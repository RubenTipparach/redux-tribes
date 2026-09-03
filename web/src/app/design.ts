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

/**
 * The hull lattice, and the one voxel every hull is built out of.
 *
 * A voxel is the SAME SIZE on every class. That is the whole point of the
 * lattice: a bigger ship is more cells, not bigger cells, so its plating,
 * its guns and its engines are counted rather than scaled and "how big is a
 * heavy cruiser" is answered by the model instead of by a multiplier.
 *
 * It did not used to be. Every class was 32 x 32 x 64 and a rung was a CELL
 * SIZE, so a heavy cruiser was a frigate drawn at four times the magnification
 * with exactly as much detail in it: the Karisen cruiser carried the same
 * number of voxels as its own frigate at 4.34 times the length. Nothing in the
 * fleet said a big ship was a big ship, because nothing counted.
 *
 * So the LATTICE is the rung now, and `VOXEL` is a constant.
 */
export interface Lat {
  readonly nx: number; readonly ny: number; readonly nz: number;
  /** Cells in the whole lattice, which is what every grid is sized on. */
  readonly cells: number;
  /**
   * The centre, which is a cell BOUNDARY and not a cell: on a lattice of 32
   * the plane a ship is symmetric about runs between columns 15 and 16. Every
   * mirrored pair in the file goes through `PX`/`SX` or `acrossFrom` for that
   * reason, and both of them start here.
   */
  readonly cx: number; readonly cy: number;
  /**
   * The thickest a FRAME member may be, in cells.
   *
   * A keel run is a BEAM, and a beam is the same beam whatever it is holding
   * up: it does not scale with the ship, any more than a turret or a drive
   * bell does. Scaling its section with the lattice was a mistake and it is
   * the one thing a bigger lattice makes worse rather than better, because a
   * solid box is the only thing in the model that gains nothing from more
   * cells. The Terran heavy cruiser's raised dorsal run came out 20 cells
   * across and 4 deep over 84 stations: a grey slab welded along the top of
   * the ship, standing proud of an elliptical deck that a flat box cannot
   * follow. 1496 of its frame cells were outside its own hull, against 0 on
   * every frigate and corvette in the fleet.
   *
   * So a section is capped in real cells, and only the RUN scales.
   */
  readonly beam: number;
}
const lat = (nx: number, ny: number, nz: number, beam: number): Lat =>
  ({ nx, ny, nz, cells: nx * ny * nz, cx: nx / 2, cy: ny / 2, beam });

/**
 * One voxel, in world units, on every hull in the game.
 *
 * 3.5/64 = 0.0546875, which is 7 x 2^-7 and therefore exact in f32. It is the
 * frigate's own cell, so a Terran frigate is the same 3.17 units it has always
 * been and the rest of the fleet is measured against it.
 *
 * The ladder is a CONSEQUENCE of this and of the lattice, and it is worth
 * being plain about what that costs: a heavy cruiser is twice a frigate rather
 * than four times, because 128 cells over 64 is two. Anchoring the voxel at
 * half this would put the cruiser back at four times the frigate and halve the
 * frigate as well. One constant, and nothing else in the file cares.
 */
export const VOXEL = 3.5 / 64;

/**
 * The four lattices, which are the four sizes of ship.
 *
 * 24 x 24 x 48, 32 x 32 x 64, 48 x 48 x 96, 64 x 64 x 128: the ladder is
 * 0.75, 1, 1.5, 2 in every dimension at once, and a heavy cruiser therefore
 * carries eight times a frigate's volume in cells rather than the same cells
 * eight times as big. That is what buys it more armour, more mounts and more
 * berths, and what makes it slow: mass is plate cells, and it has eight times
 * as many to push with engines that are the same engines.
 *
 * Four, and the civil trades sit on them too. A rung used to be a cell size,
 * and twice a class was quietly moved because a neighbour sharing its rung
 * changed; that hazard is gone, because what separates two classes on one
 * lattice is `REACHES` and `FULLNESS`, and both of those are keyed on the TIER.
 */
export const RUNG = {
  corvette: lat(24, 24, 48, 2),
  frigate: lat(32, 32, 64, 2),
  escort: lat(48, 48, 96, 2),
  cruiser: lat(64, 64, 128, 3),
} as const;
export type RungKey = keyof typeof RUNG;

/**
 * The lattice everything authored by hand is authored ON.
 *
 * A section, a socket and a spine run are written once, in frigate cells, and
 * cut to whichever lattice the class is drawn on. Four hand written copies of
 * a Terran would be four Terrans that drift.
 */
const REF: Lat = RUNG.frigate;

/** The lattice a frame is drawn on. */
export const latOf = (frame: { readonly rung: RungKey }): Lat => RUNG[frame.rung];

/**
 * The lattice the FRAMES table is being authored on, while it is being built.
 *
 * The table names cells outright (`PX(4)`, `keel(CY, 6, 56)`, a drive at z 4),
 * and those cells mean different things on four different lattices, so the
 * table is evaluated ONCE PER RUNG with this set and each frame keeps the pass
 * that matches its own rung. It is set only during that build and read only by
 * the authoring helpers; nothing at raster time may touch it, because by then
 * there are twenty three frames on four lattices and only one of them can be
 * the ambient one.
 */
let A: Lat = RUNG.frigate;

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
  // Seven greys and a gold was a merchant fleet in which every box on every
  // deck came out the same pale grey. A hull's own plating is still white and
  // grey, because that is what a civil hull is painted, but the palette now
  // carries the three colours a container yard actually has in it: a line
  // blue, a rust red and a green. The livery puts them where the ship is not
  // (the belt, the trim, the cargo), which is exactly what they are for.
  { key: 'civil', name: 'Civilian', swatches:
    [0xD8E2EC, 0xB9C6D4, 0x2E6F9E, 0xB4472B, 0xF2F5F8, 0x2A2E33, 0x2E8B76, 0xC0A24A] },
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
  { key: 'crate', name: 'Container' },
];

export const DEFAULT_FINISH = 'plate';
/**
 * What the surfaces that are not armour wear until asked otherwise.
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
 * The five surfaces a hull is drawn with, resolved.
 *
 * ONE place decides what a design's armour, frame, drives, guns and other
 * machinery are made of, because four pictures ask it: the map, the shipyard,
 * the schematic and the chip thumbnail. Each spelling out its own `?? DEFAULT`
 * chain is four places to change and three of them to forget, which is the
 * divergence GUIDELINES 5.1 is about, and it is exactly how the wound came to
 * draw its plate in a finish the hull beside it was not wearing.
 *
 * The armour answer is the PICKED SLOT's, falling back to the hull wide
 * finish for a design that has never set one.
 */
export function finishesOf(d: {
  faction: string; paint: number;
  finish?: string; slotFinish?: (string | null)[];
  frameFinish?: string; partFinish?: string;
  driveFinish?: string; weaponFinish?: string;
}): { armour: string; frame: string; part: string;
  drive: string; weapon: string } {
  const slot = paintFor(d.faction).swatches.indexOf(d.paint);
  const picked = slot >= 0 ? d.slotFinish?.[slot] : null;
  return {
    armour: picked || d.finish || DEFAULT_FINISH,
    frame: d.frameFinish || DEFAULT_FRAME_FINISH,
    part: d.partFinish || DEFAULT_PART_FINISH,
    // Machinery split three ways. It was ONE finish for everything a part is
    // made of, on the grounds that a player can already tell a drive from a
    // gun by its COLOUR and the distinction worth having was machinery
    // against plate. That is still true of the colour and it was never true
    // of the SURFACE: a drive bell is a cast nozzle, a turret is a machined
    // gun, and a barracks is a box, and one greeble over all three says none
    // of it. Each falls back to the old single answer, so a design that never
    // set them looks exactly as it did.
    drive: d.driveFinish || d.partFinish || DEFAULT_PART_FINISH,
    weapon: d.weaponFinish || d.partFinish || DEFAULT_PART_FINISH,
  };
}

export const paintFor = (key: string) =>
  FACTION_PAINT.find(f => f.key === key) ?? (FACTION_PAINT[0] as typeof FACTION_PAINT[number]);


// --------------------------------------------------------------- livery --

/**
 * What a patch of armour is FOR, which is what decides its colour and which
 * of the three plating finishes it wears.
 *
 * A hull used to be one colour and one normal map from transom to nose, and
 * seventeen ships drawn that way are seventeen ships a player tells apart by
 * hue alone. Eight roles is the whole palette used on every hull, and it is
 * the same eight on every navy, so a deck is a deck and a belt is a belt
 * whoever built the ship.
 *
 * This is a RETURN, and the thing it returns to was deleted on purpose, so
 * the objection is worth answering rather than stepping round. The old
 * scheme spread eight swatches over a hull by position and left the player
 * picking a colour they then could not see: the pick became a seed for a
 * scheme rather than the colour of the ship. What is different here is that
 * the pick is role ZERO. Every other role is a fixed OFFSET from it round
 * the palette, so the hull is the colour that was picked, the rest of the
 * scheme turns with it, and picking the next swatch along really does
 * repaint the whole ship rather than one part of it.
 */
export type LiveryRole =
  | 'hull' | 'belt' | 'deck' | 'underside' | 'bow' | 'stern' | 'trim' | 'decor';

export const LIVERY_ROLES: readonly LiveryRole[] =
  ['hull', 'belt', 'deck', 'underside', 'bow', 'stern', 'trim', 'decor'];

/** Role in one byte beside the material, the way purpose already is. Zero
 *  means the cell is not armour at all. */
export const roleCode = (r: LiveryRole): number => LIVERY_ROLES.indexOf(r) + 1;
export const roleAt = (code: number): LiveryRole =>
  LIVERY_ROLES[Math.max(0, code - 1)] ?? 'hull';

/**
 * The three plating surfaces a hull is drawn with.
 *
 * Colour is free: a vertex carries its own and any number of them merge into
 * one draw. A NORMAL MAP is not, because a map is a material and a material
 * is a draw call, so "different patterns on one ship" costs one group per
 * pattern. Three is the number that buys the distinction the eye actually
 * reads at map range: the broad plating, the trim that runs along it, and the
 * structure bolted onto it. A fourth would be a draw nobody could name.
 */
export const ARMOUR_BANDS = 3;
export type ArmourBand = 0 | 1 | 2;

/** Which band each role draws in. Broad plating, then the trim that runs
 *  along a hull, then what is bolted to the outside of it. */
export const ROLE_BAND: Record<LiveryRole, ArmourBand> = {
  hull: 0, bow: 0, stern: 0,
  belt: 1, deck: 1, trim: 1,
  underside: 2, decor: 2,
};

export interface LiveryDef {
  /** Where each role sits relative to the PICKED swatch, round the eight.
   *  A permutation, so every swatch in the palette lands on the ship. */
  readonly offset: Record<LiveryRole, number>;
  /** The finish each band wears, as a key in `FINISHES`. */
  readonly finish: readonly [string, string, string];
  /** Metalness and roughness per band. A drive bell and a painted panel are
   *  not the same surface, and neither are a hull and the raw structure
   *  welded to it. */
  readonly pbr: readonly [
    readonly [number, number], readonly [number, number], readonly [number, number]];
}

/**
 * Each navy's scheme, which is its own description read back.
 *
 * Terran is a working navy: riveted plate with a corrugated deck and greebled
 * structure, the deck light and the underside dark, the way a ship that is
 * meant to be seen from above by its own tenders is painted. Karisen plates
 * all four long faces and stacks its silhouette, so corrugation is the broad
 * surface and composite is the trim. Rogue is battered everywhere and patched
 * where it has been mended, and its accent is the one bright thing on it.
 * Benefactor is ablative hex with composite trim, tight and engineered.
 * Civil yards run grip deck with patched trim and painted plate on the racks,
 * because a freighter is a hold that people walk about on.
 *
 * The offsets are permutations of nought to seven. That is the whole
 * guarantee that a ship uses its entire palette: eight roles, eight distinct
 * offsets, one swatch each.
 */
export const LIVERY: Record<FactionKey, LiveryDef> = {
  terran: {
    offset: { hull: 0, trim: 1, belt: 2, underside: 3, deck: 4, bow: 5, stern: 6, decor: 7 },
    finish: ['plate', 'ribbed', 'greeble'],
    pbr: [[0.30, 0.50], [0.38, 0.44], [0.48, 0.58]],
  },
  karisen: {
    offset: { hull: 0, belt: 1, stern: 2, underside: 3, decor: 4, trim: 5, deck: 6, bow: 7 },
    finish: ['ribbed', 'weave', 'plate'],
    pbr: [[0.35, 0.45], [0.30, 0.52], [0.42, 0.48]],
  },
  rogue: {
    offset: { hull: 0, bow: 1, underside: 2, deck: 3, stern: 4, decor: 5, belt: 6, trim: 7 },
    finish: ['battered', 'cracked', 'tread'],
    pbr: [[0.18, 0.72], [0.14, 0.78], [0.24, 0.66]],
  },
  benefactor: {
    offset: { hull: 0, trim: 1, belt: 2, stern: 3, bow: 4, deck: 5, underside: 6, decor: 7 },
    finish: ['hex', 'weave', 'plate'],
    pbr: [[0.45, 0.30], [0.40, 0.36], [0.52, 0.34]],
  },
  civil: {
    offset: { hull: 0, trim: 1, deck: 2, decor: 3, bow: 4, underside: 5, stern: 6, belt: 7 },
    finish: ['tread', 'cracked', 'plate'],
    pbr: [[0.15, 0.70], [0.12, 0.76], [0.22, 0.58]],
  },
};

/**
 * Where each role SITS on a hull, in fractions rather than in cells.
 *
 * Fractions because the same scheme has to land on a corvette and on a heavy
 * cruiser, and on a section twice as deep as it is wide. All of it is read off
 * the same normalised coordinates the shell already computes to decide how
 * thick the plate is there, so a livery cannot move a single cell: it is a
 * second answer about a cell that exists either way.
 */
const BOW_BAND = 0.09, STERN_BAND = 0.07;
/** Half the height of the stripe that runs the length of a flank, as a
 *  fraction of the half depth. Thin on purpose: a stripe as deep as the belt
 *  is not a stripe, it is a second belt. */
const TRIM_HALF = 0.14;
/** Where the waist belt runs, along the length. Inside the bow and stern
 *  bands by construction, so the three never argue about a cell. */
const BELT_FROM = 0.30, BELT_TO = 0.68;

/**
 * What role a plate cell plays, from where it is on the hull.
 *
 * `t` runs 0 at the transom to 1 at the nose; `dx` and `dy` are the cell's
 * offset from the centreline as fractions of the half beam and half depth at
 * its own station, which is exactly what makes this work on any section.
 * Ordered, and the order is the rule: the ends win over everything, then the
 * deck and the belly, then the stripe, then the waist.
 */
export const roleOfCell = (t: number, dx: number, dy: number): LiveryRole => {
  // The deck and the belly win over the ends, and that order is the rule
  // rather than an accident of writing. Taken the other way round, a blunt
  // bow put every cell of its forward ninth into one colour, deck and belly
  // included, and a heavy cruiser came out with a painted nose cone instead
  // of a flash on its cheeks.
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'deck' : 'underside';
  if (t < STERN_BAND) return 'stern';
  if (t > 1 - BOW_BAND) return 'bow';
  if (Math.abs(dy) < TRIM_HALF) return 'trim';
  return t >= BELT_FROM && t <= BELT_TO ? 'belt' : 'hull';
};

export const liveryFor = (faction: string): LiveryDef =>
  LIVERY[faction as FactionKey] ?? (LIVERY.terran as LiveryDef);

/**
 * The colour of one role on one ship, and the only place that is decided.
 *
 * The picked swatch is role `hull` by construction: the pick's own index is
 * added to every offset, so the hull comes out exactly the colour the player
 * chose and the rest of the scheme rotates with it. A design carrying a paint
 * value that is not in its faction's palette (a hand edited record, or a
 * faction renamed under a saved hull) falls back to slot zero rather than
 * throwing, because a hull with an odd colour is still a hull.
 */
export function roleColour(faction: string, paint: number, role: LiveryRole): number {
  const swatches = paintFor(faction).swatches;
  const picked = swatches.indexOf(paint);
  const at = (picked < 0 ? 0 : picked) + liveryFor(faction).offset[role];
  return (swatches[at % swatches.length] as number) ?? paint;
}

/**
 * What each band of plating is made of on this design.
 *
 * Band nought is the hull wide answer `finishesOf` already gives, so the
 * finish a player picks in the yard still means the broad plating and nothing
 * moved under them. The other two default to the navy's own livery and can be
 * overridden per band, which is what lets a Terran hull painted in Karisen
 * orange still read as a Terran.
 */
export function bandFinishes(d: {
  faction: string; paint: number;
  finish?: string; slotFinish?: (string | null)[]; bandFinish?: (string | null)[];
}): readonly [string, string, string] {
  const l = liveryFor(d.faction);
  return [
    finishesOf(d).armour,
    d.bandFinish?.[1] || (l.finish[1] as string),
    d.bandFinish?.[2] || (l.finish[2] as string),
  ];
}

// ---------------------------------------------------------------- parts --

/** What a socket will accept. A part never fits a socket of another kind. */
/**
 * Every kind of station a frame can carry.
 *
 * A runtime list with the type read OFF it, rather than a union beside an
 * array somebody has to remember to extend twice. The architect reads untrusted
 * JSON and has to be able to ask "is this a kind this build has", and the only
 * way that answer stays true is if there is one list to ask.
 *
 * `rack` is a cargo station ON the hull rather than inside it. A container ship
 * whose containers are enclosed bays is a grey slab with the cargo invisible
 * inside it, which is what the first cut of the civil fleet came out as. A box
 * is carried on deck, in tiers, and it is the boxes that make the ship read as
 * a merchantman at all: this is the one socket kind whose whole point is that
 * the part STANDS OUT.
 */
export const SOCKET_KINDS = [
  'drive', 'retro', 'rcs', 'gun', 'trunnion', 'missile', 'bay', 'clamp', 'rack',
] as const;

export type SocketKind = typeof SOCKET_KINDS[number];

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
  readonly window?: 'porthole' | 'panes' | 'strip' | 'bridge' | 'beacons' | 'hangar'
    | 'cargo' | 'promenade' | 'louvre';
  /** How it is drawn. The client owns this and the core never sees it. */
  readonly art: 'bell' | 'nozzle' | 'block' | 'barbette' | 'beamgun' | 'cannon'
    | 'missilecell' | 'bridge' | 'pod' | 'strut'
    | 'rcs' | 'barracks' | 'airlock' | 'clamp' | 'cargo'
    | 'container' | 'tank' | 'hopper' | 'gallery' | 'drill';
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

  // -------------------------------------------------- appended, always --
  //
  // A part's POSITION in this table is its index, and that index is what
  // `partsOf` hands across the boundary to `design.rs`, which holds the same
  // table in the same order. So a new part goes on the END, however tidily it
  // would have grouped with the ones above it: slid in beside the cargo bay,
  // these six renumbered the strut, and a hull carrying one would have been
  // derived as though it carried something else.
  // A gallery is a corridor with a view: no marines, no capacity, and the one
  // room a warship carries purely so the crew can see out. It is what puts a
  // long lit band down a flank instead of another row of portholes.
  { id: 'UTL-OBS', name: 'Observation gallery', cat: 'utility', fits: 'bay',
    size: [6, 3, 8], mass: 27360, hull: 5760, purpose: 'command', art: 'gallery',
    window: 'strip', colour: 0x3FD97C },

  // ------------------------------------------------------------- civil --
  //
  // What a hull carries when it is not carrying guns. Every one of these is a
  // volume with a face a viewer can read at range: a container's doors, a
  // tank's radiator slats, a liner's promenade. A civil ship drawn without
  // them is a grey lozenge with an engine, which is exactly what the freighter
  // was.
  { id: 'UTL-CTR', name: 'Container', cat: 'utility', fits: 'rack',
    size: [7, 6, 11], mass: 87780, hull: 18480, purpose: 'structure', art: 'container',
    window: 'cargo', colour: 0x8494A8 },
  { id: 'UTL-TNK', name: 'Pressure tank', cat: 'utility', fits: 'rack',
    size: [8, 8, 12], mass: 145920, hull: 30720, purpose: 'structure', art: 'tank',
    window: 'louvre', colour: 0x8494A8 },
  { id: 'UTL-ORE', name: 'Ore hopper', cat: 'utility', fits: 'rack',
    size: [9, 7, 12], mass: 143640, hull: 30240, purpose: 'structure', art: 'hopper',
    window: 'louvre', colour: 0x8494A8 },
  { id: 'UTL-PAX', name: 'Passenger deck', cat: 'utility', fits: 'bay',
    size: [7, 5, 10], mass: 66500, hull: 14000, marines: 2, purpose: 'crew', art: 'gallery',
    window: 'promenade', colour: 0xFFC93C },
  // A cutting head on an arm, which is the one civil fitting that stands
  // proud: it has to reach the rock. It goes on a gun ring because a ring is
  // the frame's own answer to "something turns here", and a mining ship's
  // whole shape is that arm swinging.
  { id: 'UTL-DRL', name: 'Cutting head', cat: 'utility', fits: 'trunnion',
    size: [5, 5, 9], mass: 42750, hull: 9000, purpose: 'structure', art: 'drill',
    colour: 0xB0BDCB },
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
  /**
   * Which way a mount on this socket rests, in quarter turns about the hull's
   * up axis, before the player rotates it.
   *
   * A frame knows which way its own rings face and a placement does not: a
   * ring on the port flank is a BROADSIDE mount, and a broadside gun resting
   * dead ahead is a gun looking down the length of its own ship. Every stock
   * turret on a flank ring was doing exactly that, and the arc scan agreed
   * with the picture: nine of them could not see the way they were pointing at
   * all, and two ventral rings on the Terran heavy cruiser were blocked in
   * every direction there is.
   *
   * The player's `rot` is added to this rather than replacing it, so turning a
   * mount still means turning it FROM where its ring puts it.
   */
  readonly facing?: number;
}

/**
 * How a mount is actually bolted on: where its ring SEATS it, plus whatever
 * the player turned it from there.
 *
 * Two rotations with two different authors, and keeping them apart is the
 * point. The SEAT is derived from the hull: which face the ring is on
 * (`mountRoll`) and which way a ring on that face rests (`Socket.facing`).
 * The player's `Facing` is authored, three quarter turns about three axes,
 * and it is a turn FROM the seat rather than a replacement for it: a
 * broadside gun nudged one quarter is still a broadside gun.
 *
 * They compose in `faceBasis`'s own order, yaw then pitch then roll, which is
 * what makes this a composition rather than three numbers added. The seat's
 * yaw and the player's are the same axis and commute; the seat's ROLL lands
 * last, so it takes the whole authored assembly and lays it on its face
 * instead of turning the barrel inside a mount already on one.
 *
 * One helper, because the rasteriser, the map and the yard all have to agree
 * or a barrel is drawn somewhere it does not fire.
 */
export function seatedFacing(
  frame: FrameDef, sock: Socket | undefined,
  p: { rot?: number; pitch?: number; roll?: number },
): Facing {
  const f = facingOf(p);
  const q = (n: number) => ((n % 4) + 4) % 4;
  return {
    yaw: q(f.yaw + (sock?.facing ?? 0)),
    pitch: f.pitch,
    roll: q(f.roll + mountRoll(frame, sock)),
  };
}

/**
 * Which way is UP for a mount: quarter turns about the keel axis that take a
 * part's own +y onto the hull face it stands on.
 *
 * A turret is a drum with a toothed ring on one end and a flat base on the
 * other, and the base BOLTS TO SOMETHING. Drawn always +y up, a mount under
 * the keel had its ring pointing into its own ship and its base out at
 * vacuum, and one on a flank had neither end against the plating at all: it
 * hung off the side by its rim. Nine of the fleet's fifty two rings were on a
 * flank and another dozen under the keel, so most of the fleet's guns were
 * bolted to nothing.
 *
 * So a mount is rolled onto its face, and its base always points at the core.
 * The turn is about +z, which is the keel, because a hull face here is either
 * a flank or a deck: (x, y) -> (-y, x) a quarter at a time, so one quarter
 * puts +y outboard to port and three put it to starboard.
 *
 * Only guns roll. A drive bell and a retro point along the keel whatever they
 * are bolted to, a thruster block is a piece of the skin rather than a thing
 * standing on it, and a magazine is inside the ship where there is no face to
 * stand on.
 */
export const mountRoll = (frame: FrameDef, sock: Socket | undefined): number => {
  if (!sock || (sock.kind !== 'gun' && sock.kind !== 'trunnion')) return 0;
  const [ox, oy] = outwardAt(latOf(frame), frame.profile, sock.at);
  if (ox) return ox > 0 ? 3 : 1;
  return oy >= 0 ? 0 : 2;
};

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
  drive: 'proud', retro: 'proud', gun: 'proud', trunnion: 'proud', rack: 'proud',
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
export type TierKey = 'corvette' | 'frigate' | 'destroyer' | 'cruiser'
  | 'freighter' | 'lighter' | 'hauler' | 'boxship' | 'tanker' | 'miner' | 'liner';

export const TIER_NAMES: Record<TierKey, string> = {
  corvette: 'Corvette', frigate: 'Frigate', destroyer: 'Destroyer',
  cruiser: 'Heavy Cruiser',
  // The civil yards do not build a ladder, they build TRADES, and the tier is
  // what a hull is for rather than how big it is. It has to be its own key per
  // hull all the same: the class picker addresses a class by the pair
  // (faction, tier) and takes the first match, so two civil hulls sharing one
  // tier would leave the second unreachable from the shipyard with nothing
  // saying so.
  freighter: 'Freighter', lighter: 'Lighter', hauler: 'Hauler',
  boxship: 'Container Ship', tanker: 'Tanker', miner: 'Mining Ship',
  liner: 'Liner',
};

export const FACTION_ORDER: readonly FactionKey[] =
  ['terran', 'karisen', 'rogue', 'benefactor', 'civil'];

export const TIER_ORDER: readonly TierKey[] =
  ['corvette', 'frigate', 'destroyer', 'cruiser',
    'lighter', 'freighter', 'hauler', 'boxship', 'tanker', 'miner', 'liner'];

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

/**
 * A reference cell count, cut to the lattice this frame is being authored on.
 *
 * Everything the table writes by hand is written in frigate cells, so `Z(48)`
 * is "forty eight cells along a frigate" and is 96 on a heavy cruiser, which
 * is the same PLACE on a hull twice the size. Writing 48 outright would put a
 * cruiser's bow thruster amidships.
 */
const Z = (n: number): number => Math.round(n * A.nz / REF.nz);
/** The same, across the beam and up the depth. */
const RX = (n: number): number => Math.round(n * A.nx / REF.nx);
const RY = (n: number): number => Math.round(n * A.ny / REF.ny);
/** A row `n` reference cells above the keel line, or below it if negative. */
const UY = (n: number): number => A.cy + RY(n);

/**
 * A raw spine slab: low corner `dx`, `dy` reference cells off the keel line at
 * reference station `z`, spanning `w` reference cells across the beam and `h`
 * by `l` cells THICK.
 *
 * The span scales with the ship, because a gantry welded across a Rogue's beam
 * is across the beam whatever the beam is. The thickness does not, for the
 * reason `Lat.beam` gives.
 */
const slab = (dx: number, dy: number, z: number,
  w: number, h: number, l: number) =>
  [A.cx + RX(dx), A.cy + RY(dy), Z(z),
    RX(w), Math.min(h, A.beam), Math.min(l, A.beam)] as const;

/**
 * A keel run: one member from z0 to z1 along the middle, `dy` cells off the
 * keel line, `w` by `h` in section.
 *
 * Where it RUNS is reference cells cut to the lattice; what it is MADE OF is
 * capped at `Lat.beam` and never scaled. So a class authored with a heavy
 * dorsal girder still gets the heaviest member its rung allows and a class
 * authored with a light one still gets a light one, and neither becomes a
 * block on a bigger hull.
 */
const keel = (dy: number, z0: number, z1: number, w = 4, h = 3) => {
  const y = UY(dy), zw = Math.min(w, A.beam), zh = Math.min(h, A.beam);
  return [A.cx - zw / 2, y - zh / 2, Z(z0), zw, zh, Z(z1) - Z(z0)] as const;
};
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
export function insideHull(L: Lat, profile: readonly Station[],
  i: number, j: number, z: number, inset = 0): boolean {
  const [hw, hh] = hullAt(profile, z);
  const a = Math.max(0.5, (hw as number) - inset), b = Math.max(0.5, (hh as number) - inset);
  const dx = i + 0.5 - L.cx, dy = j + 0.5 - L.cy;
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
    if (i < 0 || j < 0 || i >= A.nx || j >= A.ny) return;
    const key = i * A.ny + j;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([i, j, z, 1, 1, 1] as Box);
  };
  for (let i = Math.ceil(A.cx - hw); i <= Math.floor(A.cx + hw); i++) {
    const u = (i + 0.5 - A.cx) / hw;
    const s = 1 - u * u;
    if (s < 0) continue;
    const dy = Math.sqrt(s) * hh;
    put(i, Math.round(A.cy + dy - 0.5));
    put(i, Math.round(A.cy - dy - 0.5));
  }
  for (let j = Math.ceil(A.cy - hh); j <= Math.floor(A.cy + hh); j++) {
    const v = (j + 0.5 - A.cy) / hh;
    const s = 1 - v * v;
    if (s < 0) continue;
    const dx = Math.sqrt(s) * hw;
    put(Math.round(A.cx + dx - 0.5), j);
    put(Math.round(A.cx - dx - 0.5), j);
  }
  return out;
};

const ribs = (profile: readonly Station[], zs: readonly number[]) =>
  zs.flatMap(z => rib(profile, Z(z)));

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
/**
 * The station a fraction of the way along a hull, in cells.
 *
 * A socket authored as `43` was authored against a profile that no longer
 * exists: the sections are cut from one envelope per navy now, so a corvette's
 * nose moved and its gun ring stayed where it was, hanging eight cells off the
 * end of the ship. A fraction follows the hull.
 */
const zAt = (prof: readonly Station[], t: number): number => {
  const a = Math.round((prof[0] as Station)[0]);
  const b = Math.round((prof[prof.length - 1] as Station)[0]);
  return Math.round(a + (b - a) * t);
};

/**
 * A cell a given fraction out from the centreline, MIRRORED exactly.
 *
 * `CX` is 16 on a lattice of 32, which is a cell BOUNDARY rather than a cell:
 * the plane the ship is symmetric about runs between cells 15 and 16, so cell
 * 16's centre is half a cell to starboard and `round(CX + u*hw)` and
 * `round(CX - u*hw)` do not land the same distance out. On the Benefactor
 * frigate that put the port ring at 0.80 of the beam and the starboard one at
 * 0.98, and the arc scan read it straight back: one gun 68 percent blocked and
 * its twin 36. Mirroring the index rather than the arithmetic makes a pair a
 * pair on every hull.
 */
const acrossFrom = (half: number, frac: number, n: number): number => {
  const out = Math.round(half - 0.5 + Math.abs(frac) * n);
  return frac >= 0 ? out : (2 * half - 1) - out;
};

/**
 * Cells `n` out from the centreline PLANE, to port and to starboard.
 *
 * The plane runs BETWEEN columns 15 and 16, not down the middle of column 16,
 * so a pair written `CX - n` and `CX + n` is not a mirrored pair at all: the
 * mirror of 16 - n is 15 + n, and the starboard half of every such pair sat
 * one cell further out than its twin. Eighty four pairs across the fleet were
 * authored that way, which is most of why a hull was not symmetric and why its
 * windows came out on one side and not the other.
 *
 * `acrossFrom` has always done this correctly for anything seated by fraction;
 * these are the two names for doing it by hand.
 */
const PX = (n: number): number => A.cx - 1 - RX(n);
const SX = (n: number): number => A.cx + RX(n);

const seatAt = (prof: readonly Station[], kind: SocketKind, id: string,
  label: string, z: number, u = 0, v = 0, facing?: number): Socket => {
  const [hw, hh] = hullAt(prof, z);
  return {
    id, kind, label,
    at: [acrossFrom(A.cx, u, hw as number), acrossFrom(A.cy, v, hh as number), z],
    // Authored only where the hull makes the positional default wrong; see
    // `ringFacing`, and `sim.test.mjs` is what proves each one.
    ...(facing === undefined ? {} : { facing }),
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
/**
 * Where a gun ring sits, as a fraction of the half extent it is seated on.
 *
 * Authored at about eight tenths on every class, which is what puts a turret
 * on the SKIN rather than inside the ship. Named here because it is the line
 * everything else has to stay inboard of.
 */
const RING_AT = 0.78;

/**
 * How much room a turret's swept box needs, in CELLS, beyond the ring itself.
 *
 * A turret is four or five cells across and it TURNS, so the box it sweeps is
 * wider than the gun; a berth is another five. Ten cells of clearance is those
 * two half widths plus a cell, and it is in cells rather than in a fraction
 * because a turret is the same size at every rung: the same fraction of a
 * cruiser's beam is nearly twice as many cells as it is of a corvette's, which
 * is exactly how four heavy cruisers came to seat their barracks inside their
 * own gun rings and read as illegal hulls nobody could field.
 */
const RING_CLEAR = 6;

/**
 * How far outboard the plumbing may sit on a hull with this half extent.
 *
 * Solved rather than picked: the outboard edge of a berth has to stop short of
 * the inboard edge of a gun's box, so what is left of the ring's own fraction
 * once the clearance comes out of it is all the room there is. On a wide hull
 * that is about a third of the beam; on a narrow one it is nothing at all, and
 * nothing at all is the right answer rather than a bug, because a hull six
 * cells to the skin cannot carry berths abreast under its own guns whatever
 * number is written here.
 */
const inboardOf = (half: number): number =>
  Math.max(0, Math.min(0.46, RING_AT - RING_CLEAR / Math.max(1, half)));

/** Below this a lane is not a lane: the two berths in it would overlap each
 *  other rather than the guns, which is the same part missing for a different
 *  reason. */
const LANE_MIN = 0.18;

/**
 * How a navy stacks its berths, decided by its own SECTION.
 *
 * Three answers, and which one a hull gets is arithmetic rather than habit:
 * abreast where there is beam to spare outboard of the gun rings, stacked one
 * over the other where the hull is deep and narrow, and single file down the
 * keel where it is neither. The Benefactor is the ship that made this
 * necessary: paired abreast, its berths sat inside its own gun rings on every
 * rung above a frigate and the stock hull read as illegal.
 */
const laneOf = (prof: readonly Station[], z: number):
  { axis: 'x' | 'y' | 'z'; at: number } => {
  const [hw, hh] = hullAt(prof, z);
  const u = inboardOf(hw as number), v = inboardOf(hh as number);
  if (u >= LANE_MIN && u >= v) return { axis: 'x', at: u };
  if (v >= LANE_MIN) return { axis: 'y', at: v };
  return { axis: 'z', at: 0 };
};

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

  out.push(...pairX(prof, 'retro', 'r0', 'r1', 'retro', nose - Z(8), 0.62));
  // A second pair, for the hulls that need it. Retro thrust does not scale
  // with the ship: two clusters brake a frigate and barely touch a cruiser,
  // and a heavy that cannot stop turns Full stop into a button that lies.
  out.push(...pairX(prof, 'retro', 'r2', 'r3', 'retro, quarter', nose - Z(20), 0.62));
  out.push(...pairX(prof, 'rcs', 'y0', 'y1', 'rcs, bow', nose - Z(12), 0.86));
  out.push(...pairX(prof, 'rcs', 'y2', 'y3', 'rcs, quarter', aft + Z(11), 0.86));
  out.push(seatAt(prof, 'rcs', 'p0', 'rcs, dorsal', mid, 0, 0.86));
  out.push(seatAt(prof, 'rcs', 'p1', 'rcs, ventral', mid, 0, -0.86));
  out.push(seatAt(prof, 'rcs', 'p2', 'rcs, dorsal quarter', mid - Z(11), 0, 0.86));
  out.push(seatAt(prof, 'rcs', 'p3', 'rcs, ventral quarter', mid - Z(11), 0, -0.86));

  // b0 is the bridge bay on every frame: forward and dorsal, where a bridge
  // goes and where its viewport is worth having. Everything else is berths,
  // airlocks and holds, and the stock fit decides which.
  out.push(seatAt(prof, 'bay', 'b0', 'bay, bridge', nose - Z(16), 0, 0.42));
  //
  // `bayZ` names the stations outright, for a hull whose midships volume is
  // spoken for. A Karisen cruiser keeps six missile cells on the keel and is
  // six cells deep: berths and cells cannot share a station, and the even
  // march below has no way to know that.
  // Nothing is seated inside the engines. The LONGEST drive there is, not one
  // of them: clearing `DRV-N` at four cells is no clearance on a liner, which
  // fits `DRV-H` at seven. A frame does not know which drive its stock fit
  // will carry, so the clearance is the worst case, and it applies to the
  // authored stations as well as the marched ones.
  const bell = MODULES.reduce(
    (a, m) => (m.fits === 'drive' ? Math.max(a, m.size[2] as number) : a), 4);
  const clearAft = aft + 1 + Math.ceil(bell / 2) + 4;
  const z0 = Math.max(aft + Z(9), clearAft), z1 = nose - Z(19);
  const stations = Math.max(1, Math.ceil((bays - 1) / 2));

  /**
   * Keel stations already spoken for, and the next free one at or ahead of a
   * wanted station.
   *
   * A hull with no lane either way puts EVERY fitting on the keel, and until
   * this existed the berths and the clamps worked out their stations
   * independently and landed on the same ones: the Karisen corvette, which is
   * twelve cells across and the thinnest hull in the game, seated both of its
   * clamps inside its own barracks and one of them came out with no cells at
   * all. A part that pays its mass and never appears is worse than one that
   * was never fitted, because nothing says so.
   *
   * Seven cells because that is how long a berth is: two of them closer than
   * that are two parts in one place again.
   *
   * It searches BOTH WAYS from the station it wanted and stays between the
   * drive clearance and the bridge, because a keel is a finite thing: marching
   * forward alone walked a clamp off the nose of a corvette and out of the
   * lattice, which the architect then reads as a socket that is not on the
   * ship.
   */
  const keelAt: number[] = [];
  const KEEL_STEP = 7;
  const freeKeel = (want: number): number => {
    const lo = clearAft, hi = Math.max(lo, nose - Z(14));
    const free = (z: number) => z >= lo && z <= hi
      && !keelAt.some(u => Math.abs(u - z) < KEEL_STEP);
    let z = Math.max(lo, Math.min(hi, want));
    if (!free(z)) {
      let found = -1;
      for (let n = 1; n <= 16 && found < 0; n++) {
        for (const d of [-1, 1]) {
          const t = z + d * n * KEEL_STEP;
          if (free(t)) { found = t; break; }
        }
      }
      // Nowhere CLEAR still has a best answer: the station with the most room
      // round it. Leaving the part where it was asked for puts it dead in the
      // middle of whatever is already there, and a berth loses more cells to a
      // clamp in its centre than to one at its edge.
      if (found >= 0) z = found;
      else {
        let best = z, room = -1;
        for (let t = lo; t <= hi; t++) {
          const gap = keelAt.reduce((a, u) => Math.min(a, Math.abs(u - t)), 1e9);
          if (gap > room) { room = gap; best = t; }
        }
        z = best;
      }
    }
    keelAt.push(z);
    return z;
  };

  for (let n = 1; n < bays; n++) {
    const k = Math.floor((n - 1) / 2);
    const z = Math.max(clearAft, bayZ
      ? (bayZ[Math.min(k, bayZ.length - 1)] as number)
      : Math.round(z0 + ((z1 - z0) * k) / Math.max(1, stations - 1)));
    const first = (n - 1) % 2 === 0;
    const lane = laneOf(prof, z);
    if (lane.axis === 'x') {
      out.push(seatAt(prof, 'bay', `b${n}`, `bay, ${first ? 'port' : 'starboard'} ${k + 1}`,
        z, first ? -lane.at : lane.at, bayV));
    } else if (lane.axis === 'y') {
      out.push(seatAt(prof, 'bay', `b${n}`, `bay, ${first ? 'upper' : 'lower'} ${k + 1}`,
        z, 0, first ? lane.at : -lane.at));
    } else {
      // No lane either way, so the pair goes fore and aft of the station
      // instead of abreast of it. A berth is seven cells long, so four clear
      // of the station is the least that keeps two of them apart.
      // Clamped, because the pair splits fore and aft of its station and the
      // aft half walked straight back into the bells the station cleared: the
      // liner's first passenger deck came out four cells inside its engines.
      out.push(seatAt(prof, 'bay', `b${n}`, `bay, keel ${n}`,
        freeKeel(Math.max(clearAft, z + (first ? -4 : 4))), 0, bayV));
    }
  }

  // Clamps go on the QUARTER, aft of the bays and aft of anything a missile
  // pad sweeps. A clamp is enclosed, so on a thin hull it is pulled inboard to
  // fit, and amidships that walked it straight into a ventral pad's box.
  //
  // Clear of the DRIVE BLOCK, by the same clearance the bays use. The station
  // was a flat eight cells off the transom, which is inside a bell on a short
  // hull: a Karisen corvette's port clamp sat with twenty three of its cells
  // in the engines, and once a drive's volume became its own the clamp had
  // nowhere legal left and vanished entirely. Eight was never a clearance, it
  // was a guess that the bells were shorter than they are.
  for (let n = 0; n < clamps; n++) {
    const k = Math.floor(n / 2);
    const z = clearAft + k * 9;
    const port = n % 2 === 0;
    const lane = laneOf(prof, z);
    out.push(lane.axis === 'x'
      ? seatAt(prof, 'clamp', `c${n}`, `clamp, ${port ? 'port' : 'starboard'} ${k + 1}`,
        z, port ? -lane.at : lane.at, -0.42)
      : lane.axis === 'y'
        ? seatAt(prof, 'clamp', `c${n}`, `clamp, ${port ? 'upper' : 'lower'} ${k + 1}`,
          z, 0, port ? lane.at : -lane.at)
        : seatAt(prof, 'clamp', `c${n}`, `clamp, keel ${n + 1}`,
          freeKeel(Math.max(clearAft, z + (port ? -4 : 4))), 0, -0.42));
  }
  return out;
};


/**
 * What a navy BOLTS ON, which is the half of a silhouette a section cannot
 * carry.
 *
 * A section says how a hull is proportioned and it stops there, so four navies
 * cut from four sections are still four smooth lozenges. What tells a Terran
 * from a Benefactor across a battlefield is the stuff standing off the skin:
 * the stepped crown and the fluting down a Terran flank, the swept wings on a
 * Benefactor, the rail that overruns a Karisen at both ends, the gantry welded
 * across a Rogue's beam, and the rack rails a civil hull stacks its boxes on.
 *
 * Emitted as ONE CELL THICK SLABS PER STATION rather than as long boxes,
 * because a box has one y and a hull does not: a crown authored as a single
 * run from the waist to the bow either buries itself in the deck amidships or
 * floats off it forward. Per station it follows the sheer exactly, and it
 * costs a few hundred cells on a hull that already has thousands.
 *
 * It is ARMOUR, and it costs armour's mass, because that is what it is: a
 * plate welded to the outside of a ship. `data.rs` is measured from the stock
 * hulls rather than authored beside them, so the ladder absorbs it.
 */
/**
 * The SKIN at a point, which is what decor has to be bolted to.
 *
 * A hull station is an ellipse, so its deck is only `hh` above the keel line
 * on the centreline and drops away toward each flank. Decor laid at a constant
 * height across the deck therefore floats at its outer end, and decor laid at
 * a constant beam down a flank floats at its top and bottom. That is not a
 * cosmetic problem: a cell touching nothing is not a piece of armour, and the
 * first cut of this bolted four hundred of them onto a Terran frigate.
 */
const deckAt = (hw: number, hh: number, dx: number): number =>
  hh * Math.sqrt(Math.max(0, 1 - (dx / Math.max(0.5, hw)) ** 2));
const flankAt = (hw: number, hh: number, dy: number): number =>
  hw * Math.sqrt(Math.max(0, 1 - (dy / Math.max(0.5, hh)) ** 2));

/**
 * What a navy BOLTS ON, which is the half of a silhouette a section cannot
 * carry.
 *
 * A section says how a hull is proportioned and it stops there, so four navies
 * cut from four sections are still four smooth lozenges. What tells a Terran
 * from a Benefactor across a battlefield is the stuff standing off the skin:
 * the stepped strakes and the fluting down a Terran flank, the swept wings on
 * a Benefactor, the rail that overruns a Karisen at both ends, the gantry
 * welded across a Rogue's beam, and the rack rails a civil hull stacks its
 * boxes on.
 *
 * Emitted as ONE CELL THICK SLABS PER STATION rather than as long boxes,
 * because a box has one y and a hull does not: a crown authored as a single
 * run from the waist to the bow either buries itself in the deck amidships or
 * floats off it forward. Per station it follows the sheer exactly, and every
 * cell is placed against the SKIN at its own point (see `deckAt` above), so
 * everything here is welded to the ship rather than near it.
 *
 * It is ARMOUR, and it costs armour's mass, because that is what it is: a
 * plate welded to the outside of a ship. `data.rs` is measured from the stock
 * hulls rather than authored beside them, so the ladder absorbs it.
 *
 * Nothing here may stand in front of a gun. A ring rests trained outboard on a
 * flank and abeam on the centreline (`ringFacing`), and decor is laid clear of
 * those lanes: the Terran's strakes leave the deck's centreline open and the
 * Rogue's blisters sit abaft its rings. What holds that to it is the ARC SCAN,
 * in `sim.test.mjs`: every mount on every stock hull, asked whether the ship
 * is in the way in the direction it rests.
 */
const decorFor = (L: Lat, faction: FactionKey, prof: readonly Station[]): Box[] => {
  // Shadowed rather than spelt through `L` at each of the twenty seven uses
  // below: the body of this function is a hull drawn in lattice coordinates
  // and it reads as one.
  const { nx: NX, ny: NY, nz: NZ, cx: CX, cy: CY } = L;
  const out: Box[] = [];
  const aft = Math.round((prof[0] as Station)[0]);
  const nose = Math.round((prof[prof.length - 1] as Station)[0]);
  const len = Math.max(1, nose - aft);
  /** One cell of decor, at a lattice position. */
  const put = (x: number, y: number, z: number): void => {
    const i = Math.round(x), j = Math.round(y), k = Math.round(z);
    if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return;
    out.push([i, j, k, 1, 1, 1] as Box);
  };
  // The CELL the skin occupies, not the height the surface is at. A cell is a
  // whole cell and the ellipse is continuous: a rail placed at "the deck plus
  // one unit" lands a cell and a half above a deck whose top cell happens to
  // start low, and a cell with a gap under it is a cell touching nothing.
  const deckCell = (hw: number, hh: number, dx: number, sign: number): number =>
    sign > 0
      ? Math.floor(CY + deckAt(hw, hh, dx) - 0.5)
      : (2 * CY - 1) - Math.floor(CY + deckAt(hw, hh, dx) - 0.5);
  const flankCell = (hw: number, hh: number, dy: number, side: number): number =>
    side > 0
      ? Math.floor(CX + flankAt(hw, hh, dy) - 0.5)
      : (2 * CX - 1) - Math.floor(CX + flankAt(hw, hh, dy) - 0.5);

  /** A strip ON THE DECK, from one offset to another, `up` cells above it. */
  const onDeck = (hw: number, hh: number, x0: number, x1: number,
    up: number, z: number, sign = 1): void => {
    const a = Math.round(Math.min(x0, x1)), b = Math.round(Math.max(x0, x1));
    for (let x = a; x <= b; x++) {
      put(x, deckCell(hw, hh, x + 0.5 - CX, sign) + sign * up, z);
    }
  };
  /** A rib ON A FLANK, from one height to another, `proud` cells off it. */
  const onFlank = (hw: number, hh: number, y0: number, y1: number,
    proud: number, z: number, side: number): void => {
    const a = Math.round(Math.min(y0, y1)), b = Math.round(Math.max(y0, y1));
    for (let y = a; y <= b; y++) {
      put(flankCell(hw, hh, y + 0.5 - CY, side) + side * proud, y, z);
    }
  };

  for (let z = aft; z <= nose; z++) {
    const t = (z - aft) / len;
    const [hwRaw, hhRaw] = hullAt(prof, z);
    const hw = hwRaw as number, hh = hhRaw as number;

    if (faction === 'terran') {
      // Stepped strakes down the deck, setting back twice toward the bow, and
      // a CLEAR LANE between them. Three widths and two shoulders is what
      // makes a shape read as deco rather than as a box; the lane is what
      // stops it reading as a wall in front of a gun.
      if (t > 0.16 && t < 0.86) {
        const step = t < 0.42 ? 0 : t < 0.66 ? 1 : 2;
        const outer = hw * (0.66 - step * 0.14);
        const inner = hw * 0.28;
        for (const side of [-1, 1]) {
          onDeck(hw, hh, CX + side * inner, CX + side * outer, 1, z);
          if (step === 0) {
            onDeck(hw, hh, CX + side * inner,
              CX + side * (inner + (outer - inner) * 0.6), 2, z);
          }
        }
      }
      // Fluting: a proud rib every fourth station, from the belt line up to
      // the shoulder on both flanks. Vertical lines on a horizontal ship,
      // which is the other half of the same language.
      if (z % 4 === 0 && t > 0.12 && t < 0.80) {
        for (const side of [-1, 1]) {
          onFlank(hw, hh, CY - hh * 0.30, CY + hh * 0.46, 1, z, side);
        }
      }
    } else if (faction === 'benefactor') {
      // Wings: a plate sweeping out of each flank, widest just abaft the waist
      // and gone by the bow, DROPPING as it goes out so it reads as swept
      // rather than as a disc round the middle of the ship. Low on the body,
      // because at the gun rings' own height a wing stands in front of two
      // thirds of the broadside.
      //
      // The span is a fraction of the beam rather than a count of cells: at a
      // fixed count a corvette wore a cruiser's wings, and the Benefactor is
      // the narrowest section in the game.
      if (t > 0.14 && t < 0.80) {
        const s = (t - 0.14) / 0.66;
        const span = hw * 0.70 * (1 - (2 * s - 1) * (2 * s - 1)) + 1;
        const y0 = Math.round(CY - hh * 0.55);
        for (const side of [-1, 1]) {
          for (let n = 0; n <= Math.round(span); n++) {
            // Each cell of the wing is placed against the skin at ITS OWN
            // height, and the wing drops as it goes out, so the root cell of
            // each course is welded on rather than the whole plate being hung
            // off one station's beam.
            const y = Math.round(y0 - n * 0.42);
            const root = flankCell(hw, hh, y + 0.5 - CY, side);
            // A staircase, filled. Stepping out one cell and down one cell
            // leaves two cells meeting at an EDGE, and an edge is not a weld:
            // the sweep came apart into a hundred loose blocks per hull.
            const prev = Math.round(y0 - Math.max(0, n - 1) * 0.42);
            for (let yy = y; yy <= prev; yy++) put(root + side * n, yy, z);
            if (n < span * 0.5) put(root + side * n, prev + 1, z);
          }
        }
      }
      // And a dorsal fin aft, which is what stops the section reading as a
      // wing with a body drawn on it.
      if (t > 0.10 && t < 0.44) {
        const h = Math.max(1, Math.round(3 * (1 - Math.abs(t - 0.27) / 0.17)));
        for (let dy = 1; dy <= h; dy++) put(CX, deckCell(hw, hh, 0.5, 1) + dy, z);
      }
    } else if (faction === 'karisen') {
      // The rail under the keel, overrunning the body at both ends. It is the
      // one Karisen habit that survives at every rung, and it was frame until
      // now, which is why it drew as a bare grey plank.
      if (z >= aft - 3 && z <= nose + 3) {
        const k = Math.max(aft, Math.min(nose, z));
        const [khw, khh] = hullAt(prof, k);
        for (let dx = -1; dx <= 1; dx++) {
          put(CX + dx, deckCell(khw as number, khh as number, dx + 0.5, -1) - 1, z);
        }
      }
      // Shoulder strakes: two ridges running the length of the upper flanks,
      // which is what a stacked silhouette looks like from outside.
      if (t > 0.08 && t < 0.90) {
        for (const side of [-1, 1]) {
          onFlank(hw, hh, CY + hh * 0.44, CY + hh * 0.60, 1, z, side);
        }
      }
    } else if (faction === 'rogue') {
      // The gantry: a beam welded straight across the beam amidships and
      // standing well proud of it, which is where a boarding party goes over.
      // Under the gun rings, because a beam at their height is a beam in front
      // of them.
      if (t > 0.34 && t < 0.52) {
        const y = Math.round(CY - hh * 0.42);
        const over = Math.max(2, Math.round(hw * 0.42));
        const lo = flankCell(hw, hh, y + 0.5 - CY, -1) - over;
        const hi = flankCell(hw, hh, y + 0.5 - CY, 1) + over;
        for (let x = lo; x <= hi; x++) put(x, y, z);
      }
      // Blisters, welded on and NOT symmetric, because nothing on this ship
      // was built at the same time as the rest of it. Both abaft the rings.
      if (t > 0.16 && t < 0.30) {
        for (let dy = -1; dy <= 1; dy++) onFlank(hw, hh, CY + dy, CY + dy, 1, z, -1);
        for (let dy = -1; dy <= 1; dy++) onFlank(hw, hh, CY + dy, CY + dy, 2, z, -1);
      }
      if (t > 0.40 && t < 0.54) {
        for (let dy = -1; dy <= 1; dy++) onFlank(hw, hh, CY + dy, CY + dy, 1, z, 1);
        for (let dy = -1; dy <= 1; dy++) onFlank(hw, hh, CY + dy, CY + dy, 2, z, 1);
      }
    } else {
      // Civil: rack rails. Two longitudinal rails down the deck and a hoop
      // every sixth station, which is the frame a container sits in and the
      // reason a freighter reads as cargo rather than as a smooth hull.
      if (t > 0.10 && t < 0.88) {
        for (const side of [-1, 1]) {
          onDeck(hw, hh, CX + side * hw * 0.62, CX + side * hw * 0.62, 1, z);
        }
        if (z % 6 === 0) {
          onDeck(hw, hh, CX - hw * 0.62, CX + hw * 0.62, 1, z);
          for (const side of [-1, 1]) onFlank(hw, hh, CY, CY + hh * 0.5, 1, z, side);
        }
        if (z % 6 === 3) onDeck(hw, hh, CX - 1, CX + 1, 1, z, -1);
      }
    }
  }
  return out;
};

/**
 * The decor a frame carries, worked out once and kept.
 *
 * A function of the navy and the profile rather than a field on every
 * `FrameDef`, so a class added tomorrow gets its navy's habits for free and
 * seventeen tables cannot drift about what a Terran looks like. Cached on the
 * class key because `rasterise` runs on every slider pixel and this is a walk
 * over every station of the hull.
 */
const decorCache = new Map<string, readonly Box[]>();
export const decorOf = (frame: FrameDef): readonly Box[] => {
  const had = decorCache.get(frame.classKey);
  if (had) return had;
  const made = decorFor(latOf(frame), frame.faction, frame.profile);
  decorCache.set(frame.classKey, made);
  return made;
};

/**
 * Cargo stations: holds in a RACK rather than in a line.
 *
 * A container is eleven cells long, so six of them nose to tail is sixty six
 * cells on a hull that is fifty two: a civil ship stacks its cargo the way a
 * real one does, four to a station, two abreast and two high, and marches the
 * stations forward. The section is what allows it: the civil yards build the
 * only hull in the game that is nearly square, and this is what that squareness
 * is FOR.
 */
const rack = (prof: readonly Station[], count: number,
  lanes = 2, tiers = 2): Socket[] => {
  const aft = Math.round((prof[0] as Station)[0]);
  const nose = Math.round((prof[prof.length - 1] as Station)[0]);
  const z0 = aft + Z(11), z1 = nose - Z(16);
  const per = lanes * tiers;
  const stations = Math.max(1, Math.ceil(count / per));
  const out: Socket[] = [];
  for (let n = 0; n < count; n++) {
    const k = Math.floor(n / per), slot = n % per;
    const z = Math.round(z0 + ((z1 - z0) * k) / Math.max(1, stations - 1));
    const [hw, hh] = hullAt(prof, z);
    const lane = slot % lanes, tier = Math.floor(slot / lanes);
    // Across the deck in lanes, and UP it in tiers. Half a container of beam
    // between lane centres and a container's own depth between tiers, so the
    // stack is a stack rather than a pile.
    const u = lanes === 1 ? 0 : ((lane * 2 + 1 - lanes) / lanes) * 0.52;
    const x = acrossFrom(A.cx, u, hw as number);
    // The BOTTOM of the box rests one cell above the skin AT ITS OWN LANE.
    // A station is an ellipse, so the deck two thirds of the way out to the
    // rail is two cells lower than the deck on the centreline: measured from
    // the centreline the outboard boxes floated, and a floating box gets a
    // spar per outboard cell, which on a twelve box ship is sixteen hundred
    // cells of plate holding up cargo that should be sitting on the deck.
    const deck = Math.floor(A.cy + deckAt(hw as number, hh as number,
      x + 0.5 - A.cx) - 0.5);
    const y = deck + 3 + tier * 6;
    out.push({
      id: `h${n}`, kind: 'rack',
      label: `hold, ${lanes > 1 ? (lane === 0 ? 'port' : 'starboard') + ' ' : ''}`
        + `tier ${tier + 1}, station ${k + 1}`,
      at: [x, Math.min(A.ny - 4, y), z],
    });
  }
  return out;
};

// ------------------------------------------------------- the sections --

/**
 * A navy's SECTION, authored once and cut into a whole ladder.
 *
 * The seventeen profiles used to be seventeen hand written tables, and they
 * drifted the way seventeen hand written tables do. Two things went wrong and
 * only one of them was visible.
 *
 * The visible one: every hull came out the same lozenge. A Terran was 2.41
 * wide by 1.53 deep and a Benefactor 2.19 by 2.19, which is "wide and flat"
 * against "deeper than it is wide" written down as almost the same number, so
 * the four navies could only be told apart by their paint. A section has to be
 * a RATIO a player can see at a glance, and 1.6 against 1.0 is not one.
 *
 * The invisible one: CLAUDE.md says "a rung is a cell size, not a longer
 * profile", and the tables did not obey it. Each rung was drawn a little
 * longer as well as scaled, so the ladder came out at 1.55 and 2.15 times the
 * frigate instead of 1.5 and 2. Nothing said so, because nothing measured it:
 * `tools/measure_fleet.mjs` prints that column now.
 *
 * So a faction authors ONE envelope and the ladder is cut from it. The z
 * extent and the maximum half beam and half depth are the same at every
 * warship rung, which makes the world size ladder EXACTLY the rung ratio:
 * a destroyer is one and a half times its frigate and a heavy cruiser twice
 * it, in all three dimensions, by construction rather than by tuning.
 */
interface SectionDef {
  /**
   * Length in REFERENCE cells: what this navy measures on a 32 x 32 x 64
   * lattice. `profileFor` scales it to the class's own lattice, so a rung is
   * bigger by having MORE cells rather than by being drawn longer.
   */
  readonly cells: number;
  /** Half beam and half depth at the waist, in reference cells. The whole of
   *  what makes a navy recognisable from ahead. */
  readonly halfBeam: number;
  readonly halfDepth: number;
  /**
   * The longitudinal distribution: (t, beam, depth) with t running 0 at the
   * transom to 1 at the nose, and the two fractions of the waist above.
   *
   * Fractions rather than cells so a tier can redistribute fullness without
   * touching the envelope: see `FULLNESS`.
   */
  readonly waist: ReadonlyArray<readonly [number, number, number]>;
}

/**
 * The four navies and the civil yards, from ahead.
 *
 * Terran is a wide flat slab, Karisen is nearly circular and the longest hull
 * at every rung, Rogue is the shortest and by far the broadest, Benefactor is
 * the only section that is taller than it is wide, and a civil hull is a box
 * with a parallel middle body because it is a container rack with an engine
 * behind it.
 */
const NAVY_SECTION: Record<FactionKey, SectionDef> = {
  terran: {
    cells: 54, halfBeam: 12, halfDepth: 6.2,
    waist: [[0, 0.72, 0.84], [0.13, 0.93, 0.98], [0.36, 1, 1], [0.60, 1, 1],
      [0.80, 0.82, 0.86], [0.93, 0.46, 0.52], [1, 0.20, 0.28]],
  },
  karisen: {
    cells: 60, halfBeam: 8, halfDepth: 7.4,
    waist: [[0, 0.70, 0.72], [0.15, 0.93, 0.94], [0.40, 1, 1], [0.64, 0.96, 0.97],
      [0.83, 0.72, 0.74], [0.94, 0.42, 0.44], [1, 0.17, 0.19]],
  },
  rogue: {
    cells: 44, halfBeam: 12.4, halfDepth: 5.8,
    waist: [[0, 0.66, 0.82], [0.17, 0.95, 1], [0.42, 1, 1], [0.64, 0.92, 0.95],
      [0.83, 0.62, 0.72], [1, 0.24, 0.36]],
  },
  benefactor: {
    cells: 52, halfBeam: 6.8, halfDepth: 11,
    waist: [[0, 0.76, 0.64], [0.17, 0.95, 0.92], [0.42, 1, 1], [0.64, 0.98, 0.95],
      [0.83, 0.74, 0.66], [0.93, 0.46, 0.40], [1, 0.20, 0.17]],
  },
  civil: {
    cells: 52, halfBeam: 8.5, halfDepth: 8,
    waist: [[0, 0.74, 0.76], [0.13, 1, 1], [0.70, 1, 1], [0.85, 0.80, 0.82],
      [0.94, 0.48, 0.50], [1, 0.20, 0.22]],
  },
};

/**
 * How FULL a rung's body is, as an exponent on the distribution.
 *
 * The envelope is fixed, so a tier cannot be distinguished by being bigger:
 * that is the rung's job and the rung does it exactly. What is left is where
 * the volume SITS. An exponent under one pulls every fraction toward 1, which
 * carries the waist further fore and aft and blunts the ends: a heavy cruiser
 * is a slab with a stub bow. Over one does the opposite, and a corvette comes
 * out as a needle.
 *
 * It cannot change the ladder, because 1 raised to any power is 1 and the
 * waist is where the maximum is. That is the whole reason it is an exponent
 * and not a scale.
 */
const FULLNESS: Record<TierKey, number> = {
  corvette: 1.34, frigate: 1, destroyer: 0.86, cruiser: 0.72,
  // The civil trades vary by what they carry rather than by rung, and the
  // shape follows the cargo: a tanker is a bulge round a cylinder, a liner is
  // fine because it is mostly people, a hopper ship is square because rock is.
  freighter: 1, lighter: 1.12, hauler: 0.92, boxship: 0.80,
  tanker: 0.70, miner: 0.95, liner: 1.06,
};

/**
 * How much of its own lattice a tier's body fills.
 *
 * Every warship is 1. It used to be the corvette's job to be short (0.50 of a
 * frigate's profile on a frigate's lattice), and that was the whole problem:
 * a corvette drawn that way is a frigate with its ends cut off, at a frigate's
 * beam, carrying a frigate's cells. It has its own lattice now, 24 x 24 x 48,
 * so it is three quarters of a frigate in all three dimensions and has
 * three quarters of one in each of them, which is what a smaller ship is.
 *
 * What is left here is the civil trades, which do not have a ladder: they are
 * told apart by what they carry, so a tanker is stubby and a liner is long on
 * whichever lattice its tonnage puts it.
 */
const REACHES: Record<TierKey, number> = {
  corvette: 1, frigate: 1, destroyer: 1, cruiser: 1,
  freighter: 1.18, lighter: 0.74, hauler: 1, boxship: 1.06,
  tanker: 1, miner: 0.88, liner: 1.10,
};

/**
 * One navy's section, cut to one rung, as the stations the rest of the file
 * already understands.
 *
 * Centred in the lattice rather than laid from a fixed transom, so a long
 * navy and a short one both have their overhangs: the drives are seated one
 * cell forward of the transom and a heavy bell is seven cells long, so a hull
 * that started at z 0 would push its own engines out of the world.
 */
const profileFor = (faction: FactionKey, tier: TierKey): readonly Station[] => {
  const s = NAVY_SECTION[faction];
  const e = FULLNESS[tier];
  // The section is authored on the REFERENCE lattice and cut to whichever one
  // this class is drawn on, so a navy's proportions are one table and its four
  // rungs are the same ship at four sizes. Scaling all three axes by the same
  // lattice ratio is what makes the ladder exactly the lattice ratio.
  const fz = A.nz / REF.nz, fx = A.nx / REF.nx, fy = A.ny / REF.ny;
  const cells = Math.round(s.cells * fz * REACHES[tier]);
  const aft = Math.max(2, Math.round((A.nz - cells) / 2));
  return s.waist.map(([t, w, h]) => [
    Math.round(aft + t * cells),
    +(s.halfBeam * fx * Math.pow(w, e)).toFixed(3),
    +(s.halfDepth * fy * Math.pow(h, e)).toFixed(3),
  ] as Station);
};

/**
 * The whole fleet, authored once and cut to four lattices.
 *
 * Every coordinate below is a REFERENCE cell, and `Z`, `RX`, `RY`, `UY`, `PX`,
 * `SX`, `keel` and `slab` are what say so. This runs once per rung with `A`
 * set to that rung's lattice, and each class keeps the pass that matches its
 * own. Four hand written copies of a Terran would be four Terrans that drift,
 * and the drift would be a navy that stops looking like itself somewhere up
 * its own ladder.
 */
const buildFrames = (): FrameDef[] => {
  // The seventeen profiles, all of them cut from five sections. The names are
  // what `FRAMES` and every socket below already ask for, so a navy's shape is
  // edited in ONE place and the whole ladder follows.
  const PROF_TERRAN = profileFor('terran', 'frigate');
  const PROF_KARISEN = profileFor('karisen', 'frigate');
  const PROF_ROGUE = profileFor('rogue', 'frigate');
  const PROF_BENEFACTOR = profileFor('benefactor', 'frigate');
  const PROF_FREIGHTER = profileFor('civil', 'freighter');
  const PROF_LIGHTER = profileFor('civil', 'lighter');
  const PROF_HAULER = profileFor('civil', 'hauler');
  const PROF_BOXSHIP = profileFor('civil', 'boxship');
  const PROF_TANKER = profileFor('civil', 'tanker');
  const PROF_MINER = profileFor('civil', 'miner');
  const PROF_LINER = profileFor('civil', 'liner');

  const PROF_TERRAN_CV = profileFor('terran', 'corvette');
  const PROF_TERRAN_DD = profileFor('terran', 'destroyer');
  const PROF_TERRAN_CA = profileFor('terran', 'cruiser');

  const PROF_KARISEN_CV = profileFor('karisen', 'corvette');
  const PROF_KARISEN_DD = profileFor('karisen', 'destroyer');
  const PROF_KARISEN_CA = profileFor('karisen', 'cruiser');

  const PROF_ROGUE_CV = profileFor('rogue', 'corvette');
  const PROF_ROGUE_DD = profileFor('rogue', 'destroyer');
  const PROF_ROGUE_CA = profileFor('rogue', 'cruiser');

  const PROF_BENEFACTOR_CV = profileFor('benefactor', 'corvette');
  const PROF_BENEFACTOR_DD = profileFor('benefactor', 'destroyer');
  const PROF_BENEFACTOR_CA = profileFor('benefactor', 'cruiser');

    const table: FrameDef[] = [
    {
      classKey: 'terran_frigate', name: 'Terran Frigate',
      faction: 'terran', tier: 'frigate', rung: 'frigate',
      radius: 1.8, massMax: 0.61, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_TERRAN,
      spine: [keel(0, 6, 56), ...ribs(PROF_TERRAN, [10, 17, 24, 31, 38, 45, 52])],
      sockets: [
        { id: 'd0', kind: 'drive', at: [PX(4), UY(-2), Z(4)], label: 'drive, port lower' },
        { id: 'd1', kind: 'drive', at: [A.cx, UY(-2), Z(4)], label: 'drive, centre lower' },
        { id: 'd2', kind: 'drive', at: [SX(4), UY(-2), Z(4)], label: 'drive, starboard lower' },
        { id: 'd3', kind: 'drive', at: [PX(4), UY(3), Z(4)], label: 'drive, port upper' },
        { id: 'd4', kind: 'drive', at: [A.cx, UY(3), Z(4)], label: 'drive, centre upper' },
        { id: 'd5', kind: 'drive', at: [SX(4), UY(3), Z(4)], label: 'drive, starboard upper' },
        seatAt(PROF_TERRAN, 'gun', 'g0', 'gun ring, nose', zAt(PROF_TERRAN, 0.86), 0, 0.62),
        seatAt(PROF_TERRAN, 'gun', 'g1', 'gun ring, port', zAt(PROF_TERRAN, 0.54), -0.72, 0.32),
        seatAt(PROF_TERRAN, 'gun', 'g2', 'gun ring, starboard', zAt(PROF_TERRAN, 0.54), 0.72, 0.32),
        { id: 'r0', kind: 'retro', at: [PX(6), UY(0), Z(50)], label: 'retro, port' },
        { id: 'r1', kind: 'retro', at: [SX(6), UY(0), Z(50)], label: 'retro, starboard' },
        { id: 'y0', kind: 'rcs', at: [PX(9), UY(0), Z(48)], label: 'rcs, port bow' },
        { id: 'y1', kind: 'rcs', at: [SX(9), UY(0), Z(48)], label: 'rcs, starboard bow' },
        { id: 'p0', kind: 'rcs', at: [A.cx, UY(8), Z(40)], label: 'rcs, dorsal' },
        { id: 'p1', kind: 'rcs', at: [A.cx, UY(-8), Z(40)], label: 'rcs, ventral' },
        { id: 'b0', kind: 'bay', at: [A.cx, UY(4), Z(44)], label: 'bay, forward dorsal' },
        { id: 'b1', kind: 'bay', at: [PX(4), UY(0), Z(28)], label: 'bay, port' },
        { id: 'b2', kind: 'bay', at: [SX(4), UY(0), Z(28)], label: 'bay, starboard' },
        { id: 'b3', kind: 'bay', at: [A.cx, UY(-4), Z(22)], label: 'bay, ventral' },
        { id: 'b4', kind: 'bay', at: [A.cx, UY(3), Z(16)], label: 'bay, aft' },
        { id: 'b5', kind: 'bay', at: [PX(4), UY(2), Z(20)], label: 'bay, port aft' },
        { id: 'b6', kind: 'bay', at: [SX(4), UY(2), Z(20)], label: 'bay, starboard aft' },
        { id: 'b7', kind: 'bay', at: [A.cx, UY(-3), Z(34)], label: 'bay, ventral forward' },
        { id: 'b8', kind: 'bay', at: [PX(3), UY(4), Z(28)], label: 'bay, spare port' },
        { id: 'b9', kind: 'bay', at: [SX(3), UY(4), Z(28)], label: 'bay, spare starboard' },
        { id: 'y2', kind: 'rcs', at: [PX(8), UY(0), Z(20)], label: 'rcs, port quarter' },
        { id: 'y3', kind: 'rcs', at: [SX(8), UY(0), Z(20)], label: 'rcs, starboard quarter' },
        { id: 'c0', kind: 'clamp', at: [PX(8), UY(-4), Z(26)], label: 'clamp, port' },
        { id: 'c1', kind: 'clamp', at: [SX(8), UY(-4), Z(26)], label: 'clamp, starboard' },
      ],
      note: 'A slab body on one deep keel. Six small bells in a three by two block '
        + 'on the transom and armour standing off the flanks, both read straight off '
        + 'ship_1.fbx.',
    },
    {
      classKey: 'karisen_frigate', name: 'Karisen Frigate',
      faction: 'karisen', tier: 'frigate', rung: 'frigate',
      radius: 1.9, massMax: 0.56, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      // Three parallel runs, and the ventral beam overruns the body at both ends
      // exactly as Ship_2_energy_1 overruns Ship_2_main in the archive.
      profile: PROF_KARISEN,
      spine: [keel(0, 8, 54), keel(5, 12, 50, 8, 2), keel(-5, 4, 58, 5, 3),
        ...ribs(PROF_KARISEN, [12, 19, 26, 33, 40, 47])],
      sockets: [
        { id: 'd0', kind: 'drive', at: [PX(5), UY(-1), Z(5)], label: 'drive, port' },
        { id: 'd1', kind: 'drive', at: [A.cx, UY(-1), Z(5)], label: 'drive, centre' },
        { id: 'd2', kind: 'drive', at: [SX(5), UY(-1), Z(5)], label: 'drive, starboard' },
        { id: 'd3', kind: 'drive', at: [A.cx, UY(4), Z(5)], label: 'drive, dorsal vernier' },
        seatAt(PROF_KARISEN, 'gun', 'g0', 'gun ring, nose', zAt(PROF_KARISEN, 0.82), 0, 0.6),
        seatAt(PROF_KARISEN, 'missile', 'm0', 'missile pad, ventral',
          zAt(PROF_KARISEN, 0.46), 0, -0.5),
        // A sponson set into the flank, with the body of the ship both fore and
        // aft of it: neither way along the keel is clear, so it rests trained
        // out of its own recess.
        seatAt(PROF_KARISEN, 'gun', 's0', 'sponson, port', zAt(PROF_KARISEN, 0.32), -0.78, -0.2, 1),
        seatAt(PROF_KARISEN, 'gun', 's1', 'sponson, starboard',
          zAt(PROF_KARISEN, 0.32), 0.78, -0.2),
        { id: 'r0', kind: 'retro', at: [PX(6), UY(0), Z(48)], label: 'retro, port' },
        { id: 'r1', kind: 'retro', at: [SX(6), UY(0), Z(48)], label: 'retro, starboard' },
        { id: 'y0', kind: 'rcs', at: [PX(9), UY(0), Z(46)], label: 'rcs, port bow' },
        { id: 'y1', kind: 'rcs', at: [SX(9), UY(0), Z(46)], label: 'rcs, starboard bow' },
        { id: 'p0', kind: 'rcs', at: [A.cx, UY(8), Z(38)], label: 'rcs, dorsal' },
        { id: 'p1', kind: 'rcs', at: [A.cx, UY(-8), Z(38)], label: 'rcs, ventral' },
        { id: 'b0', kind: 'bay', at: [A.cx, UY(4), Z(42)], label: 'bay, dorsal' },
        { id: 'b1', kind: 'bay', at: [PX(3), UY(-4), Z(26)], label: 'bay, port keel' },
        { id: 'b2', kind: 'bay', at: [SX(3), UY(-4), Z(26)], label: 'bay, starboard keel' },
        { id: 'b3', kind: 'bay', at: [A.cx, UY(2), Z(18)], label: 'bay, aft' },
        { id: 'b4', kind: 'bay', at: [PX(4), UY(3), Z(34)], label: 'bay, port dorsal' },
        { id: 'b5', kind: 'bay', at: [SX(4), UY(3), Z(34)], label: 'bay, starboard dorsal' },
        { id: 'c0', kind: 'clamp', at: [PX(8), UY(-5), Z(24)], label: 'clamp, port' },
        { id: 'c1', kind: 'clamp', at: [SX(8), UY(-5), Z(24)], label: 'clamp, starboard' },
      ],
      note: 'A stacked spine rather than a slab: body run, dorsal stringer, and a '
        + 'ventral keel beam longer than the ship. Two sponsons ship empty.',
    },
    {
      classKey: 'rogue_frigate', name: 'Rogue Frigate',
      faction: 'rogue', tier: 'frigate', rung: 'frigate',
      radius: 1.5, massMax: 0.81, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      // The frame feature no other class has: a transverse boarding gallery
      // crossing the keel, carrying the clamps and the collars as one structure.
      profile: PROF_ROGUE,
      spine: [keel(0, 14, 48), slab(-11, -2, 26, 22, 4, 5),
        ...ribs(PROF_ROGUE, [18, 24, 30, 36, 42])],
      sockets: [
        { id: 'd0', kind: 'drive', at: [PX(5), UY(0), Z(11)], label: 'drive, port' },
        { id: 'd1', kind: 'drive', at: [A.cx, UY(0), Z(11)], label: 'drive, centre' },
        { id: 'd2', kind: 'drive', at: [SX(5), UY(0), Z(11)], label: 'drive, starboard' },
        seatAt(PROF_ROGUE, 'gun', 'g0', 'gun ring, port', zAt(PROF_ROGUE, 0.74), -0.7, 0.4),
        seatAt(PROF_ROGUE, 'gun', 'g1', 'gun ring, starboard', zAt(PROF_ROGUE, 0.74), 0.7, 0.4),
        { id: 'r0', kind: 'retro', at: [PX(5), UY(0), Z(44)], label: 'retro, port' },
        { id: 'r1', kind: 'retro', at: [SX(5), UY(0), Z(44)], label: 'retro, starboard' },
        { id: 'r2', kind: 'retro', at: [A.cx, UY(5), Z(44)], label: 'retro, dorsal' },
        { id: 'y0', kind: 'rcs', at: [PX(10), UY(0), Z(40)], label: 'rcs, port bow' },
        { id: 'y1', kind: 'rcs', at: [SX(10), UY(0), Z(40)], label: 'rcs, starboard bow' },
        { id: 'y2', kind: 'rcs', at: [PX(10), UY(0), Z(18)], label: 'rcs, port quarter' },
        { id: 'y3', kind: 'rcs', at: [SX(10), UY(0), Z(18)], label: 'rcs, starboard quarter' },
        { id: 'p0', kind: 'rcs', at: [A.cx, UY(8), Z(36)], label: 'rcs, dorsal' },
        { id: 'p1', kind: 'rcs', at: [A.cx, UY(-8), Z(36)], label: 'rcs, ventral' },
        { id: 'b0', kind: 'bay', at: [A.cx, UY(4), Z(40)], label: 'bay, bridge' },
        { id: 'b1', kind: 'bay', at: [PX(7), UY(0), Z(28)], label: 'gallery bay, port outer' },
        { id: 'b2', kind: 'bay', at: [PX(3), UY(0), Z(28)], label: 'gallery bay, port inner' },
        { id: 'b3', kind: 'bay', at: [SX(3), UY(0), Z(28)], label: 'gallery bay, starboard inner' },
        { id: 'b4', kind: 'bay', at: [SX(7), UY(0), Z(28)], label: 'gallery bay, starboard outer' },
        { id: 'b5', kind: 'bay', at: [PX(6), UY(0), Z(22)], label: 'gallery bay, port aft' },
        { id: 'b6', kind: 'bay', at: [SX(6), UY(0), Z(22)], label: 'gallery bay, starboard aft' },
        { id: 'b7', kind: 'bay', at: [A.cx, UY(-4), Z(22)], label: 'bay, ventral' },
        { id: 'b8', kind: 'bay', at: [PX(9), UY(2), Z(26)], label: 'collar, port' },
        { id: 'b9', kind: 'bay', at: [SX(9), UY(2), Z(26)], label: 'collar, starboard' },
        { id: 'c0', kind: 'clamp', at: [PX(11), UY(0), Z(30)], label: 'clamp, port forward' },
        { id: 'c1', kind: 'clamp', at: [SX(11), UY(0), Z(30)], label: 'clamp, starboard forward' },
        { id: 'c2', kind: 'clamp', at: [PX(11), UY(0), Z(24)], label: 'clamp, port aft' },
        { id: 'c3', kind: 'clamp', at: [SX(11), UY(0), Z(24)], label: 'clamp, starboard aft' },
        { id: 'a0', kind: 'bay', at: [PX(9), UY(-4), Z(30)], label: 'collar, port forward' },
        { id: 'a1', kind: 'bay', at: [SX(9), UY(-4), Z(30)], label: 'collar, starboard forward' },
        { id: 'a2', kind: 'bay', at: [PX(9), UY(-4), Z(24)], label: 'collar, port aft' },
        { id: 'a3', kind: 'bay', at: [SX(9), UY(-4), Z(24)], label: 'collar, starboard aft' },
        { id: 'a4', kind: 'bay', at: [A.cx, UY(-6), Z(27)], label: 'collar, ventral' },
        { id: 'b10', kind: 'bay', at: [PX(3), UY(4), Z(36)], label: 'bay, spare port' },
        { id: 'b11', kind: 'bay', at: [SX(3), UY(4), Z(36)], label: 'bay, spare starboard' },
        { id: 'c4', kind: 'clamp', at: [PX(11), UY(4), Z(27)], label: 'clamp, port upper' },
        { id: 'c5', kind: 'clamp', at: [SX(11), UY(4), Z(27)], label: 'clamp, starboard upper' },
      ],
      note: 'Short and wide, with a boarding gallery across its waist. The gear that '
        + 'makes it a raider is roughly a third of its mass, which is also why it has '
        + 'the least hull and the best turn rate.',
    },
    {
      classKey: 'benefactor_frigate', name: 'Benefactor Frigate',
      faction: 'benefactor', tier: 'frigate', rung: 'frigate',
      radius: 1.8, massMax: 0.59, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      // A deep aft drop keel, which is the one archived fact worth keeping from
      // a prefab that is otherwise a single mesh.
      profile: PROF_BENEFACTOR,
      spine: [keel(0, 14, 56), keel(-7, 4, 20, 5, 4), keel(6, 4, 20, 5, 3),
        ...ribs(PROF_BENEFACTOR, [18, 25, 32, 39, 46, 52])],
      sockets: [
        { id: 'd0', kind: 'drive', at: [A.cx, UY(-3), Z(5)], label: 'drive, main' },
        { id: 'd1', kind: 'drive', at: [SX(5), UY(-3), Z(6)], label: 'drive, starboard' },
        { id: 'd2', kind: 'drive', at: [PX(5), UY(-3), Z(6)], label: 'drive, port' },
        { id: 'd3', kind: 'drive', at: [A.cx, UY(5), Z(6)], label: 'drive, dorsal' },
        seatAt(PROF_BENEFACTOR, 'gun', 'g0', 'gun ring, port',
          zAt(PROF_BENEFACTOR, 0.72), -0.82, 0.46),
        seatAt(PROF_BENEFACTOR, 'gun', 'g1', 'gun ring, starboard',
          zAt(PROF_BENEFACTOR, 0.72), 0.82, 0.46),
        seatAt(PROF_BENEFACTOR, 'missile', 'm0', 'missile pad, ventral',
          zAt(PROF_BENEFACTOR, 0.44), 0, -0.5),
        seatAt(PROF_BENEFACTOR, 'gun', 'k0', 'aft stack, ventral',
          zAt(PROF_BENEFACTOR, 0.20), 0, -0.62),
        seatAt(PROF_BENEFACTOR, 'gun', 'k1', 'aft stack, dorsal',
          zAt(PROF_BENEFACTOR, 0.20), 0, 0.62),
        { id: 'a0', kind: 'bay', at: [PX(5), UY(-4), Z(34)], label: 'collar, port' },
        { id: 'a1', kind: 'bay', at: [SX(5), UY(-4), Z(34)], label: 'collar, starboard' },
        { id: 'r0', kind: 'retro', at: [PX(5), UY(0), Z(50)], label: 'retro, port' },
        { id: 'r1', kind: 'retro', at: [SX(5), UY(0), Z(50)], label: 'retro, starboard' },
        { id: 'y0', kind: 'rcs', at: [PX(8), UY(0), Z(46)], label: 'rcs, port bow' },
        { id: 'y1', kind: 'rcs', at: [SX(8), UY(0), Z(46)], label: 'rcs, starboard bow' },
        { id: 'p0', kind: 'rcs', at: [A.cx, UY(9), Z(38)], label: 'rcs, dorsal' },
        { id: 'p1', kind: 'rcs', at: [A.cx, UY(-9), Z(38)], label: 'rcs, ventral' },
        { id: 'b0', kind: 'bay', at: [A.cx, UY(4), Z(42)], label: 'bay, dorsal' },
        { id: 'b1', kind: 'bay', at: [PX(3), UY(0), Z(28)], label: 'bay, port' },
        { id: 'b2', kind: 'bay', at: [SX(3), UY(0), Z(28)], label: 'bay, starboard' },
        { id: 'b3', kind: 'bay', at: [A.cx, UY(-5), Z(22)], label: 'bay, ventral' },
        { id: 'b4', kind: 'bay', at: [PX(4), UY(3), Z(34)], label: 'bay, port dorsal' },
        { id: 'b5', kind: 'bay', at: [SX(4), UY(3), Z(34)], label: 'bay, starboard dorsal' },
        { id: 'c0', kind: 'clamp', at: [PX(7), UY(-4), Z(26)], label: 'clamp, port' },
        { id: 'c1', kind: 'clamp', at: [SX(7), UY(-4), Z(26)], label: 'clamp, starboard' },
      ],
      note: 'A long hull that steps down deeply aft, with a forward pair of cannon '
        + 'rings and a ventral missile rack. The aft stack ships empty.',
    },
    {
      classKey: 'freighter', name: 'Freighter',
      faction: 'civil', tier: 'freighter', rung: 'escort',
      radius: 2.9, massMax: 1.07, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_FREIGHTER,
      spine: [keel(0, 12, 48), keel(0, 16, 44, 14, 1),
        ...ribs(PROF_FREIGHTER, [18, 26, 34, 40])],
      // No gun ring anywhere. Every gun needs a barbette and every barbette needs
      // a ring, so the authored empty mount table becomes geometry rather than a
      // convention. No clamp seat either: its short reach is an absence.
      sockets: [
        { id: 'd0', kind: 'drive', at: [PX(4), UY(0), Z(9)], label: 'drive, port' },
        { id: 'd1', kind: 'drive', at: [A.cx, UY(0), Z(9)], label: 'drive, centre' },
        { id: 'd2', kind: 'drive', at: [SX(4), UY(0), Z(9)], label: 'drive, starboard' },
        { id: 'r0', kind: 'retro', at: [PX(5), UY(0), Z(46)], label: 'retro, port' },
        { id: 'r1', kind: 'retro', at: [SX(5), UY(0), Z(46)], label: 'retro, starboard' },
        { id: 'y0', kind: 'rcs', at: [PX(7), UY(0), Z(44)], label: 'rcs, port bow' },
        { id: 'y1', kind: 'rcs', at: [SX(7), UY(0), Z(44)], label: 'rcs, starboard bow' },
        { id: 'p0', kind: 'rcs', at: [A.cx, UY(7), Z(38)], label: 'rcs, dorsal' },
        { id: 'p1', kind: 'rcs', at: [A.cx, UY(-7), Z(38)], label: 'rcs, ventral' },
        { id: 'h0', kind: 'bay', at: [A.cx, UY(0), Z(38)], label: 'hold, forward' },
        { id: 'h1', kind: 'bay', at: [A.cx, UY(0), Z(22)], label: 'hold, aft' },
        { id: 'b0', kind: 'bay', at: [A.cx, UY(5), Z(46)], label: 'bay, bridge' },
        { id: 'b1', kind: 'bay', at: [PX(5), UY(0), Z(14)], label: 'bay, port aft' },
        { id: 'b2', kind: 'bay', at: [SX(5), UY(0), Z(14)], label: 'bay, starboard aft' },
        { id: 'b3', kind: 'bay', at: [A.cx, UY(5), Z(30)], label: 'bay, dorsal' },
        { id: 'b4', kind: 'bay', at: [PX(5), UY(-4), Z(30)], label: 'collar, port' },
        { id: 'b5', kind: 'bay', at: [SX(5), UY(-4), Z(30)], label: 'collar, starboard' },
        { id: 'b6', kind: 'bay', at: [A.cx, UY(-5), Z(18)], label: 'collar, ventral' },
        { id: 'b7', kind: 'bay', at: [PX(4), UY(4), Z(22)], label: 'bay, spare port' },
        { id: 'b8', kind: 'bay', at: [SX(4), UY(4), Z(22)], label: 'bay, spare starboard' },
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
      faction: 'terran', tier: 'corvette', rung: 'corvette',
      radius: 1.4, massMax: 0.36, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_TERRAN_CV,
      spine: [keel(0, 13, 49), ...ribs(PROF_TERRAN_CV, [18, 25, 32, 39, 45])],
      sockets: [
        ...suite(PROF_TERRAN_CV, [[-0.5, -0.2], [0.5, -0.2]], 5, 2),
        // Rests FORWARD rather than abeam. It is a waist ring by position, and
        // the waist default is abeam because the destroyer's ventral pair look
        // at each other along the keel; on this hull the beam is what is
        // blocked and the bow is clear.
        seatAt(PROF_TERRAN_CV, 'gun', 'g0', 'gun ring, nose', zAt(PROF_TERRAN_CV, 0.42), 0, 0.45, 0),
        seatAt(PROF_TERRAN_CV, 'gun', 'g1', 'gun ring, dorsal', zAt(PROF_TERRAN_CV, 0.24), 0, 0.55),
      ],
      note: 'The frigate’s slab cut down to a bell, a nozzle and two rings. Short enough '
        + 'that the whole hull turns inside a frigate’s circle, and thin enough on '
        + 'the belt that the first cannon through it reaches the reactor.',
    },
    {
      classKey: 'terran_destroyer', name: 'Terran Destroyer',
      faction: 'terran', tier: 'destroyer', rung: 'escort',
      radius: 2.6, massMax: 1.18, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_TERRAN_DD,
      // The raised dorsal spine is what makes a Terran read as a Terran from
      // above: a flat deck with a rail down the middle of it.
      spine: [keel(0, 4, 58), keel(5, 12, 48, 8, 2),
        ...ribs(PROF_TERRAN_DD, [10, 18, 26, 34, 42, 50])],
      sockets: [
        ...suite(PROF_TERRAN_DD, [[-0.55, -0.28], [0, -0.28], [0.55, -0.28],
          [-0.55, 0.35], [0, 0.35], [0.55, 0.35]], 11, 2),
        seatAt(PROF_TERRAN_DD, 'gun', 'g0', 'gun ring, nose', Z(51), 0, 0.42),
        seatAt(PROF_TERRAN_DD, 'gun', 'g1', 'gun ring, port waist', Z(36), -0.74, 0.26),
        seatAt(PROF_TERRAN_DD, 'gun', 'g2', 'gun ring, starboard waist', Z(36), 0.74, 0.26),
        seatAt(PROF_TERRAN_DD, 'gun', 'g3', 'gun ring, aft dorsal', Z(16), 0, 0.6),
        seatAt(PROF_TERRAN_DD, 'gun', 'g4', 'gun ring, ventral', Z(30), 0, -0.6),
      ],
      note: 'Three heavy bells and three verniers on a parallel sided slab, and five '
        + 'rings, four of them beams. '
        + 'The ventral ring is the one exception to the doctrine: a projectile turret, '
        + 'carried because a fleet of beams has nothing that goes through a belt.',
    },
    {
      classKey: 'terran_cruiser', name: 'Terran Heavy Cruiser',
      faction: 'terran', tier: 'cruiser', rung: 'cruiser',
      radius: 3.5, massMax: 2.1, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_TERRAN_CA,
      spine: [keel(0, 3, 59), keel(6, 10, 52, 10, 2), keel(-5, 8, 50, 8, 2),
        ...ribs(PROF_TERRAN_CA, [9, 17, 25, 33, 41, 49, 56])],
      sockets: [
        ...suite(PROF_TERRAN_CA, [[-0.62, -0.3], [-0.21, -0.3], [0.21, -0.3], [0.62, -0.3],
          [-0.62, 0.36], [-0.21, 0.36], [0.21, 0.36], [0.62, 0.36]], 15, 4),
        seatAt(PROF_TERRAN_CA, 'gun', 'g0', 'gun ring, nose', Z(53), 0, 0.4),
        seatAt(PROF_TERRAN_CA, 'gun', 'g1', 'gun ring, port forward', Z(42), -0.76, 0.24),
        seatAt(PROF_TERRAN_CA, 'gun', 'g2', 'gun ring, starboard forward', Z(42), 0.76, 0.24),
        seatAt(PROF_TERRAN_CA, 'gun', 'g3', 'gun ring, port aft', Z(22), -0.76, 0.24),
        seatAt(PROF_TERRAN_CA, 'gun', 'g4', 'gun ring, starboard aft', Z(22), 0.76, 0.24),
        seatAt(PROF_TERRAN_CA, 'gun', 'g5', 'gun ring, aft dorsal', Z(12), 0, 0.6),
        seatAt(PROF_TERRAN_CA, 'gun', 'g6', 'gun ring, forward ventral', Z(34), 0, -0.62),
        seatAt(PROF_TERRAN_CA, 'gun', 'g7', 'gun ring, aft ventral', Z(18), 0, -0.62),
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
      faction: 'karisen', tier: 'corvette', rung: 'corvette',
      radius: 1.6, massMax: 0.37, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_KARISEN_CV,
      // The ventral rail overruns the body at both ends, which is the one
      // Karisen habit that survives at every rung.
      spine: [keel(0, 13, 51), keel(-4, 10, 54, 4, 2),
        ...ribs(PROF_KARISEN_CV, [18, 25, 32, 39, 46])],
      sockets: [
        ...suite(PROF_KARISEN_CV, [[-0.55, -0.1], [0, -0.1], [0.55, -0.1]], 4, 2),
        seatAt(PROF_KARISEN_CV, 'gun', 'g0', 'gun ring, nose', zAt(PROF_KARISEN_CV, 0.44), 0, 0.45),
        seatAt(PROF_KARISEN_CV, 'missile', 'm0', 'missile pad, ventral',
          zAt(PROF_KARISEN_CV, 0.32), 0, -0.6),
      ],
      note: 'A needle with two overclocked bells, a vernier and one cell. Fastest hull in the game and the '
        + 'least able to take a hit: it is a ship for arriving with a missile already '
        + 'in the air and leaving before the answer.',
    },
    {
      classKey: 'karisen_destroyer', name: 'Karisen Destroyer',
      faction: 'karisen', tier: 'destroyer', rung: 'escort',
      radius: 2.8, massMax: 0.86, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_KARISEN_DD,
      spine: [keel(0, 3, 60), keel(-5, 0, 63, 4, 2), keel(5, 10, 52, 5, 2),
        ...ribs(PROF_KARISEN_DD, [9, 17, 25, 33, 41, 49, 56])],
      sockets: [
        ...suite(PROF_KARISEN_DD, [[-0.6, -0.12], [0, -0.12], [0.6, -0.12], [0, 0.5]], 8, 2, 0.5),
        seatAt(PROF_KARISEN_DD, 'gun', 'g0', 'gun ring, nose', Z(51), 0, 0.42),
        seatAt(PROF_KARISEN_DD, 'gun', 'g1', 'gun ring, aft dorsal', Z(16), 0, 0.58),
        seatAt(PROF_KARISEN_DD, 'missile', 'm0', 'missile pad, forward', Z(31), 0, -0.5),
        seatAt(PROF_KARISEN_DD, 'missile', 'm1', 'missile pad, aft', Z(22), 0, -0.5),
      ],
      note: 'Sixty cells of hull and nine of beam: the longest thin thing at its rung. '
        + 'A pair of ventral cells under a rail that runs past both ends of the body, '
        + 'and two beams that are there to finish rather than to open.',
    },
    {
      classKey: 'karisen_cruiser', name: 'Karisen Heavy Cruiser',
      faction: 'karisen', tier: 'cruiser', rung: 'cruiser',
      radius: 3.8, massMax: 1.4, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_KARISEN_CA,
      spine: [keel(0, 2, 61), keel(-6, 0, 63, 5, 2), keel(6, 8, 54, 6, 2),
        ...ribs(PROF_KARISEN_CA, [8, 16, 24, 32, 40, 48, 56])],
      sockets: [
        ...suite(PROF_KARISEN_CA, [[-0.62, -0.12], [-0.25, -0.12], [0.25, -0.12],
          [0.62, -0.12], [0, 0.52]], 9, 2, 0.5, [6, 14, 32, 54].map(Z)),
        seatAt(PROF_KARISEN_CA, 'gun', 'g0', 'gun ring, nose', Z(53), 0, 0.4),
        seatAt(PROF_KARISEN_CA, 'gun', 'g1', 'gun ring, aft dorsal', Z(14), 0, 0.58),
        // Three pairs down the rail, evenly, because that is what the rail is.
        // Four cells in a ROW down the keel rather than two abreast twice. A
        // Karisen is the narrowest hull at its rung and a cell is five cells
        // across: paired, the pair was pulled inboard until the two boxes met
        // over the centreline and each stood in the other's sweep.
        seatAt(PROF_KARISEN_CA, 'missile', 'm0', 'missile pad, first', Z(43), 0, -0.5),
        seatAt(PROF_KARISEN_CA, 'missile', 'm1', 'missile pad, second', Z(35), 0, -0.5),
        seatAt(PROF_KARISEN_CA, 'missile', 'm2', 'missile pad, third', Z(27), 0, -0.5),
        seatAt(PROF_KARISEN_CA, 'missile', 'm3', 'missile pad, fourth', Z(19), 0, -0.5),
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
      faction: 'rogue', tier: 'corvette', rung: 'corvette',
      radius: 1.2, massMax: 0.36, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_ROGUE_CV,
      // A cross beam through the keel, carrying the clamps and the collars as
      // one structure, exactly as the frigate does.
      spine: [keel(0, 15, 47), slab(-8, -2, 26, 16, 3, 4),
        ...ribs(PROF_ROGUE_CV, [20, 26, 32, 38, 44])],
      sockets: [
        ...suite(PROF_ROGUE_CV, [[-0.5, 0], [0, 0], [0.5, 0]], 6, 2),
        seatAt(PROF_ROGUE_CV, 'gun', 'g0', 'gun ring, nose', zAt(PROF_ROGUE_CV, 0.42), 0, 0.4),
      ],
      note: 'A boarding launch: one gun, two overclocked bells and a hull wide enough '
        + 'to put '
        + 'clamps on. It cannot fight anything and it does not have to, because '
        + 'everything it wants is already inside somebody else’s ship.',
    },
    {
      classKey: 'rogue_destroyer', name: 'Rogue Destroyer',
      faction: 'rogue', tier: 'destroyer', rung: 'escort',
      radius: 2.2, massMax: 1.01, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_ROGUE_DD,
      spine: [keel(0, 9, 51), slab(-11, -2, 24, 22, 4, 5),
        ...ribs(PROF_ROGUE_DD, [16, 22, 28, 34, 40, 46])],
      sockets: [
        ...suite(PROF_ROGUE_DD, [[-0.55, 0], [0, 0], [0.55, 0]], 17, 6),
        seatAt(PROF_ROGUE_DD, 'gun', 'g0', 'gun ring, port', Z(36), -0.7, 0.3),
        seatAt(PROF_ROGUE_DD, 'gun', 'g1', 'gun ring, starboard', Z(36), 0.7, 0.3),
        seatAt(PROF_ROGUE_DD, 'gun', 'g2', 'gun ring, aft dorsal', Z(12), 0, 0.58),
      ],
      note: 'Short, very wide and mostly barracks. Six clamps on a cross beam and '
        + 'forty five marines behind them: the guns exist to stop a hull running, not '
        + 'to sink it, because a sunk hull is a hull nobody took.',
    },
    {
      classKey: 'rogue_cruiser', name: 'Rogue Heavy Cruiser',
      faction: 'rogue', tier: 'cruiser', rung: 'cruiser',
      radius: 2.9, massMax: 1.51, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_ROGUE_CA,
      spine: [keel(0, 7, 53), slab(-13, -2, 22, 26, 4, 6),
        slab(-13, -2, 34, 26, 4, 6),
        ...ribs(PROF_ROGUE_CA, [14, 20, 26, 32, 38, 44, 50])],
      sockets: [
        ...suite(PROF_ROGUE_CA, [[-0.6, 0], [-0.2, 0], [0.2, 0], [0.6, 0]], 23, 8),
        seatAt(PROF_ROGUE_CA, 'gun', 'g0', 'gun ring, port forward', Z(40), -0.72, 0.3),
        seatAt(PROF_ROGUE_CA, 'gun', 'g1', 'gun ring, starboard forward', Z(40), 0.72, 0.3),
        seatAt(PROF_ROGUE_CA, 'gun', 'g2', 'gun ring, port aft', Z(20), -0.72, 0.3),
        seatAt(PROF_ROGUE_CA, 'gun', 'g3', 'gun ring, starboard aft', Z(20), 0.72, 0.3),
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
      faction: 'benefactor', tier: 'corvette', rung: 'corvette',
      radius: 1.3, massMax: 0.31, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_BENEFACTOR_CV,
      spine: [keel(0, 13, 49), keel(-5, 14, 28, 4, 3),
        ...ribs(PROF_BENEFACTOR_CV, [18, 25, 32, 39, 45])],
      sockets: [
        ...suite(PROF_BENEFACTOR_CV, [[0, -0.1], [-0.55, 0.3], [0.55, 0.3]], 5, 2),
        seatAt(PROF_BENEFACTOR_CV, 'gun', 'g0', 'gun ring, nose',
          zAt(PROF_BENEFACTOR_CV, 0.42), 0, 0.4),
        seatAt(PROF_BENEFACTOR_CV, 'missile', 'm0', 'missile pad, ventral',
          zAt(PROF_BENEFACTOR_CV, 0.30), 0, -0.55),
      ],
      note: 'Deeper than it is wide, on a hull four metres long. One cannon and one '
        + 'cell, and belts thick enough that a corvette of anybody else’s cannot '
        + 'get through them inside a turn.',
    },
    {
      classKey: 'benefactor_destroyer', name: 'Benefactor Destroyer',
      faction: 'benefactor', tier: 'destroyer', rung: 'escort',
      radius: 2.5, massMax: 1.03, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_BENEFACTOR_DD,
      // A deep aft drop keel and a shallower dorsal one: the section is the
      // whole Benefactor idea and the spine says so from the inside.
      spine: [keel(0, 4, 58), keel(-8, 6, 26, 5, 5), keel(7, 6, 24, 5, 3),
        ...ribs(PROF_BENEFACTOR_DD, [11, 19, 27, 35, 43, 51])],
      sockets: [
        ...suite(PROF_BENEFACTOR_DD, [[0, -0.05], [-0.55, 0.28], [0.55, 0.28], [0, 0.55]], 11, 2),
        seatAt(PROF_BENEFACTOR_DD, 'gun', 'g0', 'gun ring, port', Z(38), -0.7, 0.52),
        seatAt(PROF_BENEFACTOR_DD, 'gun', 'g1', 'gun ring, starboard', Z(38), 0.7, 0.52),
        seatAt(PROF_BENEFACTOR_DD, 'gun', 'g2', 'gun ring, aft dorsal', Z(16), 0, 0.58),
        seatAt(PROF_BENEFACTOR_DD, 'missile', 'm0', 'missile pad, ventral', Z(28), 0, -0.6),
      ],
      note: 'Three cannon on a section deeper than it is wide, and two heavy bells '
        + 'doing the pushing. Slowest hull at its rung, and the one that does not care '
        + 'what is painted on the outside of a belt.',
    },
    {
      classKey: 'benefactor_cruiser', name: 'Benefactor Heavy Cruiser',
      faction: 'benefactor', tier: 'cruiser', rung: 'cruiser',
      radius: 3.4, massMax: 1.7, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_BENEFACTOR_CA,
      spine: [keel(0, 3, 60), keel(-10, 6, 30, 6, 6), keel(8, 6, 28, 6, 4),
        ...ribs(PROF_BENEFACTOR_CA, [10, 18, 26, 34, 42, 50, 57])],
      sockets: [
        ...suite(PROF_BENEFACTOR_CA, [[0, -0.05], [-0.6, 0.25], [0.6, 0.25],
          [-0.35, 0.55], [0.35, 0.55]], 14, 4),
        seatAt(PROF_BENEFACTOR_CA, 'gun', 'g0', 'gun ring, port forward', Z(42), -0.72, 0.52),
        seatAt(PROF_BENEFACTOR_CA, 'gun', 'g1', 'gun ring, starboard forward', Z(42), 0.72, 0.52),
        seatAt(PROF_BENEFACTOR_CA, 'gun', 'g2', 'gun ring, port aft', Z(22), -0.72, 0.52),
        seatAt(PROF_BENEFACTOR_CA, 'gun', 'g3', 'gun ring, starboard aft', Z(22), 0.72, 0.52),
        seatAt(PROF_BENEFACTOR_CA, 'missile', 'm0', 'missile pad, forward', Z(38), 0, -0.6),
        seatAt(PROF_BENEFACTOR_CA, 'missile', 'm1', 'missile pad, aft', Z(27), 0, -0.6),
      ],
      note: 'Twelve cells to the keel and the heaviest berth in the game. Four cannon, '
        + 'two cells and six layers of belt, on a hull that comes about at under two '
        + 'degrees a second. Whatever it is pointed at, it stays pointed at.',
    },

    // ------------------------------------------------------------- civil --
    //
    // Not a ladder. The four navies build the same ship four sizes; the civil
    // yards build six different ships, and what a hull is FOR is its whole
    // shape: a box ship is a rack with an engine, a tanker is a bulge round a
    // cylinder, a liner is a hotel, and a mining ship is an arm with a hull
    // behind it to hold the rock. None of them carries a gun ring, so none of
    // them can be armed, which is the same rule the Freighter has always had
    // written as geometry rather than as a convention.
    {
      classKey: 'civil_lighter', name: 'Lighter',
      faction: 'civil', tier: 'lighter', rung: 'escort',
      radius: 2, massMax: 0.52, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_LIGHTER,
      spine: [keel(0, 18, 46), ...ribs(PROF_LIGHTER, [22, 28, 34, 40])],
      sockets: [
        ...suite(PROF_LIGHTER, [[-0.45, -0.1], [0.45, -0.1]], 5, 0),
        ...rack(PROF_LIGHTER, 2, 1, 2),
      ],
      note: 'Two boxes and a bridge. The smallest thing anybody calls a ship: it '
        + 'runs between a hull in orbit and a yard, and it has no reason to be '
        + 'anywhere a shot is being fired.',
    },
    {
      classKey: 'civil_hauler', name: 'Hauler',
      faction: 'civil', tier: 'hauler', rung: 'escort',
      radius: 2.5, massMax: 1.24, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_HAULER,
      spine: [keel(0, 8, 56), keel(7, 16, 44, 12, 1),
        ...ribs(PROF_HAULER, [12, 20, 28, 36, 44, 52])],
      sockets: [
        ...suite(PROF_HAULER, [[-0.5, -0.15], [0, -0.15], [0.5, -0.15]], 7, 2),
        ...rack(PROF_HAULER, 6, 2, 2),
      ],
      note: 'Six boxes on a rack, three tug bells and a berth for the crew who '
        + 'ride with them. The hull most of everything anybody eats arrives on.',
    },
    {
      classKey: 'civil_boxship', name: 'Container Ship',
      faction: 'civil', tier: 'boxship', rung: 'cruiser',
      radius: 3.5, massMax: 2.43, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_BOXSHIP,
      spine: [keel(0, 4, 60), keel(8, 12, 52, 16, 1), keel(-7, 12, 52, 12, 1),
        ...ribs(PROF_BOXSHIP, [8, 16, 24, 32, 40, 48, 56])],
      sockets: [
        ...suite(PROF_BOXSHIP, [[-0.55, -0.2], [0, -0.2], [0.55, -0.2],
          [-0.3, 0.35], [0.3, 0.35]], 7, 2),
        ...rack(PROF_BOXSHIP, 12, 2, 3),
      ],
      note: 'Twelve boxes in four tiers of three, and a bridge stuck on the front '
        + 'of them because there was nowhere else to put it. Nothing about this '
        + 'ship is for anything except the boxes.',
    },
    {
      classKey: 'civil_tanker', name: 'Tanker',
      faction: 'civil', tier: 'tanker', rung: 'cruiser',
      radius: 3.3, massMax: 2.14, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_TANKER,
      spine: [keel(0, 4, 60), keel(-8, 14, 50, 8, 1),
        ...ribs(PROF_TANKER, [10, 18, 26, 34, 42, 50, 57])],
      sockets: [
        ...suite(PROF_TANKER, [[-0.5, -0.2], [0, -0.2], [0.5, -0.2],
          [-0.28, 0.3], [0.28, 0.3]], 5, 0),
        ...rack(PROF_TANKER, 6, 2, 1),
      ],
      note: 'Six pressure vessels with a walkway over the top of them and a hull '
        + 'wrapped round the lot. The radiator slats down the flanks are what it '
        + 'has instead of windows, because nobody lives in a tank.',
    },
    {
      classKey: 'civil_miner', name: 'Mining Ship',
      faction: 'civil', tier: 'miner', rung: 'escort',
      radius: 2.2, massMax: 1.32, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_MINER,
      spine: [keel(0, 10, 52), keel(-6, 14, 48, 10, 1),
        ...ribs(PROF_MINER, [14, 22, 30, 38, 46])],
      sockets: [
        ...suite(PROF_MINER, [[-0.45, -0.15], [0.45, -0.15]], 5, 2),
        ...rack(PROF_MINER, 4, 2, 1),
        // Rings, but not gun rings: a cutting head is a thing that TURNS, and a
        // ring is the frame's own answer to that. Nothing armed can go here,
        // because the class carries no mounts and the core reads the class.
        seatAt(PROF_MINER, 'gun', 'g0', 'boom ring, port', Z(44), -0.62, 0.1),
        seatAt(PROF_MINER, 'gun', 'g1', 'boom ring, starboard', Z(44), 0.62, 0.1),
      ],
      note: 'Two cutting booms on rings at the bow and four hoppers behind them. '
        + 'It works a rock rather than a fleet, and the only thing it can do to '
        + 'a warship is be in the way.',
    },
    {
      classKey: 'civil_liner', name: 'Liner',
      faction: 'civil', tier: 'liner', rung: 'cruiser',
      radius: 3.6, massMax: 1.96, baseReach: 10, baseMarines: 0, baseCapacity: 0,
      profile: PROF_LINER,
      spine: [keel(0, 2, 62), keel(7, 10, 54, 14, 1),
        ...ribs(PROF_LINER, [8, 16, 24, 32, 40, 48, 56])],
      sockets: [
        ...suite(PROF_LINER, [[-0.5, -0.2], [0, -0.2], [0.5, -0.2],
          [-0.28, 0.28], [0.28, 0.28]], 13, 2),
        ...rack(PROF_LINER, 2, 1, 2),
      ],
      note: 'Decks of people, lit from end to end. It is the one hull on the '
        + 'field that is brighter than the sky behind it, and the only thing it '
        + 'is carrying is passengers.',
    },
  ];
  return table;
};

/**
 * The fleet, each class on its own lattice.
 *
 * Built once per rung and then picked apart: every pass produces the same
 * classes in the same order, so frame n of the pass whose rung matches frame n
 * is the one to keep. Grouping by rung instead would reorder the fleet in
 * every picker that walks this list.
 */
export const FRAMES: readonly FrameDef[] = (() => {
  const passes = {} as Record<RungKey, FrameDef[]>;
  for (const r of Object.keys(RUNG) as RungKey[]) {
    A = RUNG[r];
    passes[r] = buildFrames();
  }
  A = REF;
  return (passes.frigate as FrameDef[])
    .map((f, n) => (passes[f.rung] as FrameDef[])[n] as FrameDef);
})();


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
export function boxInside(L: Lat, prof: readonly Station[],
  x: number, y: number, z: number,
  hx: number, hy: number, hz: number, inset = 1): boolean {
  const CX = L.cx, CY = L.cy;
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
  const { cx: CX, cy: CY } = latOf(frame);
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
      ? !insideHull(latOf(frame), prof, x + s * t, y, k)
      : !insideHull(latOf(frame), prof, x, y + s * t, k);
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

/**
 * A frame the ARCHITECT is editing, standing in for the authored one.
 *
 * The architect is an authoring tool, not a second way to field a ship: what a
 * class derives is in the core's table and that table is hashed into the match
 * state, so a frame edited here and flown there would be one seat playing a
 * different ship from the other. It previews and it EXPORTS; the edit reaches
 * a match by going back into this file and through `measure_fleet.mjs --sync`,
 * which is the same road every stock number already travels.
 *
 * So this is deliberately one frame at a time, set on the way into the screen
 * and cleared on the way out, rather than a store the rest of the app reads.
 */
let override: FrameDef | null = null;
/** Bumped on every change, because `rasterSig` keys a cache on the CLASS and
 *  two different frames under one class key would otherwise share a raster. */
let overrideGen = 0;

/** Put a frame in front of its authored one, or `null` to take it away. */
export function setFrameOverride(f: FrameDef | null): void {
  override = f;
  overrideGen++;
  seated.clear();
}

/** Which class is being overridden, if any. For the signature and for screens
 *  that have to say so out loud. */
export function frameOverride(): FrameDef | null { return override; }
export function frameGen(): number { return overrideGen; }

/** The frame as this build authored it, whatever the architect is showing. */
export const stockFrameFor = (classKey: string): FrameDef =>
  FRAMES.find(x => x.classKey === classKey) ?? (FRAMES[0] as FrameDef);

export const frameFor = (classKey: string): FrameDef => {
  if (override && override.classKey === classKey) return override;
  const hit = seated.get(classKey);
  if (hit) return hit;
  const f = stockFrameFor(classKey);
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
  const L = latOf(frame), CX = L.cx, CY = L.cy;
  const rings = frame.sockets.filter(s => s.kind === 'gun');
  const out: Socket[] = frame.sockets.map(s => (s.kind === 'gun' ? ringSeat(frame, s, rings) : s));
  for (const p of parts) {
    if (p.module !== 'WPN-BB1') continue;
    const base = out.find(s => s.id === p.socket);
    if (!base) continue;
    // The gun goes on TOP of its barbette, and "top" is away from the hull
    // rather than up. Always +2 in y put an under keel turret two cells
    // further INSIDE its own ship: the barrel was in the plating, and the arc
    // scan reported the whole sphere blocked, which is a mount that cannot
    // fire in any direction and looks like one that can.
    const [ox, oy] = outwardAt(L, frame.profile, base.at);
    const [hw, hh] = hullAt(frame.profile, base.at[2] as number);
    // ON the skin, not two cells nearer to it. A barbette is a drum SET INTO
    // the plating and the gun sits on top of the drum, so the trunnion goes
    // where the plating is: two cells out of a ring seated at six tenths of
    // the beam is still inside the ship, and a barrel inside the ship is a
    // barrel that cannot see out.
    // Mirrored the same way a socket is, and for the same reason: rounded
    // straight, the port turret came out a cell nearer its own plating than
    // the starboard one, and the arc scan read that back as one gun blocked
    // 68 percent and its twin 36.
    const at: [number, number, number] = ox
      ? [acrossFrom(CX, ox, (hw as number) + 1), base.at[1] as number, base.at[2] as number]
      : [base.at[0] as number, acrossFrom(CY, oy, (hh as number) + 1), base.at[2] as number];
    out.push({
      id: `${base.id}/t`, kind: 'trunnion', label: `${base.label}, trunnion`,
      at,
      ...(base.facing === undefined ? {} : { facing: base.facing }),
    });
  }
  return out;
}

/**
 * A gun ring, moved out to the plating it is set into.
 *
 * A barbette is a drum SET INTO the skin: its toothed ring is flush with the
 * plating and its body is inside, which is the only way its base has anything
 * to bolt to. Frames author a ring at a fraction of the beam, and on a flank
 * that fraction put the whole drum three courses UNDER the plating with the
 * gun sitting on the skin above it, bolted to the hull rather than to its own
 * base. The drum is three courses thick, so its ring lands on the skin when
 * its centre sits one course in; the trunnion then goes one course further
 * out, which is on top of the ring rather than a gap away from it.
 *
 * The face is taken before the move and the rest facing after it, so a ring
 * that slides out along its own face keeps that face.
 */
const ringSeat = (frame: FrameDef, s: Socket, rings: readonly Socket[]): Socket => {
  const { cx: CX, cy: CY } = latOf(frame);
  const [ox, oy] = outwardAt(latOf(frame), frame.profile, s.at);
  const [hw, hh] = hullAt(frame.profile, s.at[2] as number);
  const at: [number, number, number] = ox
    ? [acrossFrom(CX, ox, (hw as number) - 1), s.at[1] as number, s.at[2] as number]
    : [s.at[0] as number, acrossFrom(CY, oy, (hh as number) - 1), s.at[2] as number];
  return ringFacing(frame, { ...s, at }, rings);
};

/**
 * Which face of the hull a socket sits on, as a unit step in x or y.
 *
 * The same test the shell uses to decide whether a cell is deck, belly or
 * flank: whichever of the two normalised offsets is larger wins. One rule, so
 * a ring that the plate calls a flank ring is a flank ring here too.
 */
export const outwardAt = (
  L: Lat, prof: readonly Station[], at: readonly [number, number, number],
): readonly [number, number] => {
  const [hw, hh] = hullAt(prof, at[2] as number);
  const dx = ((at[0] as number) + 0.5 - L.cx) / Math.max(0.5, hw as number);
  const dy = ((at[1] as number) + 0.5 - L.cy) / Math.max(0.5, hh as number);
  if (Math.abs(dy) > Math.abs(dx)) return [0, dy >= 0 ? 1 : -1];
  return [dx >= 0 ? 1 : -1, 0];
};

/**
 * A gun ring's rest facing, which is a traverse about the mount's OWN axis
 * and therefore reads differently on a deck than on a flank.
 *
 * A ring on the deck or the belly traverses in the horizontal plane, so it
 * CAN rest along the keel, and along the keel is what a gun is for: a bow
 * chaser resting broadside is a main battery pointing at nothing anybody was
 * aiming at. So a centreline ring rests forward if it is forward of midships
 * and aft if it is abaft, exactly as a flank ring does.
 *
 * ABEAM is for the WAIST, and that is the whole of the distinction. What a
 * centreline ring can rest along is decided by how near an END of the hull it
 * is, not by which half it is in: a ring in the bow has a clear run ahead of
 * it and one on the transom has a clear run astern, while a ring amidships
 * has most of its own ship in both directions and abeam is the only way it
 * sees anything at all.
 *
 * Two cuts of this got it wrong in opposite directions, and the arc scan
 * caught both. Resting every centreline ring abeam applied the heavy
 * cruiser's fix to hulls with nothing to fix: the Terran frigate carries one
 * dorsal ring at 0.85 of its length, with nothing in front of it, and it
 * rested broadside. Resting them all along the keel by which half they sat in
 * then pointed the Terran destroyer's ventral ring, at 0.46, straight down
 * twenty six cells of its own hull, because "abaft midships" was true of it
 * by a single cell.
 *
 * A pair on the same face is still a pair, and still goes abeam whatever band
 * it is in: the cruiser's two ventral rings resting fore and aft looked
 * straight at each other, which is what a superfiring position exists to
 * solve and this lattice has no room for.
 *
 * A ring on a FLANK has its axis outboard, since that is the way its base
 * bolts down, so its traverse is the vertical plane along the hull and abeam
 * is where it cannot rest at all: abeam is straight up its own barbette. It
 * rests along the keel instead, forward on a ring forward of midships and aft
 * on one abaft, for the same reason the deck pair are trained to opposite
 * sides. Pointing outboard was right while every mount was drawn +y up and is
 * a barrel in the deck now.
 */
/** How near an end a centreline ring has to be to rest along the keel. A
 *  ring outside these bands is in the waist, where the ship is in the way
 *  both ways and abeam is the only clear rest. */
const BOW_RING = 0.70, STERN_RING = 0.25;

const ringFacing = (frame: FrameDef, s: Socket, rings: readonly Socket[]): Socket => {
  // An authored facing wins. Where a ring sits decides which way it rests in
  // almost every case, and in a handful it cannot: the Terran corvette's waist
  // deck ring and the Terran destroyer's waist ventral ring are in the same
  // band and want opposite answers, because what is actually in the way is the
  // hull rather than the position. A rule that guessed from position alone
  // would have to be wrong about one of them, so the frame gets the last word
  // and `sim.test.mjs` is what proves the word was right.
  if (s.facing !== undefined) return s;
  const prof = frame.profile;
  const L = latOf(frame);
  const [ox, oy] = outwardAt(L, prof, s.at);
  const aft = Math.round((prof[0] as Station)[0]);
  const nose = Math.round((prof[prof.length - 1] as Station)[0]);
  const t = ((s.at[2] as number) - aft) / Math.max(1, nose - aft);
  const fwd = t >= 0.5;
  // A flank ring's traverse is the vertical plane along the hull, so abeam is
  // straight up its own barbette and not a rest at all: it takes the nearer
  // end whatever band it is in.
  if (ox) return { ...s, facing: fwd ? 0 : 2 };
  const nearEnd = t >= BOW_RING || t <= STERN_RING;
  // Another ring on the SAME face, ahead of this one if it would rest forward
  // or astern of it if aft. Same face because a dorsal gun and a ventral one
  // are on opposite sides of the ship and neither is in the other's line: the
  // cruiser's clash was two rings on one belly.
  const paired = rings.some(r => r.id !== s.id
    && outwardAt(L, prof, r.at)[0] === 0 && outwardAt(L, prof, r.at)[1] === oy
    && (fwd ? (r.at[2] as number) > (s.at[2] as number)
      : (r.at[2] as number) < (s.at[2] as number)));
  if (!nearEnd || paired) return { ...s, facing: fwd ? 1 : 3 };
  return { ...s, facing: fwd ? 0 : 2 };
};

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
  /**
   * The other two axes, in the same quarter turns.
   *
   * Yaw alone can only ever bolt a gun to a deck. `pitch` tips it over so it
   * can sit under a keel, and `roll` lays it onto a flank, which is how a
   * broadside gets built. Optional and defaulting to zero, so a hull saved
   * before these existed is still exactly the hull it was: no migration, and
   * nothing to get wrong on somebody else's design.
   *
   * What a rotation may NOT do is only two things: lift the barbette off the
   * frame, or put the body inside a cell something else already owns. See
   * `mountFouling`.
   */
  readonly pitch?: number;
  readonly roll?: number;
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
  /**
   * Cells painted BY HAND, as `cell * 8 + slot`.
   *
   * The palette used to be a scheme picker: choosing a swatch set `paint` and
   * every other role moved with it, so a player who wanted one panel a
   * different colour repainted the whole ship instead. A slot picked here is
   * a BRUSH, and this is where the strokes go.
   *
   * One integer per cell rather than a pair, because this is a wire format
   * living in a design record beside `plate` and `cut` and it is measured
   * against the same budget. Eight slots, so the low three bits are the slot
   * and the rest is the cell.
   */
  tint?: number[];
  /**
   * The lattice `plate` and `cut` were drawn on, as [nx, ny, nz].
   *
   * A cell index means nothing without it: cell 5000 is one place on a
   * corvette's 24 x 24 x 48 and another on a heavy cruiser's 64 x 64 x 128, so
   * a record saved on one lattice and read on another is a hull with its
   * hand drawn armour scattered through it.
   *
   * Optional, and absent means the one lattice there used to be, which is why
   * `migrateDesign` can carry a design saved before this existed onto the
   * hull it was drawn for instead of throwing it away.
   */
  lattice?: readonly [number, number, number];
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
   * A finish per ARMOUR BAND, overriding the navy's livery.
   *
   * Sparse and optional: an absent entry means the livery's own answer, and
   * entry nought is ignored because the broad plating is what `finish` and
   * `slotFinish` already name. A hull saved before bands existed therefore
   * comes back wearing its navy's trim, which is what it would have worn.
   */
  bandFinish?: (string | null)[];
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
  /**
   * What the DRIVES and the GUNS are made of, apart from everything else.
   *
   * `partFinish` was ONE answer for all machinery, on the grounds that a
   * player can already tell a drive from a gun by its colour and the
   * distinction worth drawing was machinery against plate. That is still true
   * of the COLOUR and it was never true of the SURFACE: a drive bell is a
   * cast nozzle, a turret is a machined gun and a barracks is a box, and one
   * greeble over all three says none of it.
   *
   * Optional, and absent means whatever `partFinish` says, which is what every
   * design that predates them already has: nothing to migrate.
   */
  driveFinish?: string;
  weaponFinish?: string;
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
  /**
   * Cells that were touching nothing and have been taken off.
   *
   * Zero on anything authored; above zero means a frame's decor, a pylon or a
   * hand drawn stroke left a block hanging in space, which is not a ship.
   */
  readonly orphans: number;
  /** Cells inside a turret box or a drive's throat that something else is
   *  standing in. Zero on anything this rasteriser built; above zero means a
   *  part was placed into one, or a design saved before the rule came in. */
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
  /**
   * What livery role each ARMOUR cell plays, one based, zero for anything
   * that is not armour.
   *
   * Beside the material rather than worked out again by every picture: the
   * map, the yard, the schematic and the wound all have to agree about which
   * patch of plating is the deck, and four answers to that is four ships.
   * It is a pure function of the same inputs the grid is, so it needs nothing
   * added to `rasterSig`.
   */
  readonly tone: Uint8Array;
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
  /**
   * Cells that were touching nothing and have been taken off.
   *
   * Zero on anything authored; above zero means a frame's decor, a pylon or a
   * hand drawn stroke left a block hanging in space, which is not a ship.
   */
  readonly orphans: number;
  /**
   * Cells the weld pass ADDED to reattach a loose piece.
   *
   * They are plate like any other once drawn, and the mount rule has to be
   * able to tell them apart anyway: a spar grown to catch a floating turret
   * would otherwise answer "is this base still on the ship" with yes, every
   * time, and the gate that refuses a rotation lifting a mount off its hull
   * would pass on every hull without ever being reachable.
   */
  readonly welded: Uint8Array;
  /** Cells inside a turret box or a drive's throat that something else is
   *  standing in. Zero on anything this rasteriser built; above zero means a
   *  part was placed into one, or a design saved before the rule came in. */
  readonly fouled: number;
  /**
   * The cavity inside every drive bell: claimed, and empty.
   *
   * A bell is a one cell wall round a throat and the throat is the engine's.
   * Exposed so the armour pencil can refuse a stroke there with a reason,
   * rather than letting a player draw a cell that makes the hull illegal and
   * only finding out from the verdict.
   */
  readonly hollow: Uint8Array;
  /**
   * Cells of a DRIVE that some other part wanted.
   *
   * The same rule as a turret's sweep and for the same reason: the two are not
   * the same kind of bad. A berth that lost a few cells to a neighbour came
   * out small; a boarding clamp bolted through a drive bell is not a ship. A
   * Karisen corvette carried twenty three cells of docking clamp in its
   * engines, and most hulls in the fleet had a clamp or a barracks in theirs.
   */
  readonly bellFouled: number;
  readonly extent: readonly [number, number, number];
  /** The true bounding sphere, in cells, about the hull's own centre.
   *  A box diagonal is not one: it measures corners a long thin ship has
   *  nothing in, and it failed every frigate on a gate they actually pass. */
  readonly radiusCells: number;
}

const idx3 = (L: Lat, i: number, j: number, k: number) =>
  i + j * L.nx + k * L.nx * L.ny;

/**
 * A cell's index, and back again. The WIRE FORMAT for hand drawn armour.
 *
 * It depends on the lattice, so a design record written on one lattice cannot
 * be read on another: `d.plate` and `d.cut` are indices, and index 5000 is a
 * different cell on a corvette from what it is on a heavy cruiser. `saves.ts`
 * and the library carry a lattice stamp for that reason, and a record from
 * before the lattices existed is migrated on the way in rather than dropped.
 */
export const cellIndex = (L: Lat, i: number, j: number, k: number): number =>
  idx3(L, i, j, k);
export const cellAt = (L: Lat, n: number): readonly [number, number, number] =>
  [n % L.nx, ((n / L.nx) | 0) % L.ny, (n / (L.nx * L.ny)) | 0];

/** How many cells a player may draw. A frigate's whole skin is about 5,000,
 *  so this is room to work in, not a target, and it is what keeps a design
 *  record inside the library's 64 KB. */
export const DRAWN_MAX = 20000;

/** A design's identity for caching. Paint is not in it: the raster does not
 *  depend on it, and anything that draws colour keys on this plus the paint. */
export const rasterSig = (d: Design): string =>
  // The override generation first, because the rest of this describes the
  // DESIGN and a frame edited under the same class key would otherwise be
  // handed the previous frame's raster out of the cache.
  (override ? `f${overrideGen}|` : '')
  + d.classKey + '|' + d.armour + '|'
  + d.parts.map(p => p.socket + ':' + p.module + ':' + facingKey(facingOf(p)))
    .sort().join(',') + '|'
  + SECTIONS.map(k => d.sections[k]).join(',') + '|'
  // A length and a sum: cheap, and it changes whenever a cell does. The cache
  // is a frame's worth of work, not a correctness boundary.
  + drawSig(d.plate) + '/' + drawSig(d.cut) + '/' + drawSig(d.tint);

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
/** What a cell inside a turret's sweep costs the nudge, against one cell of
 *  another part. Bigger than any part's cell count, so a legal seat always
 *  beats an illegal one however cramped it is. */
const FOUL_COST = 4096;

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
export function bareGrid(grid: Uint8Array, own?: Int16Array): Uint8Array {
  const out = Uint8Array.from(grid);
  for (let n = 0; n < out.length; n++) {
    const m = out[n] as number;
    // A cell a PART owns is not armour, whatever material it is drawn with.
    // A container on the deck is painted in the ship's own livery, which is
    // the same material a plate is, and taking the plate off should not take
    // the cargo off with it.
    if (own && (own[n] as number) > 0) continue;
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
  const LAT = latOf(frame);
  // Shadowed rather than spelt through `L` at each of the seventy odd uses
  // below. This function IS the lattice walk, and it reads as one.
  const { nx: NX, ny: NY, nz: NZ, cells: CELLS, cx: CX, cy: CY } = LAT;
  const prof = frame.profile;
  const grid = new Uint8Array(CELLS);
  const purp = new Uint8Array(CELLS);
  // Which placement owns a cell, one based, so a click on the picture can name
  // the part it landed on. Zero is frame or plate.
  const own = new Int16Array(CELLS);
  // Which livery role each armour cell plays. Written wherever plate is, and
  // only there: a part or a bare frame member is not painted.
  const tone = new Uint8Array(CELLS);
  const inBounds = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ;
  /** Writes the cell if it is free. Returns whether it took it, because the
   *  owner map must never claim a cell another part is already standing in. */
  const set = (i: number, j: number, k: number, mat: number, code: number): boolean => {
    if (!mat || !inBounds(i, j, k)) return false;
    const n = idx3(LAT, i, j, k);
    if (grid[n]) return false;
    grid[n] = mat;
    purp[n] = code;
    return true;
  };

  const STRUCT = purposeCode('structure');

  /** Lay one cell of armour and say what it is FOR, in one call, because the
   *  two were written in five places between them and a plate cell with no
   *  role drew as role zero: a stern band the length of the ship. */
  const skin = (i: number, j: number, k: number, role: LiveryRole): void => {
    const n = idx3(LAT, i, j, k);
    if (grid[n] === Mat.Frame) grid[n] = Mat.Skinned;
    else if (!set(i, j, k, Mat.Plate, STRUCT)) return;
    tone[n] = roleCode(role);
  };

  // --- the frame, which the player cannot edit --------------------------
  //
  // Clamped to the hull's own ends. A spine is authored as cell runs and the
  // profiles are cut from a section now, so a run that fitted the silhouette
  // it was drawn against can stand off the end of the one it has: every
  // corvette's keel ran six cells past its own bow and stern, which made a
  // hull half a frigate long measure two thirds of one and drew a bare grey
  // spar out of the nose.
  const spineA = Math.max(0, Math.round((prof[0] as Station)[0]));
  const spineB = Math.min(NZ - 1, Math.round((prof[prof.length - 1] as Station)[0]));
  for (const [x, y, z, w, h, l] of frame.spine)
    for (let k = 0; k < l; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const pz = Math.round(z) + k;
      if (pz < spineA || pz > spineB) continue;
      set(Math.round(x) + i, Math.round(y) + j, pz, Mat.Frame, STRUCT);
    }

  // --- every fitted part, on whole cells, carrying its purpose ----------
  const allSockets = socketsOf(frame, d.parts);
  // Cells of a part that stand outboard of the hull line. They get a pylon
  // back to it below, because a pod hanging in space beside its own ship is
  // exactly the slop that voxels were supposed to end.
  const outboard: number[] = [];
  /** The boxes turrets sweep, which nothing else may occupy. */
  const turrets: TurretBox[] = [];
  let enclosedOutside = 0, flushProud = 0, bellFouled = 0;
  // Guns first, then everything else.
  //
  // A turret's box is its own, and a box only exists once the turret is
  // placed: seating a bay before the gun beside it means the gun arrives to
  // find the box already occupied, and the design is illegal with no legal
  // move left, because parts are fitted rather than dragged. Placing the
  // turrets first makes that unreachable rather than merely unlikely.
  const isGun = (n: number) => !!moduleById((d.parts[n] as Placement).module)?.weapon;
  // Drives go second, for the same reason turrets go first: a drive's volume
  // is its own and nothing may stand in it, and a volume only exists once the
  // part is placed. A bay seated before the drive beside it means the drive
  // arrives to find its own bell occupied.
  const isDrive = (n: number) => {
    const m = moduleById((d.parts[n] as Placement).module);
    return !!m && (m.fits === 'drive' || m.fits === 'retro');
  };
  const every = d.parts.map((_, n) => n);
  const order = [
    ...every.filter(isGun),
    ...every.filter(n => !isGun(n) && isDrive(n)),
    ...every.filter(n => !isGun(n) && !isDrive(n)),
  ];
  const reserved = new Uint8Array(CELLS);
  /**
   * The drive bells, which are nobody else's to stand in.
   *
   * A part's cells are claimed first come first served and the nudge treats a
   * cell another part is standing in as costing one point, so a clamp with
   * nowhere better to go simply settled inside the engines: measured over the
   * fleet, a Karisen corvette carried twenty three cells of docking clamp in
   * its drive block and most hulls had a clamp or a barracks in theirs. A
   * berth that lost a few cells to a neighbour is a berth that came out small;
   * a boarding clamp bolted through a drive bell is not a ship.
   *
   * Weighted like a turret's sweep rather than like an occupied cell, so the
   * nudge walks OUT of a drive instead of settling for the nearest hole
   * whichever it is. That distinction is the one the turret boxes already
   * taught: the two are not the same kind of bad.
   */
  const bells = new Uint8Array(CELLS);
  /**
   * The CAVITY inside a drive bell, which is the engine's and must stay empty.
   *
   * A bell is a one cell wall round a throat, and the throat is as much a part
   * of the engine as the metal: a docking clamp bolted up the mouth of a
   * nozzle is not a ship. So a cavity is reserved exactly as a turret's sweep
   * is, and anything found standing in one is counted with the same number and
   * fails the same gate.
   */
  const hollow = new Uint8Array(CELLS);
  // Which cells the weld pass grew, so the mount rule can ask whether a base
  // is on the SHIP rather than on a spar the weld grew to catch it.
  const welded = new Uint8Array(CELLS);

  /**
   * Where a placement ended up, and which placement is its mirror twin.
   *
   * A pair of fittings on exactly mirrored sockets still came out on cells
   * that were not mirrored, because each one SEARCHED for its own hole. The
   * search sees the grid the placements before it left, and one asymmetric
   * part makes the next one's search asymmetric, so a single displaced fitting
   * cascades down the whole list: the Terran frigate's clamps ended six cells
   * inboard of their sockets, five cells apart in z, and every beacon window
   * on the hull was on one side only.
   *
   * So a pair is placed AS a pair. The first of the two searches; the second
   * takes the mirror of what the first found, and only falls back to its own
   * search if the mirror does not fit. Symmetry by construction rather than by
   * two searches happening to agree.
   */
  const placedAt = new Map<number, readonly [number, number, number]>();
  const twinOf = new Map<number, number>();
  {
    const bySocket = new Map<string, number>();
    d.parts.forEach((p, n) => bySocket.set(p.socket, n));
    for (const s of allSockets) {
      const mine = bySocket.get(s.id);
      if (mine === undefined) continue;
      const mx = 2 * CX - 1 - (s.at[0] as number);
      if (mx === (s.at[0] as number)) continue;
      const twin = allSockets.find(t => t.id !== s.id && t.kind === s.kind
        && (t.at[0] as number) === mx && t.at[1] === s.at[1] && t.at[2] === s.at[2]);
      if (!twin) continue;
      const other = bySocket.get(twin.id);
      if (other === undefined) continue;
      // Only a pair carrying the SAME part is a mirror of the other: a
      // barracks to port and a magazine to starboard occupy mirrored volumes
      // and are still two different shapes.
      if ((d.parts[other] as Placement).module !== (d.parts[mine] as Placement).module) continue;
      twinOf.set(mine, other);
    }
  }

  for (const pi of order) {
    const p = d.parts[pi] as Placement;
    const sock = allSockets.find(k => k.id === p.socket);
    const m = moduleById(p.module);
    if (!sock || !m) continue;
    // Seated on the face it stands on, so the base is against the plating and
    // the ring is the end pointing at vacuum, and then turned by however much
    // the player turned it.
    const face = seatedFacing(frame, sock, p);
    const v = rotatedVoxels(m, face);
    const code = purposeCode(m.purpose);
    const seat = seatOf(frame, sock, v);
    // The PIVOT lands on the socket, not the box centre.
    const pv = rotatedPivot(m, face);
    // Three cases about the centreline PLANE, which runs between columns 15
    // and 16 rather than down the middle of column 16.
    //
    // A part was seated from its box's LOW edge in every case, so a fitting
    // and its mirror twin, on sockets that really were exact mirrors, came out
    // one cell apart: the port box grew outward from its origin and the
    // starboard one grew outward from a mirrored origin, which is inward.
    // Seated from the plane, a pair lands on mirrored cells, and a centreline
    // part straddles rather than sitting to one side of it. An ODD width part
    // on the centreline cannot be symmetric about a boundary at all and is
    // simply put as near to it as a whole cell allows.
    const MIRX = 2 * CX - 1;
    const onCentre = (sock.at[0] as number) === CX - 1 || (sock.at[0] as number) === CX;
    const bx = onCentre
      ? CX - Math.ceil(v.sx / 2)
      : (seat[0] as number) >= CX
        ? MIRX - (Math.round((MIRX - (seat[0] as number)) - ((pv[0] as number) + 0.5)) + v.sx - 1)
        : Math.round((seat[0] as number) - ((pv[0] as number) + 0.5));
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
        const n = idx3(LAT, x, y, z);
        const at = grid[n] as number;
        // A cell inside a turret's box costs far more than a cell another
        // part is already standing in, because the two are not the same kind
        // of bad. Standing in another part loses this part some cells and
        // nothing else; standing in a sweep makes the WHOLE HULL illegal, and
        // a stock hull nobody can field is not a lesser fault than a berth
        // that came out a little small. Weighted equally, the nudge took the
        // nearest free hole whichever it was, and four heavy cruisers seated
        // a barracks inside their own gun rings.
        if (reserved[n] || bells[n]) lost += FOUL_COST;
        else if (at && at !== Mat.Frame) lost++;
      }
      return lost;
    };

    // Nudge until it actually fits. Seating pulls parts toward the centreline,
    // and a frame that authored six clamps along a flank pulls all six onto
    // the same cells: five of the Rogue's lost every cell they had and the
    // ship claimed boarding gear it did not visibly carry. The search is
    // bounded and ordered, so it is the same nudge on both seats.
    // Walked MIRRORED on the starboard side. The list is in absolute lattice
    // directions, so a port fitting and its starboard twin, meeting the same
    // obstruction reflected, both took the first offset in the list that fit:
    // the same absolute direction, which relative to the hull is opposite.
    // One moved inboard while its twin moved outboard, and a pair authored on
    // exactly mirrored sockets came out on cells that were not mirrored.
    const flip = (seat[0] as number) >= CX ? -1 : 1;
    let ox = bx, oy = by, oz = bz, best = lossAt(bx, by, bz);
    // The twin went first: take the mirror of where it landed, and only search
    // if that will not do. `v.sx` is the part's own width, so the mirror of a
    // box is its far edge reflected.
    const twin = twinOf.get(pi);
    const was = twin === undefined ? undefined : placedAt.get(twin);
    if (was) {
      const tx = (2 * CX - 1) - ((was[0] as number) + v.sx - 1);
      const lost = lossAt(tx, was[1] as number, was[2] as number);
      if (lost <= best) { best = lost; ox = tx; oy = was[1] as number; oz = was[2] as number; }
    }
    if (best > 0) {
      for (const [dx, dy, dz] of NUDGE) {
        const tx = bx + dx * flip, ty = by + dy, tz = bz + dz;
        if (exposureOf(sock.kind) === 'enclosed' && !boxInside(LAT, prof,
          tx + v.sx / 2, ty + v.sy / 2, tz + v.sz / 2, v.sx / 2, v.sy / 2, v.sz / 2)) continue;
        // (tx, ty, tz) is the box origin either way, so the box test is the
        // box test whatever the pivot is.
        const lost = lossAt(tx, ty, tz);
        if (lost < best) { best = lost; ox = tx; oy = ty; oz = tz; }
        if (best === 0) break;
      }
    }

    placedAt.set(pi, [ox, oy, oz] as const);

    // A drive claims its own bell. The FILLED cells rather than the box: a
    // bell is a ring and a nozzle with space around them, and reserving the
    // whole box would push the plating off the transom.
    if (m.fits === 'drive' || m.fits === 'retro') {
      for (let k = 0; k < v.sz; k++) for (let j = 0; j < v.sy; j++) for (let i = 0; i < v.sx; i++) {
        const mat = v.data[i + j * v.sx + k * v.sx * v.sy] as number;
        if (!mat) continue;
        const x = ox + i, y = oy + j, z = oz + k;
        if (!inBounds(x, y, z)) continue;
        const n = idx3(LAT, x, y, z);
        bells[n] = 1;
        // The throat is claimed and left EMPTY. `reserved` is what every plate
        // pass below already reads, so putting it there is what keeps the
        // shell, the belts, the decor and the pencil out of an engine without
        // five separate writers each remembering to check.
        if (mat !== Mat.Void) continue;
        hollow[n] = 1;
        reserved[n] = 1;
        // And it takes a FRAME cell if the keel runs through it, exactly as a
        // part's solid cells already do. Four hulls in the fleet had a rib or
        // a keel run standing in a bell's throat, and a frame member through
        // an engine is the thing this rule exists to refuse rather than an
        // exception to it. The weld pass below catches anything this leaves
        // loose.
        if (grid[n] === Mat.Frame && own[n] === 0) {
          grid[n] = Mat.Empty;
          purp[n] = 0;
        }
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
            reserved[idx3(LAT, i, j, k)] = 1;
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
      const n = idx3(LAT, x, y, z);
      // A cell of somebody else's DRIVE that this part still wants. Zero on
      // anything this rasteriser places, because a bell costs the nudge as
      // much as a turret's sweep; above zero means a part had nowhere legal
      // to go and settled in the engines anyway.
      if (bells[n] && own[n] !== pi + 1
        && m.fits !== 'drive' && m.fits !== 'retro') bellFouled++;
      // A cavity is claimed and left empty: it is drawn by nothing, including
      // the part that owns it.
      if (mat === Mat.Void) continue;
      if (grid[n] && grid[n] !== Mat.Frame) continue;
      grid[n] = mat;
      purp[n] = code;
      own[n] = pi + 1;
      // Cargo is PAINTED, not machined. A container is a box somebody owns
      // and paints, so its panels are drawn with the hull's own palette and
      // each placement takes a different role: a rack of twelve boxes is a
      // rack in eight colours, which is what a container yard looks like and
      // what the eight swatches are for. Its castings and rails stay
      // machinery, so the shape still reads as a fitting.
      if (mat === Mat.Plate) tone[n] = roleCode(LIVERY_ROLES[pi % LIVERY_ROLES.length] as LiveryRole);
      // A RACK part is carried on the deck by the rails its navy already
      // draws, so it does not get a spar per cell. Every other proud part
      // does, and must: a pod hanging in space beside its own ship is the
      // slop voxels were supposed to end. Twelve containers over a curved
      // deck are two thousand cells of overhang, and a spar under each of
      // them buried the ship in plate that was holding up cargo which is
      // sitting on the deck already.
      if (sock.kind !== 'rack' && !insideHull(LAT, prof, x, y, z)) {
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
          if (reserved[idx3(LAT, i, j, k)]) continue;
          skin(i, j, k, roleOfCell((k - z0) / Math.max(1, z1 - z0), dx, dy));
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
          if (reserved[idx3(LAT, i, j, k)]) continue;
          skin(i, j, k, roleOfCell((k - z0) / Math.max(1, z1 - z0), dx, dy));
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
      if ((sec[side] ?? 0) <= 0) continue;
      grid[n] = Mat.Skinned;
      tone[n] = roleCode(roleOfCell((k - z0) / Math.max(1, z1 - z0), dx, dy));
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
          const n = idx3(LAT, x, y, z);
          if (reserved[n]) break;
          const at = grid[n] as number;
          if (at && at !== Mat.Plate) break;
          const st = hullAt(prof, z);
          skin(x, y, z, roleOfCell((z - z0) / Math.max(1, z1 - z0),
            (x + 0.5 - CX) / (st[0] as number), (y + 0.5 - CY) / (st[1] as number)));
        }
      }
    }
  }

  // --- what the navy bolts on -------------------------------------------
  //
  // After the shell, so a slab that overlaps the skin loses to the skin and
  // the two cannot fight over a cell; before the pylons, so anything hanging
  // off a wing still gets a spar back to the ship. It takes the `decor` role,
  // which is what puts the palette's accent swatch on every hull: seven roles
  // are places on a hull and this one is a thing added to it.
  for (const [x, y, z, w, h, l] of decorOf(frame)) {
    for (let k = 0; k < l; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = Math.round(x) + i, py = Math.round(y) + j, pz = Math.round(z) + k;
      if (!inBounds(px, py, pz) || reserved[idx3(LAT, px, py, pz)]) continue;
      skin(px, py, pz, 'decor');
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
      if (grid[idx3(LAT, x, y, k)]) break;          // met the ship: attached
      if (reserved[idx3(LAT, x, y, k)]) break;      // met a turret, which is also the ship
      // A pylon is a strake rather than plating, and it wears the stripe: it
      // is the one piece of armour that is structure a player can see, and
      // painting it as hull made a spar read as a lump of the flank.
      skin(x, y, k, 'trim');
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
    if (at === Mat.Plate) { grid[n] = Mat.Empty; purp[n] = 0; tone[n] = 0; }
    else if (at === Mat.Skinned) { grid[n] = Mat.Frame; tone[n] = 0; }
  }
  for (const n of d.plate ?? []) {
    if (n < 0 || n >= CELLS || grid[n] || reserved[n]) continue;
    grid[n] = Mat.Plate;
    purp[n] = STRUCT;
    // What a player drew takes the role of where they drew it, so a sponson
    // grown off a flank comes out the colour of that flank rather than of
    // whatever role happened to be numbered first.
    const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
    const st = hullAt(prof, k);
    tone[n] = roleCode(roleOfCell((k - z0) / Math.max(1, z1 - z0),
      (i + 0.5 - CX) / (st[0] as number), (j + 0.5 - CY) / (st[1] as number)));
  }

  // --- nothing may float --------------------------------------------------
  //
  // A ship is ONE object. A cell touching nothing is not a piece of armour, it
  // is a block hanging in space beside a hull, and every stock hull in the
  // fleet had some: a Rogue corvette carried seventy, most of an attitude
  // block that its own pylon had never reached.
  //
  // The pylon pass could not reach them because it starts at a part's
  // OUTBOARD cell and steps inward, and its first step lands on another cell
  // of the same part, which it reads as "met the ship". So the fix is here,
  // where the pieces are actually known: flood fill, weld what can be welded,
  // and take off only what is left.
  //
  // Six neighbours, not twenty six: two cells meeting at an edge are two cells
  // touching at a line, which is not a weld.
  const piecesOf = (): number[][] => {
    const seen = new Uint8Array(CELLS);
    const stack: number[] = [];
    const all: number[][] = [];
    for (let start = 0; start < CELLS; start++) {
      if (!grid[start] || seen[start]) continue;
      const piece: number[] = [];
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      while (stack.length) {
        const n = stack.pop() as number;
        piece.push(n);
        const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
        const push = (m: number) => { if (grid[m] && !seen[m]) { seen[m] = 1; stack.push(m); } };
        if (i > 0) push(n - 1);
        if (i < NX - 1) push(n + 1);
        if (j > 0) push(n - NX);
        if (j < NY - 1) push(n + NX);
        if (k > 0) push(n - NX * NY);
        if (k < NZ - 1) push(n + NX * NY);
      }
      all.push(piece);
    }
    return all;
  };

  let pieces = piecesOf();
  if (pieces.length > 1) {
    let main = 0;
    for (let i = 1; i < pieces.length; i++) {
      if ((pieces[i] as number[]).length > (pieces[main] as number[]).length) main = i;
    }
    // Weld each loose piece back with a spar, from whichever of its cells is
    // nearest the hull line, walking toward the axis exactly the way the pylon
    // pass does. It is a strake rather than plating, so it wears the stripe.
    for (let pi = 0; pi < pieces.length; pi++) {
      if (pi === main) continue;
      let bestN = -1, bestD = Infinity;
      for (const n of pieces[pi] as number[]) {
        const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
        const st = hullAt(prof, k);
        const ux = (i + 0.5 - CX) / Math.max(0.5, st[0] as number);
        const uy = (j + 0.5 - CY) / Math.max(0.5, st[1] as number);
        const d = ux * ux + uy * uy;
        if (d < bestD) { bestD = d; bestN = n; }
      }
      if (bestN < 0) continue;
      // Try EVERY cell of the piece, nearest the axis first, until one of them
      // finds its way home. One cell is not enough: the nearest cell of a
      // drive cluster has the rest of the cluster inboard of it, so the walk
      // meets the piece itself on its first step and stops having welded
      // nothing. That left the Rogue frigate's whole aft block loose.
      const order = (pieces[pi] as number[]).slice().sort((a, b) => {
        const ra = (i: number) => {
          const x = i % NX, y = ((i / NX) | 0) % NY, k = (i / (NX * NY)) | 0;
          const st = hullAt(prof, k);
          const ux = (x + 0.5 - CX) / Math.max(0.5, st[0] as number);
          const uy = (y + 0.5 - CY) / Math.max(0.5, st[1] as number);
          return ux * ux + uy * uy;
        };
        return ra(a) - ra(b);
      });
      const here = new Set(pieces[pi] as number[]);
      for (const from of order) {
        let x = from % NX, y = ((from / NX) | 0) % NY;
        const k = (from / (NX * NY)) | 0;
        const st = hullAt(prof, k);
        const hw = Math.max(0.5, st[0] as number), hh = Math.max(0.5, st[1] as number);
        const spar: number[] = [];
        let landed = false;
        for (let step = 0; step < NX + NY; step++) {
          const ux = (x + 0.5 - CX) / hw, uy = (y + 0.5 - CY) / hh;
          if (Math.abs(ux) >= Math.abs(uy)) x += ux > 0 ? -1 : 1;
          else y += uy > 0 ? -1 : 1;
          if (!inBounds(x, y, k)) break;
          const n = idx3(LAT, x, y, k);
          if (reserved[n]) break;              // a turret's box is not a landing
          if (grid[n]) { landed = !here.has(n); break; }
          spar.push(n);
        }
        if (!landed) {
          // Nothing inboard to meet, which happens when the piece is off the
          // END of the hull: the profile has no beam out there, so walking
          // toward the axis walks through empty space for ever. March along
          // the KEEL toward the middle of the ship instead.
          const mid = (Math.round((prof[0] as Station)[0])
            + Math.round((prof[prof.length - 1] as Station)[0])) / 2;
          const dz = k < mid ? 1 : -1;
          spar.length = 0;
          let z2 = k;
          for (let step = 0; step < NZ; step++) {
            z2 += dz;
            if (!inBounds(from % NX, ((from / NX) | 0) % NY, z2)) break;
            const n = idx3(LAT, from % NX, ((from / NX) | 0) % NY, z2);
            if (reserved[n]) break;
            if (grid[n]) { landed = !here.has(n); break; }
            spar.push(n);
          }
          if (!landed) continue;
        }
        for (const n of spar) {
          grid[n] = Mat.Plate;
          purp[n] = STRUCT;
          tone[n] = roleCode('trim');
          welded[n] = 1;
        }
        break;
      }
    }
    pieces = piecesOf();
  }

  let orphans = 0;
  if (pieces.length > 1) {
    let main = 0;
    for (let i = 1; i < pieces.length; i++) {
      if ((pieces[i] as number[]).length > (pieces[main] as number[]).length) main = i;
    }
    for (let pi = 0; pi < pieces.length; pi++) {
      if (pi === main) continue;
      for (const n of pieces[pi] as number[]) {
        grid[n] = Mat.Empty;
        purp[n] = 0;
        tone[n] = 0;
        own[n] = 0;
        orphans++;
      }
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
    if (mat === Mat.Plate && !own[n]) plateCells++;
    if (i < loX) loX = i; if (i > hiX) hiX = i;
    if (j < loY) loY = j; if (j > hiY) hiY = j;
    if (k < loZ) loZ = k; if (k > hiZ) hiZ = k;
  }
  // --- the brush ----------------------------------------------------------
  //
  // Hand painted cells, last, over whatever the livery worked out. Only where
  // there is ARMOUR to paint: a stroke that outlived the plate under it would
  // colour a drive bell the day somebody moved a belt, and a part is coloured
  // by what it DOES, which is the thing that makes an unfamiliar hull
  // readable.
  for (const v of d.tint ?? []) {
    const n = (v / 8) | 0;
    if (n < 0 || n >= CELLS) continue;
    const m = grid[n] as number;
    if (m !== Mat.Plate && m !== Mat.Skinned) continue;
    tone[n] = PAINTED | (v & 7);
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
  // A drive's throat, judged the same way and counted with the same number.
  // The two are one rule stated twice: a volume some part keeps clear, and
  // anything else in it makes the whole hull illegal rather than merely
  // costing somebody a few cells.
  for (let n = 0; n < CELLS; n++) if (hollow[n] && grid[n]) fouled++;
  for (const t of turrets) {
    for (let k = Math.max(0, t.k0); k <= Math.min(NZ - 1, t.k1); k++)
      for (let j = Math.max(0, t.j0); j <= Math.min(NY - 1, t.j1); j++)
        for (let i = Math.max(0, t.i0); i <= Math.min(NX - 1, t.i1); i++) {
          const n = idx3(LAT, i, j, k);
          if (!grid[n]) continue;
          const owner = own[n] as number;
          if (owner === t.part + 1) continue;          // the turret itself
          if (grid[n] === Mat.Frame) continue;         // it is bolted to the frame
          fouled++;
        }
  }

  const raster: Raster = { grid, purp, own, tone, orphans, welded, bellFouled, hollow,
    plateCells, solidCells: cells.length / 3,
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
  const { nx: NX, ny: NY, nz: NZ } = latOf(frame);
  const cell = VOXEL;
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
      scanFrom(latOf(frame), mask, table, r, pi + 1, box,
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
function scanFrom(L: Lat, mask: Uint32Array, table: Float32Array, r: Raster, own: number,
  box: TurretBox | undefined, ox: number, oy: number, oz: number): void {
  const { nx: NX, ny: NY, nz: NZ } = L;
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
  const CELLS = latOf(frame).cells;
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
    turrets: raster.turrets, fouled: raster.fouled, orphans: raster.orphans,
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
  // Armour courses are authored in REFERENCE cells and cut to the class's own
  // lattice, which is the whole of "a bigger ship can carry more armour".
  //
  // A course is a cell and a cell is the same size on every hull, so a heavy
  // cruiser plated to the same six courses as a frigate is plated to the same
  // THICKNESS as a frigate: twice the ship behind a third of the protection it
  // used to have. That is not a balance opinion, it is what the ladder does to
  // the arithmetic. Plate volume is skin area times thickness, so a hull whose
  // courses do not scale has hull points going as the SQUARE of its length
  // while its gun count goes as its length, and a heavy cruiser dies to
  // another heavy cruiser in a single turn.
  //
  // Scaled, thickness goes as the length again and hull points go as the cube
  // of it, which is the ladder the fleet has always had, arrived at by
  // counting cells rather than by multiplying one.
  //
  // The SLIDER is untouched and stays in cells: a player asking for four
  // courses gets four courses on any hull, because a course is a course.
  const f = latOf(frameFor(classKey)).nx / REF.nx;
  const cut = Object.fromEntries(Object.entries(sections)
    .map(([k, v]) => [k, Math.round((v as number) * f)])) as Partial<Sections>;
  return { classKey, parts, sections: { ...zeroSections(), ...cut },
    armour: 'wrapped', faction, paint, finish, metal, rough };
}

const P = (socket: string, module: string, rot?: number): Placement =>
  (rot === undefined ? { socket, module } : { socket, module, rot });

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
    // The one mount on the fleet whose rest a rule cannot pick. A flank ring
    // rests along the keel, forward of midships pointing forward and abaft it
    // pointing aft, and on every other hull one of those is clear. This
    // sponson sits amidships on a section that is nearly round and behind a
    // keel rail that overruns the body at both ends, so it looks into its own
    // ship BOTH ways: fore blocked, aft blocked, up and down clear. Turned a
    // quarter, it rests trained up and over the deck.
    P('b3', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('s0', 'WPN-BB1'),
    // No quarter turn on the placement any more: the RING rests trained out
    // of its recess now, and the turn that used to do that job was being
    // added on top of it and carrying the barrel back into the hull.
    P('s0/t', 'WPN-BM1'),
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

  // ------------------------------------------------------------- civil --
  //
  // Every one of these is a hull with no gun on it, which the core allows
  // because the class carries no mounts (`design.rs`: the arms gate passes on
  // an empty weapon table). What each carries instead is the thing that makes
  // it readable at range: doors, radiator slats, a lit promenade.
  stock('civil_lighter', [
    P('d0', 'DRV-T'), P('d1', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'), P('p0', 'MAN-B'), P('p1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-AIR'), P('b3', 'UTL-AIR'),
    P('h0', 'UTL-CTR'), P('h1', 'UTL-CTR'),
  ], { beltFwd: 2, beltMid: 2, beltAft: 2, dorsal: 2, ventral: 2, bow: 1, stern: 1 },
    'civil', 0xB9C6D4, 'tread', 0.15, 0.70),

  stock('civil_hauler', [
    P('d0', 'DRV-T'), P('d1', 'DRV-T'), P('d2', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'), P('y2', 'MAN-B'), P('y3', 'MAN-B'),
    P('p0', 'MAN-B'), P('p1', 'MAN-B'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'),
    P('b3', 'UTL-OBS'), P('b4', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('b6', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
    P('h0', 'UTL-CTR'), P('h1', 'UTL-CTR'), P('h2', 'UTL-CTR'),
    P('h3', 'UTL-CTR'), P('h4', 'UTL-CTR'), P('h5', 'UTL-CTR'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'civil', 0xC0A24A, 'tread', 0.15, 0.70),

  stock('civil_boxship', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'), P('d3', 'DRV-T'), P('d4', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'),
    P('b3', 'UTL-OBS'), P('b4', 'UTL-AIR'), P('b5', 'UTL-AIR'), P('b6', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
    P('h0', 'UTL-CTR'), P('h1', 'UTL-CTR'), P('h2', 'UTL-CTR'), P('h3', 'UTL-CTR'),
    P('h4', 'UTL-CTR'), P('h5', 'UTL-CTR'), P('h6', 'UTL-CTR'), P('h7', 'UTL-CTR'),
    P('h8', 'UTL-CTR'), P('h9', 'UTL-CTR'), P('h10', 'UTL-CTR'), P('h11', 'UTL-CTR'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'civil', 0x2E6F9E, 'tread', 0.15, 0.70),

  stock('civil_tanker', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'), P('d3', 'DRV-T'), P('d4', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b4', 'UTL-AIR'),
    P('h0', 'UTL-TNK'), P('h1', 'UTL-TNK'), P('h2', 'UTL-TNK'),
    P('h3', 'UTL-TNK'), P('h4', 'UTL-TNK'), P('h5', 'UTL-TNK'),
  ], { beltFwd: 4, beltMid: 4, beltAft: 4, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'civil', 0xB4472B, 'crate', 0.22, 0.62),

  stock('civil_miner', [
    P('d0', 'DRV-T'), P('d1', 'DRV-T'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-B'), P('y1', 'MAN-B'), P('y2', 'MAN-B'), P('y3', 'MAN-B'),
    P('p0', 'MAN-B'), P('p1', 'MAN-B'),
    P('g0', 'WPN-BB1'), P('g0/t', 'UTL-DRL'), P('g1', 'WPN-BB1'), P('g1/t', 'UTL-DRL'),
    P('b0', 'UTL-BRG'), P('b1', 'UTL-BAR'), P('b2', 'UTL-BAR'),
    P('b3', 'UTL-AIR'), P('b4', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
    P('h0', 'UTL-ORE'), P('h1', 'UTL-ORE'), P('h2', 'UTL-ORE'), P('h3', 'UTL-ORE'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 2, ventral: 2, bow: 2, stern: 2 },
    'civil', 0x2E8B76, 'cracked', 0.18, 0.74),

  stock('civil_liner', [
    P('d0', 'DRV-H'), P('d1', 'DRV-H'), P('d2', 'DRV-H'), P('d3', 'DRV-N'), P('d4', 'DRV-N'),
    P('r0', 'RET-C'), P('r1', 'RET-C'), P('r2', 'RET-C'), P('r3', 'RET-C'),
    P('y0', 'MAN-Y'), P('y1', 'MAN-Y'), P('y2', 'MAN-Y'), P('y3', 'MAN-Y'),
    P('p0', 'MAN-P'), P('p1', 'MAN-P'), P('p2', 'MAN-P'), P('p3', 'MAN-P'),
    P('b0', 'UTL-BRG'),
    P('b1', 'UTL-PAX'), P('b2', 'UTL-PAX'), P('b3', 'UTL-PAX'), P('b4', 'UTL-PAX'),
    P('b5', 'UTL-PAX'), P('b6', 'UTL-PAX'), P('b7', 'UTL-PAX'), P('b8', 'UTL-PAX'),
    P('b9', 'UTL-OBS'), P('b10', 'UTL-OBS'),
    P('b11', 'UTL-AIR'), P('b12', 'UTL-AIR'),
    P('c0', 'UTL-CLM'), P('c1', 'UTL-CLM'),
    P('h0', 'UTL-CTR'), P('h1', 'UTL-CTR'),
  ], { beltFwd: 3, beltMid: 3, beltAft: 3, dorsal: 3, ventral: 3, bow: 2, stern: 2 },
    'civil', 0xF2F5F8, 'plate', 0.20, 0.48),
];

/**
 * A design record, on the lattice its class is actually drawn on.
 *
 * Every design that predates the per class lattices was drawn on 32 x 32 x 64,
 * because that is all there was; a corvette's is 24 x 24 x 48 now and a heavy
 * cruiser's 64 x 64 x 128. So a stored record's cell indices are re-read
 * against the lattice they were written on and written back against the one
 * they are being opened on, scaled about the centre, which is the same place
 * on the hull because both lattices are centred on it.
 *
 * A remap rather than a refusal, and rather than dropping the arrays: hand
 * drawn armour is the part of a design somebody actually spent an evening on.
 * It is approximate on a corvette, whose profile changed when it stopped being
 * a frigate with its ends cut off, and exact on everything else, whose hull
 * scaled by exactly this factor.
 *
 * Everything that takes a design record from OUTSIDE this session calls it:
 * the library, a save, a file and a draft.
 */
export function migrateDesign(d: Design): Design {
  const to = latOf(frameFor(d.classKey));
  const f = d.lattice
    ? { nx: d.lattice[0], ny: d.lattice[1], nz: d.lattice[2] }
    : { nx: REF.nx, ny: REF.ny, nz: REF.nz };
  const stamp: readonly [number, number, number] = [to.nx, to.ny, to.nz];
  if (f.nx === to.nx && f.ny === to.ny && f.nz === to.nz) {
    return d.lattice ? d : { ...d, lattice: stamp };
  }
  const axis = (v: number, from: number, into: number): number =>
    Math.max(0, Math.min(into - 1,
      Math.round((v + 0.5 - from / 2) * (into / from) + into / 2 - 0.5)));
  const move = (list: number[] | undefined): number[] | undefined => {
    if (!list?.length) return list;
    const out = new Set<number>();
    for (const n of list) {
      if (!Number.isInteger(n) || n < 0 || n >= f.nx * f.ny * f.nz) continue;
      const i = n % f.nx, j = ((n / f.nx) | 0) % f.ny, k = (n / (f.nx * f.ny)) | 0;
      out.add(idx3(to, axis(i, f.nx, to.nx), axis(j, f.ny, to.ny),
        axis(k, f.nz, to.nz)));
    }
    return [...out].sort((a, b) => a - b);
  };
  // The brush carries its SLOT with it: an entry is `cell * 8 + slot`, so the
  // cell moves and the colour stays on it.
  const moveTint = (list: number[] | undefined): number[] | undefined => {
    if (!list?.length) return list;
    const out = new Map<number, number>();
    for (const v of list) {
      const n = (v / 8) | 0;
      if (!Number.isInteger(v) || v < 0 || n >= f.nx * f.ny * f.nz) continue;
      const i = n % f.nx, j = ((n / f.nx) | 0) % f.ny, k = (n / (f.nx * f.ny)) | 0;
      out.set(idx3(to, axis(i, f.nx, to.nx), axis(j, f.ny, to.ny),
        axis(k, f.nz, to.nz)), v & 7);
    }
    return [...out].sort((a, b) => a[0] - b[0]).map(([n, slot]) => n * 8 + slot);
  };

  const next: Design = { ...d, lattice: stamp };
  const plate = move(d.plate), cut = move(d.cut);
  const tint = moveTint(d.tint);
  if (plate) next.plate = plate;
  if (cut) next.cut = cut;
  if (tint) next.tint = tint;
  return next;
}

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
    ...(s.bandFinish ? { bandFinish: s.bandFinish.slice() } : {}),
    frameFinish: s.frameFinish ?? DEFAULT_FRAME_FINISH,
    partFinish: s.partFinish ?? DEFAULT_PART_FINISH,
    metal: s.metal ?? DEFAULT_METAL,
    rough: s.rough ?? DEFAULT_ROUGH,
    // Stamped with the lattice it is on, like every design the app makes, so
    // a hull saved from a stock start is a hull `migrateDesign` never has to
    // guess about.
    lattice: (l => [l.nx, l.ny, l.nz] as const)(latOf(frameFor(s.classKey))),
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
  Void: 8,
} as const;

/**
 * `Void` is a cell a part CLAIMS AND LEAVES EMPTY, and it never reaches a hull.
 *
 * A drive bell is a shell round a cavity, and the cavity is as much a part of
 * the engine as the metal: a docking clamp bolted up the throat of a nozzle is
 * not a ship. So the bell marks it, `rasterise` reserves it, and nothing
 * else may be written there.
 *
 * It lives in a `VoxelModel` only. Writing it into the hull grid would make it
 * a solid cell to everything that walks the grid by truthiness: the mesher
 * would draw quads across the mouth of every engine in the fleet.
 */

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
 * What colour a patch of armour is, from the role the rasteriser gave it.
 *
 * This spread the eight swatches over the hull by POSITION once before, and
 * that was deleted for a good reason: a player picked a colour and got a
 * scheme built round it rather than the colour they picked, so the pick was a
 * seed rather than a decision. The reason it is back is that the pick is now
 * role `hull` itself. Every other role is a fixed OFFSET from the picked
 * swatch round the palette, so the broad plating is exactly the colour that
 * was chosen, choosing the next swatch along really does repaint the whole
 * ship, and the other seven are used rather than sitting in a picker unseen.
 *
 * A cell with no role is not armour and keeps the paint outright, which is
 * what a hull rasterised before the tone channel existed comes back as.
 *
 * Everything that is not armour keeps its purpose colour, so a drive is still
 * orange and a gun still red on anybody's ship. That is the part a player must
 * be able to read on an unfamiliar hull, and it is not paint.
 */
/**
 * A cell PAINTED BY HAND rides in the same byte the livery role does.
 *
 * `tone` is a role code, one to eight, and the high bit says "this is not a
 * role, it is a slot somebody chose". Everything that draws armour already
 * asks `armourColour` for a cell's colour, so putting it here is what gets the
 * map, the shipyard, the schematic and the wound painting the same cell the
 * same way without four of them learning about a brush.
 */
export const PAINTED = 0x80;
export const paintedSlot = (tone: number): number => tone & 0x07;
export const isPainted = (tone: number): boolean => (tone & PAINTED) !== 0;

export function armourColour(faction: string, paint: number, tone = 0): number {
  if (isPainted(tone)) {
    const sw = paintFor(faction).swatches;
    return (sw[paintedSlot(tone) % sw.length] ?? paint) as number;
  }
  return tone ? roleColour(faction, paint, roleAt(tone)) : paint;
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

/**
 * How a part is bolted on: three quarter turns, one per axis.
 *
 * `rot` is the original yaw and keeps its name and its meaning, so every design
 * ever saved loads unchanged with the two new axes at zero. That is the whole
 * reason this is three fields rather than one orientation index: a migration
 * that rewrote saved hulls would be a migration that could get a hull wrong.
 *
 * Yaw alone could only ever bolt a turret to a deck. A gun on a flank or under
 * a keel needs the other two, and a player who wants one there should not have
 * to be told the editor cannot express it.
 */
export interface Facing {
  /** Quarter turns about the up axis. */
  readonly yaw: number;
  /** Quarter turns about the beam axis, which tips the barrel over. */
  readonly pitch: number;
  /** Quarter turns about the long axis, which rolls it onto a flank. */
  readonly roll: number;
}

/** A part's facing, defaulting every axis to zero. */
export function facingOf(p: { rot?: number; pitch?: number; roll?: number }): Facing {
  const q = (n: number | undefined) => (((n ?? 0) % 4) + 4) % 4;
  return { yaw: q(p.rot), pitch: q(p.pitch), roll: q(p.roll) };
}

/** True when a facing is the identity, which is the common case and worth not
 *  paying for: an unturned part uses its cached voxels directly. */
export function isUpright(f: Facing): boolean {
  return f.yaw === 0 && f.pitch === 0 && f.roll === 0;
}

/** A stable key for one facing, for the rotation cache. */
export function facingKey(f: Facing): string {
  return `${f.yaw}${f.pitch}${f.roll}`;
}

/**
 * One quarter turn of a point inside a box, about a named axis.
 *
 * Integer arithmetic on purpose. A part is cells, and a rotation that produced
 * fractions would put a turret half a cell into the plate beside it: exactly
 * the z fighting the original yaw only code was written to avoid.
 */
function turnPoint(
  px: number, py: number, pz: number,
  sx: number, sy: number, sz: number,
  axis: 'yaw' | 'pitch' | 'roll',
): { p: [number, number, number]; s: [number, number, number] } {
  if (axis === 'yaw') {
    // (x, z) -> (sz - 1 - z, x). The map the yaw only code already used, kept
    // exactly so an existing design turns the way it always did.
    return { p: [sz - 1 - pz, py, px], s: [sz, sy, sx] };
  }
  if (axis === 'pitch') {
    // About x: (y, z) -> (sz - 1 - z, y).
    return { p: [px, sz - 1 - pz, py], s: [sx, sz, sy] };
  }
  // roll, about z: (x, y) -> (sy - 1 - y, x).
  return { p: [sy - 1 - py, px, pz], s: [sy, sx, sz] };
}

/** The order the three axes are applied. Fixed, because a rotation is not
 *  commutative: yaw then pitch then roll is a different part from roll then
 *  pitch then yaw, and two places composing them differently would disagree
 *  about where a turret sits. */
const AXES = ['yaw', 'pitch', 'roll'] as const;

/**
 * The facing as a rotation from the MOUNT's own frame into the ship's.
 *
 * Nine numbers, row major, and every one of them is 0, 1 or -1: a quarter turn
 * of a cell grid is a signed permutation of the axes and nothing else, so
 * there is no rounding here and a mount cannot drift a fraction of a degree
 * off the cells it was rasterised into.
 *
 * Derived from `turnPoint` rather than written out as a table of sines. The
 * cells and the barrel have to agree about which way "turned" is, and the way
 * to guarantee that is to ask the same function: a unit box makes `turnPoint`
 * its own linear part, because `s - 1 - p` is `-p` when `s` is one.
 */
export function faceBasis(f: Facing): readonly number[] {
  // Columns: where each of the three axes ends up. Identity to start with,
  // which is what an unturned mount is.
  let col: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (const axis of AXES) {
    for (let n = 0; n < f[axis]; n++) {
      col = col.map(c => turnPoint(c[0], c[1], c[2], 1, 1, 1, axis).p) as
        [number, number, number][];
    }
  }
  // Row major: entry (r, c) is the r'th component of the image of axis c.
  return [
    (col[0] as number[])[0] as number, (col[1] as number[])[0] as number,
    (col[2] as number[])[0] as number,
    (col[0] as number[])[1] as number, (col[1] as number[])[1] as number,
    (col[2] as number[])[1] as number,
    (col[0] as number[])[2] as number, (col[1] as number[])[2] as number,
    (col[2] as number[])[2] as number,
  ];
}

/** The same pivot in the coordinates of the model turned to `f`. */
export function rotatedPivot(m: ModuleDef, f: Facing): readonly [number, number, number] {
  let [px, py, pz] = pivotOf(m);
  let [sx, sy, sz] = m.size as readonly [number, number, number];
  for (const axis of AXES) {
    for (let n = 0; n < f[axis]; n++) {
      const t = turnPoint(px, py, pz, sx, sy, sz, axis);
      px = t.p[0]; py = t.p[1]; pz = t.p[2];
      sx = t.s[0]; sy = t.s[1]; sz = t.s[2];
    }
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
export function rotatedVoxels(m: ModuleDef, f: Facing): VoxelModel {
  if (isUpright(f)) return voxelsOf(m);
  const key = m.id + '/' + facingKey(f);
  const hit = rotCache.get(key);
  if (hit) return hit;
  let cur = voxelsOf(m);
  for (const axis of AXES) {
    for (let n = 0; n < f[axis]; n++) cur = turnVoxels(cur, axis);
  }
  rotCache.set(key, cur);
  return cur;
}

/**
 * One quarter turn of a voxel model about a named axis.
 *
 * Rotating the CELLS rather than the drawn mesh is what keeps a turned turret
 * on the grid: it stays one cell per cell, so it still cannot z fight with the
 * plate beside it or float a fraction of a cell off its ring. That was true of
 * the yaw only version and it is the reason all three axes are done this way
 * rather than by spinning a mesh and hoping the raster follows.
 */
function turnVoxels(cur: VoxelModel, axis: 'yaw' | 'pitch' | 'roll'): VoxelModel {
  const t = turnPoint(0, 0, 0, cur.sx, cur.sy, cur.sz, axis);
  const [sx, sy, sz] = t.s;
  const data = new Uint8Array(sx * sy * sz);
  for (let z = 0; z < cur.sz; z++) for (let y = 0; y < cur.sy; y++) for (let x = 0; x < cur.sx; x++) {
    const v = cur.data[x + y * cur.sx + z * cur.sx * cur.sy] as number;
    if (!v) continue;
    const q = turnPoint(x, y, z, cur.sx, cur.sy, cur.sz, axis).p;
    data[(q[0] as number) + (q[1] as number) * sx + (q[2] as number) * sx * sy] = v;
  }
  return { sx, sy, sz, data, filled: cur.filled };
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
      const radiusAt = (z: number) => {
        const t = z / Math.max(1, sz - 1);          // 0 aft, 1 forward
        return rOuter + (rThroat - rOuter) * Math.min(1, t * 1.35);
      };
      for (let z = 0; z < sz; z++) {
        const t = z / Math.max(1, sz - 1);
        const r = radiusAt(z);
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const d = rad(x, y);
          if (d > r) continue;
          // Solid at the forward plug, and a ONE CELL WALL round a cavity
          // everywhere else, with a lit ring at the very back where the
          // exhaust leaves. Every second course of the flare is banded, which
          // is what tells one bell from another once they are all the same
          // orange.
          //
          // A wall is where the cone ENDS, not a thickness: a fixed 1.35 cells
          // is most of a small nozzle's radius, so the light nozzle, which is
          // four cells across, came out very nearly solid and had no cavity to
          // speak of. Asking whether a neighbour is outside the cone gives one
          // cell of wall at any radius, so the smallest bell in the game is
          // still a bell rather than a plug.
          if (t > 0.72) { put(x, y, z, Mat.Case); continue; }
          const wall = rad(x + 1, y) > r || rad(x - 1, y) > r
            || rad(x, y + 1) > r || rad(x, y - 1) > r;
          if (wall) put(x, y, z, z === 0 ? Mat.Glow : (z % 2 ? Mat.Accent : Mat.Machine));
          // Inside the wall is the CAVITY, and it is the engine's as much as
          // the metal is: `rasterise` reserves it and nothing else may sit in
          // it. Marked rather than left empty, because "empty" is what every
          // other part is looking for somewhere to go.
          else put(x, y, z, Mat.Void);
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
    case 'container': {
      // A box with corrugated flanks and a door on the forward face. The
      // corrugation is every other column, which is what a normal map would
      // do to a flat panel and is worth doing in CELLS here because at this
      // size the ribs are the shape rather than a texture on it.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        if (!shell(x, y, z)) continue;
        const rib = (x === 0 || x === sx - 1) && z % 2 === 0;
        const rail = y === 0 || y === sy - 1;
        // Plate is PAINT here, not armour: `rasterise` gives a part's plate
        // cells a livery role and counts none of them as armour, so a box
        // wears the ship's colours and costs its own mass and no more.
        put(x, y, z, rail ? Mat.Accent : rib ? Mat.Case : Mat.Plate);
      }
      // The doors, and the corner castings that say it is a container rather
      // than a crate somebody welded up.
      for (let y = 1; y < sy - 1; y++) for (let x = 1; x < sx - 1; x++)
        put(x, y, sz - 1, x === Math.round(cx) ? Mat.Accent : Mat.Plate);
      for (const x of [0, sx - 1]) for (const y of [0, sy - 1]) for (const z of [0, sz - 1])
        put(x, y, z, Mat.Glow);
      break;
    }
    case 'tank': {
      // A cylinder with domed ends and a saddle under it. Round, because a
      // pressure vessel is the one thing on a ship that has to be.
      const r = Math.min(sx, sy) / 2 - 0.15;
      for (let z = 0; z < sz; z++) {
        const t = Math.min(z, sz - 1 - z) / Math.max(1, sz * 0.22);
        const rz = r * Math.min(1, 0.55 + 0.45 * Math.min(1, t));
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const d = rad(x, y);
          if (d > rz) continue;
          // Hoops every fourth station, which is what a tank has and what
          // stops a cylinder reading as a pipe.
          put(x, y, z, d > rz - 1 ? (z % 4 === 0 ? Mat.Accent : Mat.Case) : Mat.Machine);
        }
      }
      for (let z = 1; z < sz - 1; z++) put(Math.round(cx), 0, z, Mat.Accent);
      put(Math.round(cx), sy - 1, Math.round(cz), Mat.Glow);
      break;
    }
    case 'hopper': {
      // A bin: wide and open at the top, tapering to a chute at the bottom.
      // The taper is the whole read, because it says the contents fall out of
      // the bottom rather than being carried out of a door.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const up = y / Math.max(1, sy - 1);
        const half = (sx / 2) * (0.34 + 0.66 * up);
        if (Math.abs(x - cx) > half) continue;
        const skinCell = Math.abs(x - cx) > half - 1 || z === 0 || z === sz - 1
          || y === 0 || y === sy - 1;
        if (!skinCell) continue;
        put(x, y, z, y === sy - 1 ? Mat.Accent : Mat.Case);
      }
      // The chute, lit, because something is coming out of it.
      for (let z = Math.round(sz * 0.3); z < Math.round(sz * 0.7); z++)
        put(Math.round(cx), 0, z, Mat.Glow);
      break;
    }
    case 'gallery': {
      // A long low room whose outboard wall is glass. The frame is the part;
      // the window is a hole cut in the PLATING over it, which is what
      // `ModuleDef.window` means, so all this has to do is be a room with a
      // face against the skin.
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        if (!shell(x, y, z)) continue;
        put(x, y, z, y === sy - 1 || y === 0 ? Mat.Case : Mat.Machine);
      }
      for (let z = 1; z < sz - 1; z += 2) put(sx - 1, Math.round(cy), z, Mat.Glow);
      break;
    }
    case 'drill': {
      // An arm with a cutting head on the end: a boom back to the mount, a
      // drum, and teeth. It reads along its own +z, which is the way every
      // trunnion part is authored, so it points where the ring points.
      for (let z = 0; z < Math.round(sz * 0.55); z++)
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++)
          if (rad(x, y) < Math.min(sx, sy) * 0.24) put(x, y, z, Mat.Case);
      for (let z = Math.round(sz * 0.55); z < sz; z++) {
        const t = (z - sz * 0.55) / Math.max(1, sz * 0.45);
        const r = Math.min(sx, sy) / 2 * (1 - 0.35 * t);
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const d = rad(x, y);
          if (d > r) continue;
          put(x, y, z, z === sz - 1 ? Mat.Glow : d > r - 1 ? Mat.Accent : Mat.Machine);
        }
      }
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

  // A cavity is claimed and empty, so it is not FILLED: a bell that counted
  // its own throat would report more cells than it draws, and everything that
  // asks a part how big it is would be told the box rather than the metal.
  let filled = 0;
  for (let i = 0; i < data.length; i++) if (data[i] && data[i] !== Mat.Void) filled++;
  const model: VoxelModel = { sx, sy, sz, data, filled };
  voxCache.set(m.id, model);
  return model;
}

/**
 * Why a mount may not be turned to a given facing, or an empty string.
 *
 * TWO rules and no others, which is the whole point:
 *
 * 1. **The base stays on the ship.** A gun is bolted to something, so the
 *    part's cells have to touch the hull. Turn it far enough and the base
 *    swings off into space, and a turret hanging beside its own hull is the
 *    slop the voxel grid exists to prevent.
 * 2. **The body fouls nothing.** No cell of the part may be lost to plating,
 *    to another part or to another turret's swept box. Two things cannot
 *    occupy one cell, and the one that loses is the one that vanishes.
 *
 * Anything else is the player's. A turret under a keel, laid along a flank or
 * pointing aft is a design decision, and an editor that second guessed it
 * would be an editor arguing with its user.
 *
 * It answers by RASTERISING the whole hull twice and comparing, rather than by
 * placing the part itself and reasoning about what it lands on. That is not a
 * style preference: the raster nudges a part that does not fit, seats it first
 * come first served, and lets a part sink through the frame, so a private
 * placement here was a second implementation that disagreed with the real one
 * immediately. It refused the stock Terran's own drive bell at the facing the
 * hull ships with, which is an editor that will not let you save the design it
 * opened.
 *
 * Comparing against the CURRENT facing rather than against a perfect fit is
 * the other half of that. A hull as authored is the baseline it has to be
 * judged from: what a rotation may not do is cost the part cells it holds
 * right now, and "cost it cells" is a thing the rasteriser can be asked rather
 * than predicted.
 */
export function mountFouling(
  d: Design, parts: readonly Placement[], socket: string,
): string {
  const L = latOf(frameFor(d.classKey));
  const { nx: NX, ny: NY, nz: NZ } = L;
  const at = parts.findIndex(p => p.socket === socket);
  if (at < 0) return '';
  if (!moduleById((parts[at] as Placement).module)) return '';
  // `own` is one based, and both lists are in the same order, so one index
  // names the same placement in either raster.
  const want = at + 1;

  const held = (r: Raster): { cells: number; attached: boolean } => {
    let cells = 0;
    let attached = false;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const n = idx3(L, i, j, k);
      if (r.own[n] !== want) continue;
      cells++;
      if (attached) continue;
      // Anything else of the ship's next door will do: frame, plate, or the
      // part beside it. What is being ruled out is a mount floating in space,
      // not one that fails to reach a rib.
      //
      // Except a WELD. The connectivity pass grows a spar to any piece that
      // reaches nothing, so a base rotated off its hull comes back with the
      // rescue already attached and this gate answered yes on every hull in
      // the fleet: 23 of 23 hulls, and not one rotation of one part could
      // reach the refusal. A weld is the rasteriser tidying up after authored
      // decor, and it must not stand in for the ship when the question is
      // whether the player has just lifted a mount off it.
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const x = i + dx, y = j + dy, z = k + dz;
        if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
        const o = idx3(L, x, y, z);
        if (r.grid[o] && r.own[o] !== want && !r.welded[o]) { attached = true; break; }
      }
    }
    return { cells, attached };
  };

  const now = held(rasterise(d));
  const next = held(rasterise({ ...d, parts: [...parts] }));

  if (next.cells === 0) {
    return now.cells === 0 ? '' : 'the body would be buried: no cell of it would be left';
  }
  if (!next.attached && now.attached) return 'the base would leave the ship frame';
  const lost = now.cells - next.cells;
  if (lost > 0) {
    return `the body would stand in ${lost} occupied cell${lost === 1 ? '' : 's'}`;
  }
  return '';
}

/** The six cells sharing a face. Used by the mount rule, which asks about
 *  contact rather than about a diagonal touching a corner. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
