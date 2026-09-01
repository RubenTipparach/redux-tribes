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
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  // Double sided, so a back face is as valid as a front one.
  float facing = abs(dot(n, v));
  // Bright at grazing angles, clear head on. The power sets how tight the rim
  // is: lower spreads it into a haze, higher draws a thin outline and loses
  // the sense of volume between.
  float rim = pow(1.0 - facing, 2.6);
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
  float a = 0.005 + rim * 0.0613;
  gl_FragColor = vec4(color, a * strength);
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
