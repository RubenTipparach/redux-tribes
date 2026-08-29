// The fitted boundary, and the lines cut from it.
//
// Every line the console draws on the reachable set now comes from one
// surface: the skin, the nine contour rungs, and the bright one on the working
// plane. These assert the properties that made that worth doing, because the
// defects they cover were all invisible to the model suites and visible only
// on screen: a contour that wandered across a face, a bright line from a
// coarser second model, and a ladder that shared no reference with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const out = await build({
  entryPoints: [resolve(root, 'src/app/spline.ts')],
  bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
});
const { chartDir, contourLevels, fit, radiusAt, sliceFill, sliceOutline, sliceRegion } =
  await import('data:text/javascript;base64,' +
    Buffer.from(out.outputFiles[0].text).toString('base64'));

const NU = 48;
const NV = 26;

/** A radius field, theta major, from a function of the chart. */
const field = (f) => {
  const r = new Float32Array(NU * NV);
  for (let u = 0; u < NU; u++) {
    for (let v = 0; v < NV; v++) r[u * NV + v] = f(u / NU, v / (NV - 1));
  }
  return r;
};

const INTERVALS = [5, 10, 20, 25, 50, 100, 200, 500];

/** The outline of a cut, as the view draws it. */
const outline = (f, cx, cy, cz, y, rays) =>
  sliceOutline(sliceRegion(f, cy, y, rays), cx, cz, y);
/** The ground a cut covers. */
const fillOf = (f, cx, cy, cz, y, rays) =>
  sliceFill(sliceRegion(f, cy, y, rays), cx, cz, y);

/**
 * Does every endpoint in a set of segments have a partner? A closed loop
 * visits each of its points exactly twice, once arriving and once leaving, so
 * an odd count is a loose end. This is the property the eye was reading as
 * "the slice line is not a closed loop".
 */
function looseEnds(pts, tol = 1e-6) {
  const seen = [];
  for (let i = 0; i < pts.length; i += 3) {
    const p = [pts[i], pts[i + 1], pts[i + 2]];
    const hit = seen.find(q => Math.abs(q.p[0] - p[0]) < tol
      && Math.abs(q.p[1] - p[1]) < tol && Math.abs(q.p[2] - p[2]) < tol);
    if (hit) hit.n++;
    else seen.push({ p, n: 1 });
  }
  return seen.filter(q => q.n % 2 === 1).length;
}

test('a sphere fits to its own radius everywhere, not just at the samples', () => {
  const f = fit(field(() => 20), NU, NV);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const u = (i * 0.377) % 1;
    const v = (i * 0.191) % 1;
    worst = Math.max(worst, Math.abs(radiusAt(f, u, v) - 20));
  }
  assert.ok(worst < 1e-3, `interpolation is off by ${worst}`);
});

test('a slice sits at the height it was asked for', () => {
  const f = fit(field(() => 20), NU, NV);
  const pts = outline(f, 3, -7, 11, -1, 96);
  assert.ok(pts.length > 0, 'a plane through the middle must cut it');
  for (let i = 1; i < pts.length; i += 3) assert.equal(pts[i], -1);
});

test('a slice of a sphere is a circle of the right radius', () => {
  const f = fit(field(() => 20), NU, NV);
  // 6 above the centre through a sphere of radius 20: sqrt(400 - 36).
  const want = Math.sqrt(400 - 36);
  const pts = outline(f, 0, 0, 0, 6, 96);
  let worst = 0;
  for (let i = 0; i < pts.length; i += 3) {
    worst = Math.max(worst, Math.abs(Math.hypot(pts[i], pts[i + 2]) - want));
  }
  assert.ok(worst < 0.05, `off the circle by ${worst}`);
});

test('a slice follows the surface it was cut from', () => {
  // Lumpy on purpose: a constant radius would pass even if the cut ignored
  // the fit entirely.
  const f = fit(field((u, v) => 20 + 5 * Math.sin(6 * Math.PI * u) * Math.sin(Math.PI * v)),
    NU, NV);
  const pts = outline(f, 0, 0, 0, 2, 120);
  let worst = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const p = [pts[i], pts[i + 1], pts[i + 2]];
    const r = Math.hypot(p[0], p[1], p[2]);
    // Recover the chart coordinates of this point and ask the fit directly.
    const v = Math.acos(Math.max(-1, Math.min(1, p[1] / r))) / Math.PI;
    let u = Math.atan2(p[2], p[0]) / (2 * Math.PI);
    if (u < 0) u += 1;
    worst = Math.max(worst, Math.abs(r - radiusAt(f, u, v)));
  }
  assert.ok(worst < 0.05, `a cut point sits ${worst} off the surface`);
});

test('a dimpled top cuts as two branches, not one', () => {
  // The real reachable set is flatter than a sphere and dips in the middle of
  // its top face, so its highest ground is a ring rather than a point. A plane
  // through that ring meets each meridian TWICE, and a cutter that stopped at
  // the first crossing drew one branch and dropped the other.
  const f = fit(field((u, v) => {
    const h = Math.cos(Math.PI * v);
    return 20 - 14 * h * h;         // short at both poles, wide at the equator
  }), NU, NV);
  const top = Math.max(...Array.from({ length: 401 }, (_, j) => {
    const v = j / 400;
    return Math.cos(Math.PI * v) * radiusAt(f, 0, v);
  }));
  const overhead = radiusAt(f, 0, 0);
  assert.ok(top > overhead + 1, `not dimpled: top ${top} against overhead ${overhead}`);

  const pts = outline(f, 0, 0, 0, (top + overhead) / 2, 96);
  assert.ok(pts.length > 0, 'a plane through the ring must cut something');
  // Two branches means two distinct radii at any azimuth the plane reaches.
  const radii = [];
  for (let i = 0; i < pts.length; i += 3) radii.push(Math.hypot(pts[i], pts[i + 2]));
  const lo = Math.min(...radii);
  const hi = Math.max(...radii);
  assert.ok(hi - lo > 1, `only one branch drawn: radii span ${lo} to ${hi}`);
});

test('a plane above the shape cuts nothing rather than inventing a ring', () => {
  const f = fit(field(() => 20), NU, NV);
  assert.equal(outline(f, 0, 0, 0, 25, 96).length, 0);
});

test('the working plane is a rung, and never drawn twice', () => {
  const levels = contourLevels(-20, 20, 0, 3, 9, INTERVALS);
  assert.ok(levels.length > 0);
  for (const y of levels) {
    const k = y / 5;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `${y} is not a whole rung above the base`);
    assert.notEqual(y, 3, 'the plane draws its own level');
  }
});

test('the ladder does not move when the working plane does', () => {
  // The rungs are a fixed scale anchored to the ship, so raising the plane
  // walks up them. Anchoring them to the plane instead dragged every line on
  // the shape along with the one line that IS the elevation.
  const a = contourLevels(-20, 20, 0, 99, 9, INTERVALS);
  const b = contourLevels(-20, 20, 0, 98, 9, INTERVALS);
  assert.deepEqual(a, b);
  // And the rung the plane sits on is the only one it takes away.
  const c = contourLevels(-20, 20, 0, 5, 9, INTERVALS);
  assert.deepEqual(c, a.filter(y => y !== 5));
});

test('moving the plane by one interval walks the ladder by one rung', () => {
  const a = contourLevels(-20, 20, 0, 99, 9, INTERVALS);
  const b = contourLevels(-20, 20, 5, 99, 9, INTERVALS);
  // Every rung of the first that still fits the shape appears in the second,
  // because both ladders are the same set of round heights.
  const shared = a.filter(y => b.some(z => Math.abs(z - y) < 1e-9));
  assert.ok(shared.length >= a.length - 2, `only ${shared.length} of ${a.length} carried over`);
});

test('the interval grows with the shape rather than the count', () => {
  const small = contourLevels(0, 40, 0, 999, 9, INTERVALS);
  const big = contourLevels(0, 4000, 0, 99999, 9, INTERVALS);
  assert.ok(small.length <= 9 && big.length <= 9, 'a ladder must stay countable');
  assert.ok(big.length > 2, 'and must not collapse to nothing');
});

test('a shape with no height has no ladder', () => {
  assert.deepEqual(contourLevels(5, 5, 5, 99, 9, INTERVALS), []);
});

test('the chart poles are the vertical axis', () => {
  assert.deepEqual(chartDir(0, 0).map(Math.round), [0, 1, 0]);
  assert.deepEqual(chartDir(0, 1).map(Math.round), [0, -1, 0]);
});

test('every cut closes, at every height through the shape', () => {
  // A shape symmetric in theta, so every azimuth carries the same spans and the
  // region never ends sideways. This pins the ordinary case; the lopsided test
  // below is the one that catches the loose end.
  const f = fit(field((u, v) => {
    const h = Math.cos(Math.PI * v);
    return 20 - 14 * h * h;
  }), NU, NV);
  let hi = -Infinity;
  for (let j = 0; j <= 400; j++) {
    hi = Math.max(hi, Math.cos(Math.PI * (j / 400)) * radiusAt(f, 0, j / 400));
  }
  for (let k = 1; k < 40; k++) {
    const y = -hi + (2 * hi * k) / 40;
    const pts = outline(f, 0, 0, 0, y, 96);
    assert.ok(pts.length > 0, `nothing cut at ${y}`);
    assert.equal(looseEnds(pts), 0, `${looseEnds(pts)} loose ends at height ${y}`);
  }
});

test('a lopsided shape still closes, including where it runs out sideways', () => {
  // The complaint that started this: the slice line was not a closed loop. A
  // region that ends at an AZIMUTH has two ends, and the old rule closed only
  // the one where that azimuth itself carried the extra span, leaving the other
  // hanging. Measured on this shape: 2 loose ends under the old rule, 0 now.
  // The symmetric case above cannot show it, because it never ends sideways.
  const f = fit(field((u, v) => {
    const h = Math.cos(Math.PI * v);
    return 20 - 13 * h * h + 6 * Math.cos(2 * Math.PI * u);
  }), NU, NV);
  for (let k = 1; k < 30; k++) {
    const y = -14 + (28 * k) / 30;
    const pts = outline(f, 0, 0, 0, y, 96);
    if (pts.length === 0) continue;
    assert.equal(looseEnds(pts), 0, `loose ends at height ${y}`);
  }
});

test('the fill sits at exactly one elevation and never deviates', () => {
  const f = fit(field((u, v) => 20 + 4 * Math.sin(4 * Math.PI * u)), NU, NV);
  for (const y of [-9, -3, 0, 4.25, 11.5]) {
    const tris = fillOf(f, 3, -7, 11, y, 96);
    assert.ok(tris.length > 0, `nothing filled at ${y}`);
    for (let i = 1; i < tris.length; i += 3) {
      assert.equal(tris[i], y, `a fill vertex sat at ${tris[i]}, not ${y}`);
    }
  }
});

test('the fill stays inside its own outline', () => {
  // Both come off one set of spans, so the widest point of the fill at any
  // azimuth is a point ON the edge, never past it.
  const f = fit(field((u, v) => 20 + 5 * Math.sin(3 * Math.PI * u)), NU, NV);
  const y = 6;
  const cut = sliceRegion(f, 0, y, 96);
  const tris = sliceFill(cut, 0, 0, y);
  const pts = sliceOutline(cut, 0, 0, y);
  let fillMax = 0;
  for (let i = 0; i < tris.length; i += 3) fillMax = Math.max(fillMax, Math.hypot(tris[i], tris[i + 2]));
  let edgeMax = 0;
  for (let i = 0; i < pts.length; i += 3) edgeMax = Math.max(edgeMax, Math.hypot(pts[i], pts[i + 2]));
  assert.ok(fillMax <= edgeMax + 1e-9, `fill reaches ${fillMax}, outline only ${edgeMax}`);
});

test('an annulus fills as a ring, with the hole left open', () => {
  // Above the shoulder of a dimpled shape the axis is outside the set, so the
  // section is a ring. A fill that assumed a disc would paint over the hole.
  const f = fit(field((u, v) => {
    const h = Math.cos(Math.PI * v);
    return 20 - 14 * h * h;
  }), NU, NV);
  const overhead = radiusAt(f, 0, 0);
  const y = overhead + 1.2;
  const cut = sliceRegion(f, 0, y, 96);
  assert.ok(cut.spans.every(sp => sp.length === 1), 'expected one span per azimuth');
  assert.ok(cut.spans.every(sp => sp[0][0] > 0.5),
    'the inner edge should stand off the axis, leaving a hole');
  const tris = sliceFill(cut, 0, 0, y);
  let nearest = Infinity;
  for (let i = 0; i < tris.length; i += 3) nearest = Math.min(nearest, Math.hypot(tris[i], tris[i + 2]));
  assert.ok(nearest > 0.5, `the fill reached ${nearest} from the axis, filling the hole`);
});
