/**
 * The far scenery: a sun to light the field, and planets to give it a size.
 *
 * A battle in flat black has no scale and no direction. Two frigates a
 * hundred units apart look exactly like two frigates a thousand units apart,
 * and turning the camera tells you nothing, because there is nothing out
 * there to turn against. This module puts three things at the edge of the
 * world so both problems go away at once: you can see how big a ship is, and
 * you can tell which way you are facing.
 *
 * **Where the sun is, is where the key light comes from.** The two are one
 * fact, published once by `sunDirection` and read by both, because a lit side
 * that disagreed with the visible sun is the kind of wrongness a player feels
 * without being able to name.
 *
 * Everything here sits at 250 to 660 units, which is the backdrop band
 * `DESIGN.md` records from the archive, outside the 200 unit combat bubble and
 * inside the camera's far plane. It is drawn, never simulated: no collider, no
 * pick target, no gravity. A planet that could be clicked or flown into would
 * be a rule, and a rule in the client is a rule two clients can disagree
 * about.
 */
import * as THREE from 'three';

/** The band the archive kept its backdrops in, per DESIGN.md. Inside the
 *  camera's 6000 unit far plane and well outside the 200 unit fight. */
const NEAR_BAND = 250;
const FAR_BAND = 660;

/** How a scenario's sky is lit and dressed. Numbers, authored here, read by
 *  the renderer: a config in the client is allowed, a rule is not. */
export interface Backdrop {
  /** Unit vector TOWARDS the sun. The key light points from here. */
  readonly sun: readonly [number, number, number];
  /** The sun's own colour, which the key light borrows. */
  readonly sunColor: number;
  /** Planets, as a direction, an angular size and a pair of colours. */
  readonly planets: ReadonlyArray<{
    readonly at: readonly [number, number, number];
    readonly radius: number;
    readonly color: number;
    /** The dark side. Never pure black: a planet lit from one side and
     *  vanishing on the other reads as a crescent sticker. */
    readonly shade: number;
    /** A ring, for the one planet per system that earns it. */
    readonly ring?: boolean;
  }>;
}

export const BACKDROPS: Readonly<Record<string, Backdrop>> = {
  skirmish: {
    sun: [0.42, 0.66, -0.62],
    sunColor: 0xfff0d2,
    planets: [
      { at: [-0.55, -0.18, -0.81], radius: 62, color: 0x3c6b4a, shade: 0x0a1410 },
      { at: [0.78, -0.34, 0.52], radius: 22, color: 0x6b5a44, shade: 0x120e0a },
    ],
  },
  duel: {
    sun: [-0.35, 0.55, 0.76],
    sunColor: 0xd8e6ff,
    planets: [
      { at: [0.62, 0.12, -0.77], radius: 48, color: 0x3a5170, shade: 0x080d16, ring: true },
    ],
  },
  convoy: {
    sun: [0.7, 0.34, 0.63],
    sunColor: 0xffd9a8,
    planets: [
      { at: [-0.7, -0.25, 0.67], radius: 78, color: 0x8a5a32, shade: 0x160d06 },
      { at: [0.28, 0.62, -0.73], radius: 18, color: 0x5c6470, shade: 0x0d1014 },
    ],
  },
  low_orbit: {
    // A low orbit engagement has the planet FILLING one side of the sky,
    // which is the whole reason the scenario reads differently from a duel.
    sun: [0.25, 0.78, -0.57],
    sunColor: 0xffeccc,
    planets: [
      { at: [-0.32, -0.86, 0.39], radius: 240, color: 0x2f5f82, shade: 0x060d14 },
    ],
  },
  binary: {
    sun: [0.58, 0.45, -0.68],
    sunColor: 0xffc9a0,
    planets: [
      { at: [-0.62, 0.3, 0.72], radius: 40, color: 0x7a4258, shade: 0x140a0e },
      { at: [0.12, -0.55, -0.83], radius: 30, color: 0x4a3a6b, shade: 0x0b0812 },
    ],
  },
  slingshot: {
    sun: [-0.6, 0.35, -0.72],
    sunColor: 0xe8d8ff,
    planets: [
      { at: [0.45, -0.4, 0.8], radius: 96, color: 0x4a3f7a, shade: 0x0a0812, ring: true },
    ],
  },
  sandbox: {
    sun: [0.4, 0.7, 0.59],
    sunColor: 0xf2f6ff,
    planets: [
      { at: [-0.5, -0.3, -0.81], radius: 54, color: 0x3f5a68, shade: 0x0a0f13 },
    ],
  },
};

export const DEFAULT_BACKDROP: Backdrop = BACKDROPS.skirmish as Backdrop;

export function backdropFor(scenario: string): Backdrop {
  return BACKDROPS[scenario] ?? DEFAULT_BACKDROP;
}

/** The direction the key light comes FROM, normalised. One source of truth
 *  for the lit side of a hull and the bright dot in the sky. */
export function sunDirection(b: Backdrop): THREE.Vector3 {
  return new THREE.Vector3(...b.sun).normalize();
}

/**
 * A soft radial disc, drawn once into a canvas and reused.
 *
 * A sun is a disc with a corona around it, and the cheapest honest way to get
 * one is a texture with the falloff baked in: the alternative is a shader per
 * sprite for a thing that never changes.
 */
function glowTexture(): THREE.Texture {
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const g = cv.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    // A hot core that holds white across the first fifth, then a corona that
    // falls away fast. A linear falloff reads as a fuzzy ball rather than a
    // star, because a real one is far brighter in the middle than the eye's
    // response to it suggests.
    grd.addColorStop(0.0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,248,224,0.95)');
    grd.addColorStop(0.36, 'rgba(255,214,150,0.42)');
    grd.addColorStop(0.62, 'rgba(255,180,110,0.12)');
    grd.addColorStop(1.0, 'rgba(255,160,90,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Build the scenery for one scenario.
 *
 * Returns a group to add to the scene. The caller owns it and disposes it on
 * the next launch: a backdrop belongs to a match, not to the renderer.
 *
 * `renderOrder` and `depthWrite` keep it behind everything: these objects are
 * hundreds of units out, but a planet 240 units across at 500 units would
 * still happily z-fight with a reach shell if it wrote depth.
 */
export function buildBackdrop(b: Backdrop): THREE.Group {
  const group = new THREE.Group();
  // Never culled and never picked. The raycaster walks the scene, and a
  // planet that swallowed a click would put a move order on the sky.
  group.frustumCulled = false;
  group.renderOrder = -10;
  group.userData.pickable = false;

  const sunDir = sunDirection(b);

  // ------------------------------------------------------------- the sun --
  const glow = glowTexture();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow,
    color: b.sunColor,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    // Tone mapping would pull the one thing that is SUPPOSED to clip back
    // into range, and a sun that is not clipping is a lamp.
    toneMapped: false,
  }));
  sun.position.copy(sunDir).multiplyScalar(FAR_BAND * 1.35);
  sun.scale.setScalar(FAR_BAND * 0.38);
  sun.renderOrder = -9;
  sun.userData.pickable = false;
  group.add(sun);

  // A second, much wider and fainter pass. One sprite gives a hard edged
  // blob; two at different scales give the bloom something to catch and read
  // as atmosphere rather than as a decal.
  const halo = new THREE.Sprite((sun.material as THREE.SpriteMaterial).clone());
  (halo.material as THREE.SpriteMaterial).opacity = 0.35;
  halo.position.copy(sun.position);
  halo.scale.setScalar(FAR_BAND * 1.1);
  halo.renderOrder = -10;
  halo.userData.pickable = false;
  group.add(halo);

  // ---------------------------------------------------------- the planets --
  for (const p of b.planets) {
    const dir = new THREE.Vector3(...p.at).normalize();
    // Spread them through the band rather than all at one radius, so turning
    // the camera moves them against each other and the sky has depth.
    const t = (Math.abs(dir.x) + Math.abs(dir.z)) * 0.5;
    const dist = NEAR_BAND + (FAR_BAND - NEAR_BAND) * t;

    const body = new THREE.Mesh(
      // 24x16 rather than 48x32, which is 2300 fewer triangles each and made
      // no measurable difference at all: 50 ms median either way. Kept because
      // it is free and an eye cannot tell, but recorded as the evidence that
      // this scene is FILL bound, not triangle bound. The cost of the backdrop
      // is the pixels it covers, so the place to look, if it ever needs to be
      // cheaper, is the sky and the light count and not the meshes.
      new THREE.SphereGeometry(p.radius, 24, 16),
      // Lambert, like the hulls: the planet is lit by the SAME sun, so its
      // terminator runs the same way as the lit edge of a ship. That
      // agreement is most of what sells a backdrop as a place.
      new THREE.MeshLambertMaterial({
        color: p.color,
        emissive: p.shade,
        depthWrite: false,
      }),
    );
    body.position.copy(dir).multiplyScalar(dist);
    body.renderOrder = -8;
    body.frustumCulled = false;
    body.userData.pickable = false;
    group.add(body);

    if (p.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(p.radius * 1.35, p.radius * 2.15, 96),
        new THREE.MeshBasicMaterial({
          color: p.color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
        }),
      );
      ring.position.copy(body.position);
      // Tipped, because a ring seen exactly edge on is an invisible ring and
      // one seen face on reads as a target reticle.
      ring.rotation.x = -Math.PI / 2 + 0.42;
      ring.rotation.y = 0.3;
      ring.renderOrder = -8;
      ring.frustumCulled = false;
      ring.userData.pickable = false;
      group.add(ring);
    }
  }

  return group;
}

/** Free everything a backdrop holds. Called when a match ends, because the
 *  next one gets its own sky and two would otherwise stack. */
export function disposeBackdrop(group: THREE.Group): void {
  group.traverse(o => {
    const m = o as THREE.Mesh | THREE.Sprite;
    const geo = (m as THREE.Mesh).geometry;
    if (geo) geo.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else if (mat) mat.dispose();
  });
}
