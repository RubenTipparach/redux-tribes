# Shader & Rendering Catalog - Fallen Tribes (Unity archive analysis)

> Reference appendix to [`../DESIGN.md`](../DESIGN.md) §10. Full decoding of the URP pipeline configuration, every custom shader/shader graph (node techniques and exposed parameters, including the per-planet material parameter tables), post-processing profiles, and particle systems, reconstructed directly from the YAML/JSON assets under `archive-model/`. This is the source-of-truth companion for the WGSL shader ports planned in [`../ARCHITECTURE.md`](../ARCHITECTURE.md) ADR-7.

### Scope and method

This report covers rendering, shaders, VFX, post-processing, and pipeline configuration of "Fallen Tribes" (Unity 2022.3, URP 14), reconstructed by direct inspection of YAML assets, ShaderGraph JSON, HLSL sources, materials, prefabs, and scenes under `/home/user/redux-tribes/archive-model`. All numeric values below were read from the files cited, not inferred.

---

### 1. URP pipeline configuration - `Settings/URP-HighFidelity.asset`

The single quality tier actually shipped (a `Settings/crap/` folder holds abandoned `URP-Balanced` and `URP-Performant` variants). Key settings:

**General**
- Forward renderer (`m_RenderingMode: 0`), SRP batcher on, dynamic batching off, depth texture required (`m_RequireDepthTexture: 1`), opaque texture off.
- HDR enabled (`m_SupportsHDR: 1`) with 32-bit color buffer precision (`m_HDRColorBufferPrecision: 0` = R11G11B10). **MSAA disabled** (`m_MSAA: 1` = 1x). Render scale 1.0, upscaling filter = Point (`m_UpscalingFilter: 2`).
- LOD cross-fade enabled with blue-noise dithering (`m_LODCrossFadeDitheringType: 1`); dither textures wired in (`blueNoise64LTex`, `bayerMatrixTex`).
- Color grading mode LDR (`m_ColorGradingMode: 0`), LUT size 16.
- Data-driven lens flare support on (`m_SupportDataDrivenLensFlare: 1`).

**Shadows (critical for the migration - owner wants unlimited-distance cascades in Rust)**
- Main light: per-pixel (`m_MainLightRenderingMode: 1`), shadows on, **shadowmap resolution 4096**.
- **Shadow distance 2000** world units (the battle camera far plane is 9000 - shadows already cut off well inside the visible range, which is presumably why "unlimited distance" is a new-engine requirement).
- **Cascade count 3**, `m_Cascade3Split: {x: 0.15, y: 0.3}` → cascade ranges 0 - 300 m, 300 - 600 m, 600 - 2000 m; cascade border 0.1.
- Depth bias 1, normal bias 0.01.
- **Soft shadows enabled** (`m_SoftShadowsSupported: 1`), `m_SoftShadowQuality: 2` (Medium PCF).
- Additional lights: per-pixel, limit 8 per object, additional-light shadows on, atlas 4096 (tiers 128/256/512), light cookies supported, cookie atlas 4096.
- Transparent objects receive shadows in the main renderer (`m_ShadowTransparentReceive: 1` in `URP-HighFidelity-Renderer.asset`).
- A `ScreenSpaceShadows` renderer feature is active (resolves the cascade shadowmap into a full-screen shadow texture before opaques).

**Scene light** (`Scenes/Campaign_RogueLike/MissionTypes/Skirmish.unity`, GameObject "Directional Light"): one realtime directional sun, white, intensity 1, **soft shadows** (`m_Shadows.m_Type: 2`), strength 1, bias 0.05, normal bias 0.4, color temperature 5000 K (`m_UseColorTemperature: 1`). The scene contains exactly one Light - everything else luminous is emissive-material + bloom or fake "proxy light" decals (§3.9).

**Scene environment** (same file, `RenderSettings`): fog off; ambient mode Skybox with tri-color fallback (sky 0.212/0.227/0.259, equator 0.114/0.125/0.133, ground 0.047/0.043/0.035); skybox material = `Materials/SpaceBackgrounds/space_mission_4.mat` (procedural space skybox, §3.4); reflection from skybox at 128 res, 1 bounce.

**Camera** (`Prefabs/[GameManager]-v2.prefab`): perspective FOV 45, near 0.3, **far 9000**, post-processing enabled, anti-aliasing **none** (`m_Antialiasing: 0`), HDR allowed, volume layer mask = Default.

### 2. Renderer features - `Settings/URP-HighFidelity-Renderer.asset`

Active features in `m_RendererFeatures` order:

1. **SSAO** - method 1 (Blue Noise), source Depth (`Source: 1`), intensity 0.5, radius 0.25, falloff 100, direct lighting strength 0.25, no downsample, blur quality high (`BlurQuality: 0`), 7 blue-noise-256 textures.
2. **ShapesRenderFeature** - render hook for Freya Holmér's *Shapes* immediate-mode vector library (`Shapes/Scripts/Runtime/Immediate Mode/ShapesRenderFeature.cs`). This draws all tactical overlays: `Scripts/Overlay/NavOverlay.cs`, `WeaponOverlay.cs`, `ShipNavOverlay.cs`, `CircleLine.cs`, `NavPlane.cs`, `Scripts/UI/V2/ShipShapesOverlayCanvas.cs`, `SubsystemInfoOverlay.cs`, `WeaponInfoOverlay.cs`. Calls used across those scripts: `Draw.Line` (11×), `Draw.Ring` (6×), `Draw.LineGeometry`, `Draw.Polyline`, `Draw.Arc`, `Draw.Disc`, `Draw.Pie`, `Draw.UseDashes`/`Draw.DashOffset`, `Draw.Thickness`/`ThicknessSpace`. `NavPlane.cs` draws a snapping dot-grid movement plane (defaults: `dotCount 1000`, `gridSpacing 1`, `fadeDistance 10`, `dotSize 0.05`) plus elevation rings - the new engine needs an anti-aliased 3D vector-primitive immediate-mode drawing layer to reproduce this.
3. **ScreenSpaceShadows** (see §1).
4. **FullScreenPassRendererFeature** - *disabled*; pass material `Shaders/DitheredMaterialBase.mat` (the retro dither post effect, §3.7), injection point 600 (AfterRenderingPostProcessing).
5. **DecalRendererFeature** - technique Automatic, max draw distance 1000, DBuffer surfaceData 2. Required by the decal-based proxy lights (§3.9).
6. **"Ship Nav Overlay"** RenderObjects pass - *disabled*; would re-render layer bit 128 (layer 7, "Nav") at event 1000 with the Hologram shader/material as override, depth compare GreaterEqual (x-ray behind-geometry ghost draw).
7. **OutlineMeshesInLayerFeature #1** - active, **selection outline**: color `{r:1, g:0.108, b:0}` (orange-red, HDR), pixel width 10, layer bit **512** (layer 9 = `Outline_1`), event 400 (AfterRenderingSkybox), `useSeperableAxisMethod: 1`.
8. **OutlineMeshesInLayerFeature #2** - active, **hover outline**: color `{r:1, g:0.972, b:0}` (yellow), width 10, layer bit **1024** (layer 10 = `Outline_Hover`), event 400.
9. **VolumetricFogFeature** - active; third-party (script GUID `175cea8de38556cbf9c2f04c6a06d29f`, data asset `cea71fd1...` - **package not present in the archived Assets folder**; settings: resolution 0 = full, temporal rendering off, `disableBlur: 1`, composited after transparents).
10. **RenderObjects** ("RenderObjects", event 300) - no layer mask, no override; effectively a no-op placeholder.
11. **FullScreenFogRendererFeature** - active; third-party full-screen analytic fog (script GUID `7a8a626e...`, also not in Assets), injection point 350 (BeforeRenderingSkybox), driven by the `FullScreenFog` volume component in the `city_planet*` profiles (§4).

Orphaned blocks in the same file (defined but not in the feature list): **ScreenSpaceOutlines** (Roberts-cross depth/normal edge detection - outline color cyan `{0, 0.8213, 1}`, outlineScale 2, depthThreshold 10, robertsCrossMultiplier 100, normalThreshold 0.4, steepAngleThreshold 0.2/multiplier 25, layer bit 512), an `OutlineFeature` (disabled, color `{0.033, 0.275, 1, 0.34}`, width 5, event 550), and a disabled `VolumetricFogRendererFeatureLite`.

`Settings/URP-VolumetricFogLite-Renderer.asset` is a second renderer with a single active `VolumetricFogRendererFeatureLite` (fog downsample level 4, event 500, explicit fog/depth/composite materials, texture names `_ColourTexture`/`_FogTexture`/`_DepthTexture`); no camera prefab selects it (`m_RendererIndex: -1` everywhere), so it appears to be a runtime-switchable or vestigial path.

**Selection flow**: `Scripts/CampaignV2/SelectionManager.cs` (and `Scripts/NavMove.cs`) implement highlighting purely by swapping `GameObject.layer` - constants `Layer_Selected = "Outline_1"`, `Layer_Hover = "Outline_Hover"`, restore to `"Default"` - and the two jump-flood outline features pick the layers up.

### 3. Shader effects catalog

#### 3.1 Procedural planets - `Shaders/planet/planet_gen.shadergraph`
Lit, opaque, specular workflow (`UniversalLitSubTarget`, `m_WorkflowMode: 1`), casts shadows, **does not receive shadows**. Fully procedural sphere shading + **vertex displacement** (writes `VertexDescription.Position`). Mechanism (from node graph: 5 SubGraph nodes - 4× `FractalNoise`, 1× `Simplex noise 3D` - plus `NormalFromHeightNode`, `FresnelNode`, `RotateAboutAxisNode`, `TimeNode`, `ColorMaskNode`×4, `BlendNode`×2, `SmoothstepNode`, gradient sampling):
- Object-space position feeds fBm fractal noise at two scales - properties `planet_shape_low_frq` (Vector3) and `planet_shape_high_frq` (Vector3) - for continent shapes and surface detail; the same height field drives both vertex displacement and `NormalFromHeight` normal detail scaled by `normal_str` (0.002 in all planet materials).
- **Land coloring**: height/noise value remapped through one of five 8-key `Gradient` properties (`green_land_gradient`, `desert_land_gradient`, `ice_land_gradient`, `moon_land_gradient`, `yellow_land_gradient`), selected by enum **keyword `land_color_type`** with entries `greenland / desertland / iceland / moonland / yellowland`; `land_color_variation` jitters the gradient lookup, `land_amount` + `land_offset` bias land vs. sea.
- **Water**: smoothstep between deep color `water` and `water_shallow` (Colors) controlled by `water_amount` (sea level) and `water_blend` (shore blend sharpness).
- **Polar caps**: `north_pole` / `south_pole` scalar thresholds on the position Y axis blend to white.
- **Clouds**: 3D simplex noise rotated over time (`RotateAboutAxis` + `TimeNode`) with `clouds_speed` (0.01), coverage threshold `cloud_cover`, opacity `cloud_opacity`.
- **Atmosphere rim**: Fresnel with power `fr_power` and color `fr_color` added as emission-like rim.
- Other exposed props: `smoothness`.

**Per-planet-type material overrides** (`Shaders/planet/*.mat`, duplicated in `Materials/Planets/`), all with keyword + numeric overrides read from the files:
| material | keyword | land_amount | land_offset | water_amount | cloud_cover/opacity | shape low_frq | shape high_frq | fr_color |
|---|---|---|---|---|---|---|---|---|
| green_planet | GREENLAND | 1.61 | -0.4 | 0.23 | -1.37 / 1 | (4.49,0,0) | (0.96,0,0) | (0.454,0.643,0.972) |
| desert_planet | DESERTLAND | 1.74 | 0.05 | 0.06 | -1.74 / 1 | (10,10,5) | (100.22,0,0) | (0.585,0.395,0.174) |
| ice_planet | ICELAND | 1.32 | -1.8 | 0.88 | -0.88 / 1.56 | (12.13,10,5) | (99.16,0,0) | (0,0.761,1) |
| moon_planet | MOONLAND | 2.2 | -1.8 | -0.5 | -2.19 / 0 | (12.72,10,5) | (105.6,30.9,2.81) | (0,0.083,0.396) |
| moon_planet_water | MOONLAND | 1.26 | -1.8 | 0.66 | -1.39 / 0.89 | (20.6,10,8.11) | (105.6,30.9,2.81) | (0,0.102,1) |
| water_planet | YELLOWLAND | 1.13 | -3.58 | 0.7 | -1.56 / 1.07 | (20.6,18.7,8.11) | (105.6,34.8,2.81) | (0,0.789,1) |
| yellow_planet 1 | YELLOWLAND | 1.49 | -1.33 | 0.3 | -0.85 / 2.62 | (19.72,10.8,5) | (105.6,30.9,2.81) | (0.693,0.857,1) |

All planet materials share `water_blend 12.28`, `smoothness 0.84` (water_planet 0.72), `clouds_speed 0.01`, `normal_str 0.002`.

#### 3.2 Asteroids - `Shaders/planet/Asteroid_gen.shadergraph`
Same property set as planet_gen (same keyword, gradients) plus **`crater_size` (default 13) and `crater_offset` (default 35)** implemented with a `Voronoi noise 3D` subgraph (crater cells) on top of one FractalNoise; receives shadows (unlike planets). Material `Shader Graphs_Asteroid_gen.mat`: MOONLAND, crater_size 1.33, crater_offset 38.34, land_amount 2, smoothness 1.4, north/south_pole −2/2, shape low (1.02, 5.97, 1.85), high (17.39, 2.41, 0), water_amount 0.

**Shared noise code**: `Shaders/_FractalNoise/FractalNoise.shadersubgraph` wraps `FractalNoise_float` in `Shaders/_FractalNoise/SimplexNoise3D.hlsl` (line 212): fBm loop, inputs Coordinates/Octaves (default 4)/FractalAmplitudeFactor (0.5)/FractalFrequencyFactor (2.0); starts `s=1, w=0.25, o=0.5`, per octave samples simplex noise 3× with ε=0.0001 offsets, accumulates `o += w * (vx,vy,vz)`, then `s *= freqFactor; w *= ampFactor`. Simplex implementation is Keijiro Takahashi's translation of Stefan Gustavson's webgl-noise; the full library (Perlin/Simplex/Voronoi 2D/3D/4D, BCC noise) is vendored at `Shaders/Shaders/NoiseShader/HLSL/` with ShaderGraph wrappers in `Shaders/Shaders/Subgraphs/`.

#### 3.3 Engine plumes - `Shaders/EngineFlames.shadergraph` + `Shaders/EngineGlow/*.mat`
Unlit, **transparent**, alpha-blended; **vertex displacement** (writes `VertexDescription.Position`; no fresnel, no scrolling texture). Technique: object-space position is split, and the plume mesh's length axis is scaled by `Stretch` plus a per-frame flicker from `RandomRangeNode` (seeded by `TimeNode`) bounded by `random_min_Max` (Vector2 min/max), with an optional `sine_variation` wobble; fragment color is a lerp along UV between `BaseColor` and `Highlight` (both **HDR colors far above 1.0** to drive bloom) toward `FadeBurn` (black) with falloff shaped by `gradientAdjust` and `faedeAdjust`; alpha fades toward the tail. Exposed: `gradientAdjust` (1), `Stretch` (0.5), `faedeAdjust` (0.5), `Highlight`, `FadeBurn`, `random_min_Max` (0.8 - 1.0), `sine_variation` (0), `BaseColor` (1, 0.235, 0 orange).
- Runtime driver: `Scripts/Subsystems/ThrusterEngine.cs` - MaterialPropertyBlock, lerps `_Stretch` and `_random_min_Max` between initial (0.66 / 0 - 0.35) and max values by throttle `power`.
- 8 material variants in `Shaders/EngineGlow/`: e.g. `Shader Graphs_EngineFlames 1.mat` (cyan, Stretch 30, Highlight ≈ (1.47, 11.0, 24.0) HDR), `…2` (orange, BaseColor (14.75, 0.92, 0)), `…7` (green, Highlight (125.8, 259.0, 139.6) - extreme HDR), `Missile_EngineFlames.mat` (white-hot base (8,8,8), Highlight (19.7, 153.3, 219.3), sine_variation 6.22, random max 0.35).

#### 3.4 Procedural space skybox - `Shaders/Procgen_Space_Skybox.shadergraph`
Unlit, opaque, ZWrite off. Layers (4 subgraph nodes: 2× FractalNoise, Simplex 3D, Voronoi 3D): two fBm nebula layers with independent `Octave_1/frequency_1/amplitude_1` (8 / 1.5 / 1) and `Octave_2/frequency_2/amplitude_2` (5 / 3 / 0.5), colored `Color_1` / `Color_2` and blended with `mask_fuziness` (0.3) and `Remap_in` (0.41 - 2.24) / `Remap_out` (0 - 1.84); a **Voronoi-based star field** (`StarDensity` 1000, `StarTextureSize` 50, `stars_mask` 2, `SmallDetal_power`) with a time-rotated **shimmer** (`ShimmerSpeed` 0.1, `ShimmerNoiseScale` 10, `ShimmerPower` 2, via `RotateAboutAxis` + `TimeNode`); `Fractal_offset` (Vector3) reseeds the whole sky. Per-mission skybox materials in `Materials/SpaceBackgrounds/` (`space_mission_1..4`, `space_labrynth`, `space_mission_hit_and_run`, `campaign_map_color`) vary only `_Color_1`/`_Color_2` (e.g. `space_mission_4.mat`: green nebula `(0, 0.443, 0.147)` over near-black purple). `Skirmish.unity` uses `space_mission_4`.

#### 3.5 Hologram - `Shaders/Hologram.shadergraph`
Unlit, transparent. Fresnel (`fres_power`) × HDR `Color`, with `scaleOffset` (0.01) inflating the mesh along vertex position (writes vertex Position). Used by: `Materials/Ship_Move_holo.mat` (`_Color` = (0, 0.789, 4) HDR cyan, `_fres_power` 2), `Missile_Move_holo.mat`, `Nav_point.mat` (+ `Nav_point_Elevation/Roll/rotation` variants) - i.e. the ghost previews of planned ship/missile movement and nav markers, and the missile's TrailRenderer material in `Prefabs/FX/Weapons/Weapon_Missile_FX.prefab`.

#### 3.6 Nebula (battlefield prop) - `Shaders/Nebula.shadergraph`
Lit, transparent, **additive** (`m_AlphaMode: 2`), ZWrite off. Inverted fresnel (`fres_power`) remapped by `InverseLerp(L1=1, L2=0)` into alpha × `Color` - a soft volumetric-looking gas blob on a mesh. Material: `Materials/GalaxyMap/Nebula.mat`.

#### 3.7 Dithered/retro effects
- `Shaders/Dithered_screenversion.shadergraph` - **full-screen** (`UniversalFullscreenSubTarget`) retro filter: samples the camera color (`UniversalSampleBufferNode`), quantizes to `ColorRes` (32) / `ColorDensity` (64,64,64) levels, pixelates via `PixleDensity` (16) with Floor/TilingAndOffset math, applies Bayer dithering (`DitherNode` ×3 + `Pattern` texture = `QuickDither/Bayer Patterns/bayer16.png`, `DitherDensity` 128, `DitherSize` 1). Bound to the disabled FullScreenPassRendererFeature via `Shaders/DitheredMaterialBase.mat`.
- `Shaders/DitherScreen.shadergraph` (fullscreen, `DitherSpread` 0.1, `ColorResolution` 64) and `Shaders/DitherTexture.shadergraph` (per-object unlit variant) - same family.
- `Shaders/QuickDither/` - vendored third-party library (Ooseykins' QuickDither): Bayer pattern textures 2/4/8/16, `PaletteCompute.compute`/`SlicerCompute.compute`, palette generator scripts (`BitPalette.cs`, `TexturePalette.cs`, `PaletteTextureGenerator.cs`), retro palettes (C64, CGA, Gameboy, DOOM, Windows95…). Its URP path renders the main camera into a low-res render texture drawn through the dither material on UI. Present but not wired into the active renderer - an experimental art direction, not core.
- Note: there is **no evidence of dithered transparency being used for cloaking**; the dither shaders are screen-space retro filters. Helper `Shaders/cginc/DitheringPatterns.cginc` defines 4×4 pattern matrices (binary, binaryDecimal, dotted, hatched).

#### 3.8 Selection outlines - `Shaders/outline_poo/URP-Outline-Render-Feature-main/`
`Scripts/OutlineMeshesFeature.cs` + `Shaders/JumpFloodOutline.shader` ("FeralPug/URP/Outlines/JumpFlood", based on Ben Golus' gist). Pipeline per feature instance: (0) `INNERSTENCIL` stencil-mark pass over the layer's meshes; (1) `BUFFERFILL` silhouette render; (2) `JUMPFLOODINIT` encodes pixel positions into an R16G16_SNorm buffer; (3/4) log2(outline width) jump-flood passes - either classic ping-pong (`JUMPFLOOD`) or Alan Wolfe's **separable-axis** variant (`JUMPFLOOD_SINGLEAXIS`, enabled: `useSeperableAxisMethod: 1`); (5) `JUMPFLOODOUTLINE` converts nearest-seed distance to an outline of exact pixel width with the HDR outline color, masked by the stencil so the interior stays unfilled; (6) `Blit_To_Target`. Settings class `ObjectOutlineSettings` {outlineMaterial, HDR outlineColor, outlinePixelWidth 0 - 100, renderPassEvent, layerToRender, useSeperableAxisMethod}. Two live instances: orange-red selected (layer 9), yellow hover (layer 10), both width 10 px.

#### 3.9 Proxy lighting decals - `Shaders/Proxy_Lighting_shaders/`
`PointLight_Graph.shadergraph` and `SpotLightProxy_Graph.shadergraph`, both `UniversalDecalSubTarget` - **fake lights implemented as URP decal projectors** writing emissive falloff: distance from decal center → `OneMinus`/`Saturate` (point) or smoothstep cone with `Power` (spot), × `LightColor` × `LightIntensity`. Materials `Materials/ProxyLighting/Spotlight.mat` (`_LightColor` (15.8, 14.4, 8.1) HDR warm, `_LightIntensity` 2.72) and `BlueSpotlight.mat` ((0.17, 7.5, 10.7)). This is how the game lights ship hulls locally without extra realtime lights.

#### 3.10 Weapon FX shaders
- **Beam** - `Shaders/Shaders/LineRenders/Beam_Basic_Shader.shadergraph`: unlit, transparent, two-sided off (`m_RenderFace: 0`), **alpha clip on**. A LineRenderer strip (`Prefabs/FX/Weapons/Weapon_Beam_FX.prefab`) with a scrolling texture (`ScrollTex` (0.1, 0)/`TilingAndOffset` + `TimeNode`), a **gradient-noise dissolve** (`NoiseNode`, `disolveScale` 35, `DisoiveSpeed` (−0.1, 0)), lerp `Color1`→`Color2`, vertex-color modulated, faded by `gradient_fade` and master `Fade_overall`. Runtime: `Scripts/FX/BeamFX.cs` animates `_Fade_overall` with an `AnimationCurve` × brightness over the shot's Timing. Material `Materials/Lines/Beam_Basic_Shader 1.mat`: `_Color1` (5.99, 5.99, 5.99) HDR white, `_Color2` (3.0, 3.0, 3.0).
- **Missile** (legacy graphs, old ShaderGraph format): `Shaders/Shaders/Missile/missileGlow.shadergraph` (unlit transparent; double fresnel + `SaturationNode`, HDR `glowColor` (0.365, 1.714, 3.031)), `missileTrail.shadergraph` (gradient-sampled trail, props `trailColor`, `trailInnerColor`, `colorGradient`, `overallAlpha`, `gradientMiddleDarkness` (−0.2), `gradientOutsidePower` (0.6), vertex-color driven), `missileTrailInner.shadergraph` (flat HDR `Color` (0, 2.1, 4) × vertex color). **No materials currently reference these three** - the shipping missile (`Prefabs/FX/Weapons/Weapon_Missile_FX.prefab`) instead uses a `TrailRenderer` with `Materials/Missile_Move_holo.mat` (Hologram) and mesh material `Materials/WeaponFX/MissileLineTexture.mat` (legacy `Particles/Additive`, fileID 211).
- Other projectile materials in `Materials/WeaponFX/` (`Laser.mat`, `torpedo.mat`, `fireball.mat`, `ball.mat`, `shot.mat`) are plain **URP/Lit** (guid `933532a4fcc9baf4fa0491de14d08ed7`), transparent, `_EMISSION` + `_RECEIVE_SHADOWS_OFF`.

#### 3.11 Misc shaders
- `Shaders/HideStuff.shader` ("Custom/HideStuff") - depth-only occluder: `Tags{Queue=Geometry+10}`, `ColorMask 0`, `ZWrite On`, empty pass; `Shaders/Hide_stuff_shadergraph.shadergraph` is the ShaderGraph equivalent (opaque unlit, 4 blocks, no nodes). Material `Materials/Custom_HideStuff.mat`. Used to mask/hide geometry (invisible occlusion).
- `Shaders/ShipMovementShader.shadergraph` - lit transparent; fresnel (`fresnel_power`) + `Color` (0.243, 0.459, 0.670, a 0.61), boolean `highlight_on` branching to `Highlight` color (0.82, 0.44, 0, a 0.57), `emission`/`emission_power` (0.1), `tiling_dither` (1). **Not referenced by any material** - superseded by the Hologram shader for move previews.
- `Shaders/LensFlare.shadergraph` - unlit transparent billboard: reconstructs the quad in view space from Object position + Camera node + transformation matrix (distance-compensated, always camera-facing), samples `Texture2D` × `Color`. Material `Shaders/Shader Graphs_LensFlare.mat`. (URP data-driven lens flares are also enabled at the pipeline level.)
- `Shaders/CelShadeLit/` - cel/toon shader: `ShaderGraphs/CelShadeLit.shadergraph` (unlit target + custom lighting) calling `CustomNodes/LightingCelShaded.hlsl` via subgraph; algorithm `CalculateCelShading`: smoothstep-banded diffuse (`Edge Diffuse` 0.001), Blinn-Phong specular banded by `Edge Specular`, rim = (1 − N·V)·diffuse^`Rim Threshold` banded by `Edge Rim` with `Rim Amount` 0.25/`Rim Strength` 1, attenuation smoothsteps (`Edge Distance Atten`, `Edge Shadow Atten`), multi-light loop guarded by keywords `MAIN_LIGHT_SHADOWS(_CASCADE)`, `ADDITIONAL_LIGHTS`, `SHADOWS_SOFT`; props `Base Map`, `Base Color` (0.196 grey), `Smoothness Map`, `Ambient Color`, `Ambient Sky Multiplier`.
- `Shaders/_FractalNoise/FireLike.shadergraph` (old format, PBR master) - fBm noise scrolled by Time, `SampleGradient` remap, `EmissionVal` 50, `BurnLerp`, `NoiseScale`; material `FireMat.mat`; not referenced elsewhere (experiment).
- `Shaders/Sprites/Sprite-BasicSimple_old.ShaderGraph` - legacy sprite shader.
- `Materials/Data_display.mat`, `Movie.renderTexture` - URP Lit screen/video surfaces.

### 4. Post-processing volume profiles

**`Settings/SampleSceneProfile.asset`** - the battle-scene global profile (referenced by `Skirmish.unity` volume, `m_IsGlobal: 1`):
- **Tonemapping**: mode 1 = **Neutral** (override on).
- **Bloom**: threshold **2.0**, intensity **0.5**, scatter 0.7 (default), max iterations 6, HQ filtering off. (Threshold 2 + HDR material colors of 4 - 260 = bloom only on deliberate emissives.)
- **Color Adjustments**: contrast **+25**, saturation **+55** (highly stylized, vivid grade), postExposure 0, hueShift 0.
- **Color Curves**: active master curve - a custom 5-key S-curve (keys ≈ (0,0), (0.279, 0.235), (0.658, 0.624), (0.878, 0.973), (1,1)) deepening shadows/brightening highlights.
- **Shadows Midtones Highlights**: active, all neutral (no overrides).
- **Split Toning**: active, neutral white/white, balance 0.
- **Motion Blur**: active, quality 1 (Medium), intensity **0.1**, clamp 0.05.
- **Vignette**: present but **disabled** (intensity 0.25, smoothness 0.4).
- **White Balance**: disabled.

**`Settings/city_planet.asset`, `city_planet 1.asset`, `city_planet 2.asset`** - identical grade to SampleSceneProfile (same Neutral tonemap, bloom 2/0.5, contrast 25/saturation 55, same master curve, motion blur 0.1) **plus a `FullScreenFog` volume component** (third-party, script guid `cbb66dc641fe8ef4c843eb98a8fa4058`) feeding the FullScreenFogRendererFeature:
- `city_planet.asset`: mode 2, densityMode 2 (height+distance exponential), color `(0.004, 0.082, 0.141)` deep teal-navy, density **0.009**, startLine 2.61, startHeight 13.43. Used-alike variant `city_planet 2.asset` (same values). Used by `Scenes/Demo/NewDemos/Labrynth.unity`.
- `city_planet 1.asset`: color `(0.481, 0.369, 0.325)` dusty brown, density **0.0027**, startHeight 0.5, noiseIntensity 0.086. Used by `Scenes/Demo/NewDemos/MissileAlley.unity`; base variant by `Scenes/Tutorial/Tutorial_2_Targetting_and_weps.unity`.

### 5. Particle systems

Prefabs in `Prefabs/FX/` (all subclassing `Scripts/Simulator/ParticleSimulator.cs`, which implements `ITimedSimulator` and **pauses/resumes `ParticleSystem`s with the WEGO simulation state** - `particles.Pause(true)` on `OnStopSim`, `Play()` on `OnStartSim` only while `SimulationState.Simulating`; the new engine's particle sim must be pausable/steppable in lockstep with turn resolution):
- **`Explosion.prefab`** (`Scripts/FX/Explosion.cs`): one burst system - duration 0.4 s, non-looping, burst of **30** at t=0, startLifetime 1, startSpeed 2, startSize 4, gravity 0, max 1000 particles; renderer = billboard, material `Materials/Explosion.mat` = **URP Particles/Unlit** (guid `0406db5a14f94604a8c57ccfbc9f3b46`), transparent, `_ALPHATEST_ON` + `_FLIPBOOKBLENDING_ON`, texture-sheet animation over `Textures/explosion_grey.scale.png` flipbook.
- **`Explosion_big.prefab`**: two systems (1 s, non-looping, 1000 + 200 max particles).
- **`Smoke_Trails_Engine.prefab` / `Smoke_Trails_Hull 1.prefab` / `Smoke_Trails_GeneralSubs.prefab`** (`Scripts/FX/SmokeTrails.cs`): looping 10 s damage-smoke emitters, max **5000** particles, material `Materials/Smokes/SmokeMaterial.mat` - URP particle shader (guid `b7839dad95683814aa64166edc107ae2`) with `_SOFTPARTICLES_ON`, `_FLIPBOOKBLENDING_ON`, `_FADING_ON`, `_EMISSION`, `_COLORADDSUBDIFF_ON` (soft-particle depth fade is therefore a required engine feature; depth texture is on in the pipeline for this + SSAO).
- **Weapon FX** `Prefabs/FX/Weapons/`: `Weapon_Beam_FX` (LineRenderer + Beam shader), `Weapon_Cannon_FX`, `Weapon_Missile_FX` (+ red variant; TrailRenderer + hologram trail + estimator ghost), `Weapon_Plasma_FX`, `Weapon_Pulse_FX`, `Weapon_Torpedo_FX`; visuals in `Weapons/Visuals/` (`Missile.prefab`, `laser_fx`, `plasma_fx`, `shot_fx`, `trorpedo_fx`). Scripts `BeamFX.cs`, `CannonShotFX.cs`, `MissileFX.cs`, `MissleFXOverlay.cs`, `PlasmaFX.cs`, `TorpedoFX.cs`, `WeaponFXBasic.cs` in `Scripts/FX/`.
- `Simple Particle Scaler/` is **editor-only tooling** (Unluck Software; `Scripts/Editor/ParticleScaler.cs` - bulk-scales selected particle systems); no runtime component.

### 6. Standard materials / general look

Ship hulls and props use stock **URP/Lit** (guid `933532a4fcc9baf4fa0491de14d08ed7`) with baseColor+normal+emission textures (e.g. `Models/Ship2_Textures/ship_2_revised.mat`: metallic 0, smoothness 0.5, `_EmissionColor` (3.0, 3.0, 3.0) HDR for window/engine glow; `Models/NewShips/Materials/*.mat` same pattern; flat-color faction materials like `Materials/RedGuys.mat`). The overall look = PBR ships + HDR emissive accents + Neutral tonemap + saturation-heavy grade + selective bloom + jump-flood outlines + procedural planets/skybox.

### 7. Feature checklist the Rust engine must reproduce

1. Forward PBR (metallic + specular workflows) with HDR R11G11B10 target, Neutral tonemapping, LDR grading LUT (contrast/saturation/curves/split-tone), thresholded bloom (thr 2, int 0.5), optional motion blur, per-scene analytic height/distance fog volume, optional volumetric fog pass.
2. **Cascaded shadow maps**: 4096 px, 3 cascades, soft PCF, per-cascade split control, plus a screen-space shadow resolve; the Unity version capped at 2000 u - the new engine should generalize the same cascade scheme to camera-far (9000 u) or log-partitioned "unlimited" distance, keeping bias pair (depth 1 / normal 0.01) tunable.
3. SSAO (depth-based, blue-noise, intensity 0.5, radius 0.25).
4. Decal projection (for emissive proxy-light decals with HDR colors).
5. Jump-flood pixel-exact HDR outlines on two selectable object groups (selected = orange-red, hover = yellow, 10 px), stencil-masked interiors, separable-axis JFA optimization.
6. Vertex-displaced procedural planets/asteroids: 3D simplex fBm (2-scale), Voronoi craters, 5-way gradient-ramp land coloring keyed by planet type, sea-level smoothstep water, polar caps, time-rotating noise clouds, fresnel atmosphere - all runtime-parameterizable per the material tables above.
7. Procedural nebula+starfield skybox (dual fBm layers, Voronoi stars, time shimmer), recolorable per mission.
8. Engine plume: mesh stretch + per-frame random flicker driven by throttle, HDR two-color gradient fade (bloom-fed).
9. Hologram/ghost previews (fresnel + HDR tint + slight inflation) for planned movement of ships/missiles and nav points.
10. Beam weapons: textured scrolling line strips with noise dissolve, HDR colors, script-driven fade curves; trail renderers for missiles.
11. CPU particle systems with flipbook animation, soft-particle depth fade, bursts and looping trails, and **pause/resume/step integration with the turn simulation**.
12. Immediate-mode anti-aliased vector overlay layer (lines, rings, arcs, discs, pies, polylines, dashes) for tactical UI in world space.
13. Depth-only occluder material; optional retro dither full-screen filter (currently disabled - decide whether to port).
14. LOD dithered cross-fade, reflection probes (blend + box projection enabled in pipeline), light cookies (4096 atlas) - low usage but enabled.

### 8. Gaps / caveats for the architecture document

- Third-party renderer-feature scripts for **VolumetricFogFeature**, **VolumetricFogRendererFeatureLite**, **FullScreenFogRendererFeature**, and the **FullScreenFog/ScreenSpaceOutlines** components are referenced by GUID but their source lives in `Packages/` which was not archived - behavior reconstructed here from serialized settings only.
- No `ProjectSettings/` folder: exact layer-name table (layers 7/9/10 inferred as Nav/Outline_1/Outline_Hover from bitmasks + `SelectionManager.cs`), quality/graphics tier bindings, and color space are unverifiable from the archive (linear is implied by URP + HDR usage).
- Several shaders are dead code (missileGlow/Trail/TrailInner, ShipMovementShader, FireLike, QuickDither, CelShadeLit has no material users beyond its example) - candidates to drop rather than port; the active visual surface is the list in §7.