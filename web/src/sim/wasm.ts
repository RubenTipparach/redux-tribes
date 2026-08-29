/**
 * The wasm boundary.
 *
 * The Rust core exposes a C ABI over one shared f32 scratch buffer rather than
 * wasm-bindgen glue: the simulation's interface is entirely numeric, so there
 * is nothing for object marshalling to do, and skipping it keeps the build to
 * plain `cargo build --target wasm32-unknown-unknown`.
 *
 * Slot layout is duplicated from `engine/sim_core/src/ffi.rs`. It is a
 * contract; the offsets here and there must move together.
 */

import {
  type Body, type Flight, type FlyOrder, type Flown, type Quat, type Vec3,
  isCommitted, PROBE_STEPS, RESOLUTION_STEPS,
} from './types.js';
import { Match, type MatchExports } from './match.js';

interface SimExports {
  readonly memory: WebAssembly.Memory;
  ft_scratch_ptr(): number;
  ft_scratch_len(): number;
  ft_fly_turn(mode: number, steps: number, sampleStride: number): number;
  ft_can_reach(mode: number, eps: number, steps: number): number;
  ft_reach_grid(
    mode: number, eps: number, steps: number, n: number,
    cx: number, cy: number, cz: number, half: number,
  ): number;
  ft_reach_grid_at(
    mode: number, eps: number, steps: number, n: number,
    cx: number, cy: number, cz: number,
    fx: number, fy: number, fz: number,
    hr: number, hu: number, hf: number,
  ): number;
  ft_reach_octree(
    mode: number, eps: number, steps: number, base: number, n: number,
    cx: number, cy: number, cz: number,
    fx: number, fy: number, fz: number,
    hr: number, hu: number, hf: number,
  ): number;
  ft_reach_radii(
    mode: number, eps: number, steps: number, nu: number, nv: number, iters: number,
    cx: number, cy: number, cz: number, far: number,
  ): number;
  ft_octree_ptr(): number;
  ft_octree_len(): number;
  ft_look_basis(fx: number, fy: number, fz: number): number;
}

// input slots
const IN_POS = 0, IN_VEL = 3, IN_QUAT = 6, IN_TARGET = 10, IN_FACE = 13;
const IN_HAS_TARGET = 16, IN_HAS_FACE = 17, IN_FLIGHT = 18;
// output slots
const OUT_POS = 32, OUT_VEL = 35, OUT_QUAT = 38, OUT_COMMITTED = 42, OUT_PATH = 64;

export class Sim {
  readonly #ex: SimExports;
  #view: Float32Array;

  private constructor(ex: SimExports) {
    this.#ex = ex;
    this.#view = this.#fresh();
  }

  /** Memory can be detached by a wasm grow, so re-derive the view on demand. */
  #fresh(): Float32Array {
    return new Float32Array(this.#ex.memory.buffer, this.#ex.ft_scratch_ptr(), this.#ex.ft_scratch_len());
  }
  get #s(): Float32Array {
    if (this.#view.buffer !== this.#ex.memory.buffer || this.#view.length === 0) {
      this.#view = this.#fresh();
    }
    return this.#view;
  }

  static async load(source: string | BufferSource): Promise<Sim> {
    const wasm = typeof source === 'string'
      ? await WebAssembly.instantiateStreaming(fetch(source), {})
      : await WebAssembly.instantiate(source, {});
    return new Sim(wasm.instance.exports as unknown as SimExports);
  }

  /**
   * The match API over the SAME instance, so both share one scratch buffer and
   * one copy of the state. Loading the module twice would give two cores that
   * agree only by luck, which is the exact failure lockstep is built to catch.
   */
  match(): Match {
    return new Match(this.#ex as unknown as MatchExports);
  }

  #writeInputs(body: Body, flight: Flight, order: FlyOrder): void {
    const s = this.#s;
    s[IN_POS] = body.pos.x; s[IN_POS + 1] = body.pos.y; s[IN_POS + 2] = body.pos.z;
    s[IN_VEL] = body.vel.x; s[IN_VEL + 1] = body.vel.y; s[IN_VEL + 2] = body.vel.z;
    s[IN_QUAT] = body.quat.x; s[IN_QUAT + 1] = body.quat.y;
    s[IN_QUAT + 2] = body.quat.z; s[IN_QUAT + 3] = body.quat.w;

    const t = order.target;
    s[IN_HAS_TARGET] = t ? 1 : 0;
    s[IN_TARGET] = t?.x ?? 0; s[IN_TARGET + 1] = t?.y ?? 0; s[IN_TARGET + 2] = t?.z ?? 0;

    const f = order.face;
    s[IN_HAS_FACE] = f ? 1 : 0;
    s[IN_FACE] = f?.x ?? 0; s[IN_FACE + 1] = f?.y ?? 0; s[IN_FACE + 2] = f?.z ?? 0;

    s[IN_FLIGHT] = flight.yawRate;
    s[IN_FLIGHT + 1] = flight.pitchRate;
    s[IN_FLIGHT + 2] = flight.accelFwd;
    s[IN_FLIGHT + 3] = flight.accelRetro;
    s[IN_FLIGHT + 4] = flight.accelLat;
    s[IN_FLIGHT + 5] = flight.maxSpeed;
  }

  /**
   * Fly one turn. `samples` is how many poses to read back for drawing; the
   * simulation always integrates at `steps` regardless.
   */
  flyTurn(body: Body, flight: Flight, order: FlyOrder, steps = RESOLUTION_STEPS, samples = 48): Flown {
    this.#writeInputs(body, flight, order);
    const stride = Math.max(1, Math.floor(steps / Math.max(1, samples)));
    const n = this.#ex.ft_fly_turn(order.mode, steps, stride);
    const s = this.#s;
    const path: Array<{ pos: Vec3; quat: Quat }> = [];
    for (let i = 0; i < n; i++) {
      const b = OUT_PATH + i * 7;
      path.push({
        pos: { x: s[b] ?? 0, y: s[b + 1] ?? 0, z: s[b + 2] ?? 0 },
        quat: { x: s[b + 3] ?? 0, y: s[b + 4] ?? 0, z: s[b + 5] ?? 0, w: s[b + 6] ?? 1 },
      });
    }
    return {
      endPos: { x: s[OUT_POS] ?? 0, y: s[OUT_POS + 1] ?? 0, z: s[OUT_POS + 2] ?? 0 },
      endVel: { x: s[OUT_VEL] ?? 0, y: s[OUT_VEL + 1] ?? 0, z: s[OUT_VEL + 2] ?? 0 },
      endQuat: {
        x: s[OUT_QUAT] ?? 0, y: s[OUT_QUAT + 1] ?? 0,
        z: s[OUT_QUAT + 2] ?? 0, w: s[OUT_QUAT + 3] ?? 1,
      },
      committed: (s[OUT_COMMITTED] ?? 0) !== 0,
      path,
    };
  }

  /** Can this ship finish the turn within `eps` of the point? */
  canReach(body: Body, flight: Flight, order: FlyOrder, target: Vec3, eps: number, steps = PROBE_STEPS): boolean {
    this.#writeInputs(body, flight, { ...order, target });
    return this.#ex.ft_can_reach(order.mode, eps, steps) !== 0;
  }

  /**
   * Probe a whole cube of candidate cells in one crossing. Returns a predicate
   * over grid indices plus the hit count, so the renderer can build an envelope
   * without paying a boundary call per cell.
   */
  reachGrid(
    body: Body, flight: Flight, order: FlyOrder,
    centre: Vec3, half: number, n: number, eps: number, steps = PROBE_STEPS,
  ): { hits: number; at: (i: number, j: number, k: number) => boolean } {
    const size = Math.max(1, Math.min(32, n));
    this.#writeInputs(body, flight, order);
    const hits = this.#ex.ft_reach_grid(order.mode, eps, steps, size, centre.x, centre.y, centre.z, half);
    // read the bitmask back out of the same buffer, reinterpreted as u32
    const s = this.#s;
    const words = Math.ceil((size * size * size) / 32);
    const mask = new Uint32Array(words);
    const bits = new Uint32Array(s.buffer, s.byteOffset + OUT_PATH * 4, words);
    mask.set(bits);
    return {
      hits,
      at: (i, j, k) => {
        const idx = (i * size + j) * size + k;
        return ((mask[idx >>> 5] ?? 0) & (1 << (idx & 31))) !== 0;
      },
    };
  }

  /**
   * The same probe, in a box that is PLACED and TURNED rather than centred on
   * the hull and aligned to the world.
   *
   * The reachable set leans along the velocity, and at speed it leaves the
   * hull behind entirely: a ship carrying eight units per second finishes its
   * turn about eighty units away whatever it does. A cube on the hull
   * therefore spends nearly all of itself on space the ship cannot use, and
   * the cell it can afford grows from 7.9 units at rest to 13.7 at speed,
   * which is backwards. Placing the box on the landing and turning it to
   * follow the velocity buys 3.8 units at rest and 2.8 at speed for the same
   * probe count.
   *
   * How far out to look is the client's business; which way the box faces is
   * not, so the frame comes from `lookBasis` rather than being rebuilt here.
   */
  reachGridAt(
    body: Body, flight: Flight, order: FlyOrder,
    centre: Vec3, forward: Vec3,
    half: { right: number; up: number; forward: number },
    n: number, eps: number, steps = PROBE_STEPS,
  ): { hits: number; at: (i: number, j: number, k: number) => boolean } {
    const size = Math.max(1, Math.min(32, n));
    this.#writeInputs(body, flight, order);
    const hits = this.#ex.ft_reach_grid_at(
      order.mode, eps, steps, size,
      centre.x, centre.y, centre.z,
      forward.x, forward.y, forward.z,
      half.right, half.up, half.forward,
    );
    const s = this.#s;
    const words = Math.ceil((size * size * size) / 32);
    const mask = new Uint32Array(words);
    mask.set(new Uint32Array(s.buffer, s.byteOffset + OUT_PATH * 4, words));
    return {
      hits,
      at: (i, j, k) => {
        const idx = (i * size + j) * size + k;
        return ((mask[idx >>> 5] ?? 0) & (1 << (idx & 31))) !== 0;
      },
    };
  }

  /**
   * The same box, found by descending only where the answer changes.
   *
   * A dense probe costs the CUBE of the resolution while what it wants is a
   * SURFACE, and nearly every cell it pays for is deep inside the set or far
   * outside it. The core returns straddling leaves AND the uniform blocks it
   * settled in one test each, which together tile the grid, so the dense field
   * is rebuilt here for free and the marching code above it is unchanged.
   *
   * Measured against the dense probe at the same cell: 1.7x cheaper at 16,
   * 3.0x at 32, 5.7x at 64, and the saving doubles again with every level
   * because it tracks area where dense tracks volume.
   */
  reachOctreeAt(
    body: Body, flight: Flight, order: FlyOrder,
    centre: Vec3, forward: Vec3,
    half: { right: number; up: number; forward: number },
    n: number, eps: number, base = 4, steps = PROBE_STEPS,
  ): { entries: number; at: (i: number, j: number, k: number) => boolean } {
    const size = Math.max(2, Math.min(128, 1 << Math.round(Math.log2(n))));
    this.#writeInputs(body, flight, order);
    const entries = this.#ex.ft_reach_octree(
      order.mode, eps, steps, base, size,
      centre.x, centre.y, centre.z,
      forward.x, forward.y, forward.z,
      half.right, half.up, half.forward,
    );
    // Corners, not cells: a grid of n cells has n+1 corners a side, and the
    // marching code reads corners.
    const side = size + 1;
    const corner = new Uint8Array(side * side * side);
    const words = new Uint32Array(
      this.#ex.memory.buffer, this.#ex.ft_octree_ptr(), this.#ex.ft_octree_len(),
    );
    const CORNERS: readonly (readonly [number, number, number])[] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ];
    for (let c = 0; c < entries; c++) {
      const w0 = words[c * 2] ?? 0;
      const w1 = words[c * 2 + 1] ?? 0;
      const i = w0 & 0xff, j = (w0 >>> 8) & 0xff, k = (w0 >>> 16) & 0xff;
      const lvl = w0 >>> 24;
      const step = 1 << lvl;
      if (w1 & 0x100) {
        // A uniform block: every corner it spans takes its one value.
        const v = w1 & 1 ? 1 : 0;
        for (let a = i; a <= i + step; a++) {
          for (let b = j; b <= j + step; b++) {
            for (let d = k; d <= k + step; d++) {
              corner[(a * side + b) * side + d] = v;
            }
          }
        }
      } else {
        for (let t = 0; t < 8; t++) {
          const [a, b, d] = CORNERS[t]!;
          corner[((i + a) * side + (j + b)) * side + (k + d)] = (w1 >>> t) & 1;
        }
      }
    }
    return {
      entries,
      at: (i, j, k) =>
        i >= 0 && j >= 0 && k >= 0 && i <= size && j <= size && k <= size
        && corner[(i * side + j) * side + k] === 1,
    };
  }

  /**
   * The boundary as a radius field, bisected along a lat-long grid of rays
   * from `anchor`.
   *
   * The chart's poles are on world Y inside the core, which is not arbitrary:
   * X and Z were measured against it and fit worse. It crowds badly at those
   * poles, and that was measured too. An equal area chart and a six face cube
   * map are both far more even and both fit WORSE at the same ray budget,
   * because the crowding is what pays for the resolution at the equator, where
   * the shape actually varies.
   */
  reachRadii(
    body: Body, flight: Flight, order: FlyOrder,
    anchor: Vec3, nu: number, nv: number,
    eps: number, iters = 12, far = 200, steps = PROBE_STEPS,
  ): Float32Array | null {
    this.#writeInputs(body, flight, order);
    const n = this.#ex.ft_reach_radii(
      order.mode, eps, steps, nu, nv, iters, anchor.x, anchor.y, anchor.z, far,
    );
    if (n <= 0) return null;
    return this.#s.slice(OUT_PATH, OUT_PATH + n);
  }

  /**
   * The basis `reachGridAt` samples in: right, up, forward. Asked for rather
   * than recomputed, so a cell the client draws is the cell the core probed.
   */
  lookBasis(forward: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
    this.#ex.ft_look_basis(forward.x, forward.y, forward.z);
    const s = this.#s;
    const v = (o: number): Vec3 => ({ x: s[o] ?? 0, y: s[o + 1] ?? 0, z: s[o + 2] ?? 0 });
    return { right: v(44), up: v(47), forward: v(50) };
  }
}

export { isCommitted };
