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
cd engine/sim_core && cargo test            # 96, the Rust core (tests/, not the lib target)
npm --prefix web test                       # 79, the wasm boundary, the addresses and the facings
npm --prefix server test                    # 13, the lobby and the lockstep API

node tools/measure_fleet.mjs --check        # the class table against the fleet
```

`measure_fleet.mjs --check` is the fifth, and it is not a unit test: it
rasterises every stock hull, asks the core what each derives, and fails if
`data.rs` disagrees. CLAUDE.md has always said that table is measured rather
than guessed; seventeen classes were, once, by hand, and twenty three cannot
be. `--sync` writes it, and it writes each class's VOLUME radius too, because
`hull_subs` took a radius argument that nothing linked to the class and the
Rogue frigate's engines cleared its own plating by five hundredths of a unit.

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

**Wait on PROGRESS, never on a deadline.** "Playback finished in under forty
five seconds" is two claims welded together, and only one of them is about the
app. One turn plays in about thirty seconds on a workstation and sixty nine in
the software rasterised container these run in, against seventy two on the
parent commit, so a fixed limit reported a freeze that was a slow machine and
would have gone on reporting it whatever anybody changed. Both harnesses watch
the TICK now: still moving is fine however slow, and stopped without handing
control back is the freeze the check exists for.

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

It also drives the **ship detail modal on a hull that has been shot**, which is
the only state the interesting half of it exists in: that the modal knows about
the same cells the map has taken off, that the armour toggle cycles on / ghost
/ off and that armour off really is a different mesh rather than the same
picture relabelled, and that a turret can be POINTED AT. Until it could, the
only pickable objects in there were the volume boxes, and a mount is not one of
those.

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
selection that outlines it, a turret that turns 90 degrees on EACH of its
three axes and takes its cells with it, giving three different hulls rather
than one control wired to three rows, and comes home from every one of them,
a saved hull taken out of the library into a practice level and
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
`/ship`, `/ship/<designId>` and `/architect/<classKey>`. `route.ts` parses and
formats, and knows nothing about screens: what a route MEANS is the app's business, and a router
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

## The architect edits the frame; the yard fits parts to it

Two screens, one canvas. The shipyard fits parts to a frame. The **architect**
(`/architect/<classKey>`) is the layer under it, where the frame ITSELF is
edited: where the drives sit, where the gun rings are, which stations a class
even has. Those are authored numbers in `design.ts` and they are wrong often
enough to be worth a screen.

**It is an authoring tool, and that is a safety property rather than a
limitation.** What a class derives is in the core's own table, and that table
is hashed into the match state, so a frame edited here and flown there would be
one seat playing a different ship from the other: a desync with no message on
it. So the architect previews and EXPORTS, and an edit reaches a match the way
every stock number already does, by going back into `design.ts` and through
`measure_fleet.mjs --sync`.

What makes that true is `setFrameOverride`, which is deliberately ONE frame at
a time, set on the way into the screen and cleared on the way out. Leaving
clears it, and `routes.mjs` and `shipyard.mjs` both check that it did, because
an override left standing would follow a player into the yard and into a match.
It is folded into `rasterSig` too: that cache is keyed on the CLASS, so two
different frames under one class key would otherwise share a raster.

**It is a MODE of the shipyard rather than a screen of its own.** The canvas,
the orbit, the picking, the derive readout and a rail that becomes a bottom
sheet at 390px all already exist and all already work; a second screen would be
a second copy of every one of them, and the copy is the one that stops working
on a phone. The first layout of the rail proved the point: laid out whole, the
file row sat under twenty nine scrolling stations and was off the screen at
both phone sizes, which is the briefing's own defect a second time.

**Both resources are files.** `frames.ts` reads and writes JSON for a frame and
for a design, with a format stamp and a reader that refuses what it does not
understand rather than half loading it. An imported file is UNTRUSTED input
even when a player wrote it: a socket at z of 9000 or a kind this build has
never heard of has to come back as a message rather than as a lattice write off
the end of an array. A frame file is laid OVER the authored class rather than
replacing it, so a file cannot invent a hull shape or move a class onto another
navy's ladder; the profile and the spine are not editable for the same reason
the ladder is one number rather than twenty three tables.

## A persisted resource gets a URL, always

**This is the rule for every future feature, not a description of the current
screens.** The moment something in this app becomes a thing that OUTLIVES the
tab it was made in, it gets an id and that id gets a path. No exceptions
waiting to be argued: decide the route in the same change that adds the
resource, because a resource shipped without one is a resource somebody has to
retrofit a URL onto later, against code that has already grown used to not
having one.

**What counts as a persisted resource.** Anything with an identity that
survives a reload: a saved game, a room, a design, and whatever comes next.
Campaigns, fleets, replays, tournaments, saved layouts, a shared scenario. The
test is not "is it on a server" but "could a person reasonably expect to come
back to this, or send it to somebody". `localStorage` counts. A practice match
lives only in this browser and still has `/play/<gameId>`, because a reload is
coming back to it.

**What does NOT.** Transient view state: which tab is open, what is selected,
where the camera is, a half typed name, a tool mode. Those are how you are
looking at a resource rather than which resource you are looking at, and
putting them in the address makes URLs that are noisy to read, awkward to
share and impossible to keep consistent. If it would be strange in a link you
sent a friend, it does not belong in the path.

**What the URL has to actually do**, and all three are checked in
`web/tests/routes.mjs` rather than assumed:

1. **A reload lands back on the resource**, showing the same thing, not the
   lobby and not an empty version of the screen.
2. **The address updates when you get there**, including when the resource is
   created. Saving a new design has to leave you on that design's URL: a page
   whose address still says "new" after the thing exists is a page whose Back
   button and refresh both lie.
3. **A dead id falls back and REWRITES itself.** An address naming a resource
   that is gone goes to the lobby and fixes the address bar, so a stale link
   does not leave a URL that will fail the same way tomorrow.

**A route that cannot say "nothing loaded" lies the moment something is.**
`/ship` used to mean "show the designer with whatever is in it" rather than "a
new design", so closing a saved hull and pressing Shipyard put you back in that
hull at an address claiming a blank one, and Save then quietly updated the row
you thought you had left. The no-id route needs to actively clear the resource,
not merely fail to name one.

**One path in, or the address and the screen will disagree.** Opening a design
from the library used to navigate AND load the row itself, so the design
loaded twice: `route.go` runs the route handler synchronously, which fetches
and loads it, and then the caller loaded its own copy over the top. Navigate
and let the route do the work.

**A default is a resource too.** Every stock hull has an address:
`/ship/terran_frigate`, `/ship/rogue_cruiser` and the rest. The class keys are a
closed authored set,
so an id that names one is that hull and no design id can collide with it, and
`route.ts` needs to know nothing about it: it parses `/ship/<id>` and what an
id MEANS stays with the app, the same division that keeps it from knowing the
screen list. Picking a class in the editor pushes that address, so browsing the
classes is a trail you can walk back.

## Four navies with a ladder each, seven civil trades, and one list

The fleet is a LADDER for the navies: corvette, frigate, destroyer, heavy
cruiser for Terran, Karisen, Rogue and Benefactor. The civil yards do not build
a ladder, they build TRADES: freighter, lighter, hauler, container ship,
tanker, mining ship and liner. Twenty three classes.

**A rung is a LATTICE, and a voxel is one size for the whole game.**

```
corvette  24 x 24 x  48        every one of those cells is 3.5/64 of a unit
frigate   32 x 32 x  64
escort    48 x 48 x  96
cruiser   64 x 64 x 128
```

A rung used to be a CELL SIZE: every class was 32 x 32 x 64 and what changed
was what a cell was worth. That made the ladder one multiplication, and it made
the ladder a lie. A heavy cruiser was a frigate drawn four times as big with
exactly as many cells in it, so the Karisen cruiser carried the SAME VOXEL
COUNT as its own frigate at 4.34 times the length. Nothing in the fleet said a
big ship was a big ship, because nothing counted; a voxel model whose voxels do
not mean anything is a mesh format with extra steps.

So `RUNG` is four lattices, `VOXEL` is a constant, and everything a size ought
to buy is COUNTED. Terran plate cells up the ladder: 2268, 6029, 21509, 65443.
A heavy cruiser is heavy because it is four times a frigate's skin at twice the
plating, and it is slow because that mass is real.

Three things follow and none of them is cosmetic.

**A FRAME MEMBER DOES NOT SCALE.** `Lat.beam` caps a keel run's section at two
cells, three on a heavy cruiser, and only its RUN is cut to the lattice. A
keel is a beam and a beam is the same beam whatever it is holding up, exactly
as a turret is the same handful of cells and a drive bell the same bell.

Scaling it was a real defect and it is the one thing a bigger lattice makes
WORSE rather than better, because a solid box is the only thing in the model
that gains nothing from more cells: everything else grows detail, a box just
grows. The Terran heavy cruiser's raised dorsal run came out 20 cells across
and 4 deep over 84 stations, which is a grey slab welded along the top of the
ship. And a flat box cannot follow an elliptical deck, so its corners and its
ends stood proud of the plating that was supposed to cover it: 1496 of its
frame cells were outside its own hull, against 0 on every frigate and corvette
in the fleet, and the Benefactor cruiser was worse at 3.96 percent of the whole
ship. Capped, the worst hull in the fleet is 0.03 percent.

The authored `w` and `h` are still worth having, because the cap is a MAXIMUM:
a class authored with a light one cell girder still gets a light one.

**Armour courses scale with the rung, and they have to.** A course is a cell
and a cell is the same size everywhere, so a cruiser plated to a frigate's six
courses is plated to a frigate's THICKNESS: twice the ship behind the same
armour. Plate volume is skin area times thickness, so a fleet whose courses did
not scale would have hull points going as the SQUARE of length while gun counts
go as length, and a heavy cruiser dies to another heavy cruiser in one turn.
`stock()` cuts its authored courses to the class's lattice, thickness goes as
length again, and hull goes as the cube of it: 69, 121, 258, 519 up the Terran
ladder. The SLIDER stays in cells, because a player asking for four courses
means four courses on whatever hull is on the bench.

**A volume's HP is a share of its own hull now** (`SUB_HP_REF` in
`measure_fleet.mjs`, 240). It used to be a hand written ladder beside the class
table that did not relate to the hulls next to it: a Terran frigate carried 100
points in each belt against 121 of hull, and a frigate therefore died before it
could be shot apart a volume at a time, which is why `tests/turn.rs` asked its
questions of heavy cruisers. The cruisers only worked because their hulls were
eight times a frigate's while their volumes were three. Solved rather than
picked: a belt absorbs 80 percent and bleeds 20, so taking one off costs an
eighth of the hull behind it, and the volume in front of a shot goes before the
ship does on EVERY class.

**`FRIGATE_CELL` in `data.rs` is still a REFERENCE, not a statement about
frigates.** `PLATE_UM`, `HULL_MILLI` and `MOUNT_RADIUS` are authored per cell of
that size; `VOXEL` is what the fleet is actually built out of, and the ratio
between them is what a cell of plate costs. Setting one to the other looks
right and undoes the change it is following.

**A cell index is meaningless without its lattice.** `d.plate` and `d.cut` are
indices, so cell 5000 is one place on a corvette and another on a heavy
cruiser. A design record carries `lattice`, `migrateDesign` carries an older
one onto the hull it was drawn for, and every route a stored design takes into
the app goes through it: the library, a save, a file and a draft. A FRAME file
is refused instead (`fallen-tribes/frame@2`), because a frame is an authoring
artefact with one copy and a hand to re-cut it.

**A navy still authors ONE envelope.** `NAVY_SECTION` is written in REFERENCE
cells and `profileFor` cuts it to whichever lattice the class is on, so the
world size ladder is exactly the lattice ratio by construction. So is every
socket, every keel run and every rib: the whole `FRAMES` table is authored in
frigate cells and evaluated once per rung with the lattice set, and `Z`, `RX`,
`RY`, `UY`, `PX`, `SX`, `keel` and `slab` are what say so. Four hand written
copies of a Terran would be four Terrans that drift. What still separates a
rung is where the volume SITS: `FULLNESS` is an exponent on the longitudinal
distribution, so a heavy cruiser carries its waist further fore and aft and a
corvette is a needle, and neither can change the ladder, because one raised to
any power is one.

Measured, and this is the command that measures it:

```
node tools/measure_fleet.mjs                  # the table, with the lattice and the ladder
node tools/fleet_shots.mjs --ladder terran    # the same claim as a picture
```

corvette 0.70 to 0.79, frigate 1, destroyer 1.42 to 1.51, cruiser 1.88 to 2.02,
which is the lattice ratio and nothing else. The
picture is the one that answers "are they actually bigger", because the
shipyard FRAMES each hull to fill the view: a corvette and a heavy cruiser come
out the same size on screen and the screen cannot answer the question at all.
`--ladder` crops each shot to the hull and rescales it by the hull's own
measured length, so what is left is the ladder rather than the camera.

**Each navy is distinct in its SECTION, and it holds at every rung.** Terran is
wide and flat, Karisen long and near round, Rogue short and very broad,
Benefactor deeper than it is wide, civil nearly square because a container is.
Their ladders differ in kind too: Terran adds beam batteries, Karisen adds
missile cells and keeps two beams forever, Rogue adds berths and clamps and
almost no guns, Benefactor adds belt and calibre and gets slower at every step.

**A section alone is not a silhouette, so each navy BOLTS something on.** Four
navies cut from four sections are still four smooth lozenges. `decorFor` is
what makes a Terran a Terran across a battlefield: stepped strakes and vertical
fluting on the deck and flanks, wings swept off a Benefactor's keel line, a
rail overrunning a Karisen at both ends, a gantry welded across a Rogue's beam,
rack rails a civil hull stacks its boxes on. Three rules hold it together:

- **It is a function of the navy and the profile**, not a field on a frame, so
  a class added tomorrow gets its navy's habits for free and twenty three
  tables cannot drift about what a Terran looks like.
- **Every cell is placed against the SKIN at its own point.** A hull station is
  an ellipse, so a rail laid at a constant height above the keel line floats at
  its outer end and a rib laid at a constant beam floats at its top and bottom.
  `deckAt` and `flankAt` are the surface; `deckCell` and `flankCell` are the
  CELL, and it is the cell that matters, because a cell with a gap under it is
  a cell touching nothing.
- **Nothing may stand in front of a gun.** The Terran's strakes leave the
  deck's centreline open and the Rogue's blisters sit abaft its rings, and what
  says so is the arc scan rather than a comment.

**The stock spawn and the stock design are the same ship.** A class's `hull`,
`radius`, `mass`, flight envelope, marines, capacity and boarding range in
`data.rs` are what `derive(stockFor(key))` actually produces, measured rather
than guessed, so a hull fielded from the briefing flies like the one a scenario
seats. `radius` and `mass` are also the SPHERE and MASS gates, and
`web/tests/sim.test.mjs` pins them against the frame's own copies: if those two
disagree the editor's budget bar and the gate disagree, and a hull reads legal
and is refused.

**A pair of fittings lands on mirrored cells, and that takes four rules.** The
plane a ship is symmetric about runs BETWEEN columns 15 and 16, not down the
middle of column 16, which is the same trap `acrossFrom` was written for. So:
`PX` and `SX` name cells out from the plane and eighty four hand authored
`CX - n` / `CX + n` pairs that were a cell apart now use them; a part is seated
from the PLANE outward rather than from its box's low edge, and a centreline
part straddles it; the collision nudge walks MIRRORED on the starboard side,
because a list of absolute directions makes a pair move the same way in the
lattice and therefore opposite ways relative to the hull; and a pair is placed
AS a pair, the second taking the mirror of where the first landed rather than
searching for its own hole. Unmirrored part cells fell from 16.6 to 13.6
percent of the fleet.

What is left cannot be fixed by arithmetic: an ODD width part on the centreline
cannot be symmetric about a boundary, and a fitting the nudge has to walk a long
way lands where there is room rather than where its twin is.

**Sockets are seated by the PROFILE, not by counted cells.** `seatAt` takes a
fraction of the half beam and half depth at a station, so a socket is inside
the skin whatever section the class has, and `suite` lays the plumbing every
warship has in the same places: drives, retros, attitude blocks, the bridge
bay, berths and clamps. What a class is FOR stays hand authored, which is its
profile and its guns. The four frigates keep their original cell coordinates,
read off the archived silhouettes.

**A drive's volume is its own, like a turret's sweep.** Cells are claimed
first come first served and the nudge charged one point for a cell another part
held, so a fitting with nowhere better simply settled inside the engines: a
Karisen corvette carried twenty three cells of docking clamp in its drive
block, a Rogue corvette forty two cells of barracks, and most of the fleet had
one or the other in theirs. A bell now costs what a sweep costs, so the nudge
walks OUT rather than taking the nearest hole whichever it is, and the two are
kept apart for the reason they always were: a berth that lost a few cells came
out small, and a clamp bolted through an engine is not a ship.

Which exposed the seating that put them there. The bay and clamp stations were
a flat eight and nine cells off the transom, and eight was never a clearance,
it was a guess that the bells were shorter than they are. They clear the
LONGEST drive in the table now, because a frame does not know which one its
stock fit will carry, and the keel fallback is clamped to the same line: it
splits its pair fore and aft of the station, and the aft half walked straight
back into the bells the station had just cleared.

**Nothing may be buried and nothing may foul.** Cells are first come first
served, so a socket seated inside another part is not an error anywhere: the
part simply never appears while paying full mass. `sim.test.mjs` walks every
stock hull and fails on a placement that owns no cells, on an enclosed part
outside the hull, and on anything standing in a turret's sweep.

### What twelve more classes broke, which was all slack rather than code

Every one of these was a FALLBACK or a CLAMP doing its job. None of them threw.
The five class world had enough slack in every one of them that nothing showed;
seventeen spent the slack without a line of the code around them changing.

- **A clamp on the way in is a monster on the way out.** `classIndexOf` answers
  -1 for a class this build does not know, which crossed as `0xFFFFFFFF` and
  `class_from_index` CLAMPED it to the last class. With five that was the
  Freighter and the sphere gate threw it out loudly; with seventeen it is a
  heavy cruiser whose berth is big enough to ACCEPT the same hull, so a frigate
  came back wearing a cruiser's mass, hull and radius, all of them hashed, with
  no message anywhere. `ft_derive` refuses an out of range index now. Clamping
  is right for an index that came out of the core's own tables and wrong for
  one that came off the wire.
- **Three fixed cooldown slots.** A ship record carried `last_fired` for three
  mounts. Seven of the seventeen carry more, and the Terran heavy cruiser
  carries eight, so its last five mounts read as never fired for ever. Eight
  slots now (`ffi::SHIP_COOLDOWNS`), which moved every slot after them: the
  stride is 39 and both sides of the boundary say so.
- **The fire panel asked the CLASS.** `ship.weapons` is what the resolver
  fires and a design's mounts are not its class's, so a hull flying a design
  got rows for guns that are not aboard. `ft_ship_mount` answers for the ship,
  in `ft_read_mount`'s own layout.
- **A repair that invented hit points.** The prize crew's emergency repair is
  `max_hp * SUB_FAIL_FRAC + 50`, reasoned about at the LOWER bound only. A
  Rogue corvette's drive bay maxes at 56.25, so a captured one came out at
  61.25. Clamped at both ends, and `tests/subsystems.rs` drives a real capture
  rather than restating the arithmetic.
- **A catch radius authored at one cell size.** `MOUNT_RADIUS` is 0.45 because
  a turret is a handful of cells and the cell it was authored at is 7/64 of a
  unit. It was per class for as long as a rung was a cell size, because a
  cruiser's turret was then twice a frigate's and a fixed 0.45 was a catch
  radius smaller than the gun it catches. A turret is the same handful of cells
  on every hull now, so `data::mount_radius` is the same on every hull too,
  and scaling it per class would be a cruiser catching shots that missed.
  `MOUNT_HP` never scaled either, for the same reason: a turret is the same
  machine at every rung and costs the same mass, so it is the same 110 points.
- **Eight draft slots.** `drafts.ts` kept eight, which was one per class and is
  now half of them: merely BROWSING the picker evicted the saved hull somebody
  was building. Twenty eight.
- **A rounding heuristic with no room left.** `routes.mjs` told a designed hull
  from a class hull by "the number is not round", with forty points of margin
  at five classes and 0.022 at seventeen. It asks the core for the class's hull
  now and compares.
- **A picker that covered the model.** Seventeen chips wrapped to three rows
  over a 222px canvas at 390x560, so the centre of the view returned a button
  and the ship could not be turned by thumb. Each row is one line that scrolls
  sideways, and `shipyard.mjs` checks the CENTRE OF THE VIEW hits the canvas,
  which nothing did before: every other probe there is a button, so anything
  drawn over the model could grow without bound and the suite would keep saying
  every control was reachable.

**A class and its stock hull are the same ship, and now that is checked.** The
Karisen frigate has always armed its port sponson in the yard while its class
table carried two mounts, so the hull a scenario spawned and the hull the
briefing fielded had different batteries under one name. The class carries the
sponson beam now, APPENDED rather than inserted, because a mount index is what
a fire order names and what a snapshot stores.

**Unsaved work belongs to the address as well.** The shipyard drafts to
`localStorage` under a key that IS the route id: a design id for a saved hull,
a class key for one that has never been saved. That is what makes the URL name
the work in progress and not merely the starting point, and it is why two hulls
on the go do not tread on each other. The draft is written from `#refresh`,
which is the one choke point every mutation already goes through, debounced,
because a plate stroke fires per cell; it is flushed on the way out, since the
debounce is a timer on a page that is about to stop running. It WINS over the
stored version on load, because it is the newer work and the stored version is
one click away, and it says so on screen rather than swapping a hull silently.
A draft is not a save: it is never listed, never fielded, and is thrown away
the moment the real thing exists, because a draft that outlived its save would
come back over the top of it.

**Add the route to `route.ts` and the check to `routes.mjs` in the same
commit.** `route.ts` parses and formats and knows nothing about screens; what a
route MEANS stays in the app. And remember the trap the deep paths already
sprang once: **asset URLs must be absolute**, because a relative `./main.js` on
a two segment path asks for the wrong thing and the shell route answers it with
HTML.

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

## Dark gradients band, and the fix is two things

A nebula and a planet terminator are both very slow gradients across a very
dark range, which is exactly what an 8 bit pipeline cannot carry: the value
crawls, the output byte holds, and where it finally tips there is a hard edge.
Magnify that (the sky cubemap is blown up about four times to fill the
viewport) and each step is a contour forty pixels wide.

Two separate fixes, and both are needed:

- **Storage.** `bakeSky` renders to a `HalfFloatType` cubemap, so no step
  exists in the texture to magnify. 12 MB a sky against 6, once, at launch.
- **Output.** The canvas is still eight bits. The sky is drawn by `skyDome`,
  our own mesh, which dithers with triangular PDF noise below one output step,
  hashed off the pixel so a still sky stays still. Not three's background pass,
  which does not dither and offers no hook; not a post pass, because `post.ts`
  can take the composer away entirely and that would leave the sky banding only
  on the machines least able to afford a second look at it. Lit meshes get
  three's own `dithering` property instead, which is the same idea one line
  long.

Measured on a wide skirmish shot: the longest flat run of luma fell from 128 px
to 90 and the 99th percentile from 44 to 35.

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

The fleet cost **4999 bytes**: 158044 against 163043 on the SAME compiler
either side of the commit, for twelve classes with their subsystem and mount
tables, `ft_class_count`, `ft_ship_mount`, the wider ship record and the class
index refusal. CI shipped that source at 161302, which is the figure to quote.

The civil yards cost **2018 bytes**: 163043 against 165061 on the SAME
compiler either side of the commit, for six more classes, six more parts on
both sides of the boundary, and `civil_subs`. CI shipped that source at
163438. Cheap for six ships, and the reason is the reason the fleet was cheap:
a class is a row in a table, not a branch in a resolver.

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

The cubemap is also handed to `scene.environment`, and which materials that
reaches is worth knowing exactly, because it changed under this branch. Three
applies the scene environment to `MeshStandardMaterial` ONLY:
`materialProperties.environment = material.isMeshStandardMaterial ?
scene.environment : null`. When the sky landed the map hull was
`MeshLambertMaterial`, so the nebula lit only the gravity well bodies and the
cool bounce on a flank was entirely the FILL light. The PBR hull work then
made the map hull a `MeshStandardMaterial`, so on main today **the nebula does
light the ships** and the sky is a real part of the lighting rather than only
the picture.

Both halves of that are worth keeping. The rule is that a renderer feature
reaches the materials it reaches and no others, so check rather than assume;
the sequel is that the answer moves when somebody changes a material, and a
note like this one goes stale silently.

**The stars are GEOMETRY, and baking them was a mistake worth remembering.**
They started as a Voronoi lookup inside the baked shader, and they came out
soft. The arithmetic says why: a cube face is 512 texels across 90 degrees, so
at a 50 degree field of view on a 1280 wide canvas every texel is stretched
over 3.24 screen pixels, and `LinearFilter` interpolates across that.
`generateMipmaps` finished the job by averaging stars away in the lower mips.
Measured, in a patch of empty sky, a star was 3.53 px wide with a median of 4
and a worst of 6, which matches the predicted 3.24x almost exactly.

Resolution does not rescue it. 1024 faces are still 1.62x and cost 25 MB;
only 2048 is genuinely sharp, at 101 MB of VRAM, on a renderer whose floor is a
Pi 5. The error was not the budget, it was baking two things with OPPOSITE
frequency content into one texture: a nebula is smooth and survives resampling,
a star is a point and no texture survives one under magnification.

So the nebula stays baked and the stars are 7181 points in one draw call, about
200 KB, at the same Voronoi FEATURE POINTS the shader used to measure rays
against. Drawing the cell centres is what the distance test was approximating.
Measured the same way afterwards: 1.47 px mean, median 1, worst 3. Being
geometry also gives back the shimmer the bake had to give up (3.4's
`ShimmerSpeed`), since moving a point costs a uniform rather than a re-bake.

The general rule: **before baking anything, ask what its finest feature is
against the texel size it will be sampled at.** A picture that is going to be
magnified 3x cannot hold anything one pixel wide.

**The reach shell is a fresnel, not a wash.** The movement envelope was a flat
`MeshBasicMaterial` at 0.022 opacity, which has no view angle response at all:
every part of it was equally faint however the surface lay, so it read as green
fog rather than as a shape with an inside. `reach.ts` shades it by grazing
angle instead, which is the archive's own Nebula prop trick (3.6: "inverted
fresnel remapped into alpha times Color, a soft volumetric-looking gas blob on
a mesh") on a different mesh. `abs(dot(n, v))` because the mesh is double sided
and comes out of marching tetrahedra.

The numbers were SOLVED rather than guessed, after two guesses that both hid
the ships inside the volume. The rim term averages 0.2774 over a uniformly
oriented surface, so `0.005 + 0.2774 * 0.0613 = 0.022` puts exactly the old
flat alpha back, with three times as much of it at the silhouette and less than
a quarter on the faces you are looking through. Redistribute the ink; do not
add more. Additive blending on a CLOSED double sided surface lays it down twice
per ray, which is why a rim that looks reasonable in isolation goes solid.

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

## Which LIST three.js drew it in decides what covers what

`renderOrder` does not order the frame. Three sorts every object into two
lists, opaque and transparent, and draws all of the first before any of the
second; `renderOrder` sorts WITHIN a list. So a very negative one on a
transparent object still puts it after every opaque hull on the map.

That cost the star field. It was `transparent: true` (additive blending needs
it) with `depthTest: false` and `renderOrder: -20`, and a comment explaining
that it was therefore drawn first and covered by the scenery in front of it.
It was drawn LAST, over everything, with the depth test off: a fleet with the
sky showing through it. `skyDome` does work that way and that is why the
mistake looked reasonable, but the dome is OPAQUE, which is the whole
difference.

The rule that comes out of it: **an object that must be behind the fleet is
either opaque and first, or depth tested.** Blending decides which of those is
available to you, so decide the blending first. The stars are depth tested now,
at 4500 units inside a 6000 unit far plane, and the planets write depth so that
something can stop them.

`checkStarsStayBehindTheFleet` in the playthrough is the check, and its first
cut is worth knowing about too. It measured from the fleet view, where a
frigate is 650 px of a 700000 px canvas, and 7181 stars over a whole sky miss a
target that size: putting the defect back left it GREEN. **A check whose
subject is smaller than its noise floor tests nothing.** It centres on a hull
and zooms all the way in first, which makes the silhouette 74000 px, and the
defect then reads as 56 lit pixels at up to 191 of 255.

## A NaN in a shader is not a wrong pixel, it is a hole

`pow` of a negative base is undefined in GLSL, and drivers lower it to
`exp2(y * log2(x))`, where `log2` of a negative is a NaN. `reach.ts` had
`pow(1.0 - facing, 2.6)` with `facing = abs(dot(n, v))` on two normalised
vectors, and a dot of two unit vectors comes back a shade over one when they
are nearly parallel. So looking straight down the envelope's own normal made
the base about -1e-7 and the alpha a NaN.

What a NaN then does is the part worth remembering. Additive blending is
`src.rgb * src.a + dst`, so a NaN alpha takes the DESTINATION with it: the sky
and the ships behind the shell were written as zero. And bloom SPREAD it, since
a NaN averaged with anything is a NaN and `UnrealBloomPass` runs a separable
blur at five halvings, so one poisoned fragment came back as a hard edged black
rectangle far larger than itself and square to the screen rather than shaped
like the surface that made it.

So: **guard every expression that can leave its domain, at the point it can
leave it.** `max(0.0, ...)` inside a `pow`, a length test before dividing by
one, a clamp on the way out. And do not expect these harnesses to catch the
next one: SwiftShader gives `pow` of a negative base a defined answer, so 96
poses across four window shapes and both pixel ratios found nothing while a
real driver showed it immediately. What IS portable is the invariant, and
`checkTheEnvelopeNeverBlacksAPixelOut` states it: an additive overlay may never
put a lit pixel out.

That check began as the stronger "may never make a pixel darker" and went red
on 316 px at up to 192 of 255, none of it a defect. Additive is monotonic in
the FRAMEBUFFER, and a screenshot is taken after tone mapping:
`NeutralToneMapping` desaturates a highlight by scaling every channel by
`newPeak / peak`, so a pixel that gains green has its red pulled DOWN. State an
invariant where it is actually true.

## C reports the camera, because a screenshot is half a bug report

A render defect that only shows "at certain angles" cannot be chased from a
picture: the pose is the missing half, and it is the half a person cannot read
off their own screen. Pressing C on the map writes the whole pose (both angles,
the distance and the focus, drawn value and goal alike), the match it is a pose
of, the viewport, the pixel ratio and which post path is running, to the console
AND to the clipboard, and says so on screen. `ftDebug.cameraReport()` is the
same thing for a phone, which has no C.

It sits outside the planning keys, which give up as soon as no ship is
selected, because where the camera is has nothing to do with whose turn it is.
Ctrl and Cmd pass through so copy still copies, and a C typed into a text box
is a letter.

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

**A turret stands on a FACE, and its base points at the core.** A barbette is
a drum with a ring at one end and a base at the other, and every one of them
was drawn +y up whatever face it stood on: under the keel the ring pointed
INTO the ship, and on a flank neither end was against the plating at all, so
the drum hung off the side by its rim and the gun above it was bolted to the
hull rather than to its own base. Thirty of the fleet's forty seven were
seated that way, and the suites were blind to it because a mount's cells were
counted and never looked at. `mountRoll` rolls a gun onto its face, from the
same `outwardAt` the plating uses, and `ringSeat` sets the ring flush in the
skin rather than three courses under it. The traverse follows through
`mountQuat`, which is `roll * aim * roll'`: a conjugation, because the cells
are laid already rolled and multiplying the roll in again lays a broadside gun
in the deck. Both gates stay in the SHIP's frame; only the two angles the
barrel is drawn at are the mount's own. It is checked by reading the CELLS:
the ring is the lit course, and its mean position along the outward axis has
to be outboard of the drum's own.

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

## A mount is bolted on at an ORIENTATION, not at an angle

A part used to carry `rot`, a quarter turn about the up axis, and that is only
enough to bolt a gun to a deck. It carries `pitch` and `roll` as well now, four
positions on each of three axes, which is what a broadside sponson or a ventral
turret actually is. Both new fields default to zero, so every design that
predates them loads as the hull it always was and there is no migration.

**The order is fixed and it is yaw, then pitch, then roll.** Rotation does not
commute, so two places composing the same three numbers differently would put
the same turret in two places. `AXES` in `design.ts` is that order, and it is
the only one.

**Two descriptions of one rotation, and they are derived from each other.**
`rotatedVoxels` permutes the CELLS, which is what keeps a turned part on the
grid instead of half a cell into the plate beside it. `faceBasis` hands the
renderer a 3x3 so a barrel can be aimed. Those two must be the same rotation,
so `faceBasis` is built by running `turnPoint` on a unit box rather than by
writing out a table of sines: `s - 1 - p` is `-p` when `s` is one, which makes
the cell map its own linear part. `web/tests/facing.test.mjs` then checks it
cell by cell, every module against all 64 facings, plus that the basis is a
rotation and not a reflection: a mirrored turret has every cell in a legal
place and nothing downstream can tell.

**A rotation is refused for TWO reasons and no others.** The base leaves the
ship, or the body stands where something already is. A turret under a keel,
laid along a flank or pointing aft is a design decision, and an editor that
argued with it would be an editor that knows better than its user.

**And the way that is answered is by rasterising twice and comparing.** The
first cut placed the part itself and counted what it landed on, which reads as
obviously right and disagreed with the real placement immediately: the raster
NUDGES a part that does not fit, seats first come first served, and lets a part
sink through the frame. It refused the stock Terran's own drive bell at the
facing the hull ships with, which is an editor that will not let you save the
design it just opened. `mountFouling` asks the rasteriser instead, and compares
against the CURRENT facing rather than against a perfect fit, because a hull as
authored is the baseline a rotation has to be judged from. Measured on the
Rogue corvette, which is the least hull in the game and therefore where a part
actually runs out of room: 984 of 1088 facings taken, 80 refused for fouling
and 24 for lifting off. A Terran frigate's beams take all 64, on all three
mounts.

**Anything keyed on a design has to know about all three axes.** `rasterSig`
carried the yaw alone, so two hulls differing only in a roll shared a cache
entry and the second was handed the first one's cells.

### A barrel swings in the MOUNT's frame, and the gates stay in the ship's

Which way a mount was bolted on changes where its cells are and therefore what
its own hull shadows. It does NOT change what the gun may shoot at: the
authored arc and the mask scanned off the hull are both about the hull, so both
gates are asked in the ship's frame exactly as before, or a player would widen
a limited arc by rolling the turret over.

The ANGLES are the mount's. `turretGoal` takes the direction into the mount's
frame before measuring, and `poseMatrix` is `F * Ry * Rx * F^-1`: undo the
facing, aim, put it back. The cells come off the raster with the facing already
baked in, so a plain `Ry * Rx` elevates about the SHIP's beam, and that was a
real defect in the yaw only code rather than a new hazard. A mount yawed a
quarter turn has the ship's beam running straight down its own barrel, so its
elevation moved nothing at all. Both of these live in `turret.ts` because the
map and the shipyard draw the same turret, and a second copy is the divergent
path GUIDELINES 5.1 is about.

`HullRig.rest` and `Rig.rest` are gone. A scalar can only describe the one axis
this used to have, so a rig carries the basis and the pose is a matrix.

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

## A volume is offline before it is gone

A hit volume is a box full of machinery, not a barrel with a health bar on it.
Shots take it apart a piece at a time, so it stops being what it was long
before the last piece has gone: past **a fifth of its starting mass** it is
offline, and `Sub::offline` in `state.rs` is the one place that says so.

That is the OPPOSITE of a weapon mount, deliberately. A turret is bolted on
whole and comes off whole; it is never partly shot away, and
`WeaponSlot::destroyed` is its own separate answer. The two rules are the two
halves of "what does losing part of a ship mean", and confusing them is how a
gun ends up firing out of an empty socket.

`SUB_FAIL_FRAC` is mirrored in `prototype/sim/data.js`, and has to be: the
prototype is the design reference, and a reference that disagrees with the
thing it references is worse than none. The one place the two could part is
the prize crew's emergency repair, which hands a captured hull's drive back at
a fixed 50 HP: on a big enough bay that is still under the line, so both
implementations clamp it above one. `tests/subsystems.rs` pins that they never
disagree.

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

## A lookup that falls back cannot find its own typos

`skyFor` and `backdropFor` answer an unknown scenario with a default rather
than throwing. That is right at runtime, where a level with no entry should
still be playable, and lethal at authoring time: `SKIES` and `BACKDROPS` were
keyed `low_orbit` against a scenario called `low-orbit`, so the one level whose
entire premise is a heavy body below you matched nothing, wore the skirmish sky
and had no body below it. Nothing failed. It just looked finished.

`tests/scenery.test.mjs` closes it in both directions: every practice level
must have a sky and a backdrop of its own, and no table may carry a key the
menu never asks for. The second half is what catches a rename that only
happened on one side.

## A wound is TWO surfaces, and both keep their UVs

A hit does two different things to a hull, and drawing them as one material
gets one of them wrong. The surviving cells of a partly hit plate are still
PLATE: they keep the hull's own finish, because a panel shot round the edges is
not made of something else. The faces the hit OPENED are the inside of the
ship, and they wear what machinery wears.

Both need UVs, and neither had any. `quadGeometry` takes them as an optional
argument and the wound passed none, so the normal map had nothing to sample and
a shot took the plating detail off a whole region: what grew back was flat
paint, which is exactly what a finish DELETED by damage would look like. The
material was bound and the texture was loaded and only a geometry channel was
missing, which is why nothing caught it.

`ftDebug.surfaces()` reports each torn surface's UVs and whether its map has
pixels, and the playthrough fails on either. Dropping the `sUv` argument flips
`uv` to false on the plate wound, which is how the guard was checked.

## The camera has a goal and a position

Two of everything: a GOAL that input writes and a value the camera is drawn
from, eased toward it with `1 - exp(-k * dt)` so the ease takes the same wall
time at 20 frames a second as at 120. Distance eases in LOG space, because zoom
is multiplicative: a step from 900 to 800 and one from 20 to 18 are the same
gesture, and a linear lerp makes the first crawl and the second snap.

**A follow is the exception, and that is the whole point.** Easing toward a
target that moves every tick is a camera that never arrives and always lags,
which reads as jitter rather than as smoothness. So a follow eases IN once and
then locks: `#locked` goes true when the gap closes, and from there the focus
is copied exactly. The ORBIT keeps easing either way, because turning round a
ship you are following is still a camera move.

Readiness tests read the GOAL rather than the eased value. A camera on its way
in has been sent, and testing where it happens to be this frame flashes the
ship data overlay off for the fifth of a second the move takes.

## Anything drawn ON a hull asks the MESH where it is

`ShipState.pos` is the pose a turn STARTED from. `setPoses` moves the meshes
every tick of a playback without touching it, so anything that reads the state
tracks a ship to where it used to be. This has now been the same bug three
times: the camera lock, the volume labels, and `pickShip`, where the sphere a
player clicks to focus on a hull stayed behind while the hull flew off, so
clicking the ship they could SEE did nothing.

`poseOf` and `#livePos` are the answer, and everything drawn on or pointed at a
hull goes through them. Expect a fourth.

## Three pictures of one hull, one surface

The map, the shipyard and the schematic all draw the same cells, and until
recently only the map drew them as a PBR surface. A player designed on flat
Lambert and flew plated Standard, which is the same ship shown two ways and
the exact divergence GUIDELINES 5.1 is about.

All three draw `MeshStandardMaterial` now, with the DESIGN's own finish,
metalness and roughness. Two surfaces rather than one, and the distinction is
plate against machinery: an armour panel and a drive bell are not the same
thing, and painting the plate's rivets onto a reactor made a ship one material
with parts drawn on it. `PART_FINISH` is greebled, more metallic and rougher,
and it is what a cell belonging to a placement wears wherever the picture does
not split machinery further: the schematic's torn edge and the inside of a
wound on the map, both of which are a mixed cross section rather than one
fitting.

That started as ONE finish for all machinery, on the grounds that a player can
already tell a drive from a gun by its COLOUR. True of the colour, and never
true of the SURFACE: a drive bell is a cast nozzle, a turret is a machined gun,
and a barracks is a welded box, and one greeble over all three says they are
the same material. Machinery is three finishes now, `SURF_DRIVE`, `SURF_WEAPON`
and `SURF_PART`, routed by `purposeAt` rather than by module kind, because
`purposeAt` is the same answer the COLOUR legend is already cut from and a
fourth division would be one a player cannot name. Propulsion and attitude are
the drive, gun and ordnance are the weapon, everything else is a part.

`driveFinish` and `weaponFinish` both fall back to `partFinish`, so every
design that predates them loads as the hull it always was and there is no
migration.

**And the yard draws all four, because that is the screen the dropdowns are
in.** It used to draw every cell that is not plating out of ONE material, so
three of the four finish controls changed nothing a player could see while
they were setting them: a control whose effect is somewhere else is a control
nobody can tell the state of. Four instanced draws rather than one, at no fill
cost, because the same cells are drawn either way.

**A design FILE is read field by field, and that list is the actual
contract.** `designToJson` writes the whole record and `designFromJson`
whitelists what it will take back, so a finish left off that list is a finish a
hull loses on the way through a file, silently, coming back wearing the
fallback. `slotFinish` was already going that way before the drives and the
guns got theirs. `sim.test.mjs` round trips every one of them now, and checks
that a slot list full of rubbish comes back as nulls rather than costing the
seven good entries beside the bad one: a file is untrusted input even when a
player wrote it.

The yard and the modal are indoor views with no sky, and metalness with no
environment renders BLACK, so both take `studioEnv` from `textures.ts`: the
same PMREM'd strip, cached, whose two ends are the colours their own hemisphere
light already uses.

The YARD is the one that cannot afford the whole material, and that is a
measurement rather than a taste. It draws a BOX PER CELL, about 6500 of them on
a Terran, where the map draws 1083 greedy quads: it is fill bound, and a PMREM
environment lookup per fragment is most of its frame. Measured headless at
1400x900: standard with a normal map and an environment 1.0 fps, the same
without the environment 1.4, and the Lambert it replaced 1.8. So the yard keeps
the finish and drops the reflection, which means its metalness is zero, and the
battlefield keeps the full material because it is not paying a box per cell.

That cost a test, and the fix was to make the test measure the right thing. The
turret tracking check waited 2.6 SECONDS for a turret to swing; at 1.4 fps
against the delta clamp that is four frames of movement, so it was reading the
renderer's speed and calling it a turret that would not turn. It waits for
FRAMES now.

`thumb.ts` stays Lambert on purpose. A 44 pixel chip has no room for a normal
map and no environment to reflect, so it would be two texture fetches for a
picture nobody can see them in.

## A window is a hole in the PLATING, not a part

**And it looks THROUGH the plating, not one cell into it.** A belt is courses
thick, so a room behind it is that many cells inside the skin and a rule that
looked exactly one cell inward found a room only where the armour happened to
be one cell deep. Measured over the fleet it was finding almost nothing: a
Terran corvette carried a bridge and drew no viewport at all, and a container
ship with twelve boxes in it showed six door panels. Every cell crossed has to
be plating, so a window still means "a room immediately behind this skin"
rather than "a room somewhere along this line". Counts went from single digits
to hundreds.

**How far it looks is not a constant, and the second time it was one it broke
the same way.** Two things put a room further inside a bigger hull and both
scale with the rung: the PLATING, since courses are cut to the lattice and the
fleet's belts run from one course on a Rogue frigate to twelve on a Benefactor
heavy cruiser; and the ROOM, since a bay is seated at a fraction of the half
beam, so the same fitting on a hull twice as wide sits twice as many cells in.
A flat five cells tracked neither, and the Terran destroyer, the Terran
cruiser, both Benefactor heavies and the Rogue cruiser drew NO room decal at
all, only the running lights on their clamps, which sit on parts standing proud
of the skin and never had to look through anything.

So the reach is the rung's own, and never less than the CLASS's stock plating.
The ceiling is still there for its original reason: a player may lay fifteen
courses on a frigate, and fifteen courses over a barracks is a barracks nobody
has a window onto. Taking the class's STOCK courses rather than this hull's is
what keeps that true while a heavy cruiser still gets its viewports.

The check that missed it counted FACES, and a beacon is a face. `sim.test.mjs`
counts hulls lit by running lights ALONE now, and at most one may be: the
Benefactor heavy cruiser, which is the hull rather than the rule. It is the
narrowest section in the game under the heaviest belt, so `laneOf` stacks its
berths up the centreline and leaves a void between them and its twelve courses
of plating, and a ship with no room against its own skin has nothing to put a
window over.

**A cabin does not have a window in the roof, and `WINDOW_FACE` is what says
so.** It names the axes a decal's normal may run along: `x` the flanks, `y` the
deck and belly, `z` the bow and transom. The first cut had two settings, `ends`
and `sides`, and `sides` meant "across or up", so every room decal tiled the
DECK and the BELLY as well: a Terran frigate carried a field of a hundred and
forty lit cabin panes across the top of its hull. A berth looks out sideways,
and so do a promenade, a gallery and an airlock porthole. A bridge is the
exception among rooms and keeps the bow, because a bridge looks where the ship
is going. Running lights genuinely go anywhere, because they are lights rather
than windows.

Three are about the module's own shape instead. A container's doors are on its
END and a radiator's slats run down a FLANK, so tiling either over every
exposed face of the module turns a box into a wall of doors: a container ship
came out wearing a thousand of them, one per cell, each the size of a hand. It
wears eleven now, which is about one per container, which is what a container
has.

**Windows are asked about the room behind the MIRROR cell as well.** A ship is
symmetric about its keel and its windows should look it; measured over the
fleet, half of every window cell had no twin. The rooms are not the problem:
every fitting is authored on a mirrored pair of sockets and all 432 pairs are
exact. What moves them is the rasteriser's own collision nudge, which walks a
part until it fits, sees whatever the placements before it left, and therefore
displaces one side and not the other. So the skin is asked about its own room
and about its mirror's, which is the ship as DESIGNED rather than as the packer
settled it. Both cells have to be plating with the mirrored face exposed, so it
can never light a pane on a surface that is not there.

`sim.test.mjs` holds the fleet above sixty percent mirrored. The gap is honest
and is about the hull rather than the windows: plating that is not itself
mirrored, and fittings the nudge walks off their sockets.


Authored on the module (`ModuleDef.window`) and derived onto the skin: the
plate cell whose inner neighbour belongs to a bridge wears the bridge viewport,
one over a barracks wears cabin panes, one over a clamp wears running lights.
That survives any change to the rasteriser, which a list of cell indices would
not, and it means a stock hull gets its windows for free from the rooms it
already carries.

Three maps, and emission alone cannot do it. Emission only ADDS, so an unlit
pane over hull paint is hull paint, which is how a cabin came out the same
shade as the plating and one window looked missing altogether. The COLOUR map
is what makes glass dark; emission lights the panes that are on; the normal
seats the whole thing into the plate.

Window faces leave the greedy pass entirely rather than merging into it, and
they are unmerged on purpose: each picks its own slice of its decal's variant
strip by a hash of its CELL, so a run of quarters down a flank is lit
differently along its length instead of reading as one panel repeated. A hash
rather than a counter, so adding a cabin elsewhere on the ship does not relight
this one, and so both seats and a re-watch light it the same way.

## Load every asset from the SITE ROOT

The console is served from `/play/<id>` as well as from `/`, so `./ember.png`
there is `/play/ember.png`, and the shell route answers that with the index
page. A texture handed 86 KB of HTML does not throw. `TextureLoader` fails to
decode it, the material keeps a normal map with no pixels in it, three.js then
samples an empty texture so every fragment gets a garbage normal, and the hull
draws as flat dark paint: exactly what a finish that was never applied looks
like. The ember atlas and all nine armour finishes shipped dead that way, on a
branch whose commit message said they were live.

`main.ts` already loaded the wasm absolutely and said why on the line above it.
Three later loads did not copy the lesson. So there is ONE loader now:
`textures.ts` owns every path, and the map, the shipyard and the schematic all
ask it. A fourth caller cannot spell the path its own way because it has
nowhere to spell it.

So: a leading slash, and PROVE it rather than asserting it.
`ftDebug.surfaces()` reports, per hull, the material, its two PBR numbers, the
finish's file name and whether that file has pixels, and the playthrough fails
if a bound finish has none. Putting `./` back flips `loaded` to false on every
hull, which is how the guard was checked.

## And a picked colour is a BRUSH, not a scheme

Choosing a swatch used to set `paint`, which every livery role is an OFFSET
from, so picking a colour repainted the whole ship in a scheme built round it
and there was no way to say "this cell, that colour". Hull colour and the brush
are two controls now: one is the base the livery is cut from, the other is a
colour you pick up and lay on ONE cell.

`Design.tint` is the strokes, as `cell * 8 + slot`. A wire format beside
`plate` and `cut`, measured against the same budget, so it is one integer per
cell rather than a pair; it migrates across a lattice change with its colour on
it. It rides into the raster on the high BIT of `tone`, which is the byte the
livery role already travels in, so the map, the shipyard, the schematic and the
wound paint the same cell the same way without four of them learning what a
brush is.

Armour only, and that is the rule rather than a limitation to work around: a
part is coloured by what it DOES, so a drive is orange and a gun is red on
anybody's ship, which is what makes an unfamiliar hull readable without a
legend. The brush says so when it refuses.

## A hull is a LIVERY, not a colour

A ship used to be one paint value and one normal map from transom to nose, and
seventeen ships drawn that way are seventeen ships told apart by hue: the other
seven swatches in every palette sat in a picker nobody could see the effect of.

A hull is eight ROLES now, in `LIVERY_ROLES`: the broad plating, the deck, the
belly, the waist belt, a bow flash, a transom band, a stripe down each flank
and whatever the navy bolted on. `roleOfCell` decides which from the same
normalised coordinates the shell already uses to decide how thick the plate is
there, so a livery cannot move a single cell: it is a second answer about a
cell that exists either way, written into `Raster.tone` beside the material.

**This is a RETURN, and the objection that deleted it the first time is
answered rather than stepped round.** Positional livery existed once and was
removed because a player picked a colour and got a scheme built round it: the
pick was a seed rather than a decision. What is different is that the pick is
role `hull` ITSELF. Every other role is a fixed OFFSET from the picked swatch
round the palette, so the broad plating is exactly the colour that was chosen,
picking the next swatch along really does repaint the whole ship, and because
the offsets are a PERMUTATION of nought to seven, every swatch in the palette
lands somewhere. `shipyard.mjs` checks both halves: eight tones on the hull,
and the picked one among them on the broad plating.

**So a swatch is a PRESET, and the control has to say so.** Eight swatches
under a heading reading "Hull colour" look like eight colours, and they are
eight whole schemes: picking one moves all eight roles at once. That row is
labelled "Scheme preset" and says what it does. WHICH palette those eight come
from is a separate question and now a separate control, a dropdown over the
five palettes, because a row of faction chips looked like a side to fly for
rather than a set of colours to paint from.

**Every surface gets its own normal map dropdown, and they are all on screen at
once.** There used to be two, one for the armour and one for "the selected
slot", so seven of the eight slot maps were unreachable and neither dropdown
said which colour it was about. The rail lists all twelve: the eight slots, each
beside a chip in its own colour, then Hull frame, Engines and thrusters,
Weapons and Subsystems. A control that governs one of a set has to be shown once
per member of that set, or it is a control nobody can tell the state of.

**Three normal maps for the LIVERY, and one per slot for the BRUSH.** A colour
is free, because a vertex carries its own and any number of them merge into one
draw. A normal map is a material and a material is a DRAW CALL, so "different
patterns on one ship" costs one group per pattern.

`ARMOUR_BANDS` is three and stops at three, because that is what the livery
paints by ITSELF, on every hull, without being asked: the broad plating, the
trim that runs along it, and the structure bolted to it. A fourth would be a
draw nobody could name.

`SURF_SLOT` is eight more, one per palette slot, and they are OPT IN: a slot is
a colour AND what it is made of, and a group is only emitted for a surface that
has quads in it. So a hull nobody has painted costs exactly what it always did,
and a hull painted from two slots pays for two. Measured on a Terran frigate,
draw groups: 6 bare, 7 painted from one slot, 9 from three.

That makes fifteen surfaces on a hull, seven of them there whatever a player
does, and `SURF_NAMES` is what reports them. A bare Terran frigate draws six of
the seven: plate, trim, structure, drive, weapon and part, the frame being
entirely inside its own plating on that hull.
`view.ts` used to spell the list `['armour', 'frame', 'part']`, which was right
for exactly as long as there were three: a fourth would have been reported
under the third's name, so a trim band whose texture never loaded would have
read as a healthy frame.

## Nothing may float, and everything did

A ship is ONE object. A cell touching nothing is not a piece of armour, it is a
block hanging in space beside a hull, and every stock hull in the fleet had
some: seventy of them on a Rogue corvette, most of an attitude block that its
own pylon had never reached.

The pylon pass could not reach them, and the reason is worth keeping. It starts
at a part's OUTBOARD cell and steps inward, and its first step lands on another
cell of the same part, which it reads as "met the ship". So the fix is at the
end of `rasterise`, where the pieces are actually known: flood fill on SIX
neighbours (two cells meeting at an edge are two cells touching at a line,
which is not a weld), weld each loose piece back with a spar, and take off only
what will not weld.

The weld tries every cell of the piece, nearest the axis first, because the
nearest cell of a drive cluster has the rest of the cluster inboard of it and
the walk meets the piece itself on its first step. When no cell finds anything
inboard, the piece is off the END of the hull, where the profile has no beam to
walk toward: it marches along the keel instead.

What comes off is COUNTED and reported, in `Raster.orphans` and on the yard's
readout, because a player who draws a plate that reaches nothing should be told
rather than tidied up after.

## A turret has to be able to see out

Three separate things had a mount pointing into its own ship, and the arc scan
had been saying so all along without anybody reading it.

**A trunnion went two cells UP from its ring**, whatever face the ring was on.
On a dorsal ring that is out; on a VENTRAL ring it is two cells further into
the ship, and two mounts on the Terran heavy cruiser scanned as blocked in
every direction there is. A gun goes on top of its barbette and "top" is away
from the hull, so the trunnion is seated on the SKIN, on the face `outwardAt`
says the ring is on.

**A ring has a REST FACING**, and the frame knows it where a placement cannot.
A ring on the port flank is a broadside mount, and a broadside gun resting dead
ahead is a gun looking down the length of its own ship. `ringFacing` rests a
flank mount trained outboard and a centreline mount ABEAM, to opposite sides
fore and aft, because a pair of centreline mounts resting fore and aft look
straight at each other. The player's `rot` is added to it rather than replacing
it, so turning a mount still means turning it FROM where its ring puts it.

**Mirrored sockets were not mirrored.** `CX` is 16 on a lattice of 32, which is
a cell BOUNDARY rather than a cell: the plane a ship is symmetric about runs
between cells 15 and 16, so `round(CX + u*hw)` and `round(CX - u*hw)` do not
land the same distance out. The Benefactor frigate's port ring sat at 0.80 of
the beam and its starboard twin at 0.98, and the scan read it straight back as
one gun 68 percent blocked and the other 36. `acrossFrom` mirrors the INDEX
rather than the arithmetic.

Measured across the fleet afterwards: every mount sits at 30 to 53 percent
blocked, which is its own hull and nothing else, and not one is blocked in the
direction it rests.

## A class wears its own surface

Four frigates in the same riveted plate are four frigates a player tells apart
by colour alone, and colour is already saying whose side they are on. So each
stock design carries a finish and its two PBR numbers, and each pick is the
class's own description read back: Terran riveted (a working navy's standard),
Karisen corrugated (it plates all four long faces and the silhouette is
stacked; corrugation gives a hull a direction), Rogue battered and barely
metallic (least hull in the game, a third of its mass in boarding gear),
Benefactor ablative hex, tight and glossy (the one hull that looks engineered
rather than fabricated), the freighter on grip deck with almost no specular.

`stockFor` copies them across. It rebuilds a design field by field, so a new
field that is not listed there goes missing between the table and the map
silently, exactly as if it had never been set.

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
every saved design. The roster comes from `ft_scenario_roster(scenario)`, which
builds the scenario and reports the side and class of every ship in it: what a
level fields is the core's own answer, not a table beside it in the client that
a new scenario would leave stale. It saves, clears and restores `HULL_CHOICE`
around the probe, since asking must not disturb a launch being assembled.

**BOTH sides, and from anyone's library.** The briefing first offered only your
own fleet, which made half the registry unreachable from the screen: the core
was always two sided. A duel now seats 1v1 and a skirmish 2v2, grouped under
Your fleet and Hostiles, and a pick carries `{ side, slot }` rather than an
index into your side alone. Choosing what you fight is as much a setup choice
as choosing what you fly, and it is the only way to try a hull against a
specific opponent.

The hulls on offer are everyone's. The library was always public to read and a
clone was always a COPY with a `from` stamp, so this is about finding one among
many rather than about who may use one: a chip row filters by maker, built from
the owners actually present so it never offers a name with nothing behind it,
and it hides itself while you are the only maker. Opening a briefing also
clears the library's Mine filter, because a briefing that offered only your own
designs (because you last pressed Mine on another screen) looks exactly like
your friends' ships having vanished.

Two save migrations sit behind that, and both exist for one reason: a resume
REPLAYS its orders, so a fleet that comes back different from the one those
orders were given to plays a different match while looking like the same one.
`hull` (one design for a whole side) fills four slots on side `g.side`; the
slot indexed array that replaced it gains that same side and keeps its index,
and its nulls are simply not carried over.

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
