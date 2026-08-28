// Scenarios for the envelope, run against the core through its real wasm
// boundary rather than through a copy of the maths in JavaScript.
//
// Every number below comes from ft_reach_octree, ft_reach_radii and the
// gravity field the resolver itself flies, so a scenario that looks wrong here
// is wrong in the game too.
//
//   node prototype/tools/scenarios.mjs            every scenario
//   node prototype/tools/scenarios.mjs orbit      just the ones matching
import { readFileSync } from 'node:fs';

const WASM = new URL('../../web/public/sim_core.wasm', import.meta.url);
const { instance } = await WebAssembly.instantiate(readFileSync(WASM), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc = () => (S.buffer !== ex.memory.buffer
  ? (S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len())) : S);
const oct = () => new Uint32Array(ex.memory.buffer, ex.ft_octree_ptr(), ex.ft_octree_len());

const IN_POS=0, IN_VEL=3, IN_QUAT=6, IN_TARGET=10, IN_FACE=13,
      IN_HAS_TARGET=16, IN_HAS_FACE=17, IN_FLIGHT=18, OUT=32;
const FRIGATE = [6.0, 4.0, 0.9, 0.35, 0.25, 8.0];   // Terran Frigate, data.rs
const EPS = 1.6, STEPS = 60;
const MODES = { MoveAndTurn: 0, TurnSlide: 1, FullSpeed: 2, FullStop: 3, Drift: 4 };

function setBody({ pos=[0,0,0], vel=[0,0,0], yawDeg=0, flight=FRIGATE, face=null }) {
  const s = sc(), a = yawDeg*Math.PI/180, h = a/2;
  s[IN_POS]=pos[0]; s[IN_POS+1]=pos[1]; s[IN_POS+2]=pos[2];
  s[IN_VEL]=vel[0]; s[IN_VEL+1]=vel[1]; s[IN_VEL+2]=vel[2];
  s[IN_QUAT]=0; s[IN_QUAT+1]=Math.sin(h); s[IN_QUAT+2]=0; s[IN_QUAT+3]=Math.cos(h);
  s[IN_HAS_FACE]= face?1:0;
  if (face) { s[IN_FACE]=face[0]; s[IN_FACE+1]=face[1]; s[IN_FACE+2]=face[2]; }
  for (let i=0;i<6;i++) s[IN_FLIGHT+i]=flight[i];
}
function coastLanding(mode) {          // fly_turn with no order: the anchor
  const s = sc(); s[IN_HAS_TARGET]=0;
  ex.ft_fly_turn(mode, STEPS, STEPS); const t = sc();
  return [t[OUT], t[OUT+1], t[OUT+2]];
}
function setField(wells) {
  ex.ft_wells_clear();
  for (const w of wells) ex.ft_well_add(w.pos[0], w.pos[1], w.pos[2], w.mu, w.soft);
}
function gravityAt(p) {
  ex.ft_gravity_at(p[0], p[1], p[2]); const t = sc();
  return [t[OUT], t[OUT+1], t[OUT+2]];
}
const len = a => Math.hypot(a[0],a[1],a[2]);

// ------------------------------------------------------------- the scenarios
const SCENARIOS = [
  { name: 'at rest',
    note: 'nothing carried, nothing pulling. The reference every other row moves away from.',
    body: {}, mode: 'MoveAndTurn', wells: [] },

  { name: 'under way',
    note: 'four along the nose. Fore falls 46.7 to 33.1 because the anchor has already moved 40 ahead: what shrinks is how much FURTHER than a coast the ship can get. Aft holds at 19.5 in every row without gravity, since getting behind your own coast point is a retro question and carried speed does not enter it.',
    body: { vel: [0,0,4] }, mode: 'MoveAndTurn', wells: [] },

  { name: 'flank speed',
    note: 'eight. Fore is 1.6, which is one eps: at top speed the ship cannot finish ANY further ahead than a plain coast would take it. Up and down fall to 10.7 as well, because the speed clamp is already spent.',
    body: { vel: [0,0,8] }, mode: 'MoveAndTurn', wells: [] },

  { name: 'turn and slide',
    note: 'the nose is pinned to +X, so the main drive should stop helping along the course. It barely does: 33.2 against 33.1. Ninety degrees at six a second is fifteen seconds and a turn is ten, so the hull only gets two thirds of the way round and the drive still has most of its +Z component. The mode matters over several turns, not within one.',
    body: { vel: [0,0,4], face: [1,0,0] }, mode: 'TurnSlide', wells: [] },

  { name: 'pitch x3',
    note: 'pitch rate 4 to 12. Up and down move 14.3 to 14.5, about 1%, and nothing else moves at all. The ship does pitch and the set is genuinely three dimensional, but pitch RATE is not what limits going up.',
    body: { flight: [6.0, 12.0, 0.9, 0.35, 0.25, 8.0] }, mode: 'MoveAndTurn', wells: [] },

  { name: 'rcs x5',
    note: 'lateral accel 0.25 to 1.25, pitch left alone. Off axis reach goes 14.4 to 57.1, four times, while fore does not move at all. Within one turn the hull cannot swing far enough for the main drive to help sideways, so the RCS is doing that work and the RCS is the number to tune.',
    body: { flight: [6.0, 4.0, 0.9, 0.35, 1.25, 8.0] }, mode: 'MoveAndTurn', wells: [] },

  { name: 'low orbit',
    note: 'a heavy body 300 below, pulling at a quarter of the main drive. Downhill 25.1 against uphill 3.9, a factor of 6.4 out of identical stats. This is the row that shows a field is a real constraint and not decoration.',
    body: {}, mode: 'MoveAndTurn',
    wells: [{ pos: [0,-300,0], mu: 20000, soft: 20 }] },

  { name: 'close pass',
    note: 'under way with a well off the port bow. Port 21.2 against starboard 6.1. Tuned down to 0.15 u/s^2 after the first attempt at 1.03 beat the 0.9 drive outright and emptied the reachable set entirely, which is a real state the client will have to draw and a useless scenario.',
    body: { vel: [0,0,6] }, mode: 'MoveAndTurn',
    wells: [{ pos: [-90,0,60], mu: 1750, soft: 15 }] },

  { name: 'between two',
    note: 'a binary, one either side. The pulls cancel exactly at the ship, so the field there reads zero, and the envelope is deformed anyway: port and starboard stretch to 16.0 while up and down squeeze to 13.6. A single number at the hull cannot tell you what a field is doing.',
    body: {}, mode: 'MoveAndTurn',
    wells: [{ pos: [-160,0,0], mu: 16000, soft: 20 },
            { pos: [ 160,0,0], mu: 16000, soft: 20 }] },

  { name: 'falling in',
    note: 'engines dead over a well. Drift is a committed mode, so its reachable set is a ball of one eps around wherever the fall lands: the interesting number here is the anchor, not the radius.',
    body: { vel: [0,0,2] }, mode: 'Drift',
    wells: [{ pos: [0,-120,0], mu: 9000, soft: 12 }] },
];

// ------------------------------------------------------------------ measures
function envelope(mode) {
  const anchor = coastLanding(mode);
  // radius field: the boundary along 24 x 13 rays, bisected 14 times each
  const NU = 24, NV = 13;
  const n = ex.ft_reach_radii(mode, EPS, STEPS, NU, NV, 14, anchor[0], anchor[1], anchor[2], 200);
  const s = sc();
  const r = [];
  for (let i=0;i<n;i++) r.push(s[64+i]);
  // phi 0 is +Y and phi pi is -Y; at the equator theta walks the XZ plane,
  // and the direction the core builds is (sin ph cos th, cos ph, sin ph sin th),
  // so theta 0 is +X and a quarter turn on is +Z.
  const eq = (NV-1)>>1;
  const at = (u,v) => s[64 + ((u % NU) + NU) % NU * NV + v];
  const up = r[0], down = r[NV-1];
  const stbd = at(0, eq), port = at(NU>>1, eq);
  const fore = at(NU>>2, eq), aft = at((3*NU)>>2, eq);
  const min = Math.min(...r), max = Math.max(...r);
  const mean = r.reduce((a,b)=>a+b,0)/r.length;
  return { anchor, min, max, mean, up, down, port, stbd, fore, aft, rays: n };
}
function octreeLeaves(mode, anchor, half) {
  const s = sc();
  const fwd = [s[IN_VEL], s[IN_VEL+1], s[IN_VEL+2]];
  const f = len(fwd) > 1e-4 ? fwd : [0,0,1];
  return ex.ft_reach_octree(mode, EPS, STEPS, 4, 16,
    anchor[0], anchor[1], anchor[2], f[0], f[1], f[2], half, half, half);
}

const filter = process.argv[2];
console.log('Envelope scenarios, measured through the real wasm boundary.\n');
console.log('reach is the boundary radius from the coast landing, in units.\n');
console.log('scenario         mode           fore    aft   port   stbd     up   down   leaves   field at ship');
console.log('-'.repeat(102));
for (const sc0 of SCENARIOS) {
  if (filter && !sc0.name.includes(filter)) continue;
  const mode = MODES[sc0.mode];
  setField(sc0.wells);
  setBody(sc0.body);
  const e = envelope(mode);
  setBody(sc0.body);
  const half = Math.max(30, e.max * 1.25);
  const leaves = octreeLeaves(mode, e.anchor, half);
  const g = gravityAt(sc0.body.pos || [0,0,0]);
  console.log(
    `${sc0.name.padEnd(16)} ${sc0.mode.padEnd(12)} `
    + `${e.fore.toFixed(1).padStart(6)} ${e.aft.toFixed(1).padStart(6)} `
    + `${e.port.toFixed(1).padStart(6)} ${e.stbd.toFixed(1).padStart(6)} `
    + `${e.up.toFixed(1).padStart(6)} ${e.down.toFixed(1).padStart(6)} `
    + `${String(leaves).padStart(8)}   ${len(g).toFixed(4)} u/s^2`);
}
console.log('');
for (const sc0 of SCENARIOS) {
  if (filter && !sc0.name.includes(filter)) continue;
  console.log(`  ${sc0.name}: ${sc0.note}`);
}
ex.ft_wells_clear();
