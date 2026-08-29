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
  type Flight, type PlannedShot, type PlannedOrder, type Pose, type ShipState, type SimEvent,
  type Vec3,
  CLASS_NAMES, EventKind, FACTION_NAMES, isCommitted, Mode, Scenario, SCENARIO_BY_NAME,
  TICKS_PER_SECOND, TICKS_PER_TURN, TURN_SECONDS, WEAPON_NAMES,
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
/**
 * The hostile that weapons, boarding and Face Target all aim at.
 *
 * -1 means "whichever enemy is still alive", which is what the whole client
 * used to do in three separate places. Now it is chosen, and chosen once.
 */
/**
 * Who each of my ships is aiming at, by ship id.
 *
 * Per ship, not one pick for the fleet. A frigate on the left flank and one on
 * the right rarely want the same hostile, and the orders already carry a target
 * per SHOT, so a single fleet wide pick was a narrower thing than the model
 * underneath it.
 */
const targets = new Map<number, number>();

/**
 * The heading each ship is trying to come round to, by ship id.
 *
 * A standing order, not a per turn one. A hull turns at 6 degrees a second and
 * a turn is ten seconds, so 60 degrees is all it gets: asking for more than
 * that used to be forgotten the moment the turn resolved, because orders are
 * cleared once they are spent and the heading went with them. The ship stopped
 * part way round and stayed there. The heading is re-issued each turn instead,
 * so a hull keeps coming about until it is pointed where it was told.
 *
 * Move mode drops it, because that mode faces its own course (DESIGN 3.2) and
 * a commanded heading means nothing there. Coming back to slide takes the
 * heading the ship is ACTUALLY on at that moment, so the nose never jumps to
 * an order given before the ship spent two turns flying somewhere else.
 */
const standingFace = new Map<number, Vec3>();

/**
 * The roll each ship is trying to come round to, by ship id.
 *
 * Standing for the same reason a heading is: a hull rolls at its yaw rate, so
 * 60 degrees is all it gets in a turn and anything more has to survive the
 * resolve. Roll does move the reachable set, because the lateral cap is a box
 * and rolling turns that box under the thrust the controller wants, so the
 * envelope carries it too.
 */
const standingRoll = new Map<number, number>();

/** Set the climb, keeping the compass heading it is already on. */
function setPitch(id: number, deg: number): void {
  const cur = standingFace.get(id) ?? match.order(id).face ?? match.forward(id);
  const a = (Math.max(-80, Math.min(80, deg)) * Math.PI) / 180;
  const l = Math.hypot(cur.x, cur.z) || 1;
  const c = Math.cos(a);
  faceToward(id, { x: (cur.x / l) * c, y: Math.sin(a), z: (cur.z / l) * c });
}

/**
 * Put a yaw onto the pitch this ship already holds.
 *
 * A heading is one direction, so yaw and pitch live in the same vector: the
 * ring sets where the nose points on the compass and must not flatten whatever
 * climb was asked for while doing it.
 */
function keepPitch(id: number, flat: Vec3): Vec3 {
  const cur = standingFace.get(id) ?? match.order(id).face;
  const rise = cur ? cur.y : 0;
  const l = Math.hypot(flat.x, flat.z) || 1;
  const c = Math.sqrt(Math.max(0, 1 - rise * rise));
  return { x: (flat.x / l) * c, y: rise, z: (flat.z / l) * c };
}

/** Command a roll about the nose, in degrees from wings level. */
function rollTo(id: number, deg: number): void {
  const rad = (((deg + 180) % 360 + 360) % 360 - 180) * Math.PI / 180;
  const o = match.order(id);
  o.roll = rad;
  standingRoll.set(id, rad);
  if (o.mode === Mode.MoveAndTurn) o.mode = Mode.TurnSlide;
}

/** Command a heading for this ship, which slide mode will hold and keep. */
function faceToward(id: number, dir: Vec3): void {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const unit = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  const o = match.order(id);
  o.face = unit;
  standingFace.set(id, unit);
  // Only slide reads a face, so commanding one is what puts a ship in it.
  if (o.mode === Mode.MoveAndTurn) o.mode = Mode.TurnSlide;
}

/**
 * Re-issue standing headings on a fresh turn, and seed one for a ship that has
 * just entered slide mode from where its nose actually is.
 */
function restoreFacing(): void {
  for (const s of ships) {
    if (!mine(s) || s.destroyed) continue;
    const want = standingFace.get(s.id);
    // No standing heading means nothing to restore. A fresh order defaults to
    // Move, so reading the mode here and skipping would have skipped every
    // ship: the standing heading IS the slide order, and re-issuing one means
    // re-issuing both.
    if (!want) continue;
    const o = match.order(s.id);
    o.face = want;
    o.mode = Mode.TurnSlide;
    const r = standingRoll.get(s.id);
    if (r !== undefined) o.roll = r;
  }
}
/**
 * Which second's fire slot is open, or null.
 *
 * Arming a weapon and then hunting for a slot is gone. It was a mode: the
 * console looked identical whether or not one was armed, so a slot tap did
 * nothing at all when nothing was, which is most of the time. A slot now opens
 * the list of mounts that could fire in it, and says why any of them cannot.
 */
let openSlot: number | null = null;
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
  // The lobby has always carried a scenario name and this always ignored it,
  // so every match was a skirmish however it was entered.
  const scenario = SCENARIO_BY_NAME[launch.scenario] ?? Scenario.Skirmish;
  match.start(seed, scenario, launch.humanSides);
  // The rings compare the field against the drive of a hull actually in the
  // match, so they mean something for the ships being flown.
  const own = match.ships().find(mine);
  const drive = own ? flightOf(own.id).accelFwd : 0;
  view.setWells(match.wells(), drive);
  view.mySide = launch.side;
  waiting = false;
  banner(false);
  flightOverride = new Map();
  ships = match.ships();
  selected = ships.find(mine)?.id ?? -1;
  targets.clear();
  standingFace.clear();
  standingRoll.clear();
  openSlot = null;
  playTick = null;
  playing = false;
  reviewTurn = null;
  view.setShips(ships);
  view.setSelection(selected);
  view.fit();
  restoreFacing();
  view.invalidateEnvelope();
  planTurnEnvelopes();
  previewTick = TICKS_PER_TURN;
  view.setGhosts([]);
  view.setPaths([]);
  refreshAll();
}

// ------------------------------------------------------------ helpers --

const selectedShip = (): ShipState | undefined => ships.find(s => s.id === selected);

/**
 * The hostile under the guns.
 *
 * The player's pick while it is alive, otherwise the first surviving enemy, so
 * a target that blows up does not silently leave every weapon aimed at a
 * wreck. Weapons, boarding and Face Target all come here: three copies of this
 * search had grown, which is exactly the divergent path GUIDELINES 5.1 calls a
 * defect.
 */
function targetShip(of = selected): ShipState | undefined {
  const want = targets.get(of);
  const picked = ships.find(t => t.id === want && !mine(t) && !t.destroyed);
  return picked ?? ships.find(t => !mine(t) && !t.destroyed);
}

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

/** The same, by id, for anything holding an order rather than a ship. */
const nameOf = (id: number): string => {
  const s = ships.find(x => x.id === id);
  return s ? shipName(s) : `ship ${id + 1}`;
};

/** Planning is only possible on a live player ship, on the live turn. */
const canPlan = (): boolean => {
  const s = selectedShip();
  return reviewTurn === null && playTick === null && !waiting && !!s && mine(s) && !s.destroyed;
};

// ------------------------------------------------------------- panels --

function renderFleet(): void {
  const aimed = targetShip();
  const rows = (list: ShipState[], host: HTMLElement, enemy: boolean) => {
    host.innerHTML = '';
    for (const s of list) {
      const div = document.createElement('div');
      // A hostile row is the target picker, so it marks the ship under the
      // guns rather than the ship being flown. Selecting an enemy as though it
      // were yours only ever made the whole rail inert, because planning needs
      // one of your own hulls.
      const isAimed = enemy && !!aimed && s.id === aimed.id;
      div.className = `shipRow${enemy ? ' enemy' : ''}`
        + `${!enemy && s.id === selected ? ' sel' : ''}${isAimed ? ' tg' : ''}`
        + `${s.destroyed ? ' gone' : ''}`;
      const hullPct = Math.max(0, (100 * s.hull) / s.hullMax);
      const subs = s.subs
        .map((x, i) => `<div class="sub${x.dead ? ' dead' : ''}"><span>sub ${i}</span><span>${x.hp.toFixed(0)}</span></div>`)
        .join('');
      div.innerHTML =
        `<div class="nm">${shipName(s)}${isAimed ? ' &middot; TARGET' : ''}`
        + `${s.destroyed ? ' &middot; LOST' : s.drifting ? ' &middot; ADRIFT' : ''}</div>`
        + `<div class="bar"><i style="width:${hullPct.toFixed(0)}%"></i></div>`
        + `<div class="sub"><span>hull ${s.hull.toFixed(0)}</span><span>${FACTION_NAMES[s.faction] ?? '?'}</span></div>`
        + `<div class="sub"><span>marines ${s.marines}</span><span>${Math.hypot(s.vel.x, s.vel.y, s.vel.z).toFixed(1)} u/s</span></div>`
        // Who this hull is aiming at, on the hull's own row, because targeting
        // is per ship: one pick for the whole fleet was narrower than the
        // orders underneath it, which already carry a target per SHOT. For a
        // hostile it is `aiTarget`, which the core keeps and reports, so the
        // row says what the enemy is set on rather than guessing.
        + (s.destroyed ? '' : `<div class="sub aim"><span>${enemy ? 'hunting' : 'target'}</span>`
          + `<span>${enemy
            ? (s.aiTarget >= 0 ? nameOf(s.aiTarget) : 'nobody yet')
            : (targetShip(s.id) ? shipName(targetShip(s.id)!) : 'none')}</span></div>`)
        + subs;
      div.onclick = () => {
        if (enemy) {
          if (s.destroyed || selected < 0) return;
          targets.set(selected, s.id);
          refreshAll();
        } else {
          select(s.id);
        }
      };
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
      if (mode === Mode.TurnSlide) {
        // Entering slide takes the heading the nose is ACTUALLY on, so there
        // is a heading to see and turn from at once, and so the ship never
        // snaps to an order given before it flew somewhere else.
        faceToward(selected, standingFace.get(selected) ?? match.forward(selected));
      } else {
        // Move faces its own course, so a commanded heading means nothing in
        // it and is dropped rather than kept to surprise a later slide.
        delete o.face;
        delete o.roll;
        standingFace.delete(selected);
        standingRoll.delete(selected);
      }
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
    const shots = order.weapons.filter(w => w.weaponIndex === i)
      .sort((a, b) => a.second - b.second);
    // Whether a mount can fire, and when it is next free, are the resolver's
    // rules, so both are asked for rather than recomputed here.
    const spent = !match.canFire(s.id, i);
    // A mount can fire more than once a turn now, so the row says how many
    // slots are still open to it rather than just whether one is.
    const last = shots.length ? shots[shots.length - 1]!.second : -1;
    const nextFree = match.nextFreeSecond(s.id, i, last);
    const room = nextFree <= TURN_SECONDS;
    const div = document.createElement('div');
    div.className = `wrow${spent || !room ? ' spent' : ''}`;
    const when = shots.length
      ? ` &middot; t+${shots.map(w => w.second).join(', ')}s`
      : spent ? ` &middot; ready t+${nextFree}s`
      : '';
    div.innerHTML =
      `<span class="k">${WEAPON_NAMES[m.key] ?? '?'}${m.batch > 1 ? ` x${m.batch}` : ''}</span>`
      + `<span>${(+m.damage.toFixed(1))} dmg &middot; ${m.range.toFixed(0)} u `
      + `&middot; ${m.cooldown.toFixed(0)}s cd${when}</span>`;
    if (!spent && room && canPlan()) {
      // Queues where the scrubber is standing (DESIGN 2.2), which is the
      // second the preview on screen is showing. No arming step, so the row
      // does the thing it names rather than putting the console in a mode.
      div.onclick = () => { queueShot(scrubbedSecond(), i); };
    }
    host.appendChild(div);
  }
  if (!info.mountCount) host.innerHTML = '<div class="hint">no mounts</div>';
  const aimed = targetShip();
  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = !aimed ? 'No hostiles left.'
    : `Firing at ${shipName(aimed)} at t+${scrubbedSecond()}s. `
      + 'Tap a hostile to switch, or a fire slot to pick the second.';
  host.appendChild(note);
}

/**
 * Is this second free for this mount, given what is already queued?
 *
 * The core answers: `nextFreeSecond` is asked once for the gap before the
 * candidate and once for the shot after it, so the cooldown arithmetic is
 * never done here. A slot the planner offers is a slot the resolver honours,
 * because both ask the same gate.
 */
function slotOpen(
  ship: number, weapon: number, sec: number, queued: readonly PlannedShot[],
): boolean {
  const mine = queued.filter(w => w.weaponIndex === weapon).map(w => w.second).sort((a, b) => a - b);
  if (mine.includes(sec)) return false;
  const before = mine.filter(s => s < sec).pop() ?? -1;
  if (sec < match.nextFreeSecond(ship, weapon, before)) return false;
  const after = mine.find(s => s > sec);
  // The shot after it has to survive too, or queuing this one would silently
  // invalidate a shot the player already placed.
  return after === undefined || after >= match.nextFreeSecond(ship, weapon, sec);
}

/** The second the scrubber is standing on, which is what the preview shows. */
/**
 * Move the scrubber, the preview and the range input together.
 *
 * One function, because they are one position: setting the preview without the
 * input leaves the thumb pointing at a second the console is not showing.
 */
function scrubTo(tick: number): void {
  const t = Math.max(0, Math.min(TICKS_PER_TURN, tick));
  if (playTick !== null) {
    playing = false;
    playTick = t;
    showTick(t);
    return;
  }
  if (!canPlan()) return;
  previewTick = t;
  $<HTMLInputElement>('scrub').value = String(t);
  showPreview();
}

function scrubbedSecond(): number {
  const t = playTick ?? previewTick;
  return Math.max(0, Math.min(TURN_SECONDS, Math.round(t / TICKS_PER_SECOND)));
}

/**
 * Put a shot in a slot, or say why it cannot go there.
 *
 * The one place a shot is queued, reached from the mount list and from the
 * slot's own menu. Two ways in, one implementation: a second copy of this is a
 * second set of rules about when a mount may fire.
 */
function queueShot(sec: number, weaponIndex: number): void {
  if (!canPlan() || selected < 0) return;
  const t = targetShip();
  if (!t) { flash('Nothing left to shoot at.'); return; }
  const o = match.order(selected);
  if (!slotOpen(selected, weaponIndex, sec, o.weapons)) {
    flash(`That mount is still cooling at t+${sec}s.`);
    return;
  }
  // A mount may fire more than once in a turn, so a second shot is ADDED
  // rather than replacing the first. It used to replace it, which is what
  // "weapons queuing is not working" looked like.
  o.weapons.push({ weaponIndex, second: sec, targetShip: t.id, targetSub: -1 });
  o.weapons.sort((a, b) => a.second - b.second || a.weaponIndex - b.weaponIndex);
  refreshAll();
}

/**
 * Take a shot back out of a slot.
 *
 * Always allowed. Whether a mount COULD fire at a second is a question about
 * adding a shot; removing one it already has can never be refused, or a plan
 * could be walked into a state it cannot be walked out of.
 */
function unqueueShot(sec: number, weaponIndex: number): void {
  if (!canPlan() || selected < 0) return;
  const o = match.order(selected);
  const at = o.weapons.findIndex(w => w.second === sec && w.weaponIndex === weaponIndex);
  if (at < 0) return;
  o.weapons.splice(at, 1);
  refreshAll();
}

/** A one line note under the slots, for a tap that could not do what it meant. */
function flash(msg: string): void {
  const el = $('slotNote');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.add('hidden'), 2600);
}
let flashTimer = 0;

function renderSlots(): void {
  const host = $('slots');
  host.innerHTML = '';
  const order = selected >= 0 ? match.order(selected) : null;
  const now = scrubbedSecond();
  for (let sec = 0; sec <= TURN_SECONDS; sec++) {
    const div = document.createElement('div');
    div.className = 'slot';
    div.textContent = String(sec);
    // Where the scrubber's thumb sits for this second. Its centre travels from
    // half a thumb in to half a thumb from the far end, so the slot is placed
    // on that same line rather than merely in the same order.
    div.style.left = `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${sec} / ${TURN_SECONDS})`;
    const queued = order?.weapons.filter(w => w.second === sec) ?? [];
    if (queued.length) div.classList.add('q', 'mark');
    if (sec === now) div.classList.add('now');
    if (sec === openSlot) div.classList.add('open');
    div.title = queued.length
      ? queued.map(w => `weapon ${w.weaponIndex} at ship ${w.targetShip + 1}`).join(', ')
      : `second ${sec}`;
    // A slot is a point on the timeline first, so a tap always moves the
    // preview there. Then it offers what can be done at that second, rather
    // than depending on a mode set somewhere else on screen.
    div.onclick = () => {
      scrubTo(sec * TICKS_PER_SECOND);
      openSlot = openSlot === sec ? null : sec;
      refreshAll();
    };
    host.appendChild(div);
  }
  renderSlotMenu();
}

/**
 * What each mount can do in the open slot.
 *
 * ONE row per mount, always, in mount order. It used to list the queued shots
 * first and then every mount, so a mount that had just fired appeared twice at
 * the same second: once as the shot, and again underneath saying "cooling",
 * which is the shot's own cooldown reported as though it were a second mount
 * being refused. The list also changed length as shots went in and came out,
 * so the row under your finger moved.
 *
 * A row is one of three things, and never two: the shot queued here, an offer
 * to queue, or the reason it cannot be.
 */
function renderSlotMenu(): void {
  const menu = $('slotMenu');
  const s = selectedShip();
  if (openSlot === null || !s || !canPlan()) {
    menu.classList.add('hidden');
    menu.innerHTML = '';
    return;
  }
  const sec = openSlot;
  const o = match.order(s.id);
  const info = match.classInfo(s.cls);
  const aimed = targetShip();
  const rows: string[] = [
    `<div class="smhead">t+${sec}s &middot; ${aimed ? shipName(aimed) : 'no target'}`
    + `<button class="smx" id="smClose" aria-label="Close">&times;</button></div>`,
  ];
  for (let i = 0; i < info.mountCount; i++) {
    const m = match.mount(s.cls, i);
    if (!m) continue;
    const here = o.weapons.filter(w => w.weaponIndex === i && w.second === sec);
    const name = `${WEAPON_NAMES[m.key] ?? '?'}${m.batch > 1 ? ` x${m.batch}` : ''}`;
    if (here.length) {
      // Queued here, so this row takes it back. Its own cooldown is not a
      // reason to refuse anything: it is the consequence of this very shot.
      const at = nameOf(here[0]!.targetShip);
      rows.push(
        `<div class="srow on" data-drop="${i}">`
        + `<span class="k">${name}</span>`
        + `<span>at ${at}${here.length > 1 ? ` x${here.length}` : ''} &middot; remove</span></div>`);
      continue;
    }
    const why = !aimed ? 'no target'
      : !slotOpen(s.id, i, sec, o.weapons) ? 'cooling'
      : '';
    rows.push(
      `<div class="srow${why ? ' off' : ''}"${why ? '' : ` data-add="${i}"`}>`
      + `<span class="k">${name}</span>`
      + `<span>${why || `queue &middot; ${(+m.damage.toFixed(1))} dmg`}</span></div>`);
  }
  if (!info.mountCount) rows.push('<div class="hint">no mounts</div>');
  menu.innerHTML = rows.join('');
  menu.classList.remove('hidden');
  $('smClose').onclick = () => { openSlot = null; refreshAll(); };
  menu.querySelectorAll<HTMLElement>('[data-add]').forEach(el => {
    el.onclick = () => queueShot(sec, Number(el.dataset.add));
  });
  menu.querySelectorAll<HTMLElement>('[data-drop]').forEach(el => {
    el.onclick = () => unqueueShot(sec, Number(el.dataset.drop));
  });
}

function renderBoard(): void {
  const b = $<HTMLButtonElement>('bBoard');
  const s = selectedShip();
  if (!s || !canPlan()) { b.disabled = true; b.textContent = 'Board Target'; return; }
  const t = targetShip();
  // The same rule the resolver applies at second zero, asked rather than copied.
  const canBoard = !!t && match.canBoard(s.id, t.id);
  const dist = t
    ? Math.hypot(s.pos.x - t.pos.x, s.pos.y - t.pos.y, s.pos.z - t.pos.z)
    : Infinity;
  const order = match.order(s.id);
  b.disabled = !canBoard;
  b.classList.toggle('on', order.board !== undefined);
  b.textContent = !t ? 'No target'
    : !canBoard ? `Out of range (${dist.toFixed(0)} > ${s.boardingRange.toFixed(0)})`
    : order.board !== undefined ? 'Boarding ordered'
    : `Board ${shipName(t)}`;
  b.onclick = () => {
    if (!canPlan() || !t) return;
    const o = match.order(s.id);
    if (o.board === undefined) o.board = t.id; else delete o.board;
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
  // Live during playback AND during planning, but they are two states on one
  // control: playback scrubs the turn that was resolved, planning scrubs a
  // preview of the plan. Only the playback one touches playTick, which is the
  // state that used to trap the console.
  const sc = $<HTMLInputElement>('scrub');
  sc.disabled = playTick === null && !canPlan();
  if (playTick === null && canPlan()) sc.value = String(previewTick);
}

function renderHelp(): void {
  $('help').innerHTML =
    '<b>Left drag</b> inside the <span style="color:var(--green)">green outline</span> sets a '
    + 'destination; anywhere else it pans. <b>Right drag</b> orbits. Scroll or pinch to zoom.'
    + '<br><br>'
    + 'Hold <kbd>Shift</kbd> and drag inside the outline to swing the heading instead.<br><br>'
    + '<kbd>Q</kbd>/<kbd>E</kbd> working altitude, <kbd>A</kbd>/<kbd>D</kbd> swing heading, '
    + '<kbd>F</kbd> face the target.<br><br>'
    + '<b>To shoot:</b> tap a hostile to make it the target, tap a weapon to arm it, '
    + 'then tap a <b>fire slot</b> under the timeline to pick the second, and '
    + 'choose a mount from the list it opens. A shot already queued there is in '
    + 'the same list, and tapping it takes the shot back.<br><br>'
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
  renderAttitude();
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
  showPreview();
  envelopeWanted = true;
}

/** Units the working plane moves per step, and per step of a long press. */
const ALT_STEP = 1;
const ALT_FAST = 5;

/**
 * Move the working plane, and say where it now is.
 *
 * The step used to be 5, which is the contour interval, so the plane could
 * only ever sit on the same ladder of heights and a target between two rungs
 * was unpickable. A unit step reaches every height; the readout carries the
 * value, since a plane you can put anywhere is one you can lose track of.
 */
function nudgeAlt(dir: number, step = ALT_STEP): void {
  view.workAlt += dir * step;
  view.clampWorkAlt();
  view.setSelection(selected);
  draw();
  const a = view.workAlt;
  const el = $('pAlt');
  el.textContent = `ALT ${a > 0 ? '+' : ''}${a.toFixed(0)}`;
  el.classList.toggle('zero', Math.abs(a) < 1e-6);
}

/**
 * Tap for one unit, hold to keep going.
 *
 * A unit step is precise and slow: crossing a frigate's envelope is about
 * forty of them. So a press held past 350 ms repeats every 90 ms, and widens
 * to 5 units after a second, which crosses the shape in about the time the
 * old single step took to press eight times. The click that ends a long press
 * is swallowed, or the hold would land one extra step on release.
 */
function holdRepeat(el: HTMLElement, dir: number): void {
  let delay = 0;
  let timer = 0;
  let ticks = 0;
  let repeated = false;
  const stop = (): void => {
    clearTimeout(delay);
    clearInterval(timer);
    delay = 0;
    timer = 0;
  };
  el.addEventListener('pointerdown', () => {
    stop();
    repeated = false;
    ticks = 0;
    delay = window.setTimeout(() => {
      repeated = true;
      timer = window.setInterval(() => {
        ticks++;
        nudgeAlt(dir, ticks > 11 ? ALT_FAST : ALT_STEP);
      }, 90);
    }, 350);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    el.addEventListener(ev, stop);
  }
  el.addEventListener('click', () => {
    if (repeated) { repeated = false; return; }
    nudgeAlt(dir);
  });
}

/**
 * Where the planning preview sits, in ticks.
 *
 * Defaults to the END of the turn, so the ghost shows the orientation a plan
 * arrives with WITHOUT anyone having to scrub for it: where the nose ends up
 * is the whole point of a slide order, and a preview you have to go looking
 * for is one nobody sees. Scrubbing moves it; committing resets it.
 *
 * Separate from `playTick` on purpose, since this previews a plan that has not
 * been committed and must never gate End Turn.
 */
let previewTick = TICKS_PER_TURN;

/**
 * Fly the plan and show where the ship would be, nose included.
 *
 * Only OUR hulls move. Before a turn is committed the other side's orders do
 * not exist: against the AI they are planned during resolution, and against a
 * person they have not been released. Ghosting a hostile here would be
 * inventing its orders, and against the AI it would leak them, so the hostiles
 * stay where they are and this stays a preview of the plan rather than a
 * preview of the turn.
 */
function showPreview(): void {
  if (!canPlan()) { view.setGhosts([]); view.setPaths([]); return; }
  const ghosts = ships
    .filter(s => mine(s) && !s.destroyed)
    .map(s => ({ id: s.id, pose: match.previewPose(s.id, match.order(s.id), previewTick) }))
    .filter((g): g is { id: number; pose: Pose } => !!g.pose);
  view.setGhosts(ghosts);

  // Every ship's course, ours planned and theirs estimated. A hostile has no
  // orders yet, so what is drawn is the course it is already on: honest, and
  // the same thing the core would fly for it given no order at all.
  const paths = ships.filter(s => !s.destroyed).map(s => ({
    id: s.id,
    estimated: !mine(s),
    pts: mine(s)
      ? match.preview(s.id, match.order(s.id), 48)
      : match.preview(s.id, { mode: Mode.Drift, weapons: [] }, 48),
  }));
  view.setPaths(paths);

  // Who is aiming at whom. Ours is the pick for the ship being flown; theirs
  // is `aiTarget`, which the core keeps on the hull and reports, so a line is
  // drawn only where the core says there is one.
  const live = ships.filter(x => !x.destroyed);
  const posOf = (id: number) => live.find(x => x.id === id)?.pos;
  const links: { from: Vec3; to: Vec3; mine: boolean }[] = [];
  const meAt = selectedShip();
  const myTarget = meAt ? targetShip(meAt.id) : undefined;
  if (meAt && myTarget) links.push({ from: meAt.pos, to: myTarget.pos, mine: true });
  for (const e of live) {
    if (mine(e) || e.aiTarget < 0) continue;
    const at = posOf(e.aiTarget);
    if (at) links.push({ from: e.pos, to: at, mine: false });
  }
  view.setAiming(links);
  // One readout for both states. It used to be two, and the planning one was
  // an element the footer no longer has, so every preview refresh threw and
  // took the click that asked for it with it.
  $('hSec').textContent = ((previewTick / TICKS_PER_TURN) * TURN_SECONDS).toFixed(1);
}

let envelopeWanted = false;

/**
 * Ask for every one of this side's envelopes at the start of a turn.
 *
 * Reachability is fixed when a turn opens, so this is the honest moment to
 * compute it: selecting another hull then shows a shape that is already there
 * rather than starting a probe under the player's finger.
 */
function planTurnEnvelopes(): void {
  view.planTurn(ships, orderOf, flightOf, launch.side);
}

const orderOf = (id: number): PlannedOrder => match.order(id);
const shipOf = (id: number): ShipState | undefined => ships.find(x => x.id === id);

/**
 * One level of one ship's envelope per frame, plus the drawing.
 *
 * The probe never runs inline with a click or a drag. It runs here, so a heavy
 * level costs one frame rather than blocking the gesture that asked for it,
 * and the shape is on screen from the first coarse pass.
 */
function probeEnvelopeIfWanted(): void {
  const stillGoing = view.stepShells(orderOf, flightOf, shipOf);
  if (!envelopeWanted && !stillGoing && !view.rebuilding) return;
  envelopeWanted = false;
  const s = selectedShip();
  if (!s) return;
  const order: PlannedOrder = selected >= 0 ? match.order(selected) : { mode: Mode.MoveAndTurn, weapons: [] };
  view.drawEnvelope(canPlan() ? s : undefined, order, flightOf(s.id));
  view.drawPlaneShape(canPlan() ? s : undefined, order, flightOf(s.id));
  $('env').innerHTML = view.envelopeSummary(s, flightOf(s.id))
    + envelopeProgress(s.id);
  showPreview();
}

/** Say that the volume is still sharpening, and how far it has got. */
function envelopeProgress(shipId: number): string {
  const p = view.shellProgress(shipId);
  if (p.done) return '';
  return `<div class="rebuild">rebuilding &middot; ${p.at} of ${p.of} rays</div>`
    + `<span class="rbar"><i style="width:${Math.round(p.frac * 100)}%"></i></span>`;
}

function select(id: number): void {
  selected = id;
  openSlot = null;
  view.setSelection(id);
  refreshAll();
}

// -------------------------------------------------------------- input --

interface Drag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  /** 'plan' issues a move order, 'yaw' drags the ring knob on the map,
   * 'heading' swings the nose from anywhere on the plane, else camera. */
  kind: 'plan' | 'yaw' | 'heading' | 'pan' | 'orbit';
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

  // The yaw ring is a control sitting in the scene, so it is tested before
  // anything that treats a press as a click on the world.
  if (canPlan() && view.onYawKnob(ev.clientX, ev.clientY)) {
    canvas.classList.add('rotating');
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, kind: 'yaw' };
    view.setLiveHeading(true);
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
  if (canPlan() && p && s && view.sliceContains(p)) {
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

  if (drag.kind === 'yaw') {
    const s = selectedShip();
    const dir = view.yawFromPointer(ev.clientX, ev.clientY);
    if (s && dir) { faceToward(s.id, keepPitch(s.id, dir)); refreshAll(); }
    return;
  }
  if (drag.kind === 'pan') { view.pan(dx, dy); return; }
  if (drag.kind === 'orbit') { view.orbit(dx, dy); return; }

  const p = view.planePoint(ev.clientX, ev.clientY);
  const s = selectedShip();
  if (!p || !s) return;
  const o = match.order(s.id);
  if (drag.kind === 'plan') {
    // Keep the destination inside what the ship can reach, by SLIDING it onto
    // the boundary rather than refusing it. Refusing left the marker stopped
    // dead while the hand kept going, which reads as the plan having come
    // unstuck; walking in from a reachable point keeps it under the finger and
    // lands it exactly on the edge. Either way the plan on screen is always a
    // plan the ship could fly, because the point comes from the core.
    // Clamped into the area drawn at this elevation, so the marker cannot
    // leave the highlight, and always AT that elevation: a target off the
    // slice plane is not a target on the plane the section describes. No point
    // means no update, rather than moving the plan somewhere arbitrary.
    const q = view.clampToSlice(p);
    if (!q) return;
    o.target = q;
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
  draw();
});

function endPointer(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (drag && drag.id === ev.pointerId) {
    canvas.classList.remove('rotating');
    const wasPlan = drag.kind === 'plan' || drag.kind === 'heading' || drag.kind === 'yaw';
    const kind = drag.kind;
    drag = null;
    // The hand is off, so the boundary may sharpen to the full ladder again.
    // Before the refresh, so the request that follows is not still capped.
    if (kind === 'yaw' || kind === 'heading') view.setLiveHeading(false);
    if (wasPlan) refreshAll();
    if (kind === 'plan') logPlacement();
  }
}

/**
 * Say where the plan ended up, once the hand comes off it.
 *
 * Printed on release rather than per pointer move, which would be a line a
 * pixel. The estimate is one flight of the planned order through the core, so
 * it is what the ship will actually do rather than what was asked for: those
 * differ by however much of the turn the hull could not deliver.
 *
 * The target's y must equal the slice elevation exactly. It is the plane the
 * highlighted area is a section of, so a target off it is a target outside the
 * region that was drawn to place it.
 */
function logPlacement(): void {
  const s = selectedShip();
  if (!s) return;
  const o = match.order(s.id);
  const y = view.planeY();
  if (!o.target) {
    console.log(`FT place | elevation ${y.toFixed(3)} | no target`);
    return;
  }
  const est = match.previewPose(s.id, o, TICKS_PER_TURN)?.pos;
  const t = o.target;
  console.log(
    `FT place | elevation ${y.toFixed(3)}`
    + ` | target (${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`
    + ` | ship est ${est
      ? `(${est.x.toFixed(3)}, ${est.y.toFixed(3)}, ${est.z.toFixed(3)})`
      : 'none'}`
    + ` | ship now (${s.pos.x.toFixed(3)}, ${s.pos.y.toFixed(3)}, ${s.pos.z.toFixed(3)})`
    + ` | inside ${view.sliceContains(t)}`
    + (t.y === y ? '' : `  OFF PLANE by ${(t.y - y).toFixed(4)}`),
  );
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
    const cur = o.face ?? standingFace.get(s.id) ?? match.forward(s.id);
    const a = Math.atan2(cur.x, cur.z) + (deg * Math.PI) / 180;
    faceToward(s.id, { x: Math.sin(a), y: 0, z: Math.cos(a) });
    refreshAll();
  };
  switch (ev.key.toLowerCase()) {
    case 'q': nudgeAlt(-1); break;
    case 'e': nudgeAlt(1); break;
    case 'a': nudgeHeading(-15); break;
    case 'd': nudgeHeading(15); break;
    case 'f': {
      const t = targetShip();
      if (!t || !canPlan()) break;
      faceToward(s.id, { x: t.pos.x - s.pos.x, y: 0, z: t.pos.z - s.pos.z });
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
  previewTick = TICKS_PER_TURN;
  view.setGhosts([]);
  view.setPaths([]);
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
/**
 * The heading dials, over the viewport.
 *
 * One control per axis the core can be told about, and both read the SHIP:
 * the dim needle is where the nose is, the bright one is where it was told to
 * point, so the gap a hull still has to turn through is the thing on screen
 * rather than a number to work out. A hull gets 60 degrees of yaw a turn, so
 * that gap is most of what planning a heading is about.
 *
 * Dragging anywhere in a dial sets the angle: a dial is an angle, so the whole
 * face is the target rather than a knob to catch.
 */
function dialDrag(id: string, apply: (deg: number, e: PointerEvent) => void): void {
  const el = $(id);
  let held = -1;
  const set = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    apply(Math.atan2(e.clientX - (r.left + r.width / 2),
                     -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI, e);
  };
  el.addEventListener('pointerdown', e => {
    if (!canPlan() || selected < 0) return;
    e.preventDefault();
    held = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    // A heading is moving, so the envelope follows at a fixed rate rather than
    // once per event. Released below, which the dial had no handler for at all
    // before: it tracked the finger and never told anything the drag was over.
    view.setLiveHeading(true);
    set(e);
  });
  el.addEventListener('pointermove', e => {
    // Only while held. `buttons` covers mouse and touch alike.
    if (e.pointerId !== held || e.buttons === 0 || !canPlan() || selected < 0) return;
    set(e);
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId !== held) return;
    held = -1;
    view.setLiveHeading(false);
    refreshAll();
  };
  for (const ev of ['pointerup', 'pointercancel'] as const) el.addEventListener(ev, release);
}

dialDrag('atRoll', deg => {
  const s = selectedShip();
  if (!s) return;
  rollTo(s.id, deg);
  refreshAll();
});
dialDrag('atPitch', deg => {
  const s = selectedShip();
  if (!s) return;
  // The pitch dial is the right half of a circle, so the pointer angle from
  // straight up maps to a climb of 90 minus that. Clamped to what the arc
  // shows, since past vertical the heading has no bearing left to hold.
  setPitch(s.id, Math.max(-80, Math.min(80, 90 - deg)));
  refreshAll();
});

/** Tick marks, drawn once: they never move. */
(() => {
  const g = $('atRollTicks');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = long ? 36 : 40;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(Math.sin(a) * r0));
    line.setAttribute('y1', String(-Math.cos(a) * r0));
    line.setAttribute('x2', String(Math.sin(a) * 45));
    line.setAttribute('y2', String(-Math.cos(a) * 45));
    g.appendChild(line);
  }
})();

/**
 * Point both dials at what the ship is doing.
 *
 * The needles are set from the SHIP, never from the last drag, so a heading
 * that came from Face Target or from a standing order left over from an
 * earlier turn shows up on them like any other.
 */
function renderAttitude(): void {
  const s = selectedShip();
  const on = !!s && canPlan();
  $('attitude').classList.toggle('off', !s);
  for (const d of ['atRoll', 'atPitch']) $(d).classList.toggle('numb', !on);
  if (!s) return;
  const now = match.forward(s.id);
  const cmd = standingFace.get(s.id) ?? match.order(s.id).face ?? now;
  const climb = (v: Vec3) => (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
  const rollNow = (match.rollOf(s.id) * 180) / Math.PI;
  const rollCmd = standingRoll.get(s.id) ?? match.order(s.id).roll;
  const rollDeg = rollCmd === undefined ? rollNow : (rollCmd * 180) / Math.PI;

  $('atRollNow').setAttribute('transform', `rotate(${(-rollNow).toFixed(2)})`);
  $('atRollCmd').setAttribute('transform', `rotate(${(-rollDeg).toFixed(2)})`);
  $('atRollV').textContent = `${Math.round(rollDeg)}`;
  $('atRoll').setAttribute('aria-valuenow', String(Math.round(rollDeg)));

  // The pitch needles start pointing along +X, so a climb rotates them the
  // other way: on screen up is negative y.
  $('atPitchNow').setAttribute('transform', `rotate(${(-climb(now)).toFixed(2)})`);
  $('atPitchCmd').setAttribute('transform', `rotate(${(-climb(cmd)).toFixed(2)})`);
  const p = Math.round(climb(cmd));
  $('atPitchV').textContent = `${p > 0 ? '+' : ''}${p}`;
  $('atPitch').setAttribute('aria-valuenow', String(p));
}

holdRepeat($('pUp'), 1);
holdRepeat($('pDown'), -1);
$('pCCW').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
$('pCW').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
$('pFace').onclick = () => dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

$('bSpeed').onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('bSpeed').textContent = `${speed}x`;
};

const scrub = $<HTMLInputElement>('scrub');
// Scrubbing pauses so the preview holds still under the finger, and RELEASING
// resumes. Without that release, `playing = false` with a tick set was a state
// nothing could leave: the frame loop only advances while playing, so playback
// never finished, never returned to planning, and End Turn stayed disabled
// forever. The scrubber is also inert outside playback, so a stray thumb on a
// phone cannot enter that state from the planning phase at all.
// Two independent states on one control. During PLAYBACK it scrubs the turn
// that was resolved; during PLANNING it scrubs a preview of the plan. The
// planning one must never touch playTick: `playing = false` with a tick set is
// a state nothing could leave, since the frame loop only advances while
// playing, and that is exactly the freeze that took End Turn with it.
scrub.oninput = () => {
  if (playTick !== null) {
    playing = false;
    playTick = Number(scrub.value);
    showTick(playTick);
    return;
  }
  if (!canPlan()) return;
  previewTick = Number(scrub.value);
  showPreview();
};
scrub.onchange = () => {
  if (playTick === null) return;
  playing = true;
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
      restoreFacing();
      view.invalidateEnvelope();
      planTurnEnvelopes();
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
    target: () => targetShip()?.id ?? -1,
    /** Where the selected hull's nose actually points, for checking that a
     * commanded heading is being turned INTO over several turns. */
    forward: () => (selected < 0 ? null : match.forward(selected)),
    /** Whether a screen point lands on the map's yaw knob. Observation only,
     * and the same test the pointer router runs. */
    onYawKnob: (x: number, y: number) => view.onYawKnob(x, y),
    playing: () => playTick,
    side: () => launch.side,
    kind: () => launch.kind,
    // Observation only, like everything else here. A harness that could WRITE
    // state would stop testing the app and start testing itself.
    scenario: () => launch.scenario,
    shipCount: () => match.shipCount,
    wells: () => match.wells(),
    paths: () => view.pathStats(),
    ghosts: () => view.ghostCount(),
    /** How far the selected hull's reachable volume has sharpened, so a
     * harness can see that a heading under a finger is not re-probing it and
     * that letting go finishes the ladder. */
    envelope: () => (selected < 0 ? null : view.shellProgress(selected)),
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
