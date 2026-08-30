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
 * What each of the eight is FOR. A scheme, not a colour: one swatch on a whole
 * hull is a paint bucket, and a paint bucket makes every ship of a faction the
 * same flat lozenge.
 */
export const PAINT_ROLE = {
  primary: 0, panel: 1, secondary: 2, deep: 3,
  highlight: 4, marking: 5, trim: 6, stripe: 7,
} as const;

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
    size: [6, 5, 6], mass: 34200, hull: 7200, purpose: 'command', art: 'bridge', colour: 0x3FD97C },
  { id: 'UTL-BAR', name: 'Marine barracks', cat: 'utility', fits: 'bay',
    size: [5, 4, 7], mass: 26600, hull: 5600, marines: 5, purpose: 'crew', art: 'barracks', colour: 0xFFC93C },
  { id: 'UTL-AIR', name: 'Boarding airlock', cat: 'utility', fits: 'bay',
    size: [3, 3, 3], mass: 5130, hull: 1080, capacity: 2, purpose: 'boarding', art: 'airlock', colour: 0xFF5FA8 },
  { id: 'UTL-CLM', name: 'Boarding clamp', cat: 'utility', fits: 'clamp',
    size: [5, 4, 6], mass: 22800, hull: 4800, reach: 5, purpose: 'boarding', art: 'clamp', colour: 0xFF5FA8 },
  { id: 'UTL-CGO', name: 'Cargo bay', cat: 'utility', fits: 'bay',
    size: [10, 8, 13], mass: 197600, hull: 41600, purpose: 'structure', art: 'cargo', colour: 0x8494A8 },

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
  readonly arcH: number;
  readonly pen: number;
}
export const GUNS: readonly GunDef[] = [
  { key: 'beam', name: 'Beam', dmg: 27.5, batch: 1, range: 300, cooldown: 3.0, arcH: 110, pen: 0 },
  { key: 'projectile', name: 'Projectile', dmg: 27.5, batch: 1, range: 200, cooldown: 4.0, arcH: 90, pen: 2 },
  { key: 'missile', name: 'Missile', dmg: 25, batch: 2, range: 250, cooldown: 6.0, arcH: 360, pen: 0 },
];
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
 * Which socket kinds may stand PROUD of the hull.
 *
 * A drive has to see vacuum, a gun has to see its target, and attitude jets
 * have to push on something that is not the ship. Everything else lives
 * inside: berths, magazines, holds, airlocks and stowed boarding clamps are
 * volume, not fittings, and a ship with its barracks bolted to the outside
 * reads as a scaffold rather than a hull.
 *
 * Sensors would belong here too. There is no sensor part, because `sim_core`
 * has no detection, and a part that can only ever raise a warning teaches
 * players to ignore warnings.
 */
export const EXPOSED_KINDS: ReadonlyArray<SocketKind> =
  ['drive', 'retro', 'rcs', 'gun', 'trunnion'];

export const isExposed = (k: SocketKind): boolean => EXPOSED_KINDS.indexOf(k) >= 0;

export interface FrameDef {
  readonly classKey: string;
  readonly name: string;
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

export const FRAMES: readonly FrameDef[] = [
  {
    classKey: 'terran_frigate', name: 'Terran Frigate', rung: 'frigate',
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
    classKey: 'karisen_frigate', name: 'Karisen Frigate', rung: 'frigate',
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
    classKey: 'rogue_frigate', name: 'Rogue Frigate', rung: 'frigate',
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
    classKey: 'benefactor_frigate', name: 'Benefactor Frigate', rung: 'frigate',
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
    classKey: 'freighter', name: 'Freighter', rung: 'escort',
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
  hx: number, hy: number, hz: number): boolean {
  let hw = Infinity, hh = Infinity;
  for (let k = Math.round(z - hz); k <= Math.round(z + hz); k++) {
    const st = hullAt(prof, k);
    hw = Math.min(hw, st[0] as number);
    hh = Math.min(hh, st[1] as number);
  }
  const a = Math.max(1, hw - 1), b = Math.max(1, hh - 1);
  const dx = (Math.abs(x - CX) + hx) / a, dy = (Math.abs(y - CY) + hy) / b;
  return dx * dx + dy * dy <= 1;
}

export function seatOf(frame: FrameDef, sock: Socket,
  v: { sx: number; sy: number; sz: number }): readonly [number, number, number] {
  const cx = sock.at[0] as number, cy = sock.at[1] as number, cz = sock.at[2] as number;
  if (isExposed(sock.kind)) return [cx, cy, cz];
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
  const a = Math.max(1, hw - 1), b = Math.max(1, hh - 1);
  let x = cx, y = cy;
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
  /** Which faction's swatches the paint bucket offers. */
  faction: string;
  /** Armour tint. Cosmetic only: never hashed, never sent to the core. */
  paint: number;
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
const PLATE_UM = 78, HULL_MILLI = 34;
/** How much bigger this rung's cell is than a frigate's, cubed. Plate is a
 *  volume of material, so it scales; a part is a machine, so it does not. */
const rungVol = (rung: RungKey): number => (RUNG[rung] / RUNG.frigate) ** 3;

/** Turn length, from prototype/sim/data.js CONST. */
const TURN_SECONDS = 10;

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
   *  jets, gun rings and trunnions are allowed to stand proud of it. */
  readonly enclosedOutside: number;
  readonly extent: readonly [number, number, number];
  /** The true bounding sphere, in cells, about the hull's own centre.
   *  A box diagonal is not one: it measures corners a long thin ship has
   *  nothing in, and it failed every frigate on a gate they actually pass. */
  readonly radiusCells: number;
}

const idx3 = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

const rasterSig = (d: Design): string =>
  d.classKey + '|' + d.armour + '|'
  + d.parts.map(p => p.socket + ':' + p.module + ':' + (p.rot ?? 0)).sort().join(',') + '|'
  + SECTIONS.map(k => d.sections[k]).join(',');

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
  let enclosedOutside = 0;
  for (let pi = 0; pi < d.parts.length; pi++) {
    const p = d.parts[pi] as Placement;
    const sock = allSockets.find(k => k.id === p.socket);
    const m = moduleById(p.module);
    if (!sock || !m) continue;
    const v = rotatedVoxels(m, p.rot ?? 0);
    const code = purposeCode(m.purpose);
    const seat = seatOf(frame, sock, v);
    const bx = Math.round((seat[0] as number) - v.sx / 2);
    const by = Math.round((seat[1] as number) - v.sy / 2);
    const bz = Math.round((seat[2] as number) - v.sz / 2);

    // How many of the part's cells another part is already standing in.
    const lossAt = (ox: number, oy: number, oz: number): number => {
      let lost = 0;
      for (let k = 0; k < v.sz; k++) for (let j = 0; j < v.sy; j++) for (let i = 0; i < v.sx; i++) {
        if (!v.data[i + j * v.sx + k * v.sx * v.sy]) continue;
        const x = ox + i, y = oy + j, z = oz + k;
        if (!inBounds(x, y, z)) { lost++; continue; }
        const at = grid[idx3(x, y, z)] as number;
        if (at && at !== Mat.Frame) lost++;
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
        if (!isExposed(sock.kind) && !boxInside(prof,
          tx + v.sx / 2, ty + v.sy / 2, tz + v.sz / 2, v.sx / 2, v.sy / 2, v.sz / 2)) continue;
        const lost = lossAt(tx, ty, tz);
        if (lost < best) { best = lost; ox = tx; oy = ty; oz = tz; }
        if (best === 0) break;
      }
    }

    // A part mounts THROUGH the frame, so it takes a rib cell if it needs one.
    // Strict first writer wins ate whole parts here: a two cell RCS quad
    // landing on the Rogue's rib ring wrote nothing at all and the ship showed
    // no attitude jets on that quarter. It still never takes another part's
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
        if (!isExposed(sock.kind)) enclosedOutside++;
      }
    }
  }

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
      if (grid[n] !== Mat.Frame) continue;
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
          const at = grid[idx3(x, y, z)] as number;
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
      set(x, y, k, Mat.Plate, STRUCT);
      const vx = (x + 0.5 - CX) / hw, vy = (y + 0.5 - CY) / hh;
      if (vx * vx + vy * vy <= 1) break;       // reached the hull line
    }
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

  const raster: Raster = { grid, purp, own, plateCells, solidCells: cells.length / 3,
    enclosedOutside, extent, radiusCells: Math.sqrt(r2) };
  rasterCache = { sig, raster };
  return raster;
}

export function derive(d: Design): Derived {
  const frame = frameFor(d.classKey);
  const cell = RUNG[frame.rung];

  // --- what is bolted on ------------------------------------------------
  let massUM = 0, hullMilli = 0;
  let thrust = 0, retro = 0, latX = 0, latY = 0, exhaust = 0;
  let marines = 0, capacity = 0, reach = 0, parts = 0;
  const gunCount = new Map<string, number>();
  let trunnions = 0, guns = 0;

  for (const p of d.parts) {
    const m = moduleById(p.module);
    if (!m) continue;
    parts++;
    massUM += m.mass;
    hullMilli += m.hull;
    thrust += m.thrust ?? 0;
    retro += m.retro ?? 0;
    latX += m.latX ?? 0;
    latY += m.latY ?? 0;
    if (m.exhaust && m.exhaust > exhaust) exhaust = m.exhaust;
    marines += m.marines ?? 0;
    capacity += m.capacity ?? 0;
    reach += m.reach ?? 0;
    if (m.fits === 'gun' && m.id === 'WPN-BB1') trunnions++;
    if (m.weapon) {
      guns++;
      gunCount.set(m.weapon, (gunCount.get(m.weapon) ?? 0) + 1);
    }
  }

  // --- the hull as built, counted rather than estimated -------------------
  const raster = rasterise(d);
  const ext = raster.extent as [number, number, number];
  const plateCells = raster.plateCells;
  const enclosed = ext[0] * ext[1] * ext[2];

  const vol = rungVol(frame.rung);
  massUM += Math.round(plateCells * PLATE_UM * vol);
  hullMilli += Math.round(plateCells * HULL_MILLI * vol);

  const mass = massUM / 1e6;
  const hull = hullMilli / 1000;

  // --- flight ------------------------------------------------------------
  // No thruster means no thrust at all, which is the core's own rule: losing
  // the last live Thruster costs 100 percent of thrust.
  const mDen = massUM > 0 ? massUM : 1;
  const accelFwd = (thrust * 10_000) / mDen;
  const accelRetro = (retro * 10_000) / mDen;
  const accelLat = (Math.min(latX, latY) * 10_000) / mDen;
  const maxSpeed = thrust > 0 ? exhaust : 0;
  // A first moment curve, not rigid body dynamics, chosen because ADR-14 says
  // the flight model is hand authored and the physical form misses the
  // authored numbers badly.
  // Rotation comes from what actually turns the ship: the lateral blocks,
  // against its mass and its length. Normalising against the CLASS budget
  // instead rewarded being under budget twice over, and gave the Freighter a
  // better turn rate than the Terran.
  const lenZ = Math.max(1, ext[2]);
  const K = 16.6;
  const yaw = thrust > 0 ? Math.min(24, (K * latX) / (Math.max(mass, 1e-6) * lenZ)) : 0;
  const pitch = thrust > 0 ? Math.min(16, (K * 0.67 * latY) / (Math.max(mass, 1e-6) * lenZ)) : 0;

  // prototype/sim/data.js nominalReach(), verbatim.
  const tAccel = accelFwd > 0 ? Math.min(TURN_SECONDS, maxSpeed / accelFwd) : 0;
  const reachU = 0.5 * accelFwd * tAccel * tAccel + maxSpeed * (TURN_SECONDS - tAccel);

  // --- the true bounding sphere, which is the gate the wireframe used to be
  const radius = raster.radiusCells * cell;

  // --- the belt a shot actually meets ------------------------------------
  const belt = Math.max(d.sections.beltFwd, d.sections.beltMid, d.sections.beltAft);

  const mounts: Mount[] = [];
  for (const g of GUNS) {
    const n = gunCount.get(g.key) ?? 0;
    if (n > 0) mounts.push({ key: g.key, n });
  }

  // --- gates. Six hard checks and no soft ones: a design cannot be refused
  // by a system sim_core does not have, which is why power and heat are not
  // here at all.
  const checks: Check[] = [
    { id: 'parts', label: 'something is fitted', ok: parts > 0,
      detail: `${parts} part${parts === 1 ? '' : 's'} placed` },
    { id: 'thrust', label: 'at least one drive', ok: thrust > 0,
      detail: thrust > 0 ? `${thrust} thrust across the drive plate`
        : 'no drive fitted, so no thrust at all' },
    { id: 'bridge', label: 'a bridge', ok: d.parts.some(p => p.module === 'UTL-BRG'),
      detail: 'exactly one, and every frame has a bay for it' },
    { id: 'arms', label: 'at least one gun', ok: guns > 0 || frame.classKey === 'freighter',
      detail: frame.classKey === 'freighter'
        ? 'the Freighter frame has no gun ring, on purpose'
        : `${guns} gun${guns === 1 ? '' : 's'} on ${trunnions} barbette${trunnions === 1 ? '' : 's'}` },
    { id: 'mass', label: 'inside the berth', ok: mass <= frame.massMax + 1e-9,
      detail: `${mass.toFixed(3)} of ${frame.massMax.toFixed(2)} mass units` },
    { id: 'sphere', label: 'inside the collision sphere', ok: radius <= frame.radius + 1e-9,
      detail: `${radius.toFixed(3)} u against the class radius ${frame.radius.toFixed(1)}` },
  ];

  return {
    cells: CELLS, plateCells, enclosed, massUM, mass, massMax: frame.massMax,
    hull, radius, extent: ext,
    accelFwd, accelRetro, accelLat, maxSpeed, yaw, pitch, reachU,
    marines: frame.baseMarines + marines,
    capacity: frame.baseCapacity + capacity,
    boardingRange: frame.baseReach + reach,
    mounts, belt, checks, legal: checks.every(c => c.ok), parts,
  };
}

// ------------------------------------------------------- stock designs --

/** The ship a player is handed, at about 85 percent of budget so their first
 *  action is not turning the editor red. */
function stock(classKey: string, parts: Placement[], sections: Partial<Sections>,
  faction: string, paint: number): Design {
  return { classKey, parts, sections: { ...zeroSections(), ...sections },
    armour: 'wrapped', faction, paint };
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
    'terran', 0x0095E9),

  // Three bells in a row and a ventral rack. Plate on all four long faces
  // rather than a belt, which is the stacked silhouette read from the inside.
  // Both sponsons ship empty, so arming them is the first thing anyone does.
  stock('karisen_frigate', [
    P('d0', 'DRV-B'), P('d1', 'DRV-B'), P('d2', 'DRV-B'), P('d3', 'DRV-V'),
    P('g0', 'WPN-BB1'), P('g0/t', 'WPN-BM1'), P('m0', 'WPN-ML1'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b4', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('s0', 'WPN-BB1'), P('s0/t', 'WPN-BM1'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'karisen', 0xFA6A0A),

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
    'rogue', 0x494182),

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
    'benefactor', 0x1A7A3E),

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
    'civil', 0xD8E2EC),
];

export const stockFor = (classKey: string): Design => {
  const s = STOCK.find(d => d.classKey === classKey) ?? (STOCK[0] as Design);
  return { classKey: s.classKey, parts: s.parts.map(p => ({ ...p })),
    sections: { ...s.sections }, armour: s.armour, faction: s.faction, paint: s.paint };
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
 * Where each of a faction's eight lands on the hull.
 *
 * Position decides, not chance: the same cell is the same colour on both
 * seats and on a reload, which matters because a livery that reshuffled would
 * read as the ship having changed. Nothing here is hashed or sent to the core,
 * so two players who painted differently still agree on the match.
 *
 * `primary` is the swatch the player picked. The other seven roles stay where
 * the faction authored them, so picking a different primary re-tints the hull
 * without wrecking the scheme: the underside stays dark, the markings stay
 * legible, the stripe stays the stripe.
 */
export function armourColour(sw: readonly number[], primary: number,
  i: number, j: number, k: number,
  z0: number, z1: number, hw: number, hh: number): number {
  const P = (n: number) => (sw[n] ?? primary) as number;
  const dx = (i + 0.5 - CX) / Math.max(1, hw);
  const dy = (j + 0.5 - CY) / Math.max(1, hh);
  const t = (k - z0) / Math.max(1, z1 - z0);        // 0 at the transom, 1 at the nose
  if (t > 0.94) return P(PAINT_ROLE.marking);        // nose flash
  if (t < 0.05) return P(PAINT_ROLE.trim);           // transom band
  if (t > 0.70 && t < 0.78 && Math.abs(dy) < 0.6) return P(PAINT_ROLE.marking);
  if (Math.abs(dy) <= 0.15) return P(PAINT_ROLE.stripe);   // the waist stripe
  if (dy < -0.58) return P(PAINT_ROLE.deep);         // underside
  if (dy > 0.70 && Math.abs(dx) < 0.42) return P(PAINT_ROLE.highlight);
  // Plating panels, coarse enough to read at ship scale.
  const panel = (((k / 7) | 0) + ((i / 5) | 0) + ((j / 5) | 0)) % 3;
  return panel === 0 ? primary
    : panel === 1 ? P(PAINT_ROLE.panel) : P(PAINT_ROLE.secondary);
}

export interface VoxelModel {
  readonly sx: number; readonly sy: number; readonly sz: number;
  /** One material per cell, x fastest then y then z. */
  readonly data: Uint8Array;
  readonly filled: number;
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
      // A box of jets. Four glow nozzles looking out along the flanks, which
      // reads at two cells a side, where a hollow shell reads as nothing:
      // the RCS quad is 2x2x2 and the old rule drew literally zero cells.
      fill(Mat.Machine);
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
        put(0, y, z, y === 0 || y === sy - 1 ? Mat.Case : Mat.Accent);
        put(sx - 1, y, z, y === 0 || y === sy - 1 ? Mat.Case : Mat.Accent);
      }
      for (let z = 0; z < sz; z++) {
        put(0, Math.round(cy), z, Mat.Glow);
        put(sx - 1, Math.round(cy), z, Mat.Glow);
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
