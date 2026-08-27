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
