// Fallen Tribes — headless deterministic WEGO simulation core (JS prototype).
//
// Implements the mechanics documented in docs/DESIGN.md on the turn pipeline
// of docs/ARCHITECTURE.md ADR-3/-4: a 10-second turn resolved over tick
// indices 0..=600 (601 boundary evaluations, second-slot events at tick s*60,
// slot 10 processed before the boundary), quadratic-Bezier momentum movement,
// spatial subsystem damage, no-clip collision resolution with impulse damage,
// per-second boarding dice, and a seeded per-turn RNG. Pure data in, pure
// data out: resolveTurn(state, orders) -> { state', events, hash, tracks? }.
//
// No engine, no DOM, no Node APIs — runs identically headless and in-browser.
(function (global) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const dmath = isNode ? require("./dmath.js") : global.FT.dmath;
  const rngMod = isNode ? require("./rng.js") : global.FT.rng;
  const data = isNode ? require("./data.js") : global.FT.data;

  const { V, Q, bezier2, arcTest3D } = dmath;
  const { CONST, WEAPONS, SHIP_CLASSES, marineEfficiency } = data;
  const T = CONST.TICKS_PER_TURN;
  const TPS = CONST.TICKS_PER_SECOND;

  // ---------------------------------------------------------------- state --
  function makeShip(id, classKey, faction, isPlayer, pos, facing) {
    const cls = SHIP_CLASSES[classKey];
    const quat = Q.look(facing || V.v3(0, 0, 1));
    return {
      id, classKey, faction, isPlayer: !!isPlayer,
      pos: V.clone(pos), quat,
      lastVel: V.zero(),            // per-turn units: exit tangent of last turn
      hull: cls.hull, hullMax: cls.hull,
      subsystems: cls.subsystems().map(s => ({ ...s, offset: V.clone(s.offset), maxHp: s.hp, dead: false })),
      weapons: cls.weapons.map(w => ({ key: w.key, mount: V.clone(w.mount), lastFiredTurn: -99 })),
      marines: cls.marines,
      boardingParties: [],          // [{faction, count}]
      drift: { active: false, dir: V.zero() },
      move: { mode: "MOVE_AND_TURN", hasBoosted: false, stopped: false, lastMode: "MOVE_AND_TURN" },
      destroyed: false,
      ai: { enabled: !isPlayer, targetId: null, fireProbability: 0.5, canChase: true },
    };
  }

  function createSkirmish(matchSeed, spec) {
    // spec: { player: [{classKey, pos, facing}...], enemy: [...] , enemyFaction }
    const state = {
      matchSeed, turn: 0, ships: [], projectiles: [], nextProjId: 1,
      gameOver: null,
    };
    let n = 0;
    for (const s of spec.player) state.ships.push(makeShip("P" + (++n), s.classKey, "terran", true, s.pos, s.facing));
    n = 0;
    for (const s of spec.enemy) state.ships.push(makeShip("E" + (++n), s.classKey, spec.enemyFaction || "karisen", false, s.pos, s.facing));
    return state;
  }

  // ------------------------------------------------------------ geometry --
  function subWorldPos(ship, sub) { return V.add(ship.pos, Q.rot(ship.quat, sub.offset)); }
  function mountWorldPos(ship, w) { return V.add(ship.pos, Q.rot(ship.quat, w.mount)); }

  // segment (a->b) vs sphere (c, r): return t in [0,1] of first intersection or -1
  function segSphere(a, b, c, r) {
    const d = V.sub(b, a), m = V.sub(a, c);
    const A = V.dot(d, d);
    if (A < 1e-12) return V.len(m) <= r ? 0 : -1;
    const B = 2 * V.dot(m, d);
    const Cc = V.dot(m, m) - r * r;
    const disc = B * B - 4 * A * Cc;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t = (-B - sq) / (2 * A);
    if (t < 0) t = (-B + sq) / (2 * A);
    return (t >= 0 && t <= 1) ? t : -1;
  }

  // Raycast a segment against every live ship (hull + live subsystem volumes).
  // Returns { ship, sub|null, t, pos } of the nearest hit, or null.
  function raycastShips(state, a, b, ignoreShipId) {
    let best = null;
    for (const ship of state.ships) {
      if (ship.destroyed || ship.id === ignoreShipId) continue;
      // subsystem volumes first (they sit inside/on the hull sphere)
      for (const sub of ship.subsystems) {
        if (sub.dead) continue;
        const t = segSphere(a, b, subWorldPos(ship, sub), sub.radius);
        if (t >= 0 && (!best || t < best.t)) best = { ship, sub, t };
      }
      const cls = SHIP_CLASSES[ship.classKey];
      const t = segSphere(a, b, ship.pos, cls.radius);
      if (t >= 0 && (!best || t < best.t)) best = { ship, sub: null, t };
    }
    if (best) best.pos = V.lerp(a, b, best.t);
    return best;
  }

  // -------------------------------------------------------------- damage --
  function applyDamage(state, ship, sub, dmg, attackerId, events, tick, kind) {
    if (ship.destroyed) return;
    let hullShare = dmg;
    if (sub && !sub.dead) {
      const absorbed = dmg * (sub.blockPct / 100);
      hullShare = dmg - absorbed;
      sub.hp = Math.max(0, sub.hp - absorbed);
      if (sub.hp <= 0) {
        sub.dead = true;
        events.push({ tick, type: "SubsystemDestroyed", ship: ship.id, sub: sub.id });
        if (sub.type === "thruster" && !ship.subsystems.some(s => s.type === "thruster" && !s.dead)) {
          // engines out -> drift (dir = 0.25 * this turn's planned offset)
          const seg = ship._seg;
          const offset = seg ? V.sub(seg.target, seg.start) : ship.lastVel;
          ship.drift = { active: true, dir: V.scale(offset, CONST.DRIFT_FACTOR) };
          events.push({ tick, type: "ShipDrifting", ship: ship.id });
        }
      }
    }
    ship.hull = Math.max(0, ship.hull - hullShare);
    events.push({
      tick, type: "Damage", ship: ship.id, sub: sub ? sub.id : null,
      amount: +dmg.toFixed(3), hullAfter: +ship.hull.toFixed(3), kind: kind || "shot", attacker: attackerId || null,
    });
    // AI retaliation (FiredEvent -> IfFiredUponAlert)
    if (ship.ai.enabled && attackerId) ship.ai.targetId = attackerId;
    if (ship.hull <= 0) {
      ship.destroyed = true;
      events.push({ tick, type: "ShipDestroyed", ship: ship.id, by: attackerId || null });
    }
  }

  // ------------------------------------------------------------ movement --
  function clampToRange(pos, target, range) {
    const off = V.sub(target, pos);
    const d = V.len(off);
    return d > range ? V.add(pos, V.scale(off, range / d)) : V.clone(target);
  }

  // Build this turn's movement segment for a ship from its order.
  function planMovement(ship, order) {
    const cls = SHIP_CLASSES[ship.classKey];
    const mv = ship.move;
    let mode = (order && order.move && order.move.mode) || "MOVE_AND_TURN";
    let effRange = cls.thrusterRange;

    if (ship.drift.active) {
      // no control: continue drifting
      const target = V.add(ship.pos, ship.drift.dir);
      ship._seg = { start: V.clone(ship.pos), cp: V.add(ship.pos, V.scale(ship.drift.dir, 0.5)), target, t0: 0 };
      ship._startQuat = ship.quat;
      ship._plannedQuat = ship.quat; // rotation frozen while drifting
      return;
    }

    // gates (from ShipController): boost requires previous MOVE_AND_TURN
    if (mode === "FULL_SPEED" && !(mv.lastMode === "MOVE_AND_TURN" && !mv.hasBoosted && !mv.stopped)) {
      mode = "MOVE_AND_TURN";
    }

    let target;
    if (mode === "FULL_SPEED") {
      effRange = cls.thrusterRange * CONST.BOOST_MULT;
      const dir = V.len(ship.lastVel) > 1e-9 ? V.norm(ship.lastVel) : Q.forward(ship.quat);
      target = V.add(ship.pos, V.scale(dir, effRange)); // locked straight, exactly full range
      mv.hasBoosted = true;
    } else if (mode === "FULL_STOP") {
      if (mv.stopped) {
        target = V.clone(ship.pos); // fully stopped: point segment
      } else {
        target = V.add(ship.pos, V.scale(ship.lastVel, CONST.FULLSTOP_MULT)); // half speed this turn
        mv.stopped = true;
      }
    } else {
      // MOVE_AND_TURN / TURN_SLIDE: destination from order, clamped; default = momentum
      const want = (order && order.move && order.move.target)
        ? V.v3(order.move.target[0], order.move.target[1], order.move.target[2])
        : V.add(ship.pos, ship.lastVel);
      target = clampToRange(ship.pos, want, effRange);
      if (mode !== "FULL_STOP") mv.stopped = false;
      mv.hasBoosted = false;
    }

    const start = V.clone(ship.pos);
    let lastVel = ship.lastVel;
    if (V.len(lastVel) < 1e-9) lastVel = V.sub(target, start); // first-turn seed (original behavior)
    const cp = (V.dist(start, target) < 1e-9)
      ? V.clone(target)                                    // full stop: degenerate point
      : V.add(start, V.scale(lastVel, 1 / CONST.INERTIA_DIVISOR));
    ship._seg = { start, cp, target, t0: 0 };

    // planned orientation
    ship._startQuat = ship.quat;
    if (order && order.move && order.move.face) {
      const f = order.move.face;
      ship._plannedQuat = Q.look(V.v3(f[0], f[1], f[2]));
    } else if (mode === "TURN_SLIDE") {
      ship._plannedQuat = ship.quat;                       // facing decoupled, unchanged by default
    } else {
      const off = V.sub(target, start);
      ship._plannedQuat = V.len(off) > 1e-9 ? Q.look(off) : ship.quat;
    }
    mv.lastMode = mode;
    mv.mode = mode;
  }

  function shipPosAtTick(ship, tick) {
    const seg = ship._seg;
    const span = T - seg.t0;
    const t = span > 0 ? Math.min(1, Math.max(0, (tick - seg.t0) / span)) : 1;
    return bezier2(seg.start, seg.cp, seg.target, t);
  }

  // Re-plan a ship's remaining path after a collision deflection.
  function replanAfterCollision(ship, tick, exitVelPerTick) {
    const carried = V.scale(exitVelPerTick, T); // per-turn units
    const start = V.clone(ship.pos);
    const target = ship._seg.target;            // still try to honor the order
    const cp = V.add(start, V.scale(carried, 1 / CONST.INERTIA_DIVISOR));
    ship._seg = { start, cp, target, t0: tick };
  }

  // ------------------------------------------------------------- weapons --
  function fireWeapon(state, ship, w, order, tick, events, rngFor) {
    const wd = WEAPONS[w.key];
    const target = state.ships.find(s => s.id === order.targetShipId);
    if (!target || target.destroyed) return;
    // cooldown: at most one shot per weapon per turn; cooldownTurns extra gap beyond that.
    // (The Unity arithmetic makes cd 0 and cd 1 both fire every turn; preserved here.)
    const gap = state.turn - w.lastFiredTurn;
    if (w.lastFiredTurn >= 0 && gap < Math.max(1, wd.cooldownTurns)) return;

    const mountPos = mountWorldPos(ship, w);
    // aim point: targeted subsystem volume, else target hull center (live position — original behavior)
    let aimPos = target.pos;
    const aimedSub = order.targetSub ? target.subsystems.find(s => s.id === order.targetSub && !s.dead) : null;
    if (aimedSub) aimPos = subWorldPos(target, aimedSub);

    // arc + range gate at the moment of firing (silently skips, as the original does)
    const dist = V.dist(mountPos, aimPos);
    if (dist > wd.range) { events.push({ tick, type: "ShotSkipped", ship: ship.id, weapon: w.key, reason: "range" }); return; }
    if (!arcTest3D(mountPos, ship.quat, aimPos, wd.arcH[0], wd.arcH[1], wd.arcV[0], wd.arcV[1])) {
      events.push({ tick, type: "ShotSkipped", ship: ship.id, weapon: w.key, reason: "arc" }); return;
    }

    w.lastFiredTurn = state.turn;
    const dmg = wd.dmg * wd.mult;
    const rng = rngFor("wep:" + ship.id + ":" + w.key + ":" + tick);

    if (wd.kind === "beam") {
      const scatter = V.scale(rng.insideUnitSphere(V), CONST.BEAM_SCATTER);
      const aim = V.add(aimPos, scatter);
      const dir = V.norm(V.sub(aim, mountPos));
      const end = V.add(mountPos, V.scale(dir, wd.range));
      events.push({ tick, type: "ShotFired", ship: ship.id, weapon: w.key, kind: "beam", from: pk(mountPos), to: pk(end) });
      const hit = raycastShips(state, mountPos, end, ship.id);
      if (hit) {
        events.push({ tick, type: "ShotHit", ship: hit.ship.id, sub: hit.sub ? hit.sub.id : null, pos: pk(hit.pos), by: ship.id });
        applyDamage(state, hit.ship, hit.sub, dmg, ship.id, events, tick, "beam");
      } else {
        events.push({ tick, type: "ShotMiss", ship: ship.id, weapon: w.key });
      }
    } else if (wd.kind === "cannon") {
      const dir = V.norm(V.sub(aimPos, mountPos)); // aim fixed at fire time, no homing
      state.projectiles.push({
        id: state.nextProjId++, kind: "cannon", owner: ship.id, dmg,
        pos: V.clone(mountPos), vel: V.scale(dir, CONST.CANNON_SPEED / TPS),
        life: CONST.CANNON_LIFE_TICKS,
      });
      events.push({ tick, type: "ProjectileSpawned", kind: "cannon", owner: ship.id, id: state.nextProjId - 1 });
    } else if (wd.kind === "missile") {
      const batch = wd.batch || 1;
      for (let b = 0; b < batch; b++) {
        const r = rngFor("mis:spawn:" + ship.id + ":" + tick + ":" + b);
        const fwd = Q.forward(ship.quat);
        const rally = V.add(V.add(mountPos, V.scale(fwd, CONST.MISSILE_LAUNCH_SPEED)),
          V.scale(r.insideUnitSphere(V), CONST.MISSILE_LAUNCH_SCATTER));
        const id = state.nextProjId++;
        state.projectiles.push({
          id, kind: "missile", owner: ship.id, dmg, targetShipId: target.id,
          pos: V.clone(mountPos),
          seg: { start: V.clone(mountPos), cp: V.lerp(mountPos, rally, 0.5), target: rally },
          segTick: 0, // ticks into current leg
          lastVel: V.sub(rally, mountPos),
          life: CONST.MISSILE_LIFE_TICKS,
        });
        events.push({ tick, type: "ProjectileSpawned", kind: "missile", owner: ship.id, id, target: target.id });
      }
    }
  }

  function stepProjectiles(state, tick, events, rngFor) {
    const remove = [];
    for (const p of state.projectiles) {
      const prev = V.clone(p.pos);
      if (p.kind === "cannon") {
        p.pos = V.add(p.pos, p.vel);
      } else {
        // missile: bezier leg, re-planned every MISSILE_HOP_TICKS
        p.segTick++;
        if (p.segTick >= CONST.MISSILE_HOP_TICKS) {
          p.segTick = 0;
          const target = state.ships.find(s => s.id === p.targetShipId);
          const r = rngFor("mis:hop:" + p.id + ":" + tick);
          let next;
          if (target && !target.destroyed) {
            const dir = V.norm(V.sub(target.pos, p.pos));
            next = V.add(V.add(p.pos, V.scale(dir, CONST.MISSILE_PURSUIT_SPEED)),
              V.scale(r.insideUnitSphere(V), CONST.MISSILE_HOP_SCATTER));
          } else {
            const dir = V.len(p.lastVel) > 1e-9 ? V.norm(p.lastVel) : V.v3(0, 0, 1);
            next = V.add(p.pos, V.scale(dir, CONST.MISSILE_PURSUIT_SPEED));
          }
          p.seg = { start: V.clone(p.pos), cp: V.add(p.pos, V.scale(p.lastVel, 1 / CONST.INERTIA_DIVISOR)), target: next };
        }
        const t = (p.segTick + 1) / CONST.MISSILE_HOP_TICKS;
        p.pos = bezier2(p.seg.start, p.seg.cp, p.seg.target, Math.min(1, t));
        p.lastVel = V.sub(p.seg.target, p.seg.cp);
      }
      // sweep prev -> pos against ships
      const hit = raycastShips(state, prev, p.pos, p.owner);
      if (hit) {
        events.push({ tick, type: "ShotHit", ship: hit.ship.id, sub: hit.sub ? hit.sub.id : null, pos: pk(hit.pos), by: p.owner, projectile: p.id });
        applyDamage(state, hit.ship, hit.sub, p.dmg, p.owner, events, tick, p.kind);
        remove.push(p.id);
        continue;
      }
      if (--p.life <= 0) {
        events.push({ tick, type: "ProjectileExpired", id: p.id, kind: p.kind });
        remove.push(p.id);
      }
    }
    if (remove.length) state.projectiles = state.projectiles.filter(p => !remove.includes(p.id));
  }

  // ---------------------------------------------------------- collisions --
  // No-interpenetration contact resolution (ADR-4): positional separation +
  // impulse damage, sorted pair order, per-pair cooldown, post-contact re-plan.
  function resolveCollisions(state, tick, events, pairCooldowns, prevPositions) {
    const live = state.ships.filter(s => !s.destroyed);
    live.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i], B = live[j];
        const rA = SHIP_CLASSES[A.classKey].radius, rB = SHIP_CLASSES[B.classKey].radius;
        const delta = V.sub(B.pos, A.pos);
        const dist = V.len(delta);
        const minDist = rA + rB;
        if (dist >= minDist || dist < 1e-9) continue;

        const n = V.scale(delta, 1 / dist);
        const overlap = minDist - dist;
        const mA = SHIP_CLASSES[A.classKey].mass, mB = SHIP_CLASSES[B.classKey].mass;
        const wA = mB / (mA + mB), wB = mA / (mA + mB); // heavier moves less

        // positional correction: separate fully this tick — never interpenetrate
        A.pos = V.sub(A.pos, V.scale(n, overlap * wA));
        B.pos = V.add(B.pos, V.scale(n, overlap * wB));

        // relative normal speed (units/s) from per-tick velocities
        const vA = V.scale(V.sub(A.pos, prevPositions[A.id]), TPS);
        const vB = V.scale(V.sub(B.pos, prevPositions[B.id]), TPS);
        const relN = V.dot(V.sub(vA, vB), n); // closing if positive

        const key = A.id + "|" + B.id;
        const cd = pairCooldowns[key] || -9999;
        if (relN > 0.5 && tick - cd >= CONST.COLLISION_PAIR_COOLDOWN_TICKS) {
          pairCooldowns[key] = tick;
          const reduced = (mA * mB) / (mA + mB);
          const dmg = CONST.COLLISION_DAMAGE_K * relN * reduced;
          const at = V.add(A.pos, V.scale(n, rA));
          events.push({ tick, type: "Collision", a: A.id, b: B.id, relSpeed: +relN.toFixed(2), dmg: +dmg.toFixed(1), pos: pk(at) });
          applyDamage(state, A, null, dmg, B.id, events, tick, "ram");
          applyDamage(state, B, null, dmg, A.id, events, tick, "ram");
        }

        // deflect: bounce the normal component, re-plan remaining path
        const bounce = CONST.COLLISION_RESTITUTION;
        const vA2 = V.sub(vA, V.scale(n, (1 + bounce) * Math.max(0, V.dot(vA, n) - V.dot(vB, n)) * wA));
        const vB2 = V.add(vB, V.scale(n, (1 + bounce) * Math.max(0, V.dot(vA, n) - V.dot(vB, n)) * wB));
        if (!A.destroyed) replanAfterCollision(A, tick, V.scale(vA2, 1 / TPS));
        if (!B.destroyed) replanAfterCollision(B, tick, V.scale(vB2, 1 / TPS));
      }
    }
  }

  // ------------------------------------------------------------ boarding --
  function boardingSecond(state, tick, events, rngFor) {
    for (const ship of state.ships) {
      if (ship.destroyed || ship.boardingParties.length === 0) continue;
      const rng = rngFor("board:" + ship.id);
      const eff = marineEfficiency(ship.hull / ship.hullMax);
      for (const party of ship.boardingParties) {
        if (party.faction === ship.faction) continue; // friendly reinforcements idle
        if (party.count <= 0 || ship.marines <= 0) continue;
        const attackSuccess = rng.rollDice(party.count, CONST.BOARDING_DICE_SIDES, CONST.BOARDING_DICE_THRESHOLD);
        const defendSuccess = rng.rollDice(ship.marines, CONST.BOARDING_DICE_SIDES, CONST.BOARDING_DICE_THRESHOLD);
        if (attackSuccess > eff) ship.marines = Math.max(0, ship.marines - 1);
        if (defendSuccess > 0) party.count = Math.max(0, party.count - eff);
        events.push({ tick, type: "BoardingTick", ship: ship.id, defenders: ship.marines, attackers: party.count, attackerFaction: party.faction });
      }
      // capture check
      for (const party of ship.boardingParties.slice()) {
        if (party.faction !== ship.faction && ship.marines <= 0 && party.count > 0) {
          ship.faction = party.faction;
          ship.marines = party.count;
          ship.isPlayer = state.ships.some(s => s.isPlayer && s.faction === party.faction);
          ship.ai.enabled = !ship.isPlayer;
          ship.boardingParties = ship.boardingParties.filter(p => p !== party);
          // emergency thruster heal (the original's 50 HP prize-crew repair)
          const thr = ship.subsystems.find(s => s.type === "thruster");
          if (thr && thr.dead) { thr.dead = false; thr.hp = 50; ship.drift.active = false; }
          events.push({ tick, type: "ShipCaptured", ship: ship.id, byFaction: party.faction });
        }
      }
      ship.boardingParties = ship.boardingParties.filter(p => p.count > 0);
    }
  }

  // ----------------------------------------------------------- main loop --
  function pk(v) { return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)]; }

  // resolveTurn: the whole 10-second turn, instantly.
  // orders: { [shipId]: { move: {mode, target:[x,y,z], face?:[x,y,z]},
  //                      weapons: [{weaponIndex, second, targetShipId, targetSub?}],
  //                      board?: targetShipId } }
  // opts: { record: bool } -> include per-tick tracks for playback rendering.
  function resolveTurn(state, orders, opts) {
    opts = opts || {};
    const events = [{ tick: 0, type: "TurnStart", turn: state.turn }];
    const rngFor = (streamKey) => rngMod.makeRng(state.matchSeed, state.turn, streamKey);

    // AI plans (committed before resolution, like the original's end-of-turn planning)
    const aiMod = isNode ? require("./ai.js") : global.FT.ai;
    for (const ship of state.ships) {
      if (!ship.destroyed && ship.ai.enabled && !orders[ship.id]) {
        orders[ship.id] = aiMod.planShip(state, ship, rngFor("ai:" + ship.id));
      }
    }

    // movement planning
    for (const ship of state.ships) {
      if (ship.destroyed) continue;
      planMovement(ship, orders[ship.id]);
    }

    // weapon order index: second -> [{ship, weaponIndex, order}]
    const bySecond = new Map();
    for (const ship of state.ships) {
      const o = orders[ship.id];
      if (ship.destroyed || !o || !o.weapons) continue;
      for (const wo of o.weapons) {
        const s = Math.max(0, Math.min(CONST.TURN_SECONDS, wo.second | 0));
        if (!bySecond.has(s)) bySecond.set(s, []);
        bySecond.get(s).push({ ship, wo });
      }
    }

    const pairCooldowns = {};
    const tracks = opts.record ? [] : null;
    const prevPositions = {};
    for (const ship of state.ships) prevPositions[ship.id] = V.clone(ship.pos);

    for (let tick = 0; tick <= T; tick++) {
      // 1. kinematics
      for (const ship of state.ships) {
        if (ship.destroyed) continue;
        prevPositions[ship.id] = V.clone(ship.pos);
        ship.pos = shipPosAtTick(ship, tick);
        if (!ship.drift.active) ship.quat = Q.slerp(ship._startQuat, ship._plannedQuat, tick / T);
      }
      // 2. projectiles
      stepProjectiles(state, tick, events, rngFor);
      // 3. collisions (no-clip separation + impulse damage)
      resolveCollisions(state, tick, events, pairCooldowns, prevPositions);
      // 4. second-boundary events — including slot 10 at tick 600 (ADR-3)
      if (tick % TPS === 0) {
        const second = tick / TPS;
        // boarding initiation at second 0
        if (second === 0) {
          for (const ship of state.ships) {
            const o = orders[ship.id];
            if (ship.destroyed || !o || !o.board) continue;
            const target = state.ships.find(s => s.id === o.board);
            const cls = SHIP_CLASSES[ship.classKey];
            if (target && !target.destroyed && target.faction !== ship.faction &&
                V.dist(ship.pos, target.pos) <= cls.boardingRange && ship.marines > 0) {
              const send = Math.min(ship.marines, cls.boardingCapacity);
              ship.marines -= send;
              const existing = target.boardingParties.find(p => p.faction === ship.faction);
              if (existing) existing.count += send;
              else target.boardingParties.push({ faction: ship.faction, count: send });
              events.push({ tick, type: "BoardingStarted", from: ship.id, ship: target.id, marines: send });
            }
          }
        }
        // queued weapon fire
        const fires = bySecond.get(second) || [];
        for (const f of fires) {
          if (f.ship.destroyed) continue;
          const w = f.ship.weapons[f.wo.weaponIndex];
          if (w) fireWeapon(state, f.ship, w, f.wo, tick, events, rngFor);
        }
        // boarding combat once per second (skip second 0: parties just arrived)
        if (second > 0) boardingSecond(state, tick, events, rngFor);
      }
      // 5. record track for playback
      if (tracks) {
        tracks.push({
          tick,
          ships: state.ships.map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, q: [s.quat.x, s.quat.y, s.quat.z, s.quat.w], destroyed: s.destroyed })),
          projectiles: state.projectiles.map(p => ({ id: p.id, kind: p.kind, x: p.pos.x, y: p.pos.y, z: p.pos.z })),
        });
      }
    }

    // finalize momentum: exit tangent = target - control point (original semantics)
    for (const ship of state.ships) {
      if (ship.destroyed) continue;
      const seg = ship._seg;
      ship.lastVel = (ship.move.mode === "FULL_STOP" && ship.move.stopped && V.dist(seg.start, seg.target) < 1e-9)
        ? V.zero()
        : V.sub(seg.target, seg.cp);
      ship.quat = ship.drift.active ? ship.quat : ship._plannedQuat;
      delete ship._seg; delete ship._startQuat; delete ship._plannedQuat;
    }

    // win/lose at the turn boundary only (original behavior)
    const playerAlive = state.ships.some(s => !s.destroyed && s.isPlayer);
    const enemyAlive = state.ships.some(s => !s.destroyed && !s.isPlayer);
    if (!enemyAlive && playerAlive) state.gameOver = { winner: "player" };
    else if (!playerAlive) state.gameOver = { winner: "enemy" };
    if (state.gameOver) events.push({ tick: T, type: "GameOver", winner: state.gameOver.winner });

    state.turn += 1;

    const snapMod = isNode ? require("./snapshot.js") : global.FT.snapshot;
    const snapshot = snapMod.serialize(state);
    const hash = snapMod.hashState(state);
    return { events, snapshot, hash, tracks };
  }

  // Planning preview: the same math the sim runs — preview equals execution.
  function previewPath(ship, targetArr, mode, samples) {
    const cls = SHIP_CLASSES[ship.classKey];
    const range = mode === "FULL_SPEED" ? cls.thrusterRange * 2 : mode === "FULL_STOP" ? cls.thrusterRange * 0.5 : cls.thrusterRange;
    const target = clampToRange(ship.pos, V.v3(targetArr[0], targetArr[1], targetArr[2]), range);
    let lastVel = ship.lastVel;
    if (V.len(lastVel) < 1e-9) lastVel = V.sub(target, ship.pos);
    const cp = V.add(ship.pos, V.scale(lastVel, 1 / CONST.INERTIA_DIVISOR));
    const pts = [];
    const n = samples || 16;
    for (let i = 0; i <= n; i++) pts.push(bezier2(ship.pos, cp, target, i / n));
    return { points: pts, target };
  }

  const api = { createSkirmish, makeShip, resolveTurn, previewPath, raycastShips, CONST };
  global.FT = global.FT || {};
  global.FT.sim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
