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
 * So this drives the actual console: taps a hostile to target it, opens a fire
 * slot, queues a mount from the list it offers, ends the turn, watches the
 * playback out, and repeats until the header says VICTORY. Nothing here reaches into app state to
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
/**
 * Each practice match rolls a fresh seed, and the AI boards and shoots back,
 * so a single match can be lost on its merits. The property under test is
 * "a person can reach a victory through this UI", not "this seed is winnable",
 * so a loss retries with a new match and only a clean sweep of losses fails.
 */
const ATTEMPTS = Number(process.env.PLAYTHROUGH_ATTEMPTS ?? 3);

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

log(`playing at ${VIEWPORT.width}x${VIEWPORT.height}${MOBILE ? ' (touch)' : ''}`);

let shotsQueued = 0;
let outcome = 'ran out of turns';
let final = null;

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  if (attempt > 1) log(`\n  lost that one, starting a fresh match (attempt ${attempt} of ${ATTEMPTS})`);
  shotsQueued = 0;
  outcome = 'ran out of turns';
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('whoName').textContent !== '...');
  await tap('#bPractice');
  await page.waitForFunction(() => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  if (attempt === 1) await checkNothingIsBuried();

  outcome = await playMatch();
  final = await state();
  if (final.phase === 'VICTORY') break;
}

/**
 * Nothing a player needs may sit UNDER a sheet.
 *
 * This defect has landed twice and looks identical both times: a control is
 * drawn, is not disabled, and swallows every touch because a sheet is over it.
 * The fire slots went first, then the heading dials. So the class is checked
 * rather than the instances: with a sheet open, the centre of every on canvas
 * control must hit that control and not something else.
 *
 * elementFromPoint is the browser's own answer to "what would this tap reach",
 * which is why it catches a case that a screenshot and a visibility check both
 * pass.
 */
async function checkNothingIsBuried() {
  await sheet(true);
  const buried = await page.evaluate(() => {
    const out = [];
    const sel = '#modes button, .dial, #toolbar button, #bEnd, #timeline, footer .slot';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && el.contains(top)) continue;
      const over = top ? (top.closest('[id]')?.id || top.tagName) : 'nothing';
      out.push(`${el.id || el.className || el.tagName}:${el.textContent.trim().slice(0, 8)} under ${over}`);
    }
    return out;
  });
  await sheet(false);
  if (buried.length) {
    console.log(`\nFAIL: ${buried.length} control(s) buried under an open sheet:`);
    for (const b of buried) console.log('  ' + b);
    process.exit(1);
  }
  log('nothing buried under an open sheet');
}

async function playMatch() {
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

  const mineRows = page.locator('#fleet .shipRow:not(.gone)');
  const mineCount = await mineRows.count();

  // First give every ship the target and point it at one.
  //
  // Whether a mount MAY fire is a cooldown question, so the console will
  // happily take a shot at a hostile no arc bears on, and this harness used to
  // sit still and shoot: one run queued 156 shots over 26 turns and killed
  // nothing, because the last hostile had flown behind a fleet that never
  // turned. Facing the target is what a player does between turns, and it goes
  // through the toolbar button rather than ftDebug, which observes and never
  // drives.
  //
  // Targeting is per ship, so the pick has to be made with that ship selected;
  // aiming and firing are two passes because the button lives on the canvas and
  // the rows live in a sheet that covers it on a phone.
  for (let i = 0; i < mineCount; i++) {
    await sheet(true);
    const row = page.locator('#fleet .shipRow:not(.gone)').nth(i);
    if (!(await row.count())) continue;
    await (MOBILE ? row.tap() : row.click());
    await page.waitForTimeout(150);
    if (!(await page.evaluate(() => window.ftDebug.canPlan()))) continue;
    const foe = page.locator('#hostiles .shipRow:not(.gone)').first();
    if (await foe.count()) {
      await (MOBILE ? foe.tap() : foe.click());
      await page.waitForTimeout(150);
    }
    await sheet(false);
    const face = page.locator('#pFace');
    if ((await face.count()) && !(await face.isDisabled())) {
      await (MOBILE ? face.tap() : face.click());
      await page.waitForTimeout(150);
    }
  }

  // Then every living ship of mine fires everything it has.
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

    // A fire slot opens what can happen in that second. There is no arming
    // step any more: pick the second, then pick the mount out of its list.
    const n = await page.locator('#weps .wrow:not(.spent)').count();
    for (let w = 0; w < n; w++) {
      // Spread the shots across the ten seconds of the turn.
      const slot = page.locator('#slots .slot').nth(Math.min(9, 1 + w * 3));
      await (MOBILE ? slot.tap() : slot.click());
      await page.waitForTimeout(140);
      // Mount w if it can fire in this second, else whatever can. Taking the
      // first row every time fires mount 0 over and over and leaves the rest
      // of the battery cold, which looks like queueing and does not shoot.
      const mine = page.locator(`#slotMenu .srow[data-add="${w}"]`);
      const add = (await mine.count()) ? mine : page.locator('#slotMenu .srow[data-add]').first();
      if (await add.count()) {
        await (MOBILE ? add.tap() : add.click());
        await page.waitForTimeout(140);
      }
      const close = page.locator('#smClose');
      if (await close.count()) {
        await (MOBILE ? close.tap() : close.click());
        await page.waitForTimeout(100);
      }
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
  return outcome;
}

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
