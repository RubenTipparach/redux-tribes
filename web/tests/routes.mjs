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
await page.waitForSelector('#briefing:not(.hidden)', { timeout: 10000 });
await page.click('#briefGo');
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

// ------------------------------------------------------- swapping a ship --

/**
 * The briefing: one card per ship the level seats, and a hull per card.
 *
 * The point of it is that a swap is per SHIP. One chooser above the levels
 * could only ever say "every hull I field is this one", which is not what
 * swapping a ship out means, and the check that matters is the one after the
 * launch: the ship you swapped is the design, and the ship beside it is still
 * what the level authored.
 */
await boot('/');
{
  const roster = async (level) => {
    await page.locator('#practiceList button', { hasText: level }).first().click();
    await page.waitForSelector('#briefing:not(.hidden)', { timeout: 10000 });
    await page.waitForTimeout(400);
    // Counted PER SIDE, because the briefing seats both now: a duel is one
    // each and a skirmish two each, and a total alone could not tell a duel
    // showing both sides from a skirmish showing only yours.
    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('#briefShips .briefRow')];
      return {
        mine: rows.filter(r => r.dataset.side === '0').length,
        foes: rows.filter(r => r.dataset.side === '1').length,
      };
    });
  };
  const duel = await roster('Duel');
  await page.click('#briefClose');
  await page.waitForTimeout(250);
  const skirmish = await roster('Skirmish');
  if (duel.mine !== 1 || duel.foes !== 1) {
    fail(`the duel briefing seats ${duel.mine} of yours and ${duel.foes} hostile(s), not 1 each`);
  } else if (skirmish.mine !== 2 || skirmish.foes !== 2) {
    fail(`the skirmish briefing seats ${skirmish.mine} and ${skirmish.foes}, not 2 each`);
  } else {
    ok(`a level says what it seats, both sides: duel ${duel.mine}v${duel.foes}, `
      + `skirmish ${skirmish.mine}v${skirmish.foes}`);
  }

  // Swap the SECOND ship of YOUR fleet only, if there is a design to swap in.
  const rows = page.locator('#briefShips .briefRow[data-side="0"]');
  const opts = await rows.nth(1).locator('.picks button .n').allTextContents();
  const swapTo = opts.find(t => t.startsWith('Route '));
  if (!swapTo) {
    fail(`no saved design offered in the briefing: ${opts.join(', ')}`);
  } else {
    await rows.nth(1).locator('.picks button', { hasText: swapTo }).click();
    await page.waitForTimeout(300);
    await page.click('#briefGo');
    await page.waitForFunction(
      () => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 20000 });
    await page.waitForTimeout(2000);
    const flown = await page.evaluate(() => {
      const side = window.ftDebug.side();
      return window.ftDebug.ships().filter(s => s.side === side).map(s => s.hull);
    });
    if (flown.length !== 2) fail(`fielded ${flown.length} hulls for a two ship level`);
    else if (flown[0] === flown[1]) {
      fail(`swapped one ship and both came out at ${flown[0]} hull points`);
    } else ok(`swapping one ship changes that ship only: ${flown[0]} and ${flown[1]} hull points`);
  }
}

// ------------------------------------------- a hull on the OTHER side too --

/**
 * Either side is pickable, and from anyone's library.
 *
 * The core's registry was always two sided; it was the screen that only
 * offered your own fleet. What this checks is the half that could silently
 * regress: a pick on a HOSTILE row reaching that hostile, and reaching only
 * it. A class hull is a round number (300, 250, 230, 195, 180) and a derived
 * design almost never is, so a fraction on exactly one hostile is the proof.
 */
await boot('/');
{
  await page.locator('#practiceList button', { hasText: 'Skirmish' }).first().click();
  await page.waitForSelector('#briefing:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(600);

  const sides = await page.evaluate(() =>
    [...document.querySelectorAll('#briefShips .briefRow')].map(r => r.dataset.side));
  if (!sides.includes('0') || !sides.includes('1')) {
    fail(`the briefing lists sides ${JSON.stringify(sides)}, not both`);
  } else ok(`the briefing seats both sides: ${sides.join(', ')}`);

  const foe = page.locator('#briefShips .briefRow[data-side="1"]').first();
  const opt = foe.locator('.picks button').nth(1);
  if (!(await opt.count())) {
    fail('no saved design offered on a hostile row');
  } else {
    await opt.click();
    await page.waitForTimeout(300);
    await page.click('#briefGo');
    await page.waitForFunction(
      () => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    const flown = await page.evaluate(() => {
      const side = window.ftDebug.side();
      const all = window.ftDebug.ships();
      return {
        ours: all.filter(s => s.side === side).map(s => s.hull),
        foes: all.filter(s => s.side !== side).map(s => s.hull),
      };
    });
    const derived = (h) => Math.abs(h - Math.round(h)) > 0.001;
    if (!flown.foes.some(derived)) {
      fail(`a design was put on a hostile and every hostile is still a class `
        + `hull: ${flown.foes.join(', ')}`);
    } else if (flown.foes.every(derived)) {
      fail(`the hostile pick reached every hostile, which is a uniform rather `
        + `than a swap: ${flown.foes.join(', ')}`);
    } else if (flown.ours.some(derived)) {
      fail(`a pick on a hostile changed OUR fleet too: ${flown.ours.join(', ')}`);
    } else {
      ok(`a hull fields on the other side: ours ${flown.ours.join(', ')}, `
        + `foes ${flown.foes.map(h => h.toFixed(2)).join(', ')}`);
    }
  }
}

// --------------------------------------------------- the briefing, on a phone --

/**
 * The briefing is a new panel, so it is checked the way every panel here is:
 * at both phone sizes, for a page that does not scroll sideways and for taps
 * that ARRIVE. A modal is the easy way to draw a control nothing can press,
 * because it sits over a lobby that is still there underneath it.
 */
for (const size of [{ w: 390, h: 844, name: 'phone 390x844' },
                    { w: 390, h: 560, name: 'phone landscape 390x560' }]) {
  const pctx = await browser.newContext({
    viewport: { width: size.w, height: size.h }, hasTouch: true, isMobile: true,
  });
  const p2 = await pctx.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#practiceList button', { timeout: 20000 });
  await p2.locator('#practiceList button', { hasText: 'Skirmish' }).first().click();
  await p2.waitForSelector('#briefing:not(.hidden)', { timeout: 10000 });
  await p2.waitForTimeout(400);

  const wide = await p2.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 1) fail(`${size.name}: the briefing scrolls ${wide}px sideways`);
  else ok(`${size.name}: the briefing fits, no horizontal scroll`);

  // Launch and Close have to be there without scrolling: a roster of a dozen
  // hulls is taller than the screen, and a Launch button below all of them is
  // a button a player has to go looking for. The picks may be scrolled to,
  // which is what the roster area is for; what is checked of them is that the
  // tap ARRIVES once they are on screen.
  const blocked = await p2.evaluate(() => {
    const bad = [];
    const hits = (el) => {
      const r = el.getBoundingClientRect();
      const name = el.id || el.textContent.trim().slice(0, 20);
      if (r.width < 1 || r.height < 1) return 'not drawn: ' + name;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return 'offscreen: ' + name;
      let hit = document.elementFromPoint(x, y);
      while (hit) { if (hit === el) return null; hit = hit.parentElement; }
      return 'covered: ' + name;
    };
    for (const id of ['briefGo', 'briefClose']) {
      const why = hits(document.getElementById(id));
      if (why) bad.push(why);
    }
    const picks = [...document.querySelectorAll('#briefShips .picks button')];
    for (const el of picks) {
      el.scrollIntoView({ block: 'center' });
      const why = hits(el);
      if (why) bad.push(why);
    }
    return { bad, n: picks.length + 2 };
  });
  if (blocked.bad.length) {
    fail(`${size.name}: ${blocked.bad.length} briefing control(s) do not take a tap: `
      + blocked.bad.join(', '));
  } else ok(`${size.name}: all ${blocked.n} briefing controls take a tap`);
  await pctx.close();
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
