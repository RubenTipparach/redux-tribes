/**
 * The lobby: who you are, what rooms exist, and getting seated in one.
 *
 * A full screen layer over the console rather than a separate page. The wasm
 * is already instantiated behind it, so entering a match is a class change
 * rather than a navigation, and leaving one does not pay to load the game
 * again.
 *
 * It polls as well as listening on a socket. Everything the socket announces
 * is the side effect of a request someone made, so polling reaches the same
 * state; a lobby that only works with a live socket is a lobby that looks
 * broken on a flaky connection.
 */

import { Api, ApiError, type Room, type SavedDesign, type Ticket } from '../net/api.js';
import { CLASS_NAMES, classIndexOf } from '../sim/types.js';
import { newId } from './route.js';
import * as saves from './saves.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** How a match was entered, which decides how its turns are resolved. */
export interface Launch {
  readonly kind: 'offline' | 'served';
  /**
   * The save this game is filed under, for an offline one.
   *
   * Present from the moment it starts rather than minted on the first turn: a
   * game refreshed before its first turn resolves is still a game somebody
   * started, and it should be there when they come back.
   */
  readonly gameId?: string;
  /** Turns already played, replayed on top of the fresh match to get back to
   *  where the save left off. */
  readonly resume?: ReadonlyArray<Record<string, unknown>>;
  readonly seed: string;
  readonly scenario: string;
  /** Bit per side: set means a person plays it. */
  readonly humanSides: number;
  /** Which side this client sits in. */
  readonly side: number;
  /**
   * The design each of this side's ships fields, by SLOT, or null for the hull
   * the scenario authored. The whole record, not its class: the core derives
   * what it weighs, what it can take and how it flies from the parts and the
   * plate.
   *
   * A list rather than one design, because a player swapping one hull out of a
   * pair is not asking for two of it. Slot n is the nth ship this side seats,
   * which is the order the roster reports and the order the core fills.
   */
  readonly hulls?: ReadonlyArray<{
    /** Which side fields it. Both are pickable: a level is an engagement to
     *  set up, not just a seat to sit in. */
    readonly side: number;
    /** Which of that side's ships, in spawn order. */
    readonly slot: number;
    readonly design: unknown;
    readonly name: string;
  }>;
  readonly ticket?: Ticket;
  readonly roomName?: string;
}

const POLL_MS = 2500;

/**
 * The practice levels, one button each.
 *
 * They were a dropdown beside a Play button, which put six of the seven behind
 * a gesture nobody makes on a phone: a control that needs opening to reveal
 * what is in it is a control most people never open.
 */
const PRACTICE: ReadonlyArray<{ key: string; name: string; blurb: string }> = [
  { key: 'skirmish', name: 'Skirmish', blurb: 'Two on two, open space' },
  { key: 'duel', name: 'Duel', blurb: 'One on one, nowhere to hide' },
  { key: 'convoy', name: 'Convoy', blurb: 'A hull worth boarding' },
  { key: 'low-orbit', name: 'Low orbit', blurb: 'A heavy body below you' },
  { key: 'binary', name: 'Binary', blurb: 'A well either side of the line' },
  { key: 'slingshot', name: 'Slingshot', blurb: 'A well off the line, to whip round' },
  { key: 'sandbox', name: 'Sandbox', blurb: 'Ship stats unlocked, nothing at stake' },
];

export class Lobby {
  readonly #api: Api;
  readonly #onLaunch: (l: Launch) => void;
  #room: Room | null = null;
  #socket: WebSocket | null = null;
  #timer: number | null = null;
  #library: SavedDesign[] = [];
  #libMine = false;
  /** Set by main.ts: opening a library design is the shipyard's job. */
  #onOpenDesign: ((d: SavedDesign) => void) | null = null;
  /**
   * Set by main.ts: where the lobby has just moved to.
   *
   * The lobby says where it went and the app puts that in the address bar,
   * rather than the lobby writing URLs itself. Which screen has which path is
   * one decision and it lives in one place; a panel that pushed its own would
   * be a second router.
   */
  #onWhere: ((where: { room?: string }) => void) | null = null;

  onWhere(fn: (where: { room?: string }) => void): void { this.#onWhere = fn; }
  /**
   * The briefing: which level it is about, the ships that level seats, and the
   * design picked for each of them.
   *
   * `#roster` is class indices in spawn order for THIS side, straight from the
   * core, and `#picks` is the same length: slot n is the nth ship you field.
   */
  #brief: string | null = null;
  /** Every ship the level seats, BOTH sides, in spawn order, straight from the
   *  core. Both because you are setting up an engagement rather than picking a
   *  seat: choosing what you fight is half of choosing a fight. */
  #roster: Array<{ side: number; cls: number }> = [];
  /** One entry per roster row, same length and same order. */
  #picks: Array<SavedDesign | null> = [];
  /**
   * Which maker's hulls the briefing is showing.
   *
   * `null` is everyone. The library is public to read and a clone is a copy
   * (see the server suite), so this is about FINDING a hull among many rather
   * than about who may use one.
   */
  #briefOwner: string | null = null;
  /** How to ask the core what a level seats. Wired by main.ts, because the
   *  lobby does not own a match and should not learn to. */
  #rosterOf: (scenario: string) => Array<{ side: number; cls: number }> = () => [];

  onRoster(fn: (scenario: string) => Array<{ side: number; cls: number }>): void {
    this.#rosterOf = fn;
  }

  onOpenDesign(fn: (d: SavedDesign) => void): void { this.#onOpenDesign = fn; }

  constructor(api: Api, onLaunch: (l: Launch) => void) {
    this.#api = api;
    this.#onLaunch = onLaunch;
    this.#bind();
  }

  get visible(): boolean { return !$('lobby').classList.contains('hidden'); }

  show(): void {
    $('lobby').classList.remove('hidden');
    this.#room = null;
    this.#showLobbyPanel();
    this.renderSaves();
    void this.refresh();
    void this.refreshLibrary();
    this.#startPolling();
  }

  hide(): void {
    $('lobby').classList.add('hidden');
    this.#stopPolling();
  }

  async signIn(): Promise<void> {
    try {
      const me = await this.#api.signIn();
      $('whoName').textContent = me.name;
    } catch (e) {
      // Offline practice must still work with no server at all, so a failed
      // sign in disables the online half rather than blocking the page.
      $('whoName').textContent = 'offline';
      this.#offline(e);
    }
  }

  // --------------------------------------------------------------- panels --

  #showLobbyPanel(): void {
    $('lobbyPanel').style.display = '';
    $('roomPanel').style.display = 'none';
  }

  #showRoomPanel(): void {
    $('lobbyPanel').style.display = 'none';
    $('roomPanel').style.display = '';
  }

  #err(e: unknown): void {
    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
    $('lobbyErr').textContent = msg;
  }

  #offline(e: unknown): void {
    this.#err(e);
    for (const id of ['bNewPve', 'bNewPvp']) $<HTMLButtonElement>(id).disabled = true;
    $('roomEmpty').textContent = 'The server is unreachable. Practice still works.';
  }

  async refresh(): Promise<void> {
    if (this.#room) return this.#refreshRoom();
    try {
      const { rooms } = await this.#api.listRooms();
      this.#renderRooms(rooms);
      $('lobbyErr').textContent = '';
    } catch (e) {
      this.#offline(e);
    }
  }

  #renderRooms(rooms: Room[]): void {
    const host = $('roomList');
    host.innerHTML = '';
    $('roomCount').textContent = rooms.length ? `(${rooms.length})` : '';
    $('roomEmpty').style.display = rooms.length ? 'none' : '';
    for (const r of rooms) {
      const div = document.createElement('div');
      div.className = 'card roomRow';
      const taken = r.seats.length;
      div.innerHTML =
        `<div class="row">`
        + `<div class="grow"><div class="t">${escape(r.name)}</div>`
        + `<div class="s">${escape(r.scenario)} &middot; ${taken}/${r.capacity} seated</div></div>`
        + `<span class="tag ${r.mode}">${r.mode}</span>`
        + `</div>`;
      div.onclick = () => { void this.#join(r.roomId); };
      host.appendChild(div);
    }
  }

  #renderRoom(room: Room): void {
    this.#room = room;
    this.#showRoomPanel();
    $('roomName').textContent = room.name;
    $('roomInfo').textContent =
      `${room.scenario} · ${room.seats.length}/${room.capacity} seated · ${room.status}`;
    const modeTag = $('roomMode');
    modeTag.textContent = room.mode;
    modeTag.className = `tag ${room.mode}`;

    const me = this.#api.identity?.accountId;
    const host = $('seatList');
    host.innerHTML = '';
    for (let side = 0; side < room.capacity; side++) {
      const seat = room.seats.find(s => s.side === side);
      const div = document.createElement('div');
      div.className = `seatRow${seat?.ready ? ' rdy' : ''}${seat?.accountId === me ? ' me' : ''}`;
      div.innerHTML = seat
        ? `<span class="dot"></span><span class="grow">${escape(seat.name)}</span>`
          + `<span class="s">side ${side}${seat.accountId === room.hostId ? ' · host' : ''}</span>`
        : `<span class="dot"></span><span class="grow empty">waiting for a player</span>`
          + `<span class="s">side ${side}</span>`;
      host.appendChild(div);
    }
    // The AI does not take a seat, so say who is flying the other side rather
    // than leaving a row that will never fill.
    if (room.mode === 'pve') {
      const div = document.createElement('div');
      div.className = 'seatRow';
      div.innerHTML = '<span class="dot"></span><span class="grow">AI</span><span class="s">side 1</span>';
      host.appendChild(div);
    }

    const mine = room.seats.find(s => s.accountId === me);
    const isHost = room.hostId === me;
    const everyone = room.seats.length >= room.capacity && room.seats.every(s => s.ready);
    $<HTMLButtonElement>('bReady').textContent = mine?.ready ? 'Not ready' : 'Ready';
    $<HTMLButtonElement>('bReady').classList.toggle('on', !!mine?.ready);
    const start = $<HTMLButtonElement>('bStart');
    start.disabled = !isHost || !everyone;
    start.title = !isHost ? 'Only the host can start'
      : everyone ? 'Start the match'
      : 'Waiting for every seat to be filled and ready';
  }

  async #refreshRoom(): Promise<void> {
    if (!this.#room) return;
    try {
      const room = await this.#api.getRoom(this.#room.roomId);
      if (room.status !== 'open' && room.matchId) {
        await this.#enter(room);
        return;
      }
      this.#renderRoom(room);
      $('lobbyErr').textContent = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // The host left and took the room with them.
        this.#room = null;
        this.#showLobbyPanel();
        $('lobbyErr').textContent = 'That room closed.';
        return;
      }
      this.#err(e);
    }
  }

  // ---------------------------------------------------------------- flow --

  async #join(roomId: string): Promise<void> {
    try {
      const room = await this.#api.joinRoom(roomId);
      this.#watch(room);
      this.#onWhere?.({ room: room.roomId });
      if (room.status !== 'open' && room.matchId) { await this.#enter(room); return; }
      this.#renderRoom(room);
    } catch (e) {
      this.#err(e);
      this.#onWhere?.({});
      void this.refresh();
    }
  }

  /**
   * Open a room by id, because the URL named it.
   *
   * The same path a click takes, so a link to a room and a click on one land
   * in exactly the same place. A room that is gone falls back to the list
   * rather than to an empty panel.
   */
  async openRoom(roomId: string): Promise<boolean> {
    if (!this.visible) this.show();
    try {
      await this.#join(roomId);
      return this.#room !== null;
    } catch {
      return false;
    }
  }

  async #create(mode: 'pve' | 'pvp'): Promise<void> {
    try {
      const room = await this.#api.createRoom({ mode });
      this.#watch(room);
      this.#onWhere?.({ room: room.roomId });
      this.#renderRoom(room);
    } catch (e) {
      this.#err(e);
    }
  }

  /** Collect this seat's own credentials and hand the match to the game. */
  async #enter(room: Room): Promise<void> {
    const ticket = await this.#api.ticket(room.roomId);
    this.#stopPolling();
    this.#socket?.close();
    this.#socket = null;
    this.#room = null;
    this.hide();
    this.#onLaunch({
      kind: 'served',
      seed: ticket.seed,
      scenario: ticket.scenario,
      humanSides: ticket.humanSides,
      side: ticket.side,
      ticket,
      roomName: room.name,
    });
  }

  #watch(room: Room): void {
    this.#socket?.close();
    this.#socket = this.#api.watch({ room: room.roomId }, () => { void this.#refreshRoom(); });
  }

  #startPolling(): void {
    this.#stopPolling();
    this.#timer = setInterval(() => { void this.refresh(); }, POLL_MS) as unknown as number;
  }

  #stopPolling(): void {
    if (this.#timer !== null) { clearInterval(this.#timer); this.#timer = null; }
  }

  /** A button a level. The first keeps the id the harness has always used. */
  #renderPractice(): void {
    const host = $('practiceList');
    if (host.childElementCount) return;
    PRACTICE.forEach((p, n) => {
      const b = document.createElement('button');
      if (n === 0) b.id = 'bPractice';
      b.innerHTML = `<span class="n">${p.name}</span><span class="d">${p.blurb}</span>`;
      b.onclick = () => { this.#openBrief(p.key); };
      host.appendChild(b);
    });
  }

  /**
   * Which hull to take into a practice level.
   *
   * One card per SHIP the level seats, because the roster is what a player is
   * choosing over: "swap the second one" is a thing you can only say if the
   * second one is on screen. The roster comes from the core, so the list
   * describes the match that is about to be played rather than a second copy
   * of it kept here.
   */
  #renderBriefing(): void {
    const host = $('briefShips');
    host.innerHTML = '';
    const scenario = this.#brief;
    if (!scenario) return;
    const level = PRACTICE.find(p => p.key === scenario);
    $('briefName').textContent = level?.name ?? scenario;
    $('briefBlurb').textContent = level?.blurb ?? '';

    this.#renderOwners();

    // The hulls on offer, after the maker filter. Sorted so a person's own
    // work comes first: it is the most likely pick and the one they can name.
    const offered = this.#library
      .filter(d => classIndexOf(d.classKey) >= 0)
      .filter(d => this.#briefOwner === null
        || (this.#briefOwner === '' ? d.mine : d.owner.name === this.#briefOwner))
      .sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1));

    // Grouped by side, because "which of my ships" and "what am I fighting"
    // are different questions and a flat list of four makes them one.
    for (const side of [0, 1]) {
      const rows = this.#roster
        .map((r, i) => ({ ...r, i }))
        .filter(r => r.side === side);
      if (!rows.length) continue;

      const head = document.createElement('div');
      head.className = 'dzgrp briefSide';
      head.textContent = side === 0 ? 'Your fleet' : 'Hostiles';
      host.appendChild(head);

      rows.forEach((r, n) => {
        const chosen = this.#picks[r.i] ?? null;
        const authored = CLASS_NAMES[r.cls] ?? 'hull';
        const row = document.createElement('div');
        row.className = 'card briefRow';
        row.dataset.side = String(side);
        row.innerHTML =
          `<div class="row"><div class="grow">`
          + `<div class="t">${side === 0 ? 'Ship' : 'Hostile'} ${n + 1}</div>`
          + `<div class="s">${escape(chosen ? chosen.name : authored)}`
          + `${chosen ? '' : ' &middot; as the level authored'}</div>`
          + `</div></div>`;

        const picks = document.createElement('div');
        picks.className = 'picks hulls';
        const pick = (label: string, sub: string, on: boolean, fn: () => void) => {
          const b = document.createElement('button');
          b.className = on ? 'on' : '';
          b.innerHTML = `<span class="n">${escape(label)}</span><span class="d">${sub}</span>`;
          b.onclick = fn;
          picks.appendChild(b);
        };
        pick(authored, 'as authored', !chosen, () => {
          this.#picks[r.i] = null;
          this.#renderBriefing();
        });
        for (const d of offered) {
          pick(d.name, escape(CLASS_NAMES[classIndexOf(d.classKey)] ?? d.classKey)
            + (d.mine ? '' : ` &middot; ${escape(d.owner.name)}`),
            chosen?.designId === d.designId, () => {
              this.#picks[r.i] = d;
              this.#renderBriefing();
            });
        }
        row.appendChild(picks);
        host.appendChild(row);
      });
    }

    $('briefNote').innerHTML = this.#library.length
      ? 'Any hull, on either side. A swapped one brings its own mass, hull '
        + 'points, flight envelope and guns, derived by the core from the parts '
        + 'and the plate it was fitted with. The level still decides where they '
        + 'stand and how many.'
      : 'Nothing in the library yet. Build a hull in the shipyard, or wait for '
        + 'somebody else to, and it will be offered here.';
  }

  /**
   * The maker filter: everyone, mine, or one person at a time.
   *
   * Built from the owners actually present rather than from a list of accounts,
   * so it never offers a name with nothing behind it and never needs a second
   * request to draw.
   */
  #renderOwners(): void {
    const host = $('briefOwners');
    host.innerHTML = '';
    const names: string[] = [];
    for (const d of this.#library) {
      if (classIndexOf(d.classKey) < 0) continue;
      if (!d.mine && !names.includes(d.owner.name)) names.push(d.owner.name);
    }
    names.sort((a, b) => a.localeCompare(b));

    const chip = (label: string, key: string | null, count: number) => {
      const b = document.createElement('button');
      b.className = this.#briefOwner === key ? 'on' : '';
      b.innerHTML = `${escape(label)}<span class="cnt">${count}</span>`;
      b.onclick = () => { this.#briefOwner = key; this.#renderBriefing(); };
      host.appendChild(b);
    };
    const usable = this.#library.filter(d => classIndexOf(d.classKey) >= 0);
    chip('Everyone', null, usable.length);
    chip('Mine', '', usable.filter(d => d.mine).length);
    for (const n of names) {
      chip(n, n, usable.filter(d => !d.mine && d.owner.name === n).length);
    }
    // One maker and it is you: a filter with a single meaningful setting is
    // furniture, so it stays out of the way until there is a choice to make.
    host.style.display = names.length ? '' : 'none';
  }

  /**
   * Open the briefing for a level: what it seats, and what you want to fly.
   *
   * A popup rather than one chooser above the levels, because the choice is
   * per SHIP and per level: a single picker could only ever say "every hull I
   * field is this one", which is not what swapping a ship out means.
   */
  #openBrief(scenario: string): void {
    this.#brief = scenario;
    this.#roster = this.#rosterOf(scenario);
    this.#picks = this.#roster.map(() => null);
    $('briefing').classList.remove('hidden');
    this.#renderBriefing();
    // Everyone's hulls, not just the tab the library happened to be left on.
    // A briefing that offered only your own designs because you last pressed
    // Mine would look like your friends' ships had vanished.
    if (this.#libMine) {
      this.#libMine = false;
      void this.refreshLibrary();
    }
  }

  #closeBrief(): void {
    this.#brief = null;
    $('briefing').classList.add('hidden');
  }

  /**
   * Start a practice level, and file it under an id straight away.
   *
   * The save exists before the first turn does. A game refreshed on turn zero
   * is still a game somebody started, and coming back to an empty lobby is
   * exactly the thing this is here to stop.
   */
  #practice(scenario: string): void {
    this.#stopPolling();
    this.#closeBrief();
    this.hide();
    const name = PRACTICE.find(p => p.key === scenario)?.name ?? scenario;
    // Slot is the index WITHIN a side, which is the order the core fills, so
    // it is counted per side rather than taken from the roster index.
    const nextSlot: [number, number] = [0, 0];
    const hulls: Array<{ side: number; slot: number; design: unknown; name: string }> = [];
    this.#picks.forEach((d, i) => {
      const side = this.#roster[i]?.side === 1 ? 1 : 0;
      const slot = nextSlot[side]++;
      if (d) hulls.push({ side, slot, design: d.design, name: d.name });
    });
    const flown = hulls.filter(h => h.side === 0).map(h => h.name);
    const against = hulls.filter(h => h.side === 1).map(h => h.name);
    const game = saves.create({
      id: newId(),
      name: flown.length || against.length
        ? `${name}${flown.length ? `, in ${flown.join(', ')}` : ''}`
          + `${against.length ? ` against ${against.join(', ')}` : ''}`
        : name,
      seed: randomSeed(),
      scenario,
      humanSides: 0b01,
      side: 0,
      hulls,
    });
    this.#onLaunch({
      kind: 'offline', gameId: game.id, seed: game.seed, scenario, humanSides: 0b01, side: 0,
      hulls,
    });
  }

  /**
   * The games this browser has in progress.
   *
   * Above the levels, because "carry on with the one I was playing" is the
   * commoner intent than "start another", and a player who lost the tab has no
   * other way back in: the address they were on is the only other handle on it
   * and they have just lost that too.
   */
  renderSaves(): void {
    const host = $('savedList');
    const rows = saves.list();
    host.innerHTML = '';
    $('savedWrap').style.display = rows.length ? '' : 'none';
    for (const g of rows) {
      const div = document.createElement('div');
      div.className = 'card roomRow';
      const state = g.outcome === 'won' ? 'won'
        : g.outcome === 'lost' ? 'lost'
        : `turn ${g.turns.length}`;
      div.innerHTML =
        `<div class="row">`
        + `<div class="grow"><div class="t">${escape(g.name)}</div>`
        + `<div class="s">${escape(state)} &middot; ${when(g.updatedMs)}</div></div>`
        + `<button class="drop" title="Forget this game">&times;</button>`
        + `</div>`;
      div.onclick = () => { this.#resume(g.id); };
      const drop = div.querySelector('button');
      if (drop) {
        drop.onclick = ev => {
          ev.stopPropagation();
          saves.remove(g.id);
          this.renderSaves();
        };
      }
      host.appendChild(div);
    }
  }

  /** Pick a saved game up where it was left. */
  #resume(id: string): void {
    const g = saves.load(id);
    if (!g) { this.renderSaves(); return; }
    this.#stopPolling();
    this.hide();
    this.#onLaunch({
      kind: 'offline', gameId: g.id, seed: g.seed, scenario: g.scenario,
      humanSides: g.humanSides, side: g.side, resume: g.turns,
      ...(g.hulls ? { hulls: g.hulls } : {}),
    });
  }

  /** Open a saved game by id, because the URL named it. Returns false when
   *  there is no such save, so the caller can put the player somewhere real. */
  resume(id: string): boolean {
    if (!saves.load(id)) return false;
    this.#resume(id);
    return true;
  }

  // ------------------------------------------------------- the ship library --

  /** Refresh the library. Public to read, so this works signed out too. */
  async refreshLibrary(): Promise<void> {
    try {
      const { designs } = await this.#api.listDesigns({ mine: this.#libMine, limit: 60 });
      this.#library = designs;
    } catch {
      // A library that cannot load must not take the lobby down with it: the
      // rooms and the practice levels have nothing to do with it.
      this.#library = [];
    }
    this.#renderLibrary();
    // The briefing offers the library, so it is rebuilt from the same fetch
    // rather than from a copy of it. Only while one is open: rebuilding a shut
    // popup writes into a panel nobody is looking at.
    if (this.#brief) this.#renderBriefing();
  }

  #renderLibrary(): void {
    const host = $('libList');
    host.innerHTML = '';
    $('libEmpty').style.display = this.#library.length ? 'none' : '';
    $('bLibAll').className = this.#libMine ? '' : 'primary';
    $('bLibMine').className = this.#libMine ? 'primary' : '';
    for (const d of this.#library) {
      const row = document.createElement('div');
      row.className = 'libRow';
      const cls = d.classKey.replace(/_/g, ' ');
      row.innerHTML = `<div class="bd"><div class="n">${escape(d.name)}`
        + (d.mine ? '<span class="me">yours</span>' : '') + '</div>'
        + `<div class="s">${escape(cls)} &middot; by ${escape(d.owner.name)} &middot; `
        + `saved mass ${d.reported.mass.toFixed(3)}, hull ${d.reported.hull.toFixed(0)}`
        + (d.reported.legal ? '' : ' &middot; <span class="bad">illegal when saved</span>')
        + '</div></div>';
      const open = document.createElement('button');
      open.textContent = 'Open';
      open.onclick = () => { this.#onOpenDesign?.(d); };
      row.appendChild(open);
      if (d.mine) {
        const del = document.createElement('button');
        del.textContent = 'Delete';
        del.onclick = () => {
          void this.#api.deleteDesign(d.designId)
            .then(() => this.refreshLibrary())
            .catch(e => this.#err(e));
        };
        row.appendChild(del);
      }
      host.appendChild(row);
    }
  }

  #bind(): void {
    this.#renderPractice();
    $('briefClose').onclick = () => { this.#closeBrief(); };
    $('briefGo').onclick = () => { if (this.#brief) this.#practice(this.#brief); };
    $('bLibAll').onclick = () => { this.#libMine = false; void this.refreshLibrary(); };
    $('bLibMine').onclick = () => { this.#libMine = true; void this.refreshLibrary(); };
    $('bNewPve').onclick = () => { void this.#create('pve'); };
    $('bNewPvp').onclick = () => { void this.#create('pvp'); };

    $('bReady').onclick = () => {
      if (!this.#room) return;
      const me = this.#api.identity?.accountId;
      const mine = this.#room.seats.find(s => s.accountId === me);
      void this.#api.setReady(this.#room.roomId, !mine?.ready)
        .then(r => this.#renderRoom(r))
        .catch(e => this.#err(e));
    };
    $('bStart').onclick = () => {
      if (!this.#room) return;
      void this.#api.startRoom(this.#room.roomId)
        .then(r => (r.matchId ? this.#enter(r) : this.#renderRoom(r)))
        .catch(e => this.#err(e));
    };
    $('bLeave').onclick = () => {
      if (!this.#room) return;
      const id = this.#room.roomId;
      this.#room = null;
      this.#socket?.close();
      this.#socket = null;
      this.#showLobbyPanel();
      this.#onWhere?.({});
      void this.#api.leaveRoom(id).catch(() => { /* leaving is best effort */ });
      void this.refresh();
    };
    $('bRename').onclick = () => {
      const next = prompt('Callsign', this.#api.identity?.name ?? '');
      if (!next) return;
      void this.#api.rename(next)
        .then(me => { $('whoName').textContent = me.name; })
        .catch(e => this.#err(e));
    };
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

export function randomSeed(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

/** How long ago, in the shortest form that still says it. */
function when(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
