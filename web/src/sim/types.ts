/** Shared vocabulary for the simulation boundary. */

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export interface Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number }

/**
 * Move modes, matching `sim_core::flight::Mode` discriminants exactly. The
 * numbers cross the wasm boundary, so they are part of the contract: changing
 * one without changing the Rust side is a silent behaviour swap.
 */
export const Mode = {
  MoveAndTurn: 0,
  TurnSlide: 1,
  FullSpeed: 2,
  FullStop: 3,
  Drift: 4,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/** Committed modes ignore the destination: their envelope is a single point. */
export function isCommitted(mode: Mode): boolean {
  return mode === Mode.FullSpeed || mode === Mode.FullStop || mode === Mode.Drift;
}

/**
 * The flight envelope. These six numbers are the whole movement model
 * (ADR-14): how fast the hull swings about each axis, and how hard it pushes
 * along each of its own axes.
 */
export interface Flight {
  /** degrees per second about local up */
  readonly yawRate: number;
  /** degrees per second about local right */
  readonly pitchRate: number;
  /** u/s^2 along +Z, the main drive */
  readonly accelFwd: number;
  /** u/s^2 along -Z, retros only */
  readonly accelRetro: number;
  /** u/s^2 along local X and Y, the RCS */
  readonly accelLat: number;
  readonly maxSpeed: number;
}

export interface Body {
  readonly pos: Vec3;
  /** units per SECOND, carried across turn boundaries */
  readonly vel: Vec3;
  readonly quat: Quat;
}

export interface FlyOrder {
  readonly mode: Mode;
  /** where to go. Omitted means hold course on carried velocity. */
  readonly target?: Vec3;
  /** commanded heading. Only TurnSlide honours it. */
  readonly face?: Vec3;
}

export interface Flown {
  readonly endPos: Vec3;
  readonly endVel: Vec3;
  readonly endQuat: Quat;
  readonly committed: boolean;
  /** sampled pose along the turn, for drawing the path and ghosts */
  readonly path: ReadonlyArray<{ pos: Vec3; quat: Quat }>;
}

/** Turn geometry, mirroring `sim_core::flight`. */
export const TICKS_PER_TURN = 600;
export const TURN_SECONDS = 10;
/** Resolution flies one slice per tick; a probe may ask for fewer. */
export const RESOLUTION_STEPS = TICKS_PER_TURN;
export const PROBE_STEPS = 60;
