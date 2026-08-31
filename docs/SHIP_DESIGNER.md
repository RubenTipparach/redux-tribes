# The ship designer

A voxel ship designer: pick a class, get its frame, fit components to its
hardpoints, sculpt armour over it, paint it. This document is the settled
proposal: the parts palette, the five class frames, the five stock designs,
and how four million cells stay deterministic.

It was authored against the ARCHIVED Unity assets rather than from
imagination. `archive-model/` carries no inventory file, so the ships were
measured directly by parsing the binary FBX and the prefab YAML. Every
dimension below is a measurement or shown arithmetic.


## Scale

**CELL = 7/256 = 0.02734375 u, one constant for every class: but it is now an ANCHOR grid, not an occupancy grid. That is the single biggest change the judges forced.**

The arithmetic is unchanged and exact: Terran/Karisen/Benefactor carry `radius: 3.5` (data.rs:265, :287, :333), so 2 x 3.5 = 7.0 u over 256 anchors is exactly 0.02734375; it is 7 x 2^-8, bit-exact in f32 (0x3CE00000), and every integer multiple below 2^24 is exact. Positions are `(i as i32 as f32) * CELL`, never accumulated.

**What changed.** The earlier draft treated 128x128x256 as the shape resolution. Judge 2 measured that claim and it is false: a greedy mesh of the proposed Terran produced **399 quads at 32x32x64 and the same 399 quads at 128x128x256**, because the fine grid was a 4x upscale of the macro one and greedy merging undoes upscaling exactly. Confirmed at 60 and 150 brush strokes (2872/2872, 4395/4395). So 4,194,304 cells bought nothing on screen, nothing in storage, and cost 280-430 ms per remesh against 6 ms. The fine grid is deleted as an occupancy resolution.

It survives where it is genuinely load-bearing: **part anchors and mount points**, which need sub-macro precision to sit on data.rs's authored values. Terran nose beam (0, 0.4, 2.2) -> anchor (0, 15, 80) -> (0, 0.410156, 2.1875); worst snap error over all ten authored mounts is **0.0125 u, under half an anchor cell**. At macro-only resolution that error would be 0.0547 u. Anchors are integers in the part record (each < 2^10), so f32 exactness is never in question.

**The one derived rule this creates**, written down because it decides a designer-time outcome: a part's macro cell is `floor(anchor / s)` where s is the rung's anchor-per-macro divisor, and a face port belongs to the macro cell the face normal points *out of*. Judge 2 is right that six of the eight authored mount coordinates are not macro-aligned (y=0.4 -> 3.75 macro), so this rule cannot be left implicit.

**GRID.** Occupancy is a fixed **32 x 32 x 64 macro lattice at every rung**. Only the macro cell's world size changes:

| rung | anchors/macro | macro cell | berth | class |
|---|---|---|---|---|
| Frigate | 4 | 0.109375 u | 3.500 x 3.500 x 7.000 u | Terran, Karisen, Rogue, Benefactor |
| Escort | 6 | 0.1640625 u | 5.250 x 5.250 x 10.500 u | Freighter |
| Cruiser | 8 | 0.21875 u | 7.000 x 7.000 x 14.000 u | (unbuilt) |
| Capital | 16 | 0.4375 u | 14.000 x 14.000 x 28.000 u | (unbuilt) |

A capital design is therefore the *same record size* as a frigate. 1024 anchors = 28.000 u exactly, as derived; but it is a heavy cruiser, not a capital, against the archive's own 34.179 u (`ship_3.fbx`) and 44.075 u (`large_batleship.fbx`). A 2048 rung (56 u) is where a dreadnought lives. Stations are NOT on this ladder: the archived Starbase is 59.2 u tall with an 87.8 u turret ring; they stay authored assets.

**The radius gate is now the TRUE bounding sphere, hard, and it passes.** The earlier draft had to keep the mockup's longest-half-axis formula (page.html:665) plus a soft warning, because a full 128x128x256 berth has a half-diagonal of 4.2866 u against a class radius of 3.5. That problem was an artifact of treating the berth as the ship. Under the envelope model, all five designs fit their real sphere:

| class | envelope (u) | true bounding r | class radius |
|---|---|---|---|
| Terran | 2.188 x 1.969 x 6.125 | 3.398 | 3.5 |
| Karisen | 2.188 x 1.750 x 5.688 | 3.170 | 3.5 |
| Rogue | 2.406 x 1.859 x 3.500 | 2.318 | 3.2 |
| Benefactor | 1.750 x 2.406 x 5.250 | 3.017 | 3.5 |
| Freighter | 2.625 x 2.461 x 8.203 | 4.479 | 4.5 |

So contact stays sphere-sphere at turn.rs:695, the check is exact rather than approximate, and the collision wireframe can be deleted (page.html:1616-1618, :1668-1670) without losing the information it carried: the gate now prints the real number.

**Why one cell size at all:** it is the discipline the archive lost. Every archived prefab has its own fudge: Terran x1.5, Karisen x1.0, Benefactor x0.5034, Rogue x0.25, freighter x6.1444, Starbase x5.0, turrets x2.5, nose gun x0.19. A single cell makes that class of drift unrepresentable.

## Storage, transport and determinism

**A design is a part list plus a fixed 32x32x64 macro lattice, and it is IMMUTABLE for the life of a match. Nothing in it is mutable state, so nothing in it needs to be in the snapshot except its identity.**

Judge 1's first blocker was fatal to the earlier draft and I am not defending it. The draft had conduit blocks and armour cells "living in the lattice and taking damage as lattice cells" while also saying the lattice never enters the hash or the snapshot. That is mutable outcome-deciding state with no home: restore a turn in which a trunk was cut, `Ship::new` rebuilds the lattice intact (snapshot.rs:214), the gun that could not fire now fires, and `tests/replay.rs` reports a desync the simulation never had.

**The fix is not to hash the lattice. It is to stop damaging it.** Armour and structure become *subsystems*, which is the shape the core already has:

- Each of the six envelope faces (and an optional citadel) becomes a `SubDef` chain: one sphere per 16 macro cells of the face's long axis, max 4 per section. `hp` from its plate cells, `block_pct = 100L/(L+1)` from its layer count, `offset`/`radius` from its geometry: all computed **once at load**.
- Each placed component becomes a `SubDef` too: offset = its anchor, radius = half its bounding diagonal, block_pct authored per part.
- Mutable per-ship state is therefore exactly `Vec<Sub>{hp, max_hp, dead}` plus weapon `last_fired_tick`: the same two things snapshot.rs:178-186 already writes. **No new state shape, no new intersection primitive, no per-voxel DDA, no armour-layer walk at hit time.** Judge 1's unbounded-traversal and tie-break objections evaporate because the traversal no longer exists.

DESIGN.md:132's "a dead plate physically exposes the hull behind it" is preserved and is now literal: a section at 0 hp stops applying its block_pct, so shots through that face go to hull.

**RECORD LAYOUT (f32 slots, `SCRATCH_LEN` 16384 at ffi.rs:58 minus `OUT` 64 = 16,320 usable, refused at ffi.rs:1466):**

| field | slots | note |
|---|---|---|
| header | 16 | version, class, rung, envelope dims, counts |
| components | 6n | part id, anchor i/j/k, orientation, socket id |
| macro lattice | 5,462 | 32x32x64 x 2 bits (empty / plate / strut / frame), packed **24 exact-integer bits per slot** |
| digest | 2 | u64, computed IN THE CORE over the received slots |

| class | n | slots | bytes | % of 16,320 |
|---|---|---|---|---|
| Terran | 30 | 5,660 | 22,640 | 34.7 |
| Karisen | 25 | 5,630 | 22,520 | 34.5 |
| Rogue | 40 | 5,720 | 22,880 | 35.0 |
| Benefactor | 27 | 5,642 | 22,568 | 34.6 |
| Freighter | 22 | 5,612 | 22,448 | 34.4 |

One design per FFI call, the idiom ffi.rs:1142-1149 already uses for events. Alternatives at frigate scale: dense 1 byte/fine cell = 4,194,304 B (64x the whole buffer); Z-run-length ~218 KB; sparse octree ~430 KB: and the last two are data-dependent, so no fixed budget can be honoured. An operation log is refused outright: it would make the brush vocabulary a simulation rule, and two core builds interpreting "sphere brush radius 3" differently would produce different ships from the same file.

**24 bits per slot, not 32.** 16,777,214 of 2^32 patterns are f32 NaN (1 in 256); over a 32-bit-stuffed 4,096-slot lattice the chance of at least one NaN slot is 99.99%, and a NaN payload crossing a JS Float32Array can be canonicalised. 24-bit packing costs 1,366 extra slots and removes the class of bug. **Correction to the earlier draft:** I claimed snapshot.rs:125/:221 has this as a live bug. Judge 1 is right that I have no reproduction: `match.ts:519` uses `Float32Array.prototype.slice`, whose same-type NaN behaviour is implementation-defined rather than known-lossy. It is a latent exposure worth a test, not a bug worth asserting.

**TRANSPORT, which the earlier draft simply did not have.** Today `ft_match_new(seed_hi, seed_lo, scenario, human_sides)` (ffi.rs:661) determines the world from four integers and every table is compiled-in `&'static` data. A 22.5 KB client-authored blob breaks that contract, and the draft's only failure mode was a turn-1 hash split indistinguishable from a physics bug.

1. `ft_design_load(slot) -> digest_hi/lo`: caller writes the record from slot 64; the **core** computes the digest over the bytes it received and stores the design in a fixed 8-entry registry (array + linear scan; no HashMap). Called before match creation.
2. `ft_match_new(..., bindings_ptr)`: a ship-index -> registry-slot array plus the digest each seat expects. A mismatch **refuses match creation and names the ship**, converting a turn-1 desync into a startup error.
3. The server stores design blobs beside `hashes` in `server/src/db.ts` and the lobby hands both seats the same bytes. Without this a design is a per-client secret.
4. Digest is computed in the core, never in the client over its own file: a client-side digest would put the 32 KB paint layer into the hash by the back door.

**SNAPSHOT (version 3.0 -> 4.0).** The header gains the per-ship digest and `restore_snapshot` refuses a digest absent from the registry, exactly as it already refuses a foreign seed (snapshot.rs:216). `Ship::new` gains a design handle so the rebuild-from-data principle at snapshot.rs:214 stays true: legitimate now because the digest pins what "data" means. Subs go from 9 slots to ~144/ship (48 subs x 3): a 4-ship snapshot moves from the measured **212 slots (848 B) to ~752 slots (3,008 B), 4.6% of the buffer.**

**HASH.** Add the per-ship design digest, 8 bytes/ship, ~7 ns. That is *sufficient*: radius, mass, boarding range, capacity, mounts and per-section block_pct are all derived from the digested bytes by the same integer code on both sides, so hashing them separately adds cost and no information: the same argument that makes hashing the class index sufficient today. The lattice itself is never hashed; at the measured 0.87 ns/byte four dense frigates would be 14.6 ms against a 452 us turn, and judge 1 is right that this figure was a straw man in the earlier draft since nobody proposed hashing a fine grid. It is moot now: there is no mutable lattice.

**ACCUMULATION ORDER, which judge 1 correctly called an unwritten rule.** f32 addition is not associative: 5,679 armour cells summed sequentially give 0.5573053 and pairwise give 0.5572978: two legal implementations, two masses, two `accel_fwd` values, a hash split on turn 0. **Every derived quantity is now integer.** Mass in uM (1e6 = mass 1.0), hull in milli-HP, thrust in cu, torque in cu-macro-cells, all summed as i64 (exact, order-independent), converted to f32 exactly once at the end by one division of two exactly-representable integers. The four-decimal "EXACT" table in the earlier draft came from f64 arithmetic in the mockup's `askTheCore`: a second implementation of a core rule (GUIDELINES 5.1). It is deleted; the designer calls an `ft_*` query for every stat it displays.

**Structures that want a HashMap, and what they are instead:** design registry (8-entry array, linear scan); anchor uniqueness at load (sort by (part_id, k, j, i), compare adjacent); exterior classification (a `[u32; 2048]` bitset over 65,536 macro cells + a `Vec<u32>` frontier with a head cursor, fixed neighbour order (-x,+x,-y,+y,-z,+z)).

## The parts palette

**Cut from v1: all 9 POWER and THERMAL parts, and UTL-SNS.** Judge 3 is right and the arithmetic is unarguable: `sim_core` has no power, heat or detection, `CK_POWER`/`CK_HEAT` are soft by the proposal's own rule, so stripping 2x PWR-2 + 1x THR-S + 3x THR-R1 off the stock Terran frees 0.0815 mass, buys ~34 hull, and the ship flies identically. Two categories that only produce warnings teach players to ignore warnings. They return as a unit when the core has the systems: the palette below is designed so they slot in without renumbering.

**Density model (two constants generate every mass in the table):** machinery 0.11 mass/u^3; a part's uM = round(footprint_anchors x CELL^3 x 0.11 x 1e6). Hit radius = half the bounding diagonal.

### DRIVE (15)
| id | name | footprint (anchors) | uM | r (u) | gives | socket | core rule |
|---|---|---|---|---|---|---|---|
| DRV-V | Vernier nozzle | 7x7x8 | 882 | 0.174 | thrust 5, v_exh 6.0 | DRIVE_PLATE, locked -z | flight.rs:298 `accel_fwd`; Thruster sub (state.rs:219, turn.rs:167) |
| DRV-N | Light nozzle | 14x14x14 | 6,171 | 0.332 | thrust 15, v_exh 8.0 | DRIVE_PLATE | as above |
| DRV-B | Standard bell | 20x20x20 | 17,991 | 0.474 | thrust 30, v_exh 8.5 | DRIVE_PLATE | as above |
| DRV-BR | Overclocked bell | 20x20x22 | 19,790 | 0.490 | thrust 33, v_exh 9.5 | DRIVE_PLATE | as above |
| DRV-T | Tug bell | 20x20x20 | 17,991 | 0.474 | thrust 30, v_exh 5.0 | DRIVE_PLATE | as above |
| DRV-H | Heavy bell | 28x28x28 | 49,367 | 0.663 | thrust 60, v_exh 7.0 | DRIVE_PLATE | as above |
| DRV-C | Capital bell | 48x48x52 | 269,434 | 1.169 | thrust 180, v_exh 6.5 | DRIVE_PLATE, cruiser+ | as above |
| RET-V | Retro vernier | 6x6x6 | 486 | 0.142 | retro 2 | RCS_PAD fwd | flight.rs:298 `accel_retro` |
| RET-S | Retro nozzle | 10x10x10 | 2,249 | 0.237 | retro 5 | RCS_PAD fwd | as above |
| RET-C | Retro cluster | 24x10x12 | 6,477 | 0.392 | retro 15 | RCS_PAD fwd, mirrored | as above |
| RCS-Q | RCS quad | 8x8x6 | 864 | 0.175 | lat 2 x AND 2 y | RCS_PAD any | flight.rs:299 `accel_lat`; torque |
| MAN-B | Manoeuvring block | 12x12x10 | 3,238 | 0.269 | lat 5 x AND 5 y | RCS_PAD any | as above |
| MAN-H | Heavy man. block | 16x16x12 | 6,909 | 0.350 | lat 10 x AND 10 y | RCS_PAD any | as above |
| MAN-Y | Yaw block | 16x10x12 | 4,318 | 0.306 | lat 10 x only | RCS_PAD flank | `accel_lat` + `yaw_rate` |
| MAN-P | Pitch block | 10x16x12 | 4,318 | 0.306 | lat 10 y only | RCS_PAD dorsal/ventral | `accel_lat` + `pitch_rate` |

**Derivations (all integer, order-independent):** `accel_fwd = thrust_cu x 10000 / mass_uM`; same for retro; `accel_lat = min(sum_x, sum_y) x 10000 / mass_uM` because flight.rs:299 spends one `accel_lat` on both local axes. `max_speed = max v_exh over live drive parts`: **no mass term**. That replaces the earlier draft's `v_exh / sqrt(mass)`, which missed the Rogue by 0.14% and needed an unjustifiable 9.0125 constant; it also creates the palette's cleanest decision (a big low-v_exh bell pushes harder, a small high-v_exh one goes faster) and it is why the stock Benefactor carries a DRV-N beside its DRV-H. `yaw = 560 x tau_x / (mass_milli x L_macro)`, pitch likewise, where tau = sum(lat_cu x |z| in macro cells from the envelope centre) and L = envelope length in macro cells. **This is a first-moment curve, not rigid-body physics, and it is chosen on purpose**: the physical `tau/(m L^2)` form misses the authored numbers by -20% (Terran) to +42% (Rogue) because those numbers were hand-tuned, and ADR-14 already says the flight model is hand-authored. The rung's scale cancels in `tau/L`, so rotation is rung-independent.

### WEAPONS (9)
| id | name | footprint | uM | r (u) | gives | socket | core rule |
|---|---|---|---|---|---|---|---|
| WPN-BB1 | Barbette, light | 24x12x24 | 15,544 | 0.492 | 1 light trunnion, block 75, hemisphere arc mask | GUN_RING | `MountDef.mount` (state.rs:216, turn.rs:476); hit vol; turn.rs:150-154 |
| WPN-BB2 | Barbette, heavy | 40x18x40 | 64,768 | 0.812 | 1 heavy trunnion | GUN_RING (heavy) | as above |
| WPN-BM1 | Beam turret | 16x16x40 | 23,029 | 0.628 | 1 x Beam | TRUNNION | data.rs:132 W_BEAM; turn.rs:355, :476 |
| WPN-BM2 | Beam turret, twin | 28x26x64 | 104,780 | 1.019 | 2 x Beam | TRUNNION (heavy) | as above (two MountDefs; `weapons` is already a slice) |
| WPN-CN1 | Projectile turret | 18x16x36 | 23,316 | 0.592 | 1 x Cannon | TRUNNION | data.rs:132 W_CANNON |
| WPN-CN2 | Proj. turret, twin | 30x26x56 | 98,231 | 0.938 | 2 x Cannon | TRUNNION (heavy) | as above |
| WPN-PL1 | Plasma turret | 18x18x34 | 24,774 | 0.581 | 1 x Plasma | TRUNNION | data.rs:132-137 |
| WPN-ML1 | Missile cell | 20x20x28 | 25,187 | 0.544 | 1 x Missile, block 50 | SKIN (no barbette) | data.rs:132 W_MISSILE |
| WPN-ML4 | Missile battery | 44x20x28 | 55,412 | 0.764 | 4 x Missile | SKIN / BAY_L lid | as above |

The barbette/gun split is the archive's own: `Weapon_Base_Cannon.prefab` puts the BoxCollider and `SubsystemColliderProxy` on the base (2.2386 x 1.5245 x 2.2), not the barrel. The base is the damage volume, the barrel is what rotates, the aim origin is a separate empty.

**Judge 3's blocker 5 is correct and I am changing data.rs, not defending the palette.** Three gun parts with zero choices is what the current weapon table gives you: Plasma resolves to `W_CANNON` (data.rs:137), and Beam is strictly better than Cannon on damage, range, cooldown and arc. Minimal fix, one new field and one subtraction, no branch in the resolver:

| key | dmg | range | cd | arc h | armor_pen (NEW) | vs 4-layer belt (80) | vs 1-layer skin (50) |
|---|---|---|---|---|---|---|---|
| Beam | 27.5 | 300 | 3.0 | +/-110 | 0 | 5.5 | 13.75 |
| Cannon | 27.5 | 200 | 4.0 | +/-90 | 2 | 9.2 | 27.5 |
| Plasma (new block) | 35.0 | 150 | 5.0 | +/-90 | 1 | 8.75 | 17.5 |
| Missile | 25 x2 | 250 | 6.0 | sphere | 0 | 5.0 x2 | 12.5 x2 |

`block_pct` uses `L_eff = max(0, L - pen)`. This is an owner decision because it changes existing balance and every recorded hash.

### UTILITY (5)
| id | name | footprint | uM | r (u) | gives | core rule |
|---|---|---|---|---|---|---|
| UTL-BRG | Bridge | 24x18x22 | 21,373 | 0.509 | required x1 (designer check) | none in v1; if built, reuse the turn.rs:170-190 drift branch |
| UTL-BAR | Marine barracks | 20x14x26 | 16,372 | 0.488 | +5 marines | `ShipClass.marines` -> state.rs:179, turn.rs:420, :769-791, :1106 |
| UTL-AIR | Boarding airlock | 12x12x10 | 3,238 | 0.269 | +2 boarding capacity | turn.rs:1003-1005 |
| UTL-CLM | Boarding clamp | 18x14x24 | 13,601 | 0.453 | +5 u boarding range over base 10 | turn.rs:421 |
| UTL-CGO | Cargo bay | 48x40x64 | 276,343 | 1.223 | mass + hull sink | mass (turn.rs:705), hull |

Splitting headcount (barracks) from throughput (airlocks) from reach (clamps) is what lets every class land its authored triple exactly: 15/8/20 for three classes, 40/12/40 for the Rogue, 15/8/10 for the Freighter (zero clamps: its short reach is the *absence of a socket*, not a penalty).

### STRUCTURE (4)
| id | name | footprint | uM | gives | note |
|---|---|---|---|---|---|
| STR-STRUT | Structural strut | 4x4x4 (1 macro) | 262 | satisfies CK_ANCHORED | v1: structural only. Judge 3 is right that an autorouted, freely-meshed power grid is ceremony with a solve button, so **conduits carry nothing in v1**: a strut is how you attach a component that is not already touching the hull. When power lands, this same block gains the severance rule. |
| STR-SPAR | Frame spar | 4x4x32 | 785 | class-supplied keel | not placeable; frame data |
| STR-RIB | Frame rib | 4x4x4 chained | 262 | class-supplied ring | not placeable |
| STR-HP | Hardpoint pad | 8x8x4 | 393 | typed socket | not placeable; **this is the mechanism behind "components cannot be modified"**: the player picks which part fills a pad, never edits a part, never adds a pad |

### LATTICE MATERIALS (not parts: you sculpt these, you do not place them)
| material | mass | hull | note |
|---|---|---|---|
| PLATE | 45 uM/macro cell (frigate rung) | via enclosed volume | the paintable surface; layer count sets block_pct |
| INTERIOR | 8 uM/macro cell | via enclosed volume | **derived by exterior flood fill, never placed** |

**STR-FIL is deleted.** Judge 3 is right that it was strictly dominated: identical mass to plate for a quarter the hull, with no compensating property, so the stock Karisen's 1,955 filler cells were a designed-in trap. Interior volume is now automatic.

**Per-rung densities scale by cell volume** (authored integers in data.rs, exact): frigate 45/8, escort 152/27, cruiser 240/32... (x(s/4)^3, rounded). Hull = 15 milli-HP per enclosed macro cell at the frigate rung, 50.625 at escort.

**`hull` now comes from ENCLOSED VOLUME, not from plate cells.** This is judge 3's blocker 6, and the old model was strictly broken: mass = area x layers, so halving the envelope's surface doubled the affordable layers for the *same* hull, the same mass, a *better* block_pct and a smaller collision sphere. Thin armoured needle, strictly dominant, on every frame. Now a bigger envelope buys hull and costs mass and surface to plate; a needle is fast and fragile. Two-sided curve, and it deletes the interior-placement chore at the same time.

**block_pct = 100L/(L+1), capped at L=19.** Not fitted: it reproduces Karisen 75 at 3 layers, Terran and Benefactor 80 at 4, Rogue 90 at 9 (data.rs:227-230) with no free parameter.

## The class frames

A frame is a new `&'static FrameDef` table in `data.rs`, one row per `ShipClassId`, read the way `SubDef` and `MountDef` already are. It holds a RUNG, a SPINE (class-supplied spars and ribs), and typed HARDPOINTS `{kind, anchor(i,j,k), orientation, accepts}`. Adding a sixth class adds a row, not a branch.

**Load-bearing claim:** a frame's GUN_RING anchors ARE data.rs's authored `MountDef.mount` values snapped to the anchor grid, worst error 0.0125 u over all ten. The frame is not a re-authoring of where guns go; it is the existing authoring made placeable.

**This is why defect 2 is not cosmetic.** `page.html:840` makes BERTH a module constant and :973-974 pushes it in regardless of `classIndex`. A class change must re-seed the rung, the spine AND the socket layout, and drop placements whose socket no longer exists (with a count reported, not silently). Re-seeding nx/ny/nz alone would leave a Terran's three beam rings on a Freighter that has none.

| class | rung | spine | hardpoints | silhouette |
|---|---|---|---|---|
| **Terran** | Frigate, 32x32x64 macro | 8 x STR-SPAR single deep keel, anchors k -128..+128; 8 rib rings at 32-anchor spacing, 20 macro cells each. Leanest of the five (0.024 mass): 300 hull on 1.0 leaves nothing for structure. | DRIVE_PLATE x1 at k=-118, 56x42 anchors, **3-wide x 2-high grid of six 14-anchor seats** (i in {-14,0,+14}, j in {-7,+7}). GUN_RING x3 at (0,15,80), (-44,7,29), (+44,7,29). BAY_M x4, BAY_S x2. RCS_PAD x5: yaw port/stbd at (+/-52,0,+104), pitch dorsal/ventral at (0,+/-40,+/-64), trim ventral aft (0,-34,-64). SKIN x12. | Slab body on one keel, six small bells in a 3x2 block on the transom, armour standing off the flanks on the rib rings with a real gap behind it: which makes DESIGN.md:132's exposed hull literal. Reads as `ship_1.fbx`. One honest divergence: the archive puts its three turrets dorsal/ventral/nose, data.rs authors nose/port/starboard; the core wins. |
| **Karisen** | Frigate | **Three parallel runs**: main keel, dorsal stringer at j=+10 (k -100..+100), and a ventral keel beam at j=-12 running k -116..+116, LONGER than the body, exactly as `Ship_2_energy_1` (8.892) overruns `Ship_2_main` (8.228). 10 rib rings, 30 cells each. | DRIVE_PLATE x1 at k=-112, **3-wide row of 20-anchor seats** at i in {-20,0,+20} plus one 7-anchor vernier seat (the archive's three bells at X 0, +/-0.5245 = +/-19.2 anchors). GUN_RING x1 at (0,15,73). MISSILE_PAD x1 at (0,-11,0). **SPONSON_RING x2** at (+/-60,-12,-34), empty on the stock design. BAY_L x1, BAY_M x3 on the ventral beam, BAY_S x2. RCS_PAD x5: yaw (+/-52,0,+104), pitch (0,+/-40,+/-60), trim. SKIN x10. | Stacked spine, not a slab: body run, wide dorsal plate, ventral keel overhanging both ends, three big bells in a row, empty sponsons on the flanks. Reads as `ship_2.fbx` directly. |
| **Rogue** | Frigate, but the frame occupies **32 macro of length, not 56** | 7-spar keel PLUS a **transverse BOARDING GALLERY**: a second spar run crossing at k=-20 spanning i -56..+56, carrying six clamp seats and six airlock collars as one structure. The frame feature no other class has. 10 rib rings at 22-anchor spacing. | DRIVE_PLATE x1 at k=-100, three 20-anchor seats. GUN_RING x2 at (-29,7,55), (+29,7,55): **light rings only**, this frame will not take WPN-BB2. **BAY_M x8** (two rows of four along the gallery): the largest block of internal volume on any frigate frame and the whole explanation of `marines: 40`. AIRLOCK_COLLAR x6 at i=+/-56. CLAMP_SEAT x6 at i=+/-58. RCS_PAD x9. SKIN x8. | Short wide raider: stubby hull with a gallery band across its waist, six grapple arms folded flat, six collars between them, three overclocked bells running exposed pipework. **Invented**: `Rogue_Ship_1.prefab` is a single mesh `ship_6` at scale 0.25, zero decals, no sub-parts. Built from the only archived evidence there is: its mount layout and its role. |
| **Benefactor** | Frigate | 8-spar keel with a **deep aft drop-keel**: the last two spars step to j=-28 over k -64..-128, with a matching dorsal step to j=+26. That is the archive's Benefactor exactly (`Pulse` at (0,-2.71,-7.17), `Torpedo` at (0,+2.283,-7.17)). 10 rib rings. | DRIVE_PLATE x1 at k=-114, **mixed seats**: one 28-anchor, one 14-anchor, two 7-anchor. GUN_RING x2 at (-37,7,44), (+37,7,44): the archive's forward mirrored pair at (+/-1.79, 0.01, 2.32). MISSILE_PAD x1 at (0,-11,0). **AFT_STACK x2** on the drop-keel, empty on stock. BAY_L x1, BAY_M x3, BAY_S x2. RCS_PAD x5: yaw (+/-52,0,+80), pitch (0,+/-40,+/-56). SKIN x10. | Long hull stepping down deeply aft, forward pair of stepped-barrel cannon, ventral missile rack amidships, one big turbopumped bell with a small nozzle beside it. **Invented** (single mesh `ship_5` at 0.5034, zero decals); the drop-keel is the one archived fact worth keeping. |
| **Freighter** | **ESCORT rung**: the only class off the frigate rung. Macro = 6 anchors. Frame occupies 50 macro of length. | 7-spar keel plus **two longitudinal cargo rails** at i=+/-42 over the hold section. 8 rib rings, 18 cells each: a light frame, because 600 hull at mass 2.0 is the same 300-per-mass the Terran pays. | DRIVE_PLATE x1 at k=-144, three 20-anchor seats. **NO GUN_RING anywhere**: not "zero guns by convention": every gun needs a barbette and every barbette needs a ring, so `static FREIGHTER_MOUNTS: [MountDef; 0]` (data.rs:258) becomes geometry. **NO CLAMP_SEAT**, which is `boarding_range: 10.0` as an absence. BAY_XL x2 (holds, full-width dorsal doors), BAY_M x2, BAY_S x2. AIRLOCK_COLLAR x4. RCS_PAD x4: yaw at (+/-78,0,+132), pitch at (0,+/-60,+/-78). SKIN x8. | Long square-section brick: two holds under a dorsal door, light keel with cargo rails, RCS as far fore and aft as the hull allows, three tug bells. The 50-macro frame at a 16x15 cross-section is 8.20 x 2.63 x 2.46 u against the archived `freighter_generic` BoxCollider's 8.12 x 2.08 x 2.08: the closest any frame gets to its source. |

**The frame is not free scenery.** STR-SPAR/RIB/HP carry structural mass, so the frame is the first line of the budget: 0.024 on the Terran, 0.072 on the Freighter. That matters because both classes sit at 300 hull per unit mass, so a heavy frame is hull they cannot afford. The Terran's frame is the leanest for arithmetic reasons, not taste.

### The hull profile, and the two exteriors

**What was built differs from the draft above on three points, and the differences are the interesting part.**

**A frame is cut to a station curve, not to a box.** Every `FrameDef` carries a `profile`: six stations of `[z, half beam, half depth]` in cells, interpolated between. Rib rings are single cells walked around that ellipse one cell inside the skin, so the skeleton tapers toward the bow and squares up around the drive plate instead of being the same rectangle from end to end. The Terran runs 8x5 at the transom, 11x6.5 at the waist and 3x2 at the nose. That one table is what stops the five classes reading as five bricks of different lengths.

**Armour is laid two ways and the player picks.**

- **CLASS HULL (`wrapped`).** Plate is a shell on the profile: a cell is skin if it is inside the hull line and NOT inside that same line drawn in by that face's layer count, which is a shell of exactly that thickness. Bow and stern layers cap the ends. This is what a premade ship ships with, so a stock hull arrives pre-sculpted with the class silhouette, and pulling a section slider changes its thickness rather than its shape.
- **FROM SCRATCH (`skin`).** Plate is a dilation of what is actually bolted on, one step per layer per direction, and the class profile is not consulted at all. It starts bare: switching modes zeroes the sections, because carrying a four-layer belt across buried the whole ship in one lump, over budget, with nothing left to read.

The frame is in neither list. It cannot be edited in either mode, which is enforced by first-writer-wins ordering rather than by a rule anyone has to remember: frame, then parts, then plate, so plate can never take a cell the frame is standing in. One exception, and it is a drawing rule rather than an edit: any frame member still bare to the outside once the shell is laid is marked `Skinned`, and draws as plate with the plate on and as frame with it off. Without it the Karisen's dorsal stringer and ventral keel beam ran the whole length of a fully plated hull as two grey planks, 915 bare cells of them, because the shell is an ellipse, a spar is a box, and a box riding a fraction of a cell proud of that ellipse keeps its cell. A skin covers its own ribs. Measured after: **zero bare frame cells on the outside of any of the five**. A skinned cell costs no extra mass: it is the frame wearing the shell, and the shell's own cells are counted where the shell is, so billing the coat as well would charge one volume twice.

**Nothing floats.** Every part cell outboard of the hull line walks a staircase back toward the centreline, taking whichever axis it is furthest out on and filling empty cells until it meets the ship or crosses the hull line. That is what attaches an RCS block ten cells off a hull seven cells wide. The first cut marched a single axis and, for a gun outboard on both, walked its pylon straight past the keel and out of the bottom of the lattice.

**ONE rasterisation, read by everybody.** `rasterise()` builds the grid; `derive()` counts ITS plate cells for mass and hull, and the editor draws the same grid. It used to be two: the editor rasterised and `derive()` costed plate from a box-area formula, so the picture and the mass were two opinions about the same armour and only one could be right (GUIDELINES 5.1). The visible consequence is that "add on to it without exceeding mass limits" now means something: a player who builds their own exterior is charged for the one they built. Measured at 4.0 ms per rasterisation of a stock frigate, cached on a signature of class, mode, placements and sections, so a slider drag pays it once per change rather than twice.

**The densities were refitted for it.** `PLATE_UM 33 -> 78` and `HULL_MILLI 17 -> 34`: a least squares fit of the two constants against the five authored stock masses and hulls over the allowed layer configurations. 5.7% rms, worst case the Rogue at +8.8% on mass, every class legal. A curved shell costs different cells from six rectangles, so the density had to follow it.

### Mounts live inside the frame

Only five socket kinds may stand proud of the hull: **drive, retro, rcs, gun ring, trunnion**. A drive has to see vacuum, a gun has to see its target, and attitude jets have to push on something that is not the ship. Berths, magazines, holds, airlocks and stowed boarding clamps are volume, not fittings, and a ship with its barracks bolted to the outside reads as a scaffold. Sensors would belong on the exposed list too; there is no sensor part, because `sim_core` has no detection and a part that can only ever raise a warning teaches players to ignore warnings.

Enclosure is a rule applied once, not 120 hand edited coordinates. `seatOf()` pulls an enclosed socket toward the centreline until the part's own box is inside the profile with a cell to spare for the plate. Three things had to be got right and each of them was found by measuring, not by looking:

- **Seat on the part, not on the socket.** Sizing every bay as though it held a cargo hold (the biggest thing a bay takes) pinned all of them to the axis and stacked them: three of the Rogue's eight barracks lost every one of their 140 cells to a bay already standing there.
- **Nudge until it fits.** A frame that authored six clamps along one flank still pulls all six onto the same cells. A bounded, ordered search (nearest first by city block distance, six cells out) finds room; it is the same search on both seats, so the ship is the same ship. Five of the Rogue's six clamps were invisible before it.
- **Judge the corners, not the centre.** The nudge originally tested whether the part's centre was inside the hull, which let it walk a bay half out through the side and still call it seated: 96 cells of the Rogue's boarding gear, 55 of the Freighter's, hanging outside a hull that was supposed to enclose them.

Two more first-writer-wins rules changed with it. A part now mounts THROUGH the frame, taking a rib cell if it needs one: strict ordering meant a two cell RCS quad landing on the Rogue's rib ring wrote nothing at all and that quarter of the ship showed no attitude jets. It still never takes another part's cell, which is what the nudge is for. Measured after all of it: **every part of all five stock ships is visible in the grid, and zero cells of any enclosed part are outside the hull.**

### Ghost armour, and picking a part off the model

The plate toggle has three states, because enclosing the mounts made two states useless: plate on hides everything a player is fitting, and plate off loses the shape they have to fit inside. **Ghost** draws the hull's outermost course only, translucent and not writing depth, over a full x ray of the structure. Outermost course matters: four translucent courses stacked on themselves is mush, which is why the toggle used to be a boolean.

**A tap names a part.** The raycast returns an instance index, that index is the position in the cell list that built the mesh, and `Raster.own` says which placement is standing in that cell, so the answer is a lookup rather than a guess: the picture IS the grid. A tap is told from a drag by distance (under 6 pixels) and time, because a phone has no second button and no hover, so the gesture that names a part is the same one that turns the camera. Tapping armour or frame says which it is and that the frame is not editable.

**Selecting outlines it.** From the menu or from the model, the selected part gets an amber wireframe box round its extent with `depthTest` off, so it reads through the plate standing in front of it. A per cell wireframe was tried first and at ship scale 160 wire cubes is a solid amber blob, not an outline.

### Gunnery: a pivot at the mount, arcs, and a tracking preview

**A turret turns on its MOUNT.** Every part used to be placed with its box centre on its socket, which put half a ten cell barrel behind the barbette and swung it through the hull when the part was turned: the outline a player selected was visibly off its own base. `pivotOf()` gives a gun a pivot inside its housing, a few cells up from the breech, and the raster lands the PIVOT on the socket rather than the centre. `rotatedPivot()` carries it through the quarter turns so a turned gun still sits on its ring.

**The arcs are `data.rs`'s own numbers**, widened from a single `arcH` to the pairs the core actually holds: beam h -110 to 110 and v -60 to 60, projectile h -90 to 90 and v -60 to 60, missile all round on both. The designer draws them and works nothing out from them. Whether a shot is legal in a match is `ft_can_fire`'s answer; a design has no match to ask about, so the designer never asks and never approximates.

**They hang on the ship's nose, not on the mount**, because that is what the core measures: `arc_test_3d` (math.rs) takes the SHIP's quaternion, and `sim_core` has no per mount rotation at all (turn.rs:476). Drawing the wedge off the turret's rest facing would be a second opinion about a rule. What Facing sets is the model's rest pose, and that is what the readout says.

**Pitch is now a true elevation, and this is a change to the CORE.** The archive's `TargetArcTest3D` measured pitch as `atan2(y, z)`, which is not an elevation: as a target comes abeam, `z` goes to zero and that angle runs to 90 degrees however level the target is, so a 60 degree mount refused everything on its own beam. A beam turret with a 220 degree horizontal arc could not fire at anything square off the nose. It is `atan2(y, sqrt(x*x + z*z))` in both implementations now, Rust and the JS reference, changed together so they cannot drift, with a test in `tests/turn.rs` pinning the four corners of the behaviour. A mount has two axes, yaw and pitch; roll does not enter it. `sqrt` is the one transcendental the sim path allows, because IEEE-754 specifies it exactly.

**A turret's default position is straight ahead on its own mount.** The rest facing a player sets in 90 degree steps is baked into the cells, so zero in the turret group's frame IS that direction, and a turret with nothing in arc returns to it rather than straining at its stop. That is also what makes bearing readable at a glance: the ones that can reach the target are the ones that moved.

**It eases under a slew rate, and both halves of that were needed.** Exponential easing alone is smooth but its first step is proportional to the gap, so a turret picking up a target 105 degrees away moved 54 of them in a tenth of a second, which reads as a snap however continuous the maths is. A 110 degree a second cap on top of the ease fixes it: measured over a second and a half of tracking, 344 degrees swept with a worst step of 21.8 degrees between samples 130 ms apart. The harness fails above 30, and separately fails if nothing moved at all, because a still turret passes a smoothness test trivially.

**The preview is two buttons over the model**, `Arcs` and `Target`, beside the plate toggle. Arcs draws a filled wedge in the horizontal plane and an unfilled one in the vertical, per turret, coloured by purpose. Target puts a marker in orbit around the hull for the turrets to chase, with a sight line from each one that bears. They are independent switches: watch the wedges without the target, or the target without the wedges.

They were one button cycling off, arcs, tracking, and the target was three presses deep behind a label that never mentioned it. The marker was also a wireframe pip a tenth of a wedge across, with no orbit path drawn, so the question it kept getting asked was where it had gone. It is a solid core in a cage now, at nearly three times the size, on a visible orbit ring. The angles are the core's verbatim: horizontal `atan2(x, z)`, vertical `atan2(y, z)`, both about the ship's axes. That reproduces one honest quirk: a target nearly abeam has a small `z`, so `atan2(y, z)` runs away and the vertical test fails even though the target is level. The preview shows what the core would decide, including that.

Three things had to be measured rather than eyeballed. The wedges at two hull radii filled the screen and washed the ship pink, so they are one radius now and only the horizontal one is filled. The vertical wedge at the same radius crossed the horizontal one and the ship read as a wireframe bowtie, so it is drawn at 60% of it. And the camera frames the arcs when they are on, because half of an arc off screen is not an arc a player can read.

### Colour: purpose everywhere, faction on the armour only

Two palettes, and which one a cell takes is decided by one function, `cellColour`.

**PURPOSE, eight jobs and eight hues:** propulsion orange, attitude cyan, gunnery red, ordnance violet, command green, crew yellow, boarding pink, structure steel. Boarding was orange-tan and sat too close to propulsion to tell apart on a hull; it is pink now. A Terran thruster and a Karisen thruster are the same orange, because the point of the coding is that propulsion looks like propulsion on anybody's ship. Each part is drawn in FOUR tones of its own hue, which is what gives it a pattern rather than a shade: casing is the shadow, the working guts the base, trim the mid, anything lit the highlight.

**And a silhouette each.** Colour alone does not separate a barracks from a hold when both are boxes, so every part is a different shape rule: bells band every second course, RCS blocks show four lit jets, barbettes carry a toothed ring, the beam is a slim emitter with a collar and the cannon a fat stepped barrel, magazines are banded blocks with lit tube mouths, the bridge is a stepped superstructure with a window band right round the top deck, barracks are banded berth decks, airlocks are collars with a lit iris, clamps are two jaws with a gap and lit tips, and a hold is a braced crate. One of these was not cosmetic: the old shared `pod` rule hollowed a part by removing its corner cells, and on a 2x2x2 RCS quad every cell is a corner, so the part drew literally nothing. `Mat.Case` exists for exactly this: a barbette drum, a gun housing and a bridge shell were all written as `Plate` at first, which let the paint bucket reach inside the ship and turn every mount the faction colour.

**FACTION, eight swatches, and all eight land on the hull.** One swatch on a whole hull is a paint bucket, and a paint bucket makes every ship of a faction the same flat lozenge. The eight are roles: primary, panel, secondary, deep, highlight, marking, trim, stripe. Position decides which one a cell takes, not chance, so the same cell is the same colour on both seats and after a reload: plating panels on a coarse three-way grid, a dark underside, a dorsal spine, a stripe along the waist, a nose flash and a transom band. Picking a swatch sets the primary and the other seven roles hold, so a re-tint does not wreck the scheme. Measured on the visible skin of the five stock ships: **8 of 8 swatches on every one**, and the browser harness fails the build if any drops below eight.

None of it is hashed or sent to the core, so two players who painted differently still agree on the match: the same argument CLAUDE.md already makes for `side`.

### Parts are placeable and rotatable, never editable

A turret is on a swivel, so which way it faces on its ring is the player's. `Placement.rot` is quarter turns about the up axis, 0 to 3, and the CELLS are what turn: the part is re-rasterised at its new orientation, so a turned turret is still one cell per cell and still cannot z-fight with the plate beside it or float a fraction of a cell off its ring. Ninety degrees is not a simplification, it is the only snap a cell grid has that leaves the part the same volume; anything between would resample it and bring back the fractional-cell slop that voxels were adopted to end.

## The stock designs

**Two builds per class, and the distinction is judge 3's best catch.** A stock design at 100.0000% of budget makes the player's first action: *add a part*: turn the editor red on a 30-component ship with no guidance. So:

- **CALIBRATION build** (a Rust test, not a shipped ship): sits at the full mass budget and proves the palette spans the authored space. **Every one of accel_fwd, accel_retro, accel_lat, max_speed, marines, boarding_capacity and boarding_range is exact on all five classes.** Hull lands within +/-1.4%, rotation within +/-2.9%. The residual is pure grid granularity: RCS pads sit on integer macro stations: and it is stated as a tolerance rather than dressed up as four-digit exactness, which the earlier draft could not honestly claim anyway since those figures came from f64 arithmetic in the mockup.
- **STOCK build** (what a player loads): the same design at **83-87% of budget**, so it is legal, flies well, and has visible headroom. Being ~15% lighter it is ~15% more agile than the class row: the headroom is a gameplay benefit, not a slack number, and the class row honestly describes a ship built to its ceiling.

### Calibration, against data.rs
| class | hull | accf | accr | accl | yaw | pitch | v_exh | mar | cap | brg |
|---|---|---|---|---|---|---|---|---|---|---|
| Terran | 302 (+0.8%) | 0.9000 = | 0.3500 = | 0.2500 = | 6.000 = | 4.000 = | 8.0 = | 15 = | 8 = | 20 = |
| Karisen | 250 (-0.2%) | 0.9500 = | 0.3500 = | 0.2500 = | 6.462 (-0.6%) | 4.092 (+2.3%) | 8.5 = | 15 = | 8 = | 20 = |
| Rogue | 180 (-0.3%) | 1.1000 = | 0.5000 = | 0.4000 = | 9.022 (+0.2%) | 5.911 (-1.5%) | 9.5 = | 40 = | 12 = | 40 = |
| Benefactor | 253 (+1.4%) | 0.8500 = | 0.3500 = | 0.2200 = | 4.900 (-2.0%) | 3.500 = | 8.0 = | 15 = | 8 = | 20 = |
| Freighter | 607 (+1.3%) | 0.4500 = | 0.1800 = | 0.1000 = | 2.464 (-1.4%) | 1.456 (-2.9%) | 5.0 = | 15 = | 8 = | 10 = |

`accel_fwd` is exact by construction and this is the palette's cleanest property: **at mass 1.0, accel_fwd = thrust_cu / 100**, so the authored 0.9 / 0.95 / 1.1 / 0.85 / 0.45 *are* the drive packages 90 / 95 / 99-at-0.9 / 85 / 90-at-2.0.

### The five stock designs

| | **Terran: TCNS Line Frigate** | **Karisen: IKS Strike Frigate** | **Rogue: RIS Boarding Raider** | **Benefactor: BNS Escort Frigate** | **Freighter: Civilian Bulk Hauler** |
|---|---|---|---|---|---|
| envelope (macro) | 20 x 18 x 56 | 20 x 16 x 52 | 22 x 17 x 32 | 16 x 22 x 48 | 16 x 15 x 50 (escort) |
| enclosed / plate / interior cells | 20,160 / 11,024 / 9,136 | 16,640 / 11,872 / 4,768 | 11,968 / 5,620 / 6,348 | 16,896 / 10,688 / 6,208 | 12,000 / 5,080 / 6,920 |
| **drive** | 6 x DRV-N (90 cu) | 3 x DRV-B + DRV-V (95) | 3 x DRV-BR (99) | DRV-H + DRV-N + 2 x DRV-V (85) | 3 x DRV-T (90) |
| **RCS** | 2 MAN-Y @26, 2 MAN-P @16, 1 MAN-B @16 | 2 MAN-Y @26, 2 MAN-P @15, 1 MAN-B @16 | 2 MAN-Y @15, 2 MAN-P @7, 2 MAN-B @14, 3 RCS-Q | 2 MAN-Y @20, 2 MAN-P @14, 1 RCS-Q @10 | 2 MAN-Y @22, 2 MAN-P @13 |
| **retro** | 2 RET-C + RET-S (35) | 2 RET-C + RET-S (35) | 3 RET-C (45) | 2 RET-C + RET-S (35) | 2 RET-C + 3 RET-V (36) |
| **guns** | 3 x WPN-BB1 + 3 x WPN-BM1 | WPN-BB1 + WPN-BM1 + WPN-ML1; **both sponsons empty** | 2 x WPN-BB1 + 2 x WPN-PL1 | 2 x WPN-BB1 + 2 x WPN-CN1 + WPN-ML1; **aft stack empty** | none: no ring exists |
| **utility** | BRG, 3 BAR, 4 AIR, 2 CLM | BRG, 3 BAR, 4 AIR, 2 CLM | BRG, **8 BAR, 6 AIR, 6 CLM** | BRG, 3 BAR, 4 AIR, 2 CLM | BRG, 3 BAR, 4 AIR, **2 CGO** |
| components | 30 | 25 | 40 | 27 | 22 |
| **armour sections, belt / dorsal-ventral / ends (layers)** | 4 / 2 / 2, belt -> **80** block | 3 / 3 / 2, belt -> **75** | 1 / 1 / 1 -> 50 | 4 / 1 / 1, belt -> **80** | 4 / 4 / 1 -> 80 |
| armour spheres / total subs | 18 / 48 | 18 / 43 | 11 / 51 | 18 / 45 | 14 / 36 |
| record slots / bytes | 5,660 / 22,640 | 5,630 / 22,520 | 5,720 / 22,880 | 5,642 / 22,568 | 5,612 / 22,448 |

**As built and measured**, from `derive()` over the wrapped exterior. These supersede the projected figures the draft carried: the shell is a curved skin on the profile rather than six rectangles, so it costs different cells, and every number below moves with it.

| | Terran | Karisen | Rogue | Benefactor | Freighter |
|---|---|---|---|---|---|
| plate / solid cells | 5,122 / 7,609 | 4,306 / 7,841 | 1,721 / 4,694 | 4,380 / 7,257 | 3,614 / 5,996 |
| **stock mass** | 0.853 (**85%**) | 0.761 (76%) | 0.796 (88%) | 0.793 (79%) | 1.588 (79%) |
| stock hull (target) | 270 (302) | 236 (250) | 198 (180) | 244 (253) | 549 (608) |
| stock accf / accr / accl | 1.055 / 0.352 / 0.234 | 1.248 / 0.394 / 0.263 | 1.243 / 0.440 / 0.301 | 1.072 / 0.378 / 0.252 | 0.567 / 0.189 / 0.126 |
| top speed | 8.0 = | 8.5 = | 9.5 = | 8.0 = | 5.0 = |
| stock yaw / pitch | 6.83 / 4.57 | 7.79 / 5.22 | 11.12 / 7.45 | 7.35 / 4.92 | 4.35 / 2.92 |
| bare frame cells on the outside | 0 | 0 | 0 | 0 | 0 |
| enclosed part cells outside the hull | 0 | 0 | 0 | 0 | 0 |
| parts visible in the grid | 28/28 | 23/23 | 37/37 | 25/25 | 18/18 |
| marines / capacity / reach | 15 / 8 / 20 | 15 / **4** / 20 | 40 / 12 / 40 | 15 / 8 / 20 | 15 / **6** / 10 |
| extent (cells) | 24 x 20 x 57 | 24 x 20 x 56 | 29 x 20 x 45 | 22 x 22 x 57 | 19 x 17 x 48 |
| bounding r vs class r | 3.240 / 3.5 | 3.224 / 3.5 | 2.640 / 3.2 | 3.193 / 3.5 | 4.133 / 4.5 |
| visible faction swatches | 8 / 8 | 8 / 8 | 8 / 8 | 8 / 8 | 8 / 8 |

Top speed, marines and boarding reach are exact on every class. **Two residuals are stated rather than hidden:** the Karisen and the Freighter land 4 and 6 boarding capacity against an authored 8, because their frames have no free bay left to hang the missing airlocks on, and the Freighter's hull is 8% under its 608. Both are frame authoring, not arithmetic: the fix is a bay socket, not a constant.

**Character, and why each falls out of arithmetic rather than taste.**

- **Terran.** The armoured line ship: 302 hull for 0.87 mass, the best hull-per-mass afloat, bought with a 4-layer belt over the biggest envelope any frigate carries. Three beams at 27.5 on a 3.0 s cooldown is four fire slots each, the heaviest sustained output in the game, and beams have `pen 0` so it is the ship that hates other people's belts most.
- **Karisen.** Same mass, 52 fewer hull, and it spends the difference on speed and reach: the only frigate whose bells reach v_exh 8.5, and the only one with 3-layer plate on all four long faces rather than a belt, which is the stacked dorsal-plate-and-ventral-keel silhouette read from the inside. Beam plus a 2-missile batch is burstier than three beams. Ships with two empty sponson rings, so arming them is the first thing a player will do.
- **Rogue.** Every authored number falls out of one fact: its boarding gear (8 barracks + 6 airlocks + 6 clamps) masses 0.232, **31% of its whole 0.743**. That is why the envelope is only 32 macro long, why it has 180 hull, and why it is nearly unarmoured everywhere except a 6x6x8 citadel at 9 layers: 90% block over the magazine and the bridge, 50% over everything else. Short envelope + low mass is also why it turns at 9.0 against a Terran's 6.0.
- **Benefactor.** Slowest-turning frigate, and its drive package is the interesting part: one DRV-H does most of the pushing but caps top speed at 7.0, so the small DRV-N beside it exists purely to raise the ceiling to 8.0. Exactly the thing a player should discover by swapping one part. Two cannon at `pen 2` make it the belt-breaker.
- **Freighter.** The most constrained design and the one that proves the model: 608 hull on 1.68 mass is the same ~360-per-mass the Terran pays, and two holds cost 0.553: 33% of everything. It is a hold and a skin. It also surfaces a live defect: at `boarding_range: 10` against a Terran (r 3.5) plus its own 4.5, contact is at 8.0 u, so its legal boarding window is **2.0 u wide today**, before any larger hull exists.

## Drawing armour: the slice editor

The slice drawer was one of three shipyard explorations (`mockups/ship-designer-slices/`) and it stayed a mockup while the built tool had nine section sliders and nothing else. There was no way to draw a hull by hand at all. There is now.

**It composes rather than replaces.** Two lists on the record, `plate` and `cut`, as cell indices, applied after everything else the raster does. The useful thing is rarely a hull drawn from nothing: it is the class hull with a sponson added here and a hangar mouth cut there. Cut is applied before fill so a player who carves a mouth and lines it in one pass gets what they drew rather than what the order happened to be.

**Only armour is drawable.** Neither list can touch the frame or a fitted part: those are the class and the fitting, both placed rather than drawn. They are shown on the slice, dimmed, so you can work around them.

**Every drawn cell must reach the ship.** A cell is refused unless a face neighbour is already solid: armour, frame, part, or another drawn cell. A run still works outward from the hull, because each cell it lays is itself something for the next one to touch. And the invariant is kept rather than checked once: cutting can strand what was drawn on top of it, so after every cut a flood fill from the anchored cells drops whatever no longer reaches. Plate hanging in space beside a hull is the defect the pylons were written to end, and a pencil that can make it is a pencil that will.

**Onion skin and brush depth.** The slices either side are ghosted, cyan aft and amber forward, dimmer the further out, up to four; a stroke writes up to eight slices deep from the one you are standing in, which is how a run becomes a rib rather than a line.

**A canvas, not a grid of elements.** 1,024 cells a slice repainted on every pointer move is a thousand nodes to lay out per frame against one fill loop. The hull is rasterised on the next animation frame rather than inline, for the same reason the envelope probe was deferred: about four milliseconds a rasterisation against a drag that fires per pixel.

**What the harness checks is that it is reversible.** Draw a run: the plate count and the mass go up and the grid digest changes. Cut: cells come out of the generated skin. Clear all: every one of those numbers returns to exactly where it started. A tool that can add but not undo is a tool nobody dares use. It also checks that a cell in the far corner is refused with a reason, that a cell against the hull is taken, and that a depth 6 stroke lays six slices in one tap.

## The ship library

**A design is storage plus provenance, and nothing else.** `designs` is a table of JSON records: id, owner, name, class, the client's own mass/hull/legal at save time, the body, and what it was cloned from. The server never interprets a body, and it cannot: what a design MEANS is the core's business and the core does not run on the server (ADR-6). So validation stops at "an object, with a `classKey`, under 64 KB", and the figures on a card are labelled as the client's own rather than presented as authority. `derive()` reading the body is the authority, on whichever client opens it.

**Everything is public to read and anyone may clone anything.** `GET /v1/designs` needs no account; the account header only decides which rows come back marked `mine`. Saving needs one. `?mine=1` narrows the list to your own.

**A clone is a copy, never a reference.** `POST /v1/designs` with a body somebody else wrote makes a NEW row owned by you, with `from` recording where it came from. So a hull you are working from cannot change under you, deleting yours never breaks anyone else's, and editing a clone provably leaves the original alone: the API suite asserts exactly that. Editing or deleting someone else's row is a 403, not a silent no-op.

**In the editor it is one gesture.** `Save as` names the current hull and keeps it; the five class buttons are stock ships, so opening one and saving it IS cloning it, and opening someone's library entry and saving it is cloning theirs. When the open design is already yours the button becomes `Save` and updates in place. The name field is in the page rather than a browser `prompt`, because a modal the page does not own cannot be styled, checked, or reached the same way on every phone.

**The round trip is what the harness checks**, not the status codes. Save a Karisen, walk out to the lobby, find the row, open it back, and assert the same class, the same part count and the same grid digest. A save that returns 201 and a list that renders a row prove nothing on their own.

**Practice levels are one button each.** They were a dropdown beside a Play button, which put six of the seven behind a gesture nobody makes on a phone: a control you have to open to see what is in it is a control most people never open.

## The editing loop

Nobody places a cell. Not a fine one: there is no fine occupancy grid any more: and not one of the 65,536 macro cells either.

**1. PICK A CLASS.** This is defect 2's fix and it is structural: the class selects a rung, a spine and a socket layout, and the viewport re-seeds all three. A Terran's three GUN_RINGs vanish on a Freighter because a Freighter's frame has none. Placements whose socket no longer exists are dropped with a count reported, never silently. `page.html:840` and `:973-974` must read the frame row instead of a module constant.

**2. THE STOCK DESIGN LOADS ON IT**, legal, at ~85% of budget, flying the class's numbers. This is also what the AI flies, so it is a real record and not a special case anywhere in the resolver.

**3. FIT COMPONENTS.** Click a socket, get the palette filtered to what it accepts: a DRIVE_PLATE seat offers bells, a GUN_RING offers barbettes, a barbette's trunnion offers guns. Place, rotate through four rotations, or clear. Mirroring on by default. You never edit a part and never add a socket: that is "components cannot be modified", enforced by the socket table rather than by a rule anyone has to remember.

**4. SHAPE THE HULL.** *As built, this is two exteriors and nine sliders rather than the four tools below: the class hull is a shell on the frame's profile and needs no offset or hollow pass, since the profile already says where inside is. The brush is still unbuilt. The rest of this step is the design it was cut down from.*

**Three tools, in this order.** The earlier draft's toolset could not build its own base designs (judge 2 measured it: section sliders on an 8x4 skeleton give a solid 20x16x56 block, 76% over the mass gate, and the affordable solid is a 1.31 x 0.98 x 6.1 u pencil rattling around the berth). The envelope model needs different tools and they are the ones judge 2 named:
 - **OFFSET**: grow a closed envelope to radius R around the frame. A morphological close; this is what makes a hull rather than a skeleton.
 - **HOLLOW**: the exterior flood fill classifies inside from out. Interior is *derived*, never placed, which is also what deletes the dominated filler material.
 - **SECTION SLIDERS**: nine named sections (bow, three belt bands, stern cap, dorsal, ventral, port, starboard), each one slider of 0-15 plate layers. Nine numbers finishes a ship, and layers *are* the damage model: dragging the mid-belt 3 -> 4 moves block_pct 75 -> 80, readable on the strip as you drag.
 - **MACRO BRUSH**, box or sphere, radius 1-8, mirrored, for local shaping: a sponson, a hangar mouth, a cut-out around a barbette.

All four are CLIENT tools emitting macro-cell writes. The core receives the resulting lattice, never the operations: a stored brush vocabulary would make "sphere brush radius 3" a simulation rule two builds could interpret differently, which is a desync wearing a paint tool's clothes.

**5. ATTACH: CK_ANCHORED.** Every component's footprint must reach the frame through occupied macro cells; STR-STRUT is what you run when it does not. **In v1 a strut carries nothing.** Judge 3 is right that an autorouted, freely-meshed power grid is a button that solves itself and a mesh that defeats it, for ~2% of mass. And `CK_JOINED` as the earlier draft defined it ("a path to a live reactor") hard-gated on a system `sim_core` does not have, contradicting the draft's own rule that CK_POWER stays soft for exactly that reason. When power lands, the same block gains severance, and severance lands on existing rules: an unpowered drive contributes 0 thrust and, if it takes the last live thruster to zero, runs the path already at turn.rs:167-190; an unpowered gun fails one more clause in `can_fire` (turn.rs:355).

**6. READ THE GATE STRIP.** Six hard checks, no soft ones: CELLS, THRUST, ARMS, ANCHORED, MASS, **SPHERE**. Sphere is now the *true bounding sphere* of the occupied lattice against the class radius: an exact hard gate, not the longest-half-axis approximation plus a warning, because the envelope is a designed shape inside the berth rather than the berth itself. All five stock designs pass with margin (Terran 3.398 of 3.5). That is what lets the collision wireframe go (page.html:1616-1618, :1668-1670) without losing information: the gate prints the number the wireframe used to draw. Keep the check at :765/:772; delete CK_POWER and CK_HEAT until the core has power and heat.

**7. PAINT.** Sections or faces, 4 bits of palette index per macro cell (32,768 bytes), **entirely in the client file**: never in the core's record, never in the snapshot, never hashed. Two players who built identical hulls in different colours must not read as a desync; same argument CLAUDE.md already makes for `side`. Mechanically an albedo tint: the archive ships a separate emissive mask per hull (`Ship_1_finish_lights.png`, `ship_2_revised_lights.png`, 512^2), so the player colour multiplies albedo and the window-lights channel is added on top unchanged, which keeps an arbitrary paint job readable under the bloom stack. As built: the swatch row is a faction's EIGHT, seeded from the archived pairs and extended to a full scheme, and picking one sets the primary while the other seven roles hold their places on the hull. Armour is the only thing that takes them, because a painted drive bell is the thing that made an unfamiliar hull unreadable. `Models/levels/generic_armor.png` (128^2) is the base tile. **IFF never depends on paint**: the side ring, the jump-flood outline and the target reticle stay side-coloured, or a player paints red and reads as the enemy.

**8. SAVE.** 5,612-5,720 slots (22.4-22.9 KB), one design per FFI call.

**RENDERING, re-quoted from measurement rather than estimate.** The earlier draft claimed ~10,073 quads and ~1.05 MB of buffers per frigate; judge 2 measured **399 quads / 798 tris / ~32 KB** for a clean box-ish design and ~4,400 quads on a heavily brush-worked one. Both figures are for the macro lattice, which is the only lattice there is now. Twelve ships is 9,600-105,000 tris in ~12 hull draws plus instanced prefabs: comfortably inside the Pi-5 floor, and cheaper than what `view.ts` ships today (fresh BufferGeometry per frame at :573, :662, :716, :737, :760). Two requirements that were missing and are not optional:
 - **Exterior flood fill before meshing.** Hollow hulls mean a boundary-face mesher draws the cavity: judge 2's model had 11,884 macro faces against the draft's assumed 4,900. The fill is already a required core pass (it defines enclosed volume), so the client uses the same classification: one pass serves both.
 - **Dirty-chunk remeshing, 8^3 macro chunks.** A full macro remesh is 6.0 ms; a mirrored radius-8 stroke touches 8-16 chunks at 0.038 ms each, so **0.3-0.6 ms per pointer-move**. The draft's "5-15 ms" was for a fine remesh that actually measures 280-430 ms on a fast x86 and 1-2.5 s on a phone: the exact stutter CLAUDE.md already documents and fixed once for the envelope slider.

**MOBILE.** Section sliders and the palette are bottom sheets on the tab bar; socket selection, rotate, mirror and the gate strip are on-canvas, because a control that only exists in a sheet is one nothing on screen says exists: how move mode went wrong before. With a sheet open, the centre of every on-canvas control must hit that control, at 390x844 and 390x560.

**The model gets the screen, and the sheet is what gives way.** The first cut fixed the view at 240 pixels and let the panel take the rest, which handed the thing being edited 28% of a 390x844 phone and the tool 72%. The rows are the other way round now: the view takes what is left and the sheet is capped at `min(46vh, 430px)`, so the model gets **49%**; one tap on the chevron in the tab bar collapses the sheet to the bar alone and it gets **89%**, and any tab tapped after that brings the sheet back rather than looking broken. At 390x560 the same numbers are 40% and 86%. The harness measures all four and fails below a floor, because "a bit small" is a number.

**And the camera frames the ship, not the lattice.** It solves the eight corners of the hull's own box against BOTH field of view angles: a corner at offset `c` sits at depth `D + c.fwd`, so it is in frame when `D >= |c.right| / tanH - c.fwd`, and the answer is the largest of those sixteen bounds. Two earlier versions were worse and each in an instructive way: framing the longest axis against the vertical angle alone ignores that on a portrait phone the HORIZONTAL angle is the one cropping, and fitting the bounding sphere gives away everything between a 6 x 1.3 unit ship and the sphere around it. It also looks at the hull's own centre rather than the middle of a 32x32x64 lattice the ship sits in one corner of.

**CHECKED IN A BROWSER, not by reading the CSS.** `node web/tests/shipyard.mjs` drives the real screen at 1280x900, 390x844 and 390x560: no horizontal scroll, every control's centre hits that control and not something over it, all five classes legal out of the box and above 70% of their berth, all eight faction swatches on each hull, every enclosed mount inside the hull, both exteriors, the plate toggle cycling on/ghost/off with ghost drawing skin over structure, a tap naming what it hit, a selection outlining it, a turret that turns 90 degrees and moves cells, and gunnery: the arcs toggle cycling, turrets that swing on a target, never past their own arc, and at least one bearing. It has found five defects nothing else could: a chip row reused from the on-canvas overlay was absolutely positioned over the mode buttons and swallowed every tap; the header ran Close from 333 to 408 in a 390 pixel viewport on a bar with overflow hidden, leaving no way out of the screen; the pick card at full width sat on top of the plate toggle and swallowed every tap on it; at 390x560 the wrapped class chip row ate most of a 150 pixel canvas band, so a tap at its centre hit nothing at all; and the trunnion sockets were never listed, so the stock ships carried guns nobody could reach.

**Deliberately NOT offered:** a free-placement voxel brush at anchor resolution, a way to move a hardpoint, a way to edit a part's stats, and any tool that writes an operation log instead of cells.

## What the core gains


- Design records and their transport. `ft_design_load(slot)` writes a record from scratch slot 64, the CORE computes its u64 digest over the bytes it received, and an 8-entry registry (array + linear scan, no HashMap) holds them. `ft_match_new` gains a ship-index -> registry-slot binding plus the digests each seat expects, and REFUSES match creation on a mismatch, naming the ship. Without this a 22.5 KB client-authored blob has no path to the other seat and its only failure mode is a turn-1 hash split indistinguishable from a physics bug.

- `Ship` gains a design handle, and `Sub`/`MountDef` resolve against it rather than against `class_def()`. This touches state.rs:216 (`mount_world_pos`), state.rs:439-448 (`raycast_ships`), turn.rs:145/:166 (`apply_damage`), turn.rs:476 (`arc_test_3d`), turn.rs:695/:705 (contact radius and mass), turn.rs:421 (boarding range) and turn.rs:1003 (capacity). With no design attached everything falls back to the class row, so today's matches and the replay tests are unchanged.

- SNAPSHOT_VERSION 3.0 -> 4.0: the header carries a per-ship design digest and `restore_snapshot` refuses a digest absent from the registry, exactly as it already refuses a foreign seed at snapshot.rs:216. This is the only thing that makes snapshot.rs:214's deliberate rebuild-from-data honest for a design, because a class table is compiled-in and identical by construction while a design arrived over a wire.

- Design derivation, at load, entirely in integers: exterior flood fill (a [u32; 2048] bitset over 65,536 macro cells plus a Vec frontier with a head cursor and neighbour order -x,+x,-y,+y,-z,+z) giving enclosed volume; then hull, mass, thrust, torque, marines, boarding capacity and boarding range as i64 sums, converted to f32 by one division at the end. Integer summation is order-independent, which removes the whole class of bug where sequential and pairwise f32 accumulation over 5,679 cells give 0.5573053 and 0.5572978 and split the hash on turn 0.

- Derived `Flight`: accel_fwd/retro = thrust_cu x 10000 / mass_uM; accel_lat = min(sum_x, sum_y) x 10000 / mass_uM (flight.rs:299 spends one accel_lat on both local axes); max_speed = max v_exh over live drive parts, no mass term; yaw/pitch = 560 x tau / (mass_milli x L_macro), a first-moment curve chosen deliberately over rigid-body tau/(m L^2), which misses the hand-authored values by -20% to +42%.

- Per-ship mass. turn.rs:705 reads `class_def().mass` for the collision impulse and `state.rs` has no per-ship mass. `ShipClass.mass` becomes a BUDGET (the ceiling CK_MASS enforces) and `Ship.mass` carries the design's value into the impulse. Fallback to the class value with no design.

- Armour sections as subsystems: six envelope faces plus an optional citadel, each emitted as a chain of spheres (one per 16 macro cells of the long axis, max 4 per section, <=24 total), with hp from plate cells and block_pct = 100L/(L+1) computed once at load. This is what makes the design's shape reach the damage model WITHOUT a per-voxel DDA, a mutable lattice, or a new intersection primitive - `raycast_ships` (state.rs:432-455) and `apply_damage` (turn.rs:130-190) are unchanged, and the two-level test (hull sphere first, state.rs:450) means a miss costs exactly what it costs today. Measured budget: ~12 ships x 48 subs x 40 rays = 23,040 seg_sphere calls, ~0.15 ms against a 452 us turn.

- `FrameDef` table in data.rs: one row per ShipClassId holding rung, spine and typed hardpoints. Pure data; the resolver gains no branch. This is the table that makes a class change re-seed the berth, the spine and the socket layout.

- OWNER DECISION, not yet agreed: `armor_pen` on WeaponDef and a separate Plasma stat block, so the three gun parts are three choices rather than one wearing three hats. One new field and one subtraction (L_eff = max(0, L - pen)) before block_pct. It changes existing balance and every recorded hash.

- DEFERRED, and explicitly not in v1: power (supply/draw/margin), heat (load/rejection/sink), conduit severance, detection, and cargo as anything but mass and hull. The 9 POWER and THERMAL parts and UTL-SNS are held with them, because a palette category that can only produce warnings teaches players to ignore warnings.


## The first cut

**The smallest slice that is playable and honest: one class, one frame, one stock design, no new simulation systems, and the lockstep contract closed before anything else.**

**Slice 1: the contract (no player-visible change).** `FrameDef` for the Terran only. The design record, `ft_design_load` with a core-computed digest, the 8-entry registry, `ft_match_new` bindings that refuse on digest mismatch, `Ship` carrying a design handle with class fallback, snapshot 4.0 with the digest in the header, the digest in the hash. Acceptance: `tests/replay.rs` passes unchanged with no design attached; passes with the Terran stock design attached to all four ships; a deliberately corrupted digest **refuses match creation** rather than desyncing on turn 1; a cross-client check (`prototype/tools/xclient-check.js`) agrees over six turns with designs loaded. Nothing ships to players in this slice, and that is the point: it is the only part that cannot be retrofitted.

**Slice 2: one designed ship in a real match.** The Terran frame, the Terran stock design as data, and derivation at load: exterior flood fill -> enclosed volume -> hull, mass, thrust, torque, marines/capacity/range as i64 sums. Armour sections as subsystem chains. Per-ship mass into turn.rs:705. Acceptance: the derived Terran matches its calibration row within the stated tolerance, and `node web/tests/playthrough.mjs` reaches VICTORY with the designed hull on desktop and `--mobile`.

**Slice 3: the editor, read-mostly.** The mockup loads the Terran stock design, draws it from the macro lattice with the exterior cull and dirty-chunk remeshing, and lets the player do exactly two things: **fill sockets** and **drag section sliders**. Six hard gates, no soft ones. Delete the collision wireframe (page.html:1616-1618, :1668-1670); keep the sphere check and make it the true bounding sphere. Delete CK_POWER and CK_HEAT. This is already a game: at 87% of budget the Terran has room for a fourth airlock or a thicker belt, and the belt slider visibly moves block_pct 75 -> 80 -> 83.3.

**Slice 4: the other four frames and stock designs, plus OFFSET/HOLLOW/BRUSH and paint.** Class switching re-seeds rung, spine and sockets and reports dropped placements. Paint is client-only from the first line of code, never the core's record.

**What is deliberately outside the first cut:** power, heat, conduit severance, radiators, reactors, sensors, the cruiser and capital rungs, WPN-BB2/BM2/CN2/ML4, DRV-C, and stations. Each is a system the core does not have or a rung nothing flies.

**One thing that must happen before the capital rung, not after.** `turn.rs:421` tests boarding centre-to-centre while contact separation is `ra + rb` (turn.rs:695-699). Against a 28 u capital (r 14) a Terran's legal window is 17.5-20.0 u: 2.5 u wide: and a Freighter (range 10) can never board one at all, because 10 < 4.5 + 14 and the condition is unsatisfiable at every legal separation. This is not hypothetical at capital scale: the **stock Freighter's window is already only 2.0 u wide today**. Make `boarding_range` surface-relative (radius + constant) in the core before any hull larger than the Freighter is authored. Gravity has the same shape at turn.rs:300 (`w.soft + r`).

## Open, and the owner's call


- **Do the weapons get differentiated, and do we accept that it rewrites balance?** Today Plasma resolves to `W_CANNON` (data.rs:137) and Beam beats Cannon on damage, range, cooldown and arc, so the WEAPONS category is one choice wearing three hats and a designer built on it has nothing to decide. The minimal fix is one new field (`armor_pen`) plus a separate Plasma stat block: Beam 27.5/300/3.0s/pen 0, Cannon 27.5/200/4.0s/pen 2, Plasma 35/150/5.0s/pen 1, Missile 25x2/250/6.0s/pen 0, with `L_eff = max(0, L - pen)` before block_pct. That is data plus one subtraction, no branch in the resolver. But it changes every existing match outcome and every recorded hash, so it is your call whether it lands with the designer or the designer ships with one gun that matters.

- **Make `boarding_range` surface-relative now, or accept that the biggest ships in the game are the ones nothing can board?** `turn.rs:421` measures centre to centre while contact is at `ra + rb`. The stock Freighter's legal window is already only 2.0 u wide TODAY, and against a 28 u capital a Terran gets 2.5 u and a Freighter gets none at all - the condition is unsatisfiable at every legal separation. The fix is `radius + constant` in the core and it is small. The decision is whether it goes in before the capital rung is authored (my recommendation) or we ship capitals that boarding cannot reach.

- **What consumes designs?** DESIGN.md:211 has the Fleet panel doing repair only, DESIGN.md:216 has `ShipUpgradeType` as an enum with seven zero-byte placeholder files, Starport and Inventory are header stubs (DESIGN.md:247), and 'shipyard' appears only as a Hit-and-Run target. Without something that consumes a design - fleet points, a hull-class unlock ladder, salvage that yields parts - a player spends forty minutes producing a sidegrade to a ship they already own, and the mass budget is a puzzle constraint with no stakes rather than a currency. This decides whether the designer is a feature or a toy, and it wants deciding before slice 4, not after.
