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
}

export { isCommitted };
