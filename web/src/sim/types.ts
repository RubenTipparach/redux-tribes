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
/** Mirrors `flight::TICKS_PER_SECOND`. A fire slot is one of these seconds. */
export const TICKS_PER_SECOND = TICKS_PER_TURN / TURN_SECONDS;
/** Resolution flies one slice per tick; a probe may ask for fewer. */
export const RESOLUTION_STEPS = TICKS_PER_TURN;
export const PROBE_STEPS = 60;

// ------------------------------------------------------------ the match --

/**
 * Ship classes, matching `sim_core::data::ALL_CLASSES` order. Like `Mode`,
 * these indices cross the boundary and are therefore part of the contract.
 */
export const ShipClass = {
  TerranFrigate: 0,
  KarisenFrigate: 1,
  RogueFrigate: 2,
  BenefactorFrigate: 3,
  Freighter: 4,
} as const;
export type ShipClass = (typeof ShipClass)[keyof typeof ShipClass];

export const CLASS_NAMES: Record<number, string> = {
  0: 'Terran Frigate',
  1: 'Karisen Frigate',
  2: 'Rogue Frigate',
  3: 'Benefactor Frigate',
  4: 'Freighter',
};

export const FACTION_NAMES: Record<number, string> = {
  0: 'terran',
  1: 'karisen',
  2: 'rogue',
  3: 'benefactor',
};

export const Scenario = {
  Skirmish: 0,
  Duel: 1,
  Convoy: 2,
  LowOrbit: 3,
  Binary: 4,
  Slingshot: 5,
} as const;
export type Scenario = (typeof Scenario)[keyof typeof Scenario];

/**
 * The name a lobby carries, mapped to the id the core builds from. The field a
 * scenario is fought in comes from that id and lives on the match, so both
 * seats get the same wells and the state hash covers them.
 */
export const SCENARIO_BY_NAME: Record<string, Scenario> = {
  skirmish: Scenario.Skirmish,
  duel: Scenario.Duel,
  convoy: Scenario.Convoy,
  'low-orbit': Scenario.LowOrbit,
  binary: Scenario.Binary,
  slingshot: Scenario.Slingshot,
};

/** A point source of gravity, as the core reports it. */
export interface Well {
  readonly pos: Vec3;
  /** GM, in u^3/s^2. */
  readonly mu: number;
  /** Softening radius: inside it the field stops growing. */
  readonly soft: number;
}

/** Matches `sim_core::turn::EventKind` discriminants. */
export const EventKind = {
  TurnStart: 0,
  ShotFired: 1,
  ShotHit: 2,
  ShotMiss: 3,
  ShotSkippedRange: 4,
  ShotSkippedArc: 5,
  ProjectileSpawned: 6,
  ProjectileExpired: 7,
  Damage: 8,
  SubsystemDestroyed: 9,
  ShipDrifting: 10,
  ShipDestroyed: 11,
  Collision: 12,
  BoardingStarted: 13,
  BoardingTick: 14,
  ShipCaptured: 15,
  GameOver: 16,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface SimEvent {
  readonly kind: EventKind;
  readonly tick: number;
  /** the ship this happened TO, or -1 */
  readonly ship: number;
  /** attacker, owner, or the other party to a collision, or -1 */
  readonly other: number;
  /** subsystem index, weapon index or projectile id, per kind */
  readonly aux: number;
  readonly amount: number;
  readonly pos: Vec3;
  readonly to: Vec3;
}

export interface SubState {
  readonly hp: number;
  readonly dead: boolean;
}

export interface PartyState {
  readonly faction: number;
  readonly count: number;
}

export interface ShipState {
  readonly id: number;
  readonly cls: number;
  readonly faction: number;
  /**
   * Which side of the match this hull fights for, 0 or 1. NOT "mine": the
   * simulation has no idea who is looking at it, and must not, or two clients
   * playing each other would hash differently from the first turn. Whether a
   * ship is yours is `side === mySide`, which only the client knows.
   */
  readonly side: number;
  readonly destroyed: boolean;
  readonly hull: number;
  readonly hullMax: number;
  readonly marines: number;
  readonly pos: Vec3;
  readonly quat: Quat;
  readonly vel: Vec3;
  readonly mode: Mode;
  readonly drifting: boolean;
  readonly subs: readonly SubState[];
  readonly weaponLastFired: readonly number[];
  readonly parties: readonly PartyState[];
  readonly radius: number;
  readonly maxSpeed: number;
  readonly aiTarget: number;
  readonly boardingRange: number;
}

export interface Pose {
  readonly id: number;
  readonly destroyed: boolean;
  readonly pos: Vec3;
  readonly quat: Quat;
}

export interface TrackProjectile {
  readonly id: number;
  readonly missile: boolean;
  readonly pos: Vec3;
}

export interface MountInfo {
  readonly key: number;
  readonly kind: number;
  readonly damage: number;
  readonly range: number;
  /** Seconds between two shots from this mount, on the match clock. */
  readonly cooldown: number;
  readonly arcH: readonly [number, number];
  readonly arcV: readonly [number, number];
  readonly batch: number;
  readonly mount: Vec3;
}

export const WEAPON_NAMES: Record<number, string> = {
  0: 'beam',
  1: 'cannon',
  2: 'plasma',
  3: 'missile',
};

export interface ClassInfo {
  readonly hull: number;
  readonly radius: number;
  readonly mass: number;
  readonly boardingRange: number;
  readonly marines: number;
  readonly boardingCapacity: number;
  readonly mountCount: number;
  readonly subCount: number;
  readonly flight: Flight;
}

/** A player's plan for one ship, before it is submitted. */
/** One queued shot: which mount, at which second of the turn, at whom. */
export interface PlannedShot {
  weaponIndex: number;
  second: number;
  targetShip: number;
  targetSub: number;
}

export interface PlannedOrder {
  mode: Mode;
  target?: Vec3;
  face?: Vec3;
  weapons: PlannedShot[];
  board?: number;
}
