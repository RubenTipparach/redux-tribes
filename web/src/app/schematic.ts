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
import { PURPOSE, type Design } from './design.js';
import { hullMesh, tintHull } from './hull.js';
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
    this.#scene.add(this.#hull, this.#marks);

    // The same gestures as the shipyard, from the same place: one finger
    // orbits, two pinch, a press that did not travel names a volume, and a
    // mouse can hover one without committing to it.
    bindOrbit(cv, this.#cam, {
      onTap: (x, y) => { this.#held = this.#pickAt(x, y); this.#hot = this.#held; this.#renderCard(); },
      onHover: (x, y) => {
        const at = this.#pickAt(x, y);
        const want = at >= 0 ? at : this.#held;
        if (want === this.#hot) return;
        this.#hot = want;
        this.#paintMarks();
        this.#renderCard();
      },
      onLeave: () => {
        if (this.#hot === this.#held) return;
        this.#hot = this.#held;
        this.#paintMarks();
        this.#renderCard();
      },
    });

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

    const hull = hullMesh(s.design);
    // Opaque. The volumes over it are the transparent things, and a hull that
    // is transparent too leaves nothing solid for them to be volumes OF.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    // The other end of the range: a schematic exists to show what a hull is
    // made of, so the side wash gets out of the way of the design's own paint.
    tintHull(mat, s.tone, s.lost, 0);
    this.#owned.push(mat);
    this.#hull.add(new THREE.Mesh(hull.geo, mat));

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

  #renderCard(): void {
    const card = $('scCard');
    const v = this.#subject?.volumes.find(x => x.index === this.#hot);
    this.#markList();
    if (!v) {
      card.classList.add('hidden');
      card.innerHTML = '';
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
      + `<p class="sub">${SUB_BLURB[v.kind] ?? ''}</p>`;
  }

  /** For the harness: what is on screen, without letting it write any of it. */
  debug(): {
    title: string; volumes: number; hot: number;
    cam: { yaw: number; pitch: number; dist: number };
  } {
    return {
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
