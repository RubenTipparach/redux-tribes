//! Turn resolution: the whole ten seconds, resolved at once.
//!
//! The order inside a tick is fixed and load bearing (ADR-3). Kinematics
//! first, then projectiles, then contact, then whatever the second boundary
//! schedules. Two clients that ran these in a different order would agree on
//! every rule and still diverge, so the sequence is part of the rules.
//!
//! Nothing here reads a clock, a renderer or the network. A turn is a pure
//! function of (state, orders): the same pair always produces the same state
//! and the same event stream, which is what lets the server broker a match
//! without ever simulating one (ADR-6).

use crate::data::{self, SubKind, WeaponKind};
use crate::flight::{fly_span, Mode, TICKS_PER_SECOND, TICKS_PER_TURN, TURN_SECONDS};
use crate::math::{arc_test_3d, bezier2, V3};
use crate::rng::{Rng, Stream};
use crate::state::{
    BoardingParty, ProjKind, Projectile, ShipId, Sim, Winner,
};

// ------------------------------------------------------------------ orders --

#[derive(Clone, Copy, Debug)]
pub struct FireOrder {
    pub weapon_index: usize,
    /// Second of the turn, 0..=10. Both endpoints fire: slot 10 lands on tick
    /// 600, which the archive dropped and this does not.
    pub second: i32,
    pub target_ship: ShipId,
    pub target_sub: Option<usize>,
}

#[derive(Clone, Debug, Default)]
pub struct Order {
    pub mode: Option<Mode>,
    pub target: Option<V3>,
    pub face: Option<V3>,
    /// Commanded roll about the nose, in radians from wings level. None holds
    /// whatever the hull is already at, which is what every order did before
    /// there was a roll to command.
    pub roll: Option<f32>,
    pub weapons: Vec<FireOrder>,
    pub board: Option<ShipId>,
    /// The AI's chosen target, carried IN the order rather than written onto
    /// the ship when planning. A client replaying a stored turn, or receiving
    /// orders over the wire, never runs the planner, so a side effect written
    /// at plan time would exist on one machine and not the other and the
    /// hashes would part (ADR-6).
    pub ai_target: Option<ShipId>,
}

// ------------------------------------------------------------------ events --

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EventKind {
    TurnStart,
    ShotFired,
    ShotHit,
    ShotMiss,
    ShotSkippedRange,
    ShotSkippedArc,
    ProjectileSpawned,
    ProjectileExpired,
    Damage,
    SubsystemDestroyed,
    ShipDrifting,
    ShipDestroyed,
    Collision,
    BoardingStarted,
    BoardingTick,
    ShipCaptured,
    GameOver,
    /// Appended rather than filed next to the other two skips on purpose: the
    /// client mirrors these discriminants by position, so inserting one in the
    /// middle silently renumbers every kind after it.
    ShotSkippedCooldown,
}

/// One thing that happened, flattened to numbers so it crosses the wasm
/// boundary as a fixed size record with no allocation on the far side.
#[derive(Clone, Copy, Debug)]
pub struct Event {
    pub kind: EventKind,
    pub tick: i32,
    /// Subject: the ship this happened TO, or the first party to a collision.
    pub ship: i32,
    /// Other party: attacker, owner, or the second ship in a collision.
    pub other: i32,
    /// Subsystem index, weapon index, or projectile id, per kind.
    pub aux: i32,
    pub amount: f32,
    pub pos: V3,
    pub to: V3,
}

impl Event {
    fn new(kind: EventKind, tick: i32) -> Self {
        Self {
            kind,
            tick,
            ship: -1,
            other: -1,
            aux: -1,
            amount: 0.0,
            pos: V3::ZERO,
            to: V3::ZERO,
        }
    }
}

pub struct TurnResult {
    pub events: Vec<Event>,
    pub hash: u64,
}

// ------------------------------------------------------------------ damage --

impl Sim {
    fn stream(&self, key: Stream) -> Rng {
        Rng::stream(self.seed_hash, self.turn, key)
    }

    /// Apply damage to a ship, optionally through one of its subsystem
    /// volumes. A live subsystem absorbs its block share and the rest bleeds
    /// through to the hull, so armour never makes a ship immune, only
    /// expensive.
    #[allow(clippy::too_many_arguments)]
    fn apply_damage(
        &mut self,
        si: usize,
        sub_idx: Option<usize>,
        dmg: f32,
        attacker: Option<ShipId>,
        events: &mut Vec<Event>,
        tick: i32,
    ) {
        if self.ships[si].destroyed {
            return;
        }
        let mut hull_share = dmg;
        let mut engines_just_died = false;

        if let Some(bi) = sub_idx {
            let block_pct = {
                let ship = &self.ships[si];
                let sub = &ship.subs[bi];
                if sub.dead {
                    None
                } else {
                    Some(ship.class_def().subsystems[sub.def].block_pct)
                }
            };
            if let Some(block_pct) = block_pct {
                let absorbed = dmg * (block_pct / 100.0);
                hull_share = dmg - absorbed;
                let sub = &mut self.ships[si].subs[bi];
                sub.hp = (sub.hp - absorbed).max(0.0);
                if sub.hp <= 0.0 {
                    sub.dead = true;
                    let mut e = Event::new(EventKind::SubsystemDestroyed, tick);
                    e.ship = si as i32;
                    e.aux = bi as i32;
                    events.push(e);

                    let ship = &self.ships[si];
                    let was_thruster =
                        ship.class_def().subsystems[ship.subs[bi].def].kind == SubKind::Thruster;
                    if was_thruster && !ship.has_live_thruster() {
                        engines_just_died = true;
                    }
                }
            }
        }

        // Engines out: the rest of this turn is unpowered from right here, so
        // the ship re-flies the remainder as a coast. Doing it now rather than
        // at the turn boundary is what makes losing engines feel like losing
        // engines instead of like a delayed status effect.
        if engines_just_died {
            let coast = self.ships[si].vel_at_tick(tick);
            let ship = &mut self.ships[si];
            ship.drift_active = true;
            ship.drift_dir = coast;
            self.replan_from(si, tick, coast);
            let mut e = Event::new(EventKind::ShipDrifting, tick);
            e.ship = si as i32;
            events.push(e);
        }

        let ship = &mut self.ships[si];
        ship.hull = (ship.hull - hull_share).max(0.0);

        let mut e = Event::new(EventKind::Damage, tick);
        e.ship = si as i32;
        e.other = attacker.map(|a| a as i32).unwrap_or(-1);
        e.aux = sub_idx.map(|b| b as i32).unwrap_or(-1);
        e.amount = dmg;
        e.pos = ship.pos;
        events.push(e);

        // Retaliation: being shot makes the AI care who did it (the archive's
        // FiredEvent into IfFiredUponAlert).
        if ship.ai_enabled {
            if let Some(a) = attacker {
                ship.ai_target = Some(a);
            }
        }

        if ship.hull <= 0.0 {
            ship.destroyed = true;
            let mut e = Event::new(EventKind::ShipDestroyed, tick);
            e.ship = si as i32;
            e.other = attacker.map(|a| a as i32).unwrap_or(-1);
            // Where it died. Every other event worth drawing carries one, and
            // a client that looked the hull's position up instead would be
            // reading a pose the wreck no longer has.
            e.pos = ship.pos;
            events.push(e);
        }
    }

    // -------------------------------------------------------------- movement --

    /// Build a ship's flight plan for the turn from its order.
    fn plan_movement(&mut self, si: usize, order: Option<&Order>) {
        let ship = &self.ships[si];
        let mut mode = order.and_then(|o| o.mode).unwrap_or(Mode::MoveAndTurn);
        if ship.drift_active {
            mode = Mode::Drift;
        }

        // The boost gate: a burn needs a prior MoveAndTurn, unspent, that did
        // not end in a stop. An ungated burn every turn is not a decision.
        if mode == Mode::FullSpeed
            && !(ship.last_mode == Mode::MoveAndTurn && !ship.has_boosted && !ship.stopped)
        {
            mode = Mode::MoveAndTurn;
        }

        let target = order.and_then(|o| o.target);
        let face = order.and_then(|o| o.face);
        let roll = order.and_then(|o| o.roll);
        let body = ship.body();
        let fl = ship.flight;
        let dead = ship.drift_active;

        let flown = if dead {
            // No thrust and no attitude authority: coast, and let fly_span
            // handle it through Drift rather than special casing it here.
            fly_span(body, None, Mode::Drift, &fl, face, roll, TICKS_PER_TURN,
                     1.0 / TICKS_PER_SECOND as f32, &self.wells)
        } else {
            fly_span(body, target, mode, &fl, face, roll, TICKS_PER_TURN,
                     1.0 / TICKS_PER_SECOND as f32, &self.wells)
        };

        let ship = &mut self.ships[si];
        match mode {
            Mode::FullSpeed => ship.has_boosted = true,
            Mode::FullStop => ship.stopped = true,
            Mode::Drift => {}
            _ => {
                ship.stopped = false;
                ship.has_boosted = false;
            }
        }
        if mode != Mode::Drift {
            ship.last_mode = mode;
        }
        ship.mode = mode;
        ship.plan = flown.path;
        ship.plan_end_vel = flown.end_vel;
        ship.plan_end_quat = flown.end_quat;
        ship.plan_from_tick = 0;
        ship.plan_target = target;
        ship.plan_face = face;
        ship.plan_roll = roll;
    }

    /// Fly into a world and you are part of it.
    ///
    /// A well's softening radius is not a fudge factor, it is the body's own
    /// radius: the distance inside which the field stops growing because you
    /// are inside the mass. So crossing it is not a near miss, it is the
    /// surface, and a hull that reaches it is gone.
    ///
    /// Straight after kinematics and before contact, because a hull that is
    /// inside a planet should not go on to bump into anything else this tick.
    /// Killed through `apply_damage` like everything else, so the wreck, the
    /// event and its position all come out of the one pipeline rather than a
    /// second way for a ship to die.
    fn resolve_impacts(&mut self, tick: i32, events: &mut Vec<Event>) {
        // Gathered first, because the loop reads the wells while the kill
        // writes to the ships.
        let mut hit: Vec<usize> = Vec::new();
        for (si, ship) in self.ships.iter().enumerate() {
            if ship.destroyed {
                continue;
            }
            let r = ship.class_def().radius;
            for w in &self.wells {
                let reach = w.soft + r;
                if ship.pos.sub(w.pos).len2() <= reach * reach {
                    hit.push(si);
                    break;
                }
            }
        }
        for si in hit {
            // Exactly enough to finish it, so the damage event carries a real
            // number rather than an infinity the console would have to print.
            let left = self.ships[si].hull.max(0.0) + 1.0;
            self.apply_damage(si, None, left, None, events, tick);
        }
    }

    /// Re-fly the remainder of the turn after contact changed the velocity.
    /// The order still stands, so the ship keeps trying for the same
    /// destination from wherever it was left.
    fn replan_from(&mut self, si: usize, tick: i32, exit_vel: V3) {
        let ship = &self.ships[si];
        let steps = (TICKS_PER_TURN as i32 - tick).max(1) as u32;
        let body = crate::flight::Body { pos: ship.pos, vel: exit_vel, quat: ship.quat };
        let mode = if ship.drift_active { Mode::Drift } else { ship.mode };
        let flown = fly_span(
            body,
            ship.plan_target,
            mode,
            &ship.flight,
            ship.plan_face,
            ship.plan_roll,
            steps,
            1.0 / TICKS_PER_SECOND as f32,
            &self.wells,
        );
        let ship = &mut self.ships[si];
        ship.plan = flown.path;
        ship.plan_end_vel = flown.end_vel;
        ship.plan_end_quat = flown.end_quat;
        ship.plan_from_tick = tick;
    }

    // ----------------------------------------------------------------- rules --
    // Questions the client also needs to ask, so they live here and are asked
    // rather than reimplemented. A rule with two implementations is a rule
    // that will be changed in one of them: the UI would grey out the wrong
    // weapon, or offer a boarding action the resolver then silently drops,
    // and neither failure says anything about itself.

    /// May this weapon fire this turn?
    ///
    /// Now just `fire_gate` at second zero: "can this mount fire at all this
    /// turn". The old arithmetic counted whole turns, which made cooldown 0
    /// and 1 both mean fire every turn, so no weapon ever waited.
    pub fn can_fire(&self, si: usize, weapon_index: usize) -> bool {
        self.fire_gate(si, weapon_index, 0)
    }

    /// May this mount fire at `second` of the CURRENT turn?
    ///
    /// One rule on the match clock: the gap since the mount last fired must
    /// reach its cooldown. Absolute ticks, so a shot at second 9 of one turn
    /// still holds the mount at second 0 of the next, and a second shot later
    /// in the same turn is gated by exactly the same comparison.
    ///
    /// The planner asks this to decide which fire slots to offer, and the
    /// resolver asks it before every shot, so a slot the client offers is a
    /// slot the resolver will honour.
    pub fn fire_gate(&self, si: usize, weapon_index: usize, second: i32) -> bool {
        let Some(ship) = self.ships.get(si) else { return false };
        let Some(w) = ship.weapons.get(weapon_index) else { return false };
        if w.last_fired_tick < 0 {
            return true;
        }
        let at = self.absolute_tick(second * TICKS_PER_SECOND as i32);
        at - w.last_fired_tick >= Self::cooldown_ticks(w.key)
    }

    /// A weapon's cooldown in ticks. Rounded once, here, so the planner and the
    /// resolver cannot round it differently.
    pub fn cooldown_ticks(key: crate::data::WeaponKey) -> i32 {
        (data::weapon(key).cooldown_secs * TICKS_PER_SECOND as f32) as i32
    }

    /// Ticks since the match began, which is the clock cooldown runs on.
    pub fn absolute_tick(&self, tick: i32) -> i32 {
        self.turn * TICKS_PER_TURN as i32 + tick
    }

    /// The earliest second of THIS turn at which a mount could fire again,
    /// given a shot already planned at `prev_second`. Negative `prev_second`
    /// means nothing is planned yet. The client walks its own queue and asks
    /// this, so the spacing itself is never computed in the renderer.
    pub fn next_free_second(&self, si: usize, weapon_index: usize, prev_second: i32) -> i32 {
        let Some(ship) = self.ships.get(si) else { return 0 };
        let Some(w) = ship.weapons.get(weapon_index) else { return 0 };
        let gap = Self::cooldown_ticks(w.key);
        let from_state = if w.last_fired_tick < 0 {
            0
        } else {
            let t = w.last_fired_tick + gap - self.absolute_tick(0);
            (t + TICKS_PER_SECOND as i32 - 1) / TICKS_PER_SECOND as i32
        };
        let from_queue = if prev_second < 0 {
            0
        } else {
            prev_second + (gap + TICKS_PER_SECOND as i32 - 1) / TICKS_PER_SECOND as i32
        };
        from_state.max(from_queue).max(0)
    }

    /// May this ship send marines to that one right now?
    pub fn can_board(&self, si: usize, ti: usize) -> bool {
        let (Some(from), Some(to)) = (self.ships.get(si), self.ships.get(ti)) else {
            return false;
        };
        !from.destroyed
            && !to.destroyed
            && to.faction != from.faction
            && from.marines > 0
            && from.pos.dist(to.pos) <= from.class_def().boarding_range
    }

    // --------------------------------------------------------------- weapons --

    fn fire_weapon(&mut self, si: usize, order: &FireOrder, tick: i32, events: &mut Vec<Event>) {
        let ti = order.target_ship as usize;
        if ti >= self.ships.len() || self.ships[ti].destroyed {
            return;
        }
        let Some(w) = self.ships[si].weapons.get(order.weapon_index) else {
            return;
        };
        let key = w.key;
        let wd = data::weapon(key);

        // The same gate the planner offered slots from, asked again here at
        // the moment of firing. A shot the cooldown does not allow is dropped
        // rather than silently fired: the client will not have offered it, and
        // a hand written or stale order set must not get a free shot.
        let second = tick / TICKS_PER_SECOND as i32;
        if !self.fire_gate(si, order.weapon_index, second) {
            let mut e = Event::new(EventKind::ShotSkippedCooldown, tick);
            e.ship = si as i32;
            e.aux = order.weapon_index as i32;
            events.push(e);
            return;
        }

        let mount_pos = self.ships[si].mount_world_pos(w);
        let quat = self.ships[si].quat;

        // Aim at the requested subsystem volume if it is still alive, else at
        // the hull centre. Live position, not a lead: the archive did not lead
        // targets and neither does this.
        let aim_sub = order.target_sub.filter(|bi| {
            self.ships[ti].subs.get(*bi).map(|s| !s.dead).unwrap_or(false)
        });
        let aim_pos = match aim_sub {
            Some(bi) => {
                let t = &self.ships[ti];
                t.sub_world_pos(&t.subs[bi])
            }
            None => self.ships[ti].pos,
        };

        // Arc and range are gated at the MOMENT of firing, so a target that
        // manoeuvred out of the envelope during the turn is simply not shot at.
        if mount_pos.dist(aim_pos) > wd.range {
            let mut e = Event::new(EventKind::ShotSkippedRange, tick);
            e.ship = si as i32;
            e.aux = order.weapon_index as i32;
            events.push(e);
            return;
        }
        if !arc_test_3d(
            mount_pos, quat, aim_pos, wd.arc_h.0, wd.arc_h.1, wd.arc_v.0, wd.arc_v.1,
        ) {
            let mut e = Event::new(EventKind::ShotSkippedArc, tick);
            e.ship = si as i32;
            e.aux = order.weapon_index as i32;
            events.push(e);
            return;
        }

        let fired_at = self.absolute_tick(tick);
        self.ships[si].weapons[order.weapon_index].last_fired_tick = fired_at;
        let dmg = wd.damage();
        let owner = self.ships[si].id;

        match wd.kind {
            WeaponKind::Beam => {
                let mut rng = self.stream(Stream::new(
                    Stream::WEAPON,
                    si as u32,
                    key as u32,
                    tick as u32,
                ));
                let scatter = rng.inside_unit_sphere().scale(data::BEAM_SCATTER);
                let dir = aim_pos.add(scatter).sub(mount_pos).norm();
                let end = mount_pos.add(dir.scale(wd.range));

                let mut e = Event::new(EventKind::ShotFired, tick);
                e.ship = si as i32;
                e.aux = order.weapon_index as i32;
                e.pos = mount_pos;
                e.to = end;
                events.push(e);

                match self.raycast_ships(mount_pos, end, Some(owner)) {
                    Some(hit) => {
                        let mut e = Event::new(EventKind::ShotHit, tick);
                        e.ship = hit.ship as i32;
                        e.other = si as i32;
                        e.aux = hit.sub.map(|b| b as i32).unwrap_or(-1);
                        e.pos = hit.pos;
                        events.push(e);
                        self.apply_damage(hit.ship, hit.sub, dmg, Some(owner), events, tick);
                    }
                    None => {
                        let mut e = Event::new(EventKind::ShotMiss, tick);
                        e.ship = si as i32;
                        e.aux = order.weapon_index as i32;
                        events.push(e);
                    }
                }
            }
            WeaponKind::Cannon => {
                // Aim is fixed at fire time. A shell does not home, which is
                // what makes a cannon a commitment and a missile a threat.
                let dir = aim_pos.sub(mount_pos).norm();
                let id = self.next_proj_id;
                self.next_proj_id += 1;
                self.projectiles.push(Projectile {
                    id,
                    kind: ProjKind::Cannon,
                    owner,
                    dmg,
                    pos: mount_pos,
                    vel: dir.scale(data::CANNON_SPEED / TICKS_PER_SECOND as f32),
                    target_ship: None,
                    seg_start: V3::ZERO,
                    seg_cp: V3::ZERO,
                    seg_target: V3::ZERO,
                    seg_tick: 0,
                    last_vel: V3::ZERO,
                    life: data::CANNON_LIFE_TICKS,
                });
                let mut e = Event::new(EventKind::ProjectileSpawned, tick);
                e.ship = si as i32;
                e.aux = id as i32;
                e.amount = 0.0;
                events.push(e);
            }
            WeaponKind::Missile => {
                let fwd = quat.forward();
                for b in 0..wd.batch {
                    let mut rng =
                        self.stream(Stream::new(Stream::MISSILE_SPAWN, si as u32, tick as u32, b as u32));
                    let rally = mount_pos
                        .add(fwd.scale(data::MISSILE_LAUNCH_SPEED))
                        .add(rng.inside_unit_sphere().scale(data::MISSILE_LAUNCH_SCATTER));
                    let id = self.next_proj_id;
                    self.next_proj_id += 1;
                    self.projectiles.push(Projectile {
                        id,
                        kind: ProjKind::Missile,
                        owner,
                        dmg,
                        pos: mount_pos,
                        vel: V3::ZERO,
                        target_ship: Some(self.ships[ti].id),
                        seg_start: mount_pos,
                        seg_cp: mount_pos.lerp(rally, 0.5),
                        seg_target: rally,
                        seg_tick: 0,
                        last_vel: rally.sub(mount_pos),
                        life: data::MISSILE_LIFE_TICKS,
                    });
                    let mut e = Event::new(EventKind::ProjectileSpawned, tick);
                    e.ship = si as i32;
                    e.other = ti as i32;
                    e.aux = id as i32;
                    e.amount = 1.0; // missile rather than shell
                    events.push(e);
                }
            }
        }
    }

    fn step_projectiles(&mut self, tick: i32, events: &mut Vec<Event>) {
        let mut hits: Vec<(usize, Option<usize>, f32, Option<ShipId>, u32, V3)> = Vec::new();
        let mut expired: Vec<u32> = Vec::new();

        for pi in 0..self.projectiles.len() {
            let prev = self.projectiles[pi].pos;

            if self.projectiles[pi].kind == ProjKind::Cannon {
                let v = self.projectiles[pi].vel;
                self.projectiles[pi].pos = prev.add(v);
            } else {
                self.projectiles[pi].seg_tick += 1;
                if self.projectiles[pi].seg_tick >= data::MISSILE_HOP_TICKS {
                    self.projectiles[pi].seg_tick = 0;
                    let p = self.projectiles[pi].clone();
                    let mut rng = self.stream(Stream::new(Stream::MISSILE_HOP, p.id, tick as u32, 0));
                    let target_alive = p
                        .target_ship
                        .and_then(|t| self.ships.get(t as usize))
                        .filter(|s| !s.destroyed)
                        .map(|s| s.pos);
                    let next = match target_alive {
                        Some(tp) => {
                            let dir = tp.sub(p.pos).norm();
                            p.pos
                                .add(dir.scale(data::MISSILE_PURSUIT_SPEED))
                                .add(rng.inside_unit_sphere().scale(data::MISSILE_HOP_SCATTER))
                        }
                        None => {
                            let dir = if p.last_vel.len() > 1e-9 {
                                p.last_vel.norm()
                            } else {
                                V3::new(0.0, 0.0, 1.0)
                            };
                            p.pos.add(dir.scale(data::MISSILE_PURSUIT_SPEED))
                        }
                    };
                    let m = &mut self.projectiles[pi];
                    m.seg_start = p.pos;
                    m.seg_cp = p.pos.add(p.last_vel.scale(1.0 / data::MISSILE_INERTIA_DIVISOR));
                    m.seg_target = next;
                }
                let m = &self.projectiles[pi];
                let t = ((m.seg_tick + 1) as f32 / data::MISSILE_HOP_TICKS as f32).min(1.0);
                let pos = bezier2(m.seg_start, m.seg_cp, m.seg_target, t);
                let last_vel = m.seg_target.sub(m.seg_cp);
                let m = &mut self.projectiles[pi];
                m.pos = pos;
                m.last_vel = last_vel;
            }

            let p = &self.projectiles[pi];
            if let Some(hit) = self.raycast_ships(prev, p.pos, Some(p.owner)) {
                hits.push((hit.ship, hit.sub, p.dmg, Some(p.owner), p.id, hit.pos));
                continue;
            }
            let m = &mut self.projectiles[pi];
            m.life -= 1;
            if m.life <= 0 {
                let (id, kind) = (m.id, m.kind);
                expired.push(id);
                let mut e = Event::new(EventKind::ProjectileExpired, tick);
                e.aux = id as i32;
                e.amount = if kind == ProjKind::Missile { 1.0 } else { 0.0 };
                events.push(e);
            }
        }

        for (ship, sub, dmg, owner, pid, pos) in hits {
            let mut e = Event::new(EventKind::ShotHit, tick);
            e.ship = ship as i32;
            e.other = owner.map(|o| o as i32).unwrap_or(-1);
            e.aux = sub.map(|b| b as i32).unwrap_or(-1);
            e.pos = pos;
            events.push(e);
            self.apply_damage(ship, sub, dmg, owner, events, tick);
            expired.push(pid);
        }
        if !expired.is_empty() {
            self.projectiles.retain(|p| !expired.contains(&p.id));
        }
    }

    // ------------------------------------------------------------ collisions --

    /// Contact resolution: separate fully, then charge for the impulse.
    ///
    /// Hulls never interpenetrate, which the archive allowed and which read as
    /// a bug every time it happened. Pairs are visited in index order so two
    /// clients resolve a pile-up identically, and a pair that has just traded
    /// damage is on cooldown so a graze does not bill twice a tick.
    fn resolve_collisions(
        &mut self,
        tick: i32,
        events: &mut Vec<Event>,
        pair_cooldowns: &mut Vec<(usize, usize, i32)>,
        prev_positions: &[V3],
    ) {
        let n = self.ships.len();
        for i in 0..n {
            for j in (i + 1)..n {
                if self.ships[i].destroyed || self.ships[j].destroyed {
                    continue;
                }
                let (ra, rb) = (self.ships[i].class_def().radius, self.ships[j].class_def().radius);
                let delta = self.ships[j].pos.sub(self.ships[i].pos);
                let dist = delta.len();
                let min_dist = ra + rb;
                if dist >= min_dist || dist < 1e-9 {
                    continue;
                }

                let nrm = delta.scale(1.0 / dist);
                let overlap = min_dist - dist;
                let (ma, mb) = (self.ships[i].class_def().mass, self.ships[j].class_def().mass);
                // The heavier hull moves less, which is the only place mass
                // shows up in this game and the only place it needs to.
                let wa = mb / (ma + mb);
                let wb = ma / (ma + mb);

                self.ships[i].pos = self.ships[i].pos.sub(nrm.scale(overlap * wa));
                self.ships[j].pos = self.ships[j].pos.add(nrm.scale(overlap * wb));

                let va = self.ships[i].pos.sub(prev_positions[i]).scale(TICKS_PER_SECOND as f32);
                let vb = self.ships[j].pos.sub(prev_positions[j]).scale(TICKS_PER_SECOND as f32);
                let rel_n = va.sub(vb).dot(nrm); // positive means closing

                let cd = pair_cooldowns
                    .iter()
                    .find(|(a, b, _)| *a == i && *b == j)
                    .map(|(_, _, t)| *t)
                    .unwrap_or(-9999);
                if rel_n > 0.5 && tick - cd >= data::COLLISION_PAIR_COOLDOWN_TICKS {
                    match pair_cooldowns.iter_mut().find(|(a, b, _)| *a == i && *b == j) {
                        Some(slot) => slot.2 = tick,
                        None => pair_cooldowns.push((i, j, tick)),
                    }
                    let reduced = (ma * mb) / (ma + mb);
                    let dmg = data::COLLISION_DAMAGE_K * rel_n * reduced;
                    let at = self.ships[i].pos.add(nrm.scale(ra));

                    let mut e = Event::new(EventKind::Collision, tick);
                    e.ship = i as i32;
                    e.other = j as i32;
                    e.amount = dmg;
                    e.pos = at;
                    events.push(e);

                    let (ida, idb) = (self.ships[i].id, self.ships[j].id);
                    self.apply_damage(i, None, dmg, Some(idb), events, tick);
                    self.apply_damage(j, None, dmg, Some(ida), events, tick);
                }

                // Deflect, then re-fly what is left of the turn from the
                // contact. The order stands; only the state it starts from
                // changed.
                let closing = (va.dot(nrm) - vb.dot(nrm)).max(0.0);
                let bounce = data::COLLISION_RESTITUTION;
                let va2 = va.sub(nrm.scale((1.0 + bounce) * closing * wa));
                let vb2 = vb.add(nrm.scale((1.0 + bounce) * closing * wb));
                if !self.ships[i].destroyed {
                    self.replan_from(i, tick, va2);
                }
                if !self.ships[j].destroyed {
                    self.replan_from(j, tick, vb2);
                }
            }
        }
    }

    // -------------------------------------------------------------- boarding --

    fn boarding_second(&mut self, tick: i32, events: &mut Vec<Event>) {
        for si in 0..self.ships.len() {
            if self.ships[si].destroyed || self.ships[si].boarding_parties.is_empty() {
                continue;
            }
            let mut rng = self.stream(Stream::new(Stream::BOARDING, si as u32, 0, 0));
            let eff = data::marine_efficiency(self.ships[si].hull / self.ships[si].hull_max);

            for pi in 0..self.ships[si].boarding_parties.len() {
                let party = self.ships[si].boarding_parties[pi];
                // Friendly reinforcements sit and wait rather than fight.
                if party.faction == self.ships[si].faction
                    || party.count <= 0
                    || self.ships[si].marines <= 0
                {
                    continue;
                }
                let attack = rng.roll_dice(
                    party.count,
                    data::BOARDING_DICE_SIDES,
                    data::BOARDING_DICE_THRESHOLD,
                );
                let defend = rng.roll_dice(
                    self.ships[si].marines,
                    data::BOARDING_DICE_SIDES,
                    data::BOARDING_DICE_THRESHOLD,
                );
                if attack > eff {
                    self.ships[si].marines = (self.ships[si].marines - 1).max(0);
                }
                if defend > 0 {
                    let p = &mut self.ships[si].boarding_parties[pi];
                    p.count = (p.count - eff).max(0);
                }
                let mut e = Event::new(EventKind::BoardingTick, tick);
                e.ship = si as i32;
                e.other = self.ships[si].boarding_parties[pi].faction.index() as i32;
                e.aux = self.ships[si].boarding_parties[pi].count;
                e.amount = self.ships[si].marines as f32;
                events.push(e);
            }

            // Capture: the defenders are gone and someone else's marines are
            // still aboard.
            let capture = self.ships[si]
                .boarding_parties
                .iter()
                .position(|p| p.faction != self.ships[si].faction && p.count > 0)
                .filter(|_| self.ships[si].marines <= 0);
            if let Some(pi) = capture {
                let party = self.ships[si].boarding_parties[pi];
                // A captured hull joins whichever side already flies that
                // faction, and picks up that side's kind of commander. Reading
                // the side off an existing ship rather than assuming side 1 is
                // what makes a three way capture chain land correctly.
                let new_side = self
                    .ships
                    .iter()
                    .find(|s| s.faction == party.faction)
                    .map(|s| s.side)
                    .unwrap_or(0);
                let now_human = self.side_is_human(new_side);
                let ship = &mut self.ships[si];
                ship.faction = party.faction;
                ship.marines = party.count;
                ship.side = new_side;
                ship.ai_enabled = !now_human;
                ship.boarding_parties.remove(pi);

                // The prize crew gets the engines turning again: the archive's
                // 50 HP emergency repair, which is what stops a captured hull
                // being a drifting trophy.
                let defs = ship.class_def().subsystems;
                if let Some(thr) = ship
                    .subs
                    .iter_mut()
                    .find(|s| defs[s.def].kind == SubKind::Thruster)
                {
                    if thr.dead {
                        thr.dead = false;
                        thr.hp = 50.0;
                        ship.drift_active = false;
                    }
                }
                let mut e = Event::new(EventKind::ShipCaptured, tick);
                e.ship = si as i32;
                e.other = party.faction.index() as i32;
                events.push(e);
            }
            self.ships[si].boarding_parties.retain(|p| p.count > 0);
        }
    }

    // ------------------------------------------------------------- main loop --

    /// Resolve one whole turn. `orders` is indexed by ship id; a `None` entry
    /// means the ship was given no order and, if it is an AI, will be planned
    /// for here.
    pub fn resolve_turn(&mut self, orders: &mut [Option<Order>]) -> TurnResult {
        let mut events = vec![Event::new(EventKind::TurnStart, 0)];
        self.tracks.clear();

        // AI plans first, and commits its decisions into the order rather than
        // onto the ship. See Order::ai_target.
        for si in 0..self.ships.len() {
            if !self.ships[si].destroyed
                && self.ships[si].ai_enabled
                && orders.get(si).map(|o| o.is_none()).unwrap_or(true)
            {
                let plan = crate::ai::plan_ship(self, si);
                if si < orders.len() {
                    orders[si] = Some(plan);
                }
            }
        }
        for si in 0..self.ships.len() {
            if let Some(Some(o)) = orders.get(si) {
                if let Some(t) = o.ai_target {
                    self.ships[si].ai_target = Some(t);
                }
            }
        }

        for si in 0..self.ships.len() {
            if self.ships[si].destroyed {
                continue;
            }
            let order = orders.get(si).and_then(|o| o.clone());
            self.plan_movement(si, order.as_ref());
        }

        // Weapon orders bucketed by second. Both endpoints are real slots.
        let mut by_second: Vec<Vec<(usize, FireOrder)>> =
            vec![Vec::new(); TURN_SECONDS as usize + 1];
        for si in 0..self.ships.len() {
            if self.ships[si].destroyed {
                continue;
            }
            if let Some(Some(o)) = orders.get(si) {
                for wo in &o.weapons {
                    let s = wo.second.clamp(0, TURN_SECONDS as i32) as usize;
                    by_second[s].push((si, *wo));
                }
            }
        }

        let mut pair_cooldowns: Vec<(usize, usize, i32)> = Vec::new();
        let mut prev_positions: Vec<V3> = self.ships.iter().map(|s| s.pos).collect();

        for tick in 0..=(TICKS_PER_TURN as i32) {
            // 1. kinematics
            for si in 0..self.ships.len() {
                if self.ships[si].destroyed {
                    continue;
                }
                prev_positions[si] = self.ships[si].pos;
                let p = self.ships[si].pos_at_tick(tick);
                let q = self.ships[si].quat_at_tick(tick);
                self.ships[si].pos = p;
                if !self.ships[si].drift_active {
                    self.ships[si].quat = q;
                }
            }
            // 2. the ground
            self.resolve_impacts(tick, &mut events);
            // 3. projectiles
            self.step_projectiles(tick, &mut events);
            // 4. contact
            self.resolve_collisions(tick, &mut events, &mut pair_cooldowns, &prev_positions);
            // 5. whatever the second boundary schedules
            if tick % TICKS_PER_SECOND as i32 == 0 {
                let second = tick / TICKS_PER_SECOND as i32;
                if second == 0 {
                    self.start_boarding(orders, tick, &mut events);
                }
                let fires: Vec<(usize, FireOrder)> = by_second
                    .get(second as usize)
                    .cloned()
                    .unwrap_or_default();
                for (si, wo) in fires {
                    if !self.ships[si].destroyed {
                        self.fire_weapon(si, &wo, tick, &mut events);
                    }
                }
                // Parties that only just arrived do not fight in the same
                // second they landed.
                if second > 0 {
                    self.boarding_second(tick, &mut events);
                }
            }
            // 6. record the frame for playback
            if self.record {
                self.tracks.push(crate::state::TrackFrame {
                    ships: self.ships.iter().map(|s| (s.pos, s.quat, s.destroyed)).collect(),
                    projectiles: self.projectiles.iter().map(|p| (p.id, p.kind, p.pos)).collect(),
                });
            }
        }

        // Momentum carries: the turn ends with whatever the integrator made.
        for si in 0..self.ships.len() {
            if self.ships[si].destroyed {
                continue;
            }
            self.ships[si].vel = self.ships[si].plan_end_vel;
            if !self.ships[si].drift_active {
                self.ships[si].quat = self.ships[si].plan_end_quat;
            }
        }

        // Win and lose are decided at the turn boundary only.
        let side0_alive = self.ships.iter().any(|s| !s.destroyed && s.side == 0);
        let side1_alive = self.ships.iter().any(|s| !s.destroyed && s.side != 0);
        if !side1_alive && side0_alive {
            self.game_over = Some(Winner::Player);
        } else if !side0_alive {
            self.game_over = Some(Winner::Enemy);
        }
        if let Some(w) = self.game_over {
            let mut e = Event::new(EventKind::GameOver, TICKS_PER_TURN as i32);
            e.aux = if w == Winner::Player { 0 } else { 1 };
            events.push(e);
        }

        self.turn += 1;
        let hash = self.hash_state();
        TurnResult { events, hash }
    }

    fn start_boarding(&mut self, orders: &[Option<Order>], tick: i32, events: &mut Vec<Event>) {
        for si in 0..self.ships.len() {
            let Some(Some(o)) = orders.get(si) else { continue };
            let Some(target_id) = o.board else { continue };
            let ti = target_id as usize;
            if self.ships[si].destroyed || ti >= self.ships.len() {
                continue;
            }
            if !self.can_board(si, ti) {
                continue;
            }
            let capacity = self.ships[si].class_def().boarding_capacity;
            let send = self.ships[si].marines.min(capacity);
            self.ships[si].marines -= send;
            let faction = self.ships[si].faction;
            match self.ships[ti]
                .boarding_parties
                .iter_mut()
                .find(|p| p.faction == faction)
            {
                Some(p) => p.count += send,
                None => self.ships[ti].boarding_parties.push(BoardingParty { faction, count: send }),
            }
            let mut e = Event::new(EventKind::BoardingStarted, tick);
            e.ship = ti as i32;
            e.other = si as i32;
            e.aux = send;
            events.push(e);
        }
    }

    // ------------------------------------------------------------------ hash --

    /// Canonical state hash: the lockstep divergence detector (ADR-5).
    ///
    /// Two states hash equal only if every field below is bit identical, so
    /// this walks a fixed stream of raw float bits rather than anything
    /// rounded or formatted. It cannot say which of two clients is right, only
    /// that they have parted, which is exactly the thing a client cannot
    /// discover about itself.
    pub fn hash_state(&self) -> u64 {
        let mut h1: u32 = 0x811c_9dc5;
        let mut h2: u32 = 0xc9dc_5118;
        let mut byte = |b: u8| {
            h1 ^= b as u32;
            h1 = h1.wrapping_mul(0x0100_0193);
            h2 ^= b as u32;
            h2 = h2.wrapping_mul(0x0100_0197);
        };
        let num = |x: f32, byte: &mut dyn FnMut(u8)| {
            for b in x.to_bits().to_le_bytes() {
                byte(b);
            }
        };
        let int = |x: i32, byte: &mut dyn FnMut(u8)| {
            for b in x.to_le_bytes() {
                byte(b);
            }
        };

        for b in self.seed_hash.to_le_bytes() {
            byte(b);
        }
        int(self.turn, &mut byte);
        int(
            match self.game_over {
                None => -1,
                Some(Winner::Player) => 0,
                Some(Winner::Enemy) => 1,
            },
            &mut byte,
        );
        int(self.next_proj_id as i32, &mut byte);

        // The field bends every flight, so it decides outcomes and belongs in
        // the hash. Count first, so an empty field and a zero strength well
        // are not the same match.
        int(self.wells.len() as i32, &mut byte);
        for w in &self.wells {
            for v in [w.pos.x, w.pos.y, w.pos.z, w.mu, w.soft] {
                num(v, &mut byte);
            }
        }

        for s in &self.ships {
            int(s.id as i32, &mut byte);
            int(s.faction.index() as i32, &mut byte);
            int(s.side as i32, &mut byte);
            int(s.destroyed as i32, &mut byte);
            for v in [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z] {
                num(v, &mut byte);
            }
            for v in [s.quat.x, s.quat.y, s.quat.z, s.quat.w] {
                num(v, &mut byte);
            }
            // Flight stats are tunable at runtime and therefore change the
            // simulation, so they belong in the hash: two clients flying
            // different envelopes must not silently agree.
            for v in [
                s.flight.yaw_rate,
                s.flight.pitch_rate,
                s.flight.accel_fwd,
                s.flight.accel_retro,
                s.flight.accel_lat,
                s.flight.max_speed,
            ] {
                num(v, &mut byte);
            }
            num(s.hull, &mut byte);
            int(s.marines, &mut byte);
            for x in &s.subs {
                num(x.hp, &mut byte);
                int(x.dead as i32, &mut byte);
            }
            for w in &s.weapons {
                int(w.last_fired_tick, &mut byte);
            }
            for p in &s.boarding_parties {
                int(p.faction.index() as i32, &mut byte);
                int(p.count, &mut byte);
            }
            int(s.drift_active as i32, &mut byte);
            for v in [s.drift_dir.x, s.drift_dir.y, s.drift_dir.z] {
                num(v, &mut byte);
            }
            int(s.mode as i32, &mut byte);
            int(s.has_boosted as i32, &mut byte);
            int(s.stopped as i32, &mut byte);
            int(s.ai_target.map(|t| t as i32).unwrap_or(-1), &mut byte);
        }
        for p in &self.projectiles {
            int(p.id as i32, &mut byte);
            int(p.kind as i32, &mut byte);
            int(p.owner as i32, &mut byte);
            for v in [p.pos.x, p.pos.y, p.pos.z] {
                num(v, &mut byte);
            }
            int(p.life, &mut byte);
        }
        ((h1 as u64) << 32) | h2 as u64
    }
}
