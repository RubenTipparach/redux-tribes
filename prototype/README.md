# Fallen Tribes - Headless Sim Prototype (JavaScript)

A dependency-free prototype of the game's deterministic WEGO simulation core, built to
validate the gameplay and the sim architecture **before** committing to a tech stack.
It implements the mechanics reconstructed in [`../docs/DESIGN.md`](../docs/DESIGN.md)
on the turn pipeline decided in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
(ADR-2 sim/render split, ADR-3 tick model, ADR-4 determinism + collision, ADR-5
snapshots, ADR-6 lockstep). The exact same files run headless in Node and in the
browser - the harness is just a consumer of the sim's events and tracks.

## Run it

```
node prototype/cli.js          # self-tests + a demo AI-vs-AI battle
node prototype/cli.js test     # tests only (11 checks)
node prototype/cli.js demo     # demo battle only
```

Browser: open `prototype/harness.html` (or serve the folder - `npx serve prototype`).
Rebuild the single-file bundle with `python3 prototype/tools/bundle.py out.html`.

### The view

The harness renders in 3D (three.js, vendored, no network). The sim was always
3D: every position is x/y/z and weapons have vertical arcs. The old top-down
canvas flattened that, which hid the thing the prototype exists to judge.

**The movement envelope.** Select a ship and the volume it can reach this turn
is drawn as a point cloud, with the exact reachable set outlined by three great
circles. That volume is *probed from the sim*, never drawn from a formula:
every candidate cell is put through `sim.plannedTarget`, the same call the turn
resolver uses, and kept only if the planner hands the point back unchanged. So
the drawing cannot drift from the rules, and when the movement model changes
the shape changes with it.

**The elevation slice.** The working altitude is one plane doing two jobs: a
drag places the destination on it, and the envelope is sliced at it. `Q`/`E`
raise and lower it, and the green disc is the spherical slice, radius
`sqrt(R^2 - dy^2)`. Climbing 20 units off the hull on a 40 unit envelope leaves
a 34.6 unit disc, which is 75% of the lateral room you had at hull level. The
readout gives that as a closed form volume and as a numerical integral over the
accepted cells, which agree to about 1%.

**Per mode.** The envelope is not the same shape for every order, which is the
whole point of probing rather than assuming:

| mode | envelope |
| --- | --- |
| Move | sphere, radius 40; heading coupled to travel |
| Slide | same sphere; heading decoupled, yours to set |
| Boost | a single committed point, 80 units along carried momentum |
| Stop | a single committed point at half carried momentum |

### Controls

Input goes through Pointer Events, so one code path serves mouse, pen and
touch, and the harness runs on a phone as well as a desktop.

| | desktop | touch |
| --- | --- | --- |
| place destination | drag in empty space | one finger drag |
| working altitude, and so the slice | `Q` / `E` | the pad's up and down |
| rotate heading | drag the white pip, or shift-drag | drag the pip (wider hit radius on a coarse pointer) |
| select / target | click a ship | tap a ship, or a row in the Ships sheet |
| orbit | right button drag | two finger drag |
| zoom | wheel | pinch |
| 15 degree yaw, face target | `A`/`D`, `F` | the round pad at the right edge |
| frame the fleet and its envelope | `Fit view` | `Fit view` in the tab bar |

Below 900px the three pane console collapses: the side rails become bottom
sheets on a tab bar, and the fire slot strip scrolls. Held sideways (under
560px tall) the tab bar stands up as a left rail and the sheets slide in from
the side, since a landscape phone has height to spare nowhere else.

## What's implemented

- **Turn pipeline (ADR-3):** 10-second turns over tick indices 0..=600; second-slot
  events at tick `s*60`, slot 10 processed before the boundary (the Unity slot-10
  loss bug is impossible by construction - there's a test for it).
- **Movement (DESIGN §3):** quadratic Bézier with the momentum control point
  (`pos + lastVel/2.5`), cross-turn tangent carry, slerp rotation, the four move
  modes with their gates (boost ×2 locked straight after a normal move; staged full
  stop; slide), drift ×0.25 with frozen rotation on engine death.
  `previewPath` is the same math the sim runs - preview equals execution.
- **Weapons (DESIGN §4):** per-second fire slots; beams (hitscan, scatter, arc+range
  gate at the moment of firing), cannon-class projectiles (100 u/s swept segments,
  persist across turns), homing missiles (1 s Bézier legs with launch/pursuit
  scatter, volleys of 2, 20 s life). Authored stats: beams 27.5 effective
  (5 × 5.5 mount multiplier), missiles 25, ranges 300/200/250.
- **Spatial damage:** subsystems are hit volumes at real offsets - bow armor blocks
  shots from the front, engines are only sniped from astern; block percentages per
  the audit (armor 75 - 90, thrusters 60); armor volumes vanish on death; thruster
  death ⇒ drift.
- **Collision (req 13 / ADR-4):** no-interpenetration positional separation with
  mass weighting, impulse ram damage (`K × relSpeed × reducedMass`) with a per-pair
  cooldown, restitution bounce, and post-contact re-planning toward the ordered
  endpoint. A test asserts hulls never overlap through a head-on ram.
- **Boarding (DESIGN §4.4):** per-second opposed d6 (success 5+), the marine
  efficiency table keyed on defender hull %, capture with faction flip and the
  50 HP prize-crew engine repair. The Rogue frigate carries its authored
  boarding-specialist stats (range 40, 40 marines, capacity 12).
- **AI (DESIGN §5):** the ported decision procedure - first-live-enemy targeting,
  retaliation on damage, chase boost, random orbit destinations, one random fire
  second 1 - 8, the `fireProbability < 0.2` primary-weapon-only branch.
- **Determinism (ADR-4/-6):** seeded per-turn stream-split RNG (sfc32); a
  deterministic math module (`dmath.js`) replacing `Math.sin/cos/atan` (which are
  engine-specific in JS, the same way platform libm is in native code); canonical
  state hashing over float bit patterns; per-turn boundary snapshots that re-simulate
  to identical hashes (tested). Orders in → identical state out, on any machine:
  the lockstep contract.

  **Verified cross-client:** `prototype/tools/xclient-check.js` resolves an identical
  order sequence (collision-heavy, with boarding and a boost) in **Node and in
  Chromium** - separate processes, separate runtime instances - and compares
  per-turn hashes. They match. The rule the sim obeys: only IEEE-exact operations
  (`+ - * /`, `sqrt`, comparisons, `Math.abs/floor/min/max/imul`) touch simulation
  state; everything transcendental goes through `dmath.js` polynomials, and even
  `Math.cbrt` is banned (rejection sampling replaces it in `insideUnitSphere`).

## What's deliberately out of scope

Campaign layer, stealth/vision cones, mission goal trees beyond destroy-all,
shields (a design intent, not a shipped system), terrain/obstacles, sound, and all
visual fidelity - the harness is a debug view, not the game's look. Cooldown note:
the Unity arithmetic makes cooldown 0 and 1 both fire every turn; preserved, with a
one-shot-per-weapon-per-turn guard.

## Why JS here, when the docs say Rust?

This is the ADR-2 bet made cheap: the sim is pure data-in/data-out with no engine,
so the *mechanics* can be reviewed and tuned now, and the port to `sim_core` (Rust)
is a transliteration - every file here maps 1:1 to a planned crate module
(`rng.js` → seeded PCG streams, `dmath.js` → glam+libm, `sim.js` → `step()`,
`snapshot.js` → postcard snapshots + xxhash). If the review changes mechanics,
it changes this file set first, at zero engine cost.
