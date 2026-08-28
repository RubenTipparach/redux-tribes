// The lockstep contract, end to end. What matters here is not that routes
// return 200 but that the server WITHHOLDS a turn until every player has
// committed (no peeking at an opponent's plan) and that it NOTICES when two
// clients report different state hashes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let proc, base, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ft-api-'));
  const port = 8300 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: join(dir, 'test.db') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('api did not come up');
});

after(() => { proc?.kill(); rmSync(dir, { recursive: true, force: true }); });

const as = (p) => ({ 'content-type': 'application/json', authorization: `Bearer ${p.token}`, 'x-player-id': p.playerId });
const post = (u, body, headers = {}) =>
  fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('a match holds its turn until every player has committed', async () => {
  const host = await (await post('/v1/matches', { name: 'host', scenario: 'skirmish' })).json();
  assert.ok(host.matchId && host.token && host.seed);
  const guest = await (await post(`/v1/matches/${host.matchId}/join`, { name: 'guest' })).json();
  assert.equal(guest.seed, host.seed, 'both players must start from the same seed');

  // host commits first: the turn must NOT be released
  const r1 = await (await post(`/v1/matches/${host.matchId}/turns/0/orders`, { P1: { mode: 0 } }, as(host))).json();
  assert.equal(r1.ready, false);
  assert.equal(r1.waitingOn, 1);

  const peek = await fetch(`${base}/v1/matches/${host.matchId}/turns/0`, { headers: as(guest) });
  assert.equal(peek.status, 202, 'orders must be withheld while a player is still planning');
  assert.equal((await peek.json()).ready, false);

  // guest commits: now it releases
  const r2 = await (await post(`/v1/matches/${host.matchId}/turns/0/orders`, { E1: { mode: 1 } }, as(guest))).json();
  assert.equal(r2.ready, true);

  const got = await (await fetch(`${base}/v1/matches/${host.matchId}/turns/0`, { headers: as(host) })).json();
  assert.equal(got.ready, true);
  assert.equal(Object.keys(got.orders).length, 2, 'both players orders come back together');
  assert.equal(got.seed, host.seed);

  const state = await (await fetch(`${base}/v1/matches/${host.matchId}`)).json();
  assert.equal(state.turn, 1, 'the match advances once the turn is released');
});

test('divergent state hashes are detected', async () => {
  const host = await (await post('/v1/matches', { name: 'host' })).json();
  const guest = await (await post(`/v1/matches/${host.matchId}/join`, { name: 'guest' })).json();
  await post(`/v1/matches/${host.matchId}/turns/0/orders`, {}, as(host));
  await post(`/v1/matches/${host.matchId}/turns/0/orders`, {}, as(guest));

  const agree = await (await post(`/v1/matches/${host.matchId}/turns/0/hash`, { hash: 'aaaa1111' }, as(host))).json();
  assert.equal(agree.diverged, false, 'one report cannot diverge from itself');

  const clash = await (await post(`/v1/matches/${host.matchId}/turns/0/hash`, { hash: 'bbbb2222' }, as(guest))).json();
  assert.equal(clash.diverged, true, 'two clients reporting different hashes is a divergence');
  assert.equal(clash.distinct.length, 2);

  // and agreeing clients are not flagged
  const m2 = await (await post('/v1/matches', { name: 'a' })).json();
  const g2 = await (await post(`/v1/matches/${m2.matchId}/join`, { name: 'b' })).json();
  await post(`/v1/matches/${m2.matchId}/turns/0/hash`, { hash: 'same' }, as(m2));
  const ok = await (await post(`/v1/matches/${m2.matchId}/turns/0/hash`, { hash: 'same' }, as(g2))).json();
  assert.equal(ok.diverged, false);
});

test('a bad token cannot submit or read orders', async () => {
  const host = await (await post('/v1/matches', { name: 'host' })).json();
  const forged = { playerId: host.playerId, token: 'not-the-token' };
  assert.equal((await post(`/v1/matches/${host.matchId}/turns/0/orders`, {}, as(forged))).status, 401);
  assert.equal((await fetch(`${base}/v1/matches/${host.matchId}/turns/0`, { headers: as(forged) })).status, 401);
});

test('orders for the wrong turn are refused', async () => {
  const host = await (await post('/v1/matches', { name: 'host' })).json();
  const r = await post(`/v1/matches/${host.matchId}/turns/7/orders`, {}, as(host));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).expected, 0);
});

test('a plan can be revised while still secret, and is locked once released', async () => {
  const host = await (await post('/v1/matches', { name: 'host' })).json();
  const guest = await (await post(`/v1/matches/${host.matchId}/join`, { name: 'guest' })).json();

  // still waiting on the guest, so the host's plan is private and revisable:
  // this is what a client that reconnects mid-plan depends on
  await post(`/v1/matches/${host.matchId}/turns/0/orders`, { v: 1 }, as(host));
  const revised = await (await post(`/v1/matches/${host.matchId}/turns/0/orders`, { v: 2 }, as(host))).json();
  assert.equal(revised.ready, false);
  assert.equal(revised.waitingOn, 1, 'a revision must not count as a second player');

  await post(`/v1/matches/${host.matchId}/turns/0/orders`, { v: 9 }, as(guest));
  const got = await (await fetch(`${base}/v1/matches/${host.matchId}/turns/0`, { headers: as(host) })).json();
  assert.equal(got.orders[host.playerId].v, 2, 'the last revision before release is the one that counts');

  // released: the turn has advanced, so the same submission is now refused.
  // Allowing it would let a player rewrite a plan an opponent has already seen.
  const late = await post(`/v1/matches/${host.matchId}/turns/0/orders`, { v: 3 }, as(host));
  assert.equal(late.status, 409, 'orders are locked once the turn is released');
  assert.equal((await late.json()).expected, 1);
});

// ------------------------------------------------------------------ lobby --
// Anonymous sign in, rooms, and the handoff into a match. The properties that
// matter are the ones a lobby gets wrong quietly: a room that seats more people
// than it has seats, a guest who can start someone else's match, a reload that
// loses your seat, and a guest who reaches a started match without ever being
// handed credentials for it.

const asAccount = (a) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${a.token}`,
  'x-account-id': a.accountId,
});
const signIn = async (name) => (await post('/v1/accounts', name ? { name } : {})).json();

test('anonymous sign in gives a usable identity with no credentials asked for', async () => {
  const me = await signIn();
  assert.match(me.accountId, /^[0-9a-f-]{36}$/);
  assert.ok(me.token.length > 20);
  assert.ok(me.name.length > 0, 'an unnamed account still gets a callsign');

  const seen = await (await fetch(`${base}/v1/accounts/me`, { headers: asAccount(me) })).json();
  assert.equal(seen.accountId, me.accountId);

  const anon = await fetch(`${base}/v1/accounts/me`);
  assert.equal(anon.status, 401, 'no headers is not an identity');

  const forged = await fetch(`${base}/v1/accounts/me`, {
    headers: { authorization: 'Bearer not-the-token', 'x-account-id': me.accountId },
  });
  assert.equal(forged.status, 401, 'knowing an id is not knowing the secret');
});

test('a pve room seats one person and starts alone', async () => {
  const me = await signIn('Solo');
  const room = await (await post('/v1/rooms', { mode: 'pve', name: 'drill' }, asAccount(me))).json();
  assert.equal(room.mode, 'pve');
  assert.equal(room.capacity, 1);
  assert.equal(room.humanSides, 0b01, 'the AI flies side 1, and the core is told so');
  assert.equal(room.seats.length, 1);
  assert.equal(room.seats[0].side, 0, 'the host takes side 0');

  const early = await post(`/v1/rooms/${room.roomId}/start`, {}, asAccount(me));
  assert.equal(early.status, 409, 'not ready is not startable');

  await post(`/v1/rooms/${room.roomId}/ready`, { ready: true }, asAccount(me));
  const started = await (await post(`/v1/rooms/${room.roomId}/start`, {}, asAccount(me))).json();
  assert.equal(started.status, 'playing');
  assert.ok(started.matchId);
  assert.ok(started.matchToken, 'the host is handed match credentials');

  // A solo match releases its turn on one commit, because the AI's orders were
  // never going to arrive over the wire.
  const seat = { playerId: me.accountId, token: started.matchToken };
  const r = await (await post(`/v1/matches/${started.matchId}/turns/0/orders`, { moves: [] }, as(seat))).json();
  assert.equal(r.ready, true, 'one seat, one commit, turn released');
});

test('a pvp room fills, refuses a third, and only the host starts it', async () => {
  const host = await signIn('Host');
  const guest = await signIn('Guest');
  const third = await signIn('Third');

  const room = await (await post('/v1/rooms', { mode: 'pvp', name: 'versus' }, asAccount(host))).json();
  assert.equal(room.capacity, 2);
  assert.equal(room.humanSides, 0b11, 'both sides are people, so no AI plans either');

  const open = await (await fetch(`${base}/v1/rooms`)).json();
  assert.ok(open.rooms.some(r => r.roomId === room.roomId), 'an open room is listed in the lobby');

  const joined = await (await post(`/v1/rooms/${room.roomId}/join`, {}, asAccount(guest))).json();
  assert.equal(joined.seats.length, 2);
  assert.deepEqual(joined.seats.map(s => s.side).sort(), [0, 1], 'seats are distinct sides');

  // A reload must put you back in your seat, not tell you the room is full of
  // yourself.
  const again = await post(`/v1/rooms/${room.roomId}/join`, {}, asAccount(guest));
  assert.equal(again.status, 200);

  const full = await post(`/v1/rooms/${room.roomId}/join`, {}, asAccount(third));
  assert.equal(full.status, 409, 'a two seat room seats two');

  await post(`/v1/rooms/${room.roomId}/ready`, { ready: true }, asAccount(host));
  const half = await post(`/v1/rooms/${room.roomId}/start`, {}, asAccount(host));
  assert.equal(half.status, 409, 'one ready is not everyone ready');

  await post(`/v1/rooms/${room.roomId}/ready`, { ready: true }, asAccount(guest));
  const notHost = await post(`/v1/rooms/${room.roomId}/start`, {}, asAccount(guest));
  assert.equal(notHost.status, 403, 'a guest cannot start the match');

  const started = await (await post(`/v1/rooms/${room.roomId}/start`, {}, asAccount(host))).json();
  assert.equal(started.status, 'playing');

  // The guest never saw the host's response, so it collects its own ticket.
  const ticket = await (await post(`/v1/rooms/${room.roomId}/ticket`, {}, asAccount(guest))).json();
  assert.equal(ticket.matchId, started.matchId);
  assert.equal(ticket.seed, started.seed, 'both seats start from one seed');
  assert.equal(ticket.side, 1);
  assert.equal(ticket.humanSides, 0b11);

  const stranger = await post(`/v1/rooms/${room.roomId}/ticket`, {}, asAccount(third));
  assert.equal(stranger.status, 403, 'a ticket is for people who were seated');

  // And the match itself now behaves as a two player lockstep match.
  const hostSeat = { playerId: host.accountId, token: started.matchToken };
  const guestSeat = { playerId: guest.accountId, token: ticket.token };
  const first = await (await post(`/v1/matches/${started.matchId}/turns/0/orders`, { a: 1 }, as(hostSeat))).json();
  assert.equal(first.ready, false, 'one of two is not a released turn');
  const peek = await fetch(`${base}/v1/matches/${started.matchId}/turns/0`, { headers: as(guestSeat) });
  assert.equal(peek.status, 202, 'and the opponent cannot read a plan before committing');
  const second = await (await post(`/v1/matches/${started.matchId}/turns/0/orders`, { b: 2 }, as(guestSeat))).json();
  assert.equal(second.ready, true);
});

test('leaving frees the seat, and the last one out closes the room', async () => {
  const host = await signIn('Leaver');
  const guest = await signIn('Stayer');
  const room = await (await post('/v1/rooms', { mode: 'pvp' }, asAccount(host))).json();
  await post(`/v1/rooms/${room.roomId}/join`, {}, asAccount(guest));

  const afterLeave = await (await post(`/v1/rooms/${room.roomId}/leave`, {}, asAccount(host))).json();
  assert.equal(afterLeave.closed, false, 'a room with someone still in it stays open');
  assert.equal(afterLeave.room.seats.length, 1);
  assert.equal(afterLeave.room.hostId, guest.accountId, 'the host role passes to whoever is left');

  const empty = await (await post(`/v1/rooms/${room.roomId}/leave`, {}, asAccount(guest))).json();
  assert.equal(empty.closed, true, 'an empty room is litter, so it goes');
  assert.equal((await fetch(`${base}/v1/rooms/${room.roomId}`)).status, 404);
});
