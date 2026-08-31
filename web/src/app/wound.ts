/**
 * What a hole in a hull actually looks like.
 *
 * The hull mesh is a SKIN. `hull.ts` emits a face only where a solid cell
 * meets the outside, greedily merged into big rectangles, and that is exactly
 * right for a ship nobody has shot yet. It leaves damage with two problems,
 * both of them visible from across the map:
 *
 * 1. A greedy quad is a rectangle of cells, and a whole plated flank is one of
 *    them. Collapsing it because a shot landed somewhere inside took the
 *    entire plate off for one hit.
 * 2. There are no interior faces at all, because no interior face ever met the
 *    outside. Take the skin away and there is nothing behind it: the eye goes
 *    straight through the ship and out the far side, which is why a damaged
 *    hull read as an empty shell rather than as a hull with a hole in it.
 *
 * So the torn edge is built here, from the cells rather than from the skin.
 * Two surfaces come out of it: the part of a partly hit plate that is STILL
 * THERE, drawn in the hull's own colours and lit like the rest of it, and the
 * inside the hit exposed, drawn unlit so it reads as still burning.
 *
 * All of it is the client's, like the carve it belongs to: nothing here is in
 * the state hash and nothing crosses the boundary. Two screens draw the same
 * wound because both are working from the same event stream, not because
 * either was told what it looks like.
 */

import * as THREE from 'three';
import { NX, NY, NZ, RUNG, frameFor, rasterise, type Design } from './design.js';
import type { HullMesh } from './hull.js';

/**
 * How long a fresh wound burns, in ticks. A turn is 600, so a hole opened this
 * turn is still glowing at the end of it and is char by the next one.
 */
export const COOL_TICKS = 900;

/**
 * The heat ramp, hottest first.
 *
 * Unlit colours, so these ARE the light coming off the wound rather than a
 * surface waiting to be lit. The last one is not black: a cold wound is still
 * a hole with a burnt edge, and pure black reads as a gap in the mesh, which
 * is the exact failure this file exists to fix.
 */
const HEAT: ReadonlyArray<readonly [number, number, number, number]> = [
  [1.00, 1.00, 0.86, 0.55],
  [0.72, 1.00, 0.62, 0.16],
  [0.42, 0.86, 0.20, 0.03],
  [0.18, 0.36, 0.07, 0.02],
  [0.00, 0.10, 0.08, 0.08],
];

/** Where a cell sits on that ramp, given how long ago it died. */
export function heatOf(diedAt: number, tick: number): number {
  return Math.max(0, Math.min(1, 1 - (tick - diedAt) / COOL_TICKS));
}

/**
 * How far the whole wound has cooled, quantised.
 *
 * The heat is a continuous function of the tick, so repainting whenever it
 * "changed" is repainting every frame: a walk over every torn vertex and a
 * colour buffer back to the card, per ship, sixty times a second, to move an
 * orange by a thousandth. The eye cannot see a step this small, so the repaint
 * waits until the step is real. Thirty two buckets over the whole burn is one
 * repaint every 28 ticks, and the ramp is smooth enough that they do not read
 * as steps.
 */
const HEAT_STEPS = 32;
export function heatKey(dead: ReadonlyMap<number, number>, tick: number): number {
  let hottest = 0;
  for (const diedAt of dead.values()) {
    const h = heatOf(diedAt, tick);
    if (h > hottest) hottest = h;
    if (hottest >= 1) break;
  }
  return Math.round(hottest * HEAT_STEPS);
}

function ramp(heat: number, out: [number, number, number]): void {
  for (let i = 1; i < HEAT.length; i++) {
    const hi = HEAT[i - 1] as readonly [number, number, number, number];
    const lo = HEAT[i] as readonly [number, number, number, number];
    if (heat > (lo[0] as number) || i === HEAT.length - 1) {
      const span = (hi[0] as number) - (lo[0] as number);
      const t = span > 0 ? Math.max(0, Math.min(1, (heat - (lo[0] as number)) / span)) : 0;
      out[0] = (lo[1] as number) + ((hi[1] as number) - (lo[1] as number)) * t;
      out[1] = (lo[2] as number) + ((hi[2] as number) - (lo[2] as number)) * t;
      out[2] = (lo[3] as number) + ((hi[3] as number) - (lo[3] as number)) * t;
      return;
    }
  }
}

/** One face of the exposed interior, and where smoke leaves it. */
export interface Vent {
  /** In the hull's own frame, on the face. */
  readonly x: number; readonly y: number; readonly z: number;
  /** Which way is out, so smoke leaves the hull rather than through it. */
  readonly nx: number; readonly ny: number; readonly nz: number;
  /** The dead cell it opened onto, which is what carries the heat. */
  readonly cell: number;
}

export interface Wound {
  /** The surviving cells of plates a hit only partly covered. Lit, hull paint. */
  readonly skin: THREE.BufferGeometry;
  /** The inside the hit opened. Unlit, and repainted as it cools. */
  readonly glow: THREE.BufferGeometry;
  /** Which dead cell each glow VERTEX belongs to, so cooling is a repaint
   *  rather than a rebuild. */
  readonly glowCell: Int32Array;
  /** Where smoke comes out, at most one per exposed face. */
  readonly vents: readonly Vent[];
  /** Which greedy quads are gone entirely, so the skin can collapse them. */
  readonly whole: Uint8Array;
}

/**
 * The ember atlas is 4 x 4 tiles, and a face picks one by a hash of its own
 * cell. One tile on every face of a wound reads as a repeating pattern rather
 * than as burning, and sixteen is enough that the eye stops finding the repeat.
 *
 * Inset by half a texel so the sampler cannot bleed a neighbouring tile in
 * along the seam, which shows as a bright rim on every face.
 */
const ATLAS = 4;
const ATLAS_STEP = 1 / ATLAS;
const ATLAS_PAD = 0.5 / (64 * ATLAS);

function tileUV(cell: number): readonly [number, number] {
  const h = Math.imul(cell ^ 0x9e3779b9, 2246822519) >>> 0;
  const t = h % (ATLAS * ATLAS);
  return [(t % ATLAS) * ATLAS_STEP, Math.floor(t / ATLAS) * ATLAS_STEP];
}

/** The four corners of a tile, in the corner order `faceCorners` emits. */
const CORNER_UV: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [1, 1], [0, 1],
];

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * The four corners of the face between a cell and the neighbour in direction
 * `d`, wound so the triangle faces along `d`.
 *
 * Same winding trap `hull.ts` fell into: u cross v points along the normal for
 * x and z, and against it for y, so a face built the same way on every axis
 * comes out backwards on the top and bottom and is culled.
 */
function faceCorners(
  i: number, j: number, k: number, d: readonly [number, number, number],
): ReadonlyArray<readonly [number, number, number]> {
  const [dx, dy, dz] = d;
  const x = i + (dx > 0 ? 1 : 0), y = j + (dy > 0 ? 1 : 0), z = k + (dz > 0 ? 1 : 0);
  if (dx !== 0) {
    return dx > 0
      ? [[x, y, z], [x, y + 1, z], [x, y + 1, z + 1], [x, y, z + 1]]
      : [[x, y, z], [x, y, z + 1], [x, y + 1, z + 1], [x, y + 1, z]];
  }
  if (dy !== 0) {
    return dy > 0
      ? [[x, y, z], [x, y, z + 1], [x + 1, y, z + 1], [x + 1, y, z]]
      : [[x, y, z], [x + 1, y, z], [x + 1, y, z + 1], [x, y, z + 1]];
  }
  return dz > 0
    ? [[x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z]]
    : [[x, y, z], [x, y + 1, z], [x + 1, y + 1, z], [x + 1, y, z]];
}

/**
 * Build the torn edges of one hull.
 *
 * Proportional to the DAMAGE, not to the ship: the interior walk visits the
 * dead cells and their neighbours, and the skin walk only rebuilds the quads a
 * hit actually reached into. An undamaged hull costs one pass over the quad
 * list and produces nothing.
 */
export function buildWound(
  hull: HullMesh, design: Design, dead: ReadonlyMap<number, number>, tick: number,
): Wound {
  const frame = frameFor(design.classKey);
  const cell = RUNG[frame.rung];
  const { grid } = rasterise(design);
  const idx = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;
  const solid = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ && !!grid[idx(i, j, k)];

  const whole = new Uint8Array(hull.quads);
  const sPos: number[] = [], sNrm: number[] = [], sCol: number[] = [];
  const gPos: number[] = [], gNrm: number[] = [], gCol: number[] = [], gUv: number[] = [];
  const glowCell: number[] = [];
  const vents: Vent[] = [];
  const rgb: [number, number, number] = [0, 0, 0];

  const world = (a: number, b: number, c: number, out: number[]) => {
    out.push((a - NX / 2) * cell, (b - NY / 2) * cell, (c - NZ / 2) * cell);
  };

  // ---- the plates a hit only partly took ----
  //
  // A greedy quad covers a rectangle of cells. If every one of them is dead
  // the quad is simply gone; if only some are, the quad has to come off AND
  // its survivors go back on one cell at a time, or the hit takes a whole
  // flank for a shot that reached six cells of it.
  const colAttr = hull.geo.getAttribute('color') as THREE.BufferAttribute;
  const nrmAttr = hull.geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let q = 0; q < hull.quads; q++) {
    const from = hull.quadAt[q] as number, to = hull.quadAt[q + 1] as number;
    let gone = 0;
    for (let n = from; n < to; n++) if (dead.has(hull.quadCells[n] as number)) gone++;
    if (!gone) continue;
    whole[q] = 1;
    if (gone === to - from) continue;

    const nx = nrmAttr.array[q * 12] as number;
    const ny = nrmAttr.array[q * 12 + 1] as number;
    const nz = nrmAttr.array[q * 12 + 2] as number;
    const r = colAttr.array[q * 12] as number;
    const g = colAttr.array[q * 12 + 1] as number;
    const b = colAttr.array[q * 12 + 2] as number;
    for (let n = from; n < to; n++) {
      const c = hull.quadCells[n] as number;
      if (dead.has(c)) continue;
      const i = c % NX, j = ((c / NX) | 0) % NY, k = (c / (NX * NY)) | 0;
      for (const [cx, cy, cz] of faceCorners(i, j, k, [nx, ny, nz] as const)) {
        world(cx, cy, cz, sPos);
        sNrm.push(nx, ny, nz);
        sCol.push(r, g, b);
      }
    }
  }

  // ---- the inside the hit opened ----
  //
  // Every face between a cell that is gone and one that is still there. This
  // is the surface that never existed before, because it never met the outside
  // and `hull.ts` only ever meshed what did.
  for (const [c, diedAt] of dead) {
    const i = c % NX, j = ((c / NX) | 0) % NY, k = (c / (NX * NY)) | 0;
    ramp(heatOf(diedAt, tick), rgb);
    for (const d of NEIGHBOURS) {
      const ni = i + (d[0] as number), nj = j + (d[1] as number), nk = k + (d[2] as number);
      if (!solid(ni, nj, nk)) continue;
      if (dead.has(idx(ni, nj, nk))) continue;
      // The face belongs to the LIVE neighbour and looks into the hole, so it
      // is built on that cell with the normal pointing back the way we came.
      const back = [-(d[0] as number), -(d[1] as number), -(d[2] as number)] as const;
      const [u0, v0] = tileUV(c);
      let cx = 0, cy = 0, cz = 0;
      let corner = 0;
      for (const [ax, ay, az] of faceCorners(ni, nj, nk, back)) {
        world(ax, ay, az, gPos);
        gNrm.push(back[0], back[1], back[2]);
        gCol.push(rgb[0], rgb[1], rgb[2]);
        const cu = CORNER_UV[corner] as readonly [number, number];
        gUv.push(
          u0 + ATLAS_PAD + (cu[0] as number) * (ATLAS_STEP - 2 * ATLAS_PAD),
          v0 + ATLAS_PAD + (cu[1] as number) * (ATLAS_STEP - 2 * ATLAS_PAD));
        glowCell.push(c);
        corner++;
        cx += ax; cy += ay; cz += az;
      }
      vents.push({
        x: (cx / 4 - NX / 2) * cell,
        y: (cy / 4 - NY / 2) * cell,
        z: (cz / 4 - NZ / 2) * cell,
        nx: -back[0], ny: -back[1], nz: -back[2],
        cell: c,
      });
    }
  }

  return {
    skin: quadGeometry(sPos, sNrm, sCol),
    glow: quadGeometry(gPos, gNrm, gCol, gUv),
    glowCell: new Int32Array(glowCell),
    vents,
    whole,
  };
}

/** Four vertices a quad, two indexed triangles, same as the hull's own. */
function quadGeometry(
  pos: number[], nrm: number[], col: number[], uv?: number[],
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const quads = pos.length / 12;
  const index = new Uint32Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    index[q * 6] = b; index[q * 6 + 1] = b + 1; index[q * 6 + 2] = b + 2;
    index[q * 6 + 3] = b; index[q * 6 + 4] = b + 2; index[q * 6 + 5] = b + 3;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Cool a wound without rebuilding it.
 *
 * The geometry only changes when a cell dies; the COLOUR changes every frame a
 * wound is burning, and rebuilding a mesh sixty times a second to fade an
 * orange would be the same mistake the envelope probe taught this client once.
 */
export function coolWound(w: Wound, dead: ReadonlyMap<number, number>, tick: number): void {
  const col = w.glow.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!col) return;
  const arr = col.array as Float32Array;
  const rgb: [number, number, number] = [0, 0, 0];
  let last = -1;
  for (let v = 0; v < w.glowCell.length; v++) {
    const c = w.glowCell[v] as number;
    if (c !== last) { ramp(heatOf(dead.get(c) ?? tick, tick), rgb); last = c; }
    arr[v * 3] = rgb[0];
    arr[v * 3 + 1] = rgb[1];
    arr[v * 3 + 2] = rgb[2];
  }
  col.needsUpdate = true;
}
