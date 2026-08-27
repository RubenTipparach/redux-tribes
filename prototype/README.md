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

**The movement model.** Ships fly. There is no curve and no closed form:
`flyTurn` integrates per tick under exactly three restrictions, which are the
only inputs the model has.

1. **Rotation stats.** `yawRate` and `pitchRate`, separate axes, cap how fast
   the hull can be pointed. A heading you cannot reach in time is thrust you
   cannot apply.
2. **Local axis acceleration limits.** `accelFwd`, `accelRetro` and `accelLat`
   are spent in the ship's OWN frame. Main drive strong astern, retros weak,
   RCS weaker still.
3. **Carried velocity.** Momentum survives the turn boundary, so every plan
   starts from where the last one left you going.

They live in `data.js` per class and are copied onto each ship, so they are
real state: serialised, hashed, and editable live from the Flight Envelope
sliders in the harness.

What falls out, for a Terran frigate from rest:

| ordered direction | reached |
| --- | --- |
| forward | 44.5 u |
| starboard | 35.0 u |
| astern | 20.9 u |
| up | 21.3 u |

Astern is half of forward because the ship must turn around and then push on
weak retros. Vertical is worse than lateral because pitch is slower than yaw.
Carrying 6 u/s it can no longer hold station at all.

**The movement envelope.** Select a ship and the boundary of the volume it can
reach this turn is drawn as a point cloud (the shell only: filling the interior
just hid the fleet, and the surface carries the shape). It comes out as a lobe
off the nose displaced downrange by momentum, not a ball around the hull.

Because the model has no closed form, the envelope is *probed*: every candidate
cell is flown through `sim.canReach` and kept only if the ship arrives. Nothing
in the renderer knows or assumes a shape, so the drawing cannot drift from the
rules and follows any tuning for free. A probe integrates in 60 slices rather
than 600 ticks (worst-case endpoint error about 0.75 u on a 44 u reach);
execution always runs at full tick resolution.

The readout is all sampled, since there is nothing exact to compare against:
volume as an integral over accepted cells, the slice at the working altitude,
carried speed, whether the ship can still hold station, and `freedom`, the
share of an omnidirectional version of the same hull that it can actually use.
A frigate under way sits around 13%.

**Previewing rotation.** A wireframe hull at the destination shows the attitude
the ship ends the turn in, and the scrub ghost is an oriented hull too, so a
rotation can be watched across the turn rather than inferred. The heading
widget draws both sides of the limit: a solid arrow to the heading the hull can
reach, and a dashed amber one to the heading you asked for when `yawRate` and
`pitchRate` cannot swing that far in ten seconds. The readout names the
shortfall in degrees.

Commanding a heading switches the ship to `Slide`. Under this model `Move`
points the nose wherever thrust is needed, so it cannot honour a facing order
at all, and silently discarding one made the widget look broken.

**The elevation slice.** The working altitude is one plane doing two jobs: a
drag places the destination on it, and the envelope is sliced at it. `Q`/`E`
raise and lower it, so elevation is a visible thing rather than a hidden
number.

**Per mode.** The envelope differs by order, which is the point of probing
rather than assuming:

| mode | envelope |
| --- | --- |
| Move | nose points where thrust is needed: the largest envelope |
| Slide | nose holds its heading, course left to the RCS: much tighter |
| Boost | a single committed point, a straight burn along momentum |
| Stop | a single committed point, retros against velocity |

### Controls

Input goes through Pointer Events, so one code path serves mouse, pen and
touch, and the harness runs on a phone as well as a desktop.

A drag is routed by where it starts. Inside the dashed ring on the working
altitude it is a move order; anywhere outside it belongs to the camera. The
ring is drawn, so the boundary between "order" and "look around" is visible
rather than guessed, and orbiting can never cost you an order by accident.

| | desktop | touch |
| --- | --- | --- |
| place destination | drag inside the ring | one finger inside the ring |
| working altitude, and so the slice | `Q` / `E`, or ▼ / ▲ under the map | ▼ / ▲ under the map |
| command a heading | drag the pip, or shift-drag | drag the pip (wider hit radius on a coarse pointer) |
| select / target | click a ship | tap a ship, or a row in the Ships sheet |
| orbit | drag outside the ring, or right button drag | one finger outside the ring |
| pan | middle button drag, or ✥ then drag outside | ✥ then one finger outside, or two fingers |
| zoom | wheel | pinch |
| centre on selected ship | ⊕ | ⊕ |
| 15 degree yaw, face target | `A`/`D`, `F`, or the row under the map | the row under the map |
| frame the fleet and its envelope | `Fit view` | `Fit view` in the tab bar |

### Reviewing past turns

Every resolved turn keeps the snapshot it *started* from, its orders, and the
state hash it produced. The turn strip above the event log replays any of them:
`reviewTurn` restores the pre state and re-runs `resolveTurn` with the same
orders, so nothing needs stored frames and the sim reproduces the turn exactly.
The stored hash is then a free self check, printed into the log on every
review. `Live` returns to the current turn.

This is ADR-5's replay format doing real work rather than being described, and
it immediately earned its keep: see the AI planning bug below.

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
