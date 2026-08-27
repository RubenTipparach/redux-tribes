// End to end across the boundary: the Rust core, compiled to wasm, driven
// through the TypeScript client API. Asserts the same PROPERTIES the Rust
// suite does, so a break anywhere in the chain (model, ABI, slot layout, TS
// wrapper) fails here rather than silently in the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// bundle the TS client into memory and import it, so the test exercises the
// real module rather than a hand written copy of it
const out = await build({
  entryPoints: [resolve(root, 'src/sim/wasm.ts')],
  bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
});
const mod = await import('data:text/javascript;base64,' +
  Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Sim } = mod;

const wasm = readFileSync(resolve(root, 'public/sim_core.wasm'));
const sim = await Sim.load(wasm);

const Mode = { MoveAndTurn: 0, TurnSlide: 1, FullSpeed: 2, FullStop: 3, Drift: 4 };
const FLIGHT = { yawRate: 6, pitchRate: 4, accelFwd: 0.9, accelRetro: 0.35, accelLat: 0.25, maxSpeed: 8 };
const body = (vel = { x: 0, y: 0, z: 0 }) => ({
  pos: { x: 0, y: 0, z: 0 }, vel, quat: { x: 0, y: 0, z: 0, w: 1 },
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const reach = (dir, mode = Mode.MoveAndTurn, face) => {
  const l = Math.hypot(dir.x, dir.y, dir.z);
  const t = { x: dir.x / l * 400, y: dir.y / l * 400, z: dir.z / l * 400 };
  const f = sim.flyTurn(body(), FLIGHT, face ? { mode, target: t, face } : { mode, target: t });
  return dist(f.endPos, { x: 0, y: 0, z: 0 });
};

test('the boundary returns a plausible flight', () => {
  const f = sim.flyTurn(body(), FLIGHT, { mode: Mode.MoveAndTurn, target: { x: 0, y: 0, z: 60 } });
  assert.ok(f.path.length > 8, `expected a sampled path, got ${f.path.length}`);
  assert.equal(f.committed, false);
  assert.ok(f.endPos.z > 30, `should have travelled, ended at z=${f.endPos.z}`);
  assert.ok(Math.abs(Math.hypot(f.endQuat.x, f.endQuat.y, f.endQuat.z, f.endQuat.w) - 1) < 1e-3,
    'end orientation should stay normalised');
});

test('forward beats reversing (local axis thrust limits)', () => {
  const fwd = reach({ x: 0, y: 0, z: 1 });
  const aft = reach({ x: 0, y: 0, z: -1 });
  assert.ok(fwd > aft * 1.5, `forward ${fwd.toFixed(1)} vs aft ${aft.toFixed(1)}`);
});

test('slower pitch makes vertical worse than lateral (rotation stats)', () => {
  const lat = reach({ x: 1, y: 0, z: 0 });
  const up = reach({ x: 0, y: 1, z: 0 });
  assert.ok(lat > up * 1.3, `lateral ${lat.toFixed(1)} vs vertical ${up.toFixed(1)}`);
});

test('carried velocity commits you', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.ok(sim.canReach(body(), FLIGHT, { mode: Mode.MoveAndTurn }, origin, 2),
    'a ship at rest can hold station');
  assert.ok(!sim.canReach(body({ x: 0, y: 0, z: 6 }), FLIGHT, { mode: Mode.MoveAndTurn }, origin, 2),
    'a ship under way cannot hold station');
});

test('committed modes report themselves', () => {
  for (const mode of [Mode.FullSpeed, Mode.FullStop, Mode.Drift]) {
    assert.equal(sim.flyTurn(body({ x: 0, y: 0, z: 5 }), FLIGHT, { mode }).committed, true);
  }
  assert.equal(sim.flyTurn(body(), FLIGHT, { mode: Mode.MoveAndTurn }).committed, false);
});

test('rotation is rate limited, and raising the rate lifts the cap', () => {
  const wantDeg = 150, r = wantDeg * Math.PI / 180;
  const face = { x: Math.sin(r), y: 0, z: Math.cos(r) };
  const bearingAt = (yawRate) => {
    const f = sim.flyTurn(body(), { ...FLIGHT, yawRate }, { mode: Mode.TurnSlide, face });
    const q = f.endQuat;
    // forward = quat * (0,0,1)
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, fz) * 180 / Math.PI;
  };
  assert.ok(Math.abs(bearingAt(6) - 60) < 1.5, `6 deg/s should cap at 60, got ${bearingAt(6).toFixed(1)}`);
  assert.ok(Math.abs(bearingAt(12) - 120) < 1.5, `12 deg/s should cap at 120, got ${bearingAt(12).toFixed(1)}`);
  assert.ok(Math.abs(bearingAt(25) - 150) < 1.5, `25 deg/s should reach 150, got ${bearingAt(25).toFixed(1)}`);
});

test('the grid probe agrees with single probes', () => {
  const b = body({ x: 0, y: 0, z: 4 });
  const order = { mode: Mode.MoveAndTurn };
  const centre = { x: 0, y: 0, z: 40 };
  const N = 8, half = 50, eps = 6;
  const grid = sim.reachGrid(b, FLIGHT, order, centre, half, N, eps);
  const step = (2 * half) / N;
  let checked = 0, agreed = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        const p = {
          x: centre.x - half + (i + 0.5) * step,
          y: centre.y - half + (j + 0.5) * step,
          z: centre.z - half + (k + 0.5) * step,
        };
        const one = sim.canReach(b, FLIGHT, order, p, eps);
        if (one === grid.at(i, j, k)) agreed++;
        checked++;
      }
    }
  }
  assert.equal(agreed, checked, `grid and single probes disagreed on ${checked - agreed} of ${checked} cells`);
  assert.ok(grid.hits > 0 && grid.hits < N * N * N,
    `envelope should be a proper subset of the box, got ${grid.hits}/${N ** 3}`);
});
