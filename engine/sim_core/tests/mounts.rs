//! A mount knocked off a hull is gone, and gone for good.
//!
//! Two halves of one rule, and they are different things. The weapons BAY
//! feeds every gun on the ship, so losing it silences all of them at once and
//! it is a condition of the hull. A MOUNT is bolted to the structure around
//! it, so fire on that structure takes the gun with it, and that is permanent:
//! there is no repair, and a turret that has left the hull never fires again.
//!
//! Pinned here because it is exactly the kind of rule that gets reimplemented
//! in a renderer. The client draws a turret and it must ask whether the mount
//! is still there rather than deciding for itself.

use sim_core::data::{self, ShipClassId};
use sim_core::math::V3;
use sim_core::state::{Faction, Sim, SpawnSpec};

const SOLO: u8 = 0b01;

fn pair() -> Sim {
    Sim::new_skirmish(
        "mounts",
        &[SpawnSpec {
            class: ShipClassId::TerranFrigate,
            pos: V3::ZERO,
            facing: V3::new(0.0, 0.0, 1.0),
        }],
        &[SpawnSpec {
            class: ShipClassId::KarisenFrigate,
            pos: V3::new(0.0, 0.0, 60.0),
            facing: V3::new(0.0, 0.0, -1.0),
        }],
        Faction::Karisen,
        SOLO,
    )
}

/// Where mount `w` of ship 0 is, in the world.
fn mount_world(sim: &Sim, w: usize) -> V3 {
    let ship = &sim.ships[0];
    ship.pos.add(ship.quat.rot(ship.weapons[w].mount))
}

#[test]
fn a_mount_starts_whole_and_can_fire() {
    let sim = pair();
    assert!(!sim.ships[0].weapons.is_empty(), "a frigate has mounts");
    for w in &sim.ships[0].weapons {
        assert!(!w.destroyed());
        assert_eq!(w.hp, data::MOUNT_HP);
    }
    assert!(sim.can_fire(0, 0));
}

#[test]
fn fire_on_the_structure_around_a_mount_knocks_it_off() {
    let mut sim = pair();
    let at = mount_world(&sim, 0);
    let mut events = Vec::new();
    // Enough to take the mount, delivered where the mount actually is.
    let mut n = 0;
    while !sim.ships[0].weapons[0].destroyed() && n < 40 {
        sim.apply_damage(0, None, 10.0, None, &mut events, 0, Some(at));
        n += 1;
    }
    assert!(sim.ships[0].weapons[0].destroyed(), "the mount should have come off");
    assert!(!sim.can_fire(0, 0), "a mount that has left the hull cannot fire");
}

#[test]
fn a_shot_elsewhere_on_the_hull_does_not_take_a_mount_with_it() {
    let mut sim = pair();
    // ON the ship, and away from this mount. The first version of this test
    // fired forty units off the hull entirely, which is a distance no radius
    // could fail, and it passed happily while MOUNT_RADIUS was wide enough to
    // swallow the whole frigate. A test has to be able to fail.
    let far = mount_world(&sim, 0).add(V3::new(0.0, 0.0, 1.5));
    let mut events = Vec::new();
    for _ in 0..40 {
        sim.apply_damage(0, None, 10.0, None, &mut events, 0, Some(far));
    }
    assert!(
        !sim.ships[0].weapons[0].destroyed(),
        "a mount should survive fire 1.5 units away, which is elsewhere on the same hull",
    );
}

#[test]
fn the_catch_radius_is_a_turret_and_not_a_ship() {
    // The number that went wrong, pinned as the relationship it has to hold.
    // A sphere of MOUNT_RADIUS must be small beside the hull it sits on, or
    // every hit anywhere damages every mount and a ship loses all its guns at
    // once, which is what happened at 1.1.
    let sim = pair();
    let hull = sim.ships[0].radius;
    assert!(
        data::MOUNT_RADIUS < hull * 0.25,
        "MOUNT_RADIUS {} is not small beside a hull of radius {}",
        data::MOUNT_RADIUS,
        hull,
    );
}

#[test]
fn a_mount_is_never_repaired() {
    let mut sim = pair();
    let at = mount_world(&sim, 0);
    let mut events = Vec::new();
    for _ in 0..40 {
        sim.apply_damage(0, None, 10.0, None, &mut events, 0, Some(at));
    }
    assert!(sim.ships[0].weapons[0].destroyed());
    // The path that could plausibly hand it back: a restore, which is how a
    // replay and the other seat both rebuild a turn.
    let mut buf = vec![0.0f32; sim.snapshot_len()];
    sim.write_snapshot(&mut buf).expect("a snapshot fits its own length");
    let mut back = pair();
    back.restore_snapshot(&buf).expect("it restores");
    assert!(back.ships[0].weapons[0].destroyed(), "a restore must not undo it");
    assert!(!back.can_fire(0, 0));
}
