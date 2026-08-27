# Fallen Tribes — Architecture Decision Document (Rust Engine)

**Status: Proposed · August 2026.** Companion to [`DESIGN.md`](./DESIGN.md), which reconstructs the game from the Unity archive. This document decides the foundations for the Rust rebuild and records why. Ecosystem versions and project statuses below were verified against crates.io / GitHub / vendor announcements in late August 2026; the Rust gamedev ecosystem moves fast, so re-verify the specific version numbers at adoption time — the *structural* conclusions are the durable part.

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
11. **Game recording & playback — state-based snapshots of each turn, replayable anywhere**
12. Intuitive, fluent ship movement (preserve the existing system)

Two facts from the code audit shape everything below:

- **The game is small-N and kinematic.** 5–20 ships, closed-form Bézier trajectories, per-second discrete events, no rigid-body dynamics. This makes a fully deterministic, headless, hand-rolled simulation *cheap* — the single greatest architectural gift the Unity code gives us.
- **The replay system is an empty stub and the current sim is unreplayable** (unseeded global RNG, wall-clock timers, FX-layer damage authority, physics-timing-dependent hits). Requirements 9–11 therefore don't constrain us to any legacy format — but they demand we design determinism in from day one, because retrofitting it is famously miserable.

---

## ADR-1: Engine Foundation — **Bevy**, with Blender + an in-game editor for authoring

**Decision:** Build on **Bevy** (0.19.x line at time of writing; wgpu-based, archetypal ECS, Bevy Foundation-backed, ~48k stars, the only Rust engine with a healthy third-party ecosystem). Do **not** build a from-scratch engine on raw wgpu/winit/hecs, and do **not** adopt Fyrox or Godot+gdext — with the reasoning below recorded honestly, because this decision locks in years.

### Alternatives considered

| Option | Verdict | Why |
|---|---|---|
| **Bevy** | ✅ chosen | Native wgpu/WebGPU today (req 7–8, stable Rust toolchain); the most flexible custom-material/WGSL system in Rust (reqs 1–3); ECS world serialization aligns perfectly with turn snapshots (req 11); the only real multiplayer-crate ecosystem; foundation-backed longevity. Costs: **no shipped official editor** (see ADR-8), breaking releases every ~4–5 months, wasm builds effectively single-threaded. |
| **Fyrox 1.0** | ❌ | The one Rust engine with a real shipped Unity-style editor (FyroxEd) — genuinely tempting for req 4. Rejected on two hard grounds: renderer is **OpenGL/WebGL2 with no wgpu/WebGPU backend scheduled** (fails req 7 indefinitely), and a near-solo bus factor on donation funding with a thin ecosystem (networking, dialog, tooling all hand-rolled). For a multi-year solo project, concentration risk on another solo project is the decisive negative. |
| **Custom engine (wgpu + winit + hecs)** | ❌ | Honest estimate: 12–24 months of engine work (glTF+PBR+IBL, CSM, post stack, UI, audio, assets, and — the killer — a scene format *plus editor*) before day-one parity with "Bevy + tooling," with you as sole maintainer forever. Correct only if the goal *is* building an engine rather than shipping Fallen Tribes. |
| **Godot 4.6 + gdext (Rust)** | ❌ (viable runner-up) | Devil's-advocate case examined seriously: Godot wins decisively on editor/cutscene-timeline/UI (reqs 4–6 on day one). But: web export runs the **WebGL2-class Compatibility renderer only, WebGPU is an unscheduled roadmap item** (fails req 7); gdext web export is officially *experimental* — nightly Rust + pinned Emscripten, toolchain breakage as recent as mid-2026, and Rust panics hard-abort the browser tab. C# web export still hasn't shipped either (the owner's premise is confirmed — and ironically Rust-via-gdext is currently the *more* viable Godot web path). If the web build were negotiable down to "WebGL2 companion," Godot+gdext would be the fastest route to content production. It isn't the brief. |
| Others (macroquad, Ambient) | ❌ | macroquad: minimal 3D, no editor, no WebGPU. Ambient: development paused indefinitely — a cautionary tale about betting on VC-backed engines. |

### The hedge that de-risks the choice

**ADR-2's engine-agnostic sim crate is deliberately engine-portable.** The deterministic core (`sim_core`) has zero Bevy dependencies; Bevy is a *frontend*. If Bevy's editor story or release churn ever becomes untenable — or if a Godot/WebGPU future materializes — the game's actual value (simulation, content data, replay format, server) moves unchanged. Build `sim_core` first; it is required under every engine option and defers nothing.

### Accepted costs (eyes open)

- One breaking Bevy migration every ~4–5 months (mitigation: thin dependency surface — see the "no netcode crate" and "own snapshot structs" decisions below; pin and batch upgrades).
- No official editor for realistically another year+ (mitigation: ADR-8's two-track authoring; the community/official editor becomes an upgrade, not a dependency).
- Wasm is effectively single-threaded (fine for 5–20 kinematic ships; budget procgen work per-frame).

---

## ADR-2: The Load-Bearing Split — Headless Deterministic `sim_core`

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
  server        # axum + sim_core + sim_campaign + sim_replay: authoritative turn
                # resolution, match persistence, replay hosting. No renderer.
```

**Why this is the most important decision in the document:**

1. **Requirement 11 falls out of the structure.** A replay is `initial snapshot + per-turn orders (+ per-turn boundary snapshots)`; "replayable anywhere" = anything that links `sim_core` (native app, the server, a wasm replay viewer on a web page).
2. **Requirements 9–10 fall out too.** The server resolves turns by running the *same* `step()` the client uses. Async play is a database row, not netcode (ADR-6).
3. **It quarantines Bevy churn.** Bevy upgrades touch `game` only; the replay format, server, and game rules never migrate.
4. **The Unity failure mode becomes impossible.** In the archive, weapon FX raycast against live colliders and apply damage during playback — hit/miss depends on frame timing, `timeScale`, physics stepping, and unseeded RNG. In the new architecture the sim resolves everything (beam = segment test at fire tick; cannon = swept segment vs. the target's Bézier; missile = the exact 1 s-leg waypoint-hop algorithm in fixed ticks — it's already almost deterministic, only its RNG and physics queries aren't) and emits events (`ShotFired{path}`, `ShotHit{target, subsystem, tick}`, `ExplosionAt`, `BoardingTick`, `ShipCaptured`…). **FX become pure consumers.** The renderer interpolates the authored beam/fade curves at any frame rate; 1×/2×/4× playback speed is a render-side concern that can no longer alter outcomes.
5. **Free gameplay features:** instant turn pre-resolution then cinematic playback with scrubbing/slow-mo (Frozen Synapse-style); "predict outcome if the enemy stands still" previews; headless CI battle tests.

**Turn resolution flow:** planning UI builds `PlayerOrders` → on End Turn, `sim_core` resolves the full 10-second turn *instantly* into `(events, boundary_snapshot)` → the renderer plays the event/trajectory timeline back over 10 s (scaled by playback speed) → next planning phase. The Unity version's "simulation = playback" identity is severed on purpose.

---

## ADR-3: Turn Pipeline and Time Model

**Decision:** One integer-tick clock owns the turn; wall time never touches game state.

- **Fixed tick:** 60 ticks/s × 10 s = **600 tick intervals per turn**; `TICKS_PER_SECOND = 60` constant. **State the endpoint convention explicitly, because the Unity bug was exactly an endpoint ambiguity:** a turn spans tick indices **0..=600 inclusive** (601 boundary evaluations over 600 intervals); ship poses use `t = tick / 600` so `t = 1.0` is actually reached (preserving the exit-tangent carry and the preview-equals-execution promise); slot-*k* events fire when the counter reaches `k × 60`, and **slot 10 (tick 600) is processed before turn-boundary evaluation**. A unit test asserts that orders queued at slot 0 and slot 10 both fire — the two cases Unity's dual clocks lost.
- **Timers:** a single `SimTimer { duration_ticks, elapsed_ticks }` advanced only by the tick — the design the Unity author already sketched (the unused `TimingSimulated`) but never adopted. No pause/resume state mutation (Unity's `Timing.Resume()` destructively rewrote durations — a bug, not a feature). Render-side smoothing/camera/UI timers use render time and never feed the sim.
- **Within-turn schedule per tick:** integrate ship poses (closed-form Bézier at `t = tick/600`), step projectiles, resolve collisions/sweeps, then at second boundaries fire queued weapons and run boarding dice; mission goals and win/loss evaluate at the turn boundary exactly as the original does.
- **The movement contract from DESIGN §3 ports verbatim into `sim_core`:** quadratic Bézier with `control = start + last_velocity/2.5`, cross-turn tangent carry, slerp rotation, drift ×0.25, boost/brake rules, `MaxThrusterRange` modifiers. Planning previews call the same functions — preview-equals-execution is preserved by construction.
- Campaign travel becomes stored progress (`travel_progress: f32` advanced by campaign delta and persisted), not a wall-clock timer.

---

## ADR-4: Determinism Policy

**Decision:** f32 with strict discipline — not fixed-point — plus structural safeguards that make silent breakage recoverable.

- **Float policy:** basic arithmetic (`+ − × ÷ sqrt`) is IEEE-exact and portable across x86-64/ARM64/wasm (Rust does not auto-contract FMA). The real hazard is **platform libm transcendentals** (`sin`, `cos`, `atan2`, `powf` differ per OS). Mitigation: `sim_core` routes all math through `glam` configured for scalar libm — and because **glam enables SSE2/simd128 by default**, the exact manifest line matters: `glam = { version = "*", default-features = false, features = ["libm", "scalar-math", "serde"] }` (`scalar-math`, not the absence of a feature, is what disables the SIMD paths). No `std` transcendentals, no `mul_add`, no NaN-tolerant logic (NaN = assertion failure in debug).
- **Fixed-point rejected** for this game: it costs every trig/vector routine and its payoff is already covered by libm discipline *plus* the snapshot safety net below. Fixed-point is the right call for 1000-unit lockstep RTSes without snapshots; we have the opposite profile.
- **RNG:** seeded, stream-split PCG (`rand_pcg`) — **one RNG per turn**, seeded `hash(match_seed, turn_index)`, with per-consumer streams keyed `(ship_id, weapon_id, batch_index, …)`. Replays seek to any turn without replaying RNG history; a divergence in turn N cannot poison turn N+1. This replaces Unity's unseeded global `Random` (boarding dice, AI plans, missile scatter — the scatter radii 0.5/5.0/0.5 and the d6-success-on-5+ boarding table port as-is, just re-sourced). The dead `batchIndex` parameter in the Unity FX API shows this was the original intent.
- **Ordering:** the authoritative sim iterates an explicitly ordered ship list (stable `ShipId`), *not* ECS queries — Bevy query iteration order is not guaranteed stable, and the parallel executor is nondeterministic. `sim_core` isn't an ECS at all; it's plain structs stepped in a loop (5–20 ships — an ECS buys nothing here). No `HashMap` iteration in sim logic (`BTreeMap`/`IndexMap`).
- **Physics:** **hand-rolled kinematics** (~1–2k lines): Bézier pose evaluation, sphere/segment sweep tests for weapons and ramming, per-subsystem hit volumes (replacing Unity collider proxies — keeps subsystem aim-point targeting data-driven). No physics engine in the sim; `parry3d` for shape-query math where useful. Rapier's `enhanced-determinism` is the documented fallback if design ever pivots to contact-rich dynamics.
- **Terrain in the sim:** AI avoidance sweeps, stealth occlusion rays, and ramming all query *scene geometry* (blocker cubes, asteroid fields, the MissileAlley canyon), and ADR-2 forbids touching engine physics — so **terrain participates in `sim_core` as authored analytic collision proxies (spheres/capsules/boxes) declared in `scenario.ron`**, never as render meshes. Cheap, deterministic, faithful to the low-poly blocker maps; the scenario editor (ADR-8) authors these proxies alongside the visuals.
- **The safety net (most important):** determinism *will* silently regress over years. Two structural mitigations make that a logged event instead of a corrupted match: (a) **per-turn boundary snapshots are authoritative** — any client whose re-sim hash mismatches falls back to fetching the snapshot; (b) a **CI cross-platform hash test** — simulate N scripted turns on Linux-x86_64, macOS-ARM, and wasm32; assert identical snapshot hashes on every commit.

---

## ADR-5: Replay, Snapshots, and Saves — One Format

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

- **Why hybrid:** pure input-replay can't seek and dies on every balance patch; pure per-tick state recording is bulky and dumb for a game whose intra-turn sim is a sub-millisecond re-run. Turn boundaries are semantically meaningful seek points unique to WEGO — O(1) seek to any turn, deterministic re-sim within a turn for scrubbing. This is the shipped pattern of the genre (Frozen Synapse: server-stored resolved games; Into the Breach: turn-reset = boundary snapshot restore).
- **Snapshot contents:** full `SimState` — ship poses/velocity state (as float bit patterns; never round-trip authoritative data through decimal text), hull/subsystem/weapon health, cooldowns, ammo/crew/marines *(restoring the fields Unity saved but never loaded)*, boarding parties, live projectiles, mission-goal state, RNG descriptor, tick counter.
- **Version strategy:** bump `sim_version` on *any* rules change. Same version → full re-sim fidelity (orders-only replays are tiny); older → **keyframe-degradation mode** (step boundary snapshots + event log, no intra-turn re-sim) — replays survive patches gracefully instead of breaking, with player expectations set accordingly.
- **Serialization choices, deliberately boring:** plain `#[derive(Serialize, Deserialize)]` structs **owned by `sim_core`** — *not* Bevy reflection/`DynamicScene` (ties the format to engine type paths and churns every release) and *not* `bevy_save` (chronically lags Bevy versions; wrong dependency for a load-bearing format). **`postcard`** because its wire format is formally specified and stable — files remain readable by future tooling in any language. (**Do not use bincode** — development ceased in 2025; its 3.0 release is an intentional tombstone.) zstd on native, raw/deflate on web.
- **Save files:** campaign save = same snapshot discipline over campaign state, replacing Unity's three parallel JSON systems, with stable string ids (repaired per ADR-11), atomic write-temp-then-rename, multiple slots, and id-keyed (never index-keyed) subsystem restore.

---

## ADR-6: Multiplayer and Async Play

**Decision:** **Server-authoritative turn resolution over plain HTTPS/WebSocket. No netcode crate.**

- **Why no replication library:** bevy_replicon / lightyear / matchbox / naia solve continuous state replication, prediction, and rollback — a WEGO correspondence game has none of that. Its traffic is: *submit `Orders{match, turn, commands}` → server stores → on all-submitted (or deadline) server runs `sim_core::resolve_turn` → clients fetch and play back*. That is a ~500–2000-line protocol on `serde`+`postcard` messages, identical on native and wasm (plain `fetch`/WebSocket; no COOP/COEP, no WebRTC signaling), with zero crates chained to Bevy's release cadence. Keep replicon in the back pocket for a hypothetical live-spectate mode.
- **Server:** **axum + tokio + Postgres (sqlx)**, embedding `sim_core` — the same Rust sim code resolves turns authoritatively (impossible with a Firebase/Supabase TypeScript backend without contortions). Match persistence = the append-only `(match_id, turn, orders, snapshot, state_hash)` log — which *is* the replay format (ADR-5). A small VPS/Fly.io box handles thousands of correspondence matches; resolution is milliseconds.
- **Why server-authoritative rather than deterministic-lockstep-by-mail:** with an authoritative server, cross-platform bit determinism stops being a *correctness cliff* and becomes a *quality bar* — a client desync self-corrects at the next boundary snapshot instead of poisoning the match, and cheating is structurally limited. The determinism discipline of ADR-4 is still worth every bit: it makes replays exact and keeps client-side preview/re-sim honest.
- **Hot-seat and solo-async** (the campaign) use the same order/turn-record pipeline with a local "server" — one code path everywhere.
- **PvP planning previews — a real design decision, not a free bonus.** The single-player UX shows enemy *committed* orders (ghost trajectories, snap-to-predicted-target, firing-solution recoloring) because the AI plans before the player does. Under simultaneous submission, opponents' orders must be hidden until both sides commit (or the second submitter gains a decisive information edge). **Decision:** in PvP, enemy ships are previewed by **momentum extrapolation** (continuing the drift Bézier from their last executed turn), visually marked as estimates; committed enemy orders are never revealed pre-resolution. Accepted knock-on: snap-rotation and second-timed alpha strikes become probabilistic against humans — that *is* the mind-game of WEGO PvP (Frozen Synapse's whole genre), and the sim's "simulate assuming X" API serves both this preview and the AI.
- **Notifications ("your opponent moved"):** VAPID Web Push (desktop/Android/installed-PWA iOS) + **email fallback** — email is the only universal channel for correspondence games given iOS PWA push restrictions. Native builds poll or hold a socket.

---

## ADR-7: Rendering Architecture

**Decision:** WebGPU-first on wgpu via Bevy; reframe "unlimited shadows" as a hybrid; port shaders by hand to WGSL; build the vector-overlay renderer as a first-class subsystem.

### 7.1 Web targets

WebGPU is default-on in all four browser engines as of 2026 (with real stragglers: Firefox-Linux, pre-OS-26 Apple devices, older Android — roughly ~70% coverage and climbing). Bevy compiles WebGL2 *or* WebGPU per binary (no runtime fallback). **Decision: WebGPU is the primary and only initially-shipped web target** — defensible for a niche tactics game in 2026–27, and it unlocks compute (GPU particles), 4-cascade shadows, and the full post stack. Revisit a degraded WebGL2 build only if launch analytics demand it; do not let its feature floor drive art direction. Budget: 10–20 MB compressed wasm, loading screen from day one, `bevy_kira_audio` + user-gesture audio unlock, assets streamed over HTTP with build-time processing (the Bevy asset processor doesn't run on wasm — process natively, ship processed output).

### 7.2 "Cascading shadows over unlimited distance" — the honest reframe

No engine — Unity included — does unlimited-distance cascaded shadow maps; the archive itself shipped a 2000-unit cutoff inside a 9000-unit far plane, which is why this requirement exists. The correct architecture for a space game with one directional star:

1. **Analytic sphere-occluder shadows for planets/moons:** a sphere's soft shadow (umbra/penumbra) has a closed-form solution (the Inigo Quilez term — a few ALU ops), implemented as a `MaterialExtension` multiplying the directional light by the occlusion product of the few large bodies, passed in a uniform. **Genuinely unlimited range, artifact-free eclipses** — strictly better than any shadow map for planetary scale.
2. **CSM for local detail:** ship-on-ship self-shadowing within a few km of the camera — 4 cascades at 2048–4096 px is high quality at 5–20-ship scale. Keep the archive's tunables (bias pair, soft PCF).
3. **Floating origin / camera-relative rendering:** `big_space` (integer-grid reference frames, actively maintained, built for exactly this genre) so world-space f32 jitter and far-from-origin shadow breakage never appear; Bevy's reversed-infinite-Z depth handles the rest without a custom log-depth pass.

This is the single largest custom rendering subsystem (est. 2–4 weeks) and the top prototyping priority — and its result will *exceed* the Unity original.

### 7.3 Shader ports (Unity Shader Graph → WGSL, by hand)

No production shader-graph tool exists in Rust; porting is mechanical (each node is a function). The port sources of truth are the `.shadergraph` assets themselves (`archive-model/Shaders/…`) plus the committed decoding in [`reference/SHADER_CATALOG.md`](./reference/SHADER_CATALOG.md) (node techniques, exposed parameters, and the per-planet material tables); DESIGN §10 is the feature summary. Bevy's `Material`/`MaterialExtension` + WGSL hot-reload is the workhorse; effort verdicts:

| Effect | Path | Effort |
|---|---|---|
| Engine plumes (req 2) | MaterialExtension: vertex stretch by throttle + seeded flicker + HDR gradient → bloom | **Low** — the easiest headline port |
| Procgen planets/asteroids (req 3) | Custom material: `noisy_bevy` (simplex/fBm/Worley in WGSL **with identical CPU implementations** — a determinism asset), gradient-ramp LUTs, vertex displacement, fresnel atmosphere; Bevy's built-in raymarched atmosphere (0.17+) covers orbital views | **Moderate** |
| Procedural skybox | Custom skybox shader (dual fBm + Voronoi stars + shimmer) | Moderate |
| Holograms, beam scroll/dissolve, nebula blobs, lens flare, dither filter | Small unlit materials | Low each |
| Selection outlines | `bevy_mod_outline` (has a jump-flood mode) or port the archive's JFA directly | Low |
| Post stack | Built-in bloom/tonemap + color grading (LUT or custom pass) matching the archive's grade (bloom thr 2.0/int 0.5, contrast +25, sat +55, S-curve) | Low |
| Proxy-light decals | Real point/spot lights are cheap at this scene scale — **drop the decal fake**, keep the look via clustered lights; revisit decals only if perf demands | — |

### 7.4 Particles and the vector overlay

- **Particles:** WebGPU-only decision unlocks `bevy_hanabi` (GPU); but at tactical scale, CPU-simulated `bevy_firework` is sufficient and lower-risk — either way, FX must be **steppable/pausable in lockstep with turn playback** (the sim's event timeline drives spawn/freeze, replacing Unity's `ParticleSimulator` pause dance).
- **The Shapes replacement is a first-class deliverable:** an anti-aliased immediate-mode vector layer (billboarded lines with pixel/meter thickness, dashes, discs/rings/arcs/pies with radial gradients, polylines, cones) drawn in a dedicated pass, styled by the ported `LineStyle` data assets. This is the game's visual identity and its planning UX (DESIGN §3.4); budget ~2–3 weeks. Implementation: instanced quad/SDF strokes in a custom render phase (references: `bevy_polyline`, `bevy_vector_shapes` — evaluate, but owning this code is acceptable given how central it is).

---

## ADR-8: Scene Format, Scenario Editor, and Authoring (req 4)

**Decision:** Two-track authoring that does not bet on anyone's roadmap: **(a)** an **in-game scenario editor** over the game's own RON data formats for everything gameplay-shaped, and **(b)** **Blender as the 3D scene/look tool** exporting glTF (with Skein-style component tagging where useful). The official Bevy editor / `.bsn` files are treated strictly as a future upgrade (BSN's file format and the editor remain unshipped; the community prototypes are promising but unscheduled — plan as 2027-at-earliest).

**Why an in-game editor is the right scope:** the Unity audit (DESIGN §6.3) shows what a "scenario" actually is: skybox pick + lighting + a handful of terrain props + spawn markers + goal components with event wiring + per-instance stat overrides. That is a **data-editing problem, not a 3D-content problem**. A feature-gated editor mode in the game binary — `bevy-inspector-egui` + `transform-gizmo-bevy` + click-to-select raycasts + a spawn palette + serialize-to-RON — is 2–4 weeks for a workable v1, guarantees editor and runtime never diverge, and ships to modders for free later.

**Scene/data formats (all RON via serde, owned by the game not the engine):**

- `scenario.ron` — map environment (skybox, fog/grade profile, props), spawn sets, pre-placed units with overrides, mission goal tree with **event bindings** (the Unity UnityEvent+SetActive language becomes explicit data: `on_success: [Activate("retreat_wp"), Spawn("ambush_1"), UnlockTutorial(5)]`) and initial-active flags.
- `campaign.ron` — the star systems/planets/battlegroups that currently live as thousands of YAML override lines inside a Unity scene (the author's abandoned `MapJson` export finished properly).
- `prefab`-equivalents — unit definitions composing model + mounts + subsystem volumes + FX hookups, with **override-at-instantiation** (the audit's required override set: transforms, active flags, scalar stats, cross-references, array elements, material swaps).
- Cutscene tracks, dialog files, line styles, and the converted ScriptableObject data (ADR-11) round out the set. One serialization discipline everywhere; scenario files are diffable and mergeable in git — an upgrade over binary Unity scenes.

**Blender's role:** the 3D-heavy scenes (cutscene bridge set, main-menu diorama, terrain arrangements) are authored in Blender and imported as glTF scenes referenced from the RON files. Skein (the maintained Blender↔Bevy component-tagging bridge, ~2k lines and designed to survive Bevy churn) is the optional enhancement for tagging gameplay markers directly in Blender; adopt if the workflow earns it, don't depend on it.

---

## ADR-9: UI (req 6)

**Decision:** **egui (`bevy_egui`) for the entire first playable HUD and all tools**, migrating the player-facing HUD to **bevy_ui + headless standard widgets (custom-skinned)** once gameplay is proven. Avoid third-party Bevy UI frameworks (kayak/cuicui/cobweb are dead or archived; lunex is single-maintainer risk). Do not build a DOM-over-canvas HUD — it forks the UI per platform and fights per-frame world-anchoring; the Twee dialog box is the only component where a DOM backend would ever make sense, and only behind a trait.

The audit's capability list (DESIGN §9) is deliberately modest — lists, 3-state buttons, sliders + one snap-scrubber, tooltips, sliding panels, show/hide modals — all comfortably within egui now and bevy_ui-with-widgets later. The two engine-demanding pieces are already owned elsewhere: **world-anchored elements** (hand-rolled `world_to_viewport` projection + frustum-cull + zoom-fade, ~100 lines, or `bevy_ui_anchor`) and the **vector leader-line/overlay layer** (ADR-7.4). Architectural correction from the audit: UI issues **commands** to the planning state and reads sim-emitted view state — never writes gameplay fields directly (the Unity UI's bidirectional coupling is the anti-pattern being retired).

---

## ADR-10: Cutscenes and Dialog (req 5)

**Decision:** Build a **thin data-driven sequencer** (~2–3 weeks) rather than waiting for a Unity-Timeline equivalent that doesn't exist in Rust; run dialog on a **Twee-native runtime**.

- **Sequencer:** RON track lists over a single seconds-based clock — the audit shows the prologue needs exactly six track types: activation, audio clip, property-animation curves, camera-shot (hard cuts between virtual cameras + one dolly spline), video window, and signal markers with receiver bindings. Keep tracks stateless/evaluable-at-time `t` so **seek-to-time skip** (Space/Enter → jump playhead) falls out for free — the same property that makes turn playback scrubbable. Implementation over `bevy_tweening` + Bevy's `AnimationPlayer`/`AnimationGraph` (glTF-skinned characters are well supported). Timeline *assets* are re-authored by hand from the decoded YAML — nothing imports `.playable`.
- **Camera layers:** the interior/exterior culling-mask swap maps directly to Bevy `RenderLayers`.
- **Dialog:** the archive's Twee subset (`:: Passage`, `-> Next`, `[[text|target]]`, `Speaker:` lines) is a weekend parser (or the frozen-spec `twee-v3` crate) driving a dialog state machine with the typewriter/choices/end-trigger/chaining behavior preserved — plus the designed-but-unbuilt extensions (per-line triggers, portraits) that the data already anticipates. If branching campaign dialog grows serious, the upgrade path is a one-time Twee→Yarn conversion onto `bevy_yarnspinner` (alive, tracks Bevy) — keep dialog behind a small trait so the swap is contained.
- **Video** (tutorial demo loops; future prologue): no mature Bevy video crate — decode via a small ffmpeg/webcodecs path per platform, or pre-convert demo clips to flipbook textures. The 17 surviving tutorial mp4s make flipbooks the pragmatic v1. On web, an HTML `<video>` overlay is acceptable *for full-screen pre-rendered cinematics only*.

---

## ADR-11: Asset Pipeline and Data Conversion

**Decision:** Build-time pipeline, glTF-only geometry, KTX2 textures, one-shot ScriptableObject conversion with id repair.

- **Geometry:** headless Blender batch (`blender -b --python export.py`) → `.glb` for the 9 `.blend` sources; convert the 21 orphan FBX once (Blender import or maintained FBX2glTF fork), then **retire FBX entirely**. Mind the Unity↔glTF handedness/scale seam once, globally (Unity is left-handed Y-up; the nav-overlay ×100 child-scale hacks in the archive are a warning).
- **Textures:** `toktx`/`basisu` → KTX2 UASTC + zstd (transcodes per-platform; matters for web GPU memory). Pixel-art UI stays PNG. Run all processing in a build script, not Bevy's asset processor (which doesn't run on wasm) — deploy processed output.
- **Data conversion (one-shot tool):** parse the 79 ScriptableObject YAMLs (+ `.meta` GUID map + sprite-atlas fileID maps) → RON records (`WeaponDef`, `ShipClassDef` — merging card + prefab loadout, `FactionDef`, `MarineEfficiencyCurve`, `PlanetTemplate`, `LineStyle`, warning strings, reputation seeds), enums as names not Unity ints. **Repair the id corruption first** (five duplicate/self-colliding card ids, six missing ids, one duplicated weapon id — fully cataloged with asset paths in [`reference/DATA_AUDIT.md`](./reference/DATA_AUDIT.md)); assert id uniqueness at load forever after. Keep the composite per-mount weapon-save key scheme. Skip the audited dead data (ShipPrefabLibrary, orphan weapon assets/icons, `shotCountPerRound`, Mission3 card clones).
- **Audio:** all source clips are lost from the archive — re-source ~8 slots (2 music, engine loop, afterburner, 2 explosion one-shots, UI); the audio system itself is tiny (one music channel + positional one-shots) via `bevy_kira_audio`.

---

## ADR-12: What Ports, What's Rebuilt, What's Dropped

| Unity subsystem | Disposition |
|---|---|
| WEGO loop, Bézier movement, move modes, boarding dice, damage splits, arc tests, AI decision procedure, mission goal semantics | **Port faithfully** into `sim_core` (constants preserved, then tuned) — DESIGN §§2–6 is the spec |
| Campaign V2 model (systems/planets/battlegroups/travel/repair economy) | Port as data + `sim_campaign` logic; finish the JSON-ification the author started |
| Replay/recording | **Greenfield** per ADR-5 (the stub's 8-event taxonomy seeds the `SimEvent` vocabulary) |
| Timing (`Timing` class), FX-authoritative damage, unseeded RNG, dual clocks | **Deliberately not ported** — replaced by ADR-3/-4 (fixing the slot-10 bug, pause corruption, and frame-rate-dependent outcomes) |
| Shaders/post/overlays | Re-implement per ADR-7 from the decoded graphs |
| Timeline cutscenes, Twee dialog, tutorial paging | Rebuild thin per ADR-10; re-author sequence data |
| UI | Rebuild per ADR-9 against the audited capability list; retire V1/V2 duality |
| Scene/prefab/ScriptableObject content | Convert per ADR-8/-11 |
| Shields, loot, diplomacy, ammo, crew, repair queue, blockades | **Design-intent backlog** — schema slots reserved (snapshot versioning makes later addition cheap), implemented post-parity |
| Dead code (audited zero-reference list in DESIGN §13) | Dropped |

---

## Migration Roadmap

**Phase 0 — Foundations (the bet-validating slice).** `sim_core` skeleton: ship state, Bézier movement, tick loop, orders; CI determinism hash test (3 platforms) from the *first week*. Bevy shell rendering sim state with interpolation; camera rig; minimal egui HUD (end turn, move order). *Exit: one ship flies a planned curve identically on native and wasm/WebGPU, hashes matching.*

**Phase 1 — The tactical vertical slice.** Weapons (beam/cannon/missile) resolved in-sim + event-driven FX; subsystems/armor/drift; boarding; the nav widget + overlays (vector renderer v1) + predictive scrubber; skirmish goals; AI port. *Exit: a full Skirmish battle, feel-matched (see below), replayable from a file.*

*A note on the feel-match reference:* the archive as committed cannot produce a running Unity build (the DevLocker SceneReference package, `ProjectSettings/`, and all audio are missing). Either (a) resurrect a runnable Unity reference early in Phase 0 — reinstall DevLocker's SceneReference, reconstruct the layer/tag table documented in DESIGN §11.2, stub the 8 missing audio clips — or (b) if a playable build still exists outside the archive, use it; failing both, define feel-parity against recorded gameplay footage plus the documented constants and the shared preview/execution math. Decide which in Phase 0, because requirement 12 hangs on it.

**Phase 2 — Look and authoring.** Hybrid shadow system prototype (**do this early — it's the top rendering risk**); planet/plume/skybox shader ports; asset pipeline + converted content; in-game scenario editor v1; remaining mission types + stealth.

**Phase 3 — Campaign + shell.** Campaign map, travel, persistence (single save system), fleet/repair UI, menus, tutorials.

**Phase 4 — Online + narrative.** axum server, match lifecycle, async turns, push/email notifications, web replay viewer; cutscene sequencer + prologue re-author; audio re-sourcing.

**Phase 5 — Debt-paying features** (now cheap by construction): battle rewind (load boundary snapshot), shields (the reserved pipeline slot), loot/diplomacy, spectate.

### Risk register (top 5, with mitigations)

1. **Bevy churn tax** — thin dependency surface (no netcode crate, own formats, egui-first UI); pin + batch upgrades; `sim_core` is immune by construction.
2. **Hybrid shadow subsystem is bespoke** — prototype in Phase 2 start; fallback is honest large-max-distance CSM + contact shadows, which already beats the archive.
3. **Editor expectations** — the in-game editor covers scenarios; accept Blender for 3D scenes; treat official-editor/BSN as upside, never a dependency.
4. **Determinism regressions** — CI hash tests + authoritative boundary snapshots turn the failure mode from "corrupted matches" into "logged fallback."
5. **Solo bandwidth** — the roadmap front-loads the unique value (sim + feel + replay); everything visual/tooling degrades gracefully; each phase exit is a shippable artifact (Phase 1 alone is a distributable skirmish demo).
