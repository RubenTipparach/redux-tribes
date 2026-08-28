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

// ---------------------------------------------------------- the match --
// The widened boundary: the core owns a whole match and the client submits
// orders and reads records back. These assert the RECORD LAYOUT as much as the
// behaviour, because a stride that drifts between ffi.rs and match.ts reads
// plausible garbage rather than failing loudly.

const EventKind = {
  TurnStart: 0, ShotFired: 1, ShotHit: 2, ShotMiss: 3,
  ShotSkippedRange: 4, ShotSkippedArc: 5, ProjectileSpawned: 6,
  ProjectileExpired: 7, Damage: 8, SubsystemDestroyed: 9, ShipDrifting: 10,
  ShipDestroyed: 11, Collision: 12, BoardingStarted: 13, BoardingTick: 14,
  ShipCaptured: 15, GameOver: 16,
};

test('a match starts with the scenario it was asked for', () => {
  const m = sim.match();
  m.start('deadbeefcafe0001', 0); // skirmish: 2 v 2
  assert.equal(m.shipCount, 4);
  const ships = m.ships();
  assert.equal(ships.length, 4);
  assert.equal(ships.filter(s => s.side === 0).length, 2);
  assert.equal(ships.filter(s => s.side === 1).length, 2);
  // Ship records must survive the crossing intact, not merely arrive.
  for (const s of ships) {
    assert.ok(s.hull > 0 && s.hull === s.hullMax, `hull ${s.hull} of ${s.hullMax}`);
    assert.ok(s.radius > 0 && s.radius < 10, `radius ${s.radius}`);
    assert.ok(Number.isFinite(s.pos.x + s.pos.y + s.pos.z));
    assert.ok(Math.abs(Math.hypot(s.quat.x, s.quat.y, s.quat.z, s.quat.w) - 1) < 1e-3);
    assert.ok(s.subs.length >= 1);
  }
});

test('the same seed and orders produce the same hash', () => {
  const play = (seed) => {
    const m = sim.match();
    m.start(seed, 0);
    const hashes = [];
    for (let t = 0; t < 3; t++) {
      const o = m.order(0);
      o.mode = Mode.MoveAndTurn;
      o.target = { x: -5, y: 0, z: 0 };
      m.endTurn();
      hashes.push(m.hash);
    }
    return hashes;
  };
  assert.deepEqual(play('0123456789abcdef'), play('0123456789abcdef'));
  assert.notDeepEqual(play('0123456789abcdef'), play('fedcba9876543210'));
});

test('a turn produces events and a scrubbable track', () => {
  const m = sim.match();
  m.start('0000000000000042', 1); // duel
  const o = m.order(0);
  o.mode = Mode.MoveAndTurn;
  o.target = { x: 0, y: 0, z: 0 };
  o.weapons = [{ weaponIndex: 0, second: 0, targetShip: 1, targetSub: -1 }];
  const events = m.endTurn();

  assert.ok(events.length > 0, 'a turn always emits at least its start');
  assert.equal(events[0].kind, EventKind.TurnStart);
  assert.ok(events.every(e => Number.isFinite(e.tick) && e.tick >= 0 && e.tick <= 600));

  // Playback: every tick of the turn is recorded, and the poses are real.
  for (const tick of [0, 1, 300, 599, 600]) {
    const poses = m.poses(tick);
    assert.equal(poses.length, 2, `tick ${tick} pose count`);
    for (const p of poses) {
      assert.ok(Number.isFinite(p.pos.x + p.pos.y + p.pos.z), `tick ${tick} pos`);
      const len = Math.hypot(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
      assert.ok(Math.abs(len - 1) < 1e-3, `tick ${tick} quat length ${len}`);
    }
  }
  // The track must actually move: a scrubber over a constant is a still image.
  const a = m.poses(0)[0].pos, b = m.poses(600)[0].pos;
  assert.ok(dist(a, b) > 1, `ship did not move over the turn: ${dist(a, b)}`);
});

test('the turn counter and history advance together', () => {
  const m = sim.match();
  m.start('0000000000000007', 1);
  assert.equal(m.turn, 0);
  for (let i = 1; i <= 3; i++) {
    m.order(0).mode = Mode.MoveAndTurn;
    m.endTurn();
    assert.equal(m.turn, i);
    assert.equal(m.history.length, i);
    assert.match(m.history[i - 1].hash, /^[0-9a-f]{16}$/);
  }
  // Every past turn stays reviewable, which is the point of keeping them.
  assert.deepEqual(m.history.map(h => h.turn), [0, 1, 2]);
});

test('a preview is the flight that will be executed', () => {
  const m = sim.match();
  m.start('0000000000000009', 1);
  const o = m.order(0);
  o.mode = Mode.MoveAndTurn;
  o.target = { x: 10, y: 4, z: 20 };
  const path = m.preview(0, o, 60);
  assert.ok(path.length > 2, `preview returned ${path.length} samples`);
  const end = m.previewEnd();

  m.endTurn();
  const after = m.ships()[0].pos;
  // The preview samples the same integrator the resolver runs, so the drawn
  // endpoint and the executed one are the same point, not merely close.
  assert.ok(dist(end, after) < 1e-3, `preview ${JSON.stringify(end)} vs executed ${JSON.stringify(after)}`);
});

test('class and mount metadata cross intact', () => {
  const m = sim.match();
  m.start('0000000000000001', 0);
  const terran = m.classInfo(0);
  assert.equal(terran.hull, 300);
  assert.equal(terran.mountCount, 3);
  assert.equal(terran.flight.maxSpeed, 8);

  const beam = m.mount(0, 0);
  assert.ok(beam, 'the Terran frigate has a first mount');
  assert.equal(beam.range, 300);
  // 5 base times the 5.5 mount multiplier the archive authored.
  assert.ok(Math.abs(beam.damage - 27.5) < 1e-4, `beam damage ${beam.damage}`);
  assert.deepEqual(beam.arcH.map(Math.round), [-110, 110]);

  const karisenLauncher = m.mount(1, 1);
  assert.ok(karisenLauncher, 'the Karisen frigate carries a launcher');
  assert.equal(karisenLauncher.batch, 2, 'launchers fire in batches of two');
  assert.equal(m.mount(0, 9), null, 'a mount past the end is absent, not garbage');
});

test('retuning a flight envelope changes what a ship can reach', () => {
  const m = sim.match();
  m.start('0000000000000005', 1);
  const far = { x: 0, y: 0, z: 400 };
  const o = m.order(0);
  o.mode = Mode.MoveAndTurn;
  o.target = far;

  m.preview(0, o, 8);
  const before = m.previewEnd();

  const base = m.classInfo(0).flight;
  m.setFlight(0, { ...base, accelFwd: base.accelFwd * 3, maxSpeed: base.maxSpeed * 3 });
  m.preview(0, o, 8);
  const after = m.previewEnd();

  const start = { x: -30, y: 0, z: 0 };
  assert.ok(
    dist(start, after) > dist(start, before) * 1.5,
    `a tripled drive should reach much further: ${dist(start, before)} -> ${dist(start, after)}`,
  );
});

test('two seats in the same match agree on every hash', () => {
  // The boundary version of the property the core test pins: nothing the state
  // hash covers may mean "mine". Two clients build the same match, receive the
  // same orders for both sides, and must not part.
  const VERSUS = 0b11;
  const play = () => {
    const m = sim.match();
    m.start('00000000cafef00d', 1, VERSUS);
    const hashes = [];
    for (let t = 0; t < 3; t++) {
      const all = new Map([
        [0, { mode: Mode.MoveAndTurn, target: { x: -10, y: 2, z: 4 }, weapons: [
          { weaponIndex: 0, second: 2, targetShip: 1, targetSub: -1 }] }],
        [1, { mode: Mode.MoveAndTurn, target: { x: 10, y: -1, z: -3 }, weapons: [
          { weaponIndex: 0, second: 3, targetShip: 0, targetSub: -1 }] }],
      ]);
      m.resolveWith(all);
      hashes.push(m.hash);
    }
    return hashes;
  };
  assert.deepEqual(play(), play(), 'two seats must agree turn for turn');
});

test('who flies a side is a property of the match, not the viewer', () => {
  // A solo game and a versus game of the same scenario and seed must NOT be
  // the same simulation: in one, side 1 is planned by the AI. If humanSides
  // were ignored, these would match and a versus match would be quietly
  // fighting a ghost.
  const run = (humanSides) => {
    const m = sim.match();
    m.start('0000000000000123', 1, humanSides);
    m.resolveWith(new Map([[0, { mode: Mode.MoveAndTurn, target: { x: 0, y: 0, z: 0 }, weapons: [] }]]));
    return m.hash;
  };
  assert.notEqual(run(0b01), run(0b11), 'an AI side and an idle side are different matches');
});
