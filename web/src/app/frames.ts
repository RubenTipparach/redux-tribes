/**
 * A base frame as a FILE: out to JSON, back in, and checked on the way.
 *
 * The shipyard fits parts to a frame. This is the layer under that, where the
 * frame itself is the thing being edited: where the drives sit, where the gun
 * rings are, which sockets a class even has. Those are authored numbers in
 * `design.ts` and they are wrong often enough to be worth a screen rather than
 * a text editor and a rebuild.
 *
 * **The architect is an authoring tool, not a second way to field a ship.**
 * What a class derives (mass, hull, radius, the flight envelope) is in the
 * core's own table, and that table is hashed into the match state: a frame
 * edited here and flown there would be one seat playing a different ship from
 * the other, which is a desync with no message on it. So an edit previews and
 * EXPORTS, and it reaches a match the way every stock number already does, by
 * going back into `design.ts` and through `measure_fleet.mjs --sync`.
 *
 * Which makes the JSON the actual product, so it is treated like one: a stable
 * shape, a version on it, and a reader that refuses what it does not
 * understand rather than half loading it. An imported file is UNTRUSTED input
 * even when a player wrote it themselves, and a socket at z of 9000 or a kind
 * this build has never heard of has to come back as a message rather than as a
 * lattice write off the end of an array.
 */
import {
  latOf, migrateDesign, type Lat, FRAMES, SECTIONS, SOCKET_KINDS, frameFor, moduleById,
  socketsOf, stockFor, stockFrameFor,
  type Design, type FrameDef, type Placement, type Socket, type SocketKind,
} from './design.js';

/**
 * What a frame file says it is. Bumped only for a shape change a reader here
 * could not otherwise detect.
 *
 * Version 2 is the per class lattices. A frame's sockets are CELLS, and every
 * file written before them holds cells on 32 x 32 x 64: on a heavy cruiser,
 * whose lattice is 64 x 64 x 128, those coordinates are all in range and all
 * in the wrong half of the ship, which is exactly the shape change a reader
 * cannot otherwise detect. Refusing an old file by name is the honest answer,
 * because a frame is an AUTHORING artefact with one copy and a hand to re-cut
 * it; a design is somebody's saved hull and is migrated instead.
 */
export const FRAME_FORMAT = 'fallen-tribes/frame@2';

/**
 * What a design file says it is. Same rules, different resource, and it does
 * NOT move with the lattices: a design carries the lattice it was drawn on in
 * the record itself, so `migrateDesign` can carry an old one across rather
 * than turning it away.
 */
export const DESIGN_FORMAT = 'fallen-tribes/design@1';

/**
 * The editable half of a frame.
 *
 * Sockets and the handful of class scalars beside them. The PROFILE and the
 * SPINE are not here on purpose: a profile is the navy's own envelope cut to a
 * rung (`NAVY_SECTION`), so editing one hull's copy of it is how four navies
 * become twenty three unrelated shapes, and the ladder stops being a
 * consequence of one number. Moving an engine is the job; redrawing the hull
 * is a different one and should stay in the tables that keep it honest.
 */
export interface FrameFile {
  readonly format: string;
  readonly classKey: string;
  readonly name: string;
  readonly radius: number;
  readonly massMax: number;
  readonly baseReach: number;
  readonly baseMarines: number;
  readonly baseCapacity: number;
  readonly note: string;
  readonly sockets: readonly Socket[];
}

/** A frame as the file it exports to. */
export function toFile(f: FrameDef): FrameFile {
  return {
    format: FRAME_FORMAT,
    classKey: f.classKey,
    name: f.name,
    radius: f.radius,
    massMax: f.massMax,
    baseReach: f.baseReach,
    baseMarines: f.baseMarines,
    baseCapacity: f.baseCapacity,
    note: f.note,
    // Sorted by id so two exports of one frame are the same bytes: a file that
    // reorders itself is a file every diff is noise in.
    sockets: [...f.sockets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/** What went wrong, or nothing. */
export type Refusal = string | null;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inBox = (L: Lat, a: readonly number[]): boolean =>
  isNum(a[0]) && isNum(a[1]) && isNum(a[2])
  && (a[0] as number) >= 0 && (a[0] as number) < L.nx
  && (a[1] as number) >= 0 && (a[1] as number) < L.ny
  && (a[2] as number) >= 0 && (a[2] as number) < L.nz;

/**
 * One socket out of untrusted JSON, or a reason it is not one.
 *
 * Every field is checked rather than cast. A cast is what turns a typo in a
 * hand edited file into a write past the end of the lattice, and the whole
 * point of a file format is that somebody will hand edit it.
 */
function readSocket(L: Lat, v: unknown, n: number): { sock?: Socket; why?: string } {
  const at = `socket ${n}`;
  if (!v || typeof v !== 'object') return { why: `${at} is not an object` };
  const o = v as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || !o['id']) return { why: `${at} has no id` };
  const id = o['id'];
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) return { why: `${at}: "${id}" is not an id` };
  if (typeof o['kind'] !== 'string' || !SOCKET_KINDS.includes(o['kind'] as SocketKind))
    return { why: `${id}: "${String(o['kind'])}" is not a socket kind` };
  const raw = o['at'];
  if (!Array.isArray(raw) || raw.length !== 3 || !inBox(L, raw as number[]))
    return { why: `${id}: at must be three cells inside ${L.nx}x${L.ny}x${L.nz}` };
  const label = typeof o['label'] === 'string' ? o['label'] : id;
  const facing = o['facing'];
  if (facing !== undefined && (!isNum(facing) || facing < 0 || facing > 3))
    return { why: `${id}: facing must be 0 to 3` };
  const mirror = o['mirror'];
  if (mirror !== undefined && typeof mirror !== 'boolean')
    return { why: `${id}: mirror must be true or false` };
  const sock: Socket = {
    id,
    kind: o['kind'] as SocketKind,
    at: [Math.round(raw[0] as number), Math.round(raw[1] as number),
      Math.round(raw[2] as number)],
    label,
    ...(facing === undefined ? {} : { facing: Math.round(facing) }),
    ...(mirror === undefined ? {} : { mirror }),
  };
  return { sock };
}

/**
 * A frame out of untrusted JSON, laid over the authored one it names.
 *
 * Over rather than instead of: the profile, the spine, the faction and the
 * rung come from the class this build ships, so a file cannot invent a hull
 * shape or move a class onto another navy's ladder. What it carries is what
 * the architect can edit.
 */
export function fromFile(text: string): { frame?: FrameDef; why?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) {
    return { why: `not JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') return { why: 'not an object' };
  const o = raw as Record<string, unknown>;
  if (o['format'] !== FRAME_FORMAT)
    return { why: `format is "${String(o['format'])}", expected "${FRAME_FORMAT}"` };
  const key = o['classKey'];
  if (typeof key !== 'string' || !FRAMES.some(f => f.classKey === key))
    return { why: `"${String(key)}" is not a class this build has` };
  const base = stockFrameFor(key);
  const list = o['sockets'];
  if (!Array.isArray(list)) return { why: 'sockets is not a list' };
  if (!list.length) return { why: 'a frame with no sockets is not a ship' };
  const sockets: Socket[] = [];
  const seen = new Set<string>();
  for (let n = 0; n < list.length; n++) {
    const { sock, why } = readSocket(latOf(frameFor(key)), list[n], n);
    if (!sock) return { why: why ?? `socket ${n} is not a socket` };
    if (seen.has(sock.id)) return { why: `two sockets called "${sock.id}"` };
    seen.add(sock.id);
    sockets.push(sock);
  }
  const num = (k: keyof FrameFile, dflt: number): number => {
    const v = o[k];
    return isNum(v) && v > 0 ? v : dflt;
  };
  return {
    frame: {
      ...base,
      name: typeof o['name'] === 'string' && o['name'] ? o['name'] : base.name,
      note: typeof o['note'] === 'string' ? o['note'] : base.note,
      radius: num('radius', base.radius),
      massMax: num('massMax', base.massMax),
      baseReach: num('baseReach', base.baseReach),
      baseMarines: isNum(o['baseMarines']) ? Math.max(0, o['baseMarines']) : base.baseMarines,
      baseCapacity: isNum(o['baseCapacity']) ? Math.max(0, o['baseCapacity']) : base.baseCapacity,
      sockets,
    },
  };
}

/** The JSON a download writes, pretty printed because a person reads it. */
export const toJson = (f: FrameDef): string => JSON.stringify(toFile(f), null, 2);

/** Whether this frame differs from the one the build authored. Compared as
 *  FILES, so a reordering or a field the architect cannot touch is not a
 *  difference a player is told about. */
export function edited(f: FrameDef): boolean {
  return toJson(f) !== toJson(stockFrameFor(f.classKey));
}

/**
 * Work in progress, under the class key.
 *
 * The same rule the shipyard's drafts follow and for the same reason: the
 * address names the work, not merely its starting point, so two frames on the
 * go do not tread on each other and a reload does not throw an hour away. A
 * draft is not a save, because there is nothing here to save TO: the only
 * durable home for a frame is `design.ts`, which is what export is for.
 */
const KEY = (classKey: string): string => `ft.frame.${classKey}`;

export function saveDraft(f: FrameDef): void {
  try { localStorage.setItem(KEY(f.classKey), toJson(f)); } catch { /* full or denied */ }
}

export function loadDraft(classKey: string): FrameDef | null {
  let text: string | null = null;
  try { text = localStorage.getItem(KEY(classKey)); } catch { return null; }
  if (!text) return null;
  const { frame } = fromFile(text);
  return frame ?? null;
}

export function clearDraft(classKey: string): void {
  try { localStorage.removeItem(KEY(classKey)); } catch { /* denied */ }
}

/** Every class with a draft waiting, so the picker can say which are in hand. */
export function drafted(): string[] {
  const out: string[] = [];
  for (const f of FRAMES) {
    try { if (localStorage.getItem(KEY(f.classKey))) out.push(f.classKey); } catch { return out; }
  }
  return out;
}

/** The frame the architect should open on: the draft if there is one, else the
 *  authored one. The draft wins because it is the newer work and the authored
 *  one is one press away, and the screen says which it is showing. */
export function openFrame(classKey: string): { frame: FrameDef; draft: boolean } {
  const d = loadDraft(classKey);
  return d ? { frame: d, draft: true } : { frame: frameFor(classKey), draft: false };
}

// ------------------------------------------------------------------ design --

/**
 * A DESIGN as a file: the other half of the same idea.
 *
 * A design is already JSON on the wire and in `localStorage`, so this adds no
 * format, only a version stamp and a reader that refuses what it cannot use.
 * The point of it is the same as the frame's: a hull somebody built should be
 * a thing they can keep, send, and put back, without a server in the middle.
 *
 * Read with the same suspicion. A design names sockets and modules by id and
 * carries raw cell indices for the hand drawn plate, so a file from anywhere
 * is a list of array subscripts somebody else chose: every one is checked
 * against the frame it claims rather than trusted to be in range.
 */
export function designToJson(d: Design, name: string): string {
  return JSON.stringify({ format: DESIGN_FORMAT, name, design: d }, null, 2);
}

/** Cell indices that are actually cells, deduplicated and ordered so two
 *  exports of one hull are the same bytes. */
const readCells = (L: Lat, v: unknown): number[] => {
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const n of v) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= L.cells) continue;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
};

export function designFromJson(text: string): { design?: Design; name?: string; why?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) {
    return { why: `not JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') return { why: 'not an object' };
  const o = raw as Record<string, unknown>;
  if (o['format'] !== DESIGN_FORMAT)
    return { why: `format is "${String(o['format'])}", expected "${DESIGN_FORMAT}"` };
  const d = o['design'];
  if (!d || typeof d !== 'object') return { why: 'no design in the file' };
  const src = d as Record<string, unknown>;
  const key = src['classKey'];
  if (typeof key !== 'string' || !FRAMES.some(f => f.classKey === key))
    return { why: `"${String(key)}" is not a class this build has` };

  // Started from the stock hull rather than from an empty object, so a field
  // the file does not carry is the class's own answer instead of undefined.
  const out = stockFor(key);
  out.parts = [];

  // Parts, checked against the frame's OWN sockets. A placement naming a
  // socket this class does not have is not a part, it is a silent no-op that
  // costs mass in one build and nothing in the next.
  const frame = stockFrameFor(key);
  const list = Array.isArray(src['parts']) ? src['parts'] : [];
  const seen = new Set<string>();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    if (typeof q['socket'] !== 'string' || typeof q['module'] !== 'string') continue;
    if (seen.has(q['socket'])) return { why: `two parts in socket "${q['socket']}"` };
    if (!moduleById(q['module'])) return { why: `"${q['module']}" is not a part` };
    // Trunnions only exist once a barbette is standing, so the socket list is
    // recomputed as the fit is rebuilt rather than taken once up front.
    if (!socketsOf(frame, out.parts).some(s => s.id === q['socket']))
      return { why: `"${String(key)}" has no socket "${q['socket']}"` };
    seen.add(q['socket']);
    const turn = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v)
      ? ((Math.round(v) % 4) + 4) % 4 : 0);
    const place: Placement = {
      socket: q['socket'], module: q['module'],
      rot: turn(q['rot']), pitch: turn(q['pitch']), roll: turn(q['roll']),
    };
    out.parts.push(place);
  }

  const sec = src['sections'];
  if (sec && typeof sec === 'object') {
    for (const k of SECTIONS) {
      const v = (sec as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.sections[k] = Math.max(0, Math.min(15, Math.round(v)));
      }
    }
  }
  // A file is untrusted input, so the lattice it claims is read the same way
  // every other field is: three numbers or nothing, and nothing means the one
  // lattice there used to be. `migrateDesign` then carries the cells onto the
  // one this class is drawn on.
  const lat = src['lattice'];
  if (Array.isArray(lat) && lat.length === 3 && lat.every(n => isNum(n) && n > 0 && n <= 256)) {
    out.lattice = [lat[0] as number, lat[1] as number, lat[2] as number];
  }
  const L: Lat = out.lattice
    ? { nx: out.lattice[0], ny: out.lattice[1], nz: out.lattice[2],
      cells: out.lattice[0] * out.lattice[1] * out.lattice[2],
      // Only `cells` is read below, to bound an index. The rest is the shape
      // of a lattice this build may no longer have, so it carries no centre
      // and no beam: `migrateDesign` is what turns these cells into cells on
      // a lattice that does exist.
      cx: 0, cy: 0, beam: 0 }
    : latOf(frameFor(key));
  out.plate = readCells(L, src['plate']);
  out.cut = readCells(L, src['cut']);
  // The brush, whose entries are `cell * 8 + slot` rather than a bare cell, so
  // they are bounded against eight times the lattice.
  const tint = src['tint'];
  out.tint = Array.isArray(tint)
    ? [...new Set(tint.filter(n => typeof n === 'number' && Number.isInteger(n)
      && n >= 0 && n < L.cells * 8))].sort((a, b) => a - b)
    : [];
  if (typeof src['faction'] === 'string') out.faction = src['faction'];
  if (typeof src['paint'] === 'number' && Number.isFinite(src['paint']))
    out.paint = src['paint'] >>> 0;
  if (typeof src['armour'] === 'string') out.armour = src['armour'] as Design['armour'];
  for (const k of ['finish', 'frameFinish', 'partFinish'] as const) {
    if (typeof src[k] === 'string') out[k] = src[k] as string;
  }
  for (const k of ['metal', 'rough'] as const) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v));
  }
  const name = typeof o['name'] === 'string' && o['name'] ? o['name'] : key;
  // Onto the lattice the class is actually drawn on, which for a file written
  // before the per class lattices means moving every cell it carries.
  return { design: migrateDesign(out), name };
}
