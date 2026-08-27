// AI - a port of BaseAIController.DoAIStuff (docs/DESIGN.md §5):
// one decision procedure per turn issuing the same orders a player would.
(function (global) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const dmath = isNode ? require("./dmath.js") : global.FT.dmath;
  const data = isNode ? require("./data.js") : global.FT.data;
  const { V } = dmath;
  const { SHIP_CLASSES } = data;

  function planShip(state, ship, rng) {
    const cls = SHIP_CLASSES[ship.classKey];
    const enemies = state.ships.filter(s => !s.destroyed && s.faction !== ship.faction);
    if (enemies.length === 0) return { move: { mode: "MOVE_AND_TURN" } };

    // target: keep retaliation target if alive, else FIRST live enemy
    // (registration order - kill priority is emergent, like the original).
    //
    // The choice is REPORTED in the order rather than written onto the ship
    // here. Planning must not mutate state: a client replaying a stored turn,
    // or receiving these orders over the wire, never calls planShip, so a
    // side effect written here would exist on one machine and not the other
    // and the state hashes would diverge (ADR-6). resolveTurn applies
    // order.aiTarget on every path instead.
    let target = ship.ai.targetId ? enemies.find(e => e.id === ship.ai.targetId) : null;
    if (!target) target = enemies[0];

    // chase boost: if target beyond range, AI gets extra reach (the AIBoost cheat)
    const dist = V.dist(ship.pos, target.pos);
    let range = cls.thrusterRange;
    if (ship.ai.canChase && dist > range) range = range + 20;

    // destination: random point on a sphere around the target (25%..100% of range)
    const radial = rng.onUnitSphere(V);
    const orbit = rng.range(0.25 * range, range);
    const dest = V.add(target.pos, V.scale(radial, orbit));

    // face the target's current position (snap-rotation approximation)
    const face = V.norm(V.sub(target.pos, ship.pos));

    // weapons: one random second 1..8; below fireProbability 0.2 the AI
    // deterministically queues only weapon[0] (the shipped low-aggression branch)
    const second = rng.int(1, 9);
    const weapons = [];
    for (let i = 0; i < ship.weapons.length; i++) {
      if (ship.ai.fireProbability < 0.2) {
        if (i === 0) weapons.push({ weaponIndex: 0, second, targetShipId: target.id });
      } else if (rng.float() < ship.ai.fireProbability) {
        weapons.push({ weaponIndex: i, second, targetShipId: target.id });
      }
    }

    // boarding-specialist behavior: rogue-class AI boards when close and healthy
    let board;
    if (cls.boardingRange >= 40 && ship.marines > cls.boardingCapacity && dist <= cls.boardingRange) {
      board = target.id;
    }

    return {
      move: { mode: "MOVE_AND_TURN", target: [dest.x, dest.y, dest.z], face: [face.x, face.y, face.z] },
      weapons,
      board,
      aiTarget: target.id,
    };
  }

  const api = { planShip };
  global.FT = global.FT || {};
  global.FT.ai = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
