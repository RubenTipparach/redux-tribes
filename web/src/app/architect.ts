/**
 * The ship architect: move the stations a class is built from.
 *
 * The shipyard fits parts to a frame. This is the layer under it, where the
 * frame is the thing being edited: where the drives sit, where the gun rings
 * are, which stations a class even has. Those are authored numbers and they
 * are wrong often enough to be worth a screen.
 *
 * **It is an authoring tool and it says so on screen.** What a class derives
 * is in the core's own table and that table is hashed into the match state, so
 * a frame edited here and flown there would be one seat playing a different
 * ship from the other: a desync with no message on it. The edit previews, and
 * it reaches a match the way every stock number already does, by going back
 * into `design.ts` and through `measure_fleet.mjs --sync`. Which is what
 * EXPORT is for, and why the JSON is the actual product rather than a
 * convenience bolted on the side.
 *
 * It is a MODE of the shipyard rather than a screen of its own, and that is
 * deliberate: the canvas, the orbit, the picking, the derive readout and a
 * rail that becomes a bottom sheet at 390 px all already exist and all already
 * work. A second screen would be a second copy of every one of them, and the
 * copy is the one that would stop working on a phone.
 */
import type { Designer } from './designer.js';
import {
  NX, NY, NZ, SOCKET_KINDS, frameFor, setFrameOverride, stockFrameFor,
  type FrameDef, type Socket, type SocketKind,
} from './design.js';
import {
  clearDraft, edited, fromFile, openFrame, saveDraft, toJson,
} from './frames.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** What each station is FOR, in the words the yard already uses for them. */
const KIND_NOTE: Readonly<Record<SocketKind, string>> = {
  drive: 'main drive, aft',
  retro: 'braking thrust, forward',
  rcs: 'attitude block, set into the skin',
  gun: 'barbette ring, on the skin',
  trunnion: 'the gun on top of a barbette',
  missile: 'missile pad',
  bay: 'enclosed volume, inside the hull',
  clamp: 'boarding gear',
  rack: 'cargo station, on the deck',
};

export class Architect {
  readonly #dz: Designer;
  #frame: FrameDef | null = null;
  #onWhere: ((classKey: string) => void) | null = null;

  constructor(dz: Designer) {
    this.#dz = dz;
    this.#bind();
  }

  /** Told when the architect moves to another class, so whoever owns the
   *  address can follow. The architect does not own the router. */
  onWhere(fn: (classKey: string) => void): void { this.#onWhere = fn; }

  get open(): boolean { return this.#frame !== null; }
  get classKey(): string | null { return this.#frame?.classKey ?? null; }

  /**
   * Open a class for editing.
   *
   * The draft wins over the authored frame, for the same reason the shipyard's
   * does: it is the newer work, the authored one is one press away, and the
   * screen says which of the two it is showing rather than swapping them
   * silently.
   */
  show(classKey: string): void {
    const { frame, draft } = openFrame(classKey);
    this.#frame = frame;
    setFrameOverride(frame);
    this.#dz.setArchitect(true);
    this.#dz.show();
    this.#dz.reseed(classKey);
    this.#said(draft ? 'showing unsaved work on this frame' : '');
    this.render();
  }

  /**
   * Leave, and take the override with you.
   *
   * The clear is the whole safety property of this screen. An override left
   * standing would follow the player into the shipyard and into a match, where
   * the hull they see and the hull the core spawns would be two ships.
   */
  hide(): void {
    if (this.#frame) saveDraft(this.#frame);
    this.#frame = null;
    setFrameOverride(null);
    this.#dz.setArchitect(false);
  }

  // ------------------------------------------------------------- editing --

  /** Put a changed frame back in front of the authored one and redraw. */
  #apply(next: FrameDef): void {
    this.#frame = next;
    setFrameOverride(next);
    saveDraft(next);
    this.#dz.reseed(next.classKey);
    this.render();
  }

  #sockets(): readonly Socket[] { return this.#frame?.sockets ?? []; }

  #selected(): Socket | null {
    const id = this.#dz.socket;
    return this.#sockets().find(s => s.id === id) ?? null;
  }

  /** Move one station by a cell, clamped to the lattice rather than wrapped:
   *  a socket that left the grid would be a part rasterised nowhere. */
  #nudge(axis: 0 | 1 | 2, by: number): void {
    const f = this.#frame, sel = this.#selected();
    if (!f || !sel) return;
    const lim = [NX, NY, NZ][axis] as number;
    const at: [number, number, number] = [sel.at[0], sel.at[1], sel.at[2]];
    at[axis] = Math.max(0, Math.min(lim - 1, (at[axis] as number) + by));
    this.#apply({ ...f, sockets: f.sockets.map(s => (s.id === sel.id ? { ...s, at } : s)) });
  }

  #setKind(kind: SocketKind): void {
    const f = this.#frame, sel = this.#selected();
    if (!f || !sel) return;
    this.#apply({ ...f, sockets: f.sockets.map(s => (s.id === sel.id ? { ...s, kind } : s)) });
  }

  #setLabel(label: string): void {
    const f = this.#frame, sel = this.#selected();
    if (!f || !sel) return;
    this.#apply({ ...f, sockets: f.sockets.map(s => (s.id === sel.id ? { ...s, label } : s)) });
  }

  #remove(): void {
    const f = this.#frame, sel = this.#selected();
    if (!f || !sel) return;
    if (f.sockets.length <= 1) { this.#said('a frame with no stations is not a ship', true); return; }
    this.#dz.selectSocket(null);
    this.#apply({ ...f, sockets: f.sockets.filter(s => s.id !== sel.id) });
  }

  /** A new station, on the centreline amidships, where it is visible and where
   *  nothing is standing: dropping one inside a drive block would put a
   *  control on screen whose effect a player cannot see. */
  #add(): void {
    const f = this.#frame;
    if (!f) return;
    let n = 1;
    while (f.sockets.some(s => s.id === `n${n}`)) n++;
    const id = `n${n}`;
    const sock: Socket = {
      id, kind: 'bay', label: `new station ${n}`,
      at: [NX / 2, NY / 2, Math.round(NZ / 2)],
    };
    this.#apply({ ...f, sockets: [...f.sockets, sock] });
    this.#dz.selectSocket(id);
    this.render();
  }

  #revert(): void {
    const f = this.#frame;
    if (!f) return;
    clearDraft(f.classKey);
    this.#dz.selectSocket(null);
    this.#apply(stockFrameFor(f.classKey));
    this.#said('back to the frame this build authored');
  }

  // ---------------------------------------------------------------- file --

  #export(): void {
    const f = this.#frame;
    if (!f) return;
    const text = toJson(f);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${f.classKey}.frame.json`;
    a.click();
    // Revoked on the next turn of the loop rather than immediately: revoking
    // before the browser has started the download cancels it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.#said(`exported ${f.classKey}.frame.json, ${f.sockets.length} stations`);
  }

  async #import(file: File): Promise<void> {
    const text = await file.text();
    const { frame, why } = fromFile(text);
    if (!frame) { this.#said(why ?? 'could not read that file', true); return; }
    // The file names its own class, so importing one while looking at another
    // is a move rather than an error: follow it, and let the address follow
    // too, or the screen and the URL would disagree about which ship this is.
    const moved = frame.classKey !== this.#frame?.classKey;
    this.#frame = frame;
    setFrameOverride(frame);
    saveDraft(frame);
    this.#dz.selectSocket(null);
    this.#dz.reseed(frame.classKey);
    if (moved) this.#onWhere?.(frame.classKey);
    this.render();
    this.#said(`loaded ${frame.sockets.length} stations from ${file.name}`);
  }

  // ---------------------------------------------------------------- view --

  #said(text: string, bad = false): void {
    const el = $('dzArchSaid');
    el.textContent = text;
    el.style.color = bad ? 'var(--bad, #FF6B6B)' : '';
  }

  #bind(): void {
    $('dzArchExport').onclick = () => { this.#export(); };
    $('dzArchImport').onclick = () => { $<HTMLInputElement>('dzArchPick').click(); };
    $('dzArchRevert').onclick = () => { this.#revert(); };
    $<HTMLInputElement>('dzArchPick').onchange = ev => {
      const input = ev.target as HTMLInputElement;
      const file = input.files?.[0];
      // Cleared so choosing the SAME file twice fires again: `change` does not
      // when the value has not changed, and re-importing after an edit is the
      // obvious thing to try.
      input.value = '';
      if (file) void this.#import(file);
    };
  }

  /** The rail, redrawn from the frame. Cheap, and it is the only thing that
   *  knows the frame changed. */
  render(): void {
    const f = this.#frame;
    if (!f) return;

    $('dzArchNote').innerHTML =
      `<b>${esc(f.name)}</b> &middot; ${f.sockets.length} stations`
      + (edited(f) ? ' &middot; <b style="color:var(--cyan)">edited</b>' : ' &middot; as authored')
      + '<br>Preview only: export the JSON into <code>design.ts</code>, then '
      + '<code>measure_fleet.mjs --sync</code>.';

    // The stations, grouped by kind so a list of twenty is readable and so
    // "where are the engines" is one glance rather than a scan.
    const host = $('dzArchList');
    host.innerHTML = '';
    const sel = this.#dz.socket;
    const order = [...SOCKET_KINDS];
    const rows = [...f.sockets].sort((a, b) =>
      (order.indexOf(a.kind) - order.indexOf(b.kind)) || (a.id < b.id ? -1 : 1));
    for (const s of rows) {
      const b = document.createElement('button');
      if (s.id === sel) b.className = 'on';
      b.innerHTML = `<span class="k">${esc(s.kind)}</span> ${esc(s.label)}`
        + `<br><span class="k">${s.at.join(', ')}</span>`;
      b.onclick = () => { this.#dz.selectSocket(s.id); this.render(); };
      host.appendChild(b);
    }

    this.#renderEdit();
  }

  #renderEdit(): void {
    const host = $('dzArchEdit');
    host.innerHTML = '';
    const sel = this.#selected();
    if (!sel) {
      const p = document.createElement('p');
      p.className = 'dznote';
      p.textContent = 'Tap a station above to move it.';
      host.appendChild(p);
      const bar = document.createElement('div');
      bar.id = 'dzArchAct';
      const add = document.createElement('button');
      add.textContent = 'Add a station';
      add.onclick = () => { this.#add(); };
      bar.appendChild(add);
      host.appendChild(bar);
      return;
    }

    // Three axes of nudges, as BUTTONS. A phone has no arrow keys and no
    // keyboard worth typing coordinates on, and the mobile rule is that every
    // control a player needs is reachable by thumb: moving a station is the
    // whole point of this screen, so it cannot be the one thing that is not.
    const axes: ReadonlyArray<readonly [string, 0 | 1 | 2]> =
      [['beam x', 0], ['depth y', 1], ['length z', 2]];
    for (const [name, axis] of axes) {
      const row = document.createElement('div');
      row.className = 'row';
      const lab = document.createElement('label');
      lab.textContent = name;
      const down = document.createElement('button');
      down.textContent = '−';
      down.id = `dzArch${'XYZ'[axis]}Down`;
      down.onclick = () => { this.#nudge(axis, -1); };
      const val = document.createElement('b');
      val.textContent = String(sel.at[axis]);
      const up = document.createElement('button');
      up.textContent = '+';
      up.id = `dzArch${'XYZ'[axis]}Up`;
      up.onclick = () => { this.#nudge(axis, 1); };
      row.append(lab, down, val, up);
      host.appendChild(row);
    }

    const kind = document.createElement('select');
    kind.id = 'dzArchKind';
    for (const k of SOCKET_KINDS) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = `${k} · ${KIND_NOTE[k]}`;
      if (k === sel.kind) o.selected = true;
      kind.appendChild(o);
    }
    kind.onchange = () => { this.#setKind(kind.value as SocketKind); };
    host.appendChild(kind);

    const label = document.createElement('input');
    label.type = 'text';
    label.id = 'dzArchLabel';
    label.value = sel.label;
    label.onchange = () => { this.#setLabel(label.value); };
    host.appendChild(label);

    const bar = document.createElement('div');
    bar.id = 'dzArchAct';
    const add = document.createElement('button');
    add.textContent = 'Add a station';
    add.onclick = () => { this.#add(); };
    const del = document.createElement('button');
    del.id = 'dzArchDelete';
    del.textContent = 'Remove this one';
    del.onclick = () => { this.#remove(); };
    bar.append(add, del);
    host.appendChild(bar);
  }

  /** Read only, for the harness. It observes and never drives. */
  debug() {
    const f = this.#frame;
    if (!f) return null;
    return {
      classKey: f.classKey,
      name: f.name,
      edited: edited(f),
      sockets: f.sockets.map(s => ({ id: s.id, kind: s.kind, at: [...s.at], label: s.label })),
      selected: this.#dz.socket,
      /** What the CLASS still is, whatever this screen is showing. The whole
       *  safety claim of the mode is that these two can differ, so a harness
       *  has to be able to see both. */
      authored: stockFrameFor(f.classKey).sockets.length,
      /** Proof the override is actually in front: `frameFor` is what every
       *  other module asks, so if it does not answer with the edit then the
       *  picture on screen came from somewhere else. */
      live: frameFor(f.classKey).sockets.length,
      json: toJson(f).length,
    };
  }
}
