// If the miss equals the overshoot, then probing FAR along a direction gives
// the boundary radius directly: R = r_probe - miss. One flight instead of
// eighteen bisections, and exact rather than converged. Test it against deep
// bisection across directions, speeds and modes.
import { readFileSync } from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  readFileSync('/home/user/redux-tribes/web/public/sim_core.wasm'), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=> (S.buffer!==ex.memory.buffer ? (S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_TARGET=10,IN_HAS_TARGET=16,IN_HAS_FACE=17,IN_FLIGHT=18,OUT_POS=32;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60;
function setBody(yawDeg,speed){ const s=sc(); const a=yawDeg*Math.PI/180,h=a/2;
  s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=Math.sin(h);s[IN_QUAT+2]=0;s[IN_QUAT+3]=Math.cos(h);
  s[IN_VEL]=Math.sin(a)*speed;s[IN_VEL+1]=0;s[IN_VEL+2]=Math.cos(a)*speed;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i]; }
function reach(mode,x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z; return ex.ft_can_reach(mode,EPS,STEPS)!==0; }
function miss(mode,x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z;
  ex.ft_fly_turn(mode, STEPS, STEPS); const t=sc();
  return Math.hypot(t[OUT_POS]-x, t[OUT_POS+1]-y, t[OUT_POS+2]-z); }
function bisectR(mode,dx,dy,dz){ let lo=0,hi=200;
  if(reach(mode,dx*hi,dy*hi,dz*hi)) return hi;
  for(let i=0;i<22;i++){ const m=(lo+hi)/2;
    if(reach(mode,dx*m,dy*m,dz*m)) lo=m; else hi=m; } return lo; }
function oneProbeR(mode,dx,dy,dz,probeAt){ return probeAt - miss(mode,dx*probeAt,dy*probeAt,dz*probeAt); }

const MODES=[['MoveAndTurn',0],['TurnSlide',1]];
console.log('R from one probe against R from 22 bisections. eps is 1.6, so the');
console.log('one probe answer should sit about eps outside the bisected one.\n');
for (const [mn, mode] of MODES) {
  for (const speed of [0,4]) {
    setBody(0,speed);
    let worst=0,sum=0,n=0, worstDir=null;
    for (let i=0;i<40;i++){
      const th=(i/40)*Math.PI*2;
      for (const el of [0, 0.5, -0.5]) {
        const dx=Math.sin(th)*Math.cos(el), dy=Math.sin(el), dz=Math.cos(th)*Math.cos(el);
        const rb=bisectR(mode,dx,dy,dz);
        if (rb>=199) continue;
        const ro=oneProbeR(mode,dx,dy,dz,180);
        const e=Math.abs(ro-rb); sum+=e; n++;
        if(e>worst){worst=e; worstDir=`${Math.round(th*180/Math.PI)}deg el${el}`;}
      }
    }
    console.log(`${mn.padEnd(12)} speed ${speed}: ${n} directions, mean |diff| ${(sum/n).toFixed(3)} u, `
      + `worst ${worst.toFixed(3)} u at ${worstDir}`);
  }
}
console.log('');
console.log('cost: one flight per direction, against 22 for the bisected answer.');
