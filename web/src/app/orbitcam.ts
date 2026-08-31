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
 * Place the camera so a box just fills the viewport.
 *
 * The box as it actually PROJECTS, not its bounding sphere. A frigate is six
 * units long and three across, so its sphere is mostly empty and fitting it
 * gave away a third of a phone screen as margin. This projects the eight
 * corners onto the camera's own right and up axes and solves for the distance
 * that just contains them in both angles, so the hull fills whatever shape the
 * viewport happens to be.
 *
 * A corner at offset c sits at depth D + c.fwd, so it stays in frame when
 * D >= |c.right| / tanH - c.fwd, and likewise vertically; the answer is the
 * largest of those sixteen bounds. Allowing for the box's whole depth instead
 * pushes the camera back far enough for its NEAREST face, which on a six unit
 * ship is another third of the screen given away.
 */
export function frameBox(
  camera: THREE.PerspectiveCamera, cam: OrbitState,
  centre: THREE.Vector3, half: { x: number; y: number; z: number },
): void {
  const fovV = (camera.fov * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * Math.max(0.05, camera.aspect));
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const fwd = new THREE.Vector3(-sy * cp, -sp, -cy * cp);   // the camera looks in
  const right = new THREE.Vector3(-cy, 0, sy);
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanH = Math.tan(fovH / 2), tanV = Math.tan(fovV / 2);
  let need = 0;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sj = -1; sj <= 1; sj += 2) {
      for (let sk = -1; sk <= 1; sk += 2) {
        const ox = sx * half.x, oy = sj * half.y, oz = sk * half.z;
        const u = Math.abs(ox * right.x + oy * right.y + oz * right.z);
        const v = Math.abs(ox * up.x + oy * up.y + oz * up.z);
        const w = ox * fwd.x + oy * fwd.y + oz * fwd.z;
        need = Math.max(need, u / tanH - w, v / tanV - w);
      }
    }
  }
  const dist = Math.max(0.4, need * 1.05) * cam.zoom;
  camera.position.set(
    centre.x + Math.sin(cam.yaw) * cp * dist,
    centre.y + Math.sin(cam.pitch) * dist,
    centre.z + Math.cos(cam.yaw) * cp * dist,
  );
  camera.lookAt(centre);
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
}
