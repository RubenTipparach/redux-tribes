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
  /** How it is drawn. The client owns this and the core never sees it. */
  readonly art: 'bell' | 'nozzle' | 'block' | 'barbette' | 'beamgun' | 'cannon'
    | 'missilecell' | 'bridge' | 'pod' | 'strut';
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
    art: 'nozzle', colour: 0xFA6A0A },
  { id: 'DRV-N', name: 'Light nozzle', cat: 'drive', fits: 'drive',
    size: [4, 4, 4], mass: 12160, hull: 2560, thrust: 15, exhaust: 8.0,
    art: 'nozzle', colour: 0xFA6A0A },
  { id: 'DRV-B', name: 'Standard bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 5], mass: 23750, hull: 5000, thrust: 30, exhaust: 8.5,
    art: 'bell', colour: 0xFA6A0A },
  { id: 'DRV-BR', name: 'Overclocked bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 6], mass: 28500, hull: 6000, thrust: 33, exhaust: 9.5,
    art: 'bell', colour: 0xFF8C3A },
  { id: 'DRV-T', name: 'Tug bell', cat: 'drive', fits: 'drive',
    size: [5, 5, 5], mass: 23750, hull: 5000, thrust: 30, exhaust: 5.0,
    art: 'bell', colour: 0xC9560A },
  { id: 'DRV-H', name: 'Heavy bell', cat: 'drive', fits: 'drive',
    size: [7, 7, 7], mass: 65170, hull: 13720, thrust: 60, exhaust: 7.0,
    art: 'bell', colour: 0xFA6A0A },

  { id: 'RET-S', name: 'Retro nozzle', cat: 'drive', fits: 'retro',
    size: [2, 2, 2], mass: 1520, hull: 320, retro: 5, art: 'nozzle', colour: 0xB4531A },
  { id: 'RET-C', name: 'Retro cluster', cat: 'drive', fits: 'retro',
    size: [6, 3, 3], mass: 10260, hull: 2160, retro: 15, art: 'nozzle', colour: 0xB4531A },

  { id: 'RCS-Q', name: 'RCS quad', cat: 'drive', fits: 'rcs',
    size: [2, 2, 2], mass: 1520, hull: 320, latX: 2, latY: 2, art: 'pod', colour: 0x7C8B9D },
  { id: 'MAN-B', name: 'Manoeuvring block', cat: 'drive', fits: 'rcs',
    size: [3, 3, 3], mass: 5130, hull: 1080, latX: 5, latY: 5, art: 'block', colour: 0x7C8B9D },
  { id: 'MAN-Y', name: 'Yaw block', cat: 'drive', fits: 'rcs',
    size: [4, 3, 3], mass: 6840, hull: 1440, latX: 10, art: 'block', colour: 0x93A6BC },
  { id: 'MAN-P', name: 'Pitch block', cat: 'drive', fits: 'rcs',
    size: [3, 4, 3], mass: 6840, hull: 1440, latY: 10, art: 'block', colour: 0x93A6BC },

  // ------------------------------------------------------------ weapon --
  // The barbette and the gun are separate parts because the archive separates
  // them: Weapon_Base_Cannon.prefab puts its collider and its subsystem proxy
  // on the BASE, not the barrel. The base takes the damage, the barrel turns.
  { id: 'WPN-BB1', name: 'Barbette', cat: 'weapon', fits: 'gun',
    size: [6, 3, 6], mass: 20520, hull: 4320, art: 'barbette', colour: 0x5B6E85 },
  { id: 'WPN-BM1', name: 'Beam turret', cat: 'weapon', fits: 'trunnion',
    size: [4, 4, 10], mass: 30400, hull: 6400, weapon: 'beam',
    art: 'beamgun', colour: 0x4CD97B },
  { id: 'WPN-CN1', name: 'Projectile turret', cat: 'weapon', fits: 'trunnion',
    size: [5, 4, 9], mass: 34200, hull: 7200, weapon: 'projectile',
    art: 'cannon', colour: 0xFF4B4B },
  { id: 'WPN-ML1', name: 'Missile cell', cat: 'weapon', fits: 'missile',
    size: [5, 5, 7], mass: 33250, hull: 7000, weapon: 'missile',
    art: 'missilecell', colour: 0xA98BFF },

  // ----------------------------------------------------------- utility --
  { id: 'UTL-BRG', name: 'Bridge', cat: 'utility', fits: 'bay',
    size: [6, 5, 6], mass: 34200, hull: 7200, art: 'bridge', colour: 0x35C7FF },
  { id: 'UTL-BAR', name: 'Marine barracks', cat: 'utility', fits: 'bay',
    size: [5, 4, 7], mass: 26600, hull: 5600, marines: 5, art: 'block', colour: 0xFFD24B },
  { id: 'UTL-AIR', name: 'Boarding airlock', cat: 'utility', fits: 'bay',
    size: [3, 3, 3], mass: 5130, hull: 1080, capacity: 2, art: 'pod', colour: 0xFFD24B },
  { id: 'UTL-CLM', name: 'Boarding clamp', cat: 'utility', fits: 'clamp',
    size: [5, 4, 6], mass: 22800, hull: 4800, reach: 5, art: 'block', colour: 0xFFD24B },
  { id: 'UTL-CGO', name: 'Cargo bay', cat: 'utility', fits: 'bay',
    size: [10, 8, 13], mass: 197600, hull: 41600, art: 'block', colour: 0x6E7F94 },

  // --------------------------------------------------------- structure --
  // A strut carries nothing in v1. An autorouted, freely meshed power grid is
  // a button that solves itself; this is simply how you attach a component
  // that is not already touching the hull. It gains the severance rule on the
  // day power exists.
  { id: 'STR-STRUT', name: 'Strut', cat: 'structure', fits: 'bay',
    size: [1, 1, 1], mass: 190, hull: 40, art: 'strut', colour: 0x3D5266 },
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
  readonly spine: ReadonlyArray<readonly [number, number, number, number, number, number]>;
  readonly sockets: readonly Socket[];
  readonly note: string;
}

/** Centre of the lattice, so a frame can be authored symmetrically. */
const CX = NX / 2, CY = NY / 2;

/** A keel run: one box from z0 to z1 along the middle. */
const keel = (y: number, z0: number, z1: number, w = 4, h = 3) =>
  [CX - w / 2, y - h / 2, z0, w, h, z1 - z0] as const;
/** A rib ring at z, drawn as a flat band. */
const rib = (z: number, w: number, h: number) =>
  [CX - w / 2, CY - h / 2, z, w, h, 1] as const;

const ribs = (zs: readonly number[], w: number, h: number) => zs.map(z => rib(z, w, h));

export const FRAMES: readonly FrameDef[] = [
  {
    classKey: 'terran_frigate', name: 'Terran Frigate', rung: 'frigate',
    radius: 3.5, massMax: 1.0, baseReach: 10, baseMarines: 0, baseCapacity: 0,
    spine: [keel(CY, 6, 56), ...ribs([10, 17, 24, 31, 38, 45, 52], 20, 12)],
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
    spine: [keel(CY, 8, 54), keel(CY + 5, 12, 50, 8, 2), keel(CY - 5, 4, 58, 5, 3),
      ...ribs([12, 19, 26, 33, 40, 47], 22, 11)],
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
    spine: [keel(CY, 14, 48), [CX - 13, CY - 2, 26, 26, 4, 5] as const,
      ...ribs([18, 24, 30, 36, 42], 24, 13)],
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
      { id: 'b1', kind: 'bay', at: [CX - 9, CY, 28], label: 'gallery bay, port outer' },
      { id: 'b2', kind: 'bay', at: [CX - 4, CY, 28], label: 'gallery bay, port inner' },
      { id: 'b3', kind: 'bay', at: [CX + 4, CY, 28], label: 'gallery bay, starboard inner' },
      { id: 'b4', kind: 'bay', at: [CX + 9, CY, 28], label: 'gallery bay, starboard outer' },
      { id: 'b5', kind: 'bay', at: [CX - 7, CY, 22], label: 'gallery bay, port aft' },
      { id: 'b6', kind: 'bay', at: [CX + 7, CY, 22], label: 'gallery bay, starboard aft' },
      { id: 'b7', kind: 'bay', at: [CX, CY - 4, 22], label: 'bay, ventral' },
      { id: 'b8', kind: 'bay', at: [CX - 12, CY + 2, 26], label: 'collar, port' },
      { id: 'b9', kind: 'bay', at: [CX + 12, CY + 2, 26], label: 'collar, starboard' },
      { id: 'c0', kind: 'clamp', at: [CX - 14, CY, 30], label: 'clamp, port forward' },
      { id: 'c1', kind: 'clamp', at: [CX + 14, CY, 30], label: 'clamp, starboard forward' },
      { id: 'c2', kind: 'clamp', at: [CX - 14, CY, 24], label: 'clamp, port aft' },
      { id: 'c3', kind: 'clamp', at: [CX + 14, CY, 24], label: 'clamp, starboard aft' },
      { id: 'a0', kind: 'bay', at: [CX - 12, CY - 4, 30], label: 'collar, port forward' },
      { id: 'a1', kind: 'bay', at: [CX + 12, CY - 4, 30], label: 'collar, starboard forward' },
      { id: 'a2', kind: 'bay', at: [CX - 12, CY - 4, 24], label: 'collar, port aft' },
      { id: 'a3', kind: 'bay', at: [CX + 12, CY - 4, 24], label: 'collar, starboard aft' },
      { id: 'a4', kind: 'bay', at: [CX, CY - 6, 27], label: 'collar, ventral' },
      { id: 'b10', kind: 'bay', at: [CX - 4, CY + 4, 36], label: 'bay, spare port' },
      { id: 'b11', kind: 'bay', at: [CX + 4, CY + 4, 36], label: 'bay, spare starboard' },
      { id: 'c4', kind: 'clamp', at: [CX - 14, CY + 4, 27], label: 'clamp, port upper' },
      { id: 'c5', kind: 'clamp', at: [CX + 14, CY + 4, 27], label: 'clamp, starboard upper' },
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
    spine: [keel(CY, 14, 56), keel(CY - 7, 4, 20, 5, 4), keel(CY + 6, 4, 20, 5, 3),
      ...ribs([18, 25, 32, 39, 46, 52], 16, 20)],
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
    spine: [keel(CY, 12, 48), keel(CY, 16, 44, 14, 1), ...ribs([18, 26, 34, 40], 14, 12)],
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

export const frameFor = (classKey: string): FrameDef =>
  FRAMES.find(f => f.classKey === classKey) ?? (FRAMES[0] as FrameDef);

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
}

export interface Design {
  classKey: string;
  /** One entry per filled socket. A socket holds at most one part. */
  parts: Placement[];
  sections: Sections;
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

/** Mass in uM per cell of plate, and hull in milli HP per enclosed cell. */
const PLATE_UM = 33, HULL_MILLI = 17;
/** How much bigger this rung's cell is than a frigate's, cubed. Plate is a
 *  volume of material, so it scales; a part is a machine, so it does not. */
const rungVol = (rung: RungKey): number => (RUNG[rung] / RUNG.frigate) ** 3;

/** Turn length, from prototype/sim/data.js CONST. */
const TURN_SECONDS = 10;

/**
 * How many cells a section's plating costs, per layer.
 *
 * The envelope is a box of the frame's own extent, so a face's area is the
 * product of the two axes it spans. Belt bands are thirds of the two flanks,
 * which is what lets a player armour the middle and leave the ends thin.
 */
function sectionArea(ext: readonly [number, number, number]): Record<SectionKey, number> {
  const [x, y, z] = ext;
  const flank = Math.round((y * z) / 3);
  return {
    bow: x * y, stern: x * y,
    port: 0, starboard: 0,
    dorsal: x * z, ventral: x * z,
    beltFwd: flank * 2, beltMid: flank * 2, beltAft: flank * 2,
  };
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

  // --- the envelope, from the frame's own extent -------------------------
  let lo = [NX, NY, NZ], hi = [-1, -1, -1];
  for (const [x, y, z, w, h, l] of frame.spine) {
    lo = [Math.min(lo[0] ?? 0, x), Math.min(lo[1] ?? 0, y), Math.min(lo[2] ?? 0, z)];
    hi = [Math.max(hi[0] ?? 0, x + w), Math.max(hi[1] ?? 0, y + h), Math.max(hi[2] ?? 0, z + l)];
  }
  const allSockets = socketsOf(frame, d.parts);
  for (const p of d.parts) {
    const s = allSockets.find(k => k.id === p.socket);
    const m = moduleById(p.module);
    if (!s || !m) continue;
    for (let a = 0; a < 3; a++) {
      const half = (m.size[a] ?? 1) / 2;
      lo[a] = Math.min(lo[a] ?? 0, Math.round((s.at[a] ?? 0) - half));
      hi[a] = Math.max(hi[a] ?? 0, Math.round((s.at[a] ?? 0) + half));
    }
  }
  const ext = [
    Math.max(1, (hi[0] ?? 1) - (lo[0] ?? 0)),
    Math.max(1, (hi[1] ?? 1) - (lo[1] ?? 0)),
    Math.max(1, (hi[2] ?? 1) - (lo[2] ?? 0)),
  ] as [number, number, number];

  // --- plate, and what it costs -----------------------------------------
  const area = sectionArea(ext);
  let plateCells = 0;
  for (const k of SECTIONS) plateCells += (area[k] ?? 0) * (d.sections[k] ?? 0);
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
  const radius = Math.sqrt(ext[0] ** 2 + ext[1] ** 2 + ext[2] ** 2) * cell / 2;

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
  paint: number): Design {
  return { classKey, parts, sections: { ...zeroSections(), ...sections }, paint };
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
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 1, ventral: 1, bow: 1, stern: 1 },
    0x0095E9),

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
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 2, ventral: 2, bow: 1, stern: 1 },
    0xFA6A0A),

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
    0x494182),

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
    0x1A7A3E),

  // A hold and a skin. Two holds are most of what it has, and no gun ring
  // exists on the frame at all.
  stock('freighter', [
    P('d0', 'DRV-T'), P('d1', 'DRV-T'), P('d2', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'), P('p0', 'MAN-B'), P('p1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('h0', 'UTL-CGO'), P('h1', 'UTL-CGO'),
    P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'), P('b3', 'UTL-BAR'),
    P('b4', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('b6', 'UTL-AIR'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    0xD8E2EC),
];

export const stockFor = (classKey: string): Design => {
  const s = STOCK.find(d => d.classKey === classKey) ?? (STOCK[0] as Design);
  return { classKey: s.classKey, parts: s.parts.map(p => ({ ...p })),
    sections: { ...s.sections }, paint: s.paint };
};
