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
// Mirrors sim/types.ts. Sandbox is the one that unlocks the flight stats.
const Scenario = { Skirmish: 0, Duel: 1, Convoy: 2, LowOrbit: 3, Binary: 4, Slingshot: 5, Sandbox: 6 };
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
    assert.ok(s.subCount >= 1);
  }

  // What those volumes ARE comes from one query, and the client asks it rather
  // than keeping a copy: kind, condition and where the thing is in the world.
  const subs = m.subs();
  assert.equal(subs.length, ships.reduce((a, s) => a + s.subCount, 0));
  for (const v of subs) {
    assert.ok(v.kind >= 0 && v.kind <= 4, `kind ${v.kind}`);
    assert.ok(v.hp > 0 && v.hp === v.hpMax && !v.dead);
    assert.ok(v.radius > 0 && v.radius < 4, `radius ${v.radius}`);
    const ship = ships.find(x => x.id === v.ship);
    const d = Math.hypot(v.pos.x - ship.pos.x, v.pos.y - ship.pos.y, v.pos.z - ship.pos.z);
    assert.ok(d < ship.radius + v.radius, `volume ${v.index} sits ${d} from its hull`);
  }
  // Every frigate carries a bay, a set of thrusters and a pile, because losing one
  // has to be a thing that can happen to any of them.
  for (const s of ships) {
    const kinds = new Set(subs.filter(v => v.ship === s.id).map(v => v.kind));
    for (const k of [1, 2, 4]) assert.ok(kinds.has(k), `ship ${s.id} has no kind ${k}`);
  }
});

test('a side fields the design it picked, derived by the core', () => {
  // Picked in the lobby, derived here, applied at spawn and hashed. The parts
  // and the counts below are the stock Rogue's, so a hull built out of them
  // has to come out as one.
  const parts = [3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16,
    17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19];
  const geo = { plateCells: 1632, ext: [24, 14, 45], radiusCells: 24.315633, fouled: 0 };

  const m = sim.match();
  m.clearHulls();
  m.start('deadbeefcafe0003', 0);
  const authored = m.ships().map(s => [s.side, s.cls, +s.hullMax.toFixed(2)]);
  const hashA = m.hash;

  // What the core says the design is, asked directly.
  const stats = sim.derive(2, geo, parts);
  assert.ok(stats, 'the core derives the record');
  assert.ok(Math.abs(stats.hull - 194.848) < 0.1, `hull ${stats.hull}`);
  assert.ok(Math.abs(stats.mass - 0.789256) < 1e-4, `mass ${stats.mass}`);
  assert.equal(stats.marines, 40);
  assert.equal(stats.gates, 0b1111111, 'the stock Rogue passes every gate');

  m.clearHulls();
  m.setHull(0, 2, geo, parts, [
    { key: 'projectile', at: [-0.8, 0.2, 1.5] },
    { key: 'projectile', at: [0.8, 0.2, 1.5] },
  ]);
  m.start('deadbeefcafe0003', 0);
  const flown = m.ships();
  for (const s of flown) {
    if (s.side !== 0) continue;
    assert.ok(Math.abs(s.hullMax - stats.hull) < 0.1,
      `a designed hull carries its own hull points: ${s.hullMax} against ${stats.hull}`);
    assert.ok(Math.abs(s.radius - stats.radius) < 0.01, `radius ${s.radius}`);
    assert.equal(s.marines, stats.marines);
  }
  assert.notEqual(m.hash, hashA, 'the design a side fields is in the hash');

  // The other side keeps what the scenario authored, and clearing restores it.
  const mineNow = flown.filter(s => s.side === 0).map(s => +s.hullMax.toFixed(2));
  const foeNow = flown.filter(s => s.side === 1).map(s => +s.hullMax.toFixed(2));
  const foeWas = authored.filter(a => a[0] === 1).map(a => a[2]);
  assert.deepEqual(foeNow, foeWas, 'a design is one side\'s, not the match\'s');
  assert.ok(mineNow.every(h => Math.abs(h - 194.85) < 0.1), 'and mine are the design');

  m.clearHulls();
  m.start('deadbeefcafe0003', 0);
  assert.deepEqual(m.ships().map(s => [s.side, s.cls, +s.hullMax.toFixed(2)]), authored,
    'clearing the design restores the authored ships');
  assert.equal(m.hash, hashA, 'exactly, hash and all');
});

/**
 * The arc mask, all the way across and back.
 *
 * Three things have to survive the trip, and each has already been a way to
 * get this wrong: the bin geometry has to agree in both directions, a mask
 * word has to arrive with all 32 of its bits, and the resolver has to be
 * reading the mask the client sent rather than the empty default.
 */
test('a scanned firing arc crosses the boundary bit for bit', () => {
  const dirs = sim.arcDirs();
  assert.ok(dirs, 'the core hands out its own mask geometry');
  assert.equal(dirs.length, 64 * 32 * 3, 'one direction per cell');
  for (let bit = 0; bit < 64 * 32; bit++) {
    const [x, y, z] = [dirs[bit * 3], dirs[bit * 3 + 1], dirs[bit * 3 + 2]];
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-3, `cell ${bit} is a direction`);
    assert.equal(sim.arcBit(x, y, z), bit, `cell ${bit} bins back to itself`);
  }

  const parts = [3, 3, 3, 12, 12, 14, 14, 7, 7, 6, 10, 10, 8, 8, 11, 11, 16,
    17, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19];
  const geo = { plateCells: 1632, ext: [24, 14, 45], radiusCells: 24.315633, fouled: 0 };
  const mounts = [{ key: 'projectile', at: [0, 0, 1.5] }];

  const bearings = (mask) => {
    const m = sim.match();
    m.clearHulls();
    assert.ok(m.setHull(0, 2, geo, parts, mounts, mask ? [mask] : undefined));
    m.start('deadbeefcafe0009', 0);
    const me = m.ships().find(s => s.side === 0);
    const foe = m.ships().find(s => s.side === 1);
    return [m, me, foe, m.canBear(me.id, 0, foe.id)];
  };

  const [live, me, foe, clearShot] = bearings(null);
  assert.ok(clearShot, 'an unmasked mount bears on a hostile in front of it');

  // The cell the target is actually in, found the way the resolver finds it:
  // the direction from the mount, in the ship's frame.
  const fwd = live.forward(me.id);
  const up = { x: 0, y: 1, z: 0 };
  const right = { x: up.y * fwd.z - up.z * fwd.y, y: up.z * fwd.x - up.x * fwd.z,
    z: up.x * fwd.y - up.y * fwd.x };
  const rl = Math.hypot(right.x, right.y, right.z);
  const r = { x: right.x / rl, y: right.y / rl, z: right.z / rl };
  const u = { x: fwd.y * r.z - fwd.z * r.y, y: fwd.z * r.x - fwd.x * r.z,
    z: fwd.x * r.y - fwd.y * r.x };
  const d = { x: foe.pos.x - me.pos.x, y: foe.pos.y - me.pos.y, z: foe.pos.z - me.pos.z };
  const dl = Math.hypot(d.x, d.y, d.z);
  const local = {
    x: (d.x * r.x + d.y * r.y + d.z * r.z) / dl,
    y: (d.x * u.x + d.y * u.y + d.z * u.z) / dl,
    z: (d.x * fwd.x + d.y * fwd.y + d.z * fwd.z) / dl,
  };
  const bit = sim.arcBit(local.x, local.y, local.z);

  // Half a word each way, because the buffer between here and the core is
  // f32: a whole 32 bit word cannot ride in one slot exactly, so it is split,
  // and a split that dropped or swapped a half would arrive as an arc nobody
  // scanned. Set the half the target is in and the shot goes; set the other
  // half and it still goes.
  const half = (word, hi) => {
    const mask = new Uint32Array(64);
    mask[word] = hi ? 0xffff0000 : 0x0000ffff;
    return mask;
  };
  const word = bit >>> 5, hi = (bit & 31) >= 16;
  assert.equal(bearings(half(word, hi))[3], false,
    'the half of the word the target sits in blocks the shot');
  assert.equal(bearings(half(word, !hi))[3], true,
    'and the other half of the same word does not');
});

test('a shot lands on the volume it was aimed at, not the hull in front of it', () => {
  // The defect this pins: a volume sits INSIDE the hull sphere, so a single
  // nearest-wins raycast over both always returned the sphere and every aimed
  // shot hit the hull. Which SHIP is nearest and WHAT it struck are two
  // questions with two answers.
  const m = sim.match();
  m.start('deadbeefcafe0002', 0);
  const ships = m.ships();
  const mine = ships.find(s => s.side === 0);
  const foe = ships.find(s => s.side === 1);
  const bay = m.subs().find(v => v.ship === foe.id && v.kind === 3);
  assert.ok(bay, 'a frigate has a weapon bay to aim at');

  let hitTheBay = false;
  for (let t = 0; t < 6 && !hitTheBay; t++) {
    const o = m.order(mine.id);
    o.weapons = [0, 1, 2].map(i => ({ weaponIndex: i, second: i + 1,
      targetShip: foe.id, targetSub: bay.index }));
    const events = m.endTurn();
    hitTheBay = events.some(e => e.kind === 2 && e.ship === foe.id && e.aux === bay.index);
  }
  assert.ok(hitTheBay, 'a shot aimed at the bay has to be able to reach the bay');
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
  // Every weapon traverses freely now. What limits a mount is the hull it is
  // bolted to, which is scanned rather than authored, plus the ten degrees
  // under its own mount that no turret can shoot through.
  assert.deepEqual(beam.arcH.map(Math.round), [-360, 360]);
  assert.deepEqual(beam.arcV.map(Math.round), [-10, 90]);

  const karisenLauncher = m.mount(1, 1);
  assert.ok(karisenLauncher, 'the Karisen frigate carries a launcher');
  assert.equal(karisenLauncher.batch, 2, 'launchers fire in batches of two');
  assert.equal(m.mount(0, 9), null, 'a mount past the end is absent, not garbage');
});

/**
 * Retuning works, and only in a sandbox.
 *
 * Both halves in one test, because a lock that refuses everything would pass a
 * test that only checked the refusal, and a lock that refuses nothing would
 * pass one that only checked the tuning.
 */
test('flight stats retune in a sandbox and are refused outside one', () => {
  const far = { x: 0, y: 0, z: 400 };
  const start = { x: -30, y: 0, z: 0 };
  const reachWithTripleDrive = (scenario) => {
    const m = sim.match();
    m.start('0000000000000005', scenario);
    const o = m.order(0);
    o.mode = Mode.MoveAndTurn;
    o.target = far;
    m.preview(0, o, 8);
    const before = m.previewEnd();
    const base = m.classInfo(0).flight;
    const took = m.setFlight(0, { ...base, accelFwd: base.accelFwd * 3, maxSpeed: base.maxSpeed * 3 });
    m.preview(0, o, 8);
    return { sandbox: m.sandbox, took, before: dist(start, before), after: dist(start, m.previewEnd()) };
  };

  const open = reachWithTripleDrive(Scenario.Sandbox);
  assert.ok(open.sandbox, 'the sandbox scenario reports itself as one');
  assert.ok(open.took, 'a sandbox should accept a stat change');
  assert.ok(
    open.after > open.before * 1.5,
    `a tripled drive should reach much further: ${open.before} -> ${open.after}`,
  );

  // The duel is a real match: the stats are what the class says they are, and
  // the core refuses to be told otherwise. They are in the state hash, so a
  // seat that could change them could part two clients on its own.
  const shut = reachWithTripleDrive(Scenario.Duel);
  assert.ok(!shut.sandbox, 'a duel is not a sandbox');
  assert.ok(!shut.took, 'a real match should refuse a stat change');
  assert.equal(shut.after, shut.before, 'the refused change moved the envelope anyway');
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

test('the client asks the core for rules instead of holding copies', () => {
  // The UI used to recompute the weapon cooldown and the boarding range. Two
  // implementations of one rule is a rule that will be changed in one of them,
  // and the failure is silent: a mount greyed out that could have fired, or a
  // boarding button offered for an action the resolver then drops.
  //
  // With the authored data every weapon fires every turn (cooldown 0 and 1
  // both floor to 1, and a turn always advances by 1), so the gate only stops
  // a SECOND shot inside one turn, which a planner cannot reach. That state is
  // constructed and asserted in the Rust suite, where it can be. What matters
  // here is that the query is wired to the resolver at all.
  const m = sim.match();
  m.start('000000000000beef', 1, 0b01);

  assert.equal(m.canFire(0, 0), true, 'a live mount is available');
  assert.equal(m.canFire(0, 99), false, 'a mount that does not exist is not');
  assert.equal(m.canFire(99, 0), false, 'nor is one on a ship that does not exist');

  // Boarding is refused at range, by the same rule the resolver runs at
  // second zero rather than by a second copy of it.
  const ships = m.ships();
  const gap = Math.hypot(
    ships[0].pos.x - ships[1].pos.x,
    ships[0].pos.y - ships[1].pos.y,
    ships[0].pos.z - ships[1].pos.z);
  assert.ok(gap > ships[0].boardingRange, `the duel starts ${gap.toFixed(0)} apart`);
  assert.equal(m.canBoard(0, 1), false, 'no boarding across open space');
  assert.equal(m.canBoard(0, 0), false, 'and never onto yourself');
});

test('forward is the core convention, not a second opinion', () => {
  // Which axis counts as forward is a convention. The renderer holding its own
  // copy is how a heading arrow ends up pointing out of the wrong end.
  const m = sim.match();
  m.start('000000000000f00d', 1, 0b01);
  const ships = m.ships();
  for (const s of ships) {
    const f = m.forward(s.id);
    assert.ok(Math.abs(Math.hypot(f.x, f.y, f.z) - 1) < 1e-4, 'forward is a unit vector');
    // The duel faces the two hulls at each other along x, so each nose should
    // point roughly at the other ship.
    const other = ships.find(o => o.id !== s.id);
    const toward = {
      x: other.pos.x - s.pos.x, y: other.pos.y - s.pos.y, z: other.pos.z - s.pos.z,
    };
    const len = Math.hypot(toward.x, toward.y, toward.z);
    const dot = (f.x * toward.x + f.y * toward.y + f.z * toward.z) / len;
    assert.ok(dot > 0.9, `ship ${s.id} should be facing its opponent, dot ${dot.toFixed(3)}`);
  }
});

test('a recorded turn replays to the hash it produced', () => {
  // The client's own divergence check. A hash says two clients parted; a
  // snapshot plus that turn's orders says WHICH turn, from inside one client
  // with no server involved.
  const m = sim.match();
  m.start('00000000dec0ded1', 0, 0b01);
  for (let t = 0; t < 3; t++) {
    const o = m.order(0);
    o.mode = Mode.MoveAndTurn;
    o.target = { x: -5 + t, y: 0, z: 0 };
    m.resolveWith(m.orders);
  }
  assert.equal(m.history.length, 3);

  const live = m.hash;
  for (let i = 0; i < m.history.length; i++) {
    const r = m.replay(i);
    assert.ok(r, `turn ${i} is replayable`);
    assert.equal(r.ok, true, `turn ${i}: expected ${r.expected}, replayed ${r.got}`);
  }
  // A self check that moved the world would be worse than no self check.
  assert.equal(m.hash, live, 'replaying leaves the live match exactly where it was');
});

test('a snapshot is a copy, not a window onto the scratch buffer', () => {
  // The scratch is reused by the very next call, so a retained view would
  // become whatever was written after it. That bug only appears when
  // something else happens to run in between, which is the worst kind.
  const m = sim.match();
  m.start('00000000c0ffee11', 1, 0b01);
  const before = m.snapshot();
  assert.ok(before && before.length > 0);
  const copy = Float32Array.from(before);

  // Do a pile of unrelated work that writes all over the scratch.
  m.ships();
  m.classInfo(0);
  m.preview(0, { mode: Mode.MoveAndTurn, target: { x: 20, y: 5, z: 5 }, weapons: [] }, 48);
  m.resolveWith(new Map([[0, { mode: Mode.MoveAndTurn, target: { x: 0, y: 0, z: 0 }, weapons: [] }]]));

  assert.deepEqual(Array.from(before), Array.from(copy), 'the snapshot survived the traffic');
  assert.equal(m.restore(before), true, 'and still restores');
});

test('a snapshot from another match is refused', () => {
  const a = sim.match();
  a.start('00000000aaaaaaa1', 1, 0b01);
  const snap = a.snapshot();

  const b = sim.match();
  b.start('00000000bbbbbbb2', 1, 0b01);
  assert.equal(b.restore(snap), false, 'restoring the wrong match is refused, not silently wrong');
});

test('every face of a drawn hull points outward', async () => {
  // The defect this pins: the greedy mesher lays each face on the two axes of
  // its own layer, and a triangle is front facing only when those two crossed
  // give the normal. For the x faces that is Y cross Z which is +X and for the
  // z faces X cross Y which is +Z, but for the y faces it is X cross Z which
  // is MINUS Y. Every hull's top and bottom came out wound backwards, was
  // culled, and the ship read as a flat slab you could see into.
  // Bundled in memory like the client above, so the test exercises the real
  // module rather than a copy of the mesher.
  const built = await build({
    entryPoints: [resolve(root, 'src/app/hull.ts')],
    bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
  });
  const hull = await import('data:text/javascript;base64,'
    + Buffer.from(built.outputFiles[0].text).toString('base64'));
  const { hullMesh } = hull;
  const dsn = await build({
    entryPoints: [resolve(root, 'src/app/design.ts')],
    bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
  });
  const design = await import('data:text/javascript;base64,'
    + Buffer.from(dsn.outputFiles[0].text).toString('base64'));
  const { stockFor, FRAMES, useCore } = design;
  // hullMesh only rasterises, but design.ts refuses to derive without a core,
  // and stockFor does not derive. Wire a stub so an accidental call is loud.
  useCore(() => null);
  for (const f of FRAMES) {
    const h = hullMesh(stockFor(f.classKey));
    const pos = h.geo.getAttribute('position').array;
    const nrm = h.geo.getAttribute('normal').array;
    let wrong = 0;
    for (let q = 0; q < h.quads; q++) {
      const b = q * 12;
      const ax = pos[b + 3] - pos[b], ay = pos[b + 4] - pos[b + 1], az = pos[b + 5] - pos[b + 2];
      const bx = pos[b + 6] - pos[b], by = pos[b + 7] - pos[b + 1], bz = pos[b + 8] - pos[b + 2];
      // The winding's own normal, against the one the vertex carries.
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const dot = cx * nrm[b] + cy * nrm[b + 1] + cz * nrm[b + 2];
      if (dot <= 0) wrong++;
    }
    assert.equal(wrong, 0, `${f.classKey}: ${wrong} of ${h.quads} faces wound inward`);
  }
});
