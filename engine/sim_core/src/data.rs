//! Game data, ported from the Unity archive's authored values
//! (docs/DESIGN.md, docs/reference/DATA_AUDIT.md). Every tunable lives here so
//! that no rule is buried in a system that happens to use it.

use crate::math::V3;

// Turn geometry and the flight envelope already live in `flight`, which is
// the module that integrates against them. Re-exported rather than restated:
// two definitions of one tunable is a defect waiting for someone to change
// only one of them (GUIDELINES 5.1).
pub use crate::flight::{
    Flight, ARRIVE_EPS, BOOST_ACCEL_MULT, BOOST_SPEED_MULT, TICKS_PER_SECOND, TICKS_PER_TURN,
    TURN_SECONDS,
};

/// Collision: no interpenetration, impulse damage.
pub const COLLISION_DAMAGE_K: f32 = 25.0;
pub const COLLISION_PAIR_COOLDOWN_TICKS: i32 = 60;
pub const COLLISION_RESTITUTION: f32 = 0.3;

/// Boarding, from DiceRoller plus MarineEfficiencyTable: success on 5+.
pub const BOARDING_DICE_SIDES: u32 = 6;
pub const BOARDING_DICE_THRESHOLD: u32 = 5;

/// Weapon constants derived from the archive's FX objects.
pub const CANNON_SPEED: f32 = 100.0;
pub const CANNON_LIFE_TICKS: i32 = 120;
pub const MISSILE_LAUNCH_SPEED: f32 = 10.0;
pub const MISSILE_PURSUIT_SPEED: f32 = 20.0;
pub const MISSILE_LAUNCH_SCATTER: f32 = 5.0;
pub const MISSILE_HOP_SCATTER: f32 = 0.5;
pub const MISSILE_HOP_TICKS: i32 = 60;
/// Tangent of a missile leg: control point = pos + lastVel / this. Missiles
/// still fly quadratic bezier hops; ADR-14 replaced the SHIP movement model
/// only. In the prototype this constant was deleted with that model and left
/// behind as a name, so every missile divided by undefined and flew to NaN.
pub const MISSILE_INERTIA_DIVISOR: f32 = 2.5;
/// 20 s: missiles outlive the turn that launched them.
pub const MISSILE_LIFE_TICKS: i32 = 1200;
pub const BEAM_SCATTER: f32 = 0.5;

/// Defender kill ratio by hull fraction (MarineEfficiencyTable.asset). Rows
/// are scanned in order and every row whose threshold is at or above the
/// health fraction overwrites, which is the archive's own lookup, quirk
/// included: the first row is a default for anything over 0.75.
pub fn marine_efficiency(health_fraction: f32) -> i32 {
    const TABLE: [(f32, i32); 5] =
        [(1.01, 2), (0.75, 2), (0.50, 1), (0.35, 0), (0.10, 0)];
    let mut v = TABLE[0].1;
    for (threshold, ratio) in TABLE {
        if threshold >= health_fraction {
            v = ratio;
        }
    }
    v
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WeaponKind {
    Beam,
    Cannon,
    Missile,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WeaponKey {
    Beam,
    Cannon,
    Plasma,
    Missile,
}

pub struct WeaponDef {
    pub kind: WeaponKind,
    pub dmg: f32,
    pub mult: f32,
    pub range: f32,
    /// Seconds between two shots from the same mount, measured on the match
    /// clock rather than per turn, so a shot at the end of one turn still
    /// holds the mount into the next one. The archive counted whole turns,
    /// which made every cooldown either 0 or 1 and therefore no cooldown at
    /// all: a turn always advances by one.
    pub cooldown_secs: f32,
    pub arc_h: (f32, f32),
    pub arc_v: (f32, f32),
    pub batch: i32,
}

impl WeaponDef {
    /// Damage applied at the hit: base times the mount multiplier. Beams and
    /// all projectile types come out at 27.5, missiles at 25.
    pub fn damage(&self) -> f32 {
        self.dmg * self.mult
    }
}

static W_BEAM: WeaponDef = WeaponDef {
    kind: WeaponKind::Beam,
    dmg: 5.0,
    mult: 5.5,
    range: 300.0,
    cooldown_secs: 2.0,
    arc_h: (-110.0, 110.0),
    arc_v: (-60.0, 60.0),
    batch: 1,
};
static W_CANNON: WeaponDef = WeaponDef {
    kind: WeaponKind::Cannon,
    dmg: 5.0,
    mult: 5.5,
    range: 200.0,
    cooldown_secs: 4.0,
    arc_h: (-90.0, 90.0),
    arc_v: (-60.0, 60.0),
    batch: 1,
};
static W_MISSILE: WeaponDef = WeaponDef {
    kind: WeaponKind::Missile,
    dmg: 25.0,
    mult: 1.0,
    range: 250.0,
    cooldown_secs: 6.0,
    arc_h: (-360.0, 360.0),
    arc_v: (-360.0, 360.0),
    batch: 2,
};

pub fn weapon(key: WeaponKey) -> &'static WeaponDef {
    match key {
        WeaponKey::Beam => &W_BEAM,
        // Plasma is a cannon with different FX; the archive authored them as
        // one stat block and this keeps that honest.
        WeaponKey::Cannon | WeaponKey::Plasma => &W_CANNON,
        WeaponKey::Missile => &W_MISSILE,
    }
}

pub fn weapon_key_name(key: WeaponKey) -> &'static str {
    match key {
        WeaponKey::Beam => "beam",
        WeaponKey::Cannon => "cannon",
        WeaponKey::Plasma => "plasma",
        WeaponKey::Missile => "missile",
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SubKind {
    Armor,
    Thruster,
}

pub struct SubDef {
    pub id: &'static str,
    pub kind: SubKind,
    pub hp: f32,
    /// Share the subsystem absorbs; the rest bleeds through to the hull.
    pub block_pct: f32,
    pub offset: V3,
    pub radius: f32,
}

pub struct MountDef {
    pub key: WeaponKey,
    pub mount: V3,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShipClassId {
    TerranFrigate,
    KarisenFrigate,
    RogueFrigate,
    BenefactorFrigate,
    Freighter,
}

pub struct ShipClass {
    pub id: ShipClassId,
    pub key: &'static str,
    pub name: &'static str,
    pub hull: f32,
    pub radius: f32,
    pub mass: f32,
    pub flight: Flight,
    pub boarding_range: f32,
    pub marines: i32,
    pub boarding_capacity: i32,
    pub subsystems: &'static [SubDef],
    pub weapons: &'static [MountDef],
}

/// Subsystem offsets are deterministic hit volume centres: a shot damages
/// whichever volume it reaches first, so the layout IS the damage model.
const fn frigate_subs(armor_block: f32) -> [SubDef; 3] {
    [
        SubDef {
            id: "armor_l",
            kind: SubKind::Armor,
            hp: 100.0,
            block_pct: armor_block,
            offset: V3::new(-1.6, 0.0, 0.5),
            radius: 1.6,
        },
        SubDef {
            id: "armor_r",
            kind: SubKind::Armor,
            hp: 100.0,
            block_pct: armor_block,
            offset: V3::new(1.6, 0.0, 0.5),
            radius: 1.6,
        },
        SubDef {
            id: "engines",
            kind: SubKind::Thruster,
            hp: 100.0,
            block_pct: 60.0,
            offset: V3::new(0.0, 0.0, -2.6),
            radius: 1.4,
        },
    ]
}

static TERRAN_SUBS: [SubDef; 3] = frigate_subs(80.0);
static KARISEN_SUBS: [SubDef; 3] = frigate_subs(75.0);
static ROGUE_SUBS: [SubDef; 3] = frigate_subs(90.0);
static BENEFACTOR_SUBS: [SubDef; 3] = frigate_subs(80.0);
static FREIGHTER_SUBS: [SubDef; 1] = [SubDef {
    id: "engines",
    kind: SubKind::Thruster,
    hp: 100.0,
    block_pct: 60.0,
    offset: V3::new(0.0, 0.0, -3.4),
    radius: 1.6,
}];

static TERRAN_MOUNTS: [MountDef; 3] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.0, 0.4, 2.2) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(-1.2, 0.2, 0.8) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(1.2, 0.2, 0.8) },
];
static KARISEN_MOUNTS: [MountDef; 2] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.0, 0.4, 2.0) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.0, -0.3, 0.0) },
];
static ROGUE_MOUNTS: [MountDef; 2] = [
    MountDef { key: WeaponKey::Plasma, mount: V3::new(-0.8, 0.2, 1.5) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(0.8, 0.2, 1.5) },
];
static BENEFACTOR_MOUNTS: [MountDef; 3] = [
    MountDef { key: WeaponKey::Cannon, mount: V3::new(-1.0, 0.2, 1.2) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(1.0, 0.2, 1.2) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.0, -0.3, 0.0) },
];
static FREIGHTER_MOUNTS: [MountDef; 0] = [];

static C_TERRAN_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::TerranFrigate,
    key: "terran_frigate",
    name: "Terran Frigate",
    hull: 300.0,
    radius: 3.5,
    mass: 1.0,
    flight: Flight {
        yaw_rate: 6.0,
        pitch_rate: 4.0,
        accel_fwd: 0.9,
        accel_retro: 0.35,
        accel_lat: 0.25,
        max_speed: 8.0,
    },
    boarding_range: 20.0,
    marines: 15,
    boarding_capacity: 8,
    subsystems: &TERRAN_SUBS,
    weapons: &TERRAN_MOUNTS,
};

static C_KARISEN_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::KarisenFrigate,
    key: "karisen_frigate",
    name: "Karisen Frigate",
    hull: 250.0,
    radius: 3.5,
    mass: 1.0,
    flight: Flight {
        yaw_rate: 6.5,
        pitch_rate: 4.0,
        accel_fwd: 0.95,
        accel_retro: 0.35,
        accel_lat: 0.25,
        max_speed: 8.5,
    },
    boarding_range: 20.0,
    marines: 15,
    boarding_capacity: 8,
    subsystems: &KARISEN_SUBS,
    weapons: &KARISEN_MOUNTS,
};

/// The boarding specialist (Rogue_Ship_1.prefab: range 40, 40 marines,
/// capacity 12), and the only hull agile enough to close for it.
static C_ROGUE_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::RogueFrigate,
    key: "rogue_frigate",
    name: "Rogue Frigate",
    hull: 180.0,
    radius: 3.2,
    mass: 0.9,
    flight: Flight {
        yaw_rate: 9.0,
        pitch_rate: 6.0,
        accel_fwd: 1.1,
        accel_retro: 0.5,
        accel_lat: 0.4,
        max_speed: 9.5,
    },
    boarding_range: 40.0,
    marines: 40,
    boarding_capacity: 12,
    subsystems: &ROGUE_SUBS,
    weapons: &ROGUE_MOUNTS,
};

static C_BENEFACTOR_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::BenefactorFrigate,
    key: "benefactor_frigate",
    name: "Benefactor Frigate",
    hull: 250.0,
    radius: 3.5,
    mass: 1.0,
    flight: Flight {
        yaw_rate: 5.0,
        pitch_rate: 3.5,
        accel_fwd: 0.85,
        accel_retro: 0.35,
        accel_lat: 0.22,
        max_speed: 8.0,
    },
    boarding_range: 20.0,
    marines: 15,
    boarding_capacity: 8,
    subsystems: &BENEFACTOR_SUBS,
    weapons: &BENEFACTOR_MOUNTS,
};

static C_FREIGHTER: ShipClass = ShipClass {
    id: ShipClassId::Freighter,
    key: "freighter",
    name: "Freighter",
    hull: 600.0,
    radius: 4.5,
    mass: 2.0,
    flight: Flight {
        yaw_rate: 2.5,
        pitch_rate: 1.5,
        accel_fwd: 0.45,
        accel_retro: 0.18,
        accel_lat: 0.10,
        max_speed: 5.0,
    },
    boarding_range: 10.0,
    marines: 15,
    boarding_capacity: 8,
    subsystems: &FREIGHTER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

pub fn ship_class(id: ShipClassId) -> &'static ShipClass {
    match id {
        ShipClassId::TerranFrigate => &C_TERRAN_FRIGATE,
        ShipClassId::KarisenFrigate => &C_KARISEN_FRIGATE,
        ShipClassId::RogueFrigate => &C_ROGUE_FRIGATE,
        ShipClassId::BenefactorFrigate => &C_BENEFACTOR_FRIGATE,
        ShipClassId::Freighter => &C_FREIGHTER,
    }
}

pub const ALL_CLASSES: [ShipClassId; 5] = [
    ShipClassId::TerranFrigate,
    ShipClassId::KarisenFrigate,
    ShipClassId::RogueFrigate,
    ShipClassId::BenefactorFrigate,
    ShipClassId::Freighter,
];

pub fn class_from_index(i: u32) -> ShipClassId {
    ALL_CLASSES[(i as usize).min(ALL_CLASSES.len() - 1)]
}

pub fn class_index(id: ShipClassId) -> u32 {
    ALL_CLASSES.iter().position(|c| *c == id).unwrap_or(0) as u32
}
