# Fallen Tribes — Headless Sim Prototype (JavaScript)

A dependency-free prototype of the game's deterministic WEGO simulation core, built to
validate the gameplay and the sim architecture **before** committing to a tech stack.
It implements the mechanics reconstructed in [`../docs/DESIGN.md`](../docs/DESIGN.md)
on the turn pipeline decided in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
(ADR-2 sim/render split, ADR-3 tick model, ADR-4 determinism + collision, ADR-5
snapshots, ADR-6 lockstep). The exact same files run headless in Node and in the
browser — the harness is just a consumer of the sim's events and tracks.

## Run it

```
node prototype/cli.js          # self-tests + a demo AI-vs-AI battle
node prototype/cli.js test     # tests only (11 checks)
node prototype/cli.js demo     # demo battle only
```

Browser: open `prototype/harness.html` (or serve the folder — `npx serve prototype`).
Rebuild the single-file bundle with `python3 prototype/tools/bundle.py out.html`.

## What's implemented

- **Turn pipeline (ADR-3):** 10-second turns over tick indices 0..=600; second-slot
  events at tick `s*60`, slot 10 processed before the boundary (the Unity slot-10
  loss bug is impossible by construction — there's a test for it).
- **Movement (DESIGN §3):** quadratic Bézier with the momentum control point
  (`pos + lastVel/2.5`), cross-turn tangent carry, slerp rotation, the four move
  modes with their gates (boost ×2 locked straight after a normal move; staged full
  stop; slide), drift ×0.25 with frozen rotation on engine death.
  `previewPath` is the same math the sim runs — preview equals execution.
- **Weapons (DESIGN §4):** per-second fire slots; beams (hitscan, scatter, arc+range
  gate at the moment of firing), cannon-class projectiles (100 u/s swept segments,
  persist across turns), homing missiles (1 s Bézier legs with launch/pursuit
  scatter, volleys of 2, 20 s life). Authored stats: beams 27.5 effective
  (5 × 5.5 mount multiplier), missiles 25, ranges 300/200/250.
- **Spatial damage:** subsystems are hit volumes at real offsets — bow armor blocks
  shots from the front, engines are only sniped from astern; block percentages per
  the audit (armor 75–90, thrusters 60); armor volumes vanish on death; thruster
  death ⇒ drift.
- **Collision (req 13 / ADR-4):** no-interpenetration positional separation with
  mass weighting, impulse ram damage (`K × relSpeed × reducedMass`) with a per-pair
  cooldown, restitution bounce, and post-contact re-planning toward the ordered
  endpoint. A test asserts hulls never overlap through a head-on ram.
- **Boarding (DESIGN §4.4):** per-second opposed d6 (success 5+), the marine
  efficiency table keyed on defender hull %, capture with faction flip and the
  50 HP prize-crew engine repair. The Rogue frigate carries its authored
  boarding-specialist stats (range 40, 40 marines, capacity 12).
- **AI (DESIGN §5):** the ported decision procedure — first-live-enemy targeting,
  retaliation on damage, chase boost, random orbit destinations, one random fire
  second 1–8, the `fireProbability < 0.2` primary-weapon-only branch.
- **Determinism (ADR-4/-6):** seeded per-turn stream-split RNG (sfc32); a
  deterministic math module (`dmath.js`) replacing `Math.sin/cos/atan` (which are
  engine-specific in JS, the same way platform libm is in native code); canonical
  state hashing over float bit patterns; per-turn boundary snapshots that re-simulate
  to identical hashes (tested). Orders in → identical state out, on any machine:
  the lockstep contract.

  **Verified cross-client:** `prototype/tools/xclient-check.js` resolves an identical
  order sequence (collision-heavy, with boarding and a boost) in **Node and in
  Chromium** — separate processes, separate runtime instances — and compares
  per-turn hashes. They match. The rule the sim obeys: only IEEE-exact operations
  (`+ - * /`, `sqrt`, comparisons, `Math.abs/floor/min/max/imul`) touch simulation
  state; everything transcendental goes through `dmath.js` polynomials, and even
  `Math.cbrt` is banned (rejection sampling replaces it in `insideUnitSphere`).

## What's deliberately out of scope

Campaign layer, stealth/vision cones, mission goal trees beyond destroy-all,
shields (a design intent, not a shipped system), terrain/obstacles, sound, and all
visual fidelity — the harness is a debug view, not the game's look. Cooldown note:
the Unity arithmetic makes cooldown 0 and 1 both fire every turn; preserved, with a
one-shot-per-weapon-per-turn guard.

## Why JS here, when the docs say Rust?

This is the ADR-2 bet made cheap: the sim is pure data-in/data-out with no engine,
so the *mechanics* can be reviewed and tuned now, and the port to `sim_core` (Rust)
is a transliteration — every file here maps 1:1 to a planned crate module
(`rng.js` → seeded PCG streams, `dmath.js` → glam+libm, `sim.js` → `step()`,
`snapshot.js` → postcard snapshots + xxhash). If the review changes mechanics,
it changes this file set first, at zero engine cost.
