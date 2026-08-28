/**
 * Anonymous accounts, and the lobby that seats people into matches.
 *
 * Sign in is anonymous by design, not by omission. There is nothing here worth
 * stealing: an id and a secret minted on first visit and kept in the browser,
 * enough to be the same person across rooms and to stop a stranger submitting
 * orders in your name, and deliberately not enough to be worth a password
 * reset flow. Anything stronger can be layered on later without changing what
 * a room or a match is.
 *
 * A room is where people gather before a match exists; starting it mints the
 * match the lockstep endpoints already broker. PvE and PvP go through the same
 * room, differing only in how many seats a person occupies: the simulation is
 * told which SIDES are human and plans the rest with its own AI, so a solo game
 * is not a special case of the turn loop, only of who fills the seats.
 */
import type express from 'express';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, nowMs } from './db.ts';

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Constant time, so a token cannot be recovered by timing the reply. */
export function tokenMatches(given: string, storedHash: string): boolean {
  const a = Buffer.from(sha(given), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AccountRow { id: string; name: string; token_hash: string }
export interface RoomRow {
  id: string; name: string; scenario: string; mode: string; host_id: string;
  status: string; match_id: string | null; seed: string; created_ms: number;
}
export interface SeatRow { account_id: string; side: number; ready: number; name: string }

const one = <T,>(r: unknown): T | undefined => r as T | undefined;
const many = <T,>(r: unknown): T[] => r as T[];

const qa = {
  account: db.prepare('SELECT id, name, token_hash FROM accounts WHERE id = ?'),
  room: db.prepare(`SELECT id, name, scenario, mode, host_id, status, match_id, seed, created_ms
                    FROM rooms WHERE id = ?`),
  seats: db.prepare(`SELECT s.account_id, s.side, s.ready, a.name
                     FROM seats s JOIN accounts a ON a.id = s.account_id
                     WHERE s.room_id = ? ORDER BY s.side, s.joined_ms`),
  openRooms: db.prepare(`SELECT id, name, scenario, mode, host_id, status, match_id, seed, created_ms
                         FROM rooms WHERE status = 'open' ORDER BY updated_ms DESC LIMIT 50`),
};

/** How many people a mode seats. PvE is one; the AI does not need a seat. */
export const seatsFor = (mode: string): number => (mode === 'pvp' ? 2 : 1);

/**
 * Which sides a person plays, as the bitmask the simulation takes. PvE is
 * side 0 only, so the core plans side 1 itself; PvP is both.
 */
export const humanSides = (mode: string): number => (mode === 'pvp' ? 0b11 : 0b01);

/** A readable handle nobody chose, so an empty lobby is not a wall of "pilot". */
function callsign(): string {
  const words = [
    'Ash', 'Bright', 'Cinder', 'Dust', 'Ember', 'Frost', 'Gale', 'Halo',
    'Iron', 'Jade', 'Kite', 'Lumen', 'Mire', 'North', 'Onyx', 'Pale',
    'Quill', 'Rift', 'Slate', 'Tide', 'Umber', 'Vale', 'Wren', 'Zephyr',
  ];
  const w = words[randomBytes(1)[0]! % words.length] ?? 'Pilot';
  return `${w}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/**
 * The account behind a request, or null. Anonymous does not mean
 * unauthenticated: every mutation still proves it holds the account's secret,
 * or one player could end another's turn.
 */
export function account(req: express.Request): AccountRow | null {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const id = req.header('x-account-id') ?? '';
  if (!token || !id) return null;
  const row = one<AccountRow>(qa.account.get(id));
  if (!row || !tokenMatches(token, row.token_hash)) return null;
  db.prepare('UPDATE accounts SET seen_ms = ? WHERE id = ?').run(nowMs(), id);
  return row;
}

export function roomView(room: RoomRow): Record<string, unknown> {
  const seats = many<SeatRow>(qa.seats.all(room.id));
  return {
    roomId: room.id,
    name: room.name,
    scenario: room.scenario,
    mode: room.mode,
    status: room.status,
    matchId: room.match_id,
    seed: room.seed,
    hostId: room.host_id,
    capacity: seatsFor(room.mode),
    humanSides: humanSides(room.mode),
    seats: seats.map(s => ({
      accountId: s.account_id, name: s.name, side: s.side, ready: !!s.ready,
    })),
  };
}

export function mountLobby(
  app: express.Express,
  publishRoom: (roomId: string, event: unknown) => void,
): void {
  /**
   * Mint an anonymous account. The only unauthenticated mutation here, because
   * it is the one that creates the thing everything else authenticates against.
   */
  app.post('/v1/accounts', (req, res) => {
    const body = req.body as { name?: unknown };
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 24)
      : callsign();
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO accounts (id, name, token_hash, created_ms, seen_ms) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, sha(token), nowMs(), nowMs());
    res.status(201).json({ accountId: id, name, token });
  });

  /** Confirm a stored identity still exists, and rename. */
  app.get('/v1/accounts/me', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    res.json({ accountId: me.id, name: me.name });
  });

  app.post('/v1/accounts/me', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const body = req.body as { name?: unknown };
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 24)
      : me.name;
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, me.id);
    res.json({ accountId: me.id, name });
  });

  /** Rooms still waiting for people. */
  app.get('/v1/rooms', (_req, res) => {
    const rooms = many<RoomRow>(qa.openRooms.all()).map(roomView);
    res.json({ rooms });
  });

  app.post('/v1/rooms', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const body = req.body as { name?: unknown; scenario?: unknown; mode?: unknown };
    const mode = body.mode === 'pvp' ? 'pvp' : 'pve';
    const scenario = typeof body.scenario === 'string' ? body.scenario : 'skirmish';
    const name = typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 40)
      : `${me.name}'s room`;

    const id = randomUUID();
    const seed = randomBytes(8).toString('hex');
    db.prepare(`INSERT INTO rooms (id, name, scenario, mode, host_id, status, seed, created_ms, updated_ms)
                VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
      .run(id, name, scenario, mode, me.id, seed, nowMs(), nowMs());
    // The host takes side 0. Someone has to, and the alternative is a lobby
    // where two people stare at an empty room waiting for the other to pick.
    db.prepare('INSERT INTO seats (room_id, account_id, side, ready, joined_ms) VALUES (?, ?, 0, 0, ?)')
      .run(id, me.id, nowMs());
    const room = one<RoomRow>(qa.room.get(id))!;
    res.status(201).json(roomView(room));
  });

  app.get('/v1/rooms/:id', (req, res) => {
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    res.json(roomView(room));
  });

  app.post('/v1/rooms/:id/join', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    if (room.status !== 'open') { res.status(409).json({ error: 'room already started' }); return; }

    const seats = many<SeatRow>(qa.seats.all(room.id));
    // Re-joining is not an error: a reload should put you back in your seat
    // rather than tell you the room is full of yourself.
    if (seats.some(s => s.account_id === me.id)) { res.json(roomView(room)); return; }
    if (seats.length >= seatsFor(room.mode)) { res.status(409).json({ error: 'room full' }); return; }

    const taken = new Set(seats.map(s => s.side));
    let side = 0;
    while (taken.has(side)) side += 1;
    db.prepare('INSERT INTO seats (room_id, account_id, side, ready, joined_ms) VALUES (?, ?, ?, 0, ?)')
      .run(room.id, me.id, side, nowMs());
    db.prepare('UPDATE rooms SET updated_ms = ? WHERE id = ?').run(nowMs(), room.id);
    const view = roomView(one<RoomRow>(qa.room.get(room.id))!);
    publishRoom(room.id, { type: 'roomChanged', room: view });
    res.status(201).json(view);
  });

  app.post('/v1/rooms/:id/leave', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    db.prepare('DELETE FROM seats WHERE room_id = ? AND account_id = ?').run(room.id, me.id);
    const seats = many<SeatRow>(qa.seats.all(room.id));
    // An empty room is litter. A room whose host left is not: whoever is still
    // sitting there keeps it, because closing it under them is worse.
    if (seats.length === 0) {
      db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
      publishRoom(room.id, { type: 'roomClosed', roomId: room.id });
      res.json({ ok: true, closed: true });
      return;
    }
    if (room.host_id === me.id) {
      db.prepare('UPDATE rooms SET host_id = ?, updated_ms = ? WHERE id = ?')
        .run(seats[0]!.account_id, nowMs(), room.id);
    }
    const view = roomView(one<RoomRow>(qa.room.get(room.id))!);
    publishRoom(room.id, { type: 'roomChanged', room: view });
    res.json({ ok: true, closed: false, room: view });
  });

  app.post('/v1/rooms/:id/ready', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    const body = req.body as { ready?: unknown };
    const ready = body.ready === false ? 0 : 1;
    const changed = db.prepare('UPDATE seats SET ready = ? WHERE room_id = ? AND account_id = ?')
      .run(ready, room.id, me.id);
    if (changed.changes === 0) { res.status(409).json({ error: 'not seated' }); return; }
    db.prepare('UPDATE rooms SET updated_ms = ? WHERE id = ?').run(nowMs(), room.id);
    const view = roomView(one<RoomRow>(qa.room.get(room.id))!);
    publishRoom(room.id, { type: 'roomChanged', room: view });
    res.json(view);
  });

  /**
   * Start the room, which mints the match.
   *
   * The host says when, and only when every seat is filled and ready. The
   * match is created with one player row per seat so the lockstep gate counts
   * the right number of people: in PvE that is one, and the turn releases as
   * soon as that one person commits, because the AI's orders were never going
   * to arrive over the wire.
   */
  app.post('/v1/rooms/:id/start', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    if (room.host_id !== me.id) { res.status(403).json({ error: 'only the host can start' }); return; }
    if (room.status !== 'open') {
      // Not an error worth failing on: two taps on Start should land you in
      // the match, not on an error page.
      res.json(roomView(room));
      return;
    }
    const seats = many<SeatRow>(qa.seats.all(room.id));
    if (seats.length < seatsFor(room.mode)) {
      res.status(409).json({ error: 'waiting for players', have: seats.length, need: seatsFor(room.mode) });
      return;
    }
    if (!seats.every(s => s.ready)) {
      res.status(409).json({ error: 'not everyone is ready' });
      return;
    }

    const matchId = randomUUID();
    db.prepare('INSERT INTO matches (id, seed, scenario, turn, created_ms) VALUES (?, ?, ?, 0, ?)')
      .run(matchId, room.seed, room.scenario, nowMs());

    // Each seat gets a per match token. The account secret never goes near the
    // turn endpoints, so a leaked match token costs one match rather than an
    // identity.
    const tokens: Record<string, string> = {};
    for (const s of seats) {
      const token = randomBytes(24).toString('base64url');
      tokens[s.account_id] = token;
      db.prepare('INSERT INTO players (match_id, player_id, name, token_hash, joined_ms) VALUES (?, ?, ?, ?, ?)')
        .run(matchId, s.account_id, s.name, sha(token), nowMs());
    }
    db.prepare("UPDATE rooms SET status = 'playing', match_id = ?, updated_ms = ? WHERE id = ?")
      .run(matchId, nowMs(), room.id);

    const view = roomView(one<RoomRow>(qa.room.get(room.id))!);
    // Every seat needs its own token, and nobody else's. The socket carries
    // the fact that the match exists; the tokens are collected by each client
    // from its own start call or the ticket endpoint below.
    publishRoom(room.id, { type: 'roomStarted', room: view });
    res.status(201).json({ ...view, matchToken: tokens[me.id] });
  });

  /**
   * The caller's own match credentials for a started room.
   *
   * A guest learns the match began from the socket or by polling, and needs a
   * token it was never handed: only the host got one back from start. Issuing
   * a fresh token here rather than storing the original keeps the plaintext
   * out of the database, which is the same reason the hash is what gets saved.
   */
  app.post('/v1/rooms/:id/ticket', (req, res) => {
    const me = account(req);
    if (!me) { res.status(401).json({ error: 'unknown account' }); return; }
    const room = one<RoomRow>(qa.room.get(req.params.id));
    if (!room) { res.status(404).json({ error: 'no such room' }); return; }
    if (room.status === 'open' || !room.match_id) {
      res.status(409).json({ error: 'room has not started' });
      return;
    }
    const seat = many<SeatRow>(qa.seats.all(room.id)).find(s => s.account_id === me.id);
    if (!seat) { res.status(403).json({ error: 'not seated in this room' }); return; }

    const token = randomBytes(24).toString('base64url');
    db.prepare(`INSERT INTO players (match_id, player_id, name, token_hash, joined_ms)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(match_id, player_id) DO UPDATE SET token_hash = excluded.token_hash`)
      .run(room.match_id, me.id, seat.name, sha(token), nowMs());
    res.json({
      matchId: room.match_id,
      seed: room.seed,
      scenario: room.scenario,
      side: seat.side,
      humanSides: humanSides(room.mode),
      playerId: me.id,
      token,
    });
  });
}
