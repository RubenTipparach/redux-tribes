# Fallen Tribes — Design Document

**Reconstructed from the Unity archive (`archive-model/`, Unity 2022.3 / URP 14) — August 2026.**

This document reverse-engineers the complete design of Fallen Tribes from the archived code: 194 C# scripts, 31 scenes, 87 prefabs, 79 authored data assets, 30 3D models, and 23 custom shaders/shader graphs plus 18 noise subgraphs (counts exclude vendored Shapes / TextMesh Pro / URP-sample assets). It records **what the game is**, **exactly how each system works** (with the numbers, so the new engine can reproduce the feel), and **what was intended but never finished** — the stubs are design signals, not noise. Its companion, [`ARCHITECTURE.md`](./ARCHITECTURE.md), decides how to rebuild it in Rust.

---

## 1. What Fallen Tribes Is

**A 3D WEGO (simultaneous-turns) space tactics game with a roguelike conquest campaign.** The player commands a small fleet (1–8 ships against similar numbers) in full-3D battles. Each turn, both sides secretly plan movement and schedule weapon fire on a 10-second timeline; pressing *End Turn* plays out 10 seconds of simultaneous simulation — ships fly momentum-preserving curves, beams and missiles resolve, marines fight deck-by-deck — then the game returns to planning. Between battles, a persistent fleet travels a hand-authored starmap, flipping planets and systems to the player's faction, earning credits, and repairing damage that carries over from fight to fight.

**Setting (from `Resources/Dialog/sketch.txt` and the prologue script `FT-sc1.txt`):** The Terran Commonwealth's summit with the alien **Karisen Empire** has failed. The Emperor plans to destroy the Karisen homeworld using an experimental jump module — a ship accelerated to 99.9% c, an "unstoppable bullet" with a 3-month countdown. Admiralty conspirators secretly assign **Captain Geril** of the flagship **ETS Orion** a treasonous mission to stop it. The bridge crew are the tutorial voices: **Shuran** (helm), **Konarm** (tactics), **Fozzine** (security/marines), **Ludwegg** (engineering).

**Factions** (`ShipFaction` enum + `Resources/FactionData/`): Terran Commonwealth (TCNS, blue), Karisen Empire (IKS, orange/red), Benefactors (BNS, purple), Rogue (RIS, green) — fully authored with ships, colors, and hologram materials. Galactic Council (UGCA), Rebels (NGRS), Cultists (FMIC), and Plague (EPSS) exist as named stubs awaiting content.

**Art style:** low-poly hulls (500–900 vertices) with hand-pixeled Aseprite textures (64–512 px), lifted by a modern render stack — HDR emissives feeding thresholded bloom, procedural-noise planets and skyboxes, saturation-heavy color grading, jump-flood selection outlines, and a signature vector-graphics tactical overlay. Scale convention: 1 unit ≈ 1 "ship-meter"; frigates are 7–16 units long, stations 45–70, combat happens in a ~200-unit bubble, weapon ranges 200–300 units, asteroid backdrops at 250–660 units.

---

## 2. The Core Loop: WEGO Turns

**Files:** `Scripts/Simulator/SimulationController.cs`, `Scripts/GameManager.cs`, `Scripts/Simulator/ITimedSimulator.cs`, `Scripts/Utilities/Timers.cs`.

### 2.1 Turn structure

- State machine: `Planning → Simulating (10.0 s) → Planning`, with `Paused` and `Rewinding` states that exist but were never wired (rewind is an explicit stub — see §13).
- During **Planning**, time is frozen. Each ship gets exactly **one movement order** (target position + orientation + move mode) and any number of **weapon orders scheduled to integer seconds 0–10** of the upcoming turn. The AI plans at the *end* of the previous execution phase, so its orders are already committed when the player starts planning.
- **End Turn** starts the simulation: every registered simulator (`ITimedSimulator`) ticks in `FixedUpdate` (default 50 Hz), receiving normalized turn progress `t ∈ [0,1]` plus the fixed delta. Ships are **closed-form interpolated** (pure functions of `t` — see §3.4); projectiles/FX are **step-integrated**.
- On each whole-second boundary, discrete events fire: `FireWeaponIfQueued(second)` and `UpdateShipStateOncePerSecond` (boarding dice, capture checks).
- Simulation speed: 1×/2×/4× via `Time.timeScale` (keyboard `=`/`-`). The camera runs on unscaled time so it stays fluid at any speed.
- When the 10-second timer completes: turn number increments, weapon cooldowns re-evaluate (cooldowns are measured in **turns**, not seconds), AI plans its next turn, and **win/loss is checked — only at turn boundaries, never mid-execution**.
- Global timeline: `masterTime = turnNumber * 10 + progress` seconds.

### 2.2 The predictive time slider (a core UX identity)

During Planning, the turn timeline slider is a **scrubber over the future**: dragging it to second *t* shows a hologram ghost of *every* ship at its predicted position at time *t* — computed with the exact same curve math the simulation will run, so the preview is never wrong. Weapon buttons queue fire at the currently-scrubbed second; the 11 tick marks (seconds 0–10) show queued attacks as hoverable dots; weapon attack lines and firing arcs re-anchor to the *predicted* poses at the scrubbed instant. During Simulating, the same slider becomes a read-only progress bar. There is no scrubbing of *past* simulation — that was the unbuilt Rewind feature.

**Known timing defect to fix in the port:** the turn is measured by two disagreeing clocks (a wall-clock timer for progress `t`, a fixed-delta accumulator for second boundaries), so **an order queued at slot 10 can never fire and slot 9 is unreliable**. The archive even contains the correct design unused: `TimingSimulated` in `Timers.cs`, a pure accumulated-delta timer. The new engine should schedule slots on exact tick indices.

---

## 3. Ship Movement — The System to Preserve

**Files:** `Scripts/NavMove.cs`, `Scripts/Simulator/ShipController.cs` (`SimVector3Update`, `SimQuaternionUpdate`), `Scripts/Overlay/*`, `Scripts/Camera/*`. This is the "intuitive and fluent ship movement system" the new engine must keep; every constant below matters to the feel.

### 3.1 Picking a 3D destination with a 2D mouse

One shared **nav widget** serves the selected ship, decomposing the 3D pick into orthogonal gestures:

1. **Horizontal drag (default):** clicking any empty space drags the destination on a mathematical horizontal plane through the widget's current altitude. No need to click the widget itself — drag anywhere.
2. **Elevation handles:** up/down arrow handles drag on a **camera-facing vertical plane** (normal = horizontal camera→handle direction), moving only Y, with grab-offset preserved so the widget never jumps to the cursor. Classic Homeworld "pole + ring" altitude visualization: a vertical line drops from the 3D destination to its plane projection, with small rings (radius 2) at both ends.
3. **Rotation ring:** free-rotates the planned facing (mouse X → yaw, mouse Y → pitch, in ship-local space).
4. **Roll arrow:** mouse-Y rolls the ship around its forward axis; roll (`zRoll`) is remembered and re-applied whenever heading recomputes.
5. Handles hover-highlight by swapping to an outline render layer.

The widget can be dragged past range; the *delivered* order is clamped to a sphere of `MaxThrusterRange` and the overflow is drawn as a dashed line. A **radial disc + ring** grows from the ship to the clamped destination, showing the movement budget spent.

### 3.2 Movement verbs (`ShipMoveModes`)

Base range `maxThrusterRangeValue` = 20 (code default; 40 on the shipped Terran frigate).

| Mode | Effect | Gate |
|---|---|---|
| `MOVE_AND_TURN` | Free destination in range sphere; ship auto-faces travel direction (with preserved roll) | default |
| `TURN_SLIDE` | Facing decoupled from travel — keep sliding on momentum while rotating freely (Battlestar-style drift-turn) | — |
| `FULL_SPEED` (boost) | Range ×2, but **locked straight along the current vector** | only after a `MOVE_AND_TURN` turn; not while stopping |
| `FULL_STOP` | Range ÷2 this turn, then a staged multi-turn braking sequence to a dead stop | not already stopping |

Plus **Reset** (undo to start-of-turn plan) and **Snap-rotation-to-target** (aims at the target's *predicted end-of-turn* position — predictive, not current).

### 3.3 The trajectory math (the actual feel)

Each turn's path is a **quadratic Bézier** evaluated by nested lerps:

```
control_point = ship_position + last_velocity / 2.5
position(t)   = Bezier(start, control_point, target, t)      // t = turn progress 0..1
rotation(t)   = Slerp(start_rotation, planned_rotation, t)
```

`last_velocity` is re-derived every tick as `target − control_point`, so **each turn's exit tangent becomes the next turn's entry tangent** — consecutive paths join smoothly, producing momentum and implicit turn-radius feel without any physics engine. The divisor **2.5 is the inertia constant** of the whole game. Ships keep their velocity by default: at turn end, the next default destination is projected forward by the previous offset (Newtonian drift).

Special cases:
- **Drift (engines destroyed):** `drift_direction = planned_offset × 0.25`, control point at half; rotation freezes; player and AI lose steering until engines heal.
- **Braking from boost:** control point thrown *behind* the ship (`−last_velocity × 2 + start`), a visible deceleration bow, over a countdown of turns until start/target collapse to a point.
- Planning previews call the *same* Bézier construction (`GetPointOnRouteBeforeSim`), which is why ghost previews exactly match execution. **Preview and simulation must share one code path in the port.**

### 3.4 Tactical overlays (vendored Shapes v4.3.1 vector library)

All drawn as anti-aliased vector primitives with per-style data assets (`Resources/LineStyling/*`, HDR colors, pixel-space billboard thickness for tactical lines, meter-space volumetric lines on the campaign map):

- Planned-trajectory polylines (8-sample Bézier), dashed, with a **cone "carrot"** at the end-of-turn pose. Enemy intended moves are visible too ("assume the enemy has chosen their next move").
- Timeline ghost ships (hologram shader) at the scrubbed second.
- Movement-budget disc/ring, elevation poles/rings, over-range dashed overflow.
- IFF "shadow rings": every ship projects a 16-segment circle (radius 5) onto the tactical plane, blue/red by side, connected by a vertical line — 3D legibility.
- A camera-focus **dot-grid plane** (up to 1000 dots, grid-snapped so dots never swim while panning, distance-faded) plus focus-altitude rings.
- Weapon attack lines (time-advanced to the scrubbed second, recolored when a firing solution exists) and **firing-arc pies/arcs** (radius 10) for horizontal and vertical limits.
- Missile predicted-route polylines.

### 3.5 Camera

Orbit rig around a free-flying focus cursor: **WASD pan + R/F vertical** (camera-relative, SmoothDamp-ramped, 50 u/s), **RMB orbit** (0.25°/px, tilt ±85°), **scroll zoom** 10–150 with smoothing, click-a-ship to lerp-then-snap follow (any pan key breaks follow), optional Dark-Souls-style **target lock-on**. All camera math on unscaled time. A zoom-ratio drives UI fading (subsystem markers fade out when zoomed away) and campaign icon NLIPS scaling.

---

## 4. Combat

**Files:** `Scripts/WeaponController.cs`, `Scripts/Simulator/ShipController.cs`, `Scripts/Subsystems/*`, `Scripts/FX/*`, `Scripts/Utilities/ArcTest.cs`, `Scripts/Data/WeaponData.cs`.

### 4.1 Weapons and scheduling

Weapons are data-driven (`WeaponData` ScriptableObjects) mounted on damageable turret prefabs (`WeaponController : ShipSubsystem`). Authored stats:

| Weapon | Damage | Range | Cooldown (turns) | Notes |
|---|---|---|---|---|
| Beam | 5 | 300 | 0 (every turn) | Hitscan with 0.5 s animated extension; per-shot lateral scatter (radius 0.5); HDR color gradient per mount |
| Missile | 25 | 250 | 1 | Homing, volley of 2–3 (`batchLaunch`), 20 s lifetime — **missiles in flight persist across turn boundaries** |
| Cannon / Plasma / Pulse / Torpedo | 5 | 200 | 1 | One shared implementation (dumb-fire, 100 u/s, 2 s lifetime); the four types differ only in visuals today |

Per-mount `damageMultiplier` scales output — and it is authored **5.5 on every mount except the missile launcher (×1)**, so effective per-shot damage is **27.5** for beams and all projectile types, versus 25 per missile. Two beam-data variants matter for balance: `BeamWeaponData_station` (damage **1** — the Starbase Assault turrets) and `LowPower-BeamWeaponData` (1, orphaned); the two Missile assets are identical duplicates differing only in FX color. Ammo fields exist and serialize but are **never decremented** — unlimited ammo shipped; ammo tracking is an unfinished intent.

- Each weapon holds at most one order per turn, queued to an integer second via the time slider (or hotkeys Z = all weapons, X = disengage all).
- **Firing-arc gates:** per-mount horizontal and vertical arc limits (`ArcTest.TargetArcTest3D` — dot-product-vs-bisector cone tests, asymmetric min/max angles; e.g. missile launchers are unrestricted, hull beams −110°..110°). Re-checked *at the moment of firing* — if the target maneuvered out of arc/range mid-turn, the shot silently skips. The same arc test doubles as the AI's stealth vision cone.
- **Targeting:** one target ship per ship, optionally a specific **subsystem** (aim-point steering: the shot flies at the subsystem's transform and hits whatever it physically reaches first).

### 4.2 Damage model — spatial, not sequential

There is **no abstract to-hit roll and no shield→armor→hull pipeline**. Hit resolution is fully physical: whatever collider a shot reaches decides where damage lands.

- Subsystem colliders wrap ship parts (`SubsystemColliderProxy`); each subsystem absorbs `blockDamagePercent` of a hit and bleeds the rest to the hull:
  - **Armor plates:** absorb 75–90% as authored (Karisen 75, Terran/Benefactor/freighter 80, Rogue 90; the code default of 100 is unused); on death the plate GameObject *disappears*, physically exposing the hull behind it. Cannot be healed.
  - **Weapons:** absorb 75% (50% on missile launchers); dead mounts just can't fire.
  - **Thrusters:** absorb 10–60%; when dead, further hits pass 100% to hull, engine FX/audio stop, and the ship **drifts** (§3.3); healable (used by the capture emergency-repair).
  - **Bare hull:** full damage; internal (collision) damage also spawns explosions. Terran frigate hull = 300 HP.
- **Ramming:** sustained collision deals 20 damage per 0.2 s tick.
- Damage events carry a `FiredEvent{firedShip}` — the AI aggro/retaliation signal.
- Damage feedback: health-threshold smoke trails (below 25–40% health), contact explosions, death explosion + 0.5 s destruction.
- **Repair:** a repair-priority queue exists in UI and data but **nothing consumes it** — battlefield repair is unfinished intent (Ludwegg the engineer was scripted to teach "parts-limited subsystem repair").

**Critical architecture fact for the port:** hit/miss and damage are decided by the FX layer — beam/projectile/missile objects raycast against live colliders during playback and apply damage directly (`WeaponFXBasic.PerformDamageProcedure`). FX are **simulation-authoritative**, entangled with physics stepping, frame timing, `Time.timeScale`, and unseeded `UnityEngine.Random`. The new engine must lift resolution into the deterministic sim and make FX pure consumers of an event stream (see ARCHITECTURE ADR-2/ADR-4). Known quirks to decide on (bug-compat vs. fix): the beam's duplicated damage code lacks the self-hit guard (beams can hit the firing ship); missiles can apply damage twice through parallel raycast + collision paths; destroyed armor plates let shots pass through without exploding.

### 4.3 Missiles (the most involved projectile)

Missiles reuse the ship movement math: launch to a rally point (`origin + forward × 10 + scatter(radius 5)`), then re-plan a quadratic-Bézier leg every 1 s toward `target + pursuit(20) + scatter(0.5)`, C1-continuous between legs, facing velocity. If the target dies they fly straight; on timeout (20 s) they self-destruct visibly. Trail renderers freeze during Planning so trails don't decay between turns.

### 4.4 Boarding and capture

The knife-fight layer, taught by Tutorial 3:

- Prereq: target within `BoardingRange` — **per-ship, a deliberate faction differentiator**: Terran/Karisen/Benefactor 20 range · 15 marines · capacity 8; the **Rogue frigate is a boarding specialist at 40 range · 40 marines · capacity 12**; civilians 10 range. (A noted-but-unimplemented intent: engines must be offline.)
- Boarding sends `min(marines, boardingActionCapacity)` marines. A defender can host **multiple factions' boarding parties simultaneously**; same-faction parties stack.
- **Once per simulated second**, opposed dice: each marine rolls d6, success on 5+. If attacker successes exceed the defender's *efficiency*, defenders lose 1 marine; any defender success kills `efficiency` attackers.
- `efficiency` comes from the **MarineEfficiencyTable keyed on the defender's hull health** — a damaged ship defends worse: >50% hull → kill ratio 2… ≤35% → 0. *Soften the target before boarding* is the core tactic.
- **Capture:** when defenders hit 0 and attackers remain, the ship flips faction — AI disabled, UI card moves to the player's roster, and dead thrusters get an emergency 50 HP heal so the prize can move. Captures count as kills for mission goals; captured ships join the campaign fleet.
- UI: a tug-of-war bar (defender vs. attacker sliders) on each ship card. "Cancel boarding" and enemy re-boarding/reinforcement are authored TODOs.
- Crew (50/200) is saved and displayed but plays no combat role yet — only marines fight. Another unfinished layer.

### 4.5 Ship roster (shipped content)

Playable/encounterable: Terran frigate `ship_1` (300 HP, 3 beam mounts, 6 thruster nozzles, 2 armor plates, 10 fake-light decal projectors), Karisen frigate `ship_2` (250 HP), Benefactor and Rogue frigates (250/180 HP, plasma/pulse/torpedo mounts) from the `sketchy_sketch` WIP sheet, an AI variant at 500 HP, plus civilians: generic freighter (600 HP in the prefab — the Freighter Escort mission overrides its instances down to 10 HP to make them fragile objectives, a good example of the scene-override mechanism in §6.3), neutral shipyard, satellite, and the **Starbase** (station AI + turret ring). Scenery hulks: `ship_3`, `large_batleship`, derelict clusters.

---

## 5. AI and Stealth

**Files:** `Scripts/Simulator/AIController/BaseAIController.cs`, `StationAIController.cs`, `VisionCone.cs`.

- The AI is **not** a state machine — it's a single decision procedure run once per turn (at end-of-execution), issuing the same orders a player would: pick target (first live enemy in registration order — kill priority is emergent from spawn order), chase with an `AIBoost` range cheat if the target is far, queue weapons into one random second (1–8) — **each weapon independently with probability `fireProbability`** (default 0.5, "doubles as aggression level"), **except below 0.2 where the AI deterministically queues only its first weapon every turn** (the shipped low-aggression ships at `fireProbability = 0.1` always fire their primary and nothing else) — pick a destination on a random sphere around the target (25–100% of thrust range), then **fan-cast sphere sweeps** (radius 10, 9 horizontal × 4 vertical angles) for collision avoidance — first clear ray wins.
- Facing: snap to the target's predicted position; at close range, a fully random tumble (a quirk players see as erratic knife-fight behavior).
- **Retaliation:** taking damage reveals and targets the shooter (`IfFiredUponAlert`); no alert propagation between ships — each ship discovers the war alone.
- **Stations:** same combat brain minus movement; they rotate 45°/turn to walk their firing arcs across the target.
- **Stealth:** patrol-route AI (waypoint parents authored in-editor; CW/CCW gizmos) + **VisionCone**: a rectangular frustum (the firing-arc math reused) with per-prefab authored angles — the code default is ±30°/±30°, but **the shipped stealth patrols (Karisen frigate prefab) use ±120° horizontal / ±80° vertical at range 100** — a 240°-wide detection arc; port the authored values, not the default, or stealth becomes trivial. Plus an occlusion raycast that requires positively hitting the target — asteroids/terrain are cover. Detection is a **one-way latch** per ship: once seen (or shot), that ship hunts forever. No suspicion meter, no re-hiding, no shared alarms; detection is only evaluated once per turn (mid-turn detection was planned, never built). Stealth missions = patrol fields + escape waypoints.
- Friendly AI (escort freighters) uses the same brain with `isFriendly` + an objective waypoint.

---

## 6. Missions and Scenarios

**Files:** `Scripts/MissionScripting/*`; scenes in `Scenes/Campaign_RogueLike/MissionTypes/`, `Scenes/Demo/`, `Scenes/Tutorial/`.

### 6.1 Goal architecture

Missions compose from **components on scene objects** under a `GameMission` prefab:

- `MissionGoalProcessor` holds a serialized `missionList` (AND semantics; an unused any-one flag) and auto-discovers failure conditions from active children (OR semantics).
- Goal components: `DestroyAllEnemies` (capture counts), `AllFrieghtersJumped` (≥1 freighter escapes), `DestroyTarget`, `DestroySubsystem` (cripple, don't kill), `CatpuredAllShips` (boarding capture), `Waypoint` (trigger sphere with in-world Shapes hologram; radius is scene-authored via transform scale — radius = scale/2 — with shipped values from ~2.5 units in the stealth mission up to 50 in Freighter Escort). Failures: `LooseAllAships`, `DestroyedShipFails` (protect-VIP).
- **Sequencing is UnityEvent wiring + GameObject active flags**: e.g. *destroy the shipyards → the Retreat waypoint activates*; *capture the ship → a 5-ship ambush spawns* (`EnemyShipSpawner`) *and the escape objective appears*. Goals on inactive objects can't complete — staged objectives via activation. This "component + event-binding + initial-active flag" language is exactly what the new scenario editor must express.
- Rewards: `FullMissionAward` per goal (default 250; starbase kill 1500) + 125 per enemy destroyed.

### 6.2 Mission types

Campaign rotation (wired): **Skirmish**, **Freighter Escort**, **Hit-and-Run** (cripple shipyards, then escape), **Starbase Assault** (6 enemy spawn points ringing the base; forced on stationed systems). Authored but unwired: Nebula Battle, Planetary Assault (skirmish variants distinguished by environment), Ship Salvaging (empty stub scene — but the capture goal is exercised by Demo Mission 3 and Tutorial 3). Demo/scenario missions: movement training, basic combat, capture-with-ambush, battle, **stealth** (patrol maze from `stealth_level.fbx`), plus the `Labrynth` and `MissileAlley` (urban-canyon, 401 objects) set-pieces. A boss mission exists at root. A random-encounter roll assigns types to planets (with an off-by-one that excludes the last table entry — Starbase Assault never rolls randomly).

### 6.3 Scenario anatomy (what the scene editor must author)

A battle scene = **skybox material** (per-mission recolor of the procedural space shader) + one directional light + post-processing volume + collider terrain (dither-shaded blocker cubes, asteroid fields, disabled derelict scenery) + **spawn markers** (`GameSpawnPoints`: ordered player/enemy transforms with a fan-out offset (20,0,0) for extras) + the `GameMission` goal tree + the self-contained `[GameManager]` prefab (sim loop, camera rig, full HUD, music — drop in one prefab, get a playable scenario). **Campaign mission scenes contain no ships** — fleets are injected at runtime from the campaign save. Demo/tutorial scenes instead pre-place ship prefab instances with per-instance overrides (`friendly=0`, `fireProbability=0.1`, health 500…). Prefab nesting runs 3–4 levels deep with overrides at every level — the new engine needs nested prefab instancing with property overrides (see ARCHITECTURE ADR-8).

---

## 7. The Campaign Layer

**Files:** `Scripts/CampaignV2/*` (current), `Scripts/Campaign/*` (V1, superseded but still hosting shared UI/save code), `Scripts/Campaign/GameSetup/EncounterMissionLoader.cs`.

### 7.1 The roguelike conquest loop

1. **Strategic map** (`Campaign_Map_v2.unity`): a 3D world-space map of **7 hand-authored star systems** (Rathis hub, Nyxara, Velmara, Eriathis, Vastora, Oshalvek, Mireth — with ~20 named planets: Teshra, Zennithar, Drenos…), rendered with vector orbit rings, system-border rings, and connection lanes. Camera: plane-raycast grab-pan + curve-mapped scroll zoom; icons NLIPS-scale with zoom.
2. The player's fleet cursor **travels** between adjacent systems (adjacency = authored connection graph): intra-system 4 u/s, interstellar 20 u/s, docking into per-planet 8-slot dock rings. Auto-save on arrival.
3. Hostile planets hold **battle groups** (authored fleets of typed ships at percent health). Clicking one offers its **encounter** (random type per planet; starbase systems forced to Starbase Assault). Mission scenes load via a `DontDestroyOnLoad` loader carrying faction, fleet counts, and the save file.
4. **Winning** removes the planet's battlegroup; a planet with none left flips to Terran; a system whose planets are all Terran flips whole. Credits are awarded; surviving player ships are **re-snapshotted with their damage** — wounds persist into the next battle.
5. Between fights, the **Fleet panel** repairs: hull at 1 credit/HP, subsystems/weapons at half price, gated on credits (start: 1000). Crew/marine hiring buttons exist but are empty stubs.

### 7.2 Supporting systems (state of truth)

- **Reputation/diplomacy:** a −100..100 per-faction score (seeded: Terran 100, Karisen −46, Rogue −14, Benefactors 12) with UI widgets and V1 hostility bands (blockades required ≥2 garrison + hostile rep) — but **no code ever changes a score at runtime**, and V2 reduced hostility to a binary faction check. The "diplomacy matrix" is an explicit TODO.
- **Loot/upgrades:** a named design space (`ShipUpgradeType`: Additional_Health, Armor, Shield, Weapon_Component, Weapon_Modifier, Marine_Capacity, Boarding_Cannon, Thruster_Engines, Hull_Regen, Missiles_Quantity, Ship_Fuel — with design comments like "Shield: absorbs n hits, regens over n turns", "only destroyed ships drop loot / captured ships you can wholesale or strip for parts") — **seven of the eight loot files are zero-byte placeholders; only `ShipUpgrade.cs` (the enum) has content**. Credits are the only implemented reward.
- **Planet taxonomy:** PlanetType (asteroid → super-Jupiter), SurfaceType (rocky/icy/lava/water/earth-like/gas/volcanic), AtmosphereType — carried everywhere, gameplay-inert so far.
- **Save system:** JSON (`campaign_1.json`, single slot) — full schema in §11. Saves only on mission victory and travel; **no mid-battle save**. Enemy fleets persist only as type + health%; crew/marines/ammo/names are saved but never restored; subsystem restore matches by array index (fragile). Two parallel save writers coexist (V1 menu path and V2 system) and must be unified.
- **Editor tooling the author relied on** (`Scripts/CampaignV2/Editor/`): inspector buttons to assign GUIDs to systems/planets/ships, seed default battlegroups everywhere, and emit a fresh save — a *scene-as-database* authoring model. The abandoned `MapJson` export shows the author already wanted the world as data files; the new engine should finish that thought.

---

## 8. Narrative, Cutscenes, Dialog, Tutorials

**Files:** `Scripts/Cutscene/*`, `Scripts/Tutorials/*`, `Sequences/*.playable`, `Scenes/Movies/Cutscene_1.unity`, `Resources/Dialog/*.txt`.

### 8.1 Cutscenes (Unity Timeline + Cinemachine)

The prologue (`Cutscene_1.unity`, ~254 s) is the template: ~128 s pre-rendered movie overlay (the mp4 itself is lost from the archive), then a real-time space flyby on a 5-waypoint **dolly path**, then a hard cut at t=154.9 s — fired by a timeline **signal** that simultaneously swaps the camera's culling mask to the interior layers and starts the bridge dialog. Track types actually used: activation (with post-playback state), audio clips with offsets, 60 Hz property-animation curves (UI fade alpha, dolly position), Cinemachine shot track (hard cuts, no blends), a control track for video, and signal markers. The only custom code is a 49-line skip controller: Space/Enter **seeks** the playhead to a per-sequence `skipToTime`. The set: a Blender bridge interior (`Bridge_Set_1.blend`, also reused as the main menu's admiral's-office diorama) with three Generic-rig characters (captain + 2 ensigns; one Mixamo-rigged) posed by the timeline — no animation controllers anywhere.

### 8.2 Dialog — Twine/Twee

Dialog scripts are plain-text **Twee** files (the author: "I came up with a script annotation… hence the `::` and `->`"). Supported syntax: `:: Passage` headers, `-> Next` linear jumps, `[[text|target]]` choices, `Speaker: line` (default "Narrator"). Runtime: typewriter reveal at 50 chars/s, click-to-complete then click-to-advance, choice buttons, and **dialog-end event triggers** that invoke scene callbacks and can chain into another twee file. Designed-but-unwired: per-line triggers, character portraits (portrait PNGs exist with no consumer). Content: the prologue scene 1 (+backup draft), a scene 2 redraft, an unwired tutorial script, and the invaluable `sketch.txt` writer's document (story arc, laws of the Galactic Council, the officer cast, mission plans).

### 8.3 Tutorials

Paged rich-text panels with **embedded looping video demonstrations** (17 mp4s rendered into shared RenderTextures), page counter, prev/next — plus **progressive disclosure**: completing an in-game objective fires an event that unlocks the next batch of pages (`LoadInMoreTutorials(n)`). Three tutorial scenes: camera+movement, targeting+weapons, boarding. A dialog-driven tutorial orchestrator was designed (empty `TutorialRunner`) but the shipped system is the simpler paged one.

---

## 9. UI Inventory

Two coexisting generations run side-by-side in one prefab (V1 `UIController` god-object, still load-bearing; V2 `UIManagerV2` panel components — the migration never finished). What the game actually renders:

**In-battle HUD:** end-turn button; the 0–10 time slider with 11 attack-queue tick dots; 1×/2×/4× speed buttons; collapsible ship rosters both sides (portrait cards with three-state tinting, right-click = target without moving camera, embedded boarding tug-of-war bars); selected-ship panel (name, faction insignia, health + marine-control sliders, subsystem list with per-subsystem health, click = repair priority); target panel (same, click = aim at subsystem, boarding button, live distance readout); weapons panel (icon buttons per mount with selected/unselected/greyed sprite states, hover draws a **vector leader-line from the button to the physical turret in 3D**); movement-verb buttons; floating over-ship health bars and subsystem markers (world→screen projected every tick, frustum-culled, zoom-faded); one shared rich-text tooltip box; warning banner; win/lose/pause overlay (which also hosts tutorial pages); editor-only debug cheat window.

**Menus:** main menu (3D office diorama backdrop; New/Continue campaign, Scenarios ×7, Tutorials ×3, Options stub, Quit), mission-select with animated unlock sliders, campaign hub panels (Fleet functional; Crew/Diplomacy/Starport/Inventory/Mission are header stubs; Options with reset/save-quit).

**Capability level actually required** (target for "decent UI support"): anchored layouts + auto-layout scrolling lists; template-instantiated rows; 3-state buttons and toggles; many sliders including one interactive snap-to-integer scrubber; hover tooltips; world-anchored elements + an **anti-aliased 2D/3D vector overlay integrated with the UI**; sliding panels; show/hide modals; per-pixel hit-testing on irregular sprites; keyboard shortcut mirroring. **Not needed:** text input, draggable windows, virtualized lists, localization (all strings hard-coded English).

Wiring today is singleton-pull + direct references + per-frame polling with UI writing gameplay state directly — the port should replace this with events/commands out of the sim (see ARCHITECTURE).

---

## 10. Rendering and VFX

**Files:** `Settings/URP-HighFidelity*.asset`, `Shaders/**`, `Settings/SampleSceneProfile.asset`. This section is the feature contract; the full per-shader technical decoding (node graphs, parameters, material tables, renderer features, particle systems) is committed as [`reference/SHADER_CATALOG.md`](./reference/SHADER_CATALOG.md).

### 10.1 Pipeline configuration (as shipped)

Forward URP, HDR (R11G11B10), MSAA off, depth texture on; **shadows: 4096 px, 3 cascades (0–300/300–600/600–2000), soft PCF, distance 2000 against a 9000 camera far plane** — shadows visibly cut off in-scene, which is precisely why "cascading shadows over unlimited distance" is a headline requirement for the new engine. One realtime directional sun (5000 K); everything else luminous is HDR emissive + bloom or fake **proxy-light decals** (emissive falloff decal projectors standing in for point/spot lights on hulls). Post: Neutral tonemap, bloom threshold 2.0 / intensity 0.5, contrast +25, saturation +55, custom S-curve, motion blur 0.1; per-scene analytic height/distance fog on the city maps via a **third-party "full-screen fog" renderer feature that is active in the shipped renderer but whose script source is missing from the archive** (behavior reconstructed from serialized settings — density/color/height values survive in the `city_planet*` volume profiles); SSAO (blue-noise, 0.5/0.25); LOD dither cross-fade.

### 10.2 Shader catalog to reproduce (identity-defining ones bolded)

1. **Procedural planets** (`planet_gen.shadergraph`): 3D simplex fBm at two scales (continents + detail) driving vertex displacement and normal-from-height; land colored via 5 selectable gradient ramps (green/desert/ice/moon/yellow) with variation jitter; sea-level smoothstep water (deep/shallow colors); polar caps; time-rotated 3D-noise clouds; fresnel atmosphere rim. Seven authored planet materials (full parameter table in [`reference/SHADER_CATALOG.md`](./reference/SHADER_CATALOG.md) §3.1). **Asteroid variant** adds Voronoi craters and receives shadows.
2. **Engine plumes** (`EngineFlames.shadergraph`): transparent mesh whose length axis stretches by throttle plus per-frame random flicker (min/max band), HDR two-color gradient fading to burn-out toward the tail — driven at runtime by thrust power (0→0.5 normal, →1.0 boost, ramping over the first second, down after second 9). 8 color variants incl. white-hot missile plumes with HDR values up to ~260 (deliberately bloom-blown).
3. **Procedural space skybox**: dual-layer fBm nebula (two colors, remap controls) + Voronoi starfield (density 1000) with time-rotated shimmer; recolored per mission (10 skybox materials).
4. **Hologram** (fresnel + HDR tint + slight inflation): all ghost previews — planned ship/missile positions, nav markers.
5. **Jump-flood selection outlines** (Ben Golus-style JFA with separable-axis optimization, stencil-masked interiors): orange-red = selected (layer-swap driven), yellow = hover, 10 px, pixel-exact.
6. Beam shader (scrolling texture + noise dissolve + HDR gradient, script-driven fade curve), missile glow/trails, nebula prop (inverse-fresnel additive gas blob), lens-flare billboard, depth-only occluder, retro **Bayer-dither post filter** (authored, currently disabled — an art-direction experiment worth keeping optional), cel-shade experiment (unused).
7. **CPU particles**: explosion flipbook bursts, damage smoke (soft particles), thruster cones — all **pause/resume with the WEGO phase** (particles freeze during Planning; missile trails set to infinite lifetime while paused). The new engine's FX must be steppable in lockstep with sim playback.

### 10.3 The Shapes dependency

The single biggest third-party dependency: the entire tactical overlay layer (every line, ring, disc, arc, pie, dashed polyline — ~15 style assets, HDR colors, pixel/meter thickness spaces) plus in-UI leader-line callouts render through the vendored Shapes immediate-mode vector library via a URP render pass. The new engine needs an equivalent **anti-aliased immediate-mode vector renderer** as a first-class subsystem (see ARCHITECTURE ADR-7).

---

## 11. Data Layer and Content Inventory

### 11.1 The de-facto database (79 assets in `Resources/`)

ScriptableObjects define: weapon configs (9), ship cards (13 = 8 main + 5 Mission-3 spawn clones: identity, portrait, colors, crew caps, spawner prefab ref, string id), factions (9, 5 fully authored), the marine efficiency table, faction reputation seeds, planet template DB (12), warning messages (7), subsystem icons (7, color-coded), button color sets, and 23 line-style assets. **The string-GUID `id` fields on ship cards and weapons are load-bearing save keys** — and audited as badly corrupted: three ship cards share one id (which is actually the GUID of `ShipCardData.cs` itself), two more share another, six assets have no id and regenerate every load, one weapon id is duplicated. The migration must repair ids first — the complete schemas, authored stat tables, and the id-corruption catalog are committed as [`reference/DATA_AUDIT.md`](./reference/DATA_AUDIT.md); conversion plan in ARCHITECTURE ADR-11.

### 11.2 Asset inventory (what must migrate)

- **Models:** 21 game FBX + 9 in-use `.blend` (blend-only sources — freighter, drydock, stations, bridge set, city generator, nebula mesh — require a Blender export step; one `.blend1` backup has no primary file). Characters: captain/ensign/aliens (~500–1000 verts, one Mixamo rig).
- **Textures:** ~300 PNGs (19 Aseprite sources), 512² ship sets, 63 MB pixel-art city kit, faction emblems, 15 ship schematic sprites, UI atlas set.
- **Prefabs:** 92 (ships/mounts/FX/UI/campaign) — 3–4-level nested composition with overrides.
- **Audio: completely lost.** The `Sounds/` folder was stripped from the archive (dangling meta + 8 dangling clip GUIDs: 2 music, engine loop, afterburner, 2 explosions). The audio design was tiny (one music channel with pause/resume at volume 0.327, engine hum per ship, afterburner one-shot in the 1.5–5.5 s window, explosion one-shots) but all content must be re-sourced.
- **Video:** 17 tutorial mp4s survive; the prologue movie is lost.
- **Also lost:** `ProjectSettings/` — tags (`Spaceship`, `Armor`, `Missile`), layer table (Nav=7, layer 8 used by weapons/smoke, Outline_1=9, Outline_Hover=10 — reconstructed from bitmasks), physics settings, build order.
- **Fonts:** OFL sci-fi set (Electrolize, Exo/Exo 2, Michroma, Orbitron, Rajdhani).
- **Third-party to replace:** Shapes (vector renderer), TextMesh Pro (SDF text), Udar SceneField + DevLocker SceneReference (scene refs — DevLocker's source isn't even in the archive), the full-screen/volumetric fog renderer features (referenced by GUID, source not archived — only their serialized settings survive), Simple Particle Scaler (editor-only, skip).

---

## 12. Application Shell

Boot flow: `MainMenu → {Campaign map | Scenario i | Tutorial i}`; campaign map → battle scene (via the DDOL mission loader) → win: campaign / lose: main menu; Escape = pause overlay. Scene transitions are plain loads (no loading screens; one TODO). Three separate save files exist (campaign, legacy mission-unlocks — currently bypassed by unlock-all, and the legacy `savefile.json`); the port should collapse to one campaign save. Input map is fully cataloged (LMB select, Ctrl+LMB/RMB target, RMB orbit, wheel zoom, WASD/RF fly, Escape, Space/Enter cutscene-advance, Z/X/T/Y/U/=/− hotkeys); an Android two-finger-touch port was started and abandoned mid-edit (the branch doesn't compile) — desktop is the real target, but keep the input-abstraction seam.

---

## 13. Current-State Audit — What Exists vs. What Was Intended

**Fully working (port as-is):** WEGO loop, movement planning + Bézier momentum system, predictive scrubber, beams/cannons/missiles, subsystem damage + drift, boarding/capture, mission goal composition + all shipped mission types, stealth patrols/vision cones, campaign V2 conquest loop with persistent fleet damage and repair economy, Twee dialog runtime, Timeline cutscene playback, tutorial paging, the full shader/overlay look.

**Declared but unfinished (design intents to honor in the new engine):**
- **Replay/recording — the headline requirement is a stub.** `EventLog` is 2 fields + an 8-value event taxonomy (Manuever, Damage, FX, WeaponFire, Transport, Destruction, Capture, EndBattle); collector and playback are empty templates; `SimulationState.Rewinding` and per-object pose snapshots were sketched and abandoned. Nothing records anything. This is greenfield — and a freedom: the new architecture isn't constrained by a legacy format (see ARCHITECTURE ADR-5).
- **Shields:** empty `ShieldBubble`/`ShieldController`, a `Shield` subsystem type + icon, a `ShieldLoot` placeholder, and an unused overflow-damage API (`TakeDamageFromRemaining`) purpose-built for a shield→hull pipeline. Design comment: "absorbs n hits from energy, requires n turns to regen."
- Loot/upgrades (enumerated, unimplemented), diplomacy matrix + reputation dynamics, blockades (V1 had them; V2 dropped them), ammo tracking, crew as a combat stat, repair queue, cancel-boarding + enemy re-boarding, per-line dialog triggers + portraits, mid-turn stealth detection, planetary assault + salvaging as distinct mission types, mission objective groups/optional objectives, energy bars in UI, multiplayer (no netcode of any kind exists).

**Known defects worth fixing (not porting):** the two-clock slot-10 bug; unseeded global RNG everywhere; FX-layer damage authority; wall-clock `Timing` with destructive pause/resume (each pause permanently shortens the timer — the unused `TimingSimulated` is the correct spec); array-index save restore with sorting commented out; corrupted content ids; dual save writers; `GetRandomEncounter` off-by-one; V1/V2 UI duality; listener-accumulation and single-subscriber event bugs; the `battleGroups.RemoveAt(0)` re-defeat crash ("This will probably blow up, worry about later lol").

**Dead code to skip entirely** (verified zero-reference): `ShipAnimator`, `ShipPrefabLibrary` + `ShipPrefabs/*`, V1 starmap classes, `VectorStuff`/`MathHelper`/`NoiseGenerator`/`RoundOffStuff`/`RectTransformAspectFitter`, `TimingUnscaled`, orphan weapon assets/icons, `PauseMenu`, `Galaxy_Map.unity`, the `garbage/` scenes, Udar composites, `MenuManager` statics.

---

## 14. Design Pillars for the Remake (distilled)

1. **The plan is a promise the simulation keeps.** Closed-form trajectories mean previews are exact; scrubbing the future is the core interaction. Never let preview and execution code diverge.
2. **Momentum is the game.** The `velocity/2.5` Bézier carry-over, boost-lock, staged braking, and slide-turns are the tactical vocabulary. Preserve the constants, then tune.
3. **Ships are places, not health bars.** Spatial damage — armor plates that physically disappear, subsystem aim-point targeting, engines-out drift, marines fighting deck by deck under a hull-integrity efficiency table.
4. **Time has texture inside a turn.** The 10-second turn with per-second scheduling (alpha strikes timed to predicted geometry) is what separates this from IGOUGO tactics games.
5. **Readable 3D.** Shadow rings, elevation poles, dot-grid planes, IFF-colored vector overlays, NLIPS icons — legibility infrastructure is a first-class renderer feature.
6. **A campaign of consequences.** Damage persists, credits are tight, captures matter. The roguelike loop is small but real; loot/diplomacy are the designed growth surface.
7. **Low-poly + modern glow.** Pixel-art textures under HDR bloom, procedural planets, and vector holograms — a distinctive, achievable art direction for a solo developer.
