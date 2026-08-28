#!/usr/bin/env node
// Why is the drawn envelope not mirror symmetric when the set is?
//
//   node prototype/tools/mesh-symmetry.mjs
//
// The reachable set is mirror symmetric about the ship's vertical plane
// (measured: left and right radii agree to the digit). So a lopsided drawing
// is the sampling, not the shape. Two suspects:
//   a) the probe box is axis aligned in WORLD space and centred on the ship,
//      but the ship's heading is arbitrary, so the lattice is not aligned to
//      the mirror plane;
//   b) marching tetrahedra splits each cube along ONE diagonal, which breaks
//      the cube's own symmetry even on a perfectly aligned lattice.
// Measure them apart.
import { readFileSync } from 'node:fs';
const { instance } = await WebAssembly.instantiate(
  readFileSync('/home/user/redux-tribes/web/public/sim_core.wasm'), {});
const ex = instance.exports;
let S = new Float32Array(ex.memory.buffer, ex.ft_scratch_ptr(), ex.ft_scratch_len());
const sc=()=> (S.buffer!==ex.memory.buffer ? (S=new Float32Array(ex.memory.buffer,ex.ft_scratch_ptr(),ex.ft_scratch_len())):S);
const IN_POS=0,IN_VEL=3,IN_QUAT=6,IN_TARGET=10,IN_HAS_TARGET=16,IN_HAS_FACE=17,IN_FLIGHT=18;
const F=[6.0,4.0,0.9,0.35,0.25,8.0], EPS=1.6, STEPS=60, MODE=0;
function setBody(yawDeg){ const s=sc(); const a=yawDeg*Math.PI/180, h=a/2;
  s[IN_POS]=0;s[IN_POS+1]=0;s[IN_POS+2]=0;
  s[IN_QUAT]=0;s[IN_QUAT+1]=Math.sin(h);s[IN_QUAT+2]=0;s[IN_QUAT+3]=Math.cos(h);
  s[IN_VEL]=0;s[IN_VEL+1]=0;s[IN_VEL+2]=0;
  s[IN_HAS_FACE]=0; for(let i=0;i<6;i++) s[IN_FLIGHT+i]=F[i]; }
function reach(x,y,z){ const s=sc(); s[IN_HAS_TARGET]=1;
  s[IN_TARGET]=x;s[IN_TARGET+1]=y;s[IN_TARGET+2]=z; return ex.ft_can_reach(MODE,EPS,STEPS)!==0; }
function bisect(a,b,n){ let lo=0,hi=1;
  for(let i=0;i<n;i++){ const m=(lo+hi)/2;
    if(reach(a[0]+(b[0]-a[0])*m,a[1]+(b[1]-a[1])*m,a[2]+(b[2]-a[2])*m)) lo=m; else hi=m; }
  return [a[0]+(b[0]-a[0])*lo,a[1]+(b[1]-a[1])*lo,a[2]+(b[2]-a[2])*lo]; }

const CUBE=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
const TETS=[[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6],[0,5,1,6]];
const N=14, HALF=56;

function surface(){
  const step=(2*HALF)/N, px=(i)=>-HALF+(i+0.5)*step;
  const Fg=[];
  for(let i=0;i<N;i++){Fg.push([]);for(let j=0;j<N;j++){Fg[i].push([]);
    for(let k=0;k<N;k++) Fg[i][j].push(reach(px(i),px(j),px(k))?1:0);}}
  const at=(i,j,k)=> i>=0&&j>=0&&k>=0&&i<N&&j<N&&k<N&&Fg[i][j][k];
  const cache=new Map();
  const key=(a,b)=>{const ka=(a[0]*N+a[1])*N+a[2],kb=(b[0]*N+b[1])*N+b[2];
    return ka<kb?ka*1e7+kb:kb*1e7+ka;};
  const vert=(ga,gb)=>{ const k=key(ga,gb); const h=cache.get(k); if(h) return h;
    const A=[px(ga[0]),px(ga[1]),px(ga[2])], B=[px(gb[0]),px(gb[1]),px(gb[2])];
    const v = at(ga[0],ga[1],ga[2]) ? bisect(A,B,4) : bisect(B,A,4);
    cache.set(k,v); return v; };
  const verts=[];
  for(let i=0;i<N-1;i++)for(let j=0;j<N-1;j++)for(let k=0;k<N-1;k++){
    const cp=CUBE.map(([a,b,c])=>[i+a,j+b,k+c]);
    const iv=cp.map(c=>at(c[0],c[1],c[2]));
    let n=0; for(const b of iv) if(b) n++;
    if(n===0||n===8) continue;
    for(const T of TETS){
      const ins=T.filter(t=>iv[t]), outs=T.filter(t=>!iv[t]);
      if(ins.length===0||ins.length===4) continue;
      if(ins.length===1){ const a=ins[0];
        verts.push(vert(cp[a],cp[outs[0]]),vert(cp[a],cp[outs[1]]),vert(cp[a],cp[outs[2]])); }
      else if(ins.length===3){ const o=outs[0];
        verts.push(vert(cp[ins[0]],cp[o]),vert(cp[ins[1]],cp[o]),vert(cp[ins[2]],cp[o])); }
      else { const [a,b]=ins,[c,d]=outs;
        verts.push(vert(cp[a],cp[c]),vert(cp[a],cp[d]),vert(cp[b],cp[d]),vert(cp[b],cp[c])); }
    }
  }
  return verts;
}
// How far is the mesh from being its own mirror image about x = 0?
function mirrorError(verts){
  let worst=0, sum=0, n=0;
  for(const v of verts){
    const m=[-v[0],v[1],v[2]];
    let best=Infinity;
    for(const w of verts){
      const d=(w[0]-m[0])**2+(w[1]-m[1])**2+(w[2]-m[2])**2;
      if(d<best) best=d;
    }
    const e=Math.sqrt(best);
    worst=Math.max(worst,e); sum+=e; n++;
  }
  return { worst, mean: sum/n, n };
}

console.log('The field is mirror symmetric about x = 0 when the nose points along +z.');
console.log('So any mismatch below is introduced by the mesh, not the shape.\n');
setBody(0);
const v0 = surface();
const e0 = mirrorError(v0);
console.log(`nose along +z, lattice ALIGNED to the mirror plane`);
console.log(`  ${e0.n} vertices, mean mirror mismatch ${e0.mean.toFixed(3)} u, worst ${e0.worst.toFixed(3)} u`);
console.log(`  cell size ${(2*HALF/N).toFixed(1)} u, so worst is ${(100*e0.worst/(2*HALF/N)).toFixed(0)}% of a cell`);
console.log(`  -> this is the tetrahedral split alone (suspect b)\n`);

// (a) the lattice is world axis aligned but the hull can point anywhere.
function mirrorErrorAbout(verts, yawDeg){
  const a=yawDeg*Math.PI/180;
  const n=[Math.cos(a),0,-Math.sin(a)];           // horizontal normal to the nose
  let worst=0,sum=0,c=0;
  for(const v of verts){
    const d=2*(v[0]*n[0]+v[1]*n[1]+v[2]*n[2]);
    const m=[v[0]-d*n[0], v[1]-d*n[1], v[2]-d*n[2]];
    let best=Infinity;
    for(const w of verts){
      const q=(w[0]-m[0])**2+(w[1]-m[1])**2+(w[2]-m[2])**2;
      if(q<best) best=q; }
    const e=Math.sqrt(best); worst=Math.max(worst,e); sum+=e; c++; }
  return { worst, mean:sum/c, n:c };
}
for (const yaw of [15, 30, 45]) {
  setBody(yaw);
  const v = surface();
  const e = mirrorErrorAbout(v, yaw);
  console.log(`nose at ${String(yaw).padStart(2)} deg, lattice NOT aligned to the mirror plane`);
  console.log(`  ${e.n} vertices, mean ${e.mean.toFixed(3)} u, worst ${e.worst.toFixed(3)} u`
    + `  (${(100*e.worst/8).toFixed(0)}% of a cell)`);
}

// The standard fix for (b): alternate the cube diagonal by cell parity, so the
// decomposition stops preferring one direction everywhere.
const TETS_B=[[1,0,3,5],[1,3,2,5],[3,2,5,6],[3,5,6,7],[3,7,5,4],[3,4,5,0]];
function surfaceAlt(){
  const step=(2*HALF)/N, px=(i)=>-HALF+(i+0.5)*step;
  const Fg=[];
  for(let i=0;i<N;i++){Fg.push([]);for(let j=0;j<N;j++){Fg[i].push([]);
    for(let k=0;k<N;k++) Fg[i][j].push(reach(px(i),px(j),px(k))?1:0);}}
  const at=(i,j,k)=> i>=0&&j>=0&&k>=0&&i<N&&j<N&&k<N&&Fg[i][j][k];
  const cache=new Map();
  const key=(a,b)=>{const ka=(a[0]*N+a[1])*N+a[2],kb=(b[0]*N+b[1])*N+b[2];
    return ka<kb?ka*1e7+kb:kb*1e7+ka;};
  const vert=(ga,gb)=>{ const k=key(ga,gb); const h=cache.get(k); if(h) return h;
    const A=[px(ga[0]),px(ga[1]),px(ga[2])], B=[px(gb[0]),px(gb[1]),px(gb[2])];
    const v = at(ga[0],ga[1],ga[2]) ? bisect(A,B,4) : bisect(B,A,4);
    cache.set(k,v); return v; };
  const verts=[];
  for(let i=0;i<N-1;i++)for(let j=0;j<N-1;j++)for(let k=0;k<N-1;k++){
    const cp=CUBE.map(([a,b,c])=>[i+a,j+b,k+c]);
    const iv=cp.map(c=>at(c[0],c[1],c[2]));
    let n=0; for(const b of iv) if(b) n++;
    if(n===0||n===8) continue;
    const T6 = ((i+j+k)&1) ? TETS_B : TETS;
    for(const T of T6){
      const ins=T.filter(t=>iv[t]), outs=T.filter(t=>!iv[t]);
      if(ins.length===0||ins.length===4) continue;
      if(ins.length===1){ const a=ins[0];
        verts.push(vert(cp[a],cp[outs[0]]),vert(cp[a],cp[outs[1]]),vert(cp[a],cp[outs[2]])); }
      else if(ins.length===3){ const o=outs[0];
        verts.push(vert(cp[ins[0]],cp[o]),vert(cp[ins[1]],cp[o]),vert(cp[ins[2]],cp[o])); }
      else { const [a,b]=ins,[c,d]=outs;
        verts.push(vert(cp[a],cp[c]),vert(cp[a],cp[d]),vert(cp[b],cp[d]),vert(cp[b],cp[c])); }
    }
  }
  return verts;
}
setBody(0);
const alt = surfaceAlt();
const ea = mirrorError(alt);
console.log('');
console.log('alternating the cube diagonal by cell parity, nose along +z');
console.log(`  ${ea.n} vertices, mean ${ea.mean.toFixed(3)} u, worst ${ea.worst.toFixed(3)} u`);
