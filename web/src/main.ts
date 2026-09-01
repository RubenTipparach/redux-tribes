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
import * as THREE from 'three';
import { BEAM_TICKS, FX_TICKS, HIT_TICKS, KILL_TICKS, View, type HullHit } from './app/view.js';
import { Lobby, randomSeed, type Launch } from './app/lobby.js';
import { Designer } from './app/designer.js';
import {
  arcMasks, gunByKey, moduleById, mountsOf, partsOf, PURPOSE, rasterise, stockFor,
  useArcDirs, useCore, type Design,
}
  from './app/design.js';
import { hullTone } from './app/hull.js';
import { blockedPct } from './app/turret.js';
import { shipThumb } from './app/thumb.js';
import { Schematic, type SchematicSubject } from './app/schematic.js';
import * as route from './app/route.js';
import * as saves from './app/saves.js';
import { Api } from './net/api.js';
import {
  type Flight, type PlannedShot, type PlannedOrder, type Pose, type ShipState, type SimEvent,
  type SubState, type Vec3,
  CLASS_KEYS, CLASS_NAMES, classIndexOf, EventKind, FACTION_NAMES, isCommitted, Mode, Scenario,
  SCENARIO_BY_NAME, SUB_BLURB, SUB_LABEL, TICKS_PER_SECOND, TICKS_PER_TURN, TURN_SECONDS,
  WEAPON_NAMES,
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
// Absolute for the same reason the script tag is: this page is served from
// `/play/<id>` too, and `./sim_core.wasm` there is `/play/sim_core.wasm`,
// which the shell route answers with HTML.
const sim = await Sim.load('/sim_core.wasm');
const match: Match = sim.match();
// The editor asks the core what a design is, rather than working it out. Wired
// once, here, because `design.ts` should not know the wasm module exists: it
// measures a picture and hands the counts over. There is deliberately no
// fallback, so a boot that failed to wire this fails loudly at the first
// derivation instead of quietly showing numbers nobody computed.
useCore((cls, geo, parts) => sim.derive(cls, geo, parts));
// And where the mask cells point, for the same reason: the angles are the
// core's definition of its own mask, not something to rebuild out of Math.sin.
useArcDirs(() => sim.arcDirs(), (x, y, z) => sim.arcBit(x, y, z));
const view = new View(canvas, match, sim);
// The map takes a turret off when the CORE says the mount has gone, rather
// than working it out from the hull it drew.
view.setMountGone((ship, mount) => match.mountGone(ship, mount));

let seed = randomSeed();
let ships: ShipState[] = [];
/**
 * Every ship's hit volumes, read beside the ships themselves.
 *
 * Read rather than derived: what a hull carries, how each volume is doing and
 * where it is are the core's answers, and a client that kept its own copy
 * would be a client that can disagree with the thing resolving the turn.
 */
let subs: SubState[] = [];
/**
 * What each ship is flying, by ship id.
 *
 * One answer for the map, the chip thumbnails and the schematic. Three places
 * deciding for themselves what hull a ship has is three chances for a chip to
 * show a picture of a ship that is not on the map.
 */
const hulls = new Map<number, Design>();
const hullOf = (s: ShipState): Design =>
  hulls.get(s.id) ?? stockFor(CLASS_KEYS[s.cls] ?? 'terran_frigate');

function readShips(): void {
  ships = match.ships();
  subs = match.subs();
}
const subsOf = (shipId: number): SubState[] => subs.filter(x => x.ship === shipId);

/**
 * What to call one volume on one ship.
 *
 * A frigate carries two belts, and two chips both reading "armour" is a choice
 * a player cannot make. Repeated kinds are numbered in the core's own order,
 * so the label, the row in the rail and the index a shot carries all agree.
 * One helper, because three near copies of a naming rule is three chances for
 * the rail and the chip to disagree about which one is which.
 */
function volumeName(shipId: number, index: number): string {
  const all = subsOf(shipId);
  const v = all.find(x => x.index === index);
  if (!v) return `sub ${index}`;
  const same = all.filter(x => x.kind === v.kind);
  const label = SUB_LABEL[v.kind] ?? '?';
  return same.length > 1 ? `${label} ${same.indexOf(v) + 1}` : label;
}

/**
 * Which volume the next shot is aimed at, or null for the hull.
 *
 * Held as a KIND and which one of that kind, not as an index, because index 5
 * on a frigate is its reactor and on a freighter there is no index 5 at all.
 * "Keep shooting at the engines" is the thing a player means, and it survives
 * changing target, which an index would not.
 *
 * The client's own, like the target itself: a thing being planned. It reaches
 * the core as the `targetSub` on each queued shot, resolved against whoever is
 * being shot at, at the moment the shot goes in the slot.
 */
let aim: { kind: number; nth: number } | null = null;
function aimSubFor(targetId: number): number {
  if (!aim) return -1;
  const v = subsOf(targetId).filter(x => x.kind === aim!.kind)[aim.nth];
  return v && !v.dead ? v.index : -1;
}
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
/**
 * The review panel: watching turns already fought instead of planning one.
 *
 * `at` indexes `match.history`. `auto` says whether reaching the end of that
 * turn runs on to the next recorded one. `live` is the world as it stood when
 * a past turn was first restored, and is null while the panel is merely OPEN
 * and aimed: aiming must not move the match, so opening the panel and stepping
 * the picker leave the plan being written untouched.
 *
 * This is one state where there were two. A turn strip in the rail chose which
 * turn the event log showed, and a Replay button in the footer re-flew the
 * whole match from turn zero, and neither knew about the other: picking a turn
 * and then hitting Replay watched something else. One object, one picked turn,
 * and both buttons aim at it.
 */
let review: { at: number; auto: boolean; live: Float32Array | null } | null = null;

/** Watching a past world, as opposed to merely having the panel open. */
const watching = (): boolean => !!review && review.live !== null;
/**
 * The selected hull's attitude at the tick on screen, while one is playing
 * back. Null when planning, where the dials read the turn boundary instead.
 */
let atAttitude: { forward: Vec3; roll: number } | null = null;
/**
 * What the AI intends this turn, by ship id, cached for the turn.
 *
 * The planner is a pure function of the boundary state and that state does not
 * move while a player plans, so this is asked once rather than per scrub: a
 * drag would otherwise re-plan every hostile per pointer event.
 */
let aiPlans = new Map<number, PlannedOrder & { aiTarget: number }>();

/**
 * Where hulls have been, by ship id, one entry per turn flown.
 *
 * Sampled from the poses the core reported for the turn that just resolved,
 * not re-flown: the client draws history, it does not compute it.
 */
const trails = new Map<number, Array<{ turn: number; points: Vec3[] }>>();
/** How much of that history is drawn. */
let trailScope: 'off' | 'turn' | 'all' = 'turn';
/** One sample every this many ticks. 600 ticks a turn, so 61 points a ship. */
const TRAIL_STEP = 10;
let flightOverride = new Map<number, Flight>();
/** How this match was entered, which decides how its turns are resolved. */
let launch: Launch = { kind: 'offline', seed: '', scenario: 'skirmish', humanSides: 0b01, side: 0 };
/** True while a committed turn is waiting on the other seat. */
let waiting = false;
/** Whether this game's ending has been written to its save yet. */
let endedSaved = false;

/**
 * Is this hull mine? The simulation only knows sides, deliberately, so this
 * is the one place the seat is applied and everything else asks here.
 */
const mine = (s: ShipState): boolean => s.side === launch.side;

function start(): void {
  // The lobby has always carried a scenario name and this always ignored it,
  // so every match was a skirmish however it was entered.
  const scenario = SCENARIO_BY_NAME[launch.scenario] ?? Scenario.Skirmish;
  // A hull picked in the lobby applies to the side that picked it, and it is
  // the DESIGN that crosses, not its class: the core derives what it weighs,
  // what it can take and how it flies, and hashes the result. The client's
  // only contribution is measuring its own picture.
  match.clearHulls();
  // One hull per SHIP, by (side, slot): slot n is the nth ship THAT side seats,
  // which is the order the roster reports and the order the core fills. Both
  // sides, because what you are fighting is as much a setup choice as what you
  // fly, and the core's registry was always two sided.
  const picks = launch.hulls ?? [];
  const took: Array<Array<Design | null>> = [[], []];
  const refused: string[] = [];
  for (const pick of picks) {
    const side = pick.side === 1 ? 1 : 0;
    const d = pick.design as Design;
    const r = rasterise(d);
    const ok = match.setHull(side, classIndexOf(d.classKey), {
      plateCells: r.plateCells, ext: r.extent, radiusCells: r.radiusCells, fouled: r.fouled,
    }, partsOf(d), mountsOf(d), arcMasks(d), pick.slot);
    // The core refuses an illegal hull, and saying so beats spawning the class
    // hull and letting a player wonder why their ship is somebody else's.
    if (ok) (took[side] as Array<Design | null>)[pick.slot] = d;
    else refused.push(pick.name);
  }
  const named = (side: number) => picks
    .filter(p => (p.side === 1 ? 1 : 0) === side && (took[side] as Array<Design | null>)[p.slot])
    .map(p => p.name);
  const flownOurs = named(launch.side);
  const flownTheirs = named(launch.side === 0 ? 1 : 0);
  const flying = refused.length
    ? `${refused.join(', ')} not legal, flying the class hull`
    : [flownOurs.length ? `in ${flownOurs.join(', ')}` : '',
       flownTheirs.length ? `against ${flownTheirs.join(', ')}` : '']
      .filter(Boolean).join(' \u00b7 ');
  match.start(seed, scenario, launch.humanSides);
  // Dress the field before the first frame. A level is somewhere: its own
  // nebula, its own sun, its own planets, and the key light aimed at that sun
  // so the lit side of a hull agrees with the sky behind it. Keyed by the
  // scenario NAME rather than the enum, because the presets are authored
  // beside the level list a player reads.
  view.setSky(launch.scenario);
  // What each ship is flying, so the map draws the hull rather than a stand in
  // for it: the picked design for the slot that picked it, and each class's
  // stock hull for everyone else. Kept rather than handed straight over,
  // because the chips and the schematic draw the same hulls and would
  // otherwise each work out their own answer to "what is this ship".
  hulls.clear();
  // A counter per side, because slot is an index WITHIN a side and the ship
  // list interleaves them.
  const seen: [number, number] = [0, 0];
  for (const s of match.ships()) {
    const side = s.side === 1 ? 1 : 0;
    const picked = (took[side] as Array<Design | null>)[seen[side]++] ?? null;
    hulls.set(s.id, picked ?? stockFor(CLASS_KEYS[s.cls] ?? 'terran_frigate'));
  }
  view.setDesigns(hulls);
  // Say what was taken out, on the panel that lists it. A design picked in the
  // lobby and never mentioned again is a pick a player cannot check.
  $('hullNote').textContent = flying;
  // The rings compare the field against the drive of a hull actually in the
  // match, so they mean something for the ships being flown.
  const own = match.ships().find(mine);
  const drive = own ? flightOf(own.id).accelFwd : 0;
  view.setWells(match.wells(), drive);
  view.mySide = launch.side;
  waiting = false;
  endedSaved = false;
  banner(false);
  flightOverride = new Map();
  readShips();
  selected = ships.find(mine)?.id ?? -1;
  targets.clear();
  standingFace.clear();
  standingRoll.clear();
  trails.clear();
  review = null;
  atAttitude = null;
  aiPlans = new Map();
  openSlot = null;
  playTick = null;
  playing = false;
  view.setShips(ships);
  view.setSelection(selected);
  view.fit();
  closeSchematic();
  setInspect(false);
  restoreFacing();
  refreshAiPlans();
  view.invalidateEnvelope();
  // A resumed game is the same match run forward again. The core is a pure
  // function of what it started from and the orders since (ADR-6), so
  // replaying them lands on the state it left off in, bit for bit, and the
  // history the review panel scrubs comes back with it.
  //
  // Before the envelopes and the first refresh, so the console draws the turn
  // the player is actually on rather than turn zero and then jumping.
  for (const [n, body] of (launch.resume ?? []).entries()) {
    const orders = new Map<number, PlannedOrder>();
    for (const [ship, o] of Object.entries(body)) orders.set(Number(ship), o as PlannedOrder);
    match.resolveWith(orders);
    void n;
  }
  if (launch.resume?.length) {
    readShips();
    view.setShips(ships);
    selected = ships.find(mine)?.id ?? -1;
    view.setSelection(selected);
    view.fit();
    restoreFacing();
    refreshAiPlans();
  }
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
  return !watching() && playTick === null && !waiting && !!s && mine(s) && !s.destroyed;
};

// ------------------------------------------------------------- panels --

/**
 * One ship's hit volumes, sorted the way every rail and card shows them.
 *
 * The core reports them in its own order and that order is the contract a shot
 * carries, so this never renumbers them: it sorts a COPY for display, and the
 * `index` on each one is still the core's.
 */
const volumesOf = (id: number): SubState[] =>
  subsOf(id).slice().sort((a, b) => a.kind - b.kind || a.index - b.index);

/** The volumes that are gone, which is what a chip has to say at a glance. */
const offlineOf = (id: number): SubState[] => volumesOf(id).filter(v => v.dead);

/** Which of my hulls are aiming at this one, nearest thing to a threat list. */
const aimersOf = (enemyId: number): ShipState[] =>
  ships.filter(s => mine(s) && !s.destroyed && targetShip(s.id)?.id === enemyId);

/**
 * The fleet rail, as chips.
 *
 * A chip is a button with a picture of the ship on it, because a player who
 * spent an hour in the shipyard should be able to pick their hull out of the
 * rail without reading. Beside it, and only when there is something to say,
 * the systems that have gone offline: a hull at 80 hull points with its thrusters
 * out is in far more trouble than one at 50 with everything working, and the
 * bar alone cannot tell those apart.
 *
 * Hover fills in the rest (hover being a desk affordance), and the info button
 * opens the schematic, which is the same detail on a device with no pointer.
 */
function renderFleet(): void {
  const rows = (list: ShipState[], host: HTMLElement, enemy: boolean) => {
    host.innerHTML = '';
    for (const s of list) {
      // A hostile chip is the target picker, so it marks the ship under the
      // guns rather than the ship being flown. Selecting an enemy as though it
      // were yours only ever made the whole rail inert, because planning needs
      // one of your own hulls.
      const aimed = enemy && targetShip()?.id === s.id && selected >= 0
        && !!selectedShip() && mine(selectedShip()!);
      const chip = document.createElement('div');
      chip.dataset.ship = String(s.id);
      chip.className = `chip${enemy ? ' enemy' : ''}`
        + `${!enemy && s.id === selected ? ' sel' : ''}${aimed ? ' tg' : ''}`
        + `${s.destroyed ? ' gone' : ''}`;

      const pick = document.createElement('button');
      pick.className = 'chipPick';
      pick.type = 'button';
      const hullPct = Math.max(0, (100 * s.hull) / s.hullMax);
      const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      const thumb = shipThumb(hullOf(s), hullTone(s, launch.side));
      // No picture on a machine that would not give up a third GL context, so
      // the chip falls back to the class initial rather than a broken image.
      const art = thumb
        ? `<img class="th" src="${thumb}" alt="">`
        : `<span class="th nogl">${(CLASS_NAMES[s.cls] ?? '?').slice(0, 1)}</span>`;
      // Who this hull is aiming at, on the hull's own chip, because targeting
      // is per ship. For a hostile it is `aiTarget`, which the core keeps and
      // reports, so the chip says what the enemy is set on rather than guessing.
      const aimLine = s.destroyed ? ''
        : `<span class="ln aim"><span>${enemy ? 'hunting' : 'target'}</span>`
          + `<span>${enemy
            ? (s.aiTarget >= 0 ? nameOf(s.aiTarget) : 'nobody yet')
            : (targetShip(s.id) ? shipName(targetShip(s.id)!) : 'none')}</span></span>`;
      pick.innerHTML = art
        + `<span class="body">`
        + `<span class="nm">${shipName(s)}`
        + `${s.destroyed ? ' <i>lost</i>' : s.drifting ? ' <i>adrift</i>' : ''}</span>`
        + `<span class="bar"><i style="width:${hullPct.toFixed(0)}%"></i></span>`
        + `<span class="ln"><span>hull ${s.hull.toFixed(0)}</span>`
        + `<span>${speed.toFixed(1)} u/s</span></span>`
        + aimLine
        + `</span>`;
      pick.onclick = () => {
        if (enemy) {
          if (s.destroyed || selected < 0) return;
          targets.set(selected, s.id);
          refreshAll();
        } else {
          select(s.id);
        }
      };
      hoverCardOn(pick, s.id);
      chip.appendChild(pick);

      // The systems that are gone, listed beside the chip rather than folded
      // into it: a chip listing all six of a frigate's volumes every turn is a
      // chip nobody reads, and the ones that matter are the ones that are out.
      const side = document.createElement('div');
      side.className = 'chipSide';
      const info = document.createElement('button');
      info.className = 'chipInfo';
      info.type = 'button';
      info.title = `Schematic of ${shipName(s)}`;
      info.setAttribute('aria-label', `Schematic of ${shipName(s)}`);
      info.textContent = 'i';
      info.onclick = ev => { ev.stopPropagation(); openSchematic(s.id); };
      side.appendChild(info);
      for (const v of offlineOf(s.id)) {
        const tag = document.createElement('span');
        tag.className = 'off';
        tag.textContent = volumeName(s.id, v.index);
        tag.title = `${volumeName(s.id, v.index)} offline. ${SUB_BLURB[v.kind] ?? ''}`;
        side.appendChild(tag);
      }
      chip.appendChild(side);

      // On a hostile, who of mine has it under the guns. The chip of the ship
      // doing the aiming is highlighted, so "which of my ships is on this one"
      // is answered on the chip rather than by clicking through the fleet.
      if (enemy && !s.destroyed) {
        const by = aimersOf(s.id);
        if (by.length) {
          const line = document.createElement('div');
          line.className = 'aimedBy';
          line.innerHTML = '<span class="k">aimed by</span>' + by.map(a =>
            `<button class="who${a.id === selected ? ' on' : ''}" type="button" `
            + `data-ship="${a.id}">${shipName(a).split(' ')[0]}</button>`).join('');
          for (const b of [...line.querySelectorAll<HTMLButtonElement>('button.who')]) {
            b.onclick = ev => { ev.stopPropagation(); select(Number(b.dataset.ship)); };
          }
          chip.appendChild(line);
        }
      }
      host.appendChild(chip);
    }
  };
  rows(ships.filter(mine), $('fleet'), false);
  rows(ships.filter(s => !mine(s)), $('hostiles'), true);
  restoreHoverCard();
}

// -------------------------------------------------------- the schematic --

const schematic = new Schematic();
/** Which hull the modal is describing, so a resolved turn can refresh it. */
let schemaOf = -1;

/**
 * One ship as the schematic wants it: named, measured and placed.
 *
 * Everything here came from the core. The volumes arrive in WORLD space
 * because that is where the map needs them, and the modal draws a hull in its
 * own frame, so they are turned back through the ship's orientation. That is a
 * change of frame and not a rule: which way the hull is pointing is still the
 * core's answer, this only reads it.
 */
function schematicOf(id: number): SchematicSubject | null {
  const s = ships.find(x => x.id === id);
  if (!s) return null;
  const inv = new THREE.Quaternion(s.quat.x, s.quat.y, s.quat.z, s.quat.w).invert();
  const at = new THREE.Vector3();
  return {
    title: shipName(s),
    subtitle: `${CLASS_NAMES[s.cls] ?? '?'} &middot; ${FACTION_NAMES[s.faction] ?? '?'}`
      + ` &middot; ${mine(s) ? 'yours' : 'hostile'}`
      + `${s.destroyed ? ' &middot; lost' : s.drifting ? ' &middot; adrift' : ''}`,
    design: hullOf(s),
    tone: hullTone(s, launch.side),
    lost: s.destroyed,
    stats: [
      ['hull', `${s.hull.toFixed(0)}/${s.hullMax.toFixed(0)}`],
      ['speed', `${Math.hypot(s.vel.x, s.vel.y, s.vel.z).toFixed(1)} u/s`],
      ['marines', String(s.marines)],
      ['board', `${s.boardingRange.toFixed(0)} u`],
    ],
    volumes: volumesOf(id).map(v => {
      at.set(v.pos.x - s.pos.x, v.pos.y - s.pos.y, v.pos.z - s.pos.z).applyQuaternion(inv);
      return {
        index: v.index,
        name: volumeName(id, v.index),
        kind: v.kind,
        hp: v.hp,
        hpMax: v.hpMax,
        dead: v.dead,
        blockPct: v.blockPct,
        half: v.half,
        at: { x: at.x, y: at.y, z: at.z },
      };
    }),
  };
}

function openSchematic(id: number): void {
  const subject = schematicOf(id);
  if (!subject) return;
  schemaOf = id;
  schemaKey = '';
  schematic.show(subject);
}

function closeSchematic(): void {
  schemaOf = -1;
  schematic.hide();
}

/**
 * Keep an open schematic on the same hull as the match moves under it.
 *
 * Guarded on what the picture depends on, because `refreshAll` runs on every
 * pointer move that changes a plan and rebuilding a scene per event is the
 * mistake the envelope probe already taught this client once.
 */
let schemaKey = '';
function refreshSchematic(): void {
  if (schemaOf < 0 || !schematic.visible) return;
  const s = ships.find(x => x.id === schemaOf);
  if (!s) return;
  const key = `${s.hull.toFixed(1)}|${s.destroyed}|${s.drifting}|${s.marines}|`
    + subsOf(schemaOf).map(v => `${v.index}:${v.hp.toFixed(1)}:${v.dead}`).join(',');
  if (key === schemaKey) return;
  schemaKey = key;
  const subject = schematicOf(schemaOf);
  if (subject) schematic.update(subject);
}

// ------------------------------------------------------- the inspector --

/**
 * Labels on the parts of one hull, out on the map.
 *
 * Offered rather than always on: the boxes are useful at the zoom where a hull
 * fills a third of the screen and are a fog of text at the zoom where a match
 * is planned. So the button only appears once the camera is actually looking
 * at a ship (`closeUpOn`), and the mode drops the moment that stops being
 * true, which is exactly "if I move or zoom away". Changing the selection
 * drops it too, because the boxes belonged to the old hull.
 */
let inspect = -1;
/** Which volume the pointer is over out on the map, or -1. */
let inspectHot = -1;

const inspectSubject = (): ShipState | undefined => {
  const s = selectedShip();
  return s && !s.destroyed ? s : undefined;
};

/** May the inspector be offered right now? */
function inspectReady(): boolean {
  const s = inspectSubject();
  return !!s && view.closeUpOn(s);
}

function setInspect(on: boolean): void {
  const s = inspectSubject();
  inspect = on && s ? s.id : -1;
  inspectHot = -1;
  // Ship data turns the ARCS on too. What a hull is made of and where its guns
  // can actually shoot are the same question asked twice, and a player who has
  // asked for one has asked for the other.
  syncArcShell();
  renderInspect();
}

/**
 * The button, and the boxes.
 *
 * Called from the frame loop, because what it depends on is the camera and the
 * camera moves without anything else happening. It writes only when something
 * changed: a rebuild a frame would throw away the hover the boxes exist for.
 */
let inspectKey = '';
function renderInspect(): void {
  const ready = inspectReady();
  const btn = $('bInspect');
  btn.classList.toggle('hidden', !ready && inspect < 0);
  btn.classList.toggle('on', inspect >= 0);
  const s = inspectSubject();
  btn.textContent = inspect >= 0 ? 'Hide ship data' : 'Ship data';

  // Moved off it, or onto another hull: the boxes described a ship that is no
  // longer the one being looked at.
  if (inspect >= 0 && (!s || s.id !== inspect || !ready)) {
    inspect = -1;
    inspectHot = -1;
    syncArcShell();
    btn.classList.remove('on');
    btn.textContent = 'Ship data';
  }

  const host = $('inspect');
  const list = inspect >= 0 && s ? volumesOf(s.id) : [];
  const key = `${inspect}|${list.map(v => `${v.index}:${v.hp.toFixed(0)}:${v.dead}`).join(',')}`;
  if (key !== inspectKey) {
    inspectKey = key;
    host.innerHTML = '';
    for (const v of list) {
      const box = document.createElement('div');
      box.className = `ibox${v.dead ? ' dead' : ''}`;
      box.dataset.sub = String(v.index);
      const pct = v.hpMax > 0 ? Math.max(0, (100 * v.hp) / v.hpMax) : 0;
      box.innerHTML =
        `<span class="k">${volumeName(s!.id, v.index)}</span>`
        + `<span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span>`
        + `<span class="v">${v.dead ? 'offline' : `${v.hp.toFixed(0)}/${v.hpMax.toFixed(0)}`}</span>`
        + `<span class="why">Soaks ${v.blockPct.toFixed(0)}% of what reaches it. `
        + `${SUB_BLURB[v.kind] ?? ''}</span>`;
      // Hover for a mouse, tap for everything else. A phone has no hover and
      // the sentence about what losing this volume costs is the reason the box
      // exists, so it cannot be behind one.
      box.onpointerenter = ev => {
        if (ev.pointerType !== 'mouse') return;
        inspectHot = v.index;
        markInspect();
      };
      box.onpointerleave = ev => {
        if (ev.pointerType !== 'mouse') return;
        inspectHot = -1;
        markInspect();
      };
      box.onclick = () => {
        inspectHot = inspectHot === v.index ? -1 : v.index;
        markInspect();
      };
      host.appendChild(box);
    }
    markInspect();
  }
  host.classList.toggle('hidden', inspect < 0);
  placeInspect();
}

/**
 * What the pointer is resting on, out on the map.
 *
 * The picture IS the grid: a raycast gives a quad, the quad names a lattice
 * cell, and the raster says which placement is standing in that cell. So this
 * is a lookup rather than a guess, and it is the same lookup the shipyard's
 * own tap does over the same cells.
 *
 * A turret gets more: its weapon's numbers, how much of its sphere its own
 * hull takes, and the blocked cone drawn on the ship while the pointer is on
 * it. A player who cannot see why a mount will not shoot astern is a player
 * who thinks the gun is broken.
 */
let tipShip = -1;
let tipRig = -1;
let tipCell = -1;

function hideTip(): void {
  if (tipShip < 0) return;
  tipShip = -1; tipRig = -1; tipCell = -1;
  $('partTip').classList.add('hidden');
  syncArcShell();
}

/** The arcs on the map: the hovered turret's, or every one of them while the
 *  ship data panel is up, because that panel is the "tell me about this hull"
 *  request and an arc is part of the answer. */
function syncArcShell(): void {
  if (tipRig >= 0 && tipShip >= 0) view.showArcs(tipShip, tipRig);
  else if (inspect >= 0) view.showArcs(inspect, -1);
  else view.showArcs(-1, -1);
}

function showTip(clientX: number, clientY: number): void {
  const at = view.pickHullCell(clientX, clientY);
  if (!at) { hideTip(); return; }
  const s = ships.find(x => x.id === at.ship);
  if (!s) { hideTip(); return; }
  const changed = at.ship !== tipShip || at.cell !== tipCell || at.rig !== tipRig;
  tipShip = at.ship; tipCell = at.cell; tipRig = at.rig;

  const tip = $('partTip');
  if (changed) {
    const design = hullOf(s);
    const owner = rasterise(design).own[at.cell] ?? 0;
    const part = owner > 0 ? design.parts[owner - 1] : undefined;
    const mod = part ? moduleById(part.module) : undefined;
    let body: string;
    if (mod) {
      const pu = PURPOSE[mod.purpose];
      body = `<span class="nm">${mod.name}</span>`
        + `<span class="sub">${mod.id} &middot; ${pu.label}</span>`;
      if (at.rig >= 0) {
        const gun = gunByKey(mod.weapon ?? '');
        const masks = arcMasks(design);
        const mask = masks[at.rig];
        if (gun) {
          body += `<span class="sub">${gun.dmg} dmg${gun.batch > 1 ? ` x${gun.batch}` : ''}`
            + ` &middot; ${gun.range} u &middot; ${gun.cooldown}s</span>`;
        }
        if (mask) {
          body += `<span class="sub">own hull blocks `
            + `<b>${blockedPct(mask).toFixed(0)}%</b> of its sphere</span>`;
        }
      }
    } else {
      // Plate and frame belong to no placement: they are the hull itself.
      body = `<span class="nm">${shipName(s)}</span>`
        + `<span class="sub">hull plating</span>`;
    }
    tip.innerHTML = body;
    tip.classList.remove('hidden');
    syncArcShell();
  }
  // Offset off the cursor and flipped near the right edge, so the label never
  // sits under the thing it is naming or off the screen.
  const w = tip.offsetWidth || 180;
  const left = clientX + 14 + w > window.innerWidth ? clientX - 14 - w : clientX + 14;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, clientY + 14)}px`;
}

function markInspect(): void {
  for (const b of [...$('inspect').children] as HTMLElement[]) {
    b.classList.toggle('hot', Number(b.dataset.sub) === inspectHot);
  }
}

/**
 * Put each box where its volume is on screen.
 *
 * Every frame the inspector is up, because the hull is moving during playback
 * and a label that lags the thing it names is a label pointing at the wrong
 * part. Behind the camera means off, not wrapped round to the other side of
 * the screen, which is what an unchecked projection does.
 *
 * Six volumes on a seven unit hull put six labels inside about two hundred
 * pixels, so they are laid out rather than dropped where they land: each goes
 * to the side of the hull its marker is already on, and then all of them are
 * pushed apart vertically until none overlaps another. The MARKER does not
 * move with the label. It stays on the volume and a leader runs back to it,
 * because a label nudged clear of its neighbours is only useful while it is
 * still visibly attached to the thing it names.
 */
const LEAD = 16;
/** Clear air between two stacked labels. */
const LABEL_GAP = 3;

function placeInspect(): void {
  if (inspect < 0) return;
  const boxes = [...$('inspect').children] as HTMLElement[];
  if (!boxes.length) return;
  const rect = canvas.getBoundingClientRect();
  const live = subsOf(inspect);

  interface Placed {
    el: HTMLElement; ax: number; ay: number; w: number; h: number; y: number;
    /** Reaching left from its marker, because the marker is on the right side. */
    flip: boolean;
  }
  const placed: Placed[] = [];
  for (const b of boxes) {
    const v = live.find(x => x.index === Number(b.dataset.sub));
    if (!v) { b.style.display = 'none'; continue; }
    // Asked of the view rather than projected from `v.pos`: that point was
    // read when the console last read the world, and through a playback the
    // hull moves every tick without another read. The label followed the
    // ship's start of turn pose and sat in empty space behind it.
    const at = view.subScreen(v);
    const ax = at.x - rect.left, ay = at.y - rect.top;
    if (ax < -80 || ay < -80 || ax > rect.width + 80 || ay > rect.height + 80) {
      b.style.display = 'none';
      continue;
    }
    b.style.display = '';
    const w = b.offsetWidth, h = b.offsetHeight;
    // Away from the middle of the hull, so labels fan outwards instead of all
    // piling up on the same flank.
    placed.push({ el: b, ax, ay, w, h, y: ay - h / 2, flip: ax > rect.width * 0.52 });
  }

  // Stacked across ALL of them rather than per side. Splitting the labels
  // left and right halves how far each leader has to run, and it does NOT
  // stop two of them colliding: a label reaching left from a marker on the
  // right meets one reaching right from a marker on the left, in the middle,
  // which is exactly where a hull's volumes are.
  placed.sort((a, b) => a.y - b.y);
  let floor = 4;
  for (const p of placed) {
    p.y = Math.max(p.y, floor);
    floor = p.y + p.h + LABEL_GAP;
  }
  // Anything pushed off the bottom comes back up, which keeps a cluster near
  // the lower edge on screen rather than marching off it.
  let ceil = rect.height - 4;
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i] as Placed;
    p.y = Math.min(p.y, ceil - p.h);
    ceil = p.y - LABEL_GAP;
  }
  for (const p of placed) {
    const x = p.flip ? p.ax - LEAD - p.w : p.ax + LEAD;
    p.el.style.left = `${Math.round(x)}px`;
    p.el.style.top = `${Math.round(p.y)}px`;
    // Where the marker sits, in the label's own frame, and the leader back to
    // it from the label's near edge.
    const dx = p.ax - x, dy = p.ay - p.y;
    const ex = p.flip ? p.w : 0;
    p.el.style.setProperty('--dx', `${dx.toFixed(1)}px`);
    p.el.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    p.el.style.setProperty('--len', `${Math.hypot(ex - dx, p.h / 2 - dy).toFixed(1)}px`);
    p.el.style.setProperty('--ang', `${Math.atan2(p.h / 2 - dy, ex - dx).toFixed(3)}rad`);
  }
}

// ------------------------------------------------------- the hover card --

/**
 * The full read on one hull, shown while a pointer rests on its chip.
 *
 * A desk affordance and only ever an addition: everything in it is reachable
 * by tapping the info button, because a phone has no hover and CLAUDE.md is
 * explicit that nothing may depend on one to be discoverable. Bound on
 * `(hover: hover)` so a touch device never gets a card stuck under a thumb.
 */
const canHover = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;

/** Which hull the card is on, so a rebuilt rail can put it back. */
let hoverShip = -1;

function hoverCardOn(el: HTMLElement, id: number): void {
  if (!canHover()) return;
  el.onpointerenter = () => { hoverShip = id; showHoverCard(el, id); };
  el.onpointerleave = hideHoverCard;
  el.onfocus = () => { hoverShip = id; showHoverCard(el, id); };
  el.onblur = hideHoverCard;
}

function hideHoverCard(): void {
  hoverShip = -1;
  $('shipCard').classList.add('hidden');
}

/**
 * Put the card back on the chip it was on.
 *
 * The rail is rebuilt wholesale on every refresh, and a refresh happens
 * whenever a plan changes. That takes the element the card was anchored to out
 * from under it, and no `pointerleave` fires for an element that no longer
 * exists: without this the card either vanishes mid read or hangs over the map
 * describing a chip that is gone.
 */
function restoreHoverCard(): void {
  if (hoverShip < 0) return;
  const el = document.querySelector<HTMLElement>(`.chip[data-ship="${hoverShip}"] .chipPick`);
  if (el) showHoverCard(el, hoverShip);
  else hideHoverCard();
}

function showHoverCard(el: HTMLElement, id: number): void {
  const s = ships.find(x => x.id === id);
  const card = $('shipCard');
  if (!s) { card.classList.add('hidden'); return; }
  const pct = Math.max(0, (100 * s.hull) / s.hullMax);
  const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  const rows = volumesOf(s.id).map(v => {
    const vp = v.hpMax > 0 ? Math.max(0, (100 * v.hp) / v.hpMax) : 0;
    return `<div class="vrow${v.dead ? ' dead' : ''}">`
      + `<span>${volumeName(s.id, v.index)}</span>`
      + `<span class="bar"><i style="width:${vp.toFixed(0)}%"></i></span>`
      + `<span>${v.dead ? 'offline' : `${v.hp.toFixed(0)}/${v.hpMax.toFixed(0)}`}</span>`
      + `</div>`;
  }).join('');
  card.innerHTML =
    `<div class="hd">${shipName(s)}</div>`
    + `<div class="s">${CLASS_NAMES[s.cls] ?? '?'} &middot; `
    + `${FACTION_NAMES[s.faction] ?? '?'} &middot; ${mine(s) ? 'yours' : 'hostile'}</div>`
    + `<div class="vrow"><span>hull</span>`
    + `<span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span>`
    + `<span>${s.hull.toFixed(0)}/${s.hullMax.toFixed(0)}</span></div>`
    + `<div class="vrow"><span>speed</span><span></span><span>${speed.toFixed(1)} u/s</span></div>`
    + `<div class="vrow"><span>marines</span><span></span><span>${s.marines}</span></div>`
    + (s.destroyed ? '' : `<div class="vrow"><span>${mine(s) ? 'target' : 'hunting'}</span>`
      + `<span></span><span>${mine(s)
        ? (targetShip(s.id) ? shipName(targetShip(s.id)!) : 'none')
        : (s.aiTarget >= 0 ? nameOf(s.aiTarget) : 'nobody yet')}</span></div>`)
    + `<div class="sect">Volumes</div>${rows}`
    + `<div class="hint">Tap <b>i</b> for the schematic.</div>`;
  card.classList.remove('hidden');

  // Beside the chip, and pushed back on screen rather than off it: the rail is
  // 250 px on a desk and the card is wider than that, so it hangs over the map.
  const r = el.getBoundingClientRect();
  card.style.visibility = 'hidden';
  card.style.left = '0px';
  card.style.top = '0px';
  const h = card.getBoundingClientRect().height;
  card.style.left = `${Math.round(r.right + 8)}px`;
  card.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - h - 8, r.top)))}px`;
  card.style.visibility = '';
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

/**
 * The flight stats.
 *
 * Read only in a real match. A hull behaves the way its class says it does,
 * and the numbers are still worth showing, because what a ship can do is what
 * planning a turn is about. Sliders only in a sandbox.
 *
 * The lock is the CORE's: `ft_set_flight` refuses outside a sandbox, because
 * the stats are in the state hash and a seat that could change them mid match
 * could part two clients on its own. This asks whether it would be accepted
 * rather than deciding for itself.
 */
function renderTuning(): void {
  const host = $('envTune');
  host.innerHTML = '';
  const s = selectedShip();
  if (!s) return;
  const f = flightOf(s.id);
  if (!match.sandbox) {
    for (const [k, label] of STAT_ROWS) {
      const row = document.createElement('div');
      row.className = 'tune locked';
      row.innerHTML = `<span>${label}</span><i></i><b>${f[k].toFixed(2)}</b>`;
      host.appendChild(row);
    }
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = 'Class stats, fixed for the match. Start a Sandbox to change them.';
    host.appendChild(note);
    return;
  }
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
    // A mount with no bay behind it is not cooling, and telling a player to
    // wait for it is telling them to wait for nothing.
    const bay = match.weaponBay(s.id);
    // And a mount whose own hull is in the way is not cooling either. Asked of
    // the core, never worked out here: the arc is scanned off the design and
    // read by the resolver, and a console holding its own opinion of it would
    // grey out one mount while the resolver dropped the shot from another.
    //
    // A hint rather than a gate, because the shot is fired several seconds
    // from now and both ships will have turned by then. What it answers is
    // "would this mount bear if the shot went off as things stand".
    const foe = targetShip();
    const bears = !foe || match.canBear(s.id, i, foe.id, aimSubFor(foe.id));
    const when = shots.length
      ? ` &middot; t+${shots.map(w => w.second).join(', ')}s`
      : !bay ? ' &middot; weapon bay out'
      : spent ? ` &middot; ready t+${nextFree}s`
      : !bears ? ' &middot; hull in the way'
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
 * Why this second is not free for this mount, or null when it is.
 *
 * Two refusals wear the same word and are not the same thing, which is what
 * made a rail of three mounts all reading "cooling" useless: one mount had
 * fired and was recovering, and the others were being held for a shot the
 * player had already placed a second later. Neither said which, or how long.
 *
 * - `after`: the mount fired, or is set to fire earlier in this turn, and is
 *   still inside its cooldown. `at` is the second it comes back.
 * - `before`: nothing is cooling, but a shot IS already queued later and
 *   firing here would push it outside its own cooldown. `at` is that shot.
 *
 * The core answers both: `nextFreeSecond` is asked once for the gap before the
 * candidate and once for the shot after it, so the cooldown arithmetic is
 * never done here. A slot the planner offers is a slot the resolver honours,
 * because both ask the same gate.
 */
interface SlotBlock { kind: 'after' | 'before' | 'taken' | 'offline'; at: number }

function slotBlock(
  ship: number, weapon: number, sec: number, queued: readonly PlannedShot[],
): SlotBlock | null {
  const mine = queued.filter(w => w.weaponIndex === weapon).map(w => w.second).sort((a, b) => a - b);
  if (mine.includes(sec)) return { kind: 'taken', at: sec };
  if (!match.weaponBay(ship)) return { kind: 'offline', at: 0 };
  const before = mine.filter(s => s < sec).pop() ?? -1;
  const ready = match.nextFreeSecond(ship, weapon, before);
  if (sec < ready) return { kind: 'after', at: ready };
  const after = mine.find(s => s > sec);
  // The shot after it has to survive too, or queuing this one would silently
  // invalidate a shot the player already placed.
  if (after !== undefined && after < match.nextFreeSecond(ship, weapon, sec)) {
    return { kind: 'before', at: after };
  }
  return null;
}

/**
 * The refusal, in words, with the number that makes it actionable.
 *
 * A countdown for a mount still recovering, because what a player wants to
 * know is how much longer; the second itself for one being held for a shot
 * already placed, because that is a slot they can go and look at.
 */
function slotBlockText(b: SlotBlock, sec: number): string {
  if (b.kind === 'taken') return 'already firing here';
  if (b.kind === 'offline') return 'weapon bay out';
  return b.kind === 'after'
    ? `-${b.at - sec}s to fire &middot; ready t+${b.at}s`
    : `firing in ${b.at - sec}s`;
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
  const block = slotBlock(selected, weaponIndex, sec, o.weapons);
  if (block) {
    // The same words the row shows, so the toast and the list never disagree
    // about why a slot was refused.
    flash(`t+${sec}s: ${slotBlockText(block, sec).replace(/&middot;/g, '.')}`);
    return;
  }
  // A mount may fire more than once in a turn, so a second shot is ADDED
  // rather than replacing the first. It used to replace it, which is what
  // "weapons queuing is not working" looked like.
  o.weapons.push({ weaponIndex, second: sec, targetShip: t.id, targetSub: aimSubFor(t.id) });
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

  // Where on the target the shots go. On the slot menu rather than in a sheet,
  // because this is where a shot is queued and a control that only exists in a
  // sheet is one nothing on screen says exists. Dead volumes are still listed,
  // greyed: knowing the engines are already gone is worth a line.
  if (aimed) {
    const at = aimSubFor(aimed.id);
    const seen = new Map<number, number>();
    const chips = [
      `<button class="aimc${at < 0 ? ' on' : ''}" data-aim="-1">hull</button>`,
      ...subsOf(aimed.id).map(v => {
        const nth = seen.get(v.kind) ?? 0;
        seen.set(v.kind, nth + 1);
        return `<button class="aimc${v.index === at ? ' on' : ''}${v.dead ? ' gone' : ''}"`
          + `${v.dead ? ' disabled' : ` data-aim="${v.kind}:${nth}"`}>`
          + `${volumeName(aimed.id, v.index)}`
          + `${v.dead ? '' : ` ${Math.round(100 * v.hp / v.hpMax)}%`}</button>`;
      }),
    ].join('');
    rows.push(`<div class="smaim"><span class="k">aim</span>${chips}</div>`);
  }
  for (let i = 0; i < info.mountCount; i++) {
    const m = match.mount(s.cls, i);
    if (!m) continue;
    const here = o.weapons.filter(w => w.weaponIndex === i && w.second === sec);
    const name = `${WEAPON_NAMES[m.key] ?? '?'}${m.batch > 1 ? ` x${m.batch}` : ''}`;
    if (here.length) {
      // Queued here, so this row takes it back. Its own cooldown is not a
      // reason to refuse anything: it is the consequence of this very shot.
      const at = nameOf(here[0]!.targetShip);
      // Where each queued shot is pointed, not where the picker is standing
      // now: a shot keeps the aim point it was queued with.
      const where = here[0]!.targetSub >= 0
        ? volumeName(here[0]!.targetShip, here[0]!.targetSub)
        : '';
      rows.push(
        `<div class="srow on" data-drop="${i}">`
        + `<span class="k">${name}</span>`
        + `<span>at ${at}${where ? `&rsquo;s ${where}` : ''}`
        + `${here.length > 1 ? ` x${here.length}` : ''} &middot; remove</span></div>`);
      continue;
    }
    const block = aimed ? slotBlock(s.id, i, sec, o.weapons) : null;
    const why = !aimed ? 'no target' : block ? slotBlockText(block, sec) : '';
    // Red for a wait, yellow for a plan. Same colours the map uses: a shot
    // already placed is the yellow the tracers are drawn in.
    const tone = block?.kind === 'after' ? ' wait' : block?.kind === 'before' ? ' soon' : '';
    rows.push(
      `<div class="srow${why ? ' off' : ''}${tone}"${why ? '' : ` data-add="${i}"`}>`
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
  menu.querySelectorAll<HTMLElement>('[data-aim]').forEach(el => {
    el.onclick = () => {
      const [kind, nth] = String(el.dataset.aim).split(':').map(Number);
      aim = (kind ?? -1) < 0 ? null : { kind: kind as number, nth: nth ?? 0 };
      refreshAll();
    };
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

/**
 * The whole review panel: which turns exist, which one is aimed at, and what
 * the transport is offering to do with it.
 *
 * Drawn only while the panel is open, because when it is shut none of this is
 * in the document's flow at all.
 */
function renderReview(): void {
  const panel = $('reviewPanel');
  const open = review !== null;
  panel.classList.toggle('hidden', !open);
  const rb = $<HTMLButtonElement>('bReview');
  rb.classList.toggle('on', open);
  rb.disabled = !open && match.history.length === 0;
  rb.title = match.history.length === 0
    ? 'Nothing to watch yet: fight a turn first'
    : open ? 'Close the review and return to the live turn'
    : `Watch turns already fought, all ${match.history.length} of them`;
  // The controls under it step up by exactly this, measured rather than
  // guessed: the panel floats over the canvas, and a control it covers is
  // visible, enabled and swallowing every tap. That is how the fire slots
  // became unreachable on a phone, and it is not happening twice.
  document.documentElement.style.setProperty('--lift',
    open ? `${panel.offsetHeight + 10}px` : '0px');
  if (!open || !review) return;

  const rec = match.history[review.at];
  const last = match.history.length - 1;
  const lastRec = match.history[last];
  const endName = lastRec ? `T${lastRec.turn}` : '--';
  panel.classList.toggle('armed', !watching());
  $('rpTurn').textContent = rec ? `T${rec.turn}` : '--';
  $<HTMLButtonElement>('rpPrev').disabled = review.at <= 0;
  $<HTMLButtonElement>('rpNext').disabled = review.at >= last;

  // Watch becomes Pause once it is running, because the button under the
  // finger has to name what the next press does, not what the last one did.
  const running = watching() && playing;
  const wb = $<HTMLButtonElement>('rpWatch');
  wb.textContent = running && !review.auto ? 'Pause' : 'Watch';
  wb.classList.toggle('on', watching() && !review.auto);
  wb.title = 'Play this one turn';
  const ab = $<HTMLButtonElement>('rpAuto');
  ab.textContent = running && review.auto ? 'Pause' : 'Auto';
  ab.classList.toggle('on', watching() && review.auto);
  ab.title = rec ? `Play from T${rec.turn} through to ${endName}` : '';
  const lb = $<HTMLButtonElement>('rpLive');
  lb.disabled = !watching();
  lb.title = 'Put the live turn back and stop watching';

  const tb = $<HTMLButtonElement>('rpTrail');
  tb.textContent = trailScope === 'off' ? 'Trails' : trailScope === 'turn' ? 'Trail 1' : 'Trail all';
  tb.classList.toggle('on', trailScope !== 'off');
  tb.title = 'Where hulls have been: off, the last turn, or the whole match';
  $('rpHint').textContent = !watching()
    ? 'aimed only: the match has not moved'
    : review.auto ? `auto, running to ${endName}`
    : playing ? 'watching this turn' : 'paused';

  renderTurnStrip();
  // The strip has just changed height, so the lift is re-read from the panel
  // as it now stands rather than as it stood before the chips went in.
  document.documentElement.style.setProperty('--lift', `${panel.offsetHeight + 10}px`);
}

function renderTurnStrip(): void {
  const host = $('turns');
  host.innerHTML = '';
  if (!match.history.length) {
    host.innerHTML = '<span class="hint">no turns resolved yet</span>';
    return;
  }
  for (let i = 0; i < match.history.length; i++) {
    const h = match.history[i];
    if (!h) continue;
    const b = document.createElement('button');
    b.textContent = `T${h.turn}`;
    if (review?.at === i) b.classList.add('on');
    b.onclick = () => aimReview(i);
    host.appendChild(b);
  }
}

function describe(e: SimEvent): { text: string; cls: string } | null {
  /** " engines", or nothing when the shot took the hull rather than a volume. */
  const volume = (shipId: number, index: number) =>
    index < 0 ? '' : ` ${volumeName(shipId, index)}`;
  const who = (i: number) => {
    const s = ships.find(x => x.id === i);
    return s ? shipName(s) : `#${i}`;
  };
  const t = `${(e.tick / 60).toFixed(1)}s `;
  switch (e.kind) {
    case EventKind.ShotFired: return { text: `${t}${who(e.ship)} fires`, cls: '' };
    case EventKind.ShotHit: return { text: `${t}${who(e.other)} hits ${who(e.ship)}${volume(e.ship, e.aux)}`, cls: 'hit' };
    case EventKind.ShotMiss: return { text: `${t}${who(e.ship)} misses`, cls: '' };
    case EventKind.ShotSkippedRange: return { text: `${t}${who(e.ship)} out of range`, cls: 'warn' };
    case EventKind.ShotSkippedArc: return { text: `${t}${who(e.ship)} out of arc`, cls: 'warn' };
    case EventKind.Damage: return { text: `${t}${who(e.ship)} takes ${e.amount.toFixed(1)}`, cls: 'hit' };
    case EventKind.SubsystemDestroyed:
      return { text: `${t}${who(e.ship)}${volume(e.ship, e.aux) || ' subsystem'} destroyed`, cls: 'warn' };
    case EventKind.ShipDrifting: return { text: `${t}${who(e.ship)} adrift`, cls: 'warn' };
    case EventKind.ShipDestroyed: return { text: `${t}${who(e.ship)} destroyed`, cls: 'bad' };
    case EventKind.Collision: return { text: `${t}${who(e.ship)} rams ${who(e.other)} for ${e.amount.toFixed(0)}`, cls: 'bad' };
    case EventKind.BoardingStarted: return { text: `${t}${who(e.other)} sends ${e.aux} marines to ${who(e.ship)}`, cls: 'good' };
    case EventKind.BoardingTick: return { text: `${t}${who(e.ship)} boarding: ${e.amount.toFixed(0)} vs ${e.aux}`, cls: '' };
    case EventKind.ShipCaptured: return { text: `${t}${who(e.ship)} captured`, cls: 'good' };
    case EventKind.ShotSkippedCooldown: return { text: `${t}${who(e.ship)} mount still cooling`, cls: 'warn' };
    case EventKind.ShotSkippedOffline:
      return { text: `${t}${who(e.ship)} has no weapon bay left to fire from`, cls: 'warn' };
    case EventKind.ShipCritical:
      return { text: `${t}${who(e.ship)} REACTOR BREACH`, cls: 'bad' };
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
  // The panel picks which turn the log reads, so the events beside the map are
  // the events of the turn on the map.
  const entry = review ? match.history[review.at] : match.history[match.history.length - 1];
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
  // How it ended goes on the shelf, once. The list offers a finished game to
  // look at rather than to come back to, and a game that never said how it
  // went would sit there looking like it was still waiting for a turn.
  if (over >= 0 && launch.gameId && !endedSaved) {
    endedSaved = true;
    saves.finish(launch.gameId, over === launch.side ? 'won' : 'lost');
  }
  // Watching a past turn is the phase that outranks the rest, because the turn
  // number in the header would otherwise name a turn nobody is looking at.
  const watched = watching() && review ? match.history[review.at] : undefined;
  $('hPhase').textContent = watched
    ? `WATCHING T${watched.turn}${review?.auto ? ' \u00b7 AUTO' : playing ? '' : ' \u00b7 PAUSED'}`
    : over >= 0 ? (over === launch.side ? 'VICTORY' : 'DEFEAT')
    : waiting ? 'COMMITTED'
    : playTick !== null ? 'PLAYBACK'
    : 'PLANNING';
  $<HTMLButtonElement>('bEnd').disabled = over >= 0 || playTick !== null || watching();
  renderReview();
  // Live during playback AND during planning, but they are two states on one
  // control: playback scrubs the turn that was resolved, planning scrubs a
  // preview of the plan. Only the playback one touches playTick, which is the
  // state that used to trap the console.
  const sc = $<HTMLInputElement>('scrub');
  // Three things it can be scrubbing: a turn playing back, a turn the review
  // panel is aimed at, or the plan being written. Only the last one needs the
  // planning gate; a review panel that is open is a turn to move through
  // whether or not it has been played yet.
  sc.disabled = playTick === null && review === null && !canPlan();
  if (playTick === null && canPlan()) sc.value = String(previewTick);
}

function renderHelp(): void {
  $('help').innerHTML =
    '<b>Left drag</b> inside the <span style="color:var(--green)">green outline</span> sets a '
    + 'destination; anywhere else it pans. <b>Middle drag</b> always pans and never '
    + 'touches a plan, whatever is under it. <b>Right drag</b> orbits. Scroll or pinch to zoom.'
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
    + '<span style="color:var(--cyan)">&#10227;</span> button swaps it for orbiting; '
    + '<b>two fingers</b> pan and pinch together, and never touch a plan.<br><br>'
    + '<b>Reading a ship:</b> the chips list what is offline beside each hull, hovering '
    + 'one gives the full state, and <b>i</b> opens its schematic. Zoom in on a ship and '
    + '<b>Ship data</b> appears in the corner of the map, which labels its systems where '
    + 'they are until you move away.';
}

function refreshAll(): void {
  renderFleet();
  renderModes();
  renderTuning();
  renderWeapons();
  renderSlots();
  renderBoard();
  // The turn strip is the review panel's, and `renderHeader` draws the panel,
  // so it is not listed here as well: two callers for one widget is how one of
  // them ends up drawing a state the other has moved on from.
  renderAttitude();
  renderLog();
  renderHeader();
  renderTrails();
  renderInspect();
  refreshSchematic();
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
/**
 * Ask the AI what it means to do, once, for the turn now open.
 *
 * Once and not per frame: the planner is a pure function of the boundary
 * state, that state does not move while a player plans, and a scrub calls
 * `showPreview` per pointer event.
 */
function refreshAiPlans(): void {
  aiPlans = new Map();
  if (match.gameOver >= 0) return;
  for (const s of ships) {
    if (s.destroyed || mine(s)) continue;
    const plan = match.aiPreview(s.id);
    if (plan) aiPlans.set(s.id, plan);
  }
}

function showPreview(): void {
  if (!canPlan()) { view.setGhosts([]); view.setPaths([]); return; }
  // What each hull will fly: my order for mine, the AI's own plan for one it
  // flies. A hostile used to be drawn coasting, because the AI planned during
  // resolution and there was no earlier answer to draw. It plans from the
  // boundary state and writes nothing, so there is one now, and it is the very
  // order the resolver will use rather than a guess at it.
  const orderFor = (s: ShipState): PlannedOrder =>
    mine(s) ? match.order(s.id) : aiPlans.get(s.id) ?? { mode: Mode.Drift, weapons: [] };

  const ghosts = ships
    .filter(s => !s.destroyed && (mine(s) || aiPlans.has(s.id)))
    .map(s => ({
      id: s.id, side: s.side,
      pose: match.previewPose(s.id, orderFor(s), previewTick),
    }))
    .filter((g): g is { id: number; side: number; pose: Pose } => !!g.pose);
  view.setGhosts(ghosts);

  // The dials read the ghost, not the hull. Scrubbing a plan is watching the
  // turn before it happens, so the attitude they report has to be the attitude
  // at the second on screen: the silhouette sat at the turn boundary while the
  // ghost it was meant to describe flew off without it.
  const meGhost = ghosts.find(g => g.id === selected);
  atAttitude = meGhost ? match.attitudeOf(meGhost.pose.quat) : null;
  renderAttitude();

  const paths = ships.filter(s => !s.destroyed).map(s => ({
    id: s.id,
    estimated: !mine(s),
    pts: match.preview(s.id, orderFor(s), 48),
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
    if (mine(e)) continue;
    // The plan for THIS turn where the AI has one, which is what a player
    // wants to know; `aiTarget` on the hull is who it last retaliated against
    // and is the fallback for a hull the AI is not flying.
    const at = posOf(aiPlans.get(e.id)?.aiTarget ?? e.aiTarget);
    if (at) links.push({ from: e.pos, to: at, mine: false });
  }
  view.setAiming(links);

  // And what every hull's TURRETS are following, which is a different list:
  // the aim lines are drawn for the ship being flown and for the hostiles,
  // but a barrel turns on every ship that has an order to shoot at something.
  // Ours from the pick, theirs from what the core says they are retaliating
  // against, so a turret tracks the ship the order set actually names.
  const aims = new Map<number, Vec3>();
  for (const e of live) {
    const at = mine(e)
      ? posOf(targetShip(e.id)?.id ?? -1)
      : posOf(aiPlans.get(e.id)?.aiTarget ?? e.aiTarget);
    if (at) aims.set(e.id, at);
  }
  view.setTurretAim(aims);
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
  // Changing hull drops the inspector: the boxes on screen described the last
  // one, and leaving them up over a different ship is worse than nothing.
  if (id !== selected) setInspect(false);
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
/**
 * Where the two fingers are between them, so a two finger drag can pan.
 *
 * Pinch was reading the gap and throwing the rest away, which made the only
 * way to move the camera on a phone the one finger gesture that the toolbar
 * toggle has to be flipped to reach. Two fingers is what every map on the
 * device does, so it does that here: the gap still zooms, and the midpoint
 * pans, both in the same gesture.
 */
let pinchMid: { x: number; y: number } | null = null;

/** The midpoint of the first two live pointers, or null with fewer than two. */
function twoFingerMid(): { x: number; y: number } | null {
  const [a, b] = [...pointers.values()];
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
}

// The right button is a camera control now, so its menu has to go. Bound on
// the canvas only: a right click on a panel should still behave like the rest
// of the page.
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
// The middle button pans, so the browser's own middle click behaviours (paste
// on X11, the autoscroll puck on Windows) have to be off it. `pointerdown`
// alone does not stop autoscroll in every engine, so the click that follows is
// cancelled as well.
canvas.addEventListener('auxclick', ev => { if (ev.button === 1) ev.preventDefault(); });

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
    pinchMid = twoFingerMid();
    // A second finger cancels whatever the first one had started. Half a move
    // order left under a pinch would finish wherever the fingers happened to
    // end up.
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

  // Middle button is always the camera, panning, and it is decided BEFORE
  // anything that reads the world: not the yaw knob, not a ship under the
  // cursor, not a destination inside the envelope. That order is the whole
  // point of it. Left drag pans too when it starts outside the reachable area,
  // which means the gesture that moves the camera is also the gesture that
  // moves a ship, and near your own hull the difference is a few pixels. The
  // middle button is the one that cannot be wrong.
  if (ev.pointerType === 'mouse' && ev.button === 1) {
    ev.preventDefault();
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false, kind: 'pan' };
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
  // A press that landed on a HULL is about that hull: it names it, and a
  // second one focuses on it. It is never a move order, whatever the
  // reachable area says. A destination under a ship is a destination the
  // player did not mean, and the two are a few pixels apart exactly where
  // their own hull is: clicking your own frigate to look at it planted a move
  // order on top of it every time.
  const p = view.planePoint(ev.clientX, ev.clientY);
  const s = selectedShip();
  let kind: Drag['kind'] = 'pan';
  if (picked >= 0) {
    kind = ev.pointerType !== 'mouse' && !view.panMode ? 'orbit' : 'pan';
  } else if (canPlan() && p && s && view.sliceContains(p)) {
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

  // With the inspector up, a mouse resting on a volume out on the map lights
  // its box. Mouse only: on a phone the box IS the control, and a finger
  // dragging the camera would light every part it crossed.
  if (inspect >= 0 && ev.pointerType === 'mouse' && !prev) {
    const at = view.pickSub(ev.clientX, ev.clientY, subsOf(inspect));
    if (at !== inspectHot) { inspectHot = at; markInspect(); }
  }

  // And a mouse resting on a HULL names the part under it, whosever ship it
  // is. Mouse only and never mid drag: a finger has no hover, and a label
  // chasing a camera gesture is a label in the way of it.
  if (ev.pointerType === 'mouse' && !prev && !drag) showTip(ev.clientX, ev.clientY);
  else if (drag) hideTip();

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
    if (pinchDist > 0 && d > 0) view.zoom(pinchDist / d);
    // The gap zooms and the midpoint pans, out of the one gesture: two fingers
    // that spread while sliding do both, which is what a hand expects from
    // every other map it has ever moved.
    const mid = twoFingerMid();
    if (pinchMid && mid) view.pan(mid.x - pinchMid.x, mid.y - pinchMid.y);
    pinchDist = d;
    pinchMid = mid;
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
  if (pointers.size < 2) { pinchDist = 0; pinchMid = null; }
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
canvas.addEventListener('pointerleave', hideTip);

/**
 * Double click a hull to go and look at it.
 *
 * Centres AND closes, which is what `focusOn` does in one move, and then turns
 * the part labels on, because "look at that ship" and "tell me what is on it"
 * are the same request. Works on a hostile as readily as on your own: reading
 * what an enemy is built out of is how a player decides where to aim, and the
 * inspector already draws whatever hull is selected.
 *
 * A phone has no double click, so the same thing is reachable there through
 * the fleet rail's own button; this is the desk's shortcut for it.
 */
canvas.addEventListener('dblclick', ev => {
  const id = view.pickShip(ev.clientX, ev.clientY);
  if (id < 0) return;
  ev.preventDefault();
  if (id !== selected) select(id);
  const s = ships.find(x => x.id === id);
  if (!s) return;
  view.focusOn(s);
  setInspect(true);
  draw();
});

/**
 * The wheel zooms, over the map AND over anything drawn on top of it.
 *
 * The inspector's labels are a sibling of the canvas rather than a child, so a
 * wheel over one bubbles past the canvas and never reaches this. That is not a
 * cosmetic gap: zooming out is how the inspector is left, so a label sitting
 * where the pointer already is made the way out of the mode dead under the
 * hand. One handler on both surfaces rather than a second copy on the overlay.
 */
const onWheel = (ev: WheelEvent) => {
  ev.preventDefault();
  view.zoom(ev.deltaY > 0 ? 1.1 : 1 / 1.1);
};
canvas.addEventListener('wheel', onWheel, { passive: false });
$('inspect').addEventListener('wheel', onWheel, { passive: false });

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
  if (match.gameOver >= 0 || playTick !== null || watching() || waiting) return;

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
    // A local game persists here, at the one moment its state changed and is
    // known to be worth keeping. Orders only: the match replays from them, so
    // what goes to disk is a few hundred bytes a turn rather than a snapshot.
    if (launch.gameId) {
      const body: Record<string, PlannedOrder> = {};
      for (const [ship, o] of own) body[String(ship)] = o;
      saves.recordTurn(launch.gameId, turn, body);
    }
  }

  waiting = false;
  banner(false);
  readShips();
  view.setShips(ships);
  recordTrails();
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
  route.go(route.LOBBY);
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
$('bInspect').onclick = () => setInspect(inspect < 0);
$('scClose').onclick = closeSchematic;
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
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // A thumb near the middle has no angle worth reading: a pixel of travel
    // there swings the value through a whole turn. Below a fifth of the radius
    // the dial simply waits for the finger to move out.
    if (Math.hypot(dx, dy) < r.width * 0.1) return;
    // Zero is straight up, which is where the ball rests and where a hull's
    // own up points when its wings are level.
    apply(Math.atan2(dx, -dy) * 180 / Math.PI, e);
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
  // Eight, not twelve. Twelve marks round a circle is an hour ring, and with a
  // two part silhouette inside it the whole dial was being read as a clock.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    // Only the quarters are long, so up, down and the two beam ends stand out.
    const long = i % 2 === 0;
    const r0 = long ? 38 : 42;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(Math.sin(a) * r0));
    line.setAttribute('y1', String(-Math.cos(a) * r0));
    line.setAttribute('x2', String(Math.sin(a) * 45));
    line.setAttribute('y2', String(-Math.cos(a) * 45));
    g.appendChild(line);
  }
})();

/**
 * The pitch scale, drawn once.
 *
 * Marked in the units it reports rather than in even slices of a circle: every
 * 20 degrees of climb, long at the multiples of 40, so the ends of the arc are
 * the clamp the dial actually enforces and the middle one is level.
 */
(() => {
  const g = $('atPitchTicks');
  for (let p = -80; p <= 80; p += 20) {
    const a = (p * Math.PI) / 180;
    const long = p % 40 === 0;
    const r0 = long ? 38 : 42;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(Math.cos(a) * r0));
    line.setAttribute('y1', String(-Math.sin(a) * r0));
    line.setAttribute('x2', String(Math.cos(a) * 45));
    line.setAttribute('y2', String(-Math.sin(a) * 45));
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
  // While a turn plays back the hull is posed from the recorded track, so the
  // dials read THAT rather than the turn boundary: a silhouette frozen at the
  // start of a turn is not showing the roll being flown in front of it.
  const now = atAttitude ? atAttitude.forward : match.forward(s.id);
  // Playing back a resolved turn there is no order left to command, so the
  // bright needle follows the hull. While planning the order is exactly what
  // the bright needle is for, even though the dim one now moves with the scrub.
  const spent = playTick !== null;
  const cmd = spent ? now : (standingFace.get(s.id) ?? match.order(s.id).face ?? now);
  const climb = (v: Vec3) => (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
  const rollNow = ((atAttitude ? atAttitude.roll : match.rollOf(s.id)) * 180) / Math.PI;
  const rollCmd = spent ? rollNow * Math.PI / 180
    : (standingRoll.get(s.id) ?? match.order(s.id).roll);
  const rollDeg = rollCmd === undefined ? rollNow : (rollCmd * 180) / Math.PI;

  // Both start upright, where a hull's own up is world up, so a roll turns
  // them by the roll itself. Positive, NOT negated: a drag reads its angle
  // clockwise from twelve and an SVG rotate turns clockwise too, so negating
  // put the ball on the opposite side of the dial from the finger that had
  // just placed it. The value was right and the picture was mirrored.
  $('atRollNow').setAttribute('transform', `rotate(${rollNow.toFixed(2)})`);
  $('atRollCmd').setAttribute('transform', `rotate(${rollDeg.toFixed(2)})`);
  $('atRollV').textContent = `${Math.round(rollDeg)}`;
  $('atRoll').setAttribute('aria-valuenow', String(Math.round(rollDeg)));

  // The pitch hull and its needle start pointing along +X, so a climb rotates
  // them the other way: on screen up is negative y.
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

// The one always visible entry point. Everything else about reviewing lives
// inside the panel it opens.
$('bReview').onclick = () => { if (review) closeReview(); else openReview(); };
$('rpClose').onclick = closeReview;
$('rpPrev').onclick = () => { if (review) aimReview(review.at - 1); };
$('rpNext').onclick = () => { if (review) aimReview(review.at + 1); };
// Watch and Auto are the same act aimed at the same turn, differing only in
// whether the end of it runs on. Pressing either while it is already running
// that way pauses, so one button says both what it will do and what it is
// doing.
const transport = (auto: boolean) => () => {
  if (!review) return;
  if (watching() && review.auto === auto && playing) { playing = false; renderHeader(); return; }
  if (watching() && review.auto === auto && playTick !== null) {
    review.auto = auto; playing = true; renderHeader(); return;
  }
  watchTurn(review.at, auto);
  refreshAll();
};
$('rpWatch').onclick = transport(false);
$('rpAuto').onclick = transport(true);
$('rpLive').onclick = () => { backToLive(); refreshAll(); };
$('rpTrail').onclick = () => {
  trailScope = trailScope === 'turn' ? 'all' : trailScope === 'all' ? 'off' : 'turn';
  refreshAll();
};
$('bSpeed').onclick = () => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  $('bSpeed').textContent = `${speed}x`;
};

const scrub = $<HTMLInputElement>('scrub');
/**
 * Was the turn actually running when this drag started?
 *
 * Releasing has to resume a playback the player paused by grabbing it, and
 * hold one they scrubbed into from a standstill. Read at the START of the
 * gesture, because the input handler has already set `playing` to false by
 * the time the release is heard.
 */
let scrubResumes = false;
const armScrub = () => { scrubResumes = playing && playTick !== null; };
scrub.addEventListener('pointerdown', armScrub);
scrub.addEventListener('keydown', armScrub);
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
  // A turn the review panel is AIMED at is a turn the scrubber can move
  // through, without pressing Watch first. Watch was the only way in, so the
  // scrubber sat there enabled and inert over a turn the panel was already
  // pointing at, and the only way to look at a moment was to play the whole
  // thing and catch it. Scrubbing into it enters it PAUSED, which is what a
  // scrubber means: this frame, held, not this frame and then off again.
  if (playTick === null && review) {
    watchTurn(review.at, review.auto);
    playing = false;
  }
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
  // Releasing resumes the turn that was already RUNNING, and holds one the
  // scrubber walked into. Resuming either would mean a player who dragged to
  // second four to look at it got the rest of the turn played at them.
  if (watching() && !scrubResumes) return;
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

/** The turn whose track and events are on screen: the one being watched in
 * the review panel, else the one just resolved. */
function shownRecord(): typeof match.history[number] | undefined {
  return match.history[shownIndex()];
}

/** Which turn record is on screen, as an index into the history. */
function shownIndex(): number {
  return watching() && review ? review.at : match.history.length - 1;
}

function showTick(tick: number): void {
  const poses = match.poses(tick);
  view.setPoses(poses);
  // The dials follow the hull through the turn rather than sitting at the
  // attitude it started from. Asked of the core per tick, because forward and
  // wings level are its conventions and a renderer holding a second opinion
  // about either is how two clients start disagreeing.
  const me = poses.find(p => p.id === selected && !p.destroyed);
  atAttitude = me ? match.attitudeOf(me.quat) : null;
  renderAttitude();
  view.setProjectiles(match.trackProjectiles(tick));

  // Beams last one tick in the simulation, so what is on screen is drawn from
  // the event stream for the tick being shown rather than kept as an object.
  // Blasts come off the same stream. Both carry an age, so both can be
  // scrubbed backwards.
  const events = shownRecord()?.events ?? [];
  view.setBeams(events
    .filter(e => e.kind === EventKind.ShotFired
                 && tick >= e.tick && tick < e.tick + BEAM_TICKS)
    .map(e => {
      const end = beamEnd(e, events);
      return {
        from: e.pos, to: end.to, hit: end.hit,
        centre: end.centre, ship: end.ship,
        age: (tick - e.tick) / BEAM_TICKS,
      };
    }));
  view.setBlasts(blastsAt(events, tick));
  // What the turn has taken off each hull, and the chunks still in the air.
  // Both are drawn from the same event stream, so scrubbing back puts the
  // cells back and a re-watch throws the same debris.
  // One monotone axis for the whole match, so a scar from turn three is still
  // there in turn four and scrubbing backwards puts cells back: a turn index
  // and a tick inside it, which the view compares against the same number.
  view.setDamage(carveHistory(), shownIndex() * TICKS_PER_TURN + tick);

  // The tail past the end of the turn is effects finishing, not time passing,
  // so the scrubber and the clock both stop at the turn's own length.
  const shown = Math.min(TICKS_PER_TURN, tick);
  scrub.value = String(shown);
  $('hSec').textContent = (shown / 60).toFixed(1);
}

/**
 * How far past the end of a turn its playback has to run for every effect to
 * finish, in ticks.
 *
 * A hull killed at second 9.5 used to be a flash and a cut: the turn ended at
 * 600 and took the fireball with it, and in a battle replay the next turn
 * started over the top of it. So playback holds at the final pose for exactly
 * as long as something is still burning, and not one tick longer when nothing
 * is.
 */
function tailFor(events: readonly SimEvent[]): number {
  let need = 0;
  for (const e of events) {
    const life = e.kind === EventKind.ShipDestroyed || e.kind === EventKind.Collision ? KILL_TICKS
      : e.kind === EventKind.ShotHit ? HIT_TICKS
      : e.kind === EventKind.ShotFired ? BEAM_TICKS
      : 0;
    if (life) need = Math.max(need, e.tick + life - TICKS_PER_TURN);
  }
  return Math.max(0, Math.min(FX_TICKS, need));
}

/**
 * Keep the track the turn that just resolved was flown along.
 *
 * Taken from the core's own poses, once, rather than re-derived whenever the
 * overlay is drawn: the track is a fact about a turn that has happened, and
 * asking again per frame would be several hundred boundary crossings to be
 * told the same thing.
 */
function recordTrails(): void {
  const turn = match.history.length - 1;
  if (turn < 0) return;
  const leg = new Map<number, Vec3[]>();
  for (let t = 0; t <= TICKS_PER_TURN; t += TRAIL_STEP) {
    for (const p of match.poses(t)) {
      // A wreck's track stops where it died rather than running on.
      if (p.destroyed) continue;
      let pts = leg.get(p.id);
      if (!pts) leg.set(p.id, pts = []);
      pts.push(p.pos);
    }
  }
  for (const [id, points] of leg) {
    let byShip = trails.get(id);
    if (!byShip) trails.set(id, byShip = []);
    // Keyed by turn rather than pushed, because a ship that dies stops adding
    // legs and its list would otherwise stop lining up with the turn numbers.
    byShip.push({ turn, points });
  }
}

/**
 * Watch the whole match back, from the records rather than from a second copy
 * of what happened.
 *
 * Each turn is restored from the snapshot it began at and resolved again in
 * place, which is the same thing `replay` does to check a hash, so the track
 * on screen is the core re-flying the turn rather than a recording of pixels.
 * It costs one resolve per turn, about half a millisecond each.
 *
 * The live world is stashed first and put back when it ends, however it ends.
 */
/** Open the panel, aimed at the turn just fought, without moving the match. */
function openReview(): void {
  if (match.history.length === 0) return;
  // A bottom sheet and this panel both want the bottom of a phone, and the one
  // that loses is the one whose taps land somewhere else. The sheet goes down.
  for (const id of ['left', 'right']) $(id).classList.remove('open');
  for (const id of ['tShips', 'tLog']) {
    $(id).classList.remove('on');
    $(id).setAttribute('aria-pressed', 'false');
  }
  review = { at: match.history.length - 1, auto: false, live: null };
  refreshAll();
}

/** Shut the panel. Whatever it was watching, the live turn comes back first. */
function closeReview(): void {
  if (!review) return;
  backToLive();
  review = null;
  refreshAll();
}

/**
 * Aim the transport at another recorded turn.
 *
 * If a turn is already being watched this jumps to that one and keeps playing,
 * so stepping the picker mid replay does what it looks like it does. If the
 * panel is only open, it re aims and nothing else: the match has not moved and
 * the plan being written is still there.
 */
function aimReview(index: number): void {
  if (!review || !match.history[index]) return;
  const wasWatching = watching();
  const auto = review.auto;
  review.at = index;
  if (wasWatching) watchTurn(index, auto);
  else refreshAll();
}

/**
 * Restore the world to the start of a recorded turn and re-fly it.
 *
 * Each turn is restored from the snapshot it began at and resolved again in
 * place, which is the same thing `replay` does to check a hash, so the track on
 * screen is the core re-flying the turn rather than a recording of pixels. It
 * costs one resolve per turn, about half a millisecond each.
 *
 * The live world is stashed on the first restore and put back by `backToLive`,
 * however the watching ends.
 */
function watchTurn(index: number, auto: boolean): void {
  const rec = match.history[index];
  if (!review || !rec) { closeReview(); return; }
  if (review.live === null) {
    const live = match.snapshot();
    if (!live) return;
    review.live = live;
  }
  if (!match.restore(rec.before)) { backToLive(); refreshAll(); return; }
  match.resolveInPlace(rec.orders);
  review.at = index;
  review.auto = auto;
  readShips();
  view.setShips(ships);
  playTick = 0;
  playing = true;
  showTick(0);
  renderTrails();
  renderHeader();
}

/**
 * Put the live world back, leaving the panel open and still aimed where it was.
 *
 * Separate from closing on purpose: the common move after watching a turn is to
 * watch another one, and having to reopen the panel to do it is a tax.
 */
function backToLive(): void {
  if (!review || review.live === null) return;
  match.restore(review.live);
  review.live = null;
  review.auto = false;
  playTick = null;
  playing = false;
  view.setBeams([]);
  view.setBlasts([]);
  view.setProjectiles([]);
  readShips();
  view.setShips(ships);
  view.setSelection(selected);
  atAttitude = null;
  refreshAiPlans();
  view.invalidateEnvelope();
  planTurnEnvelopes();
}

/** Draw as much of that history as the scope asks for. */
function renderTrails(): void {
  const upTo = watching() && review ? review.at : match.history.length - 1;
  if (trailScope === 'off' || upTo < 0) { view.setTrails([]); return; }
  // While a past turn is being watched, show only what had happened by it on
  // screen: a track running ahead of the playback spoils the thing being
  // watched.
  const first = trailScope === 'all' ? 0 : upTo;
  const out = [];
  for (const [id, legs] of trails) {
    const side = ships.find(s => s.id === id)?.side ?? 0;
    for (const leg of legs) {
      if (leg.turn < first || leg.turn > upTo) continue;
      out.push({ points: leg.points, side, age: upTo - leg.turn });
    }
  }
  view.setTrails(out);
}

/**
 * Which blasts are burning at this tick, and how far through each is.
 *
 * Derived rather than spawned, so scrubbing back through a kill runs it
 * backwards and holding on a tick holds the flame where it was.
 */
/**
 * Where each hit landed on the hull it hit, in that hull's own space.
 *
 * Worked out once per turn record rather than per tick: it costs a pose lookup
 * per event, and a playback asks sixty times a second. The pose is the one the
 * ship was in AT THE TICK, because a hull that has moved on since is a hull
 * whose scar would be in the wrong place.
 */
const carveCache = new WeakMap<object, HullHit[]>();

/**
 * Every hit of the match so far, on the one axis the view scrubs along.
 *
 * A hull shot to pieces in turn three is still in pieces in turn four, so the
 * carve cannot be a function of the turn on screen alone. Turns before the one
 * being watched contribute all of their hits; the one being watched
 * contributes the hits up to the tick.
 */
let carveAll: { upTo: number; len: number; list: HullHit[] } | null = null;
function carveHistory(): HullHit[] {
  const upTo = shownIndex();
  // Rebuilt when the turn on screen changes, not sixty times a second: the
  // list is the same list all the way through a turn.
  if (carveAll && carveAll.upTo === upTo && carveAll.len === match.history.length) {
    return carveAll.list;
  }
  const list: HullHit[] = [];
  for (let n = 0; n <= upTo && n < match.history.length; n++) {
    const rec = match.history[n];
    if (!rec) continue;
    for (const h of carveHits(rec)) list.push({ ...h, tick: n * TICKS_PER_TURN + h.tick });
  }
  carveAll = { upTo, len: match.history.length, list };
  return list;
}

function carveHits(rec: { events: readonly SimEvent[] } | null | undefined): HullHit[] {
  if (!rec) return [];
  const found = carveCache.get(rec);
  if (found) return found;
  const out: HullHit[] = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const e of rec.events) {
    const kill = e.kind === EventKind.ShipDestroyed || e.kind === EventKind.ShipCritical;
    if (!kill && e.kind !== EventKind.ShotHit && e.kind !== EventKind.Collision) continue;
    if (e.ship < 0) continue;
    const pose = match.poses(e.tick).find(p => p.id === e.ship);
    if (!pose) continue;
    q.set(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w).invert();
    v.set(e.pos.x - pose.pos.x, e.pos.y - pose.pos.y, e.pos.z - pose.pos.z).applyQuaternion(q);
    out.push({
      ship: e.ship,
      local: [v.x, v.y, v.z],
      // Where the shot MET the hull, not the point on the collision sphere the
      // event carries. The blast was moved onto the hull and the debris was
      // left behind on the sphere, so chunks came off a couple of units away
      // from the explosion that threw them. One contact, both users of it.
      world: contactWorld(e).pos,
      tick: e.tick,
      // A kill opens the hull up; a shot takes a bite out of it.
      radius: kill ? 2.2 : e.kind === EventKind.Collision ? 1.1 : 0.55,
    });
  }
  carveCache.set(rec, out);
  return out;
}

/**
 * Where a hit event actually MET the hull, in world space.
 *
 * The event carries a point on the ship's collision SPHERE, which circumscribes
 * the long axis: on a Terran it is 3.29 units against a hull 1.2 by 0.76 by
 * 3.2, so a hit abeam lands about two units off the flank in open space. That
 * is why an explosion hung beside the ship instead of on it. The core cannot
 * answer this, because the core has a sphere and boxes; only the client has the
 * hull, and it already had to solve it for the carve.
 *
 * Resolved in the hull's OWN space and put back through the pose the ship held
 * at the tick of the hit, so a blast stays where it happened rather than
 * following the ship that took it. Memoised per event, because a blast is
 * rebuilt every frame it is on screen and the search walks a hull's cells.
 */
interface Contact {
  readonly pos: Vec3;
  /** Where the ship's centre was at the tick of the hit.
   *
   *  A blast stays in the world where it happened while the ship flies on, so
   *  "is this drawn on the hull" can only be asked against the pose the ship
   *  held AT the hit. Measuring it against where the ship is now says a blast
   *  drifted off the hull when all that happened is the ship left. */
  readonly centre: Vec3;
  /** False when the hull could not be consulted and this fell back to the raw
   *  event, which is the point on the collision SPHERE. */
  readonly resolved: boolean;
}
const contactCache = new WeakMap<object, Contact>();
function contactWorld(e: SimEvent): Contact {
  const had = contactCache.get(e as unknown as object);
  if (had) return had;
  let out: Contact = { pos: e.pos, centre: e.pos, resolved: false };
  const pose = e.ship >= 0 ? match.poses(e.tick).find(p => p.id === e.ship) : undefined;
  if (pose) {
    const q = new THREE.Quaternion(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);
    const v = new THREE.Vector3(
      e.pos.x - pose.pos.x, e.pos.y - pose.pos.y, e.pos.z - pose.pos.z)
      .applyQuaternion(q.clone().invert());
    const local = view.contactOf(e.ship, [v.x, v.y, v.z]);
    const centre = { x: pose.pos.x, y: pose.pos.y, z: pose.pos.z };
    if (local) {
      const w = new THREE.Vector3(local[0], local[1], local[2])
        .applyQuaternion(q).add(new THREE.Vector3(pose.pos.x, pose.pos.y, pose.pos.z));
      out = { pos: { x: w.x, y: w.y, z: w.z }, centre, resolved: true };
    } else {
      out = { pos: e.pos, centre, resolved: false };
    }
  }
  contactCache.set(e as unknown as object, out);
  return out;
}

/**
 * Where a beam stops.
 *
 * The core fires from the mount to the weapon's full RANGE and reports the hit
 * as a separate event, so a beam that struck at eight units was still drawn out
 * to three hundred, straight through the target and away. A hit is exactly on
 * the fired segment, which is what makes the pairing sound: same tick, this
 * ship as the shooter, and the point sits on this shot's line rather than on
 * another mount's, which is what tells two shots in one tick apart.
 */
function beamEnd(fired: SimEvent, events: readonly SimEvent[])
  : { to: Vec3; hit: boolean; centre?: Vec3; ship?: number } {
  const ax = fired.pos.x, ay = fired.pos.y, az = fired.pos.z;
  const dx = fired.to.x - ax, dy = fired.to.y - ay, dz = fired.to.z - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 <= 0) return { to: fired.to, hit: false };
  let best: SimEvent | null = null, bestT = Infinity;
  for (const e of events) {
    if (e.kind !== EventKind.ShotHit || e.tick !== fired.tick) continue;
    if (e.other !== fired.ship) continue;
    const px = e.pos.x - ax, py = e.pos.y - ay, pz = e.pos.z - az;
    const t = (px * dx + py * dy + pz * dz) / len2;
    if (t < 0 || t > 1.001) continue;
    const ox = px - dx * t, oy = py - dy * t, oz = pz - dz * t;
    if (ox * ox + oy * oy + oz * oz > 0.25) continue;
    if (t < bestT) { bestT = t; best = e; }
  }
  // A MISS is drawn to full range, and correctly so: nothing stopped it. Only
  // a beam that hit something has anywhere shorter to stop, which is why the
  // two are told apart rather than judged by length.
  if (!best) return { to: fired.to, hit: false };
  const c = contactWorld(best);
  return { to: c.pos, hit: true, centre: c.centre, ship: best.ship };
}

function blastsAt(events: readonly SimEvent[], tick: number)
  : Array<{
    pos: Vec3; age: number; radius: number; kill: boolean; ship: number;
    centre: Vec3; resolved: boolean;
  }> {
  const out = [];
  for (const e of events) {
    const kill = e.kind === EventKind.ShipDestroyed || e.kind === EventKind.Collision;
    if (!kill && e.kind !== EventKind.ShotHit) continue;
    const life = kill ? KILL_TICKS : HIT_TICKS;
    const age = (tick - e.tick) / life;
    if (age < 0 || age > 1) continue;
    const hull = ships.find(x => x.id === e.ship)?.radius ?? 2;
    // A kill is the whole ship going up and belongs on its centre; a shot
    // belongs where it landed, which is not where the event says it did.
    const c = kill ? null : contactWorld(e);
    out.push({
      pos: c ? c.pos : e.pos,
      age,
      radius: kill ? hull : Math.max(0.5, hull * 0.28),
      kill,
      ship: e.ship,
      centre: c ? c.centre : e.pos,
      resolved: c ? c.resolved : true,
    });
  }
  return out;
}

/**
 * One frame.
 *
 * The next frame is booked in a `finally`, so nothing inside can stop the
 * clock. It used to be the last statement, and the battle replay returned
 * early from the middle of this function to move to the next turn: that return
 * skipped the booking and the loop simply stopped. Everything froze, not just
 * the replay, and because `playing` was still true and the tick still had a
 * value the console looked busy rather than dead. An exception anywhere in
 * here would have done the same, which is why the fix is the `finally` rather
 * than deleting two returns.
 */
function frame(): void {
  try {
    frameBody();
  } finally {
    requestAnimationFrame(frame);
  }
}

function frameBody(): void {
  view.resize();
  probeEnvelopeIfWanted();
  if (playTick !== null && playing) {
    const end = TICKS_PER_TURN + tailFor(shownRecord()?.events ?? []);
    playTick = Math.min(end, playTick + speed);
    showTick(playTick);
    if (playTick >= end) {
      // Auto runs on to the next recorded turn rather than handing the console
      // back, and stops at the last turn actually fought: the one being planned
      // has no record to fly.
      if (watching() && review) {
        if (review.auto && review.at + 1 < match.history.length) {
          watchTurn(review.at + 1, true);
          return;
        }
        // Watching one turn ends on its last frame rather than snapping back,
        // so the thing being reviewed is still on screen to look at. The world
        // is only put down by Live or by closing the panel.
        playing = false;
        renderHeader();
        return;
      }
      playing = false;
      playTick = null;
      view.setBeams([]);
      view.setBlasts([]);
      view.setProjectiles([]);
      readShips();
      view.setShips(ships);
      if (!ships.some(s => s.id === selected && !s.destroyed)) {
        selected = ships.find(s => mine(s) && !s.destroyed)?.id ?? selected;
      }
      view.setSelection(selected);
      atAttitude = null;
      restoreFacing();
      refreshAiPlans();
      view.invalidateEnvelope();
      planTurnEnvelopes();
      refreshAll();
    }
  }
  // The camera moves without anything else happening, so what the inspector
  // offers is settled per frame rather than per refresh. `renderInspect` only
  // rebuilds when its own contents changed; the boxes are placed every frame,
  // because the hull under them is moving.
  renderInspect();
  view.render();
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
    /** Where the next shot is pointed on the CURRENT target, or -1 for hull. */
    aimSub: () => { const t = targetShip(); return t ? aimSubFor(t.id) : -1; },
    aimKind: () => (aim ? aim.kind : -1),
    /** Every turret's bearing on the map, so the harness can watch one swing
     *  onto a target rather than reading the code that swings it. */
    turrets: () => view.turretState(),
    /** What is under a screen point, and what the label on it says. Reading
     *  only: the harness never writes through this. */
    partAt: (x: number, y: number) => view.pickHullCell(x, y),
    tip: () => ({
      ship: tipShip, rig: tipRig, cell: tipCell,
      shown: !$('partTip').classList.contains('hidden'),
      text: $('partTip').textContent ?? '',
    }),
    arcs: () => view.arcShellCount(),
    subs: () => subs.map(v => ({ ...v })),
    /** Where the selected hull's nose actually points, for checking that a
     * commanded heading is being turned INTO over several turns. */
    forward: () => (selected < 0 ? null : match.forward(selected)),
    /** Whether a screen point lands on the map's yaw knob. Observation only,
     * and the same test the pointer router runs. */
    onYawKnob: (x: number, y: number) => view.onYawKnob(x, y),
    playing: () => playTick,
    /** Whether playback is advancing, as against paused on a tick. */
    running: () => playing,
    side: () => launch.side,
    kind: () => launch.kind,
    // Observation only, like everything else here. A harness that could WRITE
    // state would stop testing the app and start testing itself.
    scenario: () => launch.scenario,
    shipCount: () => match.shipCount,
    wells: () => match.wells(),
    paths: () => view.pathStats(),
    ghosts: () => view.ghostCount(),
    /** Every hull's position right now, for checking a preview against what
     * the turn actually did. */
    poses: () => ships.map(s => ({ id: s.id, side: s.side, destroyed: s.destroyed, pos: s.pos })),
    /** Where a hull actually IS on screen right now, taken from the mesh.
     *  `poses` is the world the console last read and stands still through a
     *  playback; this is what the player is looking at, which is the only
     *  thing a camera lock can be checked against. */
    drawn: (id: number) => {
      const p = view.poseOf(id);
      return p ? { x: p.pos.x, y: p.pos.y, z: p.pos.z } : null;
    },
    /** Where a ship is on screen, so a harness can aim at one. */
    screenOf: (id: number) => {
      const s = ships.find(x => x.id === id);
      return s ? view.screenOf(s.pos) : null;
    },
    /** What the camera is doing and what is drawn over the ship. */
    camera: () => view.cameraState(),
    /** What has been shot off the hulls, and what is still in the air. */
    damage: () => view.damageState(),
    /** What the hulls are drawn WITH: material, finish, and whether the
     *  texture has pixels. A finish that never loaded draws exactly like one
     *  that was never applied. */
    surfaces: () => view.surfaces(),
    /** What the hulls cost to draw, and a switch to weigh it against. */
    hullQuads: () => view.hullQuads(),
    hullsVisible: (on: boolean) => view.hullsVisible(on),
    /** Who is in the match and what they are flying. */
    ships: () => ships.map(s => ({ id: s.id, side: s.side, cls: s.cls, hull: s.hull })),
    /** What the effects layer is drawing right now, and how far the biggest
     * blast has grown, so "bigger and more visible" is a measurement. */
    fx: () => view.fxStats(),
    // What the renderer settled on: whether the sky baked, which post path is
    // running and why, and the rig that lights the field. OBSERVE only, like
    // everything else here.
    post: () => view.postState(),
    lights: () => view.lightState(),
    backdrop: () => view.backdropState(),
    forceQuality: (q: 'bloom' | 'plain') => view.forceQuality(q),
    /** Which recorded turn is being WATCHED, or null when none is: the panel
     * being open and aimed is not the same thing as a past world being on
     * screen, and a harness that conflated them would pass on a review that
     * never played. */
    battle: () => (watching() && review ? review.at : null),
    /** The review panel: whether it is open, what it is aimed at, and whether
     * that turn is actually loaded. */
    review: () => (review ? { at: review.at, auto: review.auto, watching: watching() } : null),
    /** The selected hull's attitude at the tick on screen while a turn plays,
     * so a harness can watch the dials follow it. */
    attitude: () => atAttitude,
    /** What the AI means to do this turn, by ship id. */
    aiPlans: () => [...aiPlans].map(([id, p]) => ({ id, mode: p.mode, target: p.target ?? null,
                                                    aiTarget: p.aiTarget })),
    /** The last tick this turn's playback runs to: the turn's own length plus
     * whatever tail its effects still need. */
    playEnd: () => TICKS_PER_TURN + tailFor(shownRecord()?.events ?? []),
    trailScope: () => trailScope,
    /** Turn index and event kinds only: enough to find a kill, not a second
     * copy of the match. */
    history: () => match.history.map(h => ({
      turn: h.turn,
      events: h.events.map(e => ({ kind: e.kind, tick: e.tick, ship: e.ship })),
    })),
    /** How far the selected hull's reachable volume has sharpened, so a
     * harness can see that a heading under a finger is not re-probing it and
     * that letting go finishes the ladder. */
    envelope: () => (selected < 0 ? null : view.shellProgress(selected)),
    canPlan,
    /** The shipyard, read only. */
    designer: () => (designer.visible ? designer.debug() : null),
    /** The schematic modal: what it is describing, or null when it is down. */
    schematic: () => (schematic.visible ? schematic.debug() : null),
    /** The map inspector: which hull it is labelling, whether it may be
     *  offered at this zoom, and which volume the pointer is on. */
    inspect: () => ({ ship: inspect, ready: inspectReady(), hot: inspectHot }),
  },
});

const api = new Api();
const lobby = new Lobby(api, (l: Launch) => {
  launch = l;
  seed = l.seed;
  start();
  // The game is up, so the address says so. `shownRoute` is set FIRST: this
  // navigation is the consequence of a screen change rather than the cause of
  // one, and letting the router act on it would start the same game again.
  if (l.gameId) {
    const r: route.Route = { kind: 'play', gameId: l.gameId };
    shownRoute = route.href(r);
    route.go(r);
  }
});

// The shipyard sits over the lobby rather than replacing it, so closing it
// puts the player back where they opened it from.
const designer = new Designer(() => {
  if (route.current().kind === 'ship') route.go(route.LOBBY);
  else if (!lobby.visible) lobby.show();
});
$('bShipyard').onclick = () => { route.go({ kind: 'ship' }); };

// The seam between the shipyard and the library. The editor knows nothing
// about the network and the lobby knows nothing about hulls; this is the one
// place that knows both.
designer.onSave(async req => {
  const saved = req.designId
    ? await api.updateDesign(req.designId, {
      name: req.name, design: req.design,
      mass: req.mass, hull: req.hull, legal: req.legal,
    })
    : await api.saveDesign({
      name: req.name, design: req.design, from: req.from,
      mass: req.mass, hull: req.hull, legal: req.legal,
    });
  void lobby.refreshLibrary();
  return { designId: saved.designId, name: saved.name, mine: true, owner: saved.owner.name };
});

// What a level seats, asked of the core so the briefing describes the match
// that is about to be played rather than a second copy of the rosters. Side 0
// only, which is the seat practice puts a player in: the list is what YOU are
// choosing hulls for, and offering a hull for a ship you do not fly would be a
// control that does nothing.
lobby.onRoster(scenario => {
  const id = SCENARIO_BY_NAME[scenario] ?? Scenario.Skirmish;
  // BOTH sides. Picking what you fight is half of setting up a fight, and the
  // core's registry was always per side; it was the screen that only offered
  // one of them.
  return match.roster(id);
});

lobby.onOpenDesign(d => {
  // Push the design's own address, so the editor a player is in is a place
  // they can reload into and a link they can send.
  route.go({ kind: 'ship', designId: d.designId });
  designer.show();
  designer.loadDesign(d.design as Design, {
    designId: d.designId, name: d.name, mine: d.mine, owner: d.owner.name,
  });
});

// The lobby says where it went; this puts it in the address bar. One decision
// about which screen has which path, in one place.
lobby.onWhere(where => {
  const want: route.Route = where.room ? { kind: 'room', roomId: where.room } : route.LOBBY;
  if (route.same(route.current(), want)) return;
  // Same reason as above: the lobby has already moved, and this is only the
  // address catching up. Acting on it would join the room a second time.
  shownRoute = route.href(want);
  route.go(want, { replace: true });
});

/**
 * Put the screen where the URL says.
 *
 * Every entry point goes through here: the first load, a Back press, and every
 * in app navigation, because `go` calls this too. That is what keeps the
 * address and the screen from ever being two different opinions.
 *
 * A route that names something gone (a save that was forgotten, a room that
 * closed) falls back to the lobby and REWRITES the address, rather than
 * leaving a player looking at a list with an address that promises a game.
 */
let shownRoute = '';
async function showRoute(r: route.Route): Promise<void> {
  const key = route.href(r);
  if (key === shownRoute) return;
  shownRoute = key;

  if (r.kind !== 'ship') designer.hide();
  if (r.kind !== 'play' && r.kind !== 'room') {
    // Leaving a game: the match stays in the module, but the screen over it
    // goes, and the lobby is the thing behind it.
    closeSchematic();
  }

  switch (r.kind) {
    case 'play': {
      if (lobby.resume(r.gameId)) return;
      route.go(route.LOBBY, { replace: true });
      return;
    }
    case 'room': {
      if (await lobby.openRoom(r.roomId)) return;
      route.go(route.LOBBY, { replace: true });
      return;
    }
    case 'ship': {
      if (!r.designId) { designer.show(); lobby.show(); return; }
      // Straight to a design by id, which is what a reload on `/ship/<id>`
      // has to do: the library row it came from may not even be loaded yet.
      try {
        const d = await api.getDesign(r.designId);
        designer.show();
        designer.loadDesign(d.design as Design, {
          designId: d.designId, name: d.name, mine: d.mine, owner: d.owner.name,
        });
      } catch {
        designer.show();
      }
      lobby.show();
      return;
    }
    default:
      lobby.show();
  }
}

// Back, Forward, and every `go` above. `showRoute` is idempotent on the route
// it is already showing, which is what makes it safe to call from both.
route.onRoute(r => { void showRoute(r); });

renderHelp();
frame();
// Sign in first so the lobby knows who it is, then go wherever the address
// says. A reload on a game lands back in the game.
void lobby.signIn().then(() => {
  lobby.show();
  void showRoute(route.current());
});
