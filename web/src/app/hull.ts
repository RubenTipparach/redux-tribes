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
 * four of those took a headless frame from 22 fps to 2.2. What can actually be
 * seen is the faces between a solid cell and the space outside, which is 2536
 * quads and 5072 triangles for the same hull, eleven times less. The interior
 * is not drawn at all, because on a battlefield nothing looks inside a hull.
 *
 * Outside is a flood fill from the edge of the lattice rather than "any empty
 * neighbour": a frigate is full of gaps between its frame and its parts, and
 * counting those as visible drew most of the ship twice over.
 *
 * The editor draws the same cells its own way, through an instanced mesh it
 * can pick single cells out of and ghost the plate on. Two renderers, two sets
 * of needs; what they share is the thing that has to agree, which is what
 * colour a cell is (`cellColour` and `armourColour` in design.ts).
 */

import * as THREE from 'three';
import {
  CELLS, NX, NY, NZ, RUNG, Mat,
  armourColour, cellColour, frameFor, moduleById, rasterise, rasterSig, socketsOf,
  type Design,
} from './design.js';

/**
 * One gun on a hull, as the map needs it: where it turns and which quads turn
 * with it.
 *
 * In `mountsOf` order, which is the core's weapon index, so rig `n` is the
 * mount the resolver calls `n` and the arc mask `arcMasks(d)[n]` describes.
 * Three lists in the same order rather than three lookups.
 */
export interface HullRig {
  /** The weapon key, for naming it. */
  readonly key: string;
  /** Which placement it is, so a pick can name the part. */
  readonly part: number;
  /** The socket it turns on, in ship units. */
  readonly pivot: readonly [number, number, number];
  /** The rest facing the design gave it, in radians about the up axis. */
  readonly rest: number;
}

export interface HullMesh {
  readonly geo: THREE.BufferGeometry;
  /** The world size of one cell for this hull's class. */
  readonly cell: number;
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
export function tintHull(
  mat: THREE.MeshLambertMaterial, tone: number, destroyed: boolean, far: number,
): void {
  mat.color.setHex(0xffffff).lerp(new THREE.Color(tone), tintMix(destroyed, far));
  mat.emissive.setHex(destroyed ? 0x000000 : tone).multiplyScalar(GLOW_FAR * far);
  mat.needsUpdate = true;
}

const cache = new Map<string, HullMesh>();
/** Four ships out of a handful of designs, and a cap so editing between
 *  matches all session cannot grow this without bound. */
const CACHE_MAX = 12;

export function hullMesh(d: Design): HullMesh {
  const key = rasterSig(d) + '|' + d.faction + '|' + d.paint;
  const hit = cache.get(key);
  if (hit) return hit;

  const frame = frameFor(d.classKey);
  const cell = RUNG[frame.rung];
  const { grid, purp, own } = rasterise(d);
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
      rest: -(p.rot ?? 0) * Math.PI / 2,
    });
  });

  // What the outside can reach: a flood fill through empty cells from the
  // boundary of the lattice. "Any empty neighbour" is not the same question: a
  // frigate is full of gaps between its frame and its parts, and counting
  // those as visible drew most of the ship twice over.
  const outside = new Uint8Array(NX * NY * NZ);
  const queue: number[] = [];
  const reach = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return;
    const n = idx(i, j, k);
    if (outside[n] || grid[n]) return;
    outside[n] = 1;
    queue.push(i, j, k);
  };
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) { reach(0, j, k); reach(NX - 1, j, k); }
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { reach(i, 0, k); reach(i, NY - 1, k); }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { reach(i, j, 0); reach(i, j, NZ - 1); }
  for (let h = 0; h < queue.length; h += 3) {
    const i = queue[h] as number, j = queue[h + 1] as number, k = queue[h + 2] as number;
    reach(i - 1, j, k); reach(i + 1, j, k);
    reach(i, j - 1, k); reach(i, j + 1, k);
    reach(i, j, k - 1); reach(i, j, k + 1);
  }
  const open = (i: number, j: number, k: number) =>
    (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) ? 1 : outside[idx(i, j, k)];

  /** A cell's colour, which is what decides whether two faces may merge. */
  const colourAt = (i: number, j: number, k: number): number => {
    const n = idx(i, j, k);
    const mat = grid[n] as number;
    return mat === Mat.Plate || mat === Mat.Skinned
      ? armourColour(d.paint)
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

  const at = [0, 0, 0];
  for (const dir of DIRS) {
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
        put(at, axis, u, v, w + dir.step);
        if (!open(at[0] as number, at[1] as number, at[2] as number)) continue;
        mask[u + v * uN] = colourAt(i, j, k);
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
          c.setHex(hex);
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

  // Two triangles a quad, indexed, so the four corners are shared.
  const quads = cellOf.length;
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    index[q * 6] = b; index[q * 6 + 1] = b + 1; index[q * 6 + 2] = b + 2;
    index[q * 6 + 3] = b; index[q * 6 + 4] = b + 2; index[q * 6 + 5] = b + 3;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();

  const centre = new Float32Array(quads * 3);
  for (let q = 0; q < quads; q++) {
    const n = cellOf[q] as number;
    const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
    centre[q * 3] = (i - NX / 2 + 0.5) * cell;
    centre[q * 3 + 1] = (j - NY / 2 + 0.5) * cell;
    centre[q * 3 + 2] = (k - NZ / 2 + 0.5) * cell;
  }

  const rigOf = new Int32Array(quads);
  for (let q = 0; q < quads; q++) {
    const owner = own[cellOf[q] as number] as number;
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

  const out: HullMesh = {
    geo,
    cell,
    rigOf,
    rigs,
    rigOfCell,
    rigCells: rigCells.map(v => new Int32Array(v)),
    cellOf: new Int32Array(cellOf),
    centre,
    quads,
    quadCells: new Int32Array(quadCells),
    quadAt: new Uint32Array(quadAt),
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
    cache.get(oldest)?.geo.dispose();
    cache.delete(oldest);
  }
  cache.set(key, out);
  return out;
}
