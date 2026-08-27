//! Deterministic seeded RNG: sfc32 seeded through splitmix32, split per
//! stream (ADR-4). One generator per (match seed, turn, stream key), so a
//! replay can seek to any turn without replaying RNG history and one
//! consumer's draws never perturb another's.
//!
//! Everything here is integer arithmetic on u32 with explicit wrapping, which
//! is the same bit sequence JavaScript produces from `| 0`, `>>> 0` and
//! `Math.imul`. That is not a coincidence to preserve casually: the streams
//! are the port's tightest cross check against the prototype.
//!
//! The one place this leaves integers is converting a draw to the unit
//! interval, and it does that in **f64** rather than f32 on purpose. Division
//! by 2^32 is IEEE exact and portable in both widths, so f64 costs no
//! determinism, and it keeps the rejection sampling loops below accepting and
//! rejecting on exactly the same draws as the prototype. In f32 a value near a
//! boundary could be accepted here and rejected there, which does not merely
//! shift one number: it changes how many draws the loop consumes and slides
//! the whole stream out of alignment. Results are narrowed to f32 at the point
//! of use, where ADR-4 wants them.

use crate::math::V3;

fn splitmix32(state: &mut u32) -> u32 {
    *state = state.wrapping_add(0x9e37_79b9);
    let mut t = *state ^ (*state >> 16);
    t = t.wrapping_mul(0x21f0_aaad);
    t ^= t >> 15;
    t = t.wrapping_mul(0x735a_2d97);
    t ^ (t >> 15)
}

/// FNV-1a over the bytes of a key, used to mix seeds and stream keys.
/// The prototype hashes JS UTF-16 code units; every key either side is ASCII,
/// where a code unit and a byte are the same number.
pub fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

pub struct Rng {
    a: u32,
    b: u32,
    c: u32,
    d: u32,
}

impl Rng {
    pub fn new(match_seed: &str, turn: i32, stream_key: &str) -> Self {
        let mut base =
            fnv1a(match_seed) ^ (turn as u32).wrapping_mul(0x9e37_79b1) ^ fnv1a(stream_key);
        let a = splitmix32(&mut base);
        let b = splitmix32(&mut base);
        let c = splitmix32(&mut base);
        let d = splitmix32(&mut base);
        let mut r = Self { a, b, c, d };
        for _ in 0..8 {
            r.next_u32();
        }
        r
    }

    pub fn next_u32(&mut self) -> u32 {
        let t = self.a.wrapping_add(self.b);
        self.a = self.b ^ (self.b >> 9);
        self.b = self.c.wrapping_add(self.c << 3);
        self.c = (self.c << 21) | (self.c >> 11);
        self.d = self.d.wrapping_add(1);
        let out = t.wrapping_add(self.d);
        self.c = self.c.wrapping_add(out);
        out
    }

    /// Uniform in [0, 1).
    pub fn float(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }

    /// Uniform in [lo, hi).
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.float()
    }

    /// Integer in [lo, hi), hi exclusive.
    pub fn int(&mut self, lo: i32, hi: i32) -> i32 {
        let span = (hi - lo).max(1) as u32;
        lo + (self.next_u32() % span) as i32
    }

    /// Roll `n` dice of `sides` and count results at or above `threshold`.
    pub fn roll_dice(&mut self, n: i32, sides: u32, threshold: u32) -> i32 {
        let mut successes = 0;
        for _ in 0..n {
            if 1 + (self.next_u32() % sides) >= threshold {
                successes += 1;
            }
        }
        successes
    }

    /// A direction on the unit sphere: z uniform, azimuth from a rejection
    /// sampled unit disc. No trig, so nothing here can disagree between
    /// platforms the way sin and cos can.
    pub fn on_unit_sphere(&mut self) -> V3 {
        let z = self.range(-1.0, 1.0);
        let (mut x, mut y, mut l);
        loop {
            x = self.range(-1.0, 1.0);
            y = self.range(-1.0, 1.0);
            l = x * x + y * y;
            if l >= 1e-12 && l <= 1.0 {
                break;
            }
        }
        let inv = ((1.0 - z * z) / l).sqrt();
        V3::new((x * inv) as f32, (y * inv) as f32, z as f32)
    }

    /// A point inside the unit sphere, by rejection sampling.
    ///
    /// The textbook form is `dir * cbrt(u)`, and `cbrt` is exactly the kind of
    /// call ADR-4 bans: its precision is implementation defined, so two
    /// clients can disagree in the last bits. Rejection uses only multiply and
    /// compare, which are IEEE exact everywhere. About 52% acceptance, and the
    /// loop is deterministic given the stream.
    pub fn inside_unit_sphere(&mut self) -> V3 {
        loop {
            let x = self.range(-1.0, 1.0);
            let y = self.range(-1.0, 1.0);
            let z = self.range(-1.0, 1.0);
            let l = x * x + y * y + z * z;
            if l <= 1.0 && l >= 1e-12 {
                return V3::new(x as f32, y as f32, z as f32);
            }
        }
    }
}
