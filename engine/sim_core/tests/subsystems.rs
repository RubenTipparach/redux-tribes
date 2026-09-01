//! A volume stops working before its last point of hp does.
//!
//! A hit volume is a box full of machinery, not a barrel with a health bar on
//! it. Shots take it apart a piece at a time, and a drive bay missing four
//! fifths of itself is wreckage rather than a bay running at a fifth. So a
//! volume is offline once it has lost more than `SUB_FAIL_FRAC` of its mass,
//! and the cells the client takes off the picture and the hp the core takes
//! off the state are two views of the same shots rather than two rules.
//!
//! Deliberately unlike a weapon MOUNT, which `mounts.rs` pins the other way:
//! a turret is never partly shot away. Both rules live in the core because
//! both decide outcomes, and a renderer that decided either would be a second
//! opinion about the simulation.

use sim_core::data::{self, ShipClassId, SubKind};
use sim_core::math::V3;
use sim_core::state::{Faction, Sim, SpawnSpec};

const SOLO: u8 = 0b01;

fn pair() -> Sim {
    Sim::new_skirmish(
        "subsystems",
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

/// The first volume of a kind on ship 0.
fn volume_of(sim: &Sim, kind: SubKind) -> usize {
    let defs = sim.ships[0].class_def().subsystems;
    sim.ships[0]
        .subs
        .iter()
        .position(|s| defs[s.def].kind == kind)
        .expect("a frigate has one of these")
}

#[test]
fn a_whole_volume_is_online() {
    let sim = pair();
    for s in &sim.ships[0].subs {
        assert!(!s.dead, "nothing starts offline");
        assert!(!s.offline(), "a volume at full mass is not offline");
        assert!(s.max_hp > 0.0);
    }
}

#[test]
fn the_line_is_a_fifth_of_the_mass_and_not_the_last_point() {
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Thruster);
    let max = sim.ships[0].subs[bi].max_hp;
    // Just above the line: still running, and still with hp to lose.
    sim.ships[0].subs[bi].hp = max * data::SUB_FAIL_FRAC + 0.5;
    assert!(!sim.ships[0].subs[bi].offline(), "above the line it still runs");
    assert!(sim.ships[0].subs[bi].hp > 0.0, "and it is nowhere near zero");
    // On the line: offline, with a fifth of itself left.
    sim.ships[0].subs[bi].hp = max * data::SUB_FAIL_FRAC;
    assert!(sim.ships[0].subs[bi].offline(), "at the line it is wreckage");
    assert!(
        sim.ships[0].subs[bi].hp > 0.0,
        "and the point of the rule is that this happens with mass still on it",
    );
}

#[test]
fn shooting_a_volume_takes_it_offline_with_mass_still_on_it() {
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Thruster);
    let max = sim.ships[0].subs[bi].max_hp;
    let mut events = Vec::new();
    let mut n = 0;
    while !sim.ships[0].subs[bi].dead && n < 400 {
        sim.apply_damage(0, Some(bi), 5.0, None, &mut events, 0, None);
        n += 1;
    }
    let sub = &sim.ships[0].subs[bi];
    assert!(sub.dead, "fire into a volume should take it offline");
    assert!(
        sub.hp <= max * data::SUB_FAIL_FRAC,
        "it went offline at {} of {}, which is above the line",
        sub.hp,
        max,
    );
    // The whole point: it is offline WITHOUT having been reduced to nothing,
    // which is the difference between this and a mount.
    assert!(
        sub.hp > 0.0,
        "it was chewed to zero, so the fifth threshold did nothing",
    );
    // And the ship feels it: no live thruster means the hull is adrift.
    assert!(!sim.ships[0].has_live_thruster(), "the bay is out");
}

#[test]
fn a_volume_absorbs_exactly_what_the_table_authored() {
    // The rule must not move the balance. `data`'s figure is the ABSORB
    // budget, and a volume carries the fifth it dies with ON TOP, so the sum
    // it soaks before going offline is that figure again. Reading the table
    // as the mass instead would cut every subsystem in the game by a fifth,
    // which showed up as a skirmish that had been ending on turn ten still
    // going at turn twenty seven with nobody able to finish.
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Thruster);
    let authored = sim.ships[0].class_def().subsystems[sim.ships[0].subs[bi].def].hp;
    // Straight into the volume, all of it absorbed, so the sum is readable.
    let block = sim.ships[0].class_def().subsystems[sim.ships[0].subs[bi].def].block_pct;
    let mut events = Vec::new();
    let step = 1.0;
    let mut soaked = 0.0f32;
    while !sim.ships[0].subs[bi].dead {
        sim.apply_damage(0, Some(bi), step, None, &mut events, 0, None);
        soaked += step * (block / 100.0);
        assert!(soaked < authored * 2.0, "it never went offline");
    }
    assert!(
        (soaked - authored).abs() <= step,
        "it soaked {soaked} before going offline and the table says {authored}",
    );
}

#[test]
fn dead_and_offline_never_disagree() {
    // The two are one answer, and the place they could part is the prize
    // crew's emergency repair: it hands a captured hull's drive back with a
    // fixed 50 HP, which on a bay big enough would still be under the line.
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Thruster);
    let mut events = Vec::new();
    for _ in 0..400 {
        if sim.ships[0].subs[bi].dead {
            break;
        }
        sim.apply_damage(0, Some(bi), 5.0, None, &mut events, 0, None);
    }
    assert!(sim.ships[0].subs[bi].dead);
    for s in &sim.ships[0].subs {
        assert_eq!(
            s.dead,
            s.offline(),
            "a volume flagged {} reads {} by the rule",
            s.dead,
            s.offline(),
        );
    }
}

#[test]
fn an_offline_volume_stops_absorbing_and_the_hull_takes_it() {
    // Armour is the case where "offline" is the whole behaviour: a belt soaks
    // its block share until it goes, and then it soaks nothing. Past the line
    // it must already have stopped, or the fifth of it that is left keeps
    // shielding the hull behind wreckage.
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Armor);
    let mut events = Vec::new();
    while !sim.ships[0].subs[bi].dead {
        sim.apply_damage(0, Some(bi), 5.0, None, &mut events, 0, None);
    }
    let before = sim.ships[0].hull;
    sim.apply_damage(0, Some(bi), 20.0, None, &mut events, 0, None);
    let took = before - sim.ships[0].hull;
    assert!(
        (took - 20.0).abs() < 0.001,
        "a dead belt absorbed {} of a 20 point shot",
        20.0 - took,
    );
}

#[test]
fn the_threshold_survives_a_snapshot() {
    let mut sim = pair();
    let bi = volume_of(&sim, SubKind::Rcs);
    let mut events = Vec::new();
    while !sim.ships[0].subs[bi].dead {
        sim.apply_damage(0, Some(bi), 5.0, None, &mut events, 0, None);
    }
    let hp = sim.ships[0].subs[bi].hp;
    let mut buf = vec![0.0f32; sim.snapshot_len()];
    sim.write_snapshot(&mut buf).expect("a snapshot fits its own length");
    let mut back = pair();
    back.restore_snapshot(&buf).expect("it restores");
    assert!(back.ships[0].subs[bi].dead, "a restore must not put it back online");
    assert_eq!(back.ships[0].subs[bi].hp, hp, "and it keeps the mass it had left");
    assert!(!back.ships[0].has_live_rcs(), "the hull still cannot turn");
}
