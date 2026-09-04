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

/// The REFERENCE cell everything above is authored against, in world units.
///
/// Fixed, and deliberately not tied to whatever the client's lattice happens
/// to be. `PLATE_UM`, `HULL_MILLI` and `MOUNT_RADIUS` are all "per cell of this
/// size", so this is a material density and a turret size rather than a
/// statement about frigates.
///
/// Halving it alongside the voxel looks right and undoes the very change it is
/// following. The ratio goes back to one, plate costs what it always did, and
/// a hull that was meant to be an eighth the mass comes out at full weight,
/// with the core and the editor disagreeing by 80 percent.
pub const FRIGATE_CELL: f32 = 7.0 / 64.0;

/// One lattice cell, in world units, on EVERY class.
///
/// It used to be per class: a rung was a cell size, so a heavy cruiser was a
/// frigate drawn four times bigger with exactly as many cells in it. The
/// lattice is the rung now (24 x 24 x 48 to 64 x 64 x 128) and this is a
/// constant, so a bigger ship is more cells rather than bigger ones and what
/// its plating weighs is COUNTED.
pub const VOXEL: f32 = 3.5 / 64.0;

/// The catch radius for a mount, which is the same on every class.
///
/// `MOUNT_RADIUS` is authored at the reference cell, and the comment above
/// says exactly why: a turret is a handful of cells, so 0.45 is "on the mount"
/// where 1.1 was "on the ship". A turret is the same handful of cells whatever
/// it is bolted to now, so its catch radius is the same handful of cells too,
/// and scaling this per class would be a cruiser whose guns catch shots that
/// missed them.
pub fn mount_radius(_id: ShipClassId) -> f32 {
    MOUNT_RADIUS * (VOXEL / FRIGATE_CELL)
}

/// How much of a volume's MASS has to be gone before it stops working.
///
/// A hit volume is not a barrel with a hit point on it: it is a box full of
/// machinery, and a shot into it takes cells out a piece at a time. A drive
/// bay missing four fifths of itself is not a drive bay with a fifth of its
/// thrust, it is wreckage, and a bay that keeps running until the very last
/// point of hp does not match the hole a player can see through it.
///
/// So a volume is offline at a fifth of what it started with, and the cells
/// coming off the picture and the hp coming off the state are two views of the
/// same shots rather than two rules. This is the OPPOSITE of a weapon mount,
/// which is never partly shot away: a turret is bolted on whole, and it comes
/// off whole.
pub const SUB_FAIL_FRAC: f32 = 0.20;

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
    // The four fleets, corvette to heavy cruiser. APPENDED, never interleaved
    // with the frigates above: the position in `ALL_CLASSES` is the class index
    // and that index is hashed, so an entry slid into the middle renumbers every
    // class after it on one side of a lockstep pair and not the other.
    TerranCorvette,
    TerranDestroyer,
    TerranCruiser,
    KarisenCorvette,
    KarisenDestroyer,
    KarisenCruiser,
    RogueCorvette,
    RogueDestroyer,
    RogueCruiser,
    BenefactorCorvette,
    BenefactorDestroyer,
    BenefactorCruiser,
    // The civil yards, appended for the same reason: an entry slid in above
    // renumbers every class under it on one side of a lockstep pair and not
    // the other. None of them carries a mount, so none of them can be armed,
    // and `design.rs` passes the arms gate on an empty weapon table.
    CivilLighter,
    CivilHauler,
    CivilBoxship,
    CivilTanker,
    CivilMiner,
    CivilLiner,
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
/// The frigate's radius, which every other hull's volumes are scaled against.
/// One number rather than a magic 3.5 in the middle of the arithmetic below.
const FRIGATE_RADIUS: f32 = 3.5;
/// And the freighter's, which the civil volumes were authored against.
const FREIGHTER_RADIUS: f32 = 4.5;

const fn hull_subs(radius: f32, armor_block: f32, hp: f32) -> [SubDef; 6] {
    // One layout, sized to the hull it is inside. The offsets and half extents
    // below were authored against a frigate, and every relation that matters is
    // a RATIO: the belts' floor sits above the reactor's ceiling, and they stop
    // short of the bay and the drives. Scaling the whole set by one factor keeps
    // every one of those relations, which a second hand authored table for each
    // rung would not: the day somebody moved a belt on the cruiser and not on
    // the destroyer, a volume would be reachable on one and sealed on the other
    // and nothing would say so.
    let s = radius / FRIGATE_RADIUS;
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
            hp: 100.0 * hp,
            block_pct: armor_block,
            offset: V3::new(-0.5 * s, 0.15 * s, -0.3 * s),
            half: V3::new(0.85 * s, 0.45 * s, 1.2 * s),
        },
        SubDef {
            id: "armor_r",
            kind: SubKind::Armor,
            hp: 100.0 * hp,
            block_pct: armor_block,
            offset: V3::new(0.5 * s, 0.15 * s, -0.3 * s),
            half: V3::new(0.85 * s, 0.45 * s, 1.2 * s),
        },
        // Right aft, and aft of the belts, so a stern chase meets the drives.
        SubDef {
            id: "engines",
            kind: SubKind::Thruster,
            hp: 100.0 * hp,
            block_pct: 60.0,
            offset: V3::new(0.0, 0.0, -2.4 * s),
            half: V3::new(0.65 * s, 0.45 * s, 0.65 * s),
        },
        // Forward and ventral, where the attitude quads are drawn on the hull,
        // and below the belts so a shot from underneath reaches them.
        SubDef {
            id: "rcs",
            kind: SubKind::Rcs,
            hp: 60.0 * hp,
            block_pct: 40.0,
            offset: V3::new(0.0, -0.55 * s, 1.5 * s),
            half: V3::new(0.6 * s, 0.25 * s, 0.7 * s),
        },
        // The battery, dorsal and forward, where the turrets are, and above
        // the belts for the same reason.
        SubDef {
            id: "weapons",
            kind: SubKind::Weapon,
            hp: 80.0 * hp,
            block_pct: 50.0,
            offset: V3::new(0.0, 0.5 * s, 1.1 * s),
            half: V3::new(0.55 * s, 0.3 * s, 0.8 * s),
        },
        SubDef {
            id: "reactor",
            kind: SubKind::Reactor,
            hp: 90.0 * hp,
            block_pct: 45.0,
            offset: V3::new(0.0, 0.0, -0.6 * s),
            half: V3::new(0.45 * s, 0.4 * s, 0.6 * s),
        },
    ]
}

// A frigate is the unit: radius 3.5 and hp 1.0 are both exact in f32, so these
// four come out of the scaled layout bit for bit as they came out of the
// unscaled one.
static TERRAN_SUBS: [SubDef; 6] = hull_subs(1.8, 80.0, 0.51);
static KARISEN_SUBS: [SubDef; 6] = hull_subs(1.9, 75.0, 0.46);
static ROGUE_SUBS: [SubDef; 6] = hull_subs(1.5, 90.0, 0.61);
static BENEFACTOR_SUBS: [SubDef; 6] = hull_subs(1.8, 80.0, 0.47);
/// No weapon bay, because the hull has no mounts to lose. A subsystem whose
/// loss changes nothing is a hit box that teaches a player the wrong lesson.
static FREIGHTER_SUBS: [SubDef; 3] = civil_subs(2.9, 1.05);

/// The civil hull's three volumes, sized to the ship they are inside.
///
/// `FREIGHTER_SUBS` is the same layout authored at one size, and six more
/// hulls at three rungs cannot each carry a hand written copy of it: the day
/// somebody moved the reactor on the tanker and not on the hauler, one would
/// be reachable from below and the other sealed and nothing would say so. So
/// it is a function of the radius, exactly as `hull_subs` is for a warship.
///
/// Three volumes rather than six, and no weapon bay, because the hull has no
/// mounts to lose: a subsystem whose loss changes nothing is a hit box that
/// teaches a player the wrong lesson.
const fn civil_subs(radius: f32, hp: f32) -> [SubDef; 3] {
    // Against the FREIGHTER's radius, not the frigate's, because these offsets
    // were authored on the freighter. Scaled off 3.5 the engines reached 1.17
    // times the hull they sit in, so every civil ship had a drive bay hanging
    // out through its own stern plating and `volumes.rs` said so.
    let s = radius / FREIGHTER_RADIUS;
    [
        SubDef {
            id: "engines",
            kind: SubKind::Thruster,
            hp: 100.0 * hp,
            block_pct: 60.0,
            offset: V3::new(0.0, 0.0, -3.3 * s),
            half: V3::new(0.9 * s, 0.7 * s, 0.8 * s),
        },
        SubDef {
            id: "rcs",
            kind: SubKind::Rcs,
            hp: 60.0 * hp,
            block_pct: 40.0,
            offset: V3::new(0.0, -1.2 * s, 2.0 * s),
            half: V3::new(0.9 * s, 0.4 * s, 1.1 * s),
        },
        SubDef {
            id: "reactor",
            kind: SubKind::Reactor,
            hp: 120.0 * hp,
            block_pct: 45.0,
            offset: V3::new(0.0, 0.0, -1.0 * s),
            half: V3::new(0.8 * s, 0.7 * s, 1.0 * s),
        },
    ]
}

static LIGHTER_SUBS: [SubDef; 3] = civil_subs(2.0, 0.48);
static HAULER_SUBS: [SubDef; 3] = civil_subs(2.5, 1.11);
static BOXSHIP_SUBS: [SubDef; 3] = civil_subs(3.5, 2.27);
static TANKER_SUBS: [SubDef; 3] = civil_subs(3.3, 2.07);
static MINER_SUBS: [SubDef; 3] = civil_subs(2.2, 1.12);
static LINER_SUBS: [SubDef; 3] = civil_subs(3.6, 1.92);

static TERRAN_MOUNTS: [MountDef; 3] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.0, 0.4, 2.2) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(-1.2, 0.2, 0.8) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(1.2, 0.2, 0.8) },
];
/// Three, not two. The stock Karisen has always ARMED its port sponson (the
/// `s0` ring on its frame), so a Karisen fielded from the briefing carried
/// three mounts while one spawned by a scenario carried two: the same named
/// ship with a different battery depending on which code path seated it. The
/// mount is at the sponson's own cell, `(s0 - centre) * rung_cell`.
static KARISEN_MOUNTS: [MountDef; 3] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.0, 0.4, 2.0) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.0, -0.3, 0.0) },
    // APPENDED, not inserted. A mount index is what a fire order names and
    // what a snapshot stores, so putting the sponson second would have moved
    // the launcher from 1 to 2 and quietly re-aimed every order that had one.
    MountDef { key: WeaponKey::Beam, mount: V3::new(-0.98, -0.33, -1.09) },
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

static TERRAN_CORVETTE_SUBS: [SubDef; 6] = hull_subs(1.4, 80.0, 0.29);
static TERRAN_DESTROYER_SUBS: [SubDef; 6] = hull_subs(2.6, 80.0, 1.08);
static TERRAN_CRUISER_SUBS: [SubDef; 6] = hull_subs(3.5, 80.0, 2.16);
static KARISEN_CORVETTE_SUBS: [SubDef; 6] = hull_subs(1.6, 75.0, 0.29);
static KARISEN_DESTROYER_SUBS: [SubDef; 6] = hull_subs(2.8, 75.0, 0.82);
static KARISEN_CRUISER_SUBS: [SubDef; 6] = hull_subs(3.8, 75.0, 1.46);
static ROGUE_CORVETTE_SUBS: [SubDef; 6] = hull_subs(1.2, 90.0, 0.28);
static ROGUE_DESTROYER_SUBS: [SubDef; 6] = hull_subs(2.2, 90.0, 0.83);
static ROGUE_CRUISER_SUBS: [SubDef; 6] = hull_subs(2.9, 90.0, 1.33);
static BENEFACTOR_CORVETTE_SUBS: [SubDef; 6] = hull_subs(1.3, 80.0, 0.24);
static BENEFACTOR_DESTROYER_SUBS: [SubDef; 6] = hull_subs(2.5, 80.0, 0.96);
static BENEFACTOR_CRUISER_SUBS: [SubDef; 6] = hull_subs(3.4, 80.0, 1.75);

static TERRAN_CORVETTE_MOUNTS: [MountDef; 2] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.26, 1.49) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.33, 0.15) },
];

static TERRAN_DESTROYER_MOUNTS: [MountDef; 5] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.57, 3.43) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(-1.86, 0.29, 1.43) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(1.86, 0.29, 1.43) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.79, -1.14) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(0.00, -0.57, 1.86) },
];

static TERRAN_CRUISER_MOUNTS: [MountDef; 8] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.78, 5.05) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(-2.62, 0.43, 2.72) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(2.62, 0.43, 2.72) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(-2.62, 0.43, -0.78) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(2.62, 0.43, -0.78) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 1.17, -2.53) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(0.00, -0.82, 3.11) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(0.00, -0.82, -1.75) },
];

static KARISEN_CORVETTE_MOUNTS: [MountDef; 2] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.28, 1.52) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.00, -0.22, 0.22) },
];

static KARISEN_DESTROYER_MOUNTS: [MountDef; 4] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.58, 3.35) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.66, -0.87) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(-1.24, -0.41, -0.29) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(1.24, -0.41, -0.29) },
];

static KARISEN_CRUISER_MOUNTS: [MountDef; 6] = [
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.84, 5.10) },
    MountDef { key: WeaponKey::Beam, mount: V3::new(0.00, 0.96, -1.80) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(-1.90, -0.60, 1.60) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(1.90, -0.60, 1.60) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(-1.90, -0.60, -1.20) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(1.90, -0.60, -1.20) },
];

static ROGUE_CORVETTE_MOUNTS: [MountDef; 1] = [
    MountDef { key: WeaponKey::Plasma, mount: V3::new(0.00, 0.15, 1.06) },
];

static ROGUE_DESTROYER_MOUNTS: [MountDef; 3] = [
    MountDef { key: WeaponKey::Plasma, mount: V3::new(-1.14, 0.30, 2.08) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(1.14, 0.30, 2.08) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(0.00, 0.60, -0.54) },
];

static ROGUE_CRUISER_MOUNTS: [MountDef; 4] = [
    MountDef { key: WeaponKey::Plasma, mount: V3::new(-1.92, 0.44, 3.29) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(1.92, 0.44, 3.29) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(-1.92, 0.44, -0.91) },
    MountDef { key: WeaponKey::Plasma, mount: V3::new(1.92, 0.44, -0.91) },
];

static BENEFACTOR_CORVETTE_MOUNTS: [MountDef; 2] = [
    MountDef { key: WeaponKey::Cannon, mount: V3::new(0.00, 0.15, 1.00) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.00, -0.22, 0.15) },
];

static BENEFACTOR_DESTROYER_MOUNTS: [MountDef; 4] = [
    MountDef { key: WeaponKey::Cannon, mount: V3::new(-1.50, 0.31, 1.93) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(1.50, 0.31, 1.93) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(0.00, 0.79, -1.00) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.00, -0.46, 0.14) },
];

static BENEFACTOR_CRUISER_MOUNTS: [MountDef; 6] = [
    MountDef { key: WeaponKey::Cannon, mount: V3::new(-2.23, 0.47, 3.11) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(2.23, 0.47, 3.11) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(-2.23, 0.47, -1.17) },
    MountDef { key: WeaponKey::Cannon, mount: V3::new(2.23, 0.47, -1.17) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.00, -0.68, 1.36) },
    MountDef { key: WeaponKey::Missile, mount: V3::new(0.00, -0.68, -2.14) },
];

static C_TERRAN_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::TerranFrigate,
    key: "terran_frigate",
    name: "Terran Frigate",
    hull: 121.301,
    radius: 1.8,
    mass: 0.61,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 11.1611,
        pitch_rate: 7.478,
        accel_fwd: 1.7549,
        accel_retro: 0.585,
        accel_lat: 0.39,
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
    hull: 110.459,
    radius: 1.9,
    mass: 0.56,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 11.4956,
        pitch_rate: 7.702,
        accel_fwd: 2.0065,
        accel_retro: 0.6336,
        accel_lat: 0.4224,
        max_speed: 8.5,
    },
    boarding_range: 20.0,
    marines: 15,
    boarding_capacity: 4,
    subsystems: &KARISEN_SUBS,
    weapons: &KARISEN_MOUNTS,
};

/// The boarding specialist (Rogue_Ship_1.prefab: range 40, 40 marines,
/// capacity 12), and the only hull agile enough to close for it.
static C_ROGUE_FRIGATE: ShipClass = ShipClass {
    id: ShipClassId::RogueFrigate,
    key: "rogue_frigate",
    name: "Rogue Frigate",
    hull: 147.55,
    radius: 1.5,
    mass: 0.81,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 12.4519,
        pitch_rate: 8.3428,
        accel_fwd: 1.4543,
        accel_retro: 0.5141,
        accel_lat: 0.3526,
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
    hull: 113.647,
    radius: 1.8,
    mass: 0.59,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 11.7923,
        pitch_rate: 7.9008,
        accel_fwd: 1.7209,
        accel_retro: 0.6074,
        accel_lat: 0.4049,
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
    hull: 251.703,
    radius: 2.9,
    mass: 1.07,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 3.9371,
        pitch_rate: 2.6379,
        accel_fwd: 0.9926,
        accel_retro: 0.3309,
        accel_lat: 0.2206,
        max_speed: 5.0,
    },
    boarding_range: 10.0,
    marines: 15,
    boarding_capacity: 6,
    subsystems: &FREIGHTER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

/// The line navy's ladder: a slab hull, honest belts and beams, one more
/// battery at every rung. Nothing on a Terran surprises anybody, which is the
/// point of a fleet built to be replaced.
static C_TERRAN_CORVETTE: ShipClass = ShipClass {
    id: ShipClassId::TerranCorvette,
    key: "terran_corvette",
    name: "Terran Corvette",
    hull: 68.591,
    radius: 1.4,
    mass: 0.36,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 12.7765,
        pitch_rate: 8.5602,
        accel_fwd: 1.4893,
        accel_retro: 0.9929,
        accel_lat: 0.331,
        max_speed: 8.5,
    },
    boarding_range: 20.0,
    marines: 5,
    boarding_capacity: 2,
    subsystems: &TERRAN_CORVETTE_SUBS,
    weapons: &TERRAN_CORVETTE_MOUNTS,
};

static C_TERRAN_DESTROYER: ShipClass = ShipClass {
    id: ShipClassId::TerranDestroyer,
    key: "terran_destroyer",
    name: "Terran Destroyer",
    hull: 258.272,
    radius: 2.6,
    mass: 1.18,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 7.8863,
        pitch_rate: 5.2838,
        accel_fwd: 1.9454,
        accel_retro: 0.5986,
        accel_lat: 0.3991,
        max_speed: 7.0,
    },
    boarding_range: 20.0,
    marines: 25,
    boarding_capacity: 10,
    subsystems: &TERRAN_DESTROYER_SUBS,
    weapons: &TERRAN_DESTROYER_MOUNTS,
};

static C_TERRAN_CRUISER: ShipClass = ShipClass {
    id: ShipClassId::TerranCruiser,
    key: "terran_cruiser",
    name: "Terran Heavy Cruiser",
    hull: 519.374,
    radius: 3.5,
    mass: 2.1,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 3.3526,
        pitch_rate: 2.2463,
        accel_fwd: 1.4572,
        accel_retro: 0.3363,
        accel_lat: 0.2242,
        max_speed: 7.0,
    },
    boarding_range: 30.0,
    marines: 40,
    boarding_capacity: 12,
    subsystems: &TERRAN_CRUISER_SUBS,
    weapons: &TERRAN_CRUISER_MOUNTS,
};

/// Long, thin and standing off. Every rung is the longest hull at that rung and
/// has the smallest cross section, and every rung adds missile cells; the beams
/// never go past two however big it gets.
static C_KARISEN_CORVETTE: ShipClass = ShipClass {
    id: ShipClassId::KarisenCorvette,
    key: "karisen_corvette",
    name: "Karisen Corvette",
    hull: 70.152,
    radius: 1.6,
    mass: 0.37,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 11.0419,
        pitch_rate: 7.3981,
        accel_fwd: 3.1609,
        accel_retro: 0.3193,
        accel_lat: 0.3193,
        max_speed: 9.5,
    },
    boarding_range: 20.0,
    marines: 5,
    boarding_capacity: 2,
    subsystems: &KARISEN_CORVETTE_SUBS,
    weapons: &KARISEN_CORVETTE_MOUNTS,
};

static C_KARISEN_DESTROYER: ShipClass = ShipClass {
    id: ShipClassId::KarisenDestroyer,
    key: "karisen_destroyer",
    name: "Karisen Destroyer",
    hull: 196.171,
    radius: 2.8,
    mass: 0.86,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 9.908,
        pitch_rate: 6.6384,
        accel_fwd: 1.3042,
        accel_retro: 0.8237,
        accel_lat: 0.5491,
        max_speed: 8.5,
    },
    boarding_range: 20.0,
    marines: 20,
    boarding_capacity: 6,
    subsystems: &KARISEN_DESTROYER_SUBS,
    weapons: &KARISEN_DESTROYER_MOUNTS,
};

static C_KARISEN_CRUISER: ShipClass = ShipClass {
    id: ShipClassId::KarisenCruiser,
    key: "karisen_cruiser",
    name: "Karisen Heavy Cruiser",
    hull: 349.812,
    radius: 3.8,
    mass: 1.4,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 4.5588,
        pitch_rate: 3.0544,
        accel_fwd: 1.5623,
        accel_retro: 0.5067,
        accel_lat: 0.3378,
        max_speed: 8.5,
    },
    boarding_range: 20.0,
    marines: 25,
    boarding_capacity: 6,
    subsystems: &KARISEN_CRUISER_SUBS,
    weapons: &KARISEN_CRUISER_MOUNTS,
};

/// Boarding gear first and a ship built around it: the least hull at every
/// rung, the most marines by a wide margin, and still the sharpest turn on the
/// board. The guns are an afterthought and always were.
static C_ROGUE_CORVETTE: ShipClass = ShipClass {
    id: ShipClassId::RogueCorvette,
    key: "rogue_corvette",
    name: "Rogue Corvette",
    hull: 66.408,
    radius: 1.2,
    mass: 0.36,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 15.089,
        pitch_rate: 10.1096,
        accel_fwd: 2.3233,
        accel_retro: 0.3272,
        accel_lat: 0.3272,
        max_speed: 9.5,
    },
    boarding_range: 20.0,
    marines: 15,
    boarding_capacity: 4,
    subsystems: &ROGUE_CORVETTE_SUBS,
    weapons: &ROGUE_CORVETTE_MOUNTS,
};

static C_ROGUE_DESTROYER: ShipClass = ShipClass {
    id: ShipClassId::RogueDestroyer,
    key: "rogue_destroyer",
    name: "Rogue Destroyer",
    hull: 199.974,
    radius: 2.2,
    mass: 1.01,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 7.747,
        pitch_rate: 5.1905,
        accel_fwd: 1.155,
        accel_retro: 0.7,
        accel_lat: 0.3267,
        max_speed: 9.5,
    },
    boarding_range: 40.0,
    marines: 45,
    boarding_capacity: 14,
    subsystems: &ROGUE_DESTROYER_SUBS,
    weapons: &ROGUE_DESTROYER_MOUNTS,
};

static C_ROGUE_CRUISER: ShipClass = ShipClass {
    id: ShipClassId::RogueCruiser,
    key: "rogue_cruiser",
    name: "Rogue Heavy Cruiser",
    hull: 319.1,
    radius: 2.9,
    mass: 1.51,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 5.7031,
        pitch_rate: 3.8211,
        accel_fwd: 1.0317,
        accel_retro: 0.469,
        accel_lat: 0.3126,
        max_speed: 9.5,
    },
    boarding_range: 50.0,
    marines: 70,
    boarding_capacity: 16,
    subsystems: &ROGUE_CRUISER_SUBS,
    weapons: &ROGUE_CRUISER_MOUNTS,
};

/// Deep sectioned monitors. They grow by CALIBRE and belt rather than by
/// count, and each rung is slower than anything else at that rung: the trade is
/// that cannon go through a belt and beams do not.
static C_BENEFACTOR_CORVETTE: ShipClass = ShipClass {
    id: ShipClassId::BenefactorCorvette,
    key: "benefactor_corvette",
    name: "Benefactor Corvette",
    hull: 58.766,
    radius: 1.3,
    mass: 0.31,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 11.1787,
        pitch_rate: 7.4897,
        accel_fwd: 0.962,
        accel_retro: 1.1544,
        accel_lat: 0.2694,
        max_speed: 8.0,
    },
    boarding_range: 20.0,
    marines: 5,
    boarding_capacity: 2,
    subsystems: &BENEFACTOR_CORVETTE_SUBS,
    weapons: &BENEFACTOR_CORVETTE_MOUNTS,
};

static C_BENEFACTOR_DESTROYER: ShipClass = ShipClass {
    id: ShipClassId::BenefactorDestroyer,
    key: "benefactor_destroyer",
    name: "Benefactor Destroyer",
    hull: 231.18,
    radius: 2.5,
    mass: 1.03,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 9.3774,
        pitch_rate: 6.2829,
        accel_fwd: 1.4871,
        accel_retro: 0.6864,
        accel_lat: 0.4576,
        max_speed: 7.0,
    },
    boarding_range: 20.0,
    marines: 25,
    boarding_capacity: 10,
    subsystems: &BENEFACTOR_DESTROYER_SUBS,
    weapons: &BENEFACTOR_DESTROYER_MOUNTS,
};

static C_BENEFACTOR_CRUISER: ShipClass = ShipClass {
    id: ShipClassId::BenefactorCruiser,
    key: "benefactor_cruiser",
    name: "Benefactor Heavy Cruiser",
    hull: 420.386,
    radius: 3.4,
    mass: 1.7,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 4.306,
        pitch_rate: 2.885,
        accel_fwd: 1.3184,
        accel_retro: 0.4163,
        accel_lat: 0.2776,
        max_speed: 7.0,
    },
    boarding_range: 30.0,
    marines: 35,
    boarding_capacity: 12,
    subsystems: &BENEFACTOR_CRUISER_SUBS,
    weapons: &BENEFACTOR_CRUISER_MOUNTS,
};

/// The civil yards. Six trades rather than a ladder, and not one of them
/// carries a mount: `FREIGHTER_MOUNTS` is the empty table they all share, which
/// is what makes the arms gate pass on a hull with no gun ring anywhere.
static C_CIVIL_LIGHTER: ShipClass = ShipClass {
    id: ShipClassId::CivilLighter,
    key: "civil_lighter",
    name: "Lighter",
    hull: 115.27,
    radius: 2.0,
    mass: 0.52,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 12.641,
        pitch_rate: 8.4695,
        accel_fwd: 1.3707,
        accel_retro: 0.6854,
        accel_lat: 0.4569,
        max_speed: 5.0,
    },
    boarding_range: 10.0,
    marines: 5,
    boarding_capacity: 4,
    subsystems: &LIGHTER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

static C_CIVIL_HAULER: ShipClass = ShipClass {
    id: ShipClassId::CivilHauler,
    key: "civil_hauler",
    name: "Hauler",
    hull: 266.149,
    radius: 2.5,
    mass: 1.24,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 5.9414,
        pitch_rate: 3.9808,
        accel_fwd: 0.859,
        accel_retro: 0.5727,
        accel_lat: 0.2863,
        max_speed: 5.0,
    },
    boarding_range: 20.0,
    marines: 10,
    boarding_capacity: 6,
    subsystems: &HAULER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

static C_CIVIL_BOXSHIP: ShipClass = ShipClass {
    id: ShipClassId::CivilBoxship,
    key: "civil_boxship",
    name: "Container Ship",
    hull: 543.685,
    radius: 3.5,
    mass: 2.43,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 2.8554,
        pitch_rate: 1.9131,
        accel_fwd: 1.1662,
        accel_retro: 0.2916,
        accel_lat: 0.1944,
        max_speed: 7.0,
    },
    boarding_range: 20.0,
    marines: 10,
    boarding_capacity: 6,
    subsystems: &BOXSHIP_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

static C_CIVIL_TANKER: ShipClass = ShipClass {
    id: ShipClassId::CivilTanker,
    key: "civil_tanker",
    name: "Tanker",
    hull: 497.831,
    radius: 3.3,
    mass: 2.14,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 3.4222,
        pitch_rate: 1.1464,
        accel_fwd: 1.3235,
        accel_retro: 0.3309,
        accel_lat: 0.1103,
        max_speed: 7.0,
    },
    boarding_range: 10.0,
    marines: 10,
    boarding_capacity: 4,
    subsystems: &TANKER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

static C_CIVIL_MINER: ShipClass = ShipClass {
    id: ShipClassId::CivilMiner,
    key: "civil_miner",
    name: "Mining Ship",
    hull: 269.669,
    radius: 2.2,
    mass: 1.32,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 6.28,
        pitch_rate: 4.2076,
        accel_fwd: 0.5372,
        accel_retro: 0.5372,
        accel_lat: 0.2686,
        max_speed: 5.0,
    },
    boarding_range: 20.0,
    marines: 10,
    boarding_capacity: 4,
    subsystems: &MINER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

static C_CIVIL_LINER: ShipClass = ShipClass {
    id: ShipClassId::CivilLiner,
    key: "civil_liner",
    name: "Liner",
    hull: 461.78,
    radius: 3.6,
    mass: 1.96,
    base_reach: 10.0,
    base_marines: 0,
    base_capacity: 0,
    flight: Flight {
        yaw_rate: 3.4122,
        pitch_rate: 2.2862,
        accel_fwd: 1.2626,
        accel_retro: 0.3607,
        accel_lat: 0.2405,
        max_speed: 8.0,
    },
    boarding_range: 20.0,
    marines: 16,
    boarding_capacity: 4,
    subsystems: &LINER_SUBS,
    weapons: &FREIGHTER_MOUNTS,
};

pub fn ship_class(id: ShipClassId) -> &'static ShipClass {
    match id {
        ShipClassId::TerranFrigate => &C_TERRAN_FRIGATE,
        ShipClassId::KarisenFrigate => &C_KARISEN_FRIGATE,
        ShipClassId::RogueFrigate => &C_ROGUE_FRIGATE,
        ShipClassId::BenefactorFrigate => &C_BENEFACTOR_FRIGATE,
        ShipClassId::Freighter => &C_FREIGHTER,
        ShipClassId::TerranCorvette => &C_TERRAN_CORVETTE,
        ShipClassId::TerranDestroyer => &C_TERRAN_DESTROYER,
        ShipClassId::TerranCruiser => &C_TERRAN_CRUISER,
        ShipClassId::KarisenCorvette => &C_KARISEN_CORVETTE,
        ShipClassId::KarisenDestroyer => &C_KARISEN_DESTROYER,
        ShipClassId::KarisenCruiser => &C_KARISEN_CRUISER,
        ShipClassId::RogueCorvette => &C_ROGUE_CORVETTE,
        ShipClassId::RogueDestroyer => &C_ROGUE_DESTROYER,
        ShipClassId::RogueCruiser => &C_ROGUE_CRUISER,
        ShipClassId::BenefactorCorvette => &C_BENEFACTOR_CORVETTE,
        ShipClassId::BenefactorDestroyer => &C_BENEFACTOR_DESTROYER,
        ShipClassId::BenefactorCruiser => &C_BENEFACTOR_CRUISER,
        ShipClassId::CivilLighter => &C_CIVIL_LIGHTER,
        ShipClassId::CivilHauler => &C_CIVIL_HAULER,
        ShipClassId::CivilBoxship => &C_CIVIL_BOXSHIP,
        ShipClassId::CivilTanker => &C_CIVIL_TANKER,
        ShipClassId::CivilMiner => &C_CIVIL_MINER,
        ShipClassId::CivilLiner => &C_CIVIL_LINER,
    }
}

pub const ALL_CLASSES: [ShipClassId; 23] = [
    ShipClassId::TerranFrigate,
    ShipClassId::KarisenFrigate,
    ShipClassId::RogueFrigate,
    ShipClassId::BenefactorFrigate,
    ShipClassId::Freighter,
    ShipClassId::TerranCorvette,
    ShipClassId::TerranDestroyer,
    ShipClassId::TerranCruiser,
    ShipClassId::KarisenCorvette,
    ShipClassId::KarisenDestroyer,
    ShipClassId::KarisenCruiser,
    ShipClassId::RogueCorvette,
    ShipClassId::RogueDestroyer,
    ShipClassId::RogueCruiser,
    ShipClassId::BenefactorCorvette,
    ShipClassId::BenefactorDestroyer,
    ShipClassId::BenefactorCruiser,
    ShipClassId::CivilLighter,
    ShipClassId::CivilHauler,
    ShipClassId::CivilBoxship,
    ShipClassId::CivilTanker,
    ShipClassId::CivilMiner,
    ShipClassId::CivilLiner,
];

pub fn class_from_index(i: u32) -> ShipClassId {
    ALL_CLASSES[(i as usize).min(ALL_CLASSES.len() - 1)]
}

pub fn class_index(id: ShipClassId) -> u32 {
    ALL_CLASSES.iter().position(|c| *c == id).unwrap_or(0) as u32
}
