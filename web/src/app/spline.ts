/**
 * The reachable boundary as a smooth closed surface.
 *
 * The marching build this replaces was honest and ugly: a grid of cells, so
 * the shell read as facets and its contours as steps, and it could be left
 * open where the surface met the wall of the probe box.
 *
 * Measured over 400 rays from the coast landing, 398 leave the set once and
 * never come back. So the boundary is a radius field over a rectangle almost
 * everywhere, r(theta, phi), which is exactly the domain a tensor product
 * surface needs. This fits an interpolating bicubic B spline to that field: a
 * NURBS with every weight left at one, closed by construction because a
 * spherical grid wraps in theta and pins at both poles.
 *
 * What it gives up is the other 0.5%. Where a ray does cross more than twice,
 * the set folds back on itself and no single radius can describe it, so the
 * fit bridges the fold. That happens under way, around the pocket a moving
 * hull leaves behind it.
 *
 * Accuracy was measured against fresh bisections at points the fit never saw:
 * 1.16 u rms at a 32 x 18 grid, 0.80 at 48 x 26, falling roughly in step with
 * the sample spacing. The surface is presentation and may approximate; the
 * picker keeps asking the core, so nothing drawn here can offer a player a
 * point the ship cannot reach.
 */

/** Direction for a point on the chart. Poles on world Y, which measured best
 * against X and Z. */
export function chartDir(u: number, v: number): [number, number, number] {
  const th = u * 2 * Math.PI;
  const ph = v * Math.PI;
  const sp = Math.sin(ph);
  return [sp * Math.cos(th), Math.cos(ph), sp * Math.sin(th)];
}

/** Solve a tridiagonal system in place. */
function solveTri(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = d.length;
  const cp = new Array<number>(n);
  const dp = new Array<number>(n);
  cp[0] = c[0]! / b[0]!;
  dp[0] = d[0]! / b[0]!;
  for (let i = 1; i < n; i++) {
    const m = b[i]! - a[i]! * cp[i - 1]!;
    cp[i] = c[i]! / m;
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / m;
  }
  const x = new Array<number>(n);
  x[n - 1] = dp[n - 1]!;
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!;
  return x;
}

/** The [1,4,1]/6 interpolation system, cyclic, so the seam in theta closes. */
function solveCyclic(y: readonly number[]): number[] {
  const n = y.length;
  if (n < 4) return [...y];
  const a = new Array<number>(n).fill(1 / 6);
  const b = new Array<number>(n).fill(4 / 6);
  const c = new Array<number>(n).fill(1 / 6);
  const alpha = 1 / 6, beta = 1 / 6, gamma = -b[0]!;
  const bb = [...b];
  bb[0] = b[0]! - gamma;
  bb[n - 1] = b[n - 1]! - (alpha * beta) / gamma;
  const u = new Array<number>(n).fill(0);
  u[0] = gamma;
  u[n - 1] = alpha;
  const x = solveTri(a, bb, c, [...y]);
  const z = solveTri(a, bb, c, u);
  const f = (x[0]! + (beta * x[n - 1]!) / gamma) / (1 + z[0]! + (beta * z[n - 1]!) / gamma);
  return x.map((val, i) => val - f * z[i]!);
}

/** The same system clamped, which pins the poles rather than wrapping them. */
function solveClamped(y: readonly number[]): number[] {
  const n = y.length;
  if (n < 3) return [...y];
  const a = new Array<number>(n).fill(1 / 6);
  const b = new Array<number>(n).fill(4 / 6);
  const c = new Array<number>(n).fill(1 / 6);
  a[0] = 0; b[0] = 1; c[0] = 0;
  a[n - 1] = 0; b[n - 1] = 1; c[n - 1] = 0;
  return solveTri(a, b, c, [...y]);
}

const basis = (t: number): [number, number, number, number] => {
  const t2 = t * t, t3 = t2 * t;
  return [
    (1 - 3 * t + 3 * t2 - t3) / 6,
    (4 - 6 * t2 + 3 * t3) / 6,
    (1 + 3 * t + 3 * t2 - 3 * t3) / 6,
    t3 / 6,
  ];
};

export interface Fitted {
  readonly nu: number;
  readonly nv: number;
  readonly ctrl: number[][];
}

/**
 * Fit control points so the spline passes THROUGH each sampled radius rather
 * than merely near it. `radii` is theta major, nu by nv.
 */
export function fit(radii: Float32Array | number[], nu: number, nv: number): Fitted {
  const grid: number[][] = [];
  for (let u = 0; u < nu; u++) {
    const col: number[] = [];
    for (let v = 0; v < nv; v++) col.push(radii[u * nv + v] ?? 0);
    grid.push(col);
  }
  // Every theta at a pole is the same direction, so those samples have to
  // agree exactly or the fit puts a dimple in the surface.
  for (const v of [0, nv - 1]) {
    let m = 0;
    for (let u = 0; u < nu; u++) m += grid[u]![v]!;
    m /= nu;
    for (let u = 0; u < nu; u++) grid[u]![v] = m;
  }
  const rows = grid.map(col => solveClamped(col));
  const ctrl: number[][] = [];
  for (let v = 0; v < nv; v++) {
    const solved = solveCyclic(rows.map(r => r[v]!));
    solved.forEach((val, u) => { (ctrl[u] ||= [])[v] = val; });
  }
  return { nu, nv, ctrl };
}

/** The fitted radius at a point on the chart. */
export function radiusAt(f: Fitted, u: number, v: number): number {
  const { nu, nv, ctrl } = f;
  const fu = u * nu;
  const iu = Math.floor(fu);
  const bu = basis(fu - iu);
  const fv = v * (nv - 3);
  const iv = Math.min(nv - 4, Math.max(0, Math.floor(fv)));
  const bv = basis(fv - iv);
  let r = 0;
  for (let a = 0; a < 4; a++) {
    const col = ctrl[(iu + a - 1 + nu * 2) % nu]!;
    for (let b = 0; b < 4; b++) {
      r += bu[a]! * bv[b]! * col[Math.min(nv - 1, Math.max(0, iv + b))]!;
    }
  }
  return r;
}

/**
 * Height of the surface point at (u, v), relative to the chart centre.
 */
const heightOf = (f: Fitted, u: number, v: number): number =>
  chartDir(u, v)[1] * Math.max(0, radiusAt(f, u, v));

/**
 * Every height at which one meridian crosses a plane, as x and z offsets.
 *
 * Taking only the first crossing was wrong at the ends of the shape, and
 * measurably so: the reachable set of a frigate at rest spans 19.38 units of
 * height but reaches only 14.43 straight up, so its top is DIMPLED, with the
 * highest ground on a ring rather than overhead. A plane laid through that
 * ring meets 17 of 96 meridians twice and the other 79 not at all, and taking
 * the first of the two drew one branch while dropping the other. The contour
 * came out as a stray open arc instead of the closed lens it is.
 *
 * So height is not monotone along a meridian and the walk cannot stop early.
 * It IS monotone over most of a shape, which is why one crossing stays the
 * usual answer and why carrying the rest costs nothing there.
 */
function crossings(f: Fitted, u: number, want: number): Array<[number, number]> {
  const COARSE = 32;
  const REFINE = 18;
  const out: Array<[number, number]> = [];
  let v0 = 0;
  let h0 = heightOf(f, u, 0) - want;
  for (let k = 1; k <= COARSE; k++) {
    const v1 = k / COARSE;
    const h1 = heightOf(f, u, v1) - want;
    if ((h0 > 0) !== (h1 > 0)) {
      let lo = v0;
      let hi = v1;
      for (let st = 0; st < REFINE; st++) {
        const mid = (lo + hi) / 2;
        if ((heightOf(f, u, mid) - want > 0) === (h0 > 0)) lo = mid;
        else hi = mid;
      }
      const vc = (lo + hi) / 2;
      const d = chartDir(u, vc);
      const r = Math.max(0, radiusAt(f, u, vc));
      out.push([d[0] * r, d[2] * r]);
    }
    v0 = v1;
    h0 = h1;
  }
  return out;
}

/**
 * Where a horizontal plane cuts the surface, as segments ready to draw.
 *
 * Walks the meridians rather than the plane, which is what makes the line
 * smooth. Cutting the tessellated triangles instead was geometrically correct
 * and looked wrong: where the plane runs nearly tangent to a flat face, a
 * wobble of one unit in the radius becomes an excursion of tens of units
 * across that face, so the contour wandered over the middle of the shape
 * instead of tracing its edge. A meridian walk cannot do that, because each
 * azimuth contributes points at that azimuth or none at all.
 *
 * A meridian can cross more than once, so adjacent azimuths are joined branch
 * by branch, both ordered from the top pole down. Where a neighbour runs out
 * of branches the curve has reached its own edge: an even number left over is
 * closed off in pairs, which is the chord across the tangency where those two
 * branches meet, and an odd one is left open rather than joined to something
 * it is not continuous with.
 *
 * `rays` is the resolution of the LINE and is independent of the sample grid,
 * because the surface is continuous: asking it for 120 points costs 120
 * evaluations and no flights at all.
 */
export function sliceLoop(
  f: Fitted, cx: number, cy: number, cz: number, y: number, rays: number,
): number[] {
  const found: Array<Array<[number, number]>> = [];
  for (let i = 0; i < rays; i++) found.push(crossings(f, i / rays, y - cy));
  const out: number[] = [];
  const seg = (p: [number, number], q: [number, number]) =>
    out.push(cx + p[0], y, cz + p[1], cx + q[0], y, cz + q[1]);
  for (let i = 0; i < rays; i++) {
    const here = found[i]!;
    const next = found[(i + 1) % rays]!;
    const shared = Math.min(here.length, next.length);
    for (let k = 0; k < shared; k++) seg(here[k]!, next[k]!);
    for (let k = shared; k + 1 < here.length; k += 2) seg(here[k]!, here[k + 1]!);
  }
  return out;
}

/**
 * The heights to cut contours at, registered to a reference plane.
 *
 * The rungs used to be even divisions of the shape's own extent, while the
 * working plane sat wherever the player had put it. Two ladders on one
 * surface, sharing no reference, so they lined up only by accident and the
 * bright line cut across the dim ones at an angle that meant nothing.
 *
 * Here the reference plane IS a rung and the rest step from it by a round
 * number of units, so the ladder reads as an altitude scale and moving the
 * plane walks it one rung at a time. `intervals` is searched smallest first
 * for one that keeps the count near `want`.
 *
 * The plane's own level is left out. The caller draws that curve separately
 * and brighter, because it is the one a click aims at, and drawing it twice
 * buys nothing but z fighting.
 */
export function contourLevels(
  ylo: number, yhi: number, planeY: number, want: number,
  intervals: readonly number[],
): number[] {
  const span = yhi - ylo;
  if (!(span > 0) || want < 1) return [];
  const step = intervals.find(i => span / i <= want) ?? span / want;
  const lo = Math.ceil((ylo - planeY) / step);
  const hi = Math.floor((yhi - planeY) / step);
  const out: number[] = [];
  for (let k = lo; k <= hi; k++) if (k !== 0) out.push(planeY + k * step);
  return out;
}
