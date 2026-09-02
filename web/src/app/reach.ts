/**
 * The reach shell, shaded like a volume instead of a wash.
 *
 * The movement envelope is a closed surface: where this ship can get to before
 * the turn ends. It was a flat `MeshBasicMaterial` at 0.022 opacity, additive,
 * double sided, and that has no view angle response at all. Every part of it
 * was equally faint however the surface lay, so it read as green fog with
 * contour lines on it rather than as a SHAPE with an inside and an outside.
 * The one thing a player needs from it, how far out the boundary bulges in the
 * direction they are looking, was the thing it could not show.
 *
 * A fresnel term fixes exactly that, and it is a technique this project
 * already has on file: `SHADER_CATALOG.md` 3.6 records the archive's Nebula
 * prop as "inverted fresnel remapped into alpha times Color, a soft
 * volumetric-looking gas blob on a mesh". The same idea, on a different mesh.
 *
 * How it works: the surface is nearly transparent where it faces you and picks
 * up brightness where it turns away, because that is where a real translucent
 * volume has the most depth behind it. The silhouette therefore glows and the
 * middle stays clear, so you can see the shape AND the ships inside it, which
 * a uniform wash forces you to choose between.
 *
 * `abs(dot(...))` rather than the raw dot, because the mesh is double sided
 * and comes out of a marching tetrahedra pass: a back face's normal points
 * away and would otherwise go black instead of glowing.
 *
 * **An additive overlay may only ever ADD, and the arithmetic has to be kept
 * safe for that to hold.** The blend is `src.rgb * src.a + dst`, so no pixel
 * can come out darker than it went in, unless a term is a NaN: then the sum is
 * a NaN, the NaN is written as zero, and the shell has DELETED the sky and the
 * ships behind it. That shipped once, as a black patch that appeared at
 * certain camera angles, and the cause was `pow` handed a base a hair below
 * zero. Every expression in the fragment shader below is now guarded at the
 * point it could go out of range, and `checkTheEnvelopeNeverBlacksAPixelOut`
 * in the playthrough states the invariant so a future one cannot be silent.
 */
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vN;
varying vec3 vView;
void main() {
  // Both in view space, so the fresnel is against the eye rather than against
  // the world, which is what makes it follow the camera round the shape.
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vN;
varying vec3 vView;
uniform vec3 color;
uniform float strength;

void main() {
  // Normalised BY HAND, because normalize() of a zero vector is a division by
  // zero and this mesh comes out of a marching pass that can hand over a
  // degenerate triangle. A vertex sitting exactly on the eye does the same to
  // the view vector.
  float nl = length(vN), vl = length(vView);
  if (nl < 1e-6 || vl < 1e-6) discard;
  vec3 n = vN / nl;
  vec3 v = vView / vl;
  // Double sided, so a back face is as valid as a front one.
  float facing = abs(dot(n, v));
  // Bright at grazing angles, clear head on. The power sets how tight the rim
  // is: lower spreads it into a haze, higher draws a thin outline and loses
  // the sense of volume between.
  //
  // CLAMPED, and this is the black patch. dot() of two unit vectors comes back
  // a shade over one when they are very nearly parallel, which is a whole
  // smooth region of a bicubic surface every time you look straight down its
  // normal. 1.0 - facing is then about -1e-7, and pow() of a negative base
  // is undefined in GLSL: drivers compile it to exp2(y * log2(x)) and log2 of
  // a negative is a NaN. Additive blending is what turns that into damage
  // rather than into a wrong pixel: the blend is src.rgb * src.a + dst, so a
  // NaN alpha takes the DESTINATION with it and the sky and the ships behind
  // the shell are wiped to black. Hence "black patches at certain angles",
  // which moved as the camera turned because the angle is what makes the
  // subtraction go negative.
  //
  // And the patch is a RECTANGLE rather than the shape of the surface that
  // made it, which is bloom finishing the job. UnrealBloomPass takes the frame
  // down five halvings and runs a separable Gaussian at each, and a NaN
  // averaged with anything is a NaN: one poisoned fragment spreads along a row
  // and then down a column, at five scales, and comes back composited over the
  // picture as a hard edged block far bigger than the fragment that started
  // it. That is why the reported shape had straight edges parallel to the
  // screen and no resemblance to the envelope at all.
  //
  // It does not reproduce under software rasterisation, which is what these
  // harnesses run on: SwiftShader gives pow a defined answer there. So the
  // guard is a max() rather than a test, and
  // checkTheEnvelopeNeverBlacksAPixelOut in the playthrough states the
  // invariant it protects, which is that an additive overlay can never put a
  // lit pixel out.
  float rim = pow(max(0.0, 1.0 - facing), 2.6);
  // These numbers are small on purpose, and the first cut of them was not:
  // a rim at 0.55 is twenty five times the flat 0.022 this replaced, and
  // additive blending across a CLOSED double sided surface accumulates it
  // twice per ray, so the shell went solid and hid the ships it is drawn
  // around. The job is to REDISTRIBUTE the old weight towards the silhouette,
  // not to add more of it: the interior gets less than it had, the rim gets a
  // few times more, and the total stays in the same range.
  // Solved rather than eyeballed. The rim term averages 0.2774 over a
  // uniformly oriented surface, so 0.005 + 0.2774 * 0.0613 = 0.022, which is
  // exactly the flat alpha this replaced: the same total ink, with three
  // times as much of it at the silhouette and less than a quarter of it on
  // the faces you are looking through. The first two attempts were guessed
  // and both came out solid enough to hide the ships inside.
  float a = clamp(0.005 + rim * 0.0613, 0.0, 1.0);
  gl_FragColor = vec4(color, clamp(a * strength, 0.0, 1.0));
}
`;

/**
 * A shell material. `strength` is the single knob the camera drives: it fades
 * the whole thing out as you close in on a ship, because at inspection range
 * the envelope is in the way rather than useful.
 */
export function reachMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      color: { value: new THREE.Color(color) },
      strength: { value: 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
