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

/// The arc every weapon starts with.
///
/// Omnidirectional, because a turret swivels: beams, cannons and missiles can
/// all be brought to bear in any direction the mount can reach. The one thing
/// no mount can do is fire into its own base, so the floor is ten degrees
/// below the mount and everything else is the HULL's business, scanned per
/// design into an arc mask rather than authored per weapon.
pub const ARC_ALL: (f32, f32) = (-360.0, 360.0);
pub const ARC_PITCH_FLOOR: (f32, f32) = (-10.0, 90.0);

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
    // Three seconds, so a beam mount is free on four of a turn's eleven fire
    // slots rather than six, and picking a second is a choice rather than a
    // formality. Measured on the match clock, so a shot at second 9 still
    // holds the mount into second 2 of the next turn.
    cooldown_secs: 3.0,
    arc_h: ARC_ALL,
    arc_v: ARC_PITCH_FLOOR,
    batch: 1,
};
static W_CANNON: WeaponDef = WeaponDef {
    kind: WeaponKind::Cannon,
    dmg: 5.0,
    mult: 5.5,
    range: 200.0,
    cooldown_secs: 4.0,
    arc_h: ARC_ALL,
    arc_v: ARC_PITCH_FLOOR,
    batch: 1,
};
static W_MISSILE: WeaponDef = WeaponDef {
    kind: WeaponKind::Missile,
    dmg: 25.0,
    mult: 1.0,
    range: 250.0,
    cooldown_secs: 6.0,
    arc_h: ARC_ALL,
    arc_v: ARC_PITCH_FLOOR,
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

/// What a hit volume DOES, which is the whole of the damage model: a volume
/// with no consequence is just a smaller hull.
///
/// Order matters. The client mirrors these discriminants by position, so a new
/// kind goes on the end rather than in the middle.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SubKind {
    Armor,
    Thruster,
    /// Attitude authority. With every one of them out, the hull keeps its
    /// engines and loses the ability to point them anywhere.
    Rcs,
    /// The weapon bay. With every one of them out, no mount on the ship fires.
    Weapon,
    /// The pile. Breaching it does not disable anything: it ends the ship, and
    /// takes a share of whatever is standing near it.
    Reactor,
}

/// A reactor breach.
///
/// The blast damages hulls only, never subsystems, and that is deliberate
/// rather than a simplification: a breach that could reach another reactor
/// would chain, and a chain is a recursion with no bound written anywhere.
/// Falls off linearly to nothing at the edge.
/// What it takes to knock a mount off its hull, and how near a shot has to
/// land to count toward it.
///
/// A mount is not repairable: a turret that comes off is gone for the match.
/// So a gun must be lost to fire that was actually chewing the structure it is
/// bolted to, not to a shell somewhere else on the ship.
///
/// THE RADIUS IS ABOUT THE SIZE OF A TURRET, and that is the whole of it. The
/// first cut was 1.1, which is a sphere of 5.58 cubic units around each mount
/// on a hull that is 1.2 by 0.76 by 3.2, or 2.92: the catch radius had nearly
/// twice the volume of the entire frigate, so every hit anywhere damaged every
/// mount and three beam hits stripped a ship of all its guns at once. It did
/// not read as a bug, it read as combat going quiet: matches that had been
/// ending on turn ten ran past twenty-three with both sides disarmed and
/// unable to finish. A cell is 7/64 of a unit and a turret is a handful of
/// them, so 0.45 is "on the mount" and 1.1 was "on the ship".
pub const MOUNT_HP: f32 = 110.0;
pub const MOUNT_RADIUS: f32 = 0.45;

pub const CRITICAL_RADIUS: f32 = 14.0;
pub const CRITICAL_DAMAGE: f32 = 140.0;

pub struct SubDef {
    pub id: &'static str,
    pub kind: SubKind,
    pub hp: f32,
    /// Share the subsystem absorbs; the rest bleeds through to the hull.
    pub block_pct: f32,
    pub offset: V3,
    /// Half extents of the BOX this volume occupies, in the ship's own frame.
    ///
    /// A box rather than a sphere, because a hull is a box and its parts are
    /// boxes: a sphere big enough to contain a drive bay sticks out through
    /// the plating on all six sides, and six of them on a frigate overlapped
    /// into one ball that swallowed the whole ship. What the player aims at
    /// should be the shape of the thing they are aiming at.
    pub half: V3,
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
    /// The class's mass, which is ALSO the berth a design of this class is
    /// built inside: the authored ships come out at 75 to 90 percent of it.
    pub mass: f32,
    /// The world size of one lattice cell for this class, which is what makes
    /// a freighter's plate cost more than a frigate's for the same cell count.
    pub rung_cell: f32,
    /// What the bare frame carries before a single part is fitted. Everything
    /// above these comes from barracks, airlocks and clamps.
    pub base_reach: f32,
    pub base_marines: i32,
    pub base_capacity: i32,
    pub flight: Flight,
    pub boarding_range: f32,
    pub marines: i32,
    pub boarding_capacity: i32,
    pub subsystems: &'static [SubDef],
    pub weapons: &'static [MountDef],
}

/// Subsystem offsets are deterministic hit volume centres: a shot damages
/// whichever volume it reaches first, so the layout IS the damage model.
///
/// The two belts sit outboard and the reactor sits deep amidships behind
/// them, which is the whole of the protection it gets. Nothing declares the
/// reactor "shielded": a shot from abeam meets a belt first because a belt is
/// in the way, and a shot down the throat of a hull whose belts are gone does
/// not. Geometry rather than a rule is what makes closing on a damaged flank
/// worth doing.
const fn frigate_subs(armor_block: f32) -> [SubDef; 6] {
    [
        // The belts are SLABS around the WAIST, meeting over the keel line
        // and reaching neither the bow nor the belly. What they cover is the
        // reactor: a shot from ahead or abeam crosses one, and a shot from
        // below passes under them, because their floor at y -0.30 sits above
        // the reactor's ceiling at +0.40.
        //
        // They stop at z +0.90 on purpose, short of the bay and the jets. A
        // belt that ran the length of the hull covered both, and engagements
        // here are close to coplanar: shots arrive near horizontal, so a
        // volume behind a full length belt is a volume nothing can ever reach
        // and aiming at it is a button that does nothing.
        SubDef {
            id: "armor_l",
            kind: SubKind::Armor,
            hp: 100.0,
            block_pct: armor_block,
            offset: V3::new(-0.5, 0.15, -0.3),
            half: V3::new(0.85, 0.45, 1.2),
        },
        SubDef {
            id: "armor_r",
            kind: SubKind::Armor,
            hp: 100.0,
            block_pct: armor_block,
            offset: V3::new(0.5, 0.15, -0.3),
            half: V3::new(0.85, 0.45, 1.2),
        },
        // Right aft, and aft of the belts, so a stern chase meets the drives.
        SubDef {
            id: "engines",
            kind: SubKind::Thruster,
            hp: 100.0,
            block_pct: 60.0,
            offset: V3::new(0.0, 0.0, -2.4),
            half: V3::new(0.65, 0.45, 0.65),
        },
        // Forward and ventral, where the attitude quads are drawn on the hull,
        // and below the belts so a shot from underneath reaches them.
        SubDef {
            id: "rcs",
            kind: SubKind::Rcs,
            hp: 60.0,
            block_pct: 40.0,
            offset: V3::new(0.0, -0.55, 1.5),
            half: V3::new(0.6, 0.25, 0.7),
        },
        // The battery, dorsal and forward, where the turrets are, and above
        // the belts for the same reason.
        SubDef {
            id: "weapons",
            kind: SubKind::Weapon,
            hp: 80.0,
            block_pct: 50.0,
            offset: V3::new(0.0, 0.5, 1.1),
            half: V3::new(0.55, 0.3, 0.8),
        },
        SubDef {
            id: "reactor",
            kind: SubKind::Reactor,
            hp: 90.0,
            block_pct: 45.0,
            offset: V3::new(0.0, 0.0, -0.6),
            half: V3::new(0.45, 0.4, 0.6),
        },
    ]
}

static TERRAN_SUBS: [SubDef; 6] = frigate_subs(80.0);
static KARISEN_SUBS: [SubDef; 6] = frigate_subs(75.0);
static ROGUE_SUBS: [SubDef; 6] = frigate_subs(90.0);
static BENEFACTOR_SUBS: [SubDef; 6] = frigate_subs(80.0);
/// No weapon bay, because the hull has no mounts to lose. A subsystem whose
/// loss changes nothing is a hit box that teaches a player the wrong lesson.
static FREIGHTER_SUBS: [SubDef; 3] = [
    SubDef {
        id: "engines",
        kind: SubKind::Thruster,
        hp: 100.0,
        block_pct: 60.0,
        offset: V3::new(0.0, 0.0, -3.3),
        half: V3::new(0.9, 0.7, 0.8),
    },
    SubDef {
        id: "rcs",
        kind: SubKind::Rcs,
        hp: 60.0,
        block_pct: 40.0,
        offset: V3::new(0.0, -1.2, 2.0),
        half: V3::new(0.9, 0.4, 1.1),
    },
    SubDef {
        id: "reactor",
        kind: SubKind::Reactor,
        hp: 120.0,
        block_pct: 45.0,
        offset: V3::new(0.0, 0.0, -1.0),
        half: V3::new(0.8, 0.7, 1.0),
    },
];

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
    rung_cell: 0.109375,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
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
    rung_cell: 0.109375,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
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
    rung_cell: 0.109375,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
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
    rung_cell: 0.109375,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
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
    rung_cell: 0.1640625,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
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
