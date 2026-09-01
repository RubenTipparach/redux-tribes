/**
 * One ship, taken apart and labelled.
 *
 * The fleet chip says a hull is hurt. It cannot say WHERE, and where is the
 * whole question: a shot goes into a volume, and which volume decides whether
 * the ship stops turning, stops shooting or just loses paint. This is the
 * shipyard's view of a hull with the live damage model laid over it, so the
 * thing a player designed and the thing that is being shot at are looked at in
 * the same way.
 *
 * It draws and it names. Every number in it was computed by the core and
 * handed over already formatted: the volumes come from `ft_read_subs`, their
 * names from the one naming helper the rails use, and nothing here works out
 * what a hit would do. A modal that decided anything would be a second opinion
 * about a rule (ADR-2).
 */

import * as THREE from 'three';
import { PURPOSE, arcMasks, gunByKey, partAtCell, type Design } from './design.js';
import { hullMesh, tintHull, type HullMesh } from './hull.js';
import { buildWound } from './wound.js';
import { blockedPct } from './turret.js';
import { finishMap, partMap, studioEnv, windowMaterial } from './textures.js';
import { bindOrbit, frameBox, orbitStart } from './orbitcam.js';
import { SUB_BLURB, SUB_LABEL, type Vec3 } from '../sim/types.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/**
 * What each kind is drawn in.
 *
 * The shipyard's own purpose palette rather than a second set of hues: a
 * player who learned that orange is propulsion in the editor should not have
 * to learn a different orange here.
 */
const KIND_HUE: Record<number, number> = {
  0: PURPOSE.structure.base,
  1: PURPOSE.propulsion.base,
  2: PURPOSE.attitude.base,
  3: PURPOSE.gun.base,
  4: PURPOSE.command.base,
};
const DEAD_HUE = 0xff4b4b;
/** How loud a volume is when nothing in particular is being looked at. */
const QUIET_SKIN = 0.09;
const QUIET_CAGE = 0.22;

/** One hit volume, ready to draw: named, measured and placed by the caller. */
export interface SchematicVolume {
  readonly index: number;
  readonly name: string;
  readonly kind: number;
  readonly hp: number;
  readonly hpMax: number;
  readonly dead: boolean;
  readonly blockPct: number;
  /** Half extents of the box, in the hull's own frame. */
  readonly half: Vec3;
  /** In the HULL's own frame, which is the frame its mesh is built in. */
  readonly at: Vec3;
}

/** What the armour is doing: solid, see through, or off. */
export type PlateView = 'on' | 'ghost' | 'off';

/** A whole ship, as much of it as a schematic shows. */
export interface SchematicSubject {
  readonly title: string;
  readonly subtitle: string;
  readonly design: Design;
  /** The side wash, so the hull here is the colour it is on the map. */
  readonly tone: number;
  /** A wreck is washed out at any range, which the tint has to be told. */
  readonly lost: boolean;
  /** Header figures, already formatted: this draws them, it does not derive them. */
  readonly stats: ReadonlyArray<readonly [string, string]>;
  readonly volumes: readonly SchematicVolume[];
  /**
   * The cells this hull has actually lost, and the tick each went on.
   *
   * The map's own carve, handed over rather than recomputed: a schematic
   * showing a whole ship while the map shows a hole in it is the modal
   * disagreeing with the picture it was opened from. Empty for a hull nothing
   * has touched.
   */
  readonly dead: ReadonlyMap<number, number>;
  /** Where playback is, so a wound is as cool here as it is out there. */
  readonly tick: number;
}

export class Schematic {
  #renderer: THREE.WebGLRenderer | null = null;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
  #cam = orbitStart();
  #hull = new THREE.Group();
  #marks = new THREE.Group();
  #raf = 0;
  #ray = new THREE.Raycaster();
  #centre = new THREE.Vector3();
  #half = new THREE.Vector3(1, 1, 1);
  /** The HULL's own extents, without the volumes the frame also holds: the
   *  camera may come right up to the plating and no closer. */
  #solid = new THREE.Vector3(1, 1, 1);
  #subject: SchematicSubject | null = null;
  /** What the armour is doing. A hull with its plate on is a hull whose
   *  insides are a rumour, and the insides are what this modal is for. */
  #plate: PlateView = 'on';
  /** The hull as it is drawn right now, for turning a pick into a cell. */
  #drawn: HullMesh | null = null;
  /**
   * The mesh whose quads `#drawn` describes, and everything a ray may stop on.
   *
   * Two fields rather than an index into one list. The torn edge is a mesh of
   * its own with its own quads, so a ray that stopped on it and was read
   * through the BODY's quad list would name whichever cell that index happened
   * to land on: a plausible answer to a question nobody asked. Only the body
   * carries a cell list, and only the body may answer.
   */
  #body: THREE.Mesh | null = null;
  #picks: THREE.Mesh[] = [];
  /** The cell and rig under the pointer, or -1. A turret is a THING on a hull
   *  and until this existed there was no way to point at one. */
  #cell = -1;
  #rig = -1;
  /** Which volume the pointer or the list is on, by index, or -1. */
  #hot = -1;
  /** The picked one, which survives the pointer leaving: a phone has no hover,
   *  so a tap has to leave the card up. */
  #held = -1;
  /** The sphere drawn for each volume, so a pick can name what it hit. */
  #spheres: Array<{ index: number; mesh: THREE.Mesh; cage: THREE.Mesh }> = [];
  #owned: THREE.Material[] = [];
  /** The sphere geometries this modal made. The HULL's belongs to `hull.ts`'s
   *  cache and is shared, so it is never in here. */
  #geoms: THREE.BufferGeometry[] = [];

  get visible(): boolean { return !$('schema').classList.contains('hidden'); }

  show(subject: SchematicSubject): void {
    this.#subject = subject;
    this.#hot = -1;
    this.#held = -1;
    this.#cell = -1;
    this.#rig = -1;
    $('schema').classList.remove('hidden');
    if (!this.#renderer) this.#initThree();
    this.#build();
    this.#resize();
    if (!this.#raf) this.#frame();
  }

  hide(): void {
    $('schema').classList.add('hidden');
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0; }
  }

  /**
   * Redraw for a ship that has moved on.
   *
   * A turn resolves while the modal is open and the hull it is describing has
   * taken more damage; the picture has to follow, and reopening from scratch
   * would throw away the angle the player had turned it to.
   */
  update(subject: SchematicSubject): void {
    if (!this.visible) return;
    this.#subject = subject;
    this.#build();
  }

  // -------------------------------------------------------------- three --

  #initThree(): void {
    const cv = $<HTMLCanvasElement>('scCanvas');
    this.#renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#scene.background = new THREE.Color(0x070a0f);
    this.#scene.add(new THREE.AmbientLight(0x8fa6bd, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 6);
    this.#scene.add(key);
    const fill = new THREE.DirectionalLight(0x35c7ff, 0.32);
    fill.position.set(-6, -3, -5);
    this.#scene.add(fill);
    // Metalness with no environment renders black, and this view has no sky.
    // The same strip the shipyard uses, so a hull looked at here and a hull
    // looked at there are the same material under the same reflection.
    studioEnv(this.#renderer, tex => {
      this.#scene.environment = tex;
      this.#scene.environmentIntensity = 0.35;
    });
    this.#scene.add(this.#hull, this.#marks);

    // The same gestures as the shipyard, from the same place: one finger
    // orbits, two pinch, a press that did not travel names a volume, and a
    // mouse can hover one without committing to it.
    bindOrbit(cv, this.#cam, {
      onTap: (x, y) => {
        this.#pickPart(x, y);
        this.#held = this.#pickAt(x, y);
        this.#hot = this.#held;
        this.#paintMarks();
        this.#renderCard();
      },
      onHover: (x, y) => {
        const part = this.#pickPart(x, y);
        const at = this.#pickAt(x, y);
        const want = at >= 0 ? at : this.#held;
        if (want === this.#hot && !part) return;
        this.#hot = want;
        this.#paintMarks();
        this.#renderCard();
      },
      onLeave: () => {
        const had = this.#cell;
        this.#cell = -1;
        this.#rig = -1;
        if (this.#hot === this.#held && had < 0) return;
        this.#hot = this.#held;
        this.#paintMarks();
        this.#renderCard();
      },
    });

    // The plate toggle. Three states rather than two, and the same three the
    // shipyard has: solid, see through, off. Ghost is the one that answers
    // "where in the hull is that" and off is the one that answers "what is in
    // there", and a player wanting one usually wants the other next.
    $('scPlate').onclick = () => {
      this.#plate = this.#plate === 'on' ? 'ghost' : this.#plate === 'ghost' ? 'off' : 'on';
      this.#build();
    };

    if (window.ResizeObserver) new ResizeObserver(() => this.#resize()).observe($('scView'));
    window.addEventListener('resize', () => this.#resize());
  }

  #resize(): void {
    if (!this.#renderer) return;
    const box = $('scView');
    const w = box.clientWidth || 320, h = box.clientHeight || 240;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  #frame = (): void => {
    this.#raf = requestAnimationFrame(this.#frame);
    if (!this.#renderer) return;
    // Reframed per frame rather than on demand: the viewport changes size when
    // a phone turns, and the fit depends on the aspect it is solving for.
    frameBox(this.#camera, this.#cam, this.#centre, this.#half, this.#solid);
    this.#renderer.render(this.#scene, this.#camera);
  };

  // ------------------------------------------------------------- meshes --

  #clear(g: THREE.Group): void {
    while (g.children.length) g.remove(g.children[g.children.length - 1] as THREE.Object3D);
  }

  #build(): void {
    const s = this.#subject;
    if (!s) return;
    this.#clear(this.#hull);
    this.#clear(this.#marks);
    for (const m of this.#owned) m.dispose();
    for (const g of this.#geoms) g.dispose();
    this.#owned = [];
    this.#geoms = [];
    this.#spheres = [];

    // What the body of the hull IS, in this mode. With the plate on it is the
    // whole ship; with it ghosted or off it is the frame and the parts, meshed
    // by the same mesher against a lattice the armour has been taken out of.
    const bare = this.#plate !== 'on';
    const hull = hullMesh(s.design, bare);
    this.#drawn = hull;
    this.#picks = [];
    // Opaque, and the SAME surface the map draws: the hull is one merged mesh
    // here as it is out there, so it wears the design's finish and the two
    // numbers that say what it is made of. Lambert had neither, which made
    // this the third picture of one ship that did not match the other two.
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      normalMap: finishMap(s.design.finish ?? 'plate'),
      metalness: s.design.metal ?? 0.25,
      roughness: s.design.rough ?? 0.55,
      dithering: true,
    });
    // The other end of the range: a schematic exists to show what a hull is
    // made of, so the side wash gets out of the way of the design's own paint.
    tintHull(mat, s.tone, s.lost, 0);
    this.#owned.push(mat);
    const body = new THREE.Mesh(this.#carve(hull, s, bare), mat);
    this.#hull.add(body);
    this.#body = body;
    this.#picks.push(body);
    // The windows, the same ones the map draws. A schematic of a hull whose
    // bridge viewport was missing would be a schematic of a different ship.
    for (const w of hull.windows) {
      const wm = windowMaterial(w.key);
      if (wm) this.#hull.add(new THREE.Mesh(w.geo, wm));
    }

    // The armour, when it is being shown THROUGH rather than shown or hidden.
    // Drawn after the body and with no depth write, so the parts inside read
    // through it instead of being z fought over by it.
    if (this.#plate === 'ghost') {
      const plated = hullMesh(s.design);
      const ghost = new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false,
        normalMap: finishMap(s.design.finish ?? 'plate'),
        metalness: s.design.metal ?? 0.25,
        roughness: s.design.rough ?? 0.55,
      });
      tintHull(ghost, s.tone, s.lost, 0);
      this.#owned.push(ghost);
      const shell = new THREE.Mesh(this.#carve(plated, s, false), ghost);
      shell.renderOrder = 2;
      this.#hull.add(shell);
    }

    // The volumes, as the spheres the damage model actually uses. Drawn at the
    // radius the core reports rather than a token dot: how much of a hull one
    // covers is the thing a player is deciding about when they aim at it.
    for (const v of s.volumes) {
      const hue = v.dead ? DEAD_HUE : (KIND_HUE[v.kind] ?? PURPOSE.structure.base);
      const skin = new THREE.MeshBasicMaterial({
        color: hue, transparent: true, opacity: QUIET_SKIN, depthWrite: false,
      });
      const wire = new THREE.MeshBasicMaterial({
        color: hue, wireframe: true, transparent: true, opacity: QUIET_CAGE, depthWrite: false,
      });
      this.#owned.push(skin, wire);
      // A BOX, because that is the shape the resolver tests against. Spheres
      // were drawn here first and they were a ball of wool with a ship
      // somewhere inside it: a sphere big enough to hold a drive bay stands
      // proud of the plating on all six sides, and six of them overlapped into
      // one lump. The volumes are boxes in the core now and this draws them at
      // the extents it is given.
      const geo = new THREE.BoxGeometry(v.half.x * 2, v.half.y * 2, v.half.z * 2);
      this.#geoms.push(geo);
      const ball = new THREE.Mesh(geo, skin);
      ball.position.set(v.at.x, v.at.y, v.at.z);
      const cage = new THREE.Mesh(geo, wire);
      cage.position.copy(ball.position);
      this.#marks.add(ball, cage);
      this.#spheres.push({ index: v.index, mesh: ball, cage });
    }

    // Framed on the hull AND its volumes: a box can stand proud of the
    // plating, and a marker cropped at the edge of the viewport is the one a
    // player was looking for. Around the box the two make together, not
    // around the origin: a hull is not symmetric about the point it turns on.
    let lo = [
      hull.mid[0] - hull.half[0], hull.mid[1] - hull.half[1], hull.mid[2] - hull.half[2],
    ];
    let hi = [
      hull.mid[0] + hull.half[0], hull.mid[1] + hull.half[1], hull.mid[2] + hull.half[2],
    ];
    for (const v of s.volumes) {
      const at = [v.at.x, v.at.y, v.at.z];
      const h = [v.half.x, v.half.y, v.half.z];
      lo = lo.map((n, i) => Math.min(n, (at[i] as number) - (h[i] as number)));
      hi = hi.map((n, i) => Math.max(n, (at[i] as number) + (h[i] as number)));
    }
    this.#centre.set(
      ((lo[0] as number) + (hi[0] as number)) / 2,
      ((lo[1] as number) + (hi[1] as number)) / 2,
      ((lo[2] as number) + (hi[2] as number)) / 2,
    );
    this.#half.set(
      Math.max(0.2, ((hi[0] as number) - (lo[0] as number)) / 2),
      Math.max(0.2, ((hi[1] as number) - (lo[1] as number)) / 2),
      Math.max(0.2, ((hi[2] as number) - (lo[2] as number)) / 2),
    );
    this.#solid.set(
      Math.max(0.2, hull.half[0]), Math.max(0.2, hull.half[1]), Math.max(0.2, hull.half[2]));

    this.#paintMarks();
    this.#renderHead();
    this.#renderList();
    this.#renderCard();
  }

  /**
   * The same hull with the same cells shot off it.
   *
   * The map keeps the carve, so it is handed over rather than recomputed here:
   * a modal that worked out its own damage would be a second opinion about
   * which cells are gone, and the two would part the first time either was
   * touched. `buildWound` says which greedy quads went entirely and puts the
   * survivors of a partly hit plate back one cell at a time, exactly as the
   * battlefield does, so the hole in here is the hole out there.
   *
   * A hull nothing has touched is handed straight back: no walk, no copy.
   */
  #carve(hull: HullMesh, s: SchematicSubject, bare: boolean): THREE.BufferGeometry {
    if (!s.dead.size) return hull.geo;
    const wound = buildWound(hull, s.design, s.dead, s.tick, bare);
    // The ember layer is the battlefield's. In here a hole is a fact about the
    // hull rather than a fire, so it is disposed rather than drawn.
    wound.glow.dispose();
    const geo = hull.geo.clone();
    this.#geoms.push(geo);
    // A quad that is entirely gone collapses to a point, which is a triangle
    // with no area and therefore nothing to draw and nothing to pick. The
    // same trick the map uses, for the same reason: rewriting the index buffer
    // would renumber every quad and break `cellOf` under it.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let q = 0; q < hull.quads; q++) {
      if (!wound.whole[q]) continue;
      const b = q * 4;
      const x = pos.getX(b), y = pos.getY(b), z = pos.getZ(b);
      for (let v = 1; v < 4; v++) pos.setXYZ(b + v, x, y, z);
    }
    pos.needsUpdate = true;
    // And the torn edge: the survivors of a partly hit plate, and the inside
    // the hit opened, in the parts' own colours.
    // The torn edge is the INSIDE of the hull, which is machinery and frame
    // rather than plate, so it wears what machinery wears.
    // Two surfaces, the same two the map draws. A plate cell that survived a
    // hit is still plate and keeps the hull's finish; the face the hit OPENED
    // is the inside of the ship and wears what machinery wears.
    const survivor = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      normalMap: finishMap(s.design.finish ?? 'plate'),
      metalness: s.design.metal ?? 0.25, roughness: s.design.rough ?? 0.55,
    });
    const torn = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      normalMap: partMap(), metalness: 0.55, roughness: 0.62,
    });
    tintHull(survivor, s.tone, s.lost, 0);
    tintHull(torn, s.tone, s.lost, 0);
    this.#owned.push(survivor, torn);
    this.#geoms.push(wound.skin, wound.inner);
    const skin = new THREE.Mesh(wound.skin, survivor);
    const inner = new THREE.Mesh(wound.inner, torn);
    this.#hull.add(skin, inner);
    this.#picks.push(skin, inner);
    return geo;
  }

  /**
   * Which CELL of the hull is under a screen point, and which turret if any.
   *
   * The picture IS the grid: a ray gives a triangle, two triangles are a quad,
   * and `cellOf` says which lattice cell that quad was a face of. The same
   * lookup the map's tooltip does, because it is the same question about the
   * same cells. Without it a turret was a thing a player could see and not
   * point at: the only pickable objects in here were the volume boxes, and a
   * mount is not one of those.
   */
  #pickPart(clientX: number, clientY: number): boolean {
    const hull = this.#drawn;
    if (!this.#renderer || !hull || !this.#body) return false;
    const cv = $<HTMLCanvasElement>('scCanvas');
    const r = cv.getBoundingClientRect();
    this.#ray.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1), this.#camera);
    const hit = this.#ray.intersectObjects(this.#picks, false)[0];
    const was = this.#cell;
    this.#cell = -1;
    this.#rig = -1;
    // Only the body carries a quad list; the torn edge is its own geometry
    // and names no cell, which is right: a cut face is not a part.
    if (hit && hit.object === this.#body && hit.faceIndex != null) {
      const quad = (hit.faceIndex as number) >> 1;
      if (quad >= 0 && quad < hull.quads) {
        this.#cell = hull.cellOf[quad] as number;
        this.#rig = hull.rigOf[quad] as number;
      }
    }
    return this.#cell !== was;
  }

  /** The one under the pointer stands out; the rest fade back. */
  #paintMarks(): void {
    for (const { index, mesh, cage } of this.#spheres) {
      const hot = index === this.#hot;
      const dim = this.#hot >= 0 && !hot;
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        hot ? 0.3 : dim ? 0.04 : QUIET_SKIN;
      (cage.material as THREE.MeshBasicMaterial).opacity =
        hot ? 0.85 : dim ? 0.1 : QUIET_CAGE;
    }
  }

  #pickAt(clientX: number, clientY: number): number {
    if (!this.#renderer || !this.#spheres.length) return -1;
    const cv = $<HTMLCanvasElement>('scCanvas');
    const r = cv.getBoundingClientRect();
    this.#ray.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1), this.#camera);
    const hits = this.#ray.intersectObjects(this.#spheres.map(x => x.mesh), false);
    const hit = hits[0];
    if (!hit) return -1;
    return this.#spheres.find(x => x.mesh === hit.object)?.index ?? -1;
  }

  // -------------------------------------------------------------- panels --

  #renderHead(): void {
    const s = this.#subject;
    if (!s) return;
    const plate = $('scPlate');
    plate.textContent = this.#plate === 'on' ? 'Armour on'
      : this.#plate === 'ghost' ? 'Armour ghost' : 'Armour off';
    plate.classList.toggle('ghost', this.#plate === 'ghost');
    plate.classList.toggle('off', this.#plate === 'off');
    $('scName').textContent = s.title;
    // innerHTML, because the subtitle is punctuated with entities like every
    // other label in this console; as textContent they arrive spelled out.
    $('scWhat').innerHTML = s.subtitle;
    $('scStats').innerHTML = s.stats
      .map(([k, v]) => `<span class="dzstat">${k} <b>${v}</b></span>`).join('');
  }

  /**
   * The volume list, which is the half of this that works without a pointer.
   *
   * Hover here lights the sphere out there and the other way round, so the
   * name and the place are one thing rather than two lists to correlate. On a
   * phone the row is the only way in, which is why the whole card is reachable
   * from it.
   */
  #renderList(): void {
    const s = this.#subject;
    const host = $('scList');
    host.innerHTML = '';
    if (!s) return;
    for (const v of s.volumes) {
      const pct = v.hpMax > 0 ? Math.max(0, (100 * v.hp) / v.hpMax) : 0;
      const row = document.createElement('button');
      row.className = `scrow${v.dead ? ' dead' : ''}${v.index === this.#hot ? ' hot' : ''}`;
      const hue = v.dead ? DEAD_HUE : (KIND_HUE[v.kind] ?? PURPOSE.structure.base);
      row.innerHTML =
        `<span class="sw" style="background:#${hue.toString(16).padStart(6, '0')}"></span>`
        + `<span class="nm">${v.name}</span>`
        + `<span class="st">${v.dead ? 'offline' : `${v.hp.toFixed(0)}/${v.hpMax.toFixed(0)}`}</span>`
        + `<span class="bar"><i style="width:${pct.toFixed(0)}%;`
        + `background:#${hue.toString(16).padStart(6, '0')}"></i></span>`;
      const light = () => {
        if (this.#hot === v.index) return;
        this.#hot = v.index;
        this.#paintMarks();
        this.#renderCard();
        this.#markList();
      };
      row.onpointerenter = light;
      row.onfocus = light;
      row.onclick = () => { this.#held = v.index; light(); };
      host.appendChild(row);
    }
  }

  /** Just the highlight, without rebuilding the rows under the pointer. */
  #markList(): void {
    const host = $('scList');
    const rows = [...host.children];
    const vols = this.#subject?.volumes ?? [];
    for (let i = 0; i < rows.length; i++) {
      rows[i]?.classList.toggle('hot', (vols[i]?.index ?? -1) === this.#hot);
    }
  }

  /**
   * What is physically under the pointer, as a line of the card.
   *
   * A volume is where a shot GOES; a part is what is standing there. Both are
   * true about one pixel and a player asking about a turret is asking the
   * second question, so the card answers both rather than making them two
   * modes. A turret gets its gun's figures and how much of its own sphere the
   * hull it is bolted to takes away, which is the same thing the map's tooltip
   * says about the same mount.
   */
  #partLine(): string {
    const s = this.#subject;
    if (!s || this.#cell < 0) return '';
    const at = partAtCell(s.design, this.#cell);
    if (!at) {
      return `<span class="part"><b>Hull plating.</b> Frame and armour, which `
        + `belong to no part: this is the ship itself.</span>`;
    }
    const pu = PURPOSE[at.module.purpose];
    let out = `<span class="part"><b>${at.module.name}</b> &middot; ${pu.label}`;
    if (this.#rig >= 0) {
      const gun = gunByKey(at.module.weapon ?? '');
      const mask = arcMasks(s.design)[this.#rig];
      out += ` &middot; <span class="gun">mount ${this.#rig}</span>`;
      if (gun) {
        out += `<br>${gun.dmg} dmg${gun.batch > 1 ? ` x${gun.batch}` : ''}`
          + ` &middot; ${gun.range} u &middot; ${gun.cooldown}s`;
      }
      if (mask) {
        out += `<br>its own hull blocks <b>${blockedPct(mask).toFixed(0)}%</b> of its sphere`;
      }
    }
    return `${out}</span>`;
  }

  #renderCard(): void {
    const card = $('scCard');
    const v = this.#subject?.volumes.find(x => x.index === this.#hot);
    this.#markList();
    const part = this.#partLine();
    if (!v) {
      card.classList.toggle('hidden', !part);
      card.innerHTML = part;
      return;
    }
    card.classList.remove('hidden');
    const hue = v.dead ? DEAD_HUE : (KIND_HUE[v.kind] ?? PURPOSE.structure.base);
    const pct = v.hpMax > 0 ? (100 * v.hp) / v.hpMax : 0;
    card.innerHTML =
      `<div class="hd">`
      + `<span class="dot" style="background:#${hue.toString(16).padStart(6, '0')}"></span>`
      + `<span class="nm">${v.name}</span>`
      + `<span class="id">${SUB_LABEL[v.kind] ?? '?'} &middot; volume ${v.index}</span>`
      + `</div>`
      + `<p class="sub">${v.dead
        ? '<b>Offline.</b> '
        : `<b>${v.hp.toFixed(0)}</b> of ${v.hpMax.toFixed(0)} (${pct.toFixed(0)}%). `}`
      + `Soaks <b>${v.blockPct.toFixed(0)}%</b> of a hit that reaches it; the rest `
      + `goes through to the hull. Box `
      + `<b>${(v.half.x * 2).toFixed(1)} x ${(v.half.y * 2).toFixed(1)}`
      + ` x ${(v.half.z * 2).toFixed(1)}</b> u.`
      + `</p>`
      + `<p class="sub">${SUB_BLURB[v.kind] ?? ''}</p>`
      + part;
  }

  /** For the harness: what is on screen, without letting it write any of it. */
  debug(): {
    title: string; volumes: number; hot: number;
    plate: PlateView; cell: number; rig: number; carved: number; quads: number;
    cam: { yaw: number; pitch: number; dist: number };
  } {
    return {
      /** What the armour is doing, and what the pointer is on: a turret is a
       *  thing to point at now, and a harness has to be able to say so. */
      plate: this.#plate,
      cell: this.#cell,
      rig: this.#rig,
      carved: this.#subject?.dead.size ?? 0,
      quads: this.#drawn?.quads ?? 0,
      cam: {
        yaw: +this.#cam.yaw.toFixed(3),
        pitch: +this.#cam.pitch.toFixed(3),
        dist: +this.#camera.position.distanceTo(this.#centre).toFixed(3),
      },
      title: this.#subject?.title ?? '',
      volumes: this.#subject?.volumes.length ?? 0,
      hot: this.#hot,
    };
  }
}
