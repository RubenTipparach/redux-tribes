/**
 * The client.
 *
 * three.js owns the picture, the Rust core owns the simulation, and they meet
 * at a numeric boundary. Nothing in this file decides a rule: it collects what
 * the player wants, hands it to the core as orders, and draws what comes back.
 * Swapping this for a native Rust client later replaces the drawing and leaves
 * `sim_core` untouched, which is what ADR-2 and ADR-15 put the split there for.
 */

import { Sim } from './sim/wasm.js';
import type { Match } from './sim/match.js';
import { View } from './app/view.js';
import { Lobby, randomSeed, type Launch } from './app/lobby.js';
import { Api } from './net/api.js';
import {
  type Flight, type PlannedOrder, type ShipState, type SimEvent,
  CLASS_NAMES, EventKind, FACTION_NAMES, isCommitted, Mode, Scenario,
  TICKS_PER_TURN, TURN_SECONDS, WEAPON_NAMES,
} from './sim/types.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const MODE_LABELS: Array<[Mode, string]> = [
  [Mode.MoveAndTurn, 'Move'],
  [Mode.TurnSlide, 'Slide'],
  [Mode.FullSpeed, 'Boost'],
  [Mode.FullStop, 'Stop'],
  [Mode.Drift, 'Drift'],
];

const STAT_ROWS: Array<[keyof Flight, string, number, number, number]> = [
  ['yawRate', 'yaw', 0.5, 20, 0.5],
  ['pitchRate', 'pitch', 0.5, 20, 0.5],
  ['accelFwd', 'drive', 0.1, 3, 0.05],
  ['accelRetro', 'retro', 0.05, 2, 0.05],
  ['accelLat', 'rcs', 0.05, 2, 0.05],
  ['maxSpeed', 'top', 1, 25, 0.5],
];

// --------------------------------------------------------------- boot --

const canvas = $<HTMLCanvasElement>('cv');
const sim = await Sim.load('./sim_core.wasm');
const match: Match = sim.match();
const view = new View(canvas, match, sim);

let seed = randomSeed();
let ships: ShipState[] = [];
let selected = -1;
/** Which weapon is armed for the next fire slot click, or -1. */
let armedWeapon = -1;
/** null while planning; a tick while a resolved turn is being played back. */
let playTick: number | null = null;
let playing = false;
let speed = 1;
/** null means live; a number means a past turn is being reviewed. */
let reviewTurn: number | null = null;
let flightOverride = new Map<number, Flight>();
/** How this match was entered, which decides how its turns are resolved. */
let launch: Launch = { kind: 'offline', seed: '', scenario: 'skirmish', humanSides: 0b01, side: 0 };
/** True while a committed turn is waiting on the other seat. */
let waiting = false;

/**
 * Is this hull mine? The simulation only knows sides, deliberately, so this
 * is the one place the seat is applied and everything else asks here.
 */
const mine = (s: ShipState): boolean => s.side === launch.side;

function start(): void {
  match.start(seed, Scenario.Skirmish, launch.humanSides);
  view.mySide = launch.side;
  waiting = false;
  banner(false);
  flightOverride = new Map();
  ships = match.ships();
  selected = ships.find(mine)?.id ?? -1;
  armedWeapon = -1;
  playTick = null;
  playing = false;
  reviewTurn = null;
  view.setShips(ships);
  view.setSelection(selected);
  view.fit();
  view.invalidateEnvelope();
  refreshAll();
}

// ------------------------------------------------------------ helpers --

const selectedShip = (): ShipState | undefined => ships.find(s => s.id === selected);

function flightOf(id: number): Flight {
  const cached = flightOverride.get(id);
  if (cached) return cached;
  const s = ships.find(x => x.id === id);
  const f = match.classInfo(s?.cls ?? 0).flight;
  flightOverride.set(id, f);
  return f;
}

const shipName = (s: ShipState): string =>
  `${mine(s) ? 'P' : 'E'}${s.id + 1} ${CLASS_NAMES[s.cls] ?? '?'}`;

/** Planning is only possible on a live player ship, on the live turn. */
const canPlan = (): boolean => {
  const s = selectedShip();
  return reviewTurn === null && playTick === null && !waiting && !!s && mine(s) && !s.destroyed;
};

// ------------------------------------------------------------- panels --

function renderFleet(): void {
  const rows = (list: ShipState[], host: HTMLElement, enemy: boolean) => {
    host.innerHTML = '';
    for (const s of list) {
      const div = document.createElement('div');
      div.className = `shipRow${enemy ? ' enemy' : ''}${s.id === selected ? ' sel' : ''}${s.destroyed ? ' gone' : ''}`;
      const hullPct = Math.max(0, (100 * s.hull) / s.hullMax);
      const subs = s.subs
        .map((x, i) => `<div class="sub${x.dead ? ' dead' : ''}"><span>sub ${i}</span><span>${x.hp.toFixed(0)}</span></div>`)
        .join('');
      div.innerHTML =
        `<div class="nm">${shipName(s)}${s.destroyed ? ' &middot; LOST' : s.drifting ? ' &middot; ADRIFT' : ''}</div>`
        + `<div class="bar"><i style="width:${hullPct.toFixed(0)}%"></i></div>`
        + `<div class="sub"><span>hull ${s.hull.toFixed(0)}</span><span>${FACTION_NAMES[s.faction] ?? '?'}</span></div>`
        + `<div class="sub"><span>marines ${s.marines}</span><span>${Math.hypot(s.vel.x, s.vel.y, s.vel.z).toFixed(1)} u/s</span></div>`
        + subs;
      div.onclick = () => { select(s.id); };
      host.appendChild(div);
    }
  };
  rows(ships.filter(mine), $('fleet'), false);
  rows(ships.filter(s => !mine(s)), $('hostiles'), true);
}

function renderModes(): void {
  const host = $('modes');
  host.innerHTML = '';
  const order = selected >= 0 ? match.order(selected) : null;
  for (const [mode, label] of MODE_LABELS) {
    const b = document.createElement('button');
    b.textContent = label;
    if (order?.mode === mode) b.classList.add('on');
    b.disabled = !canPlan();
    b.onclick = () => {
      if (!canPlan()) return;
      const o = match.order(selected);
      o.mode = mode;
      // A committed mode has a single outcome, so a destination it cannot
      // influence would be a lie on screen.
      if (isCommitted(mode)) delete o.target;
      view.invalidateEnvelope();
      refreshAll();
    };
    host.appendChild(b);
  }
}

function renderTuning(): void {
  const host = $('envTune');
  host.innerHTML = '';
  const s = selectedShip();
  if (!s) return;
  const f = flightOf(s.id);
  for (const [k, label, min, max, step] of STAT_ROWS) {
    const row = document.createElement('div');
    row.className = 'tune';
    const value = f[k];
    row.innerHTML = `<span>${label}</span>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = document.createElement('b');
    out.textContent = value.toFixed(2);
    input.oninput = () => {
      const next = { ...flightOf(s.id), [k]: Number(input.value) } as Flight;
      flightOverride.set(s.id, next);
      match.setFlight(s.id, next);
      out.textContent = Number(input.value).toFixed(2);
      view.invalidateEnvelope();
      draw();
    };
    row.appendChild(input);
    row.appendChild(out);
    host.appendChild(row);
  }
}

function renderWeapons(): void {
  const host = $('weps');
  host.innerHTML = '';
  const s = selectedShip();
  if (!s) return;
  const info = match.classInfo(s.cls);
  const order = match.order(s.id);
  for (let i = 0; i < info.mountCount; i++) {
    const m = match.mount(s.cls, i);
    if (!m) continue;
    const queued = order.weapons.find(w => w.weaponIndex === i);
    // Whether a mount can fire is the resolver's rule, so it is asked for
    // rather than recomputed here.
    const spent = !match.canFire(s.id, i);
    const div = document.createElement('div');
    div.className = `wrow${armedWeapon === i ? ' armed' : ''}${spent ? ' spent' : ''}`;
    div.innerHTML =
      `<span class="k">${WEAPON_NAMES[m.key] ?? '?'}${m.batch > 1 ? ` x${m.batch}` : ''}</span>`
      + `<span>${(+m.damage.toFixed(1))} dmg &middot; ${m.range.toFixed(0)} u`
      + `${queued ? ` &middot; t+${queued.second}s` : spent ? ' &middot; cooling' : ''}</span>`;
    if (!spent && canPlan()) {
      div.onclick = () => { armedWeapon = armedWeapon === i ? -1 : i; refreshAll(); };
    }
    host.appendChild(div);
  }
  if (!info.mountCount) host.innerHTML = '<div class="hint">no mounts</div>';
}

function renderSlots(): void {
  const host = $('slots');
  host.innerHTML = '';
  const order = selected >= 0 ? match.order(selected) : null;
  for (let sec = 0; sec <= TURN_SECONDS; sec++) {
    const div = document.createElement('div');
    div.className = 'slot';
    div.textContent = String(sec);
    const queued = order?.weapons.filter(w => w.second === sec) ?? [];
    if (queued.length) div.classList.add('q', 'mark');
    div.title = queued.length
      ? queued.map(w => `weapon ${w.weaponIndex} at ship ${w.targetShip + 1}`).join(', ')
      : `second ${sec}`;
    div.onclick = () => {
      if (!canPlan()) return;
      const o = match.order(selected);
      if (armedWeapon < 0) {
        // No weapon armed: a click clears whatever is in the slot, which is
        // the only way to take a shot back.
        o.weapons = o.weapons.filter(w => w.second !== sec);
        refreshAll();
        return;
      }
      const target = ships.find(t => !mine(t) && !t.destroyed);
      if (!target) return;
      o.weapons = o.weapons.filter(w => w.weaponIndex !== armedWeapon);
      o.weapons.push({ weaponIndex: armedWeapon, second: sec, targetShip: target.id, targetSub: -1 });
      armedWeapon = -1;
      refreshAll();
    };
    host.appendChild(div);
  }
}

function renderBoard(): void {
  const b = $<HTMLButtonElement>('bBoard');
  const s = selectedShip();
  if (!s || !canPlan()) { b.disabled = true; b.textContent = 'Board Target'; return; }
  const target = ships.find(t => !mine(t) && !t.destroyed);
  // The same rule the resolver applies at second zero, asked rather than copied.
  const canBoard = !!target && match.canBoard(s.id, target.id);
  const dist = target
    ? Math.hypot(s.pos.x - target.pos.x, s.pos.y - target.pos.y, s.pos.z - target.pos.z)
    : Infinity;
  const order = match.order(s.id);
  b.disabled = !canBoard;
  b.classList.toggle('on', order.board !== undefined);
  b.textContent = !target ? 'No target'
    : !canBoard ? `Out of range (${dist.toFixed(0)} > ${s.boardingRange.toFixed(0)})`
    : order.board !== undefined ? 'Boarding ordered'
    : 'Board Target';
  b.onclick = () => {
    if (!canPlan() || !target) return;
    const o = match.order(s.id);
    if (o.board === undefined) o.board = target.id; else delete o.board;
    refreshAll();
  };
}

function renderTurnStrip(): void {
  const host = $('turns');
  host.innerHTML = '';
  const mk = (label: string, on: boolean, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (on) b.classList.add('on');
    b.onclick = fn;
    host.appendChild(b);
  };
  for (const h of match.history) {
    mk(`T${h.turn}`, reviewTurn === h.turn, () => { reviewTurn = h.turn; refreshAll(); });
  }
  if (match.history.length) {
    mk('live', reviewTurn === null, () => { reviewTurn = null; refreshAll(); });
  } else {
    host.innerHTML = '<span class="hint">no turns resolved yet</span>';
  }
}

function describe(e: SimEvent): { text: string; cls: string } | null {
  const who = (i: number) => {
    const s = ships.find(x => x.id === i);
    return s ? shipName(s) : `#${i}`;
  };
  const t = `${(e.tick / 60).toFixed(1)}s `;
  switch (e.kind) {
    case EventKind.ShotFired: return { text: `${t}${who(e.ship)} fires`, cls: '' };
    case EventKind.ShotHit: return { text: `${t}${who(e.other)} hits ${who(e.ship)}${e.aux >= 0 ? ` sub ${e.aux}` : ''}`, cls: 'hit' };
    case EventKind.ShotMiss: return { text: `${t}${who(e.ship)} misses`, cls: '' };
    case EventKind.ShotSkippedRange: return { text: `${t}${who(e.ship)} out of range`, cls: 'warn' };
    case EventKind.ShotSkippedArc: return { text: `${t}${who(e.ship)} out of arc`, cls: 'warn' };
    case EventKind.Damage: return { text: `${t}${who(e.ship)} takes ${e.amount.toFixed(1)}`, cls: 'hit' };
    case EventKind.SubsystemDestroyed: return { text: `${t}${who(e.ship)} sub ${e.aux} destroyed`, cls: 'warn' };
    case EventKind.ShipDrifting: return { text: `${t}${who(e.ship)} adrift`, cls: 'warn' };
    case EventKind.ShipDestroyed: return { text: `${t}${who(e.ship)} destroyed`, cls: 'bad' };
    case EventKind.Collision: return { text: `${t}${who(e.ship)} rams ${who(e.other)} for ${e.amount.toFixed(0)}`, cls: 'bad' };
    case EventKind.BoardingStarted: return { text: `${t}${who(e.other)} sends ${e.aux} marines to ${who(e.ship)}`, cls: 'good' };
    case EventKind.BoardingTick: return { text: `${t}${who(e.ship)} boarding: ${e.amount.toFixed(0)} vs ${e.aux}`, cls: '' };
    case EventKind.ShipCaptured: return { text: `${t}${who(e.ship)} captured`, cls: 'good' };
    case EventKind.GameOver: {
      const won = e.aux === launch.side;
      return { text: won ? 'VICTORY' : 'DEFEAT', cls: won ? 'good' : 'bad' };
    }
    default: return null;
  }
}

function renderLog(): void {
  const host = $('log');
  host.innerHTML = '';
  const entry = reviewTurn !== null
    ? match.history.find(h => h.turn === reviewTurn)
    : match.history[match.history.length - 1];
  if (!entry) { host.innerHTML = '<div class="hint">plan a turn, then End Turn</div>'; return; }

  // The stored hash is a free self check: it was computed by the core at the
  // end of that turn, so showing it next to the events makes a divergence
  // visible here rather than several turns later in a desync.
  const head = document.createElement('div');
  head.className = 'hint';
  head.textContent = `turn ${entry.turn} &middot; hash ${entry.hash}`.replace('&middot;', '·');
  host.appendChild(head);

  for (const e of entry.events) {
    const d = describe(e);
    if (!d) continue;
    const div = document.createElement('div');
    div.className = d.cls;
    div.textContent = d.text;
    host.appendChild(div);
  }
}

function renderHeader(): void {
  $('hTurn').textContent = String(match.turn);
  $('hHash').textContent = match.hash.slice(0, 8);
  $('hSeed').textContent = seed.slice(0, 8);
  // gameOver reports the winning SIDE, not a verdict: which of those is a
  // victory depends on the seat, and only the client knows the seat.
  const over = match.gameOver;
  $('hPhase').textContent = over >= 0 ? (over === launch.side ? 'VICTORY' : 'DEFEAT')
    : reviewTurn !== null ? `REVIEW T${reviewTurn}`
    : waiting ? 'COMMITTED'
    : playTick !== null ? 'PLAYBACK'
    : 'PLANNING';
  $<HTMLButtonElement>('bEnd').disabled = over >= 0 || playTick !== null || reviewTurn !== null;
}

function renderHelp(): void {
  $('help').innerHTML =
    '<b>Left drag</b> inside the <span style="color:var(--green)">green outline</span> sets a '
    + 'destination; anywhere else it pans. <b>Right drag</b> orbits. Scroll or pinch to zoom.'
    + '<br><br>'
    + 'Hold <kbd>Shift</kbd> and drag inside the outline to swing the heading instead.<br><br>'
    + '<kbd>Q</kbd>/<kbd>E</kbd> working altitude, <kbd>A</kbd>/<kbd>D</kbd> swing heading, '
    + '<kbd>F</kbd> face the target.<br><br>'
    + 'The outline is where the ship can actually finish its turn on this plane, and the shell '
    + 'is the same set in three dimensions. Both are <b>probed, not derived</b>: every point is '
    + 'a flight the core really flew, so they change shape as your velocity, heading and stats '
    + 'do. On a phone, one finger does what the left button does and the '
    + '<span style="color:var(--cyan)">&#10227;</span> button swaps it for orbiting.';
}

function refreshAll(): void {
  renderFleet();
  renderModes();
  renderTuning();
  renderWeapons();
  renderSlots();
  renderBoard();
  renderTurnStrip();
  renderLog();
  renderHeader();
  draw();
  const s = selectedShip();
  $('env').innerHTML = s ? view.envelopeSummary(s, flightOf(s.id)) : 'no ship selected';
}

/**
 * Redraw the plan, and ASK for an envelope rather than probing one here.
 *
 * A probe is about 2700 flights and costs a frame. A slider fires `input` per
 * pixel of travel, so probing inline would queue one per event and the drag
 * would stutter under its own feedback. Marking it wanted and letting the
 * frame loop do it collapses a fast drag to one probe per frame.
 */
function draw(): void {
  const s = selectedShip();
  if (!s) return;
  const order: PlannedOrder = selected >= 0 ? match.order(selected) : { mode: Mode.MoveAndTurn, weapons: [] };
  view.drawPlan(canPlan() ? s : undefined, order);
  envelopeWanted = true;
}

let envelopeWanted = false;

function probeEnvelopeIfWanted(): void {
  if (!envelopeWanted) return;
  envelopeWanted = false;
  const s = selectedShip();
  if (!s) return;
  const order: PlannedOrder = selected >= 0 ? match.order(selected) : { mode: Mode.MoveAndTurn, weapons: [] };
  view.drawEnvelope(canPlan() ? s : undefined, order, flightOf(s.id));
  view.drawPlaneShape(canPlan() ? s : undefined, order, flightOf(s.id));
  $('env').innerHTML = view.envelopeSummary(s, flightOf(s.id));
}

function select(id: number): void {
  selected = id;
  armedWeapon = -1;
  view.setSelection(id);
  view.invalidateEnvelope();
  refreshAll();
}

// -------------------------------------------------------------- input --

interface Drag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  /** 'plan' issues a move order, 'heading' swings the nose, else camera. */
  kind: 'plan' | 'heading' | 'pan' | 'orbit';
}
let drag: Drag | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;

// The right button is a camera control now, so its menu has to go. Bound on
// the canvas only: a right click on a panel should still behave like the rest
// of the page.
canvas.addEventListener('contextmenu', ev => ev.preventDefault());

canvas.addEventListener('pointerdown', ev => {
  // Capture is a convenience, not a precondition: it keeps a drag alive when
  // the pointer leaves the canvas. It throws for a pointer the browser does
  // not consider active, and letting that escape would abort the handler
  // before any routing happened, turning a failed nicety into a dead gesture.
  try {
    canvas.setPointerCapture(ev.pointerId);
  } catch {
    // carry on uncaptured
  }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    drag = null;
    return;
  }

  // Right button is always the camera, orbiting, whatever is under it. A
  // camera control that sometimes issues orders instead is one nobody trusts
  // near their own ships.
  if (ev.pointerType === 'mouse' && ev.button === 2) {
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, kind: 'orbit' };
    return;
  }

  const picked = view.pickShip(ev.clientX, ev.clientY);
  if (picked >= 0 && picked !== selected) { select(picked); }

  // Routing, decided by where the drag STARTS so a gesture's meaning never
  // changes underneath the hand.
  //
  // A move order needs a point the ship can actually finish its turn at, which
  // is the core's question rather than a radius: the reachable set is a lobe
  // along the nose, so a radius accepts clicks far outside it in one direction
  // and rejects nothing at all behind a ship carrying velocity.
  const p = view.planePoint(ev.clientX, ev.clientY);
  const s = selectedShip();
  let kind: Drag['kind'] = 'pan';
  if (canPlan() && p && s && view.canReachPoint(s, flightOf(s.id), match.order(s.id), p)) {
    kind = ev.shiftKey ? 'heading' : 'plan';
  } else if (ev.pointerType !== 'mouse' && !view.panMode) {
    // Touch has no second button, so the toolbar toggle still decides what one
    // finger on empty space does.
    kind = 'orbit';
  }
  if (kind === 'heading') canvas.classList.add('rotating');
  drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, kind };
});

canvas.addEventListener('pointermove', ev => {
  const prev = pointers.get(ev.pointerId);
  if (prev) { prev.x = ev.clientX; prev.y = ev.clientY; }

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    if (pinchDist > 0 && d > 0) view.zoom(pinchDist / d);
    pinchDist = d;
    return;
  }
  if (!drag || drag.id !== ev.pointerId) return;
  const dx = ev.clientX - drag.x;
  const dy = ev.clientY - drag.y;
  drag.x = ev.clientX;
  drag.y = ev.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;

  if (drag.kind === 'pan') { view.pan(dx, dy); return; }
  if (drag.kind === 'orbit') { view.orbit(dx, dy); return; }

  const p = view.planePoint(ev.clientX, ev.clientY);
  const s = selectedShip();
  if (!p || !s) return;
  const o = match.order(s.id);
  if (drag.kind === 'plan') {
    // Keep the destination inside what the ship can reach. Dragging past the
    // boundary leaves the marker at the last point that was real rather than
    // parking it where the turn cannot end, so the plan on screen is always a
    // plan the ship could fly.
    if (!view.canReachPoint(s, flightOf(s.id), o, p)) return;
    o.target = p;
    // A commanded destination with a held heading is a slide; asking for both
    // through Move would silently drop the heading, so the mode follows the
    // gesture rather than the gesture failing quietly.
    if (isCommitted(o.mode)) o.mode = Mode.MoveAndTurn;
  } else {
    const dir = { x: p.x - s.pos.x, y: 0, z: p.z - s.pos.z };
    const len = Math.hypot(dir.x, dir.z);
    if (len > 1e-3) {
      o.face = { x: dir.x / len, y: 0, z: dir.z / len };
      if (o.mode === Mode.MoveAndTurn) o.mode = Mode.TurnSlide;
    }
  }
  view.invalidateEnvelope();
  draw();
});

function endPointer(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (drag && drag.id === ev.pointerId) {
    canvas.classList.remove('rotating');
    const wasPlan = drag.kind === 'plan' || drag.kind === 'heading';
    drag = null;
    if (wasPlan) refreshAll();
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  view.zoom(ev.deltaY > 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

addEventListener('keydown', ev => {
  const s = selectedShip();
  if (!s) return;
  const nudgeHeading = (deg: number) => {
    if (!canPlan()) return;
    const o = match.order(s.id);
    const cur = o.face ?? match.forward(s.id);
    const a = Math.atan2(cur.x, cur.z) + (deg * Math.PI) / 180;
    o.face = { x: Math.sin(a), y: 0, z: Math.cos(a) };
    if (o.mode === Mode.MoveAndTurn) o.mode = Mode.TurnSlide;
    view.invalidateEnvelope();
    refreshAll();
  };
  switch (ev.key.toLowerCase()) {
    case 'q': view.workAlt -= 5; view.setSelection(selected); draw(); break;
    case 'e': view.workAlt += 5; view.setSelection(selected); draw(); break;
    case 'a': nudgeHeading(-15); break;
    case 'd': nudgeHeading(15); break;
    case 'f': {
      const t = ships.find(x => !mine(x) && !x.destroyed);
      if (!t || !canPlan()) break;
      const o = match.order(s.id);
      const d = { x: t.pos.x - s.pos.x, y: 0, z: t.pos.z - s.pos.z };
      const l = Math.hypot(d.x, d.z) || 1;
      o.face = { x: d.x / l, y: 0, z: d.z / l };
      if (o.mode === Mode.MoveAndTurn) o.mode = Mode.TurnSlide;
      view.invalidateEnvelope();
      refreshAll();
      break;
    }
    default: return;
  }
  ev.preventDefault();
});


// ------------------------------------------------------------ controls --

$('bEnd').onclick = () => { void endTurn(); };

/**
 * Commit the turn.
 *
 * One pipeline for every way a match can be played. Offline there is nobody to
 * wait for, so the client's own plan IS the whole order set. Served, the plan
 * goes up, the turn is withheld until every seat has committed (which is the
 * entire point of simultaneous turns), and then every seat's orders come back
 * together and are resolved by each client independently. A solo served game
 * releases on the first commit, because the AI's orders were never going to
 * arrive over the wire.
 *
 * The state hash goes back afterwards. The server cannot say which client is
 * right, only that two disagree, and that is the one thing a client cannot
 * discover about itself.
 */
async function endTurn(): Promise<void> {
  if (match.gameOver >= 0 || playTick !== null || reviewTurn !== null || waiting) return;

  const turn = match.turn;
  const own = new Map(match.orders);

  if (launch.kind === 'served') {
    try {
      waiting = true;
      refreshAll();
      const wire: Record<string, PlannedOrder> = {};
      for (const [ship, o] of own) wire[String(ship)] = o;
      const res = await api.submitOrders(turn, { ships: wire });
      banner(!res.ready, res.waitingOn);
      const all = await awaitTurn(turn);
      if (!all) { waiting = false; banner(false); refreshAll(); return; }
      match.resolveWith(all);
      void api.reportHash(turn, match.hash).then(r => {
        if (r.diverged) {
          $('hPhase').textContent = 'DESYNC';
          $('lobbyErr').textContent = 'Clients disagree on the state after this turn.';
        }
      }).catch(() => { /* reporting is diagnostic, never load bearing */ });
    } catch (e) {
      waiting = false;
      banner(false);
      $('hPhase').textContent = 'OFFLINE';
      console.error(e);
      refreshAll();
      return;
    }
  } else {
    match.resolveWith(own);
  }

  waiting = false;
  banner(false);
  ships = match.ships();
  view.setShips(ships);
  playTick = 0;
  playing = true;
  refreshAll();
}

/**
 * Wait for every seat, then merge the released orders into one set keyed by
 * ship. Polling rather than trusting the socket: the socket is a notifier, and
 * a turn that only completes when a push arrives is a turn that hangs on a
 * flaky connection.
 */
async function awaitTurn(turn: number): Promise<Map<number, PlannedOrder> | null> {
  for (let tries = 0; tries < 600; tries++) {
    const released = await api.fetchTurn(turn);
    if (released) {
      const merged = new Map<number, PlannedOrder>();
      for (const body of Object.values(released.orders)) {
        const ships = (body as { ships?: Record<string, PlannedOrder> }).ships ?? {};
        for (const [id, o] of Object.entries(ships)) merged.set(Number(id), o);
      }
      return merged;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

function banner(on: boolean, waitingOn = 0): void {
  const el = $('waitBanner');
  el.classList.toggle('hidden', !on);
  el.textContent = waitingOn > 1 ? `waiting for ${waitingOn} players` : 'waiting for opponent';
}

$('bRestart').onclick = () => {
  // Back to the lobby rather than straight into another match: the room you
  // were in is finished, and picking the next one is a decision.
  lobby.show();
};

// Touch only, now that a mouse has two buttons to do this with. A phone has
// one finger and no second button, so the toggle is how it reaches the gesture
// the right button covers on a desktop.
$('cMode').onclick = () => {
  view.panMode = !view.panMode;
  const b = $('cMode');
  b.classList.toggle('on', view.panMode);
  b.textContent = view.panMode ? '\u2725' : '\u27F3';
  b.title = view.panMode
    ? 'One finger on empty space pans. Tap to orbit instead. (Mouse: left pans, right orbits.)'
    : 'One finger on empty space orbits. Tap to pan instead. (Mouse: left pans, right orbits.)';
};
$('cCentre').onclick = () => { const s = selectedShip(); if (s) view.centreOn(s.pos); };
$('pUp').onclick = () => { view.workAlt += 5; view.setSelection(selected); draw(); };
$('pDown').onclick = () => { view.workAlt -= 5; view.setSelection(selected); draw(); };
$('pCCW').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
$('pCW').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
$('pFace').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

$('bSpeed').onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('bSpeed').textContent = `${speed}x`;
};

const scrub = $<HTMLInputElement>('scrub');
scrub.oninput = () => {
  playing = false;
  playTick = Number(scrub.value);
  showTick(playTick);
};

// Mobile sheets. Only one is open at a time: two sheets over a phone screen
// leaves no phone screen.
const sheet = (btn: string, panel: string) => {
  $(btn).onclick = () => {
    const el = $(panel);
    const open = el.classList.toggle('open');
    $(btn).classList.toggle('on', open);
    $(btn).setAttribute('aria-pressed', String(open));
    for (const [b, p] of [['tShips', 'left'], ['tLog', 'right']] as const) {
      if (p !== panel) { $(p).classList.remove('open'); $(b).classList.remove('on'); }
    }
  };
};
sheet('tShips', 'left');
sheet('tLog', 'right');
$('tFit').onclick = () => view.fit();

// ------------------------------------------------------------ playback --

function showTick(tick: number): void {
  view.setPoses(match.poses(tick));
  view.setProjectiles(match.trackProjectiles(tick));

  // Beams last one tick in the simulation, so they are drawn from the event
  // stream for the tick being shown rather than kept as objects.
  const entry = match.history[match.history.length - 1];
  const beams = (entry?.events ?? [])
    .filter(e => e.kind === EventKind.ShotFired && Math.abs(e.tick - tick) < 6)
    .map(e => ({ from: e.pos, to: e.to }));
  view.setBeams(beams);

  scrub.value = String(tick);
  $('hSec').textContent = (tick / 60).toFixed(1);
}

function frame(): void {
  view.resize();
  probeEnvelopeIfWanted();
  if (playTick !== null && playing) {
    playTick = Math.min(TICKS_PER_TURN, playTick + speed);
    showTick(playTick);
    if (playTick >= TICKS_PER_TURN) {
      playing = false;
      playTick = null;
      view.setBeams([]);
      view.setProjectiles([]);
      ships = match.ships();
      view.setShips(ships);
      if (!ships.some(s => s.id === selected && !s.destroyed)) {
        selected = ships.find(s => mine(s) && !s.destroyed)?.id ?? selected;
      }
      view.setSelection(selected);
      view.invalidateEnvelope();
      refreshAll();
    }
  }
  view.render();
  requestAnimationFrame(frame);
}

/**
 * A read only window onto client state, for browser checks.
 *
 * Input routing is the one part of this client that cannot be tested from the
 * headless suites: it is about which gesture on which button does what, and
 * that only exists in a browser. Pixels cannot answer it either, because a pan
 * and a move order both change every pixel. So the check needs to read the
 * plan, and this is the smallest surface that lets it. Read only on purpose:
 * a test that can WRITE state stops testing the app and starts testing itself.
 */
Object.defineProperty(window, 'ftDebug', {
  value: {
    order: () => (selected < 0 ? null : structuredClone(match.order(selected))),
    selected: () => selected,
    side: () => launch.side,
    kind: () => launch.kind,
    canPlan,
  },
});

const api = new Api();
const lobby = new Lobby(api, (l: Launch) => {
  launch = l;
  seed = l.seed;
  start();
});

renderHelp();
frame();
void lobby.signIn().then(() => lobby.show());
