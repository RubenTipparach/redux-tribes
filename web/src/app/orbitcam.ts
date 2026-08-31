/**
 * An orbiting camera over one object, and the gestures that turn it.
 *
 * The shipyard grew this first: yaw, pitch and a zoom multiplier, a camera
 * placed so the hull's own box just fills the viewport, and a pointer router
 * that tells a tap apart from a drag because a phone has neither a second
 * button nor a hover. The schematic modal needs exactly the same thing over
 * exactly the same hulls, and a second copy of it is the divergent path
 * GUIDELINES 5.1 calls a defect: the two would drift the first time either
 * one's framing was tuned.
 *
 * So it lives here once, parameterised, and both callers ask it. Nothing in
 * this file decides anything about the game; it is framing, which is the
 * client's own business (CLAUDE.md, "What the client may compute").
 */

import * as THREE from 'three';

/** Where the camera is looking from, as an orbit rather than a transform. */
export interface OrbitState {
  yaw: number;
  pitch: number;
  /** Multiplier on the distance that just frames the box. 1 is snug. */
  zoom: number;
}

export const orbitStart = (): OrbitState => ({ yaw: 0.9, pitch: 0.45, zoom: 1.15 });

/**
 * Place the camera so a box just fills the viewport, at a distance that does
 * not change as the box is turned.
 *
 * The first version solved the fit for the box AS IT PROJECTS from the current
 * angle, which frames tightly and orbits horribly: a frigate is six units long
 * and two across, so the distance that just contains it swings by a factor of
 * three between bow on and broadside, and turning the hull pulled the camera
 * in and pushed it out the whole way round. A player turning a model to look
 * at it does not expect the model to breathe.
 *
 * So the radius is the box's own bounding SPHERE, which is the one measure of
 * it that a rotation cannot change, and the distance is what puts that sphere
 * inside both angles of the viewport. That is the tight fit's widest case held
 * constant: the hull fills the frame broadside and sits inside it bow on,
 * which is what "orbit" means.
 */
export function frameBox(
  camera: THREE.PerspectiveCamera, cam: OrbitState,
  centre: THREE.Vector3, half: { x: number; y: number; z: number },
  solid?: { x: number; y: number; z: number },
): void {
  const fovV = (camera.fov * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * Math.max(0.05, camera.aspect));
  const r = Math.hypot(half.x, half.y, half.z);
  const fit = Math.max(r / Math.tan(fovH / 2), r / Math.tan(fovV / 2));

  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const out = new THREE.Vector3(Math.sin(cam.yaw) * cp, sp, Math.cos(cam.yaw) * cp);

  // Zooming in is allowed to go a long way; going INSIDE the ship is not. The
  // floor is where the eye would meet the hull along the direction it is
  // actually looking from, which is a ray out of the centre through the solid
  // box, plus a little air. Measured against the hull rather than the framing
  // box: the framing box includes the hit volumes, which can stand proud of
  // the plating, and stopping at those would hold the camera off a ship it
  // could still have got closer to.
  const clear = solid ? boxExit(out, solid) * 1.25 + 0.35 : 0;
  const dist = Math.max(0.4, clear, fit * cam.zoom);
  camera.position.set(
    centre.x + out.x * dist,
    centre.y + out.y * dist,
    centre.z + out.z * dist,
  );
  camera.lookAt(centre);
}

/**
 * How far out of a box centred on the origin a unit direction runs before it
 * leaves: the smallest of the three slab exits.
 *
 * A box rather than the voxels themselves. The silhouette of a hull at any
 * angle is a question the mesh could answer exactly and nobody would see the
 * difference: this is a floor under a zoom, not a collision the game reads.
 */
function boxExit(dir: THREE.Vector3, half: { x: number; y: number; z: number }): number {
  let t = Infinity;
  const axis = (d: number, h: number) => {
    if (Math.abs(d) < 1e-6) return;
    t = Math.min(t, h / Math.abs(d));
  };
  axis(dir.x, half.x);
  axis(dir.y, half.y);
  axis(dir.z, half.z);
  return Number.isFinite(t) ? t : 0;
}

export interface OrbitHooks {
  /** A press that did not travel: naming the thing under it, on any device. */
  onTap?(clientX: number, clientY: number): void;
  /** A mouse moving with no button down. Never fires from touch. */
  onHover?(clientX: number, clientY: number): void;
  /** The mouse left the canvas, so whatever it was over is no longer under it. */
  onLeave?(): void;
  /** How far in and out the zoom multiplier may travel. */
  zoomMin?: number;
  zoomMax?: number;
}

/**
 * Wire one canvas to one orbit state.
 *
 * One finger drags to orbit, two pinch to zoom, the wheel zooms, and a press
 * that travelled less than a few pixels is a tap rather than a drag. That last
 * distinction is the whole reason this is not three lines: on a phone the only
 * gesture that can name a part is the same one that turns the camera, so they
 * are told apart by how far the pointer went rather than by which button it
 * was.
 */
export function bindOrbit(cv: HTMLCanvasElement, cam: OrbitState, hooks: OrbitHooks = {}): void {
  const lo = hooks.zoomMin ?? 0.4, hi = hooks.zoomMax ?? 2.8;
  const zoom = (f: number) => { cam.zoom = Math.max(lo, Math.min(hi, cam.zoom * f)); };

  const pts = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number } | null = null;
  let pinch = 0;
  let downAt: { x: number; y: number; t: number } | null = null;
  let moved = 0;
  const gap = () => {
    const v = [...pts.values()];
    const a = v[0], b = v[1];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      drag = { x: e.clientX, y: e.clientY };
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      moved = 0;
    } else {
      drag = null;
      pinch = gap();
      downAt = null;
    }
    e.preventDefault();
  });

  cv.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) {
      // No button down. A mouse can still be over something, and that is the
      // only way a desk gets a preview without committing to a pick.
      if (hooks.onHover && e.pointerType === 'mouse') hooks.onHover(e.clientX, e.clientY);
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const d = gap();
      if (pinch > 0 && d > 0) { zoom(pinch / d); pinch = d; }
      return;
    }
    if (!drag) return;
    moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    cam.yaw -= (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(-1.35, Math.min(1.35, cam.pitch + (e.clientY - drag.y) * 0.008));
    drag = { x: e.clientX, y: e.clientY };
  });

  const up = (e: PointerEvent) => {
    const tap = downAt && pts.size === 1 && moved < 6 && performance.now() - downAt.t < 700;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (pts.size === 0) { drag = null; downAt = null; }
    if (tap && hooks.onTap) hooks.onTap(e.clientX, e.clientY);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (hooks.onLeave) hooks.onLeave(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.09 : 0.92);
  }, { passive: false });
  // The right button is part of the gesture set here, so the browser's menu
  // over it has to go: a drag that ends with a context menu open is a drag
  // that ends with the model half turned and a list of bookmarks on top of it.
  // On the canvas only, so a right click on a panel still behaves normally.
  cv.addEventListener('contextmenu', e => e.preventDefault());
}
