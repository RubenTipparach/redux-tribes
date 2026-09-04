/**
 * A design as a mesh, for the battlefield.
 *
 * The console drew every ship as a five sided cone. It reads at a glance and
 * it is a lie: a player spends an hour in the shipyard and then flies a
 * triangle. This turns a design into geometry, once per design rather than
 * once per ship, because a skirmish is four hulls out of at most five distinct
 * designs.
 *
 * FACES, not cubes. A box per cell is twelve triangles whichever way it is
 * turned, and on a Terran that is 4644 cells and 55728 triangles for one ship:
 * four of those took a headless frame from 22 fps to 2.2. A face wherever a
 * solid cell meets one that is not is 1606 quads for the same hull, an order
 * of magnitude less, and the greedy pass merges those into rectangles.
 *
 * The plain VOXEL rule, deliberately, including the faces nothing outside can
 * see. It used to be a flood fill from the edge of the lattice, so only the
 * outward skin existed: a frigate is mostly hollow, and the first shot through
 * its plating looked into a ship with no inside at all, stars showing through
 * the hole. Meshing the interior costs 18% more quads over a four frigate
 * skirmish (6183 to 7289) and is what makes a wound read as a hull with a hole
 * in it rather than as an empty shell.
 *
 * The editor draws the same cells its own way, through an instanced mesh it
 * can pick single cells out of and ghost the plate on. Two renderers, two sets
 * of needs; what they share is the thing that has to agree, which is what
 * colour a cell is (`cellColour` and `armourColour` in design.ts).
 */

import * as THREE from 'three';
import { finishMap, WINDOW_FACE, WINDOW_VARIANTS } from './textures.js';
import {
  latOf, VOXEL, type Lat, Mat, DEFAULT_METAL, DEFAULT_ROUGH, SECTIONS, stockFor,
  ARMOUR_BANDS, ROLE_BAND, armourColour, bandFinishes, bareGrid, cellColour, faceBasis,
  isPainted, paintedSlot, purposeAt, decalMap,
  finishesOf, frameFor, liveryFor, moduleById, rasterise, rasterSig, roleAt, seatedFacing,
  socketsOf, type Design,
} from './design.js';
import type { MountFace } from './turret.js';

/**
 * One gun on a hull, as the map needs it: where it turns and which quads turn
 * with it.
 *
 * In `mountsOf` order, which is the core's weapon index, so rig `n` is the
 * mount the resolver calls `n` and the arc mask `arcMasks(d)[n]` describes.
 * Three lists in the same order rather than three lookups.
 */
/**
 * The surfaces a hull is drawn with, and the order a material array for one
 * must be in.
 *
 * Armour, frame and machinery were three materials because they are three
 * things: an armour panel, the structure under it and a drive bell do not
 * wear the same finish, and drawing all three in the plating's was a ship
 * that looked like one material with parts painted on it.
 *
 * The armour is now THREE of them rather than one, for the same reason one
 * step down. A colour is free, because a vertex carries its own and any
 * number of them merge into one draw; a normal map is a material and a
 * material is a draw call. So a ship that wants its deck corrugated over
 * riveted flanks with greebled structure bolted on has to pay for three, and
 * three is where it stops: `ARMOUR_BANDS` in `design.ts` says why, and the
 * roles that map onto them are authored there too.
 *
 * The geometry is grouped in this order, so `mesh.material[SURF_FRAME]` is
 * still the frame's and `SURF_ARMOUR + band` is one band of plating.
 */
export const SURF_ARMOUR = 0;
export const SURF_FRAME = ARMOUR_BANDS;
/**
 * Machinery, three ways: what pushes, what shoots, and everything else.
 *
 * It was ONE surface for every part on the ship, and the note that justified
 * it said a player can tell a drive from a gun by its COLOUR, which is true
 * and is not the question a surface answers. A drive bell is a cast nozzle, a
 * turret is a machined gun and a barracks is a box; one greeble over all three
 * says none of it, and there was no way to say otherwise.
 *
 * Three rather than eight, because these are the three a player names when
 * asked what a ship is made of. Propulsion and attitude are one surface: both
 * are bells, and CLAUDE.md's own vocabulary keeps them one family of thing
 * even while keeping the WORDS apart.
 */
export const SURF_DRIVE = ARMOUR_BANDS + 1;
export const SURF_WEAPON = ARMOUR_BANDS + 2;
export const SURF_PART = ARMOUR_BANDS + 3;
/**
 * One surface per PALETTE SLOT, for cells laid down by the brush.
 *
 * A slot is a colour and what it is made of, and until now only the colour
 * reached a hand painted cell: the finish came from whichever band the cell's
 * livery role fell in, so painting a panel could not make it a different
 * material. Eight more surfaces is what a finish per slot costs, because a
 * normal map is a material and a material is a draw call.
 *
 * The three BANDS above are still three and still capped for the reason they
 * always were: they are what the livery paints by itself, on every hull,
 * without being asked. These are opt in, and a group is only emitted for a
 * surface that has quads in it, so a hull nobody has painted pays nothing and
 * a hull painted from two slots pays for two.
 */
export const SURF_SLOT = ARMOUR_BANDS + 4;
export const PAINT_SLOTS = 8;
export const SURF_COUNT = SURF_SLOT + PAINT_SLOTS;

/** What each surface is called, for anything that reports them. One list, so
 *  a screen cannot label the second band 'frame' because it counted wrong. */
/**
 * How far through the plating a window looks for its room, in REFERENCE cells.
 *
 * A window is a hole in the PLATING over a room, so how far it looks has to be
 * how thick the plating is, and how thick the plating is has to be the class's
 * own: courses are cut to the rung (`stock`), so a heavy cruiser carries ten
 * to twelve of them where a frigate carries three to five. A flat five cells
 * cannot cross that, and it did not: measured over the fleet, the Terran
 * destroyer, the Terran cruiser, both Benefactor heavies and the Rogue cruiser
 * drew NO room decal at all, only the running lights on their clamps, which
 * are on parts standing proud of the skin and never had to look through
 * anything. This is the same defect the depth was written for, back when it
 * was one cell and a belt was three.
 *
 * There is still a ceiling, and it is still the reason there was one: a player
 * may lay fifteen courses on a frigate, and fifteen courses of armour over a
 * barracks is a barracks nobody has a window onto. A decal that appeared
 * through that would be a hole the armour does not have. So the ceiling is
 * what the CLASS carries rather than what this hull was given, and over
 * armouring a ship still costs it its viewports.
 */
const WINDOW_DEPTH_REF = 5;

/** The lattice `WINDOW_DEPTH_REF` is authored on, so the reach is cut to a
 *  class's own the way everything else authored in cells already is. */
const REF_NX = 32;

export const SURF_NAMES: readonly string[] =
  ['plate', 'trim', 'structure', 'frame', 'drive', 'weapon', 'part',
    ...Array.from({ length: PAINT_SLOTS }, (_, n) => `brush ${n + 1}`)];

export interface HullRig {
  /** The weapon key, for naming it. */
  readonly key: string;
  /** Which placement it is, so a pick can name the part. */
  readonly part: number;
  /** The socket it turns on, in ship units. */
  readonly pivot: readonly [number, number, number];
  /**
   * The facing the design bolted it on at, as a rotation from the mount's
   * frame into the ship's.
   *
   * Not an angle. A mount can be yawed, pitched and rolled, and it is also
   * SEATED on whichever hull face its ring is on, so its rest is an
   * orientation rather than a number: a scalar could only ever describe the
   * one axis this used to have.
   */
  readonly face: MountFace;
}

export interface HullMesh {
  readonly geo: THREE.BufferGeometry;
  /** The world size of one cell, which is the SAME on every class. */
  readonly cell: number;
  /**
   * The lattice this hull was meshed on.
   *
   * Carried here rather than looked up again by everything that walks the
   * quads: a cell index means nothing without the lattice it was made on, and
   * the map takes hits apart in cell indices.
   */
  readonly lat: Lat;
  /** Which lattice cell each QUAD belongs to, so damage can take one away. */
  readonly cellOf: Int32Array;
  /** The centre of that cell in SHIP units, three per quad. What a hit is
   *  measured against, so a shot takes the cells it actually reached. */
  readonly centre: Float32Array;
  /** Quads, four vertices each. */
  readonly quads: number;
  /**
   * Every lattice cell each quad covers, concatenated, with `quadAt` marking
   * where each quad's run starts.
   *
   * A greedy quad is a RECTANGLE of cells, and a whole plated flank is one of
   * them. `cellOf` names only the first, so damage measured against it took a
   * hit anywhere on the plate as a reason to delete the entire plate. What a
   * shot actually reached is a handful of cells inside it, and that is the
   * question this answers.
   */
  readonly quadCells: Int32Array;
  /** Length quads + 1; quad q covers `quadCells[quadAt[q] .. quadAt[q+1]]`. */
  readonly quadAt: Uint32Array;
  /** The lattice box the hull occupies, so a carve does not sweep the void. */
  readonly lo: readonly [number, number, number];
  readonly hi: readonly [number, number, number];
  /** Half extents in ship units, about the hull's own centre. */
  readonly half: readonly [number, number, number];
  /**
   * Where that centre is, in ship units.
   *
   * Not the origin. A hull is not symmetric about the point it turns around:
   * a Terran runs from its drive bells behind the origin to a nose well in
   * front of it, and anything framing this mesh on (0,0,0) with `half` puts
   * the difference off the edge of the picture.
   */
  readonly mid: readonly [number, number, number];
  /** Which rig each QUAD belongs to, or -1 for the hull itself. */
  readonly rigOf: Int32Array;
  /** The guns, in the core's own mount order. */
  readonly rigs: readonly HullRig[];
  /**
   * Which rig each CELL belongs to, for the cells that belong to one.
   *
   * `rigOf` answers the same question per quad, which is what POSING a turret
   * needs. Damage asks it per cell, because the carve works over the lattice,
   * and answering per quad let a blast take a bite out of a barrel.
   */
  readonly rigOfCell: ReadonlyMap<number, number>;
  /** Every cell of each rig, so a mount can be taken off in one piece. */
  readonly rigCells: ReadonlyArray<Int32Array>;
  /**
   * The windows cut into the plating, one geometry per decal kind.
   *
   * A separate mesh rather than part of the hull, because a window needs three
   * maps of its own and the hull has one material. There are a few dozen of
   * them against a thousand plate quads, so it is one small extra draw per
   * kind per ship and the plate pass is untouched.
   *
   * `cellOf` runs parallel to the quads, so a carve can collapse the window
   * over a cell it just shot away: a viewport still glowing on plating that is
   * no longer there would be the one thing on a wreck that had not noticed.
   */
  readonly windows: ReadonlyArray<{
    readonly key: string;
    readonly geo: THREE.BufferGeometry;
    readonly cellOf: Int32Array;
  }>;
}

/**
 * The side colours a hull is washed with, and the wash itself.
 *
 * Here rather than in `view.ts` because three pictures now draw the same
 * hulls: the map, the fleet chip thumbnails and the schematic modal. Whose
 * ship a hull is has to read identically in all three, and a second copy of
 * the tint is a copy that goes its own way the first time one of them is
 * tuned (GUIDELINES 5.1).
 */
export const SIDE_TONE = {
  mine: 0x35c7ff,
  theirs: 0xfa6a0a,
  adrift: 0xff4b4b,
  lost: 0x33404f,
} as const;

/** Which of those a hull wears, given the seat looking at it. */
export function hullTone(
  s: { destroyed: boolean; drifting: boolean; side: number }, mySide: number,
): number {
  return s.destroyed ? SIDE_TONE.lost
    : s.drifting ? SIDE_TONE.adrift
    : s.side === mySide ? SIDE_TONE.mine : SIDE_TONE.theirs;
}

/**
 * How far the side wash goes, at the two ends of the range.
 *
 * Whose ship this is matters at MAP range, where a hull is a few pixels; what
 * it is built out of matters up CLOSE, where the tint is just paint over the
 * thing being looked at. A wreck is washed out whatever the range, because
 * "this one is gone" outranks both.
 */
const TINT_NEAR = 0.05, TINT_FAR = 0.40, TINT_LOST = 0.8;
/** How much the hull glows at map range, so it reads against the field. */
const GLOW_FAR = 0.09;

/**
 * The camera's distance as a 0 to 1 "far": 0 up close, 1 out at map range.
 *
 * Twelve to fifty four units, which is the span between inspecting one ship
 * and planning a move with a fleet.
 */
export const tintFar = (dist: number): number =>
  Math.max(0, Math.min(1, (dist - 14) / 40));

/** How much of the side colour a hull wears at that range. */
export const tintMix = (destroyed: boolean, far: number): number =>
  destroyed ? TINT_LOST : TINT_NEAR + (TINT_FAR - TINT_NEAR) * far;

/**
 * Wash a hull material toward its side, keeping the design's own paint.
 *
 * Lambert MULTIPLIES this by the vertex colour, so the full side colour would
 * wash a red gun to near black. A lerp from white keeps the hue.
 *
 * `far` is what the three callers differ on and the only thing they differ on,
 * which is why it is a parameter rather than three copies of this: the map
 * passes the camera's own range so a hull repaints as it is zoomed in on, a
 * chip thumbnail passes 1 because a 44 pixel picture IS map range, and the
 * schematic passes 0 because it exists to show what a hull is made of.
 */
/**
 * Anything with a colour and an emissive, which is the whole of what this
 * touches. Lambert and Standard both qualify, and naming one of them here made
 * every caller drawing the other cast a lie to get in.
 */
export interface Tintable {
  color: THREE.Color;
  emissive: THREE.Color;
  needsUpdate: boolean;
}

/**
 * The three materials a hull mesh is drawn with, in `SURF_*` order.
 *
 * ONE builder, because four pictures draw these hulls and a second copy is a
 * second answer to "what is a drive bell made of". Metalness and roughness
 * are the design's own for the armour, since they are what separate painted
 * steel from bare alloy and belong to the hull rather than to any one screen;
 * the frame and the machinery are duller and rougher than plating whatever
 * the plating is, because they are structure and guts rather than a finish
 * anybody chose to present.
 */
export function hullMaterials(d: Design): THREE.MeshStandardMaterial[] {
  const f = finishesOf(d);
  const bands = bandFinishes(d);
  const livery = liveryFor(d.faction);
  const common = {
    vertexColors: true,
    // A dark hull under one key light is a slow gradient in a narrow range,
    // and it contours on an eight bit canvas for the same reason the sky
    // does. One property, and the plating grades instead of stepping.
    dithering: true,
  } as const;
  const mats: THREE.MeshStandardMaterial[] = [];
  // Band nought is the broad plating and it keeps the DESIGN's own metalness
  // and roughness, because that pair is what a player sets and it has always
  // meant "what is this hull made of". The other two take the livery's, which
  // is what makes a corrugated trim read as a different material rather than
  // as the same paint with a different bump on it.
  for (let b = 0; b < ARMOUR_BANDS; b++) {
    const pbr = livery.pbr[b] as readonly [number, number];
    mats[SURF_ARMOUR + b] = new THREE.MeshStandardMaterial({
      ...common,
      metalness: b === 0 ? d.metal ?? DEFAULT_METAL : pbr[0],
      roughness: b === 0 ? d.rough ?? DEFAULT_ROUGH : pbr[1],
      normalMap: finishMap(bands[b] as string),
    });
  }
  mats[SURF_FRAME] = new THREE.MeshStandardMaterial({
    ...common, metalness: 0.45, roughness: 0.70, normalMap: finishMap(f.frame),
  });
  mats[SURF_DRIVE] = new THREE.MeshStandardMaterial({
    ...common, metalness: 0.55, roughness: 0.62, normalMap: finishMap(f.drive),
  });
  mats[SURF_WEAPON] = new THREE.MeshStandardMaterial({
    ...common, metalness: 0.55, roughness: 0.62, normalMap: finishMap(f.weapon),
  });
  mats[SURF_PART] = new THREE.MeshStandardMaterial({
    ...common, metalness: 0.55, roughness: 0.62, normalMap: finishMap(f.part),
  });
  // A surface per slot: the finish that swatch carries, falling back to the
  // hull's own. Built whether or not anything is painted with it, because a
  // material is cheap and a MISSING one is a group pointing at nothing; the
  // draw call is only paid when the mesh has quads in that group.
  for (let n = 0; n < PAINT_SLOTS; n++) {
    mats[SURF_SLOT + n] = new THREE.MeshStandardMaterial({
      ...common,
      metalness: d.metal ?? DEFAULT_METAL,
      roughness: d.rough ?? DEFAULT_ROUGH,
      normalMap: finishMap(d.slotFinish?.[n] || f.armour),
    });
  }
  return mats;
}

export function tintHull(
  mat: Tintable, tone: number, destroyed: boolean, far: number,
): void {
  mat.color.setHex(0xffffff).lerp(new THREE.Color(tone), tintMix(destroyed, far));
  mat.emissive.setHex(destroyed ? 0x000000 : tone).multiplyScalar(GLOW_FAR * far);
  mat.needsUpdate = true;
}

const cache = new Map<string, HullMesh>();
/** Four ships out of a handful of designs, and a cap so editing between
 *  matches all session cannot grow this without bound. */
const CACHE_MAX = 12;

/**
 * Mesh a hull, optionally with its armour taken off.
 *
 * `bare` is the shipyard's x ray, on the same mesher rather than beside it.
 * The plate simply is not there: a plate cell reads as empty, so the flood
 * fill runs through where it was and the greedy pass meshes the FRAME and the
 * parts against the outside, which is exactly the picture the editor draws
 * when a player turns the plate off. A `Skinned` cell goes back to being the
 * frame member it always was, because that is what it is once the shell it was
 * standing in is gone.
 *
 * The alternative was a second mesher for interiors, and a second mesher is a
 * second answer to "what colour is this cell" and "which cells are visible",
 * either of which drifting would draw a player a ship that is not the one they
 * built (GUIDELINES 5.1).
 */
export function hullMesh(d: Design, bare = false): HullMesh {
  const key = rasterSig(d) + '|' + d.faction + '|' + d.paint + (bare ? '|bare' : '');
  const hit = cache.get(key);
  if (hit) return hit;

  const frame = frameFor(d.classKey);
  // A voxel is the same size on every hull; how many of them there are is what
  // makes one class bigger than another. Shadowed so the walk below reads as
  // the lattice walk it is.
  const cell = VOXEL;
  const { nx: NX, ny: NY, nz: NZ, cells: CELLS } = latOf(frame);
  // How far in the room is, which is two things and both of them scale.
  //
  // The PLATING is one: courses are cut to the rung, so the fleet's belts run
  // from one course on a Rogue frigate to twelve on a Benefactor heavy
  // cruiser. And the ROOM is the other: a bay is seated at a fraction of the
  // half beam, so the same fitting on a hull twice as wide sits twice as many
  // cells inside the skin, whatever the armour over it is doing.
  //
  // A flat five cells tracked neither, and measured over the fleet the Terran
  // destroyer, the Terran cruiser, both Benefactor heavies and the Rogue
  // cruiser drew NO room decal at all: only the running lights on their
  // clamps, which sit on parts standing proud of the skin and never had to
  // look through anything. That is the same defect the depth was written for,
  // back when it was one cell and a belt was three.
  //
  // So it is the rung's own reach, and never less than the CLASS's stock
  // plating. The ceiling is still there and still for its original reason: a
  // player may lay fifteen courses on a frigate, and fifteen courses over a
  // barracks is a barracks nobody has a window onto. Taking the class's stock
  // courses rather than this hull's is what keeps that true.
  const stockCourses = stockFor(d.classKey).sections;
  const depth = Math.max(
    Math.round(WINDOW_DEPTH_REF * NX / REF_NX),
    1 + Math.max(...SECTIONS.map(k => stockCourses[k])));
  const raster = rasterise(d);
  const purp = raster.purp, own = raster.own, tone = raster.tone;
  const grid = bare ? bareGrid(raster.grid, raster.own) : raster.grid;
  const idx = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

  // The guns, and which placement each one is, so the quads that belong to a
  // turret can be turned without moving the hull it is bolted to. Walked the
  // same way `mountsOf` walks it, because the order IS the core's weapon
  // index: a rig that did not line up would swing the wrong barrel.
  const socks = socketsOf(frame, d.parts);
  const rigs: HullRig[] = [];
  const rigOfPart = new Map<number, number>();
  d.parts.forEach((p, pi) => {
    const m = moduleById(p.module);
    if (!m?.weapon) return;
    const sock = socks.find(k => k.id === p.socket);
    if (!sock) return;
    rigOfPart.set(pi, rigs.length);
    rigs.push({
      key: m.weapon,
      part: pi,
      pivot: [
        ((sock.at[0] as number) - NX / 2) * cell,
        ((sock.at[1] as number) - NY / 2) * cell,
        ((sock.at[2] as number) - NZ / 2) * cell,
      ],
      face: faceBasis(seatedFacing(frame, sock, p)),
    });
  });

  // A face is drawn wherever a solid cell meets one that is not: the plain
  // voxel rule, and nothing cleverer.
  //
  // This used to be a flood fill from the edge of the lattice, so only the
  // faces the OUTSIDE could reach were built. That is a smaller mesh and it is
  // wrong the moment anything opens the hull: a frigate is mostly hollow, the
  // enclosed gaps between its frame and its parts were never meshed, and a
  // shot through the plating therefore looked into a ship with no inside at
  // all. Stars came through the hole, because behind the hole there was
  // literally nothing drawn.
  //
  // The greedy pass absorbs most of what that saved, which is why the flood
  // fill was never worth what it cost in correctness: measured over the stock
  // fleet, 6183 quads to 7289 for a four frigate skirmish and 26932 to 30402
  // over all seventeen hulls, 18% and 13%. A hull you can see through is not
  // a saving.
  const open = (i: number, j: number, k: number) =>
    (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) ? 1 : (grid[idx(i, j, k)] ? 0 : 1);

  /** A cell's colour, which is what decides whether two faces may merge. */
  const colourAt = (i: number, j: number, k: number): number => {
    const n = idx(i, j, k);
    const mat = grid[n] as number;
    return mat === Mat.Plate || mat === Mat.Skinned
      ? armourColour(d.faction, d.paint, tone[n] as number)
      : cellColour(mat, purp[n] as number, d.paint);
  };

  const pos: number[] = [], nrm: number[] = [], col: number[] = [], cellOf: number[] = [];
  // One repeat of a finish per CELL, however many cells the greedy rectangle
  // turned out to cover, and the texture's V along the HULL's up axis.
  //
  // Not the layer's own V: on the x faces the layer's u IS y, so a decal came
  // out a quarter turn round and a corrugation ran vertically on one flank and
  // horizontally on the next. The y faces have no up to agree about and keep
  // theirs.
  const uv: number[] = [];
  // Every cell under every quad, and where each quad's run begins.
  const quadCells: number[] = [], quadAt: number[] = [0];
  const c = new THREE.Color();
  let loX = NX, loY = NY, loZ = NZ, hiX = -1, hiY = -1, hiZ = -1;

  // Greedy meshing, one direction and one layer at a time.
  //
  // A quad per exposed face is already eleven times better than a cube per
  // cell, and still draws a hundred separate squares across one flat panel.
  // Merging runs of the same colour into rectangles is what makes a plated
  // flank ONE quad: 2536 faces on a Terran become a few hundred, and the four
  // hulls of a skirmish stop costing more triangles than everything else on
  // the map put together.
  const DIRS: ReadonlyArray<{
    axis: 0 | 1 | 2; step: 1 | -1; n: readonly [number, number, number];
  }> = [
    { axis: 0, step: 1, n: [1, 0, 0] }, { axis: 0, step: -1, n: [-1, 0, 0] },
    { axis: 1, step: 1, n: [0, 1, 0] }, { axis: 1, step: -1, n: [0, -1, 0] },
    { axis: 2, step: 1, n: [0, 0, 1] }, { axis: 2, step: -1, n: [0, 0, -1] },
  ];
  const SIZE = [NX, NY, NZ] as const;
  const put = (a: number[], axis: number, u: number, v: number, w: number) => {
    // Back into lattice order, whichever pair of axes this layer is drawn on.
    if (axis === 0) { a[0] = w; a[1] = u; a[2] = v; }
    else if (axis === 1) { a[0] = u; a[1] = w; a[2] = v; }
    else { a[0] = u; a[1] = v; a[2] = w; }
  };

  /**
   * Which window a PLATE cell wears, if any.
   *
   * A window is a hole in the armour where a room is behind it, so it is not a
   * property of a cell at all: it is a property of the cell one step INWARD.
   * The plate over a bridge wears the bridge viewport; the plate over a
   * barracks wears cabin panes. Authored on the module (`ModuleDef.window`)
   * and derived here, which survives any change to the rasteriser and means a
   * stock hull gets its windows for free from the rooms it already carries.
   *
   * Plate only. A window in the middle of a drive bell would be a window on a
   * part that is standing outside the hull, which is a hole in an engine.
   */
  /**
   * What a player painted on, by cell. Built once per mesh rather than read
   * off the design per face: this is asked six times for every cell of the
   * hull.
   */
  const decals = decalMap(d);

  const roomBehind = (
    i: number, j: number, k: number, dx: number, dy: number, dz: number,
  ): string | null => {
    // Through the PLATING, not one step in.
    //
    // A belt is three to five courses thick and a room behind it is therefore
    // three to five cells inside the skin, so a rule that looked exactly one
    // cell inward found a room only where the armour happened to be one cell
    // thick. Measured over the fleet it was finding almost nothing: a Terran
    // corvette carried a bridge and drew no viewport at all, and a container
    // ship with twelve boxes in it showed six door panels.
    //
    // Every cell crossed has to be plating. The moment the march meets
    // anything else it is inside the ship and whatever it met is the answer,
    // so a window still means "a room immediately behind this skin" rather
    // than "a room somewhere along this line".
    for (let step = 1; step <= depth; step++) {
      const bi = i - dx * step, bj = j - dy * step, bk = k - dz * step;
      if (bi < 0 || bj < 0 || bk < 0 || bi >= NX || bj >= NY || bk >= NZ) return null;
      const m = idx(bi, bj, bk);
      const owner = own[m] as number;
      if (owner > 0) {
        const part = d.parts[owner - 1];
        const key = (part ? moduleById(part.module)?.window : undefined) ?? null;
        if (!key) return null;
        // Which axis this face's normal runs along, against the axes the
        // decal is allowed on.
        const face = WINDOW_FACE[key];
        if (face) {
          const axis = dx !== 0 ? 'x' : dy !== 0 ? 'y' : 'z';
          if (!face.includes(axis)) return null;
        }
        return key;
      }
      const inner = grid[m] as number;
      if (inner !== Mat.Plate && inner !== Mat.Skinned) return null;
    }
    return null;
  };

  /**
   * The same question asked of the hull's OTHER SIDE as well.
   *
   * A ship is symmetric about its keel and its windows should be too: a row of
   * cabins down the port flank with nothing facing them to starboard is the
   * one thing on a hull that reads as a mistake at a glance. Measured over the
   * fleet, half of every window cell had no twin.
   *
   * The rooms are not the problem. Every fitting is authored on a mirrored
   * pair of sockets, and 432 of them are exact. What moves them is the
   * rasteriser's own collision nudge: a part that cannot sit where its socket
   * puts it walks until it fits, the walk sees whatever the placements before
   * it left, and one displaced fitting sends the next one somewhere else
   * again. The Terran frigate's clamps end six cells inboard of their sockets
   * and five cells apart in z, so every beacon window on that hull was on one
   * side only.
   *
   * So the skin is asked about the room behind it AND about the room behind
   * its mirror, which is the ship as DESIGNED rather than as the packer
   * happened to settle it. Both cells have to be plating and the mirrored face
   * has to be the mirrored normal, so this can only ever light a pane on a
   * surface that is really there; what it cannot do is invent a room, because
   * a room is what it is asking about.
   *
   * Nothing here crosses the boundary or is hashed. Which cells are lit is the
   * client drawing, and two clients that disagreed about a window would still
   * play the same match.
   */
  const windowAt = (
    i: number, j: number, k: number, dx: number, dy: number, dz: number,
  ): string | null => {
    const n = idx(i, j, k);
    const mat = grid[n] as number;
    if (mat !== Mat.Plate && mat !== Mat.Skinned) return null;
    // A HAND PAINTED decal wins, and it is asked first.
    //
    // The derivation below is what gives a stock hull its windows for free,
    // and it can only ever answer for a cell with a room behind it. A player
    // who wants a porthole somewhere else is not making a mistake the editor
    // should argue with, so a painted cell is simply the answer.
    //
    // On EVERY exposed face of that cell, unlike the derived pass, which is
    // held to `WINDOW_FACE` so a room's decal does not tile over a whole hull.
    // A player placing one cell at a time is being deliberate, and a tool that
    // silently drew nothing because the cell's only open face pointed the
    // wrong way would be a tool nobody could tell was working.
    const painted = decals.get(n);
    if (painted) return painted;
    const mine = roomBehind(i, j, k, dx, dy, dz);
    if (mine) return mine;
    // The mirror of this cell, looking the mirrored way: a face whose normal
    // runs across the hull points the other way over there, and one running
    // along it or up it points the same way.
    const mi = NX - 1 - i;
    if (mi === i) return null;
    const mn = idx(mi, j, k);
    const mm = grid[mn] as number;
    if (mm !== Mat.Plate && mm !== Mat.Skinned) return null;
    // And it has to be a face over there too, or this would light a pane on
    // plating with more plating outside it.
    if (!open(mi - dx, j - dy, k - dz)) return null;
    return roomBehind(mi, j, k, -dx, dy, dz);
  };
  /** Every window face found, by decal kind: cell, and which way it looks. */
  const winFaces = new Map<string, Array<{ cell: number; dir: number }>>();

  /**
   * Which rig owns a cell, or -1.
   *
   * A turret is bolted to the hull, not part of it: at rest most of its cells
   * sit flush against the plating, and the outside flood fill treats that
   * seam as interior forever, because it is computed once for a hull that
   * never moves. But the mount DOES move, so the seam is exactly the face
   * left staring at empty space the instant the barrel swings off rest. A rig
   * cell therefore needs every face not shared with another cell of its own
   * rig, whatever sits on the other side of it, rather than the "outside"
   * test the rest of the hull uses.
   */
  const rigCellAt = (i: number, j: number, k: number): number => {
    if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return -1;
    const n = idx(i, j, k);
    if (!grid[n]) return -1;
    const owner = own[n] as number;
    return owner > 0 ? rigOfPart.get(owner - 1) ?? -1 : -1;
  };

  const at = [0, 0, 0];
  for (let di = 0; di < DIRS.length; di++) {
    const dir = DIRS[di] as (typeof DIRS)[number];
    const axis = dir.axis;
    const uAxis = axis === 0 ? 1 : 0;
    const vAxis = axis === 2 ? 1 : 2;
    const wN = SIZE[axis] as number, uN = SIZE[uAxis] as number, vN = SIZE[vAxis] as number;
    const mask = new Int32Array(uN * vN);
    const owner = new Int32Array(uN * vN);
    for (let w = 0; w < wN; w++) {
      mask.fill(-1);
      for (let v = 0; v < vN; v++) for (let u = 0; u < uN; u++) {
        put(at, axis, u, v, w);
        const i = at[0] as number, j = at[1] as number, k = at[2] as number;
        if (!grid[idx(i, j, k)]) continue;
        const rig = rigCellAt(i, j, k);
        put(at, axis, u, v, w + dir.step);
        const ni = at[0] as number, nj = at[1] as number, nk = at[2] as number;
        if (rig >= 0 ? rigCellAt(ni, nj, nk) === rig : !open(ni, nj, nk)) continue;
        // A window face leaves the plate pass entirely rather than merging
        // into it. Each one needs its own slice of a variant strip, so it
        // cannot share a quad with its neighbour, and the hole it leaves in
        // the plating is exactly where the window mesh goes.
        const win = windowAt(i, j, k, dir.n[0] as number, dir.n[1] as number, dir.n[2] as number);
        if (win) {
          let list = winFaces.get(win);
          if (!list) { list = []; winFaces.set(win, list); }
          list.push({ cell: idx(i, j, k), dir: di });
          if (i < loX) loX = i; if (i > hiX) hiX = i;
          if (j < loY) loY = j; if (j > hiY) hiY = j;
          if (k < loZ) loZ = k; if (k > hiZ) hiZ = k;
          continue;
        }
        // Tagged with the rig so a turret's own faces never merge into a
        // neighbour's or the hull's: two cells drawing the same colour would
        // otherwise share a quad that only half of them should turn with.
        mask[u + v * uN] = colourAt(i, j, k) | ((rig + 1) << 24);
        owner[u + v * uN] = idx(i, j, k);
        if (i < loX) loX = i; if (i > hiX) hiX = i;
        if (j < loY) loY = j; if (j > hiY) hiY = j;
        if (k < loZ) loZ = k; if (k > hiZ) hiZ = k;
      }

      for (let v = 0; v < vN; v++) {
        for (let u = 0; u < uN;) {
          const hex = mask[u + v * uN] as number;
          if (hex < 0) { u++; continue; }
          // How far this colour runs along u, then how many whole rows of that
          // width follow it.
          let wide = 1;
          while (u + wide < uN && mask[u + wide + v * uN] === hex) wide++;
          let tall = 1;
          grow: while (v + tall < vN) {
            for (let q = 0; q < wide; q++) {
              if (mask[u + q + (v + tall) * uN] !== hex) break grow;
            }
            tall++;
          }
          for (let b = 0; b < tall; b++) for (let a = 0; a < wide; a++) {
            mask[u + a + (v + b) * uN] = -1;
          }

          // The rectangle's four corners, in lattice space, on the face's own
          // side of the cell.
          //
          // Which way round they go depends on the axis, not just on the sign.
          // The layer's own two axes are (u, v) and the triangle is front
          // facing when u cross v points along the normal: for the x faces
          // that is Y cross Z which is +X, and for the z faces X cross Y which
          // is +Z, but for the y faces it is X cross Z which is MINUS Y. So
          // the top and bottom of every hull came out wound backwards, was
          // culled, and the ship read as a flat slab you could see into. The
          // normals were right the whole time, which is why it looked lit and
          // wrong rather than black.
          const face = dir.step > 0 ? 1 : 0;
          const ccw = (dir.step > 0) !== (axis === 1);
          const corners: ReadonlyArray<readonly [number, number]> = ccw
            ? [[0, 0], [wide, 0], [wide, tall], [0, tall]]
            : [[0, 0], [0, tall], [wide, tall], [wide, 0]];
          c.setHex(hex & 0xffffff);
          for (const [du, dv] of corners) {
            put(at, axis, u + du, v + dv, w + face);
            pos.push(
              ((at[0] as number) - NX / 2) * cell,
              ((at[1] as number) - NY / 2) * cell,
              ((at[2] as number) - NZ / 2) * cell);
            nrm.push(dir.n[0] as number, dir.n[1] as number, dir.n[2] as number);
            col.push(c.r, c.g, c.b);
            if (axis === 0) uv.push(dv, du);
            else uv.push(du, dv);
          }
          cellOf.push(owner[u + v * uN] as number);
          // The rectangle's whole footprint, not just the corner it is named
          // for: this is what lets a hit take the cells it reached and leave
          // the rest of the plate standing.
          for (let b = 0; b < tall; b++) {
            for (let a = 0; a < wide; a++) {
              put(at, axis, u + a, v + b, w);
              quadCells.push(idx(at[0] as number, at[1] as number, at[2] as number));
            }
          }
          quadAt.push(quadCells.length);
          u += wide;
        }
      }
    }
  }

  // ---- the three surfaces, sorted into runs -----------------------------
  //
  // Armour, frame and machinery are three different materials, because they
  // are three different things: a drive bell and an armour panel do not wear
  // the same finish, and a frame member wears neither. three.js draws that as
  // groups over one geometry, and a group is a CONTIGUOUS range, so the quads
  // are sorted into surface order here rather than being emitted in it.
  //
  // A sort rather than three emit buffers because every parallel array has to
  // move with the quad it belongs to: the four vertices, the cell it is named
  // for, and its whole footprint. One permutation applied to all of them
  // cannot leave two of them disagreeing, which three buffers filled in three
  // places eventually would.
  const surfaceOf = (q: number): number => {
    const n = cellOf[q] as number;
    const mat = grid[n] as number;
    if (mat === Mat.Plate || mat === Mat.Skinned) {
      // A hand painted cell draws in the broad plating's band. Its COLOUR is
      // the slot's, which is a vertex attribute and free; its finish is the
      // hull's, because a finish is a material and a material is a draw call.
      // A hand painted cell draws in its SLOT's surface, so the finish a
      // player put on that swatch is the finish the panel wears.
      const t = tone[n] as number;
      return isPainted(t) ? SURF_SLOT + paintedSlot(t)
        : SURF_ARMOUR + ROLE_BAND[roleAt(t)];
    }
    if (mat === Mat.Frame) return SURF_FRAME;
    // Which machinery, by what the cell is FOR. `purp` is the purpose code the
    // rasteriser already writes for the colour legend, so this is the same
    // answer asked about the surface instead of about the hue.
    //
    // Nought is NO purpose recorded, which is a spar or a weld rather than a
    // drive. `purposeAt` answers the first row of the table for it, so asking
    // it directly would have put every unclaimed cell in the engines.
    const code = purp[n] as number;
    if (!code) return SURF_PART;
    const job = purposeAt(code);
    if (job === 'propulsion' || job === 'attitude') return SURF_DRIVE;
    if (job === 'gun' || job === 'ordnance') return SURF_WEAPON;
    return SURF_PART;
  };
  const order = cellOf.map((_, q) => q);
  // Stable, so a run of plate stays in the order the greedy pass laid it down
  // and the same design meshes to the same buffer every time.
  order.sort((a, b) => surfaceOf(a) - surfaceOf(b) || a - b);
  const sPos: number[] = [], sNrm: number[] = [], sCol: number[] = [], sUv: number[] = [];
  const sCellOf: number[] = [], sQuadCells: number[] = [], sQuadAt: number[] = [0];
  const groups: Array<{ start: number; count: number; surface: number }> = [];
  for (let n = 0; n < order.length; n++) {
    const q = order[n] as number;
    for (let v = 0; v < 4; v++) {
      const p = q * 12 + v * 3, t = q * 8 + v * 2;
      sPos.push(pos[p] as number, pos[p + 1] as number, pos[p + 2] as number);
      sNrm.push(nrm[p] as number, nrm[p + 1] as number, nrm[p + 2] as number);
      sCol.push(col[p] as number, col[p + 1] as number, col[p + 2] as number);
      sUv.push(uv[t] as number, uv[t + 1] as number);
    }
    sCellOf.push(cellOf[q] as number);
    for (let i = quadAt[q] as number; i < (quadAt[q + 1] as number); i++) {
      sQuadCells.push(quadCells[i] as number);
    }
    sQuadAt.push(sQuadCells.length);
    const surf = surfaceOf(q);
    const last = groups[groups.length - 1];
    if (last && last.surface === surf) last.count += 6;
    else groups.push({ start: n * 6, count: 6, surface: surf });
  }
  // Two triangles a quad, indexed, so the four corners are shared.
  const quads = sCellOf.length;
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    index[q * 6] = b; index[q * 6 + 1] = b + 1; index[q * 6 + 2] = b + 2;
    index[q * 6 + 3] = b; index[q * 6 + 4] = b + 2; index[q * 6 + 5] = b + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sPos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(sNrm), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(sCol), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(sUv), 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  // One draw per surface that is actually on this hull, in SURF order, which
  // is the order a caller must build its material array in.
  for (const g of groups) geo.addGroup(g.start, g.count, g.surface);
  geo.computeBoundingSphere();

  const centre = new Float32Array(quads * 3);
  for (let q = 0; q < quads; q++) {
    const n = sCellOf[q] as number;
    const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
    centre[q * 3] = (i - NX / 2 + 0.5) * cell;
    centre[q * 3 + 1] = (j - NY / 2 + 0.5) * cell;
    centre[q * 3 + 2] = (k - NZ / 2 + 0.5) * cell;
  }

  const rigOf = new Int32Array(quads);
  for (let q = 0; q < quads; q++) {
    const owner = own[sCellOf[q] as number] as number;
    rigOf[q] = owner > 0 ? (rigOfPart.get(owner - 1) ?? -1) : -1;
  }

  // The same question at CELL resolution, because that is the resolution
  // damage works at. A turret is atomic under fire: it is whole or it is gone,
  // never chewed, so the carve has to be able to step over its cells and to
  // take all of them at once.
  const rigOfCell = new Map<number, number>();
  const rigCells: number[][] = rigs.map(() => []);
  for (let n = 0; n < CELLS; n++) {
    if (!grid[n]) continue;
    const owner = own[n] as number;
    if (owner <= 0) continue;
    const r = rigOfPart.get(owner - 1);
    if (r === undefined) continue;
    rigOfCell.set(n, r);
    (rigCells[r] as number[]).push(n);
  }

  // ---- the windows ----
  //
  // One quad per cell, unmerged on purpose: each picks its own slice of its
  // decal's variant strip, so a run of cabins down a flank is lit differently
  // along its length instead of reading as one panel repeated. Which slice is
  // a hash of the CELL, so the same hull is lit the same way on both seats and
  // on a re-watch; nothing here is random and nothing is hashed into the
  // state, because a lit window cannot change an outcome.
  const windows: Array<{ key: string; geo: THREE.BufferGeometry; cellOf: Int32Array }> = [];
  for (const [key, faces] of [...winFaces].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const variants = WINDOW_VARIANTS[key] ?? 1;
    const wPos: number[] = [], wNrm: number[] = [], wUv: number[] = [], wCol: number[] = [];
    const wCell: number[] = [];
    // The frame round a pane is the plating it is cut into, so a window on
    // the deck is framed in the deck's colour and one on the flank in the
    // flank's. One colour for every window would have put a hull coloured
    // border round a viewport in the middle of a differently painted panel.
    const plate = new THREE.Color();
    for (const f of faces) {
      const dir = DIRS[f.dir] as (typeof DIRS)[number];
      const axis = dir.axis;
      const uAxis = axis === 0 ? 1 : 0;
      const vAxis = axis === 2 ? 1 : 2;
      const i = f.cell % NX, j = ((f.cell / NX) | 0) % NY, k = (f.cell / (NX * NY)) | 0;
      const lat = [i, j, k] as const;
      const u0 = lat[uAxis] as number, v0 = lat[vAxis] as number, w0 = lat[axis] as number;
      const face = dir.step > 0 ? 1 : 0;
      const ccw = (dir.step > 0) !== (axis === 1);
      const corners: ReadonlyArray<readonly [number, number]> = ccw
        ? [[0, 0], [1, 0], [1, 1], [0, 1]]
        : [[0, 0], [0, 1], [1, 1], [1, 0]];
      // Which variant this cell shows. A hash rather than a counter, so
      // adding a cabin somewhere else on the ship does not relight this one.
      const slice = variants > 1
        ? (Math.imul(f.cell ^ 0x9e3779b9, 2246822519) >>> 0) % variants : 0;
      const span = 1 / variants;
      for (const [du, dv] of corners) {
        put(at, axis, u0 + du, v0 + dv, w0 + face);
        wPos.push(
          ((at[0] as number) - NX / 2) * cell,
          ((at[1] as number) - NY / 2) * cell,
          ((at[2] as number) - NZ / 2) * cell);
        wNrm.push(dir.n[0] as number, dir.n[1] as number, dir.n[2] as number);
        plate.setHex(armourColour(d.faction, d.paint, tone[f.cell] as number));
        wCol.push(plate.r, plate.g, plate.b);
        // The decal's own up is the HULL's up, the same swap the finish makes
        // on the x faces, or a viewport lies on its side down one flank.
        const s0 = axis === 0 ? dv : du;
        const t0 = axis === 0 ? du : dv;
        wUv.push((slice + s0) * span, t0);
      }
      wCell.push(f.cell);
    }
    if (!wCell.length) continue;
    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wPos), 3));
    wGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(wNrm), 3));
    wGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wCol), 3));
    wGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(wUv), 2));
    const wIndex = new Uint32Array(wCell.length * 6);
    for (let q = 0; q < wCell.length; q++) {
      const b = q * 4;
      wIndex[q * 6] = b; wIndex[q * 6 + 1] = b + 1; wIndex[q * 6 + 2] = b + 2;
      wIndex[q * 6 + 3] = b; wIndex[q * 6 + 4] = b + 2; wIndex[q * 6 + 5] = b + 3;
    }
    wGeo.setIndex(new THREE.BufferAttribute(wIndex, 1));
    wGeo.computeBoundingSphere();
    windows.push({ key, geo: wGeo, cellOf: new Int32Array(wCell) });
  }

  const out: HullMesh = {
    geo,
    windows,
    cell, lat: latOf(frame),
    rigOf,
    rigs,
    rigOfCell,
    rigCells: rigCells.map(v => new Int32Array(v)),
    cellOf: new Int32Array(sCellOf),
    centre,
    quads,
    quadCells: new Int32Array(sQuadCells),
    quadAt: new Uint32Array(sQuadAt),
    lo: [loX, loY, loZ],
    hi: [hiX, hiY, hiZ],
    half: [
      Math.max(1, hiX - loX + 1) * cell / 2,
      Math.max(1, hiY - loY + 1) * cell / 2,
      Math.max(1, hiZ - loZ + 1) * cell / 2,
    ],
    mid: [
      ((loX + hiX + 1) / 2 - NX / 2) * cell,
      ((loY + hiY + 1) / 2 - NY / 2) * cell,
      ((loZ + hiZ + 1) / 2 - NZ / 2) * cell,
    ],
  };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    const gone = cache.get(oldest);
    gone?.geo.dispose();
    for (const w of gone?.windows ?? []) w.geo.dispose();
    cache.delete(oldest);
  }
  cache.set(key, out);
  return out;
}
