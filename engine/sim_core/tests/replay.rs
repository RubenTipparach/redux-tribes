//! Replay: the instrument every determinism claim has to pass through.
//!
//! A state hash tells you two clients parted and nothing else. A snapshot plus
//! that turn's orders tells you where, because either machine can put the world
//! back and run the turn again in isolation.
//!
//! It is also the only honest way to evaluate a physics engine. "This
//! integrator is deterministic" is not a testable sentence without the ability
//! to restore and re-run, so this file exists before any such engine does.

use sim_core::data::ShipClassId;
use sim_core::flight::Mode;
use sim_core::math::V3;
use sim_core::state::{Faction, Sim, SpawnSpec};
use sim_core::turn::{FireOrder, Order};

const SOLO: u8 = 0b01;
const VERSUS: u8 = 0b11;

fn spec(class: ShipClassId, pos: V3, facing: V3) -> SpawnSpec {
    SpawnSpec { class, pos, facing }
}

fn skirmish(seed: &str, human_sides: u8) -> Sim {
    Sim::new_skirmish(
        seed,
        &[
            spec(ShipClassId::TerranFrigate, V3::new(-40.0, 0.0, 0.0), V3::new(1.0, 0.0, 0.0)),
            spec(ShipClassId::TerranFrigate, V3::new(-40.0, 5.0, -15.0), V3::new(1.0, 0.0, 0.0)),
        ],
        &[
            spec(ShipClassId::KarisenFrigate, V3::new(40.0, 0.0, 5.0), V3::new(-1.0, 0.0, 0.0)),
            spec(ShipClassId::RogueFrigate, V3::new(40.0, -4.0, -10.0), V3::new(-1.0, 0.0, 0.0)),
        ],
        Faction::Karisen,
        human_sides,
    )
}

fn player_order(target: V3) -> Order {
    Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(target),
        weapons: vec![FireOrder { weapon_index: 0, second: 2, target_ship: 2, target_sub: None }],
        ..Default::default()
    }
}

/// One turn's record: what the world looked like going in, what everyone did,
/// and what came out. Enough to reproduce it with nothing else on hand.
struct TurnRecord {
    before: Vec<f32>,
    orders: Vec<Option<Order>>,
    hash: u64,
}

fn play(seed: &str, human_sides: u8, turns: i32) -> (Sim, Vec<TurnRecord>) {
    let mut sim = skirmish(seed, human_sides);
    let mut log = Vec::new();
    for t in 0..turns {
        let mut before = vec![0.0f32; sim.snapshot_len()];
        sim.write_snapshot(&mut before).expect("snapshot fits its own reported length");

        let mut orders: Vec<Option<Order>> = vec![None; sim.ships.len()];
        orders[0] = Some(player_order(V3::new(-5.0 + t as f32, 0.0, 0.0)));
        if human_sides == VERSUS {
            orders[2] = Some(player_order(V3::new(5.0 - t as f32, 1.0, 2.0)));
        }

        // resolve_turn fills in AI decisions, so the record keeps the orders
        // AFTER resolution: those are what actually drove the turn, and a
        // replay that re-ran the planner would be testing the planner instead.
        let hash = sim.resolve_turn(&mut orders).hash;
        log.push(TurnRecord { before, orders, hash });
        if sim.game_over.is_some() {
            break;
        }
    }
    (sim, log)
}

#[test]
fn a_snapshot_round_trips_exactly() {
    let (sim, _) = play("seed-round-trip", SOLO, 3);
    let mut buf = vec![0.0f32; sim.snapshot_len()];
    let n = sim.write_snapshot(&mut buf).expect("fits");
    assert_eq!(n, sim.snapshot_len(), "reported length is the written length");

    let mut copy = skirmish("seed-round-trip", SOLO);
    copy.restore_snapshot(&buf).expect("restores");
    assert_eq!(copy.hash_state(), sim.hash_state(), "a restored state hashes as the original");

    // And restoring is not merely hash equal: it is the same world.
    assert_eq!(copy.turn, sim.turn);
    assert_eq!(copy.ships.len(), sim.ships.len());
    assert_eq!(copy.projectiles.len(), sim.projectiles.len());
    for (a, b) in copy.ships.iter().zip(sim.ships.iter()) {
        assert_eq!(a.hull, b.hull);
        assert_eq!(a.pos, b.pos);
        assert_eq!(a.side, b.side);
        assert_eq!(a.marines, b.marines);
        assert_eq!(a.subs.len(), b.subs.len());
    }
}

#[test]
fn every_turn_replays_from_its_initial_conditions() {
    // The property that makes a recorded match debuggable: put the world back
    // as it was at the start of any turn, feed it the orders that drove that
    // turn, and get the same turn out. No dependence on the turns before it.
    let (_, log) = play("seed-replay", SOLO, 5);
    assert!(log.len() >= 3, "the match should have lasted a few turns");

    for (i, rec) in log.iter().enumerate() {
        let mut sim = skirmish("seed-replay", SOLO);
        sim.restore_snapshot(&rec.before).expect("restores");
        let mut orders = rec.orders.clone();
        let hash = sim.resolve_turn(&mut orders).hash;
        assert_eq!(hash, rec.hash, "turn {i} did not reproduce from its own snapshot");
    }
}

#[test]
fn a_turn_can_be_replayed_out_of_order() {
    // Seeking, not just rewinding. Replaying the last turn first must give the
    // same answer, which is what proves a turn depends on its snapshot and its
    // orders rather than on anything left over in the process.
    let (_, log) = play("seed-seek", SOLO, 5);
    let mut sim = skirmish("seed-seek", SOLO);
    for i in (0..log.len()).rev() {
        sim.restore_snapshot(&log[i].before).expect("restores");
        let mut orders = log[i].orders.clone();
        assert_eq!(sim.resolve_turn(&mut orders).hash, log[i].hash, "turn {i} out of order");
    }
}

#[test]
fn two_people_replay_to_the_same_state() {
    // The lockstep case. Both seats recorded the same turns; either can
    // reconstruct any turn and must land on the hash the other reported.
    let (_, a) = play("seed-versus-replay", VERSUS, 4);
    let (_, b) = play("seed-versus-replay", VERSUS, 4);
    assert_eq!(a.len(), b.len());
    for i in 0..a.len() {
        assert_eq!(a[i].hash, b[i].hash, "seats disagreed on turn {i}");
        let mut sim = skirmish("seed-versus-replay", VERSUS);
        sim.restore_snapshot(&b[i].before).expect("restores");
        let mut orders = a[i].orders.clone();
        assert_eq!(
            sim.resolve_turn(&mut orders).hash,
            a[i].hash,
            "one seat's snapshot plus the other's orders must reproduce turn {i}",
        );
    }
}

#[test]
fn a_snapshot_from_another_match_is_refused() {
    // Restoring the wrong match would succeed and then diverge for reasons
    // nothing could explain, so it is refused where the mistake is made.
    let (sim, _) = play("seed-alpha", SOLO, 2);
    let mut buf = vec![0.0f32; sim.snapshot_len()];
    sim.write_snapshot(&mut buf).expect("fits");

    let mut other = skirmish("seed-beta", SOLO);
    assert!(other.restore_snapshot(&buf).is_err(), "a foreign snapshot is refused");

    let mut same = skirmish("seed-alpha", SOLO);
    assert!(same.restore_snapshot(&buf).is_ok(), "and its own is accepted");
}

#[test]
fn a_truncated_snapshot_is_refused_rather_than_half_written() {
    let (sim, _) = play("seed-short", SOLO, 1);
    let mut small = vec![0.0f32; sim.snapshot_len() - 1];
    assert!(sim.write_snapshot(&mut small).is_none(), "a truncated snapshot is not a snapshot");
}
