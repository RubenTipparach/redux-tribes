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

/// The same duel on HEAVY CRUISERS, for the checks that pound one volume until
/// it dies.
///
/// A frigate cannot survive that any more. Corvettes and frigates were halved,
/// and plate mass and hull go as the CUBE of the cell, so a Terran frigate
/// carries 121 hull points where it carried 300: a beam does 27.5, so the ship
/// is gone in five hits and a single volume takes longer than that to kill.
/// The subject of these checks is the damage MODEL, which is the same at every
/// rung, so they ask it of a hull with enough structure to answer.
fn heavy_duel(seed: &str, sep: f32) -> Sim {
    Sim::new_skirmish(
        seed,
        &[spec(ShipClassId::TerranCruiser, V3::new(0.0, 0.0, 0.0), V3::new(0.0, 0.0, 1.0))],
        &[spec(ShipClassId::KarisenCruiser, V3::new(0.0, 0.0, sep), V3::new(0.0, 0.0, -1.0))],
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

#[test]
fn a_weapon_fires_once_per_turn_at_most() {
    // The rule the client used to hold a second copy of. It is asserted here
    // rather than across the boundary because the state that exercises it,
    // a weapon already fired THIS turn, is one the planner cannot reach: it
    // only exists mid resolution.
    //
    // Cooldown runs on the match clock in absolute ticks, so one comparison
    // covers a second shot later in the same turn and a shot early in the
    // next one. The old arithmetic counted whole turns, which made cooldown 0
    // and 1 both mean fire every turn: no mount ever waited, and the client's
    // copy of the rule was quietly doing nothing.
    let mut sim = duel("seed-cooldown", 60.0);
    assert!(sim.can_fire(0, 0), "an unused mount is available");

    // fired at second 0 of this turn
    sim.ships[0].weapons[0].last_fired_tick = sim.absolute_tick(0);
    assert!(!sim.can_fire(0, 0), "a mount that just fired is not ready at once");
    assert!(sim.can_fire(0, 1), "and its neighbour is untouched");

    // it comes back WITHIN the turn, once its own cooldown has run
    let gap = Sim::cooldown_ticks(sim.ships[0].weapons[0].key);
    let secs = gap / 60;
    assert!(secs >= 1 && secs <= 10, "a cooldown of {secs} s should fit inside a turn");
    assert!(!sim.fire_gate(0, 0, secs - 1), "not a second early");
    assert!(sim.fire_gate(0, 0, secs), "ready exactly on its cooldown");

    // and the clock carries across the turn boundary rather than resetting
    sim.ships[0].weapons[0].last_fired_tick = sim.absolute_tick(9 * 60);
    sim.turn += 1;
    assert!(!sim.fire_gate(0, 0, 0),
        "a shot at second 9 still holds the mount at second 0 of the next turn");

    assert!(!sim.can_fire(0, 99), "a mount that does not exist cannot fire");
    assert!(!sim.can_fire(99, 0), "nor can one on a ship that does not exist");
}

/// What the planner offers has to be what the resolver honours, so the slot
/// arithmetic lives in the core and both ask it.
#[test]
fn the_next_free_second_walks_the_queue() {
    let sim = duel("seed-slots", 60.0);
    let gap_secs = Sim::cooldown_ticks(sim.ships[0].weapons[0].key) / 60;

    assert_eq!(sim.next_free_second(0, 0, -1), 0, "nothing queued, fire at once");
    assert_eq!(sim.next_free_second(0, 0, 0), gap_secs, "one cooldown after a shot at 0");
    assert_eq!(sim.next_free_second(0, 0, 3), 3 + gap_secs, "and after a shot at 3");
}

#[test]
fn boarding_needs_range_an_enemy_and_marines() {
    let mut sim = duel("seed-board-rule", 12.0);
    assert!(sim.can_board(0, 1), "alongside an enemy with marines aboard");
    assert!(!sim.can_board(0, 0), "never onto yourself, whatever the range");

    sim.ships[0].marines = 0;
    assert!(!sim.can_board(0, 1), "an empty hold cannot board");
    sim.ships[0].marines = 10;

    sim.ships[1].faction = sim.ships[0].faction;
    assert!(!sim.can_board(0, 1), "and you do not board your own side");
    sim.ships[1].faction = Faction::Karisen;

    let far = duel("seed-board-far", 400.0);
    assert!(!far.can_board(0, 1), "nor across open space");
}

/// The point of a cooldown in seconds: a mount can fire more than once in a
/// turn. Under the old per turn arithmetic that was impossible, and the client
/// enforced it by throwing away the previous shot whenever a second one was
/// queued, which is exactly what "weapons queuing is broken" looked like.
#[test]
fn a_mount_fires_twice_in_one_turn_when_its_cooldown_allows() {
    let mut sim = duel("seed-twice", 60.0);
    let gap = Sim::cooldown_ticks(sim.ships[0].weapons[0].key) / 60;
    let shot = |second: i32| FireOrder {
        weapon_index: 0,
        second,
        target_ship: 1,
        target_sub: None,
    };
    let mut orders = vec![
        Some(Order {
            mode: Some(Mode::MoveAndTurn),
            target: None,
            roll: None,
            face: None,
            ai_target: None,
            weapons: vec![shot(0), shot(gap)],
            board: None,
        }),
        None,
    ];
    let r = sim.resolve_turn(&mut orders);
    let fired = r
        .events
        .iter()
        .filter(|e| e.kind == EventKind::ShotFired && e.ship == 0 && e.aux == 0)
        .count();
    assert_eq!(fired, 2, "both shots should be taken, {gap} s apart");
}

/// And the resolver refuses one that is too close rather than trusting the
/// planner to have filtered it, so a stale or hand written order set cannot
/// buy a free shot.
#[test]
fn the_resolver_drops_a_shot_inside_the_cooldown() {
    let mut sim = duel("seed-tooclose", 60.0);
    let shot = |second: i32| FireOrder {
        weapon_index: 0,
        second,
        target_ship: 1,
        target_sub: None,
    };
    let mut orders = vec![
        Some(Order {
            mode: Some(Mode::MoveAndTurn),
            target: None,
            roll: None,
            face: None,
            ai_target: None,
            weapons: vec![shot(0), shot(1)],
            board: None,
        }),
        None,
    ];
    let r = sim.resolve_turn(&mut orders);
    let fired = r
        .events
        .iter()
        .filter(|e| e.kind == EventKind::ShotFired && e.ship == 0 && e.aux == 0)
        .count();
    let skipped = r
        .events
        .iter()
        .filter(|e| e.kind == EventKind::ShotSkippedCooldown && e.ship == 0)
        .count();
    assert_eq!(fired, 1, "only the first shot lands");
    assert_eq!(skipped, 1, "and the second is reported, not silently dropped");
}

/// The AI preview is not an estimate. It is the order the resolver will use.
///
/// The whole point of showing a hostile's course while the player is still
/// planning is that the course is real, and that rests on two properties: the
/// planner writes nothing, and the resolver asks it FIRST, from the same
/// untouched boundary state the client is sitting in. Both are checked here,
/// because a preview that merely usually matched would be worse than none.
#[test]
fn an_ai_preview_is_the_order_the_turn_actually_flies() {
    let mut sim = duel("seed-ai-preview", 70.0);
    let before = sim_core::ai::plan_ship(&sim, 1);
    let hash = sim.hash_state();
    // Asking twice gives the same answer and moves nothing: the planner draws
    // its own RNG stream from the seed and the turn rather than the match's.
    let again = sim_core::ai::plan_ship(&sim, 1);
    assert_eq!(hash, sim.hash_state(), "asking the AI what it will do moved the match");
    assert_eq!(before.target, again.target, "the planner is not a pure function of the state");
    assert_eq!(before.mode, again.mode);
    assert_eq!(before.ai_target, again.ai_target);
    assert!(before.target.is_some(), "the fixture should have the AI going somewhere");

    // And the turn flies exactly that. `plan_target` is what resolution kept.
    let mut orders = vec![Some(hold(V3::new(0.0, 0.0, 0.0))), None];
    sim.resolve_turn(&mut orders);
    assert_eq!(
        sim.ships[1].plan_target, before.target,
        "the hostile flew somewhere other than the course the preview drew",
    );
}

/// A mount has two axes: yaw round from forward, and pitch as a true
/// ELEVATION off the horizontal plane. Roll does not enter it.
///
/// The archive's `TargetArcTest3D` measured pitch as `atan2(y, z)`, which is
/// not an elevation. As a target comes abeam, z goes to zero and that angle
/// runs to 90 degrees however level the target is, so a 60 degree mount
/// refused everything on its own beam: a beam turret with a 220 degree
/// horizontal arc could not fire at anything 90 degrees off the nose. This
/// pins the fix, which is a deliberate divergence from the archive.
#[test]
fn a_level_target_abeam_is_inside_a_sixty_degree_pitch_arc() {
    use sim_core::math::{arc_test_3d, Quat};

    let origin = V3::new(0.0, 0.0, 0.0);
    let facing = Quat::IDENTITY;
    // Dead abeam and dead level: yaw 90, elevation 0.
    let abeam = V3::new(100.0, 0.0, 0.0);
    assert!(
        arc_test_3d(origin, facing, abeam, -110.0, 110.0, -60.0, 60.0),
        "a level target 90 degrees off the nose is inside a 110 by 60 arc"
    );
    // The horizontal arc still bites: 150 degrees round is outside 110.
    let behind = V3::new(50.0, 0.0, -86.6);
    assert!(
        !arc_test_3d(origin, facing, behind, -110.0, 110.0, -60.0, 60.0),
        "150 degrees off the nose is outside a 110 degree horizontal arc"
    );
    // And so does the vertical one: 70 degrees up is outside 60.
    let high = V3::new(0.0, 94.0, 34.2);
    assert!(
        !arc_test_3d(origin, facing, high, -110.0, 110.0, -60.0, 60.0),
        "70 degrees of elevation is outside a 60 degree pitch arc"
    );
    // 45 up and 45 round passes both.
    let corner = V3::new(50.0, 70.7, 50.0);
    assert!(
        arc_test_3d(origin, facing, corner, -110.0, 110.0, -60.0, 60.0),
        "45 degrees up and 45 round is inside both arcs"
    );
}

/// Beat on one volume of ship 1 with every mount ship 0 has, turn after turn,
/// until it goes. The way the game would do it, because a test that reached
/// into `subs` and set `dead` would be testing the assignment.
fn pound(sim: &mut Sim, sub: usize, turns: i32) -> Vec<sim_core::turn::Event> {
    // Every ship gets an order, including the ones doing nothing. An order of
    // None is the AI's cue to plan, and an AI that manoeuvres turns the target
    // so the volume being aimed at ends up behind another one: the test would
    // then be measuring the AI rather than the damage model.
    let hold_at: Vec<V3> = sim.ships.iter().map(|s| s.pos).collect();
    for _ in 0..turns {
        let n = sim.ships.len();
        let mut orders: Vec<Option<Order>> = (0..n).map(|i| Some(hold(hold_at[i]))).collect();
        orders[0] = Some(Order {
            mode: Some(Mode::MoveAndTurn),
            weapons: (0..sim.ships[0].weapons.len())
                .map(|i| FireOrder {
                    weapon_index: i,
                    second: i as i32 + 1,
                    target_ship: 1,
                    target_sub: Some(sub),
                })
                .collect(),
            ..Default::default()
        });
        let res = sim.resolve_turn(&mut orders);
        if sim.ships[1].subs[sub].dead || sim.ships[1].destroyed {
            return res.events;
        }
    }
    Vec::new()
}

#[test]
fn losing_the_weapon_bay_silences_every_mount() {
    // One bay feeds the whole hull, so this is not "the mount you shot": it is
    // every mount at once, and the client's own greying out has to agree
    // because it asks the same gate.
    let mut sim = heavy_duel("seed-bay", 40.0);
    assert!(sim.can_fire(1, 0), "a fresh hull can fire before anything is hit");
    let _ = pound(&mut sim, 4, 14);
    assert!(sim.ships[1].subs[4].dead, "focused fire on the bay must eventually take it");
    for i in 0..sim.ships[1].weapons.len() {
        assert!(!sim.can_fire(1, i), "mount {i} still fires with the bay gone");
    }

    // And an order that tries anyway is refused with the reason, not with a
    // cooldown it has no way to wait out.
    let mut orders: Vec<Option<Order>> = vec![None; 2];
    orders[1] = Some(Order {
        mode: Some(Mode::MoveAndTurn),
        weapons: vec![FireOrder { weapon_index: 0, second: 1, target_ship: 0, target_sub: None }],
        ..Default::default()
    });
    let res = sim.resolve_turn(&mut orders);
    assert!(
        res.events.iter().any(|e| e.kind == EventKind::ShotSkippedOffline),
        "a shot from a wrecked bay must say so",
    );
}

#[test]
fn losing_the_thrusters_keeps_the_drive_and_takes_the_turn_rates() {
    // Attitude authority and thrust are different systems, and losing one is
    // not losing the other: the hull still accelerates, it just cannot point
    // itself anywhere new.
    let mut sim = heavy_duel("seed-jets", 40.0);
    let authored = sim.ships[1].flight;
    let _ = pound(&mut sim, 3, 14);
    assert!(sim.ships[1].subs[3].dead, "focused fire on the thrusters must eventually take them");

    let now = sim.ships[1].effective_flight();
    assert_eq!(now.yaw_rate, 0.0, "a hull with no thrusters cannot yaw");
    assert_eq!(now.pitch_rate, 0.0, "a hull with no thrusters cannot pitch");
    assert_eq!(now.accel_fwd, authored.accel_fwd, "the drive is untouched");
    assert_eq!(now.max_speed, authored.max_speed, "and so is its top speed");
    assert!(!sim.ships[1].drift_active, "no thrusters is not adrift: that is the engines");
    // The authored stats are where they were. What changed is what the ship
    // can do with them, which is why this is derived rather than overwritten.
    assert_eq!(sim.ships[1].flight.yaw_rate, authored.yaw_rate);
}


#[test]
fn breaching_the_reactor_ends_the_ship_and_takes_the_neighbours_with_it() {
    // From below, because from ahead the bay and the belts are in the way and
    // that is the point of where they sit. A hull whose core can be reached
    // from any aspect is a hull with no armour worth drawing.
    let mut sim = Sim::new_skirmish(
        "seed-critical",
        &[spec(ShipClassId::TerranFrigate, V3::new(0.0, -30.0, 0.0), V3::new(0.0, 1.0, 0.0))],
        &[
            spec(ShipClassId::Freighter, V3::ZERO, V3::new(0.0, 0.0, 1.0)),
            // Eleven units, not eight. A freighter collides at 4.9 and a
            // Karisen frigate at 3.8, so eight puts the two spheres inside
            // each other: the contact solver then spent twenty turns pushing
            // them apart and the bystander was sixty units downrange by the
            // time the reactor went, which read as "a blast that does not
            // reach". Outside the sum of the two radii and inside
            // CRITICAL_RADIUS is the band this test is actually about.
            spec(ShipClassId::KarisenFrigate, V3::new(11.0, 0.0, 0.0), V3::new(0.0, 0.0, 1.0)),
        ],
        Faction::Karisen,
        SOLO,
    );
    let bystander_before = sim.ships[2].hull;
    let hull_before = sim.ships[1].hull;
    assert!(hull_before > 500.0, "the point of a freighter here is that it does not die of the bleed");

    let events = pound(&mut sim, 2, 20);
    assert!(sim.ships[1].subs[2].dead, "a clear lane to the core must eventually breach it");
    assert!(sim.ships[1].destroyed, "a breached reactor ends the ship whatever the hull says");
    assert_eq!(sim.ships[1].hull, 0.0, "the hull goes with the pile, not down to it");
    assert!(
        events.iter().any(|e| e.kind == EventKind::ShipCritical && e.ship == 1),
        "a breach announces itself, so the client can draw it as more than a kill",
    );
    assert!(
        sim.ships[2].hull < bystander_before,
        "a hull {} units from a breach takes a share of it",
        11.0,
    );
    // And it is a blast, not a second kill: the falloff leaves a frigate at
    // eleven units alive.
    assert!(!sim.ships[2].destroyed, "the blast falls off rather than clearing the field");
}

#[test]
fn a_side_can_field_a_hull_the_scenario_did_not_author() {
    // Picked in the lobby, applied at spawn, and hashed: which hull a side
    // fields decides radius, boarding range, mounts and volumes, so two seats
    // that disagreed about it would be playing different matches.
    use sim_core::ffi::{ft_hull_choice, ft_match_new, ft_read_ships, ft_scratch_ptr};
    const OUT: usize = 64;
    const STRIDE: usize = sim_core::ffi::SHIP_STRIDE;
    let read = || {
        let n = ft_read_ships() as usize;
        let s = unsafe { core::slice::from_raw_parts(ft_scratch_ptr(), 16384) };
        (0..n).map(|i| (s[OUT + i * STRIDE + 3] as u32, s[OUT + i * STRIDE + 1] as u32)).collect::<Vec<_>>()
    };

    ft_hull_choice(0, 0, -1);
    ft_hull_choice(1, 0, -1);
    ft_match_new(0xdead_beef, 0xcafe_0001, 0, 0b01);
    let authored = read();
    assert!(authored.iter().any(|(side, _)| *side == 0), "the skirmish seats a player");

    // 2 is the Rogue, picked for the FIRST hull side 0 fields. Only that one
    // changes: a player swapping one ship out of a pair is not asking for two
    // of it, and the ship beside it keeps what the scenario authored.
    ft_hull_choice(0, 0, 2);
    ft_match_new(0xdead_beef, 0xcafe_0001, 0, 0b01);
    let picked = read();
    let mut seen = 0;
    for ((side, cls), (_, was)) in picked.iter().zip(authored.iter()) {
        if *side != 0 {
            assert_eq!(cls, was, "the other side keeps what the scenario authored");
            continue;
        }
        if seen == 0 {
            assert_eq!(*cls, 2, "the picked slot is the picked hull");
        } else {
            assert_eq!(cls, was, "the ship beside it is untouched");
        }
        seen += 1;
    }
    assert!(seen >= 2, "the skirmish seats two, or this proves nothing");

    // And the second slot is its own choice.
    ft_hull_choice(0, 1, 4);
    ft_match_new(0xdead_beef, 0xcafe_0001, 0, 0b01);
    let both = read();
    let mine: Vec<u32> = both.iter().filter(|(side, _)| *side == 0).map(|(_, c)| *c).collect();
    assert_eq!(mine, vec![2, 4], "each slot fields what it was given");
    ft_hull_choice(0, 1, -1);

    // And clearing it puts the authored ships back, so the pick is a choice
    // rather than a one way door.
    ft_hull_choice(0, 0, -1);
    ft_match_new(0xdead_beef, 0xcafe_0001, 0, 0b01);
    assert_eq!(read(), authored, "clearing the pick restores the authored hulls");
}
