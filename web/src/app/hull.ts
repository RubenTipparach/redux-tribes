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
  NX, NY, NZ, RUNG, Mat,
  armourColour, cellColour, frameFor, rasterise, rasterSig,
  type Design,
} from './design.js';

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
  /** Half extents in ship units, about the hull's own centre. */
  readonly half: readonly [number, number, number];
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
  const { grid, purp } = rasterise(d);
  const idx = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

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
          }
          cellOf.push(owner[u + v * uN] as number);
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

  const out: HullMesh = {
    geo,
    cell,
    cellOf: new Int32Array(cellOf),
    centre,
    quads,
    half: [
      Math.max(1, hiX - loX + 1) * cell / 2,
      Math.max(1, hiY - loY + 1) * cell / 2,
      Math.max(1, hiZ - loZ + 1) * cell / 2,
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
