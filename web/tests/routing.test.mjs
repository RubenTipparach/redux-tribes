// Addresses, and the games behind them.
//
// Two modules with one job between them: a screen you are on should be a place
// you can reload into. The router turns a path into a screen and back; the save
// shelf is what makes a local game something a path can still name tomorrow.
//
// Both are pure enough to test off a browser, which is the point of them being
// their own modules: what they decide is not tangled up with what draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** A localStorage that behaves like one, since node has none. */
class Store {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
  get size() { return [...this.#m.values()].reduce((a, v) => a + v.length, 0); }
}
globalThis.localStorage = new Store();

const load = async (entry) => {
  const out = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
  });
  return import('data:text/javascript;base64,'
    + Buffer.from(out.outputFiles[0].text).toString('base64'));
};

const route = await load('src/app/route.ts');
const saves = await load('src/app/saves.ts');

test('every route survives the round trip through a path', () => {
  const cases = [
    { kind: 'lobby' },
    { kind: 'play', gameId: 'abc123' },
    { kind: 'room', roomId: 'r-9' },
    { kind: 'ship' },
    { kind: 'ship', designId: 'd_42' },
  ];
  for (const r of cases) {
    assert.deepEqual(route.parse(route.href(r)), r, `${JSON.stringify(r)}`);
  }
});

test('a path nobody recognises is the lobby, not a blank screen', () => {
  // Including the ones that matter: a stale link, somebody else's app, and the
  // shapes an id must not take. Landing on the lobby is recoverable; landing
  // on a lookup for a thing that cannot exist is not.
  for (const p of ['/', '', '/nope', '/play', '/play/', '/room', '/ship/a/b/c',
    '/play/../etc', '/play/' + 'x'.repeat(200), '/PLAY/abc']) {
    assert.equal(route.parse(p).kind, 'lobby', p);
  }
});

test('trailing slashes and escapes do not make a second address', () => {
  assert.deepEqual(route.parse('/play/abc/'), { kind: 'play', gameId: 'abc' });
  assert.deepEqual(route.parse('/ship/'), { kind: 'ship' });
  assert.ok(route.same({ kind: 'play', gameId: 'a' }, route.parse('/play/a/')));
  assert.ok(!route.same({ kind: 'play', gameId: 'a' }, { kind: 'play', gameId: 'b' }));
});

test('an id is minted unique and is safe in a path', () => {
  const seen = new Set();
  for (let n = 0; n < 400; n++) {
    const id = route.newId();
    assert.ok(/^[a-z0-9]+$/.test(id), id);
    assert.equal(route.parse(`/play/${id}`).gameId, id);
    seen.add(id);
  }
  assert.equal(seen.size, 400, 'two games started together must not collide');
});

test('a game is on the shelf from the moment it starts', () => {
  // The whole point: a refresh on turn zero is still a game somebody started.
  const g = saves.create({
    id: 'g1', name: 'Skirmish', seed: 'deadbeefcafe0001',
    scenario: 'skirmish', humanSides: 1, side: 0,
  });
  assert.equal(g.turns.length, 0);
  const back = saves.load('g1');
  assert.ok(back);
  assert.equal(back.seed, 'deadbeefcafe0001');
  assert.equal(back.turns.length, 0);
});

test('turns are recorded by index, so a rewind does not stack two histories', () => {
  saves.create({ id: 'g2', name: 'Duel', seed: 'a', scenario: 'duel', humanSides: 1, side: 0 });
  saves.recordTurn('g2', 0, { 0: { mode: 0, weapons: [] } });
  saves.recordTurn('g2', 1, { 0: { mode: 1, weapons: [] } });
  saves.recordTurn('g2', 2, { 0: { mode: 2, weapons: [] } });
  assert.equal(saves.load('g2').turns.length, 3);
  // Rewound to turn 1 and played differently: the old turn 2 is gone rather
  // than sitting behind the new one.
  saves.recordTurn('g2', 1, { 0: { mode: 3, weapons: [] } });
  const g = saves.load('g2');
  assert.equal(g.turns.length, 2);
  assert.equal(g.turns[1][0].mode, 3);
});

test('a game saved when a hull was per side comes back as a hull per ship', () => {
  // The shape changed under games that were already on somebody's shelf. Old
  // `hull` meant every ship this side fields, so it has to come back filling
  // the slots: a resume replays its orders, and a fleet one ship short of what
  // those orders were given to plays a different match that looks the same.
  localStorage.setItem('ft.games.v1', JSON.stringify({
    old1: {
      id: 'old1', name: 'Skirmish, in Bulwark', seed: 'c', scenario: 'skirmish',
      humanSides: 1, side: 0, turns: [], startedMs: 1, updatedMs: 1, seq: 99,
      hull: { classKey: 'terran_frigate' }, hullName: 'Bulwark',
    },
  }));
  const g = saves.load('old1');
  assert.ok(g.hulls, 'an old save should read as hulls');
  assert.equal(g.hulls.length, 4);
  for (const h of g.hulls) {
    assert.equal(h.name, 'Bulwark');
    assert.deepEqual(h.design, { classKey: 'terran_frigate' });
  }
  saves.remove('old1');
});

test('an outcome sticks, and a forgotten game is gone', () => {
  saves.create({ id: 'g3', name: 'X', seed: 'b', scenario: 'skirmish', humanSides: 1, side: 0 });
  saves.finish('g3', 'won');
  assert.equal(saves.load('g3').outcome, 'won');
  saves.remove('g3');
  assert.equal(saves.load('g3'), null);
  // And recording against a game that is gone is a no-op rather than a throw:
  // a turn resolving after the shelf was cleared in another tab must not take
  // the match down with it.
  saves.recordTurn('g3', 0, {});
  saves.finish('g3', 'lost');
  assert.equal(saves.load('g3'), null);
});

test('the shelf is a shelf: the newest stay and the oldest fall off', () => {
  localStorage.removeItem('ft.games.v1');
  for (let n = 0; n < 30; n++) {
    saves.create({ id: `k${n}`, name: `game ${n}`, seed: 'c',
      scenario: 'skirmish', humanSides: 1, side: 0 });
  }
  const rows = saves.list();
  assert.ok(rows.length <= 12, `kept ${rows.length}`);
  // Newest first, and the newest is the one that was made last.
  assert.equal(rows[0].id, 'k29');
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].updatedMs >= r.updatedMs));
});

test('a corrupt shelf reads as an empty one rather than throwing', () => {
  // Whatever else went wrong, a bad blob in storage must not stop the page
  // booting: the lobby is the one screen everything falls back to.
  localStorage.setItem('ft.games.v1', 'not json at all');
  assert.deepEqual(saves.list(), []);
  assert.equal(saves.load('anything'), null);
  localStorage.setItem('ft.games.v1', '[1,2,3]');
  assert.equal(saves.load('anything'), null);
});
