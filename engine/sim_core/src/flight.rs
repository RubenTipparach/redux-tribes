//! The flight model (ADR-14).
//!
//! Movement is a rate limited attitude plus per local axis thrust, integrated
//! against carried velocity. No curve fitting, no closed form: where a ship can
//! get to this turn is whatever this loop can fly it to.
//!
//! Three things restrict it, and only these three:
//!   1. rotation stats     yaw_rate and pitch_rate cap how fast the hull swings,
//!                         so a heading you cannot reach is thrust you cannot
//!                         apply.
//!   2. local axis limits  accel_fwd / accel_retro / accel_lat are spent in the
//!                         ship's OWN frame. The main drive is strong astern,
//!                         retros weak, RCS weaker.
//!   3. carried velocity   momentum survives the turn boundary.
//!
//! This is a port of `prototype/sim/sim.js`, kept numerically identical on
//! purpose: the JS prototype stays the reference implementation while the Rust
//! core grows, and `tests/parity.rs` pins them together.

use crate::math::{dacos, datan2, Quat, V3};

pub const TICKS_PER_SECOND: u32 = 60;
/// Resolution runs one slice per tick; a probe may ask for fewer.
pub const RESOLUTION_STEPS: u32 = TICKS_PER_TURN;
pub const TURN_SECONDS: f32 = 10.0;
pub const TICKS_PER_TURN: u32 = 600;
pub const ARRIVE_EPS: f32 = 0.35;
pub const BOOST_ACCEL_MULT: f32 = 1.6;
pub const BOOST_SPEED_MULT: f32 = 1.5;


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    MoveAndTurn,
    TurnSlide,
    FullSpeed,
    FullStop,
    Drift,
}

impl Mode {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => Mode::TurnSlide,
            2 => Mode::FullSpeed,
            3 => Mode::FullStop,
            4 => Mode::Drift,
            _ => Mode::MoveAndTurn,
        }
    }
    /// A committed mode is one whose outcome the destination cannot influence.
    pub fn committed(self) -> bool {
        matches!(self, Mode::FullSpeed | Mode::FullStop | Mode::Drift)
    }
}

/// The flight envelope. The model reads nothing else about a ship.
#[derive(Clone, Copy, Debug)]
pub struct Flight {
    pub yaw_rate: f32,   // degrees per second about local up
    pub pitch_rate: f32, // degrees per second about local right
    pub accel_fwd: f32,  // u/s^2 along +Z, the main drive
    pub accel_retro: f32,
    pub accel_lat: f32, // u/s^2 along local X and Y, the RCS
    pub max_speed: f32,
}

impl Default for Flight {
    fn default() -> Self {
        Self {
            yaw_rate: 6.0,
            pitch_rate: 4.0,
            accel_fwd: 0.9,
            accel_retro: 0.35,
            accel_lat: 0.25,
            max_speed: 8.0,
        }
    }
}

impl Flight {
    /// Roughly how far a hull covers in a turn from rest. Not a movement rule:
    /// a cheap scalar for AI engagement distances, derived from the stats so it
    /// cannot drift away from what the ship can really do.
    pub fn nominal_reach(&self) -> f32 {
        let t_accel = (self.max_speed / self.accel_fwd).min(TURN_SECONDS);
        0.5 * self.accel_fwd * t_accel * t_accel + self.max_speed * (TURN_SECONDS - t_accel)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Body {
    pub pos: V3,
    pub vel: V3, // units per SECOND, carried across turns
    pub quat: Quat,
}

pub struct Flown {
    pub end_pos: V3,
    pub end_vel: V3,
    pub end_quat: Quat,
    /// One entry per integration slice, plus the start. Ships read their pose
    /// straight out of this, so preview and execution are the same array.
    pub path: Vec<(V3, Quat)>,
}

/// Swing the hull toward `want`, spending at most yaw_rate/pitch_rate this
/// slice. The error is resolved in the BODY frame so the two axes are limited
/// separately, which is what makes a sluggish nose feel different from a
/// sluggish pitch rather than just "slow".
fn rotate_toward(quat: Quat, want: V3, fl: &Flight, dt: f32) -> Quat {
    let local = quat.inv().rot(want);
    let flat = (local.x * local.x + local.z * local.z).sqrt();
    // Straight up or straight down has no yaw: x and z are both ~0 there and
    // atan2 of two near-zero numbers is noise, which the rotation then
    // amplifies. Hold the current yaw and let pitch do the work instead.
    let mut yaw_err = if flat < 1e-4 { 0.0 } else { datan2(local.x, local.z) };
    let mut pitch_err = datan2(local.y, flat.max(1e-9));
    let max_yaw = fl.yaw_rate * crate::math::PI / 180.0 * dt;
    let max_pitch = fl.pitch_rate * crate::math::PI / 180.0 * dt;
    yaw_err = yaw_err.clamp(-max_yaw, max_yaw);
    pitch_err = pitch_err.clamp(-max_pitch, max_pitch);
    let q = quat.mul(Quat::axis_angle(V3::new(0.0, 1.0, 0.0), yaw_err));
    q.mul(Quat::axis_angle(V3::new(1.0, 0.0, 0.0), pitch_err)).norm()
}

fn desired_velocity(pos: V3, target: V3, seconds_left: f32, fl: &Flight, mode: Mode) -> V3 {
    if mode == Mode::FullStop {
        return V3::ZERO;
    }
    let aim = target.sub(pos);
    let dist = aim.len();
    if dist < ARRIVE_EPS {
        return V3::ZERO;
    }
    aim.scale(1.0 / seconds_left.max(1e-3)).clamp_len(fl.max_speed)
}

fn step_flight(
    b: Body,
    target: V3,
    seconds_left: f32,
    fl: &Flight,
    mode: Mode,
    face_dir: V3,
    dt: f32,
) -> Body {
    let boosting = mode == Mode::FullSpeed;
    let accel_fwd = fl.accel_fwd * if boosting { BOOST_ACCEL_MULT } else { 1.0 };
    let top_speed = fl.max_speed * if boosting { BOOST_SPEED_MULT } else { 1.0 };

    let dv = if boosting {
        b.quat.forward().scale(accel_fwd * dt) // straight burn, no seeking
    } else {
        desired_velocity(b.pos, target, seconds_left, fl, mode).sub(b.vel)
    };

    // Point the hull. MoveAndTurn aims the nose where thrust is needed, the most
    // manoeuvrable thing a ship can do. TurnSlide holds a commanded heading
    // instead, leaving course changes to the RCS: a far smaller envelope, bought
    // in exchange for keeping the guns on a bearing.
    let aim_dir = if mode == Mode::TurnSlide {
        face_dir
    } else if boosting {
        if b.vel.len() > 1e-6 { b.vel.norm() } else { b.quat.forward() }
    } else if dv.len() > 1e-6 {
        dv.norm()
    } else {
        b.quat.forward()
    };
    let quat = rotate_toward(b.quat, aim_dir, fl, dt);

    // Spend thrust in the ship's own frame, one budget per axis.
    let local = quat.inv().rot(dv);
    let z_cap = if local.z >= 0.0 { accel_fwd * dt } else { fl.accel_retro * dt };
    let lat_cap = fl.accel_lat * dt;
    let applied = V3::new(
        local.x.clamp(-lat_cap, lat_cap),
        local.y.clamp(-lat_cap, lat_cap),
        local.z.clamp(-z_cap, z_cap),
    );
    let vel = b.vel.add(quat.rot(applied)).clamp_len(top_speed);
    Body { pos: b.pos.add(vel.scale(dt)), vel, quat }
}

/// Fly a whole turn and record every slice.
///
/// `steps` is how many slices the turn is cut into. Resolution uses one per
/// tick (600). A reachability probe may ask for fewer: the controller is
/// smooth, so 60 slices land within about 0.75 units of the executed flight on
/// a 44 unit reach, which is close enough to draw with and ten times cheaper.
pub fn fly_turn(
    body: Body,
    target: Option<V3>,
    mode: Mode,
    fl: &Flight,
    face: Option<V3>,
    steps: u32,
) -> Flown {
    let steps = steps.max(1);
    fly_span(body, target, mode, fl, face, steps, TURN_SECONDS / steps as f32)
}

/// Fly `steps` slices of `dt` seconds each, from wherever the body is now.
///
/// `fly_turn` is this with the slices spread evenly across a whole turn.
/// Resolution needs the other case: after a collision a ship re-flies only the
/// REMAINDER of its turn, and those slices are still one tick each. Deriving
/// dt from the step count there would silently stretch the last slices to fill
/// ten seconds again, so the two callers differ in dt and in nothing else.
pub fn fly_span(
    body: Body,
    target: Option<V3>,
    mode: Mode,
    fl: &Flight,
    face: Option<V3>,
    steps: u32,
    dt: f32,
) -> Flown {
    let steps = steps.max(1);
    let mut b = body;

    // A slide with no commanded heading holds the one the ship already has:
    // that is what decoupling the nose from the course means.
    let face_dir = match face {
        Some(f) if f.len() > 1e-6 => f.norm(),
        _ => b.quat.forward(),
    };
    // No order means hold course: coast on the velocity already carried.
    let target = target.unwrap_or_else(|| b.pos.add(b.vel.scale(TURN_SECONDS)));

    let dead = mode == Mode::Drift;
    let mut path = Vec::with_capacity(steps as usize + 1);
    path.push((b.pos, b.quat));
    for i in 0..steps {
        if dead {
            b.pos = b.pos.add(b.vel.scale(dt));
        } else {
            let seconds_left = (steps - i) as f32 * dt;
            b = step_flight(b, target, seconds_left, fl, mode, face_dir, dt);
        }
        path.push((b.pos, b.quat));
    }
    Flown { end_pos: b.pos, end_vel: b.vel, end_quat: b.quat, path }
}

/// Can this ship finish the turn within `eps` of the point? The reachability
/// oracle the planner draws its envelope from: no assumed shape, just the
/// integrator asked a yes or no question.
pub fn can_reach(
    body: Body,
    target: V3,
    mode: Mode,
    fl: &Flight,
    face: Option<V3>,
    eps: f32,
    steps: u32,
) -> bool {
    let t = if mode.committed() { None } else { Some(target) };
    fly_turn(body, t, mode, fl, face, steps).end_pos.dist(target) <= eps
}

/// Angle between two directions, in degrees. Used to report how much of a
/// commanded heading the hull could not deliver.
pub fn angle_between_deg(a: V3, b: V3) -> f32 {
    dacos(a.dot(b).clamp(-1.0, 1.0)) * 180.0 / crate::math::PI
}
