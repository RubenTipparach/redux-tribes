//! Turn boundary snapshots (ADR-5).
//!
//! A snapshot is the exact state at the start of a turn, complete enough that
//! restoring it and re-applying that turn's orders reproduces the turn: same
//! events, same end state, same hash. That equality is the whole point, and it
//! is what `tests/replay.rs` asserts.
//!
//! Why bother when the hash already exists: a hash tells you two clients
//! parted, and nothing else. A snapshot plus the orders tells you WHERE, by
//! letting either machine re-run the turn in isolation and compare. It is also
//! the only honest way to evaluate a physics engine. A claim that some
//! integrator is deterministic is untestable without the ability to put the
//! world back and run it again.
//!
//! Only turn boundary state is stored. A ship's flown plan is scratch that
//! `plan_movement` rebuilds from the orders, so writing it down would record a
//! derived value and invite it to disagree with what it derives from.
//!
//! The format is a flat f32 array, matching the rest of the boundary, with
//! counts ahead of every variable length run so a reader never has to guess.

use crate::data::class_from_index;
use crate::data::class_index;
use crate::flight::Mode;
use crate::math::{Quat, V3};
use crate::state::{
    BoardingParty, Faction, ProjKind, Projectile, Ship, ShipId, Sim, Sub, Winner,
};

/// Bumped whenever the layout changes. A snapshot from another version is
/// refused rather than misread: silently reading an old layout produces a
/// state that looks plausible and is wrong, which is the worst outcome
/// available.
/// Bumped to 2 when the gravity field joined the format. A turn flown
/// through a field cannot be re-run without it, so an older snapshot is
/// refused rather than restored into empty space.
///
/// 3 when the sandbox flag joined it. It decides whether flight stats may be
/// edited, and the stats are what a turn is flown with, so a snapshot that
/// restored without it could come back into a match that accepts changes the
/// original refused.
pub const SNAPSHOT_VERSION: f32 = 3.0;

struct Writer<'a> {
    buf: &'a mut [f32],
    at: usize,
    overflow: bool,
}

impl Writer<'_> {
    fn f(&mut self, v: f32) {
        if self.at < self.buf.len() {
            self.buf[self.at] = v;
        } else {
            self.overflow = true;
        }
        self.at += 1;
    }
    fn i(&mut self, v: i32) {
        self.f(v as f32);
    }
    fn b(&mut self, v: bool) {
        self.f(if v { 1.0 } else { 0.0 });
    }
    fn v3(&mut self, v: V3) {
        self.f(v.x);
        self.f(v.y);
        self.f(v.z);
    }
    fn quat(&mut self, q: Quat) {
        self.f(q.x);
        self.f(q.y);
        self.f(q.z);
        self.f(q.w);
    }
}

struct Reader<'a> {
    buf: &'a [f32],
    at: usize,
}

impl Reader<'_> {
    fn f(&mut self) -> f32 {
        let v = self.buf.get(self.at).copied().unwrap_or(0.0);
        self.at += 1;
        v
    }
    fn i(&mut self) -> i32 {
        self.f() as i32
    }
    fn b(&mut self) -> bool {
        self.f() != 0.0
    }
    fn v3(&mut self) -> V3 {
        V3::new(self.f(), self.f(), self.f())
    }
    fn quat(&mut self) -> Quat {
        Quat { x: self.f(), y: self.f(), z: self.f(), w: self.f() }
    }
}

impl Sim {
    /// How many f32 slots `write_snapshot` needs for the current state.
    pub fn snapshot_len(&self) -> usize {
        let mut w = Writer { buf: &mut [], at: 0, overflow: false };
        self.write_into(&mut w);
        w.at
    }

    /// Serialise the turn boundary state. Returns the slots written, or None
    /// if the buffer was too small: a truncated snapshot is not a snapshot.
    pub fn write_snapshot(&self, buf: &mut [f32]) -> Option<usize> {
        let mut w = Writer { buf, at: 0, overflow: false };
        self.write_into(&mut w);
        if w.overflow {
            None
        } else {
            Some(w.at)
        }
    }

    fn write_into(&self, w: &mut Writer) {
        w.f(SNAPSHOT_VERSION);
        w.f(f32::from_bits(self.seed_hash));
        w.i(self.turn);
        w.i(self.human_sides as i32);
        w.i(self.sandbox as i32);
        w.i(self.next_proj_id as i32);
        w.i(match self.game_over {
            None => -1,
            Some(Winner::Player) => 0,
            Some(Winner::Enemy) => 1,
        });
        w.i(self.ships.len() as i32);
        w.i(self.projectiles.len() as i32);
        w.i(self.wells.len() as i32);

        // The field bends the flight, so it is part of what a turn starts
        // from. Written in order, because the accelerations are summed in it.
        for g in &self.wells {
            w.f(g.pos.x);
            w.f(g.pos.y);
            w.f(g.pos.z);
            w.f(g.mu);
            w.f(g.soft);
        }

        for s in &self.ships {
            w.i(s.id as i32);
            w.i(class_index(s.class) as i32);
            w.i(s.faction.index() as i32);
            w.i(s.side as i32);
            w.b(s.destroyed);
            w.f(s.hull);
            w.f(s.hull_max);
            w.i(s.marines);
            w.v3(s.pos);
            w.quat(s.quat);
            w.v3(s.vel);
            w.f(s.flight.yaw_rate);
            w.f(s.flight.pitch_rate);
            w.f(s.flight.accel_fwd);
            w.f(s.flight.accel_retro);
            w.f(s.flight.accel_lat);
            w.f(s.flight.max_speed);
            w.i(s.mode as i32);
            w.i(s.last_mode as i32);
            w.b(s.has_boosted);
            w.b(s.stopped);
            w.b(s.drift_active);
            w.v3(s.drift_dir);
            w.b(s.ai_enabled);
            w.i(s.ai_target.map(|t| t as i32).unwrap_or(-1));
            w.f(s.ai_fire_probability);
            w.b(s.ai_can_chase);
            w.i(s.subs.len() as i32);
            for x in &s.subs {
                w.f(x.hp);
                w.f(x.max_hp);
                w.b(x.dead);
            }
            w.i(s.weapons.len() as i32);
            for x in &s.weapons {
                w.i(x.last_fired_tick);
            }
            w.i(s.boarding_parties.len() as i32);
            for p in &s.boarding_parties {
                w.i(p.faction.index() as i32);
                w.i(p.count);
            }
        }

        for p in &self.projectiles {
            w.i(p.id as i32);
            w.i(if p.kind == ProjKind::Missile { 1 } else { 0 });
            w.i(p.owner as i32);
            w.f(p.dmg);
            w.v3(p.pos);
            w.v3(p.vel);
            w.i(p.target_ship.map(|t| t as i32).unwrap_or(-1));
            w.v3(p.seg_start);
            w.v3(p.seg_cp);
            w.v3(p.seg_target);
            w.i(p.seg_tick);
            w.v3(p.last_vel);
            w.i(p.life);
        }
    }

    /// Restore a snapshot over this match.
    ///
    /// Refused if the version differs, or if the seed does not match: a
    /// snapshot from another match would restore cleanly and then diverge for
    /// reasons nothing could explain.
    pub fn restore_snapshot(&mut self, buf: &[f32]) -> Result<(), &'static str> {
        let mut r = Reader { buf, at: 0 };
        if r.f() != SNAPSHOT_VERSION {
            return Err("snapshot version mismatch");
        }
        if r.f().to_bits() != self.seed_hash {
            return Err("snapshot belongs to a different match");
        }
        self.turn = r.i();
        self.human_sides = r.i() as u8;
        self.sandbox = r.i() != 0;
        self.next_proj_id = r.i() as u32;
        self.game_over = match r.i() {
            0 => Some(Winner::Player),
            1 => Some(Winner::Enemy),
            _ => None,
        };
        let ship_count = r.i().max(0) as usize;
        let proj_count = r.i().max(0) as usize;
        let well_count = r.i().max(0) as usize;

        self.wells.clear();
        for _ in 0..well_count {
            let pos = V3::new(r.f(), r.f(), r.f());
            self.wells.push(crate::flight::Well::new(pos, r.f(), r.f()));
        }

        self.ships.clear();
        for _ in 0..ship_count {
            let id = r.i() as ShipId;
            let class = class_from_index(r.i() as u32);
            let faction = Faction::from_index(r.i() as u32);
            let side = r.i() as u8;
            // Rebuilt from the class so the static tables (offsets, radii,
            // mounts) come from data rather than from the snapshot: those
            // never change during a match, and storing them would let a stale
            // snapshot quietly override the current balance.
            let mut s = Ship::new(id, class, faction, side, false, V3::ZERO, V3::new(0.0, 0.0, 1.0));
            s.destroyed = r.b();
            s.hull = r.f();
            s.hull_max = r.f();
            s.marines = r.i();
            s.pos = r.v3();
            s.quat = r.quat();
            s.vel = r.v3();
            s.flight.yaw_rate = r.f();
            s.flight.pitch_rate = r.f();
            s.flight.accel_fwd = r.f();
            s.flight.accel_retro = r.f();
            s.flight.accel_lat = r.f();
            s.flight.max_speed = r.f();
            s.mode = Mode::from_u32(r.i() as u32);
            s.last_mode = Mode::from_u32(r.i() as u32);
            s.has_boosted = r.b();
            s.stopped = r.b();
            s.drift_active = r.b();
            s.drift_dir = r.v3();
            s.ai_enabled = r.b();
            let target = r.i();
            s.ai_target = if target < 0 { None } else { Some(target as ShipId) };
            s.ai_fire_probability = r.f();
            s.ai_can_chase = r.b();

            let subs = r.i().max(0) as usize;
            s.subs.clear();
            for def in 0..subs {
                let hp = r.f();
                let max_hp = r.f();
                let dead = r.b();
                s.subs.push(Sub { def, hp, max_hp, dead });
            }
            let weapons = r.i().max(0) as usize;
            for k in 0..weapons {
                let fired = r.i();
                if let Some(w) = s.weapons.get_mut(k) {
                    w.last_fired_tick = fired;
                }
            }
            let parties = r.i().max(0) as usize;
            s.boarding_parties.clear();
            for _ in 0..parties {
                let faction = Faction::from_index(r.i() as u32);
                let count = r.i();
                s.boarding_parties.push(BoardingParty { faction, count });
            }
            self.ships.push(s);
        }

        self.projectiles.clear();
        for _ in 0..proj_count {
            let id = r.i() as u32;
            let kind = if r.i() == 1 { ProjKind::Missile } else { ProjKind::Cannon };
            let owner = r.i() as ShipId;
            let dmg = r.f();
            let pos = r.v3();
            let vel = r.v3();
            let target = r.i();
            let seg_start = r.v3();
            let seg_cp = r.v3();
            let seg_target = r.v3();
            let seg_tick = r.i();
            let last_vel = r.v3();
            let life = r.i();
            self.projectiles.push(Projectile {
                id,
                kind,
                owner,
                dmg,
                pos,
                vel,
                target_ship: if target < 0 { None } else { Some(target as ShipId) },
                seg_start,
                seg_cp,
                seg_target,
                seg_tick,
                last_vel,
                life,
            });
        }
        self.tracks.clear();
        Ok(())
    }
}
