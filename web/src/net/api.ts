/**
 * The server, as the client sees it.
 *
 * Identity is anonymous and lives in localStorage: an id and a secret minted
 * on first visit. There is no sign up because there is nothing to sign up
 * with, and no recovery because there is nothing worth recovering. Clearing
 * site data makes you a new pilot, which is the honest consequence of storing
 * an identity in a browser and not pretending otherwise.
 *
 * Every call here is plain REST. The socket is a notifier only: everything it
 * announces is the side effect of a request someone made, so a client whose
 * socket never connects still reaches the same state by polling. That is worth
 * preserving even though it costs a poll timer, because a lobby that only
 * works with a live socket is a lobby that appears broken on a flaky phone.
 */

const KEY = 'fallen-tribes.identity';

export interface Identity {
  readonly accountId: string;
  readonly token: string;
  readonly name: string;
}

export interface Seat {
  readonly accountId: string;
  readonly name: string;
  readonly side: number;
  readonly ready: boolean;
}

export interface Room {
  readonly roomId: string;
  readonly name: string;
  readonly scenario: string;
  readonly mode: 'pve' | 'pvp';
  readonly status: 'open' | 'playing' | 'done';
  readonly matchId: string | null;
  readonly seed: string;
  readonly hostId: string;
  readonly capacity: number;
  readonly humanSides: number;
  readonly seats: readonly Seat[];
}

/** What a seat needs to actually play the match its room started. */
export interface Ticket {
  readonly matchId: string;
  readonly seed: string;
  readonly scenario: string;
  readonly side: number;
  readonly humanSides: number;
  readonly playerId: string;
  readonly token: string;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class Api {
  #identity: Identity | null = null;
  /** Match credentials, which are separate from the account's on purpose. */
  #seat: { matchId: string; playerId: string; token: string } | null = null;

  get identity(): Identity | null { return this.#identity; }

  /**
   * Reuse the stored identity if the server still knows it, else mint one.
   *
   * The check matters: a database that was reset, or a browser profile copied
   * between machines, leaves a stored id the server has never heard of, and
   * every later call would fail with a 401 that looks like a bug rather than
   * a stale identity.
   */
  async signIn(): Promise<Identity> {
    const stored = this.#read();
    if (stored) {
      try {
        const me = await this.#json<{ accountId: string; name: string }>('/v1/accounts/me', {
          headers: this.#accountHeaders(stored),
        });
        this.#identity = { ...stored, name: me.name };
        return this.#identity;
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        // fall through and mint a new one
      }
    }
    const made = await this.#json<{ accountId: string; name: string; token: string }>(
      '/v1/accounts', { method: 'POST', body: '{}' },
    );
    this.#identity = { accountId: made.accountId, token: made.token, name: made.name };
    this.#write(this.#identity);
    return this.#identity;
  }

  async rename(name: string): Promise<Identity> {
    const me = await this.#json<{ accountId: string; name: string }>('/v1/accounts/me', {
      method: 'POST',
      headers: this.#accountHeaders(),
      body: JSON.stringify({ name }),
    });
    const next = { ...this.#must(), name: me.name };
    this.#identity = next;
    this.#write(next);
    return next;
  }

  listRooms(): Promise<{ rooms: Room[] }> {
    return this.#json('/v1/rooms');
  }

  createRoom(opts: { mode: 'pve' | 'pvp'; name?: string; scenario?: string }): Promise<Room> {
    return this.#json('/v1/rooms', {
      method: 'POST', headers: this.#accountHeaders(), body: JSON.stringify(opts),
    });
  }

  getRoom(roomId: string): Promise<Room> {
    return this.#json(`/v1/rooms/${roomId}`);
  }

  joinRoom(roomId: string): Promise<Room> {
    return this.#json(`/v1/rooms/${roomId}/join`, {
      method: 'POST', headers: this.#accountHeaders(), body: '{}',
    });
  }

  leaveRoom(roomId: string): Promise<{ ok: boolean; closed: boolean }> {
    return this.#json(`/v1/rooms/${roomId}/leave`, {
      method: 'POST', headers: this.#accountHeaders(), body: '{}',
    });
  }

  setReady(roomId: string, ready: boolean): Promise<Room> {
    return this.#json(`/v1/rooms/${roomId}/ready`, {
      method: 'POST', headers: this.#accountHeaders(), body: JSON.stringify({ ready }),
    });
  }

  startRoom(roomId: string): Promise<Room> {
    return this.#json(`/v1/rooms/${roomId}/start`, {
      method: 'POST', headers: this.#accountHeaders(), body: '{}',
    });
  }

  /** Collect this seat's own match credentials and remember them. */
  async ticket(roomId: string): Promise<Ticket> {
    const t = await this.#json<Ticket>(`/v1/rooms/${roomId}/ticket`, {
      method: 'POST', headers: this.#accountHeaders(), body: '{}',
    });
    this.#seat = { matchId: t.matchId, playerId: t.playerId, token: t.token };
    return t;
  }

  // ------------------------------------------------------------- the match --

  /**
   * Commit this seat's orders. Returns whether the turn was released, which in
   * a solo game is immediately: the AI's orders were never coming over the
   * wire, so there is nobody else to wait for.
   */
  submitOrders(turn: number, body: unknown): Promise<{ ready: boolean; waitingOn: number }> {
    const seat = this.#seatOrThrow();
    return this.#json(`/v1/matches/${seat.matchId}/turns/${turn}/orders`, {
      method: 'POST', headers: this.#seatHeaders(), body: JSON.stringify(body),
    });
  }

  /**
   * Every seat's orders for a turn, or null while the server is still
   * withholding them. Withheld is not an error: it is the whole point of
   * simultaneous turns, so it comes back as a 202 and reads as "not yet".
   */
  async fetchTurn(turn: number): Promise<{ orders: Record<string, unknown> } | null> {
    const seat = this.#seatOrThrow();
    const res = await fetch(`/v1/matches/${seat.matchId}/turns/${turn}`, {
      headers: this.#seatHeaders(),
    });
    if (res.status === 202) return null;
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<{ orders: Record<string, unknown> }>;
  }

  /**
   * Report the state hash after resolving. The server cannot say which client
   * is right, only that two disagree, and that is the one thing a client
   * cannot discover about itself.
   */
  reportHash(turn: number, hash: string): Promise<{ diverged: boolean; distinct: string[] }> {
    const seat = this.#seatOrThrow();
    return this.#json(`/v1/matches/${seat.matchId}/turns/${turn}/hash`, {
      method: 'POST', headers: this.#seatHeaders(), body: JSON.stringify({ hash }),
    });
  }

  /** A socket on a room or a match. Null if the browser refuses to open one. */
  watch(topic: { room: string } | { match: string }, onEvent: (e: unknown) => void): WebSocket | null {
    try {
      const q = 'room' in topic ? `room=${topic.room}` : `match=${topic.match}`;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
      ws.onmessage = ev => {
        try { onEvent(JSON.parse(String(ev.data))); } catch { /* not ours */ }
      };
      return ws;
    } catch {
      // A missing socket costs responsiveness, never correctness: everything
      // it would have announced is reachable by polling.
      return null;
    }
  }

  // -------------------------------------------------------------- plumbing --

  #must(): Identity {
    if (!this.#identity) throw new Error('not signed in');
    return this.#identity;
  }

  #accountHeaders(id: Identity | null = null): Record<string, string> {
    const who = id ?? this.#must();
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${who.token}`,
      'x-account-id': who.accountId,
    };
  }

  #seatOrThrow(): { matchId: string; playerId: string; token: string } {
    if (!this.#seat) throw new Error('no match seat');
    return this.#seat;
  }

  #seatHeaders(): Record<string, string> {
    const seat = this.#seatOrThrow();
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${seat.token}`,
      'x-player-id': seat.playerId,
    };
  }

  async #json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, init);
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = await res.json() as { error?: string };
        if (body.error) message = body.error;
      } catch { /* not json */ }
      throw new ApiError(res.status, message);
    }
    return res.json() as Promise<T>;
  }

  #read(): Identity | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as Partial<Identity>;
      if (typeof v.accountId === 'string' && typeof v.token === 'string') {
        return { accountId: v.accountId, token: v.token, name: String(v.name ?? 'pilot') };
      }
    } catch { /* a browser that refuses storage is a browser without a name */ }
    return null;
  }

  #write(id: Identity): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(id));
    } catch { /* private mode: the identity lasts one session, which still works */ }
  }
}
