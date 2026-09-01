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
 * The same texture is handed to `scene.environment`, and it is worth being
 * precise about what that reaches. Three applies the scene environment to
 * `MeshStandardMaterial` ONLY (`materialProperties.environment =
 * material.isMeshStandardMaterial ? scene.environment : null`). The map hull
 * is a standard material, so the nebula genuinely lights the ships: a hull's
 * shadowed flank picks up the colour of the sky it is flying in. It did NOT
 * when this was written, because the hull was Lambert then and the fill light
 * was doing all of that work alone. Worth remembering that the answer moves
 * whenever somebody changes a material.
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
  // Hyphen, because that is the SCENARIO's name: `types.ts` maps
  // 'low-orbit' onto the core's `Scenario.LowOrbit`, and the practice list
  // offers that string. Spelled with an underscore this entry matched
  // nothing, `skyFor` fell back to the default, and the one level whose
  // whole point is a heavy body below you got the skirmish sky instead.
  // A lookup that falls back rather than throwing hides its own typos.
  'low-orbit': { a: 0x2a5f7a, b: 0x040910, seed: [22.1, 6.6, 13.9] },
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

  // NO STARS HERE. They used to be a Voronoi lookup in this shader, and
  // baking them was the mistake: a cube face is 512 texels across 90 degrees,
  // so at a 50 degree field of view every texel is stretched over 3.2 screen
  // pixels and a one texel star arrives as a three pixel smudge. Mipmapping
  // made it worse by averaging them away outright. A nebula is low frequency
  // and survives that; a star is a POINT and no texture survives it.
  //
  // They are geometry now, in starfield() below, at the same Voronoi feature
  // points this shader used to test rays against.
  vec3 col = neb;

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
 * The sky, drawn by us rather than by `scene.background`, so it can be
 * DITHERED.
 *
 * Half float storage fixes the banding in the texture; it does not fix the
 * banding on the way out. The canvas is eight bits, and a gradient this slow
 * quantises against it exactly the same way whatever the texture holds: the
 * value crawls, the byte holds, and the step lands as a contour forty pixels
 * wide because the sky is magnified.
 *
 * A dither is the standard answer and it is nearly free: add noise smaller
 * than one step before the value is rounded, and the rounding scatters instead
 * of stepping. Triangular PDF (two uniform samples subtracted) rather than
 * uniform, because uniform dither leaves the noise correlated with the signal
 * and a flat area still looks like it is moving.
 *
 * Ours rather than three's background pass, for two reasons. Three's
 * background does not dither, and there is no hook to make it. And the ladder
 * in `post.ts` can take the composer away entirely, so a dither living in the
 * post chain would be a sky that bands only on the machines least able to
 * afford a second look at it.
 *
 * Depth test off and drawn first, so it is behind everything without being far
 * away: a cube of half extent one, centred on the camera, covers every
 * direction and sits clear of a near plane of 0.5.
 */
export function skyDome(cube: THREE.CubeTexture): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: { sky: { value: cube } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        // The cube is carried on the camera, so its local position IS the
        // view ray: no inverse projection, no per frame uniform to keep in
        // step with a camera that moves every frame.
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform samplerCube sky;
      varying vec3 vDir;

      // A hash of the pixel, not of time: a still sky should be still. Noise
      // that crawled would be worse than the bands it replaced.
      float hash12(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }

      void main() {
        vec3 col = textureCube(sky, normalize(vDir)).rgb;
        // Triangular PDF across one output step, which is what the eye reads
        // as smooth. Applied before three's tone mapping and colour space
        // conversion take the value to the canvas.
        float n = hash12(gl_FragCoord.xy) - hash12(gl_FragCoord.xy + 71.3);
        gl_FragColor = vec4(col + n / 255.0, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
  // Never culled and always first: a sky that popped out of the frustum, or
  // that drew after the fleet, would be a black screen or a wiped one.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return mesh;
}

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
  // HALF FLOAT, and this is the whole reason the sky stopped banding.
  //
  // A nebula is a very slow gradient across a very dark range: colorB is near
  // black and the gas climbs over it by NEB_GAIN, so most of the sky lives in
  // maybe thirty of the 256 values an 8 bit target can hold. Two neighbouring
  // pixels that ought to differ by a hundredth of a step get the SAME byte
  // until the gradient has crawled far enough to tip over, and where it tips
  // there is a hard edge. Then the cubemap is magnified about four times to
  // fill the viewport, which takes each of those steps and makes it forty
  // pixels wide: the contour map the field looked like.
  //
  // Sixteen bits of float has enough resolution in that range that no step
  // exists to magnify. It costs 12 MB a sky against 6, once, at launch.
  const target = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
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

// ---------------------------------------------------------------- stars --

/**
 * The star field, as GEOMETRY rather than as pixels in the sky texture.
 *
 * This was a Voronoi lookup inside the baked shader, and baking it was the
 * mistake. A cube face is 512 texels across 90 degrees; at a 50 degree field
 * of view on a 1280 wide canvas, every texel is stretched over 3.24 screen
 * pixels, so a one texel star arrived as a three pixel smudge and `LinearFilter`
 * smeared it further. `generateMipmaps` finished the job by averaging stars
 * out of existence in the lower mips.
 *
 * Raising the resolution does not fix it: 1024 faces are still 1.62x magnified
 * and cost 25 MB, and only 2048 is genuinely sharp, at 101 MB of VRAM on a
 * renderer whose floor is a Raspberry Pi 5. The problem was never the budget,
 * it was baking two things with opposite frequency content into one texture. A
 * nebula is smooth and survives resampling; a star is a POINT and no texture
 * survives one under magnification.
 *
 * So the nebula stays baked and the stars become points: 7238 of them in one
 * draw call and about 200 KB, always exactly as crisp as the display, because
 * a point is rasterised at its real size rather than resampled from a grid.
 *
 * **They are the same stars.** These are the Voronoi FEATURE POINTS the shader
 * used to measure rays against: the cell centres, jittered by the same hash,
 * at the same lattice density. Drawing the centres directly is what the
 * distance test was approximating all along.
 *
 * Being geometry also gives back the shimmer that baking gave up
 * (`ShimmerSpeed` in SHADER_CATALOG 3.4), because moving a point costs a
 * uniform rather than a re-bake.
 */

/** The lattice density the feature points are drawn from. 24 gives about
 *  4*pi*24^2 = 7238 cells on the shell, which is a sky with depth in it
 *  without being a wall of white. */
const STAR_LATTICE = 24;

/** `hash33` from the shader, in JS, so the field is the same one the sky was
 *  drawing and a seed still reshapes it. Exact agreement with GLSL is not
 *  needed and not attempted: this decides where a dot goes, and nothing that
 *  crosses the boundary. */
function hash33(x: number, y: number, z: number): [number, number, number] {
  const d1 = x * 127.1 + y * 311.7 + z * 74.7;
  const d2 = x * 269.5 + y * 183.3 + z * 246.1;
  const d3 = x * 113.5 + y * 271.9 + z * 124.6;
  const f = (v: number) => {
    const r = Math.sin(v) * 43758.5453123;
    return r - Math.floor(r);
  };
  return [f(d1), f(d2), f(d3)];
}

const VERT_STARS = /* glsl */`
attribute float size;
attribute float phase;
attribute vec3 tint;
uniform float time;
uniform float pixelRatio;
varying vec3 vTint;
varying float vGlow;
void main() {
  vTint = tint;
  // The archive's shimmer, at last: baking a sky meant it could never move,
  // and a point can. Slow and shallow, because a sky that pulses reads as a
  // fault rather than as space.
  float tw = 0.82 + 0.18 * sin(time * 0.9 + phase);
  vGlow = tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // No size attenuation. A star is at infinity, so it is a fixed number of
  // PIXELS however far the camera moves, which is also what keeps it crisp.
  gl_PointSize = size * tw * pixelRatio;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_STARS = /* glsl */`
precision highp float;
varying vec3 vTint;
varying float vGlow;
void main() {
  // A round dot with a soft edge. A square point is obvious at three pixels,
  // which is exactly the size the brightest stars are.
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.02, r);
  gl_FragColor = vec4(vTint * vGlow, a);
}
`;

/**
 * Build the star field for one sky.
 *
 * `radius` puts them outside everything else in the scene and inside the
 * camera's far plane, so they read as infinitely distant without being
 * clipped.
 */
export function starfield(preset: SkyPreset, radius = 4500): THREE.Points {
  const pos: number[] = [];
  const tint: number[] = [];
  const size: number[] = [];
  const phase: number[] = [];

  const D = STAR_LATTICE;
  const seed = preset.seed;
  const lo = D - 0.5;
  const hi = D + 0.5;
  // Walk the lattice shell that the unit sphere passes through, and take each
  // cell's jittered feature point. This is the Voronoi field the shader had.
  for (let i = -D - 1; i <= D + 1; i++) {
    for (let j = -D - 1; j <= D + 1; j++) {
      for (let k = -D - 1; k <= D + 1; k++) {
        const h = hash33(i + seed[0], j + seed[1], k + seed[2]);
        const fx = i + h[0], fy = j + h[1], fz = k + h[2];
        const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
        // One shell only. Every radius would give a solid ball of stars and
        // the same direction many times over.
        if (len < lo || len > hi) continue;
        pos.push((fx / len) * radius, (fy / len) * radius, (fz / len) * radius);

        // Brightness is heavily skewed: a handful of bright ones over a dust
        // of faint ones is what gives a sky depth. An even field reads as
        // noise, which is what the first cut of this looked like.
        const b = hash33(i * 3.1 + 5, j * 3.1 + 5, k * 3.1 + 5)[0];
        const bright = Math.pow(b, 7);
        size.push(1.0 + bright * 2.6);

        // Cool white through to warm, the colours of real stars.
        const c = hash33(i * 1.7 + 9, j * 1.7 + 9, k * 1.7 + 9)[0];
        const warm = 0.45 + 0.55 * bright;
        tint.push(
          (0.74 + 0.26 * c) * warm + (1 - warm) * 0.30,
          (0.80 + 0.18 * c) * warm + (1 - warm) * 0.34,
          (1.00 - 0.16 * c) * warm + (1 - warm) * 0.42,
        );
        phase.push(hash33(i + 31, j + 31, k + 31)[0] * 6.283);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
  geo.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT_STARS,
    fragmentShader: FRAG_STARS,
    uniforms: {
      time: { value: 0 },
      pixelRatio: { value: Math.min(devicePixelRatio || 1, 2) },
    },
    transparent: true,
    depthWrite: false,
    // Drawn before everything and not depth tested, so the scenery in front of
    // them covers them by drawing later. The planets do not write depth, so a
    // depth test would let stars through them.
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -20;
  points.userData.pickable = false;
  points.userData.stars = pos.length / 3;
  return points;
}
