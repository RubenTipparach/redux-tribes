// Is the lat-long chart under the envelope fit too uneven, and can anything
// beat it?
//
// It is certainly uneven. On the surface, neighbouring samples run from 0.03 u
// to 2.38 u apart, a spread of 70x: 128 meridians crowd into a tiny circle at
// each pole while the equator sits at 1.22 u. It looks indefensible.
//
// No single rectangle can cover a sphere without a pole or a seam, so the
// alternatives are an equal area chart, which keeps one rectangle and spreads
// the samples by solid angle, or a cube map, which trades two crowded points
// for twelve seams between six well behaved patches.
//
// Both are more even. Both fit WORSE, at an equal ray budget:
//
//   scheme              rays   rms drift   worst   spacing max/min
//   lat-long 128x66     8448     0.306 u   3.56 u            68.5x
//   equal area 128x66   8448     0.416 u   3.56 u            20.1x
//   cube 6 x 38x38      8664     0.682 u   7.82 u             3.7x
//
// Equal area is 3.4 times more even and 36% worse, because uniform in cos(phi)
// spends its latitude resolution near the poles and gives it up at the equator,
// which is where the shape actually varies. The cube map is 18 times more even
// and 2.2 times worse, because its six patches are fitted independently and the
// error piles up on the seams: its worst case is on an edge, not in a face.
//
// The crowding is not waste. It is what pays for the equatorial resolution that
// drives the fit, and the chart also already points its poles at the best of
// the three axes: Y gives 0.306 u where X gives 0.411 and Z gives 0.449.
//
// So this tool records a negative result. Nothing here beat what ships.
import { readFileSync } from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  readFileSync(new URL('../../web/public/sim_core.wasm', import.meta.url)), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=>(S.buffer!==ex.memory.buffer?(S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_TARGET=10,IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_HAS_FACE=17,IN_HAS_TARGET=16,IN_FLIGHT=18,OUT_POS=32;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60;
let probes=0;
function setBody(speed){const s=sc();
  s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=0;s[IN_QUAT+2]=0;s[IN_QUAT+3]=1;
  s[IN_VEL]=0;s[IN_VEL+1]=0;s[IN_VEL+2]=speed;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i];}
function reach(p){const s=sc();probes++;s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=p[0];s[IN_TARGET+1]=p[1];s[IN_TARGET+2]=p[2];
  return ex.ft_can_reach(0,EPS,STEPS)!==0;}
function land(p){const s=sc();probes++;s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=p[0];s[IN_TARGET+1]=p[1];s[IN_TARGET+2]=p[2];
  ex.ft_fly_turn(0,STEPS,STEPS);const t=sc();
  return [t[OUT_POS],t[OUT_POS+1],t[OUT_POS+2]];}
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function radius(anchor,d,it=12){let lo=0,hi=200;
  if(reach(add(anchor,mul(d,hi))))return hi;
  for(let i=0;i<it;i++){const m=(lo+hi)/2;
    if(reach(add(anchor,mul(d,m))))lo=m;else hi=m;}return(lo+hi)/2;}

function solveTri(a,b,c,d){const n=d.length,cp=new Array(n),dp=new Array(n);
  cp[0]=c[0]/b[0];dp[0]=d[0]/b[0];
  for(let i=1;i<n;i++){const m=b[i]-a[i]*cp[i-1];cp[i]=c[i]/m;dp[i]=(d[i]-a[i]*dp[i-1])/m;}
  const x=new Array(n);x[n-1]=dp[n-1];
  for(let i=n-2;i>=0;i--)x[i]=dp[i]-cp[i]*x[i+1];return x;}
function solveCyclic(y){const n=y.length;if(n<4)return y.slice();
  const a=new Array(n).fill(1/6),b=new Array(n).fill(4/6),c=new Array(n).fill(1/6);
  const alpha=1/6,beta=1/6,gamma=-b[0];
  const bb=b.slice();bb[0]=b[0]-gamma;bb[n-1]=b[n-1]-alpha*beta/gamma;
  const u=new Array(n).fill(0);u[0]=gamma;u[n-1]=alpha;
  const x=solveTri(a,bb,c,y),z=solveTri(a,bb,c,u);
  const f=(x[0]+beta*x[n-1]/gamma)/(1+z[0]+beta*z[n-1]/gamma);
  return x.map((v,i)=>v-f*z[i]);}
function solveClamped(y){const n=y.length;if(n<3)return y.slice();
  const a=new Array(n).fill(1/6),b=new Array(n).fill(4/6),c=new Array(n).fill(1/6);
  a[0]=0;b[0]=1;c[0]=0;a[n-1]=0;b[n-1]=1;c[n-1]=0;
  return solveTri(a,b,c,y);}
const Bs=t=>{const t2=t*t,t3=t2*t;
  return [(1-3*t+3*t2-t3)/6,(4-6*t2+3*t3)/6,(1+3*t+3*t2-3*t3)/6,t3/6];};
function evalClamped(ctrl,N,t){ const f=t*(N-3), i=Math.min(N-4,Math.max(0,Math.floor(f)));
  const b=Bs(f-i); let r=0;
  for(let k=0;k<4;k++) r+=b[k]*ctrl[Math.min(N-1,Math.max(0,i+k))]; return r; }

// ---- lat-long, one chart
const llDir=(u,v)=>{const th=u*2*Math.PI,ph=v*Math.PI;
  return [Math.sin(ph)*Math.cos(th),Math.cos(ph),Math.sin(ph)*Math.sin(th)];};
function llFit(anchor,NU,NV){
  const g=[];for(let u=0;u<NU;u++){g[u]=[];
    for(let v=0;v<NV;v++) g[u][v]=radius(anchor,llDir(u/NU,v/(NV-1)));}
  for(const v of [0,NV-1]){let m=0;for(let u=0;u<NU;u++)m+=g[u][v];m/=NU;
    for(let u=0;u<NU;u++)g[u][v]=m;}
  const rows=g.map(c=>solveClamped(c)),ctrl=[];
  for(let v=0;v<NV;v++) solveCyclic(rows.map(r=>r[v])).forEach((val,u)=>{(ctrl[u]||=[])[v]=val;});
  return {ctrl,NU,NV,g};}
function llEval(f,u,v){ const {ctrl,NU,NV}=f;
  const fu=u*NU,iu=Math.floor(fu),bu=Bs(fu-iu);
  const fv=v*(NV-3),iv=Math.min(NV-4,Math.max(0,Math.floor(fv))),bv=Bs(fv-iv);
  let r=0;
  for(let a=0;a<4;a++)for(let b=0;b<4;b++)
    r+=bu[a]*bv[b]*ctrl[(iu+a-1+NU*2)%NU][Math.min(NV-1,Math.max(0,iv+b))];
  return r;}

// ---- cube map, six equiangular faces
const AX=[[[0,0,1],[0,1,0],[1,0,0]],[[0,0,-1],[0,1,0],[-1,0,0]],
          [[1,0,0],[0,0,1],[0,1,0]],[[1,0,0],[0,0,-1],[0,-1,0]],
          [[-1,0,0],[0,1,0],[0,0,1]],[[1,0,0],[0,1,0],[0,0,-1]]];
function cubeDir(f,s,t){
  const a=Math.tan((s-0.5)*Math.PI/2), b=Math.tan((t-0.5)*Math.PI/2);
  const [X,Y,Z]=AX[f];
  const v=[X[0]*a+Y[0]*b+Z[0], X[1]*a+Y[1]*b+Z[1], X[2]*a+Y[2]*b+Z[2]];
  const l=Math.hypot(...v); return [v[0]/l,v[1]/l,v[2]/l];}
function cubeFit(anchor,N){
  const faces=[];
  for(let f=0;f<6;f++){ const g=[];
    for(let s=0;s<N;s++){ g[s]=[];
      for(let t=0;t<N;t++) g[s][t]=radius(anchor,cubeDir(f,s/(N-1),t/(N-1))); }
    const rows=g.map(c=>solveClamped(c)),ctrl=[];
    for(let t=0;t<N;t++) solveClamped(rows.map(r=>r[t])).forEach((val,s)=>{(ctrl[s]||=[])[t]=val;});
    faces.push(ctrl); }
  return {faces,N};}
function cubeFace(d){ const a=Math.abs(d[0]),b=Math.abs(d[1]),c=Math.abs(d[2]);
  if(c>=a&&c>=b) return d[2]>0?4:5;
  if(a>=b) return d[0]>0?0:1;
  return d[1]>0?2:3;}
function cubeST(f,d){ const [X,Y,Z]=AX[f];
  const x=d[0]*X[0]+d[1]*X[1]+d[2]*X[2], y=d[0]*Y[0]+d[1]*Y[1]+d[2]*Y[2],
        z=d[0]*Z[0]+d[1]*Z[1]+d[2]*Z[2];
  return [Math.atan2(x/z,1)/(Math.PI/2)+0.5, Math.atan2(y/z,1)/(Math.PI/2)+0.5];}
function cubeEval(fit,d){ const f=cubeFace(d),[s,t]=cubeST(f,d),ctrl=fit.faces[f],N=fit.N;
  const fs=s*(N-3),is=Math.min(N-4,Math.max(0,Math.floor(fs))),bs=Bs(fs-is);
  const ft=t*(N-3),it=Math.min(N-4,Math.max(0,Math.floor(ft))),bt=Bs(ft-it);
  let r=0;
  for(let a=0;a<4;a++)for(let b=0;b<4;b++)
    r+=bs[a]*bt[b]*ctrl[Math.min(N-1,Math.max(0,is+a))][Math.min(N-1,Math.max(0,it+b))];
  return r;}

const eaDir=(u,v)=>{const th=u*2*Math.PI,c=1-2*v,s=Math.sqrt(Math.max(0,1-c*c));
  return [s*Math.cos(th),c,s*Math.sin(th)];};
function eaFit(anchor,NU,NV){
  const g=[];for(let u=0;u<NU;u++){g[u]=[];
    for(let v=0;v<NV;v++) g[u][v]=radius(anchor,eaDir(u/NU,v/(NV-1)));}
  for(const v of [0,NV-1]){let m=0;for(let u=0;u<NU;u++)m+=g[u][v];m/=NU;
    for(let u=0;u<NU;u++)g[u][v]=m;}
  const rows=g.map(c=>solveClamped(c)),ctrl=[];
  for(let v=0;v<NV;v++) solveCyclic(rows.map(r=>r[v])).forEach((val,u)=>{(ctrl[u]||=[])[v]=val;});
  return {ctrl,NU,NV};}

setBody(4);
const anchor=land([0,0,40]);
// score on directions neither fit was built from
const test=[];
for(let i=0;i<3000;i++){ const y=1-(2*i+1)/3000, r=Math.sqrt(Math.max(0,1-y*y)),
  th=Math.PI*(1+Math.sqrt(5))*i;
  const d=[Math.cos(th)*r,y,Math.sin(th)*r];
  test.push([d, radius(anchor,d,16)]); }

// If the crowding cannot be removed, it can at least be aimed. Put the poles
// on each axis in turn and see where the wasted samples hurt least.
console.log('the chart has to crowd somewhere. Which axis should it crowd on?\n');
console.log('  poles on    rms drift   worst');
const AXES = { 'X': d=>[d[1],d[0],d[2]], 'Y (now)': d=>d, 'Z (velocity)': d=>[d[0],d[2],d[1]] };
for (const [an, perm] of Object.entries(AXES)) {
  const inv = perm;                      // each permutation is its own inverse
  const g=[], NU=128, NV=66;
  for(let u=0;u<NU;u++){ g[u]=[];
    for(let v=0;v<NV;v++) g[u][v]=radius(anchor, perm(llDir(u/NU,v/(NV-1)))); }
  for(const v of [0,NV-1]){ let m=0; for(let u=0;u<NU;u++) m+=g[u][v]; m/=NU;
    for(let u=0;u<NU;u++) g[u][v]=m; }
  const rows=g.map(c=>solveClamped(c)), ctrl=[];
  for(let v=0;v<NV;v++) solveCyclic(rows.map(r=>r[v])).forEach((val,u)=>{(ctrl[u]||=[])[v]=val;});
  const fit={ctrl,NU,NV};
  let sum=0, worst=0;
  for (const [d,rTrue] of test) {
    const dd = inv(d);
    const ph=Math.acos(Math.max(-1,Math.min(1,dd[1]))), th=Math.atan2(dd[2],dd[0]);
    const e=Math.abs(llEval(fit,((th/(2*Math.PI))%1+1)%1, ph/Math.PI)-rTrue);
    sum+=e*e; if(e>worst) worst=e;
  }
  console.log(`  ${an.padEnd(13)} ${Math.sqrt(sum/test.length).toFixed(3).padStart(7)} u `
    + `${worst.toFixed(2).padStart(7)} u`);
}
console.log('');
console.log('equal ray budget, scored on 3000 directions neither fit was given.\n');
console.log('  scheme            rays   probes    rms drift   worst   spacing max/min');
for (const [name, build, ev, rays] of [
  ['lat-long 128x66', () => llFit(anchor,128,66), (f,d)=>{
      const ph=Math.acos(Math.max(-1,Math.min(1,d[1]))), th=Math.atan2(d[2],d[0]);
      return llEval(f,((th/(2*Math.PI))%1+1)%1, ph/Math.PI); }, 8448],
  ['lat-long 96x50',  () => llFit(anchor,96,50), (f,d)=>{
      const ph=Math.acos(Math.max(-1,Math.min(1,d[1]))), th=Math.atan2(d[2],d[0]);
      return llEval(f,((th/(2*Math.PI))%1+1)%1, ph/Math.PI); }, 4800],
  ['cube 6 x 38x38',  () => cubeFit(anchor,38), cubeEval, 8664],
  ['cube 6 x 28x28',  () => cubeFit(anchor,28), cubeEval, 4704],
  ['equal area 128x66', () => eaFit(anchor,128,66), (f,d)=>{
      const c=Math.max(-1,Math.min(1,d[1])), th=Math.atan2(d[2],d[0]);
      return llEval(f,((th/(2*Math.PI))%1+1)%1, (1-c)/2); }, 8448],
  ['equal area 96x50', () => eaFit(anchor,96,50), (f,d)=>{
      const c=Math.max(-1,Math.min(1,d[1])), th=Math.atan2(d[2],d[0]);
      return llEval(f,((th/(2*Math.PI))%1+1)%1, (1-c)/2); }, 4800],
]) {
  probes = 0;
  const fit = build();
  const p = probes;
  let sum=0, worst=0;
  for (const [d,rTrue] of test) {
    const e = Math.abs(ev(fit,d)-rTrue); sum+=e*e; if(e>worst) worst=e; }
  // spacing spread, on the surface
  const gaps=[];
  if (name.startsWith('cube')) { const N=fit.N;
    for(let f=0;f<6;f++) for(let s=0;s<N-1;s++) for(let t=0;t<N-1;t++){
      const P=(a,b)=>{const d=cubeDir(f,a/(N-1),b/(N-1));return add(anchor,mul(d,cubeEval(fit,d)));};
      gaps.push(dist(P(s,t),P(s+1,t)), dist(P(s,t),P(s,t+1))); }
  } else { const {NU,NV}=fit;
    const DF = name.startsWith('equal') ? eaDir : llDir;
    for(let u=0;u<NU;u++) for(let v=0;v<NV-1;v++){
      const P=(a,b)=>{const d=DF(a/NU,b/(NV-1));return add(anchor,mul(d,ev(fit,d)));};
      gaps.push(dist(P(u,v),P(u,v+1)), dist(P(u,v),P((u+1)%NU,v))); } }
  const nz=gaps.filter(g=>g>1e-4).sort((a,b)=>a-b);
  const q=f=>nz[Math.floor(f*(nz.length-1))];
  console.log(`  ${name.padEnd(17)} ${String(rays).padStart(5)} ${String(p).padStart(8)} `
    + `${Math.sqrt(sum/test.length).toFixed(3).padStart(10)} u ${worst.toFixed(2).padStart(7)} u `
    + `${(q(0.99)/q(0.01)).toFixed(1).padStart(13)}x`);
}
