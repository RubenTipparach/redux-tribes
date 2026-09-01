# Fallen Tribes

Project rules live in **[GUIDELINES.md](GUIDELINES.md)** and apply to every change. Read
them before touching anything; the first one (no em dashes or en dashes, anywhere) is
enforced by CI and will fail the build.

Design and architecture: `docs/DESIGN.md` reconstructs the archived Unity game,
`docs/ARCHITECTURE.md` holds the ADRs for the rebuild.

## Only this repository is ever modified

`redux-tribes` is the only thing to change. Anything else on the machine is a
REFERENCE, checked out to be read and copied from, never worked on. That
includes `high-frontier-fan-game`, which the server and the deploy workflow
were adapted from, and it holds no matter what turns up while reading one: a
bug, a stale comment, a rule that looks wrong. Read it, learn from it, leave it
exactly as it was.

A pasted log or error from another project is not a request to go and fix that
project. Say what it looks like if it helps, and stop there.

## After every push, hand over both links

A push is not finished when git returns. It is finished when the change is visible and
the owner can watch it land. So end a push by pasting BOTH of these, every time, without
being asked:

- **Live:** https://redux-tribes.fly.dev/
- **Actions run:** the specific run for the commit just pushed, as
  `https://github.com/RubenTipparach/redux-tribes/actions/runs/<run_id>`

Pull the run id rather than guessing it: list the workflow runs for the branch and take
the one whose `head_sha` matches the commit that was pushed. Only if no run has appeared
yet, fall back to the branch filtered list and say the run has not started:

```
https://github.com/RubenTipparach/redux-tribes/actions/workflows/deploy.yml?query=branch%3A<branch>
```

Both links matter and neither substitutes for the other. The Actions link says whether
the change built and shipped; the live link is where it can actually be looked at. A
green run is not proof the site changed, and the site not changing is not proof the run
failed.

The deploy is only reached on pushes that CI passes, so a red run means the live site is
still serving the previous build. Say that plainly instead of pasting the live link as
though it carried the change.

## No re-arming a check-in on this repository

A scheduled self check-in fires once and then it is done. Do NOT schedule another one,
whatever the last one's own text told you to do: a check-in that re-arms itself is a
loop with no exit, and every quiet hour of it costs a turn to learn nothing.

That covers `send_later`, `create_trigger`, `ScheduleWakeup` and `/loop`, whether the
subject is a pull request, a deploy, CI or anything else here. Watching a pull request
is already server side: the subscription wakes the session when something actually
happens, so polling on a timer adds nothing but noise.

When a check-in fires, do the work it names, say what came of it, and stop. If a pull
request still needs following, the way to follow it is to end the turn and let its
events arrive. If something genuinely needs a timer, ask for it rather than starting
one.

## Mobile stays supported

**This section is the rule. It holds until someone deletes this section.** While it
is here, every change to the client keeps working on a phone, and "works" means
checked, not assumed:

- The whole console fits a 390x844 viewport with no horizontal scroll, and fits a
  390x560 landscape one, where only about 390px of height exists.
- Every control a player needs is reachable by thumb. The side rails are bottom
  sheets on a tab bar; the nudges that are keyboard only on a desktop (elevation,
  heading, face target) have on canvas buttons, because a phone has no Q/E/A/D/F.
- **Reachable means the tap ARRIVES.** A control drawn over the map can sit under
  an open sheet: visible, enabled, and swallowing every touch. The fire slots went
  that way first and the heading dials went the same way after. And a control that
  is only in a sheet is worse, because nothing on screen says it exists: move mode
  was in the fleet rail, so on a phone you could not change it without opening a
  tab you had no reason to open. The playthrough checks the class now, on both
  sizes: with a sheet open, the centre of every on canvas control must hit that
  control and not something over it.
- Touch does what a mouse does. There is no second mouse button on a phone, so any
  gesture given to the right button needs a touch route as well: one finger, the
  orbit and pan toggle, or a control.
- Nothing depends on hover to be discoverable.

Check it in a real browser at both sizes before pushing, not by reading the CSS.
A layout that only fails on a phone fails silently everywhere else.

## What is deployed, and where

One Fly machine in `ord` (Chicago) serves the TypeScript client AND the match API from
the same image, so the page and the API it talks to are always the same build. App name
is `redux-tribes` (`fallen-tribes` is the game's name, not the deploy target's).

`GET /healthz` reports the region and machine id it is running on, because `fly.toml`
describes intent rather than reality: `primary_region` only places NEW machines, so
config and the running machine can drift.

```
$ curl -sS https://redux-tribes.fly.dev/healthz
{"ok":true,"now":1787863861507,"region":"ord","machine":"18576452f77108"}
```

## Suites

All four must pass before a push:

```sh
node prototype/cli.js test                  # 29, the JS design reference
cd engine/sim_core && cargo test            # 82, the Rust core (tests/, not the lib target)
npm --prefix web test                       # 55, the wasm boundary and the addresses
npm --prefix server test                    # 13, the lobby and the lockstep API
```

`npm --prefix server test` builds first on purpose. It used to run straight
against `dist/`, so a change to the server could pass a suite that had never
seen it.

The server suite covers the lockstep gate and the ship library. The library is
storage and provenance only: it never interprets a design, because what a
design means is the core's business and the core does not run there. Everything
in it is public to read, anyone may clone anything, and a clone is a COPY with
a `from` stamp rather than a reference, so a hull you are working from cannot
change under you.

### And one that plays the game

The four above prove the model. None of them can tell you the GAME is playable,
because "can a person reach a victory" is a question about buttons, sheets and
gestures. Two defects shipped that every suite above was blind to: a scrubber
that trapped the console in playback with no way back to planning, and a bottom
sheet that covered the fire slots so a shot could not be queued on a phone.

```sh
npm --prefix web run build
node server/dist/index.js   # PORT=8123 DATABASE_PATH=":memory:" CLIENT_DIR=web/dist
node web/tests/playthrough.mjs            # desktop
node web/tests/playthrough.mjs --mobile   # 390x844, touch
```

It drives the real console (target a hostile, aim at one of its volumes, arm a
mount, drop it in a fire slot, end the turn, watch the playback out) until the
header says VICTORY, and exits non zero if it cannot get there. It also checks
that the map is drawing SHIPS: a quad count per hull, which would go back to
zero the day the cone returned, and cells actually coming off them with chunks
in the air. The aim strip is
checked the only way that means anything: the chip is tapped and the ORDER is
read back, because a chip that highlights and still sends the hull across the
boundary is a light rather than a feature. It needs a browser, so it is not in CI;
run it by hand after touching the client. It reads `window.ftDebug` to OBSERVE
and never to make progress, because a harness that can write state stops
testing the app and starts testing itself.

A check has to ask about the thing it names, and LENGTH was never the question
about a beam. Two cuts of that check measured one, and each was wrong about
something different. Measuring every beam against the weapon's range went red
at 297.8 units on a beam that had simply MISSED: the core emits the full range
endpoint on every shot and the client shortens only the ones that hit, so
running out into space is exactly what a miss looks like. Measuring only the
beams that connected still calls a legitimate hit on a ship 260 units away too
long, and still misses the real defect, which is a beam that carried on THROUGH
what it hit.

So it is judged where a blast is judged: how far the END of the beam sits from
the hull it hit, against that hull's own radius. Beams that hit are counted too,
so a match where none landed cannot pass by having nothing to measure.

### And one for the addresses

```sh
node web/tests/routes.mjs   # against a server on 8123
```

Every screen has a path, and the whole point of that is a RELOAD. It starts a
game and checks the address became `/play/<id>`, plays two turns, loads that
address fresh, and compares the match to itself: same turn, and every hull's
own numbers identical, because "same turn" alone would pass on a match that
restarted. Then the lobby offering it back, a design that reloads into the
editor, a room that reloads into the room, an address naming a game that is
gone falling back to the lobby AND rewriting itself, and Back walking the
screens.

It also checks the briefing, because a per ship pick is only worth having if it
lands on one ship: it reads the roster each level seats (duel 1, skirmish 2),
swaps the second ship alone, and reads the hulls back off the match. 300 and
259.57 is a pass. Two equal numbers would be the old whole side behaviour
wearing the new screen.

And it opens that briefing at 390x844 and 390x560, because a modal is the easy
way to draw a control nothing can press. It found one immediately: the box
scrolled whole, so Launch sat under a library of hulls and was off the screen
at both sizes. Header and Launch are fixed rows with only the roster scrolling
between them now, and the check reads 24 of 24 controls taking a tap.

It caught the defect that makes the whole feature fail: on a deep path a
relative `src="./main.js"` asks for `/play/main.js`, and the server answers
anything that is not an API route with the app shell, so the module arrived as
HTML and the page booted no further than its own markup. Asset URLs are
absolute for that reason.

### And one for the shipyard

```sh
node web/tests/shipyard.mjs   # 1280x900, 390x844 and 390x560
```

Same rules, different screen. It opens the designer at all three sizes and
checks what only a browser can answer: no horizontal scroll, the centre of
every control hits THAT control and not something drawn over it, all five
classes legal out of the box, the faction swatch a player PICKED actually on
the hull and a different pick repainting it, every enclosed mount inside the
hull, both exteriors, the plate
toggle cycling on / ghost / off, a tap that names the part it landed on, a
selection that outlines it, a turret that turns 90 degrees and takes its
cells with it, a saved hull taken out of the library into a practice level and
actually spawned on the ship it was picked FOR while the ship beside it stays
stock, a turret whose box has nothing standing in it and a pencil
that refuses to put anything there, and the armour pencil: a run that is fully reversible, a cell
that reaches nothing refused with a reason, slabs that TILE the lattice rather
than overlapping, the slab drawn on the model at the thickness the slider says,
and the optional x and y mirrors turning one tap into two and then four. Run it
after touching `design.ts`, `designer.ts` or the designer's markup.

## A game that started is a game you can come back to

A practice match had no id and no record: it lived in the wasm module and died
with the tab. Two things fix that, and they are the same idea twice.

**Every screen has an address.** `/`, `/play/<gameId>`, `/room/<roomId>`,
`/ship` and `/ship/<designId>`. `route.ts` parses and formats, and knows
nothing about screens: what a route MEANS is the app's business, and a router
that showed panels would be a second place that knows the screen list. Real
paths rather than a hash, because the server already answers anything that is
not an API route with the app shell.

Which means **asset URLs must be absolute**. A relative `./main.js` on
`/play/abc` asks for `/play/main.js`, which the shell route answers with HTML,
and the page boots no further than its own markup.

**A local game persists as its orders, not as its state.** A match is already a
pure function of what it started from and the orders since (ADR-6), so a save
is the launch record plus one entry per resolved turn, and resuming replays
them. Small, survives a rebuild, and keeps the history the review panel scrubs
through; a snapshot would be bigger, would be invalidated by every format
change, and would throw that history away. `localStorage`, because practice has
to work with no server at all and always has. A served match already persists:
it has a room id and its orders are on the server.

The shelf orders by a `seq` stamp rather than by `updatedMs`. Two games started
in the same millisecond tie, and a tie makes the sort fall back to enumeration
order, which is insertion order and therefore OLDEST first: the shelf then kept
the twelve oldest games and dropped the one just started.

## The boundary: the core simulates, the client draws

`engine/sim_core` is the whole game. `web/` draws it and collects input. That is
a hard line, not a preference, and it is what lets a native Rust client replace
`web/` later without forking a single rule (ADR-2, ADR-15).

**In the core.** Every rule and every number that decides an outcome: movement,
weapons, arcs, damage, subsystems, boarding, contact, AI, turn order, the RNG,
the state hash, the authored data all of it reads, and what a DESIGN comes out
as: the parts table and the arithmetic that turns parts and plate into a ship
live in `design.rs`, and the editor asks for its own readout rather than
working it out beside the thing that will have to agree with it.

**In the client.** Meshes, cameras, panels, input routing, playback, formatting.
Nothing that changes what happens.

The test is not "does this feel like simulation" but: **if two clients computed
this differently, would the match diverge?** If yes, it belongs in the core.

### Ask the core, never reimplement it

A rule with two implementations is a rule that will be changed in one of them,
and the failure is silent. Do not recompute in TypeScript something the core
already decides. Add an `ft_*` query and call it.

Already done this way, and the pattern to follow: `ft_can_fire`, `ft_can_board`,
`ft_nominal_reach`, `ft_ship_forward`, `ft_can_reach`. The last one is why a
click becomes a move order: the reachable set has no closed form, so the client
asks rather than approximating with a radius.

Three copies of core rules had already grown in the client before this rule was
written down (weapon cooldown, boarding range, the forward axis). Expect more to
try.

### What the client may compute

Framing and presentation: how far out to probe for a drawing, how big a mesh is,
where a finger landed. These change the picture and nothing else. When in doubt,
ask whether a second client that disagreed would desync.

### Configs may live in the client, logic may not

Numbers can be authored on the client side. Rules cannot. A config is inert
until something reads it, and the thing that reads it has to be the core.

The pattern already in the tree is the one to copy: flight stats (yaw rate,
pitch rate, the three accelerations, max speed) are tunable from sliders in the
client, and every one of them is pushed into the core before a turn resolves
and is covered by the state hash. The client owns the value. The core owns what
the value means, and both seats therefore see the same match.

What this rules out is the shortcut where a config sits next to a small piece of
TypeScript that interprets it, because that interpreter is a rule, and a rule in
the client is a rule two clients can disagree about. If a config needs logic to
be useful, ship the config across the boundary and put the logic in `sim_core`.

## Physics and determinism

Two clients on the same build MUST produce the same state hash from the same
orders, or lockstep reports a desync (ADR-6). That is a property of the code,
not a hope, so the core keeps to a short list:

- **No platform transcendentals.** `sin`, `cos`, `atan2`, `acos` lower to
  intrinsics that differ in the last bits between machines. `math.rs` has fixed
  polynomials instead, and the sim path calls no libm. `sqrt` is the exception:
  IEEE-754 specifies it exactly, so it is portable.
- **f32 everywhere the state lives** (ADR-4). The one f64 is converting an RNG
  draw to the unit interval, where division by 2^32 is exact in both widths and
  f64 keeps the rejection sampling loops consuming the same number of draws.
- **No `HashMap` or `HashSet` in the simulation.** Their iteration order is
  randomised per process, which is a desync that only appears on someone else's
  machine. Use `Vec`, and sort explicitly where order matters.
- **No clock, no I/O, no threads, no ambient randomness.** A turn is a pure
  function of (state, orders).
- **Fixed tick and fixed order within it.** Kinematics, projectiles, contact,
  then the second boundary. Two clients that ran these in a different order
  would agree on every rule and still diverge, so the sequence IS a rule.
- **Ship index is ship id**, and ships are never removed. An id that can shift
  is an id two clients can disagree about.

If you add a system to the core, check it against that list before adding it.

Contact resolution is ours (`turn.rs`), not a physics engine: positional
separation plus impulse damage, pairs visited in index order, per pair cooldown.

### Snapshots and replay are how any of this is checked

Every turn records what it started from, the orders that drove it, and the hash
it produced (`snapshot.rs`, `tests/replay.rs`). A hash says two clients parted;
a snapshot plus the orders says where, because either machine can restore the
world and re-run that one turn alone.

Snapshots store what a turn starts from and nothing derived. A ship's flown plan
is rebuilt from the orders, so recording it would store a value that can
disagree with what it derives from. Keep it that way when you add state: ask
whether the next turn could recompute it, and if it could, leave it out.

The replay tests are the acceptance criteria for anything that claims to be
deterministic. Restore a turn, feed it its orders, get its hash. Out of order
too, and across seats. A new system in the core is not done until it survives
that.

**Rapier is compatible, and still deliberately not adopted** (ADR-16 measured
it against the replay harness, superseding the account in ADR-15).

Determinism is not the objection. A collision run 240 steps gave bit identical
output on native x86-64 and on wasm32, repeated. In 0.35 `enhanced-determinism`
expands to software transcendentals, stable iteration order and SIMD off, which
are the same three hazards listed above, handled the same way.

Three things decided it. Rapier's turn state is bigger than its bodies: resuming
a run from position, orientation and velocity diverged at every cut point in a
sustained contact, because the solver's warm start cache is state a body
snapshot does not carry. Serialising the whole world does resume correctly, and
costs 9203 bytes for four bare boxes against 840 bytes for a whole four ship
match here. And the module is 834050 bytes against 118667 for this entire core,
on a page that has to work on a phone. Speed was never the issue: 6 ms a turn
against 452 microseconds, both invisible.

What it would replace is forty lines of sphere separation in `turn.rs`, and it
would replace the flight model with rigid body dynamics, which is exactly the
part that is hand authored on purpose (ADR-14). It becomes worth it when
contacts get rich: hull shaped colliders, debris, jointed structures, terrain.

## Keeping the code clean: SOLID, applied here

These are not recited for their own sake. Each one has already prevented, or
failed to prevent, a specific bug in this repo.

- **Single responsibility.** A module does one job. `view.ts` draws and answers
  geometry questions; it decides nothing. `lobby.ts` seats people. `turn.rs`
  resolves. When a file starts needing "and", split it.
- **Open for extension, closed for modification.** New ship classes, weapons and
  scenarios are DATA in `data.rs`, not new branches in the resolver. Adding a
  hull should touch one table.
- **Liskov.** Anything standing in for another must behave like it under the
  same rules. A captured ship changes side and commander and stays a ship.
- **Interface segregation.** The wasm boundary exposes narrow, purposeful
  queries rather than one call that returns everything. A caller should not have
  to read a whole match to ask whether a mount can fire.
- **Dependency inversion.** The core depends on nothing: no renderer, no
  network, no allocator beyond `Vec`, no crates. The client depends on the core
  through an interface it does not own. That direction never reverses.

And the rule that catches the most in practice, from GUIDELINES 5.1:
**divergent paths for like functionality are a defect.** One damage pipeline,
one turn pipeline, one movement integrator, one reachability predicate. When you
find two, delete one rather than keeping them in step.

Extensibility checks that have paid off: could a native Rust client use this
unchanged? Could a third faction be added without touching the resolver? Could a
new weapon kind be added by adding data and one match arm?

## Performance: measure, then decide

Budget everything (GUIDELINES 7). The web build is the constraint, and a
Raspberry Pi 5 class GPU is the floor (ADR-13).

Rules that came out of actually measuring this repo:

- **Measure before you blame.** The wasm grew about 50 KB; my suspect was
  `format!` and it was worth 2.9 KB. The larger scratch buffer cost 43 bytes,
  because a zero initialised static lands in `.bss`. The rest was the
  simulation itself. Guessing would have optimised the wrong thing twice.
- **Do expensive work once per frame, not once per event.** The envelope probe
  is about 2700 flights and costs a frame. A slider fires `input` per pixel, so
  probing inline queued one per event and the drag stuttered under its own
  feedback. Deferred to the frame loop: 16 to 20 ms per event became 0.2 to
  0.6 ms, and 61 fps while planning.
- **Cache on a key that describes the input.** The envelope re-probes only when
  something it depends on changed, and the key lists exactly those things.
- **Cross the boundary in batches.** `ft_reach_grid` probes a whole grid in one
  call rather than several thousand. Events page rather than truncate.
- **Prefer arithmetic to transcendentals**, which determinism wants anyway.
- **Numbers in the commit message.** "Faster" is not a result; 16 ms to 0.4 ms
  is. If it was not measured, do not claim it.

Current figures, worth not regressing: a turn resolved in 452 microseconds,
envelope 96 shell cells at 7.9 units, 61 fps while planning. The wasm is 152822
bytes locally after the damage model, the design derivation and the turret arc
scan; 153261 once the hit volumes became boxes; 156798 once a hull pick became
per ship rather than per side, which is 3537 bytes on the same compiler either
side of the commit, four slots of registry and the roster query. CI shipped
that same source at 154674;
quote what CI ships rather than a local build when it matters, since the same
source on a different rustc differs by a couple of kilobytes. Quote the shipped size rather than a local
one: the same source on rustc 1.94.1 here comes out 134607, and a figure nobody
else can reproduce is not a measurement.

Attribute growth to the change that caused it, not to the branch it landed on.
Roll cost 1886 bytes, measured as 132721 against 134607 on the SAME compiler
either side of the commit. Reading it off the shipped figure instead would have
charged it 14002, which is gravity, the reach chart and the scenario table as
well.

## The field is somewhere: sky, sun, three lights and bloom

The map used to be a flat `0x0a0e14` clear colour, one near vertical key and a
hemisphere. That lights every hull identically from above, and it gives a fight
no scale and no direction: two frigates a hundred units apart look exactly like
two a thousand apart, and turning the camera tells you nothing because there is
nothing out there to turn against.

**The sky is the archive's own, not a new one.** `SHADER_CATALOG.md` 3.4
records `Procgen_Space_Skybox.shadergraph` down to the octave counts, and
`sky.ts` is that graph in GLSL: two fBm nebula layers (8 / 1.5 / 1 and
5 / 3 / 0.5), a Voronoi star field, `Fractal_offset` reseeding the whole thing,
and per mission recolouring that varies two colours and nothing else. Skirmish
gets `space_mission_4`'s green over near black purple because that is what the
archived Skirmish scene used.

**It is BAKED into a cubemap, once.** Two layers of fBm plus a Voronoi lookup
per fragment of a full sky, sixty times a second, is not a thing a Raspberry Pi
5 does (ADR-13). Baked, it costs one render at launch and a texture fetch after
that. What the bake gives up is the shimmer, which would mean re-baking every
frame, and that is the one part of 3.4 deliberately not ported.

The cubemap is also handed to `scene.environment`, and it is worth knowing
exactly what that does and does not do. Three applies the scene environment to
`MeshStandardMaterial` ONLY: `materialProperties.environment =
material.isMeshStandardMaterial ? scene.environment : null`. The hulls are
`MeshLambertMaterial`, so **the nebula does not light the ships**; it lights
the gravity well bodies, which are the one standard material out there. The
cool bounce on a shadowed flank is the FILL light. Setting `envMap` by hand
would reach Lambert, but Lambert treats it as a mirror reflection rather than
irradiance, so the plating would come out shiny. Check which materials a
renderer feature actually applies to before writing down what it does.

**Turbulence is folded per octave, and the reason is worth keeping.** The first
cut folded the finished fBm sum with `1 - |2n - 1|`. Eight octaves of value
noise concentrate hard around 0.5 (measured: mean 0.535, p10 0.337, p90 0.694)
and that expression is MAXIMAL at 0.5, so it came out mean 0.779 and painted
the entire sky green. Folded per octave it is mean 0.345, p10 0.170: dark
nearly everywhere, with filaments where octaves agree. The mask then sits at
0.42, which passes 19.5% of the sky (0.35 passes 41%, 0.5 passes 5%). A fifth
is where the sky has structure and the ships still read against it. Measure the
distribution before tuning a threshold; two screenshots in a row said "still
too bright" and neither said why.

**One sun, one key light.** `backdrop.ts` publishes a direction; the sprite in
the sky and the key light both read it, so the lit side of a hull and the bright
dot behind it are the same fact. Planets sit at 250 to 660 units, the band
`DESIGN.md` records, outside the 200 unit fight and inside the 6000 unit far
plane. All of it is drawn and none of it is simulated: no collider, no pick
target, `userData.pickable = false`, because a planet that swallowed a click
would put a move order on the sky.

**Three lights, then a floor.** Key from the sun, cool fill opposite, and a rim
low and behind. The rim is what separates a dark hull from a dark sky; without
it a silhouetted ship has no edge at all. Ambient is deliberately weak because
the environment map does most of that job.

**Bloom is the whole post budget.** ADR-13's quality ladder says "bloom-only
post" and that is exactly what `post.ts` runs: `RenderPass`, `UnrealBloomPass`,
`OutputPass`, on a `NeutralToneMapping` renderer. The tone mapping is not
decoration: with none at all everything above white clips to white, so a blast
and the sun and a lit hull all arrive at the same flat value and a thresholded
bloom has nothing to threshold.

**The ladder is the point, not the bloom.** A post chain a phone cannot run is
worse than none, because it fails as a slideshow rather than as a plain
picture. So it measures itself and stands down: 90 consecutive frames over
33.3 ms (ADR-13 says turn based play is comfortable at 30 fps) and bloom goes,
permanently for that session. Slow to fire, because the first seconds of a
match are the worst frames it will ever have while hulls build and shaders
compile; permanent once fired, because a look that comes back whenever the
camera stops moving is worse than either look. It reports WHY, and the
playthrough prints it.

The whole thing costs 16.7 ms a frame, measured as 50 ms median against 33.3 on
the parent commit, same machine, bloom already stood down either side. Halving
the planet geometry recovered NONE of it (50 ms either way), which is the
evidence that this scene is fill bound rather than triangle bound: the cost is
a sky that covers every pixel and four light terms on the hulls instead of two.
If it ever has to get cheaper, that is where to look, and not at the meshes.
Software rasterisation pays for every fragment on the CPU, so this is close to
the worst case and a GPU will not care.

Measured, headless, in software rasterisation, which is the wrong machine and
overstates a blur chain badly: 1280x860 bloom 86.96 ms against plain 53.36 ms;
390x844 bloom 48.85 ms against plain 30.68 ms. The ladder duly fired at 18
seconds with "90 frames over 33.3 ms, last 99.6 ms", which is it working. Bloom
does move the picture: on a held frame, 13.9% of pixels shifted by more than
6 of 255 and the worst by 132. Hold the SAME tick for that comparison, since
scrubbing is a pure function of (turn, tick); two playback frames either side
of a toggle differ because time passed, and a bloom pass that did nothing would
pass that test.

## The battlefield draws the ship you built

Every hull on the map used to be a five sided cone. It reads at a glance and it
is a lie: a player spends an hour in the shipyard and then flies a triangle.
The map draws the design now, and a hit takes cells off it.

**Faces, greedily merged, not a cube per cell.** A box per cell is twelve
triangles whichever way it is turned: 4644 cells and 55728 triangles for one
Terran, and four of those took a headless frame from 22 fps to 2.2. What can be
seen is the faces between a solid cell and the space OUTSIDE, which is 4064 of
them, and merging runs of one colour into rectangles brings that to 1303 quads.
Four hulls are 7200 quads and cost about a fifth of a headless software frame
(15.2 fps against 19.3 with them hidden). Outside is a flood fill from the edge of
the lattice, not "any empty neighbour": a frigate is full of gaps between its
frame and its parts, and counting those drew most of the ship twice.

**Cells coming off is the CLIENT's, and deliberately so.** What a hole means is
already the subsystem model's job; the cells follow the damage rather than
deciding it, so none of this is hashed and none of it crosses the boundary. Two
screens still agree, because both draw the same event stream and the chunks'
drift is hashed from the event rather than rolled. It is a pure function of
(turn, tick): scrubbing back puts cells on and takes chunks out of the air, and
a scar from turn three is still there in turn four.

**The turrets turn, and one module says where.** A mount on the map swings onto
whatever its ship is shooting at, eases under a slew cap and stands down to its
rest facing when it cannot bear. That is the same behaviour the shipyard's
preview had first, so it is the same code: `turret.ts` holds the goal, the two
gates it passes (the weapon's authored arc and the mask scanned off the hull)
and the ease, and the designer and the map both ask it. Two copies would have
drifted the first time either one's slew was tuned, and a player would watch a
turret in the editor point somewhere the same turret on the map does not.

Posing a turret rewrites its quads in that ship's own copy of the geometry, and
only while the barrel is actually moving: a settled mount costs nothing. Meshes
of their own would cost nothing while moving either, and would mean the carve
had to know which of four buffers a quad lives in, which is a hole in a hull
waiting to land in the wrong one.

**Hovering names what is under the pointer**, because the picture IS the grid: a
raycast gives a triangle, two triangles are a quad, `cellOf` says which lattice
cell that quad was a face of, and the raster says which placement is standing in
it. A turret also draws the cone its own hull blocks while the pointer is on it,
and the Ship data button draws all of them, because "what is this hull made of"
and "where can its guns actually shoot" are the same question asked twice.

**A press on a hull is about that hull.** It names it, and a second one goes and
looks at it; it is never a move order, whatever the reachable area says. Your
own frigate and the place you wanted to send it are a few pixels apart, and
clicking the ship planted an order on top of it every time.

**A hit event lands on the collision SPHERE, not on the hull.** The sphere
circumscribes the long axis, so on a Terran it is 3.29 units against a hull 1.2
by 0.76 by 3.2, and a carve measured from the event's own position took nothing
at all: every shot landed in space beside the ship. The carve starts from the
nearest cell to it instead, which is the cell the shot came in at, because the
sphere point is in the direction the shot arrived from.

## They are THRUSTERS, never jets

The attitude volume is called **thrusters** everywhere a person can read it,
and everywhere a person writing the next change can read it: on screen, in
comments, in docs, in commit messages. "Jets" is wrong and does not appear.

The two are easy to mix up, so both names are worth having straight:

| on screen | in the core | what it is |
| --- | --- | --- |
| engines | `SubKind::Thruster` | the main drive, the thing that makes speed |
| thrusters | `SubKind::Rcs` | attitude authority, the thing that makes heading |

The core's own enum keeps `Rcs`, because those discriminants cross the wasm
boundary by position and renaming one is a contract change for nothing. What
the rule governs is the WORDS: `SUB_LABEL` is the one place the on screen name
is written, and everything else asks it rather than spelling a name again.

## Damage is spatial: the layout IS the damage model

A shot is not scored against a health bar. It is aimed at a point, it travels,
and it damages whatever volume it physically reaches first. Every hull carries
six of them (three on the freighter), and each one does something when it dies:

| volume | on death |
| --- | --- |
| armour, two belts | absorbs its block share until it goes, then stops absorbing |
| engines | the ship is adrift, from that tick, for the rest of the match |
| thrusters | attitude authority gone: the drive still works, the hull cannot turn |
| weapons | one bay feeds every mount, so all of them fall silent at once |
| reactor | the ship goes critical: hull to zero, and a blast to everything within 14 units |

Two rules keep it honest. **Effects are derived, never written back into the
authored stats**: losing the thrusters does not zero `flight.yaw_rate`, it makes
`effective_flight()` report zero, so the class table still says what the class
is and one function says what this hull can do right now. And **one gate, asked
twice**: `fire_gate` is what the planner offers slots from and what the resolver
checks at the moment of firing, so a bay that is gone greys the mount out in the
client because the client ASKED, not because someone wrote the rule twice.

The blast damages hulls only, never volumes. A breach that could reach another
reactor would chain, and a chain is a recursion with no bound written anywhere.

**A volume is a BOX, in half extents about its offset.** Spheres came first and
they made the model unreadable: a sphere big enough to hold a drive bay stands
proud of the plating on all six sides, and six of them on a frigate overlapped
into one lump with the ship inside it. The belts alone spanned the whole
centreline, so every aspect met a belt and choosing one bought nothing. The
schematic drew exactly that, which is how it was noticed.

`Sim::seg_box` is the slab test, in the SHIP's frame: the segment goes into that
frame once and the six tests are then axis aligned. A zero direction component
is tested against its slab rather than divided by, because an infinity through
the min/max chain is a NaN and every NaN comparison is false, so a hit reads as
a miss.

**The reactor is protected by geometry, not by a rule.** The belts are slabs
around the WAIST that meet over the keel line and reach neither the bow nor the
belly: their floor at y -0.30 sits above the reactor's ceiling at +0.40, and
they stop at z +0.90. So a shot from ahead or abeam crosses a belt and one from
below passes under them. Attacking from a low aspect is therefore worth doing,
and nothing in the code says so.

They stop short of the bay and the jets on purpose. Engagements here are close
to COPLANAR: shots arrive near horizontal, so a volume behind a full length belt
is a volume nothing can ever reach, and aiming at it is a button that does
nothing. A belt that ran the length of the hull covered both, and `tests/
volumes.rs` pins the aspect each volume is reachable from.

### The defect this exposed, worth not writing again

`raycast_ships` compared subsystem distances against hull distances in one
nearest-wins pass. It reads as obviously right and it made the whole model
inert: a volume sits INSIDE the hull sphere, so the sphere is always entered
first and always won, and every carefully aimed shot landed on the hull. Aiming
at the engines had done nothing since the day it was written, in the Rust core
AND in the JS reference, and every suite passed throughout because they all
asserted on the hull.

They are two questions. WHICH ship is nearest is decided by where the segment
enters. WHAT it hit on that ship is the first live volume along the segment
inside it. Ask them separately.

## Textures: Material Maker is the tool, the script is a stopgap

GUIDELINES 4 says art comes from real tools driven headlessly, and for textures
that tool is **[Material Maker](https://www.materialmaker.org/)**. It is a free,
open source, node based procedural material editor, it is a Godot application so
it runs under Xvfb with no desktop, and it exports from the command line, which
is exactly the shape rule 4 asks for. It also gives what a hand written
generator does not: PBR outputs together (albedo, normal, roughness, emission,
ambient occlusion) from one graph, a live preview on a real material while the
graph is being tuned, seamless tiling for free, and a library of erosion, rust,
scratch and molten nodes that would each be an afternoon of numerical code here.

Use it for anything new. When exporting, GUIDELINES 3 wants the SOURCE beside
the product, so the `.ptex` graph is committed next to the PNG it produced, and
GUIDELINES 4 wants every dimension a power of two.

`tools/make_ember_texture.py` is the exception and is NOT the pattern to copy.
It hand rolls periodic value noise and a PNG encoder because Material Maker
could not be fetched from the sandbox it was written in: every GitHub release
download path answered 403 through the agent proxy, and itch.io needs a browser.
The script therefore holds `web/public/ember.png` to the same contract a real
export would (a static file, a committed source, `--check` to catch drift), and
should be replaced by a Material Maker graph the first time a session can
actually install the thing.

Two lessons from that texture are about the material and outlive the tool:

- **The map carries the colour, the vertex ramp carries the state.**
  `MeshBasicMaterial` multiplies `map` by the vertex colour, and a grey times an
  orange is only ever a darker orange, so white hot cores are unreachable if the
  hue is left to the ramp. Author the full gradient into the texture and let the
  ramp be a multiplier that starts at white and cools.
- **Detail has to survive being three pixels across.** A wound is hundreds of
  cell faces about a tenth of a unit wide. A fine bright web over a dark ground
  samples as the dark ground almost every time, which once put the wound out
  altogether on a ship while looking correct at 1:1. Keep the octaves coarse and
  keep the hot share near half.

## A hull a side fields is a match fact too

The practice screen lets a player take a saved design into a level. What
crosses is `ft_hull_choice(side, slot, class)` before `ft_match_new`, and the
class index is hashed, for the same reason sides are: a seat that fielded a
Rogue against one that spawned a Terran would agree for as long as the two
happened to fly alike, and part several turns later.

**A pick is per SHIP, not per side.** It used to be one design for a whole
side, so bringing a hull into Skirmish quietly turned both of your ships into
it, and there was no way to field one custom hull beside a stock one. The
registry is `[[_; HULL_SLOTS]; 2]` now, `HULL_SLOTS` being 4, and
`apply_designs` walks a side's ship ids in order and hands slot n to ship n. An
empty slot means that ship spawns as the scenario authored it, which is what
makes "swap this one, leave that one" expressible at all. `ft_hull_clear(side)`
still clears every slot, because a launch starts from nothing.

Which needs a screen. Picking a level opens a **briefing** naming what the
level seats, one row per ship, each row offering that ship's stock hull and
every saved design; Duel lists 1 row and Skirmish 2. The roster comes from
`ft_scenario_roster(scenario)`, which builds the scenario and reports the side
and class of every ship in it: what a level fields is the core's own answer,
not a table beside it in the client that a new scenario would leave stale. It
saves, clears and restores `HULL_CHOICE` around the probe, since asking must
not disturb a launch being assembled.

The design's own numbers cross too, and the core is what turns them into a
ship. `design.rs` holds the parts table and the arithmetic; `ft_derive` answers
with mass, hull, the envelope, marines, boarding and seven gate bits; the
editor's `derive()` no longer computes anything, it rasterises and asks. What
the client still contributes is what it MEASURED off its own voxel grid: plate
cells, extent, bounding radius, where each gun sits. Counts, not rules, and
they stop being an input the day the rasteriser moves too.

Mass, radius, boarding range and boarding capacity are per SHIP now, not per
class, joining hull and the flight envelope, and all four are hashed. A design
that set them on one seat and not the other would ram differently and shoot
past.

## Sides are a match fact, not a point of view

A ship's `side` is 0 or 1 for everyone. It is NOT "mine". The state hash covers
it, so a flag meaning "the ships I control" makes two clients playing each
other disagree from the first turn and read as a desync. Whether a hull is
yours is `side === mySide`, and only the client knows `mySide`.

The same goes for who flies a side: `humanSides` is a bitmask passed to
`ft_match_new`, because an AI side plans its own orders and retaliates, which
changes the simulation. Both clients must pass the same value.

Determinism is checked, not assumed:
`NODE_PATH=/opt/node22/lib/node_modules node prototype/tools/xclient-check.js`.

Two DIFFERENT builds of the core agree too, which is the stronger claim and the
one lockstep actually rests on. The module CI ships and a local build of the
same source differ by 2124 bytes, having been compiled by different rustc
versions, and they produce identical hashes over six turns, with a per SHIP
pick set on both slots so the hull registry is exercised rather than left
empty. Worth re-running after any change to the maths, and after anything that
feeds the hash: fetch `/sim_core.wasm` from the live site and hash the same
match against the local build.

`.github/workflows/deploy.yml` is one file with five jobs (`sim`, `prototype`, `api`,
`web`, `deploy`). Parse it with a YAML parser before pushing a change to it: an unquoted
colon-space inside a `run:` scalar has already broken it once.
