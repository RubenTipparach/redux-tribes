/**
 * Where a turret points, and how fast it gets there.
 *
 * The shipyard grew this first, as a preview: a mount swings onto a target it
 * can bear on, eases rather than snaps, and returns to its rest facing when it
 * has nothing to track. The battlefield needs exactly the same thing over
 * exactly the same hulls, and a second copy is the divergent path GUIDELINES
 * 5.1 calls a defect: the two would drift the first time either one's slew was
 * tuned, and a player would watch a turret in the editor point somewhere the
 * same turret on the map does not.
 *
 * Nothing here decides an outcome. Whether a shot is legal is `Sim::bears` in
 * the core, asked through `ft_can_bear`; this is where the barrel is DRAWN,
 * which is framing and the client's own business. The two agree because they
 * read the same two gates: the weapon's authored arc and the mask scanned off
 * the hull.
 */

import * as THREE from 'three';

import { allRound, arcBlocked, ARC_PITCH, ARC_YAW, type GunDef } from './design.js';

/**
 * A mount's own frame, as the rotation that takes it into the ship's.
 *
 * Nine numbers row major, straight from `faceBasis`. It is what a design's
 * yaw, pitch and roll come out as once the cells have been turned, and it is
 * why a turret laid on a flank traverses about the flank rather than about
 * the deck: the angles below are worked out in THIS frame and then put back.
 */
export type MountFace = readonly number[];

/** An unturned mount, which is most of them. */
export const UPRIGHT: MountFace = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A direction taken out of the ship's frame and into the mount's. The basis
 *  is a rotation, so its inverse is its transpose and no solve is needed. */
function intoMount(f: MountFace, x: number, y: number, z: number):
  { x: number; y: number; z: number } {
  return {
    x: (f[0] as number) * x + (f[3] as number) * y + (f[6] as number) * z,
    y: (f[1] as number) * x + (f[4] as number) * y + (f[7] as number) * z,
    z: (f[2] as number) * x + (f[5] as number) * y + (f[8] as number) * z,
  };
}

/** How fast a mount traverses, in radians a second. */
const SLEW = (110 * Math.PI) / 180;
/** The exponential the ease runs on. Together with the cap: easing alone is
 *  smooth and its first step is proportional to the gap, so a turret picking
 *  up a target 105 degrees away moved 54 of them in a tenth of a second, which
 *  reads as a snap however continuous the maths is. */
const EASE = 5.5;

export interface TurretGoal {
  /** About the mount's OWN up axis, in the mount's own frame. */
  readonly yaw: number;
  /** Elevation about the mount's own trunnion, in the same frame. */
  readonly pitch: number;
  /** Whether it can actually bear: both gates passed. */
  readonly bears: boolean;
}

/** Straight ahead on the mount, which is where one with nothing to do sits. */
export const AT_REST: TurretGoal = { yaw: 0, pitch: 0, bears: false };

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Where this mount wants to point, given a direction in the SHIP's frame.
 *
 * TWO frames, and keeping them apart is the whole of this function. The GATES
 * are asked in the ship's: yaw is the angle round from the nose and pitch a
 * true elevation off the horizontal plane, which is what `arc_test_3d`
 * measures. The ANGLES come back in the MOUNT's, because a barrel swings on
 * its own trunnions and not on the hull's.
 *
 * A mount still has two axes of travel. Its third, the roll the design bolted
 * it on at, is fixed once the ship is built and is exactly what `face`
 * carries. A mount that cannot bear stays at rest rather than straining at its
 * stop, which is also what makes "bearing" readable at a glance: the ones that
 * can reach the target are the ones that moved.
 */
export function turretGoal(
  dir: { x: number; y: number; z: number },
  face: MountFace,
  gun: GunDef,
  mask?: Uint32Array,
): TurretGoal {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-6) return AT_REST;
  const h = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
  const v = (Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 180) / Math.PI;
  const inside = (x: number, a: readonly [number, number]) => allRound(a)
    || (x >= Math.min(a[0], a[1]) && x <= Math.max(a[0], a[1]));
  // The authored arc, then the hull's own shadow. A turret that swung happily
  // onto a target through its own engine block would be the picture promising
  // a shot the match then refuses.
  //
  // Both gates are asked in the SHIP's frame, and that is deliberate: the arc
  // a gun is authored with and the mask scanned off the hull are both about
  // the hull, so which way the mount was bolted on does not widen or narrow
  // what it may shoot at. What the facing changes is where the cells are, and
  // the mask follows those, which is the whole of its effect on bearing.
  const bears = inside(h, gun.arcH) && inside(v, gun.arcV)
    && !(mask && arcBlocked(mask, dir.x, dir.y, dir.z));
  if (!bears) return AT_REST;
  // The ANGLES are the mount's, not the ship's. A gun rolled onto a flank
  // traverses about the flank's normal and elevates about its own trunnion,
  // and asking for them in the ship's frame is how a rolled turret ends up
  // swinging about an axis that runs through its own barrel.
  const m = intoMount(face, dir.x, dir.y, dir.z);
  const yaw = Math.atan2(m.x, m.z);
  const pitch = -Math.atan2(m.y, Math.hypot(m.x, m.z));
  return { yaw, pitch, bears: true };
}

/**
 * The rotation to apply to cells that were rasterised in the SHIP's frame.
 *
 * The cells come off the raster already turned by the facing, so posing one is
 * not simply `Ry(yaw) * Rx(pitch)`: that elevates about the SHIP's beam, which
 * for a mount yawed a quarter turn runs straight down its own barrel and moves
 * nothing at all. Undo the facing, aim in the mount's frame, put the facing
 * back: `F * Ry * Rx * F^-1`, which is the identity's `Ry * Rx` again for the
 * mounts that are not turned.
 */
export function poseMatrix(
  out: THREE.Matrix4, face: MountFace, yaw: number, pitch: number,
): THREE.Matrix4 {
  // Scratch rather than fresh objects: this runs once per moving mount per
  // frame on every hull in the fight, and four allocations a call is a
  // collection nobody asked for.
  F.set(
    face[0] as number, face[1] as number, face[2] as number, 0,
    face[3] as number, face[4] as number, face[5] as number, 0,
    face[6] as number, face[7] as number, face[8] as number, 0,
    0, 0, 0, 1);
  AIM.makeRotationFromEuler(E.set(pitch, yaw, 0, 'YXZ'));
  // A rotation's inverse is its transpose, which is exact here and a solve is
  // not: every entry is 0, 1 or -1 and must stay that way.
  INV.copy(F).transpose();
  return out.copy(F).multiply(AIM).multiply(INV);
}

const F = new THREE.Matrix4();
const AIM = new THREE.Matrix4();
const INV = new THREE.Matrix4();
const E = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * One frame of travel toward a goal angle, under both the ease and the cap.
 *
 * `wrapped` for yaw, which runs the short way round the circle; pitch has no
 * wrap because a mount does not tip over backwards.
 */
export function easeAngle(cur: number, goal: number, dt: number, wrapped = false): number {
  const gap = wrapped ? wrap(goal - cur) : goal - cur;
  const k = 1 - Math.exp(-EASE * dt);
  const cap = SLEW * dt;
  return cur + Math.max(-cap, Math.min(cap, gap * k));
}

/**
 * The blocked half of a mount's arc, as triangles on a shell around it.
 *
 * One patch per blocked cell, on the sphere the turret would otherwise cover.
 * This draws the MASK itself rather than a picture of what it ought to be: a
 * player who cannot see why a mount will not shoot astern is a player who
 * thinks the gun is broken.
 *
 * Returned as a flat position array so the two callers can wrap it in whatever
 * material each wants. `Math.sin` is fine here and nowhere near the scan
 * itself: this is a picture, and a picture that differs in its last bits
 * between two machines is still the same picture.
 */
export function blockedShell(
  mask: Uint32Array, reach: number, blocked = true,
): number[] {
  const at = (yi: number, pi: number): readonly [number, number, number] => {
    const yaw = (yi / ARC_YAW) * Math.PI * 2 - Math.PI;
    const pitch = (pi / ARC_PITCH) * Math.PI - Math.PI / 2;
    const cp = Math.cos(pitch);
    return [Math.sin(yaw) * cp * reach, Math.sin(pitch) * reach, Math.cos(yaw) * cp * reach];
  };
  const pts: number[] = [];
  for (let pi = 0; pi < ARC_PITCH; pi++) {
    for (let yi = 0; yi < ARC_YAW; yi++) {
      const bit = pi * ARC_YAW + yi;
      // One scan, both answers. `blocked` picks which side of the mask is
      // drawn: the shipyard shows what the hull is in the way of, and the map
      // shows where the gun CAN shoot, which is the same set inverted and not
      // a second function that could disagree about the winding.
      const set = ((mask[bit >>> 5] ?? 0) >>> (bit & 31)) & 1;
      if ((set === 1) !== blocked) continue;
      const a = at(yi, pi), b = at(yi + 1, pi);
      const c = at(yi + 1, pi + 1), d = at(yi, pi + 1);
      pts.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  return pts;
}

/** How much of a mount's sphere its own hull takes, as a percentage. Every
 *  cell counts once, which over-weights the poles as the mask itself does: the
 *  number is here to compare turrets, not to integrate a solid angle. */
export function blockedPct(mask: Uint32Array): number {
  let n = 0;
  for (const w of mask) {
    let v = w >>> 0;
    while (v) { n += v & 1; v >>>= 1; }
  }
  return (n / (ARC_YAW * ARC_PITCH)) * 100;
}
