//! What a designed hull IS, in numbers.
//!
//! The editor draws a ship out of parts and plate; this decides what that ship
//! weighs, how much hull it has and how it flies. That is a rule, not a
//! picture, so it lives here rather than in the client that happens to be
//! drawing it (ADR-2): two clients that derived a design differently would
//! field two different ships from the same record and part on the first turn.
//!
//! The client still MEASURES. How many cells of plate a design has, how big its
//! bounding box is and how far its furthest corner sits are questions about a
//! voxel grid, and the voxel grid is still rasterised on the client. Those
//! arrive as `Geometry` and nothing here re-derives them. What arrives is a
//! count; what leaves is a ship.

use crate::data::{class_index, ship_class, ShipClassId, WeaponKey, ALL_CLASSES};

/// One fittable part, in the fields that decide an outcome.
///
/// Art, colour and purpose are not here on purpose: what a part LOOKS like is
/// the client's business and nothing in a match reads it.
pub struct ModuleDef {
    pub id: &'static str,
    /// Millionths of a class mass unit, so the sums stay integer.
    pub mass_um: i64,
    /// Structural hull in milli HP.
    pub hull_milli: i64,
    pub thrust: i32,
    pub retro: i32,
    pub lat_x: i32,
    pub lat_y: i32,
    /// Exhaust velocity. Top speed is the best of these, with no mass term.
    pub exhaust: f32,
    pub weapon: Option<WeaponKey>,
    pub marines: i32,
    pub capacity: i32,
    /// Boarding reach added over the class base.
    pub reach: i32,
}

/// The parts table, mirroring `web/src/app/design.ts`.
///
/// Index IS the identity across the boundary: strings do not cross a wasm ABI
/// worth writing, so the client sends the position and this table gives it a
/// meaning. An entry inserted in the middle renumbers every part after it on
/// one side and not the other, so new parts go on the end.
pub static MODULES: [ModuleDef; 22] = [
    ModuleDef { id: "DRV-V", mass_um: 1520, hull_milli: 320, thrust: 5, retro: 0, lat_x: 0, lat_y: 0, exhaust: 6.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "DRV-N", mass_um: 12160, hull_milli: 2560, thrust: 15, retro: 0, lat_x: 0, lat_y: 0, exhaust: 8.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "DRV-B", mass_um: 23750, hull_milli: 5000, thrust: 30, retro: 0, lat_x: 0, lat_y: 0, exhaust: 8.5, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "DRV-BR", mass_um: 28500, hull_milli: 6000, thrust: 33, retro: 0, lat_x: 0, lat_y: 0, exhaust: 9.5, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "DRV-T", mass_um: 23750, hull_milli: 5000, thrust: 30, retro: 0, lat_x: 0, lat_y: 0, exhaust: 5.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "DRV-H", mass_um: 65170, hull_milli: 13720, thrust: 60, retro: 0, lat_x: 0, lat_y: 0, exhaust: 7.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "RET-S", mass_um: 1520, hull_milli: 320, thrust: 0, retro: 5, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "RET-C", mass_um: 10260, hull_milli: 2160, thrust: 0, retro: 15, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "RCS-Q", mass_um: 1520, hull_milli: 320, thrust: 0, retro: 0, lat_x: 2, lat_y: 2, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "MAN-B", mass_um: 5130, hull_milli: 1080, thrust: 0, retro: 0, lat_x: 5, lat_y: 5, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "MAN-Y", mass_um: 6840, hull_milli: 1440, thrust: 0, retro: 0, lat_x: 10, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "MAN-P", mass_um: 6840, hull_milli: 1440, thrust: 0, retro: 0, lat_x: 0, lat_y: 10, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "WPN-BB1", mass_um: 20520, hull_milli: 4320, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "WPN-BM1", mass_um: 30400, hull_milli: 6400, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: Some(WeaponKey::Beam), marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "WPN-CN1", mass_um: 34200, hull_milli: 7200, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: Some(WeaponKey::Cannon), marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "WPN-ML1", mass_um: 33250, hull_milli: 7000, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: Some(WeaponKey::Missile), marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "UTL-BRG", mass_um: 34200, hull_milli: 7200, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "UTL-BAR", mass_um: 26600, hull_milli: 5600, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 5, capacity: 0, reach: 0 },
    ModuleDef { id: "UTL-AIR", mass_um: 5130, hull_milli: 1080, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 2, reach: 0 },
    ModuleDef { id: "UTL-CLM", mass_um: 22800, hull_milli: 4800, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 5 },
    ModuleDef { id: "UTL-CGO", mass_um: 197600, hull_milli: 41600, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
    ModuleDef { id: "STR-STRUT", mass_um: 190, hull_milli: 40, thrust: 0, retro: 0, lat_x: 0, lat_y: 0, exhaust: 0.0, weapon: None, marines: 0, capacity: 0, reach: 0 },
];

/// The bridge, which every hull must carry exactly one of.
pub const BRIDGE: usize = 16;

pub fn module(i: usize) -> Option<&'static ModuleDef> {
    MODULES.get(i)
}

/// A part's index by id, for callers that hold the string rather than the slot.
pub fn module_index(id: &str) -> Option<usize> {
    MODULES.iter().position(|m| m.id == id)
}

/// Plate costs mass and gives hull, per cell of a FRIGATE's cell. A bigger
/// rung's cell is a bigger volume of the same material, so it scales cubically;
/// a part is a machine and does not.
const PLATE_UM: f32 = 78.0;
const HULL_MILLI: f32 = 34.0;
/// The frigate cell, in world units. Every other rung is a multiple of it.
use crate::data::FRIGATE_CELL;
/// Turn length, from `data.rs` CONST.
const TURN_SECONDS: f32 = 10.0;

/// What the client measured off the voxel grid it drew.
///
/// Counts, not rules. The rasteriser is still on the client, so these are the
/// one thing that crosses inward; when it moves into the core they will be
/// computed here and this struct becomes an internal detail rather than an
/// input.
#[derive(Clone, Copy, Debug, Default)]
pub struct Geometry {
    pub plate_cells: i32,
    pub ext: [i32; 3],
    /// The true bounding sphere in cells, about the hull's own centre.
    pub radius_cells: f32,
    /// Cells of armour or another part standing inside a turret's box.
    pub fouled: i32,
}

/// What a design comes out as.
#[derive(Clone, Copy, Debug, Default)]
pub struct Derived {
    pub mass: f32,
    pub hull: f32,
    pub radius: f32,
    pub accel_fwd: f32,
    pub accel_retro: f32,
    pub accel_lat: f32,
    pub max_speed: f32,
    pub yaw_rate: f32,
    pub pitch_rate: f32,
    pub reach_u: f32,
    pub marines: i32,
    pub capacity: i32,
    pub boarding_range: f32,
    pub mass_max: f32,
    pub parts: i32,
    pub guns: i32,
    pub trunnions: i32,
    /// One bit per gate, set when it PASSES. Order is the `CHECK_*` constants.
    pub gates: u32,
}

pub const CHECK_PARTS: u32 = 1 << 0;
pub const CHECK_THRUST: u32 = 1 << 1;
pub const CHECK_BRIDGE: u32 = 1 << 2;
pub const CHECK_ARMS: u32 = 1 << 3;
pub const CHECK_MASS: u32 = 1 << 4;
pub const CHECK_SPHERE: u32 = 1 << 5;
pub const CHECK_TURRETS: u32 = 1 << 6;
pub const CHECK_ALL: u32 = 0b111_1111;

impl Derived {
    pub fn legal(&self) -> bool {
        self.gates == CHECK_ALL
    }
}

/// The cell size of a class, in world units.
pub fn cell_of(class: ShipClassId) -> f32 {
    ship_class(class).rung_cell
}

/// Derive a design: what it weighs, what it can take, and how it flies.
///
/// The arithmetic is the editor's, moved rather than reinvented, because the
/// numbers it produces are calibrated against the five authored classes and a
/// second opinion about them would be a second ship.
pub fn derive(class: ShipClassId, parts: &[usize], geo: Geometry) -> Derived {
    let cls = ship_class(class);
    let cell = cls.rung_cell;

    let mut mass_um: i64 = 0;
    let mut hull_milli: i64 = 0;
    let (mut thrust, mut retro, mut lat_x, mut lat_y) = (0i32, 0i32, 0i32, 0i32);
    let mut exhaust = 0.0f32;
    let (mut marines, mut capacity, mut reach) = (0i32, 0i32, 0i32);
    let (mut guns, mut trunnions, mut count) = (0i32, 0i32, 0i32);
    let mut has_bridge = false;

    for &p in parts {
        let Some(m) = module(p) else { continue };
        count += 1;
        mass_um += m.mass_um;
        hull_milli += m.hull_milli;
        thrust += m.thrust;
        retro += m.retro;
        lat_x += m.lat_x;
        lat_y += m.lat_y;
        if m.exhaust > exhaust {
            exhaust = m.exhaust;
        }
        marines += m.marines;
        capacity += m.capacity;
        reach += m.reach;
        if p == BRIDGE {
            has_bridge = true;
        }
        if m.id == "WPN-BB1" {
            trunnions += 1;
        }
        if m.weapon.is_some() {
            guns += 1;
        }
    }

    // The hull as built, counted rather than estimated. A cell of plate is a
    // volume of material, so it scales with the rung; the parts do not.
    let scale = cell / FRIGATE_CELL;
    let vol = scale * scale * scale;
    mass_um += (geo.plate_cells as f32 * PLATE_UM * vol).round() as i64;
    hull_milli += (geo.plate_cells as f32 * HULL_MILLI * vol).round() as i64;

    let mass = mass_um as f32 / 1.0e6;
    let hull = hull_milli as f32 / 1000.0;

    // No thruster means no thrust at all, which is the core's own rule: losing
    // the last live Thruster costs 100 percent of it.
    let m_den = if mass_um > 0 { mass_um as f32 } else { 1.0 };
    let accel_fwd = (thrust as f32 * 10_000.0) / m_den;
    let accel_retro = (retro as f32 * 10_000.0) / m_den;
    let accel_lat = (lat_x.min(lat_y) as f32 * 10_000.0) / m_den;
    let max_speed = if thrust > 0 { exhaust } else { 0.0 };

    // A first moment curve rather than rigid body dynamics, because the flight
    // model is hand authored on purpose (ADR-14). Rotation comes from what
    // actually turns the ship, against its mass and its length.
    let len_z = (geo.ext[2].max(1)) as f32;
    const K: f32 = 16.6;
    let denom = mass.max(1.0e-6) * len_z;
    let yaw_rate = if thrust > 0 { (K * lat_x as f32 / denom).min(24.0) } else { 0.0 };
    let pitch_rate = if thrust > 0 { (K * 0.67 * lat_y as f32 / denom).min(16.0) } else { 0.0 };

    // nominal_reach(), which the AI picks engagement distances with.
    let t_accel = if accel_fwd > 0.0 { (max_speed / accel_fwd).min(TURN_SECONDS) } else { 0.0 };
    let reach_u = 0.5 * accel_fwd * t_accel * t_accel + max_speed * (TURN_SECONDS - t_accel);

    let radius = geo.radius_cells * cell;
    let mass_max = cls.mass;

    let mut gates = 0u32;
    if count > 0 { gates |= CHECK_PARTS; }
    if thrust > 0 { gates |= CHECK_THRUST; }
    if has_bridge { gates |= CHECK_BRIDGE; }
    // The Freighter frame has no gun ring, on purpose.
    if guns > 0 || cls.weapons.is_empty() { gates |= CHECK_ARMS; }
    if mass <= mass_max + 1.0e-9 { gates |= CHECK_MASS; }
    if radius <= cls.radius + 1.0e-9 { gates |= CHECK_SPHERE; }
    if geo.fouled == 0 { gates |= CHECK_TURRETS; }

    Derived {
        mass, hull, radius,
        accel_fwd, accel_retro, accel_lat, max_speed,
        yaw_rate, pitch_rate, reach_u,
        marines: cls.base_marines + marines,
        capacity: cls.base_capacity + capacity,
        boarding_range: cls.base_reach + reach as f32,
        mass_max,
        parts: count,
        guns,
        trunnions,
        gates,
    }
}

/// The class a key names, for callers holding the design's own `classKey`.
pub fn class_by_key(key: &str) -> Option<ShipClassId> {
    ALL_CLASSES.iter().copied().find(|c| ship_class(*c).key == key)
}

/// A class's index, re-exported so a caller deriving a design does not have to
/// reach into `data` for the one number it needs.
pub fn index_of(class: ShipClassId) -> u32 {
    class_index(class)
}
