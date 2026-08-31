//! Firing arcs: the authored one, the scanned one, and the bins they share.
//!
//! A turret is omnidirectional in this game. What stops it is its own hull,
//! and where its own hull is cannot be authored: it is whatever the player
//! built. So a mount carries a MASK, scanned off the design's voxels by the
//! client that drew them, and the resolver reads it here.
//!
//! Two things have to hold for that to be one rule rather than two. The bins
//! the client scans must be the bins the resolver reads, and a shot the
//! console offers must be a shot the resolver takes.

use sim_core::data::ShipClassId;
use sim_core::math::{arc_bit, arc_blocked, ARC_PITCH, ARC_WORDS, ARC_YAW, V3};
use sim_core::state::{Faction, SpawnSpec, Sim};
use sim_core::turn::{EventKind, FireOrder, Order};
use std::sync::{Mutex, MutexGuard};

/// `ft_arc_dirs` writes through the one scratch buffer, so it queues with
/// everything else that crosses the boundary.
static BOUNDARY: Mutex<()> = Mutex::new(());
fn alone() -> MutexGuard<'static, ()> {
    BOUNDARY.lock().unwrap_or_else(|e| e.into_inner())
}

const SOLO: u8 = 0b01;

fn duel(sep: f32) -> Sim {
    Sim::new_skirmish(
        "arcs",
        &[SpawnSpec {
            class: ShipClassId::TerranFrigate,
            pos: V3::new(0.0, 0.0, 0.0),
            facing: V3::new(0.0, 0.0, 1.0),
        }],
        &[SpawnSpec {
            class: ShipClassId::KarisenFrigate,
            pos: V3::new(0.0, 0.0, sep),
            facing: V3::new(0.0, 0.0, -1.0),
        }],
        Faction::Karisen,
        SOLO,
    )
}

#[test]
fn every_scanned_direction_lands_in_the_cell_it_was_scanned_for() {
    // The whole scheme rests on this. The client walks cells and asks the core
    // which way each one points; the resolver takes an aim direction and asks
    // which cell it falls in. If those two disagree by one cell, a mount is
    // blocked in a direction nothing was ever measured in, and the bug reads
    // as a turret that will not shoot at a target in plain sight.
    let _lock = alone();
    let n = sim_core::ffi::ft_arc_dirs() as usize;
    assert_eq!(n, ARC_YAW * ARC_PITCH, "one direction per cell");
    let s = unsafe { core::slice::from_raw_parts(sim_core::ffi::ft_scratch_ptr(), 16384) };
    for bit in 0..n {
        let b = 64 + bit * 3;
        let d = V3::new(s[b], s[b + 1], s[b + 2]);
        assert!((d.len() - 1.0).abs() < 1e-3, "cell {bit} is a unit direction: {}", d.len());
        assert_eq!(arc_bit(d), bit, "cell {bit} maps back to itself");
    }
}

#[test]
fn a_mask_refuses_the_shot_the_same_mount_would_otherwise_take() {
    // Same duel twice, and the only difference is a mask over the direction
    // the target is in. A gate the mask does not reach is a gate that does
    // nothing, which is exactly how this would fail silently.
    let clear = duel(30.0);
    let target = clear.ships[1].pos;
    assert!(clear.bears(0, 0, target), "nose to nose is a clear shot");

    let mut masked = duel(30.0);
    let mount = masked.ships[0].mount_world_pos(&masked.ships[0].weapons[0]);
    let local = masked.ships[0].quat.inv().rot(target.sub(mount).norm());
    let bit = arc_bit(local);
    masked.ships[0].weapons[0].arc_mask[bit >> 5] |= 1 << (bit & 31);
    assert!(!masked.bears(0, 0, target), "and the mask closes it");

    // And the resolver says so rather than quietly dropping the order.
    let mut orders: Vec<Option<Order>> = vec![None; masked.ships.len()];
    orders[0] = Some(Order {
        weapons: vec![FireOrder { weapon_index: 0, target_ship: 1, second: 0, target_sub: None }],
        ..Default::default()
    });
    let rec = masked.resolve_turn(&mut orders);
    assert!(
        rec.events.iter().any(|e| e.kind == EventKind::ShotSkippedArc && e.ship == 0),
        "a blocked mount reports the arc, not nothing",
    );
}

#[test]
fn the_authored_floor_still_bites_under_a_clear_mask() {
    // Every weapon is omnidirectional except the ten degrees under its own
    // mount, and that is authored rather than scanned: a mount cannot fire
    // through the plate it is bolted to whatever the hull above it looks
    // like. An empty mask must not widen it.
    let sim = duel(30.0);
    for w in &sim.ships[0].weapons {
        assert_eq!(w.arc_mask, [0u32; ARC_WORDS], "a class mount is unmasked");
    }
    let mount = sim.ships[0].mount_world_pos(&sim.ships[0].weapons[0]);
    // Straight down, well inside the floor.
    assert!(!sim.bears(0, 0, mount.add(V3::new(0.0, -20.0, 0.0))));
    // And straight up, which nothing forbids.
    assert!(sim.bears(0, 0, mount.add(V3::new(0.0, 20.0, 0.0))));
}

#[test]
fn a_mask_is_read_in_the_ships_frame_and_turns_with_it() {
    // The mask is fixed to the HULL, so a turret blocked astern is blocked
    // astern wherever the ship is pointing. Read in world coordinates instead
    // it would be blocked in a compass direction, which is a different game
    // and a very confusing one.
    let mut sim = duel(30.0);
    let target = sim.ships[1].pos;
    let mount = sim.ships[0].mount_world_pos(&sim.ships[0].weapons[0]);
    let bit = arc_bit(sim.ships[0].quat.inv().rot(target.sub(mount).norm()));
    sim.ships[0].weapons[0].arc_mask[bit >> 5] |= 1 << (bit & 31);
    assert!(!sim.bears(0, 0, target));

    // Turn the ship about, and the same blocked cell now points the other way.
    sim.ships[0].quat = sim_core::math::Quat::look(V3::new(0.0, 0.0, -1.0), None);
    assert!(sim.bears(0, 0, target), "the hole in the arc turned with the hull");
}

#[test]
fn an_unset_mask_blocks_nothing_anywhere() {
    // The default has to be permissive: a class ship carries no design and
    // therefore no scan, and a mask that defaulted to blocked would silence
    // every stock hull in the game.
    let empty = [0u32; ARC_WORDS];
    let _lock = alone();
    let n = sim_core::ffi::ft_arc_dirs() as usize;
    let s = unsafe { core::slice::from_raw_parts(sim_core::ffi::ft_scratch_ptr(), 16384) };
    for bit in 0..n {
        let b = 64 + bit * 3;
        assert!(!arc_blocked(&empty, V3::new(s[b], s[b + 1], s[b + 2])));
    }
}

#[test]
fn two_seats_that_scanned_different_arcs_part_at_once() {
    // Lockstep's whole promise. The mask decides whether a shot happens, so a
    // client that scanned its own hull differently is playing a different
    // match; hashing the mask means it says so on the turn it happens rather
    // than several turns later when one seat has quietly missed a shot.
    let plain = duel(30.0);
    let mut odd = duel(30.0);
    odd.ships[0].weapons[0].arc_mask[7] |= 0x8000_0001;
    assert_ne!(plain.hash_state(), odd.hash_state(), "the mask is in the hash");

    // And where the mount SITS, for the same reason: a design puts guns in
    // different places and a shot leaves from where the gun is.
    let mut moved = duel(30.0);
    moved.ships[0].weapons[0].mount = moved.ships[0].weapons[0].mount.add(V3::new(0.0, 0.5, 0.0));
    assert_ne!(plain.hash_state(), moved.hash_state(), "and so is the mount");
}
