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
  /** commanded roll about the nose, radians from wings level. */
  readonly roll?: number;
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
  TerranCorvette: 5,
  TerranDestroyer: 6,
  TerranCruiser: 7,
  KarisenCorvette: 8,
  KarisenDestroyer: 9,
  KarisenCruiser: 10,
  RogueCorvette: 11,
  RogueDestroyer: 12,
  RogueCruiser: 13,
  BenefactorCorvette: 14,
  BenefactorDestroyer: 15,
  BenefactorCruiser: 16,
} as const;
export type ShipClass = (typeof ShipClass)[keyof typeof ShipClass];

/**
 * The class keys, in `sim_core::data::ALL_CLASSES` order.
 *
 * The same strings the designer uses for `classKey`, which is what lets a
 * saved design name a hull the core can spawn. Positional, like the event and
 * subsystem discriminants: an entry inserted in the middle here renumbers
 * every class after it on one side of the boundary and not the other.
 */
export const CLASS_KEYS: readonly string[] = [
  'terran_frigate', 'karisen_frigate', 'rogue_frigate', 'benefactor_frigate', 'freighter',
  'terran_corvette', 'terran_destroyer', 'terran_cruiser',
  'karisen_corvette', 'karisen_destroyer', 'karisen_cruiser',
  'rogue_corvette', 'rogue_destroyer', 'rogue_cruiser',
  'benefactor_corvette', 'benefactor_destroyer', 'benefactor_cruiser',
];
export const classIndexOf = (key: string): number => CLASS_KEYS.indexOf(key);

export const CLASS_NAMES: Record<number, string> = {
  0: 'Terran Frigate',
  1: 'Karisen Frigate',
  2: 'Rogue Frigate',
  3: 'Benefactor Frigate',
  4: 'Freighter',
  5: 'Terran Corvette',
  6: 'Terran Destroyer',
  7: 'Terran Heavy Cruiser',
  8: 'Karisen Corvette',
  9: 'Karisen Destroyer',
  10: 'Karisen Heavy Cruiser',
  11: 'Rogue Corvette',
  12: 'Rogue Destroyer',
  13: 'Rogue Heavy Cruiser',
  14: 'Benefactor Corvette',
  15: 'Benefactor Destroyer',
  16: 'Benefactor Heavy Cruiser',
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
  /** The skirmish with the flight stats unlocked. Editing them is refused by
   * the core in every other scenario, because the stats are in the state
   * hash. */
  Sandbox: 6,
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
  sandbox: Scenario.Sandbox,
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
  ShotSkippedCooldown: 17,
  ShotSkippedOffline: 18,
  ShipCritical: 19,
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

/** Matches `sim_core::data::SubKind` discriminants. */
export const SubKind = {
  Armour: 0,
  Thruster: 1,
  Rcs: 2,
  Weapon: 3,
  Reactor: 4,
} as const;
export type SubKind = (typeof SubKind)[keyof typeof SubKind];

/**
 * One hit volume on one ship: what it is, how it is doing, and where it is.
 *
 * Position is WORLD, straight from the core. A client that rotated the class
 * offset itself would be holding a second opinion about which way a hull is
 * facing, and the marker would drift off the thing it is marking.
 */
export interface SubState {
  readonly ship: number;
  readonly index: number;
  readonly kind: SubKind;
  readonly hp: number;
  readonly hpMax: number;
  readonly dead: boolean;
  readonly pos: Vec3;
  /** Half extents of the BOX, in the SHIP's own frame. A volume is a box, so
   *  drawing or picking one means orienting it by the hull's quaternion. */
  readonly half: Vec3;
  readonly blockPct: number;
}

/** What each kind is called on screen. Presentation, so it lives here. */
export const SUB_LABEL: Record<number, string> = {
  0: 'armour', 1: 'engines', 2: 'thrusters', 3: 'weapons', 4: 'reactor',
};

/**
 * What losing one costs, in a sentence.
 *
 * Words about a rule, not the rule: `turn.rs` decides what a dead volume stops,
 * and this says so where a player is looking at the volume. If the resolver's
 * answer changes, this line is stale copy and has to be rewritten with it.
 */
export const SUB_BLURB: Record<number, string> = {
  0: 'Belt armour. Nothing runs through it, so losing one costs no system: it is '
    + 'there to be shot instead of the hull, and once the belt is gone the hits '
    + 'land whole.',
  1: 'Main drive. When the LAST one goes the ship is adrift from that instant: it '
    + 'coasts out the rest of the turn on the velocity it was carrying and cannot '
    + 'add to it.',
  2: 'Attitude thrusters. When the last one goes the drive still pushes and the hull '
    + 'stops swinging, so it re-flies the rest of the turn on an envelope with no '
    + 'turn left in it.',
  3: 'Weapon bay. With it out every mount on the ship is silent, whatever cooldown '
    + 'they have left.',
  4: 'Reactor. Not damage that happens to be lethal: the hull is gone the moment '
    + 'the pile is, whatever was left of it.',
};

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
  /** How many volumes it has. What they ARE comes from `Match.subs()`. */
  readonly subCount: number;
  /** How many mounts THIS SHIP has, which is not always how many its class
   *  has: a hull flying a design carries the design's guns. */
  readonly mountCount: number;
  /** When each mount last fired, for as many as the record can carry
   *  (`ffi::SHIP_COOLDOWNS`). `mountCount` is the honest total. */
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
  /** Commanded roll about the nose, radians from wings level. */
  roll?: number;
  weapons: PlannedShot[];
  board?: number;
}
