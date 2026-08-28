#!/usr/bin/env node
// Is there a usable signed distance field for the reachable set?
//
//   node prototype/tools/sdf-probe.mjs
//
// can_reach is `dist(end_pos, target) <= eps`. So miss - eps is already a
// signed implicit function: negative inside, positive outside, zero on the
// boundary. If it behaves, marching can place vertices by INTERPOLATING it
// instead of bisecting, which costs nothing and is smooth by construction.
// Three questions: is it monotone across the boundary, how close does linear
// interpolation land to a deep bisection, and does the mesh get symmetric.
import { readFileSync } from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  readFileSync('/home/user/redux-tribes/web/public/sim_core.wasm'), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=> (S.buffer!==ex.memory.buffer ? (S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_TARGET=10,IN_HAS_TARGET=16,IN_HAS_FACE=17,IN_FLIGHT=18;
const OUT_POS=32;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60, MODE=0;
function setBody(yawDeg=0, speed=0){ const s=sc(); const a=yawDeg*Math.PI/180,h=a/2;
  s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=Math.sin(h);s[IN_QUAT+2]=0;s[IN_QUAT+3]=Math.cos(h);
  s[IN_VEL]=Math.sin(a)*speed;s[IN_VEL+1]=0;s[IN_VEL+2]=Math.cos(a)*speed;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i]; }
function reach(x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z; return ex.ft_can_reach(MODE,EPS,STEPS)!==0; }
// The field the core already computes and discards.
function field(x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z;
  ex.ft_fly_turn(MODE, STEPS, STEPS);
  const t=sc();
  const dx=t[OUT_POS]-x, dy=t[OUT_POS+1]-y, dz=t[OUT_POS+2]-z;
  return Math.hypot(dx,dy,dz) - EPS; }

setBody(0,0);
console.log('agreement: field(p) < 0 should mean reach(p) is true');
let agree=0, tot=0;
for (let i=0;i<400;i++){
  const x=(Math.random()*2-1)*60, y=(Math.random()*2-1)*40, z=(Math.random()*2-1)*60;
  if ((field(x,y,z) < 0) === reach(x,y,z)) agree++;
  tot++;
}
console.log(`  ${agree} of ${tot} agree\n`);

console.log('1. MONOTONE ACROSS THE BOUNDARY? field along a ray at 30 degrees off the nose');
console.log('   r      field      sign');
let prev=null, flips=0;
for (let r=10; r<=40; r+=2){
  const th=30*Math.PI/180;
  const f=field(Math.sin(th)*r, 0, Math.cos(th)*r);
  if (prev!==null && Math.sign(f)!==Math.sign(prev)) flips++;
  console.log(`  ${String(r).padStart(3)}  ${f.toFixed(3).padStart(9)}   ${f<0?'in':'out'}`);
  prev=f;
}
console.log(`  sign changes along the ray: ${flips} (1 means a clean single crossing)\n`);

console.log('2. LINEAR INTERPOLATION vs DEEP BISECTION, on real grid edges');
function bisect(a,b,n){ let lo=0,hi=1;
  for(let i=0;i<n;i++){ const m=(lo+hi)/2;
    if(reach(a[0]+(b[0]-a[0])*m,a[1]+(b[1]-a[1])*m,a[2]+(b[2]-a[2])*m)) lo=m; else hi=m; }
  return lo; }
const N=14, HALF=56, step=(2*HALF)/N, px=(i)=>-HALF+(i+0.5)*step;
let worst=0, sum=0, n=0;
for (let i=0;i<N-1 && n<120;i++) for (let j=0;j<N-1 && n<120;j++) for (let k=0;k<N-1 && n<120;k++){
  const A=[px(i),px(j),px(k)], B=[px(i+1),px(j),px(k)];
  const fa=field(...A), fb=field(...B);
  if ((fa<0) === (fb<0)) continue;
  const tLin = fa/(fa-fb);                       // where the field says zero is
  const inA = fa<0;
  const tBis = inA ? bisect(A,B,14) : 1-bisect(B,A,14);
  const err = Math.abs(tLin-tBis)*step;
  worst=Math.max(worst,err); sum+=err; n++;
}
console.log(`  ${n} crossing edges: mean placement error ${(sum/n).toFixed(3)} u, worst ${worst.toFixed(3)} u`);
console.log(`  (cell is ${step.toFixed(1)} u; bisecting 4 times leaves ${(step/16).toFixed(3)} u by construction)`);

console.log('');
console.log('3. THE FIELD IS A PLATEAU INSIDE, BUT DOES IT CARRY DISTANCE OUTSIDE?');
console.log('   Ask for points past the boundary and see how the miss grows.');
const th=30*Math.PI/180, dirx=Math.sin(th), dirz=Math.cos(th);
// find the boundary radius first
let lo=0, hi=140;
for(let i=0;i<20;i++){ const m=(lo+hi)/2; if(reach(dirx*m,0,dirz*m)) lo=m; else hi=m; }
const R=lo;
console.log(`   boundary at r = ${R.toFixed(2)} u`);
console.log('   past R    field    field/past  (1.00 would mean the miss equals the overshoot)');
for (const d of [1,2,4,8,16,32]) {
  const f=field(dirx*(R+d),0,dirz*(R+d));
  console.log(`   ${String(d).padStart(6)}  ${f.toFixed(3).padStart(7)}  ${(f/d).toFixed(3).padStart(10)}`);
}

console.log('');
console.log('4. ONE SIDED PLACEMENT: use the OUTSIDE sample only.');
console.log('   The crossing sits about f_out back from the outside end, if the miss');
console.log('   tracks the overshoot. Compare against deep bisection on real edges.');
let w2=0,s2=0,n2=0;
for (let i=0;i<N-1 && n2<120;i++) for (let j=0;j<N-1 && n2<120;j++) for (let k=0;k<N-1 && n2<120;k++){
  const A=[px(i),px(j),px(k)], B=[px(i+1),px(j),px(k)];
  const fa=field(...A), fb=field(...B);
  if ((fa<0) === (fb<0)) continue;
  const inA = fa<0;
  const fOut = inA ? fb : fa;
  // distance from the OUTSIDE end back toward the inside end
  const back = Math.min(step, Math.max(0, fOut));
  const tOneSided = inA ? (step-back)/step : back/step;
  const tBis = inA ? bisect(A,B,14) : 1-bisect(B,A,14);
  const err = Math.abs(tOneSided-tBis)*step;
  w2=Math.max(w2,err); s2+=err; n2++;
}
console.log(`   ${n2} edges: mean ${(s2/n2).toFixed(3)} u, worst ${w2.toFixed(3)} u`);
console.log(`   against 4 bisections at ${(step/16).toFixed(3)} u, and linear interp at 1.135 u`);
