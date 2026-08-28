// Finding the reachable boundary without paying for the volume.
//
// The dense probe the client ships samples every cell in a box, so its cost is
// the CUBE of the resolution while what it wants is a SURFACE. Almost every
// probe is spent deep inside the set (always yes) or far outside it (always
// no), and neither tells you anything.
//
// Three ways to skip that bulk, measured against a dense ground truth on the
// real wasm:
//   octree     subdivide only cells whose corners disagree. Uniform interior
//              and uniform exterior stop early, so cost tracks area not volume.
//   seeded     the same, plus forced subdivision of any cell holding a landing
//              point, because a feature thinner than a coarse cell has eight
//              agreeing corners and is otherwise invisible.
//   follow     find one straddling cell and flood fill along the surface,
//              never descending from the root at all.
//
// A landing point is fly_turn(target=t).end_pos, which for an unreachable t is
// a point ON the boundary: can_reach is |L(t) - t| <= eps, so L projects.
import { readFileSync } from 'node:fs';

const WASM = new URL('../../web/public/sim_core.wasm', import.meta.url);
const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc = () => (S.buffer !== ex.memory.buffer
  ? (S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len())) : S);
const IN_POS=0, IN_VEL=3, IN_QUAT=6, IN_TARGET=10, IN_HAS_TARGET=16, IN_HAS_FACE=17,
      IN_FLIGHT=18, OUT_POS=32;
const FLIGHT=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60;

let probes = 0;
function setBody(speed) { const s = sc();
  s[IN_POS]=0; s[IN_POS+1]=0; s[IN_POS+2]=0;
  s[IN_QUAT]=0; s[IN_QUAT+1]=0; s[IN_QUAT+2]=0; s[IN_QUAT+3]=1;
  s[IN_VEL]=0; s[IN_VEL+1]=0; s[IN_VEL+2]=speed;
  s[IN_HAS_FACE]=0; for (let i=0;i<6;i++) s[IN_FLIGHT+i]=FLIGHT[i]; }
function reach(mode, p) { const s = sc(); probes++;
  s[IN_HAS_TARGET]=1; s[IN_TARGET]=p[0]; s[IN_TARGET+1]=p[1]; s[IN_TARGET+2]=p[2];
  return ex.ft_can_reach(mode, EPS, STEPS) !== 0 ? 1 : 0; }
function land(mode, p) { const s = sc(); probes++;
  s[IN_HAS_TARGET]=1; s[IN_TARGET]=p[0]; s[IN_TARGET+1]=p[1]; s[IN_TARGET+2]=p[2];
  ex.ft_fly_turn(mode, STEPS, STEPS); const t = sc();
  return [t[OUT_POS], t[OUT_POS+1], t[OUT_POS+2]]; }
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
function dirs(n) { const o=[]; for (let i=0;i<n;i++) { const y=1-(2*i+1)/n;
  const r=Math.sqrt(Math.max(0,1-y*y)), th=Math.PI*(1+Math.sqrt(5))*i;
  o.push([Math.cos(th)*r, y, Math.sin(th)*r]); } return o; }
// three flights, because L is idempotent only after iterating in MoveAndTurn
const project=(mode,p)=>{ for(let i=0;i<3;i++) p=land(mode,p); return p; };

// ---------------------------------------------------------------- the box
function landingCloud(mode, speed, n) {
  const anchor = land(mode, [0,0,speed*10]);          // the coast landing
  return dirs(n).map(d => project(mode, add(anchor, mul(d,180))));
}
function boxOf(pts, pad) {
  const lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9];
  for (const p of pts) for (let a=0;a<3;a++) {
    if (p[a]<lo[a]) lo[a]=p[a]; if (p[a]>hi[a]) hi[a]=p[a]; }
  for (let a=0;a<3;a++) { lo[a]-=pad; hi[a]+=pad; }
  return { lo, hi };
}

// -------------------------------------------------------- sampling helpers
// One shared corner cache in the FINEST index space, so every method pays for
// a corner once no matter which level asked for it.
function makeField(mode, box, R) {
  const { lo, hi } = box;
  const step = [(hi[0]-lo[0])/R, (hi[1]-lo[1])/R, (hi[2]-lo[2])/R];
  const cache = new Map();
  const at = (i,j,k) => {
    const key = (i*(R+1) + j)*(R+1) + k;
    let v = cache.get(key);
    if (v === undefined) {
      v = reach(mode, [lo[0]+i*step[0], lo[1]+j*step[1], lo[2]+k*step[2]]);
      cache.set(key, v);
    }
    return v;
  };
  const pointOf = (i,j,k) => [lo[0]+i*step[0], lo[1]+j*step[1], lo[2]+k*step[2]];
  const cellOf = p => [ Math.floor((p[0]-lo[0])/step[0]),
                        Math.floor((p[1]-lo[1])/step[1]),
                        Math.floor((p[2]-lo[2])/step[2]) ];
  return { at, pointOf, cellOf, step, R, cache };
}
const CORNERS = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
function straddles(f, i, j, k, size) {
  let first = -1;
  for (const [a,b,c] of CORNERS) {
    const v = f.at(i+a*size, j+b*size, k+c*size);
    if (first < 0) first = v; else if (v !== first) return true;
  }
  return false;
}

// ------------------------------------------------------------------ dense
function dense(f) {
  const leaves = [];
  for (let i=0;i<f.R;i++) for (let j=0;j<f.R;j++) for (let k=0;k<f.R;k++)
    if (straddles(f,i,j,k,1)) leaves.push([i,j,k]);
  return leaves;
}

// ----------------------------------------------------------------- octree
// base^3 cells at the root, halving to the finest level. A cell whose eight
// corners agree is not descended into: that is the interior and the exterior
// skipped in one rule.
function octree(f, base, seeds) {
  const leaves = [];
  const forced = new Set();
  if (seeds) for (const p of seeds) {
    const [i,j,k] = f.cellOf(p);
    if (i>=0 && j>=0 && k>=0 && i<f.R && j<f.R && k<f.R)
      forced.add((i*f.R + j)*f.R + k);
  }
  const holdsSeed = (i,j,k,size) => {
    if (!forced.size) return false;
    for (const key of forced) {
      const kk = key % f.R, jj = ((key - kk)/f.R) % f.R, ii = (key - kk - jj*f.R)/(f.R*f.R);
      if (ii>=i && ii<i+size && jj>=j && jj<j+size && kk>=k && kk<k+size) return true;
    }
    return false;
  };
  const rec = (i,j,k,size) => {
    if (size === 1) { if (straddles(f,i,j,k,1)) leaves.push([i,j,k]); return; }
    if (!straddles(f,i,j,k,size) && !holdsSeed(i,j,k,size)) return;
    const h = size/2;
    for (const [a,b,c] of CORNERS) rec(i+a*h, j+b*h, k+c*h, h);
  };
  const rootSize = f.R / base;
  for (let i=0;i<base;i++) for (let j=0;j<base;j++) for (let k=0;k<base;k++)
    rec(i*rootSize, j*rootSize, k*rootSize, rootSize);
  return leaves;
}

// -------------------------------------------------------- surface follower
// Never descends from a root. Seed on the boundary, then walk the surface.
function follow(f, seeds) {
  const seen = new Set(), leaves = [], queue = [];
  const key = (i,j,k) => (i*f.R + j)*f.R + k;
  const push = (i,j,k) => {
    if (i<0||j<0||k<0||i>=f.R||j>=f.R||k>=f.R) return;
    const q = key(i,j,k); if (seen.has(q)) return; seen.add(q); queue.push([i,j,k]);
  };
  for (const p of seeds) { const [i,j,k] = f.cellOf(p);
    // a landing point sits within about eps of the edge, so look around it
    for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) for (let c=-1;c<=1;c++)
      push(i+a, j+b, k+c); }
  while (queue.length) {
    const [i,j,k] = queue.pop();
    if (!straddles(f,i,j,k,1)) continue;
    leaves.push([i,j,k]);
    for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) for (let c=-1;c<=1;c++)
      if (a||b||c) push(i+a, j+b, k+c);
  }
  return leaves;
}

// ---------------------------------------------------------------- scoring
function score(truth, got, R) {
  const set = new Set(got.map(([i,j,k]) => (i*R + j)*R + k));
  let found = 0;
  for (const [i,j,k] of truth) if (set.has((i*R + j)*R + k)) found++;
  return { found, total: truth.length, extra: got.length - found };
}

// ------------------------------------------------------------------- main
const MODE = 0;
const speedArg = process.argv.includes('--speed')
  ? Number(process.argv[process.argv.indexOf('--speed')+1]) : 4;

console.log(`MoveAndTurn, speed ${speedArg}, eps ${EPS}, ${STEPS} steps a flight.`);
console.log('A probe is one 60 step flight, about 6.5 microseconds on this wasm.\n');

setBody(speedArg);
probes = 0;
const cloud = landingCloud(MODE, speedArg, 300);
const cloudProbes = probes;
const box = boxOf(cloud, 4);
const span = [box.hi[0]-box.lo[0], box.hi[1]-box.lo[1], box.hi[2]-box.lo[2]];
console.log(`box ${span.map(v=>v.toFixed(0)).join(' x ')} u, fitted from `
  + `${cloud.length} landing points (${cloudProbes} probes, `
  + `${(cloudProbes*0.0065).toFixed(1)} ms)\n`);

const R_TRUTH = Number(process.env.R_TRUTH || 64);
setBody(speedArg);
let f = makeField(MODE, box, R_TRUTH);
probes = 0; let t0 = performance.now();
const truth = dense(f);
const truthProbes = probes, truthMs = performance.now() - t0;
console.log(`ground truth: dense at ${R_TRUTH}^3, cell `
  + `${(span[0]/R_TRUTH).toFixed(2)} u, ${truth.length} boundary cells, `
  + `${truthProbes} probes, ${truthMs.toFixed(0)} ms\n`);

console.log('method          cell     probes     ms    surface found   spurious');
console.log('-'.repeat(70));
const row = (name, cell, p, ms, s) =>
  console.log(`${name.padEnd(14)} ${cell.toFixed(2)} u ${String(p).padStart(9)} `
    + `${ms.toFixed(0).padStart(6)}   ${String(s.found).padStart(5)}/${s.total} `
    + `(${(100*s.found/s.total).toFixed(1)}%) ${String(s.extra).padStart(7)}`);

row('dense', span[0]/R_TRUTH, truthProbes, truthMs, { found: truth.length, total: truth.length, extra: 0 });

for (const base of [4, 8, 16]) {
  setBody(speedArg); f = makeField(MODE, box, R_TRUTH);
  probes = 0; t0 = performance.now();
  const got = octree(f, base, null);
  row(`octree base ${base}`, span[0]/R_TRUTH, probes, performance.now()-t0, score(truth, got, R_TRUTH));
}
for (const base of [4, 8]) {
  setBody(speedArg); f = makeField(MODE, box, R_TRUTH);
  probes = 0; t0 = performance.now();
  const got = octree(f, base, cloud);
  row(`seeded base ${base}`, span[0]/R_TRUTH, probes, performance.now()-t0, score(truth, got, R_TRUTH));
}
{
  setBody(speedArg); f = makeField(MODE, box, R_TRUTH);
  probes = 0; t0 = performance.now();
  const got = follow(f, cloud);
  row('follow', span[0]/R_TRUTH, probes, performance.now()-t0, score(truth, got, R_TRUTH));
}

// --------------------------------------------------------------- scaling
// The point of skipping the bulk is that cost should track the SURFACE, so it
// should grow as the square of the resolution where dense grows as the cube.
if (process.argv.includes('--scan')) {
  console.log('\nscaling. dense is (R+1)^3 probes by construction, so it is');
  console.log('quoted rather than run past 64.\n');
  console.log('  R    cell      dense    octree   follow   octree ms  follow ms');
  console.log('  ' + '-'.repeat(64));
  for (const R of [16, 32, 64, 128, 256]) {
    setBody(speedArg); let g = makeField(MODE, box, R);
    probes = 0; let t = performance.now();
    octree(g, Math.min(8, R), null);
    const op = probes, oms = performance.now() - t;
    setBody(speedArg); g = makeField(MODE, box, R);
    probes = 0; t = performance.now();
    follow(g, cloud);
    const fp = probes, fms = performance.now() - t;
    console.log(`  ${String(R).padStart(3)}  ${(span[0]/R).toFixed(2)} u `
      + `${String(Math.pow(R+1,3)).padStart(10)} ${String(op).padStart(9)} `
      + `${String(fp).padStart(8)} ${oms.toFixed(0).padStart(10)} ${fms.toFixed(0).padStart(10)}`);
  }
}

// ------------------------------------------------------ probe fidelity
// A probe integrates the turn in `steps` slices. The client uses 60, which is
// already ten times coarser than the 600 tick resolution path. If a coarser
// flight CLASSIFIES the same, the octree can spend cheap probes at its coarse
// levels and fine ones only at the leaves, which is where the answer is
// actually read.
if (process.argv.includes('--steps')) {
  console.log('\nhow much integration does a yes or no answer need? 60 steps is');
  console.log('the reference. Sampled on a shell around the boundary, which is');
  console.log('the only place the answer is in doubt.\n');
  const probePts = [];
  for (const p of cloud) for (const s of [-3,-1.5,0,1.5,3]) {
    const d = Math.hypot(p[0],p[1],p[2]) || 1;
    probePts.push([p[0]*(1+s/d), p[1]*(1+s/d), p[2]*(1+s/d)]);
  }
  const ref = probePts.map(p => { const s = sc(); s[IN_HAS_TARGET]=1;
    s[IN_TARGET]=p[0]; s[IN_TARGET+1]=p[1]; s[IN_TARGET+2]=p[2];
    return ex.ft_can_reach(MODE, EPS, 60) !== 0; });
  console.log('  steps   agrees with 60   ms per 10k probes');
  console.log('  ' + '-'.repeat(44));
  for (const st of [10, 15, 20, 30, 60]) {
    let same = 0;
    const t = performance.now();
    probePts.forEach((p,i) => { const s = sc(); s[IN_HAS_TARGET]=1;
      s[IN_TARGET]=p[0]; s[IN_TARGET+1]=p[1]; s[IN_TARGET+2]=p[2];
      if ((ex.ft_can_reach(MODE, EPS, st) !== 0) === ref[i]) same++; });
    const ms = (performance.now()-t) * 10000 / probePts.length;
    console.log(`  ${String(st).padStart(5)}   ${(100*same/probePts.length).toFixed(1)}%`
      .padEnd(26) + `   ${ms.toFixed(0)}`);
  }
}

// ------------------------------------------------------------ per level
// Every level of the octree is a COMPLETE answer at its own resolution, so the
// cost per level says whether the envelope can be drawn coarse at once and
// sharpened over the next few frames instead of blocking on the fine one.
if (process.argv.includes('--levels')) {
  console.log('\ncost of each level, and what it costs to arrive there.\n');
  console.log('  level    cell     probes this level   cumulative    ms at 20 steps');
  console.log('  ' + '-'.repeat(70));
  let prev = 0;
  for (let R = 8; R <= 128; R *= 2) {
    setBody(speedArg); const g = makeField(MODE, box, R);
    probes = 0;
    octree(g, Math.min(8, R), null);
    const cum = probes;
    console.log(`  ${String(R).padStart(5)}  ${(span[0]/R).toFixed(2)} u `
      + `${String(cum - prev).padStart(17)} ${String(cum).padStart(12)} `
      + `${(cum * 0.0025).toFixed(1).padStart(15)}`);
    prev = cum;
  }
}

// ------------------------------------------------------------- what it said
//
// MoveAndTurn, speed 4, box 53 x 42 x 60 u, ground truth dense at 64^3.
//
//   method     cell     probes     ms   surface found
//   dense      0.83 u   274625   2173   100.0%
//   octree     0.83 u    47911    349    99.8%
//   follow     0.83 u    60708    454   100.0%
//
// The octree is 5.7 times cheaper than dense at the same cell, and the saving
// DOUBLES with every level because it tracks the surface where dense tracks
// the volume: 1.7x at R=16, 3.0x at 32, 5.7x at 64, 11.1x at 128, 21.8x at 256.
//
// Three results that went against what I expected, kept because they decide
// the design:
//
//   Seeding the octree with landing points changed nothing. 99.8% either way,
//   and it cost 2000 more probes. The cells the octree misses are thin
//   features whose eight corners agree, and they are not where the landing
//   points are, because landing points sit on the parts of the surface that a
//   coarse cell already straddles.
//
//   Surface following is DOMINATED, not cheaper. It finds every cell, but it
//   costs 27% more probes than the octree because it tests the 26 neighbours
//   of every surface cell and most are not on the surface. It is also fragile:
//   at R=256 it collapsed to 16207 cells against the ~1M it should find, since
//   a landing point is only accurate to about eps (1.6 u) and at a 0.21 u cell
//   its neighbourhood no longer touches the surface. The octree needs no seed
//   and cannot fail that way.
//
//   Speed 8 is not a special case. The hull is outside its own reachable set
//   there, so the set has a pocket, and both methods handle it: 99.4% and
//   100%.
//
// What this buys the client, which spends about 2491 probes for a 4.1 u cell:
// every octree level is a complete answer, so the envelope can be drawn coarse
// at once and sharpened over the following frames.
//
//   level  cell    probes at that level   ms at 20 steps
//       8  6.61 u                   708              1.8
//      16  3.30 u                  2205              5.5
//      32  1.65 u                  9185             23.0
//      64  0.83 u                 35813             89.5
//     128  0.41 u                145144            363.1
//
// Reaching 3.30 u costs 7.3 ms all in, against 16.2 ms for today's coarser
// 4.1 u, and no single frame has to spend more than a few ms to keep going.
//
// The 20 steps in that column is the other half. A probe integrates the turn
// in `steps` slices and the client uses 60. Sampled on a shell around the
// boundary, which is the only place the answer is ever in doubt, a coarser
// flight mostly agrees: 30 steps 98.2% at 1.9 times cheaper, 20 steps 96.8% at
// 2.6 times, 10 steps 90.5% at 4.1 times. The envelope is a drawing, and the
// order it previews is resolved at 600 ticks either way, so spending 20 or 30
// there is a drawing decision rather than a rule.
