# Data Layer Audit - Fallen Tribes (ScriptableObjects & Resources)

> Reference appendix to [`../DESIGN.md`](../DESIGN.md) §11. Complete schemas and authored values of every ScriptableObject data asset (weapons, ship cards, factions, marine table, line styles, reputation seeds, planet DB, warnings), the reference-graph/wiring analysis, the content-id corruption catalog, and the conversion plan consumed by [`../ARCHITECTURE.md`](../ARCHITECTURE.md) ADR-11.

### Scope and Method

This report covers the data-driven content layer of "Fallen Tribes": all ScriptableObject class definitions in `/home/user/redux-tribes/archive-model/Scripts/Data/` and every authored `.asset` instance under `/home/user/redux-tribes/archive-model/Resources/` (79 asset files, all read as Unity YAML), plus the code paths that consume them. All values below were read from the actual files, not inferred.

---

### 1. ScriptableObject Schemas

#### 1.1 `ShipCardData` - `/home/user/redux-tribes/archive-model/Scripts/Data/ShipCardData.cs`
`[CreateAssetMenu(menuName = "ShipData/ShipCard")]`. The per-ship identity/UI record.

| Field | Type | Notes |
|---|---|---|
| `shipSprite` | `Sprite` | Schematic image (Textures/UI/Schematics/*.png) |
| `highlightcolor` | `Color` | Card hover color |
| `selectedColor` | `Color` | Card selected color |
| `unselectedColor` | `Color` | Card idle color |
| `shipFaction` | `ShipFaction` (enum, int) | See enum table below |
| `shipType` | `ShipType` (enum, int) | See enum table below |
| `shipName` | `string` | e.g. "TCS Invincible" |
| `shipRegistryNumber` | `string` | Empty in all authored assets |
| `maxCrew` | `int` | 0 in every authored asset |
| `maxMarines` | `int` | 0 or field entirely absent (older serialization) |
| `shipVariant` | `string` = `"A"` | Variant key |
| `shipSpawner` | `ShipController` | **Direct component reference into a prefab** (GUID + fileID) |
| `factionColor` | `Color` | |
| `id` | `string` | Hand-pasted GUID string; intended stable key (see §7 - badly corrupted) |

Enums defined in the same file (integer values are what appear in the YAML):

`ShipFaction`: `None=0, Terran=1, Karisen=2, GalcticCouncil=3, Benefactors=4, Rebels=5, Cultists=6, Plague=7, Rogue=8` (note the source typo "GalcticCouncil").

`ShipType`: `None=999, Fighter=0, Bomber=1, Corvette=2, HeavyCorvette=3, LightFrigate=4, HeavyFrigate=5, LightCruiser=6, MediumCruiser=7, HeavyCruiser=8, MissileCarrier=9, FighterCarrier=10, BomberCarrier=11, BattleCarrier=12, Battleship=13, Dreadnaught=14, Flagship=15, SuperFlagship=16, Mothership=17, Frieghter=18` (typo), `HeavyFreighter=19, PassengerTransport=20, HeavyPassengerTransport=21, Colony=22, Shuttle=23, Station=24, Shipyard=25, Satellite=26`. Only 4 (LightFrigate), 24, 25, 26 are used in authored data.

#### 1.2 `WeaponData` - `/home/user/redux-tribes/archive-model/Scripts/Data/WeaponData.cs`
`[CreateAssetMenu(menuName = "Weapons/WeaponData")]`.

| Field | Type | Default |
|---|---|---|
| `damage` | `float` | 1 |
| `range` | `float` | 50 |
| `cooldown` | `float` | 1 (in turns; `WeaponController.cs:175` checks `cooldown <= currentTurnNumber - lastFired`) |
| `weaponHealth` | `float` | 10 |
| `weaponFx` | `WeaponFXBasic` | Component reference into an FX prefab (`Prefabs/FX/Weapons/*.prefab`) |
| `shotCountPerRound` | `int` | 3 - **defined but never read anywhere in Scripts/** (dead field; only the class default and asset values exist) |
| `id` | `string` | Initialized `Guid.NewGuid().ToString()` in the field initializer |

Method `GetCustomShipWeaponId(ShipController, int index)` returns `"{shipCardData.id}-W-{id}-I-{index}"` - the composite key used by the campaign save system (`Scripts/Campaign/Utilities/GenerateShipDataBlock.cs:48,102`) to persist per-weapon health across missions. **This makes `ShipCardData.id` + `WeaponData.id` load-bearing save keys.**

#### 1.3 `ShipPrefabData` - `/home/user/redux-tribes/archive-model/Scripts/Data/ShipPrefabData.cs`
`shipFaction: ShipFaction`, `shipType: ShipType`, `shipVariant: string = "A"`, `shipControllerPrefab: GameObject`. A (faction, type, variant) → prefab mapping record.

#### 1.4 `ShipPrefabLibrary` - `/home/user/redux-tribes/archive-model/Scripts/Data/ShipPrefabLibrary.cs`
Serialized field: `TerranFaction: List<ShipPrefabData>` (only one faction list exists despite the name-keyed design). Lazily builds `Dictionary<ShipFaction, ShipFactionPrefabs>` → `Dictionary<ShipType, ShipVariants>` → `Dictionary<string, ShipPrefabData>` with accessor `GetShip(faction, shipType, shipVariant)`. **Latent bug:** `GenerateShipsForFaction` (lines 29 - 57) builds the local `shipFaction` structure but never executes `shipLibrary.Add(...)`, so `GetShip` would always throw `KeyNotFoundException`. It never crashes only because `GetShip` is called nowhere in the codebase - the whole library is effectively dead scaffolding (wired into `GameManager.shipPrefabLibrary` at `Scripts/GameManager.cs:58` and `MenuManager.CentralShipLibrary` but never queried).

#### 1.5 `FactionInfo` - `/home/user/redux-tribes/archive-model/Scripts/Data/FactionInfo.cs`
`[CreateAssetMenu(menuName = "ShipData/ShipFaction")]`. Fields: `shipFaction: ShipFaction`, `factionName: string`, `factionDesignation: string`, `factionIcon: Sprite`, `defaultShip: ShipCardData`, `allShips: ShipCardData[]`, `factionHologramMaterial: Material`, `primaryFactionColor: Color`, `secondaryFactionColor: Color`. Method `GetShip(string id)` does `allShips.FirstOrDefault(p => p.id == id)` - used by `Scripts/Campaign/FleetManager/ShipManagerUnit.cs:44` to rehydrate save-file `shipId` back into a card.

#### 1.6 `FactionInfoLibrary` - `/home/user/redux-tribes/archive-model/Scripts/Data/FactionInfoLibrary.cs`
`factionInfo: List<FactionInfo>` and `weaponIcons: List<WeaponIcon>`, each lazily indexed into dictionaries via `GetFactionInfo(ShipFaction)` and `GetWeaponInfo(WeaponIconType)` (throws on duplicates/missing - see §7).

#### 1.7 `MarineEfficiencyTable` - `/home/user/redux-tribes/archive-model/Scripts/Data/MarineEfficiencyTable.cs`
`marineEfficiencies: List<MarineEfficiency>` where `MarineEfficiency { int KillRatio = 3; float efficiency = .75f; }`. `GetMarineEfficenyValue(float shipHealthPercent)` (note typo) scans the list in order, taking the `KillRatio` of every row whose `efficiency` threshold ≥ current health percent (last matching row wins). Consumed by `Scripts/Simulator/ShipController.cs:463` as the defender kill-ratio in `DiceRoller.RollDiceForBoardingParty`.

#### 1.8 `WeaponIcon` - `/home/user/redux-tribes/archive-model/Scripts/Data/Icons/WeaponIcon.cs`
`weaponIconType: WeaponIconType`, `icon_u: Sprite` (unselected), `icon_s: Sprite` (selected), `WeaponName: string = "Default Weapon"`. Enum `WeaponIconType { Beam=1, Beam_Heavy=2, Railgun=3, Missile_light=4, Missile_heavy=5 }`. Also stamped on FX prefabs via `WeaponFXBasic.weaponType` (`Scripts/FX/WeaponFXBasic.cs:31`); `WeaponController.cs:94` branches on `weaponData.weaponFx.weaponType == WeaponIconType.Missile_light`.

#### 1.9 `SubsytemIcons` - `/home/user/redux-tribes/archive-model/Scripts/Data/SubsytemIcons.cs`
`assignedSprite: Sprite`, `subsystemType: SubsystemType`, `subsystemColor: Color`. `SubsystemType` (defined at `Scripts/UI/SubsystemHealthUI.cs:93`): `Armor=0, Shield=1, Weapon=2, Thrusters=3, LifeSupport=4, Generator=5, HeatExchange=6`. Wired as 7 named inspector fields on `SubsystemHealthUI` (lines 9 - 15).

#### 1.10 `ButtonColorProperties` - `/home/user/redux-tribes/archive-model/Scripts/Data/ButtonColorProperties.cs`
`unselectedColor: Color`, `selectedColor: Color`. Consumed by `Scripts/UI/SubsystemUI.cs:23`, `Scripts/UI/WeaponControllerUI.cs:20`, `Scripts/UI/MovementSelection.cs:18`, `Scripts/UI/V2/Navigation/NavButtons.cs:79`.

#### 1.11 `CustomLineProperties` - `/home/user/redux-tribes/archive-model/Scripts/Data/CustomLineProperties.cs`
The signature line-rendering style record, built on the third-party **Shapes** immediate-mode library (`/home/user/redux-tribes/archive-model/Shapes/`):

| Field | Type | Default |
|---|---|---|
| `color` | `Color` `[ColorUsage(true, true)]` | HDR-enabled (assets contain components > 1) |
| `thickness` | `float` | 0.1 |
| `lineGeometry` | `Shapes.LineGeometry` | `Billboard` (enum: `Flat2D=0, Billboard=1, Volumetric3D=2`) |
| `thicknessSpace` | `Shapes.ThicknessSpace` | `Pixels` (enum: `Meters=0, Pixels=1, Noots=2`) |
| `hasDash` | `bool` | false |
| `DashOffset`, `DashSize`, `DashSpacing`, `DashShape` | `float` | 1 each |

Methods `DrawNormal()`, `DrawDash()`, `DrawDots()` push these into the static `Shapes.Draw` state (`DashSnap = Tiling`, `DashSpace = Meters`). Consumers (all inspector-wired): `Scripts/Overlay/NavOverlay.cs` (mainLineProp, secondaryLineProp, attackLineProp, moveDisc, moveDis2, needMovementLine, elevationLine1/2), `Scripts/Overlay/ShipNavOverlay.cs`, `Scripts/Overlay/CircleLine.cs` (friendlyProps/enemyProps), `Scripts/FX/MissleFXOverlay.cs`, `Scripts/MissionScripting/MissionTypes/Waypoint.cs` (wayPointSphere/waypointMarkers), `Scripts/CampaignV2/SolarSystem.cs` (orbit/connection/border), `Scripts/CampaignV2/CampaignMapOverlay.cs` (navLineProperties).

#### 1.12 `WeaponSystemColorConfigs` - `/home/user/redux-tribes/archive-model/Scripts/Data/WeaponSystemColorConfigs.cs`
`radius: float = 2`, four `DiscColorsProp` blocks (`discColorsHorizontal`, `discColorsHorizontalPie`, `discColorsVertical`, `discColorsVerticalPie`), and `targettingLine: CustomLineProperties` (a ScriptableObject→ScriptableObject reference). `DiscColorsProp` (`Scripts/Overlay/WeaponOverlay.cs:181`): `innerStart/outerStart/innerEnd/outerEnd: Color` + `colorType: ColorType` where `ColorType { Angular=0, Bilinear=1, Flat=2, Radial=3 }` (`WeaponOverlay.cs:238`). Consumed by `WeaponOverlay.configs` (`WeaponOverlay.cs:23`) to render weapon firing-arc discs.

#### 1.13 Campaign data classes - `/home/user/redux-tribes/archive-model/Scripts/Data/CampaignData/`
- `FactionReputation` (`FactionReputation.cs`): `factionStatus: List<FactionStatus>`; `FactionStatus { [Range(-100,100)] int factionScore; ShipFaction shipFaction; }` with a `CopyFaction()` deep-copy (the asset is treated as immutable defaults; `Scripts/CampaignV2/CampaignMap.cs:106-109` copies rows into a runtime `Dictionary<ShipFaction, FactionStatus>`).
- `PlanetTypeDB` (`PlanetTypeDB.cs`): `planetItems: List<PlanetItemUI>` - **references to MonoBehaviour components on planet prefabs**, not plain data. `PlanetItemUI` (`Scripts/Campaign/Starmap/PlanetItemUI.cs`) carries `planetType: PlanetType`, `surfaceType: SurfaceType`, `atmosphereType: AtmosphereType`, `sprite`, `shipFaction`, `planetId`. Enums (same file): `PlanetType { ASTEROID=0, SUB_PLANET=1, SUB_EARTH=2, EARTH_SIZE=3, SUPER_EARTH=4, SUB_JUPITER=5, JUPITER=6, SUPER_JUPITER=7 }`, `SurfaceType { ROCKY, ICY, LAVA, WATER_WORLD, EARTH_LIKE, GAS, VOLCANIC }` (0 - 6), `AtmosphereType { NONE, HYDROGEN, OXYGEN_NITROGEN, METHANE, SULFURIC, CARBON, OTHER_GAS, UNKNOWN }` (0 - 7). Used by `Scripts/Campaign/Starmap/StarmapGenerator.cs:38` / `StarItemUI.cs:90-99` to pick 1 - 9 random planet templates per star (`Random.Range(1,10)`).
- `WarningPanelMessages` (`WarningPanelMessages.cs`): seven named `WarningMessage { WarningType warningType; string warning; }` fields, indexed by `GetWarning(WarningType)`; `WarningType { ENEMY_SHIP_CAPTURED=101, PLAYER_SHIP_DESTROYED=102, ESCORT_SHIP_DESTROYED=103, ESCAPE_TO_WAYPOINT=104, BLOCKADE_PREVENTING_TRANSIT=105, ENEMY_HAS_ENTERED_FRIENDLY_SYSTEM=106, FRIENDLY_SYSTEM_WAS_LOST=107 }`. Consumed via `CampaignMenu.warningPanelMessages` (`Scripts/Campaign/CampaignMenu.cs:56,103,113`).

#### 1.14 Editor support
`ReadOnlyAttribute.cs` (empty `PropertyAttribute`) + `Editor/ReadOnlyDrawer.cs` (`CustomPropertyDrawer` that disables GUI). Editor-only; drop in migration.

---

### 2. Weapon Stats - All Authored Values (`/home/user/redux-tribes/archive-model/Resources/WeaponConfig/`)

| Asset | damage | range | cooldown | weaponHealth | shots/round | id | weaponFx prefab | Referenced by |
|---|---|---|---|---|---|---|---|---|
| `BeamWeaponData.asset` | 5 | 300 | 0 | 10 | 3 | `4fa51271-f093-47ff-8a92-e6b83413348c` | `Prefabs/FX/Weapons/Weapon_Beam_FX.prefab` | `Prefabs/WeaponMounts/Weapon_Base_Cannon.prefab` |
| `BeamWeaponData_station.asset` | 1 | 300 | 0 | 10 | 3 | `b8a88422-d4d5-430d-a63e-162982b06e41` | Weapon_Beam_FX | `Scenes/Campaign_RogueLike/MissionTypes/Starbase_Assault.unity` |
| `LowPower-BeamWeaponData 1.asset` | 1 | 300 | 0 | 10 | 3 | `4fa51271-…` (**duplicate of BeamWeaponData**) | Weapon_Beam_FX | **nothing - orphan** |
| `Missile.asset` | 25 | 250 | 1 | 10 | 1 | **absent** (regenerates every load) | `Weapon_Missile_FX.prefab` | `Weapon_Missile_Launcher.prefab`, `Scenes/Demo/Mission3_Capture_sandbox_test.unity` |
| `Missile 1.asset` | 25 | 250 | 1 | 10 | 1 | `7c5d1b10-de70-4cdc-ab48-d6e7974d4ad3` | `Weapon_Missile_red_FX Variant.prefab` | `Scenes/Demo/NewDemos/MissileAlley.unity` |
| `Projectile_Cannon.asset` | 5 | 200 | 1 | 10 | 1 | `40be8932-1fec-41e2-8b97-1f85d7c0d30b` | `Weapon_Cannon_FX.prefab` | Cannon **and Pulse and Torpedo** mount prefabs |
| `Projectile_Plasma.asset` | 5 | 200 | 1 | 10 | 1 | `52cebe03-9693-4518-bf69-22c8099a30bc` | `Weapon_Plasma_FX.prefab` | `Benefactor_ship_1.prefab`, `Weapon_Projectlie_Plasma.prefab` |
| `Projectile_Pulse.asset` | 5 | 200 | 1 | 10 | 1 | `681cffc4-53e8-406a-8507-8ef1b8f7df78` | `Weapon_Pulse_FX.prefab` | **nothing - orphan** (Pulse mount uses Cannon data) |
| `Projectile_Torpedo.asset` | 5 | 200 | 1 | 10 | 1 | `15bf86e8-dafe-4277-97df-235db998117d` | `Weapon_Torpedo_FX.prefab` | **nothing - orphan** (Torpedo mount uses Cannon data) |

Balance takeaways for the design doc: beams are 0-cooldown (fire every turn), longest range (300); missiles are the alpha-strike weapon (25 dmg, cooldown 1, range 250); all projectile types are currently a single stat block (5/200/1) differentiated only by FX.

#### Weapon icons (`Resources/WeaponConfig/WeaponIcons/`, all sprites from `Textures/UI/small_icons.png`)

| Asset | weaponIconType | WeaponName | In FactionInfoLibrary? |
|---|---|---|---|
| `WeaponBeam.asset` | 1 (Beam) | "WeaponBeam" | yes |
| `WeaponBeamHeavy.asset` | 2 (Beam_Heavy) | "Weapon Beam Heavy" | yes |
| `WeaponProjectileCannon.asset` | 3 (Railgun) | "Cannon" | yes |
| `WeaponMissile.asset` | 4 (Missile_light) | "Missile" | yes |
| `WeaponProjectilePlasma.asset` | 3 | "Cannon" | **no - orphan, duplicate type** |
| `WeaponProjectilePulse.asset` | 3 | "Cannon" | **no - orphan, duplicate type** |
| `WeaponProjectileTorpedo.asset` | 3 | "Cannon" | **no - orphan, duplicate type** |

`Missile_heavy=5` has no icon asset at all. Adding any of the three orphans to the library would crash `GetWeaponInfo`'s `Dictionary.Add` (duplicate key 3).

---

### 3. Ship Cards - All Authored Values (`/home/user/redux-tribes/archive-model/Resources/ShipCards/`)

Colors as normalized RGBA. All cards: `shipRegistryNumber` empty, `maxCrew: 0`, `shipVariant: "A"`. (`maxMarines` present only on the three Neutral cards, value 0; absent on others - older serialization, deserializes as 0.)

| Asset | shipName | faction | type | selectedColor / factionColor | shipSpawner prefab | id |
|---|---|---|---|---|---|---|
| `Terran_Frigate_Ship_1_Card.asset` | TCS Invincible | 1 Terran | 4 LightFrigate | (0.392, 0.631, 0.761) | `Prefabs/Completed_Ships/Terran_ship_1.prefab` | `273afea6b5d096c4483882ef1f9395d7` ⚠ |
| `Terran_Freighter_Ship_1_Card.asset` | TCS Invincible | 1 | 4 | (0.392, 0.631, 0.761) | `Prefabs/Completed_Ships/Civillian/freighter_generic.prefab` | `273afea6…` ⚠ same |
| `Karisen_Frigate_Ship_1_Card.asset` | IKS Scion | 2 Karisen | 4 | (0.643, 0.200, 0.200) | `Prefabs/Completed_Ships/Karisen_ship_1.prefab` | `76472f33d615d154996a3fce2d073654` |
| `Benefacto_Frigate_Ship_1_Card.asset` | BNS Fluantei | 4 Benefactors | 4 | (0.627, 0.251, 0.545) | `Prefabs/Completed_Ships/Benefactor_ship_1.prefab` | `e7405e4ea3fe1c3408f28742260222a4` |
| `Rogue_Frigate_Ship_1_Card.asset` | BNS Fluantei (copy-paste) | 8 Rogue | 4 | sel (0, 0.396, 0.333) / factionColor (0.165, 0.518, 0.302) | `Prefabs/Completed_Ships/Rogue_Ship_1.prefab` | `bd8505e0f1331cd4ca47c3f1d8d46d01` |
| `Neutral_Satilite_1_Card.asset` | Satilite | 0 None | 26 Satellite | sel (1, 0.689, 0) / factionColor (1, 0.602, 0) | `Civillian/Neutral_Shipyard.prefab` (⚠ shared) | `da2299a8322a4b43aa107f29137ea3d2` ⚠ |
| `Neutral_Sshipyard_1_Card.asset` | Shipyard | 0 | 25 Shipyard | (0.392, 0.631, 0.761) | `Civillian/Neutral_Shipyard.prefab` | `da2299a8…` ⚠ same |
| `Neutral_Starbase_1_Card.asset` | Station X | 1 Terran | 24 Station | (0.392, 0.631, 0.761) | **`{fileID: 0}` - null** | `273afea6…` ⚠ same as Terran cards |

Mission 3 spawn deck - `Resources/ShipCards/Mission3_ship_Spawns/` (all faction 2 Karisen, type 4, sprite `Textures/UI/ship_2_schematic.png`, spawner `Karisen_ship_1.prefab`, **no `id` field at all**, referenced by `Scenes/Demo/Mission3_Capture.unity` and `Mission3_Capture_sandbox_test.unity`):

| Asset | shipName |
|---|---|
| `Karisen_Ship_1_Card 5.asset` | IKS Putrak |
| `Ship_2_Card 1.asset` | IKS Nevra |
| `Ship_2_Card 2.asset` | IKS Alemno |
| `Ship_2_Card 3.asset` | IKS Putrak |
| `Ship_2_Card 4.asset` | IKS Putrak |

The `id` corruption pattern (verified by GUID reverse-lookup): `273afea6…` is literally the GUID of `ShipCardData.cs` itself; `e7405e4e…`, `76472f33…`, `bd8505e0…` are the GUIDs of each card's own schematic PNG. The author pasted asset GUIDs by hand rather than generating unique ids. Consequences in §7.

Highlight/unselected colors (for the design doc's card palette): Terran family highlight (0.458, 0.785, 0.962)/unselected (0.184, 0.282, 0.361); Karisen highlight (0.821, 0.290, 0.290)/unselected (0.263, 0.133, 0.204); Benefactor highlight (0.811, 0.325, 0.705)/unselected (0.259, 0.169, 0.322); Rogue highlight (0.612, 0.898, 0.310)/unselected (0.137, 0.259, 0.275); Neutral-yellow highlight (1, 0.937, 0)/unselected (0.361, 0.303, 0.184).

---

### 4. Ship Prefab Data and Libraries

`/home/user/redux-tribes/archive-model/Resources/ShipPrefabs/Terran_Frigate_A.asset`: faction 1, type 4, variant A → prefab = `Models/ship_1.fbx` (the FBX root, not a Completed_Ships prefab). `Karisen_Frigate_A.asset`: faction 2, type 4, variant A → `Models/ship_2.fbx`. Both are stale - they point at raw model files, while the real gameplay prefabs live in `Prefabs/Completed_Ships/`.

`/home/user/redux-tribes/archive-model/Resources/ShipPrefabLibrary.asset` lists exactly these two under `TerranFaction` (including the Karisen one - the single-list design ignores faction). Wired into `Prefabs/[GameManager]-v2.prefab`, `Prefabs/UI/v2/[GameManager]-v2.prefab`, `Prefabs/GameSetup/[GameManager].prefab`, `Scenes/Demo/Mission_Selection.unity`, and to `MenuManager.CentralShipLibrary` (static, set in `Awake`, `Scripts/Menu/MenuManager.cs:27`) - but per §1.4 never actually queried. **Recommendation: do not migrate this subsystem; the ship-card `shipSpawner` reference is the live spawning path (`Scripts/MissionScripting/GameEvents/EnemyShipSpawner.cs:21` calls `Instantiate(s.shipSpawner, …)`).**

---

### 5. Factions (`/home/user/redux-tribes/archive-model/Resources/FactionData/`)

Fully authored ("ImplementedFactions/", with ships, materials, colors):

| Asset | enum | factionName | designation | primary color (hex approx) | secondary (hex) | defaultShip / allShips | hologram material |
|---|---|---|---|---|---|---|---|
| `ImplementedFactions/Terran.asset` | 1 | Terran Commonwealth | TCNS | (0, 0.584, 0.914) ≈ #0095E9 | (0.071, 0.306, 0.537) ≈ #124E89 | Terran_Frigate card | `Materials/Campaign_Map_v2/Factions/Terran_faction.mat` |
| `ImplementedFactions/Karisen.asset` | 2 | Karisen Empire | IKS | (0.980, 0.416, 0.039) ≈ #FA6A0A | (0.451, 0.090, 0.176) ≈ #73172D | Karisen_Frigate card | Karisen_faction.mat |
| `ImplementedFactions/Benefactors.asset` | 4 | Benefactors | BNS | (0.286, 0.255, 0.510) ≈ #494182 | (0.094, 0.078, 0.145) ≈ #181425 | Benefacto_Frigate card | Benfactors_faction.mat |
| `ImplementedFactions/Rogue.asset` | 8 | "Rouge" (typo) | RIS | (0.102, 0.478, 0.243) ≈ #1A7A3E | (0.976, 0.639, 0.106) ≈ #F9A31B | Rogue_Frigate card | Rogue_faction.mat |
| `ImplementedFactions/None.asset` | 0 | None | NONE | #FFFFFF | (0.311×3) ≈ #4F4F4F | Rogue_Frigate card (placeholder) | none_faction.mat |

Stub factions (`Faction/` root - only name/designation/icon serialized; defaultShip/allShips/material/colors absent, so they deserialize null/black):

| Asset | enum | name | designation |
|---|---|---|---|
| `Faction/Council.asset` | 3 | Council | UGCA |
| `Faction/Rebels.asset` | 5 | Rebels | NGRS |
| `Faction/Cultists.asset` | 6 | Cultists | FMIC |
| `Faction/Plague.asset` | 7 | Plague | EPSS |

`/home/user/redux-tribes/archive-model/Resources/FactionData/FactionInfoLibrary.asset` lists all 9 (order: Terran, Karisen, Benefactors, Council, Cultists, Plague, Rebels, Rogue, None) plus the 4 non-duplicate weapon icons. Wired to the three [GameManager] prefabs, `Scenes/Campaign_RogueLike/Campaign_Map_v2.unity`, and `MenuManager.FactionInfoLibrary` static. Runtime lookups: `Scripts/UI/BoardingPartyUI.cs:23`, `Scripts/UI/V2/ShipInfo/ShipInfo.cs:36`, `Scripts/CampaignV2/Celestial.cs:204`, `Scripts/CampaignV2/CampaignMap.cs:236`, `Scripts/Campaign/GameSetup/EncounterMissionLoader.cs:89,147`, `Scripts/Campaign/Starmap/ReputationWidget.cs:18`, `Scripts/Campaign/FleetManager/ShipManagerUnit.cs:43`.

#### MarineEfficiencyTable - `/home/user/redux-tribes/archive-model/Resources/FactionData/MarineEfficiencyTable.asset`
The complete boarding-defense curve (defender kill-ratio by defending ship's hull %):

| ship health ≤ | KillRatio (kills per success) |
|---|---|
| (above 0.75) | 2 (first row default) |
| 0.75 | 2 |
| 0.50 | 1 |
| 0.35 | 0 |
| 0.10 | 0 |

(Code defaults in `MarineEfficiency` are `KillRatio=3, efficiency=.75`; the authored table caps at 2.) Referenced by every completed-ship prefab (`Karisen_ship_1.prefab`, `Terran_ship_1.prefab`, `Civillian/Satellite.prefab`, `Civillian/freighter_generic.prefab`, etc.) via `ShipController.marineEfficiencyTable` - a shared-asset-as-global-constant pattern.

---

### 6. Campaign, UI, and Line-Styling Values

#### FactionRep defaults - `/home/user/redux-tribes/archive-model/Resources/CampaignData/FactionRep.asset`
Starting reputation (range −100..100): Terran (1) = **100**, Karisen (2) = **−46**, Rogue (8) = **−14**, Benefactors (4) = **12**. No rows for factions 0/3/5/6/7. Copied into runtime state at `Scripts/CampaignV2/CampaignMap.cs:106` and `Scripts/Campaign/CampaignMenu.cs:98`; persisted as `ReputationSave[]` in `CampaignSaveFile` (`Scripts/Campaign/Utilities/CampaignSaveSystem.cs:127-130`).

#### PlanetDB - `/home/user/redux-tribes/archive-model/Resources/CampaignData/PlanetDB.asset`
12 `PlanetItemUI` component references (type 3 = prefab objects): `Prefabs/CampaignUI/Navigation/Planets/Asteroid_a - d Variant.prefab`, `Planet_a.prefab`, `Planet_b - h Variant.prefab`. Referenced by `Campaign_Map_v2.unity` plus two scenes in `Scenes/Campaign_RogueLike/garbage/`. The planet-type/surface/atmosphere enums per template live inside those prefabs, not in the DB asset.

#### WarningPanelMessages - `/home/user/redux-tribes/archive-model/Resources/CampaignData/WarningPanelMessages.asset`
Exact authored strings (typos included): 101 "Enemy ship was captured." · 102 "One of your ships was destroyed." · 103 "A ship you are escorting has been destroyed." · 104 "Escape to the designated waypoint." · 105 "Enemy blockade preventing transit. You must initiate combat." · 106 "Alert! Enemy ships have entered a friendly sysytem." · 107 "Allied ship was destroyed." (note 107's text does not match its FRIENDLY_SYSTEM_WAS_LOST semantic).

#### Subsystem icon colors - `/home/user/redux-tribes/archive-model/Resources/UISettings/` (all sprites from `Textures/UI/subsystem_icons.png`)

| Asset | subsystemType | subsystemColor |
|---|---|---|
| `SubsytemIcons_armor.asset` | 0 Armor | (0, 0.905, 1) cyan |
| `SubsytemIcons_shield.asset` | 1 Shield | (0, 0.022, 1) blue |
| `SubsytemIcons_weapon.asset` | 2 Weapon | (1, 0.165, 0) red-orange |
| `SubsytemIcons_thruster.asset` | 3 Thrusters | (1, 0.754, 0) amber |
| `SubsytemIcons_lifesupport.asset` | 4 LifeSupport | (0, 1, 0.073) green |
| `SubsytemIcons_generator.asset` | 5 Generator | (0.383, 0, 1) violet |
| `SubsytemIcons_heat_exchanger.asset` | 6 HeatExchange | (1, 0, 0.694) magenta |

#### Button colors - `/home/user/redux-tribes/archive-model/Resources/UI/`
`MovementButttons.asset`: unselected (0, 0.367, 0.491) teal / selected (0.538, 0.170, 0.170) dark red. `SubsystemTargetButtonColorProperties.asset`: unselected (0.180, 0.392, 0.416) / selected (0.708, 0.497, 0) gold. `WeaponsQueuedButtonColorProperties.asset`: unselected (0, 0.161, 0.565) navy / selected (0.868, 0, 0) red.

#### Line styling - `/home/user/redux-tribes/archive-model/Resources/LineStyling/` (the game's signature look)
Format: color RGBA (HDR-capable) · thickness · geometry (F=Flat2D, B=Billboard, V=Volumetric3D) · space (m=Meters, px=Pixels) · dash.

Tactical layer (root + `MovementEst/` + `FriendFoeLines/` + `Waypoints/`):

| Asset | color (r,g,b,a) | thick | geo/space | dash |
|---|---|---|---|---|
| `AttackLineProp.asset` (targeting line, referenced from WeaponSystemColors) | (1, 0, 0.052, 0.804) | 4 | B/px | yes (offset 1, size 1, spacing 1, shape 1) |
| `AttackLineProp_weapon.asset` | (1, 0.146, 0, 0.420) | 3 | B/px | yes |
| `RotationMainLineProp.asset` | (0.821, 0.821, 0.821, 1) grey | 4 | B/px | no |
| `RotationCursorMainLineProp.asset` | (0.462, 0, 0.209, 0.318) | 4 | B/px | no |
| `MovementEst/MainLineProp.asset` (committed move) | (0, 1, 0.086, 0.804) green | 1 | B/px | no |
| `MovementEst/MainLineProp_player_est.asset` | (0, 0.309, 0.604, 0.804) blue | 5 | B/px | dash size 0.5, offset 0 |
| `MovementEst/MainLineProp_enemy_est.asset` | (1, 0.245, 0, 0.804) orange | 2 | B/px | dash size 0.12, offset 0 |
| `MovementEst/SecondaryLineProp.asset` | (0, 0.102, 1, 0.675) | 1 | B/px | dash offset 2, size 2 |
| `MovementEst/MoveDisc/MoveDisc1.asset` | (0, 0, 0, 0.071) shadow | 1 | B/px | no |
| `MovementEst/MoveDisc/MoveDisc2.asset` | (0, 0.264, 0.024, 0.510) | 1 | B/px | no |
| `MovementEst/MoveDisc/BoldDirectionalLine.asset` | **(0, 1.498, 0.129, 1) HDR green** | 1 | B/px | no |
| `MovementEst/MoveDisc/ElevationLine1.asset` | **(1.611, 2, 0, 0.804) HDR yellow** | 1 | B/px | no |
| `MovementEst/MoveDisc/ElevationLine2.asset` | (0.472, 0.216, 0, 0.518) | 1 | B/px | no |
| `FriendFoeLines/Friend_MainLineProp 1.asset` | (0, 0.309, 0.604, 0.804) blue | 1 | B/px | no |
| `FriendFoeLines/Foe_MainLineProp.asset` | (0.604, 0.011, 0, 0.804) red | 0.5 | B/px | no |
| `Waypoints/WaypointMarker.asset` | (0, 0.528, 0.047, 1) | 4 | B/px | no |
| `Waypoints/WaypointSphere.asset` | (0, 0.264, 0.024, 0.114) | 1 | B/px | no |
| `Waypoints/Waypoint2/WaypointMarker 1.asset` | (0, 0.528, 0.047, 0.482) | 4 | B/px | no |
| `Waypoints/Waypoint2/WaypointSphere 1.asset` | (0, 0.264, 0.024, 0.027) | 1 | B/px | no |

Campaign map layer (`Campaign_v2/`, referenced by `Prefabs/Campaign_v2/Star_1.prefab` and `Scenes/Campaign_RogueLike/Campaign_Map_v2.unity`):

| Asset | color | thick | geo/space | dash |
|---|---|---|---|---|
| `Connection_line_prop.asset` (star lanes) | (0, 0.646, 0.831, 0.475) cyan | 0.25 | **V/m** | no |
| `Orbit_line_Prop.asset` | (0.831, 0.387, 0, 0.412) orange | 0.25 | V/m | no |
| `SystemBorder_prop.asset` | (1, 0.627, 0, 0.412) | 0.3 | V/m | no |
| `Ship_Move_Line.asset` | (0.009, 0.660, 0, 0.475) green | 10 | B/px | dash size 2, spacing 0.5, offset 0 |

Note the deliberate split: tactical lines are Billboard/Pixels (constant screen width), campaign lines are Volumetric3D/Meters (world-scaled).

#### WeaponSystemColors - `/home/user/redux-tribes/archive-model/Resources/LineStyling/WeaponSystemColors.asset`
`radius: 2`. Firing-arc discs: `discColorsHorizontal` colorType 3 (Radial), innerStart transparent → outerStart (0.537, 0.141, 0, 0.169); `discColorsHorizontalPie` colorType 2 (Flat), innerStart (0.812, 0.078, 0.078, 0.349) red; `discColorsVertical` Radial, outerStart (0.055, 0.255, 0, 0.376) green; `discColorsVerticalPie` Flat, innerStart (0, 0.388, 0.090, 0.384). `targettingLine` → `AttackLineProp.asset` by GUID `c18b7c74d948363489184954e1c18faa` - the only SO→SO reference in the LineStyling set.

---

### 7. Reference Graph, Wiring Patterns, and What Breaks in Migration

Wiring patterns actually used (in order of prevalence):
1. **Inspector references from scenes/prefabs to Resources assets** - the dominant pattern. Nothing except `CampaignSaveSystem.cs:61` uses `Resources.Load*` (verified by grep: single hit in all of Scripts/), and even that call (`Resources.LoadAll<ShipCardData>("")` inside `FindScriptableObjectById`) is dead code whose loop body is commented out. The Resources/ folder placement is vestigial discipline, not a runtime discovery mechanism.
2. **Static singleton promotion**: `MenuManager.Awake` (`Scripts/Menu/MenuManager.cs:25-29`) copies inspector-assigned `ShipPrefabLibrary`/`FactionInfoLibrary` into `public static` fields; `GameManager`, `CampaignMenu`, `CampaignMap` similarly expose their inspector-wired assets via `Instance` singletons.
3. **Asset→prefab component references** (Unity `{fileID, guid, type: 3}`): `ShipCardData.shipSpawner` → `ShipController` component in a `.prefab`; `WeaponData.weaponFx` → `WeaponFXBasic` component in an FX prefab; `PlanetTypeDB.planetItems` → `PlanetItemUI` components in planet prefabs. **These are the references that do not survive migration** - they name a component instance inside a Unity prefab file by internal fileID.
4. **Asset→asset references** (`type: 2`): FactionInfoLibrary → FactionInfo → ShipCardData; ShipPrefabLibrary → ShipPrefabData; WeaponSystemColors → AttackLineProp. These map cleanly to key-based references.
5. **Circular asset↔prefab loop**: ship card → ship prefab (`shipSpawner`) while the prefab's `ShipController.shipCardData` (`Scripts/Simulator/ShipController.cs:223`) points back at the card. In Rust this should become a one-directional lookup (entity spawned from a `ship_class` record; no back-pointer).
6. **String-GUID ids as save-file keys**: `ShipCardData.id` (via `ShipSave.shipId`, `GenerateShipDataBlock.cs:62,116`, rehydrated by `FactionInfo.GetShip(id)`) and `WeaponData.id` (via `GetCustomShipWeaponId` composite). This is the *intended* stable-key system and the right seam for migration - but the authored values are broken (below).

Data-integrity defects found in the authored ids:
- Three cards share `id = 273afea6b5d096c4483882ef1f9395d7` (`Terran_Frigate_Ship_1_Card.asset`, `Terran_Freighter_Ship_1_Card.asset`, `Neutral_Starbase_1_Card.asset`) - and that value is the GUID of `Scripts/Data/ShipCardData.cs` itself.
- `Neutral_Satilite_1_Card.asset` and `Neutral_Sshipyard_1_Card.asset` share `id = da2299a8322a4b43aa107f29137ea3d2`.
- All five `Mission3_ship_Spawns/*.asset` cards and `WeaponConfig/Missile.asset` have **no serialized `id`** - the C# field initializer (`Guid.NewGuid()`) regenerates a different id on every load, so any save referencing them breaks across sessions.
- `LowPower-BeamWeaponData 1.asset` duplicates `BeamWeaponData.asset`'s id (`4fa51271-…`).
- `FactionInfo.GetShip` uses `FirstOrDefault`, silently returning the wrong card on collision.

---

### 8. Migration Recommendations (Rust engine)

**Data format.** Replace every ScriptableObject with plain data files loaded via serde - RON is the best fit (comments, enums-as-names, trailing commas); JSON works equally if tooling prefers it. One file per record type collection, mirroring the schemas in §1:

```ron
// weapons.ron
WeaponDef(
    id: "4fa51271-f093-47ff-8a92-e6b83413348c",  // keep existing GUIDs verbatim
    name: "Beam",
    damage: 5.0, range: 300.0, cooldown_turns: 0,
    weapon_health: 10.0, shots_per_round: 3,
    fx: "beam_fx",                                // string key, not prefab fileID
    icon: BeamLight,                              // WeaponIconType by name
)
```

Suggested Rust-side types: `WeaponDef`, `ShipClassDef` (merging `ShipCardData` + `ShipPrefabData` + the prefab's subsystem loadout, since the split only existed to serve Unity's prefab system), `FactionDef`, `MarineEfficiencyCurve(Vec<(f32 /*hp_threshold*/, u32 /*kill_ratio*/)>)`, `PlanetTemplate` (fold the `PlanetItemUI` MonoBehaviour data - planetType/surfaceType/atmosphereType/sprite - into pure data; `PlanetTypeDB` becomes just the template list), `WarningMessages(HashMap<WarningType, String>)`, `ReputationDefaults(Vec<(FactionId, i8)>)` with the −100..=100 range as a validated newtype, `LineStyle` and `DiscStyle` for §6. Model the enums with `#[serde(rename_all = ...)]` string names, not the Unity integers - the integer values in §1 are only needed once, in the conversion script.

**Stable keys.** Keep the existing GUID strings as ids where they are already unique (all WeaponData ids except the two defects; Karisen/Benefactor/Rogue card ids), because campaign save files (`campaign_1.json`, written by `CampaignSaveSystem`) embed them in `shipId` and `CustomShipWeaponId`. But first repair the corruption in §7: assign fresh unique ids to the three `273afea6…` cards, the two `da2299a8…` cards, the five Mission3 cards, `Missile.asset`, and `LowPower-BeamWeaponData 1.asset`. Since the old ids were unstable/duplicated anyway, old saves are already unreliable - a clean id regeneration for *ship cards* with human-readable slugs (`"terran_frigate_a"`) is defensible; the composite weapon-save key format `"{ship}-W-{weapon}-I-{index}"` is worth keeping as the per-weapon persistence scheme.

**Reference rewiring.** Convert every `{fileID, guid, type:3}` prefab-component reference to a string key resolved by the new engine's asset registry: `shipSpawner` → `ship_class` scene-spawn key; `weaponFx` → FX id; `planetItems` → planet-template ids; sprite references (`shipSprite`, `factionIcon`, `icon_u/icon_s`, `assignedSprite`) → texture-atlas keys (note `small_icons.png` and `subsystem_icons.png` are multi-sprite atlases addressed by sub-asset fileID - the converter must map fileIDs to sprite names from the `.png.meta` importer data). `factionHologramMaterial` → material/shader key.

**Do not migrate (dead data / dead systems):**
- `ShipPrefabLibrary` + both `ShipPrefabs/*.asset` (never-queried, buggy, points at raw FBX roots - §4).
- `LowPower-BeamWeaponData 1.asset`, `Projectile_Pulse.asset`, `Projectile_Torpedo.asset` (zero references; Pulse/Torpedo mounts actually use Cannon's data - either delete, or promote to real distinct stats intentionally).
- `WeaponIcons/WeaponProjectilePlasma|Pulse|Torpedo.asset` (unreferenced duplicates of icon type 3).
- `WeaponData.shotCountPerRound` (never read).
- The five `Mission3_ship_Spawns` numbered card copies exist only to give unique `shipName`s to identical stat blocks - replace with a mission spawn-list format of `(ship_class, count | name_list)`.
- `Missile 1.asset` is *not* dead (it backs `Scenes/Demo/NewDemos/MissileAlley.unity` with a distinct red-missile FX) - rename to something meaningful (`missile_red`) during conversion.
- Editor-only: `ReadOnlyAttribute.cs` / `Editor/ReadOnlyDrawer.cs`.
- The `garbage/` scenes referencing PlanetDB/FactionRep/WarningPanelMessages confirm those assets' consumers; migrate the assets, skip those scenes.

**Conversion tooling.** The `.asset` files are trivially machine-readable YAML with a fixed prelude; a one-shot converter needs: (1) the GUID→path map from `.meta` files (as built in this analysis), (2) the enum integer→name tables in §1, (3) fileID→sprite-name maps from texture `.meta` importers. Emit RON per schema, validate with serde into the new types, and assert id uniqueness at load - the single check that would have caught every defect listed in §7.