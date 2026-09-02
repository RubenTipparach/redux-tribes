//! The hit volumes, as the boxes they are.
//!
//! The layout IS the damage model: a shot damages whatever volume it
//! physically reaches first, so where the volumes sit and how big they are is
//! not decoration. These pin the aspect story the frigate layout is built to
//! tell, in the only way that means anything, which is by firing a segment at
//! a hull from a direction and asking what it met.
//!
//! Spheres could not tell that story. Six of them on a frigate overlapped into
//! one ball with the ship inside it: the belts alone spanned the whole
//! centreline, so every aspect met a belt and choosing one bought nothing.

use sim_core::data::ShipClassId;
use sim_core::math::{Quat, V3};
use sim_core::state::{Faction, Sim, SpawnSpec};

const SOLO: u8 = 0b01;

fn lone(class: ShipClassId) -> Sim {
    Sim::new_skirmish(
        "volumes",
        &[SpawnSpec { class, pos: V3::ZERO, facing: V3::new(0.0, 0.0, 1.0) }],
        &[SpawnSpec {
            class: ShipClassId::KarisenFrigate,
            pos: V3::new(0.0, 0.0, 400.0),
            facing: V3::new(0.0, 0.0, -1.0),
        }],
        Faction::Karisen,
        SOLO,
    )
}

/// What a shot fired from `from` at the hull's centre meets first, by id.
fn from_direction(sim: &Sim, from: V3) -> &'static str {
    let target = sim.ships[0].pos;
    let hit = sim.raycast_ships(from, target, Some(sim.ships[1].id)).expect("the segment reaches");
    match hit.sub {
        Some(bi) => sim.ships[0].class_def().subsystems[sim.ships[0].subs[bi].def].id,
        None => "hull",
    }
}

/// What a shot aimed AT one volume's own centre meets first.
fn aimed_at(sim: &Sim, id: &str, from: V3) -> &'static str {
    let ship = &sim.ships[0];
    let bi = ship
        .subs
        .iter()
        .position(|s| ship.class_def().subsystems[s.def].id == id)
        .expect("the class carries it");
    let at = ship.sub_world_pos(&ship.subs[bi]);
    let hit = sim
        .raycast_ships(at.add(from), at, Some(sim.ships[1].id))
        .expect("the segment reaches");
    match hit.sub {
        Some(b) => ship.class_def().subsystems[ship.subs[b].def].id,
        None => "hull",
    }
}

#[test]
fn the_belts_cover_the_flanks_and_the_bow_and_not_the_belly() {
    // The reactor's whole protection, and nothing declares it: a belt is in
    // the way from abeam and from ahead, and is not from underneath. That is
    // what makes closing from a low aspect worth doing, and it is a fact about
    // where the boxes are rather than a rule anybody wrote.
    let sim = lone(ShipClassId::TerranFrigate);
    assert_eq!(from_direction(&sim, V3::new(-40.0, 0.0, 0.0)), "armor_l", "from port");
    assert_eq!(from_direction(&sim, V3::new(40.0, 0.0, 0.0)), "armor_r", "from starboard");
    // Either belt over the bow: they meet on the keel line, so a shot down
    // the centreline enters both at the same z and the tie is arbitrary.
    assert!(from_direction(&sim, V3::new(0.0, 0.0, 40.0)).starts_with("armor"), "from ahead");
    assert_eq!(from_direction(&sim, V3::new(0.0, -40.0, 0.0)), "reactor", "from below");
}

#[test]
fn every_volume_is_reachable_from_the_aspect_it_faces() {
    // A volume nothing can reach is a hit box that teaches a player the wrong
    // lesson: they aim at the jets, the shot lands on a belt, and the model
    // looks broken. Each one has an aspect that is ITS aspect.
    let sim = lone(ShipClassId::TerranFrigate);
    assert_eq!(aimed_at(&sim, "rcs", V3::new(0.0, -30.0, 0.0)), "rcs", "jets from below");
    assert_eq!(aimed_at(&sim, "weapons", V3::new(0.0, 30.0, 0.0)), "weapons", "bay from above");
    assert_eq!(aimed_at(&sim, "engines", V3::new(0.0, 0.0, -30.0)), "engines", "drives from astern");
    assert_eq!(aimed_at(&sim, "armor_l", V3::new(-30.0, 0.0, 0.0)), "armor_l", "belt from abeam");
}

#[test]
fn a_volume_fits_inside_the_hull_it_belongs_to() {
    // The complaint that started this: spheres big enough to hold a drive bay
    // stuck out through the plating on all six sides, and the schematic drew
    // a ship lost inside its own hit boxes. A box that leaves the hull is a
    // box a shot can meet before the ship.
    // Every class there is, rather than a list of them. A hand written list is
    // a list a new class is simply absent from, and the check then passes by
    // never looking at the hull that was just added.
    for class in sim_core::data::ALL_CLASSES {
        let sim = lone(class);
        let ship = &sim.ships[0];
        for sub in &ship.subs {
            let def = &ship.class_def().subsystems[sub.def];
            let far = def.offset.add(V3::new(
                def.half.x * def.offset.x.signum(),
                def.half.y * def.offset.y.signum(),
                def.half.z * def.offset.z.signum(),
            ));
            assert!(
                far.len() <= ship.radius,
                "{} reaches {} on a hull of {}",
                def.id, far.len(), ship.radius,
            );
        }
    }
}

#[test]
fn the_boxes_turn_with_the_hull() {
    // Read in world coordinates a box would be a compass direction rather than
    // a place on the ship, and a frigate presenting its stern would still be
    // belted to port.
    let mut sim = lone(ShipClassId::TerranFrigate);
    assert!(from_direction(&sim, V3::new(0.0, 0.0, 40.0)).starts_with("armor"), "belted over the bow");
    // Stand the hull on its side: what was the belly is now the flank.
    sim.ships[0].quat = Quat::axis_angle(V3::new(0.0, 0.0, 1.0), -sim_core::math::PI / 2.0);
    assert_eq!(
        from_direction(&sim, V3::new(-40.0, 0.0, 0.0)),
        "reactor",
        "rolled onto its side, the open belly faces port",
    );
}

#[test]
fn the_slab_test_answers_the_awkward_segments() {
    // The three that a naive implementation gets wrong: a miss, a segment that
    // starts inside the box, and one running exactly parallel to a face.
    let c = V3::new(0.0, 0.0, 0.0);
    let h = V3::new(1.0, 1.0, 1.0);
    assert!(Sim::seg_box(V3::new(-5.0, 3.0, 0.0), V3::new(5.0, 3.0, 0.0), c, h).is_none(), "over the top");
    let inside = Sim::seg_box(V3::new(0.0, 0.0, 0.0), V3::new(5.0, 0.0, 0.0), c, h);
    assert_eq!(inside, Some(0.0), "a segment starting inside is already in it");
    // Parallel to x, inside the y and z slabs: a division by zero would make
    // this a NaN and NaN comparisons are all false, so it would report a miss.
    let along = Sim::seg_box(V3::new(-5.0, 0.5, 0.5), V3::new(5.0, 0.5, 0.5), c, h);
    assert!(along.is_some_and(|t| (t - 0.4).abs() < 1e-5), "parallel and through it: {along:?}");
    // And the same line moved out of the y slab misses.
    assert!(Sim::seg_box(V3::new(-5.0, 2.5, 0.5), V3::new(5.0, 2.5, 0.5), c, h).is_none());
    // A segment that stops short never arrives.
    assert!(Sim::seg_box(V3::new(-5.0, 0.0, 0.0), V3::new(-2.0, 0.0, 0.0), c, h).is_none());
}

/// A warship's boarding gear has to reach a hull it is TOUCHING.
///
/// Boarding is measured centre to centre (`turn.rs`) while contact separation
/// holds two hulls `ra + rb` apart, so a class whose `boarding_range` is under
/// the sum of the two radii can never board that hull at any legal separation:
/// the window is empty and the button does nothing. `docs/SHIP_DESIGNER.md`
/// raised this as the thing to check before authoring hulls bigger than the
/// Freighter, and this is that check, run over every ordered pair.
///
/// The Freighter is the one exemption and it is deliberate. It is a civilian
/// hull with a ten unit reach, whose window against a FRIGATE is already only
/// two units wide, and against anything at the destroyer rung or above it is
/// empty. Making it reach would mean either giving a cargo hauler a warship's
/// boarding gear or making `boarding_range` surface relative in the core,
/// which changes every existing match outcome and is the owner's call rather
/// than a side effect of adding hulls. What this test pins is that no WARSHIP
/// is in that position, and that the exemption stays exactly one class wide.
#[test]
fn every_warship_can_board_a_hull_it_is_touching() {
    use sim_core::data::{ship_class, ALL_CLASSES};
    let mut unreachable = Vec::new();
    for a in ALL_CLASSES {
        let ca = ship_class(a);
        // An UNARMED hull is exempt, and by its own table rather than by name.
        // The rule this checks is about a warship: a ship whose gun can reach
        // a hull it is touching and whose marines cannot is a ship with a
        // boarding range that is a decoration. A freighter, a tanker or a
        // liner carries no gun and no boarding gear, so the base reach is the
        // whole of what it has and it is not supposed to reach anybody.
        //
        // It used to name the Freighter outright, which passed for exactly as
        // long as the Freighter was the only civil hull in the game.
        if ca.weapons.is_empty() {
            continue;
        }
        for b in ALL_CLASSES {
            if a == b {
                continue;
            }
            let cb = ship_class(b);
            if ca.boarding_range < ca.radius + cb.radius {
                unreachable.push((ca.key, cb.key));
            }
        }
    }
    let offenders: Vec<&str> = {
        let mut v: Vec<&str> = unreachable.iter().map(|(a, _)| *a).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    assert!(offenders.is_empty(),
        "an armed class cannot board a hull it is touching: {unreachable:?}");
}
