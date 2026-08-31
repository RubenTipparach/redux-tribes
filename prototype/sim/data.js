// Game data - ported from the Unity archive's authored values
// (docs/DESIGN.md + docs/reference/DATA_AUDIT.md). All tunables live here.
(function (global) {
  "use strict";

  // A reactor breach. Hulls only, never subsystems: a breach that could reach
  // another reactor would chain, and a chain is a recursion with no bound.
  const CRITICAL_RADIUS = 14;
  const CRITICAL_DAMAGE = 140;

  const CONST = {
    TICKS_PER_SECOND: 60,
    TURN_SECONDS: 10,
    TICKS_PER_TURN: 600,        // tick indices 0..=600 inclusive (ADR-3)
    BOOST_ACCEL_MULT: 1.6,      // burn: forward thrust and top speed while boosting
    BOOST_SPEED_MULT: 1.5,
    ARRIVE_EPS: 0.35,           // "reached it" tolerance, units
    // collision (new system - no interpenetration, impulse damage)
    COLLISION_DAMAGE_K: 25.0,   // dmg = K * relNormalSpeed(units/s) * reducedMass
    COLLISION_PAIR_COOLDOWN_TICKS: 60,
    COLLISION_RESTITUTION: 0.3,
    // boarding (per second, from DiceRoller + MarineEfficiencyTable)
    BOARDING_DICE_SIDES: 6,
    BOARDING_DICE_THRESHOLD: 5, // success on 5+
    // weapon FX-derived sim constants
    CANNON_SPEED: 100,          // units / second
    CANNON_LIFE_TICKS: 120,     // 2 s
    MISSILE_LAUNCH_SPEED: 10,
    MISSILE_PURSUIT_SPEED: 20,
    MISSILE_LAUNCH_SCATTER: 5,
    MISSILE_HOP_SCATTER: 0.5,
    MISSILE_HOP_TICKS: 60,      // re-plan every 1 s
    // Tangent of a missile leg: control point = pos + lastVel / this. Missiles
    // still fly quadratic bezier hops; only the SHIP movement model was
    // replaced (ADR-14), and this constant survived that removal by name only,
    // leaving stepProjectiles dividing by undefined.
    MISSILE_INERTIA_DIVISOR: 2.5,
    MISSILE_LIFE_TICKS: 1200,   // 20 s - missiles persist across turns
    BEAM_SCATTER: 0.5,          // insideUnitCircle * 0.5 at the aim point
    PROJECTILE_RADIUS: 0.5,
  };

  // Defender kill-ratio by hull health (MarineEfficiencyTable.asset):
  // scan rows in order; every row whose threshold >= health% overwrites.
  const MARINE_TABLE = [
    { threshold: 1.01, killRatio: 2 }, // default row (> 0.75)
    { threshold: 0.75, killRatio: 2 },
    { threshold: 0.50, killRatio: 1 },
    { threshold: 0.35, killRatio: 0 },
    { threshold: 0.10, killRatio: 0 },
  ];
  function marineEfficiency(healthPercent) {
    let v = MARINE_TABLE[0].killRatio;
    for (const row of MARINE_TABLE) if (row.threshold >= healthPercent) v = row.killRatio;
    return v;
  }

  // Weapon definitions (Resources/WeaponConfig + mount multipliers).
  // dmg = base * mountMult applied at hit (beams/projectiles 5*5.5=27.5, missiles 25*1).
  const WEAPONS = {
    beam:    { kind: "beam",    dmg: 5,  mult: 5.5, range: 300, cooldownTurns: 0, arcH: [-110, 110], arcV: [-60, 60] },
    beam_station: { kind: "beam", dmg: 1, mult: 5.5, range: 300, cooldownTurns: 0, arcH: [-360, 360], arcV: [-360, 360] },
    cannon:  { kind: "cannon",  dmg: 5,  mult: 5.5, range: 200, cooldownTurns: 1, arcH: [-90, 90],  arcV: [-60, 60] },
    plasma:  { kind: "cannon",  dmg: 5,  mult: 5.5, range: 200, cooldownTurns: 1, arcH: [-90, 90],  arcV: [-60, 60] },
    missile: { kind: "missile", dmg: 25, mult: 1.0, range: 250, cooldownTurns: 1, arcH: [-360, 360], arcV: [-360, 360], batch: 2 },
  };

  // Subsystem layout: local offsets are deterministic hit-volume centers
  // (spatial damage model - the shot hits whatever volume it reaches first).
  // blockPct: share the subsystem absorbs; rest bleeds to hull.
  // Flight envelope. The movement model reads nothing else: how fast the hull
  // can be swung (per rotation axis) and how hard it can push along each of its
  // OWN axes. A main drive astern is strong, retros are weak, and the RCS that
  // shoves the hull sideways or vertically is weaker still, which is what makes
  // a ship's reachable set a lobe along its nose rather than a ball around it.
  //
  // Sized so a frigate from rest covers roughly 40 units in a 10 s turn
  // (0.5 * 0.9 * 100 = 45) and tops out near 8 u/s, keeping the scale the
  // archive's thrusterRange established.
  function flight(o) {
    return Object.assign({
      yawRate: 6,        // degrees per second about local up
      pitchRate: 4,      // degrees per second about local right
      accelFwd: 0.9,     // u/s^2 along +Z, the main drive
      accelRetro: 0.35,  // u/s^2 along -Z, retros only
      accelLat: 0.25,    // u/s^2 along local X and Y, the RCS
      maxSpeed: 8,       // u/s
    }, o || {});
  }

  // Roughly how far a ship covers in a turn from rest, accelerating then
  // cruising. Not a movement rule (the integrator is), just a cheap scalar for
  // the AI to pick engagement distances with, derived from the flight stats so
  // it cannot drift away from what the ship can really do.
  function nominalReach(fl) {
    const T = CONST.TURN_SECONDS;
    const tAccel = Math.min(T, fl.maxSpeed / fl.accelFwd);
    return 0.5 * fl.accelFwd * tAccel * tAccel + fl.maxSpeed * (T - tAccel);
  }

  // The belts sit outboard and the core sits deep amidships behind them, which
  // is the whole of the protection it gets. Nothing declares the reactor
  // shielded: a shot from abeam meets a belt because a belt is in the way, and
  // one from below does not. Geometry rather than a rule.
  function frigateSubsystems(armorBlock) {
    return [
      { id: "armor_l", type: "armor",    hp: 100, blockPct: armorBlock, offset: { x: -1.6, y: 0, z: 0.5 }, radius: 1.6 },
      { id: "armor_r", type: "armor",    hp: 100, blockPct: armorBlock, offset: { x: 1.6,  y: 0, z: 0.5 }, radius: 1.6 },
      { id: "engines", type: "thruster", hp: 100, blockPct: 60,         offset: { x: 0, y: 0, z: -2.6 },  radius: 1.4 },
      { id: "rcs",     type: "rcs",      hp: 60,  blockPct: 40,         offset: { x: 0, y: -1.0, z: 1.5 }, radius: 1.0 },
      { id: "weapons", type: "weapon",   hp: 80,  blockPct: 50,         offset: { x: 0, y: 1.0, z: 1.2 },  radius: 1.1 },
      { id: "reactor", type: "reactor",  hp: 90,  blockPct: 45,         offset: { x: 0, y: 0, z: -0.6 },   radius: 1.0 },
    ];
  }

  const SHIP_CLASSES = {
    terran_frigate: {
      name: "Terran Frigate", hull: 300, radius: 3.5, mass: 1.0,
      flight: flight({}),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => frigateSubsystems(80),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.4, z: 2.2 } },
        { key: "beam", mount: { x: -1.2, y: 0.2, z: 0.8 } },
        { key: "beam", mount: { x: 1.2, y: 0.2, z: 0.8 } },
      ],
    },
    karisen_frigate: {
      name: "Karisen Frigate", hull: 250, radius: 3.5, mass: 1.0,
      flight: flight({ yawRate: 6.5, accelFwd: 0.95, maxSpeed: 8.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => frigateSubsystems(75),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.4, z: 2.0 } },
        { key: "missile", mount: { x: 0, y: -0.3, z: 0 } },
      ],
    },
    rogue_frigate: {
      // the boarding specialist (Rogue_Ship_1.prefab: range 40, marines 40, capacity 12)
      name: "Rogue Frigate", hull: 180, radius: 3.2, mass: 0.9,
      flight: flight({ yawRate: 9, pitchRate: 6, accelFwd: 1.1, accelRetro: 0.5, accelLat: 0.4, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 40, marines: 40, marinesMax: 50, boardingCapacity: 12,
      subsystems: () => frigateSubsystems(90),
      weapons: [
        { key: "plasma", mount: { x: -0.8, y: 0.2, z: 1.5 } },
        { key: "plasma", mount: { x: 0.8, y: 0.2, z: 1.5 } },
      ],
    },
    benefactor_frigate: {
      name: "Benefactor Frigate", hull: 250, radius: 3.5, mass: 1.0,
      flight: flight({ yawRate: 5, pitchRate: 3.5, accelFwd: 0.85, accelLat: 0.22 }),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => frigateSubsystems(80),
      weapons: [
        { key: "cannon", mount: { x: -1.0, y: 0.2, z: 1.2 } },
        { key: "cannon", mount: { x: 1.0, y: 0.2, z: 1.2 } },
        { key: "missile", mount: { x: 0, y: -0.3, z: 0 } },
      ],
    },
    freighter: {
      name: "Freighter", hull: 600, radius: 4.5, mass: 2.0,
      flight: flight({ yawRate: 2.5, pitchRate: 1.5, accelFwd: 0.45, accelRetro: 0.18, accelLat: 0.10, maxSpeed: 5 }),
      thrusterRange: 30, boardingRange: 10, marines: 15, marinesMax: 50, boardingCapacity: 8,
      // No weapon bay, because the hull has no mounts to lose. A volume whose
      // loss changes nothing teaches a player the wrong lesson.
      subsystems: () => [
        { id: "engines", type: "thruster", hp: 100, blockPct: 60, offset: { x: 0, y: 0, z: -3.4 }, radius: 1.6 },
        { id: "rcs",     type: "rcs",      hp: 60,  blockPct: 40, offset: { x: 0, y: -1.2, z: 2.0 }, radius: 1.2 },
        { id: "reactor", type: "reactor",  hp: 120, blockPct: 45, offset: { x: 0, y: 0, z: -1.0 }, radius: 1.2 },
      ],
      weapons: [],
    },
  };

  const api = { CONST, WEAPONS, SHIP_CLASSES, marineEfficiency, nominalReach,
    CRITICAL_RADIUS, CRITICAL_DAMAGE };
  global.FT = global.FT || {};
  global.FT.data = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
