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

import { allRound, arcBlocked, ARC_PITCH, ARC_YAW, type GunDef } from './design.js';

/** How fast a mount traverses, in radians a second. */
const SLEW = (110 * Math.PI) / 180;
/** The exponential the ease runs on. Together with the cap: easing alone is
 *  smooth and its first step is proportional to the gap, so a turret picking
 *  up a target 105 degrees away moved 54 of them in a tenth of a second, which
 *  reads as a snap however continuous the maths is. */
const EASE = 5.5;

export interface TurretGoal {
  /** About the mount's own up axis, with its rest facing already taken off. */
  readonly yaw: number;
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
 * Yaw is the angle round from the nose and pitch is a true elevation off the
 * horizontal plane, which is what `arc_test_3d` measures: a mount has two
 * axes, and roll does not enter it. A mount that cannot bear stays at rest
 * rather than straining at its stop, which is also what makes "bearing"
 * readable at a glance, the ones that can reach the target are the ones that
 * moved.
 */
export function turretGoal(
  dir: { x: number; y: number; z: number },
  rest: number,
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
  const bears = inside(h, gun.arcH) && inside(v, gun.arcV)
    && !(mask && arcBlocked(mask, dir.x, dir.y, dir.z));
  if (!bears) return AT_REST;
  return { yaw: (h * Math.PI) / 180 - rest, pitch: (-v * Math.PI) / 180, bears: true };
}

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
