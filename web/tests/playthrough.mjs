/**
 * Play the game to a win, through the real UI.
 *
 * The headless suites prove the model. They cannot prove the GAME is playable,
 * because "can a person actually reach a victory" is a question about buttons,
 * sheets and gestures, not about the resolver. Two defects that shipped were
 * invisible to every other suite for exactly that reason: a scrubber that
 * trapped the app in playback with no way back to planning, and a bottom sheet
 * that covered the fire slots so a queued shot could not be placed on a phone.
 *
 * So this drives the actual console: taps a hostile to target it, arms each
 * mount, drops it in a fire slot, ends the turn, watches the playback out, and
 * repeats until the header says VICTORY. Nothing here reaches into app state to
 * make progress; ftDebug is read only and used only to observe.
 *
 *   node web/tests/playthrough.mjs [url] [--mobile]
 *
 * Exits non zero if the match cannot be won, which is the point.
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const URL = process.argv.find(a => a.startsWith('http')) ?? 'http://127.0.0.1:8123/';
const MOBILE = process.argv.includes('--mobile');
const MAX_TURNS = 40;

const VIEWPORT = MOBILE
  ? { width: 390, height: 844 }
  : { width: 1200, height: 860 };

const log = (...a) => console.log(...a);

const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: VIEWPORT, hasTouch: MOBILE, isMobile: MOBILE });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const tap = async (sel) => { const l = page.locator(sel); await (MOBILE ? l.tap() : l.click()); };

/** On a phone the fleet rail is a sheet; open or close it as needed. */
async function sheet(open) {
  if (!MOBILE) return;
  const isOpen = await page.evaluate(() => document.getElementById('left').classList.contains('open'));
  if (isOpen !== open) { await tap('#tShips'); await page.waitForTimeout(280); }
}

const state = () => page.evaluate(() => ({
  turn: Number(document.getElementById('hTurn').textContent),
  phase: document.getElementById('hPhase').textContent,
  playTick: window.ftDebug.playing(),
  target: window.ftDebug.target(),
  canPlan: window.ftDebug.canPlan(),
  mine: [...document.querySelectorAll('#fleet .shipRow')].map(r => ({
    name: r.querySelector('.nm').textContent.trim(), gone: r.classList.contains('gone') })),
  foes: [...document.querySelectorAll('#hostiles .shipRow')].map(r => ({
    name: r.querySelector('.nm').textContent.trim(), gone: r.classList.contains('gone') })),
}));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#lobby:not(.hidden)');
await page.waitForFunction(() => document.getElementById('whoName').textContent !== '...');
await tap('#bPractice');
await page.waitForFunction(() => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 20000 });
await page.waitForTimeout(2000);

log(`playing at ${VIEWPORT.width}x${VIEWPORT.height}${MOBILE ? ' (touch)' : ''}`);

let shotsQueued = 0;
let outcome = 'ran out of turns';

for (let t = 0; t < MAX_TURNS; t++) {
  const s = await state();
  if (s.phase === 'VICTORY' || s.phase === 'DEFEAT') { outcome = s.phase; break; }

  await sheet(true);

  // Aim at the first hostile still alive, chosen through the hostile list the
  // way a player does rather than left to whatever the client defaults to.
  const foes = page.locator('#hostiles .shipRow:not(.gone)');
  const foeCount = await foes.count();
  if (foeCount === 0) { outcome = 'no hostiles left'; break; }
  await (MOBILE ? foes.first().tap() : foes.first().click());
  await page.waitForTimeout(150);

  // Every living ship of mine fires everything it has.
  const mineRows = page.locator('#fleet .shipRow:not(.gone)');
  const mineCount = await mineRows.count();
  let queuedThisTurn = 0;
  for (let i = 0; i < mineCount; i++) {
    await sheet(true);
    const row = page.locator('#fleet .shipRow:not(.gone)').nth(i);
    if (!(await row.count())) continue;
    await (MOBILE ? row.tap() : row.click());
    await page.waitForTimeout(150);
    if (!(await page.evaluate(() => window.ftDebug.canPlan()))) continue;

    // Board when the core says it is allowed. It ends a match faster than guns.
    const board = page.locator('#bBoard');
    if (!(await board.isDisabled())) {
      await (MOBILE ? board.tap() : board.click());
      await page.waitForTimeout(150);
    }

    const weps = page.locator('#weps .wrow:not(.spent)');
    const n = await weps.count();
    for (let w = 0; w < n; w++) {
      const wep = page.locator('#weps .wrow:not(.spent)').nth(w);
      if (!(await wep.count())) break;
      await (MOBILE ? wep.tap() : wep.click());
      await page.waitForTimeout(120);
      // Spread the shots across the ten seconds of the turn.
      const slot = page.locator('#slots .slot').nth(Math.min(9, 1 + w * 3));
      await (MOBILE ? slot.tap() : slot.click());
      await page.waitForTimeout(120);
    }
    const order = await page.evaluate(() => window.ftDebug.order());
    queuedThisTurn += order?.weapons?.length ?? 0;
  }
  shotsQueued += queuedThisTurn;

  await sheet(false);
  const endBtn = page.locator('#bEnd');
  if (await endBtn.isDisabled()) { outcome = 'End Turn was disabled while planning'; break; }
  await tap('#bEnd');

  // Playback must run out and hand control back. A turn that never returns to
  // planning is the freeze this harness exists to catch.
  try {
    await page.waitForFunction(() => window.ftDebug.playing() === null, null, { timeout: 45000 });
  } catch {
    outcome = `playback never finished on turn ${s.turn}`;
    break;
  }
  const after = await state();
  log(`  turn ${String(s.turn).padStart(2)} -> ${String(after.turn).padStart(2)}`
    + `  shots ${String(queuedThisTurn).padStart(2)}`
    + `  mine ${after.mine.filter(x => !x.gone).length}/${after.mine.length}`
    + `  foes ${after.foes.filter(x => !x.gone).length}/${after.foes.length}`
    + `  ${after.phase}`);
  if (after.phase === 'VICTORY' || after.phase === 'DEFEAT') { outcome = after.phase; break; }
}

const final = await state();
log('');
log('outcome        :', outcome);
log('final phase    :', final.phase);
log('turns played   :', final.turn);
log('shots queued   :', shotsQueued);
log('my ships       :', final.mine.map(m => `${m.name}${m.gone ? ' (lost)' : ''}`).join(', '));
log('hostiles       :', final.foes.map(m => `${m.name}${m.gone ? ' (lost)' : ''}`).join(', '));
log('page errors    :', errors.length ? errors : 'none');

await page.screenshot({ path: MOBILE ? '/tmp/playthrough-mobile.png' : '/tmp/playthrough.png' });
await browser.close();

const won = final.phase === 'VICTORY';
if (!won || errors.length) {
  console.error(`\nFAIL: ${won ? 'page errors' : 'the match was not won'}`);
  process.exit(1);
}
console.log('\nPASS: played through to a victory.');
