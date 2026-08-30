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
  FACTION_PAINT, PURPOSE, PURPOSE_ORDER,
  derive, frameFor, moduleById, stockFor, blockPct, throughArmour,
  socketsOf, rasterise, cellColour, armourColour, hullAt, paintFor, Mat,
  type Design, type Derived, type SectionKey, type ArmourMode,
} from './design.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

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
  #voxelCount = 0;
  #liveryColours = 0;
  #gridHash = 0;
  #showPlate = true;
  #hist: Record<string, number> = {};
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
   * Draw the grid the core would read. It is not built here: `rasterise()` in
   * design.ts builds it, and `derive()` costs the very same cells, so the
   * picture and the mass cannot be two opinions about one hull.
   *
   * The client's whole job in this method is which cells are visible and what
   * colour they are. Both are presentation: a second client that culled
   * differently would draw a different picture of the same ship and never
   * desync.
   */
  #rebuild(): void {
    this.#dispose();
    this.#clear(this.#hull);
    this.#clear(this.#rig);
    this.#clear(this.#sockets);

    const frame = frameFor(this.#design.classKey);
    const cell = RUNG[frame.rung];
    const { grid, purp } = rasterise(this.#design);
    const idx = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

    // The livery needs the hull's own shape to know where a stripe or an
    // underside is. Read once per station rather than per cell: it is the same
    // answer 1024 times over.
    const prof = frame.profile;
    const z0 = Math.round(prof[0]![0]), z1 = Math.round(prof[prof.length - 1]![0]);
    const hwAt = new Float32Array(NZ), hhAt = new Float32Array(NZ);
    for (let k = 0; k < NZ; k++) {
      const st = hullAt(prof, k);
      hwAt[k] = st[0] as number;
      hhAt[k] = st[1] as number;
    }
    const sw = paintFor(this.#design.faction).swatches;

    // --- draw only what can be seen ---------------------------------------
    // A cell with all six neighbours filled is invisible, and on a plated hull
    // that is most of them, so culling here is the difference between a few
    // thousand instances and tens of thousands.
    // Taking the plate off has to take it out of the VISIBILITY pass too, not
    // just out of the draw call. A part buried under four layers of armour is
    // an interior cell either way, so hiding the plate while still culling
    // against it leaves an empty screen. This is the x ray.
    // A skinned frame member is plate while the plate is on and frame the
    // moment it comes off, which is the only way both readings are true.
    const view = this.#showPlate
      ? grid.map(m => (m === Mat.Skinned ? Mat.Plate : m)) as Uint8Array
      : grid.map(m => (m === Mat.Plate ? Mat.Empty : m === Mat.Skinned ? Mat.Frame : m)) as Uint8Array;

    const solid: number[] = [], solidCol: number[] = [];
    const skin: number[] = [], skinCol: number[] = [];
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const n = idx(i, j, k);
      const mat = view[n] as number;
      if (!mat) continue;
      const hidden =
        i > 0 && view[idx(i - 1, j, k)] && i < NX - 1 && view[idx(i + 1, j, k)] &&
        j > 0 && view[idx(i, j - 1, k)] && j < NY - 1 && view[idx(i, j + 1, k)] &&
        k > 0 && view[idx(i, j, k - 1)] && k < NZ - 1 && view[idx(i, j, k + 1)];
      if (hidden) continue;
      if (mat === Mat.Plate) {
        skin.push(i, j, k);
        skinCol.push(armourColour(sw, this.#design.paint, i, j, k, z0, z1,
          hwAt[k] as number, hhAt[k] as number));
      } else {
        solid.push(i, j, k);
        solidCol.push(cellColour(mat, purp[n] as number, this.#design.paint));
      }
    }
    this.#voxelCount = solid.length / 3 + skin.length / 3;
    // How many of the faction's eight actually reached the hull. One means a
    // paint bucket rather than a livery, which is the thing this replaced.
    this.#liveryColours = new Set(skinCol).size;
    // FNV-1a over the occupancy grid. It exists so the harness can OBSERVE
    // that a rotation moved cells; nothing reads it back into the editor.
    let hsh = 0x811c9dc5;
    for (let q = 0; q < grid.length; q++) {
      hsh ^= grid[q] as number;
      hsh = Math.imul(hsh, 0x01000193) >>> 0;
    }
    this.#gridHash = hsh;
    const hist: Record<number, number> = {};
    for (let n = 0; n < grid.length; n++)
      if (grid[n]) hist[grid[n] as number] = (hist[grid[n] as number] ?? 0) + 1;
    this.#hist = { ...hist, solid: solid.length / 3, skin: skin.length / 3 };

    const place = (cells: number[], material: THREE.Material,
      colourAt: ((n: number) => number) | null) => {
      const n = cells.length / 3;
      if (!n) return;
      const geo = this.#geo(new THREE.BoxGeometry(cell, cell, cell));
      const inst = new THREE.InstancedMesh(geo, material, n);
      const mx = new THREE.Matrix4(), col = new THREE.Color();
      for (let q = 0; q < n; q++) {
        mx.setPosition(
          ((cells[q * 3] as number) - NX / 2 + 0.5) * cell,
          ((cells[q * 3 + 1] as number) - NY / 2 + 0.5) * cell,
          ((cells[q * 3 + 2] as number) - NZ / 2 + 0.5) * cell);
        inst.setMatrixAt(q, mx);
        if (colourAt) inst.setColorAt(q, col.setHex(colourAt(q)));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.#hull.add(inst);
    };

    // The structure inside, each cell in its own job's colour: orange is a
    // drive on anybody's ship, red is a gun, green is the bridge. That is what
    // makes an unfamiliar hull readable without a legend, and it is why the
    // paint bucket is not allowed in here.
    place(solid, this.#mat(new THREE.MeshLambertMaterial({})),
      q => solidCol[q] as number);
    // The plate over it, in the faction's whole scheme rather than one colour:
    // panels, an underside, a dorsal spine, a waist stripe, a nose flash and a
    // transom band, all eight swatches on the hull at once. Opaque, because
    // four layers of see through armour stacked on itself is mush rather than
    // a window: the way to look inside a ship is to take the plate off.
    place(skin, this.#mat(new THREE.MeshLambertMaterial({})),
      q => skinCol[q] as number);

    // --- sockets, as markers rather than solids ----------------------------
    const allSockets = socketsOf(frame, this.#design.parts);
    const socketMat = this.#mat(new THREE.MeshBasicMaterial({
      color: 0x35C7FF, transparent: true, opacity: 0.45, wireframe: true }));
    const pickedMat = this.#mat(new THREE.MeshBasicMaterial({ color: 0xFFD24B, wireframe: true }));
    for (const sock of allSockets) {
      const held = this.#design.parts.find(p => p.socket === sock.id);
      if (held && this.#socket !== sock.id) continue;
      const mk = new THREE.Mesh(
        this.#geo(new THREE.BoxGeometry(cell * 2.4, cell * 2.4, cell * 2.4)),
        this.#socket === sock.id ? pickedMat : socketMat);
      mk.position.copy(this.#pos(cell, sock.at[0], sock.at[1], sock.at[2]));
      this.#sockets.add(mk);
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
    this.#renderKey();
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
    // The frame's own sockets PLUS the ones its parts opened. Listing only the
    // frame's left every trunnion off the panel, so the stock ships shipped
    // with guns nobody could reach: the barbette is what carries a gun, and
    // the barbette is a part.
    const all = socketsOf(frame, this.#design.parts);
    const order: Array<[string, string]> = [
      ['drive', 'Drive'], ['retro', 'Retro'], ['rcs', 'Manoeuvring'],
      ['gun', 'Gun rings'], ['trunnion', 'Trunnions'], ['missile', 'Missile pads'],
      ['bay', 'Bays'], ['clamp', 'Clamps'],
    ];
    for (const [kind, label] of order) {
      const list = all.filter(s => s.kind === kind);
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
    const sock = socketsOf(frame, this.#design.parts).find(s => s.id === this.#socket);
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
      // Which way it faces is the player's. Four positions, because the part
      // is a volume of cells and four is how many orientations leave it one.
      const rot = held.rot ?? 0;
      const turn = document.createElement('div');
      turn.className = 'dzturn';
      turn.innerHTML = '<span class="k">Facing</span>';
      for (const [label, delta] of [['\u21ba 90', 3], ['\u21bb 90', 1]] as const) {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = () => { this.#turn(sock.id, delta); };
        turn.appendChild(b);
      }
      const deg = document.createElement('b');
      deg.textContent = `${rot * 90}\u00b0`;
      turn.appendChild(deg);
      host.appendChild(turn);

      const c = document.createElement('button');
      c.className = 'dzpart clear';
      c.innerHTML = '<span class="sw" style="background:#2b3d52"></span>'
        + '<span class="nm">Clear this socket</span>';
      c.onclick = () => { this.#fit(sock.id, null); };
      host.appendChild(c);
    }
  }

  #fit(socket: string, module: string | null): void {
    const rot = this.#design.parts.find(p => p.socket === socket)?.rot ?? 0;
    this.#design.parts = this.#design.parts.filter(p => p.socket !== socket);
    if (module) this.#design.parts.push({ socket, module, rot });
    this.#refresh();
  }

  #turn(socket: string, delta: number): void {
    this.#design.parts = this.#design.parts.map(p => p.socket === socket
      ? { socket: p.socket, module: p.module, rot: (((p.rot ?? 0) + delta) % 4 + 4) % 4 }
      : p);
    this.#refresh();
  }

  #renderArmour(): void {
    // --- which exterior is being edited -----------------------------------
    // The frame is in neither list. A player works inside its constraints or
    // adds to what hangs on it, and cannot move a single cell of it.
    const mode = $('dzMode');
    mode.innerHTML = '';
    for (const [key, label, hint] of [
      ['wrapped', 'Class hull', 'restore the class hull and its authored layers'],
      ['skin', 'From scratch', 'take the whole exterior off and build your own'],
    ] as ReadonlyArray<readonly [ArmourMode, string, string]>) {
      const b = document.createElement('button');
      b.className = this.#design.armour === key ? 'on' : '';
      b.textContent = label;
      b.title = hint;
      // Each mode lands somewhere a player can work from. Carrying a four
      // layer belt across into the dilated skin buried the whole ship in one
      // blue lump, over budget, with nothing left to read.
      b.onclick = () => {
        if (this.#design.armour === key) return;
        this.#design.armour = key;
        const stockSec = stockFor(this.#design.classKey).sections;
        for (const k of SECTIONS)
          this.#design.sections[k] = key === 'wrapped' ? stockSec[k] : 0;
        this.#refresh();
      };
      mode.appendChild(b);
    }
    $('dzModeNote').textContent = this.#design.armour === 'wrapped'
      ? 'The class hull: plate laid on the frame\u2019s own profile, which is what '
        + 'gives the class its silhouette. What you are changing is its thickness.'
      : 'Your own exterior: plate grown off the parts themselves and nothing else, '
        + 'so it follows what you built rather than what the class is. It starts '
        + 'bare and it still has to fit the mass budget.';

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

    // --- paint, which reaches the armour and nothing else -----------------
    const fac = $('dzFactions');
    fac.innerHTML = '';
    for (const f of FACTION_PAINT) {
      const b = document.createElement('button');
      b.className = f.key === this.#design.faction ? 'on' : '';
      b.textContent = f.name;
      b.onclick = () => {
        this.#design.faction = f.key;
        // Land on the scheme's first swatch, because a faction whose colours
        // are not on the ship is a menu rather than a choice.
        this.#design.paint = f.swatches[0] as number;
        this.#refresh();
      };
      fac.appendChild(b);
    }

    const paint = $('dzPaint');
    paint.innerHTML = '';
    const scheme = paintFor(this.#design.faction);
    for (const col of scheme.swatches) {
      const b = document.createElement('button');
      b.className = 'dzsw' + (col === this.#design.paint ? ' on' : '');
      b.style.background = `#${col.toString(16).padStart(6, '0')}`;
      b.title = `#${col.toString(16).padStart(6, '0')}`;
      b.onclick = () => { this.#design.paint = col; this.#refresh(); };
      paint.appendChild(b);
    }
  }

  /** The colour key. Eight jobs, eight hues, the same on every faction. */
  #renderKey(): void {
    const host = $('dzKey');
    host.innerHTML = '';
    for (const key of PURPOSE_ORDER) {
      const p = PURPOSE[key];
      const row = document.createElement('span');
      row.className = 'dzkey';
      row.innerHTML = `<span class="sw" style="background:#${p.base.toString(16).padStart(6, '0')}"></span>`
        + `<span class="nm">${p.label}</span>`;
      host.appendChild(row);
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
    $('dzPlate').onclick = () => {
      this.#showPlate = !this.#showPlate;
      $('dzPlate').className = this.#showPlate ? 'on' : '';
      $('dzPlate').textContent = this.#showPlate ? 'Plate on' : 'Plate off';
      this.#refresh();
    };
    $('dzStrip').onclick = () => {
      this.#design.parts = [];
      for (const k of SECTIONS) this.#design.sections[k] = 0;
      this.#refresh();
    };
    // Take the plate off and leave the frame and its parts standing. The mode
    // is left alone: this zeroes whichever exterior is being edited.
    $('dzBare').onclick = () => {
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
      voxels: this.#voxelCount,
      showPlate: this.#showPlate,
      armour: this.#design.armour,
      livery: this.#liveryColours,
      gridHash: this.#gridHash,
      faction: this.#design.faction,
      paint: this.#design.paint,
      hist: this.#hist,
    };
  }
}
