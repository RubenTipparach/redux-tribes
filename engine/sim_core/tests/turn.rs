//! Turn resolution tests.
//!
//! These pin behaviour, not numbers: what the model must DO, phrased so that a
//! tuning change does not fail them but a broken rule does. The oracle is
//! "two Rust builds agree", so determinism is checked here directly rather
//! than assumed from the code reading as pure.

use sim_core::data::ShipClassId;
use sim_core::flight::Mode;
use sim_core::math::V3;
use sim_core::state::{Faction, SpawnSpec, Sim};
use sim_core::turn::{EventKind, FireOrder, Order};

/// Side 0 is a person, side 1 is the AI: the shape every test here wants.
const SOLO: u8 = 0b01;

fn spec(class: ShipClassId, pos: V3, facing: V3) -> SpawnSpec {
    SpawnSpec { class, pos, facing }
}

/// Two frigates nose to nose, the enemy carrying a missile launcher.
fn duel(seed: &str, sep: f32) -> Sim {
    Sim::new_skirmish(
        seed,
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, 0.0, 0.0), V3::new(0.0, 0.0, 1.0))],
        &[spec(ShipClassId::KarisenFrigate, V3::new(0.0, 0.0, sep), V3::new(0.0, 0.0, -1.0))],
        Faction::Karisen,
        SOLO,
    )
}

fn hold(target: V3) -> Order {
    Order { mode: Some(Mode::MoveAndTurn), target: Some(target), ..Default::default() }
}

fn scripted(seed: &str) -> Sim {
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
        SOLO,
    )
}

fn run(seed: &str, turns: i32) -> Vec<u64> {
    let mut sim = scripted(seed);
    let mut hashes = Vec::new();
    for _ in 0..turns {
        let mut orders: Vec<Option<Order>> = vec![None; sim.ships.len()];
        orders[0] = Some(hold(V3::new(-5.0, 0.0, 0.0)));
        hashes.push(sim.resolve_turn(&mut orders).hash);
        if sim.game_over.is_some() {
            break;
        }
    }
    hashes
}

#[test]
fn same_seed_and_orders_give_identical_hashes() {
    assert_eq!(run("seed-alpha", 4), run("seed-alpha", 4));
}

#[test]
fn a_different_seed_diverges() {
    assert_ne!(run("seed-alpha", 4), run("seed-beta", 4));
}

#[test]
fn planning_does_not_mutate_ship_state() {
    // The case that matters is replaying with the orders already decided,
    // which is also the lockstep case: a client that RECEIVES orders never
    // runs the planner. If planning writes to a ship, the run that planned
    // and the run that replayed part company here and nowhere earlier.
    let mut a = scripted("seed-plan");
    let mut orders: Vec<Option<Order>> = vec![None; a.ships.len()];
    orders[0] = Some(hold(V3::new(-5.0, 0.0, 0.0)));
    let planned = a.resolve_turn(&mut orders);
    // `orders` now holds what the AI decided. Replay from a fresh state with
    // exactly those orders, so no planner runs at all.
    let mut b = scripted("seed-plan");
    let replayed = b.resolve_turn(&mut orders);
    assert_eq!(planned.hash, replayed.hash, "replaying decided orders must reproduce the turn");
}

#[test]
fn missiles_fly_a_finite_path_and_connect() {
    // Regression: the missile leg's control point came from a constant deleted
    // with the ship movement model, so it was NaN from the first hop. The
    // missile could not hit, did not expire, and went into the state hash.
    let mut sim = duel("seed-missile", 120.0);
    let mut orders: Vec<Option<Order>> = vec![None; sim.ships.len()];
    orders[0] = Some(hold(V3::ZERO));
    orders[1] = Some(Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(V3::new(0.0, 0.0, 120.0)),
        weapons: vec![FireOrder {
            weapon_index: 1, // the Karisen launcher
            second: 0,
            target_ship: 0,
            target_sub: None,
        }],
        ..Default::default()
    });
    let hull_before = sim.ships[0].hull;
    let res = sim.resolve_turn(&mut orders);

    let spawned = res
        .events
        .iter()
        .filter(|e| e.kind == EventKind::ProjectileSpawned && e.amount == 1.0)
        .count();
    assert_eq!(spawned, 2, "a launcher spawns its authored batch of two");

    assert!(
        sim.projectiles.iter().all(|p| p.pos.x.is_finite() && p.pos.y.is_finite() && p.pos.z.is_finite()),
        "no missile position may be NaN after a full turn",
    );
    assert!(
        sim.ships[0].hull < hull_before,
        "missiles must reach the target: hull {} did not drop from {}",
        sim.ships[0].hull,
        hull_before,
    );
}

#[test]
fn both_slot_endpoints_fire() {
    // The archive dropped the last slot because its loop stopped one short.
    // Both endpoints are real here, so a plan can use all eleven.
    let mut sim = duel("seed-slots", 60.0);
    let mut orders: Vec<Option<Order>> = vec![None; sim.ships.len()];
    orders[0] = Some(Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(V3::ZERO),
        weapons: vec![
            FireOrder { weapon_index: 0, second: 0, target_ship: 1, target_sub: None },
            FireOrder { weapon_index: 1, second: 10, target_ship: 1, target_sub: None },
        ],
        ..Default::default()
    });
    let res = sim.resolve_turn(&mut orders);
    let fired: Vec<i32> = res
        .events
        .iter()
        .filter(|e| {
            matches!(
                e.kind,
                EventKind::ShotFired
                    | EventKind::ProjectileSpawned
                    | EventKind::ShotSkippedArc
                    | EventKind::ShotSkippedRange
            )
        })
        .map(|e| e.tick)
        .collect();
    assert!(fired.contains(&0), "slot 0 fires at tick 0, got {:?}", fired);
    assert!(fired.contains(&600), "slot 10 fires at tick 600, got {:?}", fired);
}

#[test]
fn hulls_never_interpenetrate() {
    // Two hulls driven straight at each other. The archive let them pass
    // through one another; contact resolution means they cannot.
    let mut sim = Sim::new_skirmish(
        "seed-ram",
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, 0.0, -30.0), V3::new(0.0, 0.0, 1.0))],
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, 0.0, 30.0), V3::new(0.0, 0.0, -1.0))],
        Faction::Karisen,
        SOLO,
    );
    let min_sep = sim.ships[0].class_def().radius + sim.ships[1].class_def().radius;
    for _ in 0..3 {
        let mut orders: Vec<Option<Order>> = vec![
            Some(hold(V3::new(0.0, 0.0, 30.0))),
            Some(hold(V3::new(0.0, 0.0, -30.0))),
        ];
        sim.resolve_turn(&mut orders);
        let d = sim.ships[0].pos.dist(sim.ships[1].pos);
        assert!(
            d >= min_sep - 1e-3,
            "hulls interpenetrated: {} apart, minimum {}",
            d,
            min_sep,
        );
    }
}

#[test]
fn a_ram_costs_both_ships_hull() {
    let mut sim = Sim::new_skirmish(
        "seed-ram2",
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, 0.0, -25.0), V3::new(0.0, 0.0, 1.0))],
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, 0.0, 25.0), V3::new(0.0, 0.0, -1.0))],
        Faction::Karisen,
        SOLO,
    );
    let before = (sim.ships[0].hull, sim.ships[1].hull);
    let mut saw_collision = false;
    for _ in 0..4 {
        let mut orders: Vec<Option<Order>> = vec![
            Some(hold(V3::new(0.0, 0.0, 25.0))),
            Some(hold(V3::new(0.0, 0.0, -25.0))),
        ];
        let res = sim.resolve_turn(&mut orders);
        if res.events.iter().any(|e| e.kind == EventKind::Collision) {
            saw_collision = true;
        }
    }
    assert!(saw_collision, "two ships driven into each other must collide");
    assert!(
        sim.ships[0].hull < before.0 && sim.ships[1].hull < before.1,
        "a ram bills both hulls, got {:?} from {:?}",
        (sim.ships[0].hull, sim.ships[1].hull),
        before,
    );
}

#[test]
fn armour_absorbs_its_share_and_the_rest_reaches_the_hull() {
    // A subsystem is not immunity. It takes its block share and the remainder
    // bleeds through, so a shot into armour still costs hull.
    let mut sim = duel("seed-armour", 40.0);
    let hull_before = sim.ships[1].hull;
    let mut orders: Vec<Option<Order>> = vec![None; 2];
    orders[0] = Some(Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(V3::ZERO),
        weapons: vec![FireOrder { weapon_index: 0, second: 0, target_ship: 1, target_sub: Some(0) }],
        ..Default::default()
    });
    orders[1] = Some(hold(V3::new(0.0, 0.0, 40.0)));
    let res = sim.resolve_turn(&mut orders);
    let hit = res.events.iter().find(|e| e.kind == EventKind::ShotHit);
    assert!(hit.is_some(), "a beam at 40 units with a clear arc should connect");
    assert!(
        sim.ships[1].hull < hull_before,
        "damage through armour must still reach the hull",
    );
}

#[test]
fn losing_every_thruster_puts_a_ship_adrift() {
    let mut sim = duel("seed-drift", 40.0);
    // Beat on the engine volume until it goes.
    for _ in 0..8 {
        let mut orders: Vec<Option<Order>> = vec![None; 2];
        orders[0] = Some(Order {
            mode: Some(Mode::MoveAndTurn),
            target: Some(V3::ZERO),
            weapons: (0..3)
                .map(|i| FireOrder {
                    weapon_index: i,
                    second: i as i32 + 1,
                    target_ship: 1,
                    target_sub: Some(2), // engines
                })
                .collect(),
            ..Default::default()
        });
        orders[1] = Some(hold(V3::new(0.0, 0.0, 40.0)));
        sim.resolve_turn(&mut orders);
        if sim.ships[1].drift_active || sim.ships[1].destroyed {
            break;
        }
    }
    assert!(
        sim.ships[1].drift_active || sim.ships[1].destroyed,
        "focused engine fire must put the target adrift (or kill it first)",
    );
}

#[test]
fn the_defender_kill_ratio_falls_with_the_hull() {
    // Why softening a target before boarding it is a rule and not a tactic:
    // the defender kill ratio comes straight off the hull fraction, and it
    // reaches zero below 35%. Above that a boarding party spends two marines
    // per defender, which is what makes marines a finishing move rather than
    // an opening one.
    assert_eq!(sim_core::data::marine_efficiency(1.00), 2);
    assert_eq!(sim_core::data::marine_efficiency(0.80), 2);
    assert_eq!(sim_core::data::marine_efficiency(0.50), 1);
    assert_eq!(sim_core::data::marine_efficiency(0.34), 0);
    assert_eq!(sim_core::data::marine_efficiency(0.20), 0);
}

#[test]
fn boarding_a_softened_hull_captures_it() {
    let mut sim = Sim::new_skirmish(
        "seed-board",
        &[spec(ShipClassId::RogueFrigate, V3::new(0.0, 0.0, 0.0), V3::new(0.0, 0.0, 1.0))],
        &[spec(ShipClassId::Freighter, V3::new(0.0, 0.0, 15.0), V3::new(0.0, 0.0, 1.0))],
        Faction::Karisen,
        SOLO,
    );
    // Hold both still and let the marines decide it: this is a test of
    // boarding, not of whether the AI flies away mid boarding action.
    for s in sim.ships.iter_mut() {
        s.ai_enabled = false;
    }
    sim.ships[1].hull = sim.ships[1].hull_max * 0.2;
    sim.ships[1].marines = 5;

    let mut captured = false;
    for _ in 0..8 {
        let mut orders: Vec<Option<Order>> = vec![
            Some(Order { mode: Some(Mode::FullStop), board: Some(1), ..Default::default() }),
            Some(Order { mode: Some(Mode::FullStop), ..Default::default() }),
        ];
        let res = sim.resolve_turn(&mut orders);
        if res.events.iter().any(|e| e.kind == EventKind::ShipCaptured) {
            captured = true;
            break;
        }
    }
    assert!(captured, "a hull at 20% with five defenders cannot hold its decks");
    assert_eq!(sim.ships[1].faction, Faction::Terran, "a captured ship flips faction");
    assert_eq!(sim.ships[1].side, 0, "and changes sides for good");
}

#[test]
fn a_destroyed_ship_ends_the_match() {
    let mut sim = duel("seed-over", 30.0);
    sim.ships[1].hull = 1.0;
    let mut orders: Vec<Option<Order>> = vec![None; 2];
    orders[0] = Some(Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(V3::ZERO),
        weapons: (0..3)
            .map(|i| FireOrder { weapon_index: i, second: i as i32, target_ship: 1, target_sub: None })
            .collect(),
        ..Default::default()
    });
    orders[1] = Some(hold(V3::new(0.0, 0.0, 30.0)));
    let res = sim.resolve_turn(&mut orders);
    assert!(sim.ships[1].destroyed, "a 1 hull ship under three beams dies");
    assert!(res.events.iter().any(|e| e.kind == EventKind::GameOver));
}

#[test]
fn two_people_playing_each_other_hash_the_same() {
    // The reason sides are a match-wide fact rather than a point of view.
    //
    // Both clients build the same match, receive the same orders for both
    // sides, and resolve. If anything the hash covers meant "mine" instead of
    // "side 0", these two would part on the very first turn and lockstep would
    // report a desync that is really just two honest clients disagreeing about
    // which ships are theirs.
    const VERSUS: u8 = 0b11;
    let build = || {
        Sim::new_skirmish(
            "seed-pvp",
            &[spec(ShipClassId::TerranFrigate, V3::new(-30.0, 0.0, 0.0), V3::new(1.0, 0.0, 0.0))],
            &[spec(ShipClassId::KarisenFrigate, V3::new(30.0, 0.0, 0.0), V3::new(-1.0, 0.0, 0.0))],
            Faction::Karisen,
            VERSUS,
        )
    };
    let orders = || -> Vec<Option<Order>> {
        vec![
            Some(Order {
                mode: Some(Mode::MoveAndTurn),
                target: Some(V3::new(-10.0, 2.0, 4.0)),
                weapons: vec![FireOrder { weapon_index: 0, second: 2, target_ship: 1, target_sub: None }],
                ..Default::default()
            }),
            Some(Order {
                mode: Some(Mode::MoveAndTurn),
                target: Some(V3::new(10.0, -1.0, -3.0)),
                weapons: vec![FireOrder { weapon_index: 0, second: 3, target_ship: 0, target_sub: None }],
                ..Default::default()
            }),
        ]
    };

    let mut a = build();
    let mut b = build();
    for _ in 0..3 {
        let ha = a.resolve_turn(&mut orders()).hash;
        let hb = b.resolve_turn(&mut orders()).hash;
        assert_eq!(ha, hb, "two seats must agree on every turn");
    }
}

#[test]
fn a_human_side_is_never_planned_for_by_the_ai() {
    // In a versus match nobody's ships get quietly flown by the AI when their
    // orders are simply absent for a turn, because ai_enabled is off for both
    // sides. Retaliation writes ai_target only for AI ships, and ai_target is
    // hashed, so this is a determinism property and not only a fairness one.
    let sim = Sim::new_skirmish(
        "seed-versus",
        &[spec(ShipClassId::TerranFrigate, V3::new(-30.0, 0.0, 0.0), V3::new(1.0, 0.0, 0.0))],
        &[spec(ShipClassId::KarisenFrigate, V3::new(30.0, 0.0, 0.0), V3::new(-1.0, 0.0, 0.0))],
        Faction::Karisen,
        0b11,
    );
    assert!(sim.ships.iter().all(|s| !s.ai_enabled), "no AI in a versus match");

    // And in a solo game exactly the other side is the AI.
    let solo = Sim::new_skirmish(
        "seed-solo",
        &[spec(ShipClassId::TerranFrigate, V3::new(-30.0, 0.0, 0.0), V3::new(1.0, 0.0, 0.0))],
        &[spec(ShipClassId::KarisenFrigate, V3::new(30.0, 0.0, 0.0), V3::new(-1.0, 0.0, 0.0))],
        Faction::Karisen,
        SOLO,
    );
    assert!(!solo.ships[0].ai_enabled, "the person flies side 0");
    assert!(solo.ships[1].ai_enabled, "the AI flies side 1");
}
