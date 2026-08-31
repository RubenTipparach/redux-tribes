/**
 * Little pictures of ships, for the fleet chips.
 *
 * A chip that says "P1 Terran Frigate" tells you what you already knew. A
 * player spends an hour in the shipyard and then has to pick their hull out of
 * a list of names, which is the same complaint `hull.ts` answers on the map:
 * draw the ship, not a stand in for it.
 *
 * Rendered once per (design, side) into a data URL rather than per chip and
 * per refresh. `refreshAll` runs on every pointer move that changes a plan, so
 * a live canvas per chip would be four extra draws a frame to show something
 * that changes about twice a match. One 128 x 128 render lands in the cache and
 * every later chip is an `<img src>` the browser has already decoded.
 *
 * One WebGL context for the whole cache, created on the first chip and never
 * for a session that does not open a match. Contexts are a scarce browser
 * resource: the map has one, the shipyard has one, and this is the third and
 * last.
 */

import * as THREE from 'three';
import { rasterSig, type Design } from './design.js';
import { hullMesh, tintHull } from './hull.js';
import { frameBox, type OrbitState } from './orbitcam.js';

/** Backing size. Chips draw it at 44 CSS pixels, so this survives a 2x screen. */
const PX = 128;
/** A three quarter view from above: the nose reads, and so does the profile. */
const POSE: OrbitState = { yaw: 2.3, pitch: 0.42, zoom: 1.02 };
/** A session can edit hulls between matches, so the cache is capped. */
const CACHE_MAX = 24;

const cache = new Map<string, string>();

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}
let rig: Rig | null | undefined;

/**
 * The one renderer, made on demand.
 *
 * `undefined` means not tried, `null` means tried and refused: a machine with
 * no WebGL left to give gets chips with no picture rather than an exception
 * halfway through building the rail.
 */
function rigOf(): Rig | null {
  if (rig !== undefined) return rig;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PX;
    canvas.height = PX;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true,
      // `toDataURL` reads the buffer after the draw call has returned, and
      // without this the browser is free to have thrown it away by then.
      preserveDrawingBuffer: true,
    });
    renderer.setSize(PX, PX, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x8fa6bd, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x35c7ff, 0.3);
    fill.position.set(-6, -3, -5);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
    rig = { renderer, scene, camera };
  } catch {
    rig = null;
  }
  return rig;
}

/**
 * A design's hull as a PNG data URL, washed toward `tone`, or '' if this
 * machine cannot draw one.
 *
 * Keyed on what the picture depends on and nothing else: the raster signature
 * covers the parts and the plating, the paint covers the livery, and the tone
 * covers whose it is. A hull that took a hit looks the same on its chip,
 * deliberately: the chip carries what is broken as words beside it, and a
 * silhouette redrawn every time a shot lands would be a render per hit.
 */
export function shipThumb(design: Design, tone: number): string {
  const key = `${rasterSig(design)}|${design.faction}|${design.paint}|${tone.toString(16)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const r = rigOf();
  if (!r) return '';
  let url = '';
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  try {
    const hull = hullMesh(design);
    // Full map range. A chip is 44 pixels across, which is the size a hull is
    // on the map when whose it is matters more than what it is built out of.
    tintHull(mat, tone, false, 1);
    const mesh = new THREE.Mesh(hull.geo, mat);
    r.scene.add(mesh);
    r.camera.aspect = 1;
    r.camera.updateProjectionMatrix();
    // On the hull's own box rather than on the origin: a ship is not symmetric
    // about the point it turns on, and framing on the origin puts the nose or
    // the drive bells over the edge of a 128 pixel picture.
    frameBox(r.camera, POSE,
      new THREE.Vector3(hull.mid[0], hull.mid[1], hull.mid[2]),
      { x: hull.half[0], y: hull.half[1], z: hull.half[2] });
    r.renderer.render(r.scene, r.camera);
    url = r.renderer.domElement.toDataURL('image/png');
    r.scene.remove(mesh);
  } catch {
    url = '';
  } finally {
    // The geometry belongs to `hull.ts`'s cache and is shared; the material was
    // this thumbnail's own.
    mat.dispose();
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, url);
  return url;
}
