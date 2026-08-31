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

/**
 * The fitted radius at a point on the chart.
 *
 * The two axes evaluate the same way, four controls centred on the span, which
 * they did not. Theta took `iu - 1 .. iu + 2` and phi took `iv .. iv + 3`: one
 * control out of step, over a range of `nv - 3` rather than `nv - 1`. So the
 * chart was shifted by a whole sample and squeezed by two. `radiusAt(f, u, 0)`
 * returned the SECOND row of samples and v = 1 returned the second to last, and
 * the surface never reached either pole. A field of constant radius hides that
 * completely, which is why a sphere fitted perfectly and the poles were still
 * wrong; measured on a radius rising 10 to 30 down the chart, the poles came
 * out 10.8 and 29.2.
 *
 * Phi is clamped rather than cyclic, so the two controls off each end are
 * mirrored, `2c0 - c1`. That is what makes the ends interpolate exactly:
 * plain clamping evaluates the first span as `(5c0 + c1) / 6` and misses.
 */
export function radiusAt(f: Fitted, u: number, v: number): number {
  const { nu, nv, ctrl } = f;
  const fu = u * nu;
  const iu = Math.floor(fu);
  const bu = basis(fu - iu);
  const fv = v * (nv - 1);
  const iv = Math.min(nv - 2, Math.max(0, Math.floor(fv)));
  const bv = basis(fv - iv);
  let r = 0;
  for (let a = 0; a < 4; a++) {
    const col = ctrl[(iu + a - 1 + nu * 2) % nu]!;
    for (let b = 0; b < 4; b++) {
      const j = iv + b - 1;
      const c = j < 0
        ? 2 * col[0]! - col[1]!
        : j > nv - 1
          ? 2 * col[nv - 1]! - col[nv - 2]!
          : col[j]!;
      r += bu[a]! * bv[b]! * c;
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
 * Radii at which one meridian crosses a plane, nearest the axis first.
 *
 * Taking only the first crossing was wrong at the ends of the shape, and
 * measurably so: the reachable set of a frigate at rest spans 23.08 units of
 * height but reaches only 14.43 straight up, because forward is the cheap
 * direction, so its top is DIMPLED and its highest ground lies on a ring. A
 * plane through that ring meets a meridian twice, and taking the first drew
 * one branch while dropping the other.
 *
 * Sorted by radius rather than left in the order the walk finds them. The walk
 * runs from the top pole down, which is outward for a cut above the centre and
 * INWARD for one below it, so the raw order flips halfway down the shape.
 */
function crossings(f: Fitted, u: number, want: number): number[] {
  const COARSE = 32;
  const REFINE = 18;
  const out: number[] = [];
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
      // The planar radius at this azimuth. The direction is known from u, so
      // the radius is the whole answer.
      out.push(Math.hypot(d[0] * r, d[2] * r));
    }
    v0 = v1;
    h0 = h1;
  }
  out.sort((p, q) => p - q);
  return out;
}

/**
 * A horizontal cut through the surface, as the AREA it encloses.
 *
 * Each azimuth carries the radial spans that are inside the shape at this
 * height, nearest the axis first. That is the whole cut: an outline is its
 * edges and a fill is the ground between them, so the two cannot disagree
 * about where the boundary is.
 *
 * The spans, not a list of boundary points, because the cut is not always a
 * disc. Above the shoulder of a dimpled shape the axis itself is outside the
 * set, and the section becomes a ring or a crescent. Pairing crossings off the
 * axis outward gets all three cases right with no special casing: what decides
 * it is whether the axis is inside, which is one comparison.
 */
export interface SliceCut {
  /** Per azimuth, inner and outer radius of each span. Empty where the plane
   * misses the shape entirely at that azimuth. */
  readonly spans: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  readonly rays: number;
}

export function sliceRegion(f: Fitted, cy: number, y: number, rays: number): SliceCut {
  const want = y - cy;
  // Straight up (or down) from the centre: inside, and the first crossing
  // closes a span that starts at the axis. Outside, and it opens one.
  const axis = Math.abs(want) <= Math.max(0, radiusAt(f, 0, want >= 0 ? 0 : 1));
  const spans: Array<Array<readonly [number, number]>> = [];
  for (let i = 0; i < rays; i++) {
    const cs = crossings(f, i / rays, want);
    const here: Array<readonly [number, number]> = [];
    let k = 0;
    if (axis && cs.length > 0) {
      here.push([0, cs[0]!]);
      k = 1;
    }
    // Whatever is left pairs off: in at one radius, out at the next. An odd
    // one over is a tangency the walk caught once, and closes nothing, so it
    // is dropped rather than paired with a boundary it does not belong to.
    for (; k + 1 < cs.length; k += 2) here.push([cs[k]!, cs[k + 1]!]);
    spans.push(here);
  }
  return { spans, rays };
}

/**
 * The edge of a cut, as segments ready to draw.
 *
 * Every span contributes its outer arc, its inner arc where it has one, and a
 * chord wherever the neighbouring azimuth has no matching span, which is where
 * the region ends and the two arcs meet. Closing only on the side that HAD the
 * extra span left a crescent sealed at one end and hanging open at the other.
 */
export function sliceOutline(
  cut: SliceCut, cx: number, cz: number, y: number,
): number[] {
  const { spans, rays } = cut;
  const out: number[] = [];
  const at = (i: number, r: number): [number, number] => {
    const th = (i / rays) * 2 * Math.PI;
    return [cx + Math.cos(th) * r, cz + Math.sin(th) * r];
  };
  const seg = (p: [number, number], q: [number, number]) =>
    out.push(p[0], y, p[1], q[0], y, q[1]);
  for (let i = 0; i < rays; i++) {
    const here = spans[i]!;
    const next = spans[(i + 1) % rays]!;
    const shared = Math.min(here.length, next.length);
    for (let k = 0; k < shared; k++) {
      const a = here[k]!;
      const b = next[k]!;
      seg(at(i, a[1]), at(i + 1, b[1]));
      // A span that starts at the axis has no inner edge to trace.
      if (a[0] > 1e-6 || b[0] > 1e-6) seg(at(i, a[0]), at(i + 1, b[0]));
    }
    // Close whichever side runs on alone, so both ends of an arc are sealed.
    const solo = here.length > next.length ? here : next;
    const where = here.length > next.length ? i : i + 1;
    for (let k = shared; k < solo.length; k++) {
      const sp = solo[k]!;
      seg(at(where, sp[0]), at(where, sp[1]));
    }
  }
  return out;
}

/**
 * The ground a cut covers, as triangles at exactly one height.
 *
 * Every vertex takes `y` verbatim rather than anything derived from the
 * surface, so the filled area cannot drift off the elevation it claims to be
 * a section of. Its outline comes from the same spans, so the fill and the
 * bright edge around it are one thing measured once.
 */
export function sliceFill(
  cut: SliceCut, cx: number, cz: number, y: number,
): number[] {
  const { spans, rays } = cut;
  const out: number[] = [];
  const at = (i: number, r: number): [number, number] => {
    const th = (i / rays) * 2 * Math.PI;
    return [cx + Math.cos(th) * r, cz + Math.sin(th) * r];
  };
  const tri = (p: [number, number], q: [number, number], r: [number, number]) =>
    out.push(p[0], y, p[1], q[0], y, q[1], r[0], y, r[1]);
  for (let i = 0; i < rays; i++) {
    const here = spans[i]!;
    const next = spans[(i + 1) % rays]!;
    for (let k = 0; k < Math.min(here.length, next.length); k++) {
      const a = here[k]!;
      const b = next[k]!;
      const ai = at(i, a[0]);
      const ao = at(i, a[1]);
      const bi = at(i + 1, b[0]);
      const bo = at(i + 1, b[1]);
      tri(ai, ao, bo);
      tri(ai, bo, bi);
    }
  }
  return out;
}

/**
 * The heights to cut contours at.
 *
 * Anchored to `baseY`, which is the ship's own height, so the rungs are a
 * fixed scale: raising the working plane walks UP the ladder instead of
 * dragging it along. An earlier version anchored them to the plane itself so
 * that it was always a rung, and the cost was that every line on the shape
 * moved whenever the elevation did, when only one of them is the elevation.
 *
 * `skipY` is dropped, because the caller draws that level brighter as the cut
 * the player is aiming with and drawing it twice buys nothing but z fighting.
 * With the plane at a whole number of intervals it lands exactly on a rung,
 * which is the rung that gets skipped.
 *
 * `intervals` is searched smallest first for one that keeps the count near
 * `want`, so the spacing is a round number of units rather than an arbitrary
 * fraction of however tall this shape happens to be.
 */
export function contourLevels(
  ylo: number, yhi: number, baseY: number, skipY: number, want: number,
  intervals: readonly number[],
): number[] {
  const span = yhi - ylo;
  if (!(span > 0) || want < 1) return [];
  const step = intervals.find(i => span / i <= want) ?? span / want;
  const lo = Math.ceil((ylo - baseY) / step);
  const hi = Math.floor((yhi - baseY) / step);
  const out: number[] = [];
  for (let k = lo; k <= hi; k++) {
    const y = baseY + k * step;
    if (Math.abs(y - skipY) > step * 1e-3) out.push(y);
  }
  return out;
}

/** Which ray of a cut a planar offset falls on, and how far out it sits. */
function bearing(cut: SliceCut, dx: number, dz: number): { i: number; rho: number } {
  let th = Math.atan2(dz, dx) / (2 * Math.PI);
  if (th < 0) th += 1;
  return { i: Math.round(th * cut.rays) % cut.rays, rho: Math.hypot(dx, dz) };
}

/** Is this planar offset from the cut's centre inside the area it covers? */
export function sliceHolds(cut: SliceCut, dx: number, dz: number): boolean {
  const { i, rho } = bearing(cut, dx, dz);
  return (cut.spans[i] ?? []).some(([lo, hi]) => rho >= lo && rho <= hi);
}

/**
 * The nearest offset inside the area, as x and z from the centre.
 *
 * Landing exactly ON a span edge is not good enough: the caller stores the
 * point, and asking whether that stored point is inside runs the radius back
 * through a sin, a cos and a hypot, which can return it a hair outside the
 * edge it was placed on. So a clamp settles just inside, by a thousandth of a
 * unit or half the span where the span is thinner than that.
 *
 * Null when nothing is within reach of this bearing at all, which the caller
 * reads as "leave the plan alone".
 */
export function sliceClamp(
  cut: SliceCut, dx: number, dz: number,
): { dx: number; dz: number } | null {
  const { i, rho } = bearing(cut, dx, dz);
  const settle = (lo: number, hi: number, to: number): number => {
    const inset = Math.min(1e-3, (hi - lo) / 2);
    return to <= lo ? lo + inset : hi - inset;
  };
  const nearestIn = (spans: ReadonlyArray<readonly [number, number]>): number | null => {
    let best: number | null = null;
    for (const [lo, hi] of spans) {
      if (rho >= lo && rho <= hi) return rho;
      const edge = settle(lo, hi, rho);
      if (best === null || Math.abs(edge - rho) < Math.abs(best - rho)) best = edge;
    }
    return best;
  };
  const out = (k: number, r: number) => {
    const th = (k / cut.rays) * 2 * Math.PI;
    return { dx: Math.cos(th) * r, dz: Math.sin(th) * r };
  };
  // Already inside: hand it back untouched. Rebuilding it from the nearest ray
  // would snap a free drag onto one of `rays` bearings, and quantising the
  // whole interior to hold the edge steady is the wrong trade.
  if ((cut.spans[i] ?? []).some(([lo, hi]) => rho >= lo && rho <= hi)) return { dx, dz };
  const here = nearestIn(cut.spans[i] ?? []);
  if (here !== null) return out(i, here);
  // Nothing on this bearing: take the closest one that has something, so the
  // marker slides round the edge of the area rather than stopping dead.
  for (let step = 1; step <= cut.rays / 2; step++) {
    for (const j of [i + step, i - step]) {
      const k = ((j % cut.rays) + cut.rays) % cut.rays;
      const r = nearestIn(cut.spans[k] ?? []);
      if (r !== null) return out(k, r);
    }
  }
  return null;
}
