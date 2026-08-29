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
const { chartDir, contourLevels, fit, radiusAt, sliceLoop } =
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
  const pts = sliceLoop(f, 3, -7, 11, -1, 96);
  assert.ok(pts.length > 0, 'a plane through the middle must cut it');
  for (let i = 1; i < pts.length; i += 3) assert.equal(pts[i], -1);
});

test('a slice of a sphere is a circle of the right radius', () => {
  const f = fit(field(() => 20), NU, NV);
  // 6 above the centre through a sphere of radius 20: sqrt(400 - 36).
  const want = Math.sqrt(400 - 36);
  const pts = sliceLoop(f, 0, 0, 0, 6, 96);
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
  const pts = sliceLoop(f, 0, 0, 0, 2, 120);
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

test('a plane above the shape cuts nothing rather than inventing a ring', () => {
  const f = fit(field(() => 20), NU, NV);
  assert.equal(sliceLoop(f, 0, 0, 0, 25, 96).length, 0);
});

test('the working plane is a rung, and never drawn twice', () => {
  const levels = contourLevels(-20, 20, 3, 9, INTERVALS);
  assert.ok(levels.length > 0);
  for (const y of levels) {
    const k = (y - 3) / 5;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `${y} is not a whole rung above 3`);
    assert.notEqual(Math.round(k), 0, 'the plane draws its own level');
  }
});

test('moving the plane by one interval walks the ladder by one rung', () => {
  const a = contourLevels(-20, 20, 0, 9, INTERVALS);
  const b = contourLevels(-20, 20, 5, 9, INTERVALS);
  // Every rung of the first that still fits the shape appears in the second,
  // because both ladders are the same set of round heights.
  const shared = a.filter(y => b.some(z => Math.abs(z - y) < 1e-9));
  assert.ok(shared.length >= a.length - 2, `only ${shared.length} of ${a.length} carried over`);
});

test('the interval grows with the shape rather than the count', () => {
  const small = contourLevels(0, 40, 0, 9, INTERVALS);
  const big = contourLevels(0, 4000, 0, 9, INTERVALS);
  assert.ok(small.length <= 9 && big.length <= 9, 'a ladder must stay countable');
  assert.ok(big.length > 2, 'and must not collapse to nothing');
});

test('a shape with no height has no ladder', () => {
  assert.deepEqual(contourLevels(5, 5, 5, 9, INTERVALS), []);
});

test('the chart poles are the vertical axis', () => {
  assert.deepEqual(chartDir(0, 0).map(Math.round), [0, 1, 0]);
  assert.deepEqual(chartDir(0, 1).map(Math.round), [0, -1, 0]);
});
