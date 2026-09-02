// A mount's facing, checked against the cells it actually produces.
//
// Three axes of 90 degree steps is two descriptions of one rotation: the
// integer permutation `rotatedVoxels` applies to the cells, and the basis
// `faceBasis` hands the renderer so a barrel can be aimed. If those two ever
// part, a turret's picture and its body stop being the same object: the model
// swings about an axis the cells are not on, and nothing throws.
//
// So the check is not that either one is "right" on its own. It is that the
// basis IS the cell rotation, measured cell by cell over every facing there
// is, on real modules off a real hull.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const bundle = async (entry) => {
  const out = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true, format: 'esm', write: false, target: 'es2022',
    logLevel: 'silent',
  });
  return import('data:text/javascript;base64,'
    + Buffer.from(out.outputFiles[0].text).toString('base64'));
};

const D = await bundle('src/app/design.ts');
const T = await bundle('src/app/turret.ts');
const {
  MODULES, faceBasis, facingOf, facingKey, moduleById, mountFouling, rasterSig,
  rotatedVoxels, socketsOf, frameFor, stockFor, voxelsOf,
} = D;
const { turretGoal, poseMatrix, UPRIGHT } = T;
const THREE = await import('three');

/** Every facing there is: four quarters on each of three axes. */
const ALL = [];
for (let y = 0; y < 4; y++) for (let p = 0; p < 4; p++) for (let r = 0; r < 4; r++)
  ALL.push({ yaw: y, pitch: p, roll: r });

const mul = (f, v) => [
  f[0] * v[0] + f[1] * v[1] + f[2] * v[2],
  f[3] * v[0] + f[4] * v[1] + f[5] * v[2],
  f[6] * v[0] + f[7] * v[1] + f[8] * v[2],
];

test('a facing basis is a rotation, in whole numbers', () => {
  for (const f of ALL) {
    const b = faceBasis(f);
    assert.equal(b.length, 9, facingKey(f));
    for (const n of b) assert.ok(n === 0 || n === 1 || n === -1,
      `${facingKey(f)} has ${n}, and a quarter turn of a cell grid cannot`);
    // Orthonormal columns, and right handed: a reflection would mirror a
    // turret rather than turn it, and every cell would still be in a legal
    // place, so nothing downstream could notice.
    const col = [0, 1, 2].map(c => [b[c], b[c + 3], b[c + 6]]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const dot = col[i][0] * col[j][0] + col[i][1] * col[j][1] + col[i][2] * col[j][2];
      assert.equal(dot, i === j ? 1 : 0, `${facingKey(f)} columns ${i},${j}`);
    }
    const det =
      b[0] * (b[4] * b[8] - b[5] * b[7])
      - b[1] * (b[3] * b[8] - b[5] * b[6])
      + b[2] * (b[3] * b[7] - b[4] * b[6]);
    assert.equal(det, 1, `${facingKey(f)} is a reflection, not a rotation`);
  }
});

test('the basis is the same rotation the CELLS got', () => {
  // Every module with a body worth turning, against all 64 facings. A cell's
  // centre relative to its box centre is what has to map, because the box
  // itself changes shape and its corner is not a fixed point of anything.
  let checked = 0;
  for (const m of MODULES) {
    const src = voxelsOf(m);
    for (const f of ALL) {
      const b = faceBasis(f);
      const got = rotatedVoxels(m, f);
      const cen = (v) => [v.sx / 2, v.sy / 2, v.sz / 2];
      const [ax, ay, az] = cen(src), [bx, by, bz] = cen(got);
      for (let z = 0; z < src.sz; z++)
        for (let y = 0; y < src.sy; y++)
          for (let x = 0; x < src.sx; x++) {
            const v = src.data[x + y * src.sx + z * src.sx * src.sy];
            if (!v) continue;
            const p = mul(b, [x + 0.5 - ax, y + 0.5 - ay, z + 0.5 - az]);
            const i = Math.round(p[0] + bx - 0.5);
            const j = Math.round(p[1] + by - 0.5);
            const k = Math.round(p[2] + bz - 0.5);
            assert.ok(i >= 0 && j >= 0 && k >= 0 && i < got.sx && j < got.sy && k < got.sz,
              `${m.id} ${facingKey(f)}: ${x},${y},${z} left the box`);
            assert.equal(got.data[i + j * got.sx + k * got.sx * got.sy], v,
              `${m.id} ${facingKey(f)}: cell ${x},${y},${z} is not where the basis says`);
            checked++;
          }
    }
  }
  assert.ok(checked > 100000, `only ${checked} cells checked`);
});

test('a pose points the barrel at the target, whatever the facing', () => {
  // The cells come off the raster with the facing already in them, so the
  // question is where the BAKED forward axis ends up. Local +Z is forward, so
  // baked forward is F times Z, and the pose has to take that to the target.
  const dirs = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [-0.3, 0.8, 0.5], [0.6, -0.2, -0.75],
  ];
  const gun = { key: 't', arcH: [-180, 180], arcV: [-180, 180], dmg: 1, range: 1, pen: 1 };
  for (const f of ALL) {
    const b = faceBasis(f);
    for (const d of dirs) {
      const g = turretGoal({ x: d[0], y: d[1], z: d[2] }, b, gun);
      assert.ok(g.bears);
      // F * Ry(yaw) * Rx(pitch) applied to local forward, worked out here in
      // plain arithmetic rather than borrowed from the code under test.
      const sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
      const sp = Math.sin(g.pitch), cp = Math.cos(g.pitch);
      const local = [sy * cp, -sp, cy * cp];
      const world = mul(b, local);
      const len = Math.hypot(d[0], d[1], d[2]);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(world[i] - d[i] / len) < 1e-6,
          `${facingKey(f)} toward ${d}: barrel at ${world}`);
      }
    }
  }
});

test('the pose matrix moves the BAKED cells onto the target', () => {
  // The check above proves the angles agree with the basis. This one proves
  // the matrix handed to the renderer does, which is a different claim: a
  // three.js matrix is set row major and a basis is easy to feed in the other
  // way round, and a transposed rotation is still a rotation, so nothing
  // throws and every turret simply points somewhere else.
  const gun = { key: 't', arcH: [-180, 180], arcV: [-180, 180], dmg: 1, range: 1, pen: 1 };
  const out = new THREE.Matrix4();
  for (const f of ALL) {
    const b = faceBasis(f);
    // Local forward is +Z, so the cells come off the raster pointing along
    // F times Z. That is what the pose has to swing.
    const baked = new THREE.Vector3(...mul(b, [0, 0, 1]));
    for (const d of [[1, 0, 0], [0, 1, 0], [-0.3, 0.8, 0.5], [0.6, -0.2, -0.75]]) {
      const g = turretGoal({ x: d[0], y: d[1], z: d[2] }, b, gun);
      const got = baked.clone().applyMatrix4(poseMatrix(out, b, g.yaw, g.pitch));
      const want = new THREE.Vector3(...d).normalize();
      assert.ok(got.distanceTo(want) < 1e-6,
        `${facingKey(f)} toward ${d}: barrel at ${got.toArray()}`);
    }
  }
});

test('an upright mount is the plain ship frame it always was', () => {
  // The old code took yaw from atan2(x, z) of the ship frame direction and
  // pitch from the elevation off horizontal. An unturned mount must still get
  // exactly that, or every existing hull moves.
  const gun = { key: 't', arcH: [-180, 180], arcV: [-180, 180], dmg: 1, range: 1, pen: 1 };
  for (const d of [[1, 0, 0], [0.3, 0.4, -0.9], [-0.7, -0.1, 0.2]]) {
    const g = turretGoal({ x: d[0], y: d[1], z: d[2] }, UPRIGHT, gun);
    assert.ok(Math.abs(g.yaw - Math.atan2(d[0], d[2])) < 1e-9);
    assert.ok(Math.abs(g.pitch + Math.atan2(d[1], Math.hypot(d[0], d[2]))) < 1e-9);
  }
  assert.deepEqual([...faceBasis({ yaw: 0, pitch: 0, roll: 0 })], [...UPRIGHT]);
});

test('an arc gate does not care which way a mount was bolted on', () => {
  // What a gun may shoot at is the hull's business: the authored arc and the
  // mask scanned off the hull are both in the ship's frame. Turning the mount
  // moves the picture, never the permission, or a player would widen a limited
  // arc by rolling the turret over.
  const gun = { key: 't', arcH: [-45, 45], arcV: [-30, 30], dmg: 1, range: 1, pen: 1 };
  const astern = { x: 0, y: 0, z: -1 };
  const ahead = { x: 0, y: 0, z: 1 };
  for (const f of ALL) {
    const b = faceBasis(f);
    assert.equal(turretGoal(astern, b, gun).bears, false, facingKey(f));
    assert.equal(turretGoal(ahead, b, gun).bears, true, facingKey(f));
  }
});

test('the raster cache key knows about all three axes', () => {
  // rasterSig used to carry the yaw alone, which is a cache that hands back a
  // hull built at a facing the design no longer has.
  const d = stockFor('terran_frigate');
  const one = d.parts[0];
  const sigs = new Set();
  for (const f of ALL) {
    sigs.add(rasterSig({
      ...d,
      parts: d.parts.map(p => p === one
        ? { ...p, rot: f.yaw, pitch: f.pitch, roll: f.roll } : p),
    }));
  }
  assert.equal(sigs.size, ALL.length, 'two facings share a cache key');
});

test('facingOf wraps, so a quarter past three is upright', () => {
  assert.deepEqual(facingOf({ rot: 4, pitch: -1, roll: 7 }), { yaw: 0, pitch: 3, roll: 3 });
  assert.deepEqual(facingOf({}), { yaw: 0, pitch: 0, roll: 0 });
});

test('a rotation is refused only when the base lifts off or the body fouls', () => {
  // The rule, on a real hull rather than on a shape invented for the test.
  // The Rogue corvette is the one to ask: least hull in the game with a third
  // of its mass in boarding gear, so it is where a part actually runs out of
  // room, and both halves of the rule fire on it.
  const d = stockFor('rogue_corvette');
  let took = 0, hit = 0, off = 0;
  for (const p of d.parts) {
    for (const f of ALL) {
      const parts = d.parts.map(q => q.socket === p.socket
        ? { ...q, rot: f.yaw, pitch: f.pitch, roll: f.roll } : q);
      const why = mountFouling(d, parts, p.socket);
      if (!why) { took++; continue; }
      if (/stand in/.test(why)) hit++;
      else if (/leave the ship frame|be buried/.test(why)) off++;
      else assert.fail(`${p.socket} ${facingKey(f)}: refused with "${why}"`);
    }
  }
  // Both halves have to be reachable. All refused would be a gate welded shut
  // and all accepted a gate that is not there, and a check that counts only
  // one of them passes either way.
  assert.ok(took > 0, 'every rotation of every part was refused');
  assert.ok(hit > 0, 'no rotation ever fouled anything');
  assert.ok(off > 0, 'no rotation ever lifted a base off the ship');
  console.log(`  rogue corvette: ${took} facings taken, ${hit} fouled, ${off} adrift`);
});

test('a hull with room takes every facing', () => {
  // The other side of the same rule. A Terran frigate carries its beams out on
  // the skin with space around them, so nothing about turning one is illegal,
  // and a rule that refused anything here would be one guessing rather than
  // measuring.
  const d = stockFor('terran_frigate');
  const guns = d.parts.filter(p => moduleById(p.module)?.weapon);
  assert.ok(guns.length > 0);
  for (const g of guns) {
    for (const f of ALL) {
      const parts = d.parts.map(p => p.socket === g.socket
        ? { ...p, rot: f.yaw, pitch: f.pitch, roll: f.roll } : p);
      assert.equal(mountFouling(d, parts, g.socket), '',
        `${g.socket} ${facingKey(f)} was refused on a hull with room for it`);
    }
  }
});

test('the upright facing is always legal, on every stock hull', () => {
  // A hull as authored must not be refused by the rule that guards turning it:
  // that would mean the shipyard opens on a design it will not let you save.
  for (const key of ['terran_frigate', 'karisen_frigate', 'rogue_cruiser',
    'benefactor_destroyer', 'civil_freighter']) {
    const d = stockFor(key);
    for (const p of d.parts) {
      const why = mountFouling(d, d.parts, p.socket);
      assert.equal(why, '', `${key} ${p.socket}: ${why}`);
    }
    assert.ok(socketsOf(frameFor(key), d.parts).length > 0);
  }
});
