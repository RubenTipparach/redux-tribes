/**
 * The shipyard: a full screen over the console, like the lobby.
 *
 * The player picks a class, takes its frame, fits parts to its hardpoints,
 * plates it and paints it. Nobody places a cell: at 32 x 32 x 64 that is
 * 65,536 of them, so the tools are sockets and section sliders and the cells
 * are the medium rather than the interface.
 *
 * This file draws and collects input, which is the client's whole job. Every
 * number it prints comes from `derive()` in design.ts, and it works none of
 * them out for itself, so when derivation moves to Rust nothing here changes
 * except where the answer comes from.
 */

import * as THREE from 'three';
import {
  NX, NY, NZ, RUNG, FRAMES, MODULES, GUNS, SECTIONS, STOCK,
  derive, frameFor, moduleById, stockFor, blockPct, throughArmour,
  type Design, type Derived, type ModuleDef, type SectionKey,
} from './design.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** Faction paint, from the archived material palette. */
const PAINTS: ReadonlyArray<readonly [string, number]> = [
  ['terran', 0x0095E9], ['terran deep', 0x124E89],
  ['karisen', 0xFA6A0A], ['karisen dark', 0x73172D],
  ['rogue', 0x494182], ['rogue night', 0x181425],
  ['benefactor', 0x1A7A3E], ['benefactor gold', 0xF9A31B],
  ['hull white', 0xD8E2EC], ['gunmetal', 0x4F4F4F],
];

export class Designer {
  readonly #onClose: () => void;
  #design: Design = stockFor('terran_frigate');
  #derived: Derived = derive(this.#design);
  #socket: string | null = null;
  #tab: 'parts' | 'armour' | 'stats' = 'parts';

  // three
  #renderer: THREE.WebGLRenderer | null = null;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  #hull = new THREE.Group();
  #rig = new THREE.Group();
  #sockets = new THREE.Group();
  #cam = { yaw: 0.7, pitch: 0.35, zoom: 1 };
  #raf = 0;
  #geoms: THREE.BufferGeometry[] = [];
  #mats: THREE.Material[] = [];

  constructor(onClose: () => void) {
    this.#onClose = onClose;
    this.#bind();
  }

  get visible(): boolean { return !$('designer').classList.contains('hidden'); }

  show(): void {
    $('designer').classList.remove('hidden');
    if (!this.#renderer) this.#initThree();
    this.#refresh();
    this.#resize();
    if (!this.#raf) this.#frame();
  }

  hide(): void {
    $('designer').classList.add('hidden');
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0; }
  }

  // ------------------------------------------------------------- three --

  #initThree(): void {
    const cv = $<HTMLCanvasElement>('dzCanvas');
    this.#renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#scene.background = new THREE.Color(0x070a0f);
    this.#scene.add(new THREE.AmbientLight(0x8fa6bd, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 6); this.#scene.add(key);
    const fill = new THREE.DirectionalLight(0x35C7FF, 0.32);
    fill.position.set(-6, -3, -5); this.#scene.add(fill);
    this.#scene.add(this.#hull, this.#rig, this.#sockets);

    // Orbit. One finger drags, two pinch, and the buttons do the same job for
    // anyone who would rather tap. There is no second mouse button on a phone.
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number } | null = null, pinch = 0;
    const gap = () => {
      const v = [...pts.values()];
      const a = v[0], b = v[1];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) drag = { x: e.clientX, y: e.clientY };
      else { drag = null; pinch = gap(); }
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        const d = gap();
        if (pinch > 0 && d > 0) { this.#zoom(pinch / d); pinch = d; }
        return;
      }
      if (!drag) return;
      this.#cam.yaw -= (e.clientX - drag.x) * 0.008;
      this.#cam.pitch = Math.max(-1.35, Math.min(1.35, this.#cam.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (pts.size === 0) drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.#zoom(e.deltaY > 0 ? 1.09 : 0.92); },
      { passive: false });

    if (window.ResizeObserver) new ResizeObserver(() => this.#resize()).observe($('dzView'));
    window.addEventListener('resize', () => this.#resize());
  }

  #zoom(f: number): void { this.#cam.zoom = Math.max(0.4, Math.min(2.8, this.#cam.zoom * f)); }

  #resize(): void {
    if (!this.#renderer) return;
    const box = $('dzView');
    const w = box.clientWidth || 320, h = box.clientHeight || 240;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  #frame = (): void => {
    this.#raf = requestAnimationFrame(this.#frame);
    if (!this.#renderer) return;
    // Framed on the hull's own extent, not on an empty berth, so a small ship
    // does not sit in the corner of a void.
    const cell = RUNG[frameFor(this.#design.classKey).rung];
    const e = this.#derived.extent;
    const fit = Math.max(e[0], e[1], e[2]) * cell * 0.72;
    const dist = (fit / Math.tan(this.#camera.fov * Math.PI / 360)) * this.#cam.zoom;
    const cp = Math.cos(this.#cam.pitch);
    this.#camera.position.set(
      Math.sin(this.#cam.yaw) * cp * dist,
      Math.sin(this.#cam.pitch) * dist,
      Math.cos(this.#cam.yaw) * cp * dist);
    this.#camera.lookAt(0, 0, 0);
    this.#renderer.render(this.#scene, this.#camera);
  };

  // ------------------------------------------------------------ meshes --

  #clear(g: THREE.Group): void {
    while (g.children.length) g.remove(g.children[g.children.length - 1] as THREE.Object3D);
  }

  #dispose(): void {
    for (const g of this.#geoms) g.dispose();
    for (const m of this.#mats) m.dispose();
    this.#geoms = []; this.#mats = [];
  }

  #geo<T extends THREE.BufferGeometry>(g: T): T { this.#geoms.push(g); return g; }
  #mat<T extends THREE.Material>(m: T): T { this.#mats.push(m); return m; }

  /** World position of a cell centre, with the lattice centred on the origin. */
  #pos(cell: number, i: number, j: number, k: number): THREE.Vector3 {
    return new THREE.Vector3(
      (i - NX / 2) * cell, (j - NY / 2) * cell, (k - NZ / 2) * cell);
  }

  /**
   * One part, as a cluster of blocks rather than a cube.
   *
   * A drive is a bell: a cone flaring aft off a short barrel. A gun is a
   * barbette with a barrel on a trunnion, because the archive puts the
   * collider on the base and turns the barrel. A missile cell is a box of
   * tubes. Nothing here is a stat, so all of it is the client's to choose.
   */
  #partMesh(m: ModuleDef, cell: number, tint: number): THREE.Group {
    const g = new THREE.Group();
    const [sx, sy, sz] = m.size;
    const w = sx * cell, h = sy * cell, l = sz * cell;
    const body = this.#mat(new THREE.MeshLambertMaterial({ color: m.colour }));
    const dark = this.#mat(new THREE.MeshLambertMaterial({ color: 0x2A3646 }));
    const lit = this.#mat(new THREE.MeshLambertMaterial({ color: tint }));

    const box = (bw: number, bh: number, bl: number, mat: THREE.Material,
      x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(this.#geo(new THREE.BoxGeometry(bw, bh, bl)), mat);
      mesh.position.set(x, y, z); g.add(mesh); return mesh;
    };
    const cyl = (rt: number, rb: number, len: number, mat: THREE.Material,
      z = 0, seg = 12) => {
      const mesh = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(rt, rb, len, seg)), mat);
      mesh.rotation.x = Math.PI / 2; mesh.position.z = z; g.add(mesh); return mesh;
    };

    switch (m.art) {
      case 'bell':
        // Barrel forward, bell flaring aft. Aft is -z.
        cyl(w * 0.30, w * 0.30, l * 0.40, dark, l * 0.28);
        cyl(w * 0.30, w * 0.50, l * 0.55, body, -l * 0.18);
        cyl(w * 0.46, w * 0.46, l * 0.06, lit, -l * 0.46);
        break;
      case 'nozzle':
        cyl(w * 0.26, w * 0.42, l * 0.85, body, -l * 0.05);
        cyl(w * 0.38, w * 0.38, l * 0.06, lit, -l * 0.46);
        break;
      case 'barbette':
        // The base takes the damage; the ring on top is what turns.
        box(w, h * 0.7, l, body, 0, -h * 0.15, 0);
        cyl(w * 0.34, w * 0.40, h * 0.5, dark, 0).rotation.set(0, 0, 0);
        break;
      case 'beamgun': {
        box(w * 0.9, h * 0.9, l * 0.32, body, 0, 0, -l * 0.30);
        const barrel = cyl(w * 0.14, w * 0.14, l * 0.68, dark, l * 0.20);
        barrel.position.y = h * 0.08;
        cyl(w * 0.20, w * 0.20, l * 0.08, lit, l * 0.50);
        break;
      }
      case 'cannon': {
        box(w * 0.95, h * 0.95, l * 0.42, body, 0, 0, -l * 0.26);
        cyl(w * 0.24, w * 0.28, l * 0.60, dark, l * 0.22);
        cyl(w * 0.30, w * 0.30, l * 0.07, body, l * 0.48);
        break;
      }
      case 'missilecell': {
        // A block of tubes, lids forward.
        box(w, h, l * 0.9, body);
        const r = Math.min(w, h) * 0.16;
        for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) {
          const t = new THREE.Mesh(this.#geo(new THREE.CylinderGeometry(r, r, l * 0.12, 8)), lit);
          t.rotation.x = Math.PI / 2;
          t.position.set(a * w * 0.24, b * h * 0.24, l * 0.48);
          g.add(t);
        }
        break;
      }
      case 'bridge':
        box(w, h * 0.6, l, body);
        box(w * 0.55, h * 0.5, l * 0.5, lit, 0, h * 0.42, l * 0.1);
        break;
      case 'pod':
        box(w, h, l, body);
        for (const s of [-1, 1]) box(w * 0.2, h * 0.2, l * 0.3, dark, s * w * 0.5, 0, 0);
        break;
      case 'strut':
        box(w * 0.5, h * 0.5, l, dark);
        break;
      default:
        box(w, h, l, body);
        box(w * 1.02, h * 0.28, l * 0.28, dark, 0, h * 0.28, 0);
    }
    return g;
  }

  /** Frame spine plus armour shell, rebuilt whenever the design changes. */
  #rebuild(): void {
    this.#dispose();
    this.#clear(this.#hull);
    this.#clear(this.#rig);
    this.#clear(this.#sockets);

    const frame = frameFor(this.#design.classKey);
    const cell = RUNG[frame.rung];
    const d = this.#derived;

    // The spine, which the player cannot edit and therefore never picks.
    const spineMat = this.#mat(new THREE.MeshLambertMaterial({ color: 0x6E829B }));
    for (const [x, y, z, w, h, l] of frame.spine) {
      const mesh = new THREE.Mesh(
        this.#geo(new THREE.BoxGeometry(w * cell, h * cell, l * cell)), spineMat);
      mesh.position.copy(this.#pos(cell, x + w / 2, y + h / 2, z + l / 2));
      this.#rig.add(mesh);
    }

    // The armour shell: a box per plated face, thickness by layer count. It is
    // a shell and not 65,536 cubes because a greedy mesh of a boxy hull is a
    // few hundred quads and drawing every cell is the same picture for two
    // orders of magnitude more work.
    const paint = this.#design.paint;
    const e = d.extent;
    // Thin panels hugging the envelope, not solid slabs. Drawing a nine layer
    // belt at nine cells thick made the armour bigger than the ship and hid
    // everything inside it, which is the opposite of what a designer is for.
    const shellMat = this.#mat(new THREE.MeshLambertMaterial({
      color: paint, transparent: true, opacity: 0.3, depthWrite: false }));
    const edgeMat = this.#mat(new THREE.LineBasicMaterial({
      color: paint, transparent: true, opacity: 0.55 }));
    const face = (w: number, h: number, l: number, x: number, y: number, z: number) => {
      const geo = this.#geo(new THREE.BoxGeometry(w * cell, h * cell, l * cell));
      const mesh = new THREE.Mesh(geo, shellMat);
      mesh.position.set(x * cell, y * cell, z * cell);
      this.#hull.add(mesh);
      // An outline, so a plated face still reads as a surface at low opacity.
      const line = new THREE.LineSegments(this.#geo(new THREE.EdgesGeometry(geo)), edgeMat);
      line.position.copy(mesh.position);
      this.#hull.add(line);
    };
    const s = this.#design.sections;
    // Layers drive the thickness but do not equal it. Nine layers of plate is
    // a heavier belt, not a belt three quarters the width of the ship.
    const t = (layers: number) => 0.4 + layers * 0.35;
    if (s.dorsal > 0) face(e[0], t(s.dorsal), e[2], 0, (e[1] + t(s.dorsal)) / 2, 0);
    if (s.ventral > 0) face(e[0], t(s.ventral), e[2], 0, -(e[1] + t(s.ventral)) / 2, 0);
    if (s.bow > 0) face(e[0], e[1], t(s.bow), 0, 0, (e[2] + t(s.bow)) / 2);
    if (s.stern > 0) face(e[0], e[1], t(s.stern), 0, 0, -(e[2] + t(s.stern)) / 2);
    // The three belt bands, fore to aft, which is what lets a player armour
    // the middle and leave the ends thin.
    const bands: Array<[SectionKey, number]> = [
      ['beltFwd', e[2] / 3], ['beltMid', 0], ['beltAft', -e[2] / 3]];
    for (const [k, z] of bands) {
      const n = s[k];
      if (n <= 0) continue;
      for (const side of [-1, 1]) {
        face(t(n), e[1], e[2] / 3, side * (e[0] + t(n)) / 2, 0, z);
      }
    }

    // Every part on its socket, and every empty socket as a marker you can hit.
    const socketMat = this.#mat(new THREE.MeshBasicMaterial({
      color: 0x35C7FF, transparent: true, opacity: 0.5, wireframe: true }));
    const pickedMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xFFD24B, wireframe: true }));
    for (const sock of frame.sockets) {
      const held = this.#design.parts.find(p => p.socket === sock.id);
      const at = this.#pos(cell, sock.at[0], sock.at[1], sock.at[2]);
      if (held) {
        const m = moduleById(held.module);
        if (!m) continue;
        const g = this.#partMesh(m, cell, paint);
        g.position.copy(at);
        this.#hull.add(g);
      }
      if (!held || this.#socket === sock.id) {
        const mk = new THREE.Mesh(
          this.#geo(new THREE.BoxGeometry(cell * 2.2, cell * 2.2, cell * 2.2)),
          this.#socket === sock.id ? pickedMat : socketMat);
        mk.position.copy(at);
        this.#sockets.add(mk);
      }
    }
  }

  // -------------------------------------------------------------- panels --

  #refresh(): void {
    this.#derived = derive(this.#design);
    this.#rebuild();
    this.#renderClasses();
    this.#renderSockets();
    this.#renderPalette();
    this.#renderArmour();
    this.#renderStats();
    this.#renderHeader();
  }

  #renderHeader(): void {
    const d = this.#derived;
    $('dzMass').textContent = `${d.mass.toFixed(3)} / ${d.massMax.toFixed(2)}`;
    $('dzHull').textContent = d.hull.toFixed(0);
    $('dzParts').textContent = String(d.parts);
    const v = $('dzVerdict');
    const bad = d.checks.filter(c => !c.ok).length;
    v.textContent = d.legal ? 'legal' : `illegal, ${bad} failed`;
    v.className = `dzv ${d.legal ? 'ok' : 'bad'}`;
  }

  #renderClasses(): void {
    const host = $('dzClasses');
    host.innerHTML = '';
    for (const f of FRAMES) {
      const b = document.createElement('button');
      b.textContent = f.name.replace(' Frigate', '');
      b.className = f.classKey === this.#design.classKey ? 'on' : '';
      // A class change re-seeds the frame, the sockets and the ship. Anything
      // less would leave a Terran's gun rings on a hull that has none.
      b.onclick = () => {
        if (f.classKey === this.#design.classKey) return;
        this.#design = stockFor(f.classKey);
        this.#socket = null;
        this.#refresh();
      };
      host.appendChild(b);
    }
    $('dzFrameNote').textContent = frameFor(this.#design.classKey).note;
  }

  #renderSockets(): void {
    const frame = frameFor(this.#design.classKey);
    const host = $('dzSockets');
    host.innerHTML = '';
    const order: Array<[string, string]> = [
      ['drive', 'Drive'], ['retro', 'Retro'], ['rcs', 'Manoeuvring'],
      ['gun', 'Gun rings'], ['missile', 'Missile pads'],
      ['bay', 'Bays'], ['clamp', 'Clamps'],
    ];
    for (const [kind, label] of order) {
      const list = frame.sockets.filter(s => s.kind === kind);
      if (!list.length) continue;
      const h = document.createElement('div');
      h.className = 'dzgrp';
      h.textContent = label;
      host.appendChild(h);
      const row = document.createElement('div');
      row.className = 'dzrow';
      for (const s of list) {
        const held = this.#design.parts.find(p => p.socket === s.id);
        const b = document.createElement('button');
        b.className = 'dzsock' + (this.#socket === s.id ? ' on' : '') + (held ? ' full' : '');
        b.title = s.label;
        b.textContent = held ? (moduleById(held.module)?.id ?? '?') : 'empty';
        b.onclick = () => { this.#socket = this.#socket === s.id ? null : s.id; this.#refresh(); };
        row.appendChild(b);
      }
      host.appendChild(row);
    }
  }

  #renderPalette(): void {
    const host = $('dzPalette');
    host.innerHTML = '';
    const frame = frameFor(this.#design.classKey);
    const sock = frame.sockets.find(s => s.id === this.#socket);
    if (!sock) {
      host.innerHTML = '<p class="dznote">Pick a socket to see what fits it. '
        + 'A drive plate offers bells, a gun ring offers a barbette, and a barbette '
        + 'offers a gun. You never edit a part and never add a socket.</p>';
      return;
    }
    const head = document.createElement('div');
    head.className = 'dzgrp';
    head.textContent = sock.label;
    host.appendChild(head);

    const fits = MODULES.filter(m => m.fits === sock.kind);
    const held = this.#design.parts.find(p => p.socket === sock.id);
    for (const m of fits) {
      const b = document.createElement('button');
      b.className = 'dzpart' + (held?.module === m.id ? ' on' : '');
      const gun = m.weapon ? GUNS.find(g => g.key === m.weapon) : undefined;
      b.innerHTML = `<span class="sw" style="background:#${m.colour.toString(16).padStart(6, '0')}"></span>`
        + `<span class="nm">${m.name}</span>`
        + `<span class="num">${(m.mass / 1e6).toFixed(3)}</span>`
        + `<span class="sub">${m.size[0]} x ${m.size[1]} x ${m.size[2]} cells`
        + (m.thrust ? ` &middot; thrust ${m.thrust}, exhaust ${m.exhaust?.toFixed(1)}` : '')
        + (m.retro ? ` &middot; retro ${m.retro}` : '')
        + (m.latX || m.latY ? ` &middot; lateral ${m.latX ?? 0} by ${m.latY ?? 0}` : '')
        + (gun ? ` &middot; ${gun.dmg} dmg, ${gun.range} u, pen ${gun.pen}` : '')
        + (m.marines ? ` &middot; ${m.marines} marines` : '')
        + (m.capacity ? ` &middot; capacity ${m.capacity}` : '')
        + (m.reach ? ` &middot; reach +${m.reach} u` : '')
        + '</span>';
      b.onclick = () => { this.#fit(sock.id, m.id); };
      host.appendChild(b);
    }
    if (held) {
      const c = document.createElement('button');
      c.className = 'dzpart clear';
      c.innerHTML = '<span class="sw" style="background:#2b3d52"></span>'
        + '<span class="nm">Clear this socket</span>';
      c.onclick = () => { this.#fit(sock.id, null); };
      host.appendChild(c);
    }
  }

  #fit(socket: string, module: string | null): void {
    this.#design.parts = this.#design.parts.filter(p => p.socket !== socket);
    if (module) this.#design.parts.push({ socket, module });
    this.#refresh();
  }

  #renderArmour(): void {
    const host = $('dzArmour');
    host.innerHTML = '';
    const names: Record<SectionKey, string> = {
      bow: 'Bow', stern: 'Stern', port: 'Port', starboard: 'Starboard',
      dorsal: 'Dorsal', ventral: 'Ventral',
      beltFwd: 'Belt, forward', beltMid: 'Belt, midships', beltAft: 'Belt, aft',
    };
    for (const k of SECTIONS) {
      if (k === 'port' || k === 'starboard') continue;   // the belt bands are the flanks
      const n = this.#design.sections[k];
      const row = document.createElement('label');
      row.className = 'dzslider';
      row.innerHTML = `<span class="k">${names[k]}</span>`
        + `<input type="range" min="0" max="15" step="1" value="${n}">`
        + `<b>${n}</b><span class="pc">${n > 0 ? blockPct(n).toFixed(0) + '%' : 'bare'}</span>`;
      const input = row.querySelector('input') as HTMLInputElement;
      input.oninput = () => {
        this.#design.sections[k] = Number(input.value);
        this.#refresh();
      };
      host.appendChild(row);
    }

    const paint = $('dzPaint');
    paint.innerHTML = '';
    for (const [name, col] of PAINTS) {
      const b = document.createElement('button');
      b.className = 'dzsw' + (col === this.#design.paint ? ' on' : '');
      b.style.background = `#${col.toString(16).padStart(6, '0')}`;
      b.title = name;
      b.onclick = () => { this.#design.paint = col; this.#refresh(); };
      paint.appendChild(b);
    }
  }

  #renderStats(): void {
    const d = this.#derived;
    const row = (k: string, v: string, bad = false) =>
      `<div class="dzr${bad ? ' zero' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

    let h = '<div class="dzchecks">';
    for (const c of d.checks) {
      h += `<div class="dzck${c.ok ? '' : ' no'}"><span class="mk">${c.ok ? '+' : '!'}</span>`
        + `<span class="bd"><span class="h">${c.label}</span>`
        + `<span class="s">${c.detail}</span></span></div>`;
    }
    h += '</div>';

    h += '<div class="dzgrp">Hull</div><div class="dzrows">';
    h += row('mass', `${d.mass.toFixed(3)} of ${d.massMax.toFixed(2)}`, d.mass > d.massMax);
    h += row('hull', d.hull.toFixed(0));
    h += row('bounding radius', `${d.radius.toFixed(2)} u`);
    h += row('extent', `${d.extent[0]} x ${d.extent[1]} x ${d.extent[2]} cells`);
    h += row('plate cells', String(d.plateCells));
    h += '</div>';

    h += '<div class="dzgrp">Flight</div><div class="dzrows">';
    h += row('accel forward', `${d.accelFwd.toFixed(2)} u/s2`, d.accelFwd === 0);
    h += row('accel retro', `${d.accelRetro.toFixed(2)} u/s2`, d.accelRetro === 0);
    h += row('accel lateral', `${d.accelLat.toFixed(2)} u/s2`, d.accelLat === 0);
    h += row('top speed', `${d.maxSpeed.toFixed(1)} u/s`, d.maxSpeed === 0);
    h += row('yaw', `${d.yaw.toFixed(1)} deg/s`);
    h += row('pitch', `${d.pitch.toFixed(1)} deg/s`);
    h += row('reach, 10 s', `${d.reachU.toFixed(1)} u`);
    h += '</div>';

    h += '<div class="dzgrp">Guns</div>';
    if (!d.mounts.length) {
      h += '<p class="dznote">Nothing fitted. The Freighter frame has no gun ring at all, '
        + 'which is the authored empty mount table as geometry.</p>';
    } else {
      h += '<div class="dzrows">';
      for (const mt of d.mounts) {
        const g = GUNS.find(x => x.key === mt.key);
        if (!g) continue;
        h += row(`${mt.n} x ${g.name}`,
          `${g.dmg} dmg${g.batch > 1 ? ` x${g.batch}` : ''} &middot; ${g.range} u &middot; ${g.cooldown}s &middot; pen ${g.pen}`);
      }
      h += '</div>';
      // What each gun gets through THIS ship's own belt, which is the whole
      // reason penetration exists as a field.
      h += `<div class="dzgrp">Through a ${d.belt} layer belt</div><div class="dzrows">`;
      for (const g of GUNS) {
        h += row(g.name, `${throughArmour(g, d.belt).toFixed(1)}${g.batch > 1 ? ` x${g.batch}` : ''}`);
      }
      h += '</div>';
    }

    h += '<div class="dzgrp">Boarding</div><div class="dzrows">';
    h += row('marines', String(d.marines));
    h += row('capacity', String(d.capacity));
    h += row('range', `${d.boardingRange} u`);
    h += '</div>';

    $('dzStats').innerHTML = h;
  }

  // ------------------------------------------------------------- wiring --

  #bind(): void {
    $('dzClose').onclick = () => { this.hide(); this.#onClose(); };
    $('dzReset').onclick = () => {
      this.#design = stockFor(this.#design.classKey);
      this.#socket = null;
      this.#refresh();
    };
    $('dzStrip').onclick = () => {
      this.#design.parts = [];
      for (const k of SECTIONS) this.#design.sections[k] = 0;
      this.#refresh();
    };
    const tab = (id: string, which: 'parts' | 'armour' | 'stats') => {
      $(id).onclick = () => { this.#tab = which; this.#syncTabs(); };
    };
    tab('dzTabParts', 'parts'); tab('dzTabArmour', 'armour'); tab('dzTabStats', 'stats');
    this.#syncTabs();
  }

  #syncTabs(): void {
    for (const [id, pane, which] of [
      ['dzTabParts', 'dzPaneParts', 'parts'],
      ['dzTabArmour', 'dzPaneArmour', 'armour'],
      ['dzTabStats', 'dzPaneStats', 'stats'],
    ] as const) {
      $(id).className = this.#tab === which ? 'on' : '';
      $(pane).classList.toggle('hidden', this.#tab !== which);
    }
    this.#resize();
  }

  /** Read only, for the harness. It observes and never drives. */
  debug() {
    return {
      classKey: this.#design.classKey,
      parts: this.#design.parts.length,
      socket: this.#socket,
      derived: this.#derived,
      stockCount: STOCK.length,
    };
  }
}
