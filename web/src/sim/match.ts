/**
 * The match, as the client sees it.
 *
 * State lives in Rust. This class does not hold a copy that could drift from
 * it; every getter reads the core through the scratch buffer and hands back a
 * plain snapshot for the renderer to draw. The one thing the client owns is
 * the ORDERS it has not submitted yet, which is exactly the thing the core
 * should not know about until End Turn.
 *
 * Record strides are duplicated from `engine/sim_core/src/ffi.rs`. They are a
 * contract: the numbers here and there move together or the client reads
 * garbage that still typechecks.
 */

import {
  type ClassInfo, type MountInfo, type PlannedOrder, type Pose, type ShipState,
  type SimEvent, type TrackProjectile, type Vec3,
  EventKind, Mode, Scenario, TICKS_PER_TURN,
} from './types.js';

const OUT = 64;
const SHIP_STRIDE = 40;
const EVENT_STRIDE = 14;
const POSE_STRIDE = 9;
const PROJ_STRIDE = 5;
/** One read of events per call; a busy turn pages rather than truncating. */
const EVENT_PAGE = 512;

export interface MatchExports {
  readonly memory: WebAssembly.Memory;
  ft_scratch_ptr(): number;
  ft_scratch_len(): number;
  ft_match_new(seedHi: number, seedLo: number, scenario: number): number;
  ft_ship_count(): number;
  ft_turn_index(): number;
  ft_game_over(): number;
  ft_hash_hi(): number;
  ft_hash_lo(): number;
  ft_read_ships(): number;
  ft_load_ship(ship: number): number;
  ft_set_flight(
    ship: number, yaw: number, pitch: number,
    fwd: number, retro: number, lat: number, maxSpeed: number,
  ): number;
  ft_orders_clear(): void;
  ft_set_move(
    ship: number, mode: number, hasTarget: number, tx: number, ty: number, tz: number,
    hasFace: number, fx: number, fy: number, fz: number,
  ): number;
  ft_add_fire(
    ship: number, weaponIndex: number, second: number, targetShip: number, targetSub: number,
  ): number;
  ft_clear_fire(ship: number): number;
  ft_set_board(ship: number, target: number): number;
  ft_resolve_turn(): number;
  ft_read_events(from: number, max: number): number;
  ft_read_poses(tick: number): number;
  ft_read_track_projectiles(tick: number): number;
  ft_ship_preview(ship: number, mode: number, samples: number): number;
  ft_read_class(index: number): number;
  ft_read_mount(classIdx: number, mount: number): number;
}

function v3(s: Float32Array, b: number): Vec3 {
  return { x: s[b] ?? 0, y: s[b + 1] ?? 0, z: s[b + 2] ?? 0 };
}

export class Match {
  readonly #ex: MatchExports;
  #view: Float32Array;
  /** Plans the player has made but not submitted, keyed by ship id. */
  readonly orders = new Map<number, PlannedOrder>();
  /** Every turn's events and hash, so any past turn can be reviewed. */
  readonly history: Array<{ turn: number; events: SimEvent[]; hash: string }> = [];

  constructor(ex: MatchExports) {
    this.#ex = ex;
    this.#view = this.#fresh();
  }

  #fresh(): Float32Array {
    return new Float32Array(
      this.#ex.memory.buffer, this.#ex.ft_scratch_ptr(), this.#ex.ft_scratch_len(),
    );
  }

  /** wasm memory can be detached by a grow, so re-derive the view on demand. */
  get #s(): Float32Array {
    if (this.#view.buffer !== this.#ex.memory.buffer || this.#view.length === 0) {
      this.#view = this.#fresh();
    }
    return this.#view;
  }

  /**
   * Start a match. The seed is the same 16 hex character string the server
   * issues, split into halves because the boundary carries 32 bit values.
   */
  start(seed: string, scenario: Scenario): void {
    const clean = seed.replace(/[^0-9a-f]/gi, '').padStart(16, '0').slice(-16);
    const hi = parseInt(clean.slice(0, 8), 16) >>> 0;
    const lo = parseInt(clean.slice(8), 16) >>> 0;
    this.#ex.ft_match_new(hi, lo, scenario);
    this.orders.clear();
    this.history.length = 0;
  }

  get turn(): number { return this.#ex.ft_turn_index(); }
  get shipCount(): number { return this.#ex.ft_ship_count(); }

  /** -1 while live, else 0 for a player win and 1 for an enemy win. */
  get gameOver(): number { return this.#ex.ft_game_over(); }

  get hash(): string {
    const hi = this.#ex.ft_hash_hi() >>> 0;
    const lo = this.#ex.ft_hash_lo() >>> 0;
    return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
  }

  ships(): ShipState[] {
    const n = this.#ex.ft_read_ships();
    const s = this.#s;
    const out: ShipState[] = [];
    for (let i = 0; i < n; i++) {
      const b = OUT + i * SHIP_STRIDE;
      const subCount = s[b + 20] ?? 0;
      const subs = [];
      for (let k = 0; k < subCount && k < 3; k++) {
        subs.push({ hp: s[b + 21 + k * 2] ?? 0, dead: (s[b + 22 + k * 2] ?? 0) !== 0 });
      }
      const wCount = s[b + 27] ?? 0;
      const weaponLastFired = [];
      for (let k = 0; k < wCount && k < 3; k++) weaponLastFired.push(s[b + 28 + k] ?? -99);
      const pCount = s[b + 31] ?? 0;
      const parties = [];
      for (let k = 0; k < pCount && k < 2; k++) {
        parties.push({ faction: s[b + 32 + k * 2] ?? -1, count: s[b + 33 + k * 2] ?? 0 });
      }
      out.push({
        id: s[b] ?? i,
        cls: s[b + 1] ?? 0,
        faction: s[b + 2] ?? 0,
        isPlayer: (s[b + 3] ?? 0) !== 0,
        destroyed: (s[b + 4] ?? 0) !== 0,
        hull: s[b + 5] ?? 0,
        hullMax: s[b + 6] ?? 1,
        marines: s[b + 7] ?? 0,
        pos: v3(s, b + 8),
        quat: {
          x: s[b + 11] ?? 0, y: s[b + 12] ?? 0, z: s[b + 13] ?? 0, w: s[b + 14] ?? 1,
        },
        vel: v3(s, b + 15),
        mode: (s[b + 18] ?? 0) as Mode,
        drifting: (s[b + 19] ?? 0) !== 0,
        subs,
        weaponLastFired,
        parties,
        radius: s[b + 36] ?? 3.5,
        maxSpeed: s[b + 37] ?? 8,
        aiTarget: s[b + 38] ?? -1,
        boardingRange: s[b + 39] ?? 20,
      });
    }
    return out;
  }

  classInfo(cls: number): ClassInfo {
    this.#ex.ft_read_class(cls);
    const s = this.#s;
    return {
      hull: s[OUT] ?? 0,
      radius: s[OUT + 1] ?? 0,
      mass: s[OUT + 2] ?? 1,
      boardingRange: s[OUT + 3] ?? 0,
      marines: s[OUT + 4] ?? 0,
      boardingCapacity: s[OUT + 5] ?? 0,
      mountCount: s[OUT + 6] ?? 0,
      subCount: s[OUT + 7] ?? 0,
      flight: {
        yawRate: s[OUT + 8] ?? 6,
        pitchRate: s[OUT + 9] ?? 4,
        accelFwd: s[OUT + 10] ?? 0.9,
        accelRetro: s[OUT + 11] ?? 0.35,
        accelLat: s[OUT + 12] ?? 0.25,
        maxSpeed: s[OUT + 13] ?? 8,
      },
    };
  }

  mount(cls: number, index: number): MountInfo | null {
    if (this.#ex.ft_read_mount(cls, index) === 0) return null;
    const s = this.#s;
    return {
      key: s[OUT] ?? 0,
      kind: s[OUT + 1] ?? 0,
      damage: s[OUT + 2] ?? 0,
      range: s[OUT + 3] ?? 0,
      cooldownTurns: s[OUT + 4] ?? 0,
      arcH: [s[OUT + 5] ?? -180, s[OUT + 6] ?? 180],
      arcV: [s[OUT + 7] ?? -180, s[OUT + 8] ?? 180],
      batch: s[OUT + 9] ?? 1,
      mount: v3(s, OUT + 10),
    };
  }

  setFlight(ship: number, f: ClassInfo['flight']): void {
    this.#ex.ft_set_flight(
      ship, f.yawRate, f.pitchRate, f.accelFwd, f.accelRetro, f.accelLat, f.maxSpeed,
    );
  }

  /**
   * Preview a ship's turn: the same integrator the resolver runs, from the
   * ship's live state. Preview and execution are the same code, which is the
   * only way a drawn plan can be trusted to be what happens.
   */
  preview(ship: number, order: PlannedOrder, samples = 48): Vec3[] {
    this.#ex.ft_load_ship(ship);
    const s = this.#s;
    const t = order.target;
    s[16] = t ? 1 : 0;
    s[10] = t?.x ?? 0; s[11] = t?.y ?? 0; s[12] = t?.z ?? 0;
    const f = order.face;
    s[17] = f ? 1 : 0;
    s[13] = f?.x ?? 0; s[14] = f?.y ?? 0; s[15] = f?.z ?? 0;
    const n = this.#ex.ft_ship_preview(ship, order.mode, samples);
    const out: Vec3[] = [];
    const v = this.#s;
    for (let i = 0; i < n; i++) out.push(v3(v, OUT + i * 7));
    return out;
  }

  /** Where a plan actually ends up. Read from the same flight it just flew. */
  previewEnd(): Vec3 {
    return v3(this.#s, 32);
  }

  // -------------------------------------------------------------- orders --

  order(ship: number): PlannedOrder {
    let o = this.orders.get(ship);
    if (!o) {
      o = { mode: Mode.MoveAndTurn, weapons: [] };
      this.orders.set(ship, o);
    }
    return o;
  }

  /**
   * Push every planned order into the core and resolve. Everything the player
   * decided crosses in one go, immediately before the turn runs, so nothing
   * the core holds can be stale relative to what is on screen.
   */
  endTurn(): SimEvent[] {
    this.#ex.ft_orders_clear();
    for (const [ship, o] of this.orders) {
      const t = o.target;
      const f = o.face;
      this.#ex.ft_set_move(
        ship, o.mode, t ? 1 : 0, t?.x ?? 0, t?.y ?? 0, t?.z ?? 0,
        f ? 1 : 0, f?.x ?? 0, f?.y ?? 0, f?.z ?? 0,
      );
      this.#ex.ft_clear_fire(ship);
      for (const w of o.weapons) {
        this.#ex.ft_add_fire(ship, w.weaponIndex, w.second, w.targetShip, w.targetSub);
      }
      this.#ex.ft_set_board(ship, o.board ?? -1);
    }
    const turnIndex = this.turn;
    const total = this.#ex.ft_resolve_turn();

    const events: SimEvent[] = [];
    for (let from = 0; from < total; from += EVENT_PAGE) {
      const n = this.#ex.ft_read_events(from, Math.min(EVENT_PAGE, total - from));
      const s = this.#s;
      for (let i = 0; i < n; i++) {
        const b = OUT + i * EVENT_STRIDE;
        events.push({
          kind: (s[b] ?? 0) as EventKind,
          tick: s[b + 1] ?? 0,
          ship: s[b + 2] ?? -1,
          other: s[b + 3] ?? -1,
          aux: s[b + 4] ?? -1,
          amount: s[b + 5] ?? 0,
          pos: v3(s, b + 6),
          to: v3(s, b + 9),
        });
      }
    }
    this.history.push({ turn: turnIndex, events, hash: this.hash });
    // Orders are spent. Keeping them would silently repeat a plan the player
    // has already watched play out.
    this.orders.clear();
    return events;
  }

  // ------------------------------------------------------------ playback --

  poses(tick: number): Pose[] {
    const n = this.#ex.ft_read_poses(Math.max(0, Math.min(TICKS_PER_TURN, tick)));
    const s = this.#s;
    const out: Pose[] = [];
    for (let i = 0; i < n; i++) {
      const b = OUT + i * POSE_STRIDE;
      out.push({
        id: s[b] ?? i,
        destroyed: (s[b + 1] ?? 0) !== 0,
        pos: v3(s, b + 2),
        quat: { x: s[b + 5] ?? 0, y: s[b + 6] ?? 0, z: s[b + 7] ?? 0, w: s[b + 8] ?? 1 },
      });
    }
    return out;
  }

  trackProjectiles(tick: number): TrackProjectile[] {
    const n = this.#ex.ft_read_track_projectiles(Math.max(0, Math.min(TICKS_PER_TURN, tick)));
    const s = this.#s;
    const out: TrackProjectile[] = [];
    for (let i = 0; i < n; i++) {
      const b = OUT + i * PROJ_STRIDE;
      out.push({
        id: s[b] ?? 0,
        missile: (s[b + 1] ?? 0) !== 0,
        pos: v3(s, b + 2),
      });
    }
    return out;
  }
}
