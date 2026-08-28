/**
 * The picture, and only the picture.
 *
 * Nothing here decides anything about the game. It reads state the core owns,
 * asks the core where a ship could go, and draws the answer. That division is
 * what lets the renderer be replaced (ADR-2/ADR-15) without touching a rule:
 * the envelope drawn below has no idea what shape it is, because it is probed
 * rather than derived, so tuning the flight stats changes the picture for free
 * and changes nothing here.
 */

import * as THREE from 'three';
import type { Match } from '../sim/match.js';
import type { Sim } from '../sim/wasm.js';
import {
  type Flight, type PlannedOrder, type ShipState, type Vec3,
  isCommitted, PROBE_STEPS,
} from '../sim/types.js';

const CYAN = 0x35c7ff;
const ORANGE = 0xfa6a0a;
const GREEN = 0x4cd97b;
const RED = 0xff4b4b;
const MUTED = 0x7c8b9d;

const v = (a: Vec3) => new THREE.Vector3(a.x, a.y, a.z);

/** How finely the reachable set is probed. 14 cells a side is 2744 flights. */
const GRID_N = 14;
/**
 * Bisection steps used to place a surface vertex on the boundary. Four halves
 * the cell four times, which puts the vertex within a sixteenth of a cell of
 * the real surface: about 0.5 units at rest, against half a cell, 5.5 units,
 * for the midpoint it replaces.
 */
const BISECT_STEPS = 4;
/** Cube corners, then six tetrahedra sharing the main diagonal 0 to 6. */
const CUBE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS: ReadonlyArray<readonly number[]> = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];
/** How finely the movable AREA on the working plane is probed. */
const PLANE_N = 40;
/**
 * "Close enough to count as arriving", for both the drawn boundary and the
 * click router. One constant on purpose: if the contour and the router used
 * different tolerances, the line on screen would stop being the line you can
 * click inside, and only at the edge, which is where every click that matters
 * lands.
 */
const REACH_EPS = 1.6;

/**
 * Marching squares: which edge midpoints to join, per corner membership code.
 * Edges are 0 top, 1 right, 2 bottom, 3 left. The two saddle cases (5 and 10)
 * emit both segments rather than guessing which way the region connects.
 */
const MARCHING: number[][] = [
  [], [3, 0], [0, 1], [3, 1],
  [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [2, 0], [0, 1, 2, 3], [2, 1],
  [1, 3], [1, 0], [0, 3], [],
];

export class View {
  readonly #canvas: HTMLCanvasElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera: THREE.PerspectiveCamera;
  readonly #match: Match;
  readonly #sim: Sim;

  // camera: an orbit around a focus, which pan slides and pinch zooms
  #focus = new THREE.Vector3(0, 0, 0);
  #yaw = 0.6;
  #pitch = 0.75;
  #dist = 150;
  /** Drag on empty space orbits by default; the toolbar swaps it to pan. */
  panMode = false;

  /** The horizontal plane a click is projected onto, as an offset in y. */
  workAlt = 0;

  #hulls = new Map<number, THREE.Mesh>();
  #ring = new THREE.Mesh();
  #planLine: THREE.Line;
  #planPip: THREE.Mesh;
  #headingArrow: THREE.Line;
  #shell: THREE.Mesh;
  #shellLines: THREE.LineSegments;
  /** The outline of where a click actually becomes a move order. */
  #planeShape: THREE.LineSegments;
  #planeGrid: THREE.GridHelper;
  #projGroup = new THREE.Group();
  #beamGroup = new THREE.Group();

  #ships: ShipState[] = [];
  #selected = -1;
  /**
   * Which side this client is sitting in. A rendering concern only: the
   * simulation never knows, which is what lets both seats hash the same.
   */
  mySide = 0;
  /** Cached so the envelope is not re-probed on every frame, only on change. */
  #shellKey = '';
  #shellTris = 0;
  #shellEdges = 0;
  #planeKey = '';

  constructor(canvas: HTMLCanvasElement, match: Match, sim: Sim) {
    this.#canvas = canvas;
    this.#match = match;
    this.#sim = sim;

    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
    this.#scene.background = new THREE.Color(0x0a0e14);

    this.#scene.add(new THREE.HemisphereLight(0x5f7fa0, 0x0a0e14, 1.6));
    const key = new THREE.DirectionalLight(0xdfefff, 1.1);
    key.position.set(0.4, 1, 0.25);
    this.#scene.add(key);

    // The working plane. A click has to land somewhere, and in a 3D game with
    // no ground the somewhere has to be chosen: this is it, drawn so the
    // choice is visible rather than implied.
    this.#planeGrid = new THREE.GridHelper(400, 20, 0x1e2a3a, 0x141d29);
    this.#scene.add(this.#planeGrid);

    this.#ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 6.0, 40),
      new THREE.MeshBasicMaterial({ color: CYAN, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
    );
    this.#ring.rotation.x = -Math.PI / 2;
    this.#ring.visible = false;
    this.#scene.add(this.#ring);

    this.#planLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.75 }),
    );
    this.#scene.add(this.#planLine);

    this.#planPip = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 10),
      new THREE.MeshBasicMaterial({ color: CYAN }),
    );
    this.#planPip.visible = false;
    this.#scene.add(this.#planPip);

    this.#headingArrow = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: GREEN }),
    );
    this.#scene.add(this.#headingArrow);

    // A surface, not a cloud. Dots at the grid spacing read as scatter rather
    // than as a shape, and the shape is the entire point. The skin is drawn
    // twice: a translucent additive hull for volume, and its edges over the
    // top so the silhouette still reads against a dark field.
    this.#shell = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: GREEN, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.#scene.add(this.#shell);
    // The silhouette, drawn as the surface seen edge on. Every triangle edge
    // was too much: marching tetrahedra makes thin triangles and the mesh read
    // as wire soup rather than as a shape. The skin carries the volume and the
    // contour where it crosses the working plane carries the line you click
    // against, so this only needs to keep the outline from dissolving.
    this.#shellLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: GREEN, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.#scene.add(this.#shellLines);

    // Where the shell meets the working plane. The shell says where the ship
    // can go; this says where a click means it, which is the part a hand needs
    // rather than an eye.
    this.#planeShape = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.9 }),
    );
    this.#scene.add(this.#planeShape);

    this.#scene.add(this.#projGroup);
    this.#scene.add(this.#beamGroup);
  }

  // ------------------------------------------------------------- camera --

  resize(): void {
    const w = this.#canvas.clientWidth || 1;
    const h = this.#canvas.clientHeight || 1;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  orbit(dx: number, dy: number): void {
    this.#yaw -= dx * 0.005;
    // Dragging down raises the camera, so you end up looking down at the
    // fleet. That is the way three.js OrbitControls and most 3D tools go, and
    // it was backwards here.
    this.#pitch = Math.max(-1.45, Math.min(1.45, this.#pitch + dy * 0.005));
  }

  pan(dx: number, dy: number): void {
    // Pan in the camera's own plane, scaled by distance so the world keeps up
    // with the finger at any zoom.
    const scale = this.#dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.#camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.#camera.matrix, 1);
    this.#focus.addScaledVector(right, -dx * scale);
    this.#focus.addScaledVector(up, dy * scale);
  }

  zoom(factor: number): void {
    this.#dist = Math.max(18, Math.min(900, this.#dist * factor));
  }

  centreOn(p: Vec3): void {
    this.#focus.set(p.x, p.y, p.z);
  }

  /** Frame every live ship, so "where is everyone" is one tap away. */
  fit(): void {
    const live = this.#ships.filter(s => !s.destroyed);
    if (!live.length) return;
    const box = new THREE.Box3();
    for (const s of live) box.expandByPoint(v(s.pos));
    box.getCenter(this.#focus);
    const size = box.getSize(new THREE.Vector3()).length();
    this.#dist = Math.max(60, size * 1.4 + 40);
  }

  #applyCamera(): void {
    const cp = Math.cos(this.#pitch);
    this.#camera.position.set(
      this.#focus.x + this.#dist * cp * Math.sin(this.#yaw),
      this.#focus.y + this.#dist * Math.sin(this.#pitch),
      this.#focus.z + this.#dist * cp * Math.cos(this.#yaw),
    );
    this.#camera.lookAt(this.#focus);
  }

  // -------------------------------------------------------------- input --

  /**
   * Where a screen point meets the working plane, or null if the ray runs
   * parallel to it. This is what decides whether a drag is a move order or a
   * camera move: a drag that cannot land on the plane has nowhere to be a
   * destination, so it is camera.
   */
  planePoint(clientX: number, clientY: number): Vec3 | null {
    const rect = this.#canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.#camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.planeY());
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y, z: hit.z } : null;
  }

  planeY(): number {
    const sel = this.#ships.find(s => s.id === this.#selected);
    return (sel ? sel.pos.y : 0) + this.workAlt;
  }

  /** The ship under a screen point, or -1. Hull spheres, generously sized. */
  pickShip(clientX: number, clientY: number): number {
    const rect = this.#canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.#camera);
    let best = -1;
    let bestT = Infinity;
    for (const s of this.#ships) {
      if (s.destroyed) continue;
      const sphere = new THREE.Sphere(v(s.pos), Math.max(s.radius * 1.8, 4));
      const hit = new THREE.Vector3();
      if (ray.ray.intersectSphere(sphere, hit)) {
        const t = hit.distanceTo(this.#camera.position);
        if (t < bestT) { bestT = t; best = s.id; }
      }
    }
    return best;
  }

  // --------------------------------------------------------------- state --

  setShips(ships: ShipState[]): void {
    this.#ships = ships;
    for (const s of ships) {
      let mesh = this.#hulls.get(s.id);
      if (!mesh) {
        // A five sided cone: cheap, and its nose reads at a glance, which is
        // the one thing a player must be able to see about a ship in a game
        // where facing decides what the guns can reach.
        const geo = new THREE.ConeGeometry(s.radius * 0.62, s.radius * 2.1, 5);
        geo.rotateX(Math.PI / 2);
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
          color: s.side === this.mySide ? CYAN : ORANGE, flatShading: true, roughness: 0.55,
        }));
        this.#hulls.set(s.id, mesh);
        this.#scene.add(mesh);
      }
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      mesh.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
      mesh.visible = !s.destroyed;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(
        s.destroyed ? 0x33404f : s.drifting ? RED : s.side === this.mySide ? CYAN : ORANGE,
      );
    }
  }

  /** Pose ships from a recorded track rather than their turn end state. */
  setPoses(poses: ReadonlyArray<{ id: number; destroyed: boolean; pos: Vec3; quat: Vec3 & { w: number } }>): void {
    for (const p of poses) {
      const mesh = this.#hulls.get(p.id);
      if (!mesh) continue;
      mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
      mesh.quaternion.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
      mesh.visible = !p.destroyed;
    }
  }

  setSelection(id: number): void {
    this.#selected = id;
    const sel = this.#ships.find(s => s.id === id);
    this.#ring.visible = !!sel && !sel.destroyed;
    if (sel) {
      this.#ring.position.set(sel.pos.x, sel.pos.y + 0.02, sel.pos.z);
      this.#planeGrid.position.set(sel.pos.x, this.planeY(), sel.pos.z);
    }
  }

  setProjectiles(list: ReadonlyArray<{ missile: boolean; pos: Vec3 }>): void {
    this.#projGroup.clear();
    for (const p of list) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(p.missile ? 0.8 : 0.5, 8, 6),
        new THREE.MeshBasicMaterial({ color: p.missile ? RED : 0xffd24b }),
      );
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.#projGroup.add(m);
    }
  }

  /** Beams are events, not objects: drawn for the tick they happened on. */
  setBeams(list: ReadonlyArray<{ from: Vec3; to: Vec3 }>): void {
    this.#beamGroup.clear();
    for (const b of list) {
      const geo = new THREE.BufferGeometry().setFromPoints([v(b.from), v(b.to)]);
      this.#beamGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: CYAN, transparent: true, opacity: 0.85,
      })));
    }
  }

  // ------------------------------------------------------------- planning --

  /**
   * Draw the plan: the path the ship will fly, where it ends, and where its
   * nose will point. The path comes from the core's own integrator, so this is
   * the executed turn drawn early rather than an approximation of it.
   */
  drawPlan(ship: ShipState | undefined, order: PlannedOrder): void {
    if (!ship || ship.destroyed) {
      this.#planLine.visible = false;
      this.#planPip.visible = false;
      this.#headingArrow.visible = false;
      return;
    }
    const path = this.#match.preview(ship.id, order, 60);
    const end = this.#match.previewEnd();
    this.#planLine.geometry.dispose();
    this.#planLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map(v));
    this.#planLine.visible = path.length > 1;

    this.#planPip.position.set(end.x, end.y, end.z);
    this.#planPip.visible = true;
    // Amber when the ship cannot actually make the commanded point: the gap
    // between what was asked and what the hull can deliver is the whole
    // subject of the movement model, so it is shown rather than snapped away.
    const asked = order.target;
    const shortfall = asked
      ? Math.hypot(end.x - asked.x, end.y - asked.y, end.z - asked.z)
      : 0;
    (this.#planPip.material as THREE.MeshBasicMaterial).color.setHex(
      shortfall > 1.0 ? 0xffd24b : CYAN,
    );

    const face = order.face;
    if (face) {
      const from = v(ship.pos);
      const to = from.clone().add(new THREE.Vector3(face.x, face.y, face.z).normalize().multiplyScalar(18));
      this.#headingArrow.geometry.dispose();
      this.#headingArrow.geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      this.#headingArrow.visible = true;
    } else {
      this.#headingArrow.visible = false;
    }
  }

  /**
   * Probe the reachable set and draw its surface.
   *
   * There is no formula to consult. The set has no closed form once rotation
   * rates, per axis thrust limits and carried velocity all constrain it, so
   * the only honest way to know where a ship can get to is to fly it there and
   * see. That is what this does, once per grid cell, in a single crossing.
   */
  drawEnvelope(ship: ShipState | undefined, order: PlannedOrder, flight: Flight): void {
    if (!ship || ship.destroyed || isCommitted(order.mode)) {
      this.#shell.visible = false;
      this.#shellLines.visible = false;
      return;
    }
    // Size the box from what the hull can actually cover, plus the ground the
    // carried velocity will make regardless. maxSpeed alone over-sizes it by
    // roughly double, and an over-sized box spends its cells on empty space:
    // the shell comes out coarse and the shape stops being readable, which is
    // the one thing it exists to show.
    const half = this.probeHalf(ship, flight);
    const key = [
      ship.id, order.mode, half.toFixed(1),
      ship.pos.x.toFixed(2), ship.pos.y.toFixed(2), ship.pos.z.toFixed(2),
      ship.vel.x.toFixed(3), ship.vel.y.toFixed(3), ship.vel.z.toFixed(3),
      order.face?.x.toFixed(3) ?? '-', order.face?.z.toFixed(3) ?? '-',
      flight.yawRate, flight.pitchRate, flight.accelFwd,
      flight.accelRetro, flight.accelLat, flight.maxSpeed,
    ].join('|');
    if (key === this.#shellKey) return;
    this.#shellKey = key;

    const body = { pos: ship.pos, vel: ship.vel, quat: ship.quat };
    const flyOrder = order.face
      ? { mode: order.mode, face: order.face }
      : { mode: order.mode };
    const grid = this.#sim.reachGrid(
      body, flight, flyOrder, ship.pos, half, GRID_N, REACH_EPS, PROBE_STEPS,
    );

    // Marching tetrahedra over the sampled field. Six tets per cube sharing
    // the main diagonal gives sixteen cases and no 256 entry table, and it is
    // watertight for any topology, which matters here: a ship carrying speed
    // cannot stop where it already is, so the reachable set has a pocket
    // around the hull that a ray cast from one centre cannot describe.
    //
    // Every vertex is then BISECTED onto the real boundary rather than dropped
    // at the edge midpoint. A midpoint sits up to half a cell off, which is
    // what made the old shell look blocky, and the correction is the same
    // question the router asks: can the ship finish here.
    const step = (2 * half) / GRID_N;
    const px = (i: number) => ship.pos.x - half + (i + 0.5) * step;
    const py = (j: number) => ship.pos.y - half + (j + 0.5) * step;
    const pz = (k: number) => ship.pos.z - half + (k + 0.5) * step;
    const at = (i: number, j: number, k: number) =>
      i >= 0 && j >= 0 && k >= 0 && i < GRID_N && j < GRID_N && k < GRID_N && grid.at(i, j, k);

    // A crossing edge is shared by several tetrahedra, so solve it once and
    // key the answer by the edge. Without that the same edge is bisected four
    // or five times over and the placement looks far dearer than it is.
    const edge = new Map<number, Vec3>();
    const edgeKey = (a: number[], b: number[]) => {
      const ka = (a[0]! * GRID_N + a[1]!) * GRID_N + a[2]!;
      const kb = (b[0]! * GRID_N + b[1]!) * GRID_N + b[2]!;
      return ka < kb ? ka * 1e7 + kb : kb * 1e7 + ka;
    };
    const surfacePoint = (ga: number[], gb: number[]): Vec3 => {
      const k = edgeKey(ga, gb);
      const hit = edge.get(k);
      if (hit) return hit;
      const A = { x: px(ga[0]!), y: py(ga[1]!), z: pz(ga[2]!) };
      const B = { x: px(gb[0]!), y: py(gb[1]!), z: pz(gb[2]!) };
      const inside = at(ga[0]!, ga[1]!, ga[2]!);
      const from = inside ? A : B;
      const to = inside ? B : A;
      let lo = 0;
      let hi = 1;
      for (let n = 0; n < BISECT_STEPS; n++) {
        const m = (lo + hi) / 2;
        const q = {
          x: from.x + (to.x - from.x) * m,
          y: from.y + (to.y - from.y) * m,
          z: from.z + (to.z - from.z) * m,
        };
        if (this.#sim.canReach(body, flight, flyOrder, q, REACH_EPS, PROBE_STEPS)) lo = m;
        else hi = m;
      }
      const v: Vec3 = {
        x: from.x + (to.x - from.x) * lo,
        y: from.y + (to.y - from.y) * lo,
        z: from.z + (to.z - from.z) * lo,
      };
      edge.set(k, v);
      return v;
    };

    const tri: number[] = [];
    const wire: number[] = [];
    // Keep an edge only if exactly one triangle owns it. A shared edge lies
    // inside the skin and drawing it is what turned the shell into wire soup.
    const seen = new Map<string, [Vec3, Vec3]>();
    const rim = (a: Vec3, b: Vec3) => {
      const q = (v: Vec3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
      const ka = q(a);
      const kb = q(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(k)) seen.delete(k);
      else seen.set(k, [a, b]);
    };
    const push = (a: Vec3, b: Vec3, c: Vec3) => {
      tri.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      rim(a, b); rim(b, c); rim(c, a);
    };
    for (let i = 0; i < GRID_N - 1; i++) {
      for (let j = 0; j < GRID_N - 1; j++) {
        for (let k = 0; k < GRID_N - 1; k++) {
          const corner = CUBE.map(([dx, dy, dz]) => [i + dx!, j + dy!, k + dz!]);
          const inside = corner.map((c) => at(c[0]!, c[1]!, c[2]!));
          let n = 0;
          for (const b of inside) if (b) n++;
          if (n === 0 || n === 8) continue;
          for (const tet of TETS) {
            const ins = tet.filter((t) => inside[t!]);
            const outs = tet.filter((t) => !inside[t!]);
            const g = (t: number) => corner[t]!;
            if (ins.length === 1) {
              const a = ins[0]!;
              push(surfacePoint(g(a), g(outs[0]!)),
                   surfacePoint(g(a), g(outs[1]!)),
                   surfacePoint(g(a), g(outs[2]!)));
            } else if (ins.length === 3) {
              const o = outs[0]!;
              push(surfacePoint(g(ins[0]!), g(o)),
                   surfacePoint(g(ins[1]!), g(o)),
                   surfacePoint(g(ins[2]!), g(o)));
            } else if (ins.length === 2) {
              const [a, b] = ins as [number, number];
              const [c, d] = outs as [number, number];
              const v1 = surfacePoint(g(a), g(c));
              const v2 = surfacePoint(g(a), g(d));
              const v3 = surfacePoint(g(b), g(d));
              const v4 = surfacePoint(g(b), g(c));
              push(v1, v2, v3);
              push(v1, v3, v4);
            }
          }
        }
      }
    }

    this.#shell.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    geo.computeVertexNormals();
    this.#shell.geometry = geo;
    this.#shell.visible = tri.length > 0;

    for (const [a, b] of seen.values()) {
      wire.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    this.#shellLines.geometry.dispose();
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    this.#shellLines.geometry = wgeo;
    this.#shellLines.visible = wire.length > 0;
    this.#shellTris = tri.length / 9;
    this.#shellEdges = edge.size;
  }

  /**
   * Can this ship finish its turn at this exact point?
   *
   * The one authority on whether a click is a move order. Asking the core the
   * real question costs a single flight, which is nothing, and it means the
   * router can never disagree with the model about what is reachable. The
   * alternative, a radius, was wrong in both directions at once: it accepted
   * clicks far outside a lobe that does not extend that way, and rejected
   * nothing at all behind a ship carrying velocity.
   */
  canReachPoint(ship: ShipState, flight: Flight, order: PlannedOrder, p: Vec3): boolean {
    if (isCommitted(order.mode)) return false;
    const body = { pos: ship.pos, vel: ship.vel, quat: ship.quat };
    const flyOrder = order.face
      ? { mode: order.mode, face: order.face }
      : { mode: order.mode };
    return this.#sim.canReach(body, flight, flyOrder, p, REACH_EPS, PROBE_STEPS);
  }

  /**
   * Trace the movable area where it crosses the working plane.
   *
   * The shell is a cloud of points in three dimensions, which reads well as a
   * shape and badly as a target. A click happens on the plane, so the plane is
   * where the boundary has to be drawn. Marching squares over the same
   * predicate the router uses, so the line and the rule are one thing: the
   * contour is a discretisation of it, and can disagree by under half a cell
   * right at the edge, which is the only honest way to draw a curve on a grid.
   */
  drawPlaneShape(ship: ShipState | undefined, order: PlannedOrder, flight: Flight): void {
    if (!ship || ship.destroyed || isCommitted(order.mode)) {
      this.#planeShape.visible = false;
      return;
    }
    const half = this.probeHalf(ship, flight);
    const y = this.planeY();
    const key = [
      ship.id, order.mode, half.toFixed(1), y.toFixed(2),
      ship.pos.x.toFixed(2), ship.pos.y.toFixed(2), ship.pos.z.toFixed(2),
      ship.vel.x.toFixed(3), ship.vel.y.toFixed(3), ship.vel.z.toFixed(3),
      order.face?.x.toFixed(3) ?? '-', order.face?.z.toFixed(3) ?? '-',
      flight.yawRate, flight.pitchRate, flight.accelFwd,
      flight.accelRetro, flight.accelLat, flight.maxSpeed,
    ].join('|');
    if (key === this.#planeKey) return;
    this.#planeKey = key;

    const step = (2 * half) / PLANE_N;
    const x0 = ship.pos.x - half;
    const z0 = ship.pos.z - half;
    const px = (i: number) => x0 + i * step;
    const pz = (j: number) => z0 + j * step;

    // Membership at every grid CORNER, so a cell can read its four corners
    // without probing any point twice.
    const n = PLANE_N + 1;
    const inside = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        inside[i * n + j] =
          this.canReachPoint(ship, flight, order, { x: px(i), y, z: pz(j) }) ? 1 : 0;
      }
    }

    const pts: number[] = [];
    const mid = (e: number, i: number, j: number): [number, number] => {
      switch (e) {
        case 0: return [px(i + 0.5), pz(j)];
        case 1: return [px(i + 1), pz(j + 0.5)];
        case 2: return [px(i + 0.5), pz(j + 1)];
        default: return [px(i), pz(j + 0.5)];
      }
    };
    for (let i = 0; i < PLANE_N; i++) {
      for (let j = 0; j < PLANE_N; j++) {
        const code =
          (inside[i * n + j] ?? 0) |
          ((inside[(i + 1) * n + j] ?? 0) << 1) |
          ((inside[(i + 1) * n + j + 1] ?? 0) << 2) |
          ((inside[i * n + j + 1] ?? 0) << 3);
        const edges = MARCHING[code] ?? [];
        for (let e = 0; e < edges.length; e += 2) {
          const a = mid(edges[e] ?? 0, i, j);
          const b = mid(edges[e + 1] ?? 0, i, j);
          pts.push(a[0], y, a[1], b[0], y, b[1]);
        }
      }
    }
    this.#planeShape.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.#planeShape.geometry = geo;
    this.#planeShape.visible = pts.length > 0;
  }

  /**
   * How far out to probe. The core owns the reach; the momentum term is this
   * side's business, since it is about framing rather than about flight.
   */
  probeHalf(ship: ShipState, flight: Flight): number {
    const carried = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    const reach = this.#match.nominalReach(ship.id) || flight.maxSpeed * 5;
    return Math.max(30, reach * 1.25 + carried * 5);
  }

  /** Cells probed, cells reachable, and the volume that implies. */
  envelopeSummary(ship: ShipState | undefined, flight: Flight): string {
    if (!ship) return 'no ship selected';
    const half = this.probeHalf(ship, flight);
    const cell = (2 * half) / GRID_N;
    return `${GRID_N}<sup>3</sup> probes over ${(2 * half).toFixed(0)} units, `
      + `${this.#shellTris} triangles from ${this.#shellEdges} bisected edges, `
      + `cell ${cell.toFixed(1)} u`;
  }

  invalidateEnvelope(): void {
    this.#shellKey = '';
    this.#planeKey = '';
  }

  render(): void {
    this.#applyCamera();
    this.#renderer.render(this.#scene, this.#camera);
  }
}

export { MUTED };
