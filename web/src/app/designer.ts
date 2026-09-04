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
import { bindOrbit, frameBox } from './orbitcam.js';
import * as drafts from './drafts.js';
// The same loaders the map uses, so the yard cannot spell a path its own way
// and cannot drift onto a different surface than the thing being designed will
// fly with.
import { finishMap, partMap, windowMaterial, windowThumb } from './textures.js';
import {
  AT_REST, blockedPct, blockedShell, easeAngle, poseMatrix, turretGoal, type MountFace,
} from './turret.js';
// The map's own mesher, asked ONLY for its windows: where a window goes is a
// fact about the design, and two answers to it would be two ships.
import { hullMesh } from './hull.js';
import { designFromJson, designToJson } from './frames.js';
import {
  latOf, VOXEL, migrateDesign, type Lat, FRAMES, MODULES, GUNS, SECTIONS, STOCK,
  FACTION_PAINT, PURPOSE_ORDER,
  derive, frameFor, moduleById, stockFor, blockPct, throughArmour,
  socketsOf, rasterise, cellColour, armourColour, hullAt, paintFor, Mat, PURPOSE,
  gunByKey, allRound, zeroSections, cellIndex, inTurret, DRAWN_MAX,
  arcMasks, rasterSig, DEFAULT_FINISH, DEFAULT_METAL, DEFAULT_ROUGH,
  DECALS, DECAL_STRIDE,
  DEFAULT_FRAME_FINISH, DEFAULT_PART_FINISH, FINISHES, finishesOf, purposeAt,
  FACTION_ORDER, TIER_ORDER, TIER_NAMES,
  ARMOUR_BANDS, ROLE_BAND, bandFinishes, roleAt, roleCode, seatedFacing,
  type Design, type Derived, type SectionKey, type ArmourMode, type GunDef,
  type FrameDef,
  faceBasis, facingOf, isUpright,
  mountFouling,
} from './design.js';

/** What the plate is doing: solid, see through, or off. */
type PlateView = 'on' | 'ghost' | 'off';

/**
 * What a hull is drawn with in here: one material per BAND of plating, four
 * for the machinery, and the ghosted shell. It is the map's list.
 *
 * The plate is three rather than one for the reason `hull.ts` gives: colour is
 * free and a normal map is a draw call, so a ship whose deck is corrugated
 * over riveted flanks costs one material per pattern. The yard has to pay it
 * too, or a player designs on one surface and flies another, which is the
 * divergence GUIDELINES 5.1 is about.
 *
 * The same argument is why the machinery is four. It was ONE surface over
 * every cell that is not plating, which meant three of the four finish
 * dropdowns in this very screen changed nothing you could see in it: the
 * frame, the drives and the guns all came out wearing the subsystems' answer.
 * A control set where its effect is invisible is a control nobody can tell the
 * state of, which is the whole complaint these dropdowns exist to answer.
 *
 * Four instanced draws rather than one, at no fill cost: the same cells are
 * drawn either way, over three more draw calls.
 */
interface HullSurfaces {
  frame: THREE.MeshStandardMaterial;
  drive: THREE.MeshStandardMaterial;
  weapon: THREE.MeshStandardMaterial;
  part: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial[];
  ghost: THREE.MeshStandardMaterial;
}

/**
 * How metallic the yard draws a hull, whatever the design says.
 *
 * NOT the design's own number, and this is a measurement rather than a taste.
 * Metalness with no environment renders black, and an environment is the one
 * thing this view cannot afford: the yard draws a BOX PER CELL, about 6500 of
 * them on a Terran, where the map draws 1083 greedy quads. It is fill bound,
 * and a PMREM lookup per fragment is most of the frame. Measured headless at
 * 1400x900: standard with a normal map and an environment 1.0 fps, the same
 * without the environment 1.7, and the Lambert it replaced 1.8. The normal map
 * itself is free (0.9 with an environment and no normal map, which is the same
 * number inside noise), so the finish stays and the reflection goes.
 *
 * The battlefield keeps the full material, because it is not paying a box per
 * cell. What a player loses here is the sheen; what they keep is the plating,
 * the rivets and the greebles, which is what the yard is for.
 */
const YARD_METAL = 0.0;

/**
 * Gunnery preview: two independent switches, not one three way cycle.
 *
 * They were one button reading "Arcs off / Arcs on / Tracking", and the target
 * was three presses deep behind a label that never mentioned it. Two toggles
 * that each say what they do: you can watch the wedges without the target, or
 * the target without the wedges.
 */

/** Scratch for the pose, so aiming a turret does not allocate a matrix a
 *  frame per mount. */
const POSE = new THREE.Matrix4();

/** Scratch for the barrel readout, which runs per mount per debug read. */
const BARREL = new THREE.Vector3();

/**
 * Where a mount's barrel points in the SHIP's frame, in degrees.
 *
 * Its cells came off the raster already turned by the facing, so the barrel at
 * rest lies along `F * z` rather than along z, and the pose on the group takes
 * it from there. Reported so a check can ask about the authored arc, which is
 * a fact about the hull and is measured in the hull's frame.
 */
function barrelOf(r: Rig): { shipYaw: number; shipPitch: number } {
  BARREL.set(r.face[2] as number, r.face[5] as number, r.face[8] as number)
    .applyQuaternion(r.group.quaternion);
  return {
    shipYaw: +(Math.atan2(BARREL.x, BARREL.z) * 180 / Math.PI).toFixed(1),
    shipPitch: +(Math.atan2(BARREL.y, Math.hypot(BARREL.x, BARREL.z)) * 180 / Math.PI)
      .toFixed(1),
  };
}

/** A facing in words, for the one place a person reads one back. Only the axes
 *  that are actually turned, because "yaw 0, pitch 0, roll 90" is three
 *  numbers to say one thing. */
const faceWords = (f: { yaw: number; pitch: number; roll: number }): string =>
  ([['yaw', f.yaw], ['pitch', f.pitch], ['roll', f.roll]] as const)
    .filter(([, n]) => n).map(([k, n]) => `${k} ${n * 90}\u00b0`).join(', ');

/** One turret drawn in its own group so it can be swung without the hull. */
interface Rig {
  readonly group: THREE.Group;
  readonly gun: GunDef;
  readonly pivot: THREE.Vector3;
  /** The facing the player set, as a rotation from mount to ship. Three axes,
   *  so an orientation and not an angle. */
  readonly face: MountFace;
  readonly label: string;
  /** Whether the target was inside this turret's arc on the last frame. */
  bears: boolean;
  /** Where the barrel is now, in radians about the mount. It eases toward the
   *  goal rather than jumping: a turret that snaps reads as a texture swap. */
  yaw: number;
  pitch: number;
}

/**
 * How long the pencil has to be still before the arcs are rescanned, in ms.
 *
 * A few seconds rather than a frame, because a run of armour is one gesture
 * and not thirty questions about firing arcs. Overridable from the harness,
 * which cannot sit out a real settle on every edit and should not have to.
 */
const ARC_SETTLE = Number((globalThis as { ftArcSettle?: number }).ftArcSettle ?? 1500);

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
  #tab: 'parts' | 'armour' | 'decor' | 'stats' | 'frame' = 'parts';
  /** The decal armed for painting, by `DECALS` index, or null for none. */
  #decal: number | null = null;
  /** Architect mode: the same canvas editing the FRAME rather than a fit. */
  #arch = false;
  /**
   * Which draft slot this hull's unsaved work belongs in, which is the same
   * string the URL carries: a design id for a saved hull, a class key for one
   * that has never been saved. One name for "what am I editing" rather than
   * two that can disagree.
   */
  #draftKey = 'terran_frigate';
  /** Coalesces the writes. A plate stroke fires per cell, and serialising a
   *  whole hull per cell would make drawing feel like treacle. */
  #draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while a draft is being put back, so restoring does not immediately
   *  re-save what it just read. */
  #restoring = false;

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
  #armourTones: number[] = [];
  #gridHash = 0;
  #plate: PlateView = 'on';
  /** Cells behind each drawn mesh, so a click can be turned back into a part. */
  #pickable: Array<{ mesh: THREE.InstancedMesh; cells: number[] }> = [];
  #ray = new THREE.Raycaster();
  #note: string | null = null;
  #marks = new THREE.Group();
  #arcs = new THREE.Group();
  #slabBox = new THREE.Group();
  #rigs: Rig[] = [];
  /**
   * Each turret's blocked directions, scanned off the hull, and the design
   * they were scanned from.
   *
   * Held rather than asked for per frame because the scan is a ray a
   * direction over 2048 directions a mount, which is a frame's work and not a
   * frame's budget. `#maskSig` is what they describe: when it is not the
   * design on screen the arcs draw as they were and a rescan is pending.
   */
  #masks: Uint32Array[] = [];
  #maskSig = '';
  #maskTimer = 0;
  /** Whether the pencil is DOWN. A timer alone is not enough: a slow,
   *  deliberate stroke is quiet for longer than the settle between one cell
   *  and the next, and a scan landing halfway through a run is exactly what
   *  the debounce is for. Nothing is scanned until the finger lifts. */
  #drawing = false;
  /** How many scans have actually run. The harness reads it to prove the
   *  pencil did not trigger one per cell. */
  #maskScans = 0;
  #showArcs = false;
  #showTarget = false;
  #target = new THREE.Vector3();
  #clock = 0;
  /**
   * The slice editor's cursor, as a SLAB index rather than a z.
   *
   * Thickness makes a slice deeper, not overlapping: the lattice is cut into
   * slabs of `#depth` cells and the slider walks the slabs, so at thickness 4
   * there are 16 of them rather than 64 positions that each smear four cells
   * into their neighbours. A run paints the whole slab.
   */
  // Amidships of a frigate to start with, and clamped by `#slabZ` from then
  // on: the lattice is 48 cells deep on a corvette and 128 on a heavy cruiser,
  // so a slab index that was in range on one class is off the end of another.
  #slab = 32;
  #brush: 'add' | 'cut' = 'add';
  /**
   * The colour slot the pointer is holding, or null for no brush.
   *
   * Picking a swatch used to set `paint`, which is the base every livery role
   * is an OFFSET from, so choosing a colour repainted the whole ship in a
   * scheme built round it. That is a seed rather than a decision, and it is
   * what a player means when they say the palette will not let them pick a
   * colour to paint WITH. This is the brush; `paint` is still the hull's own
   * colour and has its own control.
   */
  #brushSlot: number | null = null;
  /** How many SLABS either side are ghosted, and how thick a slab is. */
  #onion = 1;
  #depth = 1;
  /** Optional mirroring, about the ship's own centre planes. Z is not offered:
   *  a hull is not symmetric front to back and nobody wants it to be. */
  #mirrorX = false;
  #mirrorY = false;
  #pending = 0;
  /** The drawing, as sets as well as lists: connectivity is checked on every
   *  painted cell and a linear scan per cell is a scan per pixel of a drag. */
  #drawSet = new Set<number>();
  #cutSet = new Set<number>();
  #drawSaid = '';
  #last = performance.now();
  /** Where the hull actually is in the lattice, so the camera looks at it. */
  #centre = new THREE.Vector3();
  /** Half extents of the drawn hull, for framing it rather than its sphere. */
  #half = new THREE.Vector3(1, 1, 1);
  /** The HULL's own extents, without the arcs the frame may also have to
   *  hold. It is what the camera is not allowed to zoom inside of. */
  #solid = new THREE.Vector3(1, 1, 1);
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
    // Rebuilt field by field and then MIGRATED, because this is where a stored
    // record becomes the design on the bench: the lattice stamp has to travel
    // with the cell indices or the next Save writes a cruiser's armour back as
    // though it had been drawn on a frigate.
    this.#design = migrateDesign({
      classKey: d.classKey,
      parts: (d.parts ?? []).map(p => ({ ...p })),
      sections: { ...zeroSections(), ...(d.sections ?? {}) },
      armour: d.armour === 'skin' ? 'skin' : 'wrapped',
      faction: typeof d.faction === 'string' ? d.faction : 'terran',
      paint: typeof d.paint === 'number' ? d.paint : 0x0095E9,
      // The SURFACE comes across too. Rebuilding a design field by field and
      // forgetting one is how a hull's finish goes missing between the library
      // and the editor, and since Save writes this record back, the loss was
      // permanent the first time anybody opened a saved ship and saved it.
      finish: typeof d.finish === 'string' ? d.finish : DEFAULT_FINISH,
      // Same reason, one field further on: the per slot surfaces and the two
      // interior ones are part of the record, and Save writes this back.
      ...(Array.isArray(d.bandFinish)
        ? { bandFinish: d.bandFinish.map(k => (typeof k === 'string' ? k : null)) }
        : {}),
      ...(Array.isArray(d.slotFinish)
        ? { slotFinish: d.slotFinish.map(k => (typeof k === 'string' ? k : null)) }
        : {}),
      frameFinish: typeof d.frameFinish === 'string' ? d.frameFinish : DEFAULT_FRAME_FINISH,
      partFinish: typeof d.partFinish === 'string' ? d.partFinish : DEFAULT_PART_FINISH,
      metal: typeof d.metal === 'number' ? d.metal : DEFAULT_METAL,
      rough: typeof d.rough === 'number' ? d.rough : DEFAULT_ROUGH,
      plate: Array.isArray(d.plate) ? d.plate.slice(0, DRAWN_MAX) : [],
      cut: Array.isArray(d.cut) ? d.cut.slice(0, DRAWN_MAX) : [],
      tint: Array.isArray(d.tint) ? d.tint.slice(0, DRAWN_MAX) : [],
      // Same list, one entry further on. This rebuilds the record field by
      // field, so a field left off it is a field a hull loses between the
      // library and the editor, and Save writes this record back: the loss is
      // permanent the first time anybody opens a decorated ship and saves it.
      decal: Array.isArray(d.decal) ? d.decal.slice(0, DRAWN_MAX) : [],
      ...(Array.isArray(d.lattice) ? { lattice: [...d.lattice] as [number, number, number] } : {}),
    });
    this.#slot = slot;
    // The draft slot for a saved hull is its own id, which is also what the
    // URL carries. One name for what is being edited.
    this.#draftKey = slot.designId ?? d.classKey;
    this.#syncDrawSets();
    this.#socket = null;
    this.#note = null;
    this.#said('');
    this.#syncSaveButton();
    if (this.#renderer) this.#refresh();
    // After the load, so what comes back sits over the stored version rather
    // than under it: the draft is the newer work.
    this.#restoreDraft();
  }

  /**
   * A blank slate: a stock hull, owned by nobody yet.
   *
   * This is what `/ship` with no id MEANS, and until it existed the route
   * could not say it. The designer simply showed whatever was already in it,
   * so closing a saved design and pressing Shipyard again put you back in that
   * design at an address claiming a new one, and Save then quietly updated the
   * row you thought you had left. A route that cannot express "nothing loaded"
   * is a route that lies the moment something has been loaded.
   *
   * Idempotent on purpose: `showRoute` re-enters `/ship` on Back and on close,
   * and wiping a hull somebody is drawing because a route fired twice would be
   * worse than the bug this fixes.
   */
  newDesign(classKey?: string): void {
    const want = classKey ?? this.#design.classKey;
    // Idempotent on the hull it is already showing. `showRoute` re-enters
    // `/ship` on Back and on close, and re-seeding a stock hull under somebody
    // who is drawing on it would be worse than the bug this fixes.
    if (!this.#slot.designId && !this.#slot.name && this.#design.classKey === want
        && this.#draftKey === want) return;
    // Anything in progress on the way out is kept, not dropped: switching
    // class is browsing, not discarding.
    this.#flushDraft();
    this.#design = stockFor(want);
    this.#slot = { designId: null, name: '', mine: false };
    this.#draftKey = want;
    this.#syncDrawSets();
    this.#socket = null;
    this.#note = null;
    this.#said('');
    this.#syncSaveButton();
    const field = $<HTMLInputElement>('dzSaveName');
    if (field) field.value = '';
    if (this.#renderer) this.#refresh();
    this.#restoreDraft();
  }

  /** Throw this hull's unsaved work away, once the real thing exists or the
   *  person asked for a clean slate. */
  clearDraft(key?: string): void {
    if (this.#draftTimer) { clearTimeout(this.#draftTimer); this.#draftTimer = null; }
    drafts.forget(key ?? this.#draftKey);
  }

  /** Move the draft slot, for when a hull acquires an id by being saved. */
  setDraftKey(key: string): void { this.#draftKey = key; }

  /**
   * The architect: the same yard, editing the FRAME rather than a fit.
   *
   * A mode rather than a second screen, because everything the architect needs
   * is already here and correct: the canvas, the orbit, the picking, the
   * derive readout, and a rail that is a bottom sheet on a phone. A second
   * screen would be a second copy of all of that, and the copy is the one that
   * would stop working at 390 px.
   */
  setArchitect(on: boolean): void {
    this.#arch = on;
    $('designer').classList.toggle('arch', on);
    $('dzTitle').textContent = on ? 'Ship Architect' : 'Shipyard';
    // Land on a pane that exists in this mode. Staying on Parts in the
    // architect would show the fitting rail with its tab hidden, which is a
    // pane a player cannot leave.
    if (on && (this.#tab === 'parts' || this.#tab === 'armour'
      || this.#tab === 'decor')) this.#tab = 'frame';
    if (!on && this.#tab === 'frame') this.#tab = 'parts';
    // Open the sheet on the way in. Collapsed is right for the yard, where the
    // model is the thing being edited and the rail is the tool; here the RAIL
    // is the tool and the editor both, so arriving with it shut is arriving at
    // a screen with no controls on it.
    if (on) {
      $('designer').classList.remove('wide');
      $('dzGrow').innerHTML = '\u25B2';
    }
    this.#syncTabs();
  }

  get architect(): boolean { return this.#arch; }

  /**
   * Rebuild the hull from its FRAME, throwing away the fit on screen.
   *
   * `newDesign` is idempotent on the class it is already showing, which is
   * right for browsing and wrong here: the architect changes the frame UNDER
   * one class key, so what it wants back is a different ship at the same
   * address and the early return would hand it the old one. It skips the
   * design draft too, because a draft is a FIT and what just moved is the
   * thing being fitted to.
   */
  reseed(classKey: string): void {
    this.#design = stockFor(classKey);
    this.#slot = { designId: null, name: '', mine: false };
    this.#draftKey = classKey;
    this.#syncDrawSets();
    this.#note = null;
    this.#syncSaveButton();
    if (this.#renderer) this.#refresh();
  }

  /** Which station is selected, and a way to say so from the rail. The model
   *  and the list are one selection: picking in either has to light both, or
   *  a player nudges a socket that is not the one they can see outlined. */
  get socket(): string | null { return this.#socket; }
  selectSocket(id: string | null): void {
    this.#socket = id;
    if (this.#renderer) this.#refresh();
  }

  /** Told when an unsaved hull's class changes, so whoever owns the address
   *  can point it at that stock ship. The designer does not own the router. */
  #onPickClass: ((classKey: string) => void) | null = null;
  onPickClass(fn: (classKey: string) => void): void { this.#onPickClass = fn; }

  get visible(): boolean { return !$('designer').classList.contains('hidden'); }

  show(): void {
    $('designer').classList.remove('hidden');
    if (!this.#renderer) this.#initThree();
    this.#refresh();
    this.#resize();
    if (!this.#raf) this.#frame();
  }

  hide(): void {
    // The debounce is a timer on a page that is about to stop drawing, so the
    // pending write happens now. Leaving on Back was one of the two ways an
    // hour of work used to vanish.
    this.#flushDraft();
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
    this.#scene.add(this.#hull, this.#rig, this.#sockets, this.#marks, this.#arcs,
      this.#slabBox);

    // Orbit. One finger drags, two pinch, and a press that did not travel is a
    // tap on a part rather than a turn of the camera. Shared with the
    // schematic modal, which orbits the same hulls and would otherwise be a
    // second copy of the same gestures.
    bindOrbit(cv, this.#cam, { onTap: (x, y) => this.#pickAt(x, y) });

    if (window.ResizeObserver) new ResizeObserver(() => this.#resize()).observe($('dzView'));
    window.addEventListener('resize', () => this.#resize());
  }

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
    // does not sit in the corner of a void. The fit is `orbitcam`'s, shared
    // with the schematic modal.
    frameBox(this.#camera, this.#cam, this.#centre, this.#half, this.#solid);
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

  /**
   * The three surfaces a hull is drawn with, made ONCE and updated in place.
   *
   * Not through `#mat`, which disposes everything it is handed on the next
   * rebuild. That is right for the little wireframes and markers and wrong for
   * these: disposing a material releases its compiled program, so a material
   * rebuilt per edit is a SHADER rebuilt per edit, and a standard material
   * with a normal map is the most expensive shader in this view.
   *
   * The only parameter that can change is the finish, and that is an
   * assignment. `needsUpdate` is set only when the MAP actually changed:
   * setting it every rebuild is the recompile this exists to avoid, spelled a
   * different way.
   */
  #surfaces: HullSurfaces | null = null;

  /**
   * Hang the elaboration off a heading, as the `?` that folds it away.
   *
   * A rail is for controls: what one DOES is the label, and why it works that
   * way is a footnote nobody should have to scroll past to reach the next
   * slider. `main.ts` owns the toggle, so this only has to put the button
   * where the text used to be, and it replaces any `?` already there because
   * `#refresh` runs on every edit.
   */
  #why(head: HTMLElement, text: string): void {
    head.querySelector('.dzwhy')?.remove();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dzwhy';
    b.textContent = '?';
    b.title = text;
    b.setAttribute('aria-expanded', 'false');
    head.appendChild(b);
  }

  #surfaceFor(design: Design): HullSurfaces {
    if (!this.#surfaces) {
      const base = () => new THREE.MeshStandardMaterial({
        metalness: YARD_METAL, roughness: 0.62, dithering: true,
      });
      // Machinery, four ways: the frame under the plating, what pushes, what
      // shoots, and everything else. `partMap` is only the starting value;
      // each is set from the design below.
      const frame = base(), drive = base(), weapon = base(), part = base();
      for (const m of [frame, drive, weapon, part]) m.normalMap = partMap();
      const plate = Array.from({ length: ARMOUR_BANDS }, base);
      const ghost = base();
      ghost.transparent = true;
      ghost.opacity = 0.3;
      ghost.depthWrite = false;
      this.#surfaces = { frame, drive, weapon, part, plate, ghost };
    }
    const s = this.#surfaces;
    // The picked SLOT's surface, through the same resolver the map uses, so
    // the hull a player is looking at in here is the hull that gets fielded.
    const surf = finishesOf(design);
    const bands = bandFinishes(design);
    bands.forEach((key, b) => {
      const m = s.plate[b] as THREE.MeshStandardMaterial;
      const map = finishMap(key);
      if (m.normalMap !== map) { m.normalMap = map; m.needsUpdate = true; }
    });
    // The ghost is the broad plating's finish. It is one translucent shell
    // standing in for the whole skin, so it takes the surface most of that
    // skin is: three ghosts would be three transparent draws over each other.
    const finish = finishMap(bands[0] as string);
    if (s.ghost.normalMap !== finish) { s.ghost.normalMap = finish; s.ghost.needsUpdate = true; }
    // Each of the four from the design, and `needsUpdate` only where the map
    // actually moved: setting it every rebuild is the shader recompile the
    // whole cache exists to avoid, spelled a different way.
    for (const [m, key] of [[s.frame, surf.frame], [s.drive, surf.drive],
      [s.weapon, surf.weapon], [s.part, surf.part]] as const) {
      const map = finishMap(key);
      if (m.normalMap !== map) { m.normalMap = map; m.needsUpdate = true; }
    }
    return s;
  }

  /**
   * The lattice the hull on the bench is drawn on.
   *
   * A corvette is 24 x 24 x 48 and a heavy cruiser 64 x 64 x 128, so every
   * walk over the grid and every cell index in this file depends on which
   * class is open. Asked here rather than captured, because the class changes
   * under the same designer when a player picks another hull.
   */
  get #lat(): Lat { return latOf(frameFor(this.#design.classKey)); }

  /** World position of a cell centre, with the lattice centred on the origin. */
  #pos(cell: number, i: number, j: number, k: number): THREE.Vector3 {
    const { nx: NX, ny: NY, nz: NZ } = this.#lat;
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
    const cell = VOXEL;
    const { nx: NX, ny: NY, nz: NZ } = this.#lat;
    const { grid, purp, own, tone } = rasterise(this.#design);
    const idx = (i: number, j: number, k: number) => i + j * NX + k * NX * NY;

    // The hull's own shape, read once per station rather than per cell: it is
    // the same answer 1024 times over. The livery no longer needs it, but the
    // ghost skin and the proud part checks still do.
    const prof = frame.profile;
    const hwAt = new Float32Array(NZ), hhAt = new Float32Array(NZ);
    for (let k = 0; k < NZ; k++) {
      const st = hullAt(prof, k);
      hwAt[k] = st[0] as number;
      hhAt[k] = st[1] as number;
    }

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
    // A cell a PART owns is not armour, whatever material it is drawn with, so
    // the toggle leaves it alone: a container on the deck is painted in the
    // ship's livery and drawn as plate, and turning the plating off should not
    // take the cargo off with it. Same rule as `bareGrid`, which is the map's
    // half of this.
    const solidView = this.#plate === 'on'
      ? grid.map(m => (m === Mat.Skinned ? Mat.Plate : m)) as Uint8Array
      : grid.map((m, n) => ((own[n] as number) > 0 ? m
        : m === Mat.Plate ? Mat.Empty
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
      rigOf.set(n, this.#rigs.length);
      rigCells.push([]); rigCols.push([]);
      this.#rigs.push({ group, gun: g, pivot,
        face: faceBasis(seatedFacing(frame, sock, p)),
        label: `${m.name}, ${sock.label}`, bears: false, yaw: 0, pitch: 0 });
      this.#hull.add(group);
    });

    // Machinery, in four lists because it is drawn in four surfaces: the
    // frame, the drives, the guns and everything else. Same cells, same
    // colours, sorted by what they are FOR so each can wear its own finish.
    const SOLID = ['frame', 'drive', 'weapon', 'part'] as const;
    const solid: Record<typeof SOLID[number], number[]> =
      { frame: [], drive: [], weapon: [], part: [] };
    const solidCol: Record<typeof SOLID[number], number[]> =
      { frame: [], drive: [], weapon: [], part: [] };
    const solidOf = (mat: number, code: number): typeof SOLID[number] => {
      // Structure wears the frame's surface, which is what its COLOUR already
      // says: `cellColour` gives a frame cell and a skinned one the same
      // structure hue, so giving them different materials would be one cell
      // painted two ways.
      if (mat === Mat.Frame || mat === Mat.Skinned) return 'frame';
      // Nought is no purpose recorded, which is a spar rather than a drive.
      if (!code) return 'part';
      const job = purposeAt(code);
      if (job === 'propulsion' || job === 'attitude') return 'drive';
      if (job === 'gun' || job === 'ordnance') return 'weapon';
      return 'part';
    };
    // One list per band of plating, because each band is its own material and
    // an instanced draw takes one.
    const skin: number[][] = Array.from({ length: ARMOUR_BANDS }, () => []);
    const skinCol: number[][] = Array.from({ length: ARMOUR_BANDS }, () => []);
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
        const band = ROLE_BAND[roleAt(tone[n] as number)];
        (skin[band] as number[]).push(i, j, k);
        (skinCol[band] as number[]).push(
          armourColour(this.#design.faction, this.#design.paint, tone[n] as number));
      } else {
        const rig = rigOf.get((own[n] as number) - 1);
        const col = cellColour(mat, purp[n] as number, this.#design.paint);
        if (rig !== undefined) {
          (rigCells[rig] as number[]).push(i, j, k);
          (rigCols[rig] as number[]).push(col);
        } else {
          const which = solidOf(mat, purp[n] as number);
          (solid[which] as number[]).push(i, j, k);
          (solidCol[which] as number[]).push(col);
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
        ghostCol.push(armourColour(this.#design.faction, this.#design.paint, tone[n] as number));
      }
    }

    let loX = NX, loY = NY, loZ = NZ, hiX = -1, hiY = -1, hiZ = -1;
    for (const list of [...SOLID.map(k => solid[k]), ...skin, ghost, ...rigCells]) {
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
      this.#solid.copy(this.#half);
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

    const skinCells = skin.reduce((a, c) => a + c.length / 3, 0);
    const solidCells = SOLID.reduce((a, k) => a + (solid[k] as number[]).length / 3, 0);
    this.#voxelCount = solidCells + skinCells + ghost.length / 3
      + rigCells.reduce((a, c) => a + c.length / 3, 0);
    // Every distinct colour the armour actually came out.
    //
    // It used to be exactly one, and the rule it proved was that the pick IS
    // the hull. The rule now is that the pick is role `hull` and the rest of
    // the palette turns with it, so this is the set that shows the whole
    // livery landed: sorted, because a set of colours in raster order is a
    // list that changes when a cell does and a harness comparing two hulls
    // wants to compare schemes rather than orderings.
    const laid = skinCells ? skinCol.flat() : ghostCol;
    this.#armourTones = [...new Set(laid)].sort((a, b) => a - b);
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
    this.#hist = { ...hist, solid: solidCells, skin: skinCells,
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
    // Standard rather than Lambert, because the map draws these same cells as
    // a PBR surface and a yard that drew them flat showed a player one ship
    // and flew them another. Lambert has no normal map, which is the whole of
    // what a finish is.
    const surf = this.#surfaceFor(this.#design);

    // One draw per machinery surface, so the frame dropdown, the engines
    // dropdown and the weapons dropdown each reach something in here.
    for (const k of SOLID) {
      place(solid[k] as number[], surf[k],
        q => (solidCol[k] as number[])[q] as number);
    }
    // The plate over it, in the navy's whole scheme rather than one colour: a
    // deck, an underside, a waist belt, a flank stripe, a bow flash and a
    // transom band, every swatch in the palette on the hull at once, and one
    // draw per band so each wears its own normal map.
    skin.forEach((cells, b) => place(cells, surf.plate[b] as THREE.MeshStandardMaterial,
      q => (skinCol[b] as number[])[q] as number));
    // Ghosted armour draws last and never into the depth buffer, so what is
    // under it stays readable rather than fighting it. It is not pickable:
    // a click through the ghost should reach the part you can see.
    place(ghost, surf.ghost,
      q => ghostCol[q] as number, false);
    // The windows, which the yard drew none of until now.
    //
    // A player who fits a bridge should SEE the viewport appear, and three of
    // the four screens that draw this hull already did: the map, the ship
    // detail modal and the fleet chip all go through `hullMesh`, and the yard
    // built its own boxes and never asked. That is the divergence CLAUDE.md's
    // "three pictures of one hull, one surface" is about, and a second
    // derivation here would be the same defect with extra steps: where a
    // window goes is one question, so it is asked once. `hullMesh` is cached
    // on the raster signature, so an edit that does not move a cell costs
    // nothing and one that does pays a single surface pass.
    //
    // Neither the geometry nor the material goes through `#geo`/`#mat`: both
    // are owned by those caches, and disposing one here would leave the next
    // caller holding a released buffer.
    if (this.#plate !== 'off') {
      for (const w of hullMesh(this.#design).windows) {
        const wm = windowMaterial(w.key);
        if (wm) this.#hull.add(new THREE.Mesh(w.geo, wm));
      }
    }

    // Every gun in its own group, drawn about its pivot so a rotation of the
    // group is a rotation of the turret on its mount.
    this.#rigs.forEach((r, n) => {
      // A rig IS a gun, so it wears the weapons surface by construction
      // rather than by asking what its cells are for.
      place(rigCells[n] as number[], surf.weapon,
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
    const { nx: NX, ny: NY } = this.#lat;
    const n = i + j * NX + k * NX * NY;
    const owner = own[n] as number;
    // The BRUSH takes the tap before anything else does. A player who has
    // picked up a colour is not asking what a cell is called.
    if (this.#brushSlot !== null) { this.#paintAt(n, grid[n] as number); return; }
    // And a DECAL takes it before the brush would have, for the same reason:
    // a tool that is armed is the answer to a tap.
    if (this.#decal !== null) { this.#decalAt(n, grid[n] as number); return; }
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

  /**
   * Stick a decal on one cell of plating, or peel it off.
   *
   * Plating only, and for the same reason the brush is: a window is a hole in
   * ARMOUR. A porthole in the middle of a drive bell is a hole in an engine,
   * and a frame member is the class rather than the design.
   *
   * The same kind again lifts it off, which is what a second tap with the same
   * tool means everywhere else in here.
   */
  #decalAt(n: number, mat: number): void {
    if (mat !== Mat.Plate && mat !== Mat.Skinned) {
      this.#note = 'A decal goes on PLATING. A window in a drive bell is a hole '
        + 'in an engine, and the frame is the class rather than the design.';
      this.#refresh();
      return;
    }
    const list = (this.#design.decal ??= []);
    const at = list.findIndex(v => ((v / DECAL_STRIDE) | 0) === n);
    const want = n * DECAL_STRIDE + (this.#decal as number);
    if (at >= 0) {
      if (list[at] === want) list.splice(at, 1);
      else list[at] = want;
    } else {
      if (list.length >= DRAWN_MAX) return;
      list.push(want);
    }
    this.#note = null;
    this.#refresh();
  }

  /**
   * Lay the brush on one cell, or lift it off.
   *
   * Armour only, and that is not a limitation to work around: a part is
   * coloured by what it DOES, so a drive is orange and a gun is red whoever
   * built them, which is what makes an unfamiliar hull readable without a
   * legend. Painting one would take that away for the sake of a panel.
   */
  #paintAt(n: number, mat: number): void {
    if (mat !== Mat.Plate && mat !== Mat.Skinned) {
      this.#note = 'The brush paints ARMOUR. A part is coloured by what it is '
        + 'for, so a drive is orange and a gun is red on anybody\u2019s ship, '
        + 'and the frame is the class rather than the design.';
      this.#refresh();
      return;
    }
    const list = (this.#design.tint ??= []);
    const at = list.findIndex(v => ((v / 8) | 0) === n);
    const want = n * 8 + (this.#brushSlot as number);
    if (at >= 0) {
      // The same colour again lifts it off, which is what a second tap with
      // the same brush means everywhere else.
      if (list[at] === want) list.splice(at, 1);
      else list[at] = want;
    } else {
      if (list.length >= DRAWN_MAX) return;
      list.push(want);
    }
    this.#note = null;
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
        + (held && !isUpright(facingOf(held)) ? ` &middot; facing ${faceWords(facingOf(held))}` : '')
        + `</p>`
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

  /**
   * Where this turret's own hull is in the way, drawn as a shadow on a shell.
   *
   * The mask is what the SIMULATION reads, so this draws the mask itself
   * rather than a picture of what it ought to be: one patch per blocked cell,
   * on the sphere the turret would otherwise cover. A player who cannot see
   * why a mount will not shoot astern is a player who thinks the gun is
   * broken.
   *
   * Attached to the hull rather than to the barrel, because that is where the
   * blockage is: the shadow does not swing when the turret does.
   */
  #buildBlocked(n: number, full: number): void {
    const mask = this.#masks[n];
    const r = this.#rigs[n];
    if (!mask || !r) return;
    const pts = blockedShell(mask, full * 0.92);
    if (!pts.length) return;
    const geo = this.#geo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mesh = new THREE.Mesh(geo, this.#mat(new THREE.MeshBasicMaterial({
      color: 0xE0503A, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false })));
    mesh.position.copy(r.pivot);
    mesh.renderOrder = 4;
    mesh.name = `blocked${n}`;
    this.#arcs.add(mesh);
  }

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
      this.#buildBlocked(this.#rigs.indexOf(r), full);
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
    for (const r of this.#rigs) {
      // Where it wants to point, and how fast it may get there: both from
      // `turret.ts`, which the map reads too. A second copy here would drift
      // the first time either one's slew was tuned, and a player would watch a
      // turret in the editor point somewhere the same turret on the map does
      // not.
      //
      // At rest is straight ahead ON THE MOUNT: the facing set in 90 degree
      // steps is already baked into the cells, so zero in the mount's own
      // frame IS that direction, and `poseMatrix` is what takes the aim out of
      // the ship's frame and into that one.
      const n = this.#rigs.indexOf(r);
      const goal = this.#showTarget
        ? turretGoal(this.#target.clone().sub(r.pivot), r.face, r.gun, this.#masks[n])
        : AT_REST;
      r.bears = goal.bears;
      r.yaw = easeAngle(r.yaw, goal.yaw, dt, true);
      r.pitch = easeAngle(r.pitch, goal.pitch, dt);
      r.group.quaternion.setFromRotationMatrix(
        poseMatrix(POSE, r.face, r.yaw, r.pitch));

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

  /**
   * Rescan every turret's field of fire, once the player has stopped drawing.
   *
   * The scan is 2048 rays a mount through a 65536 cell lattice. That is a
   * frame's work, and the armour pencil fires an edit per cell dragged
   * through, so scanning inline would have queued one per cell and made the
   * pencil stutter under its own feedback. The same lesson as the reach
   * envelope: expensive work happens once things settle, not once per event.
   *
   * The delay is deliberately long. A player laying a run of plate is not
   * asking about arcs; a player who has stopped is.
   */
  #scanArcs(): void {
    const sig = rasterSig(this.#design);
    if (sig === this.#maskSig) return;
    if (this.#maskTimer) clearTimeout(this.#maskTimer);
    this.#maskTimer = 0;
    if (this.#drawing) return;
    this.#maskTimer = setTimeout(() => {
      this.#maskTimer = 0;
      this.#maskSig = rasterSig(this.#design);
      this.#masks = arcMasks(this.#design);
      this.#maskScans++;
      // The arcs are part of the picture, so a finished scan redraws it.
      if (this.#showArcs || this.#showTarget) this.#rebuild();
      this.#renderStats();
    }, ARC_SETTLE) as unknown as number;
  }

  #refresh(): void {
    this.#derived = derive(this.#design);
    this.#scanArcs();
    this.#rebuild();
    this.#renderClasses();
    this.#renderSockets();
    this.#renderPalette();
    this.#renderArmour();
    this.#renderSlice();
    this.#renderSlabBox();
    this.#renderPick();
    this.#renderKey();
    this.#renderStats();
    this.#renderHeader();
    // Every mutation in the editor ends here, so this is the one place a draft
    // needs writing from. Hooking each handler instead would mean remembering
    // to hook the next one, and the one that got forgotten would be the one
    // that lost an hour of work.
    this.#keepDraft();
  }

  /**
   * Write the unsaved hull to its draft slot, coalesced.
   *
   * Debounced rather than immediate because a plate stroke calls `#refresh`
   * per cell, and serialising a whole design per cell turns drawing to
   * treacle. Half a second is long enough to swallow a stroke and short enough
   * that a tab closed in frustration still has the work in it.
   */
  #keepDraft(): void {
    if (this.#restoring) return;
    if (this.#draftTimer) clearTimeout(this.#draftTimer);
    this.#draftTimer = setTimeout(() => {
      this.#draftTimer = null;
      drafts.remember(
        this.#draftKey, this.#design,
        $<HTMLInputElement>('dzSaveName')?.value ?? '',
        this.#slot.name || 'a new hull',
      );
    }, 500);
  }

  /** Flush a pending draft write now. Called on the way out, because the
   *  debounce is measured in a timer the page is about to stop running. */
  #flushDraft(): void {
    if (!this.#draftTimer) return;
    clearTimeout(this.#draftTimer);
    this.#draftTimer = null;
    drafts.remember(
      this.#draftKey, this.#design,
      $<HTMLInputElement>('dzSaveName')?.value ?? '',
      this.#slot.name || 'a new hull',
    );
  }

  /**
   * Put a draft back over the hull that was just loaded, if there is one.
   *
   * The draft WINS over the stored version, because it is the newer work and
   * the stored version is a click away in the library. Silence would be the
   * wrong call either way, so it says which it did.
   */
  #restoreDraft(): boolean {
    const d = drafts.recall(this.#draftKey);
    if (!d) return false;
    this.#restoring = true;
    try {
      // A draft is storage, and storage predating the per class lattices
      // holds cell indices for a lattice this class is no longer on.
      this.#design = migrateDesign(d.design as Design);
      this.#syncDrawSets();
      this.#socket = null;
      if (this.#renderer) this.#refresh();
      const field = $<HTMLInputElement>('dzSaveName');
      if (field && d.name) field.value = d.name;
      this.#said('unsaved changes restored');
    } finally {
      this.#restoring = false;
    }
    return true;
  }

  /** Which hull's unsaved work is on screen, for the harness to read. */
  get draftKey(): string { return this.#draftKey; }

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

  /**
   * The class picker: the navy, then that navy's ladder.
   *
   * One flat row worked at five hulls and does not at seventeen. The names
   * would not fit a phone either, so the chip says the TIER and the row above
   * says whose it is, which is the same two facts a class name carries.
   *
   * Grouped on the frame's own `faction` and `tier` rather than by splitting
   * its display name: a screen that read `name.replace(' Frigate', '')` was
   * already wrong the moment a class was called something else, and it was.
   */
  #renderClasses(): void {
    const host = $('dzClasses');
    host.innerHTML = '';
    const here = frameFor(this.#design.classKey);

    const chip = (row: HTMLElement, label: string, on: boolean, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = on ? 'on' : '';
      b.onclick = fn;
      row.appendChild(b);
    };

    const navies = document.createElement('div');
    navies.className = 'dzrow';
    host.appendChild(navies);
    const tiers = document.createElement('div');
    tiers.className = 'dzrow tier';
    host.appendChild(tiers);

    for (const fac of FACTION_ORDER) {
      const ladder = FRAMES.filter(f => f.faction === fac);
      if (!ladder.length) continue;
      const name = FACTION_PAINT.find(f => f.key === fac)?.name ?? fac;
      // Picking a navy lands on the rung you were already on where it exists,
      // and on its frigate where it does not. Anything else would send a
      // player looking at a cruiser to somebody's corvette.
      chip(navies, name, fac === here.faction, () => {
        if (fac === here.faction) return;
        const want = ladder.find(f => f.tier === here.tier) ?? ladder[0] as FrameDef;
        this.#pickClass(want.classKey);
      });
    }

    for (const tier of TIER_ORDER) {
      const f = FRAMES.find(x => x.faction === here.faction && x.tier === tier);
      if (!f) continue;
      chip(tiers, TIER_NAMES[tier], f.classKey === this.#design.classKey,
        () => this.#pickClass(f.classKey));
    }

    $('dzFrameNote').textContent = here.note;
  }

  /** A class change re-seeds the frame, the sockets and the ship. Anything
   *  less would leave a Terran's gun rings on a hull that has none. */
  #pickClass(classKey: string): void {
    if (classKey === this.#design.classKey) return;
    // On an unsaved hull, picking a class is picking a DIFFERENT stock ship,
    // and that ship has an address. Say so, and let the route do the seeding:
    // one path in, so the class on screen and the class in the URL cannot
    // drift apart. On a SAVED design it is a change to that design instead, so
    // the address stays where it is.
    if (!this.#slot.designId && this.#onPickClass) {
      this.#onPickClass(classKey);
      return;
    }
    this.#design = stockFor(classKey);
    this.#socket = null;
    this.#note = null;
    this.#syncDrawSets();
    this.#refresh();
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
    // A heading and a sentence, because "empty empty empty" under no title is
    // a grid of buttons nobody can name.
    const top = document.createElement('div');
    top.className = 'dzgrp';
    top.textContent = 'Stations on this hull';
    const why = document.createElement('p');
    why.className = 'dznote';
    why.textContent = 'Every place this frame will take a part, by what it is '
      + 'for. Tap one to see what fits it; a full station shows the part it is '
      + 'holding. You never add a station here, because a station is a fact '
      + 'about the class: the architect is where those move.';
    host.append(top, why);
    // Its own scroller. Twenty nine stations laid out whole pushed the palette
    // and the facing controls off the bottom of the rail.
    const box = document.createElement('div');
    box.className = 'dzlist';
    host.appendChild(box);
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
      box.appendChild(h);
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
          // A refusal belongs to the mount it was said about. Left standing,
          // it reads as a complaint about the part just selected.
          this.#turnSaid = '';
          this.#note = null;
          this.#refresh();
        };
        row.appendChild(b);
      }
      box.appendChild(row);
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
    head.textContent = `What fits ${sock.label}`;
    const lead = document.createElement('p');
    lead.className = 'dznote';
    lead.textContent = 'Everything this station will take, with what it weighs '
      + 'on the right and what it does underneath. Tap one to fit it; tapping '
      + 'the one already in takes it out.';
    host.append(head, lead);

    const fits = MODULES.filter(m => m.fits === sock.kind);
    const held = this.#design.parts.find(p => p.socket === sock.id);
    const list = document.createElement('div');
    list.className = 'dzlist';
    host.appendChild(list);
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
      list.appendChild(b);
    }
    if (held) {
      // Which way it faces is the player's, on all three axes. Ninety degree
      // steps because the part is a volume of cells and a cell grid has four
      // orientations per axis that are still the same volume: anything between
      // would resample the part, and a resampled part is back to fractions of
      // a cell.
      //
      // Yaw alone could only bolt a gun to a deck. Roll lays it on a flank and
      // pitch tips it under a keel, which is how a broadside or a ventral
      // turret gets built at all.
      const face = facingOf(held);
      const turnHead = document.createElement('div');
      turnHead.className = 'dzgrp';
      turnHead.textContent = `Facing of the ${moduleById(held.module)?.name ?? 'part'}`;
      host.appendChild(turnHead);
      const turnNote = document.createElement('p');
      turnNote.className = 'dznote';
      turnNote.textContent = 'Which way this part is bolted on, in quarter turns'
        + ' about each of the three axes. Yaw swings it round the mast, pitch'
        + ' tips it under the keel, roll lays it on a flank. A rotation is'
        + ' refused only if the base would leave the ship or the body would'
        + ' stand where something already is.';
      host.appendChild(turnNote);
      for (const [key, name, axis] of [
        ['yaw', 'Yaw', 'yaw'],
        ['pitch', 'Pitch', 'pitch'],
        ['roll', 'Roll', 'roll'],
      ] as const) {
        const turn = document.createElement('div');
        turn.className = 'dzturn';
        turn.dataset.axis = key;
        turn.innerHTML = `<span class="k">${name}</span>`;
        for (const [label, delta] of [['\u21ba 90', 3], ['\u21bb 90', 1]] as const) {
          const b = document.createElement('button');
          b.textContent = label;
          b.onclick = () => { this.#turn(sock.id, axis, delta); };
          turn.appendChild(b);
        }
        const deg = document.createElement('b');
        deg.textContent = `${face[axis] * 90}\u00b0`;
        turn.appendChild(deg);
        host.appendChild(turn);
      }
      // Why a rotation was refused, when one was. Silence plus a part that
      // snapped back is a control a player thinks is broken.
      if (this.#turnSaid) {
        const why = document.createElement('div');
        why.className = 'dzsaid bad';
        why.id = 'dzTurnSaid';
        why.textContent = this.#turnSaid;
        host.appendChild(why);
      }

      const c = document.createElement('button');
      c.className = 'dzpart clear';
      c.innerHTML = '<span class="sw" style="background:#2b3d52"></span>'
        + '<span class="nm">Clear this socket</span>';
      c.onclick = () => { this.#fit(sock.id, null); };
      host.appendChild(c);
    }
  }

  #fit(socket: string, module: string | null): void {
    // Keep the whole facing, not the yaw alone. A socket a player has already
    // rolled onto a flank stays rolled when they swap the gun in it, and
    // carrying one of the three axes across while dropping the other two would
    // stand the part back up for no reason a player could see.
    const held = this.#design.parts.find(p => p.socket === socket);
    const face = held ? facingOf(held) : { yaw: 0, pitch: 0, roll: 0 };
    const rest = this.#design.parts.filter(p => p.socket !== socket);
    this.#turnSaid = '';
    if (!module) { this.#design.parts = rest; this.#refresh(); return; }

    // A facing that suited the last part need not suit this one: a different
    // module is a different shape, and a kept roll can bury it. So the new
    // part goes in upright, the kept facing is offered to the SAME rule that
    // guards the turn buttons, and it only stands if the rule takes it.
    // Without this the facing carries silently and the part simply vanishes
    // into whatever it landed in.
    const upright = [...rest, { socket, module }];
    const turned = [...rest,
      { socket, module, rot: face.yaw, pitch: face.pitch, roll: face.roll }];
    this.#design.parts = isUpright(face)
      || mountFouling({ ...this.#design, parts: upright }, turned, socket)
      ? upright : turned;
    this.#refresh();
  }

  /**
   * Turn a mount a quarter about one axis, if the result is legal.
   *
   * TWO rules and no others. A rotation is refused when the barbette would
   * lift off the ship frame, because a gun has to be bolted to something, and
   * when the body would stand inside a cell another part or the plating
   * already owns, because two things cannot occupy one cell. Everything else a
   * player wants to do with a mount is theirs: a turret hanging under a keel
   * or laid along a flank is a design choice, not an error.
   *
   * Checked by ASKING the rasteriser rather than by reasoning about the shape
   * here. `mountFouling` places the turned part exactly as the real raster
   * would and reports what it hit, so the editor cannot approve a rotation the
   * hull then refuses, and cannot refuse one the hull would have taken.
   */
  /** Why the last rotation was refused, shown beside the controls. Cleared by
   *  the next one that works. */
  #turnSaid = '';

  #turn(socket: string, axis: 'yaw' | 'pitch' | 'roll', delta: number): void {
    const held = this.#design.parts.find(p => p.socket === socket);
    if (!held) return;
    const face = facingOf(held);
    const next: Record<'yaw' | 'pitch' | 'roll', number> = {
      yaw: face.yaw, pitch: face.pitch, roll: face.roll,
    };
    next[axis] = (((next[axis] + delta) % 4) + 4) % 4;

    const turned = this.#design.parts.map(p => p.socket === socket
      ? { socket: p.socket, module: p.module, rot: next.yaw, pitch: next.pitch, roll: next.roll }
      : p);

    const why = mountFouling(this.#design, turned, socket);
    if (why) {
      this.#turnSaid = why;
      this.#refresh();
      return;
    }
    this.#turnSaid = '';
    this.#design.parts = turned;
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
    // A label and a footnote, not a paragraph. The label says which exterior
    // is on the bench; the rest is why, and it goes behind the `?`.
    const wrapped = this.#design.armour === 'wrapped';
    $('dzModeNote').textContent = wrapped
      ? 'Plate on the class profile.'
      : 'Plate grown off your own parts.';
    this.#why($('dzModeHead'), wrapped
      ? 'The class hull: plate laid on the frame\u2019s own profile, which is what '
        + 'gives the class its silhouette. What you change is its thickness.'
      : 'Your own exterior: plate grown off the parts themselves, so it follows '
        + 'what you built rather than what the class is. It starts bare and it '
        + 'still has to fit the mass budget.');

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
    // A DROPDOWN, because that is what swapping one whole palette for another
    // is. Five chips read as five things you might combine; they are not, they
    // are five presets and exactly one is in use.
    const fac = $('dzFactions');
    fac.innerHTML = '';
    const pal = document.createElement('select');
    pal.id = 'dzPaletteSel';
    for (const f of FACTION_PAINT) {
      const o = document.createElement('option');
      o.value = f.key;
      o.textContent = `${f.name} palette`;
      if (f.key === this.#design.faction) o.selected = true;
      pal.appendChild(o);
    }
    pal.onchange = () => {
      const f = FACTION_PAINT.find(x => x.key === pal.value);
      if (!f) return;
      this.#design.faction = f.key;
      // Land on the scheme's first swatch, because a palette whose colours are
      // not on the ship is a menu rather than a choice.
      this.#design.paint = f.swatches[0] as number;
      this.#refresh();
    };
    fac.appendChild(pal);

    const paint = $('dzPaint');
    paint.innerHTML = '';
    const scheme = paintFor(this.#design.faction);

    // TWO controls, because they were one and it was the wrong one.
    //
    // The hull's own colour is the base every livery role is an OFFSET from,
    // so setting it repaints the ship in a scheme built round it. That is
    // worth having and it is not a brush: a player who wants one panel a
    // different colour was repainting the whole ship to get it. The brush is
    // the row under it, and it lays a colour on ONE cell.
    const hullRow = document.createElement('div');
    hullRow.className = 'dzpaint';
    scheme.swatches.forEach(col => {
      const b = document.createElement('button');
      b.className = 'dzsw' + (col === this.#design.paint ? ' on' : '');
      b.style.background = `#${col.toString(16).padStart(6, '0')}`;
      b.title = `Paint the whole hull from #${col.toString(16).padStart(6, '0')}`;
      b.onclick = () => { this.#design.paint = col; this.#refresh(); };
      hullRow.appendChild(b);
    });

    const brushHead = document.createElement('div');
    brushHead.className = 'dzgrp';
    brushHead.textContent = 'Brush';
    const brushNote = document.createElement('p');
    brushNote.className = 'dznote';
    brushNote.textContent = 'Tap the model to paint one cell.';
    this.#why(brushHead, 'Armour only. The same colour on the same cell lifts it '
      + 'off again. Put the brush down to go back to tapping parts to name them.');
    const brushRow = document.createElement('div');
    brushRow.className = 'dzpaint';
    scheme.swatches.forEach((col, slot) => {
      const b = document.createElement('button');
      b.className = 'dzsw' + (this.#brushSlot === slot ? ' on' : '');
      b.style.background = `#${col.toString(16).padStart(6, '0')}`;
      const wears = this.#design.slotFinish?.[slot];
      b.title = `Paint with #${col.toString(16).padStart(6, '0')}`
        + (wears ? ` \u00b7 ${FINISHES.find(f => f.key === wears)?.name ?? wears}` : '');
      b.onclick = () => {
        this.#brushSlot = this.#brushSlot === slot ? null : slot;
        if (this.#brushSlot !== null) this.#decal = null;
        this.#refresh();
      };
      brushRow.appendChild(b);
    });

    const down = document.createElement('button');
    down.id = 'dzBrushDown';
    down.className = 'dzpart clear';
    down.innerHTML = '<span class="sw"></span><span class="nm">'
      + (this.#brushSlot === null ? 'No brush: a tap names the part it lands on'
        : 'Put the brush down') + '</span>';
    down.onclick = () => { this.#brushSlot = null; this.#refresh(); };
    const wipe = document.createElement('button');
    wipe.id = 'dzTintClear';
    wipe.className = 'dzpart clear';
    const strokes = (this.#design.tint ?? []).length;
    wipe.innerHTML = '<span class="sw"></span><span class="nm">'
      + `Wipe ${strokes} hand painted cell${strokes === 1 ? '' : 's'}</span>`;
    wipe.onclick = () => { this.#design.tint = []; this.#refresh(); };
    paint.append(hullRow, brushHead, brushNote, brushRow, down, wipe);

    // The surfaces, one row each.
    //
    // A select PER swatch was the first cut and it was the wrong control: nine
    // finishes under each of eight 34px swatches is eight boxes too narrow to
    // read their own contents, and on a 390px phone they truncated to "As
    // hu...". The slot is already selected by the swatch above, so the surface
    // it wears is one full width row that edits the selected one, which is how
    // the rest of this panel works and is one thumb sized target instead of
    // eight cramped ones.
    //
    // The frame and the parts follow it because they are the same question
    // --- decals, which are stuck ON the hull rather than part of it -------
    // Rebuilt here with everything else, because `#refresh` is the one choke
    // point every mutation already goes through and a second place that
    // redraws a pane is a second place to forget to.
    const dec = $('dzDecals');
    dec.innerHTML = '';
    DECALS.forEach((k, n) => {
      const b = document.createElement('button');
      b.className = this.#decal === n ? 'on' : '';
      const g = document.createElement('span');
      g.className = 'glyph';
      // The decal itself, not a grey square: nine identical swatches beside
      // nine names is nine names doing all the work.
      const thumb = windowThumb(k.key);
      if (thumb) {
        g.style.backgroundImage = `url(${thumb.url})`;
        // The file is a strip of variants side by side, so this shows the
        // first one rather than all of them squashed into 20 pixels.
        g.style.backgroundSize = `${thumb.variants * 100}% 100%`;
      }
      b.append(g, document.createTextNode(k.name));
      b.onclick = () => {
        // Arming a decal puts the brush down: two tools cannot both own a tap.
        this.#decal = this.#decal === n ? null : n;
        if (this.#decal !== null) this.#brushSlot = null;
        this.#refresh();
      };
      dec.appendChild(b);
    });
    const painted = (this.#design.decal ?? []).length;
    $('dzDecalCount').textContent = painted
      ? `${painted} cell${painted === 1 ? '' : 's'}` : 'none';
    ($('dzDecalClear') as HTMLButtonElement).disabled = !painted;

    // asked about the two surfaces nobody could choose before: the frame wore
    // the plating's finish and every part wore one hard coded greeble, which
    // did not matter while a hull was a sealed skin and does now, because a
    // hole in the plating is a look at both of them.
    const inner = $('dzInner');
    inner.innerHTML = '';
    // EVERY slot, each beside its own colour, and then the four things that
    // are not armour.
    //
    // One row that edited "the selected slot" meant a player had to remember
    // which swatch they last touched to know what the dropdown was about, and
    // seven of the eight were invisible. Eight rows say which colour is which
    // surface by standing next to it.
    const rows: Array<[string, string, string | null, (k: string | null) => void,
      string?, number?]> = scheme.swatches.map((col, slot) => [
      `Slot ${slot + 1}`,
      `What every cell painted in #${col.toString(16).padStart(6, '0')} is made of`,
      this.#design.slotFinish?.[slot] ?? null,
      (key: string | null) => {
        // Sparse until something is actually chosen, so a design that never
        // touched this still falls back to the hull wide finish rather than
        // freezing today's default into eight slots.
        const list = (this.#design.slotFinish ?? []).slice();
        while (list.length < scheme.swatches.length) list.push(null);
        list[slot] = key;
        this.#design.slotFinish = list;
      },
      'As hull',
      col,
    ] as [string, string, string | null, (k: string | null) => void, string?, number?]);
    rows.push(
      ['Hull frame', 'Surface of the frame under the plating',
        this.#design.frameFinish ?? DEFAULT_FRAME_FINISH,
        key => { this.#design.frameFinish = key ?? DEFAULT_FRAME_FINISH; }],
      ['Engines and thrusters', 'Surface of every bell and attitude block',
        this.#design.driveFinish ?? this.#design.partFinish ?? DEFAULT_PART_FINISH,
        key => { this.#design.driveFinish = key ?? DEFAULT_PART_FINISH; }],
      ['Weapons', 'Surface of the barbettes, turrets and missile pads',
        this.#design.weaponFinish ?? this.#design.partFinish ?? DEFAULT_PART_FINISH,
        key => { this.#design.weaponFinish = key ?? DEFAULT_PART_FINISH; }],
      ['Subsystems', 'Surface of the bridge, the berths, the clamps and the holds',
        this.#design.partFinish ?? DEFAULT_PART_FINISH,
        key => { this.#design.partFinish = key ?? DEFAULT_PART_FINISH; }],
    );
    for (const [label, title, cur, set, blank, swatch] of rows) {
      const row = document.createElement('div');
      row.className = 'dzrow dzsurf';
      // The colour this row is about, drawn on the row. Eight dropdowns
      // labelled "Slot 1" to "Slot 8" is eight rows nobody can map onto the
      // swatches above them, which is the complaint this is answering.
      if (swatch !== undefined) {
        const chip = document.createElement('span');
        chip.className = 'dzsw sm';
        chip.style.background = `#${swatch.toString(16).padStart(6, '0')}`;
        row.appendChild(chip);
      }
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      row.appendChild(k);
      const sel = this.#finishPick(cur, title, key => { set(key); this.#refresh(); }, blank);
      row.appendChild(sel);
      inner.appendChild(row);
    }
  }

  /**
   * One finish picker: every surface in `FINISHES`, and what it is called.
   *
   * A select rather than a row of chips. There are nine finishes and this is
   * drawn ten times over on a 390px phone, and ninety chips is a panel nobody
   * can hit; a select is one tap target whatever the list length, and the
   * platform's own list is already thumb sized.
   */
  #finishPick(
    cur: string | null, title: string, onPick: (key: string | null) => void,
    blank?: string,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'dzfin';
    sel.title = title;
    if (blank) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = blank;
      sel.appendChild(o);
    }
    for (const f of FINISHES) {
      const o = document.createElement('option');
      o.value = f.key;
      o.textContent = f.name;
      sel.appendChild(o);
    }
    sel.value = cur ?? '';
    sel.onchange = () => onPick(sel.value || null);
    return sel;
  }

  // ------------------------------------------------------- drawing armour --

  /**
   * The slice editor: one z plane of the lattice, flat, at tap size.
   *
   * Drawing composes with the generated exterior rather than replacing it,
   * because the useful thing is rarely a hull drawn from nothing: it is the
   * class hull with a sponson added here and a hangar mouth cut there. Two
   * lists on the record, `plate` and `cut`, applied after everything else.
   *
   * A canvas rather than a grid of elements: 1,024 cells a slice, repainted on
   * every pointer move, is a thousand nodes to lay out per frame against one
   * fill loop.
   */
  /** The z range this slab covers, inclusive. */
  #slabZ(): readonly [number, number] {
    const NZ = this.#lat.nz;
    const z0 = Math.min(this.#slabCount() - 1, this.#slab) * this.#depth;
    return [z0, Math.min(NZ - 1, z0 + this.#depth - 1)];
  }

  /** How many slabs the lattice divides into at the current thickness. */
  #slabCount(): number { return Math.ceil(this.#lat.nz / this.#depth); }

  /** Rebuild the fast sets from the record. Called whenever the record is
   *  replaced wholesale: a class change, a reset, a design loaded. */
  #syncDrawSets(): void {
    this.#drawSet = new Set(this.#design.plate ?? []);
    this.#cutSet = new Set(this.#design.cut ?? []);
  }

  /**
   * Is this cell solid, as the ship stands right now?
   *
   * The cached raster plus the pencil on top. Re-rasterising to answer would
   * be four milliseconds a cell and a drag asks per pixel.
   */
  #solidAt(n: number, grid: Uint8Array): boolean {
    if (n < 0 || n >= this.#lat.cells) return false;
    if (this.#drawSet.has(n)) return true;
    if (this.#cutSet.has(n)) return false;
    return (grid[n] as number) !== Mat.Empty;
  }

  /** Face neighbours, staying inside the lattice and never wrapping a row. */
  #neighbours(n: number): number[] {
    const { nx: NX, ny: NY, nz: NZ } = this.#lat;
    const i = n % NX, j = ((n / NX) | 0) % NY, k = (n / (NX * NY)) | 0;
    const out: number[] = [];
    if (i > 0) out.push(n - 1);
    if (i < NX - 1) out.push(n + 1);
    if (j > 0) out.push(n - NX);
    if (j < NY - 1) out.push(n + NX);
    if (k > 0) out.push(n - NX * NY);
    if (k < NZ - 1) out.push(n + NX * NY);
    return out;
  }

  #renderSlice(): void {
    const cv = $<HTMLCanvasElement>('dzSliceCanvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { grid, purp, tone } = rasterise(this.#design);
    const L = this.#lat;
    const { nx: NX, ny: NY, nz: NZ } = L;
    // Pulled back into range HERE rather than only inside `#slabZ`, because
    // the readout and the slider both show the raw index: opening a corvette
    // while parked amidships a heavy cruiser would paint cell 40 and say 64.
    this.#slab = Math.max(0, Math.min(this.#slabCount() - 1, this.#slab));
    const [za, zb] = this.#slabZ();
    // The slab is drawn as one picture: a cell shows if ANY z in the slab has
    // it, taking the material of the first that does. Drawing on it writes the
    // whole slab, so showing only its front plane would be a lie about what a
    // stroke does.
    const k = za;
    const px = cv.width / NX;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const inSlab = (i: number, j: number): number => {
      for (let z = za; z <= zb; z++) {
        const m = grid[cellIndex(L, i, j, z)] as number;
        if (m) return m;
      }
      return 0;
    };
    const purpIn = (i: number, j: number): number => {
      for (let z = za; z <= zb; z++) {
        const n = cellIndex(L, i, j, z);
        if (grid[n]) return purp[n] as number;
      }
      return 0;
    };
    /** The livery role of the first filled cell in the slab, so the slice is
     *  painted the same colours the model beside it is. */
    const toneIn = (i: number, j: number): number => {
      for (let z = za; z <= zb; z++) {
        const n = cellIndex(L, i, j, z);
        if (grid[n]) return tone[n] as number;
      }
      return 0;
    };

    const prof = frameFor(this.#design.classKey).profile;
    const st = hullAt(prof, k);

    // The hull line for this station, so a player drawing knows where the
    // class thinks its own skin is.
    ctx.strokeStyle = '#2b3d5288';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(NX / 2 * px, NY / 2 * px, (st[0] as number) * px, (st[1] as number) * px,
      0, 0, Math.PI * 2);
    ctx.stroke();

    // Onion skin: the SLABS either side, dimmer the further out, so a run
    // being drawn can be lined up with what is already there in front of and
    // behind it. Drawn under the live slab, furthest first.
    for (let d = this.#onion; d >= 1; d--) {
      for (const side of [-1, 1]) {
        const oa = (this.#slab + side * d) * this.#depth;
        if (oa < 0 || oa >= NZ) continue;
        const ob = Math.min(NZ - 1, oa + this.#depth - 1);
        ctx.globalAlpha = 0.34 / d;
        ctx.fillStyle = side < 0 ? '#35C7FF' : '#FFD24B';
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
          let any = false;
          for (let z = oa; z <= ob && !any; z++) if (grid[cellIndex(L, i, j, z)]) any = true;
          if (!any) continue;
          ctx.fillRect(i * px + px * 0.28, (NY - 1 - j) * px + px * 0.28, px * 0.44, px * 0.44);
        }
      }
    }
    ctx.globalAlpha = 1;

    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const mat = inSlab(i, j);
      if (!mat) continue;
      const col = mat === Mat.Plate || mat === Mat.Skinned
        ? armourColour(this.#design.faction, this.#design.paint, toneIn(i, j))
        : cellColour(mat, purpIn(i, j), this.#design.paint);
      ctx.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
      // y grows upward on the ship and downward on a canvas.
      ctx.fillRect(i * px, (NY - 1 - j) * px, px - 0.6, px - 0.6);
      // What a player may edit is only ever the plate. Everything else is
      // drawn dimmer, so the difference is visible rather than remembered.
      if (mat !== Mat.Plate && mat !== Mat.Skinned) {
        ctx.fillStyle = '#0a0f17aa';
        ctx.fillRect(i * px, (NY - 1 - j) * px, px - 0.6, px - 0.6);
      }
    }

    // What this slice owes to the pencil rather than the sliders.
    const inZ = (n: number) => {
      const z = (n / (NX * NY)) | 0;
      return z >= za && z <= zb;
    };
    ctx.strokeStyle = '#FFD24B';
    ctx.lineWidth = 1.2;
    for (const n of this.#design.plate ?? []) {
      if (!inZ(n)) continue;
      const i = n % NX, j = ((n / NX) | 0) % NY;
      ctx.strokeRect(i * px + 0.6, (NY - 1 - j) * px + 0.6, px - 1.8, px - 1.8);
    }
    ctx.strokeStyle = '#F03B3B';
    for (const n of this.#design.cut ?? []) {
      if (!inZ(n)) continue;
      const i = n % NX, j = ((n / NX) | 0) % NY;
      const x = i * px, y = (NY - 1 - j) * px;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + px - 2, y + px - 2);
      ctx.moveTo(x + px - 2, y + 2); ctx.lineTo(x + 2, y + px - 2);
      ctx.stroke();
    }

    // Where a turret swings. Hatched rather than filled, because these cells
    // are not occupied: they are RESERVED, and a player who cannot see the
    // difference between "there is something there" and "nothing may go
    // there" will keep drawing into it and keep being refused.
    const { turrets } = rasterise(this.#design);
    if (turrets.length) {
      ctx.strokeStyle = '#F03B3B55';
      ctx.lineWidth = 1;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        let hit = false;
        for (let z = za; z <= zb && !hit; z++) if (inTurret(turrets, i, j, z)) hit = true;
        if (!hit || inSlab(i, j)) continue;
        const x = i * px, y = (NY - 1 - j) * px;
        ctx.beginPath();
        ctx.moveTo(x, y + px); ctx.lineTo(x + px, y);
        ctx.stroke();
      }
    }

    // The mirror planes, so a symmetric stroke has something to aim at.
    ctx.strokeStyle = '#35C7FF66';
    ctx.lineWidth = 1;
    if (this.#mirrorX) {
      ctx.beginPath();
      ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height);
      ctx.stroke();
    }
    if (this.#mirrorY) {
      ctx.beginPath();
      ctx.moveTo(0, cv.height / 2); ctx.lineTo(cv.width, cv.height / 2);
      ctx.stroke();
    }

    $('dzSliceNum').textContent = String(this.#slab);
    const range = $('dzSliceAt') as HTMLInputElement;
    range.max = String(Math.max(0, this.#slabCount() - 1));
    range.value = String(this.#slab);
    $('dzSliceSpan').textContent = za === zb
      ? `z ${za} of ${NZ}` : `z ${za} to ${zb} of ${NZ}`;
    const added = (this.#design.plate ?? []).length, cut = (this.#design.cut ?? []).length;
    $('dzDrawCount').textContent = this.#drawSaid
      ? this.#drawSaid
      : added || cut
        ? `${added} cell${added === 1 ? '' : 's'} drawn, ${cut} cut, of ${DRAWN_MAX}`
        : 'Nothing drawn by hand yet. The sliders above built what you see.';
  }

  /**
   * Paint one column of cells, `depth` slices deep from the current one.
   *
   * Every added cell must touch something: armour, frame or a fitted part, on
   * a face. Plate hanging in space beside a hull is the same defect the pylons
   * were written to end, and a pencil that can make it is a pencil that will.
   * A stroke still works outward from the hull because each cell it lays is
   * itself something for the next one to touch.
   */
  #paintCell(i: number, j: number): boolean {
    const L = this.#lat;
    const { nx: NX, ny: NY } = L;
    if (i < 0 || j < 0 || i >= NX || j >= NY) return false;
    const { grid, turrets, hollow } = rasterise(this.#design);
    const plate = (this.#design.plate ??= []);
    const cut = (this.#design.cut ??= []);
    const drop = (list: number[], set: Set<number>, v: number) => {
      if (!set.has(v)) return false;
      const at = list.indexOf(v);
      if (at >= 0) list.splice(at, 1);
      set.delete(v);
      return true;
    };
    let changed = false;
    let blocked = false;
    let inGun = false;

    // Where the stroke lands: this column, plus its mirror images if either
    // axis is on. Deduped, because a cell on a mirror plane is its own mirror
    // and painting it twice would undo it.
    const columns = new Set<number>([i * NY + j]);
    if (this.#mirrorX) columns.add((NX - 1 - i) * NY + j);
    if (this.#mirrorY) columns.add(i * NY + (NY - 1 - j));
    if (this.#mirrorX && this.#mirrorY) columns.add((NX - 1 - i) * NY + (NY - 1 - j));

    const [za, zb] = this.#slabZ();
    for (const col of columns) {
      const ci = (col / NY) | 0, cj = col % NY;
      for (let k = za; k <= zb; k++) {
        const n = cellIndex(L, ci, cj, k);
        const mat = grid[n] as number;

        if (this.#brush === 'add') {
          // A turret swings through its own box, so nothing may be drawn in
          // one. Refused here as well as carved out of the generated exterior,
          // because a pencil that can put a cell somewhere the rasteriser will
          // not keep is a pencil that lies.
          if (inTurret(turrets, ci, cj, k)) { inGun = true; continue; }
          // And a drive's THROAT, for the same reason: a bell is a one cell
          // wall round a cavity, the cavity is the engine's, and a cell drawn
          // in one makes the hull illegal. Refusing the stroke is how a player
          // finds that out from the pencil rather than from the verdict.
          if (hollow[n]) { inGun = true; continue; }
          // Undoing a cut is the same gesture as adding, which is what anyone
          // expects from a pencil that has just rubbed something out.
          if (drop(cut, this.#cutSet, n)) { changed = true; continue; }
          if (this.#solidAt(n, grid)) continue;      // something is already there
          if (plate.length >= DRAWN_MAX) break;
          if (!this.#neighbours(n).some(m => this.#solidAt(m, grid))) { blocked = true; continue; }
          plate.push(n);
          this.#drawSet.add(n);
          changed = true;
          continue;
        }

        if (drop(plate, this.#drawSet, n)) { changed = true; continue; }
        // Only plate can be cut. The frame and the parts are not armour.
        if (mat !== Mat.Plate && mat !== Mat.Skinned) continue;
        if (this.#cutSet.has(n) || cut.length >= DRAWN_MAX) continue;
        cut.push(n);
        this.#cutSet.add(n);
        changed = true;
      }
    }

    if (changed && this.#brush === 'cut') this.#dropOrphans(grid);
    this.#drawSaid = changed ? ''
      : inGun ? 'a turret swings through there: nothing else may be in its box'
      : blocked ? 'that cell touches nothing: armour has to reach the ship'
      : '';
    return changed;
  }

  /**
   * A cut can strand what was drawn on top of it, so the invariant is kept
   * rather than merely checked at the moment of drawing: anything the pencil
   * added that no longer reaches the ship comes off with it.
   */
  #dropOrphans(grid: Uint8Array): void {
    const drawn = this.#design.plate ?? [];
    if (!drawn.length) return;
    // Anchored: touching something that is NOT itself hand drawn.
    const anchored = new Set<number>();
    const queue: number[] = [];
    for (const n of drawn) {
      if (this.#neighbours(n).some(m => !this.#drawSet.has(m) && this.#solidAt(m, grid))) {
        anchored.add(n);
        queue.push(n);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      for (const m of this.#neighbours(queue[head] as number)) {
        if (this.#drawSet.has(m) && !anchored.has(m)) { anchored.add(m); queue.push(m); }
      }
    }
    if (anchored.size === drawn.length) return;
    this.#design.plate = drawn.filter(n => anchored.has(n));
    this.#drawSet = new Set(this.#design.plate);
  }

  #bindSlice(): void {
    const cv = $<HTMLCanvasElement>('dzSliceCanvas');
    let painting = false, last = -1;
    const cellFrom = (e: PointerEvent): readonly [number, number] => {
      const r = cv.getBoundingClientRect();
      const { nx: NX, ny: NY } = this.#lat;
      const i = Math.floor(((e.clientX - r.left) / r.width) * NX);
      const j = NY - 1 - Math.floor(((e.clientY - r.top) / r.height) * NY);
      return [i, j];
    };
    const at = (e: PointerEvent) => {
      const [i, j] = cellFrom(e);
      const key = i * this.#lat.ny + j;
      if (key === last) return;
      last = key;
      if (this.#paintCell(i, j)) this.#drawChanged();
    };
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      painting = true; last = -1;
      this.#drawing = true;
      at(e);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => { if (painting) at(e); });
    // The settle starts when the finger lifts, not when the last cell landed.
    const stop = () => {
      painting = false; last = -1;
      this.#drawing = false;
      this.#scanArcs();
    };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);

    const go = (k: number) => {
      this.#slab = Math.max(0, Math.min(this.#slabCount() - 1, k));
      this.#renderSlice();
      this.#renderSlabBox();
    };
    $('dzSliceDown').onclick = () => { go(this.#slab - 1); };
    $('dzSliceUp').onclick = () => { go(this.#slab + 1); };
    ($('dzSliceAt') as HTMLInputElement).oninput = e => {
      go(Number((e.target as HTMLInputElement).value));
    };
    ($('dzOnion') as HTMLInputElement).oninput = e => {
      this.#onion = Number((e.target as HTMLInputElement).value);
      $('dzOnionN').textContent = String(this.#onion);
      this.#renderSlice();
    };
    ($('dzDepth') as HTMLInputElement).oninput = e => {
      // Thicker slices means FEWER of them, so the cursor is remapped by the
      // z it was standing on rather than kept as an index into a scale that
      // just changed under it.
      const wasZ = this.#slab * this.#depth;
      this.#depth = Math.max(1, Number((e.target as HTMLInputElement).value));
      $('dzDepthN').textContent = String(this.#depth);
      this.#slab = Math.max(0, Math.min(this.#slabCount() - 1,
        Math.floor(wasZ / this.#depth)));
      this.#renderSlice();
      this.#renderSlabBox();
    };
    const mirror = (id: string, set: (on: boolean) => void, get: () => boolean) => {
      $(id).onclick = () => {
        set(!get());
        this.#syncBrush();
        this.#renderSlice();
      };
    };
    mirror('dzMirrorX', v => { this.#mirrorX = v; }, () => this.#mirrorX);
    mirror('dzMirrorY', v => { this.#mirrorY = v; }, () => this.#mirrorY);
    $('dzBrushAdd').onclick = () => { this.#brush = 'add'; this.#syncBrush(); };
    $('dzBrushCut').onclick = () => { this.#brush = 'cut'; this.#syncBrush(); };
    $('dzSliceClear').onclick = () => {
      const [za, zb] = this.#slabZ();
      const { nx: NX, ny: NY } = this.#lat;
      const off = (n: number) => {
        const z = (n / (NX * NY)) | 0;
        return z < za || z > zb;
      };
      this.#design.plate = (this.#design.plate ?? []).filter(off);
      this.#design.cut = (this.#design.cut ?? []).filter(off);
      this.#syncDrawSets();
      this.#dropOrphans(rasterise(this.#design).grid);
      this.#drawChanged();
    };
    $('dzDrawClear').onclick = () => {
      this.#design.plate = [];
      this.#design.cut = [];
      this.#syncDrawSets();
      this.#drawChanged();
    };
    this.#syncBrush();
  }

  /**
   * The slab, boxed on the model.
   *
   * A flat grid on the right says WHAT you are drawing and nothing at all
   * about WHERE: on a 64 cell hull, "slice 32" is a number, and a box round
   * the part of the ship it cuts is a place. It grows and shrinks with the
   * thickness, which is the other half of what the control does.
   *
   * Only while the Armour tab is open. A box round a slab you cannot draw on
   * is decoration over the thing you are trying to look at.
   */
  #renderSlabBox(): void {
    this.#clear(this.#slabBox);
    if (this.#tab !== 'armour') return;
    const cell = VOXEL;
    const { nx: NX, ny: NY, nz: NZ } = this.#lat;
    const [za, zb] = this.#slabZ();
    const depth = (zb - za + 1) * cell;
    const mid = ((za + zb + 1) / 2 - NZ / 2) * cell;
    const w = NX * cell, h = NY * cell;

    const box = new THREE.LineSegments(
      this.#geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, depth))),
      this.#mat(new THREE.LineBasicMaterial({
        color: 0xFFD24B, transparent: true, opacity: 0.5, depthTest: false })));
    box.position.z = mid;
    box.renderOrder = 9;
    this.#slabBox.add(box);

    // The two cut planes, filled faintly, so the slab reads as a slab rather
    // than as a wireframe crate floating round the hull.
    for (const z of [za, zb + 1]) {
      const plane = new THREE.Mesh(
        this.#geo(new THREE.PlaneGeometry(w, h)),
        this.#mat(new THREE.MeshBasicMaterial({
          color: 0xFFD24B, transparent: true, opacity: 0.06,
          side: THREE.DoubleSide, depthWrite: false })));
      plane.position.z = (z - NZ / 2) * cell;
      this.#slabBox.add(plane);
    }
  }

  #syncBrush(): void {
    $('dzBrushAdd').className = this.#brush === 'add' ? 'on' : '';
    $('dzBrushCut').className = this.#brush === 'cut' ? 'on' : '';
    $('dzMirrorX').className = this.#mirrorX ? 'on' : '';
    $('dzMirrorY').className = this.#mirrorY ? 'on' : '';
  }

  /**
   * A change to the drawing repaints the slice at once and the hull on the
   * next frame.
   *
   * Rasterising the whole lattice takes about four milliseconds, and a drag
   * fires per pixel. Doing it inline made the pencil stutter under its own
   * feedback, the same way the envelope slider did before it was deferred.
   */
  #drawChanged(): void {
    this.#renderSlice();
    if (this.#pending) return;
    this.#scanArcs();
    this.#pending = requestAnimationFrame(() => {
      this.#pending = 0;
      this.#derived = derive(this.#design);
      this.#rebuild();
      this.#renderHeader();
      this.#renderStats();
      this.#renderSlice();
    });
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
    // A ship is ONE object, and a player who draws a plate that reaches
    // nothing has drawn a block floating beside their hull. The pencil already
    // refuses a stroke that touches nothing; this is what says so about the
    // whole design, including cells a later edit stranded, and it is a note
    // rather than a gate because the rasteriser has already taken them off:
    // the picture is never invalid, and this is what happened to make it so.
    if (d.orphans > 0) {
      h += `<p class="dznote">${d.orphans} cell${d.orphans === 1 ? '' : 's'} `
        + 'reached nothing and came off. Armour has to be welded to the ship: '
        + 'a piece touching it only at an edge is a piece touching nothing.</p>';
    }

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
        + 'Yaw, Pitch and Roll set where the model SITS, which moves its cells and '
        + 'therefore what its own hull shadows, and never what it is allowed to shoot '
        + 'at. Turn the arcs on over the model to see them, and Target for something '
        + 'to track.</p>';

      // And the arc this HULL leaves, which is the other half and the half
      // nobody authored. Scanned off the voxels, so it is a measurement and
      // says so, and the core reads the same mask when the shot goes off.
      h += '<div class="dzgrp">Blocked by this hull</div><div class="dzrows">';
      const stale = this.#maskSig !== rasterSig(this.#design);
      this.#rigs.forEach((r, n) => {
        const m = this.#masks[n];
        h += row(r.label, !m || stale ? 'scanning\u2026'
          : `${(blockedPct(m)).toFixed(0)}% of the sphere`);
      });
      h += '</div>';
      h += '<p class="dznote">Every weapon here traverses freely, so the only thing '
        + 'that stops one is the ship it is bolted to. A ray per direction, 64 by 32 '
        + 'of them, cast through the hull you drew: what comes back is a mask the '
        + 'resolver reads before it fires. Rescanned a second or so after you stop '
        + 'drawing, not while you draw.</p>';

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
      this.#syncDrawSets();
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
      this.#design.plate = [];
      this.#design.cut = [];
      this.#syncDrawSets();
      this.#refresh();
    };
    // A hull as a FILE. The library needs a server and an account; this needs
    // neither, which is what makes it the way to keep a design, send one, or
    // put one back after a rebuild.
    $('dzExport').onclick = () => {
      const name = $<HTMLInputElement>('dzSaveName')?.value.trim()
        || this.#slot.name || this.#design.classKey;
      const url = URL.createObjectURL(new Blob([designToJson(this.#design, name)],
        { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()}.ship.json`;
      a.click();
      // Revoked on a later turn: revoking before the browser has begun the
      // download cancels it.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.#said(`exported ${a.download}`);
    };
    $('dzImport').onclick = () => { $<HTMLInputElement>('dzDesignPick').click(); };
    $<HTMLInputElement>('dzDesignPick').onchange = ev => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      // Cleared so the same file chosen twice fires again: `change` does not
      // when the value is unchanged, and re-importing after an edit is the
      // obvious thing to try.
      input.value = '';
      if (!file) return;
      void file.text().then(text => {
        const { design, name, why } = designFromJson(text);
        if (!design) { this.#said(why ?? 'could not read that file', true); return; }
        // Loaded as a NEW hull rather than over the row that happens to be
        // open: a file is somebody's ship, not an edit to yours, and saving it
        // should make a design rather than quietly rewrite one.
        this.loadDesign(design, { designId: null, name: name ?? '', mine: true });
        this.#said(`loaded ${name ?? 'a hull'} from ${file.name}`);
      });
    };
    // Take the plate off and leave the frame and its parts standing. The mode
    // is left alone: this zeroes whichever exterior is being edited.
    $('dzBare').onclick = () => {
      for (const k of SECTIONS) this.#design.sections[k] = 0;
      this.#refresh();
    };
    const tab = (id: string, which: 'parts' | 'armour' | 'decor' | 'stats' | 'frame') => {
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
    tab('dzTabFrame', 'frame'); tab('dzTabDecor', 'decor');
    $('dzDecalClear').onclick = () => {
      this.#design.decal = [];
      this.#refresh();
    };
    this.#bindSlice();
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
      ['dzTabDecor', 'dzPaneDecor', 'decor'],
      ['dzTabFrame', 'dzPaneFrame', 'frame'],
      ['dzTabStats', 'dzPaneStats', 'stats'],
    ] as const) {
      // TOGGLE, never assign. `dzTabFrame` carries `archonly`, which is what
      // keeps the architect's tab out of the shipyard, and assigning
      // `className` wiped it the first time this ran: from then on the Frame
      // tab stood in the yard's tab bar on every hull, and pressing it took a
      // player who had asked for a shipyard into the architect on whatever
      // class they happened to be looking at.
      $(id).classList.toggle('on', this.#tab === which);
      $(pane).classList.toggle('hidden', this.#tab !== which);
    }
    this.#renderSlabBox();
    this.#resize();
  }

  /** Read only, for the harness. It observes and never drives. */
  debug() {
    return {
      classKey: this.#design.classKey,
      parts: this.#design.parts.length,
      // Which hull's unsaved work is on screen. The cell counts a harness
      // compares across a reload are already here as `drawn` and `cutCells`.
      draftKey: this.#draftKey,
      socket: this.#socket,
      derived: this.#derived,
      stockCount: STOCK.length,
      voxels: this.#voxelCount,
      /**
       * What the preview is actually drawing each surface WITH.
       *
       * Read off the live materials rather than off the record, because that
       * is the whole question: a finish that was chosen and never reached the
       * material draws exactly like one that was never chosen, and so does one
       * whose file failed to load. The map answers the same question about the
       * same design through `ftDebug.surfaces()`.
       */
      surfaces: [
        ...(this.#surfaces?.plate ?? []).map((m, b) => ({ what: `plate${b}`, m })),
        { what: 'frame', m: this.#surfaces?.frame },
        { what: 'drive', m: this.#surfaces?.drive },
        { what: 'weapon', m: this.#surfaces?.weapon },
        { what: 'part', m: this.#surfaces?.part },
      ].map(({ what, m }) => {
        const img = m?.normalMap?.image as { src?: string; width?: number } | undefined;
        return {
          what,
          finish: m?.normalMap ? (img?.src ?? 'bound').split('/').slice(-1)[0] as string : 'none',
          loaded: !!img?.width,
        };
      }),
      plate: this.#plate,
      arcs: this.#showArcs,
      target: this.#showTarget,
      // TWO pairs of angles, because a mount now has two frames and a check
      // that conflated them could not ask either question. `yaw` and `pitch`
      // are the MOUNT's own: zero is straight ahead on the mount whatever
      // facing it was bolted at, which is what "at rest" means. `shipYaw` and
      // `shipPitch` are where the barrel actually points, which is the frame
      // the authored arc is measured in.
      //
      // The ship frame euler used to stand in for both and was silently the
      // wrong one for the first: it reported a rolled mount's rest as some
      // arbitrary angle, and the harness compared it against a `rest` field
      // that was never published at all, so the comparison was NaN and the
      // check passed on every hull without ever looking.
      rigs: this.#rigs.map(r => ({ label: r.label, key: r.gun.key,
        arcH: r.gun.arcH, arcV: r.gun.arcV, bears: r.bears,
        yaw: +(r.yaw * 180 / Math.PI).toFixed(1),
        pitch: +(r.pitch * 180 / Math.PI).toFixed(1),
        ...barrelOf(r) })),
      bearing: this.#rigs.filter(r => r.bears).length,
      // The scan, so the harness can wait for it and read what it found
      // without ever being able to drive it.
      arcScan: {
        pending: this.#maskSig !== rasterSig(this.#design),
        drawing: this.#drawing,
        settle: ARC_SETTLE,
        blocked: this.#masks.map(m => +blockedPct(m).toFixed(2)),
        drawn: this.#arcs.children.filter(c => c.name.startsWith('blocked')).length,
        scans: this.#maskScans,
      },
      showPlate: this.#plate === 'on',
      armour: this.#design.armour,
      slot: this.#slot,
      slab: this.#slab,
      slabZ: this.#slabZ(),
      slabs: this.#slabCount(),
      slabBox: this.#slabBox.children.length
        ? (() => {
          const b = new THREE.Box3().setFromObject(this.#slabBox);
          return { parts: this.#slabBox.children.length,
            depth: +(b.max.z - b.min.z).toFixed(3),
            mid: +((b.max.z + b.min.z) / 2).toFixed(3) };
        })()
        : null,
      brush: this.#brush,
      /** Where the camera is standing, so the harness can turn the model and
       *  check that the distance does NOT move with it. */
      cam: {
        yaw: +this.#cam.yaw.toFixed(3),
        pitch: +this.#cam.pitch.toFixed(3),
        zoom: +this.#cam.zoom.toFixed(3),
        dist: +this.#camera.position.distanceTo(this.#centre).toFixed(3),
      },
      mirrorX: this.#mirrorX,
      mirrorY: this.#mirrorY,
      drawn: (this.#design.plate ?? []).length,
      cutCells: (this.#design.cut ?? []).length,
      onion: this.#onion,
      depth: this.#depth,
      drawSaid: this.#drawSaid,
      armourTones: [...this.#armourTones],
      /**
       * Window panes actually DRAWN in the yard, by decal, and the quads each
       * came to.
       *
       * Counted off the meshes rather than off the design, because the defect
       * this exists to catch is exactly a hull whose rooms all have windows
       * and a screen that draws none of them: asking the design would have
       * reported healthy numbers throughout.
       */
      windows: (() => {
        const by: Record<string, number> = {};
        for (const o of this.#hull.children) {
          const m = o as THREE.Mesh;
          const key = (m.material as THREE.Material | undefined)?.name;
          if (!m.isMesh || !key?.startsWith('window:')) continue;
          const n = (m.geometry.getIndex()?.count ?? 0) / 6;
          by[key.slice(7)] = (by[key.slice(7)] ?? 0) + n;
        }
        return by;
      })(),
      /** What the BROAD PLATING came out, as against the whole scheme. It is
       *  the picked swatch by construction (the livery makes the pick role
       *  `hull`), and that is the half of the rule a set of eight colours
       *  cannot show: the set is the same set whichever swatch is picked. */
      hullTone: armourColour(this.#design.faction, this.#design.paint,
        roleCode('hull')),
      enclosedOutside: rasterise(this.#design).enclosedOutside,
      flushProud: rasterise(this.#design).flushProud,
      turrets: rasterise(this.#design).turrets.map(t => ({ ...t })),
      fouled: rasterise(this.#design).fouled,
      orphans: rasterise(this.#design).orphans,
      /** One cell's material. Observation only: the harness uses it to aim a
       *  gesture at a cell it can describe, rather than at a pixel it hopes
       *  about. Nothing in the editor reads it back. */
      /** One derivation, for measuring what the crossing costs. */
      timeDerive: () => derive(this.#design).hull,
      cellAt: (i: number, j: number, k: number) =>
        rasterise(this.#design).grid[cellIndex(this.#lat, i, j, k)] ?? 0,
      // The lattice this hull is on, because a harness that walks the grid
      // cannot know how far to walk without it: a corvette is 24 x 24 x 48
      // and a heavy cruiser 64 x 64 x 128.
      lat: { ...this.#lat },
      marks: this.#marks.children.length,
      note: this.#note,
      gridHash: this.#gridHash,
      faction: this.#design.faction,
      paint: this.#design.paint,
      /** The brush, and what it has laid down. Observed by the harness; the
       *  harness never sets either. */
      brushSlot: this.#brushSlot,
      tint: (this.#design.tint ?? []).length,
      decal: (this.#design.decal ?? []).length,
      decalArmed: this.#decal,
      hist: this.#hist,
    };
  }
}
