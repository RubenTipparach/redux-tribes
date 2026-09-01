/**
 * Ship designs: the parts, the class frames, and the one function that turns a
 * design into numbers.
 *
 * THIS WHOLE FILE IS A STAGING POST. Everything in it is destined for
 * `engine/sim_core/src/data.rs` and an `ft_read_design` query, because what a
 * design WEIGHS, how it FLIES and whether it is LEGAL are rules, and a rule
 * with a second implementation in the client is a rule two clients can
 * disagree about (CLAUDE.md, "Ask the core, never reimplement it").
 *
 * It is allowed to live here for exactly as long as a design cannot reach a
 * match. Nothing here is hashed, nothing here is snapshotted, and no resolver
 * reads it, so today it cannot desync anything. The moment a designed hull is
 * flown, `derive()` moves to Rust and this file keeps only the palette art:
 * meshes, colours, glyphs and labels, which are the client's business.
 *
 * The one rule the staging post still obeys: `derive()` is the ONLY place a
 * derived number is produced. The editor reads its result and formats it, and
 * never works one out for itself, so the move to Rust is a move of one
 * function rather than an archaeology dig.
 */

import { CLASS_KEYS } from '../sim/types.js';

/** The hull lattice, every class. A frigate is 32 x 32 x 64 cells. */
export const NX = 32, NY = 32, NZ = 64;
export const CELLS = NX * NY * NZ;

/**
 * Cell size in world units, by rung.
 *
 * A frigate is 7 u long (class radius 3.5) over 64 cells, so 7/64 = 0.109375,
 * which is 7 x 2^-6 and therefore exact in f32. Every rung is the same lattice
 * with a bigger cell, so a capital costs no more to store than a frigate.
 */
export const RUNG = {
  frigate: 7 / 64,
  escort: 10.5 / 64,
  cruiser: 14 / 64,
  capital: 28 / 64,
} as const;
export type RungKey = keyof typeof RUNG;

// -------------------------------------------------------------- colour --

/** What a part is for. Eight jobs, eight hues. */
export type Purpose =
  | 'propulsion' | 'attitude' | 'gun' | 'ordnance'
  | 'command' | 'crew' | 'boarding' | 'structure';

/**
 * The purpose palette: base, shadow and highlight per job.
 *
 * These are NOT the faction colours. A Terran and a Karisen thruster are the
 * same orange, because the point of the coding is that propulsion looks like
 * propulsion on anybody's ship. Faction identity lives on the armour, which
 * is the part a player paints.
 */
export const PURPOSE: Record<Purpose,
  { base: number; dark: number; mid: number; lit: number; label: string }> = {
  propulsion: { base: 0xFF7A18, dark: 0x6B2D04, mid: 0xFFA85C, lit: 0xFFE0BC, label: 'propulsion' },
  attitude:   { base: 0x2FD6E8, dark: 0x0C4E58, mid: 0x7FE8F4, lit: 0xD6F8FC, label: 'attitude control' },
  gun:        { base: 0xF03B3B, dark: 0x5E1010, mid: 0xFF8080, lit: 0xFFD0D0, label: 'gunnery' },
  ordnance:   { base: 0xA574FF, dark: 0x3C2470, mid: 0xC7ABFF, lit: 0xE9DEFF, label: 'ordnance' },
  command:    { base: 0x3FD97C, dark: 0x0F5228, mid: 0x8AECB2, lit: 0xD2F9E2, label: 'command' },
  crew:       { base: 0xFFC93C, dark: 0x6B4C03, mid: 0xFFDF8A, lit: 0xFFF2CC, label: 'crew' },
  boarding:   { base: 0xFF5FA8, dark: 0x6B1439, mid: 0xFF9ECA, lit: 0xFFD6E9, label: 'boarding' },
  structure:  { base: 0x8494A8, dark: 0x333E4C, mid: 0xB0BDCB, lit: 0xDCE4EC, label: 'structure' },
};

/**
 * Armour paint, eight swatches per faction.
 *
 * Seeded from the archived material palette, then extended to a full eight so
 * a player has a scheme rather than a colour. Armour is the ONLY thing that
 * takes these: paint a drive bell and you have lost the thing that made an
 * unfamiliar hull readable.
 */
export const FACTION_PAINT: ReadonlyArray<{ key: string; name: string; swatches: readonly number[] }> = [
  { key: 'terran', name: 'Terran', swatches:
    [0x0095E9, 0x0B7FC4, 0x124E89, 0x0B2E52, 0x6FB6E8, 0xD8E2EC, 0x37475A, 0xF2A93B] },
  { key: 'karisen', name: 'Karisen', swatches:
    [0xFA6A0A, 0xD2560A, 0x73172D, 0x3E0F18, 0xFFA35C, 0xE8D6C0, 0x4A2A1A, 0xFFD24B] },
  { key: 'rogue', name: 'Rogue', swatches:
    [0x494182, 0x3A3466, 0x6B5FA8, 0x181425, 0x9A8FD1, 0xC9C4E0, 0x2A2440, 0xE0483C] },
  { key: 'benefactor', name: 'Benefactor', swatches:
    [0x1A7A3E, 0x146032, 0x2FA85B, 0x0E4423, 0x7FD9A0, 0xEDE7C8, 0x2F4A38, 0xF9A31B] },
  { key: 'civil', name: 'Civilian', swatches:
    [0xD8E2EC, 0xB9C6D4, 0x8C949E, 0x4F4F4F, 0xF2F5F8, 0x2A2E33, 0x6E7680, 0xC0A24A] },
];

/**
 * The finishes a palette colour can wear, and what each is called.
 *
 * The key IS the file name in `web/public/surf/`, so adding one is adding a
 * texture and a row here. `smooth` is deliberately not a texture: it means no
 * normal map at all, which is cheaper than a flat one and says the same thing.
 */
export const FINISHES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'smooth', name: 'Smooth' },
  { key: 'plate', name: 'Riveted' },
  { key: 'ribbed', name: 'Corrugated' },
  { key: 'hex', name: 'Ablative' },
  { key: 'cracked', name: 'Patched' },
  { key: 'tread', name: 'Grip deck' },
  { key: 'greeble', name: 'Greebled' },
  { key: 'weave', name: 'Composite' },
  { key: 'battered', name: 'Battered' },
];

export const DEFAULT_FINISH = 'plate';
/**
 * What the two surfaces that are not armour wear until asked otherwise.
 *
 * `greeble` for the parts is where the machinery finish has always been; the
 * frame used to have no answer of its own and simply wore the plating's,
 * which read as a hull with no structure in it the moment a shot opened one
 * up. Bare metal weave under the plate is what a frame member looks like.
 */
export const DEFAULT_FRAME_FINISH = 'weave';
export const DEFAULT_PART_FINISH = 'greeble';
/** What a hull is made of until a player says otherwise. */
export const DEFAULT_METAL = 0.25;
export const DEFAULT_ROUGH = 0.55;

/**
 * The three surfaces a hull is drawn with, resolved.
 *
 * ONE place decides what a design's armour, frame and machinery are made of,
 * because four pictures ask it: the map, the shipyard, the schematic and the
 * chip thumbnail. Each spelling out its own `?? DEFAULT` chain is four places
 * to change and three of them to forget, which is the divergence GUIDELINES
 * 5.1 is about, and it is exactly how the wound came to draw its plate in a
 * finish the hull beside it was not wearing.
 *
 * The armour answer is the PICKED SLOT's, falling back to the hull wide
 * finish for a design that has never set one.
 */
export function finishesOf(d: {
  faction: string; paint: number;
  finish?: string; slotFinish?: (string | null)[];
  frameFinish?: string; partFinish?: string;
}): { armour: string; frame: string; part: string } {
  const slot = paintFor(d.faction).swatches.indexOf(d.paint);
  const picked = slot >= 0 ? d.slotFinish?.[slot] : null;
  return {
    armour: picked || d.finish || DEFAULT_FINISH,
    frame: d.frameFinish || DEFAULT_FRAME_FINISH,
    part: d.partFinish || DEFAULT_PART_FINISH,
  };
}

export const paintFor = (key: string) =>
  FACTION_PAINT.find(f => f.key === key) ?? (FACTION_PAINT[0] as typeof FACTION_PAINT[number]);

// ---------------------------------------------------------------- parts --

/** What a socket will accept. A part never fits a socket of another kind. */
export type SocketKind =
  | 'drive' | 'retro' | 'rcs' | 'gun' | 'trunnion' | 'missile' | 'bay' | 'clamp';

export interface ModuleDef {
  readonly id: string;
  readonly name: string;
  readonly cat: 'drive' | 'weapon' | 'utility' | 'structure';
  readonly fits: SocketKind;
  /** Bounding box in cells, [x, y, z]. Parts are clusters, never one cube. */
  readonly size: readonly [number, number, number];
  /** Mass in millionths of a class mass unit, so sums stay integer. */
  readonly mass: number;
  /** Structural hull in milli HP. */
  readonly hull: number;
  /** Drive contribution, in centi units. */
  readonly thrust?: number;
  readonly retro?: number;
  /** Lateral thrust, per local axis. The core spends one accel_lat on both. */
  readonly latX?: number;
  readonly latY?: number;
  /** Exhaust velocity. Top speed is the best of these, with no mass term. */
  readonly exhaust?: number;
  /** Which gun it carries, if any. */
  readonly weapon?: 'beam' | 'projectile' | 'missile';
  readonly marines?: number;
  readonly capacity?: number;
  /** Boarding reach added over the class base. */
  readonly reach?: number;
  /**
   * What the part is FOR, which is what colours it.
   *
   * Only armour wears the faction palette. Everything else is coded by
   * purpose, so orange is always propulsion, red is always a gun, and a
   * player can read an unfamiliar hull without a legend.
   */
  readonly purpose: Purpose;
  /**
   * What the armour over this part is cut away for.
   *
   * A window is a hole in the PLATING where a room is behind it, so it is
   * authored on the module and derived onto the skin: the plate cell whose
   * inner neighbour belongs to a bridge wears the bridge viewport, and one
   * over a barracks wears cabin panes. That survives any change to the
   * rasteriser, which a list of cell indices would not, and it means a stock
   * hull gets its windows for free because it already carries those rooms.
   *
   * Presentation only. A window cannot change an outcome and none of it
   * crosses the boundary.
   */
  readonly window?: 'porthole' | 'panes' | 'strip' | 'bridge' | 'beacons' | 'hangar';
  /** How it is drawn. The client owns this and the core never sees it. */
  readonly art: 'bell' | 'nozzle' | 'block' | 'barbette' | 'beamgun' | 'cannon'
    | 'missilecell' | 'bridge' | 'pod' | 'strut'
    | 'rcs' | 'barracks' | 'airlock' | 'clamp' | 'cargo';
  readonly colour: number;
}

/**
 * The palette.
 *
 * Masses are generated from one density constant rather than chosen, so the
 * table cannot quietly contain a bargain: uM = volume in cells x 190, and hull
 * is 40 milli HP per cell of volume. A part is machinery, so its mass does NOT
 * scale with the rung: a bell is the same bell on a freighter.
 *
 * Power and thermal parts are deliberately absent. `sim_core` has no power or
 * heat, so they could only ever raise warnings, and a category that only warns
 * teaches players to ignore warnings.
 */
export const MODULES: readonly ModuleDef[] = [
  // ------------------------------------------------------------- drive --
  { id: 'DRV-V', name: 'Vernier nozzle', cat: 'drive', fits: 'drive',
    size: [2, 2, 2], mass: 1520, hull: 320, thrust: 5, exhaust: 6.0,
    purpose: 'propulsion', art: 'nozzle', colour: 0xFA6A0A },
  { id: 'DRV-N', name: 'Light nozzle', cat: 'drive', fits: 'drive',
    size: [4, 4, 4], mass: 12160, hull: 2560, thrust: 15, exhaust: 8.0,
    purpose: 'propulsion', art: 'nozzle', colour: 0xFA6A0A },
  { id: 'DRV-B', name: 'Standard bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 5], mass: 23750, hull: 5000, thrust: 30, exhaust: 8.5,
    purpose: 'propulsion', art: 'bell', colour: 0xFA6A0A },
  { id: 'DRV-BR', name: 'Overclocked bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 6], mass: 28500, hull: 6000, thrust: 33, exhaust: 9.5,
    purpose: 'propulsion', art: 'bell', colour: 0xFF8C3A },
  { id: 'DRV-T', name: 'Tug bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 5], mass: 23750, hull: 5000, thrust: 30, exhaust: 5.0,
    purpose: 'propulsion', art: 'bell', colour: 0xC9560A },
  { id: 'DRV-H', name: 'Heavy bell', cat: 'drive', fits: 'drive',
    size: [7, 7, 7], mass: 65170, hull: 13720, thrust: 60, exhaust: 7.0,
    purpose: 'propulsion', art: 'bell', colour: 0xFA6A0A },

  { id: 'RET-S', name: 'Retro nozzle', cat: 'drive', fits: 'retro',
    size: [2, 2, 2], mass: 1520, hull: 320, retro: 5, purpose: 'propulsion', art: 'nozzle', colour: 0xB4531A },
  { id: 'RET-C', name: 'Retro cluster', cat: 'drive', fits: 'retro',
    size: [6, 3, 3], mass: 10260, hull: 2160, retro: 15, purpose: 'propulsion', art: 'nozzle', colour: 0xB4531A },

  { id: 'RCS-Q', name: 'RCS quad', cat: 'drive', fits: 'rcs',
    size: [2, 2, 2], mass: 1520, hull: 320, latX: 2, latY: 2, purpose: 'attitude', art: 'rcs', colour: 0x2FD6E8 },
  { id: 'MAN-B', name: 'Manoeuvring block', cat: 'drive', fits: 'rcs',
    size: [3, 3, 3], mass: 5130, hull: 1080, latX: 5, latY: 5, purpose: 'attitude', art: 'rcs', colour: 0x2FD6E8 },
  { id: 'MAN-Y', name: 'Yaw block', cat: 'drive', fits: 'rcs',
    size: [4, 3, 3], mass: 6840, hull: 1440, latX: 10, purpose: 'attitude', art: 'rcs', colour: 0x2FD6E8 },
  { id: 'MAN-P', name: 'Pitch block', cat: 'drive', fits: 'rcs',
    size: [3, 4, 3], mass: 6840, hull: 1440, latY: 10, purpose: 'attitude', art: 'rcs', colour: 0x2FD6E8 },

  // ------------------------------------------------------------ weapon --
  // The barbette and the gun are separate parts because the archive separates
  // them: Weapon_Base_Cannon.prefab puts its collider and its subsystem proxy
  // on the BASE, not the barrel. The base takes the damage, the barrel turns.
  { id: 'WPN-BB1', name: 'Barbette', cat: 'weapon', fits: 'gun',
    size: [6, 3, 6], mass: 20520, hull: 4320, purpose: 'gun', art: 'barbette', colour: 0xF03B3B },
  { id: 'WPN-BM1', name: 'Beam turret', cat: 'weapon', fits: 'trunnion',
    size: [4, 4, 10], mass: 30400, hull: 6400, weapon: 'beam',
    purpose: 'gun', art: 'beamgun', colour: 0xFF8080 },
  { id: 'WPN-CN1', name: 'Projectile turret', cat: 'weapon', fits: 'trunnion',
    size: [5, 4, 9], mass: 34200, hull: 7200, weapon: 'projectile',
    purpose: 'gun', art: 'cannon', colour: 0xF03B3B },
  { id: 'WPN-ML1', name: 'Missile cell', cat: 'weapon', fits: 'missile',
    size: [5, 5, 7], mass: 33250, hull: 7000, weapon: 'missile',
    purpose: 'ordnance', art: 'missilecell', colour: 0xA574FF },

  // ----------------------------------------------------------- utility --
  { id: 'UTL-BRG', name: 'Bridge', cat: 'utility', fits: 'bay',
    size: [6, 5, 6], mass: 34200, hull: 7200, purpose: 'command', art: 'bridge',
    window: 'bridge', colour: 0x3FD97C },
  // Cabins, which is the one window with variants: seven of them, picked per
  // cell, so a run of quarters down a flank is lit differently along its
  // length instead of reading as one panel repeated.
  { id: 'UTL-BAR', name: 'Marine barracks', cat: 'utility', fits: 'bay',
    size: [5, 4, 7], mass: 26600, hull: 5600, marines: 5, purpose: 'crew', art: 'barracks',
    window: 'panes', colour: 0xFFC93C },
  { id: 'UTL-AIR', name: 'Boarding airlock', cat: 'utility', fits: 'bay',
    size: [3, 3, 3], mass: 5130, hull: 1080, capacity: 2, purpose: 'boarding', art: 'airlock',
    window: 'porthole', colour: 0xFF5FA8 },
  // Running lights on the clamps, which sit at the extremities of a hull:
  // the one decal that reads at MAP range, where a normal map does not, and
  // the thing that makes a hull look crewed from across the field.
  { id: 'UTL-CLM', name: 'Boarding clamp', cat: 'utility', fits: 'clamp',
    size: [5, 4, 6], mass: 22800, hull: 4800, reach: 5, purpose: 'boarding', art: 'clamp',
    window: 'beacons', colour: 0xFF5FA8 },
  { id: 'UTL-CGO', name: 'Cargo bay', cat: 'utility', fits: 'bay',
    size: [10, 8, 13], mass: 197600, hull: 41600, purpose: 'structure', art: 'cargo',
    window: 'hangar', colour: 0x8494A8 },

  // --------------------------------------------------------- structure --
  // A strut carries nothing in v1. An autorouted, freely meshed power grid is
  // a button that solves itself; this is simply how you attach a component
  // that is not already touching the hull. It gains the severance rule on the
  // day power exists.
  { id: 'STR-STRUT', name: 'Strut', cat: 'structure', fits: 'bay',
    size: [1, 1, 1], mass: 190, hull: 40, purpose: 'structure', art: 'strut', colour: 0x8494A8 },
];

export const moduleById = (id: string): ModuleDef | undefined =>
  MODULES.find(m => m.id === id);

// ---------------------------------------------------------------- guns --

/**
 * The three guns, as the owner settled them: three types, three models, three
 * jobs. Plasma is not here because `data.rs` already calls it what it is, a
 * cannon with different effects.
 *
 * `pen` is the new field. Armour blocks a share set by its layer count, and a
 * gun with penetration is scored against fewer layers, so a belt that stops a
 * beam is porous to a shell.
 */
export interface GunDef {
  readonly key: 'beam' | 'projectile' | 'missile';
  readonly name: string;
  readonly dmg: number;
  readonly batch: number;
  readonly range: number;
  readonly cooldown: number;
  /**
   * The firing arc, in degrees, as `data.rs` authors it: [min, max] about the
   * SHIP's own forward axis, horizontal then vertical.
   *
   * About the ship, not about the mount, because that is what the core
   * measures: `arc_test_3d` takes the ship's quaternion and no per mount
   * rotation exists in `sim_core` yet (turn.rs:476). The designer draws these
   * numbers and works nothing out from them: whether a shot is legal is
   * `ft_can_fire`'s answer in a match, never this table's.
   */
  readonly arcH: readonly [number, number];
  readonly arcV: readonly [number, number];
  readonly pen: number;
}
export const GUNS: readonly GunDef[] = [
  { key: 'beam', name: 'Beam', dmg: 27.5, batch: 1, range: 300, cooldown: 3.0,
    arcH: [-110, 110], arcV: [-60, 60], pen: 0 },
  { key: 'projectile', name: 'Projectile', dmg: 27.5, batch: 1, range: 200, cooldown: 4.0,
    arcH: [-90, 90], arcV: [-60, 60], pen: 2 },
  { key: 'missile', name: 'Missile', dmg: 25, batch: 2, range: 250, cooldown: 6.0,
    arcH: [-360, 360], arcV: [-360, 360], pen: 0 },
];

/** Does this arc cover everything? The core's own test: a span of 360 or more. */
export const allRound = (a: readonly [number, number]): boolean =>
  Math.abs(a[1] - a[0]) >= 360;
export const gunByKey = (k: string): GunDef | undefined => GUNS.find(g => g.key === k);

/** Layers of plate to the share they absorb. Reproduces the authored 75, 80
 *  and 90 at 3, 4 and 9 layers with no free parameter. */
export const blockPct = (layers: number): number =>
  layers <= 0 ? 0 : (100 * layers) / (layers + 1);

/** What a gun gets through, once armour has taken its share. */
export const throughArmour = (g: GunDef, layers: number): number =>
  g.dmg * (1 - blockPct(Math.max(0, layers - g.pen)) / 100);

// -------------------------------------------------------------- frames --

export interface Socket {
  readonly id: string;
  readonly kind: SocketKind;
  /** Cell position of the socket's centre. */
  readonly at: readonly [number, number, number];
  /** Mirrored sockets are authored once and reflected about x. */
  readonly mirror?: boolean;
  readonly label: string;
}

/**
 * How far out of the hull a socket's part is allowed to sit.
 *
 * - **proud**: standing off the hull, where the frame put it. A drive has to
 *   see vacuum and a gun has to see its target.
 * - **flush**: set INTO the skin, so only its face is on the surface. This is
 *   what attitude thrusters are: a thruster block is part of the hull, not a pod
 *   bolted to the outside of one, and standing them off left cyan bricks
 *   hanging off both flanks with a plate stub reaching back to the ship.
 * - **enclosed**: entirely inside, a cell under the plate. Berths, magazines,
 *   holds, airlocks and stowed boarding clamps are volume, not fittings.
 *
 * Sensors would be flush too. There is no sensor part, because `sim_core` has
 * no detection, and a part that can only ever raise a warning teaches players
 * to ignore warnings.
 */
export type Exposure = 'proud' | 'flush' | 'enclosed';

export const EXPOSURE: Record<SocketKind, Exposure> = {
  drive: 'proud', retro: 'proud', gun: 'proud', trunnion: 'proud',
  rcs: 'flush',
  missile: 'enclosed', bay: 'enclosed', clamp: 'enclosed',
};

export const exposureOf = (k: SocketKind): Exposure => EXPOSURE[k] ?? 'enclosed';

/** Left where the frame put it: nothing to seat and nothing to check. */
export const isProud = (k: SocketKind): boolean => exposureOf(k) === 'proud';

/**
 * How deep under the hull line a seated part sits.
 *
 * One cell for an enclosed part, which is the room the plate needs to close
 * over it. Zero for a flush one, so its outer face lands ON the surface and
 * the shell fills in around it rather than over it.
 */
const seatInset = (k: SocketKind): number => (exposureOf(k) === 'flush' ? 0 : 1);

/** The four navies and the civil yards, which is what a hull is painted as and
 *  what the shipyard groups its classes under. */
export type FactionKey = 'terran' | 'karisen' | 'rogue' | 'benefactor' | 'civil';

/** Where a class sits on its navy's ladder. Authored rather than read off the
 *  name: a screen that grouped hulls by splitting their display names would
 *  break the first time a class was called something else. */
export type TierKey = 'corvette' | 'frigate' | 'destroyer' | 'cruiser' | 'freighter';

export const TIER_NAMES: Record<TierKey, string> = {
  corvette: 'Corvette', frigate: 'Frigate', destroyer: 'Destroyer',
  cruiser: 'Heavy Cruiser', freighter: 'Freighter',
};

export const FACTION_ORDER: readonly FactionKey[] =
  ['terran', 'karisen', 'rogue', 'benefactor', 'civil'];

export const TIER_ORDER: readonly TierKey[] =
  ['corvette', 'frigate', 'destroyer', 'cruiser', 'freighter'];

export interface FrameDef {
  readonly classKey: string;
  readonly name: string;
  readonly faction: FactionKey;
  readonly tier: TierKey;
  readonly rung: RungKey;
  readonly radius: number;
  /** Mass ceiling, which is the authored class mass. */
  readonly massMax: number;
  readonly baseReach: number;
  readonly baseMarines: number;
  readonly baseCapacity: number;
  /** Keel and rib runs, as cell boxes. Fixed: the player cannot edit these. */
  /** The hull's cross section along z, which cuts the ribs and lays the plate. */
  readonly profile: readonly Station[];
  readonly spine: ReadonlyArray<readonly [number, number, number, number, number, number]>;
  readonly sockets: readonly Socket[];
  readonly note: string;
}

/** Centre of the lattice, so a frame can be authored symmetrically. */
const CX = NX / 2, CY = NY / 2;

/** A keel run: one box from z0 to z1 along the middle. */
const keel = (y: number, z0: number, z1: number, w = 4, h = 3) =>
  [CX - w / 2, y - h / 2, z0, w, h, z1 - z0] as const;
/**
 * A station on the hull profile: z, half beam, half depth, in cells.
 *
 * The profile is what stops a class being a brick. A frame authored as one
 * box from transom to nose reads as a brick, and armour wrapped over it reads
 * as a slightly larger brick, so the silhouette that tells a Terran from a
 * Benefactor has to live somewhere. It lives here: the ribs are cut to it and
 * the wrapped armour is laid on it, which is also why the two agree.
 */
export type Station = readonly [number, number, number];

/** The hull's half extents at z, interpolated between stations. */
export function hullAt(profile: readonly Station[], z: number): readonly [number, number] {
  const first = profile[0] as Station;
  const last = profile[profile.length - 1] as Station;
  if (z <= first[0]) return [first[1], first[2]];
  if (z >= last[0]) return [last[1], last[2]];
  for (let n = 1; n < profile.length; n++) {
    const a = profile[n - 1] as Station, b = profile[n] as Station;
    if (z > b[0]) continue;
    const t = (z - a[0]) / Math.max(1e-6, b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  return [last[1], last[2]];
}

/**
 * Is a cell inside the hull at z, with the surface drawn in by `inset` cells?
 *
 * One predicate answers both questions the profile is asked: where the ribs
 * are cut, and where the wrapped plate stops. Two would drift, and the drift
 * would look like plate floating off its own frame.
 */
export function insideHull(profile: readonly Station[],
  i: number, j: number, z: number, inset = 0): boolean {
  const [hw, hh] = hullAt(profile, z);
  const a = Math.max(0.5, (hw as number) - inset), b = Math.max(0.5, (hh as number) - inset);
  const dx = i + 0.5 - CX, dy = j + 0.5 - CY;
  return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1;
}

type Box = readonly [number, number, number, number, number, number];

/**
 * A rib RING at z: single cells around the profile's ellipse, one cell under
 * the skin, not four bars around a rectangle.
 *
 * A frame is a skeleton, so it is an outline rather than a slab: drawn filled
 * it reads as a bulkhead and charges hull for material nobody asked for. The
 * inset is what leaves room for the plate, so the ribs sit under the armour
 * instead of striping through it.
 */
const rib = (profile: readonly Station[], z: number, inset = 1): Box[] => {
  const [hw0, hh0] = hullAt(profile, z);
  const hw = Math.max(1, (hw0 as number) - inset), hh = Math.max(1, (hh0 as number) - inset);
  const seen = new Set<number>();
  const out: Box[] = [];
  const put = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= NX || j >= NY) return;
    const key = i * NY + j;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([i, j, z, 1, 1, 1] as Box);
  };
  for (let i = Math.ceil(CX - hw); i <= Math.floor(CX + hw); i++) {
    const u = (i + 0.5 - CX) / hw;
    const s = 1 - u * u;
    if (s < 0) continue;
    const dy = Math.sqrt(s) * hh;
    put(i, Math.round(CY + dy - 0.5));
    put(i, Math.round(CY - dy - 0.5));
  }
  for (let j = Math.ceil(CY - hh); j <= Math.floor(CY + hh); j++) {
    const v = (j + 0.5 - CY) / hh;
    const s = 1 - v * v;
    if (s < 0) continue;
    const dx = Math.sqrt(s) * hw;
    put(Math.round(CX + dx - 0.5), j);
    put(Math.round(CX - dx - 0.5), j);
  }
  return out;
};

const ribs = (profile: readonly Station[], zs: readonly number[]) =>
  zs.flatMap(z => rib(profile, z));

/**
 * A socket seated BY THE PROFILE rather than at a counted cell.
 *
 * `u` and `v` are fractions of the half beam and half depth AT THAT STATION,
 * so a socket authored at six tenths of the beam is inside the skin whatever
 * section the class has. The four frigates were authored in raw cells against
 * silhouettes read off the archive, which is exactly what raw cells are for;
 * twelve more frames that way would mean re-deriving every socket by hand
 * against its own profile, and a socket one cell outside the hull is a part
 * hanging in space with a pylon reaching back to its own ship.
 */
const seatAt = (prof: readonly Station[], kind: SocketKind, id: string,
  label: string, z: number, u = 0, v = 0): Socket => {
  const [hw, hh] = hullAt(prof, z);
  return {
    id, kind, label,
    at: [Math.round(CX + u * (hw as number)), Math.round(CY + v * (hh as number)), z],
  };
};

/** Two sockets mirrored about the keel line, which is how nearly every fitting
 *  on a ship actually comes. */
const pairX = (prof: readonly Station[], kind: SocketKind, a: string, b: string,
  label: string, z: number, u: number, v = 0): Socket[] => [
  seatAt(prof, kind, a, `${label}, port`, z, -u, v),
  seatAt(prof, kind, b, `${label}, starboard`, z, u, v),
];

/**
 * Everything on a hull that is NOT a gun: drives, retros, attitude thrusters,
 * the bridge, the berths and the clamps.
 *
 * These are the fittings every warship has in the same places for the same
 * reasons, and authoring them per class is how two frames of one faction come
 * to disagree about where a ship keeps its bridge. What a class is FOR lives
 * in the guns and in the profile, and both of those stay hand authored: this
 * lays the plumbing and gets out of the way.
 *
 * Bays march forward in PAIRS, a station at a time, because a barracks is
 * seven cells deep and two of them eight cells apart do not reach each other.
 * Cells are claimed first come first served, so a bay seated inside another
 * one is not an error anywhere: it is simply a part that never appears.
 */
const suite = (prof: readonly Station[],
  drives: ReadonlyArray<readonly [number, number]>,
  bays: number, clamps: number, bayV = 0.05,
  bayZ: readonly number[] | null = null): Socket[] => {
  const aft = Math.round((prof[0] as Station)[0]);
  const nose = Math.round((prof[prof.length - 1] as Station)[0]);
  const mid = Math.round((aft + nose) / 2);
  const out: Socket[] = [];

  drives.forEach(([u, v], n) => out.push(
    seatAt(prof, 'drive', `d${n}`, `drive ${n + 1}`, aft + 1, u, v)));

  out.push(...pairX(prof, 'retro', 'r0', 'r1', 'retro', nose - 8, 0.62));
  // A second pair, for the hulls that need it. Retro thrust does not scale
  // with the ship: two clusters brake a frigate and barely touch a cruiser,
  // and a heavy that cannot stop turns Full stop into a button that lies.
  out.push(...pairX(prof, 'retro', 'r2', 'r3', 'retro, quarter', nose - 20, 0.62));
  out.push(...pairX(prof, 'rcs', 'y0', 'y1', 'rcs, bow', nose - 12, 0.86));
  out.push(...pairX(prof, 'rcs', 'y2', 'y3', 'rcs, quarter', aft + 11, 0.86));
  out.push(seatAt(prof, 'rcs', 'p0', 'rcs, dorsal', mid, 0, 0.86));
  out.push(seatAt(prof, 'rcs', 'p1', 'rcs, ventral', mid, 0, -0.86));
  out.push(seatAt(prof, 'rcs', 'p2', 'rcs, dorsal quarter', mid - 11, 0, 0.86));
  out.push(seatAt(prof, 'rcs', 'p3', 'rcs, ventral quarter', mid - 11, 0, -0.86));

  // b0 is the bridge bay on every frame: forward and dorsal, where a bridge
  // goes and where its viewport is worth having. Everything else is berths,
  // airlocks and holds, and the stock fit decides which.
  out.push(seatAt(prof, 'bay', 'b0', 'bay, bridge', nose - 16, 0, 0.42));
  //
  // `bayZ` names the stations outright, for a hull whose midships volume is
  // spoken for. A Karisen cruiser keeps six missile cells on the keel and is
  // six cells deep: berths and cells cannot share a station, and the even
  // march below has no way to know that.
  const z0 = aft + 9, z1 = nose - 19;
  const stations = Math.max(1, Math.ceil((bays - 1) / 2));
  for (let n = 1; n < bays; n++) {
    const k = Math.floor((n - 1) / 2);
    const z = bayZ
      ? (bayZ[Math.min(k, bayZ.length - 1)] as number)
      : Math.round(z0 + ((z1 - z0) * k) / Math.max(1, stations - 1));
    const port = (n - 1) % 2 === 0;
    out.push(seatAt(prof, 'bay', `b${n}`, `bay, ${port ? 'port' : 'starboard'} ${k + 1}`,
      z, port ? -0.46 : 0.46, bayV));
  }

  // Clamps go on the QUARTER, aft of the bays and aft of anything a missile
  // pad sweeps. A clamp is enclosed, so on a thin hull it is pulled inboard to
  // fit, and amidships that walked it straight into a ventral pad's box.
  for (let n = 0; n < clamps; n++) {
    const k = Math.floor(n / 2);
    const z = aft + 8 + k * 9;
    const port = n % 2 === 0;
    out.push(seatAt(prof, 'clamp', `c${n}`, `clamp, ${port ? 'port' : 'starboard'} ${k + 1}`,
      z, port ? -0.80 : 0.80, -0.34));
  }
  return out;
};

// The five hull profiles. Half beam and half depth at a handful of stations,
// read off the archived silhouettes: the Terran's slab waist, the Karisen's
// long thin body, the Rogue's short wide one, the Benefactor's deep section,
// and the Freighter's parallel middle body.
const PROF_TERRAN: readonly Station[] = [
  [4, 8, 5], [10, 10, 6], [24, 11, 6.5], [38, 10, 6], [50, 7, 4.5], [58, 3, 2]];
const PROF_KARISEN: readonly Station[] = [
  [4, 9, 5], [12, 11, 5.5], [28, 11, 6], [42, 9, 5], [52, 6, 3.5], [58, 2.5, 2]];
const PROF_ROGUE: readonly Station[] = [
  [9, 8, 5], [18, 12, 6.5], [30, 12, 7], [40, 9, 5.5], [48, 5, 3.5], [52, 2.5, 2]];
const PROF_BENEFACTOR: readonly Station[] = [
  [4, 7, 8], [18, 8, 10], [32, 8, 9], [46, 7, 7], [54, 4, 4], [58, 2, 2]];
const PROF_FREIGHTER: readonly Station[] = [
  [8, 6, 5], [16, 8, 7], [30, 8, 7], [42, 7, 6], [50, 4, 3.5], [54, 2, 1.5]];

// The twelve that fill the ladder in. A faction's SECTION is its signature and
// it holds at every rung: Terran wide and flat, Karisen long and round, Rogue
// short and very broad, Benefactor deeper than it is wide. A corvette is short
// at the frigate's cell size; a destroyer and a heavy cruiser are the same
// lattice at the escort and cruiser rungs, which is what makes a cruiser cost
// eight times a frigate's plate for the same cells (design.rs scales it by the
// cube of the cell).
const PROF_TERRAN_CV: readonly Station[] = [
  [12, 6, 4], [18, 8, 5], [28, 8.5, 5], [38, 7, 4], [46, 4, 2.5], [50, 2, 1.5]];
const PROF_TERRAN_DD: readonly Station[] = [
  [3, 8, 5], [10, 11, 6], [22, 12, 6.5], [36, 12, 6.5], [48, 9, 5], [56, 4, 2.5],
  [60, 2, 1.5]];
const PROF_TERRAN_CA: readonly Station[] = [
  [2, 8.5, 5], [9, 11.5, 6], [20, 12.5, 6.5], [34, 12.5, 6.5], [46, 10.5, 5.5],
  [55, 6, 3.5], [61, 2.5, 1.5]];

const PROF_KARISEN_CV: readonly Station[] = [
  [12, 5, 4], [18, 6.5, 4.5], [28, 7, 4.5], [38, 6, 4], [46, 3.5, 2.5], [52, 1.5, 1.5]];
const PROF_KARISEN_DD: readonly Station[] = [
  [2, 6, 4.5], [10, 8.5, 5.5], [24, 9.5, 6], [40, 9, 5.5], [52, 6.5, 4], [59, 3, 2],
  [62, 1.5, 1]];
const PROF_KARISEN_CA: readonly Station[] = [
  [1, 6.5, 5], [9, 9, 6], [24, 10.5, 6.5], [42, 10, 6], [54, 7, 4.5], [60, 3.5, 2.5],
  [63, 1.5, 1]];

const PROF_ROGUE_CV: readonly Station[] = [
  [14, 7, 4], [20, 10, 5], [30, 10.5, 5.5], [38, 8, 4.5], [44, 4.5, 3], [48, 2.5, 2]];
const PROF_ROGUE_DD: readonly Station[] = [
  [8, 8, 5], [16, 12, 6.5], [28, 12.5, 7], [38, 10.5, 6.5], [46, 6.5, 4.5], [52, 3, 2]];
const PROF_ROGUE_CA: readonly Station[] = [
  [6, 9, 5.5], [14, 13, 7], [26, 13.5, 7.5], [38, 12, 7], [47, 7, 5], [54, 3, 2]];

const PROF_BENEFACTOR_CV: readonly Station[] = [
  [12, 5, 5.5], [18, 6, 7], [28, 6, 6.5], [38, 5.5, 5.5], [46, 3.5, 3.5], [50, 2, 2]];
const PROF_BENEFACTOR_DD: readonly Station[] = [
  [3, 7, 7.5], [12, 8.5, 10.5], [26, 9, 10], [40, 8.5, 9], [50, 6, 6], [57, 3, 3],
  [60, 1.5, 1.5]];
const PROF_BENEFACTOR_CA: readonly Station[] = [
  [2, 8, 8.5], [11, 9.5, 12], [24, 10, 12], [40, 9.5, 10.5], [51, 7, 7], [58, 3.5, 3.5],
  [62, 1.5, 1.5]];

export const FRAMES: readonly FrameDef[] = [
  {
    classKey: 'terran_frigate', name: 'Terran Frigate',
    faction: 'terran', tier: 'frigate', rung: 'frigate',
    radius: 3.5, massMax: 1.0, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_TERRAN,
    spine: [keel(CY, 6, 56), ...ribs(PROF_TERRAN, [10, 17, 24, 31, 38, 45, 52])],
    sockets: [
      { id: 'd0', kind: 'drive', at: [CX - 5, CY - 2, 4], label: 'drive, port lower' },
      { id: 'd1', kind: 'drive', at: [CX, CY - 2, 4], label: 'drive, centre lower' },
      { id: 'd2', kind: 'drive', at: [CX + 5, CY - 2, 4], label: 'drive, starboard lower' },
      { id: 'd3', kind: 'drive', at: [CX - 5, CY + 3, 4], label: 'drive, port upper' },
      { id: 'd4', kind: 'drive', at: [CX, CY + 3, 4], label: 'drive, centre upper' },
      { id: 'd5', kind: 'drive', at: [CX + 5, CY + 3, 4], label: 'drive, starboard upper' },
      { id: 'g0', kind: 'gun', at: [CX, CY + 4, 52], label: 'gun ring, nose' },
      { id: 'g1', kind: 'gun', at: [CX - 8, CY + 2, 34], label: 'gun ring, port' },
      { id: 'g2', kind: 'gun', at: [CX + 8, CY + 2, 34], label: 'gun ring, starboard' },
      { id: 'r0', kind: 'retro', at: [CX - 7, CY, 50], label: 'retro, port' },
      { id: 'r1', kind: 'retro', at: [CX + 7, CY, 50], label: 'retro, starboard' },
      { id: 'y0', kind: 'rcs', at: [CX - 10, CY, 48], label: 'rcs, port bow' },
      { id: 'y1', kind: 'rcs', at: [CX + 10, CY, 48], label: 'rcs, starboard bow' },
      { id: 'p0', kind: 'rcs', at: [CX, CY + 8, 40], label: 'rcs, dorsal' },
      { id: 'p1', kind: 'rcs', at: [CX, CY - 8, 40], label: 'rcs, ventral' },
      { id: 'b0', kind: 'bay', at: [CX, CY + 4, 44], label: 'bay, forward dorsal' },
      { id: 'b1', kind: 'bay', at: [CX - 5, CY, 28], label: 'bay, port' },
      { id: 'b2', kind: 'bay', at: [CX + 5, CY, 28], label: 'bay, starboard' },
      { id: 'b3', kind: 'bay', at: [CX, CY - 4, 22], label: 'bay, ventral' },
      { id: 'b4', kind: 'bay', at: [CX, CY + 3, 16], label: 'bay, aft' },
      { id: 'b5', kind: 'bay', at: [CX - 5, CY + 2, 20], label: 'bay, port aft' },
      { id: 'b6', kind: 'bay', at: [CX + 5, CY + 2, 20], label: 'bay, starboard aft' },
      { id: 'b7', kind: 'bay', at: [CX, CY - 3, 34], label: 'bay, ventral forward' },
      { id: 'b8', kind: 'bay', at: [CX - 4, CY + 4, 28], label: 'bay, spare port' },
      { id: 'b9', kind: 'bay', at: [CX + 4, CY + 4, 28], label: 'bay, spare starboard' },
      { id: 'y2', kind: 'rcs', at: [CX - 9, CY, 20], label: 'rcs, port quarter' },
      { id: 'y3', kind: 'rcs', at: [CX + 9, CY, 20], label: 'rcs, starboard quarter' },
      { id: 'c0', kind: 'clamp', at: [CX - 9, CY - 4, 26], label: 'clamp, port' },
      { id: 'c1', kind: 'clamp', at: [CX + 9, CY - 4, 26], label: 'clamp, starboard' },
    ],
    note: 'A slab body on one deep keel. Six small bells in a three by two block '
      + 'on the transom and armour standing off the flanks, both read straight off '
      + 'ship_1.fbx.',
  },
  {
    classKey: 'karisen_frigate', name: 'Karisen Frigate',
    faction: 'karisen', tier: 'frigate', rung: 'frigate',
    radius: 3.5, massMax: 1.0, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    // Three parallel runs, and the ventral beam overruns the body at both ends
    // exactly as Ship_2_energy_1 overruns Ship_2_main in the archive.
    profile: PROF_KARISEN,
    spine: [keel(CY, 8, 54), keel(CY + 5, 12, 50, 8, 2), keel(CY - 5, 4, 58, 5, 3),
      ...ribs(PROF_KARISEN, [12, 19, 26, 33, 40, 47])],
    sockets: [
      { id: 'd0', kind: 'drive', at: [CX - 6, CY - 1, 5], label: 'drive, port' },
      { id: 'd1', kind: 'drive', at: [CX, CY - 1, 5], label: 'drive, centre' },
      { id: 'd2', kind: 'drive', at: [CX + 6, CY - 1, 5], label: 'drive, starboard' },
      { id: 'd3', kind: 'drive', at: [CX, CY + 4, 5], label: 'drive, dorsal vernier' },
      { id: 'g0', kind: 'gun', at: [CX, CY + 4, 50], label: 'gun ring, nose' },
      { id: 'm0', kind: 'missile', at: [CX, CY - 6, 30], label: 'missile pad, ventral' },
      { id: 's0', kind: 'gun', at: [CX - 9, CY - 3, 22], label: 'sponson, port' },
      { id: 's1', kind: 'gun', at: [CX + 9, CY - 3, 22], label: 'sponson, starboard' },
      { id: 'r0', kind: 'retro', at: [CX - 7, CY, 48], label: 'retro, port' },
      { id: 'r1', kind: 'retro', at: [CX + 7, CY, 48], label: 'retro, starboard' },
      { id: 'y0', kind: 'rcs', at: [CX - 10, CY, 46], label: 'rcs, port bow' },
      { id: 'y1', kind: 'rcs', at: [CX + 10, CY, 46], label: 'rcs, starboard bow' },
      { id: 'p0', kind: 'rcs', at: [CX, CY + 8, 38], label: 'rcs, dorsal' },
      { id: 'p1', kind: 'rcs', at: [CX, CY - 8, 38], label: 'rcs, ventral' },
      { id: 'b0', kind: 'bay', at: [CX, CY + 4, 42], label: 'bay, dorsal' },
      { id: 'b1', kind: 'bay', at: [CX - 4, CY - 4, 26], label: 'bay, port keel' },
      { id: 'b2', kind: 'bay', at: [CX + 4, CY - 4, 26], label: 'bay, starboard keel' },
      { id: 'b3', kind: 'bay', at: [CX, CY + 2, 18], label: 'bay, aft' },
      { id: 'b4', kind: 'bay', at: [CX - 5, CY + 3, 34], label: 'bay, port dorsal' },
      { id: 'b5', kind: 'bay', at: [CX + 5, CY + 3, 34], label: 'bay, starboard dorsal' },
      { id: 'c0', kind: 'clamp', at: [CX - 9, CY - 5, 24], label: 'clamp, port' },
      { id: 'c1', kind: 'clamp', at: [CX + 9, CY - 5, 24], label: 'clamp, starboard' },
    ],
    note: 'A stacked spine rather than a slab: body run, dorsal stringer, and a '
      + 'ventral keel beam longer than the ship. Two sponsons ship empty.',
  },
  {
    classKey: 'rogue_frigate', name: 'Rogue Frigate',
    faction: 'rogue', tier: 'frigate', rung: 'frigate',
    radius: 3.2, massMax: 0.9, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    // The frame feature no other class has: a transverse boarding gallery
    // crossing the keel, carrying the clamps and the collars as one structure.
    profile: PROF_ROGUE,
    spine: [keel(CY, 14, 48), [CX - 11, CY - 2, 26, 22, 4, 5] as const,
      ...ribs(PROF_ROGUE, [18, 24, 30, 36, 42])],
    sockets: [
      { id: 'd0', kind: 'drive', at: [CX - 6, CY, 11], label: 'drive, port' },
      { id: 'd1', kind: 'drive', at: [CX, CY, 11], label: 'drive, centre' },
      { id: 'd2', kind: 'drive', at: [CX + 6, CY, 11], label: 'drive, starboard' },
      { id: 'g0', kind: 'gun', at: [CX - 6, CY + 3, 42], label: 'gun ring, port' },
      { id: 'g1', kind: 'gun', at: [CX + 6, CY + 3, 42], label: 'gun ring, starboard' },
      { id: 'r0', kind: 'retro', at: [CX - 6, CY, 44], label: 'retro, port' },
      { id: 'r1', kind: 'retro', at: [CX + 6, CY, 44], label: 'retro, starboard' },
      { id: 'r2', kind: 'retro', at: [CX, CY + 5, 44], label: 'retro, dorsal' },
      { id: 'y0', kind: 'rcs', at: [CX - 11, CY, 40], label: 'rcs, port bow' },
      { id: 'y1', kind: 'rcs', at: [CX + 11, CY, 40], label: 'rcs, starboard bow' },
      { id: 'y2', kind: 'rcs', at: [CX - 11, CY, 18], label: 'rcs, port quarter' },
      { id: 'y3', kind: 'rcs', at: [CX + 11, CY, 18], label: 'rcs, starboard quarter' },
      { id: 'p0', kind: 'rcs', at: [CX, CY + 8, 36], label: 'rcs, dorsal' },
      { id: 'p1', kind: 'rcs', at: [CX, CY - 8, 36], label: 'rcs, ventral' },
      { id: 'b0', kind: 'bay', at: [CX, CY + 4, 40], label: 'bay, bridge' },
      { id: 'b1', kind: 'bay', at: [CX - 8, CY, 28], label: 'gallery bay, port outer' },
      { id: 'b2', kind: 'bay', at: [CX - 4, CY, 28], label: 'gallery bay, port inner' },
      { id: 'b3', kind: 'bay', at: [CX + 4, CY, 28], label: 'gallery bay, starboard inner' },
      { id: 'b4', kind: 'bay', at: [CX + 8, CY, 28], label: 'gallery bay, starboard outer' },
      { id: 'b5', kind: 'bay', at: [CX - 7, CY, 22], label: 'gallery bay, port aft' },
      { id: 'b6', kind: 'bay', at: [CX + 7, CY, 22], label: 'gallery bay, starboard aft' },
      { id: 'b7', kind: 'bay', at: [CX, CY - 4, 22], label: 'bay, ventral' },
      { id: 'b8', kind: 'bay', at: [CX - 10, CY + 2, 26], label: 'collar, port' },
      { id: 'b9', kind: 'bay', at: [CX + 10, CY + 2, 26], label: 'collar, starboard' },
      { id: 'c0', kind: 'clamp', at: [CX - 12, CY, 30], label: 'clamp, port forward' },
      { id: 'c1', kind: 'clamp', at: [CX + 12, CY, 30], label: 'clamp, starboard forward' },
      { id: 'c2', kind: 'clamp', at: [CX - 12, CY, 24], label: 'clamp, port aft' },
      { id: 'c3', kind: 'clamp', at: [CX + 12, CY, 24], label: 'clamp, starboard aft' },
      { id: 'a0', kind: 'bay', at: [CX - 10, CY - 4, 30], label: 'collar, port forward' },
      { id: 'a1', kind: 'bay', at: [CX + 10, CY - 4, 30], label: 'collar, starboard forward' },
      { id: 'a2', kind: 'bay', at: [CX - 10, CY - 4, 24], label: 'collar, port aft' },
      { id: 'a3', kind: 'bay', at: [CX + 10, CY - 4, 24], label: 'collar, starboard aft' },
      { id: 'a4', kind: 'bay', at: [CX, CY - 6, 27], label: 'collar, ventral' },
      { id: 'b10', kind: 'bay', at: [CX - 4, CY + 4, 36], label: 'bay, spare port' },
      { id: 'b11', kind: 'bay', at: [CX + 4, CY + 4, 36], label: 'bay, spare starboard' },
      { id: 'c4', kind: 'clamp', at: [CX - 12, CY + 4, 27], label: 'clamp, port upper' },
      { id: 'c5', kind: 'clamp', at: [CX + 12, CY + 4, 27], label: 'clamp, starboard upper' },
    ],
    note: 'Short and wide, with a boarding gallery across its waist. The gear that '
      + 'makes it a raider is roughly a third of its mass, which is also why it has '
      + 'the least hull and the best turn rate.',
  },
  {
    classKey: 'benefactor_frigate', name: 'Benefactor Frigate',
    faction: 'benefactor', tier: 'frigate', rung: 'frigate',
    radius: 3.5, massMax: 1.0, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    // A deep aft drop keel, which is the one archived fact worth keeping from
    // a prefab that is otherwise a single mesh.
    profile: PROF_BENEFACTOR,
    spine: [keel(CY, 14, 56), keel(CY - 7, 4, 20, 5, 4), keel(CY + 6, 4, 20, 5, 3),
      ...ribs(PROF_BENEFACTOR, [18, 25, 32, 39, 46, 52])],
    sockets: [
      { id: 'd0', kind: 'drive', at: [CX, CY - 3, 5], label: 'drive, main' },
      { id: 'd1', kind: 'drive', at: [CX + 6, CY - 3, 6], label: 'drive, starboard' },
      { id: 'd2', kind: 'drive', at: [CX - 6, CY - 3, 6], label: 'drive, port' },
      { id: 'd3', kind: 'drive', at: [CX, CY + 5, 6], label: 'drive, dorsal' },
      { id: 'g0', kind: 'gun', at: [CX - 7, CY + 2, 46], label: 'gun ring, port' },
      { id: 'g1', kind: 'gun', at: [CX + 7, CY + 2, 46], label: 'gun ring, starboard' },
      { id: 'm0', kind: 'missile', at: [CX, CY - 6, 30], label: 'missile pad, ventral' },
      { id: 'k0', kind: 'gun', at: [CX, CY - 9, 14], label: 'aft stack, ventral' },
      { id: 'k1', kind: 'gun', at: [CX, CY + 8, 14], label: 'aft stack, dorsal' },
      { id: 'a0', kind: 'bay', at: [CX - 6, CY - 4, 34], label: 'collar, port' },
      { id: 'a1', kind: 'bay', at: [CX + 6, CY - 4, 34], label: 'collar, starboard' },
      { id: 'r0', kind: 'retro', at: [CX - 6, CY, 50], label: 'retro, port' },
      { id: 'r1', kind: 'retro', at: [CX + 6, CY, 50], label: 'retro, starboard' },
      { id: 'y0', kind: 'rcs', at: [CX - 9, CY, 46], label: 'rcs, port bow' },
      { id: 'y1', kind: 'rcs', at: [CX + 9, CY, 46], label: 'rcs, starboard bow' },
      { id: 'p0', kind: 'rcs', at: [CX, CY + 9, 38], label: 'rcs, dorsal' },
      { id: 'p1', kind: 'rcs', at: [CX, CY - 9, 38], label: 'rcs, ventral' },
      { id: 'b0', kind: 'bay', at: [CX, CY + 4, 42], label: 'bay, dorsal' },
      { id: 'b1', kind: 'bay', at: [CX - 4, CY, 28], label: 'bay, port' },
      { id: 'b2', kind: 'bay', at: [CX + 4, CY, 28], label: 'bay, starboard' },
      { id: 'b3', kind: 'bay', at: [CX, CY - 5, 22], label: 'bay, ventral' },
      { id: 'b4', kind: 'bay', at: [CX - 5, CY + 3, 34], label: 'bay, port dorsal' },
      { id: 'b5', kind: 'bay', at: [CX + 5, CY + 3, 34], label: 'bay, starboard dorsal' },
      { id: 'c0', kind: 'clamp', at: [CX - 8, CY - 4, 26], label: 'clamp, port' },
      { id: 'c1', kind: 'clamp', at: [CX + 8, CY - 4, 26], label: 'clamp, starboard' },
    ],
    note: 'A long hull that steps down deeply aft, with a forward pair of cannon '
      + 'rings and a ventral missile rack. The aft stack ships empty.',
  },
  {
    classKey: 'freighter', name: 'Freighter',
    faction: 'civil', tier: 'freighter', rung: 'escort',
    radius: 4.5, massMax: 2.0, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_FREIGHTER,
    spine: [keel(CY, 12, 48), keel(CY, 16, 44, 14, 1),
      ...ribs(PROF_FREIGHTER, [18, 26, 34, 40])],
    // No gun ring anywhere. Every gun needs a barbette and every barbette needs
    // a ring, so the authored empty mount table becomes geometry rather than a
    // convention. No clamp seat either: its short reach is an absence.
    sockets: [
      { id: 'd0', kind: 'drive', at: [CX - 5, CY, 9], label: 'drive, port' },
      { id: 'd1', kind: 'drive', at: [CX, CY, 9], label: 'drive, centre' },
      { id: 'd2', kind: 'drive', at: [CX + 5, CY, 9], label: 'drive, starboard' },
      { id: 'r0', kind: 'retro', at: [CX - 6, CY, 46], label: 'retro, port' },
      { id: 'r1', kind: 'retro', at: [CX + 6, CY, 46], label: 'retro, starboard' },
      { id: 'y0', kind: 'rcs', at: [CX - 8, CY, 44], label: 'rcs, port bow' },
      { id: 'y1', kind: 'rcs', at: [CX + 8, CY, 44], label: 'rcs, starboard bow' },
      { id: 'p0', kind: 'rcs', at: [CX, CY + 7, 38], label: 'rcs, dorsal' },
      { id: 'p1', kind: 'rcs', at: [CX, CY - 7, 38], label: 'rcs, ventral' },
      { id: 'h0', kind: 'bay', at: [CX, CY, 38], label: 'hold, forward' },
      { id: 'h1', kind: 'bay', at: [CX, CY, 22], label: 'hold, aft' },
      { id: 'b0', kind: 'bay', at: [CX, CY + 5, 46], label: 'bay, bridge' },
      { id: 'b1', kind: 'bay', at: [CX - 6, CY, 14], label: 'bay, port aft' },
      { id: 'b2', kind: 'bay', at: [CX + 6, CY, 14], label: 'bay, starboard aft' },
      { id: 'b3', kind: 'bay', at: [CX, CY + 5, 30], label: 'bay, dorsal' },
      { id: 'b4', kind: 'bay', at: [CX - 6, CY - 4, 30], label: 'collar, port' },
      { id: 'b5', kind: 'bay', at: [CX + 6, CY - 4, 30], label: 'collar, starboard' },
      { id: 'b6', kind: 'bay', at: [CX, CY - 5, 18], label: 'collar, ventral' },
      { id: 'b7', kind: 'bay', at: [CX - 5, CY + 4, 22], label: 'bay, spare port' },
      { id: 'b8', kind: 'bay', at: [CX + 5, CY + 4, 22], label: 'bay, spare starboard' },
    ],
    note: 'A long square brick with two holds under a dorsal door. No gun ring '
      + 'exists on this frame, which is what the empty mount table looks like as '
      + 'geometry.',
  },

  // ------------------------------------------------------------ Terran --
  //
  // One ladder, four rungs, and nothing on it is a surprise. Every step adds
  // another beam battery and another belt to the same slab body, because the
  // fleet is built to be replaced rather than to be clever.
  {
    classKey: 'terran_corvette', name: 'Terran Corvette',
    faction: 'terran', tier: 'corvette', rung: 'frigate',
    radius: 2.5, massMax: 0.55, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_TERRAN_CV,
    spine: [keel(CY, 13, 49), ...ribs(PROF_TERRAN_CV, [18, 25, 32, 39, 45])],
    sockets: [
      ...suite(PROF_TERRAN_CV, [[-0.5, -0.2], [0.5, -0.2]], 5, 2),
      seatAt(PROF_TERRAN_CV, 'gun', 'g0', 'gun ring, nose', 43, 0, 0.45),
      seatAt(PROF_TERRAN_CV, 'gun', 'g1', 'gun ring, dorsal', 29, 0, 0.55),
    ],
    note: 'The frigate’s slab cut down to a bell, a nozzle and two rings. Short enough '
      + 'that the whole hull turns inside a frigate’s circle, and thin enough on '
      + 'the belt that the first cannon through it reaches the reactor.',
  },
  {
    classKey: 'terran_destroyer', name: 'Terran Destroyer',
    faction: 'terran', tier: 'destroyer', rung: 'escort',
    radius: 5.8, massMax: 2.4, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_TERRAN_DD,
    // The raised dorsal spine is what makes a Terran read as a Terran from
    // above: a flat deck with a rail down the middle of it.
    spine: [keel(CY, 4, 58), keel(CY + 5, 12, 48, 8, 2),
      ...ribs(PROF_TERRAN_DD, [10, 18, 26, 34, 42, 50])],
    sockets: [
      ...suite(PROF_TERRAN_DD, [[-0.55, -0.28], [0, -0.28], [0.55, -0.28],
        [-0.55, 0.35], [0, 0.35], [0.55, 0.35]], 11, 2),
      seatAt(PROF_TERRAN_DD, 'gun', 'g0', 'gun ring, nose', 51, 0, 0.42),
      seatAt(PROF_TERRAN_DD, 'gun', 'g1', 'gun ring, port waist', 36, -0.74, 0.26),
      seatAt(PROF_TERRAN_DD, 'gun', 'g2', 'gun ring, starboard waist', 36, 0.74, 0.26),
      seatAt(PROF_TERRAN_DD, 'gun', 'g3', 'gun ring, aft dorsal', 16, 0, 0.6),
      seatAt(PROF_TERRAN_DD, 'gun', 'g4', 'gun ring, ventral', 30, 0, -0.6),
    ],
    note: 'Three heavy bells and three verniers on a parallel sided slab, and five '
      + 'rings, four of them beams. '
      + 'The ventral ring is the one exception to the doctrine: a projectile turret, '
      + 'carried because a fleet of beams has nothing that goes through a belt.',
  },
  {
    classKey: 'terran_cruiser', name: 'Terran Heavy Cruiser',
    faction: 'terran', tier: 'cruiser', rung: 'cruiser',
    radius: 7.8, massMax: 5.45, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_TERRAN_CA,
    spine: [keel(CY, 3, 59), keel(CY + 6, 10, 52, 10, 2), keel(CY - 5, 8, 50, 8, 2),
      ...ribs(PROF_TERRAN_CA, [9, 17, 25, 33, 41, 49, 56])],
    sockets: [
      ...suite(PROF_TERRAN_CA, [[-0.62, -0.3], [-0.21, -0.3], [0.21, -0.3], [0.62, -0.3],
        [-0.62, 0.36], [-0.21, 0.36], [0.21, 0.36], [0.62, 0.36]], 15, 4),
      seatAt(PROF_TERRAN_CA, 'gun', 'g0', 'gun ring, nose', 53, 0, 0.4),
      seatAt(PROF_TERRAN_CA, 'gun', 'g1', 'gun ring, port forward', 42, -0.76, 0.24),
      seatAt(PROF_TERRAN_CA, 'gun', 'g2', 'gun ring, starboard forward', 42, 0.76, 0.24),
      seatAt(PROF_TERRAN_CA, 'gun', 'g3', 'gun ring, port aft', 22, -0.76, 0.24),
      seatAt(PROF_TERRAN_CA, 'gun', 'g4', 'gun ring, starboard aft', 22, 0.76, 0.24),
      seatAt(PROF_TERRAN_CA, 'gun', 'g5', 'gun ring, aft dorsal', 12, 0, 0.6),
      seatAt(PROF_TERRAN_CA, 'gun', 'g6', 'gun ring, forward ventral', 34, 0, -0.62),
      seatAt(PROF_TERRAN_CA, 'gun', 'g7', 'gun ring, aft ventral', 18, 0, -0.62),
    ],
    note: 'Eight rings on a broadside: two down each flank, one at the nose, one '
      + 'over the quarterdeck and two under the keel. Four heavy bells and four '
      + 'verniers push it and none of them make it quick. What it does is stand in a line and keep firing.',
  },

  // ----------------------------------------------------------- Karisen --
  //
  // Every rung is the longest hull at that rung and the thinnest, and every
  // rung adds missile cells rather than beams. Two beams is what a Karisen
  // carries however big it gets: the ordnance is the ship.
  {
    classKey: 'karisen_corvette', name: 'Karisen Corvette',
    faction: 'karisen', tier: 'corvette', rung: 'frigate',
    radius: 2.8, massMax: 0.5, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_KARISEN_CV,
    // The ventral rail overruns the body at both ends, which is the one
    // Karisen habit that survives at every rung.
    spine: [keel(CY, 13, 51), keel(CY - 4, 10, 54, 4, 2),
      ...ribs(PROF_KARISEN_CV, [18, 25, 32, 39, 46])],
    sockets: [
      ...suite(PROF_KARISEN_CV, [[-0.55, -0.1], [0, -0.1], [0.55, -0.1]], 4, 2),
      seatAt(PROF_KARISEN_CV, 'gun', 'g0', 'gun ring, nose', 44, 0, 0.45),
      seatAt(PROF_KARISEN_CV, 'missile', 'm0', 'missile pad, ventral', 30, 0, -0.6),
    ],
    note: 'A needle with two overclocked bells, a vernier and one cell. Fastest hull in the game and the '
      + 'least able to take a hit: it is a ship for arriving with a missile already '
      + 'in the air and leaving before the answer.',
  },
  {
    classKey: 'karisen_destroyer', name: 'Karisen Destroyer',
    faction: 'karisen', tier: 'destroyer', rung: 'escort',
    radius: 5.7, massMax: 1.9, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_KARISEN_DD,
    spine: [keel(CY, 3, 60), keel(CY - 5, 0, 63, 4, 2), keel(CY + 5, 10, 52, 5, 2),
      ...ribs(PROF_KARISEN_DD, [9, 17, 25, 33, 41, 49, 56])],
    sockets: [
      ...suite(PROF_KARISEN_DD, [[-0.6, -0.12], [0, -0.12], [0.6, -0.12], [0, 0.5]], 8, 2, 0.5),
      seatAt(PROF_KARISEN_DD, 'gun', 'g0', 'gun ring, nose', 51, 0, 0.42),
      seatAt(PROF_KARISEN_DD, 'gun', 'g1', 'gun ring, aft dorsal', 16, 0, 0.58),
      seatAt(PROF_KARISEN_DD, 'missile', 'm0', 'missile pad, port', 26, -0.42, -0.78),
      seatAt(PROF_KARISEN_DD, 'missile', 'm1', 'missile pad, starboard', 26, 0.42, -0.78),
    ],
    note: 'Sixty cells of hull and nine of beam: the longest thin thing at its rung. '
      + 'A pair of ventral cells under a rail that runs past both ends of the body, '
      + 'and two beams that are there to finish rather than to open.',
  },
  {
    classKey: 'karisen_cruiser', name: 'Karisen Heavy Cruiser',
    faction: 'karisen', tier: 'cruiser', rung: 'cruiser',
    radius: 8.0, massMax: 4.65, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_KARISEN_CA,
    spine: [keel(CY, 2, 61), keel(CY - 6, 0, 63, 5, 2), keel(CY + 6, 8, 54, 6, 2),
      ...ribs(PROF_KARISEN_CA, [8, 16, 24, 32, 40, 48, 56])],
    sockets: [
      ...suite(PROF_KARISEN_CA, [[-0.62, -0.12], [-0.25, -0.12], [0.25, -0.12],
        [0.62, -0.12], [0, 0.52]], 9, 2, 0.5, [6, 14, 32, 54]),
      seatAt(PROF_KARISEN_CA, 'gun', 'g0', 'gun ring, nose', 53, 0, 0.4),
      seatAt(PROF_KARISEN_CA, 'gun', 'g1', 'gun ring, aft dorsal', 14, 0, 0.58),
      // Three pairs down the rail, evenly, because that is what the rail is.
      seatAt(PROF_KARISEN_CA, 'missile', 'm0', 'missile pad, port forward', 40, -0.44, -0.78),
      seatAt(PROF_KARISEN_CA, 'missile', 'm1', 'missile pad, starboard forward', 40, 0.44, -0.78),
      seatAt(PROF_KARISEN_CA, 'missile', 'm2', 'missile pad, port aft', 24, -0.44, -0.78),
      seatAt(PROF_KARISEN_CA, 'missile', 'm3', 'missile pad, starboard aft', 24, 0.44, -0.78),
    ],
    note: 'The arsenal: four cells in two pairs along a keel rail longer than the '
      + 'ship, and still only the two beams every Karisen carries. The berths are up '
      + 'top because the keel is a magazine, and it is the one heavy that outruns a '
      + 'frigate.',
  },

  // ------------------------------------------------------------- Rogue --
  //
  // The ladder that grows in MARINES. Every rung has the least hull at that
  // rung, the fewest guns, the most clamps and by some way the sharpest turn:
  // a Rogue heavy cruiser still comes about faster than a Terran destroyer.
  {
    classKey: 'rogue_corvette', name: 'Rogue Corvette',
    faction: 'rogue', tier: 'corvette', rung: 'frigate',
    radius: 2.3, massMax: 0.5, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_ROGUE_CV,
    // A cross beam through the keel, carrying the clamps and the collars as
    // one structure, exactly as the frigate does.
    spine: [keel(CY, 15, 47), [CX - 8, CY - 2, 26, 16, 3, 4] as const,
      ...ribs(PROF_ROGUE_CV, [20, 26, 32, 38, 44])],
    sockets: [
      ...suite(PROF_ROGUE_CV, [[-0.5, 0], [0, 0], [0.5, 0]], 6, 2),
      seatAt(PROF_ROGUE_CV, 'gun', 'g0', 'gun ring, nose', 39, 0, 0.4),
    ],
    note: 'A boarding launch: one gun, two overclocked bells and a hull wide enough '
      + 'to put '
      + 'clamps on. It cannot fight anything and it does not have to, because '
      + 'everything it wants is already inside somebody else’s ship.',
  },
  {
    classKey: 'rogue_destroyer', name: 'Rogue Destroyer',
    faction: 'rogue', tier: 'destroyer', rung: 'escort',
    radius: 4.5, massMax: 1.45, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_ROGUE_DD,
    spine: [keel(CY, 9, 51), [CX - 11, CY - 2, 24, 22, 4, 5] as const,
      ...ribs(PROF_ROGUE_DD, [16, 22, 28, 34, 40, 46])],
    sockets: [
      ...suite(PROF_ROGUE_DD, [[-0.55, 0], [0, 0], [0.55, 0]], 17, 6),
      seatAt(PROF_ROGUE_DD, 'gun', 'g0', 'gun ring, port', 36, -0.7, 0.3),
      seatAt(PROF_ROGUE_DD, 'gun', 'g1', 'gun ring, starboard', 36, 0.7, 0.3),
      seatAt(PROF_ROGUE_DD, 'gun', 'g2', 'gun ring, aft dorsal', 12, 0, 0.58),
    ],
    note: 'Short, very wide and mostly barracks. Six clamps on a cross beam and '
      + 'forty five marines behind them: the guns exist to stop a hull running, not '
      + 'to sink it, because a sunk hull is a hull nobody took.',
  },
  {
    classKey: 'rogue_cruiser', name: 'Rogue Heavy Cruiser',
    faction: 'rogue', tier: 'cruiser', rung: 'cruiser',
    radius: 6.7, massMax: 3.1, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_ROGUE_CA,
    spine: [keel(CY, 7, 53), [CX - 13, CY - 2, 22, 26, 4, 6] as const,
      [CX - 13, CY - 2, 34, 26, 4, 6] as const,
      ...ribs(PROF_ROGUE_CA, [14, 20, 26, 32, 38, 44, 50])],
    sockets: [
      ...suite(PROF_ROGUE_CA, [[-0.6, 0], [-0.2, 0], [0.2, 0], [0.6, 0]], 23, 8),
      seatAt(PROF_ROGUE_CA, 'gun', 'g0', 'gun ring, port forward', 40, -0.72, 0.3),
      seatAt(PROF_ROGUE_CA, 'gun', 'g1', 'gun ring, starboard forward', 40, 0.72, 0.3),
      seatAt(PROF_ROGUE_CA, 'gun', 'g2', 'gun ring, port aft', 20, -0.72, 0.3),
      seatAt(PROF_ROGUE_CA, 'gun', 'g3', 'gun ring, starboard aft', 20, 0.72, 0.3),
    ],
    note: 'The widest hull on the board and the shortest of the big ones: two cross '
      + 'beams, eight clamps and berths for seventy. Four plasma is the whole '
      + 'battery, and it is still the fastest turning heavy in the game.',
  },

  // -------------------------------------------------------- Benefactor --
  //
  // Deep sectioned monitors, taller than they are wide at every rung. They
  // grow by CALIBRE and by belt rather than by count, and each one is the
  // slowest thing at its rung. The trade is that a cannon goes through a belt
  // and a beam does not.
  {
    classKey: 'benefactor_corvette', name: 'Benefactor Corvette',
    faction: 'benefactor', tier: 'corvette', rung: 'frigate',
    radius: 2.4, massMax: 0.45, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_BENEFACTOR_CV,
    spine: [keel(CY, 13, 49), keel(CY - 5, 14, 28, 4, 3),
      ...ribs(PROF_BENEFACTOR_CV, [18, 25, 32, 39, 45])],
    sockets: [
      ...suite(PROF_BENEFACTOR_CV, [[0, -0.1], [-0.55, 0.3], [0.55, 0.3]], 5, 2),
      seatAt(PROF_BENEFACTOR_CV, 'gun', 'g0', 'gun ring, nose', 42, 0, 0.4),
      seatAt(PROF_BENEFACTOR_CV, 'missile', 'm0', 'missile pad, ventral', 28, 0, -0.55),
    ],
    note: 'Deeper than it is wide, on a hull four metres long. One cannon and one '
      + 'cell, and belts thick enough that a corvette of anybody else’s cannot '
      + 'get through them inside a turn.',
  },
  {
    classKey: 'benefactor_destroyer', name: 'Benefactor Destroyer',
    faction: 'benefactor', tier: 'destroyer', rung: 'escort',
    radius: 5.7, massMax: 2.5, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_BENEFACTOR_DD,
    // A deep aft drop keel and a shallower dorsal one: the section is the
    // whole Benefactor idea and the spine says so from the inside.
    spine: [keel(CY, 4, 58), keel(CY - 8, 6, 26, 5, 5), keel(CY + 7, 6, 24, 5, 3),
      ...ribs(PROF_BENEFACTOR_DD, [11, 19, 27, 35, 43, 51])],
    sockets: [
      ...suite(PROF_BENEFACTOR_DD, [[0, -0.05], [-0.55, 0.28], [0.55, 0.28], [0, 0.55]], 11, 2),
      seatAt(PROF_BENEFACTOR_DD, 'gun', 'g0', 'gun ring, port', 38, -0.7, 0.24),
      seatAt(PROF_BENEFACTOR_DD, 'gun', 'g1', 'gun ring, starboard', 38, 0.7, 0.24),
      seatAt(PROF_BENEFACTOR_DD, 'gun', 'g2', 'gun ring, aft dorsal', 16, 0, 0.58),
      seatAt(PROF_BENEFACTOR_DD, 'missile', 'm0', 'missile pad, ventral', 28, 0, -0.6),
    ],
    note: 'Three cannon on a section deeper than it is wide, and two heavy bells '
      + 'doing the pushing. Slowest hull at its rung, and the one that does not care '
      + 'what is painted on the outside of a belt.',
  },
  {
    classKey: 'benefactor_cruiser', name: 'Benefactor Heavy Cruiser',
    faction: 'benefactor', tier: 'cruiser', rung: 'cruiser',
    radius: 7.9, massMax: 6.5, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    profile: PROF_BENEFACTOR_CA,
    spine: [keel(CY, 3, 60), keel(CY - 10, 6, 30, 6, 6), keel(CY + 8, 6, 28, 6, 4),
      ...ribs(PROF_BENEFACTOR_CA, [10, 18, 26, 34, 42, 50, 57])],
    sockets: [
      ...suite(PROF_BENEFACTOR_CA, [[0, -0.05], [-0.6, 0.25], [0.6, 0.25],
        [-0.35, 0.55], [0.35, 0.55]], 14, 4),
      seatAt(PROF_BENEFACTOR_CA, 'gun', 'g0', 'gun ring, port forward', 42, -0.72, 0.22),
      seatAt(PROF_BENEFACTOR_CA, 'gun', 'g1', 'gun ring, starboard forward', 42, 0.72, 0.22),
      seatAt(PROF_BENEFACTOR_CA, 'gun', 'g2', 'gun ring, port aft', 22, -0.72, 0.22),
      seatAt(PROF_BENEFACTOR_CA, 'gun', 'g3', 'gun ring, starboard aft', 22, 0.72, 0.22),
      seatAt(PROF_BENEFACTOR_CA, 'missile', 'm0', 'missile pad, forward', 38, 0, -0.6),
      seatAt(PROF_BENEFACTOR_CA, 'missile', 'm1', 'missile pad, aft', 27, 0, -0.6),
    ],
    note: 'Twelve cells to the keel and the heaviest berth in the game. Four cannon, '
      + 'two cells and six layers of belt, on a hull that comes about at under two '
      + 'degrees a second. Whatever it is pointed at, it stays pointed at.',
  },
];

/**
 * Seat a part inside the hull.
 *
 * Enclosed kinds are pulled toward the centreline until the part's own box is
 * inside the profile with a cell to spare for the plate over it. Exposed kinds
 * are left exactly where the frame put them.
 *
 * It is sized on the part actually being placed, not on the biggest part the
 * socket could take. Seating every bay as though it held a cargo hold pinned
 * all of them to the axis and stacked them: three of the Rogue's eight
 * barracks lost every one of their 140 cells to a bay already standing there.
 */
/**
 * Would a box of these half extents sit inside the hull at z?
 *
 * The corners are what has to be inside, not the centre. Testing the centre
 * let the nudge search walk a bay half out through the side of the ship and
 * still call it seated.
 */
export function boxInside(prof: readonly Station[], x: number, y: number, z: number,
  hx: number, hy: number, hz: number, inset = 1): boolean {
  let hw = Infinity, hh = Infinity;
  for (let k = Math.round(z - hz); k <= Math.round(z + hz); k++) {
    const st = hullAt(prof, k);
    hw = Math.min(hw, st[0] as number);
    hh = Math.min(hh, st[1] as number);
  }
  const a = Math.max(1, hw - inset), b = Math.max(1, hh - inset);
  const dx = (Math.abs(x - CX) + hx) / a, dy = (Math.abs(y - CY) + hy) / b;
  return dx * dx + dy * dy <= 1;
}

export function seatOf(frame: FrameDef, sock: Socket,
  v: { sx: number; sy: number; sz: number }): readonly [number, number, number] {
  const cx = sock.at[0] as number, cy = sock.at[1] as number, cz = sock.at[2] as number;
  if (isProud(sock.kind)) return [cx, cy, cz];
  const inset = seatInset(sock.kind);
  const prof = frame.profile;
  const hx = v.sx / 2, hy = v.sy / 2, hz = v.sz / 2;
  const z0 = Math.round((prof[0] as Station)[0]);
  const z1 = Math.round((prof[prof.length - 1] as Station)[0]);
  const k = Math.max(z0 + Math.ceil(hz), Math.min(z1 - Math.ceil(hz), Math.round(cz)));
  // The narrowest station the part spans, so a bay near the bow is judged on
  // the bow rather than on its own midpoint.
  let hw = Infinity, hh = Infinity;
  for (let z = Math.round(k - hz); z <= Math.round(k + hz); z++) {
    const st = hullAt(prof, z);
    hw = Math.min(hw, st[0] as number);
    hh = Math.min(hh, st[1] as number);
  }
  const a = Math.max(1, hw - inset), b = Math.max(1, hh - inset);
  let x = cx, y = cy;

  if (inset === 0) {
    // FLUSH: slide the part along whichever way it is facing until its outer
    // FACE lands on the hull line, and stop there. Pulling until the corners
    // are inside instead sinks it a cell or two, and the shell then closes
    // over the top of it: on the Freighter's four layer plating only 9 of an
    // attitude block's 108 cells still reached daylight, so the thrusters were
    // inside the ship.
    const onX = Math.abs(cx - CX) / Math.max(0.5, hw) >= Math.abs(cy - CY) / Math.max(0.5, hh);
    const s = onX ? (cx >= CX ? 1 : -1) : (cy >= CY ? 1 : -1);
    const face = onX ? hx : hy;
    const out = (t: number) => onX
      ? !insideHull(prof, x + s * t, y, k)
      : !insideHull(prof, x, y + s * t, k);
    for (let n = 0; n < 64; n++) {
      const proud = out(face - 0.5);          // the outer face is past the skin
      const sunk = !out(face + 0.5);          // there is still hull beyond it
      if (!proud && !sunk) break;
      const step = proud ? -s : s;
      if (onX) x += step; else y += step;
    }
    return [x, y, k];
  }

  const outside = () => {
    const dx = (Math.abs(x - CX) + hx) / a, dy = (Math.abs(y - CY) + hy) / b;
    return dx * dx + dy * dy > 1;
  };
  for (let n = 0; n < 64 && outside(); n++) {
    const dx = (Math.abs(x - CX) + hx) / a, dy = (Math.abs(y - CY) + hy) / b;
    const atX = Math.abs(x - CX) < 1, atY = Math.abs(y - CY) < 1;
    if (atX && atY) break;
    if ((dx >= dy && !atX) || atY) x += x > CX ? -1 : 1;
    else y += y > CY ? -1 : 1;
  }
  return [x, y, k];
}

const seated = new Map<string, FrameDef>();

export const frameFor = (classKey: string): FrameDef => {
  const hit = seated.get(classKey);
  if (hit) return hit;
  const f = FRAMES.find(x => x.classKey === classKey) ?? (FRAMES[0] as FrameDef);
  seated.set(classKey, f);
  return f;
};

/**
 * The sockets a design actually offers, which is the frame's own plus one
 * trunnion for every barbette standing on it.
 *
 * This is why the base and the barrel are separate parts. A gun ring takes a
 * barbette; the barbette is what takes the damage and what turns; and the gun
 * goes on its trunnion. A player cannot hang a beam on bare structure.
 */
export function socketsOf(frame: FrameDef, parts: readonly Placement[]): Socket[] {
  const out: Socket[] = [...frame.sockets];
  for (const p of parts) {
    if (p.module !== 'WPN-BB1') continue;
    const base = frame.sockets.find(s => s.id === p.socket);
    if (!base) continue;
    out.push({
      id: `${base.id}/t`, kind: 'trunnion', label: `${base.label}, trunnion`,
      at: [base.at[0], base.at[1] + 2, base.at[2]],
    });
  }
  return out;
}

// --------------------------------------------------------------- armour --

/** The nine faces a player plates, each 0 to 15 layers. */
export const SECTIONS = ['bow', 'stern', 'port', 'starboard', 'dorsal',
  'ventral', 'beltFwd', 'beltMid', 'beltAft'] as const;
export type SectionKey = typeof SECTIONS[number];
export type Sections = Record<SectionKey, number>;

export const zeroSections = (): Sections =>
  Object.fromEntries(SECTIONS.map(s => [s, 0])) as Sections;

// --------------------------------------------------------------- design --

export interface Placement {
  readonly socket: string;
  readonly module: string;
  /**
   * Quarter turns about the ship's up axis, 0 to 3.
   *
   * A turret is on a swivel, so which way it faces on its ring is the
   * player's, not the frame's. It snaps to 90 degrees because the part is a
   * volume of cells and a cell grid has four orientations that are still the
   * same volume: anything between them would have to resample the part, and a
   * resampled part is back to fractions of a cell and the slop that came with
   * them. Placeable and rotatable, never editable.
   */
  readonly rot?: number;
}

/**
 * How the exterior is built.
 *
 * `wrapped` is the class hull: plate laid on the frame's own profile, which
 * is what a premade ship ships with and what a player is modifying when they
 * pull a section slider.
 *
 * `skin` is the exterior redone from scratch: plate hugging whatever is
 * actually bolted on, and nothing else. It is lighter, it is uglier, and it
 * leaves the gaps between parts open, which is the trade a player is making.
 *
 * The frame is not in either list. It cannot be edited in either mode.
 */
export type ArmourMode = 'wrapped' | 'skin';

export interface Design {
  classKey: string;
  /** One entry per filled socket. A socket holds at most one part. */
  parts: Placement[];
  sections: Sections;
  /** Which exterior the plate sliders are building. */
  armour: ArmourMode;
  /**
   * Hand drawn armour, as cell indices, ON TOP of whatever the mode built.
   *
   * Two lists rather than one replacing the shell, because the useful thing a
   * player wants is rarely a hull drawn from nothing: it is the class hull
   * with a sponson added here and a hangar mouth cut there. `plate` fills
   * empty cells, `cut` removes plate the generator laid. Neither can touch the
   * frame or a part: those are not armour and are not editable.
   */
  plate?: number[];
  cut?: number[];
  /** Which faction's swatches the paint bucket offers. */
  faction: string;
  /** Armour tint. Cosmetic only: never hashed, never sent to the core. */
  paint: number;
  /**
   * What the armour is MADE of, as a finish key.
   *
   * Presentation, like `paint`, and for the same reason: it changes how a hull
   * is lit and nothing about what happens. It is not passed to the core and
   * not in the state hash, so two seats that disagreed about whether a hull is
   * riveted or ablative still resolve the same turn to the same number.
   *
   * Optional so every design that predates it still loads, and an absent one
   * means the default.
   */
  finish?: string;
  /**
   * A finish per PALETTE SLOT, by index into the faction's eight swatches.
   *
   * The colour a player picks and the surface it wears are one decision, not
   * two: a pale grey that is meant to be a composite panel and a pale grey
   * that is meant to be bare rolled steel are different ships. So a slot
   * carries both, and picking the swatch picks the finish with it.
   *
   * Sparse and optional on purpose. An entry that is absent falls back to
   * `finish`, which is the hull wide choice and what every design that
   * predates this already has, so nothing has to be migrated.
   */
  slotFinish?: (string | null)[];
  /**
   * What the FRAME and the fitted PARTS are made of.
   *
   * The two surfaces that are not armour and were never choosable: the frame
   * was drawn in the plating's own finish, and every part in one hard coded
   * greeble. They are the inside of the ship, which is exactly what a hole in
   * the plating now shows, so they are worth being able to author.
   */
  frameFinish?: string;
  partFinish?: string;
  /** How metallic and how rough that armour is, 0 to 1. Presentation. */
  metal?: number;
  rough?: number;
}

// ============================================================= THE SEAM ==
//
// EVERYTHING BELOW THIS LINE MOVES TO RUST.
//
// This is the one function that turns a design into numbers, and it is the
// only place in the client where a derived number is produced. The editor
// prints what it returns and works nothing out for itself, so the day this
// becomes `ft_read_design(ship)` the change is one call site, not a hunt.
//
// It sums in integers on purpose, because f32 addition is not associative:
// the same armour cells summed in two legal orders give two masses, two
// accel_fwd values and a hash split on turn zero.
// ==========================================================================

export interface Check {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface Mount {
  readonly key: 'beam' | 'projectile' | 'missile';
  readonly n: number;
}

export interface Derived {
  readonly cells: number;
  readonly plateCells: number;
  readonly enclosed: number;
  readonly massUM: number;
  readonly mass: number;
  readonly massMax: number;
  readonly hull: number;
  readonly radius: number;
  /** The boxes turrets keep clear, in placement order. */
  readonly turrets: readonly TurretBox[];
  /** Cells inside a turret box that something else is standing in. Zero on
   *  anything this rasteriser built; above zero means a part was placed into
   *  one, or a design saved before the rule came in. */
  readonly fouled: number;
  readonly extent: readonly [number, number, number];
  readonly accelFwd: number;
  readonly accelRetro: number;
  readonly accelLat: number;
  readonly maxSpeed: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly reachU: number;
  readonly marines: number;
  readonly capacity: number;
  readonly boardingRange: number;
  readonly mounts: readonly Mount[];
  readonly belt: number;
  readonly checks: readonly Check[];
  readonly legal: boolean;
  readonly parts: number;
}

/**
 * Mass in uM per cell of plate, and hull in milli HP per cell of plate.
 *
 * Refitted when plate stopped being a box area formula and started being the
 * cells actually laid: the wrapped shell is a curved skin rather than six
 * rectangles, so it costs different cells and the density had to follow. The
 * pair is a least squares fit against the five authored stock masses and
 * hulls over the allowed layer configurations: 5.7 percent rms, worst case
 * the Rogue at 8.8 percent on mass, and every class still legal.
 */
/* What a cell of plate costs and gives, how a bigger rung scales it, and how
 * long a turn is, all used to live here. They are the core's now
 * (`design.rs`), along with the arithmetic that read them: this file measures
 * the picture and the core says what the picture weighs. */

/**
 * The whole ship as one occupancy grid: frame, parts and plate.
 *
 * ONE rasterisation, read by everybody. It used to be two: the editor drew a
 * grid and `derive()` costed plate from a box area formula, so the picture and
 * the mass were two opinions about the same armour and only one of them could
 * be right. Divergent paths for like functionality are a defect (GUIDELINES
 * 5.1), and the defect here is that a player who rebuilds an exterior would be
 * charged for one they did not build.
 *
 * First writer wins, in this order: frame, then parts, then plate. That is
 * what makes the frame impossible to edit and what stops two solids sharing a
 * cell, which is what removed the z fighting.
 */
/**
 * The box a turret occupies, which is illegal placement for anything else.
 *
 * A turret swivels: it is not a shape that armour may be packed around cell by
 * cell, it is a volume it has to keep clear. The generated exterior carves
 * round these, the pencil refuses a cell inside one, and a design that arrives
 * with something in one (an older save, a part nudged into one) is illegal
 * rather than quietly rebuilt, because moving a player's parts for them is
 * worse than telling them.
 */
export interface TurretBox {
  /** Placement index, so the offender can be named. */
  readonly part: number;
  readonly i0: number; readonly i1: number;
  readonly j0: number; readonly j1: number;
  readonly k0: number; readonly k1: number;
}

/** Is this cell inside a turret's box? One implementation, because the pencil,
 *  the picture and the gate all have to agree about where a turret is. */
export function inTurret(turrets: readonly TurretBox[], i: number, j: number, k: number): boolean {
  for (const t of turrets) {
    if (i >= t.i0 && i <= t.i1 && j >= t.j0 && j <= t.j1 && k >= t.k0 && k <= t.k1) return true;
  }
  return false;
}

export interface Raster {
  /** One material per cell, x fastest then y then z. */
  readonly grid: Uint8Array;
  /** One purpose code per cell, which is what colours it. */
  readonly purp: Uint8Array;
  /** Which placement owns a cell, one based. Zero is frame or plate. */
  readonly own: Int16Array;
  readonly plateCells: number;
  readonly solidCells: number;
  /** Cells of an ENCLOSED part that ended up outside the hull line. Should be
   *  zero: mounts live inside the frame, and only drives, retros, attitude
   *  thrusters, gun rings and trunnions are allowed to stand proud of it. */
  readonly enclosedOutside: number;
  /** How far past the hull line the worst cell of a FLUSH part sits, in cells.
   *  A flat block set into a curved hull leaves its corners a fraction proud,
   *  which is what a recessed thruster looks like; a whole block standing off
   *  the flank on a pylon is what this number is here to catch. */
  readonly flushProud: number;
  /** The boxes turrets keep clear, in placement order. */
  readonly turrets: readonly TurretBox[];
  /** Cells inside a turret box that something else is standing in. Zero on
   *  anything this rasteriser built; above zero means a part was placed into
   *  one, or a design saved before the rule came in. */
  readonly fouled: number;
  readonly extent: readonly [number, number, number];
  /** The true bounding sphere, in cells, about the hull's own centre.
   *  A box diagonal is not one: it measures corners a long thin ship has
   *  nothing in, and it failed every frigate on a gate they actually pass. */
  readonly radiusCells: number;
}

const idx3 = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

/** A cell's index, and back again. The wire format for hand drawn armour. */
export const cellIndex = (i: number, j: number, k: number): number => idx3(i, j, k);
export const cellAt = (n: number): readonly [number, number, number] =>
  [n % NX, ((n / NX) | 0) % NY, (n / (NX * NY)) | 0];

/** How many cells a player may draw. A frigate's whole skin is about 5,000,
 *  so this is room to work in, not a target, and it is what keeps a design
 *  record inside the library's 64 KB. */
export const DRAWN_MAX = 20000;

/** A design's identity for caching. Paint is not in it: the raster does not
 *  depend on it, and anything that draws colour keys on this plus the paint. */
export const rasterSig = (d: Design): string =>
  d.classKey + '|' + d.armour + '|'
  + d.parts.map(p => p.socket + ':' + p.module + ':' + (p.rot ?? 0)).sort().join(',') + '|'
  + SECTIONS.map(k => d.sections[k]).join(',') + '|'
  // A length and a sum: cheap, and it changes whenever a cell does. The cache
  // is a frame's worth of work, not a correctness boundary.
  + drawSig(d.plate) + '/' + drawSig(d.cut);

const drawSig = (list: readonly number[] | undefined): string => {
  if (!list || !list.length) return '0';
  let sum = 0;
  for (const n of list) sum = (sum + n * 2654435761) >>> 0;
  return `${list.length}.${sum}`;
};

/** A cache of one. `derive()` and the renderer ask for the same design back to
 *  back, and rasterising it twice per keystroke is the whole cost. */
let rasterCache: { sig: string; raster: Raster } | null = null;

/**
 * Where to look for room, in order, when a seated part lands on another one.
 *
 * Nearest first by city block distance, then a fixed tiebreak, so the search
 * is the same search on both seats and the same after a reload. Bounded at
 * six cells: past that the part is not near its socket any more and the honest
 * answer is that the frame is full.
 */
const NUDGE: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<readonly [number, number, number]> = [];
  for (let dz = -6; dz <= 6; dz++) for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
    if (d === 0 || d > 6) continue;
    out.push([dx, dy, dz] as const);
  }
  out.sort((a, b) => {
    const da = Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]);
    const db = Math.abs(b[0]) + Math.abs(b[1]) + Math.abs(b[2]);
    return da - db || a[2] - b[2] || a[1] - b[1] || a[0] - b[0];
  });
  return out;
})();

/**
 * The same lattice with the armour taken off.
 *
 * A plate cell simply is not there, so a flood fill runs through where it was
 * and a mesher meshes the frame and the parts against the outside. A `Skinned`
 * cell goes back to being the frame member it always was, because that is what
 * it is once the shell it was standing in has gone.
 *
 * One definition, because three pictures now want it: the editor's plate
 * toggle, the schematic's, and the wound that has to agree with whichever of
 * them is on screen. A copy rather than a mutation, since `rasterise` caches
 * and zeroing its grid in place would take the plate off every other reader.
 */
export function bareGrid(grid: Uint8Array): Uint8Array {
  const out = Uint8Array.from(grid);
  for (let n = 0; n < out.length; n++) {
    const m = out[n] as number;
    if (m === Mat.Plate) out[n] = Mat.Empty;
    else if (m === Mat.Skinned) out[n] = Mat.Frame;
  }
  return out;
}

/**
 * Which placement a lattice cell belongs to, and what that placement is.
 *
 * The picture IS the grid, so naming what is under a pointer is this lookup
 * and not a guess. Here rather than beside each caller: the map's tooltip and
 * the schematic's card ask the same question about the same cells, and two
 * copies would be two names for one part the first time either was tuned.
 * Plate and frame belong to no placement and answer null; they are the hull.
 */
export function partAtCell(
  d: Design, cell: number,
): { index: number; part: Placement; module: ModuleDef } | null {
  const owner = rasterise(d).own[cell] ?? 0;
  if (owner <= 0) return null;
  const part = d.parts[owner - 1];
  if (!part) return null;
  const module = moduleById(part.module);
  return module ? { index: owner - 1, part, module } : null;
}

export function rasterise(d: Design): Raster {
  const sig = rasterSig(d);
  if (rasterCache && rasterCache.sig === sig) return rasterCache.raster;

  const frame = frameFor(d.classKey);
  const prof = frame.profile;
  const grid = new Uint8Array(CELLS);
  const purp = new Uint8Array(CELLS);
  // Which placement owns a cell, one based, so a click on the picture can name
  // the part it landed on. Zero is frame or plate.
  const own = new Int16Array(CELLS);
  const inBounds = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ;
  /** Writes the cell if it is free. Returns whether it took it, because the
   *  owner map must never claim a cell another part is already standing in. */
  const set = (i: number, j: number, k: number, mat: number, code: number): boolean => {
    if (!mat || !inBounds(i, j, k)) return false;
    const n = idx3(i, j, k);
    if (grid[n]) return false;
    grid[n] = mat;
    purp[n] = code;
    return true;
  };

  const STRUCT = purposeCode('structure');

  // --- the frame, which the player cannot edit --------------------------
  for (const [x, y, z, w, h, l] of frame.spine)
    for (let k = 0; k < l; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
      set(Math.round(x) + i, Math.round(y) + j, Math.round(z) + k, Mat.Frame, STRUCT);

  // --- every fitted part, on whole cells, carrying its purpose ----------
  const allSockets = socketsOf(frame, d.parts);
  // Cells of a part that stand outboard of the hull line. They get a pylon
  // back to it below, because a pod hanging in space beside its own ship is
  // exactly the slop that voxels were supposed to end.
  const outboard: number[] = [];
  /** The boxes turrets sweep, which nothing else may occupy. */
  const turrets: TurretBox[] = [];
  let enclosedOutside = 0, flushProud = 0;
  // Guns first, then everything else.
  //
  // A turret's box is its own, and a box only exists once the turret is
  // placed: seating a bay before the gun beside it means the gun arrives to
  // find the box already occupied, and the design is illegal with no legal
  // move left, because parts are fitted rather than dragged. Placing the
  // turrets first makes that unreachable rather than merely unlikely.
  const isGun = (n: number) => !!moduleById((d.parts[n] as Placement).module)?.weapon;
  const every = d.parts.map((_, n) => n);
  const order = [...every.filter(isGun), ...every.filter(n => !isGun(n))];
  const reserved = new Uint8Array(CELLS);
  for (const pi of order) {
    const p = d.parts[pi] as Placement;
    const sock = allSockets.find(k => k.id === p.socket);
    const m = moduleById(p.module);
    if (!sock || !m) continue;
    const v = rotatedVoxels(m, p.rot ?? 0);
    const code = purposeCode(m.purpose);
    const seat = seatOf(frame, sock, v);
    // The PIVOT lands on the socket, not the box centre.
    const pv = rotatedPivot(m, p.rot ?? 0);
    const bx = Math.round((seat[0] as number) - ((pv[0] as number) + 0.5));
    const by = Math.round((seat[1] as number) - ((pv[1] as number) + 0.5));
    const bz = Math.round((seat[2] as number) - ((pv[2] as number) + 0.5));

    // How many of the part's cells another part is already standing in, and a
    // cell inside a turret's box counts, so the nudge walks out of one rather
    // than settling in it.
    const lossAt = (ox: number, oy: number, oz: number): number => {
      let lost = 0;
      for (let k = 0; k < v.sz; k++) for (let j = 0; j < v.sy; j++) for (let i = 0; i < v.sx; i++) {
        if (!v.data[i + j * v.sx + k * v.sx * v.sy]) continue;
        const x = ox + i, y = oy + j, z = oz + k;
        if (!inBounds(x, y, z)) { lost++; continue; }
        const n = idx3(x, y, z);
        const at = grid[n] as number;
        if ((at && at !== Mat.Frame) || reserved[n]) lost++;
      }
      return lost;
    };

    // Nudge until it actually fits. Seating pulls parts toward the centreline,
    // and a frame that authored six clamps along a flank pulls all six onto
    // the same cells: five of the Rogue's lost every cell they had and the
    // ship claimed boarding gear it did not visibly carry. The search is
    // bounded and ordered, so it is the same nudge on both seats.
    let ox = bx, oy = by, oz = bz, best = lossAt(bx, by, bz);
    if (best > 0) {
      for (const [dx, dy, dz] of NUDGE) {
        const tx = bx + dx, ty = by + dy, tz = bz + dz;
        if (exposureOf(sock.kind) === 'enclosed' && !boxInside(prof,
          tx + v.sx / 2, ty + v.sy / 2, tz + v.sz / 2, v.sx / 2, v.sy / 2, v.sz / 2)) continue;
        // (tx, ty, tz) is the box origin either way, so the box test is the
        // box test whatever the pivot is.
        const lost = lossAt(tx, ty, tz);
        if (lost < best) { best = lost; ox = tx; oy = ty; oz = tz; }
        if (best === 0) break;
      }
    }

    // A turret swivels, so its own volume belongs to it and to nothing else.
    // Recorded as the placed box rather than as its filled cells, because the
    // gaps in a gun (under the barrel, beside the base) are the gaps the shell
    // used to grow into, and a barrel buried in plate is exactly what a player
    // sees and calls broken.
    if (m.weapon) {
      const box: TurretBox = { part: pi,
        i0: ox, i1: ox + v.sx - 1, j0: oy, j1: oy + v.sy - 1, k0: oz, k1: oz + v.sz - 1 };
      turrets.push(box);
      for (let k = Math.max(0, box.k0); k <= Math.min(NZ - 1, box.k1); k++)
        for (let j = Math.max(0, box.j0); j <= Math.min(NY - 1, box.j1); j++)
          for (let i = Math.max(0, box.i0); i <= Math.min(NX - 1, box.i1); i++)
            reserved[idx3(i, j, k)] = 1;
    }

    // A part mounts THROUGH the frame, so it takes a rib cell if it needs one.
    // Strict first writer wins ate whole parts here: a two cell RCS quad
    // landing on the Rogue's rib ring wrote nothing at all and the ship showed
    // no attitude thrusters on that quarter. It still never takes another part's
    // cell, which is what the nudge above is for.
    for (let k = 0; k < v.sz; k++) for (let j = 0; j < v.sy; j++) for (let i = 0; i < v.sx; i++) {
      const mat = v.data[i + j * v.sx + k * v.sx * v.sy] as number;
      if (!mat) continue;
      const x = ox + i, y = oy + j, z = oz + k;
      if (!inBounds(x, y, z)) continue;
      const n = idx3(x, y, z);
      if (grid[n] && grid[n] !== Mat.Frame) continue;
      grid[n] = mat;
      purp[n] = code;
      own[n] = pi + 1;
      if (!insideHull(prof, x, y, z)) {
        outboard.push(x, y, z);
        const ex = exposureOf(sock.kind);
        if (ex === 'enclosed') enclosedOutside++;
        else if (ex === 'flush') {
          const st = hullAt(prof, z);
          const shw = st[0] as number, shh = st[1] as number;
          const ux = (x + 0.5 - CX) / shw, uy = (y + 0.5 - CY) / shh;
          const past = (Math.sqrt(ux * ux + uy * uy) - 1) * Math.min(shw, shh);
          if (past > flushProud) flushProud = past;
        }
      }
    }
  }

  // `reserved` is now every turret's box, filled as each one was placed. It is
  // read by every pass that lays armour below: a flag rather than a test per
  // writer, because there are five places that write plate and the one that
  // forgot would be the one nobody noticed.

  // --- plate --------------------------------------------------------------
  const sec = d.sections;
  const z0 = Math.max(0, Math.round((prof[0] as Station)[0]));
  const z1 = Math.min(NZ - 1, Math.round((prof[prof.length - 1] as Station)[0]));
  /** Which belt band a station falls in, so fore, midships and aft still mean
   *  something once the hull is a curve rather than a box. */
  const band = (k: number): SectionKey => {
    const t = (k - z0) / Math.max(1, z1 - z0);
    return t > 0.66 ? 'beltFwd' : t > 0.33 ? 'beltMid' : 'beltAft';
  };

  if (d.armour === 'wrapped') {
    // The class hull: plate laid on the frame's own profile, so a premade ship
    // has a silhouette rather than a bounding box. A cell is skin if it is
    // inside the hull line and NOT inside the same line drawn in by that
    // face's layer count, which is a shell of exactly that thickness.
    // The station's half extents are read once per k and the ellipse tested
    // inline, because reading them per cell is 55,000 profile walks a frame
    // and a slider fires on every pixel of a drag.
    for (let k = z0; k <= z1; k++) {
      const st = hullAt(prof, k);
      const hw = st[0] as number, hh = st[1] as number;
      const band_k = band(k);
      const i0 = Math.max(0, Math.ceil(CX - hw)), i1 = Math.min(NX - 1, Math.floor(CX + hw));
      const j0 = Math.max(0, Math.ceil(CY - hh)), j1 = Math.min(NY - 1, Math.floor(CY + hh));
      for (let j = j0; j <= j1; j++) {
        const dy = (j + 0.5 - CY) / hh;
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5 - CX) / hw;
          if (dx * dx + dy * dy > 1) continue;
          const side: SectionKey = Math.abs(dy) > Math.abs(dx)
            ? (dy > 0 ? 'dorsal' : 'ventral') : band_k;
          const L = sec[side] ?? 0;
          if (L <= 0) continue;
          const a = Math.max(0.5, hw - L), b = Math.max(0.5, hh - L);
          const ux = (i + 0.5 - CX) / a, uy = (j + 0.5 - CY) / b;
          if (ux * ux + uy * uy <= 1) continue;
          const n = idx3(i, j, k);
          if (reserved[n]) continue;
          if (grid[n] === Mat.Frame) grid[n] = Mat.Skinned;
          else set(i, j, k, Mat.Plate, STRUCT);
        }
      }
    }
    // The caps. Without them the hull is a tube open at both ends, and the
    // stern is where the drive plate lives.
    const cap = (k: number) => {
      if (k < 0 || k >= NZ) return;
      const st = hullAt(prof, k);
      const hw = st[0] as number, hh = st[1] as number;
      const i0 = Math.max(0, Math.ceil(CX - hw)), i1 = Math.min(NX - 1, Math.floor(CX + hw));
      const j0 = Math.max(0, Math.ceil(CY - hh)), j1 = Math.min(NY - 1, Math.floor(CY + hh));
      for (let j = j0; j <= j1; j++) {
        const dy = (j + 0.5 - CY) / hh;
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5 - CX) / hw;
          if (dx * dx + dy * dy > 1) continue;
          const n = idx3(i, j, k);
          if (reserved[n]) continue;
          if (grid[n] === Mat.Frame) grid[n] = Mat.Skinned;
          else set(i, j, k, Mat.Plate, STRUCT);
        }
      }
    };
    for (let t = 0; t < (sec.stern ?? 0); t++) cap(z0 + t);
    for (let t = 0; t < (sec.bow ?? 0); t++) cap(z1 - t);

    // And cover whatever frame is still bare to the outside.
    //
    // The shell is an ellipse and a spar is a box, so a stringer riding a
    // fraction of a cell proud of that ellipse is outside it and keeps the
    // cell: the Karisen's dorsal stringer and ventral keel beam ran the whole
    // length of a fully plated hull as two grey planks, 915 bare cells of
    // them. A skin covers its own ribs, including the ones that stick out.
    for (let n = 0; n < CELLS; n++) {
      if (grid[n] !== Mat.Frame || reserved[n]) continue;
      const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
      const exposed =
        i === 0 || !grid[n - 1] || i === NX - 1 || !grid[n + 1] ||
        j === 0 || !grid[n - NX] || j === NY - 1 || !grid[n + NX] ||
        k === 0 || !grid[n - NX * NY] || k === NZ - 1 || !grid[n + NX * NY];
      if (!exposed) continue;
      const st = hullAt(prof, k);
      const dx = (i + 0.5 - CX) / (st[0] as number), dy = (j + 0.5 - CY) / (st[1] as number);
      const side: SectionKey = Math.abs(dy) > Math.abs(dx)
        ? (dy > 0 ? 'dorsal' : 'ventral') : band(k);
      if ((sec[side] ?? 0) > 0) grid[n] = Mat.Skinned;
    }
  } else {
    // The exterior rebuilt from scratch: plate hugging what is actually
    // bolted on, one step per layer per direction. It follows the parts
    // instead of the class, which is the point of choosing it.
    const seed: number[] = [];
    for (let n = 0; n < CELLS; n++)
      if (grid[n]) seed.push(n % NX, ((n / NX) | 0) % NY, (n / (NX * NY)) | 0);
    const DIRS: ReadonlyArray<readonly [number, number, number, SectionKey | 'belt']> = [
      [1, 0, 0, 'belt'], [-1, 0, 0, 'belt'],
      [0, 1, 0, 'dorsal'], [0, -1, 0, 'ventral'],
      [0, 0, 1, 'bow'], [0, 0, -1, 'stern'],
    ];
    for (const [dx, dy, dz, which] of DIRS) {
      for (let n = 0; n < seed.length; n += 3) {
        const i = seed[n] as number, j = seed[n + 1] as number, k = seed[n + 2] as number;
        const layers = which === 'belt' ? (sec[band(k)] ?? 0) : (sec[which] ?? 0);
        for (let t = 1; t <= layers; t++) {
          const x = i + dx * t, y = j + dy * t, z = k + dz * t;
          if (!inBounds(x, y, z)) break;
          const n = idx3(x, y, z);
          if (reserved[n]) break;
          const at = grid[n] as number;
          if (at && at !== Mat.Plate) break;
          set(x, y, z, Mat.Plate, STRUCT);
        }
      }
    }
  }

  // --- pylons, so nothing floats ----------------------------------------
  // Every outboard cell walks back toward the axis on whichever side it is
  // furthest out, filling empty cells until it meets the ship. An RCS block
  // ten cells off the centreline on a hull seven cells wide is attached to
  // something now, in both modes and whatever the layer counts are.
  for (let n = 0; n < outboard.length; n += 3) {
    const i = outboard[n] as number, j = outboard[n + 1] as number, k = outboard[n + 2] as number;
    if (k < z0 || k > z1) continue;
    const st = hullAt(prof, k);
    const hw = st[0] as number, hh = st[1] as number;
    // A staircase toward the centreline, taking whichever axis is furthest
    // out. Marching one axis only never arrives when the cell is outboard on
    // BOTH: a gun overhanging the Rogue's bow walked its pylon straight down
    // past the keel and out of the bottom of the lattice, because no cell on
    // that column was ever inside the ellipse.
    let x = i, y = j;
    for (let t = 0; t < NX + NY; t++) {
      const ux = (x + 0.5 - CX) / hw, uy = (y + 0.5 - CY) / hh;
      if (Math.abs(ux) >= Math.abs(uy)) x += ux > 0 ? -1 : 1;
      else y += uy > 0 ? -1 : 1;
      if (!inBounds(x, y, k)) break;
      if (grid[idx3(x, y, k)]) break;          // met the ship: attached
      if (reserved[idx3(x, y, k)]) break;      // met a turret, which is also the ship
      set(x, y, k, Mat.Plate, STRUCT);
      const vx = (x + 0.5 - CX) / hw, vy = (y + 0.5 - CY) / hh;
      if (vx * vx + vy * vy <= 1) break;       // reached the hull line
    }
  }

  // --- hand drawn armour, last, over the top of everything ----------------
  // Cut first, then fill, so a player who cuts a mouth and lines it in one
  // pass gets what they drew rather than what the order happened to be.
  //
  // Neither list can touch the frame or a part. Armour is the only thing on
  // the ship a player edits; the rest is the class and the fitting, and both
  // of those are placed, not drawn.
  for (const n of d.cut ?? []) {
    if (n < 0 || n >= CELLS) continue;
    const at = grid[n] as number;
    if (at === Mat.Plate) { grid[n] = Mat.Empty; purp[n] = 0; }
    else if (at === Mat.Skinned) grid[n] = Mat.Frame;
  }
  for (const n of d.plate ?? []) {
    if (n < 0 || n >= CELLS || grid[n] || reserved[n]) continue;
    grid[n] = Mat.Plate;
    purp[n] = STRUCT;
  }

  // --- what came out ------------------------------------------------------
  let plateCells = 0;
  let loX = NX, loY = NY, loZ = NZ, hiX = -1, hiY = -1, hiZ = -1;
  const cells: number[] = [];
  // Walked linearly and unpacked only where a cell is filled. Indexing three
  // nested loops through idx3 cost most of the pass, and a slider drag pays
  // for this one on every pixel.
  for (let n = 0; n < CELLS; n++) {
    const mat = grid[n] as number;
    if (!mat) continue;
    const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
    cells.push(i, j, k);
    // A skinned frame member is the FRAME wearing the shell, not another cell
    // of armour. The shell's own cells are counted where the shell is; charging
    // the coat as well would bill one volume twice, and it billed the Rogue
    // hardest, which is the class with the least plate to hide it in.
    if (mat === Mat.Plate) plateCells++;
    if (i < loX) loX = i; if (i > hiX) hiX = i;
    if (j < loY) loY = j; if (j > hiY) hiY = j;
    if (k < loZ) loZ = k; if (k > hiZ) hiZ = k;
  }
  const extent = [
    Math.max(1, hiX - loX + 1), Math.max(1, hiY - loY + 1), Math.max(1, hiZ - loZ + 1),
  ] as [number, number, number];

  // The sphere the collision gate actually asks about: furthest cell corner
  // from the hull's own centre, not the diagonal of a box drawn round it.
  const mx = (loX + hiX + 1) / 2, my = (loY + hiY + 1) / 2, mz = (loZ + hiZ + 1) / 2;
  let r2 = 0;
  for (let n = 0; n < cells.length; n += 3) {
    const dx = Math.abs((cells[n] as number) + 0.5 - mx) + 0.5;
    const dy = Math.abs((cells[n + 1] as number) + 0.5 - my) + 0.5;
    const dz = Math.abs((cells[n + 2] as number) + 0.5 - mz) + 0.5;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) r2 = d2;
  }

  // What is standing in a turret's box that should not be. The passes above
  // carve round them, so anything here came in with the design: a part nudged
  // into one, or a save made before the rule existed.
  let fouled = 0;
  for (const t of turrets) {
    for (let k = Math.max(0, t.k0); k <= Math.min(NZ - 1, t.k1); k++)
      for (let j = Math.max(0, t.j0); j <= Math.min(NY - 1, t.j1); j++)
        for (let i = Math.max(0, t.i0); i <= Math.min(NX - 1, t.i1); i++) {
          const n = idx3(i, j, k);
          if (!grid[n]) continue;
          const owner = own[n] as number;
          if (owner === t.part + 1) continue;          // the turret itself
          if (grid[n] === Mat.Frame) continue;         // it is bolted to the frame
          fouled++;
        }
  }

  const raster: Raster = { grid, purp, own, plateCells, solidCells: cells.length / 3,
    enclosedOutside, flushProud, turrets, fouled, extent, radiusCells: Math.sqrt(r2) };
  rasterCache = { sig, raster };
  return raster;
}

/**
 * Every gun a design carries, and where it sits in SHIP units.
 *
 * A measurement of the picture, like the plate count: which socket a gun was
 * fitted to is the design, and turning a cell into a position is the same
 * arithmetic the renderer uses to draw the turret there. What the position
 * MEANS, which is the arc it fires through and the range it reaches, is the
 * core's and stays there.
 */
export function mountsOf(d: Design): Array<{ key: string; at: [number, number, number] }> {
  const frame = frameFor(d.classKey);
  const cell = RUNG[frame.rung];
  const socks = socketsOf(frame, d.parts);
  const out: Array<{ key: string; at: [number, number, number] }> = [];
  for (const p of d.parts) {
    const m = moduleById(p.module);
    if (!m?.weapon) continue;
    const sock = socks.find(k => k.id === p.socket);
    if (!sock) continue;
    out.push({
      key: m.weapon,
      at: [
        ((sock.at[0] as number) - NX / 2) * cell,
        ((sock.at[1] as number) - NY / 2) * cell,
        ((sock.at[2] as number) - NZ / 2) * cell,
      ],
    });
  }
  return out;
}

/**
 * The arc mask grid, mirroring `sim_core::math`.
 *
 * 64 steps of yaw by 32 of pitch, which is 5.625 degrees a cell and 2048 bits
 * a mount. Duplicated here for the same reason the scratch slot offsets are:
 * it is a contract, and the two sides move together.
 */
export const ARC_YAW = 64;
export const ARC_PITCH = 32;
export const ARC_WORDS = (ARC_YAW * ARC_PITCH) / 32;

/**
 * Which way each mask cell points, in the ship's frame, asked of the core once.
 *
 * NOT computed here. The cells are the mask's own geometry and the resolver
 * reads them back with `atan2`, so a client that built these angles out of its
 * platform's `sin` would set a different bit on the boundary from the client
 * across the table and desync over a shot one seat allowed. `design.ts` calls
 * no transcendental at all, and this is why it can stay that way.
 */
export type CoreArcDirs = () => Float32Array | null;
export type CoreArcBit = (x: number, y: number, z: number) => number;
let coreArcDirs: CoreArcDirs | null = null;
let coreArcBit: CoreArcBit | null = null;
export function useArcDirs(fn: CoreArcDirs, bit: CoreArcBit): void {
  coreArcDirs = fn; coreArcBit = bit; arcDirs = null; arcCache = null;
}
let arcDirs: Float32Array | null = null;

/** Is this direction blocked for this mount? The bit the core would read, off
 *  the mask the client scanned. The shipyard draws with it, which is why it is
 *  here and not a second `atan2` next to the renderer. */
export function arcBlocked(mask: Uint32Array, x: number, y: number, z: number): boolean {
  if (!coreArcBit) return false;
  const bit = coreArcBit(x, y, z);
  return (((mask[bit >>> 5] ?? 0) >>> (bit & 31)) & 1) !== 0;
}

/** The scan is only as good as the directions, so a client with no core wired
 *  scans nothing rather than scanning a guess. */
const dirs = (): Float32Array | null => {
  if (!arcDirs && coreArcDirs) arcDirs = coreArcDirs();
  return arcDirs;
};

/**
 * Where a design's own hull stops each of its turrets.
 *
 * One mask per gun, in `mountsOf` order, a set bit meaning blocked. A turret
 * here is omnidirectional: beams, cannons and missiles all traverse freely,
 * and the only thing that stops one is the ship it is bolted to. Which
 * directions those are is not a number anybody can author, because the hull is
 * whatever the player built, so it is MEASURED off the same voxels that were
 * drawn, the way the plate count is. What a blocked direction MEANS, which is
 * whether the shot is legal, stays in the core.
 *
 * The ray leaves the socket the gun was fitted to, which is where the resolver
 * fires from, and ignores the turret's own reserved box, which is the volume
 * it swivels in and cannot shoot itself with.
 */
export function arcMasks(d: Design): Uint32Array[] {
  const sig = rasterSig(d);
  if (arcCache && arcCache.sig === sig) return arcCache.masks;
  const table = dirs();
  const r = rasterise(d);
  const frame = frameFor(d.classKey);
  const socks = socketsOf(frame, d.parts);
  const masks: Uint32Array[] = [];
  for (let pi = 0; pi < d.parts.length; pi++) {
    const p = d.parts[pi] as Placement;
    const m = moduleById(p.module);
    if (!m?.weapon) continue;
    const sock = socks.find(k => k.id === p.socket);
    if (!sock) continue;
    const mask = new Uint32Array(ARC_WORDS);
    // Only what stands PROUD is scanned. A trunnion or a gun ring carries a
    // turret out on the hull and the hull is then in its way, which is the
    // whole point of this. A missile bay is enclosed by design: it sits inside
    // the ship and fires through its own doors, so line of sight from its
    // socket is blocked in every direction at once and scanning it would take
    // the launcher off two of the five stock frigates for a reason nobody
    // asked for. What a mount IS remains the core's; which of them have a hull
    // to see past is a fact about the picture, like the plate count.
    if (table && isProud(sock.kind)) {
      const box = r.turrets.find(t => t.part === pi);
      scanFrom(mask, table, r, pi + 1, box,
        (sock.at[0] as number) + 0.5, (sock.at[1] as number) + 0.5, (sock.at[2] as number) + 0.5);
    }
    masks.push(mask);
  }
  arcCache = { sig, masks };
  return masks;
}

/** A cache of one, on the same key the raster uses: the scan depends on the
 *  voxels and on nothing else, so it is stale exactly when they are. */
let arcCache: { sig: string; masks: Uint32Array[] } | null = null;

/**
 * March one ray per mask cell and set the bit where the hull is in the way.
 *
 * A voxel DDA (Amanatides and Woo): step to whichever axis boundary is nearer
 * and test the cell entered. Arithmetic and comparisons only, so two engines
 * running it agree bit for bit, which they must: the mask crosses into the
 * simulation and decides whether a shot is taken.
 */
function scanFrom(mask: Uint32Array, table: Float32Array, r: Raster, own: number,
  box: TurretBox | undefined, ox: number, oy: number, oz: number): void {
  const g = r.grid, owns = r.own;
  const cells = ARC_YAW * ARC_PITCH;
  for (let bit = 0; bit < cells; bit++) {
    const dx = table[bit * 3] as number;
    const dy = table[bit * 3 + 1] as number;
    const dz = table[bit * 3 + 2] as number;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    // A ray parallel to an axis never crosses that axis's boundaries, and
    // Infinity is exactly the right answer for "not before the others".
    const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(1 / dy);
    const tdz = dz === 0 ? Infinity : Math.abs(1 / dz);
    let tx = dx === 0 ? Infinity : ((dx > 0 ? x + 1 - ox : ox - x) / Math.abs(dx));
    let ty = dy === 0 ? Infinity : ((dy > 0 ? y + 1 - oy : oy - y) / Math.abs(dy));
    let tz = dz === 0 ? Infinity : ((dz > 0 ? z + 1 - oz : oz - z) / Math.abs(dz));
    for (;;) {
      if (tx <= ty && tx <= tz) { x += sx; tx += tdx; }
      else if (ty <= tz) { y += sy; ty += tdy; }
      else { z += sz; tz += tdz; }
      if (x < 0 || x >= NX || y < 0 || y >= NY || z < 0 || z >= NZ) break;  // out, clear
      const n = x + y * NX + z * NX * NY;
      if (!g[n]) continue;
      // Its own gun, and the box that gun swings in, are not in its way.
      if (owns[n] === own) continue;
      if (box && x >= box.i0 && x <= box.i1 && y >= box.j0 && y <= box.j1
        && z >= box.k0 && z <= box.k1) continue;
      mask[bit >>> 5] = ((mask[bit >>> 5] as number) | (1 << (bit & 31))) >>> 0;
      break;
    }
  }
}

/** The module indices a design is built from, in the core's own order. */
export function partsOf(d: Design): number[] {
  const out: number[] = [];
  for (const p of d.parts) {
    const at = MODULES.findIndex(m => m.id === p.module);
    if (at >= 0) out.push(at);
  }
  return out;
}

/**
 * Ask the core what a design IS.
 *
 * The rules moved. Mass, hull, the flight envelope and the seven gates are the
 * core's arithmetic now, because they decide outcomes and a rule that decides
 * outcomes cannot live in one of two clients (ADR-2). This function is what is
 * left: rasterise, which is the client MEASURING its own picture, then hand the
 * counts across and hand the answer back with labels on it.
 *
 * The wiring is explicit rather than imported so `design.ts` stays free of the
 * wasm module: the app hands it a derivation once, at boot, and there is no
 * second path to fall back to. A fallback would be the copy this deleted.
 */
export type CoreDerive = (
  classIdx: number,
  geo: { plateCells: number; ext: readonly [number, number, number];
    radiusCells: number; fouled: number },
  parts: readonly number[],
) => CoreStats | null;

/** The block the core writes back. Mirrors `DerivedStats` in `sim/wasm.ts`. */
export interface CoreStats {
  readonly mass: number; readonly hull: number; readonly radius: number;
  readonly accelFwd: number; readonly accelRetro: number; readonly accelLat: number;
  readonly maxSpeed: number; readonly yaw: number; readonly pitch: number;
  readonly reachU: number; readonly marines: number; readonly capacity: number;
  readonly boardingRange: number; readonly massMax: number; readonly parts: number;
  readonly guns: number; readonly trunnions: number; readonly gates: number;
}

let coreDerive: CoreDerive | null = null;
export function useCore(fn: CoreDerive): void { coreDerive = fn; }

/** One bit per gate, in the core's own order, with the words to say about it. */
const GATES: ReadonlyArray<readonly [string, string, string]> = [
  ['parts', 'something is fitted', 'nothing is fitted at all'],
  ['thrust', 'at least one drive', 'no drive fitted, so no thrust at all'],
  ['bridge', 'a bridge', 'every frame has a bay for exactly one'],
  ['arms', 'at least one gun', 'a frigate with no gun is not a warship'],
  ['mass', 'inside the berth', 'over the berth this frame allows'],
  ['sphere', 'inside the collision sphere', 'wider than the class collides at'],
  ['turrets', 'turrets swing clear', 'armour or another part is inside a turret'],
];

export function derive(d: Design): Derived {
  const frame = frameFor(d.classKey);
  const raster = rasterise(d);
  const ext = raster.extent as [number, number, number];
  const enclosed = ext[0] * ext[1] * ext[2];

  if (!coreDerive) {
    throw new Error('design.derive: the core has not been wired in, so nothing may be derived');
  }
  const parts = partsOf(d);
  const stats = coreDerive(Math.max(0, CLASS_KEYS.indexOf(d.classKey)), {
    plateCells: raster.plateCells, ext, radiusCells: raster.radiusCells, fouled: raster.fouled,
  }, parts);
  if (!stats) throw new Error('design.derive: the core refused the record');

  // What each gun kind is fitted, which is a count over the same list and not
  // a rule: the client draws a mounts table with it and nothing else reads it.
  const gunCount = new Map<string, number>();
  for (const p of d.parts) {
    const m = moduleById(p.module);
    if (m?.weapon) gunCount.set(m.weapon, (gunCount.get(m.weapon) ?? 0) + 1);
  }
  const mounts: Mount[] = [];
  for (const g of GUNS) {
    const n = gunCount.get(g.key) ?? 0;
    if (n > 0) mounts.push({ key: g.key, n });
  }

  const checks: Check[] = GATES.map(([id, label, why], i) => ({
    id,
    label,
    ok: (stats.gates & (1 << i)) !== 0,
    detail: (stats.gates & (1 << i)) !== 0 ? detailFor(id, stats, raster, frame) : why,
  }));

  const belt = Math.max(d.sections.beltFwd, d.sections.beltMid, d.sections.beltAft);

  return {
    cells: CELLS, plateCells: raster.plateCells, enclosed,
    massUM: Math.round(stats.mass * 1e6), mass: stats.mass, massMax: stats.massMax,
    hull: stats.hull, radius: stats.radius, extent: ext,
    accelFwd: stats.accelFwd, accelRetro: stats.accelRetro, accelLat: stats.accelLat,
    maxSpeed: stats.maxSpeed, yaw: stats.yaw, pitch: stats.pitch, reachU: stats.reachU,
    marines: stats.marines, capacity: stats.capacity, boardingRange: stats.boardingRange,
    turrets: raster.turrets, fouled: raster.fouled,
    mounts, belt, checks, legal: checks.every(c => c.ok), parts: stats.parts,
  };
}

/** The number that makes a passing gate worth reading. Words only. */
function detailFor(id: string, s: CoreStats, r: Raster, frame: FrameDef): string {
  switch (id) {
    case 'parts': return `${s.parts} part${s.parts === 1 ? '' : 's'} placed`;
    case 'thrust': return `drive fitted across ${s.parts} parts`;
    case 'bridge': return 'exactly one, and every frame has a bay for it';
    case 'arms': return frame.classKey === 'freighter'
      ? 'the Freighter frame has no gun ring, on purpose'
      : `${s.guns} gun${s.guns === 1 ? '' : 's'} on ${s.trunnions} barbette${s.trunnions === 1 ? '' : 's'}`;
    case 'mass': return `${s.mass.toFixed(3)} of ${s.massMax.toFixed(2)} mass units`;
    case 'sphere': return `${s.radius.toFixed(3)} u against the class radius ${frame.radius.toFixed(1)}`;
    default: return `${r.turrets.length} turret${r.turrets.length === 1 ? '' : 's'}, `
      + 'each with its box to itself';
  }
}

// ------------------------------------------------------- stock designs --

/** The ship a player is handed, at about 85 percent of budget so their first
 *  action is not turning the editor red. */
/**
 * The surface a class flies out of the yard wearing.
 *
 * A finish is a fact about who built the ship, so the stock hulls wear one
 * rather than all sharing the default: four frigates in the same riveted plate
 * are four frigates a player tells apart by colour alone, and colour is
 * already doing the job of saying whose side they are on.
 *
 * Each pick is the class's own description, read back:
 *
 * - Terran flies the heaviest sustained battery in the game off a plain hull.
 *   Riveted plate, faintly metallic, is a working navy's standard and the
 *   thing every other finish reads as a departure from.
 * - Karisen plates all four long faces rather than running a belt, and the
 *   silhouette is stacked. Corrugation is structural and it gives a hull a
 *   DIRECTION, which is what that stack is.
 * - Rogue has the least hull in the game and a third of its mass in boarding
 *   gear. It is battered because it has been, and it is the roughest and least
 *   metallic surface here: nothing about that ship is new.
 * - Benefactor breaks belts with pen 2 cannon and is the most advanced hull on
 *   the field. Ablative hex, tight and glossy, is the one finish that looks
 *   engineered rather than fabricated.
 * - The freighter is a hold with a skin on it and people walking about outside.
 *   Grip deck, and almost no specular at all: nothing on it is polished.
 */
function stock(classKey: string, parts: Placement[], sections: Partial<Sections>,
  faction: string, paint: number,
  finish: string, metal: number, rough: number): Design {
  return { classKey, parts, sections: { ...zeroSections(), ...sections },
    armour: 'wrapped', faction, paint, finish, metal, rough };
}

const P = (socket: string, module: string): Placement => ({ socket, module });

export const STOCK: readonly Design[] = [
  // Six light nozzles in a three by two block, the archived transom exactly.
  // Three beams is the heaviest sustained output in the game, and beams have
  // no penetration, so this is the ship that hates other people's belts most.
  stock('terran_frigate', [
    P('d0', 'DRV-N'), P('d1', 'DRV-N'), P('d2', 'DRV-N'),
    P('d3', 'DRV-N'), P('d4', 'DRV-N'), P('d5', 'DRV-N'),
    P('g0', 'WPN-BB1'), P('g1', 'WPN-BB1'), P('g2', 'WPN-BB1'),
    P('g0/t', 'WPN-BM1'), P('g1/t', 'WPN-BM1'), P('g2/t', 'WPN-BM1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b5', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b4', 'UTL-AIR'), P('b6', 'UTL-AIR'), P('b7', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'terran', 0x0095E9, 'plate', 0.30, 0.50),

  // Three bells in a row and a ventral rack. Plate on all four long faces
  // rather than a belt, which is the stacked silhouette read from the inside.
  // The starboard sponson ships empty, so arming it is the first thing anyone does.
  stock('karisen_frigate', [
    P('d0', 'DRV-B'), P('d1', 'DRV-B'), P('d2', 'DRV-B'), P('d3', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('s0', 'WPN-BB1'), P('s0/t', 'WPN-BM1'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'karisen', 0xFA6A0A, 'ribbed', 0.35, 0.45),

  // Its boarding gear is roughly a third of its mass, which is why it is short,
  // why it has the least hull, and why it turns better than anything else.
  stock('rogue_frigate', [
    P('d0', 'DRV-BR'), P('d1', 'DRV-BR'), P('d2', 'DRV-BR'),
    P('g0', 'WPN-BB1'), P('g1', 'WPN-BB1'),
    P('g0/t', 'WPN-CN1'), P('g1/t', 'WPN-CN1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-S'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'RCS-Q'), P('y3', 'RCS-Q'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'),
    P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b5', 'UTL-BAR'), P('b6', 'UTL-BAR'), P('b7', 'UTL-BAR'), P('b8', 'UTL-BAR'),
    P('b9', 'UTL-AIR'),
    P('a0', 'UTL-AIR'), P('a1', 'UTL-AIR'), P('a2', 'UTL-AIR'),
    P('a3', 'UTL-AIR'), P('a4', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'), P('c2', 'UTL-CLM'),
    P('c3', 'UTL-CLM'), P('c4', 'UTL-CLM'), P('c5', 'UTL-CLM'),
  ], { beltFwd: 1, beltMid: 1, beltAft: 1, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'rogue', 0x494182, 'battered', 0.18, 0.72),

  // One heavy bell does the pushing but caps top speed at 7.0, so the light
  // nozzle beside it exists purely to raise the ceiling. Two cannon at pen 2
  // make it the belt breaker. The aft stack ships empty.
  stock('benefactor_frigate', [
    P('d0', 'DRV-H'), P('d1', 'DRV-V'), P('d2', 'DRV-V'), P('d3', 'DRV-N'),
    P('g0', 'WPN-BB1'), P('g1', 'WPN-BB1'),
    P('g0/t', 'WPN-CN1'), P('g1/t', 'WPN-CN1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('a0', 'UTL-AIR'), P('a1', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'benefactor', 0x1A7A3E, 'hex', 0.45, 0.30),

  // A hold and a skin. Two holds are most of what it has, and no gun ring
  // exists on the frame at all.
  stock('freighter', [
    P('d0', 'DRV-T'), P('d1', 'DRV-T'), P('d2', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'), P('p0', 'MAN-B'), P('p1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('h0', 'UTL-CGO'), P('h1', 'UTL-CGO'),
    P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('b6', 'UTL-AIR'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 4, ventral: 4, bow: 1, stern: 1 },
    'civil', 0xD8E2EC, 'tread', 0.15, 0.70),

  // ------------------------------------------------------------ Terran --
  // Two bells, two beams, and a belt thin enough to be a decision. Only y0 and
  // y1 are fitted: four attitude blocks on a hull this short would turn it
  // faster than a Rogue, which is somebody else's job.
  stock('terran_corvette', [
    P('d0', 'DRV-B'), P('d1', 'DRV-N'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-BM1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'terran', 0x6FB6E8, 'plate', 0.30, 0.50),

  // Six heavy bells in the frigate's three by two block, four beams and one
  // projectile ring under the keel: the fleet's only answer to its own belts.
  stock('terran_destroyer', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'),
    P('d3', 'DRV-V'), P('d4', 'DRV-V'), P('d5', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-BM1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-BM1'), P('g3', 'WPN-BB1'), P('g3/t', 'WPN-BM1'),
    P('g4', 'WPN-BB1'), P('g4/t', 'WPN-CN1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-BAR'),
    P('b6', 'UTL-AIR'), P('b7', 'UTL-AIR'), P('b8', 'UTL-AIR'), P('b9', 'UTL-AIR'),
    P('b10', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'terran', 0x0B7FC4, 'plate', 0.30, 0.50),

  // Eight bells and eight rings. The belt is five layers all the way round,
  // which is most of what the berth buys and all of what the ship is for.
  stock('terran_cruiser', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'), P('d3', 'DRV-H'),
    P('d4', 'DRV-V'), P('d5', 'DRV-V'), P('d6', 'DRV-V'), P('d7', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-BM1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-BM1'), P('g3', 'WPN-BB1'), P('g3/t', 'WPN-BM1'),
    P('g4', 'WPN-BB1'), P('g4/t', 'WPN-BM1'), P('g5', 'WPN-BB1'), P('g5/t', 'WPN-BM1'),
    P('g6', 'WPN-BB1'), P('g6/t', 'WPN-CN1'), P('g7', 'WPN-BB1'), P('g7/t', 'WPN-CN1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-BAR'), P('b6', 'UTL-BAR'),
    P('b7', 'UTL-BAR'), P('b8', 'UTL-BAR'),
    P('b9', 'UTL-AIR'), P('b10', 'UTL-AIR'), P('b11', 'UTL-AIR'), P('b12', 'UTL-AIR'),
    P('b13', 'UTL-AIR'), P('b14', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'), P('c2', 'UTL-CLM'), P('c3', 'UTL-CLM'),
  ], { beltFwd: 5, beltMid: 5, beltAft: 5, dorsal: 3, ventral: 3, bow: 3, stern: 3 },
    'terran', 0x124E89, 'plate', 0.30, 0.50),

  // ----------------------------------------------------------- Karisen --
  // Three overclocked bells and one cell. Two layers everywhere, because a
  // Karisen plates all four long faces rather than carrying a belt, and two
  // of everything is what that costs on a hull this thin.
  stock('karisen_corvette', [
    P('d0', 'DRV-BR'), P('d1', 'DRV-BR'), P('d2', 'DRV-BR'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-S'), P('r1', 'RET-S'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 2, beltMid: 2, beltAft: 2, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'karisen', 0xFFA35C, 'ribbed', 0.35, 0.45),

  // Four bells, two beams and three cells on the ventral rail. The beams are
  // the finisher; the rail is the ship.
  stock('karisen_destroyer', [
    P('d0', 'DRV-B'), P('d1', 'DRV-B'), P('d2', 'DRV-B'), P('d3', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-BM1'),
    P('m0', 'WPN-ML1'), P('m1', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-AIR'), P('b6', 'UTL-AIR'), P('b7', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'karisen', 0xD2560A, 'ribbed', 0.35, 0.45),

  // Six cells and still two beams. Everything the extra berth bought went into
  // ordnance and into the rail carrying it.
  stock('karisen_cruiser', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-B'), P('d3', 'DRV-B'),
    P('d4', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-BM1'),
    P('m0', 'WPN-ML1'), P('m1', 'WPN-ML1'), P('m2', 'WPN-ML1'), P('m3', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-BAR'),
    P('b6', 'UTL-AIR'), P('b7', 'UTL-AIR'), P('b8', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'karisen', 0x73172D, 'ribbed', 0.35, 0.45),

  // ------------------------------------------------------------- Rogue --
  // One gun and one layer of plate. Everything else is berths and clamps, and
  // that is the whole class.
  stock('rogue_corvette', [
    P('d0', 'DRV-BR'), P('d1', 'DRV-BR'), P('d2', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'),
    P('r0', 'RET-S'), P('r1', 'RET-S'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-AIR'), P('b5', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 1, beltMid: 1, beltAft: 1, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'rogue', 0x6B5FA8, 'battered', 0.18, 0.72),

  // Six clamps, eight barracks and three guns. Seventy marines is more than
  // anybody else's cruiser carries, on a hull that costs less than their
  // destroyer.
  stock('rogue_destroyer', [
    P('d0', 'DRV-BR'), P('d1', 'DRV-BR'), P('d2', 'DRV-BR'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-CN1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-CN1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'RCS-Q'), P('y3', 'RCS-Q'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'RCS-Q'), P('p3', 'RCS-Q'),
    P('b0', 'UTL-BRG'),
    P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b5', 'UTL-BAR'), P('b6', 'UTL-BAR'), P('b7', 'UTL-BAR'), P('b8', 'UTL-BAR'),
    P('b9', 'UTL-BAR'),
    P('b10', 'UTL-AIR'), P('b11', 'UTL-AIR'), P('b12', 'UTL-AIR'), P('b13', 'UTL-AIR'),
    P('b14', 'UTL-AIR'), P('b15', 'UTL-AIR'), P('b16', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'), P('c2', 'UTL-CLM'),
    P('c3', 'UTL-CLM'), P('c4', 'UTL-CLM'), P('c5', 'UTL-CLM'),
  ], { beltFwd: 1, beltMid: 1, beltAft: 1, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'rogue', 0x3A3466, 'battered', 0.18, 0.72),

  // Eight clamps and berths for a hundred and ten. Four guns on a heavy hull
  // is the lightest battery in the game at that rung, and deliberately so.
  stock('rogue_cruiser', [
    P('d0', 'DRV-BR'), P('d1', 'DRV-BR'), P('d2', 'DRV-BR'), P('d3', 'DRV-BR'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-CN1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-CN1'), P('g3', 'WPN-BB1'), P('g3/t', 'WPN-CN1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'),
    P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b5', 'UTL-BAR'), P('b6', 'UTL-BAR'), P('b7', 'UTL-BAR'), P('b8', 'UTL-BAR'),
    P('b9', 'UTL-BAR'), P('b10', 'UTL-BAR'), P('b11', 'UTL-BAR'), P('b12', 'UTL-BAR'),
    P('b13', 'UTL-BAR'), P('b14', 'UTL-BAR'),
    P('b15', 'UTL-AIR'), P('b16', 'UTL-AIR'), P('b17', 'UTL-AIR'), P('b18', 'UTL-AIR'),
    P('b19', 'UTL-AIR'), P('b20', 'UTL-AIR'), P('b21', 'UTL-AIR'), P('b22', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'), P('c2', 'UTL-CLM'), P('c3', 'UTL-CLM'),
    P('c4', 'UTL-CLM'), P('c5', 'UTL-CLM'), P('c6', 'UTL-CLM'), P('c7', 'UTL-CLM'),
  ], { beltFwd: 2, beltMid: 2, beltAft: 2, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'rogue', 0x181425, 'battered', 0.18, 0.72),

  // -------------------------------------------------------- Benefactor --
  // Four layers of belt on a hull four metres long, one cannon and one cell.
  // The corvette nobody else's corvette can open.
  stock('benefactor_corvette', [
    P('d0', 'DRV-N'), P('d1', 'DRV-V'), P('d2', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'RCS-Q'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    'benefactor', 0x2FA85B, 'hex', 0.45, 0.30),

  // One heavy bell doing the pushing, three cannon and a cell, on a section
  // ten cells deep. Five layers of belt is the most any destroyer carries.
  stock('benefactor_destroyer', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-V'), P('d3', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-CN1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-CN1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-BAR'),
    P('b6', 'UTL-AIR'), P('b7', 'UTL-AIR'), P('b8', 'UTL-AIR'), P('b9', 'UTL-AIR'),
    P('b10', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 5, beltMid: 5, beltAft: 5, dorsal: 2, ventral: 2, bow: 1, stern: 1 },
    'benefactor', 0x146032, 'hex', 0.45, 0.30),

  // Six layers of belt, four cannon, two cells, and two and a half degrees a
  // second of yaw. The heaviest berth in the game, spent almost entirely on
  // not dying.
  stock('benefactor_cruiser', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'),
    P('d3', 'DRV-V'), P('d4', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-CN1'), P('g1', 'WPN-BB1'), P('g1/t', 'WPN-CN1'),
    P('g2', 'WPN-BB1'), P('g2/t', 'WPN-CN1'), P('g3', 'WPN-BB1'), P('g3/t', 'WPN-CN1'),
    P('m0', 'WPN-ML1'), P('m1', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-BAR'), P('b5', 'UTL-BAR'), P('b6', 'UTL-BAR'), P('b7', 'UTL-BAR'),
    P('b8', 'UTL-AIR'), P('b9', 'UTL-AIR'), P('b10', 'UTL-AIR'), P('b11', 'UTL-AIR'),
    P('b12', 'UTL-AIR'), P('b13', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'), P('c2', 'UTL-CLM'), P('c3', 'UTL-CLM'),
  ], { beltFwd: 6, beltMid: 6, beltAft: 6, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'benefactor', 0x0E4423, 'hex', 0.45, 0.30),
];

export const stockFor = (classKey: string): Design => {
  const s = STOCK.find(d => d.classKey === classKey) ?? (STOCK[0] as Design);
  // The surface comes across too. A copy that rebuilt the record field by
  // field and forgot one is how a class's own finish would go missing between
  // the table and the map, silently, exactly as if it had never been set.
  return { classKey: s.classKey, parts: s.parts.map(p => ({ ...p })),
    sections: { ...s.sections }, armour: s.armour, faction: s.faction, paint: s.paint,
    finish: s.finish ?? DEFAULT_FINISH,
    // The per slot finishes and the two interior surfaces come across for the
    // same reason the hull wide one does: this rebuilds the record field by
    // field, so a field left out here goes missing between the table and the
    // map exactly as if it had never been set.
    ...(s.slotFinish ? { slotFinish: s.slotFinish.slice() } : {}),
    frameFinish: s.frameFinish ?? DEFAULT_FRAME_FINISH,
    partFinish: s.partFinish ?? DEFAULT_PART_FINISH,
    metal: s.metal ?? DEFAULT_METAL,
    rough: s.rough ?? DEFAULT_ROUGH,
    plate: [], cut: [] };
};

// ============================================================== VOXELS ==
//
// Every part is a VOLUME OF CELLS, not a parametric mesh.
//
// The first cut drew bells as cones and turrets as cylinders, and it produced
// exactly the slop that shape choice guarantees: coplanar faces z fighting
// into stripes, barrels poking out through plating, and parts hanging in
// space with nothing under them. None of those are bugs to chase. They are
// what happens when the ship is a pile of overlapping solids in continuous
// space instead of an occupancy grid.
//
// A cell is filled or it is not. Two parts cannot occupy the same cell, so
// nothing z fights. A part sits on whole cells, so nothing floats a
// fraction of a cell off its mounting. And the picture is then the same
// structure the damage model reads, rather than a second opinion about it.

/**
 * What a filled cell is made of. The colour comes from the palette below.
 *
 * A plain object, NOT a const enum: a const enum has no runtime value, so
 * importing one across a module boundary and reading `Mat.Plate` in another
 * file gets whatever the bundler felt like inlining. It classified every cell
 * on the ship as plate, which drew the whole hull in one colour and made the
 * plate toggle empty the screen.
 */
export const Mat = {
  Empty: 0, Plate: 1, Frame: 2, Machine: 3, Glow: 4, Accent: 5, Case: 6, Skinned: 7,
} as const;

/**
 * `Skinned` is a frame member lying where the armour shell wants to be.
 *
 * First writer wins, so the frame owns the cell, and the Karisen's dorsal
 * stringer and ventral keel beam therefore ran as two bare grey slabs straight
 * down the outside of a plated hull. A skin covers its own ribs. So the shell
 * marks those cells instead of skipping them: they draw and cost as plate with
 * the plate on, and go back to being frame the moment it comes off, which is
 * what the x ray is for.
 */

/**
 * `Case` exists so a part's own casing is not armour.
 *
 * A barbette drum, a gun housing and a bridge shell all used to be written as
 * `Plate`, which meant the paint bucket reached inside the ship and turned
 * every mount the faction colour. Armour is the only thing a player paints,
 * so armour is the only thing that carries `Plate`.
 */

/** Purpose in one byte, so a whole grid can carry it beside the material. */
export const PURPOSE_ORDER: readonly Purpose[] = [
  'propulsion', 'attitude', 'gun', 'ordnance',
  'command', 'crew', 'boarding', 'structure',
];
export const purposeCode = (p: Purpose): number => PURPOSE_ORDER.indexOf(p) + 1;
export const purposeAt = (code: number): Purpose =>
  PURPOSE_ORDER[Math.max(0, code - 1)] ?? 'structure';

/**
 * The colour of one cell, and the ONLY place that decision is made.
 *
 * Armour takes the paint. Everything else takes its purpose hue, in one of
 * three tones: the casing is the shadow, the working guts are the base, and
 * anything lit or trimmed is the highlight. That is why an unfamiliar hull is
 * readable: orange is a drive on anybody's ship, red is a gun, and the only
 * thing that changes between factions is the skin over them.
 */
export function cellColour(mat: number, code: number, paint: number): number {
  if (mat === Mat.Plate) return paint;   // callers that want the livery use armourColour
  if (mat === Mat.Frame || mat === Mat.Skinned) return PURPOSE.structure.base;
  const p = PURPOSE[purposeAt(code)];
  switch (mat) {
    case Mat.Case: return p.dark;
    case Mat.Accent: return p.mid;
    case Mat.Glow: return p.lit;
    default: return p.base;
  }
}

/**
 * What colour the armour is: the one that was picked.
 *
 * It used to spread all eight of a faction's swatches over the hull by
 * POSITION, as panels, an underside, a spine, a waist stripe, a nose flash and
 * a transom band. It made a handsome ship and it took the decision away: a
 * player picking a colour got a scheme built round it rather than the colour
 * they picked. Now the pick IS the hull, and the eight are eight things to
 * choose between rather than eight roles to be assigned.
 *
 * Everything that is not armour keeps its purpose colour, so a drive is still
 * orange and a gun still red on anybody's ship. That is the part a player must
 * be able to read on an unfamiliar hull, and it is not paint.
 */
export function armourColour(primary: number): number {
  return primary;
}

export interface VoxelModel {
  readonly sx: number; readonly sy: number; readonly sz: number;
  /** One material per cell, x fastest then y then z. */
  readonly data: Uint8Array;
  readonly filled: number;
}

/**
 * The cell a part turns about, and the cell that lands on its socket.
 *
 * A turret pivots on its MOUNT, not on the middle of its barrel. Placing the
 * box centre on the trunnion put half the barrel behind the barbette and swung
 * it through the hull when the part was turned; the outline a player selected
 * was visibly off its own base. So a gun's pivot is inside its housing, a few
 * cells up from the breech, and everything else keeps the box centre.
 */
export function pivotOf(m: ModuleDef): readonly [number, number, number] {
  const [sx, sy, sz] = m.size;
  const cx = (sx - 1) / 2, cy = (sy - 1) / 2;
  if (m.art === 'beamgun' || m.art === 'cannon')
    return [cx, cy, Math.round(sz * 0.18)];
  return [cx, cy, (sz - 1) / 2];
}

/** The same pivot in the coordinates of the model turned `rot` quarter turns. */
export function rotatedPivot(m: ModuleDef, rot: number): readonly [number, number, number] {
  const r = ((rot % 4) + 4) % 4;
  let [px, py, pz] = pivotOf(m);
  let [sx, , sz] = m.size;
  for (let n = 0; n < r; n++) {
    // The same map the cells take: (x, z) -> (sz - 1 - z, x).
    const nx = (sz as number) - 1 - pz, nz = px;
    px = nx; pz = nz;
    const t = sx; sx = sz; sz = t;
  }
  return [px, py, pz];
}

const voxCache = new Map<string, VoxelModel>();
const rotCache = new Map<string, VoxelModel>();

/**
 * The same part, turned a quarter at a time about the up axis.
 *
 * Rotating the CELLS rather than the drawn mesh is what keeps a turned turret
 * on the grid: it stays one cell per cell, so it still cannot z fight with the
 * plate beside it or float a fraction of a cell off its ring.
 */
export function rotatedVoxels(m: ModuleDef, rot: number): VoxelModel {
  const r = ((rot % 4) + 4) % 4;
  if (r === 0) return voxelsOf(m);
  const key = m.id + '/' + r;
  const hit = rotCache.get(key);
  if (hit) return hit;
  let cur = voxelsOf(m);
  for (let n = 0; n < r; n++) {
    // (x, z) -> (sz - 1 - z, x): one quarter turn, exact on integers.
    const sx = cur.sz, sy = cur.sy, sz = cur.sx;
    const data = new Uint8Array(sx * sy * sz);
    for (let z = 0; z < cur.sz; z++) for (let y = 0; y < cur.sy; y++) for (let x = 0; x < cur.sx; x++) {
      const v = cur.data[x + y * cur.sx + z * cur.sx * cur.sy] as number;
      if (!v) continue;
      data[(cur.sz - 1 - z) + y * sx + x * sx * sy] = v;
    }
    cur = { sx, sy, sz, data, filled: cur.filled };
  }
  rotCache.set(key, cur);
  return cur;
}

/**
 * Rasterise a part into cells.
 *
 * Shapes are written as fill rules over the part's own box rather than as
 * meshes, so the same code that draws a bell is the code that says which
 * cells a bell occupies. There is no second description to drift.
 */
export function voxelsOf(m: ModuleDef): VoxelModel {
  const hit = voxCache.get(m.id);
  if (hit) return hit;
  const [sx, sy, sz] = m.size;
  const data = new Uint8Array(sx * sy * sz);
  const at = (x: number, y: number, z: number) => x + y * sx + z * sx * sy;
  const put = (x: number, y: number, z: number, mat: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
    data[at(x, y, z)] = mat;
  };
  const fill = (mat: number) => {
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
      put(x, y, z, mat);
  };
  const cx = (sx - 1) / 2, cy = (sy - 1) / 2, cz = (sz - 1) / 2;
  // Distance from the part's own long axis, used by everything round.
  const rad = (x: number, y: number) => Math.hypot(x - cx, y - cy);
  const shell = (x: number, y: number, z: number) =>
    x === 0 || y === 0 || z === 0 || x === sx - 1 || y === sy - 1 || z === sz - 1;

  switch (m.art) {
    case 'bell':
    case 'nozzle': {
      // Aft is -z, so the throat is forward and the bell flares to the back.
      const rOuter = Math.min(sx, sy) / 2;
      const rThroat = m.art === 'bell' ? rOuter * 0.42 : rOuter * 0.55;
      for (let z = 0; z < sz; z++) {
        const t = z / Math.max(1, sz - 1);          // 0 aft, 1 forward
        const r = rOuter + (rThroat - rOuter) * Math.min(1, t * 1.35);
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const d = rad(x, y);
          if (d > r) continue;
          // Hollow through the flare, solid at the forward plug, and a lit
          // ring at the very back where the exhaust leaves. Every second
          // course of the flare is banded, which is what tells one bell from
          // another once they are all the same orange.
          if (t > 0.72) put(x, y, z, Mat.Case);
          else if (d > r - 1.35) put(x, y, z, z === 0 ? Mat.Glow : (z % 2 ? Mat.Accent : Mat.Machine));
        }
      }
      break;
    }
    case 'rcs': {
      // A box of thrusters, and they point the way the block actually pushes: a
      // yaw block throws sideways and a pitch block throws up and down, so
      // reading `latX` and `latY` is the difference between a thruster that
      // faces out of the hull and one that faces into it. Small parts too:
      // the RCS quad is 2x2x2, where a hollowed shell drew literally nothing.
      fill(Mat.Machine);
      const jetX = (m.latX ?? 0) > 0, jetY = (m.latY ?? 0) > 0;
      const face = (fx: number, fy: number) => {
        for (let z = 0; z < sz; z++) for (let q = 0; q < (fx < 0 ? sy : sx); q++) {
          const x = fx < 0 ? (fx === -1 ? 0 : sx - 1) : q;
          const y = fx < 0 ? q : (fy === 0 ? 0 : sy - 1);
          const edge = fx < 0 ? (q === 0 || q === sy - 1) : (q === 0 || q === sx - 1);
          put(x, y, z, edge ? Mat.Case : Mat.Accent);
        }
      };
      if (jetX) { face(-1, 0); face(-2, 0); }
      if (jetY) { face(0, 0); face(0, 1); }
      // One lit nozzle at the centre of each face it pushes through, rather
      // than a lit stripe down the whole of it: the stripe overwrote every
      // trim cell the face had and the block came out flat.
      const mz = Math.round(cz);
      if (jetX) {
        put(0, Math.round(cy), mz, Mat.Glow);
        put(sx - 1, Math.round(cy), mz, Mat.Glow);
      }
      if (jetY) {
        put(Math.round(cx), 0, mz, Mat.Glow);
        put(Math.round(cx), sy - 1, mz, Mat.Glow);
      }
      break;
    }
    case 'barbette': {
      // A drum with a toothed ring on top. The base is what takes the damage,
      // which is why it is a part in its own right and not decoration.
      const r = Math.min(sx, sz) / 2;
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > r) continue;
        if (y === sy - 1 && d > r - 1.2) put(x, y, z, (x + z) % 2 ? Mat.Accent : Mat.Glow);
        else put(x, y, z, d > r - 1.2 ? Mat.Case : Mat.Machine);
      }
      break;
    }
    case 'beamgun': {
      // A slim emitter: short housing, thin barrel, a lit muzzle and a collar
      // ring where the barrel leaves the housing.
      const housing = Math.max(2, Math.round(sz * 0.36));
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        if (z < housing) { put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine); continue; }
        if (z === housing) { if (rad(x, y) <= 1.9) put(x, y, z, Mat.Accent); continue; }
        if (rad(x, y) <= 1.05) put(x, y, z, z === sz - 1 ? Mat.Glow : Mat.Machine);
      }
      break;
    }
    case 'cannon': {
      // A fat stepped barrel, so it is a different silhouette from the beam
      // rather than a different number in a tooltip.
      const housing = Math.max(2, Math.round(sz * 0.45));
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        if (z < housing) { put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine); continue; }
        const step = z > housing + (sz - housing) * 0.55 ? 1.15 : 1.75;
        if (rad(x, y) <= step) put(x, y, z, z === sz - 1 ? Mat.Glow : Mat.Machine);
        else if (rad(x, y) <= step + 0.9 && z < housing + 2) put(x, y, z, Mat.Accent);
      }
      break;
    }
    case 'missilecell': {
      // A block with tubes bored forward through it, and a band round the
      // waist so a magazine does not read as a barracks.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
        put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine);
      for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
        if (shell(x, y, Math.round(cz))) put(x, y, Math.round(cz), Mat.Accent);
      const qx = [Math.floor(sx * 0.28), Math.floor(sx * 0.72)];
      const qy = [Math.floor(sy * 0.28), Math.floor(sy * 0.72)];
      for (const x of qx) for (const y of qy) for (let z = Math.floor(sz * 0.35); z < sz; z++)
        put(x, y, z, z === sz - 1 ? Mat.Glow : Mat.Empty);
      break;
    }
    case 'bridge': {
      // A stepped superstructure with a lit window band right round the top
      // deck. It is the one part a player should find in a second.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const inset = y >= sy - 1 ? 1 : 0;      // the top deck steps in
        if (x < inset || x >= sx - inset || z < inset || z >= sz - inset) continue;
        put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine);
      }
      const top = sy - 1;
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++)
        if (data[at(x, top, z)] && shell(x, top, z)) put(x, top, z, Mat.Glow);
      for (let x = 1; x < sx - 1; x++) put(x, top - 1, sz - 1, Mat.Accent);
      break;
    }
    case 'barracks': {
      // Berth decks: every other course banded, so it reads as stacked bunks
      // rather than as a crate.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
        put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine);
      for (let y = 1; y < sy - 1; y += 2) for (let z = 0; z < sz; z++) {
        put(0, y, z, Mat.Accent);
        put(sx - 1, y, z, Mat.Accent);
      }
      for (let y = 1; y < sy - 1; y += 2) put(Math.round(cx), y, sz - 1, Mat.Glow);
      break;
    }
    case 'airlock': {
      // A collar with a hatch iris. Small, so the pattern has to survive three
      // cells a side: a ring of casing round a lit centre.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const d = Math.hypot(x - cx, z - cz);
        if (d > Math.min(sx, sz) / 2) continue;
        put(x, y, z, Mat.Case);
      }
      const yTop = sy - 1;
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        if (!data[at(x, yTop, z)]) continue;
        const d = Math.hypot(x - cx, z - cz);
        put(x, yTop, z, d <= 0.75 ? Mat.Glow : Mat.Accent);
      }
      break;
    }
    case 'clamp': {
      // Two jaws with a gap between them and lit tips: a grapple, not a box.
      const jaw = Math.max(1, Math.round(sy * 0.35));
      for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
        for (let y = 0; y < jaw; y++) put(x, y, z, Mat.Machine);
        for (let y = sy - jaw; y < sy; y++) put(x, y, z, Mat.Machine);
      }
      for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
        if (data[at(x, y, sz - 1)]) put(x, y, sz - 1, x === 0 || x === sx - 1 ? Mat.Glow : Mat.Accent);
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++)
        if (data[at(Math.round(cx), y, z)]) put(Math.round(cx), y, z, Mat.Case);
      break;
    }
    case 'cargo': {
      // A crate: braced edges and bare panels, which is the cheapest way to
      // read "volume" at any size.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        if (!shell(x, y, z)) continue;
        const edges = (x === 0 || x === sx - 1 ? 1 : 0) + (y === 0 || y === sy - 1 ? 1 : 0)
          + (z === 0 || z === sz - 1 ? 1 : 0);
        put(x, y, z, edges >= 2 ? Mat.Accent : Mat.Case);
      }
      for (let y = 1; y < sy - 1; y++) put(Math.round(cx), y, sz - 1, Mat.Glow);
      break;
    }
    case 'pod': {
      // A rounded canister with a lit cap, for the small fittings.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const corner = (x === 0 || x === sx - 1) && (y === 0 || y === sy - 1)
          && (z === 0 || z === sz - 1) && sx > 2 && sy > 2;
        if (corner) continue;
        put(x, y, z, shell(x, y, z) ? Mat.Case : Mat.Machine);
      }
      for (let x = 0; x < sx; x++) put(x, sy - 1, Math.round(cz), Mat.Glow);
      break;
    }
    case 'strut':
      for (let z = 0; z < sz; z++) put(Math.floor(cx), Math.floor(cy), z, Mat.Frame);
      break;
    default:
      // A plain block, with a machined face so it is not a featureless brick.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
        put(x, y, z, y === sy - 1 ? Mat.Machine : Mat.Case);
  }

  let filled = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) filled++;
  const model: VoxelModel = { sx, sy, sz, data, filled };
  voxCache.set(m.id, model);
  return model;
}
