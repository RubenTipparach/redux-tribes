//! The flight model's own tests, mirroring the JS prototype's suite so the two
//! implementations are pinned to the same behaviour, not just the same shape.
//!
//! These assert PROPERTIES of the model (anisotropy, commitment, rate limits),
//! not magic numbers, so retuning the stats does not falsely fail them.

use sim_core::flight::{angle_between_deg, RESOLUTION_STEPS};
use sim_core::{can_reach, fly_turn, Body, Flight, Mode, Quat, V3};

fn ship(vel: V3) -> Body {
    Body { pos: V3::ZERO, vel, quat: Quat::IDENTITY }
}

fn reach(dir: V3, mode: Mode, fl: &Flight, face: Option<V3>) -> f32 {
    let b = ship(V3::ZERO);
    let flown = fly_turn(b, Some(dir.norm().scale(400.0)), mode, fl, face, RESOLUTION_STEPS, &[]);
    flown.end_pos.dist(b.pos)
}

#[test]
fn forward_beats_reversing() {
    let fl = Flight::default();
    let fwd = reach(V3::new(0.0, 0.0, 1.0), Mode::MoveAndTurn, &fl, None);
    let aft = reach(V3::new(0.0, 0.0, -1.0), Mode::MoveAndTurn, &fl, None);
    assert!(fwd > aft * 1.5, "forward {fwd} should beat reversing {aft} by half again");
}

#[test]
fn slower_pitch_makes_vertical_worse_than_lateral() {
    let fl = Flight::default();
    let lateral = reach(V3::new(1.0, 0.0, 0.0), Mode::MoveAndTurn, &fl, None);
    let vertical = reach(V3::new(0.0, 1.0, 0.0), Mode::MoveAndTurn, &fl, None);
    assert!(lateral > vertical * 1.3, "lateral {lateral} vs vertical {vertical}");
}

#[test]
fn an_agile_hull_outreaches_a_sluggish_one() {
    let agile = Flight { yaw_rate: 9.0, pitch_rate: 6.0, accel_fwd: 1.1, accel_retro: 0.5, accel_lat: 0.4, max_speed: 9.5 };
    let heavy = Flight { yaw_rate: 2.5, pitch_rate: 1.5, accel_fwd: 0.45, accel_retro: 0.18, accel_lat: 0.10, max_speed: 5.0 };
    let a = reach(V3::new(1.0, 0.0, 0.0), Mode::MoveAndTurn, &agile, None);
    let h = reach(V3::new(1.0, 0.0, 0.0), Mode::MoveAndTurn, &heavy, None);
    assert!(a > h * 1.5, "agile {a} vs sluggish {h}");
}

#[test]
fn momentum_commits_you() {
    let fl = Flight::default();
    assert!(
        can_reach(ship(V3::ZERO), V3::ZERO, Mode::MoveAndTurn, &fl, None, 2.0, RESOLUTION_STEPS, &[]),
        "a ship at rest can hold station"
    );
    assert!(
        !can_reach(ship(V3::new(0.0, 0.0, 6.0)), V3::ZERO, Mode::MoveAndTurn, &fl, None, 2.0, RESOLUTION_STEPS, &[]),
        "a ship carrying velocity cannot hold station"
    );
}

#[test]
fn holding_a_heading_shortens_a_lateral_move() {
    let fl = Flight::default();
    let free = reach(V3::new(1.0, 0.0, 0.0), Mode::MoveAndTurn, &fl, None);
    let held = reach(V3::new(1.0, 0.0, 0.0), Mode::TurnSlide, &fl, None);
    assert!(free > held * 1.5, "free nose {free} vs held heading {held}");
}

#[test]
fn rotation_is_rate_limited() {
    // Ask for a 150 degree swing at three authorities and watch the cap bind.
    let want = V3::new((150f32).to_radians().sin(), 0.0, (150f32).to_radians().cos());
    let bearing = |q: Quat| {
        let f = q.forward();
        f.x.atan2(f.z).to_degrees()
    };
    let at = |yaw: f32| {
        let fl = Flight { yaw_rate: yaw, ..Flight::default() };
        let f = fly_turn(ship(V3::ZERO), None, Mode::TurnSlide, &fl, Some(want), RESOLUTION_STEPS, &[]);
        bearing(f.end_quat)
    };
    let slow = at(6.0);
    let mid = at(12.0);
    let fast = at(25.0);
    assert!((slow - 60.0).abs() < 1.0, "6 deg/s should cap at 60 per turn, got {slow}");
    assert!((mid - 120.0).abs() < 1.0, "12 deg/s should cap at 120 per turn, got {mid}");
    assert!((fast - 150.0).abs() < 1.0, "25 deg/s should reach the full 150, got {fast}");
}

#[test]
fn committed_modes_ignore_the_destination() {
    let fl = Flight::default();
    let b = ship(V3::new(0.0, 0.0, 5.0));
    let a = fly_turn(b, Some(V3::new(200.0, 0.0, 0.0)), Mode::FullSpeed, &fl, None, RESOLUTION_STEPS, &[]);
    let c = fly_turn(b, Some(V3::new(-200.0, 0.0, 0.0)), Mode::FullSpeed, &fl, None, RESOLUTION_STEPS, &[]);
    // fly_turn honours what it is handed; the caller drops the target for a
    // committed mode. Assert the mode reports itself as committed so that
    // contract is pinned somewhere.
    assert!(Mode::FullSpeed.committed());
    assert!(Mode::FullStop.committed());
    assert!(Mode::Drift.committed());
    assert!(!Mode::MoveAndTurn.committed());
    assert!(!Mode::TurnSlide.committed());
    // and that a burn does go somewhere regardless of which way it was aimed
    assert!(a.end_pos.dist(V3::ZERO) > 50.0);
    assert!(c.end_pos.dist(V3::ZERO) > 50.0);
}

#[test]
fn drift_is_an_unpowered_coast() {
    let fl = Flight::default();
    let b = ship(V3::new(0.0, 0.0, 4.0));
    let f = fly_turn(b, None, Mode::Drift, &fl, None, RESOLUTION_STEPS, &[]);
    // ten seconds at 4 u/s, with no thrust and no attitude change
    assert!((f.end_pos.z - 40.0).abs() < 0.01, "coasted to {}", f.end_pos.z);
    assert_eq!(f.end_vel.z, 4.0);
    assert!(angle_between_deg(f.end_quat.forward(), b.quat.forward()) < 0.001);
}

#[test]
fn a_probe_tracks_the_executed_flight() {
    // 60 slices is what the planner probes with; it must land close enough to
    // the 600 tick execution to draw an envelope that is not a lie.
    let fl = Flight::default();
    let mut worst = 0.0f32;
    for target in [
        V3::new(60.0, 0.0, 0.0),
        V3::new(0.0, 0.0, -60.0),
        V3::new(30.0, 20.0, -40.0),
    ] {
        for vel in [V3::ZERO, V3::new(0.0, 0.0, 5.0)] {
            let b = ship(vel);
            let exact = fly_turn(b, Some(target), Mode::MoveAndTurn, &fl, None, RESOLUTION_STEPS, &[]);
            let probe = fly_turn(b, Some(target), Mode::MoveAndTurn, &fl, None, 60, &[]);
            worst = worst.max(exact.end_pos.dist(probe.end_pos));
        }
    }
    assert!(worst < 1.0, "probe drifted {worst} units from the executed flight");
}
