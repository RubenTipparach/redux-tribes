#!/usr/bin/env node
// How close is this ship to a Dubins car?
//
//   node prototype/tools/dubins-fit.mjs
//
// Can a Dubins model stand in for this ship's envelope? The libraries Ruben
// linked all compute the same object: the shortest curvature bounded path
// between two poses. From that you get reachability for free and in closed
// form: a point is reachable in time T if the Dubins distance to it is at most
// v*T. No sampling, and a smooth boundary. So fit the best Dubins car to this
// ship and measure the gap.
import { readFileSync } from 'node:fs';

const TAU = Math.PI*2;
const mod2pi = (a) => ((a % TAU) + TAU) % TAU;

// Standard six word Dubins, unit turning radius, start (0,0,0), goal (x,y,phi).
function dubins(x, y, phi) {
  const d = Math.hypot(x, y);
  const th = mod2pi(Math.atan2(y, x));
  const a = mod2pi(-th), b = mod2pi(phi - th);
  const sa=Math.sin(a), ca=Math.cos(a), sb=Math.sin(b), cb=Math.cos(b), cab=Math.cos(a-b);
  let best = Infinity;
  { const tmp = 2 + d*d - 2*cab + 2*d*(sa - sb);            // LSL
    if (tmp >= 0) { const th2 = Math.atan2(cb-ca, d+sa-sb);
      best = Math.min(best, mod2pi(-a+th2) + Math.sqrt(tmp) + mod2pi(b-th2)); } }
  { const tmp = 2 + d*d - 2*cab + 2*d*(sb - sa);            // RSR
    if (tmp >= 0) { const th2 = Math.atan2(ca-cb, d-sa+sb);
      best = Math.min(best, mod2pi(a-th2) + Math.sqrt(tmp) + mod2pi(-b+th2)); } }
  { const tmp = -2 + d*d + 2*cab + 2*d*(sa + sb);           // LSR
    if (tmp >= 0) { const p = Math.sqrt(tmp);
      const th2 = Math.atan2(-ca-cb, d+sa+sb) - Math.atan2(-2, p);
      best = Math.min(best, mod2pi(-a+th2) + p + mod2pi(-mod2pi(b)+th2)); } }
  { const tmp = -2 + d*d + 2*cab - 2*d*(sa + sb);           // RSL
    if (tmp >= 0) { const p = Math.sqrt(tmp);
      const th2 = Math.atan2(ca+cb, d-sa-sb) - Math.atan2(2, p);
      best = Math.min(best, mod2pi(a-th2) + p + mod2pi(b-th2)); } }
  { const tmp = (6 - d*d + 2*cab + 2*d*(sa-sb))/8;          // RLR
    if (Math.abs(tmp) <= 1) { const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(a - Math.atan2(ca-cb, d-sa+sb) + p/2);
      best = Math.min(best, t + p + mod2pi(a - b - t + p)); } }
  { const tmp = (6 - d*d + 2*cab + 2*d*(sb-sa))/8;          // LRL
    if (Math.abs(tmp) <= 1) { const p = mod2pi(TAU - Math.acos(tmp));
      const t = mod2pi(-a + Math.atan2(-ca+cb, d+sa-sb) + p/2);
      best = Math.min(best, t + p + mod2pi(b - a - t + p)); } }
  return best;
}
// Reaching a POINT, final heading free.
function dubinsToPoint(x, y, R) {
  let best = Infinity;
  for (let i = 0; i < 180; i++) best = Math.min(best, dubins(x/R, y/R, (i/180)*TAU));
  return best * R;
}
// sanity
const s1 = dubinsToPoint(10, 0, 5);
console.log(`sanity: straight ahead 10 units, radius 5 -> Dubins ${s1.toFixed(3)} (should be 10.000)`);

// ---- the real envelope, from the core ----
const { instance } = await WebAssembly.instantiate(
  readFileSync('/home/user/redux-tribes/web/public/sim_core.wasm'), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=> (S.buffer!==ex.memory.buffer ? (S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_TARGET=10,IN_HAS_TARGET=16,IN_HAS_FACE=17,IN_FLIGHT=18;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60, MODE=0;
function setBody(speed){ const s=sc(); s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=0;s[IN_QUAT+2]=0;s[IN_QUAT+3]=1;
  s[IN_VEL]=0;s[IN_VEL+1]=0;s[IN_VEL+2]=speed;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i]; }
function reach(x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z; return ex.ft_can_reach(MODE,EPS,STEPS)!==0; }
function trueRadius(th){ const dx=Math.sin(th), dz=Math.cos(th); let lo=0,hi=140;
  if(reach(dx*hi,0,dz*hi)) return hi;
  for(let i=0;i<18;i++){ const m=(lo+hi)/2; if(reach(dx*m,0,dz*m)) lo=m; else hi=m; } return lo; }
function dubinsRadius(th, R, L){ const dx=Math.sin(th), dz=Math.cos(th);
  // our +z is the nose; Dubins uses +x as heading 0, so map (z,x)->(x,y)
  let lo=0, hi=140;
  if(dubinsToPoint(dz*hi, dx*hi, R) <= L) return hi;
  for(let i=0;i<24;i++){ const m=(lo+hi)/2;
    if(dubinsToPoint(dz*m, dx*m, R) <= L) lo=m; else hi=m; } return lo; }

setBody(0);
const ANG = [];
for (let i=0;i<48;i++) ANG.push((i/48)*TAU);
const truth = ANG.map(trueRadius);

// Fit R and L by grid search on worst absolute error.
let bestFit = null;
for (let R=2; R<=90; R+=2) for (let L=20; L<=90; L+=2) {
  let worst=0, sum=0;
  for (let i=0;i<ANG.length;i++){ const e=Math.abs(dubinsRadius(ANG[i],R,L)-truth[i]);
    worst=Math.max(worst,e); sum+=e*e; }
  const rms=Math.sqrt(sum/ANG.length);
  if (!bestFit || rms<bestFit.rms) bestFit={R,L,rms,worst};
}
console.log('');
console.log(`best fitting Dubins car: turn radius ${bestFit.R} u, path budget ${bestFit.L} u`);
console.log(`  RMS error over 48 directions : ${bestFit.rms.toFixed(2)} u`);
console.log(`  worst direction              : ${bestFit.worst.toFixed(2)} u`);
console.log(`  true envelope radius spans   : ${Math.min(...truth).toFixed(1)} to ${Math.max(...truth).toFixed(1)} u`);
console.log(`  worst error as a share of it : ${(100*bestFit.worst/Math.max(...truth)).toFixed(0)}%`);
console.log('');
console.log(' bearing   true      best-fit Dubins   error');
for (let i=0;i<ANG.length;i+=6){
  const d=dubinsRadius(ANG[i],bestFit.R,bestFit.L);
  console.log(`  ${String(Math.round(ANG[i]*180/Math.PI)).padStart(4)} deg  ${truth[i].toFixed(1).padStart(6)}  ${d.toFixed(1).padStart(14)}  ${(d-truth[i]).toFixed(1).padStart(7)}`);
}
