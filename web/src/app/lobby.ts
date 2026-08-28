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

import { Api, ApiError, type Room, type Ticket } from '../net/api.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

/** How a match was entered, which decides how its turns are resolved. */
export interface Launch {
  readonly kind: 'offline' | 'served';
  readonly seed: string;
  readonly scenario: string;
  /** Bit per side: set means a person plays it. */
  readonly humanSides: number;
  /** Which side this client sits in. */
  readonly side: number;
  readonly ticket?: Ticket;
  readonly roomName?: string;
}

const POLL_MS = 2500;

export class Lobby {
  readonly #api: Api;
  readonly #onLaunch: (l: Launch) => void;
  #room: Room | null = null;
  #socket: WebSocket | null = null;
  #timer: number | null = null;

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
    void this.refresh();
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
      if (room.status !== 'open' && room.matchId) { await this.#enter(room); return; }
      this.#renderRoom(room);
    } catch (e) {
      this.#err(e);
      void this.refresh();
    }
  }

  async #create(mode: 'pve' | 'pvp'): Promise<void> {
    try {
      const room = await this.#api.createRoom({ mode });
      this.#watch(room);
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

  #bind(): void {
    $('bPractice').onclick = () => {
      this.#stopPolling();
      this.hide();
      const pick = document.getElementById('selScenario') as HTMLSelectElement | null;
      this.#onLaunch({
        kind: 'offline',
        seed: randomSeed(),
        scenario: pick?.value || 'skirmish',
        humanSides: 0b01,
        side: 0,
      });
    };
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
