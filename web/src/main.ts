/**
 * Client entry point.
 *
 * The split this file exists to demonstrate: three.js owns the picture and
 * nothing else, the Rust core owns the simulation and nothing else, and they
 * meet at a numeric boundary. Swapping the renderer for a native Rust client
 * later replaces this file and leaves `sim_core` untouched.
 */

import * as THREE from 'three';
import { Sim } from './sim/wasm.js';
import { Mode, RESOLUTION_STEPS, TURN_SECONDS, type Body, type Flight } from './sim/types.js';

const FLIGHT: Flight = {
  yawRate: 6, pitchRate: 4,
  accelFwd: 0.9, accelRetro: 0.35, accelLat: 0.25,
  maxSpeed: 8,
};

const hud = document.getElementById('hud');
const sim = await Sim.load('./sim_core.wasm');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 4000);
camera.position.set(60, 55, 90);
camera.lookAt(0, 0, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0x5f7fa0, 0x0a0e14, 1.5));
const key = new THREE.DirectionalLight(0xdfefff, 1.1);
key.position.set(0.4, 1, 0.25);
scene.add(key);
scene.add(new THREE.GridHelper(400, 20, 0x1e2a3a, 0x141d29));

const hull = new THREE.Mesh(
  new THREE.ConeGeometry(2.2, 7.4, 5),
  new THREE.MeshStandardMaterial({ color: 0x35c7ff, flatShading: true, roughness: 0.55 }),
);
hull.geometry.rotateX(Math.PI / 2);
scene.add(hull);

// The turn the ship is flying, computed once by the core. The renderer only
// interpolates it: no movement logic lives on this side of the boundary.
const start: Body = {
  pos: { x: -40, y: 0, z: -30 },
  vel: { x: 0, y: 0, z: 3 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
};
const flown = sim.flyTurn(start, FLIGHT, { mode: Mode.MoveAndTurn, target: { x: 40, y: 12, z: 40 } },
  RESOLUTION_STEPS, 240);

const line = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(flown.path.map(p => new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z))),
  new THREE.LineBasicMaterial({ color: 0x35c7ff, transparent: true, opacity: 0.55 }),
);
scene.add(line);

if (hud) {
  hud.innerHTML =
    `<b>sim_core</b> (rust to wasm) flying, three.js drawing<br>` +
    `end ${flown.endPos.x.toFixed(1)}, ${flown.endPos.y.toFixed(1)}, ${flown.endPos.z.toFixed(1)} ` +
    `after ${TURN_SECONDS}s<br>carrying ${Math.hypot(flown.endVel.x, flown.endVel.y, flown.endVel.z).toFixed(2)} u/s`;
}

let t0 = 0;
renderer.setAnimationLoop((now) => {
  if (!t0) t0 = now;
  const k = ((now - t0) / (TURN_SECONDS * 1000)) % 1;
  const i = Math.min(flown.path.length - 1, Math.floor(k * (flown.path.length - 1)));
  const pose = flown.path[i];
  if (pose) {
    hull.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
    hull.quaternion.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
  }
  renderer.render(scene, camera);
});
