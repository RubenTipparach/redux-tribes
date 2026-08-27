/**
 * Fallen Tribes match API.
 *
 * Deliberately small, because lockstep (ADR-6) makes it small: the server never
 * simulates anything. It collects each player's orders for a turn, releases
 * them once everyone has submitted, and compares the state hashes the clients
 * report back. Game state lives on the clients; what crosses the wire is
 * orders and hashes.
 *
 * That is also why divergence detection belongs here. The server cannot say
 * which client is right, but it can say that two of them disagree, which is
 * the thing you cannot discover from inside one client.
 *
 * HTTP and WebSocket share a process so one Fly machine serves both. The socket
 * is a notifier only: every event it pushes is the side effect of a REST
 * mutation, so a client that never opens a socket still gets a correct view by
 * polling.
 */
import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { db, nowMs } from './db.ts';
import { mountLobby } from './lobby.ts';

const PORT = Number(process.env['PORT'] ?? 8080);
const app = express();
app.use(express.json({ limit: '256kb' }));

// Permissive CORS: the client is a static page that may be served from Pages,
// a local file, or a dev server, and there are no cookies or credentials to
// protect. Authority rests on the per-player token, checked below.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});
app.options(/.*/, (_req, res) => { res.sendStatus(204); });

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Constant time compare so a token cannot be recovered by timing the reply. */
function tokenMatches(given: string, storedHash: string): boolean {
  const a = Buffer.from(sha(given), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

interface PlayerRow { player_id: string; name: string; token_hash: string }
interface MatchRow { id: string; seed: string; scenario: string; turn: number; closed: number }
interface OrderRow { player_id: string; body: string }
interface HashRow { player_id: string; hash: string }

// node:sqlite returns untyped rows. These narrow at the one place the shape is
// actually known, rather than sprinkling double casts through the handlers.
const one = <T,>(r: unknown): T | undefined => r as T | undefined;
const many = <T,>(r: unknown): T[] => r as T[];

const q = {
  match: db.prepare('SELECT id, seed, scenario, turn, closed FROM matches WHERE id = ?'),
  players: db.prepare('SELECT player_id, name, token_hash FROM players WHERE match_id = ? ORDER BY joined_ms'),
  player: db.prepare('SELECT player_id, name, token_hash FROM players WHERE match_id = ? AND player_id = ?'),
  ordersFor: db.prepare('SELECT player_id, body FROM orders WHERE match_id = ? AND turn = ? ORDER BY player_id'),
  hashesFor: db.prepare('SELECT player_id, hash FROM hashes WHERE match_id = ? AND turn = ? ORDER BY player_id'),
};

function auth(req: express.Request, matchId: string): PlayerRow | null {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const playerId = req.header('x-player-id') ?? '';
  if (!token || !playerId) return null;
  const row = one<PlayerRow>(q.player.get(matchId, playerId));
  if (!row || !tokenMatches(token, row.token_hash)) return null;
  return row;
}

// ------------------------------------------------------------------ sockets --
// One map, keyed by whatever the client asked to watch. A room and a match are
// different things with different ids, so they cannot collide, and a client
// that follows a room into a match simply reconnects with the other key.
const sockets = new Map<string, Set<WebSocket>>();
function publishTo(topic: string, event: unknown): void {
  const set = sockets.get(topic);
  if (!set) return;
  const payload = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

// -------------------------------------------------------------------- routes --
// Anonymous accounts, rooms and the lobby. Kept in its own module because it
// is a different job from brokering turns: this one is about who is playing,
// the rest of this file is about what they did.
mountLobby(app, publishTo);

// Fly sets these inside the machine. Reporting them makes "where is this
// actually running" answerable from outside with a single request, rather
// than by reading a deploy log or trusting fly.toml to describe reality:
// primary_region only places NEW machines, so config and truth can drift.
// Both are null off Fly, which is what local runs and the tests see.
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    now: nowMs(),
    region: process.env.FLY_REGION ?? null,
    machine: process.env.FLY_MACHINE_ID ?? null,
  });
});

app.post('/v1/matches', (req, res) => {
  const body = req.body as { scenario?: unknown; seed?: unknown; name?: unknown };
  const scenario = typeof body.scenario === 'string' ? body.scenario : 'skirmish';
  const seed = typeof body.seed === 'string' && body.seed ? body.seed : randomBytes(8).toString('hex');
  const name = typeof body.name === 'string' && body.name ? body.name.slice(0, 40) : 'host';

  const id = randomUUID();
  const playerId = randomUUID();
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO matches (id, seed, scenario, turn, created_ms) VALUES (?, ?, ?, 0, ?)')
    .run(id, seed, scenario, nowMs());
  db.prepare('INSERT INTO players (match_id, player_id, name, token_hash, joined_ms) VALUES (?, ?, ?, ?, ?)')
    .run(id, playerId, name, sha(token), nowMs());
  res.status(201).json({ matchId: id, seed, scenario, playerId, token });
});

app.post('/v1/matches/:id/join', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  if (match.closed) { res.status(409).json({ error: 'match closed' }); return; }
  if (match.turn > 0) { res.status(409).json({ error: 'match already under way' }); return; }

  const body = req.body as { name?: unknown };
  const name = typeof body.name === 'string' && body.name ? body.name.slice(0, 40) : 'pilot';
  const playerId = randomUUID();
  const token = randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO players (match_id, player_id, name, token_hash, joined_ms) VALUES (?, ?, ?, ?, ?)')
    .run(match.id, playerId, name, sha(token), nowMs());
  publishTo(match.id, { type: 'playerJoined', matchId: match.id, playerId, name });
  res.status(201).json({ matchId: match.id, seed: match.seed, scenario: match.scenario, playerId, token });
});

app.get('/v1/matches/:id', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  const players = (many<PlayerRow>(q.players.all(match.id))).map(p => ({ playerId: p.player_id, name: p.name }));
  res.json({
    matchId: match.id, seed: match.seed, scenario: match.scenario,
    turn: match.turn, closed: !!match.closed, players,
  });
});

/**
 * Submit this player's orders for a turn. Idempotent: re-submitting the same
 * turn replaces the previous body, which is what a client that reconnects
 * mid-plan needs. Once every player is in, the turn is released and the socket
 * is told; a client that missed the push discovers it by polling the GET.
 */
app.post('/v1/matches/:id/turns/:turn/orders', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  const who = auth(req, match.id);
  if (!who) { res.status(401).json({ error: 'bad token' }); return; }

  const turn = Number(req.params.turn);
  if (!Number.isInteger(turn) || turn < 0) { res.status(400).json({ error: 'bad turn' }); return; }
  if (turn !== match.turn) {
    res.status(409).json({ error: 'wrong turn', expected: match.turn });
    return;
  }
  db.prepare(`INSERT INTO orders (match_id, turn, player_id, body, sent_ms) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(match_id, turn, player_id) DO UPDATE SET body = excluded.body, sent_ms = excluded.sent_ms`)
    .run(match.id, turn, who.player_id, JSON.stringify(req.body ?? {}), nowMs());

  const players = many<PlayerRow>(q.players.all(match.id));
  const submitted = many<OrderRow>(q.ordersFor.all(match.id, turn));
  const ready = submitted.length >= players.length && players.length > 0;
  if (ready) {
    db.prepare('UPDATE matches SET turn = ? WHERE id = ?').run(turn + 1, match.id);
    publishTo(match.id, { type: 'turnReady', matchId: match.id, turn });
  } else {
    publishTo(match.id, { type: 'ordersReceived', matchId: match.id, turn, playerId: who.player_id });
  }
  res.json({ ok: true, turn, ready, waitingOn: players.length - submitted.length });
});

/**
 * Fetch the turn's orders. Withheld until every player has submitted, so no
 * one can peek at an opponent's plan before committing their own: that is the
 * whole point of simultaneous turns.
 */
app.get('/v1/matches/:id/turns/:turn', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  if (!auth(req, match.id)) { res.status(401).json({ error: 'bad token' }); return; }

  const turn = Number(req.params.turn);
  const players = many<PlayerRow>(q.players.all(match.id));
  const rows = many<OrderRow>(q.ordersFor.all(match.id, turn));
  if (rows.length < players.length) {
    res.status(202).json({ ready: false, waitingOn: players.length - rows.length });
    return;
  }
  const orders: Record<string, unknown> = {};
  for (const r of rows) orders[r.player_id] = JSON.parse(r.body);
  res.json({ ready: true, turn, seed: match.seed, orders });
});

/**
 * Report the state hash this client computed after resolving a turn. The
 * server compares, it does not adjudicate: it cannot know which client is
 * right, only that they disagree, and disagreement is the signal that matters.
 */
app.post('/v1/matches/:id/turns/:turn/hash', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  const who = auth(req, match.id);
  if (!who) { res.status(401).json({ error: 'bad token' }); return; }

  const turn = Number(req.params.turn);
  const body = req.body as { hash?: unknown };
  if (typeof body.hash !== 'string' || !body.hash) { res.status(400).json({ error: 'hash required' }); return; }
  db.prepare(`INSERT INTO hashes (match_id, turn, player_id, hash, sent_ms) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(match_id, turn, player_id) DO UPDATE SET hash = excluded.hash, sent_ms = excluded.sent_ms`)
    .run(match.id, turn, who.player_id, body.hash, nowMs());

  const rows = many<HashRow>(q.hashesFor.all(match.id, turn));
  const distinct = [...new Set(rows.map(r => r.hash))];
  const diverged = distinct.length > 1;
  if (diverged) {
    publishTo(match.id, { type: 'diverged', matchId: match.id, turn, hashes: rows });
  }
  res.json({ ok: true, turn, reported: rows.length, diverged, distinct });
});

app.get('/v1/matches/:id/turns/:turn/hash', (req, res) => {
  const match = one<MatchRow>(q.match.get(req.params.id));
  if (!match) { res.status(404).json({ error: 'no such match' }); return; }
  const turn = Number(req.params.turn);
  const rows = many<HashRow>(q.hashesFor.all(match.id, turn));
  const distinct = [...new Set(rows.map(r => r.hash))];
  res.json({ turn, reported: rows.length, diverged: distinct.length > 1, hashes: rows });
});

// -------------------------------------------------------------- the client --
// One deploy target, not two. The same machine that brokers turns serves the
// page that plays them, which removes a whole second pipeline (Pages, its
// enablement, and its artifact quota) for a static bundle measured in
// hundreds of kilobytes.
const CLIENT_DIR = resolve(process.env['CLIENT_DIR'] ?? '../web/dist');
if (existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, {
    // WebAssembly.instantiateStreaming REFUSES a module served as anything
    // other than application/wasm, and fails at runtime rather than at build,
    // so the type is set here rather than trusted to a lookup table.
    setHeaders: (res, path) => {
      if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
      // The bundle is content addressed by its build, the shell is not.
      if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  // Anything not an API route, and not a file, is the app shell.
  app.get(/^(?!\/v1\/|\/healthz|\/ws).*/, (_req, res) => {
    res.sendFile(join(CLIENT_DIR, 'index.html'));
  });
} else {
  console.warn(`no client build at ${CLIENT_DIR}; serving the API only`);
}

// --------------------------------------------------------------------- boot --
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const params = new URL(req.url ?? '/', 'http://x').searchParams;
  const topic = params.get('match') ?? params.get('room') ?? '';
  if (!topic) { ws.close(1008, 'match or room required'); return; }
  let set = sockets.get(topic);
  if (!set) { set = new Set(); sockets.set(topic, set); }
  set.add(ws);
  ws.on('close', () => {
    set?.delete(ws);
    if (set && set.size === 0) sockets.delete(topic);
  });
});

export { app, server };

// Only listen when run directly, so tests can import the app without binding.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  server.listen(PORT, () => { console.log(`fallen-tribes api on :${PORT}`); });
}
