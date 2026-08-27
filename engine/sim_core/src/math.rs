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
}
