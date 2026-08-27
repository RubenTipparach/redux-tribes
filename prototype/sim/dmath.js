// Deterministic math for the sim.
//
// Why this file exists: JS basic arithmetic (+ - * / sqrt) is IEEE-754 and
// bit-identical across engines, but Math.sin/cos/atan are implementation-
// defined and CAN differ between V8/JSC/SpiderMonkey. The sim must produce
// identical results on every machine (lockstep, ADR-6), so all transcendental
// functions used by sim code live here as fixed polynomial approximations.
// This mirrors the Rust plan's libm discipline (ADR-4).
//
// Accuracy: sin/cos ~1e-4 absolute, atan2 ~1e-3 rad - plenty for gameplay;
// the same approximations run everywhere, which is what matters.
(function (global) {
  "use strict";

  const PI = Math.PI;
  const TWO_PI = 2 * PI;
  const HALF_PI = PI / 2;

  // --- deterministic trig -------------------------------------------------
  function wrapPi(x) {
    // wrap to [-PI, PI] using only arithmetic + floor (deterministic)
    x = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
    return x;
  }

  // sin via odd minimax polynomial on [-PI, PI] (max err ~1e-4)
  function dsin(x) {
    x = wrapPi(x);
    // fold into [-PI/2, PI/2]
    if (x > HALF_PI) x = PI - x;
    else if (x < -HALF_PI) x = -PI - x;
    const x2 = x * x;
    // 7th-order odd polynomial (Taylor with tweaked last coefficient)
    return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040))));
  }

  function dcos(x) { return dsin(x + HALF_PI); }

  // atan on [-1, 1] (max err ~1e-3 rad), extended by identity + quadrants
  function datan(z) {
    const az = Math.abs(z);
    if (az <= 1) {
      const z2 = z * z;
      return z * (0.995354 + z2 * (-0.288679 + z2 * 0.079331));
    }
    const inv = 1 / z;
    const inv2 = inv * inv;
    const core = inv * (0.995354 + inv2 * (-0.288679 + inv2 * 0.079331));
    return (z > 0 ? HALF_PI : -HALF_PI) - core;
  }

  function datan2(y, x) {
    if (x > 0) return datan(y / x);
    if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
    // x === 0
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }

  function dacos(x) {
    if (x >= 1) return 0;
    if (x <= -1) return PI;
    return datan2(Math.sqrt(1 - x * x), x);
  }

  // --- vectors ------------------------------------------------------------
  const V = {
    v3(x, y, z) { return { x, y, z }; },
    clone(a) { return { x: a.x, y: a.y, z: a.z }; },
    add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; },
    dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
    cross(a, b) {
      return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
    },
    len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); },
    len2(a) { return a.x * a.x + a.y * a.y + a.z * a.z; },
    dist(a, b) { return V.len(V.sub(a, b)); },
    norm(a) {
      const l = V.len(a);
      return l > 1e-12 ? V.scale(a, 1 / l) : { x: 0, y: 0, z: 1 };
    },
    lerp(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    },
    zero() { return { x: 0, y: 0, z: 0 }; },
  };

  // Quadratic bezier by nested lerps (the game's exact construction).
  function bezier2(a, b, c, t) {
    return V.lerp(V.lerp(a, b, t), V.lerp(b, c, t), t);
  }

  // --- quaternions --------------------------------------------------------
  const Q = {
    id() { return { x: 0, y: 0, z: 0, w: 1 }; },
    mul(a, b) {
      return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
      };
    },
    norm(q) {
      const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
    },
    axisAngle(axis, angle) {
      const h = angle * 0.5, s = dsin(h);
      return Q.norm({ x: axis.x * s, y: axis.y * s, z: axis.z * s, w: dcos(h) });
    },
    // rotate vector by quaternion
    rot(q, v) {
      const u = { x: q.x, y: q.y, z: q.z };
      const s = q.w;
      const uv = V.cross(u, v);
      const uuv = V.cross(u, uv);
      return V.add(v, V.scale(V.add(V.scale(uv, s), uuv), 2));
    },
    inv(q) { return { x: -q.x, y: -q.y, z: -q.z, w: q.w }; },
    // look rotation: forward +Z, up +Y (Unity convention, matching the archive)
    look(forward, up) {
      const f = V.norm(forward);
      up = up || V.v3(0, 1, 0);
      let r = V.cross(up, f);
      if (V.len2(r) < 1e-10) r = V.cross(V.v3(1, 0, 0), f); // forward ~ up
      r = V.norm(r);
      const u = V.cross(f, r);
      // rotation matrix (r, u, f) columns -> quaternion
      const m00 = r.x, m01 = u.x, m02 = f.x;
      const m10 = r.y, m11 = u.y, m12 = f.y;
      const m20 = r.z, m21 = u.z, m22 = f.z;
      const tr = m00 + m11 + m22;
      let q;
      if (tr > 0) {
        const s = Math.sqrt(tr + 1) * 2;
        q = { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
      } else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        q = { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
      } else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
      } else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
      }
      return Q.norm(q);
    },
    forward(q) { return Q.rot(q, V.v3(0, 0, 1)); },
    upv(q) { return Q.rot(q, V.v3(0, 1, 0)); },
    right(q) { return Q.rot(q, V.v3(1, 0, 0)); },
    // slerp with deterministic trig; nlerp for near-parallel quats
    slerp(a, b, t) {
      let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
      let bb = b;
      if (dot < 0) { dot = -dot; bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; }
      if (dot > 0.9995) {
        return Q.norm({
          x: a.x + (bb.x - a.x) * t, y: a.y + (bb.y - a.y) * t,
          z: a.z + (bb.z - a.z) * t, w: a.w + (bb.w - a.w) * t,
        });
      }
      const theta = dacos(dot);
      const s = dsin(theta);
      const wa = dsin((1 - t) * theta) / s;
      const wb = dsin(t * theta) / s;
      return Q.norm({
        x: a.x * wa + bb.x * wb, y: a.y * wa + bb.y * wb,
        z: a.z * wa + bb.z * wb, w: a.w * wa + bb.w * wb,
      });
    },
  };

  // Firing-arc test, ported from the archive's ArcTest.TargetArcTest3D:
  // project the to-target direction onto the turret's local XZ (yaw) and YZ
  // (pitch) planes; each axis passes if the direction is within the
  // [minDeg, maxDeg] arc (bisector dot-comparison). A span >= 360 always passes.
  function arcTest3D(turretPos, turretRot, targetPos, hMinDeg, hMaxDeg, vMinDeg, vMaxDeg) {
    const dir = V.norm(V.sub(targetPos, turretPos));
    const local = Q.rot(Q.inv(turretRot), dir); // into turret space, forward = +Z
    function axisPass(a1, a2, u, v) {
      // u, v: the 2D components in this plane; arc measured from +Z
      const span = Math.abs(a2 - a1);
      if (span >= 360) return true;
      const ang = datan2(u, v) * (180 / PI); // 0 = forward(+Z)
      // normalize the arc: does ang lie within [min, max] going the short way?
      let lo = Math.min(a1, a2), hi = Math.max(a1, a2);
      return ang >= lo && ang <= hi;
    }
    const yawOk = axisPass(hMinDeg, hMaxDeg, local.x, local.z);
    const pitchOk = axisPass(vMinDeg, vMaxDeg, local.y, local.z);
    return yawOk && pitchOk;
  }

  const api = { PI, TWO_PI, dsin, dcos, datan, datan2, dacos, wrapPi, V, Q, bezier2, arcTest3D };
  global.FT = global.FT || {};
  global.FT.dmath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
