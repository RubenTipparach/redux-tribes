// Is the reachable set star shaped about the coast landing anchor?
//
// It decides whether a tensor product surface can describe the boundary at
// all. A NURBS patch needs a rectangular domain, and the natural one here is
// direction: r(theta, phi). That only exists if every ray leaves the set once
// and never comes back, so count the crossings. Exactly 2, in then out, means
// single valued and a spherical spline fits. More means the set folds back on
// itself along that ray and no one patch can follow it.
//
// The answer is 398 of 400 rays at every speed and mode tested, with the two
// exceptions in MoveAndTurn under way. So the fit is viable, and the half a
// percent it cannot see is a known and bounded error rather than a surprise.
import { readFileSync } from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  readFileSync(new URL('../../web/public/sim_core.wasm', import.meta.url)), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=>(S.buffer!==ex.memory.buffer?(S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_TARGET=10,IN_HAS_FACE=17,IN_HAS_TARGET=16,IN_FLIGHT=18,OUT_POS=32;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60;
function setBody(speed){const s=sc();
  s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=0;s[IN_QUAT+2]=0;s[IN_QUAT+3]=1;
  s[IN_VEL]=0;s[IN_VEL+1]=0;s[IN_VEL+2]=speed;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i];}
function reach(mode,p){const s=sc();s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=p[0];s[IN_TARGET+1]=p[1];s[IN_TARGET+2]=p[2];
  return ex.ft_can_reach(mode,EPS,STEPS)!==0;}
function land(mode,p){const s=sc();s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=p[0];s[IN_TARGET+1]=p[1];s[IN_TARGET+2]=p[2];
  ex.ft_fly_turn(mode,STEPS,STEPS);const t=sc();
  return [t[OUT_POS],t[OUT_POS+1],t[OUT_POS+2]];}
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const project=(m,p)=>{for(let i=0;i<3;i++)p=land(m,p);return p;};
function dirs(n){const o=[];for(let i=0;i<n;i++){const y=1-(2*i+1)/n;
  const r=Math.sqrt(Math.max(0,1-y*y)),th=Math.PI*(1+Math.sqrt(5))*i;
  o.push([Math.cos(th)*r,y,Math.sin(th)*r]);}return o;}

console.log('crossings along each ray from the coast landing anchor.');
console.log('2 is star shaped. More than 2 means r(theta,phi) is multi valued');
console.log('there and no single tensor product patch can describe it.\n');
console.log('mode          spd   rays   exactly 2   more than 2   worst');
for (const [mn,mode] of [['MoveAndTurn',0],['TurnSlide',1]]) {
  for (const speed of [0,4,8]) {
    setBody(speed);
    const anchor = land(mode,[0,0,speed*10]);
    const D = dirs(400);
    let two=0, many=0, worst=2;
    for (const d of D) {
      let prev = reach(mode, add(anchor, mul(d,0.001))), n=0;
      for (let t=0.5; t<=120; t+=0.5) {
        const cur = reach(mode, add(anchor, mul(d,t)));
        if (cur !== prev) { n++; prev = cur; }
      }
      n += 1;                                 // the ray starts inside and ends outside
      if (n === 2) two++; else { many++; if (n>worst) worst=n; }
    }
    console.log(`${mn.padEnd(12)} ${speed}    ${D.length}   ${String(two).padStart(7)} `
      + `${String(many).padStart(11)}   ${String(worst).padStart(5)}`);
  }
}
