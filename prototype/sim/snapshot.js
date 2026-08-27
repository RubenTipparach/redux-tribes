// Turn-boundary snapshots + deterministic state hashing (ADR-5 prototype).
// Serialization is plain JSON-able data; the hash walks a canonical flat
// number/string stream (float bit patterns via Float64Array), so two states
// hash equal iff they are bit-identical — the lockstep divergence detector.
(function (global) {
  "use strict";

  function serialize(state) {
    return JSON.parse(JSON.stringify({
      matchSeed: state.matchSeed,
      turn: state.turn,
      gameOver: state.gameOver,
      nextProjId: state.nextProjId,
      ships: state.ships.map(s => ({
        id: s.id, classKey: s.classKey, faction: s.faction, isPlayer: s.isPlayer,
        pos: s.pos, quat: s.quat, lastVel: s.lastVel,
        hull: s.hull, hullMax: s.hullMax,
        subsystems: s.subsystems.map(x => ({ id: x.id, type: x.type, hp: x.hp, maxHp: x.maxHp, blockPct: x.blockPct, offset: x.offset, radius: x.radius, dead: x.dead })),
        weapons: s.weapons.map(w => ({ key: w.key, mount: w.mount, lastFiredTurn: w.lastFiredTurn })),
        marines: s.marines, boardingParties: s.boardingParties,
        drift: s.drift, move: s.move, destroyed: s.destroyed, ai: s.ai,
      })),
      projectiles: state.projectiles.map(p => ({ ...p })),
    }));
  }

  function restore(snapshot) {
    // snapshots are plain data; a deep clone IS a live state
    return JSON.parse(JSON.stringify(snapshot));
  }

  // --- canonical hash ------------------------------------------------------
  const f64 = new Float64Array(1);
  const u8 = new Uint8Array(f64.buffer);

  function makeHasher() {
    let h1 = 0x811c9dc5, h2 = 0xc9dc5118;
    function byte(b) {
      h1 ^= b; h1 = Math.imul(h1, 0x01000193);
      h2 ^= b; h2 = Math.imul(h2, 0x01000197);
    }
    return {
      num(x) {
        f64[0] = x;
        for (let i = 0; i < 8; i++) byte(u8[i]);
      },
      str(s) {
        byte(0xff);
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); byte(c & 0xff); byte((c >> 8) & 0xff); }
      },
      hex() {
        return ((h1 >>> 0).toString(16).padStart(8, "0")) + ((h2 >>> 0).toString(16).padStart(8, "0"));
      },
    };
  }

  function hashState(state) {
    const H = makeHasher();
    H.str(String(state.matchSeed)); H.num(state.turn);
    H.str(state.gameOver ? state.gameOver.winner : "-");
    H.num(state.nextProjId);
    for (const s of state.ships) {
      H.str(s.id); H.str(s.faction); H.num(s.isPlayer ? 1 : 0); H.num(s.destroyed ? 1 : 0);
      H.num(s.pos.x); H.num(s.pos.y); H.num(s.pos.z);
      H.num(s.quat.x); H.num(s.quat.y); H.num(s.quat.z); H.num(s.quat.w);
      H.num(s.lastVel.x); H.num(s.lastVel.y); H.num(s.lastVel.z);
      H.num(s.hull); H.num(s.marines);
      for (const x of s.subsystems) { H.str(x.id); H.num(x.hp); H.num(x.dead ? 1 : 0); }
      for (const w of s.weapons) { H.str(w.key); H.num(w.lastFiredTurn); }
      for (const p of s.boardingParties) { H.str(p.faction); H.num(p.count); }
      H.num(s.drift.active ? 1 : 0); H.num(s.drift.dir.x); H.num(s.drift.dir.y); H.num(s.drift.dir.z);
      H.str(s.move.mode); H.num(s.move.hasBoosted ? 1 : 0); H.num(s.move.stopped ? 1 : 0);
      H.str(s.ai.targetId || "-");
    }
    for (const p of state.projectiles) {
      H.num(p.id); H.str(p.kind); H.str(p.owner);
      H.num(p.pos.x); H.num(p.pos.y); H.num(p.pos.z); H.num(p.life);
    }
    return H.hex();
  }

  const api = { serialize, restore, hashState };
  global.FT = global.FT || {};
  global.FT.snapshot = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
