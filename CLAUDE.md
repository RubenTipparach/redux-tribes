# Fallen Tribes

Project rules live in **[GUIDELINES.md](GUIDELINES.md)** and apply to every change. Read
them before touching anything; the first one (no em dashes or en dashes, anywhere) is
enforced by CI and will fail the build.

Design and architecture: `docs/DESIGN.md` reconstructs the archived Unity game,
`docs/ARCHITECTURE.md` holds the ADRs for the rebuild.

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

## Mobile stays supported

**This section is the rule. It holds until someone deletes this section.** While it
is here, every change to the client keeps working on a phone, and "works" means
checked, not assumed:

- The whole console fits a 390x844 viewport with no horizontal scroll, and fits a
  390x560 landscape one, where only about 390px of height exists.
- Every control a player needs is reachable by thumb. The side rails are bottom
  sheets on a tab bar; the nudges that are keyboard only on a desktop (elevation,
  heading, face target) have on canvas buttons, because a phone has no Q/E/A/D/F.
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
node prototype/cli.js test                  # 21, the JS design reference
cd engine/sim_core && cargo test            # 25, the Rust core (tests/, not the lib target)
npm --prefix web test                       # 18, the wasm boundary
npm --prefix server test                    # 9, the lobby and the lockstep API
```

`npm --prefix server test` builds first on purpose. It used to run straight
against `dist/`, so a change to the server could pass a suite that had never
seen it.

## The boundary: the core simulates, the client draws

`engine/sim_core` is the whole game. `web/` draws it and collects input. That is
a hard line, not a preference, and it is what lets a native Rust client replace
`web/` later without forking a single rule (ADR-2, ADR-15).

**In the core.** Every rule and every number that decides an outcome: movement,
weapons, arcs, damage, subsystems, boarding, contact, AI, turn order, the RNG,
the state hash, and the authored data all of it reads.

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

Contact resolution is ours (`turn.rs`), not a physics engine: positional
separation plus impulse damage, pairs visited in index order, per pair cooldown.

**Rapier is compatible but deliberately not adopted** (ADR-15). It needs the
`enhanced-determinism` feature, strictly IEEE 754-2008 targets, nalgebra's
`ComplexField`/`RealField` in place of the built in float methods, and identical
initialisation and insertion order; it cannot be combined with `simd8`. Contact
needs here are small and already covered deterministically with no dependency.
Because the sim is a crate behind a numeric boundary, adopting it later is a
change the renderer never sees.

If you add a system to the core, check it against that list before adding it.

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

Current figures, worth not regressing: wasm 108 KB (43 KB gzipped), envelope 96
shell cells at 7.9 units, 61 fps while planning.

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

`.github/workflows/deploy.yml` is one file with five jobs (`sim`, `prototype`, `api`,
`web`, `deploy`). Parse it with a YAML parser before pushing a change to it: an unquoted
colon-space inside a `run:` scalar has already broken it once.
