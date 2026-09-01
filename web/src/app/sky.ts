/**
 * The sky: a nebula, a star field, and the light they throw.
 *
 * This is the archive's own space shader, not a new one. `SHADER_CATALOG.md`
 * 3.4 records what `Procgen_Space_Skybox.shadergraph` did, down to the octave
 * counts and the star density, because the missions differed only by two
 * colours. Porting it rather than inventing a look is the whole point of the
 * rebuild, and it means the numbers below are recovered rather than guessed.
 *
 * **Baked once into a cubemap, not evaluated per frame.** Two layers of fBm
 * plus a Voronoi lookup is a lot of arithmetic to spend on every pixel of a
 * full sky, sixty times a second, on a GPU whose floor is a Raspberry Pi 5
 * (ADR-13). Baked, the sky costs one render at launch and a cubemap fetch
 * thereafter, which is what a static background should cost.
 *
 * The same texture is also handed to `scene.environment`, but be careful what
 * that buys. Three applies the scene environment to `MeshStandardMaterial`
 * ONLY (`materialProperties.environment = material.isMeshStandardMaterial ?
 * scene.environment : null`), and the hulls are `MeshLambertMaterial`, so the
 * nebula does not light a ship. What it does light is the gravity well bodies,
 * which are the one standard material on the map. The cool bounce on a
 * shadowed flank is the FILL light doing that job, not the sky.
 *
 * Setting `envMap` on the hulls by hand would reach Lambert, but Lambert
 * treats an envMap as a mirror reflection rather than as irradiance, so
 * plating would come out shiny instead of softly filled. That is a worse
 * picture, not a better one.
 *
 * What the bake gives up is the shimmer, which in the original rotated the
 * star layer slowly over time. A moving sky means re-baking the cubemap every
 * frame, which is the cost the bake exists to avoid. It is the one part of 3.4
 * not ported, and it is deliberate.
 *
 * Nothing here crosses the boundary. A sky changes the picture and cannot
 * change an outcome, so none of it is hashed and two clients drawing different
 * skies would still agree on the match (they do not: the seed is the
 * scenario's).
 */
import * as THREE from 'three';

/** The two colours a mission's sky is mixed from, and the seed that shapes it.
 *
 *  The archive shipped ten of these and varied nothing else, so a preset here
 *  is a pair of colours and an offset rather than a shader of its own. */
export interface SkyPreset {
  /** The dominant nebula colour. */
  readonly a: THREE.ColorRepresentation;
  /** The colour it sits over, near black in every archived mission. */
  readonly b: THREE.ColorRepresentation;
  /** Reseeds the whole sky. `Fractal_offset` in the original. */
  readonly seed: readonly [number, number, number];
}

/**
 * One sky per scenario, so a level is somewhere rather than anywhere.
 *
 * `skirmish` is `space_mission_4`, the green over near black purple that the
 * archived Skirmish scene actually used. The rest follow the same rule the
 * originals did: two colours, one offset, no new shader.
 */
export const SKIES: Readonly<Record<string, SkyPreset>> = {
  skirmish: { a: 0x00714b, b: 0x0a0616, seed: [0, 0, 0] },
  duel: { a: 0x1d4d86, b: 0x05070f, seed: [11.3, 4.1, 27.7] },
  convoy: { a: 0x6b3a1f, b: 0x0d0806, seed: [3.7, 19.2, 8.4] },
  low_orbit: { a: 0x2a5f7a, b: 0x040910, seed: [22.1, 6.6, 13.9] },
  binary: { a: 0x7a3560, b: 0x0b0512, seed: [17.5, 28.3, 2.2] },
  slingshot: { a: 0x3f2f7a, b: 0x06050f, seed: [9.8, 12.7, 31.4] },
  sandbox: { a: 0x2f4a5c, b: 0x07090d, seed: [5.2, 24.9, 18.1] },
};

export const DEFAULT_SKY: SkyPreset = SKIES.skirmish as SkyPreset;

/** Look a preset up by scenario name, falling back rather than throwing: an
 *  unknown level should still have a sky. */
export function skyFor(scenario: string): SkyPreset {
  return SKIES[scenario] ?? DEFAULT_SKY;
}

/**
 * The shader, as close to `Procgen_Space_Skybox.shadergraph` as GLSL gets.
 *
 * Four layers, which are the four subgraph nodes the catalog lists: two fBm
 * nebulae, a Voronoi star field, and the small detail that keeps the nebula
 * from reading as smooth fog.
 */
const FRAG = /* glsl */`
precision highp float;

varying vec3 vDir;

uniform vec3 colorA;
uniform vec3 colorB;
uniform vec3 seed;

// 3.4's own numbers. Two fBm layers with independent octave, frequency and
// amplitude, blended by a fuzziness and then remapped.
const int   OCT_1  = 8;
const float FREQ_1 = 1.5;
const float AMP_1  = 1.0;
const int   OCT_2  = 5;
const float FREQ_2 = 3.0;
const float AMP_2  = 0.5;
const float FUZZ   = 0.3;
// Where the mask sits, against the turbulence measured above. 0.42 passes
// 19.5% of the sky; 0.35 passes 41% and 0.5 passes 5%. A fifth is the point
// where the sky has structure and the ships still read against it.
const float HIGH   = 0.42;
// How far the nebula is allowed to climb above the ground colour. A sky that
// reaches full saturation is a painted backdrop; gas stays dim.
const float NEB_GAIN = 0.55;
const vec2  REMAP_IN  = vec2(0.41, 2.24);
const vec2  REMAP_OUT = vec2(0.0, 1.84);

// StarDensity 1000 over the sphere, and the mask that keeps all but the
// brightest cells dark. A density of 1000 cells across a direction vector is
// the cell size below rather than a count, which is what the Voronoi node did.
const float STAR_DENSITY = 42.0;
const float STAR_MASK    = 2.0;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}

/** Value noise, smoothstepped. Cheaper than gradient noise and, under eight
 *  octaves of fBm, indistinguishable in a nebula. */
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

// Fractal noise: octaves of noise3 at doubling frequency and halving weight,
// normalised so the octave count does not change the brightness.
// Turbulence: the same octave walk, but each octave is folded about zero
// BEFORE it is summed. Folding the finished sum instead is the trap this hit
// first: eight octaves of value noise concentrate hard around 0.5 (measured:
// mean 0.535, p10 0.337, p90 0.694), and 1 - |2n - 1| is MAXIMAL at 0.5, so
// that version came out mean 0.779 and painted the whole sky. Folded per
// octave it comes out mean 0.345 with p10 0.170: dark nearly everywhere, with
// filaments where the octaves happen to agree. That is what gas looks like.
float turb(vec3 p, int octaves, float freq, float amp) {
  float sum = 0.0;
  float norm = 0.0;
  float f = freq;
  float a = amp;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += a * abs(2.0 * noise3(p * f) - 1.0);
    norm += a;
    f *= 2.0;
    a *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

float fbm(vec3 p, int octaves, float freq, float amp) {
  float sum = 0.0;
  float norm = 0.0;
  float f = freq;
  float a = amp;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += a * noise3(p * f);
    norm += a;
    f *= 2.0;
    a *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

/** Distance to the nearest Voronoi feature point. Stars are the cells whose
 *  centre a ray very nearly passes through, which is why almost all of them
 *  are dark and a few are points. */
float voronoi(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  float best = 1.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = hash33(i + g);
        float d = length(g + o - f);
        best = min(best, d);
      }
    }
  }
  return best;
}

float remap(float v, vec2 inRange, vec2 outRange) {
  float t = (v - inRange.x) / max(1e-5, inRange.y - inRange.x);
  return outRange.x + clamp(t, 0.0, 1.0) * (outRange.y - outRange.x);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 p = dir + seed;

  // Two nebula layers. Value fBm sits near 0.5 almost everywhere, so a mask
  // centred on 0.5 passes nearly the whole sky and the nebula becomes a flat
  // wash: the first cut of this was exactly that, a green screen with stars
  // on it, and ships had nothing to read against. A nebula is mostly EMPTY.
  //
  // Turbulence is what gives it structure: folding the noise about zero
  // (1 - |2n - 1|) turns smooth blobs into filaments with dark lanes between
  // them, which is what the shape of a gas cloud actually is. Then the mask
  // sits high, so only the densest quarter of the sky carries any colour.
  float t1 = turb(p, OCT_1, FREQ_1, AMP_1);
  float t2 = turb(p + 17.0, OCT_2, FREQ_2, AMP_2);

  float mask = smoothstep(HIGH - FUZZ * 0.5, HIGH + FUZZ * 0.5, t1 * 0.65 + t2 * 0.35);
  float density = remap(t1 * 1.4 + t2 * 0.8, REMAP_IN, REMAP_OUT);

  // The ground is the near black the archive kept behind every mission, and
  // the nebula is ADDED over it rather than mixed into it. Mixing lets a
  // dense patch reach the full colour and read as paint; adding keeps it
  // gas, and keeps the darkest sky genuinely dark.
  vec3 neb = colorB + colorA * clamp(mask * density, 0.0, 1.0) * NEB_GAIN;
  // The second layer tints where it is densest, which is what stopped the
  // original reading as one colour with holes in it.
  neb += colorA * 0.22 * smoothstep(0.72, 1.0, t2) * density * NEB_GAIN;

  // Stars. The mask keeps all but the near centres black, and the small
  // detail term stops the field looking like a regular lattice.
  float v = voronoi(p * STAR_DENSITY);
  float star = pow(clamp(1.0 - v, 0.0, 1.0), 24.0) * STAR_MASK;
  float twinkleSize = 0.6 + 0.8 * hash13(floor(p * STAR_DENSITY));
  star *= twinkleSize;

  // A few stars are much brighter than the rest, which is what gives a sky
  // depth: an even field reads as noise.
  float bright = smoothstep(0.985, 1.0, hash13(floor(p * STAR_DENSITY) + 5.0));
  vec3 starCol = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.92, 0.78), hash13(floor(p * STAR_DENSITY) + 9.0));

  vec3 col = neb + starCol * star * (1.0 + bright * 6.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  // The direction from the centre, which for a sphere is the position. The
  // sky is drawn on the inside, so this is the ray the fragment stands for.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Bake a preset into a cubemap.
 *
 * Rendered on the CPU's schedule rather than the frame loop's: this happens
 * once when a match starts, and everything after it is a texture fetch.
 *
 * `size` is per face. 512 is enough that a star is a point rather than a
 * blob at the default field of view, and six faces of it is 6 MB, which is
 * a fraction of what the hull geometry already costs.
 */
export function bakeSky(
  renderer: THREE.WebGLRenderer,
  preset: SkyPreset,
  size = 512,
): THREE.CubeTexture {
  const target = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      colorA: { value: new THREE.Color(preset.a) },
      colorB: { value: new THREE.Color(preset.b) },
      seed: { value: new THREE.Vector3(...preset.seed) },
    },
  });

  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  scene.add(mesh);

  const cam = new THREE.CubeCamera(0.1, 10, target);
  // The renderer's own target and colour state are restored by `update`, but
  // the pass must not be tone mapped twice: the sky is baked in the space the
  // scene is graded from, and grading it here would bake the curve in.
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, scene);
  renderer.toneMapping = toneMapping;

  mesh.geometry.dispose();
  mat.dispose();

  return target.texture;
}
