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
  FACTION_PAINT, PURPOSE_ORDER,
  derive, frameFor, moduleById, stockFor, blockPct, throughArmour,
  socketsOf, rasterise, cellColour, armourColour, hullAt, paintFor, Mat, PURPOSE,
  gunByKey, allRound, zeroSections,
  type Design, type Derived, type SectionKey, type ArmourMode, type GunDef,
} from './design.js';

/** What the plate is doing: solid, see through, or off. */
type PlateView = 'on' | 'ghost' | 'off';

/**
 * Gunnery preview: two independent switches, not one three way cycle.
 *
 * They were one button reading "Arcs off / Arcs on / Tracking", and the target
 * was three presses deep behind a label that never mentioned it. Two toggles
 * that each say what they do: you can watch the wedges without the target, or
 * the target without the wedges.
 */

/** One turret drawn in its own group so it can be swung without the hull. */
interface Rig {
  readonly group: THREE.Group;
  readonly gun: GunDef;
  readonly pivot: THREE.Vector3;
  /** The rest facing the player set, in radians about the up axis. */
  readonly rest: number;
  readonly label: string;
  /** Whether the target was inside this turret's arc on the last frame. */
  bears: boolean;
  /** Where the barrel is now, in radians about the mount. It eases toward the
   *  goal rather than jumping: a turret that snaps reads as a texture swap. */
  yaw: number;
  pitch: number;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** What the shipyard knows about where the open design came from. */
export interface DesignSlot {
  readonly designId: string | null;
  readonly name: string;
  /** Whether it is the signed in account's own, and so updatable in place. */
  readonly mine: boolean;
  readonly owner?: string;
}

export class Designer {
  readonly #onClose: () => void;
  /**
   * Saving is the host's job, not the shipyard's.
   *
   * The editor draws and collects input; talking to the library is a network
   * concern and belongs where the other network concerns are. This is the one
   * seam between them: hand over a name, a record and the client's own figures,
   * get back where it ended up.
   */
  #onSave: ((req: {
    name: string; design: Design; mass: number; hull: number; legal: boolean;
    designId: string | null; from: string | null;
  }) => Promise<DesignSlot>) | null = null;
  #slot: DesignSlot = { designId: null, name: '', mine: false };
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
  #plate: PlateView = 'on';
  /** Cells behind each drawn mesh, so a click can be turned back into a part. */
  #pickable: Array<{ mesh: THREE.InstancedMesh; cells: number[] }> = [];
  #ray = new THREE.Raycaster();
  #note: string | null = null;
  #marks = new THREE.Group();
  #arcs = new THREE.Group();
  #rigs: Rig[] = [];
  #showArcs = false;
  #showTarget = false;
  #target = new THREE.Vector3();
  #clock = 0;
  #last = performance.now();
  /** Where the hull actually is in the lattice, so the camera looks at it. */
  #centre = new THREE.Vector3();
  /** Half extents of the drawn hull, for framing it rather than its sphere. */
  #half = new THREE.Vector3(1, 1, 1);
  #hist: Record<string, number> = {};
  #geoms: THREE.BufferGeometry[] = [];
  #mats: THREE.Material[] = [];

  constructor(onClose: () => void) {
    this.#onClose = onClose;
    this.#bind();
  }

  onSave(fn: NonNullable<Designer['saveHandler']>): void { this.#onSave = fn; }
  /** Only for the type above; never called. */
  declare saveHandler: (req: {
    name: string; design: Design; mass: number; hull: number; legal: boolean;
    designId: string | null; from: string | null;
  }) => Promise<DesignSlot>;

  /**
   * Open a record from the library. It arrives as a WORKING COPY: editing it
   * changes nothing anywhere until it is saved, and saving somebody else's
   * makes a new row rather than touching theirs.
   */
  loadDesign(d: Design, slot: DesignSlot): void {
    this.#design = {
      classKey: d.classKey,
      parts: (d.parts ?? []).map(p => ({ ...p })),
      sections: { ...zeroSections(), ...(d.sections ?? {}) },
      armour: d.armour === 'skin' ? 'skin' : 'wrapped',
      faction: typeof d.faction === 'string' ? d.faction : 'terran',
      paint: typeof d.paint === 'number' ? d.paint : 0x0095E9,
    };
    this.#slot = slot;
    this.#socket = null;
    this.#note = null;
    this.#said('');
    if (this.#renderer) this.#refresh();
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
    this.#scene.add(this.#hull, this.#rig, this.#sockets, this.#marks, this.#arcs);

    // Orbit. One finger drags, two pinch, and the buttons do the same job for
    // anyone who would rather tap. There is no second mouse button on a phone.
    const pts = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number } | null = null, pinch = 0;
    const gap = () => {
      const v = [...pts.values()];
      const a = v[0], b = v[1];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    // A tap picks and a drag orbits, told apart by how far the pointer moved.
    // There is no second mouse button on a phone and no hover either, so the
    // only gesture that can name a part is the one that also turns the camera.
    let downAt: { x: number; y: number; t: number } | null = null;
    let moved = 0;
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY };
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
        moved = 0;
      } else { drag = null; pinch = gap(); downAt = null; }
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
      moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      this.#cam.yaw -= (e.clientX - drag.x) * 0.008;
      this.#cam.pitch = Math.max(-1.35, Math.min(1.35, this.#cam.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      const tap = downAt && pts.size === 1 && moved < 6
        && performance.now() - downAt.t < 700;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (pts.size === 0) { drag = null; downAt = null; }
      if (tap) this.#pickAt(e.clientX, e.clientY);
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
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.#last) / 1000);
    this.#last = now;
    this.#aimTurrets(dt);
    // Framed on the hull's own extent, not on an empty berth, so a small ship
    // does not sit in the corner of a void.
    // Frame the hull's BOX as it actually projects, not its sphere.
    //
    // A frigate is six units long and three across, so its sphere is mostly
    // empty: fitting the sphere left a third of a phone's screen as margin the
    // ship was never going to reach. This projects the eight corners onto the
    // camera's own right and up axes and solves for the distance that just
    // contains them, in both angles, so the ship fills whatever shape the
    // viewport happens to be.
    const fovV = this.#camera.fov * Math.PI / 180;
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * Math.max(0.05, this.#camera.aspect));
    const cp0 = Math.cos(this.#cam.pitch), sp0 = Math.sin(this.#cam.pitch);
    const cy0 = Math.cos(this.#cam.yaw), sy0 = Math.sin(this.#cam.yaw);
    const fwd = new THREE.Vector3(-sy0 * cp0, -sp0, -cy0 * cp0);   // camera looks in
    const right = new THREE.Vector3(-cy0, 0, sy0);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const h = this.#half;
    // Solve the eight corners exactly. A corner at offset c sits at depth
    // D + c.fwd, so it stays in frame when D >= |c.right| / tanH - c.fwd, and
    // likewise vertically; the answer is the largest of those sixteen bounds.
    // Allowing for the box's whole depth instead pushed the camera back far
    // enough for its NEAREST face, which on a six unit ship was a third of the
    // screen given away as margin.
    const tanH = Math.tan(fovH / 2), tanV = Math.tan(fovV / 2);
    let need = 0;
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2)
      for (let sz = -1; sz <= 1; sz += 2) {
        const ox = sx * h.x, oy = sy * h.y, oz = sz * h.z;
        const u = Math.abs(ox * right.x + oy * right.y + oz * right.z);
        const v = Math.abs(ox * up.x + oy * up.y + oz * up.z);
        const w = ox * fwd.x + oy * fwd.y + oz * fwd.z;
        need = Math.max(need, u / tanH - w, v / tanV - w);
      }
    const dist = Math.max(0.4, need * 1.05) * this.#cam.zoom;
    const c = this.#centre;
    const cp = Math.cos(this.#cam.pitch);
    this.#camera.position.set(
      c.x + Math.sin(this.#cam.yaw) * cp * dist,
      c.y + Math.sin(this.#cam.pitch) * dist,
      c.z + Math.cos(this.#cam.yaw) * cp * dist);
    this.#camera.lookAt(c);
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
    this.#clear(this.#marks);
    this.#clear(this.#arcs);
    this.#pickable = [];

    const frame = frameFor(this.#design.classKey);
    const cell = RUNG[frame.rung];
    const { grid, purp, own } = rasterise(this.#design);
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
    //
    // Ghost is the same x ray with the armour still drawn, one layer of it,
    // see through and not writing depth. Only the OUTER surface: four courses
    // of translucent plate stacked on themselves is mush, which is why the
    // toggle used to be on or off and nothing in between.
    const solidView = this.#plate === 'on'
      ? grid.map(m => (m === Mat.Skinned ? Mat.Plate : m)) as Uint8Array
      : grid.map(m => (m === Mat.Plate ? Mat.Empty
        : m === Mat.Skinned ? Mat.Frame : m)) as Uint8Array;
    const isPlate = (m: number) => m === Mat.Plate || m === Mat.Skinned;

    // Which placements are guns, and where each one turns. A turret is drawn
    // in a group of its own so the preview can swing it without moving the
    // hull it is bolted to.
    this.#rigs = [];
    const rigOf = new Map<number, number>();          // placement index -> rig
    const rigCells: number[][] = [], rigCols: number[][] = [];
    const allSock = socketsOf(frame, this.#design.parts);
    this.#design.parts.forEach((p, n) => {
      const m = moduleById(p.module);
      const g = m?.weapon ? gunByKey(m.weapon) : undefined;
      if (!m || !g) return;
      const sock = allSock.find(sk => sk.id === p.socket);
      if (!sock) return;
      const group = new THREE.Group();
      const pivot = this.#pos(cell, sock.at[0], sock.at[1], sock.at[2]);
      group.position.copy(pivot);
      group.rotation.order = 'YXZ';
      rigOf.set(n, this.#rigs.length);
      rigCells.push([]); rigCols.push([]);
      this.#rigs.push({ group, gun: g, pivot, rest: -(p.rot ?? 0) * Math.PI / 2,
        label: `${m.name}, ${sock.label}`, bears: false, yaw: 0, pitch: 0 });
      this.#hull.add(group);
    });

    const solid: number[] = [], solidCol: number[] = [];
    const skin: number[] = [], skinCol: number[] = [];
    const shown = (n: number) => solidView[n] as number;
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const n = idx(i, j, k);
      const mat = shown(n);
      if (!mat) continue;
      const hidden =
        i > 0 && shown(idx(i - 1, j, k)) && i < NX - 1 && shown(idx(i + 1, j, k)) &&
        j > 0 && shown(idx(i, j - 1, k)) && j < NY - 1 && shown(idx(i, j + 1, k)) &&
        k > 0 && shown(idx(i, j, k - 1)) && k < NZ - 1 && shown(idx(i, j, k + 1));
      if (hidden) continue;
      if (mat === Mat.Plate) {
        skin.push(i, j, k);
        skinCol.push(armourColour(sw, this.#design.paint, i, j, k, z0, z1,
          hwAt[k] as number, hhAt[k] as number));
      } else {
        const rig = rigOf.get((own[n] as number) - 1);
        const col = cellColour(mat, purp[n] as number, this.#design.paint);
        if (rig !== undefined) {
          (rigCells[rig] as number[]).push(i, j, k);
          (rigCols[rig] as number[]).push(col);
        } else {
          solid.push(i, j, k);
          solidCol.push(col);
        }
      }
    }

    // The ghost skin: the hull's outermost course only, read off the full grid.
    const ghost: number[] = [], ghostCol: number[] = [];
    if (this.#plate === 'ghost') {
      for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const n = idx(i, j, k);
        if (!isPlate(grid[n] as number)) continue;
        const open =
          i === 0 || !grid[n - 1] || i === NX - 1 || !grid[n + 1] ||
          j === 0 || !grid[n - NX] || j === NY - 1 || !grid[n + NX] ||
          k === 0 || !grid[n - NX * NY] || k === NZ - 1 || !grid[n + NX * NY];
        if (!open) continue;
        ghost.push(i, j, k);
        ghostCol.push(armourColour(sw, this.#design.paint, i, j, k, z0, z1,
          hwAt[k] as number, hhAt[k] as number));
      }
    }

    let loX = NX, loY = NY, loZ = NZ, hiX = -1, hiY = -1, hiZ = -1;
    for (const list of [solid, skin, ghost, ...rigCells]) {
      for (let q = 0; q < list.length; q += 3) {
        const x = list[q] as number, y = list[q + 1] as number, z = list[q + 2] as number;
        if (x < loX) loX = x; if (x > hiX) hiX = x;
        if (y < loY) loY = y; if (y > hiY) hiY = y;
        if (z < loZ) loZ = z; if (z > hiZ) hiZ = z;
      }
    }
    if (hiX >= 0) {
      this.#centre.set(
        ((loX + hiX + 1) / 2 - NX / 2) * cell,
        ((loY + hiY + 1) / 2 - NY / 2) * cell,
        ((loZ + hiZ + 1) / 2 - NZ / 2) * cell);
      this.#half.set((hiX - loX + 1) * cell / 2, (hiY - loY + 1) * cell / 2,
        (hiZ - loZ + 1) * cell / 2);
      // Arcs are part of the picture when they are on, so they are part of
      // what has to fit in the frame.
      if (this.#showArcs || this.#showTarget) {
        const reach = this.#arcReach() * (this.#showTarget ? 1.45 : 1.06);
        for (const r of this.#rigs) {
          this.#half.x = Math.max(this.#half.x, Math.abs(r.pivot.x - this.#centre.x) + reach);
          this.#half.y = Math.max(this.#half.y, Math.abs(r.pivot.y - this.#centre.y) + reach * 0.6);
          this.#half.z = Math.max(this.#half.z, Math.abs(r.pivot.z - this.#centre.z) + reach);
        }
      }
    }

    this.#voxelCount = solid.length / 3 + skin.length / 3 + ghost.length / 3
      + rigCells.reduce((a, c) => a + c.length / 3, 0);
    // How many of the faction's eight actually reached the hull. One means a
    // paint bucket rather than a livery, which is the thing this replaced.
    this.#liveryColours = new Set(skinCol.length ? skinCol : ghostCol).size;
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
    this.#hist = { ...hist, solid: solid.length / 3, skin: skin.length / 3,
      ghost: ghost.length / 3 };

    const place = (cells: number[], material: THREE.Material,
      colourAt: ((n: number) => number) | null, pick = true,
      parent: THREE.Object3D = this.#hull, origin?: THREE.Vector3) => {
      const n = cells.length / 3;
      if (!n) return;
      const geo = this.#geo(new THREE.BoxGeometry(cell, cell, cell));
      const inst = new THREE.InstancedMesh(geo, material, n);
      const mx = new THREE.Matrix4(), col = new THREE.Color();
      const ox = origin ? origin.x : 0, oy = origin ? origin.y : 0, oz = origin ? origin.z : 0;
      for (let q = 0; q < n; q++) {
        mx.setPosition(
          ((cells[q * 3] as number) - NX / 2 + 0.5) * cell - ox,
          ((cells[q * 3 + 1] as number) - NY / 2 + 0.5) * cell - oy,
          ((cells[q * 3 + 2] as number) - NZ / 2 + 0.5) * cell - oz);
        inst.setMatrixAt(q, mx);
        if (colourAt) inst.setColorAt(q, col.setHex(colourAt(q)));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      parent.add(inst);
      if (pick) this.#pickable.push({ mesh: inst, cells });
    };

    // The structure inside, each cell in its own job's colour: orange is a
    // drive on anybody's ship, red is a gun, green is the bridge. That is what
    // makes an unfamiliar hull readable without a legend, and it is why the
    // paint bucket is not allowed in here.
    place(solid, this.#mat(new THREE.MeshLambertMaterial({})),
      q => solidCol[q] as number);
    // The plate over it, in the faction's whole scheme rather than one colour:
    // panels, an underside, a dorsal spine, a waist stripe, a nose flash and a
    // transom band, all eight swatches on the hull at once.
    place(skin, this.#mat(new THREE.MeshLambertMaterial({})),
      q => skinCol[q] as number);
    // Ghosted armour draws last and never into the depth buffer, so what is
    // under it stays readable rather than fighting it. It is not pickable:
    // a click through the ghost should reach the part you can see.
    place(ghost, this.#mat(new THREE.MeshLambertMaterial({
      transparent: true, opacity: 0.3, depthWrite: false })),
      q => ghostCol[q] as number, false);
    // Every gun in its own group, drawn about its pivot so a rotation of the
    // group is a rotation of the turret on its mount.
    this.#rigs.forEach((r, n) => {
      place(rigCells[n] as number[], this.#mat(new THREE.MeshLambertMaterial({})),
        q => (rigCols[n] as number[])[q] as number, true, r.group, r.pivot);
    });

    // --- the selected part, outlined over the top of everything ------------
    // A wireframe on its own surface cells rather than a box round its
    // extent: a clamp is a pair of jaws and a cargo hold is a crate, and the
    // point of picking one is to see WHICH shape lit up. depthTest off so it
    // reads through the plate that is standing in front of it.
    const held = this.#socket
      ? this.#design.parts.findIndex(p => p.socket === this.#socket) : -1;
    if (held >= 0) {
      const want = held + 1;
      const mark: number[] = [];
      for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const n = idx(i, j, k);
        if (own[n] !== want) continue;
        const face =
          i === 0 || own[n - 1] !== want || i === NX - 1 || own[n + 1] !== want ||
          j === 0 || own[n - NX] !== want || j === NY - 1 || own[n + NX] !== want ||
          k === 0 || own[n - NX * NY] !== want || k === NZ - 1 || own[n + NX * NY] !== want;
        if (face) mark.push(i, j, k);
      }
      if (mark.length) {
        let lo = [NX, NY, NZ], hi = [-1, -1, -1];
        for (let q = 0; q < mark.length; q += 3) for (let a = 0; a < 3; a++) {
          const v = mark[q + a] as number;
          if (v < (lo[a] as number)) lo[a] = v;
          if (v > (hi[a] as number)) hi[a] = v;
        }
        const sizeOf = (a: number) => ((hi[a] as number) - (lo[a] as number) + 1) * cell;
        const midOf = (a: number, n: number) =>
          (((lo[a] as number) + (hi[a] as number) + 1) / 2 - n / 2) * cell;
        const box = new THREE.LineSegments(
          this.#geo(new THREE.EdgesGeometry(
            new THREE.BoxGeometry(sizeOf(0) * 1.06, sizeOf(1) * 1.06, sizeOf(2) * 1.06))),
          this.#mat(new THREE.LineBasicMaterial({ color: 0xFFD24B, depthTest: false })));
        box.position.set(midOf(0, NX), midOf(1, NY), midOf(2, NZ));
        box.renderOrder = 10;
        this.#marks.add(box);
      }
    }

    this.#buildArcs(this.#arcReach());

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

  /**
   * Turn a tap into a part.
   *
   * The instance index the raycast returns is the index into the cell list
   * that built the mesh, so it converts straight back to a lattice cell, and
   * `own` says which placement is standing in it. That is the whole trick:
   * the picture IS the grid, so what you clicked on is not a guess.
   */
  #pickAt(clientX: number, clientY: number): void {
    if (!this.#renderer || !this.#pickable.length) return;
    const cv = $<HTMLCanvasElement>('dzCanvas');
    const r = cv.getBoundingClientRect();
    this.#ray.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1), this.#camera);
    const hits = this.#ray.intersectObjects(this.#pickable.map(p => p.mesh), false);
    const hit = hits[0];
    if (!hit || hit.instanceId === undefined) {
      this.#socket = null; this.#note = null; this.#refresh(); return;
    }
    const entry = this.#pickable.find(p => p.mesh === hit.object);
    if (!entry) return;
    const q = hit.instanceId * 3;
    const i = entry.cells[q] as number, j = entry.cells[q + 1] as number,
      k = entry.cells[q + 2] as number;
    const { own, grid } = rasterise(this.#design);
    const n = i + j * NX + k * NX * NY;
    const owner = own[n] as number;
    if (owner > 0) {
      const p = this.#design.parts[owner - 1];
      this.#socket = p ? p.socket : null;
      this.#note = null;
      if (p) this.#tab = 'parts';
    } else {
      this.#socket = null;
      const mat = grid[n] as number;
      this.#note = mat === Mat.Plate
        ? 'Armour plating. Its thickness is on the Armour tab, and it is the '
          + 'only thing on the ship that wears the faction paint.'
        : mat === Mat.Skinned
          ? 'A frame member under the skin. The plate covers it, so it wears the '
            + 'paint, but it is frame and it is not editable.'
          : 'The frame. It is the class, not the design: it cannot be moved, cut '
            + 'or painted, and everything you fit hangs inside it.';
    }
    this.#refresh();
  }

  /** The card that says what you just tapped, or what the menu just selected. */
  #renderPick(): void {
    const card = $('dzPick');
    const frame = frameFor(this.#design.classKey);
    const sock = socketsOf(frame, this.#design.parts).find(s => s.id === this.#socket);
    const held = sock ? this.#design.parts.find(p => p.socket === sock.id) : undefined;
    const m = held ? moduleById(held.module) : undefined;

    if (!sock && !this.#note) { card.classList.add('hidden'); card.innerHTML = ''; return; }
    card.classList.remove('hidden');

    if (!sock) {
      card.innerHTML = `<div class="hd"><span class="nm">Hull</span>`
        + `<button class="x" id="dzPickX">close</button></div>`
        + `<p class="sub">${this.#note ?? ''}</p>`;
    } else if (!m) {
      card.innerHTML = `<div class="hd"><span class="nm">${sock.label}</span>`
        + `<button class="x" id="dzPickX">close</button></div>`
        + `<p class="sub">Empty ${sock.kind} socket. The palette on the Parts tab `
        + `lists what fits it.</p>`;
    } else {
      const pu = PURPOSE[m.purpose];
      const gun = m.weapon ? GUNS.find(g => g.key === m.weapon) : undefined;
      const bits: string[] = [];
      if (m.thrust) bits.push(`thrust ${m.thrust}, exhaust ${m.exhaust?.toFixed(1)}`);
      if (m.retro) bits.push(`retro ${m.retro}`);
      if (m.latX || m.latY) bits.push(`lateral ${m.latX ?? 0} by ${m.latY ?? 0}`);
      if (gun) bits.push(`${gun.dmg} dmg${gun.batch > 1 ? ` x${gun.batch}` : ''}, `
        + `${gun.range} u, ${gun.cooldown}s, pen ${gun.pen}`);
      if (m.marines) bits.push(`${m.marines} marines`);
      if (m.capacity) bits.push(`capacity ${m.capacity}`);
      if (m.reach) bits.push(`reach +${m.reach} u`);
      bits.push(`${m.size[0]} x ${m.size[1]} x ${m.size[2]} cells`);
      bits.push(`mass ${(m.mass / 1e6).toFixed(3)}, hull ${(m.hull / 1000).toFixed(1)}`);
      card.innerHTML = `<div class="hd">`
        + `<span class="dot" style="background:#${pu.base.toString(16).padStart(6, '0')}"></span>`
        + `<span class="nm">${m.name}</span><span class="id">${m.id}</span>`
        + `<button class="x" id="dzPickX">close</button></div>`
        + `<p class="sub"><b>${pu.label}</b> &middot; ${sock.label}`
        + (held?.rot ? ` &middot; facing ${(held.rot ?? 0) * 90}\u00b0` : '') + `</p>`
        + `<p class="sub">${bits.join(' &middot; ')}</p>`;
    }
    const x = document.getElementById('dzPickX');
    if (x) (x as HTMLButtonElement).onclick = () => {
      this.#socket = null; this.#note = null; this.#refresh();
    };
  }

  /**
   * The firing arcs, drawn from `data.rs`'s own numbers.
   *
   * A fan in the horizontal plane and a fan in the vertical one, both hung on
   * the SHIP's forward axis rather than on the turret's rest facing, because
   * that is what the core measures: `arc_test_3d` takes the ship's quaternion
   * and `sim_core` has no per mount rotation yet (turn.rs:476). Drawing them
   * off the mount would be a second opinion about a rule, and the rule is the
   * core's. What a player sets with Facing is the model's rest pose.
   *
   * This DISPLAYS a config and decides nothing. Whether a shot is legal in a
   * match is `ft_can_fire`'s answer, and the designer never asks it, because a
   * design has no match to ask about.
   */
  /** How far a wedge is drawn. Long enough to read, short enough that the
   *  ship is not lost inside its own arcs: about one hull radius. */
  #arcReach(): number { return Math.max(0.6, this.#derived.radius) * 0.72; }

  #buildArcs(full: number): void {
    if (!this.#showArcs && !this.#showTarget) return;
    if (this.#showArcs)
    { const SEG = 48;
    for (const r of this.#rigs) {
      const pu = PURPOSE[r.gun.key === 'missile' ? 'ordnance' : 'gun'];
      const fan = (arc: readonly [number, number], vertical: boolean) => {
        // The vertical wedge is drawn shorter. At the same radius the two
        // cross at full length and the ship reads as a wireframe bowtie with
        // a hull somewhere inside it.
        const reach = vertical ? full * 0.6 : full;
        const round = allRound(arc);
        const a0 = round ? -180 : (arc[0] as number);
        const a1 = round ? 180 : (arc[1] as number);
        const pts: number[] = [0, 0, 0];
        for (let n = 0; n <= SEG; n++) {
          const a = (a0 + (a1 - a0) * (n / SEG)) * Math.PI / 180;
          const s = Math.sin(a) * reach, c = Math.cos(a) * reach;
          pts.push(vertical ? 0 : s, vertical ? s : 0, c);
        }
        const geo = this.#geo(new THREE.BufferGeometry());
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const idx: number[] = [];
        for (let n = 1; n < SEG + 1; n++) idx.push(0, n, n + 1);
        geo.setIndex(idx);
        geo.computeVertexNormals();
        // The horizontal wedge is filled and the vertical one is not. Both
        // filled, at any opacity that showed, washed the whole ship pink and
        // the thing being described disappeared behind its own description.
        if (!vertical) {
          const mesh = new THREE.Mesh(geo, this.#mat(new THREE.MeshBasicMaterial({
            color: pu.base, transparent: true, opacity: 0.07,
            side: THREE.DoubleSide, depthWrite: false })));
          mesh.position.copy(r.pivot);
          this.#arcs.add(mesh);
        }

        // The limits, drawn as lines, because the fill alone does not say
        // where an arc ENDS and that is the number a player is reading.
        const edge: number[] = [];
        if (!round) {
          for (const a of [a0, a1]) {
            const rad = a * Math.PI / 180;
            const s = Math.sin(rad) * reach, c = Math.cos(rad) * reach;
            edge.push(0, 0, 0, vertical ? 0 : s, vertical ? s : 0, c);
          }
        }
        for (let n = 0; n <= SEG; n++) {
          const a = (a0 + (a1 - a0) * (n / SEG)) * Math.PI / 180;
          const s = Math.sin(a) * reach, c = Math.cos(a) * reach;
          if (n > 0) edge.push(edge[edge.length - 3] as number,
            edge[edge.length - 2] as number, edge[edge.length - 1] as number);
          edge.push(vertical ? 0 : s, vertical ? s : 0, c);
        }
        const lg = this.#geo(new THREE.BufferGeometry());
        lg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
        const line = new THREE.LineSegments(lg, this.#mat(new THREE.LineBasicMaterial({
          color: pu.mid, transparent: true, opacity: vertical ? 0.26 : 0.5 })));
        line.position.copy(r.pivot);
        this.#arcs.add(line);
      };
      fan(r.gun.arcH, false);
      if (!allRound(r.gun.arcV)) fan(r.gun.arcV, true);
    } }

    if (this.#showTarget) {
      // Big enough to find. It was a wireframe pip a tenth of a wedge across
      // and the question it kept getting asked was where it had gone.
      const mk = new THREE.Group();
      mk.name = 'target';
      const core = new THREE.Mesh(
        this.#geo(new THREE.OctahedronGeometry(full * 0.14)),
        this.#mat(new THREE.MeshBasicMaterial({ color: 0xFFD24B })));
      const cage = new THREE.Mesh(
        this.#geo(new THREE.OctahedronGeometry(full * 0.27)),
        this.#mat(new THREE.MeshBasicMaterial({
          color: 0xFFD24B, wireframe: true, transparent: true, opacity: 0.7 })));
      mk.add(core, cage);
      this.#arcs.add(mk);

      // Its path, so the thing is findable when it is round the far side.
      const ring: number[] = [];
      const orbit = full * 1.35;
      for (let n = 0; n <= 96; n++) {
        const a = (n / 96) * Math.PI * 2;
        ring.push(Math.sin(a) * orbit, 0, Math.cos(a) * orbit);
      }
      const rg = this.#geo(new THREE.BufferGeometry());
      rg.setAttribute('position', new THREE.Float32BufferAttribute(ring, 3));
      this.#arcs.add(new THREE.Line(rg, this.#mat(new THREE.LineBasicMaterial({
        color: 0xFFD24B, transparent: true, opacity: 0.32 }))));
      // One sight line per turret, shown only while that turret bears. Which
      // guns can actually reach the thing is the question the preview exists
      // to answer, and a swung barrel alone does not answer it.
      this.#rigs.forEach((_r, n) => {
        const g = this.#geo(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
        const line = new THREE.Line(g, this.#mat(new THREE.LineBasicMaterial({
          color: 0xFFD24B, transparent: true, opacity: 0.55 })));
        line.name = `sight${n}`;
        line.visible = false;
        this.#arcs.add(line);
      });
    }
  }

  /**
   * Swing every turret onto the target, and ease it home when it loses one.
   *
   * The angles are the core's, verbatim: yaw is atan2(x, z) round from the
   * ship's nose and pitch is atan2(y, hypot(x, z)), a true elevation off the
   * horizontal plane. Roll never enters it, because a mount has two axes.
   */
  #aimTurrets(dt: number): void {
    if (!this.#rigs.length) return;
    const reach = this.#arcReach() * 1.35;
    if (this.#showTarget) {
      this.#clock += dt;
      // About seven seconds a lap. Eleven was a screensaver: a preview you
      // have to wait on is one nobody watches to the end.
      const a = this.#clock * 0.9;
      this.#target.set(Math.sin(a) * reach, Math.sin(a * 0.73) * reach * 0.3,
        Math.cos(a) * reach);
      const mk = this.#arcs.getObjectByName('target');
      if (mk) mk.position.copy(this.#target);
    }
    // Easing under a slew rate. The ease alone is smooth but its first step is
    // proportional to the gap, so a turret picking up a target 105 degrees
    // away still moved 54 of them in a tenth of a second, which reads as a
    // snap however continuous the maths is. A mount has a top speed.
    const SLEW = 110 * Math.PI / 180;              // radians a second
    const k = 1 - Math.exp(-5.5 * dt);
    const cap = SLEW * dt;
    const step = (gap: number) => Math.max(-cap, Math.min(cap, gap * k));
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

    for (const r of this.#rigs) {
      // The default position is straight ahead ON THE MOUNT: the rest facing
      // the player set in 90 degree steps is already baked into the cells, so
      // zero in the group's own frame IS that direction.
      let goalYaw = 0, goalPitch = 0;
      r.bears = false;

      if (this.#showTarget) {
        const d = this.#target.clone().sub(r.pivot);
        // The core's own angles: yaw round from the nose, pitch as a true
        // elevation off the horizontal plane (math.rs arc_test_3d). Roll does
        // not enter it, because a mount has two axes.
        const h = Math.atan2(d.x, d.z) * 180 / Math.PI;
        const v = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
        const inside = (x: number, a: readonly [number, number]) => allRound(a)
          || (x >= Math.min(a[0] as number, a[1] as number)
            && x <= Math.max(a[0] as number, a[1] as number));
        r.bears = inside(h, r.gun.arcH) && inside(v, r.gun.arcV);
        // A mount that cannot bear returns to rest rather than straining at
        // its stop, which is also what makes "bearing" readable at a glance.
        if (r.bears) {
          goalYaw = h * Math.PI / 180 - r.rest;
          goalPitch = -v * Math.PI / 180;
        }
      }

      r.yaw += step(wrap(goalYaw - r.yaw));
      r.pitch += step(goalPitch - r.pitch);
      r.group.rotation.y = r.yaw;
      r.group.rotation.x = r.pitch;

      const sight = this.#arcs.getObjectByName(`sight${this.#rigs.indexOf(r)}`);
      if (sight) {
        sight.visible = r.bears;
        if (r.bears) {
          const g = (sight as THREE.Line).geometry;
          g.setAttribute('position', new THREE.Float32BufferAttribute([
            r.pivot.x, r.pivot.y, r.pivot.z,
            this.#target.x, this.#target.y, this.#target.z], 3));
          g.attributes.position!.needsUpdate = true;
        }
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
    this.#renderPick();
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
        this.#note = null;
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
        b.onclick = () => {
          this.#socket = this.#socket === s.id ? null : s.id;
          this.#note = null;
          this.#refresh();
        };
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
      // The arcs, straight off data.rs. The designer shows the numbers and
      // works nothing out from them: whether a shot is legal in a match is
      // ft_can_fire's answer, and a design has no match to ask about.
      h += '<div class="dzgrp">Firing arcs, about the ship\u2019s nose</div><div class="dzrows">';
      for (const mt of d.mounts) {
        const g = GUNS.find(x => x.key === mt.key);
        if (!g) continue;
        h += row(g.name, allRound(g.arcH)
          ? 'all round'
          : `${g.arcH[0]} to ${g.arcH[1]} deg across &middot; `
            + (allRound(g.arcV) ? 'any elevation' : `${g.arcV[0]} to ${g.arcV[1]} deg up`));
      }
      h += '</div>';
      h += '<p class="dznote">Measured about the hull\u2019s own nose, not about the '
        + 'mount, because that is what the core measures: <code>arc_test_3d</code> takes '
        + 'the ship\u2019s rotation and <code>sim_core</code> has no per mount facing yet. '
        + 'Facing sets the model\u2019s rest pose. Turn the arcs on over the model to see '
        + 'them, and Target for something to track.</p>';

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

    // Save. Someone else's design saves as a clone: their row is never
    // touched, so a hull you are working from cannot change under you.
    $('dzSave').onclick = () => {
      const bar = $('dzSaveBar');
      const field = $<HTMLInputElement>('dzSaveName');
      bar.classList.remove('hidden');
      field.value = this.#slot.mine && this.#slot.designId
        ? this.#slot.name
        : this.#slot.name ? `${this.#slot.name} copy` : this.#suggestName();
      field.focus();
      field.select();
      this.#said('');
    };
    $('dzSaveNo').onclick = () => { $('dzSaveBar').classList.add('hidden'); };
    $<HTMLInputElement>('dzSaveName').onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); void this.#doSave(); }
      if (e.key === 'Escape') $('dzSaveBar').classList.add('hidden');
    };
    $('dzSaveGo').onclick = () => { void this.#doSave(); };
    $('dzReset').onclick = () => {
      this.#design = stockFor(this.#design.classKey);
      this.#socket = null;
      this.#note = null;
      this.#refresh();
    };
    // Three states, not two. Ghost is the one a player actually wants while
    // fitting: the mounts live inside the hull now, so plate on hides them and
    // plate off loses the shape they have to fit inside.
    $('dzPlate').onclick = () => {
      this.#plate = this.#plate === 'on' ? 'ghost' : this.#plate === 'ghost' ? 'off' : 'on';
      this.#syncPlateButton();
      this.#refresh();
    };
    // Gunnery, on canvas because it is a thing you watch rather than set.
    // Two switches: the wedges, and the target the turrets chase.
    $('dzArcs').onclick = () => {
      this.#showArcs = !this.#showArcs;
      this.#syncArcButton();
      this.#refresh();
    };
    $('dzTrack').onclick = () => {
      this.#showTarget = !this.#showTarget;
      this.#syncArcButton();
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
      $(id).onclick = () => {
        this.#tab = which;
        // A tab tapped while the sheet is collapsed opens it, because
        // otherwise the tab looks broken.
        $('designer').classList.remove('wide');
        $('dzGrow').innerHTML = '\u25B2';
        this.#syncTabs();
      };
    };
    tab('dzTabParts', 'parts'); tab('dzTabArmour', 'armour'); tab('dzTabStats', 'stats');
    this.#syncSaveButton();
    // Collapse the sheet so the model has the screen. A phone control: at desk
    // widths the panel is beside the view and takes none of it.
    $('dzGrow').onclick = () => {
      $('designer').classList.toggle('wide');
      $('dzGrow').innerHTML = $('designer').classList.contains('wide')
        ? '\u25BC' : '\u25B2';
      this.#resize();
    };
    this.#syncTabs();
  }

  #syncArcButton(): void {
    $('dzArcs').className = this.#showArcs ? 'on' : '';
    $('dzArcs').textContent = this.#showArcs ? 'Arcs on' : 'Arcs';
    $('dzTrack').className = this.#showTarget ? 'ghost' : '';
    $('dzTrack').textContent = this.#showTarget ? 'Target on' : 'Target';
  }

  /** The one line of feedback the save flow needs. */
  #said(text: string, bad = false): void {
    const el = $('dzSaid');
    el.textContent = text;
    el.className = bad ? 'dzsaid bad' : 'dzsaid';
  }

  /** What the Save button offers depends on whose design is open. */
  #syncSaveButton(): void {
    const b = $('dzSave');
    b.textContent = this.#slot.mine && this.#slot.designId ? 'Save' : 'Save as';
    b.title = this.#slot.designId && !this.#slot.mine
      ? `Cloning ${this.#slot.name} into a design of your own`
      : 'Keep this hull in the ship library';
  }

  #syncPlateButton(): void {
    const b = $('dzPlate');
    b.className = this.#plate === 'off' ? '' : this.#plate === 'ghost' ? 'ghost' : 'on';
    b.textContent = this.#plate === 'on' ? 'Plate on'
      : this.#plate === 'ghost' ? 'Plate ghost' : 'Plate off';
  }

  /** A name a player will recognise, from the class and the faction. */
  #suggestName(): string {
    const f = frameFor(this.#design.classKey);
    return `${paintFor(this.#design.faction).name} ${f.name.split(' ').pop()}`;
  }

  async #doSave(): Promise<void> {
    if (!this.#onSave) { this.#said('the library is not reachable from here', true); return; }
    const name = $<HTMLInputElement>('dzSaveName').value.trim();
    if (!name) { this.#said('give it a name first', true); return; }
    const d = this.#derived;
    this.#said('saving...');
    try {
      const slot = await this.#onSave({
        name,
        design: this.#design,
        mass: d.mass, hull: d.hull, legal: d.legal,
        // Updating in place only ever happens on your own row.
        designId: this.#slot.mine ? this.#slot.designId : null,
        from: this.#slot.designId,
      });
      this.#slot = slot;
      $('dzSaveBar').classList.add('hidden');
      this.#said(`saved as "${slot.name}"`);
      this.#syncSaveButton();
    } catch (e) {
      this.#said(e instanceof Error ? e.message : 'could not save', true);
    }
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
      plate: this.#plate,
      arcs: this.#showArcs,
      target: this.#showTarget,
      rigs: this.#rigs.map(r => ({ label: r.label, key: r.gun.key,
        arcH: r.gun.arcH, arcV: r.gun.arcV, bears: r.bears,
        yaw: +(r.group.rotation.y * 180 / Math.PI).toFixed(1),
        pitch: +(r.group.rotation.x * 180 / Math.PI).toFixed(1) })),
      bearing: this.#rigs.filter(r => r.bears).length,
      showPlate: this.#plate === 'on',
      armour: this.#design.armour,
      slot: this.#slot,
      livery: this.#liveryColours,
      enclosedOutside: rasterise(this.#design).enclosedOutside,
      flushProud: rasterise(this.#design).flushProud,
      marks: this.#marks.children.length,
      note: this.#note,
      gridHash: this.#gridHash,
      faction: this.#design.faction,
      paint: this.#design.paint,
      hist: this.#hist,
    };
  }
}
