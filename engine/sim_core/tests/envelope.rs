//! The two envelope samplers.
//!
//! Both decide WHERE to ask, never what the answer is: every cell they report
//! comes from the same `can_reach` the resolver uses. So the thing to pin is
//! that the cheap traversal agrees with the exhaustive one, and that both move
//! when the simulation underneath them moves.

use sim_core::ffi::*;
use std::sync::{Mutex, MutexGuard};

/// The boundary is single threaded by construction: one scratch buffer, one
/// match, one field, because wasm has one thread and a handle in every call
/// would buy nothing. Cargo runs tests in parallel, so they take this first.
/// Without it a test that adds a well changes the answer another one is in the
/// middle of reading, which fails intermittently and looks like a bug in the
/// traversal rather than in the harness.
static BOUNDARY: Mutex<()> = Mutex::new(());
fn alone() -> MutexGuard<'static, ()> {
    BOUNDARY.lock().unwrap_or_else(|e| e.into_inner())
}

const EPS: f32 = 1.6;
const STEPS: u32 = 60;

/// Slot layout, mirrored from web/src/sim/wasm.ts.
fn set_body(speed: f32) {
    let s = ft_scratch_slice();
    for v in s.iter_mut() {
        *v = 0.0;
    }
    s[9] = 1.0; // quat w
    s[5] = speed; // vel z
    let flight = [6.0f32, 4.0, 0.9, 0.35, 0.25, 8.0];
    s[18..24].copy_from_slice(&flight);
}

fn dense_hits(n: u32, half: f32) -> u32 {
    ft_reach_grid(0, EPS, STEPS, n, 0.0, 0.0, 0.0, half)
}

/// A leaf the octree reports has to be a real boundary cell, which means its
/// eight corners must not agree. The corner bits ride along in word 1 so a
/// caller can march without probing again, and that is what this checks.
#[test]
fn every_leaf_the_octree_reports_actually_straddles() {
    let _lock = alone();
    set_body(4.0);
    let n = 16;
    let count = ft_reach_octree(0, EPS, STEPS, 4, n, 0.0, 0.0, 40.0, 0.0, 0.0, 1.0, 45.0, 45.0, 60.0);
    assert!(count > 0, "found nothing to draw");
    let out = ft_octree_slice();
    let mut leaves = 0;
    let mut blocks = 0;
    for c in 0..count as usize {
        let word = out[c * 2];
        let bits = out[c * 2 + 1];
        let uniform = bits & (1 << 8) != 0;
        let corners = bits & 0xff;
        if uniform {
            assert!(corners == 0x00 || corners == 0xff, "a uniform block agrees with itself");
            blocks += 1;
        } else {
            assert_ne!(corners, 0x00, "leaf {c} is entirely outside the set");
            assert_ne!(corners, 0xff, "leaf {c} is entirely inside the set");
            assert_eq!(word >> 24, 0, "a straddling leaf is always at the finest level");
            leaves += 1;
        }
        for shift in [0u32, 8, 16] {
            assert!((word >> shift) & 0xff < n, "cell index inside the grid");
        }
    }
    assert!(leaves > 0 && blocks > 0, "{leaves} leaves and {blocks} blocks");
}

/// Leaves and uniform blocks together have to account for the WHOLE grid, or a
/// caller rebuilding a dense field from them is left with holes it will march
/// through as if they were empty space.
#[test]
fn the_entries_tile_the_whole_grid() {
    let _lock = alone();
    set_body(4.0);
    let n = 16usize;
    let count = ft_reach_octree(
        0, EPS, STEPS, 4, n as u32, 0.0, 0.0, 40.0, 0.0, 0.0, 1.0, 45.0, 45.0, 60.0,
    );
    let out = ft_octree_slice();
    let mut covered = vec![0u32; n * n * n];
    for c in 0..count as usize {
        let word = out[c * 2];
        let (i, j, k) = (
            (word & 0xff) as usize,
            ((word >> 8) & 0xff) as usize,
            ((word >> 16) & 0xff) as usize,
        );
        let size = 1usize << (word >> 24);
        for a in i..i + size {
            for b in j..j + size {
                for d in k..k + size {
                    covered[(a * n + b) * n + d] += 1;
                }
            }
        }
    }
    for (idx, c) in covered.iter().enumerate() {
        assert_eq!(*c, 1, "cell {idx} covered {c} times, should be exactly once");
    }
}

/// The point of descending only where corners disagree is that it must not
/// change the answer, only the cost of reaching it.
#[test]
fn a_coarser_root_finds_the_same_surface() {
    let _lock = alone();
    set_body(4.0);
    let mut counts = Vec::new();
    for base in [2u32, 4, 8] {
        let n = ft_reach_octree(
            0, EPS, STEPS, base, 16, 0.0, 0.0, 40.0, 0.0, 0.0, 1.0, 45.0, 45.0, 60.0,
        );
        // Only the straddling leaves. The uniform blocks legitimately differ:
        // a coarse root settles the empty corners of the box in one big block
        // where a fine root reports several small ones, and both describe the
        // same space. The SURFACE is what must not move.
        let out = ft_octree_slice();
        counts.push(
            (0..n as usize).filter(|c| out[c * 2 + 1] & (1 << 8) == 0).count(),
        );
    }
    assert!(counts[0] > 0);
    for c in &counts {
        assert_eq!(*c, counts[0], "the root size is a cost, not an answer: {counts:?}");
    }
}

#[test]
fn a_non_power_of_two_is_refused_rather_than_guessed_at() {
    let _lock = alone();
    set_body(0.0);
    assert_eq!(
        ft_reach_octree(0, EPS, STEPS, 4, 12, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 40.0, 40.0, 40.0),
        0
    );
}

#[test]
fn the_radius_field_lands_on_the_boundary() {
    let _lock = alone();
    set_body(0.0);
    let n = ft_reach_radii(0, EPS, STEPS, 16, 9, 14, 0.0, 0.0, 0.0, 200.0);
    assert_eq!(n, 16 * 9);
    let s = ft_scratch_slice();
    for i in 0..n as usize {
        let r = s[64 + i];
        assert!(r > 1.0 && r < 200.0, "radius {r} is not on a boundary");
    }
}

/// Every theta at a pole is the same direction, so those samples have to agree
/// exactly or a fitted surface gets a dimple in it.
#[test]
fn the_poles_agree_across_theta() {
    let _lock = alone();
    set_body(4.0);
    let (nu, nv) = (24usize, 13usize);
    ft_reach_radii(0, EPS, STEPS, nu as u32, nv as u32, 14, 0.0, 0.0, 40.0, 200.0);
    let s = ft_scratch_slice();
    for v in [0usize, nv - 1] {
        let first = s[64 + v];
        for u in 0..nu {
            assert_eq!(s[64 + u * nv + v], first, "pole sample {u} disagrees");
        }
    }
}

/// The samplers are worth nothing if they cannot see the simulation change
/// under them. A well below the ship must pull the boundary down.
#[test]
fn the_field_moves_the_radius_field() {
    let _lock = alone();
    set_body(0.0);
    ft_wells_clear();
    let (nu, nv) = (16usize, 9usize);
    ft_reach_radii(0, EPS, STEPS, nu as u32, nv as u32, 14, 0.0, 0.0, 0.0, 200.0);
    let free_up = ft_scratch_slice()[64];              // phi 0 is +Y
    let free_down = ft_scratch_slice()[64 + nv - 1];   // phi pi is -Y

    ft_well_add(0.0, -300.0, 0.0, 20000.0, 10.0);
    assert_eq!(ft_well_count(), 1);
    ft_reach_radii(0, EPS, STEPS, nu as u32, nv as u32, 14, 0.0, 0.0, 0.0, 200.0);
    let pulled_up = ft_scratch_slice()[64];
    let pulled_down = ft_scratch_slice()[64 + nv - 1];
    ft_wells_clear();

    assert!(pulled_down > free_down, "downhill reach {pulled_down} vs {free_down}");
    assert!(pulled_up < free_up, "uphill reach {pulled_up} vs {free_up}");
}

#[test]
fn the_field_is_readable_where_the_client_draws_it() {
    let _lock = alone();
    ft_wells_clear();
    ft_well_add(0.0, 0.0, 100.0, 400.0, 5.0);
    ft_gravity_at(0.0, 0.0, 0.0);
    let s = ft_scratch_slice();
    assert!(s[34] > 0.0, "pulls toward +Z");
    assert!(s[32].abs() < 1e-6 && s[33].abs() < 1e-6);
    ft_wells_clear();
    ft_gravity_at(0.0, 0.0, 0.0);
    let s = ft_scratch_slice();
    assert_eq!([s[32], s[33], s[34]], [0.0, 0.0, 0.0], "no wells, no field");
}

/// A sanity floor under both: the dense probe still works and still finds
/// something, so a zero from the traversal would be a real regression.
#[test]
fn the_dense_probe_still_finds_the_set() {
    let _lock = alone();
    set_body(0.0);
    assert!(dense_hits(12, 60.0) > 0);
}
