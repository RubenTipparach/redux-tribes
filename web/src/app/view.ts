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
  chartDir, contourLevels, fit, radiusAt, sliceClamp, sliceFill, sliceHolds,
  sliceOutline, sliceRegion, type Fitted, type SliceCut,
} from './spline.js';
import {
  type Flight, type PlannedOrder, type Pose, type ShipState, type Vec3, type Well,
  isCommitted, PROBE_STEPS,
} from '../sim/types.js';

const CYAN = 0x35c7ff;
const ORANGE = 0xfa6a0a;
const GREEN = 0x4cd97b;
const RED = 0xff4b4b;
const MUTED = 0x7c8b9d;

const v = (a: Vec3) => new THREE.Vector3(a.x, a.y, a.z);

/** How finely the reachable set is probed. 14 cells a side is 2744 flights. */
/**
 * Cells a side for the envelope probe.
 *
 * The dense probe could afford 14, because it pays for the whole volume. The
 * octree pays for the surface, so the same budget buys a finer grid: 32 cells
 * is a cell a little over half the size for a comparable number of flights.
 * A power of two, which the traversal requires.
 */
/**
 * Resolutions the envelope sharpens through, coarsest first.
 *
 * Every octree level is a complete answer at its own cell size, so the shape
 * appears at once and gets finer over the following frames instead of the
 * console blocking on the fine one. Measured per ship on a 45 x 60 x 82 u box:
 * 8 cells costs 5 ms, 16 costs 14, 32 costs 57. 64 is a further 228 ms for a
 * cell already well under a hull radius, so it is not in the ladder: one
 * frame of 228 ms is a stutter a player feels and a cell of 1.4 u is not
 * something they can see.
 */
const ENVELOPE_LEVELS: ReadonlyArray<readonly [number, number]> =
  [[16, 10], [24, 14], [32, 18], [48, 26]];
/** Bisections a ray, over a 200 u reach: 0.05 u, well inside the 1.6 u the
 * predicate itself is fuzzy by. */
const RAY_STEPS = 12;
/** How finely the fitted surface is tessellated, as a multiple of the sample
 * grid. Twice the control density: any less throws away what a fine fit
 * bought, any more costs triangles for a curve that is already smooth. */
const TESS = 2;
/** About how many contour rungs to draw. Not exact: the interval is a round
 * number of units and the shape decides how many of them fit. */
const SLICES = 9;
/**
 * Contour intervals to choose from, smallest first. Round numbers on purpose,
 * so the ladder is an altitude scale a player can count in rather than an
 * arbitrary ninth of whatever the shape happens to be tall. 5 is the elevation
 * nudge, so at the usual reach one press steps exactly one rung.
 */
const INTERVALS = [5, 10, 20, 25, 50, 100, 200, 500];
/**
 * Points around one slice. This is the resolution of the LINE, not of the
 * probe: the fitted surface is continuous, so a finer contour costs
 * evaluations of a polynomial and not one extra flight.
 */
const SLICE_RAYS = 120;

/** One finished resolution of one ship's envelope. */
interface BuiltShell {
  readonly cells: number;
  readonly geo: THREE.BufferGeometry;
  /** The surface itself, kept so every line drawn on it is cut from the same
   * thing the skin is drawn from rather than from a second model of it. The
   * contours are NOT baked in here: they depend on where the working plane
   * sits, which moves without the surface changing at all. */
  readonly fitted: Fitted;
  readonly anchor: Vec3;
  readonly ylo: number;
  readonly yhi: number;
  readonly tris: number;
  readonly edges: number;
  readonly entries: number;
  readonly box: { right: number; up: number; forward: number };
  /** Nearest and furthest the boundary sits from the coast landing. */
  readonly reach: { min: number; max: number };
}

/** What is known about one ship's envelope, and how far it has sharpened. */
interface ShellEntry {
  key: string;
  /** Index into ENVELOPE_LEVELS of the next level still to build. */
  next: number;
  built: BuiltShell | null;
}
/**
 * Points around the working plane contour. Denser than a slice because this is
 * the line a hand aims at rather than one of nine that suggest a volume.
 */
const PLANE_RAYS = 192;
/**
 * "Close enough to count as arriving", for both the drawn boundary and the
 * click router. One constant on purpose: if the contour and the router used
 * different tolerances, the line on screen would stop being the line you can
 * click inside, and only at the edge, which is where every click that matters
 * lands.
 */
const REACH_EPS = 1.6;

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
  #planeFill: THREE.Mesh;
  /** Which shell and working plane the drawn contours belong to. */
  #wireKey = '';
  /**
   * The cut currently drawn on the working plane, kept because it is also what
   * a drag is clamped into. One region, drawn and picked against, so the marker
   * cannot sit outside the area highlighted for it.
   */
  #planeCut: { cut: SliceCut; anchor: Vec3; y: number } | null = null;
  #planeGrid: THREE.GridHelper;
  #projGroup = new THREE.Group();
  #beamGroup = new THREE.Group();
  /** The gravity field, drawn from what the match reports rather than from a
   * second model of gravity living here. */
  #wellGroup = new THREE.Group();
  /** Where our own hulls would be part way through the turn being planned. */
  #ghostGroup = new THREE.Group();
  /** Every ship's course: ours planned, theirs estimated. */
  #pathGroup = new THREE.Group();

  #ships: ShipState[] = [];
  #selected = -1;
  /**
   * Which side this client is sitting in. A rendering concern only: the
   * simulation never knows, which is what lets both seats hash the same.
   */
  mySide = 0;
  /** Cached so the envelope is not re-probed on every frame, only on change. */
  /** One entry per ship, so selecting a hull shows its envelope at once
   * instead of starting a probe. */
  #shells = new Map<number, ShellEntry>();
  /** Ships whose envelope is still sharpening, in the order they were asked
   * for. Read by the console to say so. */
  #pending: number[] = [];
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
        color: GREEN, transparent: true, opacity: 0.022, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.#scene.add(this.#shell);
    this.#scene.add(this.#wellGroup);
    this.#scene.add(this.#ghostGroup);
    this.#scene.add(this.#pathGroup);
    // The silhouette, drawn as the surface seen edge on. Every triangle edge
    // was too much: marching tetrahedra makes thin triangles and the mesh read
    // as wire soup rather than as a shape. The skin carries the volume and the
    // contour where it crosses the working plane carries the line you click
    // against, so this only needs to keep the outline from dissolving.
    this.#shellLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: GREEN, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.#scene.add(this.#shellLines);

    // Where the shell meets the working plane. The shell says where the ship
    // can go; this says where a click means it, which is the part a hand needs
    // rather than an eye.
    this.#planeShape = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.95 }),
    );
    this.#scene.add(this.#planeShape);

    // The area the ship can finish its turn in AT THIS ELEVATION, filled. The
    // shell says where it could go at all, which is a volume and reads as one;
    // this is the single horizontal slice of it a click can actually land in,
    // so it is the one thing on screen drawn as ground rather than as wire.
    this.#planeFill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: GREEN, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.#scene.add(this.#planeFill);

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

  /**
   * Keep the working plane inside the shape it is cutting.
   *
   * Off the top of the envelope there is no reachable point at that height, so
   * the aiming line correctly has nothing to draw and correctly disappears.
   * That is honest and useless: the control still moves, the readout still
   * counts up, and the thing the player was aiming with is gone with nothing
   * saying why. Holding the button now stops at the shape instead.
   *
   * Held a hair inside the extreme, because exactly at it the plane is tangent
   * and meets the surface in a point rather than a curve.
   */
  clampWorkAlt(): void {
    const sel = this.#ships.find(s => s.id === this.#selected);
    const built = sel ? this.#shells.get(sel.id)?.built : null;
    if (!sel || !built) return;
    const inset = (built.yhi - built.ylo) * 0.02;
    const lo = built.ylo + inset - sel.pos.y;
    const hi = built.yhi - inset - sel.pos.y;
    if (hi < lo) return;
    this.workAlt = Math.min(hi, Math.max(lo, this.workAlt));
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
  /**
   * Every ship's path, ours planned and theirs estimated.
   *
   * Our own come from the order being planned, so they are exactly what the
   * resolver will fly. A hostile's orders do not exist yet, so its line is the
   * course it is ALREADY on, coasted forward: an estimate, drawn dashed and
   * dimmer to say so. It is what the hull does if it does nothing, which is
   * the only honest thing to draw before the turn is released.
   */
  setPaths(paths: readonly { id: number; pts: Vec3[]; estimated: boolean }[]): void {
    while (this.#pathGroup.children.length) {
      const c = this.#pathGroup.children.pop() as THREE.Line;
      c.geometry?.dispose();
      (c.material as THREE.Material | undefined)?.dispose();
    }
    for (const p of paths) {
      if (p.pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(p.pts.map(v));
      const line = p.estimated
        ? new THREE.Line(geo, new THREE.LineDashedMaterial({
            color: ORANGE, dashSize: 2.5, gapSize: 2.5, transparent: true, opacity: 0.55,
          }))
        : new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: CYAN, transparent: true, opacity: 0.45,
          }));
      if (p.estimated) line.computeLineDistances();
      this.#pathGroup.add(line);
    }
  }

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
  /**
   * What every ship on this side can reach, computed once at the start of a
   * turn rather than when a hull is selected.
   *
   * Reachability is fixed the moment a turn opens: nothing a player does while
   * planning changes where a ship could have gone. So this is asked once per
   * ship, and picking a destination afterwards never probes anything, which is
   * what keeps the picker instant.
   *
   * The one exception is a commanded heading in slide mode. There the nose is
   * an INPUT to the flight rather than aimed at the target, and thrust is spent
   * in the ship's own frame, so turning re-points the strong drive: measured,
   * commanding a different heading moves the boundary by up to 30 u. The cache
   * key carries the face for that reason, and changing it re-opens the ladder.
   */
  planTurn(ships: readonly ShipState[], orderOf: (id: number) => PlannedOrder,
           flightOf: (id: number) => Flight, side: number): void {
    for (const ship of ships) {
      if (ship.side !== side || ship.destroyed) continue;
      this.requestShell(ship, orderOf(ship.id), flightOf(ship.id));
    }
  }

  /** Note what this ship's envelope depends on, and queue it if that changed. */
  requestShell(ship: ShipState, order: PlannedOrder, flight: Flight): void {
    if (ship.destroyed || isCommitted(order.mode)) {
      this.#shells.delete(ship.id);
      this.#pending = this.#pending.filter(id => id !== ship.id);
      return;
    }
    const key = this.#shellKeyFor(ship, order, flight);
    const have = this.#shells.get(ship.id);
    if (have && have.key === key) return;
    if (have?.built) have.built.geo.dispose();
    this.#wireKey = '';
    this.#shells.set(ship.id, { key, next: 0, built: null });
    if (!this.#pending.includes(ship.id)) this.#pending.push(ship.id);
  }

  /**
   * The inputs the boundary actually depends on. Everything here changes where
   * the ship can get to; nothing else does, which is why picking a destination
   * is not in it.
   */
  #shellKeyFor(ship: ShipState, order: PlannedOrder, flight: Flight): string {
    return [
      ship.id, order.mode,
      ship.pos.x.toFixed(2), ship.pos.y.toFixed(2), ship.pos.z.toFixed(2),
      ship.vel.x.toFixed(3), ship.vel.y.toFixed(3), ship.vel.z.toFixed(3),
      // All three components. The old key carried x and z only, so a purely
      // vertical change of commanded heading never invalidated the shell.
      order.face?.x.toFixed(3) ?? '-',
      order.face?.y.toFixed(3) ?? '-',
      order.face?.z.toFixed(3) ?? '-',
      flight.yawRate, flight.pitchRate, flight.accelFwd,
      flight.accelRetro, flight.accelLat, flight.maxSpeed,
    ].join('|');
  }

  /**
   * Build at most ONE level, for one ship, and return whether anything is
   * still outstanding.
   *
   * A level is a single call into the core that runs a whole traversal, so it
   * cannot be split part way. What keeps this off the frame budget is that the
   * levels are cheap before they are fine: the shape is up in 5 ms and only
   * then sharpens. Called once a frame, so a heavy level costs one frame and
   * never a queue of them.
   */
  stepShells(orderOf: (id: number) => PlannedOrder,
             flightOf: (id: number) => Flight,
             shipOf: (id: number) => ShipState | undefined): boolean {
    while (this.#pending.length) {
      const id = this.#pending[0]!;
      const entry = this.#shells.get(id);
      const ship = shipOf(id);
      if (!entry || !ship || entry.next >= ENVELOPE_LEVELS.length) {
        this.#pending.shift();
        continue;
      }
      const [nu, nv] = ENVELOPE_LEVELS[entry.next]!;
      const built = this.#probeShell(ship, orderOf(id), flightOf(id), nu, nv);
      if (built) {
        if (entry.built) entry.built.geo.dispose();
        entry.built = built;
        // A new level is a new surface, so whatever contours were cut from the
        // old one are stale even if the working plane has not moved.
        this.#wireKey = '';
      }
      entry.next++;
      if (entry.next >= ENVELOPE_LEVELS.length) this.#pending.shift();
      return this.#pending.length > 0;
    }
    return false;
  }

  /** How many course lines are drawn, and how long each is. Observation only,
   * for the harness. */
  pathStats(): { count: number; points: number[] } {
    return {
      count: this.#pathGroup.children.length,
      points: this.#pathGroup.children.map(
        c => (c as THREE.Line).geometry.getAttribute('position')?.count ?? 0),
    };
  }

  /** How many plan ghosts are drawn. */
  ghostCount(): number { return this.#ghostGroup.children.length; }

  /** True while any ship's envelope is still sharpening. */
  get rebuilding(): boolean { return this.#pending.length > 0; }

  /** How far the selected ship's envelope has got, for the console to show. */
  shellProgress(shipId: number): { at: string; of: string; frac: number; done: boolean } {
    const e = this.#shells.get(shipId);
    const done = !e || e.next >= ENVELOPE_LEVELS.length;
    const top = ENVELOPE_LEVELS[ENVELOPE_LEVELS.length - 1]!;
    const cur = e?.built ? [e.built.cells, e.built.edges / e.built.cells] : null;
    return {
      at: cur ? `${cur[0]} x ${cur[1]}` : 'starting',
      of: `${top[0]} x ${top[1]}`,
      frac: e ? e.next / ENVELOPE_LEVELS.length : 1,
      done,
    };
  }

  /** Show the envelope this ship already has, without probing anything. */
  drawEnvelope(ship: ShipState | undefined, order: PlannedOrder, flight: Flight): void {
    if (!ship || ship.destroyed || isCommitted(order.mode)) {
      this.#shell.visible = false;
      this.#shellLines.visible = false;
      return;
    }
    this.requestShell(ship, order, flight);
    const built = this.#shells.get(ship.id)?.built;
    if (!built) {
      this.#shell.visible = false;
      this.#shellLines.visible = false;
      return;
    }
    if (this.#shell.geometry !== built.geo) this.#shell.geometry = built.geo;

    // Contours follow the working plane, so they are cut here rather than with
    // the surface: the plane moves far more often than the surface does.
    const planeY = this.planeY();
    // The ladder itself does not move with the plane. What changes is which
    // rung is left out, so the key carries the plane rather than ignoring it.
    const key = `${ship.id}|${built.cells}|${ship.pos.y.toFixed(2)}|${planeY.toFixed(2)}`;
    if (key !== this.#wireKey) {
      this.#wireKey = key;
      const wire: number[] = [];
      const levels = contourLevels(
        built.ylo, built.yhi, ship.pos.y, planeY, SLICES, INTERVALS);
      for (const y of levels) {
        const cut = sliceRegion(built.fitted, built.anchor.y, y, SLICE_RAYS);
        wire.push(...sliceOutline(cut, built.anchor.x, built.anchor.z, y));
      }
      // The rungs are a fixed scale anchored to the ship, so this list must not
      // change as the elevation moves: only which rung drops out, being the one
      // the bright cut is already drawing.
      console.log(
        `FT rungs | ${levels.map(y => y.toFixed(1)).join(' ')}`
        + ` | anchored at ship y ${ship.pos.y.toFixed(3)}`
        + ` | plane ${planeY.toFixed(3)} takes its own rung out`,
      );
      this.#shellLines.geometry.dispose();
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
      this.#shellLines.geometry = wgeo;
    }
    this.#shell.visible = built.tris > 0;
    this.#shellLines.visible = built.tris > 0;
  }

  /**
   * Fit and tessellate the boundary at one sample density.
   *
   * The surface is closed by construction, which the marching build was not:
   * a spherical grid wraps in theta and pins at both poles, so there is no
   * seam and no box wall to be clipped against. The contours below are cut
   * from THIS mesh, so they cannot disagree with the surface they sit on.
   */
  #probeShell(
    ship: ShipState, order: PlannedOrder, flight: Flight, nu: number, nv: number,
  ): BuiltShell | null {
    const body = { pos: ship.pos, vel: ship.vel, quat: ship.quat };
    const flyOrder = order.face
      ? { mode: order.mode, face: order.face }
      : { mode: order.mode };
    // Rays are cast from where a plain coast lands, not from the hull: at
    // speed the hull is outside its own reachable set and cannot see it.
    const anchor = this.#sim.flyTurn(body, flight, { mode: order.mode }, PROBE_STEPS, 1).endPos;
    const radii = this.#sim.reachRadii(
      body, flight, flyOrder, anchor, nu, nv, REACH_EPS, RAY_STEPS, 200, PROBE_STEPS,
    );
    if (!radii) return null;
    const fitted = fit(radii, nu, nv);

    const RU = nu * TESS;
    const RV = nv * TESS;
    const pos: number[] = [];
    for (let a = 0; a <= RU; a++) {
      for (let b = 0; b <= RV; b++) {
        const u = a / RU;
        const v = b / RV;
        const d = chartDir(u, v);
        const r = Math.max(0, radiusAt(fitted, u, v));
        pos.push(anchor.x + d[0] * r, anchor.y + d[1] * r, anchor.z + d[2] * r);
      }
    }
    const idx: number[] = [];
    for (let a = 0; a < RU; a++) {
      for (let b = 0; b < RV; b++) {
        const i0 = a * (RV + 1) + b;
        const i1 = (a + 1) * (RV + 1) + b;
        idx.push(i0, i1, i0 + 1, i1, i1 + 1, i0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // How tall the shape is, which is what sets the contour interval. The
    // contours themselves are cut later, because where they sit depends on the
    // working plane and that moves without the surface changing.
    let ylo = Infinity;
    let yhi = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      const y = pos[i]!;
      if (y < ylo) ylo = y;
      if (y > yhi) yhi = y;
    }

    let rmin = Infinity;
    let rmax = 0;
    for (const r of radii) { if (r < rmin) rmin = r; if (r > rmax) rmax = r; }
    return {
      cells: nu,
      geo,
      fitted,
      anchor,
      ylo,
      yhi,
      tris: idx.length / 3,
      edges: nu * nv,
      entries: radii.length,
      box: { right: rmax, up: rmax, forward: rmax },
      reach: { min: rmin, max: rmax },
    };
  }


  /**
   * Is this point inside the area the ship can finish its turn in, AT the
   * working plane?
   *
   * Asked of the region already drawn there rather than of the core. That is
   * not a second model of the rule: the region IS the core's own bisections,
   * taken once when the turn started, which is when reachability is decided.
   * Re-probing per pointer move answers the same question again at a flight a
   * pixel, and the answer it gives can disagree with the picture, which is
   * what let a marker sit outside the area lit up for it.
   */
  sliceContains(p: Vec3): boolean {
    const c = this.#planeCut;
    if (!c) return false;
    return sliceHolds(c.cut, p.x - c.anchor.x, p.z - c.anchor.z);
  }

  /**
   * The nearest point to `p` inside the drawn region, always AT the working
   * plane.
   *
   * y comes from the plane and never from `p` or from anything interpolated.
   * The walk this replaces bisected between the click and the SHIP's own
   * position, which sits at the ship's height rather than the plane's, so the
   * point it returned drifted off the plane and out of the area drawn for it.
   */
  clampToSlice(p: Vec3): Vec3 | null {
    const c = this.#planeCut;
    if (!c) return null;
    const q = sliceClamp(c.cut, p.x - c.anchor.x, p.z - c.anchor.z);
    return q ? { x: c.anchor.x + q.dx, y: c.y, z: c.anchor.z + q.dz } : null;
  }

  /**
   * Trace the movable area where it crosses the working plane.
   *
   * A click happens on the plane, so the plane is where the boundary has to be
   * drawn. This cuts the SAME fitted surface the skin is drawn from, one
   * meridian walk per azimuth, so the bright line and the shell around it are
   * one model of the boundary rather than two that can disagree.
   *
   * It used to be marching squares over its own 40 by 40 grid of `can_reach`
   * probes, with each vertex snapped to a cell edge midpoint and no
   * interpolation at all. That was a second, coarser model of a boundary the
   * surface already described, which is the divergent path GUIDELINES 5.1
   * forbids, and it looked like one: a hard polygon sitting inside a smooth
   * shell. It also cost 1681 flights every time the working altitude moved,
   * where cutting the surface costs none.
   *
   * The drawn line may now sit up to the fit error off the predicate, 0.80 u
   * rms at the finest level, against up to half a cell of midpoint snapping
   * before. The picker is unaffected either way: it asks the core, never this.
   */
  drawPlaneShape(ship: ShipState | undefined, order: PlannedOrder, flight: Flight): void {
    if (!ship || ship.destroyed || isCommitted(order.mode)) {
      this.#planeShape.visible = false;
      this.#planeFill.visible = false;
      this.#planeCut = null;
      return;
    }
    const built = this.#shells.get(ship.id)?.built;
    if (!built) {
      this.#planeShape.visible = false;
      this.#planeFill.visible = false;
      this.#planeCut = null;
      return;
    }
    const y = this.planeY();
    const key = [
      ship.id, built.cells, y.toFixed(2),
      this.#shellKeyFor(ship, order, flight),
    ].join('|');
    if (key === this.#planeKey) return;
    this.#planeKey = key;

    // One cut, drawn twice: the ground it covers and the edge around it. Both
    // come off the same spans, so the fill cannot spill past its own outline.
    const cut = sliceRegion(built.fitted, built.anchor.y, y, PLANE_RAYS);
    const a = built.anchor;
    this.#planeCut = { cut, anchor: a, y };
    const pts = sliceOutline(cut, a.x, a.z, y);
    const tris = sliceFill(cut, a.x, a.z, y);

    this.#planeShape.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.#planeShape.geometry = geo;
    this.#planeShape.visible = pts.length > 0;

    this.#planeFill.geometry.dispose();
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    this.#planeFill.geometry = fgeo;
    this.#planeFill.visible = tris.length > 0;

    // Every vertex of both took `y` verbatim, so this reports the elevation
    // asked for beside the elevation drawn. They are the same number or there
    // is a bug, which is the only reason to print it.
    let ylo = Infinity;
    let yhi = -Infinity;
    for (const src of [pts, tris]) {
      for (let i = 1; i < src.length; i += 3) {
        if (src[i]! < ylo) ylo = src[i]!;
        if (src[i]! > yhi) yhi = src[i]!;
      }
    }
    const p = ship.pos;
    console.log(
      `FT slice | elevation ${y.toFixed(3)}`
      + ` | ship (${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})`
      + ` | work alt ${this.workAlt.toFixed(3)}`
      + ` | drawn y ${Number.isFinite(ylo) ? ylo.toFixed(3) : 'none'}`
      + ` to ${Number.isFinite(yhi) ? yhi.toFixed(3) : 'none'}`
      + ` | ${tris.length / 9} triangles, ${pts.length / 6} edges`
      + (Number.isFinite(ylo) && (ylo !== y || yhi !== y) ? '  DEVIATES' : ''),
    );
  }

  /**
   * Draw the match's gravity field.
   *
   * A well is a body plus the region where it actually bites. The rings are
   * NOT decoration and not a second gravity model: each is the radius at which
   * the pull equals a given fraction of `drive`, the ship's own main drive,
   * solved from mu / r^2 = a. So the outer ring is where the field starts to
   * be worth planning around and the inner one is where it beats the engine
   * outright. The drive comes in from the caller rather than being written
   * down here, because it is authored per class in data.rs and a copy of it
   * in the renderer is a number that can drift.
   */
  setWells(wells: Well[], drive: number): void {
    while (this.#wellGroup.children.length) {
      const c = this.#wellGroup.children.pop() as THREE.Mesh | THREE.LineSegments;
      c.geometry?.dispose();
      (c.material as THREE.Material | undefined)?.dispose();
    }
    if (!(drive > 0)) return;
    for (const w of wells) {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(2, w.soft), 24, 16),
        new THREE.MeshStandardMaterial({
          color: 0x2a3550, emissive: 0x101c33, roughness: 0.9, metalness: 0.0,
        }),
      );
      body.position.set(w.pos.x, w.pos.y, w.pos.z);
      this.#wellGroup.add(body);

      // ACCEL_FWD is the frigate main drive from data.rs. A ring at a fraction
      // of it is the honest way to show reach: the field is inverse square, so
      // a single sphere would say nothing about where it stops mattering.
      for (const [frac, colour, op] of [
        [1.0, 0xff5f6d, 0.55],
        [0.25, 0xffa23f, 0.35],
        [0.05, 0x35c7ff, 0.2],
      ] as const) {
        const r = Math.sqrt(w.mu / (drive * frac));
        if (!Number.isFinite(r) || r < w.soft) continue;
        const mat = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: op });
        for (const axis of [0, 1, 2]) {
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            const c = Math.cos(a) * r;
            const d = Math.sin(a) * r;
            pts.push(axis === 0 ? new THREE.Vector3(0, c, d)
                   : axis === 1 ? new THREE.Vector3(c, 0, d)
                                : new THREE.Vector3(c, d, 0));
          }
          const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
          ring.position.set(w.pos.x, w.pos.y, w.pos.z);
          this.#wellGroup.add(ring);
        }
      }
    }
  }

  /**
   * Ghost our hulls at a point in the plan, orientation included.
   *
   * The nose matters as much as the position: a slide order that arrives
   * pointing the wrong way is a turn spent, and this is where a player sees
   * that before committing. Only our own ships are ghosted, because the other
   * side's orders do not exist until the turn is released.
   */
  setGhosts(poses: readonly { id: number; pose: Pose }[]): void {
    while (this.#ghostGroup.children.length) {
      const c = this.#ghostGroup.children.pop() as THREE.Mesh;
      c.geometry?.dispose();
      (c.material as THREE.Material | undefined)?.dispose();
    }
    for (const g of poses) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 5.2, 4),
        new THREE.MeshBasicMaterial({
          color: CYAN, wireframe: true, transparent: true, opacity: 0.5,
        }),
      );
      // The cone points along +Y as built and a hull points along +Z, so it is
      // tipped once here rather than every frame.
      mesh.geometry.rotateX(Math.PI / 2);
      mesh.position.set(g.pose.pos.x, g.pose.pos.y, g.pose.pos.z);
      mesh.quaternion.set(g.pose.quat.x, g.pose.quat.y, g.pose.quat.z, g.pose.quat.w);
      this.#ghostGroup.add(mesh);
    }
  }

  envelopeSummary(ship: ShipState | undefined, _flight: Flight): string {
    if (!ship) return 'no ship selected';
    const e = this.#shells.get(ship.id);
    const built = e?.built;
    if (!built) return 'probing the boundary...';
    const nv = built.edges / built.cells;
    // Spacing between neighbouring rays at the widest part of the surface,
    // which is what actually sets how much detail the fit can carry.
    const spacing = (built.reach.max * Math.PI) / Math.max(1, nv - 1);
    return `bicubic surface through ${built.cells} x ${nv} rays `
      + `(${built.entries} bisected), ${built.tris} triangles, `
      + `reach ${built.reach.min.toFixed(1)} to ${built.reach.max.toFixed(1)} u, `
      + `sample spacing ${spacing.toFixed(1)} u`;
  }

  /**
   * Drop every cached envelope.
   *
   * Only for a NEW turn. Reachability is fixed while a turn is open, so
   * nothing a player does during planning belongs here: what a ship can reach
   * depends on its state, its mode, its commanded heading and its flight
   * stats, and every one of those is in the cache key, which restarts one
   * ship's ladder rather than throwing away every ship's work.
   */
  invalidateEnvelope(): void {
    for (const e of this.#shells.values()) e.built?.geo.dispose();
    this.#shells.clear();
    this.#pending = [];
    this.#planeKey = '';
    this.#wireKey = '';
  }

  render(): void {
    this.#applyCamera();
    this.#renderer.render(this.#scene, this.#camera);
  }
}

export { MUTED };
