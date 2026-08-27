# Fallen Tribes - Architecture Decision Document (Rust Engine)

**Status: Proposed · August 2026.** Companion to [`DESIGN.md`](./DESIGN.md), which reconstructs the game from the Unity archive. This document decides the foundations for the Rust rebuild and records why. Ecosystem versions and project statuses below were verified against crates.io / GitHub / vendor announcements in late August 2026; the Rust gamedev ecosystem moves fast, so re-verify the specific version numbers at adoption time - the *structural* conclusions are the durable part.

## Requirements (from the owner)

1. Advanced rendering: detailed ships and planets, **cascading shadows cast over unlimited distance**
2. Engine plume shaders on par with the Unity ones
3. Advanced procedural planet shaders
4. **Scene-graph editor** for setting up scenarios/scenes
5. Cutscene support
6. Decent UI support
7. **WebGPU renderer preferred**
8. **WebAssembly compatibility**
9. Multiplayer compatibility
10. **Async playability** (correspondence play; players submit turns hours apart)
11. **Game recording & playback - state-based snapshots of each turn, replayable anywhere**
12. Intuitive, fluent ship movement (preserve the existing system)
13. **Deterministic no-clip collision:** ships must not interpenetrate (the Unity build lets them clip inside each other while taking timer-tick damage); collisions resolve with rigid-body-style response and deal damage - and the whole turn must resolve **identically on every machine from orders alone**, so multiplayer exchanges only each side's inputs at the start of the turn
14. *(Stretch)* Runs on a **Raspberry Pi 5** - pursued as long as it doesn't distort the architecture; droppable by agreement

Two facts from the code audit shape everything below:

- **The game is small-N and kinematic.** 5 - 20 ships, closed-form Bézier trajectories, per-second discrete events, no rigid-body dynamics in the original. This makes a fully deterministic, headless, hand-rolled simulation *cheap* - the single greatest architectural gift the Unity code gives us - and it keeps the contact resolution requirement 13 adds (ADR-4) tractable at the same small scale.
- **The replay system is an empty stub and the current sim is unreplayable** (unseeded global RNG, wall-clock timers, FX-layer damage authority, physics-timing-dependent hits). Requirements 9 - 11 therefore don't constrain us to any legacy format - but they demand we design determinism in from day one, because retrofitting it is famously miserable.

---

## ADR-1: Engine Foundation - **Bevy**, with Blender + an in-game editor for authoring

**Decision:** Build on **Bevy** (0.19.x line at time of writing; wgpu-based, archetypal ECS, Bevy Foundation-backed, ~48k stars, the only Rust engine with a healthy third-party ecosystem). Do **not** build a from-scratch engine on raw wgpu/winit/hecs, and do **not** adopt Fyrox or Godot+gdext - with the reasoning below recorded honestly, because this decision locks in years.

### Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| **Bevy** | ✅ chosen | Native wgpu/WebGPU today (req 7 - 8, stable Rust toolchain); the most flexible custom-material/WGSL system in Rust (reqs 1 - 3); ECS world serialization aligns perfectly with turn snapshots (req 11); the only real multiplayer-crate ecosystem; foundation-backed longevity. Costs: **no shipped official editor** (see ADR-8), breaking releases every ~4 - 5 months, wasm builds effectively single-threaded. |
| **Fyrox 1.0** | ❌ | The one Rust engine with a real shipped Unity-style editor (FyroxEd) - genuinely tempting for req 4. Rejected on two hard grounds: renderer is **OpenGL/WebGL2 with no wgpu/WebGPU backend scheduled** (fails req 7 indefinitely), and a near-solo bus factor on donation funding with a thin ecosystem (networking, dialog, tooling all hand-rolled). For a multi-year solo project, concentration risk on another solo project is the decisive negative. |
| **Custom engine (wgpu + winit + hecs)** | ❌ | Honest estimate: 12 - 24 months of engine work (glTF+PBR+IBL, CSM, post stack, UI, audio, assets, and - the killer - a scene format *plus editor*) before day-one parity with "Bevy + tooling," with you as sole maintainer forever. Correct only if the goal *is* building an engine rather than shipping Fallen Tribes. |
| **Godot 4.6 + gdext (Rust)** | ❌ (viable runner-up) | Devil's-advocate case examined seriously: Godot wins decisively on editor/cutscene-timeline/UI (reqs 4 - 6 on day one). But: web export runs the **WebGL2-class Compatibility renderer only, WebGPU is an unscheduled roadmap item** (fails req 7); gdext web export is officially *experimental* - nightly Rust + pinned Emscripten, toolchain breakage as recent as mid-2026, and Rust panics hard-abort the browser tab. C# web export still hasn't shipped either (the owner's premise is confirmed - and ironically Rust-via-gdext is currently the *more* viable Godot web path). If the web build were negotiable down to "WebGL2 companion," Godot+gdext would be the fastest route to content production. It isn't the brief. |
| Others (macroquad, Ambient) | ❌ | macroquad: minimal 3D, no editor, no WebGPU. Ambient: development paused indefinitely - a cautionary tale about betting on VC-backed engines. |

### The hedge that de-risks the choice

**ADR-2's engine-agnostic sim crate is deliberately engine-portable.** The deterministic core (`sim_core`) has zero Bevy dependencies; Bevy is a *frontend*. If Bevy's editor story or release churn ever becomes untenable - or if a Godot/WebGPU future materializes - the game's actual value (simulation, content data, replay format, server) moves unchanged. Build `sim_core` first; it is required under every engine option and defers nothing.

### Accepted costs (eyes open)

- One breaking Bevy migration every ~4 - 5 months (mitigation: thin dependency surface - see the "no netcode crate" and "own snapshot structs" decisions below; pin and batch upgrades).
- No official editor for realistically another year+ (mitigation: ADR-8's two-track authoring; the community/official editor becomes an upgrade, not a dependency).
- Wasm is effectively single-threaded (fine for 5 - 20 kinematic ships; budget procgen work per-frame).
- **Compile times and dev-mode performance** - the owner's lived pain with Bevy, addressed head-on in the addendum below rather than waved away.

### ADR-1 Addendum: Iteration Speed - the Owner's Objection and the Alternatives Shortlist

The owner has shipped Bevy work before and disliked two things: **cold/incremental build times** and **dev-mode slowdowns**. Both are real, both have known causes, and both are now recorded acceptance criteria - if the mitigated dev loop still feels bad at the Phase 1 exit, the fallback order below is the plan, not a scramble.

**First, the mitigation stack for staying on Bevy** (these transform the experience and most people never configure them):

1. **Dev-mode slowdowns are mostly unoptimized dependencies.** The standard fix in `Cargo.toml`: your own crate at `opt-level = 1`, all dependencies at `opt-level = 3` (`[profile.dev.package."*"]`). Bevy in a plain debug profile is genuinely unplayable; with this split it's fine - this alone usually cures the "dev mode is slow" complaint.
2. **Incremental link time:** `bevy/dynamic_linking` for dev builds (note: it briefly broke in the 0.18 release - churn evidence, [bevy#22654](https://github.com/bevyengine/bevy/issues/22654)) plus a fast linker (`mold` on Linux, `lld` elsewhere).
3. **Codegen:** the **Cranelift** backend for the dev profile compiles dramatically faster than LLVM (cost: worse debug-info/inspection - [bevy#19916](https://github.com/bevyengine/bevy/issues/19916)).
4. **Hotpatching:** the Dioxus `subsecond`-based hotpatch path ([TheBevyFlock/bevy_hotpatching_experiments](https://github.com/TheBevyFlock/bevy_hotpatching_experiments)) edits running systems without a restart, and WGSL shader hot-reload is built in - together they cover the two tightest loops this project has (gameplay tuning and shader porting).
5. **Structural:** the ADR-2 split already keeps `sim_core` a small, fast-compiling crate - sim iteration (the balance/feel loop) never pays Bevy's compile bill at all, and its tests run headless in seconds.

**The alternatives shortlist**, judged against the requirements (WebGPU req 7, wasm req 8, rendering reqs 1 - 3, editor req 4) and iteration speed:

| Option | Iteration speed | What it is | Honest fit here |
|---|---|---|---|
| **sokol** (+ official auto-generated `sokol-rust` bindings) | Excellent - C headers, seconds to build | Thin cross-platform GPU/app/audio layer; backends: Metal, D3D11, GL, **and an actively maintained WebGPU backend** | The best *custom-engine core* on the list: keeps req 7 alive on web, tiny and stable. But it is a graphics layer, not an engine - scene graph, glTF, CSM shadows, post stack, UI, asset pipeline are all yours to build, so ADR-1's 12 - 24-month custom-engine estimate still applies (minus the lowest-level plumbing). Wasm via Emscripten, not wasm-bindgen. |
| **raylib 5.5/6** (`raylib-rs` / the maintained `sola-raylib` fork) | Excellent | Batteries-included C library: windowing, 2D/3D drawing, input, audio, raygui | The fastest way to see pixels, and a superb **prototyping frontend** - but the renderer is OpenGL-class (a wgpu port is [only a discussion](https://github.com/raysan5/raylib/discussions/4505)), there's no PBR/CSM pipeline of the sort reqs 1 - 3 demand, and web is Emscripten/WebGL. Prototype in it; don't ship the space-visuals bar with it. |
| **macroquad/miniquad** | Excellent - pure Rust, near-instant builds, tiny wasm | Minimal Rust game lib | Same verdict as raylib but Rust-native with painless wasm. Ideal for the **debug/replay viewer and Phase 0 - 1 sim visualizer** (which we want anyway). Minimal 3D, GL-class - not the shipping renderer. |
| **Fyrox 1.0** | Good - notably quick iterative compiles, prebuilt editor | Full engine + shipped editor (see ADR-1 table) | Iteration speed and FyroxEd are its genuine strengths; still fails req 7 (OpenGL/WebGL2 only, no wgpu backend scheduled) and carries the bus-factor risk. |
| **Godot 4.6 + gdext** | **Best on the list** - the engine is prebuilt; you recompile only a small gameplay dylib, with editor hot-reload | Full engine + editor, Rust as an extension | Under an iteration-speed criterion Godot's case *strengthens*: near-instant builds, live editor. The blockers are unchanged (WebGL2-class web, experimental gdext wasm toolchain - ADR-1). The recorded fallback if web fidelity is negotiable. |
| **three-d / rend3 / SDL3-GPU bindings** | Good | Small Rust renderers / the new SDL3 GPU abstraction | three-d is GL-class; rend3 is unmaintained; SDL3's modern-API GPU layer is promising but its browser story is immature. Watch items, not foundations. |

**The synthesis - and why this is a cheap decision now:** the ADR-2/ADR-6 architecture (engine-free `sim_core`, lockstep, event-driven FX) makes the renderer a *swappable frontend*. So the plan:

1. **Phase 0 - 1 builds the sim with a thin visualizer** (macroquad or raylib - pick whichever feels better in an afternoon), which doubles as the permanent debug/replay viewer. All feel-critical iteration (movement constants, combat, collision) happens here at C-like compile speeds, insulated from any engine.
2. **Bevy is adopted for the real renderer with the full mitigation stack from day one**, and judged on the Phase 1 slice: if the mitigated loop still grates, fall back - **Godot+gdext** if the web build may be WebGL2-class, **sokol as the custom-engine core** if WebGPU-on-web stays non-negotiable and the tooling bill is accepted.
3. Either way `sim_core`, the replay format, the content data, and the server move unchanged - the engine choice stops being a years-long bet and becomes a revisitable frontend decision.

*Addendum sources:* [sokol](https://github.com/floooh/sokol) · [sokol WebGPU backend write-up](https://floooh.github.io/2023/10/16/sokol-webgpu.html) · [sokol-rust bindings](https://docs.rs/sokol/latest/sokol/gfx/) · [raylib-rs](https://github.com/raylib-rs/raylib-rs) · [sola-raylib (raylib 6 fork)](https://github.com/brettchalupa/sola-raylib) · [raylib→wgpu discussion](https://github.com/raysan5/raylib/discussions/4505) · [bevy_hotpatching_experiments](https://github.com/TheBevyFlock/bevy_hotpatching_experiments) · [bevy#22654](https://github.com/bevyengine/bevy/issues/22654) · [bevy#19916](https://github.com/bevyengine/bevy/issues/19916) · [Rust engines 2026 comparison](https://aarambhdevhub.medium.com/rust-game-engines-in-2026-bevy-vs-macroquad-vs-ggez-vs-fyrox-which-one-should-you-actually-use-9bf93669e83f)

---

## ADR-2: The Load-Bearing Split - Headless Deterministic `sim_core`

**Decision:** The workspace is split so that game truth never touches the engine:

```
crates/
  sim_core      # no_std-friendly, NO Bevy deps. Orders, SimState, fixed-tick step(),
                # kinematics, weapons/damage, boarding dice, mission goal evaluation,
                # per-turn seeded RNG. Emits SimEvent streams.
  sim_campaign  # campaign rules (map state, travel, economy, encounter generation),
                # engine-free like sim_core and under the same determinism +
                # snapshot/versioning discipline (ADR-4/ADR-5), so the server can
                # resolve campaign turns and campaign saves share the format.
  sim_replay    # replay/save file format (postcard), versioning, hashing.
  game          # Bevy app: presentation, input, planning UX, HUD, FX, cutscenes.
                # Mirrors sim entities via ShipId ↔ Entity map. May be as
                # nondeterministic as it likes. The scenario editor (ADR-8) is a
                # feature-gated mode of this binary, not a separate crate.
  server        # axum + sim_core + sim_campaign + sim_replay: order relay + store,
                # canonical re-resolution/verification (ADR-6), match persistence,
                # replay hosting. No renderer.
```

**Why this is the most important decision in the document:**

1. **Requirement 11 falls out of the structure.** A replay is `initial snapshot + per-turn orders (+ per-turn boundary snapshots)`; "replayable anywhere" = anything that links `sim_core` (native app, the server, a wasm replay viewer on a web page).
2. **Requirements 9 - 10 fall out too.** The server resolves turns by running the *same* `step()` the client uses. Async play is a database row, not netcode (ADR-6).
3. **It quarantines Bevy churn.** Bevy upgrades touch `game` only; the replay format, server, and game rules never migrate.
4. **The Unity failure mode becomes impossible.** In the archive, weapon FX raycast against live colliders and apply damage during playback - hit/miss depends on frame timing, `timeScale`, physics stepping, and unseeded RNG. In the new architecture the sim resolves everything (beam = segment test at fire tick; cannon = swept segment vs. the target's Bézier; missile = the exact 1 s-leg waypoint-hop algorithm in fixed ticks - it's already almost deterministic, only its RNG and physics queries aren't) and emits events (`ShotFired{path}`, `ShotHit{target, subsystem, tick}`, `ExplosionAt`, `BoardingTick`, `ShipCaptured`…). **FX become pure consumers.** The renderer interpolates the authored beam/fade curves at any frame rate; 1×/2×/4× playback speed is a render-side concern that can no longer alter outcomes.
5. **Free gameplay features:** instant turn pre-resolution then cinematic playback with scrubbing/slow-mo (Frozen Synapse-style); "predict outcome if the enemy stands still" previews; headless CI battle tests.

**Turn resolution flow:** planning UI builds `PlayerOrders` → on End Turn, `sim_core` resolves the full 10-second turn *instantly* into `(events, boundary_snapshot)` → the renderer plays the event/trajectory timeline back over 10 s (scaled by playback speed) → next planning phase. The Unity version's "simulation = playback" identity is severed on purpose.

---

## ADR-3: Turn Pipeline and Time Model

**Decision:** One integer-tick clock owns the turn; wall time never touches game state.

- **Fixed tick:** 60 ticks/s × 10 s = **600 tick intervals per turn**; `TICKS_PER_SECOND = 60` constant. **State the endpoint convention explicitly, because the Unity bug was exactly an endpoint ambiguity:** a turn spans tick indices **0..=600 inclusive** (601 boundary evaluations over 600 intervals); ship poses use `t = tick / 600` so `t = 1.0` is actually reached (preserving the exit-tangent carry and the preview-equals-execution promise); slot-*k* events fire when the counter reaches `k × 60`, and **slot 10 (tick 600) is processed before turn-boundary evaluation**. A unit test asserts that orders queued at slot 0 and slot 10 both fire - the two cases Unity's dual clocks lost.
- **Timers:** a single `SimTimer { duration_ticks, elapsed_ticks }` advanced only by the tick - the design the Unity author already sketched (the unused `TimingSimulated`) but never adopted. No pause/resume state mutation (Unity's `Timing.Resume()` destructively rewrote durations - a bug, not a feature). Render-side smoothing/camera/UI timers use render time and never feed the sim.
- **Within-turn schedule per tick:** integrate ship poses (closed-form Bézier at `t = tick/600`), step projectiles, resolve collisions/sweeps, then at second boundaries fire queued weapons and run boarding dice; mission goals and win/loss evaluate at the turn boundary exactly as the original does.
- **Movement: see ADR-14, which supersedes this.** The archive's Bézier contract from DESIGN §3 is *not* ported; it is replaced by a per-tick flight integrator restricted by rotation stats, local axis acceleration limits and carried velocity. Planning previews still call the same functions the resolver does, so preview-equals-execution is preserved by construction.
- Campaign travel becomes stored progress (`travel_progress: f32` advanced by campaign delta and persisted), not a wall-clock timer.

---

## ADR-4: Determinism Policy

**Decision:** f32 with strict discipline - not fixed-point - plus structural safeguards that make silent breakage recoverable.

- **Float policy:** basic arithmetic (`+ − × ÷ sqrt`) is IEEE-exact and portable across x86-64/ARM64/wasm (Rust does not auto-contract FMA). The real hazard is **platform libm transcendentals** (`sin`, `cos`, `atan2`, `powf` differ per OS). Mitigation: `sim_core` routes all math through `glam` configured for scalar libm - and because **glam enables SSE2/simd128 by default**, the exact manifest line matters: `glam = { version = "*", default-features = false, features = ["libm", "scalar-math", "serde"] }` (`scalar-math`, not the absence of a feature, is what disables the SIMD paths). No `std` transcendentals, no `mul_add`, no NaN-tolerant logic (NaN = assertion failure in debug).
- **Fixed-point rejected** for this game: it costs every trig/vector routine and its payoff is already covered by libm discipline *plus* the snapshot safety net below. Fixed-point is the right call for 1000-unit lockstep RTSes without snapshots; we have the opposite profile.
- **RNG:** seeded, stream-split PCG (`rand_pcg`) - **one RNG per turn**, seeded `hash(match_seed, turn_index)`, with per-consumer streams keyed `(ship_id, weapon_id, batch_index, …)`. Replays seek to any turn without replaying RNG history; a divergence in turn N cannot poison turn N+1. This replaces Unity's unseeded global `Random` (boarding dice, AI plans, missile scatter - the scatter radii 0.5/5.0/0.5 and the d6-success-on-5+ boarding table port as-is, just re-sourced). The dead `batchIndex` parameter in the Unity FX API shows this was the original intent.
- **Ordering:** the authoritative sim iterates an explicitly ordered ship list (stable `ShipId`), *not* ECS queries - Bevy query iteration order is not guaranteed stable, and the parallel executor is nondeterministic. `sim_core` isn't an ECS at all; it's plain structs stepped in a loop (5 - 20 ships - an ECS buys nothing here). No `HashMap` iteration in sim logic (`BTreeMap`/`IndexMap`).
- **Physics:** **hand-rolled kinematics plus deterministic contact resolution** (req 13). The Unity original has no collision response at all - ships carry frozen-constraint rigidbodies, interpenetrate freely, and tick 20 damage per 0.2 s of overlap. The rebuild replaces that wholesale:
  - **Hulls:** each ship class authors a convex compound proxy (spheres/capsules/boxes) - the same volumes that serve subsystem aim-point targeting; N ≤ ~20 makes the broadphase a trivial pair loop.
  - **Motion:** superseded by ADR-14. The integrator carries a real velocity already, so no velocity-following controller is needed and contact forces deflect it directly.
  - **Resolution:** a swept/speculative contact pass each tick, then **position-based (PBD-style) separation with impulse exchange** - fixed iteration count, contact pairs processed in sorted `(ShipId, ShipId)` order, scalar math only. Interpenetration can never persist a tick.
  - **Damage** = f(relative normal velocity, masses) at contact, with a short per-pair cooldown so grinding hulls don't shred instantly - replacing the timer-tick model and making ramming a real maneuver with real physics.
  - **After contact,** a deflected ship re-flies the remainder of the turn from its current pose and velocity toward the same ordered destination (a pure coast if thrusters are dead), so orders stay meaningful.
  - **Cold-start rule:** every turn's resolution begins from the boundary snapshot with *no carried solver state* (no warm starts) - replays and lockstep peers (ADR-6) converge by construction, and physics state never needs serializing beyond pose/velocity.
  - **Buy option:** Rapier with `enhanced-determinism` (bit-exact cross-platform incl. wasm; no SIMD/parallel - irrelevant at this scale) driven the same way under the same cold-start-per-turn contract, if hand-rolled contacts prove annoying. The earlier objection (snapshotting hidden solver state) dissolves under cold-start.
  - **Preview consequence:** planned trajectories are exact *until contact* - and because turn resolution is an instant headless run (ADR-2), the planner can show **collision-inclusive previews** by simply simulating the draft orders (exact against the committed AI in single-player; estimated against humans per ADR-6).
- **Terrain in the sim:** AI avoidance sweeps, stealth occlusion rays, and ramming all query *scene geometry* (blocker cubes, asteroid fields, the MissileAlley canyon), and ADR-2 forbids touching engine physics - so **terrain participates in `sim_core` as authored analytic collision proxies (spheres/capsules/boxes) declared in `scenario.ron`**, never as render meshes. Cheap, deterministic, faithful to the low-poly blocker maps; the scenario editor (ADR-8) authors these proxies alongside the visuals.
- **The safety net (most important):** determinism *will* silently regress over years. Two structural mitigations make that a logged event instead of a corrupted match: (a) **per-turn boundary snapshots are authoritative** - any client whose re-sim hash mismatches falls back to fetching the snapshot; (b) a **CI cross-platform hash test** - simulate N scripted turns on Linux-x86_64, macOS-ARM, Linux-ARM64 (the Pi 5 target, ADR-13), and wasm32; assert identical snapshot hashes on every commit. Under ADR-6's lockstep model this test is *gating*, not advisory.

---

## ADR-5: Replay, Snapshots, and Saves - One Format

**Decision:** Hybrid event-sourced replay: **per-turn boundary snapshot + per-turn orders (+ redundant event log)**, in `postcard`, versioned. This single format is simultaneously the replay file, the async-multiplayer match state, the battle save, and the desync-detection oracle.

```
ReplayFile {
  header:  { magic, format_version: u16, sim_version: u16, match_seed, content_hash }
  turns:   [ TurnRecord { turn_idx,
                          orders: Vec<PlayerOrders>,
                          boundary_snapshot: SimSnapshot,   // few KB for 20 ships
                          snapshot_hash: u64,               // xxhash over postcard bytes
                          events: Vec<SimEvent> } ]         // redundant but cheap
}
```

- **Why hybrid:** pure input-replay can't seek and dies on every balance patch; pure per-tick state recording is bulky and dumb for a game whose intra-turn sim is a sub-millisecond re-run. Turn boundaries are semantically meaningful seek points unique to WEGO - O(1) seek to any turn, deterministic re-sim within a turn for scrubbing. This is the shipped pattern of the genre (Frozen Synapse: server-stored resolved games; Into the Breach: turn-reset = boundary snapshot restore).
- **Snapshot contents:** full `SimState` - ship poses/velocity state (as float bit patterns; never round-trip authoritative data through decimal text), hull/subsystem/weapon health, cooldowns, ammo/crew/marines *(restoring the fields Unity saved but never loaded)*, boarding parties, live projectiles, mission-goal state, RNG descriptor, tick counter.
- **Version strategy:** bump `sim_version` on *any* rules change. Same version → full re-sim fidelity (orders-only replays are tiny); older → **keyframe-degradation mode** (step boundary snapshots + event log, no intra-turn re-sim) - replays survive patches gracefully instead of breaking, with player expectations set accordingly.
- **Serialization choices, deliberately boring:** plain `#[derive(Serialize, Deserialize)]` structs **owned by `sim_core`** - *not* Bevy reflection/`DynamicScene` (ties the format to engine type paths and churns every release) and *not* `bevy_save` (chronically lags Bevy versions; wrong dependency for a load-bearing format). **`postcard`** because its wire format is formally specified and stable - files remain readable by future tooling in any language. (**Do not use bincode** - development ceased in 2025; its 3.0 release is an intentional tombstone.) zstd on native, raw/deflate on web.
- **Save files:** campaign save = same snapshot discipline over campaign state, replacing Unity's three parallel JSON systems, with stable string ids (repaired per ADR-11), atomic write-temp-then-rename, multiple slots, and id-keyed (never index-keyed) subsystem restore.

---

## ADR-6: Multiplayer and Async Play

**Decision:** **Deterministic lockstep - only orders cross the wire.** Each player submits `Orders{match, turn, commands}` at the start of the turn; every machine resolves the turn independently with the shared `sim_core` and arrives at bit-identical state (owner requirement 13). No state replication, no netcode crate.

- **Why no replication library:** bevy_replicon / lightyear / matchbox / naia solve continuous state replication, prediction, and rollback - a WEGO correspondence game has none of that, and under lockstep there is no state to replicate at all. The traffic is: *submit orders → relay/store → when all sides have submitted (or the deadline fires), everyone fetches the order set and resolves locally*. That is a ~500 - 2000-line protocol on `serde`+`postcard` messages, identical on native and wasm (plain `fetch`/WebSocket; no COOP/COEP, no WebRTC signaling), with zero crates chained to Bevy's release cadence. Per-turn bandwidth is a few hundred bytes of orders - nothing else.
- **Divergence detection and recovery:** every client attaches its `snapshot_hash` for turn N when submitting orders for turn N+1. A hash mismatch is a *logged, recoverable event*, not a corrupted match: the diverged client fetches the canonical boundary snapshot (ADR-5) and rejoins. This is the safety net that makes lockstep shippable by a solo dev - determinism bugs degrade to a snapshot download instead of a broken game.
- **Server:** **axum + tokio + Postgres (sqlx)** as the relay + store; match persistence = the append-only `(match_id, turn, orders, snapshot_hash)` log - which *is* the replay format (ADR-5). **Recommended: the server also links `sim_core` and re-resolves each turn** - it costs milliseconds, produces the canonical snapshot for recovery, arbitrates ties, and structurally limits cheating; but because the clients don't *depend* on it for resolution, the same protocol also runs serverless (dumb relay, host-peer canonical) for LAN/hot-seat play. A small VPS/Fly.io box handles thousands of correspondence matches.
- **What this hardens:** ADR-4's determinism discipline is now **load-bearing correctness**, not a quality bar - a single `f32::sin` from platform libm, an unsorted contact pair, or a carried solver warm-start desyncs matches. Hence the mandatory pieces: scalar-libm math, per-turn seeded RNG, sorted iteration, cold-start physics per turn, and the gating CI hash test across x86-64, macOS-ARM, **Linux-ARM64**, and wasm32.
- **Hot-seat and solo-async** (the campaign) use the same order/turn-record pipeline with a local "server" - one code path everywhere.
- **PvP planning previews - a real design decision, not a free bonus.** The single-player UX shows enemy *committed* orders (ghost trajectories, snap-to-predicted-target, firing-solution recoloring) because the AI plans before the player does. Under simultaneous submission, opponents' orders must be hidden until both sides commit (or the second submitter gains a decisive information edge). **Decision:** in PvP, enemy ships are previewed by **momentum extrapolation** (continuing the drift Bézier from their last executed turn), visually marked as estimates; committed enemy orders are never revealed pre-resolution. Accepted knock-on: snap-rotation and second-timed alpha strikes become probabilistic against humans - that *is* the mind-game of WEGO PvP (Frozen Synapse's whole genre), and the sim's "simulate assuming X" API serves both this preview and the AI.
- **Notifications ("your opponent moved"):** VAPID Web Push (desktop/Android/installed-PWA iOS) + **email fallback** - email is the only universal channel for correspondence games given iOS PWA push restrictions. Native builds poll or hold a socket.

---

## ADR-7: Rendering Architecture

**Decision:** WebGPU-first on wgpu via Bevy; reframe "unlimited shadows" as a hybrid; port shaders by hand to WGSL; build the vector-overlay renderer as a first-class subsystem.

### 7.1 Web targets

WebGPU is default-on in all four browser engines as of 2026 (with real stragglers: Firefox-Linux, pre-OS-26 Apple devices, older Android - roughly ~70% coverage and climbing). Bevy compiles WebGL2 *or* WebGPU per binary (no runtime fallback). **Decision: WebGPU is the primary and only initially-shipped web target** - defensible for a niche tactics game in 2026 - 27, and it unlocks compute (GPU particles), 4-cascade shadows, and the full post stack. Revisit a degraded WebGL2 build only if launch analytics demand it; do not let its feature floor drive art direction. Budget: 10 - 20 MB compressed wasm, loading screen from day one, `bevy_kira_audio` + user-gesture audio unlock, assets streamed over HTTP with build-time processing (the Bevy asset processor doesn't run on wasm - process natively, ship processed output).

### 7.2 "Cascading shadows over unlimited distance" - the honest reframe

No engine - Unity included - does unlimited-distance cascaded shadow maps; the archive itself shipped a 2000-unit cutoff inside a 9000-unit far plane, which is why this requirement exists. The correct architecture for a space game with one directional star:

1. **Analytic sphere-occluder shadows for planets/moons:** a sphere's soft shadow (umbra/penumbra) has a closed-form solution (the Inigo Quilez term - a few ALU ops), implemented as a `MaterialExtension` multiplying the directional light by the occlusion product of the few large bodies, passed in a uniform. **Genuinely unlimited range, artifact-free eclipses** - strictly better than any shadow map for planetary scale.
2. **CSM for local detail:** ship-on-ship self-shadowing within a few km of the camera - 4 cascades at 2048 - 4096 px is high quality at 5 - 20-ship scale. Keep the archive's tunables (bias pair, soft PCF).
3. **Floating origin / camera-relative rendering:** `big_space` (integer-grid reference frames, actively maintained, built for exactly this genre) so world-space f32 jitter and far-from-origin shadow breakage never appear; Bevy's reversed-infinite-Z depth handles the rest without a custom log-depth pass.

This is the single largest custom rendering subsystem (est. 2 - 4 weeks) and the top prototyping priority - and its result will *exceed* the Unity original.

### 7.3 Shader ports (Unity Shader Graph → WGSL, by hand)

No production shader-graph tool exists in Rust; porting is mechanical (each node is a function). The port sources of truth are the `.shadergraph` assets themselves (`archive-model/Shaders/…`) plus the committed decoding in [`reference/SHADER_CATALOG.md`](./reference/SHADER_CATALOG.md) (node techniques, exposed parameters, and the per-planet material tables); DESIGN §10 is the feature summary. Bevy's `Material`/`MaterialExtension` + WGSL hot-reload is the workhorse; effort verdicts:

| Effect | Path | Effort |
|---|---|---|
| Engine plumes (req 2) | MaterialExtension: vertex stretch by throttle + seeded flicker + HDR gradient → bloom | **Low** - the easiest headline port |
| Procgen planets/asteroids (req 3) | Custom material: `noisy_bevy` (simplex/fBm/Worley in WGSL **with identical CPU implementations** - a determinism asset), gradient-ramp LUTs, vertex displacement, fresnel atmosphere; Bevy's built-in raymarched atmosphere (0.17+) covers orbital views | **Moderate** |
| Procedural skybox | Custom skybox shader (dual fBm + Voronoi stars + shimmer) | Moderate |
| Holograms, beam scroll/dissolve, nebula blobs, lens flare, dither filter | Small unlit materials | Low each |
| Selection outlines | `bevy_mod_outline` (has a jump-flood mode) or port the archive's JFA directly | Low |
| Post stack | Built-in bloom/tonemap + color grading (LUT or custom pass) matching the archive's grade (bloom thr 2.0/int 0.5, contrast +25, sat +55, S-curve) | Low |
| Proxy-light decals | Real point/spot lights are cheap at this scene scale - **drop the decal fake**, keep the look via clustered lights; revisit decals only if perf demands | - |

### 7.4 Particles and the vector overlay

- **Particles:** WebGPU-only decision unlocks `bevy_hanabi` (GPU); but at tactical scale, CPU-simulated `bevy_firework` is sufficient and lower-risk - either way, FX must be **steppable/pausable in lockstep with turn playback** (the sim's event timeline drives spawn/freeze, replacing Unity's `ParticleSimulator` pause dance).
- **The Shapes replacement is a first-class deliverable:** an anti-aliased immediate-mode vector layer (billboarded lines with pixel/meter thickness, dashes, discs/rings/arcs/pies with radial gradients, polylines, cones) drawn in a dedicated pass, styled by the ported `LineStyle` data assets. This is the game's visual identity and its planning UX (DESIGN §3.4); budget ~2 - 3 weeks. Implementation: instanced quad/SDF strokes in a custom render phase (references: `bevy_polyline`, `bevy_vector_shapes` - evaluate, but owning this code is acceptable given how central it is).

---

## ADR-8: Scene Format, Scenario Editor, and Authoring (req 4)

**Decision:** Two-track authoring that does not bet on anyone's roadmap: **(a)** an **in-game scenario editor** over the game's own RON data formats for everything gameplay-shaped, and **(b)** **Blender as the 3D scene/look tool** exporting glTF (with Skein-style component tagging where useful). The official Bevy editor / `.bsn` files are treated strictly as a future upgrade (BSN's file format and the editor remain unshipped; the community prototypes are promising but unscheduled - plan as 2027-at-earliest).

**Why an in-game editor is the right scope:** the Unity audit (DESIGN §6.3) shows what a "scenario" actually is: skybox pick + lighting + a handful of terrain props + spawn markers + goal components with event wiring + per-instance stat overrides. That is a **data-editing problem, not a 3D-content problem**. A feature-gated editor mode in the game binary - `bevy-inspector-egui` + `transform-gizmo-bevy` + click-to-select raycasts + a spawn palette + serialize-to-RON - is 2 - 4 weeks for a workable v1, guarantees editor and runtime never diverge, and ships to modders for free later.

**Scene/data formats (all RON via serde, owned by the game not the engine):**

- `scenario.ron` - map environment (skybox, fog/grade profile, props), spawn sets, pre-placed units with overrides, mission goal tree with **event bindings** (the Unity UnityEvent+SetActive language becomes explicit data: `on_success: [Activate("retreat_wp"), Spawn("ambush_1"), UnlockTutorial(5)]`) and initial-active flags.
- `campaign.ron` - the star systems/planets/battlegroups that currently live as thousands of YAML override lines inside a Unity scene (the author's abandoned `MapJson` export finished properly).
- `prefab`-equivalents - unit definitions composing model + mounts + subsystem volumes + FX hookups, with **override-at-instantiation** (the audit's required override set: transforms, active flags, scalar stats, cross-references, array elements, material swaps).
- Cutscene tracks, dialog files, line styles, and the converted ScriptableObject data (ADR-11) round out the set. One serialization discipline everywhere; scenario files are diffable and mergeable in git - an upgrade over binary Unity scenes.

**Blender's role:** the 3D-heavy scenes (cutscene bridge set, main-menu diorama, terrain arrangements) are authored in Blender and imported as glTF scenes referenced from the RON files. Skein (the maintained Blender↔Bevy component-tagging bridge, ~2k lines and designed to survive Bevy churn) is the optional enhancement for tagging gameplay markers directly in Blender; adopt if the workflow earns it, don't depend on it.

---

## ADR-9: UI (req 6)

**Decision:** **egui (`bevy_egui`) for the entire first playable HUD and all tools**, migrating the player-facing HUD to **bevy_ui + headless standard widgets (custom-skinned)** once gameplay is proven. Avoid third-party Bevy UI frameworks (kayak/cuicui/cobweb are dead or archived; lunex is single-maintainer risk). Do not build a DOM-over-canvas HUD - it forks the UI per platform and fights per-frame world-anchoring; the Twee dialog box is the only component where a DOM backend would ever make sense, and only behind a trait.

The audit's capability list (DESIGN §9) is deliberately modest - lists, 3-state buttons, sliders + one snap-scrubber, tooltips, sliding panels, show/hide modals - all comfortably within egui now and bevy_ui-with-widgets later. The two engine-demanding pieces are already owned elsewhere: **world-anchored elements** (hand-rolled `world_to_viewport` projection + frustum-cull + zoom-fade, ~100 lines, or `bevy_ui_anchor`) and the **vector leader-line/overlay layer** (ADR-7.4). Architectural correction from the audit: UI issues **commands** to the planning state and reads sim-emitted view state - never writes gameplay fields directly (the Unity UI's bidirectional coupling is the anti-pattern being retired).

---

## ADR-10: Cutscenes and Dialog (req 5)

**Decision:** Build a **thin data-driven sequencer** (~2 - 3 weeks) rather than waiting for a Unity-Timeline equivalent that doesn't exist in Rust; run dialog on a **Twee-native runtime**.

- **Sequencer:** RON track lists over a single seconds-based clock - the audit shows the prologue needs exactly six track types: activation, audio clip, property-animation curves, camera-shot (hard cuts between virtual cameras + one dolly spline), video window, and signal markers with receiver bindings. Keep tracks stateless/evaluable-at-time `t` so **seek-to-time skip** (Space/Enter → jump playhead) falls out for free - the same property that makes turn playback scrubbable. Implementation over `bevy_tweening` + Bevy's `AnimationPlayer`/`AnimationGraph` (glTF-skinned characters are well supported). Timeline *assets* are re-authored by hand from the decoded YAML - nothing imports `.playable`.
- **Camera layers:** the interior/exterior culling-mask swap maps directly to Bevy `RenderLayers`.
- **Dialog:** the archive's Twee subset (`:: Passage`, `-> Next`, `[[text|target]]`, `Speaker:` lines) is a weekend parser (or the frozen-spec `twee-v3` crate) driving a dialog state machine with the typewriter/choices/end-trigger/chaining behavior preserved - plus the designed-but-unbuilt extensions (per-line triggers, portraits) that the data already anticipates. If branching campaign dialog grows serious, the upgrade path is a one-time Twee→Yarn conversion onto `bevy_yarnspinner` (alive, tracks Bevy) - keep dialog behind a small trait so the swap is contained.
- **Video** (tutorial demo loops; future prologue): no mature Bevy video crate - decode via a small ffmpeg/webcodecs path per platform, or pre-convert demo clips to flipbook textures. The 17 surviving tutorial mp4s make flipbooks the pragmatic v1. On web, an HTML `<video>` overlay is acceptable *for full-screen pre-rendered cinematics only*.

---

## ADR-11: Asset Pipeline and Data Conversion

**Decision:** Build-time pipeline, glTF-only geometry, KTX2 textures, one-shot ScriptableObject conversion with id repair.

- **Geometry:** headless Blender batch (`blender -b --python export.py`) → `.glb` for the 9 `.blend` sources; convert the 21 orphan FBX once (Blender import or maintained FBX2glTF fork), then **retire FBX entirely**. Mind the Unity↔glTF handedness/scale seam once, globally (Unity is left-handed Y-up; the nav-overlay ×100 child-scale hacks in the archive are a warning).
- **Textures:** `toktx`/`basisu` → KTX2 UASTC + zstd (transcodes per-platform; matters for web GPU memory). Pixel-art UI stays PNG. Run all processing in a build script, not Bevy's asset processor (which doesn't run on wasm) - deploy processed output.
- **Data conversion (one-shot tool):** parse the 79 ScriptableObject YAMLs (+ `.meta` GUID map + sprite-atlas fileID maps) → RON records (`WeaponDef`, `ShipClassDef` - merging card + prefab loadout, `FactionDef`, `MarineEfficiencyCurve`, `PlanetTemplate`, `LineStyle`, warning strings, reputation seeds), enums as names not Unity ints. **Repair the id corruption first** (five duplicate/self-colliding card ids, six missing ids, one duplicated weapon id - fully cataloged with asset paths in [`reference/DATA_AUDIT.md`](./reference/DATA_AUDIT.md)); assert id uniqueness at load forever after. Keep the composite per-mount weapon-save key scheme. Skip the audited dead data (ShipPrefabLibrary, orphan weapon assets/icons, `shotCountPerRound`, Mission3 card clones).
- **Audio:** all source clips are lost from the archive - re-source ~8 slots (2 music, engine loop, afterburner, 2 explosion one-shots, UI); the audio system itself is tiny (one music channel + positional one-shots) via `bevy_kira_audio`.

---

## ADR-12: What Ports, What's Rebuilt, What's Dropped

| Unity subsystem | Disposition |
|---|---|
| WEGO loop, move modes, boarding dice, damage splits, arc tests, AI decision procedure, mission goal semantics | **Port faithfully** into `sim_core` (constants preserved, then tuned) - DESIGN §§2 - 6 is the spec |
| Bézier movement | **Replaced**, not ported - see ADR-14. The reachable set was the design flaw, not a constant to retune |
| Campaign V2 model (systems/planets/battlegroups/travel/repair economy) | Port as data + `sim_campaign` logic; finish the JSON-ification the author started |
| Replay/recording | **Greenfield** per ADR-5 (the stub's 8-event taxonomy seeds the `SimEvent` vocabulary) |
| Timing (`Timing` class), FX-authoritative damage, unseeded RNG, dual clocks | **Deliberately not ported** - replaced by ADR-3/-4 (fixing the slot-10 bug, pause corruption, and frame-rate-dependent outcomes) |
| Shaders/post/overlays | Re-implement per ADR-7 from the decoded graphs |
| Timeline cutscenes, Twee dialog, tutorial paging | Rebuild thin per ADR-10; re-author sequence data |
| UI | Rebuild per ADR-9 against the audited capability list; retire V1/V2 duality |
| Scene/prefab/ScriptableObject content | Convert per ADR-8/-11 |
| Shields, loot, diplomacy, ammo, crew, repair queue, blockades | **Design-intent backlog** - schema slots reserved (snapshot versioning makes later addition cheap), implemented post-parity |
| Dead code (audited zero-reference list in DESIGN §13) | Dropped |

---

## ADR-13: Platform Targets - and the Raspberry Pi 5 Question (req 14)

**Decision:** Primary targets are desktop (Windows/macOS/Linux) native + WebGPU browser. **Raspberry Pi 5 is a stretch target pursued through mechanisms we need anyway - never an architecture driver.** Verdict up front: *plausible but not guaranteed today*; validate cheaply and drop by agreement if it fights back.

**The honest state of it (verified Aug 2026):**

- The API path exists: the Pi 5's VideoCore VII driver (Mesa `v3dv`) is **Vulkan 1.3-conformant since Mesa 24.3**, and wgpu's Vulkan backend runs on it. The CPU side is a non-issue - four Cortex-A76 cores dwarf what a 20-ship deterministic sim needs; a Pi could resolve turns in microseconds.
- The renderer is the risk: Bevy's stock 3D pipeline currently trips VideoCore limits - a reported Pi 5 crash (*"Too many bindings of type StorageBuffers"*, bevy#18867) and a history of Pi performance regressions and stutter (bevy#14253). Some of this is fixable with feature trimming; none of it is guaranteed fixable by us.
- The browser path on Pi (WebGPU in Chromium on Linux-ARM) is behind flags - **native ARM64 is the only serious Pi route.**

**What we do about it (all things the project wants regardless):**

1. **A quality-preset ladder** as a first-class system: shadow map 4096→1024 and 3→1 cascades, SSAO off, CPU particles, bloom-only post, capped render scale. Turn-based play is perfectly comfortable at 30 fps.
2. **The sim/render split does the heavy lifting:** worst case, a Pi 5 is still a *perfect* headless server, turn-resolution node, or replay host even if the full battle renderer never fits - the game's logic runs anywhere Rust does.
3. **A validation spike, early:** when the Phase 1 slice renders, build for `aarch64-unknown-linux-gnu` and run it on a real Pi 5 (Wayland). One afternoon answers the question with data instead of hope. Linux-ARM64 is already in the determinism CI matrix (ADR-4), so the sim side is continuously proven on the Pi's architecture from day one.
4. **The exit clause, per the owner:** if VideoCore limits require distorting the renderer (bespoke render paths, abandoning the deferred/clustered features the art direction wants), the requirement is dropped rather than paid for.

---

## ADR-14: Movement Model - Bezier Replaced by a Flight Integrator (supersedes the movement parts of ADR-3 and ADR-4)

**Status:** decided by the owner after flying both in the prototype. This ADR overrides every reference to porting the Bezier movement contract elsewhere in this document, including ADR-3's tick schedule wording, ADR-4's velocity-following controller, ADR-12's port table row, and the Phase 0 exit criterion.

**Decision.** Ship movement is no longer a closed-form curve. It is an integrator, run per tick, restricted by exactly three things:

1. **Rotation stats.** `yawRate` and `pitchRate` (degrees per second, separate axes) cap how fast the hull can be pointed. A heading you cannot reach in time is thrust you cannot apply.
2. **Local axis acceleration limits.** `accelFwd`, `accelRetro` and `accelLat` are applied in the ship's OWN frame. The main drive is strong astern, retros weak, RCS weaker still.
3. **Carried velocity.** Momentum survives the turn boundary. Every plan starts from where the last one left the ship going.

Nothing else feeds it. `MaxThrusterRange` is gone as a movement rule; a derived `nominalReach` survives only as a scalar for AI engagement distances and is computed from the flight stats so it cannot drift from them.

**Why this and not the Bezier.** The archive's reachable set is a sphere centred on the hull, so a ship can always hold station and momentum never constrains the next decision. That is the single biggest flaw DESIGN identifies, and no amount of tuning the control point fixes it, because the shape is wrong rather than the size. Under the integrator the reachable set is a lobe off the nose displaced downrange by momentum: a frigate at rest covers 44.5 units forward but only 20.9 astern (it must turn first, then push on weak retros) and 21.3 vertically (pitch is slower than yaw). Carrying 6 u/s it can no longer hold station at all.

**Consequences.**

- **There is no closed form for the reachable set,** so the planner cannot draw one. It probes: every candidate cell is flown through `canReach` and kept only if the ship arrives. The drawing therefore cannot drift from the rules, and it follows any future tuning for free. A probe integrates in 60 slices rather than 600 ticks (worst-case endpoint error about 0.75 units on a 44 unit reach); execution always uses full tick resolution.
- **Move modes are re-expressed, not dropped.** `MOVE_AND_TURN` points the nose where thrust is needed. `TURN_SLIDE` holds a commanded heading and hands the course to the RCS, which is a far smaller envelope bought in exchange for keeping guns on a bearing. `FULL_SPEED` and `FULL_STOP` are committed: the order chooses no destination, so their envelope is a single point, and the planner says so rather than drawing an empty volume.
- **Contact resolution gets simpler, not harder.** ADR-4's velocity-following controller existed to give a spline something to be deflected from. The integrator already carries a real velocity, so a collision just changes it and the remainder of the turn is re-flown from the contact.
- **Engines dead means unpowered.** Drift is no longer a 0.25 fudge on the last offset; it is the ship coasting on the velocity it had, with no attitude authority. If engines die mid-turn the rest of that turn is re-flown as a coast from that tick.
- **Flight stats are per ship, serialised, and hashed.** They are tunable at runtime in the prototype, which makes them state that affects the simulation, so two clients flying different envelopes must not silently agree.
- **Determinism is unaffected.** The integrator uses only arithmetic plus the existing deterministic trig in `dmath`, on the same libm discipline ADR-4 requires.

## Migration Roadmap

**Phase 0 - Foundations (the bet-validating slice).** `sim_core` skeleton: ship state, the ADR-14 flight integrator, tick loop, orders; CI determinism hash test (3 platforms) from the *first week*. Bevy shell rendering sim state with interpolation; camera rig; minimal egui HUD (end turn, move order). *Exit: one ship flies a planned turn identically on native and wasm/WebGPU, hashes matching.*

**Phase 1 - The tactical vertical slice.** Weapons (beam/cannon/missile) resolved in-sim + event-driven FX; **contact resolution + impulse ram damage (ADR-4 - ships can no longer clip)**; subsystems/armor/drift; boarding; the nav widget + overlays (vector renderer v1) + predictive scrubber; skirmish goals; AI port. *Exit: a full Skirmish battle, feel-matched (see below), replayable from a file - and two builds resolving the same orders to identical hashes (the lockstep proof).*

*A note on the feel-match reference:* the archive as committed cannot produce a running Unity build (the DevLocker SceneReference package, `ProjectSettings/`, and all audio are missing). Either (a) resurrect a runnable Unity reference early in Phase 0 - reinstall DevLocker's SceneReference, reconstruct the layer/tag table documented in DESIGN §11.2, stub the 8 missing audio clips - or (b) if a playable build still exists outside the archive, use it; failing both, define feel-parity against recorded gameplay footage plus the documented constants and the shared preview/execution math. Decide which in Phase 0, because requirement 12 hangs on it.

**Phase 2 - Look and authoring.** Hybrid shadow system prototype (**do this early - it's the top rendering risk**); planet/plume/skybox shader ports; asset pipeline + converted content; in-game scenario editor v1; remaining mission types + stealth; **Raspberry Pi 5 render spike** (ADR-13 - one afternoon on real hardware decides the stretch goal).

**Phase 3 - Campaign + shell.** Campaign map, travel, persistence (single save system), fleet/repair UI, menus, tutorials.

**Phase 4 - Online + narrative.** axum server, match lifecycle, async turns, push/email notifications, web replay viewer; cutscene sequencer + prologue re-author; audio re-sourcing.

**Phase 5 - Debt-paying features** (now cheap by construction): battle rewind (load boundary snapshot), shields (the reserved pipeline slot), loot/diplomacy, spectate.

### Risk register (top 5, with mitigations)

1. **Bevy churn tax** - thin dependency surface (no netcode crate, own formats, egui-first UI); pin + batch upgrades; `sim_core` is immune by construction.
2. **Hybrid shadow subsystem is bespoke** - prototype in Phase 2 start; fallback is honest large-max-distance CSM + contact shadows, which already beats the archive.
3. **Editor expectations** - the in-game editor covers scenarios; accept Blender for 3D scenes; treat official-editor/BSN as upside, never a dependency.
4. **Determinism regressions** - CI hash tests + authoritative boundary snapshots turn the failure mode from "corrupted matches" into "logged fallback."
5. **Solo bandwidth** - the roadmap front-loads the unique value (sim + feel + replay); everything visual/tooling degrades gracefully; each phase exit is a shippable artifact (Phase 1 alone is a distributable skirmish demo).
