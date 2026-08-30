//! Match state: ships, their subsystems and mounts, projectiles in flight,
//! and the geometry queries the combat systems ask of them.
//!
//! Ships are stored in a `Vec` and never removed. A destroyed ship keeps its
//! slot and sets a flag, so an index IS an id: stable for the whole match, on
//! every client, with no lookup table to keep in step. That matters more than
//! the memory it wastes, because an id that can shift is an id two clients can
//! disagree about, and lockstep (ADR-6) has no way to notice until the hashes
//! part several turns later.

use crate::data::{self, ShipClassId, SubKind, WeaponKey};
use crate::flight::{Body, Flight, Mode, Well};
use crate::math::{Quat, V3};

pub type ShipId = u16;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Faction {
    Terran,
    Karisen,
    Rogue,
    Benefactor,
}

impl Faction {
    pub fn index(self) -> u32 {
        match self {
            Faction::Terran => 0,
            Faction::Karisen => 1,
            Faction::Rogue => 2,
            Faction::Benefactor => 3,
        }
    }
    pub fn from_index(i: u32) -> Self {
        match i {
            1 => Faction::Karisen,
            2 => Faction::Rogue,
            3 => Faction::Benefactor,
            _ => Faction::Terran,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Faction::Terran => "terran",
            Faction::Karisen => "karisen",
            Faction::Rogue => "rogue",
            Faction::Benefactor => "benefactor",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Sub {
    /// Index into the class's static subsystem table, which carries the
    /// unchanging half (id, kind, offset, radius, block share).
    pub def: usize,
    pub hp: f32,
    pub max_hp: f32,
    pub dead: bool,
}

#[derive(Clone, Debug)]
pub struct WeaponSlot {
    pub key: WeaponKey,
    pub mount: V3,
    /// Absolute tick this mount last fired on, or -1. Absolute rather than per
    /// turn, so one comparison covers both a second shot later in the same
    /// turn and a shot early in the next one.
    pub last_fired_tick: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct BoardingParty {
    pub faction: Faction,
    pub count: i32,
}

#[derive(Clone, Debug)]
pub struct Ship {
    pub id: ShipId,
    pub class: ShipClassId,
    pub faction: Faction,
    /// Which side of the match this hull fights for, 0 or 1.
    ///
    /// A match-wide fact, deliberately NOT "mine". Two clients playing each
    /// other must agree on every field the state hash covers, and this is one
    /// of them, so a flag meaning "the ship I control" would make the two
    /// disagree from the first turn and read as a desync. Which side a given
    /// client is sitting in is that client's business and lives nowhere near
    /// the simulation.
    pub side: u8,

    pub pos: V3,
    pub quat: Quat,
    /// Units per SECOND, carried across the turn boundary. This is the term
    /// that makes a plan a commitment rather than a suggestion.
    pub vel: V3,
    /// Per ship rather than per class so the harness can tune it live.
    pub flight: Flight,

    pub hull: f32,
    pub hull_max: f32,
    pub subs: Vec<Sub>,
    pub weapons: Vec<WeaponSlot>,

    pub marines: i32,
    pub boarding_parties: Vec<BoardingParty>,

    pub drift_active: bool,
    pub drift_dir: V3,

    pub mode: Mode,
    /// Boost bookkeeping. A burn needs a prior MoveAndTurn that has not
    /// already spent one and did not end in a full stop, so the gate needs to
    /// remember what the ship did LAST turn, not what it is doing now.
    pub last_mode: Mode,
    pub has_boosted: bool,
    pub stopped: bool,
    pub destroyed: bool,

    pub ai_enabled: bool,
    pub ai_target: Option<ShipId>,
    pub ai_fire_probability: f32,
    pub ai_can_chase: bool,

    /// This turn's flown path, filled in at planning time and read back per
    /// tick. Preview and execution are the same array by construction, which
    /// is the only way to keep a drawn plan honest.
    pub plan: Vec<(V3, Quat)>,
    pub plan_end_vel: V3,
    pub plan_end_quat: Quat,
    /// The tick the plan starts at. Zero normally; a collision re-flies the
    /// remainder of the turn and the replacement plan begins where the contact
    /// happened, so every read has to subtract this.
    pub plan_from_tick: i32,
    /// The order the plan came from, kept so a replan can pursue the same
    /// destination from wherever the contact left the ship.
    pub plan_target: Option<V3>,
    pub plan_face: Option<V3>,
    /// The roll this turn was flown with, kept for the same reason as the
    /// face: resolution re-enters the span after a collision and must fly
    /// the remainder on the order it started with.
    pub plan_roll: Option<f32>,
}

impl Ship {
    pub fn new(
        id: ShipId,
        class: ShipClassId,
        faction: Faction,
        side: u8,
        ai_enabled: bool,
        pos: V3,
        facing: V3,
    ) -> Self {
        let cls = data::ship_class(class);
        Self {
            id,
            class,
            faction,
            side,
            pos,
            quat: Quat::look(facing, None),
            vel: V3::ZERO,
            flight: cls.flight,
            hull: cls.hull,
            hull_max: cls.hull,
            subs: cls
                .subsystems
                .iter()
                .enumerate()
                .map(|(i, d)| Sub { def: i, hp: d.hp, max_hp: d.hp, dead: false })
                .collect(),
            weapons: cls
                .weapons
                .iter()
                .map(|m| WeaponSlot { key: m.key, mount: m.mount, last_fired_tick: -99 })
                .collect(),
            marines: cls.marines,
            boarding_parties: Vec::new(),
            drift_active: false,
            drift_dir: V3::ZERO,
            mode: Mode::MoveAndTurn,
            last_mode: Mode::MoveAndTurn,
            has_boosted: false,
            stopped: false,
            destroyed: false,
            ai_enabled,
            ai_target: None,
            ai_fire_probability: 0.5,
            ai_can_chase: true,
            plan: Vec::new(),
            plan_end_vel: V3::ZERO,
            plan_end_quat: Quat::IDENTITY,
            plan_from_tick: 0,
            plan_target: None,
            plan_face: None,
            plan_roll: None,
        }
    }

    pub fn class_def(&self) -> &'static data::ShipClass {
        data::ship_class(self.class)
    }

    pub fn body(&self) -> Body {
        Body { pos: self.pos, vel: self.vel, quat: self.quat }
    }

    pub fn sub_world_pos(&self, sub: &Sub) -> V3 {
        self.pos.add(self.quat.rot(self.class_def().subsystems[sub.def].offset))
    }

    pub fn mount_world_pos(&self, w: &WeaponSlot) -> V3 {
        self.pos.add(self.quat.rot(w.mount))
    }

    pub fn has_live_thruster(&self) -> bool {
        let defs = self.class_def().subsystems;
        self.subs.iter().any(|s| defs[s.def].kind == SubKind::Thruster && !s.dead)
    }

    fn plan_index(&self, tick: i32) -> usize {
        if self.plan.is_empty() {
            return 0;
        }
        ((tick - self.plan_from_tick).max(0) as usize).min(self.plan.len() - 1)
    }

    /// Pose at a tick, straight out of the flown plan. Clamped rather than
    /// wrapped: a tick past the end is the end.
    pub fn pos_at_tick(&self, tick: i32) -> V3 {
        match self.plan.get(self.plan_index(tick)) {
            Some((p, _)) => *p,
            None => self.pos,
        }
    }

    pub fn quat_at_tick(&self, tick: i32) -> Quat {
        match self.plan.get(self.plan_index(tick)) {
            Some((_, q)) => *q,
            None => self.quat,
        }
    }

    /// Velocity implied by the plan at a tick, from the difference between
    /// neighbouring samples. The plan stores poses, not velocities, and
    /// differencing it is what keeps the two from ever disagreeing.
    pub fn vel_at_tick(&self, tick: i32) -> V3 {
        let n = self.plan.len();
        if n < 2 {
            return self.vel;
        }
        let i = self.plan_index(tick);
        let (a, b) = if i == 0 { (0, 1) } else { (i - 1, i) };
        self.plan[b].0.sub(self.plan[a].0).scale(crate::flight::TICKS_PER_SECOND as f32)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProjKind {
    Cannon,
    Missile,
}

#[derive(Clone, Debug)]
pub struct Projectile {
    pub id: u32,
    pub kind: ProjKind,
    pub owner: ShipId,
    pub dmg: f32,
    pub pos: V3,
    /// Cannon shells only: per tick displacement, fixed at fire time.
    pub vel: V3,
    /// Missiles only: the current bezier leg and how far into it we are.
    pub target_ship: Option<ShipId>,
    pub seg_start: V3,
    pub seg_cp: V3,
    pub seg_target: V3,
    pub seg_tick: i32,
    pub last_vel: V3,
    pub life: i32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Winner {
    Player,
    Enemy,
}

pub struct Hit {
    pub ship: usize,
    pub sub: Option<usize>,
    pub t: f32,
    pub pos: V3,
}

/// One tick of recorded playback: where everything was, and nothing about why.
/// The renderer scrubs these; it never re-simulates to draw a frame, which is
/// what keeps a replay showing what actually happened rather than what would
/// happen if it ran again.
#[derive(Clone, Debug)]
pub struct TrackFrame {
    pub ships: Vec<(V3, Quat, bool)>,
    pub projectiles: Vec<(u32, ProjKind, V3)>,
}

pub struct Sim {
    pub seed: String,
    /// Bit per side: set means a person plays it, clear means the AI does.
    /// Part of the match rather than of the viewer, for the same reason
    /// `Ship::side` is: it changes the simulation, so both clients must hold
    /// the same value or their hashes part.
    pub human_sides: u8,
    /// The seed, hashed once. Every draw mixes this rather than re-hashing the
    /// string, which is the difference between hashing 16 bytes at match start
    /// and hashing them again for every random number in the match.
    pub seed_hash: u32,
    pub turn: i32,
    pub ships: Vec<Ship>,
    pub projectiles: Vec<Projectile>,
    pub next_proj_id: u32,
    pub game_over: Option<Winner>,
    /// Whether to record per tick tracks while resolving. The headless server
    /// never needs them; a client playing the turn back always does.
    pub record: bool,
    pub tracks: Vec<TrackFrame>,
    /// The gravity field this match is fought in. Environmental, so it lives
    /// here rather than on a hull, and the state hash covers it: two clients
    /// flying the same orders through different fields part on turn one.
    /// Order matters, because the accelerations are summed in it.
    pub wells: Vec<Well>,
    /// Whether a hull's flight stats may be changed while the match is running.
    ///
    /// Off for a real match: the stats are what the class says, and a ship
    /// behaves the way the ship behaves. They are also in the state hash, so
    /// one seat nudging a slider parts the two clients from that turn on, and
    /// the only reason that has never been seen is that nobody has done it in
    /// a versus game.
    ///
    /// On, they are editable, which is the whole point of a sandbox. A match
    /// fact rather than a client one for the same reason `human_sides` is: it
    /// decides what the simulation will accept.
    pub sandbox: bool,
}

/// One ship in a scenario request.
pub struct SpawnSpec {
    pub class: ShipClassId,
    pub pos: V3,
    pub facing: V3,
}

impl Sim {
    pub fn new_skirmish(
        seed: &str,
        side0: &[SpawnSpec],
        side1: &[SpawnSpec],
        side1_faction: Faction,
        human_sides: u8,
    ) -> Self {
        let human = |side: u8| human_sides & (1 << side) != 0;
        let mut ships = Vec::with_capacity(side0.len() + side1.len());
        for s in side0 {
            let id = ships.len() as ShipId;
            ships.push(Ship::new(id, s.class, Faction::Terran, 0, !human(0), s.pos, s.facing));
        }
        for s in side1 {
            let id = ships.len() as ShipId;
            ships.push(Ship::new(id, s.class, side1_faction, 1, !human(1), s.pos, s.facing));
        }
        Self {
            seed: seed.to_string(),
            human_sides,
            seed_hash: crate::rng::fnv1a(seed),
            turn: 0,
            ships,
            projectiles: Vec::new(),
            next_proj_id: 1,
            game_over: None,
            record: false,
            tracks: Vec::new(),
            wells: Vec::new(),
            sandbox: false,
        }
    }

    pub fn ship(&self, id: ShipId) -> Option<&Ship> {
        self.ships.get(id as usize)
    }

    /// Is this side played by a person? Used when a captured hull changes
    /// hands and has to pick up the right kind of commander.
    pub fn side_is_human(&self, side: u8) -> bool {
        self.human_sides & (1 << side) != 0
    }

    /// Segment a->b against sphere (c, r): the parameter of the first
    /// intersection in [0, 1], or None. Arithmetic and one sqrt, so it is
    /// portable; nothing here can disagree between platforms.
    pub fn seg_sphere(a: V3, b: V3, c: V3, r: f32) -> Option<f32> {
        let d = b.sub(a);
        let m = a.sub(c);
        let aa = d.dot(d);
        if aa < 1e-12 {
            return if m.len() <= r { Some(0.0) } else { None };
        }
        let bb = 2.0 * m.dot(d);
        let cc = m.dot(m) - r * r;
        let disc = bb * bb - 4.0 * aa * cc;
        if disc < 0.0 {
            return None;
        }
        let sq = disc.sqrt();
        let mut t = (-bb - sq) / (2.0 * aa);
        if t < 0.0 {
            t = (-bb + sq) / (2.0 * aa);
        }
        if (0.0..=1.0).contains(&t) {
            Some(t)
        } else {
            None
        }
    }

    /// Sweep a segment against every live ship, hull sphere and live subsystem
    /// volumes alike, and return the nearest hit.
    ///
    /// Subsystems are tested before the hull, and since a subsystem volume
    /// sits inside the hull sphere, a shot that reaches one damages it rather
    /// than the hull. The layout is the damage model: this is what makes
    /// aiming at the engines mean something.
    pub fn raycast_ships(&self, a: V3, b: V3, ignore: Option<ShipId>) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        for (si, ship) in self.ships.iter().enumerate() {
            if ship.destroyed || Some(ship.id) == ignore {
                continue;
            }
            for (bi, sub) in ship.subs.iter().enumerate() {
                if sub.dead {
                    continue;
                }
                let def = &ship.class_def().subsystems[sub.def];
                if let Some(t) = Self::seg_sphere(a, b, ship.sub_world_pos(sub), def.radius) {
                    if best.as_ref().is_none_or(|h| t < h.t) {
                        best = Some(Hit { ship: si, sub: Some(bi), t, pos: V3::ZERO });
                    }
                }
            }
            if let Some(t) = Self::seg_sphere(a, b, ship.pos, ship.class_def().radius) {
                if best.as_ref().is_none_or(|h| t < h.t) {
                    best = Some(Hit { ship: si, sub: None, t, pos: V3::ZERO });
                }
            }
        }
        if let Some(h) = &mut best {
            h.pos = a.lerp(b, h.t);
        }
        best
    }
}
