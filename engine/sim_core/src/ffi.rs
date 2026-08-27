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
//!
//!   OUT 32..34  end position
//!       35..37  end velocity
//!       38..41  end orientation
//!       42      1 if the mode is committed
//!       64..    path samples, 7 floats each: pos(3) + quat(4)
//!
//! Everything is f32 and little endian on both sides, which wasm guarantees.

use crate::flight::{can_reach, fly_turn, Body, Flight, Mode};
use crate::math::{Quat, V3};

const SCRATCH_LEN: usize = 64 + 7 * 601;
static mut SCRATCH: [f32; SCRATCH_LEN] = [0.0; SCRATCH_LEN];

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

fn read_inputs(s: &[f32]) -> (Body, Option<V3>, Option<V3>, Flight) {
    let body = Body {
        pos: V3::new(s[0], s[1], s[2]),
        vel: V3::new(s[3], s[4], s[5]),
        quat: Quat { x: s[6], y: s[7], z: s[8], w: s[9] },
    };
    let target = if s[16] != 0.0 { Some(V3::new(s[10], s[11], s[12])) } else { None };
    let face = if s[17] != 0.0 { Some(V3::new(s[13], s[14], s[15])) } else { None };
    let fl = Flight {
        yaw_rate: s[18],
        pitch_rate: s[19],
        accel_fwd: s[20],
        accel_retro: s[21],
        accel_lat: s[22],
        max_speed: s[23],
    };
    (body, target, face, fl)
}

/// Fly one turn. Returns how many path samples were written from slot 64.
///
/// `sample_stride` thins the recorded path: 1 keeps every slice, 10 keeps every
/// tenth. The renderer wants a few dozen points for a line, not 601.
#[no_mangle]
pub extern "C" fn ft_fly_turn(mode: u32, steps: u32, sample_stride: u32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, target, face, fl) = read_inputs(s);
    let mode = Mode::from_u32(mode);
    let target = if mode.committed() { None } else { target };

    let flown = fly_turn(body, target, mode, &fl, face, steps);

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
    let (body, _t, face, fl) = read_inputs(s);
    let target = V3::new(s[10], s[11], s[12]);
    can_reach(body, target, Mode::from_u32(mode), &fl, face, eps, steps) as u32
}

/// Sweep a whole grid of candidate cells in one call, so probing an envelope
/// costs one boundary crossing instead of several thousand. Cells are written
/// back as a bitmask, 32 cells per u32, from slot 64.
#[no_mangle]
pub extern "C" fn ft_reach_grid(mode: u32, eps: f32, steps: u32, n: u32, cx: f32, cy: f32, cz: f32, half: f32) -> u32 {
    let s: &mut [f32] = unsafe { &mut *(&raw mut SCRATCH) };
    let (body, _t, face, fl) = read_inputs(s);
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
                if can_reach(body, V3::new(x, y, z), mode, &fl, face, eps, steps) {
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
