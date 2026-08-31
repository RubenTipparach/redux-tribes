//! Deterministic maths.
//!
//! Why this module exists: `f32::sin` and friends lower to platform intrinsics,
//! and two machines can disagree in the last bits. Basic arithmetic (+ - * /
//! sqrt) is IEEE-754 and portable; transcendentals are not. Lockstep (ADR-6)
//! needs bit-identical results on every client, so every transcendental the sim
//! touches lives here as a fixed polynomial, matching the JS prototype's
//! `dmath.js` term for term so the two implementations agree numerically.

pub const PI: f32 = std::f32::consts::PI;
const TWO_PI: f32 = 2.0 * PI;
const HALF_PI: f32 = PI / 2.0;

/// Wrap to [-PI, PI] with arithmetic and floor only.
pub fn wrap_pi(x: f32) -> f32 {
    x - TWO_PI * ((x + PI) / TWO_PI).floor()
}

/// sin via a 7th order odd polynomial. Max error about 1e-4, which is far
/// below anything gameplay can see, and identical everywhere.
pub fn dsin(x: f32) -> f32 {
    let mut x = wrap_pi(x);
    if x > HALF_PI {
        x = PI - x;
    } else if x < -HALF_PI {
        x = -PI - x;
    }
    let x2 = x * x;
    x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0))))
}

pub fn dcos(x: f32) -> f32 {
    dsin(x + HALF_PI)
}

fn datan(z: f32) -> f32 {
    let az = z.abs();
    if az <= 1.0 {
        let z2 = z * z;
        return z * (0.995354 + z2 * (-0.288679 + z2 * 0.079331));
    }
    let inv = 1.0 / z;
    let inv2 = inv * inv;
    let core = inv * (0.995354 + inv2 * (-0.288679 + inv2 * 0.079331));
    (if z > 0.0 { HALF_PI } else { -HALF_PI }) - core
}

pub fn datan2(y: f32, x: f32) -> f32 {
    if x > 0.0 {
        return datan(y / x);
    }
    if x < 0.0 {
        return if y >= 0.0 { datan(y / x) + PI } else { datan(y / x) - PI };
    }
    if y > 0.0 {
        HALF_PI
    } else if y < 0.0 {
        -HALF_PI
    } else {
        0.0
    }
}

pub fn dacos(x: f32) -> f32 {
    if x >= 1.0 {
        return 0.0;
    }
    if x <= -1.0 {
        return PI;
    }
    datan2((1.0 - x * x).sqrt(), x)
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl V3 {
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);
    pub fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    pub fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    pub fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn len2(self) -> f32 {
        self.dot(self)
    }
    pub fn len(self) -> f32 {
        self.len2().sqrt()
    }
    pub fn dist(self, o: Self) -> f32 {
        self.sub(o).len()
    }
    pub fn norm(self) -> Self {
        let l = self.len();
        if l > 1e-12 {
            self.scale(1.0 / l)
        } else {
            Self::new(0.0, 0.0, 1.0)
        }
    }
    pub fn lerp(self, o: Self, t: f32) -> Self {
        Self::new(
            self.x + (o.x - self.x) * t,
            self.y + (o.y - self.y) * t,
            self.z + (o.z - self.z) * t,
        )
    }
    /// Clamp magnitude, leaving direction alone.
    pub fn clamp_len(self, max: f32) -> Self {
        let l = self.len();
        if l > max && l > 1e-12 {
            self.scale(max / l)
        } else {
            self
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

impl Default for Quat {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Quat {
    pub const IDENTITY: Self = Self { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };

    pub fn mul(self, b: Self) -> Self {
        Self {
            x: self.w * b.x + self.x * b.w + self.y * b.z - self.z * b.y,
            y: self.w * b.y - self.x * b.z + self.y * b.w + self.z * b.x,
            z: self.w * b.z + self.x * b.y - self.y * b.x + self.z * b.w,
            w: self.w * b.w - self.x * b.x - self.y * b.y - self.z * b.z,
        }
    }
    pub fn norm(self) -> Self {
        let l = (self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w).sqrt();
        Self { x: self.x / l, y: self.y / l, z: self.z / l, w: self.w / l }
    }
    pub fn axis_angle(axis: V3, angle: f32) -> Self {
        let h = angle * 0.5;
        let s = dsin(h);
        Self { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: dcos(h) }.norm()
    }
    pub fn inv(self) -> Self {
        Self { x: -self.x, y: -self.y, z: -self.z, w: self.w }
    }
    pub fn rot(self, v: V3) -> V3 {
        let u = V3::new(self.x, self.y, self.z);
        let uv = u.cross(v);
        let uuv = u.cross(uv);
        v.add(uv.scale(self.w).add(uuv).scale(2.0))
    }
    /// Forward is +Z, matching the archive's Unity convention.
    pub fn forward(self) -> V3 {
        self.rot(V3::new(0.0, 0.0, 1.0))
    }

    /// Look rotation: forward +Z, up +Y. Built from the rotation matrix by the
    /// usual trace split, which is branchy but exact: every branch is
    /// arithmetic and one sqrt, so it is portable.
    pub fn look(forward: V3, up: Option<V3>) -> Self {
        let f = forward.norm();
        let up = up.unwrap_or(V3::new(0.0, 1.0, 0.0));
        let mut r = up.cross(f);
        // forward parallel to up leaves no right vector to speak of; pick any
        // axis not parallel to f so the frame stays well defined.
        if r.len2() < 1e-10 {
            r = V3::new(1.0, 0.0, 0.0).cross(f);
        }
        let r = r.norm();
        let u = f.cross(r);
        let (m00, m01, m02) = (r.x, u.x, f.x);
        let (m10, m11, m12) = (r.y, u.y, f.y);
        let (m20, m21, m22) = (r.z, u.z, f.z);
        let tr = m00 + m11 + m22;
        let q = if tr > 0.0 {
            let s = (tr + 1.0).sqrt() * 2.0;
            Self { w: s / 4.0, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }
        } else if m00 > m11 && m00 > m22 {
            let s = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
            Self { w: (m21 - m12) / s, x: s / 4.0, y: (m01 + m10) / s, z: (m02 + m20) / s }
        } else if m11 > m22 {
            let s = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
            Self { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4.0, z: (m12 + m21) / s }
        } else {
            let s = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
            Self { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4.0 }
        };
        q.norm()
    }
}

/// Quadratic bezier by nested lerps, which is the construction the archive
/// used. Missile legs still fly these; only ship movement stopped (ADR-14).
pub fn bezier2(a: V3, b: V3, c: V3, t: f32) -> V3 {
    a.lerp(b, t).lerp(b.lerp(c, t), t)
}

/// The resolution of a mount's own arc mask.
///
/// A turret is omnidirectional until its own ship gets in the way, and what
/// gets in the way is geometry rather than a number anybody can author. The
/// mask is that geometry, sampled: 64 steps of yaw by 32 of pitch, which is
/// 5.625 degrees a cell and 2048 bits a mount.
pub const ARC_YAW: usize = 64;
pub const ARC_PITCH: usize = 32;
pub const ARC_WORDS: usize = ARC_YAW * ARC_PITCH / 32;

/// Which bit of an arc mask a direction in the SHIP's frame falls in.
///
/// The same two angles `arc_test_3d` measures, so a direction that passes the
/// authored arc and a direction that passes the mask are the same direction.
pub fn arc_bit(local: V3) -> usize {
    let hyp = (local.x * local.x + local.z * local.z).sqrt();
    let yaw = datan2(local.x, local.z) * (180.0 / PI);          // -180 .. 180
    let pitch = datan2(local.y, hyp) * (180.0 / PI);            // -90 .. 90
    let yi = (((yaw + 180.0) / 360.0 * ARC_YAW as f32) as i32).clamp(0, ARC_YAW as i32 - 1);
    let pi = (((pitch + 90.0) / 180.0 * ARC_PITCH as f32) as i32).clamp(0, ARC_PITCH as i32 - 1);
    pi as usize * ARC_YAW + yi as usize
}

/// Is this direction blocked by the ship's own hull? A set bit means blocked,
/// so a mount with no mask at all is a mount with nothing in its way.
pub fn arc_blocked(mask: &[u32; ARC_WORDS], local: V3) -> bool {
    let bit = arc_bit(local);
    (mask[bit >> 5] >> (bit & 31)) & 1 != 0
}

/// Firing arc gate: is `target` inside the mount's horizontal and vertical
/// arcs? Measured from +Z in the mount's own frame, per axis independently,
/// which is what the archive's dot-product-vs-bisector test amounted to.
pub fn arc_test_3d(
    turret_pos: V3,
    turret_rot: Quat,
    target_pos: V3,
    h_min_deg: f32,
    h_max_deg: f32,
    v_min_deg: f32,
    v_max_deg: f32,
) -> bool {
    let dir = target_pos.sub(turret_pos).norm();
    let local = turret_rot.inv().rot(dir);
    fn axis_pass(a1: f32, a2: f32, u: f32, v: f32) -> bool {
        if (a2 - a1).abs() >= 360.0 {
            return true;
        }
        let ang = datan2(u, v) * (180.0 / PI);
        let lo = if a1 < a2 { a1 } else { a2 };
        let hi = if a1 < a2 { a2 } else { a1 };
        ang >= lo && ang <= hi
    }
    // Yaw is the angle round from forward. Pitch is a true ELEVATION off the
    // horizontal plane, which is why the second argument is the horizontal
    // magnitude and not z.
    //
    // The archive's ArcTest.TargetArcTest3D passed z here. That is not an
    // elevation: as a target comes abeam, z goes to zero and atan2(y, z) runs
    // to 90 degrees however level the target is, so a 60 degree mount refused
    // anything on its own beam. A mount has two axes, yaw and pitch, and roll
    // does not enter it. Deliberate divergence from the archive.
    //
    // `sqrt` is the one transcendental the sim path is allowed: IEEE-754
    // specifies it exactly, so it is bit identical everywhere.
    let hyp = (local.x * local.x + local.z * local.z).sqrt();
    axis_pass(h_min_deg, h_max_deg, local.x, local.z)
        && axis_pass(v_min_deg, v_max_deg, local.y, hyp)
}
