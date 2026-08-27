//! The AI, a port of the archive's `BaseAIController.DoAIStuff`
//! (docs/DESIGN.md section 5): one decision procedure per turn, issuing the
//! same orders a player would issue.
//!
//! It reads state and returns an order. It writes nothing. That is not
//! tidiness: a client replaying a stored turn, or receiving orders over the
//! wire, never calls this, so anything written onto a ship here would exist on
//! one machine and not the other and the state hashes would part several turns
//! later with no clue why (ADR-6). The target choice is REPORTED in the order
//! and applied by the resolver on every path instead.

use crate::flight::Mode;
use crate::state::Sim;
use crate::turn::{FireOrder, Order};

pub fn plan_ship(sim: &Sim, si: usize) -> Order {
    let ship = &sim.ships[si];
    let cls = ship.class_def();

    let enemies: Vec<usize> = sim
        .ships
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.destroyed && s.faction != ship.faction)
        .map(|(i, _)| i)
        .collect();
    if enemies.is_empty() {
        return Order { mode: Some(Mode::MoveAndTurn), ..Default::default() };
    }

    let mut rng = crate::rng::Rng::new(&sim.seed, sim.turn, &format!("ai:{}", si));

    // Keep the retaliation target while it lives, else take the first live
    // enemy by index. Kill priority is emergent from registration order, the
    // same way the archive's was, rather than being a rule anyone wrote.
    let ti = ship
        .ai_target
        .map(|t| t as usize)
        .filter(|t| enemies.contains(t))
        .unwrap_or(enemies[0]);
    let target = &sim.ships[ti];

    let dist = ship.pos.dist(target.pos);
    let mut range = ship.flight.nominal_reach();
    // The chase cheat: an AI that cannot close would just sit there.
    if ship.ai_can_chase && dist > range {
        range += 20.0;
    }

    // Destination: a point on a sphere around the target, somewhere between a
    // quarter and all of the engagement range.
    let radial = rng.on_unit_sphere();
    let orbit = rng.range(0.25 * range as f64, range as f64) as f32;
    let dest = target.pos.add(radial.scale(orbit));
    let face = target.pos.sub(ship.pos).norm();

    // One random second, 1..=8, for every weapon that fires this turn. Below a
    // fire probability of 0.2 the AI deterministically queues only its first
    // weapon, which is the low aggression branch the archive shipped.
    let second = rng.int(1, 9);
    let mut weapons = Vec::new();
    for i in 0..ship.weapons.len() {
        if ship.ai_fire_probability < 0.2 {
            if i == 0 {
                weapons.push(FireOrder {
                    weapon_index: 0,
                    second,
                    target_ship: target.id,
                    target_sub: None,
                });
            }
        } else if (rng.float() as f32) < ship.ai_fire_probability {
            weapons.push(FireOrder {
                weapon_index: i,
                second,
                target_ship: target.id,
                target_sub: None,
            });
        }
    }

    // The boarding specialist actually specialises: a rogue hull closes and
    // boards when it is near enough and still has marines to spare.
    let board = if cls.boarding_range >= 40.0
        && ship.marines > cls.boarding_capacity
        && dist <= cls.boarding_range
    {
        Some(target.id)
    } else {
        None
    };

    Order {
        mode: Some(Mode::MoveAndTurn),
        target: Some(dest),
        face: Some(face),
        weapons,
        board,
        ai_target: Some(target.id),
    }
}
