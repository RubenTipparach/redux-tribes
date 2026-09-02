// Game data - ported from the Unity archive's authored values
// (docs/DESIGN.md + docs/reference/DATA_AUDIT.md). All tunables live here.
(function (global) {
  "use strict";

  // A reactor breach. Hulls only, never subsystems: a breach that could reach
  // another reactor would chain, and a chain is a recursion with no bound.
  const CRITICAL_RADIUS = 14;
  const CRITICAL_DAMAGE = 140;

  // How much of a volume's mass has to be gone before it stops working.
  //
  // A hit volume is a box full of machinery, not a barrel with a health bar on
  // it: shots take it apart a piece at a time, and a drive bay missing four
  // fifths of itself is wreckage rather than a bay running at a fifth. Mirrors
  // `data::SUB_FAIL_FRAC` in the Rust core, and it has to: the two are one rule
  // with two implementations, and a rule that differs between them is a
  // reference that no longer says what the core does.
  const SUB_FAIL_FRAC = 0.20;

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

  // A volume is a BOX, in half extents about its offset. A sphere big enough
  // to hold a drive bay stands out through the plating on all six sides, and
  // six of them on a frigate overlapped into one ball with the ship inside it:
  // every aspect met a belt, so choosing one bought nothing.
  //
  // The belts are slabs down the flanks that meet over the keel, and their
  // floor sits above the reactor's ceiling. That is the whole of the reactor's
  // protection: a shot from abeam or from ahead crosses a belt because a belt
  // is in the way, and one from below passes under them. Geometry, not a rule.
  //
  // One layout, scaled to the hull it is inside. Every relation that matters
  // here is a RATIO, so one factor keeps all of them: the belts' floor above
  // the reactor's ceiling, and both of them short of the bay and the drives.
  // Mirrors `hull_subs` in `engine/sim_core/src/data.rs`.
  const FRIGATE_RADIUS = 3.5;
  /** And the freighter's, which the civil volumes were authored against. */
  const FREIGHTER_RADIUS = 4.5;
  function hullSubsystems(radius, armorBlock, hpScale) {
    // f32 throughout, because the core is f32 throughout. The reference
    // dividing in f64 and the thing it references dividing in f32 agree at
    // scale 1 (the four frigates) and part in the last bits at every other
    // rung, which is a reference that is wrong about 367 of 891 numbers while
    // looking right about all of them.
    // The literals are rounded too: `0.85` as a JS double is not the same
    // number as `0.85f32`, so the product has to be taken between two f32s to
    // land on the bits the core lands on.
    const f = Math.fround;
    const m = (a, b) => f(f(a) * b);
    const s = f(radius / FRIGATE_RADIUS), h = f(hpScale);
    return [
      { id: "armor_l", type: "armor",    hp: m(100, h), blockPct: armorBlock, offset: { x: m(-0.5, s), y: m(0.15, s), z: m(-0.3, s) }, half: { x: m(0.85, s), y: m(0.45, s), z: m(1.2, s) } },
      { id: "armor_r", type: "armor",    hp: m(100, h), blockPct: armorBlock, offset: { x: m(0.5, s),  y: m(0.15, s), z: m(-0.3, s) }, half: { x: m(0.85, s), y: m(0.45, s), z: m(1.2, s) } },
      { id: "engines", type: "thruster", hp: m(100, h), blockPct: 60,         offset: { x: 0, y: 0, z: m(-2.4, s) },      half: { x: m(0.65, s), y: m(0.45, s), z: m(0.65, s) } },
      { id: "rcs",     type: "rcs",      hp: m(60, h),  blockPct: 40,         offset: { x: 0, y: m(-0.55, s), z: m(1.5, s) },   half: { x: m(0.6, s), y: m(0.25, s), z: m(0.7, s) } },
      { id: "weapons", type: "weapon",   hp: m(80, h),  blockPct: 50,         offset: { x: 0, y: m(0.5, s), z: m(1.1, s) },     half: { x: m(0.55, s), y: m(0.3, s), z: m(0.8, s) } },
      { id: "reactor", type: "reactor",  hp: m(90, h),  blockPct: 45,         offset: { x: 0, y: 0, z: m(-0.6, s) },      half: { x: m(0.45, s), y: m(0.4, s), z: m(0.6, s) } },
    ];
  }


  /**
   * The CIVIL layout: three volumes, sized to the hull they are inside.
   *
   * No weapon bay, because a civil hull has no mounts to lose. Scaled off the
   * FREIGHTER's radius rather than the frigate's, because these offsets were
   * authored on the freighter: against 3.5 the engines reached 1.17 times the
   * hull they sit in, which is a drive bay hanging out through the stern.
   */
  function civilSubsystems(radius, hpScale) {
    const f = Math.fround;
    const m = (a, b) => f(f(a) * b);
    const s = f(radius / FREIGHTER_RADIUS), h = f(hpScale);
    return [
      { id: "engines", type: "thruster", hp: m(100, h), blockPct: 60, offset: { x: 0, y: 0, z: m(-3.3, s) },  half: { x: m(0.9, s), y: m(0.7, s), z: m(0.8, s) } },
      { id: "rcs",     type: "rcs",      hp: m(60, h),  blockPct: 40, offset: { x: 0, y: m(-1.2, s), z: m(2.0, s) }, half: { x: m(0.9, s), y: m(0.4, s), z: m(1.1, s) } },
      { id: "reactor", type: "reactor",  hp: m(120, h), blockPct: 45, offset: { x: 0, y: 0, z: m(-1.0, s) },  half: { x: m(0.8, s), y: m(0.7, s), z: m(1.0, s) } },
    ];
  }

  const SHIP_CLASSES = {
    terran_frigate: {
      name: "Terran Frigate", hull: 300, radius: 3.5, mass: 1.0,
      flight: flight({}),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => hullSubsystems(3.5, 80, 1),
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
      subsystems: () => hullSubsystems(3.5, 75, 1),
      // Three: the stock Karisen arms its port sponson, so a class that
      // carried two was a different ship from the one the yard builds.
      // Appended, not inserted: a mount index is what a fire order names.
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.4, z: 2.0 } },
        { key: "missile", mount: { x: 0, y: -0.3, z: 0 } },
        { key: "beam", mount: { x: -0.98, y: -0.33, z: -1.09 } },
      ],
    },
    rogue_frigate: {
      // the boarding specialist (Rogue_Ship_1.prefab: range 40, marines 40, capacity 12)
      name: "Rogue Frigate", hull: 180, radius: 3.2, mass: 0.9,
      flight: flight({ yawRate: 9, pitchRate: 6, accelFwd: 1.1, accelRetro: 0.5, accelLat: 0.4, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 40, marines: 40, marinesMax: 50, boardingCapacity: 12,
      subsystems: () => hullSubsystems(3.5, 90, 1),
      weapons: [
        { key: "plasma", mount: { x: -0.8, y: 0.2, z: 1.5 } },
        { key: "plasma", mount: { x: 0.8, y: 0.2, z: 1.5 } },
      ],
    },
    benefactor_frigate: {
      name: "Benefactor Frigate", hull: 250, radius: 3.5, mass: 1.0,
      flight: flight({ yawRate: 5, pitchRate: 3.5, accelFwd: 0.85, accelLat: 0.22 }),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 8,
      subsystems: () => hullSubsystems(3.5, 80, 1),
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
      subsystems: () => civilSubsystems(4.9, 1),
      weapons: [],
    },
    terran_corvette: {
      name: "Terran Corvette", hull: 125, radius: 2.5, mass: 0.55,
      flight: flight({ yawRate: 9.57, pitchRate: 6.41, accelFwd: 1.04, accelRetro: 0.69, accelLat: 0.23, maxSpeed: 8.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 5, marinesMax: 50, boardingCapacity: 2,
      subsystems: () => hullSubsystems(2.5, 80, 0.65),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.26, z: 1.49 } },
        { key: "beam", mount: { x: 0, y: 0.33, z: 0.15 } },
      ],
    },
    terran_destroyer: {
      name: "Terran Destroyer", hull: 705, radius: 5.8, mass: 2.4,
      flight: flight({ yawRate: 5.45, pitchRate: 3.65, accelFwd: 0.96, accelRetro: 0.3, accelLat: 0.2, maxSpeed: 7 }),
      thrusterRange: 40, boardingRange: 20, marines: 25, marinesMax: 50, boardingCapacity: 10,
      subsystems: () => hullSubsystems(5.8, 80, 1.9),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.57, z: 3.43 } },
        { key: "beam", mount: { x: -1.86, y: 0.29, z: 1.43 } },
        { key: "beam", mount: { x: 1.86, y: 0.29, z: 1.43 } },
        { key: "beam", mount: { x: 0, y: 0.79, z: -1.14 } },
        { key: "cannon", mount: { x: 0, y: -0.57, z: 1.86 } },
      ],
    },
    terran_cruiser: {
      name: "Terran Heavy Cruiser", hull: 1755, radius: 7.8, mass: 5.45,
      flight: flight({ yawRate: 2.32, pitchRate: 1.55, accelFwd: 0.56, accelRetro: 0.13, accelLat: 0.09, maxSpeed: 7 }),
      thrusterRange: 40, boardingRange: 30, marines: 40, marinesMax: 50, boardingCapacity: 12,
      subsystems: () => hullSubsystems(7.8, 80, 3.2),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.78, z: 5.05 } },
        { key: "beam", mount: { x: -2.62, y: 0.43, z: 2.72 } },
        { key: "beam", mount: { x: 2.62, y: 0.43, z: 2.72 } },
        { key: "beam", mount: { x: -2.62, y: 0.43, z: -0.78 } },
        { key: "beam", mount: { x: 2.62, y: 0.43, z: -0.78 } },
        { key: "beam", mount: { x: 0, y: 1.17, z: -2.53 } },
        { key: "cannon", mount: { x: 0, y: -0.82, z: 3.11 } },
        { key: "cannon", mount: { x: 0, y: -0.82, z: -1.75 } },
      ],
    },
    karisen_corvette: {
      name: "Karisen Corvette", hull: 110, radius: 2.8, mass: 0.5,
      flight: flight({ yawRate: 9.43, pitchRate: 6.32, accelFwd: 2.48, accelRetro: 0.25, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 5, marinesMax: 50, boardingCapacity: 2,
      subsystems: () => hullSubsystems(2.8, 75, 0.6),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.28, z: 1.52 } },
        { key: "missile", mount: { x: 0, y: -0.22, z: 0.22 } },
      ],
    },
    karisen_destroyer: {
      name: "Karisen Destroyer", hull: 570, radius: 5.7, mass: 1.9,
      flight: flight({ yawRate: 6.64, pitchRate: 4.45, accelFwd: 0.6, accelRetro: 0.38, maxSpeed: 8.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 20, marinesMax: 50, boardingCapacity: 6,
      subsystems: () => hullSubsystems(5.7, 75, 1.75),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.58, z: 3.35 } },
        { key: "beam", mount: { x: 0, y: 0.66, z: -0.87 } },
        { key: "missile", mount: { x: 0, y: -0.47, z: 0.87 } },
        { key: "missile", mount: { x: -1.24, y: -0.41, z: -0.29 } },
        { key: "missile", mount: { x: 1.24, y: -0.41, z: -0.29 } },
      ],
    },
    karisen_cruiser: {
      name: "Karisen Heavy Cruiser", hull: 1550, radius: 8, mass: 4.65,
      flight: flight({ yawRate: 2.63, pitchRate: 1.76, accelFwd: 0.47, accelRetro: 0.15, accelLat: 0.1, maxSpeed: 8.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 25, marinesMax: 50, boardingCapacity: 6,
      subsystems: () => hullSubsystems(8, 75, 2.9),
      weapons: [
        { key: "beam", mount: { x: 0, y: 0.84, z: 5.1 } },
        { key: "beam", mount: { x: 0, y: 0.96, z: -1.8 } },
        { key: "missile", mount: { x: 0, y: -0.68, z: 2.4 } },
        { key: "missile", mount: { x: -1.9, y: -0.6, z: 0.8 } },
        { key: "missile", mount: { x: 1.9, y: -0.6, z: 0.8 } },
        { key: "missile", mount: { x: -1.9, y: -0.6, z: -1 } },
        { key: "missile", mount: { x: 1.9, y: -0.6, z: -1 } },
        { key: "missile", mount: { x: 0, y: -0.68, z: -2.8 } },
      ],
    },
    rogue_corvette: {
      name: "Rogue Corvette", hull: 100, radius: 2.3, mass: 0.5,
      flight: flight({ yawRate: 11.7, pitchRate: 7.84, accelFwd: 1.85, accelRetro: 0.26, accelLat: 0.26, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 20, marines: 15, marinesMax: 50, boardingCapacity: 4,
      subsystems: () => hullSubsystems(2.3, 90, 0.45),
      weapons: [
        { key: "plasma", mount: { x: 0, y: 0.15, z: 1.06 } },
      ],
    },
    rogue_destroyer: {
      name: "Rogue Destroyer", hull: 350, radius: 4.5, mass: 1.45,
      flight: flight({ yawRate: 8.22, pitchRate: 5.51, accelFwd: 0.82, accelRetro: 0.5, accelLat: 0.23, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 40, marines: 45, marinesMax: 50, boardingCapacity: 14,
      subsystems: () => hullSubsystems(4.5, 90, 1.3),
      weapons: [
        { key: "plasma", mount: { x: -1.14, y: 0.3, z: 2.08 } },
        { key: "plasma", mount: { x: 1.14, y: 0.3, z: 2.08 } },
        { key: "plasma", mount: { x: 0, y: 0.6, z: -0.54 } },
      ],
    },
    rogue_cruiser: {
      name: "Rogue Heavy Cruiser", hull: 910, radius: 6.7, mass: 3.1,
      flight: flight({ yawRate: 4.95, pitchRate: 3.32, accelFwd: 0.5, accelRetro: 0.23, accelLat: 0.15, maxSpeed: 9.5 }),
      thrusterRange: 40, boardingRange: 50, marines: 70, marinesMax: 50, boardingCapacity: 16,
      subsystems: () => hullSubsystems(6.7, 90, 2.2),
      weapons: [
        { key: "plasma", mount: { x: -1.92, y: 0.44, z: 3.29 } },
        { key: "plasma", mount: { x: 1.92, y: 0.44, z: 3.29 } },
        { key: "plasma", mount: { x: -1.92, y: 0.44, z: -0.91 } },
        { key: "plasma", mount: { x: 1.92, y: 0.44, z: -0.91 } },
      ],
    },
    benefactor_corvette: {
      name: "Benefactor Corvette", hull: 110, radius: 2.4, mass: 0.45,
      flight: flight({ yawRate: 7.75, pitchRate: 5.2, accelFwd: 0.67, accelRetro: 0.8, accelLat: 0.19 }),
      thrusterRange: 40, boardingRange: 20, marines: 5, marinesMax: 50, boardingCapacity: 2,
      subsystems: () => hullSubsystems(2.4, 80, 0.7),
      weapons: [
        { key: "cannon", mount: { x: 0, y: 0.15, z: 1 } },
        { key: "missile", mount: { x: 0, y: -0.22, z: 0.15 } },
      ],
    },
    benefactor_destroyer: {
      name: "Benefactor Destroyer", hull: 770, radius: 5.7, mass: 2.5,
      flight: flight({ yawRate: 5.16, pitchRate: 3.46, accelFwd: 0.62, accelRetro: 0.28, accelLat: 0.19, maxSpeed: 7 }),
      thrusterRange: 40, boardingRange: 20, marines: 25, marinesMax: 50, boardingCapacity: 10,
      subsystems: () => hullSubsystems(5.7, 80, 2.05),
      weapons: [
        { key: "cannon", mount: { x: -1.5, y: 0.31, z: 1.93 } },
        { key: "cannon", mount: { x: 1.5, y: 0.31, z: 1.93 } },
        { key: "cannon", mount: { x: 0, y: 0.79, z: -1 } },
        { key: "missile", mount: { x: 0, y: -0.46, z: 0.14 } },
      ],
    },
    benefactor_cruiser: {
      name: "Benefactor Heavy Cruiser", hull: 2180, radius: 7.9, mass: 6.5,
      flight: flight({ yawRate: 1.92, pitchRate: 1.29, accelFwd: 0.35, accelRetro: 0.11, accelLat: 0.07, maxSpeed: 7 }),
      thrusterRange: 40, boardingRange: 30, marines: 35, marinesMax: 50, boardingCapacity: 12,
      subsystems: () => hullSubsystems(7.9, 80, 3.5),
      weapons: [
        { key: "cannon", mount: { x: -2.23, y: 0.47, z: 3.11 } },
        { key: "cannon", mount: { x: 2.23, y: 0.47, z: 3.11 } },
        { key: "cannon", mount: { x: -2.23, y: 0.47, z: -1.17 } },
        { key: "cannon", mount: { x: 2.23, y: 0.47, z: -1.17 } },
        { key: "missile", mount: { x: 0, y: -0.68, z: 1.36 } },
        { key: "missile", mount: { x: 0, y: -0.68, z: -2.14 } },
      ],
    },
    civil_lighter: {
      name: "Lighter", hull: 260, radius: 3.0, mass: 1.1,
      flight: flight({ yawRate: 3.0, pitchRate: 1.8, accelFwd: 0.60, accelRetro: 0.24, accelLat: 0.14, maxSpeed: 6 }),
      thrusterRange: 30, boardingRange: 10, marines: 5, marinesMax: 20, boardingCapacity: 4,
      subsystems: () => civilSubsystems(3.0, 0.8),
      weapons: [],
    },
    civil_hauler: {
      name: "Hauler", hull: 780, radius: 4.6, mass: 2.6,
      flight: flight({ yawRate: 2.4, pitchRate: 1.4, accelFwd: 0.45, accelRetro: 0.18, accelLat: 0.10, maxSpeed: 5 }),
      thrusterRange: 30, boardingRange: 15, marines: 10, marinesMax: 40, boardingCapacity: 6,
      subsystems: () => civilSubsystems(4.6, 1.4),
      weapons: [],
    },
    civil_boxship: {
      name: "Container Ship", hull: 1700, radius: 7.0, mass: 5.6,
      flight: flight({ yawRate: 1.6, pitchRate: 1.0, accelFwd: 0.32, accelRetro: 0.13, accelLat: 0.07, maxSpeed: 5 }),
      thrusterRange: 30, boardingRange: 20, marines: 10, marinesMax: 40, boardingCapacity: 6,
      subsystems: () => civilSubsystems(7.0, 2.4),
      weapons: [],
    },
    civil_tanker: {
      name: "Tanker", hull: 1800, radius: 7.2, mass: 6.0,
      flight: flight({ yawRate: 1.5, pitchRate: 0.9, accelFwd: 0.30, accelRetro: 0.12, accelLat: 0.07, maxSpeed: 5 }),
      thrusterRange: 30, boardingRange: 20, marines: 10, marinesMax: 40, boardingCapacity: 4,
      subsystems: () => civilSubsystems(7.2, 2.6),
      weapons: [],
    },
    civil_miner: {
      name: "Mining Ship", hull: 720, radius: 4.4, mass: 2.5,
      flight: flight({ yawRate: 2.2, pitchRate: 1.3, accelFwd: 0.42, accelRetro: 0.20, accelLat: 0.11, maxSpeed: 5 }),
      thrusterRange: 30, boardingRange: 15, marines: 10, marinesMax: 40, boardingCapacity: 6,
      subsystems: () => civilSubsystems(4.4, 1.5),
      weapons: [],
    },
    civil_liner: {
      name: "Liner", hull: 1500, radius: 7.4, mass: 5.2,
      flight: flight({ yawRate: 1.9, pitchRate: 1.2, accelFwd: 0.40, accelRetro: 0.15, accelLat: 0.09, maxSpeed: 6.5 }),
      thrusterRange: 30, boardingRange: 20, marines: 16, marinesMax: 60, boardingCapacity: 6,
      subsystems: () => civilSubsystems(7.4, 2.2),
      weapons: [],
    },
  };

  const api = { CONST, WEAPONS, SHIP_CLASSES, marineEfficiency, nominalReach,
    CRITICAL_RADIUS, CRITICAL_DAMAGE, SUB_FAIL_FRAC };
  global.FT = global.FT || {};
  global.FT.data = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
