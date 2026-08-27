// Deterministic seeded RNG — sfc32 seeded via splitmix32.
// Per-turn, stream-split: rng = makeRng(matchSeed, turnIndex, streamId)
// so replays can seek to any turn and one consumer never perturbs another.
// (Prototype of ARCHITECTURE ADR-4's RNG policy.)
(function (global) {
  "use strict";

  function splitmix32(a) {
    return function () {
      a |= 0; a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      return ((t = t ^ (t >>> 15)) >>> 0);
    };
  }

  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      const t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      const out = (t + d) | 0;
      c = (c + out) | 0;
      return (out >>> 0);
    };
  }

  // FNV-1a 32-bit over a string — used to mix seeds and stream keys.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function makeRng(matchSeed, turnIndex, streamKey) {
    const base = splitmix32((fnv1a(String(matchSeed)) ^ Math.imul(turnIndex | 0, 0x9e3779b1) ^ fnv1a(String(streamKey))) | 0);
    const rng = sfc32(base(), base(), base(), base());
    // warm up
    for (let i = 0; i < 8; i++) rng();
    return {
      // uniform in [0, 1)
      float() { return rng() / 4294967296; },
      // uniform in [lo, hi)
      range(lo, hi) { return lo + (hi - lo) * (rng() / 4294967296); },
      // integer in [lo, hi)  (hi exclusive, like Unity's int Random.Range)
      int(lo, hi) { return lo + (rng() % Math.max(1, (hi - lo))); },
      // d6-style: roll n dice of `sides`, count results >= threshold
      rollDice(n, sides, threshold) {
        let successes = 0;
        for (let i = 0; i < n; i++) if (1 + (rng() % sides) >= threshold) successes++;
        return successes;
      },
      // point in/on spheres for scatter (rejection-free: normalized gaussian-ish via trig-free method)
      onUnitSphere(V) {
        // deterministic: z uniform in [-1,1], azimuth via unit circle from two uniforms (no trig)
        const z = this.range(-1, 1);
        // pick direction on circle by rejection sampling a unit disc (deterministic loop)
        let x = 0, y = 0, l = 0;
        do { x = this.range(-1, 1); y = this.range(-1, 1); l = x * x + y * y; } while (l < 1e-12 || l > 1);
        const inv = Math.sqrt((1 - z * z) / l);
        return V.v3(x * inv, y * inv, z);
      },
      insideUnitSphere(V) {
        const dir = this.onUnitSphere(V);
        const r = Math.cbrt(this.float());
        return V.scale(dir, r);
      },
      insideUnitCircleXY(V) {
        let x = 0, y = 0, l = 0;
        do { x = this.range(-1, 1); y = this.range(-1, 1); l = x * x + y * y; } while (l > 1);
        return V.v3(x, y, 0);
      },
    };
  }

  const api = { makeRng, fnv1a };
  global.FT = global.FT || {};
  global.FT.rng = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
