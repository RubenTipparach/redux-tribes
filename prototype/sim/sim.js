// Fallen Tribes - headless deterministic WEGO simulation core (JS prototype).
//
// Implements the mechanics documented in docs/DESIGN.md on the turn pipeline
// of docs/ARCHITECTURE.md ADR-3/-4: a 10-second turn resolved over tick
// indices 0..=600 (601 boundary evaluations, second-slot events at tick s*60,
// slot 10 processed before the boundary), quadratic-Bezier momentum movement,
// spatial subsystem damage, no-clip collision resolution with impulse damage,
// per-second boarding dice, and a seeded per-turn RNG. Pure data in, pure
// data out: resolveTurn(state, orders) -> { state', events, hash, tracks? }.
//
// No engine, no DOM, no Node APIs - runs identically headless and in-browser.
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
      vel: V.zero(),                // units per SECOND, carried across turns
      flight: Object.assign({}, cls.flight),   // per ship so it can be tuned live
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
          const coastVel = ship._flight ? shipVelAtTick(ship, tick) : V.clone(ship.vel);
          ship.drift = { active: true, dir: V.clone(coastVel) };
          // the rest of this turn is unpowered from right here
          if (ship._flight) replanAfterCollision(ship, tick, coastVel);
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

  // ---------------------------------------------------------- flight model --
  // Movement is a rate limited attitude plus per local axis thrust, integrated
  // against carried velocity. There is no curve fitting and no closed form:
  // where a ship can get to this turn is whatever this loop can fly it to.
  //
  // Three things restrict it, and only these three:
  //   1. rotation stats     yawRate and pitchRate cap how fast the hull swings,
  //                         so a heading you cannot reach is thrust you cannot
  //                         apply.
  //   2. local axis limits  accelFwd / accelRetro / accelLat are applied in the
  //                         ship's OWN frame. The main drive is strong astern,
  //                         retros weak, RCS weaker, so pushing sideways costs
  //                         several times what pushing forward does.
  //   3. carried velocity   momentum survives the turn boundary, so every plan
  //                         starts from where the last one left the ship going.
  //
  // The consequence, and the point of the exercise: the reachable set is a lobe
  // off the nose displaced downrange by momentum, not a sphere around the hull.

  const DT = 1 / TPS;                       // seconds per tick

  function clampLen(v, max) {
    const l = V.len(v);
    return l > max && l > 1e-12 ? V.scale(v, max / l) : v;
  }

  // Swing the hull toward `want`, spending at most yawRate/pitchRate this tick.
  // The error is resolved in the BODY frame so the two axes are limited
  // separately, which is what makes a sluggish nose feel different from a
  // sluggish pitch rather than just "slow".
  function rotateToward(quat, want, fl, dt) {
    const local = Q.rot(Q.inv(quat), want);          // desired forward, body frame
    const flat = Math.sqrt(local.x * local.x + local.z * local.z);
    let yawErr = dmath.datan2(local.x, local.z);
    let pitchErr = dmath.datan2(local.y, flat < 1e-9 ? 1e-9 : flat);
    const maxYaw = fl.yawRate * Math.PI / 180 * dt;
    const maxPitch = fl.pitchRate * Math.PI / 180 * dt;
    yawErr = Math.max(-maxYaw, Math.min(maxYaw, yawErr));
    pitchErr = Math.max(-maxPitch, Math.min(maxPitch, pitchErr));
    let q = Q.mul(quat, Q.axisAngle(V.v3(0, 1, 0), yawErr));
    q = Q.mul(q, Q.axisAngle(V.v3(1, 0, 0), pitchErr));
    return Q.norm(q);
  }

  // The velocity the controller wants this tick, before the hull gets a say.
  function desiredVelocity(pos, vel, target, secondsLeft, fl, mode) {
    if (mode === "FULL_STOP") return V.zero();
    if (mode === "FULL_SPEED") return null;          // handled as pure burn
    const aim = V.sub(target, pos);
    const dist = V.len(aim);
    if (dist < CONST.ARRIVE_EPS) return V.zero();
    const t = Math.max(secondsLeft, 1e-3);
    return clampLen(V.scale(aim, 1 / t), fl.maxSpeed);
  }

  // One tick of flight. Returns the new {pos, vel, quat}.
  function stepFlight(pos, vel, quat, target, secondsLeft, fl, mode, faceDir, dt) {
    dt = dt || DT;
    const boosting = mode === "FULL_SPEED";
    const accelFwd = fl.accelFwd * (boosting ? CONST.BOOST_ACCEL_MULT : 1);
    const topSpeed = fl.maxSpeed * (boosting ? CONST.BOOST_SPEED_MULT : 1);

    // what change in velocity we would like
    let dv;
    if (boosting) {
      dv = V.scale(Q.forward(quat), accelFwd * dt);  // straight burn, no seeking
    } else {
      const want = desiredVelocity(pos, vel, target, secondsLeft, fl, mode);
      dv = V.sub(want, vel);
    }

    // Point the hull. MOVE_AND_TURN aims the nose where thrust is needed, which
    // is the most manoeuvrable thing a ship can do. TURN_SLIDE holds a commanded
    // heading instead, so course changes are left to the RCS: a far smaller
    // envelope, bought in exchange for keeping the guns on a bearing.
    let aimDir;
    if (mode === "TURN_SLIDE" && faceDir) aimDir = faceDir;
    else if (boosting) aimDir = V.len(vel) > 1e-6 ? V.norm(vel) : Q.forward(quat);
    else if (V.len(dv) > 1e-6) aimDir = V.norm(dv);
    else aimDir = Q.forward(quat);
    quat = rotateToward(quat, aimDir, fl, dt);

    // Spend thrust in the ship's own frame, one budget per axis.
    const local = Q.rot(Q.inv(quat), dv);
    const zCap = local.z >= 0 ? accelFwd * dt : fl.accelRetro * dt;
    const latCap = fl.accelLat * dt;
    const applied = V.v3(
      Math.max(-latCap, Math.min(latCap, local.x)),
      Math.max(-latCap, Math.min(latCap, local.y)),
      Math.max(-zCap, Math.min(zCap, local.z)));
    vel = clampLen(V.add(vel, Q.rot(quat, applied)), topSpeed);
    pos = V.add(pos, V.scale(vel, dt));
    return { pos, vel, quat };
  }

  // Fly a whole turn (or the tail of one) and record every tick. Ships read
  // their position and attitude straight out of this, so what the planner
  // previews and what the resolver executes are the same array.
  function flyTurn(ship, targetArr, mode, opts) {
    opts = opts || {};
    const fl = ship.flight || SHIP_CLASSES[ship.classKey].flight;
    const fromTick = opts.fromTick || 0;
    // steps: how many integration slices the remaining turn is cut into.
    // Resolution always uses one per tick. A probe may ask for fewer.
    const steps = opts.steps || (T - fromTick);
    const sub = (T - fromTick) / steps;          // ticks per slice
    const dt = sub * DT;
    let pos = opts.pos ? V.clone(opts.pos) : V.clone(ship.pos);
    let vel = opts.vel ? V.clone(opts.vel) : V.clone(ship.vel || V.zero());
    let quat = opts.quat || ship.quat;
    // A slide with no commanded heading holds the one the ship already has:
    // that is what decoupling the nose from the course means, and it is what
    // hands the course over to the weak lateral thrusters.
    const faceDir = (opts.face && V.len(V.v3(opts.face[0], opts.face[1], opts.face[2])) > 1e-6)
      ? V.norm(V.v3(opts.face[0], opts.face[1], opts.face[2]))
      : Q.forward(quat);
    const target = targetArr
      ? V.v3(targetArr[0], targetArr[1], targetArr[2])
      : V.add(pos, V.scale(vel, CONST.TURN_SECONDS));   // no order: hold course

    // engines dead: no thrust, no attitude authority, just coast
    const dead = ship.drift.active;
    const path = [{ pos: V.clone(pos), quat }];
    for (let i = 0; i < steps; i++) {
      if (dead) {
        pos = V.add(pos, V.scale(vel, dt));
      } else {
        const secondsLeft = (steps - i) * dt;
        const r = stepFlight(pos, vel, quat, target, secondsLeft, fl, mode, faceDir, dt);
        pos = r.pos; vel = r.vel; quat = r.quat;
      }
      path.push({ pos: V.clone(pos), quat });
    }
    return { path, endPos: pos, endVel: vel, endQuat: quat, fromTick,
             target: targetArr || null, face: opts.face || null };
  }

  // Build this turn's flight plan for a ship from its order.
  function planMovement(ship, order) {
    const mv = ship.move;
    let mode = (order && order.move && order.move.mode) || "MOVE_AND_TURN";
    if (ship.drift.active) mode = "DRIFT";

    // the boost gate, unchanged: a burn needs a prior MOVE_AND_TURN, unspent
    if (mode === "FULL_SPEED" && !(mv.lastMode === "MOVE_AND_TURN" && !mv.hasBoosted && !mv.stopped)) {
      mode = "MOVE_AND_TURN";
    }
    if (mode === "FULL_SPEED") mv.hasBoosted = true;
    else if (mode === "FULL_STOP") mv.stopped = true;
    else if (mode !== "DRIFT") { mv.stopped = false; mv.hasBoosted = false; }

    ship._flight = flyTurn(ship, order && order.move && order.move.target, mode, {
      face: order && order.move && order.move.face,
    });
    mv.lastMode = mode === "DRIFT" ? mv.lastMode : mode;
    mv.mode = mode;
  }

  function shipPosAtTick(ship, tick) {
    const f = ship._flight;
    const i = Math.max(0, Math.min(f.path.length - 1, tick - f.fromTick));
    return V.clone(f.path[i].pos);
  }
  function shipVelAtTick(ship, tick) {
    const f = ship._flight;
    const i = Math.max(0, Math.min(f.path.length - 2, tick - f.fromTick));
    return V.scale(V.sub(f.path[i + 1].pos, f.path[i].pos), TPS);
  }
  function shipQuatAtTick(ship, tick) {
    const f = ship._flight;
    const i = Math.max(0, Math.min(f.path.length - 1, tick - f.fromTick));
    return f.path[i].quat;
  }

  // Re-fly the remainder of the turn after a collision changed the velocity.
  // The order still stands, so the ship keeps trying for the same destination
  // from wherever the contact left it.
  function replanAfterCollision(ship, tick, exitVel) {
    const prev = ship._flight;
    const target = prev.target || null;
    ship._flight = flyTurn(ship, target, ship.move.mode, {
      fromTick: tick, pos: ship.pos, vel: exitVel, quat: ship.quat, face: prev.face,
    });
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
    // aim point: targeted subsystem volume, else target hull center (live position - original behavior)
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

        // positional correction: separate fully this tick - never interpenetrate
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
        if (!A.destroyed) replanAfterCollision(A, tick, vA2);
        if (!B.destroyed) replanAfterCollision(B, tick, vB2);
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
    // Apply the planning-time target selection from the ORDER, not from having
    // run the planner. Orders that arrive from a replay or from the wire carry
    // aiTarget too, so this reproduces identically whether the AI was run here
    // or the decision was made on another machine last turn.
    for (const ship of state.ships) {
      const o = orders[ship.id];
      if (o && o.aiTarget) ship.ai.targetId = o.aiTarget;
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
        if (!ship.drift.active) ship.quat = shipQuatAtTick(ship, tick);
      }
      // 2. projectiles
      stepProjectiles(state, tick, events, rngFor);
      // 3. collisions (no-clip separation + impulse damage)
      resolveCollisions(state, tick, events, pairCooldowns, prevPositions);
      // 4. second-boundary events - including slot 10 at tick 600 (ADR-3)
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
      // momentum carries: the turn ends with whatever the integrator produced
      ship.vel = V.clone(ship._flight.endVel);
      if (!ship.drift.active) ship.quat = ship._flight.endQuat;
      delete ship._flight;
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

  // Where a mode will actually put the ship this turn. There is no formula to
  // consult: the only way to know is to fly it, so this flies it. Both the
  // resolver and the planner come through here, which is what keeps the drawn
  // preview and the executed turn the same thing.
  //
  // "committed" now means something sharper than it used to: a mode whose
  // outcome the destination cannot influence at all.
  function plannedTarget(ship, targetArr, mode, face) {
    const mv = ship.move;
    let m = mode || "MOVE_AND_TURN";
    if (ship.drift.active) m = "DRIFT";
    if (m === "FULL_SPEED" && !(mv.lastMode === "MOVE_AND_TURN" && !mv.hasBoosted && !mv.stopped)) {
      m = "MOVE_AND_TURN";
    }
    const committed = (m === "FULL_SPEED" || m === "FULL_STOP" || m === "DRIFT");
    const flown = flyTurn(ship, committed ? null : targetArr, m, { face });
    return { target: flown.endPos, mode: m, committed, endVel: flown.endVel, endQuat: flown.endQuat };
  }

  // Planning preview: the exact tick path the resolver will execute.
  function previewPath(ship, targetArr, mode, samples, face) {
    const mv = ship.move;
    let m = mode || "MOVE_AND_TURN";
    if (ship.drift.active) m = "DRIFT";
    if (m === "FULL_SPEED" && !(mv.lastMode === "MOVE_AND_TURN" && !mv.hasBoosted && !mv.stopped)) {
      m = "MOVE_AND_TURN";
    }
    const committed = (m === "FULL_SPEED" || m === "FULL_STOP" || m === "DRIFT");
    // The facing order has to reach the integrator or a Slide preview flies with
    // the heading the ship already has, which makes the widget look inert.
    const flown = flyTurn(ship, committed ? null : targetArr, m, { face });
    const n = samples || 16;
    const pts = [], quats = [];
    for (let i = 0; i <= n; i++) {
      const k = Math.round(i / n * (flown.path.length - 1));
      pts.push(V.clone(flown.path[k].pos));
      quats.push(flown.path[k].quat);
    }
    return {
      points: pts, quats, target: flown.endPos, endQuat: flown.endQuat,
      mode: m, committed, endVel: flown.endVel,
    };
  }

  // Can this ship finish the turn within `eps` of the given point? This is the
  // reachability oracle the planner draws its envelope from: no assumed shape,
  // just the integrator asked a yes or no question.
  function canReach(ship, targetArr, mode, eps, steps, face) {
    const flown = flyTurn(ship, targetArr, mode, { steps: steps || 60, face });
    return V.dist(flown.endPos, V.v3(targetArr[0], targetArr[1], targetArr[2])) <= (eps || CONST.ARRIVE_EPS);
  }

  const api = {
    createSkirmish, makeShip, resolveTurn,
    previewPath, plannedTarget, canReach, flyTurn,
    raycastShips, CONST,
  };
  global.FT = global.FT || {};
  global.FT.sim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
