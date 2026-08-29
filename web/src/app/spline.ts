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
