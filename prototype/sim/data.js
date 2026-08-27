// Game data - ported from the Unity archive's authored values
// (docs/DESIGN.md + docs/reference/DATA_AUDIT.md). All tunables live here.
(function (global) {
  "use strict";

  const CONST = {
    TICKS_PER_SECOND: 60,
    TURN_SECONDS: 10,
    TICKS_PER_TURN: 600,        // tick indices 0..=600 inclusive (ADR-3)
    INERTIA_DIVISOR: 2.5,       // bezier control point = pos + lastVel / 2.5
    DRIFT_FACTOR: 0.25,         // engines-dead drift = last offset * 0.25
    BOOST_MULT: 2.0,
    FULLSTOP_MULT: 0.5,
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
  function frigateSubsystems(armorBlock) {
    return [
      { id: "armor_l", type: "armor",    hp: 100, blockPct: armorBlock, offset: { x: -1.6, y: 0, z: 0.5 }, radius: 1.6 },
      { id: "armor_r", type: "armor",    hp: 100, blockPct: armorBlock, offset: { x: 1.6,  y: 0, z: 0.5 }, radius: 1.6 },
      { id: "engines", type: "thruster", hp: 100, blockPct: 60,         offset: { x: 0, y: 0, z: -2.6 },  radius: 1.4 },
    ];
  }

  const SHIP_CLASSES = {
    terran_frigate: {
      name: "Terran Frigate", hull: 300, radius: 3.5, mass: 1.0,
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
      thrusterRange: 40, boardingRange: 40, marines: 40, marinesMax: 50, boardingCapacity: 12,
      subsystems: () => frigateSubsystems(90),
      weapons: [
        { key: "plasma", mount: { x: -0.8, y: 0.2, z: 1.5 } },
        { key: "plasma", mount: { x: 0.8, y: 0.2, z: 1.5 } },
      ],
    },
    benefactor_frigate: {
      name: "Benefactor Frigate", hull: 250, radius: 3.5, mass: 1.0,
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
      thrusterRange: 30, boardingRange: 10, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => [
        { id: "engines", type: "thruster", hp: 100, blockPct: 60, offset: { x: 0, y: 0, z: -3.4 }, radius: 1.6 },
      ],
      weapons: [],
    },
  };

  const api = { CONST, WEAPONS, SHIP_CLASSES, marineEfficiency };
  global.FT = global.FT || {};
  global.FT.data = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
