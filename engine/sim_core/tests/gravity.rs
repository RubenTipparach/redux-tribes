//! The gravity field.
//!
//! A field is environmental, so it lives on the match rather than on a hull,
//! and it decides outcomes, so it is in the state hash and in the snapshot.
//! These tests pin the three things that makes true: it does nothing when
//! empty, it does something when not, and a turn flown through one can be
//! restored and re-run to the same hash.

use sim_core::data::ShipClassId;
use sim_core::state::{Faction, Sim, SpawnSpec};
use sim_core::{can_reach, fly_turn, gravity_at, Body, Flight, Mode, Quat, Well, V3};

const STEPS: u32 = 600;

fn ship(vel: V3) -> Body {
    Body { pos: V3::ZERO, vel, quat: Quat::IDENTITY }
}

/// The whole existing suite runs with no wells, so this is the guarantee that
/// makes it meaningful: an empty field is not merely close to the old flight
/// model, it is bit identical to it.
#[test]
fn an_empty_field_changes_nothing() {
    let fl = Flight::default();
    for vel in [V3::ZERO, V3::new(0.0, 0.0, 4.0), V3::new(1.0, -2.0, 3.0)] {
        for mode in [Mode::MoveAndTurn, Mode::TurnSlide, Mode::FullSpeed, Mode::Drift] {
            let a = fly_turn(ship(vel), Some(V3::new(30.0, 10.0, 40.0)), mode, &fl, None, None, STEPS, &[]);
            let b = fly_turn(
                ship(vel),
                Some(V3::new(30.0, 10.0, 40.0)),
                mode, &fl, None, None, STEPS,
                &[Well::new(V3::new(0.0, 500.0, 0.0), 0.0, 10.0)],
            );
            assert_eq!(a.end_pos.x.to_bits(), b.end_pos.x.to_bits());
            assert_eq!(a.end_pos.y.to_bits(), b.end_pos.y.to_bits());
            assert_eq!(a.end_pos.z.to_bits(), b.end_pos.z.to_bits());
        }
    }
}

#[test]
fn the_field_points_at_the_well_and_falls_off_as_the_square() {
    let w = [Well::new(V3::new(0.0, 0.0, 100.0), 400.0, 5.0)];
    let near = gravity_at(V3::new(0.0, 0.0, 50.0), &w);
    let far = gravity_at(V3::new(0.0, 0.0, 0.0), &w);
    assert!(near.z > 0.0 && far.z > 0.0, "both pull toward the well");
    assert!(near.x.abs() < 1e-6 && near.y.abs() < 1e-6, "on axis, no side force");
    // half the distance is four times the pull
    let ratio = near.len() / far.len();
    assert!((ratio - 4.0).abs() < 0.01, "inverse square, got {ratio}");
}

/// Without softening a close pass divides by something near zero and throws
/// the hull to infinity, which is a NaN in the state hash on someone else's
/// machine rather than an interesting flyby.
#[test]
fn softening_keeps_the_centre_finite() {
    let w = [Well::new(V3::ZERO, 1000.0, 8.0)];
    let at_centre = gravity_at(V3::ZERO, &w);
    assert!(at_centre.len().is_finite());
    let edge = gravity_at(V3::new(8.0, 0.0, 0.0), &w).len();
    let inside = gravity_at(V3::new(4.0, 0.0, 0.0), &w).len();
    assert!(inside <= edge + 1e-4, "the field stops growing inside the softening radius");
}

#[test]
fn a_drifting_hull_falls() {
    let fl = Flight::default();
    let w = [Well::new(V3::new(0.0, -200.0, 0.0), 4000.0, 10.0)];
    let free = fly_turn(ship(V3::ZERO), None, Mode::Drift, &fl, None, None, STEPS, &[]);
    let fell = fly_turn(ship(V3::ZERO), None, Mode::Drift, &fl, None, None, STEPS, &w);
    assert!(free.end_pos.y.abs() < 1e-6, "nothing to fall toward");
    assert!(fell.end_pos.y < -1.0, "fell {} units", fell.end_pos.y);
}

/// The envelope is what the client draws, and a field moves it. Downhill
/// should reach further than uphill through the same stats.
#[test]
fn the_field_leans_the_reachable_set() {
    let fl = Flight::default();
    let w = [Well::new(V3::new(0.0, -300.0, 0.0), 20000.0, 10.0)];
    let mut down = 0.0f32;
    let mut up = 0.0f32;
    for r in 1..200 {
        let d = r as f32;
        if can_reach(ship(V3::ZERO), V3::new(0.0, -d, 0.0), Mode::MoveAndTurn, &fl, None, None, 1.6, 60, &w) {
            down = d;
        }
        if can_reach(ship(V3::ZERO), V3::new(0.0, d, 0.0), Mode::MoveAndTurn, &fl, None, None, 1.6, 60, &w) {
            up = d;
        }
    }
    assert!(down > up, "downhill {down} should beat uphill {up}");
}

fn two_ship_match(wells: Vec<Well>) -> Sim {
    let mut sim = Sim::new_skirmish(
        "gravity-seed",
        &[SpawnSpec {
            class: ShipClassId::TerranFrigate,
            pos: V3::new(-20.0, 0.0, 0.0),
            facing: V3::new(1.0, 0.0, 0.0),
        }],
        &[SpawnSpec {
            class: ShipClassId::TerranFrigate,
            pos: V3::new(20.0, 0.0, 0.0),
            facing: V3::new(-1.0, 0.0, 0.0),
        }],
        Faction::Terran,
        3,
    );
    sim.wells = wells;
    sim
}

#[test]
fn the_field_is_in_the_state_hash() {
    let empty = two_ship_match(Vec::new());
    let pulled = two_ship_match(vec![Well::new(V3::new(0.0, -100.0, 0.0), 900.0, 8.0)]);
    let moved = two_ship_match(vec![Well::new(V3::new(0.0, 100.0, 0.0), 900.0, 8.0)]);
    assert_ne!(empty.hash_state(), pulled.hash_state(), "a field must change the hash");
    assert_ne!(pulled.hash_state(), moved.hash_state(), "so must moving it");
}

/// A zero strength well is not the same match as no well at all: it is one
/// more number both seats have to agree on.
#[test]
fn a_zero_strength_well_still_counts() {
    let none = two_ship_match(Vec::new());
    let inert = two_ship_match(vec![Well::new(V3::ZERO, 0.0, 1.0)]);
    assert_ne!(none.hash_state(), inert.hash_state());
}

#[test]
fn a_turn_in_a_field_replays_to_the_same_hash() {
    let wells = vec![
        Well::new(V3::new(0.0, -120.0, 30.0), 6000.0, 12.0),
        Well::new(V3::new(60.0, 40.0, -20.0), 2000.0, 8.0),
    ];
    let mut sim = two_ship_match(wells.clone());
    let mut buf = vec![0.0f32; 8192];
    let n = sim.write_snapshot(&mut buf).expect("snapshot fits");
    sim.resolve_turn(&mut [None, None]);
    let after = sim.hash_state();

    let mut fresh = two_ship_match(Vec::new());
    fresh.restore_snapshot(&buf[..n]).expect("restores");
    assert_eq!(fresh.wells.len(), 2, "the field came back with the turn");
    fresh.resolve_turn(&mut [None, None]);
    assert_eq!(fresh.hash_state(), after, "same field, same orders, same hash");
}

/// The restore above is only proof if dropping the field would have been
/// caught. Re-running the same turn through empty space must NOT agree.
#[test]
fn replaying_without_the_field_parts() {
    let wells = vec![Well::new(V3::new(0.0, -120.0, 30.0), 6000.0, 12.0)];
    let mut with = two_ship_match(wells);
    let mut without = two_ship_match(Vec::new());
    with.resolve_turn(&mut [None, None]);
    without.resolve_turn(&mut [None, None]);
    assert_ne!(with.hash_state(), without.hash_state());
}

/// Fly into a world and you are part of it.
///
/// The well's softening radius is the body's own radius, so crossing it is the
/// surface rather than a near miss. Checked both ways round in one fixture,
/// because a rule that kills everything near a planet would pass a test that
/// only looked for the death.
#[test]
fn a_hull_that_reaches_a_world_dies_on_it() {
    use sim_core::turn::{EventKind, Order};
    let build = |target: V3| {
        let mut sim = Sim::new_skirmish(
            "impact-seed",
            &[SpawnSpec {
                class: ShipClassId::TerranFrigate,
                pos: V3::new(0.0, 0.0, -40.0),
                facing: V3::new(0.0, 0.0, 1.0),
            }],
            &[SpawnSpec {
                class: ShipClassId::TerranFrigate,
                pos: V3::new(300.0, 0.0, 0.0),
                facing: V3::new(-1.0, 0.0, 0.0),
            }],
            Faction::Terran,
            3,
        );
        // A small dead world with no pull at all, so what kills is the surface
        // and not a field dragging the hull in.
        sim.wells = vec![Well::new(V3::ZERO, 0.0, 12.0)];
        let mut orders = vec![
            Some(Order { mode: Some(Mode::MoveAndTurn), target: Some(target), ..Default::default() }),
            None,
        ];
        let res = sim.resolve_turn(&mut orders);
        (sim, res)
    };

    // Straight at the middle of it.
    let (sim, res) = build(V3::ZERO);
    assert!(sim.ships[0].destroyed, "flew into a world and lived");
    let boom = res
        .events
        .iter()
        .find(|e| e.kind == EventKind::ShipDestroyed && e.ship == 0)
        .expect("no wreck reported");
    let r = sim.ships[0].class_def().radius;
    let reach = 12.0 + r;
    assert!(
        boom.pos.len() <= reach + 1.0,
        "died {} from the centre, but the surface is at {reach}", boom.pos.len(),
    );
    assert!(boom.tick > 0 && boom.tick <= 600, "died at tick {}", boom.tick);

    // And a course that stops short of the surface is simply a close pass.
    let (near, _) = build(V3::new(0.0, 0.0, -22.0));
    assert!(!near.ships[0].destroyed, "a near miss should not be a wreck");
}
