//! The wasm boundary.
//!
//! Deliberately a C ABI over a flat f32 scratch buffer rather than
//! wasm-bindgen. The simulation's whole interface is numeric (poses, orders,
//! stats in; poses out), so there is nothing for object marshalling to do, and
//! avoiding the glue keeps the build to plain `cargo build --target
//! wasm32-unknown-unknown` with no extra toolchain. The TypeScript side reads
//! and writes the same buffer through a Float32Array view.
//!
//! Layout of the scratch buffer, in f32 slots:
//!
//!   IN   0..2   position
//!        3..5   velocity, units per second
//!        6..9   orientation quaternion (x, y, z, w)
//!       10..12  target
//!       13..15  commanded facing
//!       16      1 if a target was given, else 0
//!       17      1 if a facing was commanded, else 0
//!       18..23  flight stats: yaw, pitch, fwd, retro, lat, max speed
//!       24      commanded roll about the nose, radians from wings level
//!       25      1 if a roll was commanded, else 0
//!
//!   OUT 32..34  end position
//!       35..37  end velocity
//!       38..41  end orientation
//!       42      1 if the mode is committed
//!       64..    path samples, 7 floats each: pos(3) + quat(4)
//!
//! Everything is f32 and little endian on both sides, which wasm guarantees.
//!
//! Beyond the single flight query above, the core also owns a whole MATCH.
//! State lives in Rust; the client submits orders and reads records back. That
//! direction matters: if the client owned the state it would have to be
//! serialised across the boundary every turn AND kept identical to whatever a
//! second client believed, which is the divergence lockstep exists to catch
//! (ADR-6). One owner, one truth, and the boundary carries only what is drawn.
//!
//! Record layouts, all f32, all written from slot 64:
//!
//!   ship   40 slots: id, class, faction, side, destroyed, hull, hullMax,
//!          marines, pos(3), quat(4), vel(3), mode, drifting, subCount,
//!          sub hp+dead (3 pairs), weaponCount, lastFiredTurn (3),
//!          partyCount, party faction+count (2 pairs)
//!   event  14 slots: kind, tick, ship, other, aux, amount, pos(3), to(3)
//!   pose    9 slots: id, destroyed, pos(3), quat(4)
//!   proj    5 slots: id, kind, pos(3)

use crate::data::{class_index, class_from_index, ship_class, WeaponKey, ALL_CLASSES};
use crate::math::ARC_WORDS;
use crate::flight::{
    can_reach, fly_span, fly_turn, Body, Flight, Mode, Well, TICKS_PER_SECOND, TICKS_PER_TURN,
};
use crate::math::{Quat, V3};
use crate::state::{Faction, ProjKind, Sim, SpawnSpec, WeaponSlot, Winner};
use crate::turn::{Event, FireOrder, Order};

/// Sized for the largest single payload the boundary carries, which is the
/// 601 sample path (4207 slots). Everything else pages through the same space.
const SCRATCH_LEN: usize = 16384;
static mut SCRATCH: [f32; SCRATCH_LEN] = [0.0; SCRATCH_LEN];

const OUT: usize = 64;
pub const SHIP_STRIDE: usize = 34;
pub const SUB_STRIDE: usize = 13;
pub const EVENT_STRIDE: usize = 14;
pub const POSE_STRIDE: usize = 9;
pub const PROJ_STRIDE: usize = 5;

/// The match the client is playing. Single threaded by construction: wasm has
/// one thread, and a second match would need a handle in every call for no
/// gain the client cannot get by instantiating the module twice.
static mut MATCH: Option<Sim> = None;

/// The gravity field.
///
/// A live match owns its own, because the state hash covers it and both seats
/// must hold the same one. This static is what a NEW match starts from, and
/// what a standalone probe flies through when there is no match at all, which
/// is exactly what the envelope mockups do.
static mut WELLS: Vec<Well> = Vec::new();
static mut ORDERS: Vec<Option<Order>> = Vec::new();
static mut EVENTS: Vec<Event> = Vec::new();

#[allow(static_mut_refs)]
fn sim_opt() -> Option<&'static mut Sim> {
    unsafe { MATCH.as_mut() }
}

/// The field to fly through. A live match is the authority: its wells are the
/// ones the hash covers and resolution uses. The static only stands in before
/// a match exists.
#[allow(static_mut_refs)]
fn wells() -> &'static [Well] {
    unsafe {
        match MATCH.as_ref() {
            Some(sim) => &sim.wells,
            None => &WELLS,
        }
    }
}

/// Empty the field. Returns the new count, which is always 0.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn ft_wells_clear() -> u32 {
    unsafe {
        WELLS.clear();
        if let Some(sim) = MATCH.as_mut() {
            sim.wells.clear();
        }
    }
    0
}

/// Add a point source and return the new count.
///
/// Order is part of the simulation, because the accelerations are summed in
/// it, so both seats must add the same wells in the same sequence.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn ft_well_add(x: f32, y: f32, z: f32, mu: f32, soft: f32) -> u32 {
    let w = Well::new(V3::new(x, y, z), mu, soft.max(1e-3));
    unsafe {
        WELLS.push(w);
        if let Some(sim) = MATCH.as_mut() {
            sim.wells.push(w);
            return sim.wells.len() as u32;
        }
        WELLS.len() as u32
    }
}

#[no_mangle]
pub extern "C" fn ft_well_count() -> u32 {
    wells().len() as u32
}

/// The field's acceleration at a point, in u/s^2, written to slots 32..35.
/// The client draws streamlines from this rather than growing a second
/// gravity model of its own.
#[no_mangle]
pub extern "C" fn ft_gravity_at(x: f32, y: f32, z: f32) -> u32 {
    let a = crate::flight::gravity_at(V3::new(x, y, z), wells());
    let s = scratch();
    s[32] = a.x;
    s[33] = a.y;
    s[34] = a.z;
    1
}

#[allow(static_mut_refs)]
fn orders() -> &'static mut Vec<Option<Order>> {
    unsafe { &mut ORDERS }
}

#[allow(static_mut_refs)]
fn events() -> &'static mut Vec<Event> {
    unsafe { &mut EVENTS }
}

/// The scratch buffer as a slice. The wasm caller maps a Float32Array over
/// `ft_scratch_ptr` instead; this is the same memory for a native test.
#[allow(static_mut_refs)]
pub fn ft_scratch_slice() -> &'static mut [f32] {
    unsafe { &mut *(&raw mut SCRATCH) }
}

/// The octree output buffer as a slice, for the same reason.
#[allow(static_mut_refs)]
pub fn ft_octree_slice() -> &'static [u32] {
    unsafe { &*(&raw const OCT) }
}

fn scratch() -> &'static mut [f32] {
    unsafe { &mut *(&raw mut SCRATCH) }
}

/// Pointer to the shared scratch buffer. The caller maps a Float32Array over
/// wasm memory at this offset and reads and writes the slots above.
#[no_mangle]
pub extern "C" fn ft_scratch_ptr() -> *mut f32 {
    &raw mut SCRATCH as *mut f32
}

#[no_mangle]
pub extern "C" fn ft_scratch_len() -> u32 {
    SCRATCH_LEN as u32
}

fn read_inputs(s: &[f32]) -> (Body, Option<V3>, Option<V3>, Option<f32>, Flight) {
    let body = Body {
        pos: V3::new(s[0], s[1], s[2]),
        vel: V3::new(s[3], s[4], s[5]),
        quat: Quat { x: s[6], y: s[7], z: s[8], w: s[9] },
    };
    let target = if s[16] != 0.0 { Some(V3::new(s[10], s[11], s[12])) } else { None };
    let face = if s[17] != 0.0 { Some(V3::new(s[13], s[14], s[15])) } else { None };
    let roll = if s[25] != 0.0 { Some(s[24]) } else { None };
    let fl = Flight {
        yaw_rate: s[18],
        pitch_rate: s[19],
        accel_fwd: s[20],
        accel_retro: s[21],
        accel_lat: s[22],
        max_speed: s[23],
    };
    (body, target, face, roll, fl)
}

/// Fly one turn. Returns how many path samples were written from slot 64.
///
/// `sample_stride` thins the recorded path: 1 keeps every slice, 10 keeps every
/// tenth. The renderer wants a few dozen points for a line, not 601.
#[no_mangle]
pub extern "C" fn ft_fly_turn(mode: u32, steps: u32, sample_stride: u32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, target, face, roll, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let target = if mode.committed() { None } else { target };

    let flown = fly_turn(body, target, mode, &fl, face, roll, steps, wells());

    s[32] = flown.end_pos.x;
    s[33] = flown.end_pos.y;
    s[34] = flown.end_pos.z;
    s[35] = flown.end_vel.x;
    s[36] = flown.end_vel.y;
    s[37] = flown.end_vel.z;
    s[38] = flown.end_quat.x;
    s[39] = flown.end_quat.y;
    s[40] = flown.end_quat.z;
    s[41] = flown.end_quat.w;
    s[42] = if mode.committed() { 1.0 } else { 0.0 };

    let stride = sample_stride.max(1) as usize;
    let mut n = 0usize;
    let mut i = 0usize;
    while i < flown.path.len() {
        let base = 64 + n * 7;
        if base + 7 > SCRATCH_LEN {
            break;
        }
        let (p, q) = flown.path[i];
        s[base] = p.x;
        s[base + 1] = p.y;
        s[base + 2] = p.z;
        s[base + 3] = q.x;
        s[base + 4] = q.y;
        s[base + 5] = q.z;
        s[base + 6] = q.w;
        n += 1;
        i += stride;
    }
    n as u32
}

/// The reachability probe, one cell at a time. Reads the same inputs; the
/// target slots carry the candidate point.
#[no_mangle]
pub extern "C" fn ft_can_reach(mode: u32, eps: f32, steps: u32) -> u32 {
    let s: &[f32] = unsafe { &*(&raw const SCRATCH) };
    let (body, _t, face, roll, fl) = read_inputs(s);
    let target = V3::new(s[10], s[11], s[12]);
    can_reach(body, target, Mode::from_u32(mode), &fl, face, roll, eps, steps, wells()) as u32
}

/// Sweep a whole grid of candidate cells in one call, so probing an envelope
/// costs one boundary crossing instead of several thousand. Cells are written
/// back as a bitmask, 32 cells per u32, from slot 64.
#[no_mangle]
pub extern "C" fn ft_reach_grid(mode: u32, eps: f32, steps: u32, n: u32, cx: f32, cy: f32, cz: f32, half: f32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, roll, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let n = n.max(1).min(32) as usize;
    let step = 2.0 * half / n as f32;
    let mut hits = 0u32;
    let mut idx = 0usize;
    let words = (n * n * n).div_ceil(32);
    for w in 0..words {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = 0.0;
        }
    }
    let mut mask = vec![0u32; words];
    for i in 0..n {
        let x = cx - half + (i as f32 + 0.5) * step;
        for j in 0..n {
            let y = cy - half + (j as f32 + 0.5) * step;
            for k in 0..n {
                let z = cz - half + (k as f32 + 0.5) * step;
                if can_reach(body, V3::new(x, y, z), mode, &fl, face, roll, eps, steps, wells()) {
                    mask[idx / 32] |= 1 << (idx % 32);
                    hits += 1;
                }
                idx += 1;
            }
        }
    }
    for (w, word) in mask.iter().enumerate() {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = f32::from_bits(*word);
        }
    }
    hits
}

// ---------------------------------------------------------------- envelope --
// Two ways to find the boundary of the reachable set without paying for the
// volume behind it. Both are SAMPLING strategies rather than rules: they decide
// where to ask, never what the answer is. They live here because the answer
// costs a 60 step flight and batching a whole traversal into one call is worth
// tens of thousands of boundary crossings.

/// Straddling leaves from `ft_reach_octree`, two words each.
///
/// Its own buffer because the scratch cannot hold it: a 64 cell traversal finds
/// about 14,600 leaves. Zero initialised, so it lands in .bss and costs the
/// module nothing.
const OCT_LEN: usize = 65536;
/// Bit 8 of word 1: this entry is a uniform block, not a straddling leaf.
const UNIFORM: u32 = 1 << 8;
static mut OCT: [u32; OCT_LEN] = [0; OCT_LEN];

#[no_mangle]
pub extern "C" fn ft_octree_ptr() -> *mut u32 {
    &raw mut OCT as *mut u32
}

#[no_mangle]
pub extern "C" fn ft_octree_len() -> u32 {
    OCT_LEN as u32
}

/// Find the boundary by descending only where the answer changes.
///
/// A grid probe costs the CUBE of the resolution while what it wants is a
/// SURFACE, and nearly every cell it pays for is deep inside the set, where the
/// answer is always yes, or far outside it, where it is always no. This tests a
/// cell's eight corners first and descends only if they disagree, so a uniform
/// interior and a uniform exterior are each settled once and never looked at
/// again. Cost then tracks area rather than volume: measured against a dense
/// probe at the same cell it is 1.7 times cheaper at 16, 3.0 at 32, 5.7 at 64
/// and 11.1 at 128.
///
/// Every level is a complete answer at its own resolution, so a client can draw
/// coarse at once and sharpen over the following frames rather than blocking on
/// the fine one.
///
/// The box is positioned and oriented like `ft_reach_grid_at`: `f` is the
/// forward axis and `hr`/`hu`/`hf` the half extents across it.
///
/// Writes two words per leaf from `ft_octree_ptr`:
///   word 0  i | j<<8 | k<<16 | level<<24, in cells of the FINEST grid
///   word 1  bits 0..7 the eight corner values, bit 8 set on a UNIFORM block
///
/// A straddling leaf is always at level 0 and carries its real corners. A
/// uniform block is whatever level the traversal stopped at, and its corners
/// are all 0 or all 1: that is the interior and the exterior, reported rather
/// than discarded, because a caller rebuilding a dense field needs them and
/// the traversal already knows them. Together the two kinds determine every
/// corner of the grid, so a client can march at a resolution it could never
/// afford to probe densely.
///
/// Returns the entry count, or 0 if `n` is not a power of two at least `base`,
/// or if the traversal would not FIT. A partial list is worse than none: the
/// two kinds tile the grid, so a caller that rebuilt a dense field from a
/// truncated one would be left with holes it marches through as empty space.
/// Refusing lets the caller drop a level instead of drawing a lie.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn ft_reach_octree(
    mode: u32, eps: f32, steps: u32, base: u32, n: u32,
    cx: f32, cy: f32, cz: f32,
    fx: f32, fy: f32, fz: f32,
    hr: f32, hu: f32, hf: f32,
) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, roll, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let n = n.clamp(2, 128) as usize;
    if !n.is_power_of_two() {
        return 0;
    }
    let base = (base.max(1) as usize).min(n);
    if !base.is_power_of_two() {
        return 0;
    }

    let fwd = V3::new(fx, fy, fz);
    let q = if fwd.len2() > 1e-12 { Quat::look(fwd, None) } else { Quat::IDENTITY };
    let centre = V3::new(cx, cy, cz);
    let half = [hr, hu, hf];
    let at = |i: usize, j: usize, k: usize| -> V3 {
        let l = V3::new(
            -half[0] + 2.0 * half[0] * (i as f32 / n as f32),
            -half[1] + 2.0 * half[1] * (j as f32 / n as f32),
            -half[2] + 2.0 * half[2] * (k as f32 / n as f32),
        );
        centre.add(q.rot(l))
    };

    // One corner costs a flight, and a corner is shared by up to eight cells
    // and by every level above them, so it is solved once and remembered.
    // A Vec of bytes, not a HashMap: iteration order never enters the answer,
    // but a map in the simulation path is a desync waiting for another machine.
    let side = n + 1;
    let mut seen = vec![0u8; side * side * side];
    let mut corner = |i: usize, j: usize, k: usize| -> bool {
        let idx = (i * side + j) * side + k;
        if seen[idx] == 0 {
            let hit = can_reach(body, at(i, j, k), mode, &fl, face, roll, eps, steps, wells());
            seen[idx] = if hit { 2 } else { 1 };
        }
        seen[idx] == 2
    };

    const CORNERS: [(usize, usize, usize); 8] = [
        (0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0),
        (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1),
    ];
    let out: &mut [u32] = unsafe { &mut *(&raw mut OCT) };
    let mut count = 0usize;
    let mut overflowed = false;

    // An explicit stack, because a wasm recursion this deep is a stack the
    // caller cannot see the bottom of.
    let root = n / base;
    let mut stack: Vec<(usize, usize, usize, usize)> = Vec::new();
    for i in 0..base {
        for j in 0..base {
            for k in 0..base {
                stack.push((i * root, j * root, k * root, root));
            }
        }
    }
    while let Some((i, j, k, size)) = stack.pop() {
        let mut bits = 0u32;
        let mut all_same = true;
        let mut first = None;
        for (c, (a, b, d)) in CORNERS.iter().enumerate() {
            let v = corner(i + a * size, j + b * size, k + d * size);
            if v {
                bits |= 1 << c;
            }
            match first {
                None => first = Some(v),
                Some(f) if f != v => all_same = false,
                _ => {}
            }
        }
        let mut emit = |lvl: u32, flag: u32| {
            if count * 2 + 1 < OCT_LEN {
                out[count * 2] =
                    (i as u32) | ((j as u32) << 8) | ((k as u32) << 16) | (lvl << 24);
                out[count * 2 + 1] = bits | flag;
                count += 1;
            } else {
                overflowed = true;
            }
        };
        if size == 1 {
            if !all_same {
                emit(0, 0);
            } else {
                emit(0, UNIFORM);
            }
            continue;
        }
        if all_same {
            // The interior and the exterior, each settled in one test and then
            // reported at the level it was settled at.
            emit(size.trailing_zeros(), UNIFORM);
            continue;
        }
        let h = size / 2;
        for (a, b, d) in CORNERS.iter() {
            stack.push((i + a * h, j + b * h, k + d * h, h));
        }
    }
    if overflowed {
        return 0;
    }
    count as u32
}

/// How many entries the output buffer can hold, so a caller can pick a level
/// it knows will fit rather than discovering the refusal.
#[no_mangle]
pub extern "C" fn ft_octree_capacity() -> u32 {
    (OCT_LEN / 2) as u32
}

/// The boundary as a radius field, for a caller fitting a smooth surface to it.
///
/// Measured over 400 rays, 398 leave the set once and never come back, so the
/// edge is single valued in direction almost everywhere and a tensor product
/// surface can describe it. Writes `nu * nv` radii from slot 64, theta major,
/// each found by bisecting along its own ray from `(cx, cy, cz)`.
///
/// The poles sit on world Y, which is not arbitrary: X and Z were measured
/// against it and lose. The chart crowds badly there, and that was measured
/// too. An equal area chart and a six face cube map are both far more even and
/// both fit WORSE at the same ray budget, because the crowding is what pays for
/// the resolution at the equator, where the shape actually varies.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn ft_reach_radii(
    mode: u32, eps: f32, steps: u32, nu: u32, nv: u32, iters: u32,
    cx: f32, cy: f32, cz: f32, far: f32,
) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, roll, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let nu = nu.clamp(4, 256) as usize;
    let nv = nv.clamp(3, 256) as usize;
    if 64 + nu * nv > SCRATCH_LEN {
        return 0;
    }
    let iters = iters.clamp(4, 30);
    let anchor = V3::new(cx, cy, cz);
    let far = if far > 0.0 { far } else { 200.0 };

    for u in 0..nu {
        let th = (u as f32 / nu as f32) * 2.0 * crate::math::PI;
        let (st, ct) = (crate::math::dsin(th), crate::math::dcos(th));
        for v in 0..nv {
            let ph = (v as f32 / (nv - 1) as f32) * crate::math::PI;
            let (sp, cp) = (crate::math::dsin(ph), crate::math::dcos(ph));
            let d = V3::new(sp * ct, cp, sp * st);
            let mut lo = 0.0f32;
            let mut hi = far;
            if can_reach(body, anchor.add(d.scale(hi)), mode, &fl, face, roll, eps, steps, wells()) {
                s[64 + u * nv + v] = hi;
                continue;
            }
            for _ in 0..iters {
                let m = 0.5 * (lo + hi);
                if can_reach(body, anchor.add(d.scale(m)), mode, &fl, face, roll, eps, steps, wells()) {
                    lo = m;
                } else {
                    hi = m;
                }
            }
            s[64 + u * nv + v] = 0.5 * (lo + hi);
        }
    }
    // Every theta at a pole is the same direction, so the samples there have to
    // agree exactly or a fit puts a dimple in the surface.
    for v in [0usize, nv - 1] {
        let mut m = 0.0f32;
        for u in 0..nu {
            m += s[64 + u * nv + v];
        }
        m /= nu as f32;
        for u in 0..nu {
            s[64 + u * nv + v] = m;
        }
    }
    (nu * nv) as u32
}

/// Probe a box that is POSITIONED and ORIENTED, rather than an axis aligned
/// cube centred on the hull.
///
/// The reachable set is a lobe that leans along the velocity, and at speed it
/// leaves the hull behind entirely: a ship carrying 8 units per second ends
/// its turn about 80 units away whatever it does, so a cube centred on the
/// hull spends almost all of itself on space the ship cannot use. Measured,
/// the cell it can afford grows from 7.9 units at rest to 13.7 at speed, which
/// is backwards: the envelope gets coarsest exactly when it matters most.
///
/// Centring on where the turn actually lands and turning the box to follow the
/// velocity puts the cells where the answer is. Same probe count, cells of 3.8
/// units at rest and 2.8 at speed.
///
/// The frame is built here with `Quat::look` rather than in the client, so
/// there is one definition of which way the box faces and the caller cannot
/// place its vertices somewhere the probe did not look.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn ft_reach_grid_at(
    mode: u32, eps: f32, steps: u32, n: u32,
    cx: f32, cy: f32, cz: f32,
    fx: f32, fy: f32, fz: f32,
    hr: f32, hu: f32, hf: f32,
) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, roll, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let n = n.max(1).min(32) as usize;
    let fwd = V3::new(fx, fy, fz);
    let q = if fwd.len2() > 1e-12 { Quat::look(fwd, None) } else { Quat::IDENTITY };
    let centre = V3::new(cx, cy, cz);
    let mut hits = 0u32;
    let mut idx = 0usize;
    let words = (n * n * n).div_ceil(32);
    for w in 0..words {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = 0.0;
        }
    }
    let mut mask = vec![0u32; words];
    let at = |i: usize, half: f32| -> f32 {
        -half + (i as f32 + 0.5) * (2.0 * half / n as f32)
    };
    for i in 0..n {
        let lx = at(i, hr);
        for j in 0..n {
            let ly = at(j, hu);
            for k in 0..n {
                let lz = at(k, hf);
                let p = centre.add(q.rot(V3::new(lx, ly, lz)));
                if can_reach(body, p, mode, &fl, face, roll, eps, steps, wells()) {
                    mask[idx / 32] |= 1 << (idx % 32);
                    hits += 1;
                }
                idx += 1;
            }
        }
    }
    for (w, word) in mask.iter().enumerate() {
        if 64 + w < SCRATCH_LEN {
            s[64 + w] = f32::from_bits(*word);
        }
    }
    hits
}

/// The basis `ft_reach_grid_at` samples in, so a caller can place the cells it
/// was told about without rebuilding the convention. Right, up and forward go
/// to slots 44 to 52.
#[no_mangle]
pub extern "C" fn ft_look_basis(fx: f32, fy: f32, fz: f32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let fwd = V3::new(fx, fy, fz);
    let q = if fwd.len2() > 1e-12 { Quat::look(fwd, None) } else { Quat::IDENTITY };
    let r = q.rot(V3::new(1.0, 0.0, 0.0));
    let u = q.rot(V3::new(0.0, 1.0, 0.0));
    let f = q.rot(V3::new(0.0, 0.0, 1.0));
    for (o, v) in [(44, r), (47, u), (50, f)] {
        s[o] = v.x;
        s[o + 1] = v.y;
        s[o + 2] = v.z;
    }
    1
}

// ------------------------------------------------------------- the match --

/// Start a match. The seed arrives as two u32 halves and is reassembled into
/// the same 16 character hex string the server issues, so a client and the
/// server name the same match without any string marshalling.
///
/// `human_sides` is a bit per side: set means a person plays it, clear means
/// the AI does. It belongs here rather than on the client because it changes
/// the simulation (an AI side plans its own orders and retaliates), and two
/// clients that disagreed about it would part on the first turn. 1 is a solo
/// game against the AI, 3 is two people.
///
/// Returns the number of ships.
/// Which hull each side fields, or -1 for the one the scenario authored.
///
/// A match fact like every other: both seats pass the same pair or they are
/// playing different matches, which is why it is hashed rather than treated as
/// a preference. Set before `ft_match_new`, which consumes it; the scenario
/// still decides where the ships stand and how many there are, because a
/// player picking a hull is not a player redrawing the engagement.
static mut HULL_CHOICE: [i32; 2] = [-1, -1];

/// A designed hull per side: what the core derived from it, and the mounts the
/// client measured off it.
///
/// Stored derived rather than raw, so a match applies numbers that were worked
/// out once, here, by the thing that owns the rules. Cleared by setting a
/// design with no parts, and consumed by `ft_match_new` like the hull choice.
static mut HULL_DESIGN: [Option<crate::design::Derived>; 2] = [None, None];
static mut HULL_MOUNTS: [Vec<(WeaponKey, V3, [u32; ARC_WORDS])>; 2] = [Vec::new(), Vec::new()];

/// Derive a design and hold it for one side.
///
/// Inputs are `ft_derive`'s, plus the side. The results are written back the
/// same way too, so a caller can read what its own hull came out as without a
/// second call.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn ft_hull_design(
    side: u32,
    class_idx: u32,
    plate_cells: i32,
    ext_x: i32,
    ext_y: i32,
    ext_z: i32,
    radius_cells: f32,
    fouled: i32,
    parts: u32,
) -> u32 {
    if side > 1 {
        return 0;
    }
    if ft_derive(class_idx, plate_cells, ext_x, ext_y, ext_z, radius_cells, fouled, parts) == 0 {
        return 0;
    }
    let s = scratch();
    let d = crate::design::Derived {
        mass: s[OUT], hull: s[OUT + 1], radius: s[OUT + 2],
        accel_fwd: s[OUT + 3], accel_retro: s[OUT + 4], accel_lat: s[OUT + 5],
        max_speed: s[OUT + 6], yaw_rate: s[OUT + 7], pitch_rate: s[OUT + 8],
        reach_u: s[OUT + 9], marines: s[OUT + 10] as i32, capacity: s[OUT + 11] as i32,
        boarding_range: s[OUT + 12], mass_max: s[OUT + 13], parts: s[OUT + 14] as i32,
        guns: s[OUT + 15] as i32, trunnions: s[OUT + 16] as i32, gates: s[OUT + 17] as u32,
    };
    // An illegal hull is not fielded. The gates are the core's, so the refusal
    // is too: a client that decided for itself which of its own designs were
    // allowed into a match would be the client that let one through. The stats
    // are left in the scratch either way, so a caller can read the gate bits
    // and say WHICH rule refused it.
    if !d.legal() {
        return 0;
    }
    unsafe {
        HULL_DESIGN[side as usize] = Some(d);
        HULL_MOUNTS[side as usize].clear();
    }
    // The class comes with it: a design is a hull of its own class, and the
    // spawn still needs to know which one.
    ft_hull_choice(side, class_idx as i32);
    1
}

/// One gun on a designed hull: what it is, where it sits, and where its own
/// ship is in the way.
///
/// Position is measured by the client off the socket the gun was fitted to,
/// and the arc mask is scanned off the same voxels it drew: both are numbers,
/// not rules. What they MEAN, which is whether a shot is legal, stays here.
///
/// The mask is `ARC_WORDS * 2` values written at `DERIVE_PARTS` before the
/// call, one bit per direction, set where the hull blocks it. HALF a word per
/// slot, low then high: the scratch buffer is f32 and carries whole numbers
/// exactly only to 2^24, so a word with its top bit set would arrive rounded
/// and the mount would come out blocked in directions nobody scanned. A caller
/// with nothing to say passes `masked = 0` and the mount has a clear field of
/// fire.
#[no_mangle]
pub extern "C" fn ft_hull_mount(side: u32, key: u32, x: f32, y: f32, z: f32, masked: u32) -> u32 {
    if side > 1 {
        return 0;
    }
    let k = match key {
        1 => WeaponKey::Cannon,
        2 => WeaponKey::Plasma,
        3 => WeaponKey::Missile,
        _ => WeaponKey::Beam,
    };
    let mut mask = [0u32; ARC_WORDS];
    if masked != 0 {
        let s = scratch();
        for (i, w) in mask.iter_mut().enumerate() {
            let lo = s[DERIVE_PARTS + i * 2].clamp(0.0, 65535.0) as u32;
            let hi = s[DERIVE_PARTS + i * 2 + 1].clamp(0.0, 65535.0) as u32;
            *w = lo | (hi << 16);
        }
    }
    unsafe {
        HULL_MOUNTS[side as usize].push((k, V3::new(x, y, z), mask));
    }
    1
}

/// Forget a side's design, so the next match is flown in the authored hull.
#[no_mangle]
pub extern "C" fn ft_hull_clear(side: u32) -> u32 {
    if side > 1 {
        return 0;
    }
    unsafe {
        HULL_DESIGN[side as usize] = None;
        HULL_MOUNTS[side as usize].clear();
    }
    ft_hull_choice(side, -1);
    1
}

/// Put a side's designed guns on its ships, without touching anything a turn
/// can change. Split out of `apply_designs` because a restore needs exactly
/// this and nothing else: the hull points and the subsystems it just read out
/// of the snapshot must not be handed back their starting values.
fn apply_mounts(sim: &mut Sim) {
    for side in 0..2usize {
        let mounts = unsafe { HULL_MOUNTS[side].clone() };
        if mounts.is_empty() {
            continue;
        }
        for ship in sim.ships.iter_mut().filter(|s| s.side as usize == side) {
            // Cooldowns survive: a restored mount is the same mount, and
            // forgetting when it last fired would hand a ship a free shot.
            // Cooldowns and damage both survive: a restored mount is the same
            // mount, and a gun that has been knocked off the hull does not come
            // back because the design was re-read.
            let fired: Vec<i32> = ship.weapons.iter().map(|w| w.last_fired_tick).collect();
            let hp: Vec<f32> = ship.weapons.iter().map(|w| w.hp).collect();
            ship.weapons = mounts
                .iter()
                .enumerate()
                .map(|(i, (key, at, mask))| WeaponSlot {
                    key: *key,
                    mount: *at,
                    arc_mask: *mask,
                    last_fired_tick: fired.get(i).copied().unwrap_or(-99),
                    hp: hp.get(i).copied().unwrap_or(crate::data::MOUNT_HP),
                })
                .collect();
        }
    }
}

/// Put a derived hull on every ship of a side.
///
/// Hull, mass, radius, the boarding pair and the flight envelope, because
/// those are what a design changes about a ship. The subsystem LAYOUT stays
/// the class's: where a reactor sits inside a hull is geometry the rasteriser
/// owns, and the rasteriser is still on the client.
fn apply_designs(sim: &mut Sim) {
    apply_mounts(sim);
    for side in 0..2usize {
        let Some(d) = (unsafe { HULL_DESIGN[side] }) else { continue };
        for ship in sim.ships.iter_mut().filter(|s| s.side as usize == side) {
            ship.hull = d.hull;
            ship.hull_max = d.hull;
            ship.mass = d.mass;
            ship.radius = d.radius;
            ship.marines = d.marines;
            ship.boarding_capacity = d.capacity;
            ship.boarding_range = d.boarding_range;
            ship.flight = Flight {
                yaw_rate: d.yaw_rate,
                pitch_rate: d.pitch_rate,
                accel_fwd: d.accel_fwd,
                accel_retro: d.accel_retro,
                accel_lat: d.accel_lat,
                max_speed: d.max_speed,
            };
        }
    }
}

#[no_mangle]
pub extern "C" fn ft_hull_choice(side: u32, class_idx: i32) -> u32 {
    if side > 1 {
        return 0;
    }
    unsafe {
        HULL_CHOICE[side as usize] = if class_idx < 0 || class_idx as usize >= ALL_CLASSES.len() {
            -1
        } else {
            class_idx
        };
    }
    1
}

/// Apply the choice to one side's spawn list, in place.
fn choose_hulls(side: usize, specs: &mut [SpawnSpec]) {
    let pick = unsafe { HULL_CHOICE[side] };
    if pick < 0 {
        return;
    }
    let class = crate::data::class_from_index(pick as u32);
    for s in specs.iter_mut() {
        s.class = class;
    }
}

#[no_mangle]
pub extern "C" fn ft_match_new(seed_hi: u32, seed_lo: u32, scenario: u32, human_sides: u32) -> u32 {
    // Written out by hand rather than with format!, which would drag Rust's
    // whole formatting machinery into the module for sixteen characters. The
    // result is byte identical to the server's lowercase hex seed, so a match
    // started here and one started from that string are the same match.
    let mut hex = [0u8; 16];
    for (i, byte) in hex.iter_mut().enumerate() {
        let word = if i < 8 { seed_hi } else { seed_lo };
        let nibble = (word >> (28 - 4 * (i % 8))) & 0xf;
        *byte = if nibble < 10 { b'0' + nibble as u8 } else { b'a' + (nibble as u8 - 10) };
    }
    let seed = core::str::from_utf8(&hex).unwrap_or("0000000000000000");
    let mask = (human_sides & 0b11) as u8;
    let sim = match scenario {
        1 => scenario_duel(seed, mask),
        2 => scenario_convoy(seed, mask),
        3 => scenario_low_orbit(seed, mask),
        4 => scenario_binary(seed, mask),
        5 => scenario_slingshot(seed, mask),
        6 => scenario_sandbox(seed, mask),
        _ => scenario_skirmish(seed, mask),
    };
    let mut sim = sim;
    apply_designs(&mut sim);
    let n = sim.ships.len();
    unsafe {
        MATCH = Some(sim);
    }
    if let Some(s) = sim_opt() {
        s.record = true;
    }
    let o = orders();
    o.clear();
    o.resize(n, None);
    events().clear();
    n as u32
}

fn spec(class: crate::data::ShipClassId, p: (f32, f32, f32), f: (f32, f32, f32)) -> SpawnSpec {
    SpawnSpec { class, pos: V3::new(p.0, p.1, p.2), facing: V3::new(f.0, f.1, f.2) }
}

/// Build a match from two spawn lists, applying each side's hull choice first.
///
/// Every scenario goes through here rather than calling `new_skirmish` itself,
/// so a scenario added later cannot quietly be the one that ignores the pick.
fn skirmish(
    seed: &str,
    mut player: Vec<SpawnSpec>,
    mut enemy: Vec<SpawnSpec>,
    faction: Faction,
    human_sides: u8,
) -> Sim {
    choose_hulls(0, &mut player);
    choose_hulls(1, &mut enemy);
    Sim::new_skirmish(seed, &player, &enemy, faction, human_sides)
}

fn scenario_skirmish(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    skirmish(
        seed,
        vec![
            spec(TerranFrigate, (-40.0, 0.0, 0.0), (1.0, 0.0, 0.0)),
            spec(TerranFrigate, (-40.0, 5.0, -15.0), (1.0, 0.0, 0.0)),
        ],
        vec![
            spec(KarisenFrigate, (40.0, 0.0, 5.0), (-1.0, 0.0, 0.0)),
            spec(RogueFrigate, (40.0, -4.0, -10.0), (-1.0, 0.0, 0.0)),
        ],
        Faction::Karisen,
        human_sides,
    )
}

fn scenario_duel(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    skirmish(
        seed,
        vec![spec(TerranFrigate, (-30.0, 0.0, 0.0), (1.0, 0.0, 0.0))],
        vec![spec(KarisenFrigate, (30.0, 0.0, 0.0), (-1.0, 0.0, 0.0))],
        Faction::Karisen,
        human_sides,
    )
}

/// A freighter worth taking rather than killing, escorted by something that
/// objects. The boarding rules only bite when there is a hull worth boarding.
fn scenario_convoy(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    skirmish(
        seed,
        vec![
            spec(RogueFrigate, (-35.0, 0.0, -10.0), (1.0, 0.0, 0.0)),
            spec(TerranFrigate, (-35.0, 4.0, 10.0), (1.0, 0.0, 0.0)),
        ],
        vec![
            spec(Freighter, (40.0, 0.0, 0.0), (-1.0, 0.0, 0.0)),
            spec(BenefactorFrigate, (30.0, -3.0, 18.0), (-1.0, 0.0, 0.0)),
        ],
        Faction::Benefactor,
        human_sides,
    )
}

/// Fought over something heavy. The well pulls at 0.096 u/s^2 at the start
/// line, which is a ninth of the main drive and about a third of the lateral
/// thrusters: enough to lean the reachable set without outgunning the RCS.
///
/// It used to pull 0.192, which is 77 percent of the lateral budget, and the
/// lean showed it. Probing straight up and straight down from a start:
///
/// ```text
/// no field      14 u up, 14 u down
/// 0.192 u/s^2    5 u up, 23 u down     4.6 to 1
/// 0.096 u/s^2    9 u up, 19 u down     2.1 to 1
/// ```
///
/// Five units of uphill reach is barely a hull length, so climbing was not a
/// choice a player could make. At half the pull the field still leans the
/// envelope two to one and a hull can still fly out of it.
///
/// The field is on the MATCH, so it is in the state hash and in the snapshot,
/// and both seats get it from the scenario id rather than from a client that
/// might have set it up differently.
fn scenario_low_orbit(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    let mut sim = skirmish(
        seed,
        vec![
            spec(TerranFrigate, (-40.0, 20.0, 0.0), (1.0, 0.0, 0.0)),
            spec(TerranFrigate, (-40.0, 26.0, -15.0), (1.0, 0.0, 0.0)),
        ],
        vec![
            spec(KarisenFrigate, (40.0, 22.0, 5.0), (-1.0, 0.0, 0.0)),
            spec(RogueFrigate, (40.0, 16.0, -10.0), (-1.0, 0.0, 0.0)),
        ],
        Faction::Karisen,
        human_sides,
    );
    sim.wells.push(Well::new(V3::new(0.0, -300.0, 0.0), 10000.0, 20.0));
    sim
}

/// The skirmish, with the ship stats unlocked.
///
/// A sandbox is not a different battle, it is the same one with the numbers
/// exposed, so it reuses the skirmish layout rather than inventing a set of
/// positions nobody balanced. What it changes is what the core will ACCEPT:
/// `ft_set_flight` is refused everywhere else.
///
/// A scenario rather than a client side switch, because the stats are in the
/// state hash. A flag the client owned could differ between two seats, and the
/// first slider either of them touched would part the match; coming from the
/// scenario id, both seats get it from the same place they get the field and
/// the starting positions.
fn scenario_sandbox(seed: &str, human_sides: u8) -> Sim {
    let mut sim = scenario_skirmish(seed, human_sides);
    sim.sandbox = true;
    sim
}

/// A binary, one either side. The pulls cancel on the centre line and add
/// further out, so a single number at the hull says nothing: sitting between
/// them the field reads zero while the envelope is stretched along the axis
/// joining them and squeezed across it.
///
/// 0.104 u/s^2 net at the start line, down from 0.255. That figure is the one
/// that made this scenario unflyable rather than tense: the lateral thrusters
/// are 0.25, so the field was taking a hull sideways faster than it could push
/// back.
fn scenario_binary(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    let mut sim = skirmish(
        seed,
        vec![spec(TerranFrigate, (0.0, 0.0, -35.0), (0.0, 0.0, 1.0))],
        vec![spec(KarisenFrigate, (0.0, 0.0, 35.0), (0.0, 0.0, -1.0))],
        Faction::Karisen,
        human_sides,
    );
    sim.wells.push(Well::new(V3::new(-160.0, 0.0, 0.0), 6500.0, 20.0));
    sim.wells.push(Well::new(V3::new(160.0, 0.0, 0.0), 6500.0, 20.0));
    sim
}

/// A well close enough to matter, off the line the two sides start on. At 0.09
/// u/s^2 it perturbs rather than dominates, which is the interesting band: 1.03
/// was measured and empties the reachable set entirely.
fn scenario_slingshot(seed: &str, human_sides: u8) -> Sim {
    use crate::data::ShipClassId::*;
    let mut sim = skirmish(
        seed,
        vec![spec(TerranFrigate, (-55.0, 0.0, -30.0), (1.0, 0.0, 0.3))],
        vec![
            spec(KarisenFrigate, (55.0, 0.0, -30.0), (-1.0, 0.0, 0.3)),
            spec(RogueFrigate, (60.0, 8.0, -45.0), (-1.0, 0.0, 0.3)),
        ],
        Faction::Karisen,
        human_sides,
    );
    sim.wells.push(Well::new(V3::new(0.0, 0.0, 60.0), 1000.0, 15.0));
    sim
}

/// The match's field, for a client drawing it: five floats a well from slot 64,
/// x, y, z, mu, soft. Returns the count.
#[no_mangle]
pub extern "C" fn ft_wells_read() -> u32 {
    let w = wells();
    let s = scratch();
    for (i, g) in w.iter().enumerate() {
        let b = 64 + i * 5;
        if b + 5 > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = g.pos.x;
        s[b + 1] = g.pos.y;
        s[b + 2] = g.pos.z;
        s[b + 3] = g.mu;
        s[b + 4] = g.soft;
    }
    w.len() as u32
}

/// The earliest second of this turn at which a mount may fire, given a shot
/// already planned at `prev_second` (negative for none).
///
/// The planner walks its own queue and asks this per weapon, so the spacing
/// itself is never computed in the renderer: the client owns WHAT is queued,
/// the core owns WHEN it is allowed.
#[no_mangle]
pub extern "C" fn ft_next_free_second(ship: u32, weapon: u32, prev_second: i32) -> i32 {
    let Some(sim) = sim_opt() else { return 0 };
    sim.next_free_second(ship as usize, weapon as usize, prev_second)
}

/// May this mount fire at this second of the current turn? The same gate the
/// resolver applies at the moment of firing.
#[no_mangle]
pub extern "C" fn ft_fire_gate(ship: u32, weapon: u32, second: i32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    sim.fire_gate(ship as usize, weapon as usize, second) as u32
}

#[no_mangle]
pub extern "C" fn ft_ship_count() -> u32 {
    sim_opt().map(|s| s.ships.len() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn ft_turn_index() -> i32 {
    sim_opt().map(|s| s.turn).unwrap_or(0)
}

/// -1 while the match is live, else the winning SIDE, 0 or 1. Which of those
/// is a victory is the client's question, since it depends on the seat.
#[no_mangle]
pub extern "C" fn ft_game_over() -> i32 {
    match sim_opt().and_then(|s| s.game_over) {
        None => -1,
        Some(Winner::Player) => 0,
        Some(Winner::Enemy) => 1,
    }
}

/// The state hash, split because the boundary carries 32 bit values.
#[no_mangle]
pub extern "C" fn ft_hash_hi() -> u32 {
    sim_opt().map(|s| (s.hash_state() >> 32) as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn ft_hash_lo() -> u32 {
    sim_opt().map(|s| s.hash_state() as u32).unwrap_or(0)
}

/// Write every ship as a fixed 40 slot record from slot 64. Returns the count.
#[no_mangle]
pub extern "C" fn ft_read_ships() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let n = sim.ships.len();
    let s = scratch();
    for (i, ship) in sim.ships.iter().enumerate() {
        let b = OUT + i * SHIP_STRIDE;
        if b + SHIP_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = ship.id as f32;
        s[b + 1] = class_index(ship.class) as f32;
        s[b + 2] = ship.faction.index() as f32;
        s[b + 3] = ship.side as f32;
        s[b + 4] = ship.destroyed as u32 as f32;
        s[b + 5] = ship.hull;
        s[b + 6] = ship.hull_max;
        s[b + 7] = ship.marines as f32;
        s[b + 8] = ship.pos.x;
        s[b + 9] = ship.pos.y;
        s[b + 10] = ship.pos.z;
        s[b + 11] = ship.quat.x;
        s[b + 12] = ship.quat.y;
        s[b + 13] = ship.quat.z;
        s[b + 14] = ship.quat.w;
        s[b + 15] = ship.vel.x;
        s[b + 16] = ship.vel.y;
        s[b + 17] = ship.vel.z;
        s[b + 18] = ship.mode as u32 as f32;
        s[b + 19] = ship.drift_active as u32 as f32;
        // How many volumes, and nothing about them: what each one IS comes
        // from `ft_read_subs`, which is the only place that answer lives. The
        // three fixed slots that used to sit here were a second copy of it,
        // and a second copy is a copy that will be wrong for a six volume hull
        // while still looking right for a three volume one.
        s[b + 20] = ship.subs.len() as f32;
        s[b + 21] = ship.weapons.len() as f32;
        for k in 0..3 {
            s[b + 22 + k] = ship.weapons.get(k).map(|w| w.last_fired_tick as f32).unwrap_or(-99.0);
        }
        s[b + 25] = ship.boarding_parties.len() as f32;
        for k in 0..2 {
            let (f, c) = match ship.boarding_parties.get(k) {
                Some(p) => (p.faction.index() as f32, p.count as f32),
                None => (-1.0, 0.0),
            };
            s[b + 26 + k * 2] = f;
            s[b + 27 + k * 2] = c;
        }
        // The SHIP's, not the class's: a designed hull carries its own radius
        // and its own reach, and reporting the class here would draw a ring
        // round a ship that is not the ring the resolver uses.
        s[b + 30] = ship.radius;
        s[b + 31] = ship.flight.max_speed;
        s[b + 32] = ship.ai_target.map(|t| t as f32).unwrap_or(-1.0);
        s[b + 33] = ship.boarding_range;
    }
    n as u32
}

/// Every ship's subsystems, in one call.
///
/// What a shot can be aimed at, what it does when it dies, and where it is:
/// the client needs all three to offer a target and to draw the marker on it,
/// and asking per ship would be four crossings a frame to save nothing. World
/// position rather than the class offset, because the volume moves with the
/// hull and a client that rotated the offset itself would be holding a second
/// opinion about which way the ship is facing.
#[no_mangle]
pub extern "C" fn ft_read_subs() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let s = scratch();
    let mut n = 0usize;
    for (si, ship) in sim.ships.iter().enumerate() {
        let defs = ship.class_def().subsystems;
        for (bi, sub) in ship.subs.iter().enumerate() {
            let b = OUT + n * SUB_STRIDE;
            if b + SUB_STRIDE > SCRATCH_LEN {
                return n as u32;
            }
            let def = &defs[sub.def];
            let at = ship.sub_world_pos(sub);
            s[b] = si as f32;
            s[b + 1] = bi as f32;
            s[b + 2] = sub_kind_index(def.kind) as f32;
            s[b + 3] = sub.hp;
            s[b + 4] = sub.max_hp;
            s[b + 5] = sub.dead as u32 as f32;
            s[b + 6] = at.x;
            s[b + 7] = at.y;
            s[b + 8] = at.z;
            // Half extents rather than a radius: the volume is a BOX in the
            // ship's own frame, so the client orients it with the same
            // quaternion it already draws the hull with.
            s[b + 9] = def.half.x;
            s[b + 10] = def.half.y;
            s[b + 11] = def.half.z;
            s[b + 12] = def.block_pct;
            n += 1;
        }
    }
    n as u32
}

/// The kind discriminants the client mirrors by position.
fn sub_kind_index(k: crate::data::SubKind) -> u32 {
    match k {
        crate::data::SubKind::Armor => 0,
        crate::data::SubKind::Thruster => 1,
        crate::data::SubKind::Rcs => 2,
        crate::data::SubKind::Weapon => 3,
        crate::data::SubKind::Reactor => 4,
    }
}

/// Flight stats for one ship, into the input slots the flight queries read.
/// Written there rather than somewhere new so a preview for a ship in the
/// match and a preview for a hypothetical one go through the same path.
#[no_mangle]
pub extern "C" fn ft_load_ship(ship: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let s = scratch();
    s[0] = sh.pos.x;
    s[1] = sh.pos.y;
    s[2] = sh.pos.z;
    s[3] = sh.vel.x;
    s[4] = sh.vel.y;
    s[5] = sh.vel.z;
    s[6] = sh.quat.x;
    s[7] = sh.quat.y;
    s[8] = sh.quat.z;
    s[9] = sh.quat.w;
    // What it can fly now rather than what its class was authored to fly. A
    // hull whose thrusters are gone previews as a hull that cannot turn, which is
    // the difference between finding out while planning and finding out while
    // watching the playback.
    let fl = sh.effective_flight();
    s[18] = fl.yaw_rate;
    s[19] = fl.pitch_rate;
    s[20] = fl.accel_fwd;
    s[21] = fl.accel_retro;
    s[22] = fl.accel_lat;
    s[23] = fl.max_speed;
    1
}

/// Retune one ship's flight envelope. The harness sliders drive this, and the
/// stats are in the state hash precisely so two clients flying different
/// envelopes cannot silently agree.
#[no_mangle]
pub extern "C" fn ft_set_flight(
    ship: u32,
    yaw: f32,
    pitch: f32,
    fwd: f32,
    retro: f32,
    lat: f32,
    max_speed: f32,
) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    // Refused outside a sandbox, and refused HERE rather than by a client
    // hiding a slider. Flight stats are in the state hash, so a seat that
    // could change them mid match could part the two clients on its own; a
    // rule that decides what the simulation accepts belongs in the simulation.
    if !sim.sandbox {
        return 0;
    }
    let Some(sh) = sim.ships.get_mut(ship as usize) else { return 0 };
    sh.flight = Flight {
        yaw_rate: yaw,
        pitch_rate: pitch,
        accel_fwd: fwd,
        accel_retro: retro,
        accel_lat: lat,
        max_speed,
    };
    1
}

/// Whether this match will accept a change to a hull's flight stats.
///
/// Asked rather than assumed: the client knows which scenario it launched, but
/// a console that decided on its own what the core would allow is a second
/// copy of the rule.
#[no_mangle]
pub extern "C" fn ft_sandbox() -> u32 {
    sim_opt().map(|s| s.sandbox as u32).unwrap_or(0)
}

// ---------------------------------------------------------------- orders --

#[no_mangle]
pub extern "C" fn ft_orders_clear() {
    for o in orders().iter_mut() {
        *o = None;
    }
}

#[allow(clippy::too_many_arguments)]
#[no_mangle]
pub extern "C" fn ft_set_move(
    ship: u32,
    mode: u32,
    has_target: u32,
    tx: f32,
    ty: f32,
    tz: f32,
    has_face: u32,
    fx: f32,
    fy: f32,
    fz: f32,
    has_roll: u32,
    roll: f32,
) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.mode = Some(Mode::from_u32(mode));
    entry.target = if has_target != 0 { Some(V3::new(tx, ty, tz)) } else { None };
    entry.face = if has_face != 0 { Some(V3::new(fx, fy, fz)) } else { None };
    entry.roll = if has_roll != 0 { Some(roll) } else { None };
    1
}

/// Queue one shot. `target_sub` is negative for "aim at the hull".
#[no_mangle]
pub extern "C" fn ft_add_fire(
    ship: u32,
    weapon_index: u32,
    second: i32,
    target_ship: u32,
    target_sub: i32,
) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.weapons.push(FireOrder {
        weapon_index: weapon_index as usize,
        second,
        target_ship: target_ship as u16,
        target_sub: if target_sub < 0 { None } else { Some(target_sub as usize) },
    });
    1
}

/// Clear just the queued shots for one ship, so a player can rebuild a
/// timeline without losing the movement order they already set.
#[no_mangle]
pub extern "C" fn ft_clear_fire(ship: u32) -> u32 {
    let o = orders();
    let Some(Some(entry)) = o.get_mut(ship as usize) else { return 0 };
    entry.weapons.clear();
    1
}

/// `target` negative cancels a boarding order.
#[no_mangle]
pub extern "C" fn ft_set_board(ship: u32, target: i32) -> u32 {
    let o = orders();
    let Some(slot) = o.get_mut(ship as usize) else { return 0 };
    let entry = slot.get_or_insert_with(Order::default);
    entry.board = if target < 0 { None } else { Some(target as u16) };
    1
}

/// Resolve the turn. Returns the number of events, which are then read in
/// pages through `ft_read_events`.
#[no_mangle]
pub extern "C" fn ft_resolve_turn() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let o = orders();
    if o.len() < sim.ships.len() {
        o.resize(sim.ships.len(), None);
    }
    let res = sim.resolve_turn(o);
    let ev = events();
    *ev = res.events;
    ev.len() as u32
}

/// Read events `from..from+max` into the scratch buffer, 14 slots each.
/// Paged because a busy turn can produce more events than the buffer holds,
/// and silently truncating the tail would lose exactly the interesting part.
#[no_mangle]
pub extern "C" fn ft_read_events(from: u32, max: u32) -> u32 {
    let ev = events();
    let s = scratch();
    let cap = ((SCRATCH_LEN - OUT) / EVENT_STRIDE) as u32;
    let take = max.min(cap);
    let mut n = 0u32;
    for i in 0..take {
        let Some(e) = ev.get((from + i) as usize) else { break };
        let b = OUT + (n as usize) * EVENT_STRIDE;
        s[b] = e.kind as u32 as f32;
        s[b + 1] = e.tick as f32;
        s[b + 2] = e.ship as f32;
        s[b + 3] = e.other as f32;
        s[b + 4] = e.aux as f32;
        s[b + 5] = e.amount;
        s[b + 6] = e.pos.x;
        s[b + 7] = e.pos.y;
        s[b + 8] = e.pos.z;
        s[b + 9] = e.to.x;
        s[b + 10] = e.to.y;
        s[b + 11] = e.to.z;
        s[b + 12] = 0.0;
        s[b + 13] = 0.0;
        n += 1;
    }
    n
}

// -------------------------------------------------------------- playback --

/// Ship poses at one recorded tick, 8 slots each. This is what the scrubber
/// reads: the renderer never re-simulates to draw a frame, so a replay shows
/// what happened rather than what would happen if it ran again.
#[no_mangle]
pub extern "C" fn ft_read_poses(tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(frame) = sim.tracks.get(tick.min(TICKS_PER_TURN) as usize) else { return 0 };
    let s = scratch();
    for (i, (p, q, dead)) in frame.ships.iter().enumerate() {
        let b = OUT + i * POSE_STRIDE;
        if b + POSE_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = i as f32;
        s[b + 1] = *dead as u32 as f32;
        s[b + 2] = p.x;
        s[b + 3] = p.y;
        s[b + 4] = p.z;
        s[b + 5] = q.x;
        s[b + 6] = q.y;
        s[b + 7] = q.z;
        s[b + 8] = q.w;
    }
    frame.ships.len() as u32
}

/// Projectiles at one recorded tick, 5 slots each, written after the poses.
#[no_mangle]
pub extern "C" fn ft_read_track_projectiles(tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(frame) = sim.tracks.get(tick.min(TICKS_PER_TURN) as usize) else { return 0 };
    let s = scratch();
    for (i, (id, kind, p)) in frame.projectiles.iter().enumerate() {
        let b = OUT + i * PROJ_STRIDE;
        if b + PROJ_STRIDE > SCRATCH_LEN {
            return i as u32;
        }
        s[b] = *id as f32;
        s[b + 1] = if *kind == ProjKind::Missile { 1.0 } else { 0.0 };
        s[b + 2] = p.x;
        s[b + 3] = p.y;
        s[b + 4] = p.z;
    }
    frame.projectiles.len() as u32
}

/// Preview a ship's turn without committing it: the same integrator the
/// resolver runs, from the ship's live state. Preview and execution are the
/// same code, which is the only way a drawn plan can be trusted.
#[no_mangle]
pub extern "C" fn ft_ship_preview(ship: u32, mode: u32, samples: u32) -> u32 {
    if ft_load_ship(ship) == 0 {
        return 0;
    }
    let stride = (TICKS_PER_TURN / samples.max(1)).max(1);
    ft_fly_turn(mode, TICKS_PER_TURN, stride)
}

/// One tick of a ship's plan, at the fixed tick rate. Used by the resolver's
/// sibling on the client: the ghost that shows where a ship WILL be.
#[no_mangle]
pub extern "C" fn ft_ship_pose_at(ship: u32, tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let s = scratch();
    let p = sh.pos_at_tick(tick as i32);
    let q = sh.quat_at_tick(tick as i32);
    s[32] = p.x;
    s[33] = p.y;
    s[34] = p.z;
    s[38] = q.x;
    s[39] = q.y;
    s[40] = q.z;
    s[41] = q.w;
    1
}

/// Fly a ship's remaining turn from an arbitrary tick, used by nothing on the
/// client yet but exercised by tests: it is the shape a mid turn re-plan takes
/// and it belongs at the boundary rather than in a test only build.
#[no_mangle]
pub extern "C" fn ft_ship_fly_from(ship: u32, mode: u32, from_tick: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let steps = (TICKS_PER_TURN - from_tick.min(TICKS_PER_TURN)).max(1);
    let flown = fly_span(
        sh.body(),
        sh.plan_target,
        Mode::from_u32(mode),
        &sh.effective_flight(),
        sh.plan_face,
        sh.plan_roll,
        steps,
        1.0 / TICKS_PER_SECOND as f32,
        wells(),
    );
    let s = scratch();
    s[32] = flown.end_pos.x;
    s[33] = flown.end_pos.y;
    s[34] = flown.end_pos.z;
    s[35] = flown.end_vel.x;
    s[36] = flown.end_vel.y;
    s[37] = flown.end_vel.z;
    1
}

/// Where a design's part list is written before `ft_derive` reads it.
///
/// Past the block the results come back in, so a caller can lay the parts down
/// once and read the answer without the two treading on each other.
pub const DERIVE_PARTS: usize = OUT + 32;

/// What a design comes out as: what it weighs, what it can take, how it flies.
///
/// The client measures its own voxel grid and passes the counts; every RULE
/// that turns those counts into a ship is here. It used to be the other way
/// round, with the editor doing the arithmetic, which is exactly the shortcut
/// ADR-2 exists to refuse: two clients that derived a design differently would
/// field two different ships from one record.
///
/// Parts are module INDICES into `design::MODULES`, written at `DERIVE_PARTS`
/// before the call. Results land at `OUT`:
///
/// ```text
///   0 mass          6 max speed    12 boarding range
///   1 hull          7 yaw rate     13 mass budget
///   2 radius        8 pitch rate   14 parts
///   3 accel fwd     9 nominal reach 15 guns
///   4 accel retro  10 marines      16 trunnions
///   5 accel lat    11 capacity     17 gate bits, one per check, set when it passes
/// ```
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn ft_derive(
    class_idx: u32,
    plate_cells: i32,
    ext_x: i32,
    ext_y: i32,
    ext_z: i32,
    radius_cells: f32,
    fouled: i32,
    parts: u32,
) -> u32 {
    let n = parts as usize;
    if DERIVE_PARTS + n > SCRATCH_LEN {
        return 0;
    }
    let s = scratch();
    let list: Vec<usize> = (0..n).map(|i| s[DERIVE_PARTS + i].max(0.0) as usize).collect();
    let geo = crate::design::Geometry {
        plate_cells,
        ext: [ext_x, ext_y, ext_z],
        radius_cells,
        fouled,
    };
    let d = crate::design::derive(class_from_index(class_idx), &list, geo);
    let s = scratch();
    s[OUT] = d.mass;
    s[OUT + 1] = d.hull;
    s[OUT + 2] = d.radius;
    s[OUT + 3] = d.accel_fwd;
    s[OUT + 4] = d.accel_retro;
    s[OUT + 5] = d.accel_lat;
    s[OUT + 6] = d.max_speed;
    s[OUT + 7] = d.yaw_rate;
    s[OUT + 8] = d.pitch_rate;
    s[OUT + 9] = d.reach_u;
    s[OUT + 10] = d.marines as f32;
    s[OUT + 11] = d.capacity as f32;
    s[OUT + 12] = d.boarding_range;
    s[OUT + 13] = d.mass_max;
    s[OUT + 14] = d.parts as f32;
    s[OUT + 15] = d.guns as f32;
    s[OUT + 16] = d.trunnions as f32;
    s[OUT + 17] = d.gates as f32;
    1
}

/// Class metadata the client draws from: hull, radius, mass, boarding range,
/// marine complement, mount count and the default flight envelope.
#[no_mangle]
pub extern "C" fn ft_read_class(index: u32) -> u32 {
    let cls = ship_class(class_from_index(index));
    let s = scratch();
    s[OUT] = cls.hull;
    s[OUT + 1] = cls.radius;
    s[OUT + 2] = cls.mass;
    s[OUT + 3] = cls.boarding_range;
    s[OUT + 4] = cls.marines as f32;
    s[OUT + 5] = cls.boarding_capacity as f32;
    s[OUT + 6] = cls.weapons.len() as f32;
    s[OUT + 7] = cls.subsystems.len() as f32;
    s[OUT + 8] = cls.flight.yaw_rate;
    s[OUT + 9] = cls.flight.pitch_rate;
    s[OUT + 10] = cls.flight.accel_fwd;
    s[OUT + 11] = cls.flight.accel_retro;
    s[OUT + 12] = cls.flight.accel_lat;
    s[OUT + 13] = cls.flight.max_speed;
    1
}

/// One weapon mount: which weapon it carries and what that weapon can do.
#[no_mangle]
pub extern "C" fn ft_read_mount(class_idx: u32, mount: u32) -> u32 {
    let cls = ship_class(class_from_index(class_idx));
    let Some(m) = cls.weapons.get(mount as usize) else { return 0 };
    let wd = crate::data::weapon(m.key);
    let s = scratch();
    s[OUT] = m.key as u32 as f32;
    s[OUT + 1] = wd.kind as u32 as f32;
    s[OUT + 2] = wd.damage();
    s[OUT + 3] = wd.range;
    s[OUT + 4] = wd.cooldown_secs;
    s[OUT + 5] = wd.arc_h.0;
    s[OUT + 6] = wd.arc_h.1;
    s[OUT + 7] = wd.arc_v.0;
    s[OUT + 8] = wd.arc_v.1;
    s[OUT + 9] = wd.batch as f32;
    s[OUT + 10] = m.mount.x;
    s[OUT + 11] = m.mount.y;
    s[OUT + 12] = m.mount.z;
    1
}

/// A ship's nominal reach: roughly how far it covers in a turn from rest.
///
/// Not a movement rule, and not what the envelope is made of. The integrator
/// decides where a ship can go and the client probes it cell by cell; this
/// only says how big a box is worth probing. Exposed rather than recomputed on
/// the client so the box, the AI's engagement distances and the flight stats
/// all come from one number instead of two that can drift apart.
#[no_mangle]
pub extern "C" fn ft_nominal_reach(ship: u32) -> f32 {
    sim_opt()
        .and_then(|s| s.ships.get(ship as usize))
        .map(|sh| sh.effective_flight().nominal_reach())
        .unwrap_or(0.0)
}

/// May this weapon fire this turn? The client greys out a mount with this, so
/// the answer must be the resolver's own, not a second copy of the rule.
#[no_mangle]
pub extern "C" fn ft_can_fire(ship: u32, weapon: u32) -> u32 {
    sim_opt().map(|s| s.can_fire(ship as usize, weapon as usize) as u32).unwrap_or(0)
}

/// Has this mount been knocked off the hull?
///
/// `ft_can_fire` already returns false for a mount that has gone, which greys
/// it out. This is asked separately because the client has a second thing to
/// do about it: stop DRAWING the turret. A gun knocked off a hull is not
/// cooling down and is not waiting for the bay, it is not there, and it is
/// never coming back, so the renderer takes it off rather than leaving a
/// barrel bolted to a hole.
#[no_mangle]
pub extern "C" fn ft_mount_gone(ship: u32, weapon: u32) -> u32 {
    sim_opt()
        .and_then(|s| s.ships.get(ship as usize))
        .and_then(|sh| sh.weapons.get(weapon as usize))
        .map(|w| w.destroyed() as u32)
        .unwrap_or(0)
}

/// Has this hull a weapon bay left to fire from?
///
/// `ft_can_fire` already returns false for every mount when the bay is gone,
/// which greys them out. This is the same answer asked separately so the
/// client can say WHY: a mount that reads "ready in 3s" when the bay is
/// wrecked sends a player off to wait for a shot that is never coming.
#[no_mangle]
pub extern "C" fn ft_weapon_bay(ship: u32) -> u32 {
    sim_opt()
        .and_then(|s| s.ships.get(ship as usize))
        .map(|sh| sh.has_live_weapon_bay() as u32)
        .unwrap_or(0)
}

/// The direction at the centre of every arc mask cell, in the ship's frame.
///
/// `ARC_YAW * ARC_PITCH` triples at `OUT`, in bit order, so cell `n` starts at
/// `OUT + n * 3`. Returns the number of cells written.
///
/// The client scans its own voxels to find where a hull blocks a turret, which
/// is a measurement of a picture the core cannot see. WHICH directions it must
/// measure is not a measurement: it is the mask's own geometry, and a client
/// that derived those angles from its platform's `sin` would set a different
/// bit on the boundary from the client next to it and desync over a shot one
/// seat allowed and the other did not. So the angles come from here, off the
/// same fixed polynomials the resolver reads the mask with.
#[no_mangle]
pub extern "C" fn ft_arc_dirs() -> u32 {
    use crate::math::{ARC_PITCH, ARC_YAW, PI};
    let s = scratch();
    let mut n = 0usize;
    for p in 0..ARC_PITCH {
        // Cell centres, which is what `arc_bit` would map back to this cell.
        let pitch = (p as f32 + 0.5) / ARC_PITCH as f32 * PI - PI / 2.0;
        let (cp, sp) = (crate::math::dcos(pitch), crate::math::dsin(pitch));
        for y in 0..ARC_YAW {
            let yaw = (y as f32 + 0.5) / ARC_YAW as f32 * (2.0 * PI) - PI;
            let b = OUT + n * 3;
            s[b] = crate::math::dsin(yaw) * cp;
            s[b + 1] = sp;
            s[b + 2] = crate::math::dcos(yaw) * cp;
            n += 1;
        }
    }
    n as u32
}

/// Which arc mask cell a direction in the SHIP's frame falls in.
///
/// The other half of `ft_arc_dirs`. The shipyard has no match to ask
/// `ft_can_bear`, but it still has to draw a turret refusing a bearing the
/// resolver would refuse, and the binning is `atan2` on fixed polynomials.
/// Asked rather than rebuilt, for the third time in this file and the same
/// reason: two answers to one question is one answer too many.
#[no_mangle]
pub extern "C" fn ft_arc_bit(x: f32, y: f32, z: f32) -> u32 {
    crate::math::arc_bit(V3::new(x, y, z)) as u32
}

/// Can this mount swing onto that target right now?
///
/// The arc question, asked of the core for the same reason `ft_can_fire` is:
/// a turret buried behind its own hull has a smaller field of fire than the
/// weapon's authored arc, and the client that offered the shot must be the
/// client whose shot the resolver honours. Aims at the same point the resolver
/// would: the named subsystem while it lives, the hull centre otherwise, so a
/// mount that can see the engines but not the bridge says so.
///
/// `sub` is the subsystem index, or negative for the hull centre.
#[no_mangle]
pub extern "C" fn ft_can_bear(ship: u32, weapon: u32, target: u32, sub: i32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(t) = sim.ships.get(target as usize) else { return 0 };
    let aim = match usize::try_from(sub).ok().and_then(|bi| t.subs.get(bi)) {
        Some(b) if !b.dead => t.sub_world_pos(b),
        _ => t.pos,
    };
    sim.bears(ship as usize, weapon as usize, aim) as u32
}

/// May this ship board that one right now? Same reason as above: the button
/// and the resolver have to agree, and the way to guarantee that is for the
/// button to ask.
#[no_mangle]
pub extern "C" fn ft_can_board(ship: u32, target: u32) -> u32 {
    sim_opt().map(|s| s.can_board(ship as usize, target as usize) as u32).unwrap_or(0)
}

/// A ship's nose direction, written to the output slots.
///
/// Forward is +Z rotated by the hull's quaternion, and which axis counts as
/// forward is a convention the renderer must not hold a second opinion about.
#[no_mangle]
pub extern "C" fn ft_ship_forward(ship: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let f = sh.quat.forward();
    let s = scratch();
    s[32] = f.x;
    s[33] = f.y;
    s[34] = f.z;
    1
}

/// A ship's roll about its own nose, in radians from wings level, written to
/// slot 32. Nose vertical has no wings level to measure from, so it reports 0
/// and says so with a 0 return rather than handing back an angle off noise.
///
/// Asked of the core rather than derived in the renderer for the same reason
/// forward is: which way is level is a convention the client must not hold a
/// second opinion about.
#[no_mangle]
pub extern "C" fn ft_ship_roll(ship: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    let s = scratch();
    match crate::flight::roll_of(sh.quat) {
        Some(r) => { s[32] = r; 1 }
        None => { s[32] = 0.0; 0 }
    }
}

/// The nose direction and roll of a GIVEN orientation, rather than of a ship's
/// current one.
///
/// Playback poses a hull from a recorded track, so the dials that read its
/// attitude have to read the same track. Deriving forward or roll from the
/// quaternion in the renderer would be a second opinion about which axis is
/// forward and which way is level, and those are the core's conventions.
///
/// Forward lands in slots 32..34 and roll in 35. Returns 0 when the nose is
/// vertical, where there is no wings level to measure a roll from.
#[no_mangle]
pub extern "C" fn ft_attitude_of(qx: f32, qy: f32, qz: f32, qw: f32) -> u32 {
    let q = Quat { x: qx, y: qy, z: qz, w: qw }.norm();
    let f = q.forward();
    let s = scratch();
    s[32] = f.x;
    s[33] = f.y;
    s[34] = f.z;
    match crate::flight::roll_of(q) {
        Some(r) => { s[35] = r; 1 }
        None => { s[35] = 0.0; 0 }
    }
}

/// What the AI will do with this hull this turn, asked BEFORE the turn runs.
///
/// The planner is a pure function of the boundary state: it takes `&Sim`, so it
/// cannot write, and it draws its own RNG stream from the seed, the turn and
/// the ship index rather than from the match's. Asking it early therefore
/// changes nothing and returns exactly what the resolver will get, because the
/// resolver asks it first, from this same untouched state.
///
/// Only for a hull the AI actually flies. A seat held by a person plans in
/// secret, and answering for one would hand a player the other's orders.
///
///   32     mode
///   33..35 destination
///   36     1 if it has one
///   37     the ship it means to shoot, or -1
#[no_mangle]
pub extern "C" fn ft_ai_preview(ship: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let Some(sh) = sim.ships.get(ship as usize) else { return 0 };
    if sh.destroyed || !sh.ai_enabled {
        return 0;
    }
    let pos = sh.pos;
    let plan = crate::ai::plan_ship(sim, ship as usize);
    let s = scratch();
    s[32] = plan.mode.unwrap_or(Mode::MoveAndTurn).to_u32() as f32;
    let t = plan.target.unwrap_or(pos);
    s[33] = t.x;
    s[34] = t.y;
    s[35] = t.z;
    s[36] = if plan.target.is_some() { 1.0 } else { 0.0 };
    s[37] = plan.ai_target.map(|i| i as f32).unwrap_or(-1.0);
    1
}

// ------------------------------------------------------------- snapshots --

/// How many f32 slots the current turn boundary state needs.
#[no_mangle]
pub extern "C" fn ft_snapshot_len() -> u32 {
    sim_opt().map(|s| s.snapshot_len() as u32).unwrap_or(0)
}

/// Write the turn boundary state from slot 64. Returns the slots written, or
/// 0 if it would not fit: a truncated snapshot is not a snapshot, and half of
/// one restores cleanly into a world that is quietly wrong.
#[no_mangle]
pub extern "C" fn ft_snapshot() -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let need = sim.snapshot_len();
    if OUT + need > SCRATCH_LEN {
        return 0;
    }
    let s = scratch();
    sim.write_snapshot(&mut s[OUT..OUT + need]).map(|n| n as u32).unwrap_or(0)
}

/// Restore a snapshot the caller has written from slot 64.
///
/// Returns 1 on success, 0 if refused. Refusal means the snapshot came from a
/// different match or a different layout version, both of which would restore
/// into something plausible and wrong.
#[no_mangle]
pub extern "C" fn ft_restore(count: u32) -> u32 {
    let Some(sim) = sim_opt() else { return 0 };
    let n = count as usize;
    if OUT + n > SCRATCH_LEN {
        return 0;
    }
    // The borrow has to end before restore_snapshot takes &mut Sim.
    let copy: Vec<f32> = scratch()[OUT..OUT + n].to_vec();
    let ok = sim.restore_snapshot(&copy).is_ok();
    // A restore rebuilds ships from their CLASS, so a designed hull would come
    // back with the class's guns: the wrong mounts, in the wrong places, with
    // no arc mask. The snapshot carries what changes during a match; which
    // guns a design fitted never does, so it is re-applied from the record the
    // match was started with rather than stored a second time in every turn.
    if ok {
        if let Some(sim) = sim_opt() {
            apply_mounts(sim);
        }
    }
    ok as u32
}
