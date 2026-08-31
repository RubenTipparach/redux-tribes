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
  type Flight, type PlannedOrder, type Pose, type ShipState, type SubState,
  type Vec3, type Well,
  CLASS_KEYS, isCommitted, Mode, PROBE_STEPS,
} from '../sim/types.js';
import { stockFor, type Design } from './design.js';
import { hullMesh, hullTone, tintHull, type HullMesh } from './hull.js';

/**
 * How close the camera has to be for the ship inspector to be offered, as
 * multiples of the hull's own radius: distance, and how far off the hull the
 * camera may be aimed. Ten radii puts a frigate at about a third of the
 * screen, which is the point at which its parts are worth labelling, and it
 * clears the camera's own closest approach of 18 u for the smallest hull the
 * span floor allows, so a fully zoomed in ship is always inside it.
 */
const INSPECT_SPANS = 10;
const INSPECT_OFF = 4;

/** How long a chunk of hull stays on screen, in ticks: three seconds. */
const DEBRIS_TICKS = 180;
/** Chunks one hit may throw, and how many may be in the air at once. A hull
 *  coming apart is a few dozen cells, not a snowstorm. */
const DEBRIS_PER_HIT = 14;
const DEBRIS_MAX = 400;

/** A hit, in the frame the hull is drawn in and the frame the chunks fly in. */
export interface HullHit {
  readonly ship: number;
  /** Where it landed in the hull's OWN space, which is where cells live. */
  readonly local: readonly [number, number, number];
  /** And in the world, which is where the chunks come from. */
  readonly world: Vec3;
  readonly tick: number;
  readonly radius: number;
}

interface Debris {
  readonly at: THREE.Vector3;
  readonly dir: THREE.Vector3;
  readonly hex: number;
}

interface Carved {
  readonly hull: HullMesh;
  /** This ship's own copy, so a hole in one is not a hole in every hull of the
   *  same design. */
  readonly geo: THREE.BufferGeometry;
  readonly dead: Uint8Array;
  readonly born: Map<number, Debris[]>;
  readonly cells: Set<number>;
  upTo: number;
}

const CYAN = 0x35c7ff;
const ORANGE = 0xfa6a0a;
const GREEN = 0x4cd97b;
const RED = 0xff4b4b;
const MUTED = 0x7c8b9d;
const FLAME = 0xffd24b;
const WHITE = 0xfff3d0;

/**
 * How long an effect is on screen, in ticks of the 60 Hz sim clock.
 *
 * A kill runs two whole seconds, because losing a hull is the event of the
 * turn and a flicker is not an ending. A hit is half a second, and a beam
 * holds for one: long enough to see which mount fired at what, short enough
 * that a turn's worth of them is a battle rather than a lightshow.
 */
export const KILL_TICKS = 120;
export const HIT_TICKS = 30;
export const BEAM_TICKS = 60;
/** The longest anything burns, which is how much playback tail a turn may
 * need before the next one starts. */
export const FX_TICKS = Math.max(KILL_TICKS, HIT_TICKS, BEAM_TICKS);
/** A kill's fireball, as a multiple of the hull radius it consumed. */
const KILL_REACH = 7.5;

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
/**
 * How still a heading has to be before the boundary is re-probed, while it is
 * under a finger. A trailing debounce: a drag that keeps moving never pays for
 * a rebuild it is about to invalidate.
 */
const SETTLE_MS = 180;
/**
 * And the longest the drawn boundary may lag a heading that never settles, so
 * a slow continuous sweep still shows roughly where it can get to rather than
 * where it could a second ago. The throttle over the debounce.
 */
const LIVE_MAX_MS = 700;
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
  /** True while `built` belongs to a superseded key: drawn, but not current. */
  stale: boolean;
  /** True while the ladder is capped at its coarsest rung because a heading is
   * under a finger. Cleared, and the rest of the ladder queued, on release. */
  coarse: boolean;
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
  /**
   * Which design each ship is flying, so the battlefield can draw the hull a
   * player built rather than a cone standing in for it.
   *
   * Set by the app, because which design a ship carries is a match fact the
   * console knows and the renderer does not: side 0 flies what was picked in
   * the lobby, everybody else flies their class's stock hull.
   */
  #designs = new Map<number, Design>();
  /** What each hull is currently tinted for, so a repaint that would change
   *  nothing does not touch the GPU. */
  #tint = new Map<number, number>();
  /** What has been shot off each hull, and the chunks it threw. */
  #carved = new Map<number, Carved>();
  #debris: THREE.InstancedMesh | null = null;

  /**
   * This ship's own copy of its hull, made the first time it takes damage.
   *
   * Designs are shared: four ships out of one design draw one geometry, which
   * is the whole reason the map can afford them. The moment one of them starts
   * losing cells it needs its own, or a hole in one would be a hole in all of
   * them.
   */
  #carveOf(id: number): Carved | null {
    const found = this.#carved.get(id);
    if (found) return found;
    const mesh = this.#hulls.get(id);
    const s = this.#ships.find(x => x.id === id);
    if (!mesh || !s) return null;
    const design = this.#designs.get(id) ?? stockFor(CLASS_KEYS[s.cls] ?? 'terran_frigate');
    const hull = hullMesh(design);
    const geo = hull.geo.clone();
    mesh.geometry = geo;
    const c: Carved = {
      hull, geo, dead: new Uint8Array(hull.quads), born: new Map(), cells: new Set(), upTo: -1,
    };
    this.#carved.set(id, c);
    return c;
  }

  /** Put a hull back together, which is what scrubbing backwards means. */
  #resetCarve(id: number): void {
    const c = this.#carved.get(id);
    if (!c) return;
    const mesh = this.#hulls.get(id);
    if (mesh) mesh.geometry = c.hull.geo;
    c.geo.dispose();
    this.#carved.delete(id);
  }

  /**
   * Take the cells one hit reached off a hull.
   *
   * A quad is collapsed rather than removed: four vertices onto one point is a
   * pair of degenerate triangles the rasteriser throws away, and it costs one
   * write to a buffer that is already on the card. Rebuilding the index for
   * every hit would cost the whole hull.
   */
  #applyHit(c: Carved, h: HullHit): void {
    const pos = c.geo.getAttribute('position') as THREE.BufferAttribute;
    const col = c.hull.geo.getAttribute('color') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const born: Debris[] = [];

    // Where the shot actually met the hull.
    //
    // A hit event carries the point on the ship's COLLISION SPHERE, and that
    // sphere circumscribes the long axis: on a Terran it is 3.29 units against
    // a hull 1.2 by 0.76 by 3.2, so a hit abeam lands two units off the flank
    // and a carve measured from it took nothing at all. The nearest cell is
    // the cell the shot came in at, and it is on the right side of the ship
    // because the sphere point is in the direction the shot arrived from.
    let near = -1, best = Infinity;
    for (let q = 0; q < c.hull.quads; q++) {
      if (c.dead[q]) continue;
      const dx = (c.hull.centre[q * 3] as number) - h.local[0];
      const dy = (c.hull.centre[q * 3 + 1] as number) - h.local[1];
      const dz = (c.hull.centre[q * 3 + 2] as number) - h.local[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; near = q; }
    }
    if (near < 0) return;
    const ax = c.hull.centre[near * 3] as number;
    const ay = c.hull.centre[near * 3 + 1] as number;
    const az = c.hull.centre[near * 3 + 2] as number;

    const r2 = h.radius * h.radius;
    for (let q = 0; q < c.hull.quads; q++) {
      if (c.dead[q]) continue;
      const dx = (c.hull.centre[q * 3] as number) - ax;
      const dy = (c.hull.centre[q * 3 + 1] as number) - ay;
      const dz = (c.hull.centre[q * 3 + 2] as number) - az;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      c.dead[q] = 1;
      const b = q * 12;
      for (let v = 1; v < 4; v++) {
        arr[b + v * 3] = arr[b] as number;
        arr[b + v * 3 + 1] = arr[b + 1] as number;
        arr[b + v * 3 + 2] = arr[b + 2] as number;
      }
      // One chunk per CELL, not per face: a corner cell has three quads and
      // three chunks off one cell is three times the debris nobody asked for.
      // The cell is counted whether or not it throws one, because how much of
      // a hull is gone and how much of it is in the air are two questions.
      const cell = c.hull.cellOf[q] as number;
      if (c.cells.has(cell)) continue;
      c.cells.add(cell);
      if (born.length >= DEBRIS_PER_HIT) continue;
      // Away from the hit, jittered by a hash of the cell so the same shot
      // throws the same chunks on both screens and on a re-watch.
      const rnd = (salt: number) => {
        const x = Math.imul(cell ^ (h.tick * 2654435761) ^ salt, 2246822519) >>> 0;
        return (x % 2048) / 1024 - 1;
      };
      born.push({
        at: new THREE.Vector3(h.world.x, h.world.y, h.world.z),
        dir: new THREE.Vector3(dx + rnd(1) * 0.6, dy + rnd(2) * 0.6, dz + rnd(3) * 0.6)
          .normalize().multiplyScalar(0.6 + 0.5 * (rnd(4) + 1)),
        hex: new THREE.Color(
          col.array[q * 12] as number, col.array[q * 12 + 1] as number,
          col.array[q * 12 + 2] as number).getHex(),
      });
    }
    pos.needsUpdate = true;
    if (born.length) c.born.set(h.tick, [...(c.born.get(h.tick) ?? []), ...born]);
  }

  /** The chunks in flight, as one instanced mesh however many there are. */
  #drawDebris(chunks: ReadonlyArray<{ at: THREE.Vector3; dir: THREE.Vector3; age: number; hex: number }>): void {
    if (!this.#debris) {
      this.#debris = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshLambertMaterial({ transparent: true }),
        DEBRIS_MAX);
      this.#debris.frustumCulled = false;
      this.#scene.add(this.#debris);
    }
    const mesh = this.#debris;
    const n = Math.min(chunks.length, DEBRIS_MAX);
    mesh.count = n;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const at = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const d = chunks[i] as { at: THREE.Vector3; dir: THREE.Vector3; age: number; hex: number };
      // Out and slowing, shrinking as it goes, so the field does not silt up
      // with the wreckage of a long match.
      const t = d.age * (2 - d.age);
      at.copy(d.at).addScaledVector(d.dir, t * 6);
      q.setFromAxisAngle(d.dir, d.age * 7);
      const s = 0.16 * (1 - d.age * 0.75);
      scale.set(s, s, s);
      mesh.setMatrixAt(i, m.compose(at, q, scale));
      mesh.setColorAt(i, c.setHex(d.hex));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    (mesh.material as THREE.MeshLambertMaterial).opacity = 1;
    mesh.visible = n > 0;
  }
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
  /** Blasts: kills, collisions and hits, drawn for the tick being shown. */
  #fxGroup = new THREE.Group();
  /** Where hulls have actually been, one line per ship per turn flown. */
  #trailGroup = new THREE.Group();
  /** The gravity field, drawn from what the match reports rather than from a
   * second model of gravity living here. */
  #wellGroup = new THREE.Group();
  /** Where our own hulls would be part way through the turn being planned. */
  #ghostGroup = new THREE.Group();
  /** Every ship's course: ours planned, theirs estimated. */
  #pathGroup = new THREE.Group();
  /** Who is aiming at whom, drawn hull to hull. */
  #aimGroup = new THREE.Group();
  /** The yaw ring around the arrival estimate, and the knob you drag on it. */
  #yawRing: THREE.Line;
  #yawKnob: THREE.Mesh;
  /** Where the ring is centred and how wide, so a pointer can be tested
   * against it without guessing at the geometry that drew it. */
  #yawAt: { centre: Vec3; radius: number } | null = null;

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
  /** True while a heading is being dragged, so the boundary is not re-probed
   * once per pointer event. */
  #live = false;
  /** Ships whose boundary is out of date because a heading is still moving. */
  #deferred = new Set<number>();
  /** When the heading last moved, and when a deferred rebuild last ran. */
  #movedAt = 0;
  #liveBuiltAt = 0;

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

    // Yaw, as a ring around where the ship ends up. The heading is a direction
    // in the working plane, so the control is a direction in the working plane:
    // a dial reads as an angle, where two nudge buttons read as a rate.
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.#yawRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.4 }),
    );
    this.#yawRing.visible = false;
    this.#scene.add(this.#yawRing);
    this.#yawKnob = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: CYAN }),
    );
    this.#yawKnob.visible = false;
    this.#scene.add(this.#yawKnob);

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
    this.#scene.add(this.#aimGroup);
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
    this.#scene.add(this.#fxGroup);
    this.#scene.add(this.#trailGroup);
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

  /**
   * Is the camera close enough to one hull to read the parts on it?
   *
   * Two conditions, because either alone lies. Zoomed right in on empty space
   * a hundred units from the fleet is close, and it is not close TO anything;
   * centred on a ship from six hundred units away is aimed at it and shows a
   * dot. So the camera has to be both near in distance and pointed near the
   * hull, measured against the hull's own size so a freighter and a frigate
   * both have to be looked at properly rather than a fixed number suiting one
   * of them.
   *
   * Framing, so it is the client's (CLAUDE.md, "What the client may compute").
   * Nothing downstream of it changes the simulation: it decides whether an
   * overlay is offered.
   */
  closeUpOn(ship: ShipState): boolean {
    const span = Math.max(ship.radius, 2);
    if (this.#dist > span * INSPECT_SPANS) return false;
    return this.#focus.distanceTo(v(ship.pos)) <= span * INSPECT_OFF;
  }

  /**
   * Which of one ship's hit volumes is under a screen point, or -1.
   *
   * The volumes come in from the core already placed in the world, so this
   * only turns a ray into an index. Nearest wins, since a belt sphere and a
   * drive sphere overlap on most hulls.
   */
  pickSub(clientX: number, clientY: number, volumes: ReadonlyArray<SubState>): number {
    const rect = this.#canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ), this.#camera);
    let best = -1;
    let bestT = Infinity;
    const hit = new THREE.Vector3();
    for (const b of volumes) {
      if (ray.ray.intersectSphere(new THREE.Sphere(v(b.pos), b.radius), hit)) {
        const t = hit.distanceTo(this.#camera.position);
        if (t < bestT) { bestT = t; best = b.index; }
      }
    }
    return best;
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

  /**
   * What each ship is flying. Call before `setShips`, whenever a match starts.
   *
   * Rebuilding a hull is a rasterisation, so it happens here rather than per
   * frame; `hullCells` caches by design, and a skirmish is four ships out of
   * at most five distinct designs.
   */
  setDesigns(designs: ReadonlyMap<number, Design>): void {
    this.#designs = new Map(designs);
    for (const [, mesh] of this.#hulls) {
      this.#scene.remove(mesh);
      // The geometry belongs to the design cache and is shared; the material
      // is this ship's own.
      (mesh.material as THREE.Material).dispose();
    }
    this.#hulls.clear();
    this.#tint.clear();
  }

  /**
   * A ship's hull, as the cells it is built out of.
   *
   * Tinted toward its side rather than painted over: whose ship this is has to
   * be readable across the map at a glance, and a hull in its own faction
   * colours alone is a hull a player has to squint at. Sixty percent the
   * design's own colour, forty percent the side, which keeps a Karisen stripe
   * a Karisen stripe and still says whose it is.
   */
  #buildHull(s: ShipState): THREE.Mesh {
    const design = this.#designs.get(s.id) ?? stockFor(CLASS_KEYS[s.cls] ?? 'terran_frigate');
    const hull: HullMesh = hullMesh(design);
    const mesh = new THREE.Mesh(hull.geo, new THREE.MeshLambertMaterial({
      vertexColors: true,
    }));
    this.#tintHull(mesh, s);
    return mesh;
  }

  /**
   * Whose ship this is, said in colour.
   *
   * A hull in nothing but its own faction paint is a hull a player has to
   * squint at, and which ships are yours is the first thing the map has to
   * answer. The design's colours stay: the MATERIAL is tinted rather than the
   * cells, so a Karisen stripe is still a Karisen stripe under a cyan wash,
   * and a repaint is one number rather than a walk over every face.
   */
  #tintHull(mesh: THREE.Mesh, s: ShipState): void {
    const tone = hullTone(s, this.mySide);
    if (this.#tint.get(s.id) === tone) return;
    this.#tint.set(s.id, tone);
    tintHull(mesh.material as THREE.MeshLambertMaterial, tone, s.destroyed);
  }

  /**
   * Where a world point lands on screen, in CSS pixels.
   *
   * The reverse of the pick ray, and the thing a harness needs to aim a click
   * at a particular ship rather than at the middle of the canvas.
   */
  screenOf(at: Vec3): { x: number; y: number } {
    const v = new THREE.Vector3(at.x, at.y, at.z).project(this.#camera);
    const r = this.#renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (0.5 - v.y * 0.5) * r.height,
    };
  }

  /**
   * What a turn has taken off each hull, as a pure function of the tick.
   *
   * A hit removes the cells it reached, and the chunks fly off and fade. Both
   * are the CLIENT's: what a hole means is already the subsystem model's job,
   * and the cells coming off follow the damage rather than deciding it. That
   * is why none of this is in the state hash and none of it crosses the
   * boundary. It still matches on two screens, because both are drawing the
   * same event stream and the drift directions are hashed from the event
   * rather than rolled.
   *
   * Scrubbing backwards un-carves: the hits are re-applied from nothing when
   * the tick goes back, which is what makes the picture a function of the tick
   * rather than a pile of side effects.
   */
  setDamage(hits: ReadonlyArray<HullHit>, tick: number): void {
    const live = new Set<number>();
    for (const h of hits) live.add(h.ship);
    for (const [id, c] of this.#carved) {
      if (!live.has(id) || tick < c.upTo) this.#resetCarve(id);
    }
    const chunks: Array<{ at: THREE.Vector3; dir: THREE.Vector3; age: number; hex: number }> = [];
    for (const h of hits) {
      if (h.tick > tick) continue;
      const c = this.#carveOf(h.ship);
      if (!c) continue;
      if (h.tick > c.upTo) this.#applyHit(c, h);
      const age = (tick - h.tick) / DEBRIS_TICKS;
      if (age >= 0 && age < 1) {
        for (const d of c.born.get(h.tick) ?? []) {
          chunks.push({ at: d.at, dir: d.dir, age, hex: d.hex });
        }
      }
    }
    for (const c of this.#carved.values()) c.upTo = Math.max(c.upTo, tick);
    this.#drawDebris(chunks);
  }

  /** What has come off the hulls, and what is in the air: cells carved per
   *  ship, and chunks currently drawn. Observation only. */
  damageState(): { carved: Array<[number, number]>; chunks: number } {
    return {
      carved: [...this.#carved].map(([id, c]) => [id, c.cells.size] as [number, number]),
      chunks: this.#debris?.visible ? this.#debris.count : 0,
    };
  }

  /** How many quads each hull on screen is, for weighing what they cost. */
  hullQuads(): number[] {
    return [...this.#hulls.values()].map(m => (m.geometry.getIndex()?.count ?? 0) / 6);
  }

  /** Hide every hull, to measure what the rest of the frame costs without
   *  them. Observation only: nothing in the console turns this off. */
  hullsVisible(on: boolean): void {
    for (const m of this.#hulls.values()) m.visible = on;
  }

  setShips(ships: ShipState[]): void {
    this.#ships = ships;
    for (const s of ships) {
      let mesh = this.#hulls.get(s.id);
      if (!mesh) {
        mesh = this.#buildHull(s);
        this.#hulls.set(s.id, mesh);
        this.#scene.add(mesh);
      }
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      mesh.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
      mesh.visible = !s.destroyed;
      this.#tintHull(mesh, s);
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

  /**
   * Beams are events, not objects: drawn from the tick they fired on, for as
   * long as the mount holds them.
   *
   * A beam holds bright for the first third of its second and then dies down,
   * which is what a sustained shot looks like and what a line that simply
   * vanishes never does. `age` is passed in for the same reason a blast's is:
   * scrubbing must be able to run one backwards.
   */
  setBeams(list: ReadonlyArray<{ from: Vec3; to: Vec3; age: number }>): void {
    for (const c of this.#beamGroup.children) {
      (c as THREE.Line).geometry.dispose();
      ((c as THREE.Line).material as THREE.Material).dispose();
    }
    this.#beamGroup.clear();
    for (const b of list) {
      const a = Math.max(0, Math.min(1, b.age));
      const geo = new THREE.BufferGeometry().setFromPoints([v(b.from), v(b.to)]);
      this.#beamGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: CYAN, transparent: true,
        opacity: a < 0.35 ? 0.95 : 0.95 * (1 - (a - 0.35) / 0.65),
        blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }
  }

  /**
   * Blasts, drawn from the same event stream the beams come from.
   *
   * A pure function of (event tick, tick being shown): `age` is passed in
   * rather than accumulated here, so scrubbing backwards runs an explosion
   * backwards and pausing holds it. Animation state kept in the renderer would
   * make the picture depend on how the player got to a tick rather than on
   * which tick it is.
   *
   * A kill is three things because one sphere reads as a bubble: a white core
   * that flashes and shrinks, a fireball that expands to KILL_REACH hull radii
   * and fades, and a flat ring that keeps expanding past both, which is what
   * makes it legible from a camera looking down the blast rather than across
   * it. Additive and depth-write off, so they light each other instead of
   * cutting holes.
   */
  setBlasts(list: ReadonlyArray<{ pos: Vec3; age: number; radius: number; kill: boolean }>): void {
    for (const c of this.#fxGroup.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.#fxGroup.clear();
    for (const b of list) {
      const a = Math.max(0, Math.min(1, b.age));
      const at = v(b.pos);
      // An explosion leaps and then lingers: it reaches its size in the first
      // third of its life and spends the rest fading. Growth spread evenly
      // over two seconds would be a balloon inflating, not a hull coming
      // apart, which is why the reach and the fade run on separate clocks.
      const grow = (frac: number) => {
        const g = Math.min(1, a / frac);
        return 1 - (1 - g) * (1 - g);
      };
      if (!b.kill) {
        this.#fxGroup.add(this.#blastMesh(
          new THREE.SphereGeometry(b.radius * (0.35 + 2.2 * grow(0.35)), 10, 8),
          at, FLAME, (1 - a) * 0.9));
        continue;
      }
      const out = grow(0.32);
      const reach = b.radius * KILL_REACH;
      this.#fxGroup.add(this.#blastMesh(
        new THREE.SphereGeometry(reach * (0.18 + 0.82 * out), 20, 14),
        at, a < 0.4 ? FLAME : RED, (1 - a) * 0.55));
      this.#fxGroup.add(this.#blastMesh(
        new THREE.SphereGeometry(b.radius * (1.8 - 1.4 * Math.min(1, a * 3)), 14, 10),
        at, WHITE, Math.max(0, 1 - a * 5)));
      // The shockwave runs on past the fireball, which is what reads from a
      // camera looking down the blast rather than across it. Same reach as the
      // fireball, on a slower clock: it is the fireball's edge still travelling
      // after the flame has stopped, not a wider explosion.
      const wide = reach * grow(0.55);
      const ring = new THREE.RingGeometry(wide * 0.92, wide * 1.12, 44);
      ring.rotateX(-Math.PI / 2);
      const m = this.#blastMesh(ring, at, WHITE, (1 - a) * 0.5);
      (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
      this.#fxGroup.add(m);
    }
  }

  /**
   * Where hulls have been.
   *
   * One line per ship per turn, taken from poses the core reported rather than
   * re-flown here: a second integrator drawing a second path is exactly the
   * divergent rule GUIDELINES 5.1 forbids, and this one would be wrong in a
   * way nobody could see.
   *
   * `age` is how many turns back the line is, so the oldest fade out and the
   * turn just flown reads clearly against them.
   */
  setTrails(list: ReadonlyArray<{ points: readonly Vec3[]; side: number; age: number }>): void {
    for (const c of this.#trailGroup.children) {
      (c as THREE.Line).geometry.dispose();
      ((c as THREE.Line).material as THREE.Material).dispose();
    }
    this.#trailGroup.clear();
    for (const t of list) {
      if (t.points.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(t.points.map(v));
      this.#trailGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: t.side === this.mySide ? CYAN : ORANGE,
        transparent: true,
        // Never all the way to nothing: a line that fades out entirely is a
        // history that quietly stops rather than one that recedes.
        opacity: Math.max(0.12, 0.75 / (1 + t.age * 0.9)),
      })));
    }
  }

  #blastMesh(geo: THREE.BufferGeometry, at: THREE.Vector3, color: number, opacity: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: Math.max(0, opacity),
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.copy(at);
    return m;
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
  /**
   * Who is aiming at whom.
   *
   * Ours is dotted red from the hull we are flying to the hull it is pointed
   * at; theirs is a dimmer orange from each hostile to the ship it is set on.
   *
   * Their line is not a guess. `ai_target` is state the core keeps on the
   * hull and reports over the boundary: it is who that ship retaliated against
   * and will keep after while it lives. Nothing here decides it, so a line is
   * drawn only where the core says there is one.
   */
  setAiming(links: readonly { from: Vec3; to: Vec3; mine: boolean }[]): void {
    while (this.#aimGroup.children.length) {
      const c = this.#aimGroup.children.pop() as THREE.Line;
      c.geometry?.dispose();
      (c.material as THREE.Material | undefined)?.dispose();
    }
    for (const l of links) {
      const geo = new THREE.BufferGeometry().setFromPoints([v(l.from), v(l.to)]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
        color: l.mine ? RED : ORANGE,
        dashSize: l.mine ? 1.6 : 3.4,
        gapSize: l.mine ? 1.6 : 3.4,
        transparent: true,
        opacity: l.mine ? 0.85 : 0.3,
      }));
      line.computeLineDistances();
      this.#aimGroup.add(line);
    }
  }

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

    // Slide always shows a heading, whether or not one has been commanded yet:
    // it is the mode where the nose is an input, so there has to be something
    // on screen to turn. Move faces its own course, so it shows none.
    const face = order.mode === Mode.TurnSlide
      ? (order.face ?? this.#match.forward(ship.id))
      : order.face;
    if (face && order.mode === Mode.TurnSlide) {
      const from = v(ship.pos);
      const to = from.clone().add(new THREE.Vector3(face.x, face.y, face.z).normalize().multiplyScalar(18));
      this.#headingArrow.geometry.dispose();
      this.#headingArrow.geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      this.#headingArrow.visible = true;
    } else {
      this.#headingArrow.visible = false;
    }

    // The ring sits on the arrival estimate, because that is the hull whose
    // heading is being set: the ship on screen now is where it starts from.
    const spin = order.mode === Mode.TurnSlide;
    if (spin) {
      const centre = { x: end.x, y: end.y, z: end.z };
      // Wide enough to clear the selection ring around the hull, so the two
      // circles read as two controls rather than one thick one.
      const radius = Math.max(14, this.#dist * 0.105);
      this.#yawAt = { centre, radius };
      this.#yawRing.position.set(centre.x, centre.y, centre.z);
      this.#yawRing.scale.setScalar(radius);
      const dir = face ?? { x: 0, y: 0, z: 1 };
      const flat = Math.hypot(dir.x, dir.z) || 1;
      this.#yawKnob.position.set(
        centre.x + (dir.x / flat) * radius, centre.y, centre.z + (dir.z / flat) * radius);
      this.#yawKnob.scale.setScalar(Math.max(1.1, radius * 0.10));
    } else {
      this.#yawAt = null;
    }
    this.#yawRing.visible = spin;
    this.#yawKnob.visible = spin;
  }

  /** Is this screen point on the yaw knob? Generous, because it is a target
   * for a thumb as well as a cursor. */
  onYawKnob(clientX: number, clientY: number): boolean {
    if (!this.#yawKnob.visible) return false;
    const rect = this.#canvas.getBoundingClientRect();
    const p = this.#yawKnob.position.clone().project(this.#camera);
    const sx = rect.left + ((p.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - p.y) / 2) * rect.height;
    return Math.hypot(clientX - sx, clientY - sy) <= 26;
  }

  /**
   * The heading a pointer over the ring is asking for.
   *
   * Read off the ring's own plane rather than the working plane: the ring sits
   * at the arrival estimate, which is rarely the height a click projects to,
   * and reading the wrong plane puts the knob under the hand only by accident.
   */
  yawFromPointer(clientX: number, clientY: number): Vec3 | null {
    const at = this.#yawAt;
    if (!at) return null;
    const rect = this.#canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.#camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -at.centre.y);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const dx = hit.x - at.centre.x;
    const dz = hit.z - at.centre.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return null;
    return { x: dx / l, y: 0, z: dz / l };
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

  /**
   * Say whether a heading is under a finger right now.
   *
   * A rotation drag fires a pointer event per pixel, and in slide mode every
   * one of them moves the boundary, so the envelope was re-probed per event:
   * a 16 x 10 chart is 1920 flights through the core, and the console fell
   * from 46 fps to 14, with a median frame of 68 ms against 21 idle. The dial
   * then stutters under its own feedback, which reads as a broken control
   * rather than a slow one.
   *
   * So while this is on, the boundary follows at a fixed rate and only to its
   * coarsest rung, and the fine ones are left until the finger comes off. The
   * shape still tracks the dial; it is simply not re-derived to 48 x 26 for a
   * heading that is still moving.
   */
  setLiveHeading(on: boolean): void {
    if (this.#live === on) return;
    this.#live = on;
    if (on) {
      this.#movedAt = performance.now();
      this.#liveBuiltAt = this.#movedAt;
      return;
    }
    // Released. Anything still deferred is asked for by the refresh that
    // follows, and every capped ladder is uncapped so it sharpens to the end.
    this.#deferred.clear();
    for (const [id, e] of this.#shells) {
      if (!e.coarse) continue;
      e.coarse = false;
      if (e.next < ENVELOPE_LEVELS.length && !this.#pending.includes(id)) this.#pending.push(id);
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
    if (this.#live) {
      // Under the finger the boundary is not rebuilt per event. The request is
      // noted and the frame loop runs it once the heading settles, or once it
      // has lagged far enough to be worth one anyway. The old surface stays
      // drawn in the meantime, which is what `stale` is for.
      this.#movedAt = performance.now();
      this.#deferred.add(ship.id);
      return;
    }
    // Keep the old surface on screen while the new one is found. It used to be
    // thrown away here, so anything that re-opened the ladder blanked the
    // envelope and grew it back from the coarsest level: a flash on every
    // rotation in slide mode, where turning genuinely does move the boundary
    // and so cannot be spared the rebuild. Stale for a few frames beats absent.
    this.#shells.set(ship.id, {
      key, next: 0, built: have?.built ?? null, stale: !!have?.built, coarse: this.#live,
    });
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
      // The commanded heading, but ONLY where the flight reads it. Slide holds
      // the nose, so turning re-points the strong drive and moves the boundary:
      // measured at 19.09 u worst and 0.81 u mean over a 48 x 26 chart. Move
      // faces its own course, so the same turn moves it by 0.00 u, exactly, and
      // carrying the face here rebuilt a surface that could not have changed.
      // All three components, since the old key carried x and z only.
      ...(order.mode === Mode.TurnSlide
        ? [order.face?.x.toFixed(3) ?? '-',
           order.face?.y.toFixed(3) ?? '-',
           order.face?.z.toFixed(3) ?? '-',
           // Roll too, and for a reason that is easy to argue away: x and y
           // are spent against the same lateral cap, so the budget looks
           // rotationally symmetric about the nose. The cap is a BOX, and a
           // box has corners, so rolling turns it under the wanted thrust and
           // the arrival point moves, by 7.87 u on a 44 u reach when measured.
           order.roll?.toFixed(4) ?? '-']
        : []),
      flight.yawRate, flight.pitchRate, flight.accelFwd,
      flight.accelRetro, flight.accelLat, flight.maxSpeed,
    ].join('|');
  }

  /**
   * Run a deferred rebuild once the heading has stopped moving, or once the
   * drawn boundary has lagged a heading that will not stop.
   *
   * Which of the two it is decides how far the ladder runs. A heading that has
   * settled gets the whole thing, finger down or not, because nothing is about
   * to throw it away: pausing on a dial should sharpen the shape, not coarsen
   * it. One that is still sweeping gets the coarsest rung only, since the fine
   * ones are the expensive ones and the next nudge would discard them.
   */
  #flushDeferred(orderOf: (id: number) => PlannedOrder,
                 flightOf: (id: number) => Flight,
                 shipOf: (id: number) => ShipState | undefined): void {
    if (!this.#live) return;
    const now = performance.now();
    const settled = now - this.#movedAt >= SETTLE_MS;
    if (this.#deferred.size) {
      if (!settled && now - this.#liveBuiltAt < LIVE_MAX_MS) return;
      this.#liveBuiltAt = now;
      for (const id of this.#deferred) {
        const ship = shipOf(id);
        if (!ship) continue;
        const have = this.#shells.get(id);
        this.#shells.set(id, {
          key: this.#shellKeyFor(ship, orderOf(id), flightOf(id)),
          next: 0, built: have?.built ?? null, stale: !!have?.built, coarse: !settled,
        });
        if (!this.#pending.includes(id)) this.#pending.push(id);
      }
      this.#deferred.clear();
      return;
    }
    // Nothing outstanding, but a sweep that ran past LIVE_MAX_MS left its
    // ladder capped at the coarse rung. Once the heading stops, uncap it: the
    // shape must sharpen when the finger rests, not only when it lifts.
    if (!settled) return;
    for (const [id, e] of this.#shells) {
      if (!e.coarse) continue;
      e.coarse = false;
      if (e.next < ENVELOPE_LEVELS.length && !this.#pending.includes(id)) this.#pending.push(id);
    }
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
    this.#flushDeferred(orderOf, flightOf, shipOf);
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
        entry.stale = false;
        // A new level is a new surface, so whatever contours were cut from the
        // old one are stale even if the working plane has not moved.
        this.#wireKey = '';
      }
      entry.next++;
      // Capped while a heading is being dragged: one rung is the whole answer
      // for now, and the rest waits for the finger to come off.
      if (entry.next >= ENVELOPE_LEVELS.length || entry.coarse) this.#pending.shift();
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

  /** How much blast and how much history is on screen, and how big the biggest
   * blast has grown. Observation only, for the harness and the console. */
  fxStats(): { blasts: number; beams: number; trails: number; widest: number } {
    let widest = 0;
    for (const c of this.#fxGroup.children) {
      const g = (c as THREE.Mesh).geometry;
      g.computeBoundingSphere();
      widest = Math.max(widest, g.boundingSphere?.radius ?? 0);
    }
    return {
      blasts: this.#fxGroup.children.length,
      beams: this.#beamGroup.children.length,
      trails: this.#trailGroup.children.length,
      widest,
    };
  }

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
  setGhosts(poses: readonly { id: number; side: number; pose: Pose }[]): void {
    while (this.#ghostGroup.children.length) {
      const c = this.#ghostGroup.children.pop() as THREE.Mesh;
      c.geometry?.dispose();
      (c.material as THREE.Material | undefined)?.dispose();
    }
    for (const g of poses) {
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 5.2, 4),
        new THREE.MeshBasicMaterial({
          // A hostile's ghost is where the AI's own plan puts it, so it is
          // drawn in their colour: a cyan cone out among the enemy would read
          // as one of mine.
          color: g.side === this.mySide ? CYAN : ORANGE,
          wireframe: true, transparent: true, opacity: 0.5,
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
