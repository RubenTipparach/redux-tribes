#!/usr/bin/env node
// Headless runner + self-tests for the Fallen Tribes sim prototype.
//   node prototype/cli.js         -> run tests, then a demo AI-vs-AI battle
//   node prototype/cli.js demo    -> demo battle only
//   node prototype/cli.js test    -> tests only
"use strict";

const sim = require("./sim/sim.js");
const snap = require("./sim/snapshot.js");
const { V } = require("./sim/dmath.js");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); }
}

function scriptedSetup(seed) {
  return sim.createSkirmish(seed, {
    player: [
      { classKey: "terran_frigate", pos: V.v3(-40, 0, 0), facing: V.v3(1, 0, 0) },
      { classKey: "terran_frigate", pos: V.v3(-40, 5, -15), facing: V.v3(1, 0, 0) },
    ],
    enemy: [
      { classKey: "karisen_frigate", pos: V.v3(40, 0, 5), facing: V.v3(-1, 0, 0) },
      { classKey: "rogue_frigate", pos: V.v3(40, -4, -10), facing: V.v3(-1, 0, 0) },
    ],
    enemyFaction: "karisen",
  });
}

// scripted player orders for turn 0 (fixed, so runs are comparable)
function turn0Orders() {
  return {
    P1: {
      move: { mode: "MOVE_AND_TURN", target: [-5, 0, 0] },
      weapons: [
        { weaponIndex: 0, second: 0, targetShipId: "E1" },   // slot 0 must fire
        { weaponIndex: 1, second: 10, targetShipId: "E1" },  // slot 10 must fire (the Unity bug)
      ],
    },
    P2: { move: { mode: "MOVE_AND_TURN", target: [-10, 3, -10] }, weapons: [{ weaponIndex: 2, second: 4, targetShipId: "E2" }] },
  };
}

function runMatch(seed, turns, record) {
  const state = scriptedSetup(seed);
  const perTurn = [];
  for (let t = 0; t < turns; t++) {
    const orders = t === 0 ? turn0Orders() : {}; // later turns: player drifts, AI fights
    const r = sim.resolveTurn(state, orders, { record });
    perTurn.push(r);
    if (state.gameOver) break;
  }
  return { state, perTurn };
}

function tests() {
  console.log("\n== determinism ==");
  const a = runMatch("seed-alpha", 4, false);
  const b = runMatch("seed-alpha", 4, false);
  check("same seed + same orders -> identical per-turn hashes",
    a.perTurn.length === b.perTurn.length && a.perTurn.every((r, i) => r.hash === b.perTurn[i].hash),
    a.perTurn.map(r => r.hash).join(",") + " vs " + b.perTurn.map(r => r.hash).join(","));
  const c = runMatch("seed-beta", 4, false);
  check("different seed -> different outcome hash", a.perTurn[a.perTurn.length - 1].hash !== c.perTurn[c.perTurn.length - 1].hash);

  console.log("\n== snapshot re-simulation (replay seek) ==");
  const fresh = scriptedSetup("seed-alpha");
  sim.resolveTurn(fresh, turn0Orders(), {});           // turn 0
  const snapAfter0 = snap.serialize(fresh);
  const r1a = sim.resolveTurn(fresh, {}, {});          // turn 1 on the live state
  const restored = snap.restore(snapAfter0);
  const r1b = sim.resolveTurn(restored, {}, {});       // turn 1 from the snapshot
  check("turn re-simulated from boundary snapshot matches live run", r1a.hash === r1b.hash, r1a.hash + " vs " + r1b.hash);

  // The test above lets the AI run on BOTH paths, so a planning-time side
  // effect on ship state cancels out and stays invisible. The case that
  // matters is replaying with the orders already decided, which is also the
  // lockstep case: a client that RECEIVES orders never runs the planner. If
  // planning mutates state, that client diverges from the one that planned.
  const rep0 = scriptedSetup("seed-replay");
  const repPre = snap.serialize(rep0);
  const repOrders = turn0Orders();
  const live0 = sim.resolveTurn(rep0, repOrders, {});   // resolveTurn fills in AI orders
  const replayed = sim.resolveTurn(snap.restore(repPre), JSON.parse(JSON.stringify(repOrders)), {});
  check("replaying a turn from its stored orders reproduces it exactly",
    live0.hash === replayed.hash, live0.hash + " vs " + replayed.hash);

  console.log("\n== flight model: rotation stats, local axis limits, carried velocity ==");
  {
    const lone = (classKey, vel) => {
      const st = sim.createSkirmish("flight", {
        player: [{ classKey, pos: V.v3(0, 0, 0), facing: V.v3(0, 0, 1) }],
        enemy: [], enemyFaction: "karisen",
      });
      const sh = st.ships[0];
      if (vel) sh.vel = vel;
      return sh;
    };
    const reach = (sh, dir, mode, face) => {
      const r = sim.previewPath(sh, [dir[0] * 400, dir[1] * 400, dir[2] * 400], mode || "MOVE_AND_TURN", 2);
      return V.dist(sh.pos, r.target);
    };

    // 1. local axis limits: the main drive is astern, so forward is the cheap
    //    direction and backing up costs a turnaround plus weak retros
    const fwd = reach(lone("terran_frigate"), [0, 0, 1]);
    const aft = reach(lone("terran_frigate"), [0, 0, -1]);
    check("forward reach beats reversing (local axis thrust limits)",
      fwd > aft * 1.5, "fwd " + fwd.toFixed(1) + " vs aft " + aft.toFixed(1));

    // 2. rotation stats: pitch is slower than yaw on a frigate, so climbing
    //    costs more of the turn than sidestepping does
    const side = reach(lone("terran_frigate"), [1, 0, 0]);
    const up = reach(lone("terran_frigate"), [0, 1, 0]);
    check("slower pitch makes vertical reach worse than lateral (rotation stats)",
      side > up * 1.3, "lateral " + side.toFixed(1) + " vs vertical " + up.toFixed(1));

    // 3. a hull that turns and pushes harder simply gets further
    const agile = reach(lone("rogue_frigate"), [1, 0, 0]);
    const heavy = reach(lone("freighter"), [1, 0, 0]);
    check("agile hull outreaches a sluggish one on the same order",
      agile > heavy * 1.5, "rogue " + agile.toFixed(1) + " vs freighter " + heavy.toFixed(1));

    // 4. carried velocity commits you: at rest a ship can sit still, under way
    //    it cannot, and that is the whole point of the redesign
    check("a ship at rest can hold station",
      sim.canReach(lone("terran_frigate"), [0, 0, 0], "MOVE_AND_TURN", 2));
    check("a ship carrying velocity CANNOT hold station (momentum commits)",
      !sim.canReach(lone("terran_frigate", V.v3(0, 0, 6)), [0, 0, 0], "MOVE_AND_TURN", 2));

    // 5. holding a heading gives the course over to the RCS, which is weak, so
    //    the same sideways order lands far shorter than it does when the nose
    //    is free to swing
    const freeNose = reach(lone("terran_frigate"), [1, 0, 0], "MOVE_AND_TURN");
    const lockedShip = lone("terran_frigate");
    const locked = sim.previewPath(lockedShip, [400, 0, 0], "TURN_SLIDE", 2);
    const lockedDist = V.dist(lockedShip.pos, locked.target);
    check("holding a heading shortens a lateral move (nose locked, RCS only)",
      freeNose > lockedDist * 1.5, "free " + freeNose.toFixed(1) + " vs slide " + lockedDist.toFixed(1));
  }

  console.log("\n== slot endpoints (the Unity slot-10 bug, fixed by construction) ==");
  const s = scriptedSetup("seed-slots");
  const r = sim.resolveTurn(s, turn0Orders(), {});
  const fired = r.events.filter(e => e.type === "ShotFired" || e.type === "ProjectileSpawned" || e.type === "ShotSkipped");
  check("slot 0 order fires at tick 0", fired.some(e => e.tick === 0));
  check("slot 10 order fires at tick 600", fired.some(e => e.tick === 600));

  console.log("\n== missiles fly a finite path and connect ==");
  // Regression: stepProjectiles built each bezier leg from
  // CONST.INERTIA_DIVISOR, which was deleted with the ship movement model
  // (ADR-14) and left behind as a name. 1/undefined is NaN, so every missile
  // went NaN at its first hop: it never hit, never expired, and rode into the
  // state hash as NaN. Nothing failed loudly, missiles just stopped existing.
  const mState = sim.createSkirmish("seed-missile", {
    player: [{ classKey: "terran_frigate", pos: V.v3(0, 0, 0), facing: V.v3(0, 0, 1) }],
    enemy: [{ classKey: "karisen_frigate", pos: V.v3(0, 0, 120), facing: V.v3(0, 0, -1) }],
    enemyFaction: "karisen",
  });
  const mHullBefore = mState.ships[0].hull;
  const mRes = sim.resolveTurn(mState, {
    P1: { move: { mode: "MOVE_AND_TURN", target: [0, 0, 0] }, weapons: [] },
    E1: { move: { mode: "MOVE_AND_TURN", target: [0, 0, 120] }, weapons: [{ weaponIndex: 1, second: 0, targetShipId: "P1" }] },
  }, {});
  const launched = mRes.events.filter(e => e.type === "ProjectileSpawned" && e.kind === "missile");
  check("a missile launcher spawns its batch", launched.length === 2, "spawned " + launched.length);
  const anyNaN = mState.projectiles.some(p => !Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y) || !Number.isFinite(p.pos.z));
  check("no missile position is NaN after a full turn", !anyNaN);
  const mHits = mRes.events.filter(e => e.type === "ShotHit" && e.projectile);
  check("missiles reach the target and damage it", mHits.length === 2 && mState.ships[0].hull < mHullBefore,
    mHits.length + " hits, hull " + mHullBefore + " -> " + mState.ships[0].hull);

  console.log("\n== collision: no interpenetration + impulse damage ==");
  const cState = sim.createSkirmish("seed-ram", {
    player: [{ classKey: "terran_frigate", pos: V.v3(-20, 0, 0), facing: V.v3(1, 0, 0) }],
    enemy: [{ classKey: "karisen_frigate", pos: V.v3(20, 0, 0), facing: V.v3(-1, 0, 0) }],
  });
  cState.ships.forEach(sh => { sh.ai.enabled = false; });   // pure head-on ram, no AI steering
  const ramOrders = {
    P1: { move: { mode: "MOVE_AND_TURN", target: [20, 0, 0] } },
    E1: { move: { mode: "MOVE_AND_TURN", target: [-20, 0, 0] } },
  };
  const cr = sim.resolveTurn(cState, ramOrders, { record: true });
  const rr = 3.5 + 3.5; // both frigate radii
  let minDist = 1e9;
  for (const frame of cr.tracks) {
    const p = frame.ships.find(x => x.id === "P1"), e = frame.ships.find(x => x.id === "E1");
    const d = Math.sqrt((p.x - e.x) ** 2 + (p.y - e.y) ** 2 + (p.z - e.z) ** 2);
    if (d < minDist) minDist = d;
  }
  check("hulls never interpenetrate (min distance >= radii sum - eps)", minDist >= rr - 1e-6, "minDist=" + minDist.toFixed(3));
  check("ram deals impulse damage", cr.events.some(e => e.type === "Collision" && e.dmg > 0));
  check("rammed ships lost hull", cState.ships.every(sh => sh.hull < sh.hullMax));

  console.log("\n== boarding + capture ==");
  const bState = sim.createSkirmish("seed-board", {
    player: [{ classKey: "rogue_frigate", pos: V.v3(0, 0, 0), facing: V.v3(0, 0, 1) }],
    enemy: [{ classKey: "freighter", pos: V.v3(0, 0, 15), facing: V.v3(0, 0, 1) }],
  });
  bState.ships.forEach(sh => { sh.ai.enabled = false; });
  const eShip = bState.ships.find(s => s.id === "E1");
  eShip.hull = eShip.hullMax * 0.2;  // soften the target: defender efficiency drops to 0
  eShip.marines = 5;
  let captured = false;
  for (let t = 0; t < 8 && !captured; t++) {
    const orders = { P1: { move: { mode: "FULL_STOP" }, board: "E1" }, E1: { move: { mode: "FULL_STOP" } } };
    const rb = sim.resolveTurn(bState, orders, {});
    if (rb.events.some(e => e.type === "ShipCaptured")) captured = true;
  }
  check("boarding a softened target captures it", captured);
  check("captured ship flipped faction", eShip.faction === "terran");

  console.log("\n== drift on engine death ==");
  // shooter astern of the target: engines are a REAR volume - the spatial
  // damage model means you cannot snipe them through the bow.
  const dState = sim.createSkirmish("seed-drift", {
    player: [{ classKey: "terran_frigate", pos: V.v3(0, 0, 90), facing: V.v3(0, 0, -1) }],
    enemy: [{ classKey: "karisen_frigate", pos: V.v3(0, 0, 60), facing: V.v3(0, 0, -1) }],
  });
  dState.ships.forEach(sh => { sh.ai.enabled = false; });
  const enemy = dState.ships.find(s => s.id === "E1");
  const dOrders = {
    P1: {
      move: { mode: "FULL_STOP" }, // hold station astern
      weapons: [0, 1, 2].map(i => ({ weaponIndex: i, second: 1 + i, targetShipId: "E1", targetSub: "engines" })),
    },
    E1: { move: { mode: "FULL_STOP" } },
  };
  let drifted = false;
  for (let t = 0; t < 6 && !drifted; t++) {
    const rd = sim.resolveTurn(dState, JSON.parse(JSON.stringify(dOrders)), {});
    if (rd.events.some(e => e.type === "ShipDrifting" && e.ship === "E1")) drifted = true;
  }
  check("focused engine fire puts the target adrift", drifted, "enemy engine hp: " + enemy.subsystems.find(x => x.type === "thruster").hp);

  console.log("\n" + pass + " passed, " + fail + " failed");
  return fail === 0;
}

function demo() {
  console.log("\n== demo: 2v2 AI-vs-AI skirmish (seed 'demo-1') ==");
  const state = scriptedSetup("demo-1");
  state.ships.forEach(s => { s.ai.enabled = true; }); // everyone AI for the demo
  for (let t = 0; t < 12; t++) {
    const r = sim.resolveTurn(state, {}, {});
    const shots = r.events.filter(e => e.type === "ShotFired" || e.type === "ProjectileSpawned").length;
    const hits = r.events.filter(e => e.type === "ShotHit").length;
    const rams = r.events.filter(e => e.type === "Collision").length;
    const notable = r.events.filter(e =>
      ["ShipDestroyed", "ShipCaptured", "SubsystemDestroyed", "ShipDrifting", "BoardingStarted", "GameOver"].includes(e.type));
    const hulls = state.ships.map(s => `${s.id}${s.destroyed ? "†" : ""}:${Math.round(s.hull)}`).join(" ");
    console.log(`turn ${String(t).padStart(2)}  hash ${r.hash}  shots:${shots} hits:${hits} rams:${rams}  | ${hulls}`);
    for (const e of notable) console.log("         · " + e.type + " " + (e.ship || "") + (e.byFaction ? " by " + e.byFaction : "") + (e.winner ? " winner=" + e.winner : ""));
    if (state.gameOver) break;
  }
  if (!state.gameOver) console.log("(battle still undecided after 12 turns)");
}

const mode = process.argv[2] || "all";
let ok = true;
if (mode === "test" || mode === "all") ok = tests();
if (mode === "demo" || mode === "all") demo();
process.exit(ok ? 0 : 1);
