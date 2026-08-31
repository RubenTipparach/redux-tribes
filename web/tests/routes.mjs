/**
 * Addresses, driven in a real browser.
 *
 * Every screen has a path now, and the whole point of that is a reload: a game
 * you are forty turns into, a room you are sitting in, a design you are
 * editing. None of that is a question the unit suites can answer, because all
 * of it is about what a fresh page load does with a URL, and the one that
 * matters most, "is this the same match I was in", can only be answered by
 * comparing a match to itself across a navigation.
 *
 *   node web/tests/routes.mjs        # against a server on 8123
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = process.env.BASE ?? 'http://localhost:8123';
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); failures++; };
const ok = (msg) => console.log('  ok   ' + msg);

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));

const path = () => new URL(page.url()).pathname;

/** Load a URL and wait for the app to be up. A page that boots no further than
 *  its own markup is the failure this harness was written for: on a deep path
 *  a relative script src asks for `/play/main.js`, which the shell route
 *  answers with HTML. */
async function boot(p) {
  await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.getElementById('whoName')?.textContent !== '...', null, { timeout: 20000 });
  await page.waitForTimeout(1200);
}

const settle = () => page.waitForFunction(
  () => document.getElementById('hPhase').textContent === 'PLANNING', null, { timeout: 60000 });

/** Everything about the match that a resume has to reproduce. Ships by their
 *  own numbers, because "same turn" alone would pass on a match restarted. */
const matchState = () => page.evaluate(() => ({
  turn: Number(document.getElementById('hTurn').textContent),
  ships: window.ftDebug.ships().map(s => Object.keys(s).sort()
    .filter(k => typeof s[k] === 'number').map(k => `${k}=${s[k].toFixed(3)}`).join(',')),
  lobbyUp: !document.getElementById('lobby').classList.contains('hidden'),
}));

// --------------------------------------------------------------- the lobby --

await boot('/');
if (path() !== '/') fail(`booting at / landed on ${path()}`);
else ok('the lobby is /');

// ------------------------------------------------------------- a new game --

await page.click('#bPractice');
await page.waitForFunction(
  () => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 20000 });
await page.waitForTimeout(1500);
const gamePath = path();
if (!/^\/play\/[a-z0-9]+$/.test(gamePath)) fail(`starting a game left the address at ${gamePath}`);
else ok(`a new game gets an address of its own: ${gamePath}`);

for (let n = 0; n < 2; n++) {
  await page.click('#bEnd');
  await page.waitForTimeout(500);
  await settle();
}
const before = await matchState();
if (before.turn < 2) fail(`played two turns and the header says turn ${before.turn}`);

// ---------------------------------------------------------------- a reload --

await boot(gamePath);
const after = await matchState();
if (after.lobbyUp) fail('reloading a game landed on the lobby');
else if (after.turn !== before.turn) {
  fail(`the game came back on turn ${after.turn} rather than ${before.turn}`);
} else if (JSON.stringify(after.ships) !== JSON.stringify(before.ships)) {
  fail('the game came back on the right turn with different ships in it');
} else {
  ok(`a reload resumes the same match: turn ${after.turn}, ${after.ships.length} hulls identical`);
}

// The lobby offers it back, for a player who lost the address too.
await boot('/');
const listed = await page.evaluate(() =>
  [...document.querySelectorAll('#savedList .roomRow')].map(r => r.querySelector('.t').textContent));
if (!listed.length) fail('a game in progress is not offered in the lobby');
else ok(`the lobby offers it back: ${JSON.stringify(listed)}`);

// And tapping it goes back to the same address rather than starting another.
await page.click('#savedList .roomRow');
await page.waitForTimeout(1800);
if (path() !== gamePath) fail(`carrying on went to ${path()} rather than ${gamePath}`);
else ok('carrying on returns to the same address');

// ------------------------------------------------------- an address that lies --

await boot('/play/doesnotexist');
const lost = await page.evaluate(() =>
  !document.getElementById('lobby').classList.contains('hidden'));
if (!lost) fail('a game that is gone left the player on a game screen');
else if (path() !== '/') fail(`a game that is gone left the address at ${path()}`);
else ok('an address naming a game that is gone falls back to the lobby and says so');

// ------------------------------------------------------------- the shipyard --

await boot('/');
await page.click('#bShipyard');
await page.waitForTimeout(800);
if (path() !== '/ship') fail(`opening the shipyard left the address at ${path()}`);
else ok('the shipyard is /ship');

const name = `Route ${Date.now().toString(36)}`;
await page.click('#dzSave');
await page.waitForTimeout(300);
await page.fill('#dzSaveName', name);
await page.click('#dzSaveGo');
await page.waitForTimeout(1500);
const slot = await page.evaluate(() => window.ftDebug.designer().slot);
if (!slot.designId) {
  fail('could not save a design, so the design address cannot be checked');
} else {
  await boot(`/ship/${slot.designId}`);
  const open = await page.evaluate(() => ({
    up: !document.getElementById('designer').classList.contains('hidden'),
    slot: window.ftDebug.designer().slot,
  }));
  if (!open.up) fail('a design address did not open the shipyard');
  else if (open.slot.designId !== slot.designId) {
    fail(`/ship/${slot.designId} opened design ${open.slot.designId}`);
  } else ok(`a design has an address that reloads into it: /ship/${slot.designId}`);
}

// ----------------------------------------------------------------- a room --

await boot('/');
await page.click('#bNewPve');
await page.waitForTimeout(1500);
const roomPath = path();
if (!/^\/room\/.+/.test(roomPath)) {
  fail(`creating a room left the address at ${roomPath}`);
} else {
  ok(`a room gets an address: ${roomPath}`);
  await boot(roomPath);
  const inRoom = await page.evaluate(() =>
    getComputedStyle(document.getElementById('roomPanel')).display !== 'none');
  if (!inRoom) fail('reloading a room address did not put the player back in the room');
  else ok('a reload puts the player back in the room');
}

// ------------------------------------------------------------------ Back --

await boot('/');
await page.click('#bShipyard');
await page.waitForTimeout(700);
await page.goBack();
await page.waitForTimeout(900);
if (path() !== '/') fail(`Back from the shipyard went to ${path()}`);
else if (await page.evaluate(() =>
  !document.getElementById('designer').classList.contains('hidden'))) {
  fail('Back changed the address and left the shipyard on screen');
} else ok('Back walks the screens rather than leaving the address behind');

if (errs.length) for (const e of errs.slice(0, 4)) fail(`page error: ${e}`);
else ok('no page errors');

await browser.close();
console.log(failures
  ? `\nFAIL: ${failures} problem${failures === 1 ? '' : 's'} with the addresses.`
  : '\nPASS: every screen has an address, and a reload lands back on it.');
process.exit(failures ? 1 : 0);
