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
  mine: [...document.querySelectorAll('#fleet .chip')].map(r => ({
    name: r.querySelector('.nm').textContent.trim(), gone: r.classList.contains('gone') })),
  foes: [...document.querySelectorAll('#hostiles .chip')].map(r => ({
    name: r.querySelector('.nm').textContent.trim(), gone: r.classList.contains('gone') })),
}));

log(`playing at ${VIEWPORT.width}x${VIEWPORT.height}${MOBILE ? ' (touch)' : ''}`);

let shotsQueued = 0;
/** Whether the aim strip was used, and whether the pick reached an order. */
let aimedAtAVolume = false;
let aimedShotQueued = false;
/** The most chunks of hull seen in the air at once. */
let chunksSeen = 0;
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
  if (attempt === 1) await checkHullsAreShips(page);
  if (attempt === 1) await checkFleetChips();
  if (attempt === 1) await checkSchematic();
  if (attempt === 1) await checkCameraGestures();
  if (attempt === 1) await checkInspector();
  if (attempt === 1) await checkLookingAtShips();

  outcome = await playMatch();
  final = await state();
  if (final.phase === 'VICTORY') break;
}

// Subsystem targeting is a pick that has to reach the ORDER. A chip that
// highlights and sends -1 across the boundary is a light, not a feature.
if (!aimedAtAVolume) {
  console.log('\nFAIL: never managed to aim at a volume');
  process.exit(1);
}
if (!aimedShotQueued) {
  console.log('\nFAIL: aimed at a volume and the queued shot still carried the hull');
  process.exit(1);
}
log('shots can be aimed at a subsystem, and the order carries it');

// A hit takes cells off the hull it hit, and they fly. Both are drawn from the
// event stream, so this is the check that the stream is actually reaching the
// renderer: a match full of hits and nothing off any hull means the carve
// stopped finding the cells.
const carved = await page.evaluate(() => window.ftDebug.damage().carved);
const total = carved.reduce((a, [, n]) => a + n, 0);
if (!total) {
  console.log('\nFAIL: a whole match of hits and not one cell off a hull');
  process.exit(1);
}
if (!chunksSeen) {
  console.log('\nFAIL: cells came off and nothing flew');
  process.exit(1);
}
log(`hulls come apart: ${total} cells off ${carved.length} ships, `
  + `${chunksSeen} chunks in the air at once`);

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
/**
 * The map draws the ships, not stand ins for them.
 *
 * Every hull used to be a five sided cone. It reads at a glance and it is a
 * lie: a player spends an hour in the shipyard and then flies a triangle. A
 * quad count is the cheapest thing that can tell the difference, and it is the
 * one that would go back to zero if the cone ever returned.
 */
async function checkHullsAreShips(page) {
  const quads = await page.evaluate(() => window.ftDebug.hullQuads());
  if (quads.length < 2) {
    console.log(`\nFAIL: only ${quads.length} hulls on the map`);
    process.exit(1);
  }
  if (quads.some(q => q < 200)) {
    console.log(`\nFAIL: a hull is ${Math.min(...quads)} quads, which is not a ship`);
    process.exit(1);
  }
  const total = quads.reduce((a, b) => a + b, 0);
  if (total > 24000) {
    console.log(`\nFAIL: ${total} quads of hull on screen, which is a budget rather than a ship`);
    process.exit(1);
  }
  log(`hulls are drawn from their own cells: ${quads.join(', ')} quads, ${total} in all`);
}

async function checkNothingIsBuried() {
  await sheet(true);
  await assertNothingBuried('an open sheet');
  await sheet(false);
}

/** The one implementation, so a second thing that floats over the canvas is
 * checked the same way the sheets are rather than by its own near copy. */
async function assertNothingBuried(what) {
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
  if (buried.length) {
    console.log(`\nFAIL: ${buried.length} control(s) buried under ${what}:`);
    for (const b of buried) console.log('  ' + b);
    process.exit(1);
  }
  log(`nothing buried under ${what}`);
}

/**
 * The review panel: shut unless asked for, and it puts the match back.
 *
 * The point of the panel is that watching a turn again is a MODE you enter,
 * so the two things worth proving are that it is not on screen until you open
 * it, and that leaving it returns the match bit for bit. Watching restores a
 * past world into the live core, so a review that left the world anywhere else
 * would be worse than no review at all, and the state hash is the check the
 * core already computes for exactly that.
 */
async function checkReview() {
  const read = () => page.evaluate(() => ({
    hidden: document.getElementById('reviewPanel').classList.contains('hidden'),
    hash: document.getElementById('hHash').textContent,
    turn: document.getElementById('hTurn').textContent,
    phase: document.getElementById('hPhase').textContent,
    review: window.ftDebug.review(),
  }));
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };

  const shut = await read();
  if (!shut.hidden) fail('the review panel is on screen before it is opened');
  if (shut.review !== null) fail('review state exists with the panel shut');
  const live = { hash: shut.hash, turn: shut.turn };

  await tap('#bReview');
  const open = await read();
  if (open.hidden) fail('Review did not open the panel');
  await assertNothingBuried('the review panel');
  // Aiming must not move the match.
  await tap('#rpPrev');
  const aimed = await read();
  if (aimed.hash !== live.hash || aimed.turn !== live.turn) {
    fail(`aiming the picker moved the match: ${live.turn}/${live.hash} became ${aimed.turn}/${aimed.hash}`);
  }
  if (aimed.review?.watching) fail('aiming the picker started watching');

  await tap('#rpWatch');
  await page.waitForTimeout(400);
  const watching = await read();
  if (!watching.review?.watching) fail('Watch did not load the turn it was aimed at');
  if (!/WATCHING/.test(watching.phase)) fail(`header says ${watching.phase} while watching`);

  await tap('#rpLive');
  await page.waitForTimeout(200);
  const back = await read();
  if (back.hash !== live.hash || back.turn !== live.turn) {
    fail(`the review did not put the match back: ${live.turn}/${live.hash} became ${back.turn}/${back.hash}`);
  }
  await tap('#rpClose');
  const closed = await read();
  if (!closed.hidden) fail('closing the panel left it on screen');
  log(`review panel opens, aims without moving the match, and restores ${live.turn}/${live.hash}`);
}

/**
 * Pull the camera back off whatever it is looking at.
 *
 * The wheel rather than the Fit button: the tab bar the button lives on only
 * exists below 900px, so a desk run would be reaching for a control that is
 * not there. The wheel is what a player uses at both sizes and it is the same
 * gesture the inspector is meant to react to.
 */
async function wheelBy(steps, dir) {
  const box = await page.locator('#cv').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * 100);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(250);
}
// Declarations, not consts: the checks below run at module top level before a
// `const` further down the file has been initialised.
async function zoomOut(steps = 26) { await wheelBy(steps, 1); }
async function zoomIn(steps = 26) { await wheelBy(steps, -1); }

/**
 * The fleet rail says what the match says.
 *
 * A chip carries three claims a player acts on: which hull this is, what is
 * broken on it, and who it is aiming at. All three are drawn from state the
 * core owns, so all three can be checked against it rather than against a
 * screenshot. The offline list is the one that matters most and the one a
 * headless suite is blind to: a subsystem dies in the resolver and the only
 * place a player learns it is a tag on a chip.
 */
async function checkFleetChips() {
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };
  await sheet(true);
  const seen = await page.evaluate(() => {
    const read = (host) => [...document.querySelectorAll(`#${host} .chip`)].map(c => ({
      ship: Number(c.dataset.ship),
      name: c.querySelector('.nm')?.textContent.trim() ?? '',
      art: c.querySelector('.th')?.tagName ?? 'none',
      src: (c.querySelector('img.th')?.getAttribute('src') ?? '').slice(0, 14),
      info: !!c.querySelector('.chipInfo'),
      offline: [...c.querySelectorAll('.off')].map(o => o.textContent.trim()).sort(),
    }));
    return {
      mine: read('fleet'), foes: read('hostiles'),
      subs: window.ftDebug.subs(), ships: window.ftDebug.ships(),
    };
  });
  const chips = [...seen.mine, ...seen.foes];
  if (chips.length !== seen.ships.length) {
    fail(`${seen.ships.length} ships in the match and ${chips.length} chips in the rail`);
  }
  if (!chips.every(c => c.info)) fail('a chip has no info button, so its schematic is unreachable');
  // A picture, or the deliberate fallback. Anything else is a broken image.
  const art = chips.filter(c => c.art === 'IMG' && c.src.startsWith('data:image'));
  const fallback = chips.filter(c => c.art === 'SPAN');
  if (art.length + fallback.length !== chips.length) {
    fail('a chip has neither a thumbnail nor the no-WebGL fallback');
  }
  if (!art.length) fail('not one chip drew a thumbnail');

  // What the chips say is offline against what the core says is dead.
  const dead = new Map();
  for (const v of seen.subs) {
    if (!v.dead) continue;
    const list = dead.get(v.ship) ?? [];
    list.push(v.index);
    dead.set(v.ship, list);
  }
  let matched = 0;
  for (const c of chips) {
    const want = (dead.get(c.ship) ?? []).length;
    const got = c.offline.length;
    if (want !== got) fail(`${c.name} has ${want} volume(s) out and its chip lists ${got}`);
    matched += got;
  }
  await sheet(false);
  log(`fleet chips: ${chips.length} hulls, ${art.length} drawn, `
    + `${matched} offline system(s) listed and every one of them real`);
  return matched;
}

/**
 * The schematic modal: it opens on the hull whose button was pressed, it draws
 * that hull's volumes, and a row names one.
 *
 * Opened from the chip rather than by calling into the app, because the thing
 * that has broken before is the route and not the renderer.
 */
async function checkSchematic() {
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };
  await sheet(true);
  const chip = page.locator('#fleet .chip:not(.gone)').first();
  const name = (await chip.locator('.nm').textContent()).trim();
  await (MOBILE ? chip.locator('.chipInfo').tap() : chip.locator('.chipInfo').click());
  await page.waitForSelector('#schema:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(400);

  const open = await page.evaluate(() => ({
    ...window.ftDebug.schematic(),
    rows: document.querySelectorAll('#scList .scrow').length,
    title: document.getElementById('scName').textContent.trim(),
    subs: window.ftDebug.subs(),
    canvas: (() => {
      const c = document.getElementById('scCanvas');
      return { w: c.clientWidth, h: c.clientHeight };
    })(),
  }));
  if (!open.title.startsWith(name.split(' ')[0])) {
    fail(`pressed info on ${name} and the schematic opened on ${open.title}`);
  }
  if (!open.rows) fail('the schematic lists no volumes');
  if (open.rows !== open.volumes) {
    fail(`${open.volumes} volumes drawn and ${open.rows} listed`);
  }
  if (open.canvas.w < 40 || open.canvas.h < 40) {
    fail(`the schematic canvas is ${open.canvas.w}x${open.canvas.h}`);
  }

  // A row names a volume: the half of this that works with no pointer at all.
  const row = page.locator('#scList .scrow').first();
  await (MOBILE ? row.tap() : row.click());
  await page.waitForTimeout(200);
  const named = await page.evaluate(() => ({
    hot: window.ftDebug.schematic().hot,
    card: !document.getElementById('scCard').classList.contains('hidden'),
    text: document.getElementById('scCard').textContent.trim().length,
  }));
  if (named.hot < 0) fail('tapping a volume row named nothing');
  if (!named.card || named.text < 40) fail('a volume was named and the card said nothing');

  // The modal turns the same way the shipyard does, because it is the same
  // camera: a distance that changed with the angle made turning a hull to look
  // at it feel like the hull was breathing.
  if (!MOBILE) {
    const cam = () => page.evaluate(() => window.ftDebug.schematic().cam);
    const box = await (await page.$('#scCanvas')).boundingBox();
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const seen = [];
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    for (let n = 0; n < 6; n++) {
      await page.mouse.move(mid.x + (n + 1) * 40, mid.y + (n % 3) * 10);
      await page.waitForTimeout(110);
      seen.push(await cam());
    }
    await page.mouse.up();
    const d = seen.map(c => c.dist);
    const lo = Math.min(...d), hi = Math.max(...d);
    const turned = Math.abs((seen[seen.length - 1]?.yaw ?? 0) - (seen[0]?.yaw ?? 0));
    if (turned < 0.8) fail(`the schematic drag turned it only ${turned.toFixed(2)} rad`);
    if (hi - lo > 0.01 * hi) {
      fail(`the schematic camera breathed from ${lo.toFixed(2)} to ${hi.toFixed(2)} u`);
    }
    log(`schematic orbit holds ${lo.toFixed(2)} u across ${turned.toFixed(1)} rad`);

    // The right button is part of the gesture set in here, so the browser's own
    // menu over it has to be off: a drag that ends with a context menu open is
    // a drag that ends with the model half turned and a list on top of it.
    const menu = await page.evaluate(() => new Promise(res => {
      const cv = document.getElementById('scCanvas');
      const r = cv.getBoundingClientRect();
      cv.addEventListener('contextmenu', e => res(e.defaultPrevented), { once: true });
      cv.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    }));
    if (!menu) fail('the right click menu is still live over the schematic');
    else log('the right click menu is suppressed over the schematic');
  }

  await tap('#scClose');
  // The class, not visibility: `waitForSelector` waits for an element to be
  // SHOWN, and a hidden one never is, so it would time out on a modal that
  // closed correctly.
  await page.waitForFunction(
    () => document.getElementById('schema').classList.contains('hidden'), null, { timeout: 3000 });
  await sheet(false);
  log(`schematic: ${open.rows} volumes on ${open.title}, a row names one, and Close puts it down`);
}

/**
 * The map inspector: offered only close up, and it lets go on its own.
 *
 * Both halves matter. A button that never appears is a feature nobody finds; a
 * mode that stays on while the camera flies away leaves labels floating over
 * empty space. Zooming is done through the wheel, which is what a player uses,
 * rather than by reaching into the camera.
 */
/**
 * Looking at a ship: hover, focus, and the turrets that follow a target.
 *
 * Four things the unit suites cannot see, because every one of them is about
 * a pointer over a picture. A hull names the part under the cursor; a turret
 * names its gun and draws the cone its own hull blocks; a double click goes
 * and looks at a ship; and a plain click on a hull is about that hull and not
 * a move order, which is the defect that started this: your own frigate and
 * the place you wanted to send it are a few pixels apart, and clicking the
 * ship planted an order on top of it every time.
 */
async function checkLookingAtShips() {
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };
  await sheet(false);
  const at = await page.evaluate(() => window.ftDebug.screenOf(window.ftDebug.selected()));
  if (!at) fail('the selected ship is not on screen to look at');

  // A phone has neither a hover nor a double click. What it DOES share is the
  // rule that a press on a hull is about that hull: the fire slots and the
  // heading dials both went the other way once, and a tap that planted a move
  // order under your own frigate is the same defect in a third place.
  if (MOBILE) {
    const was = JSON.stringify(await page.evaluate(() => window.ftDebug.order()?.target ?? null));
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(300);
    const now = JSON.stringify(await page.evaluate(() => window.ftDebug.order()?.target ?? null));
    if (was !== now) fail(`tapping a hull moved the plan from ${was} to ${now}`);
    log('a tap on a hull names it and does not plant a move order');
    const rigs = await page.evaluate(() => window.ftDebug.turrets());
    if (!rigs.some(r => Math.abs(r.yaw) > 1 || Math.abs(r.pitch) > 1)) {
      fail(`${rigs.length} turrets and not one of them has turned`);
    }
    log(`turrets track on a phone too: ${rigs.length} mounts, `
      + `${rigs.filter(r => r.bears).length} bearing`);
    return;
  }

  // A double click goes there: centred AND closed, so the inspector is offered
  // when it arrives.
  const before = await page.evaluate(() => window.ftDebug.camera().dist);
  await page.mouse.dblclick(at.x, at.y);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.ftDebug.camera().dist);
  if (!(after < before - 1)) fail(`double clicked a hull and the camera stayed at ${after}`);
  if (await page.evaluate(() => window.ftDebug.inspect().ship) < 0) {
    fail('double clicked a hull and the ship data did not come up with it');
  }
  const allArcs = await page.evaluate(() => window.ftDebug.arcs());
  if (allArcs < 1) fail('ship data is up and no firing arc is drawn');
  log(`double click focuses: ${before.toFixed(0)} u to ${after.toFixed(0)} u, `
    + `${allArcs} firing arcs drawn`);

  // A plain click on the hull names it and leaves the plan alone.
  const planBefore = JSON.stringify(await page.evaluate(() => window.ftDebug.order()?.target ?? null));
  const here = await page.evaluate(() => window.ftDebug.screenOf(window.ftDebug.selected()));
  await page.mouse.click(here.x, here.y);
  await page.waitForTimeout(300);
  const planAfter = JSON.stringify(await page.evaluate(() => window.ftDebug.order()?.target ?? null));
  if (planBefore !== planAfter) {
    fail(`clicking a hull moved the plan from ${planBefore} to ${planAfter}`);
  }
  log('a click on a hull names it and does not plant a move order');

  // Hovering the hull names a part; hovering a TURRET names its gun and draws
  // that one mount's cone rather than all of them.
  const turret = await page.evaluate(() => {
    const c = document.getElementById('cv').getBoundingClientRect();
    for (let y = c.top + 20; y < c.bottom - 20; y += 6) {
      for (let x = c.left + 20; x < c.right - 20; x += 6) {
        const p = window.ftDebug.partAt(x, y);
        if (p && p.rig >= 0) return { x, y, ...p };
      }
    }
    return null;
  });
  if (!turret) fail('no turret anywhere on screen to hover');
  await page.mouse.move(turret.x, turret.y);
  await page.waitForTimeout(350);
  const tip = await page.evaluate(() => window.ftDebug.tip());
  if (!tip.shown || tip.rig < 0) fail('hovered a turret and no label came up');
  if (!/dmg/.test(tip.text) || !/blocks/.test(tip.text)) {
    fail(`a turret label without its gun or its arc: "${tip.text}"`);
  }
  const one = await page.evaluate(() => window.ftDebug.arcs());
  if (one !== 1) fail(`hovering one turret drew ${one} cones`);
  log(`hovering a turret says what it is and draws its own cone: "${tip.text.slice(0, 46)}"`);

  // And the turrets are actually tracking. At least one has swung off its rest
  // facing, and the ones that report a bearing are the ones that moved.
  const rigs = await page.evaluate(() => window.ftDebug.turrets());
  const swung = rigs.filter(r => Math.abs(r.yaw) > 1 || Math.abs(r.pitch) > 1);
  const still = rigs.filter(r => !r.bears && Math.abs(r.yaw) < 0.5 && Math.abs(r.pitch) < 0.5);
  if (!rigs.length) fail('no turrets on any hull');
  if (!swung.length) fail(`${rigs.length} turrets and not one of them has turned`);
  if (rigs.some(r => r.bears && Math.abs(r.yaw) < 1e-6 && Math.abs(r.pitch) < 1e-6)) {
    fail('a turret reports a bearing without having moved onto it');
  }
  log(`turrets track: ${swung.length} of ${rigs.length} swung onto a target, `
    + `${still.length} stood down with nothing they can bear on`);
  await zoomOut();
}

async function checkInspector() {
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };
  await sheet(false);

  // Far out over the whole field the offer must not be there.
  await zoomOut();
  if (await page.evaluate(() => window.ftDebug.inspect().ready)) {
    fail('the ship data button is offered from a whole fleet view');
  }

  // Now go and look at the selected hull. Far enough in to hit the camera's own
  // closest approach, because that is what a player does when they want to
  // look at a ship, and the offer has to be there when they get there.
  await tap('#cCentre');
  await zoomIn(45);
  if (!(await page.evaluate(() => window.ftDebug.inspect().ready))) {
    fail('zoomed all the way in on a ship and the inspector is still not offered');
  }
  await tap('#bInspect');
  await page.waitForTimeout(250);
  const on = await page.evaluate(() => ({
    ship: window.ftDebug.inspect().ship,
    boxes: document.querySelectorAll('#inspect .ibox').length,
    shown: !document.getElementById('inspect').classList.contains('hidden'),
    volumes: window.ftDebug.subs().filter(v => v.ship === window.ftDebug.selected()).length,
  }));
  if (on.ship < 0) fail('pressed Ship data and nothing turned on');
  if (!on.shown) fail('the inspector is on and its layer is hidden');
  if (on.boxes !== on.volumes) {
    fail(`${on.volumes} volumes on the hull and ${on.boxes} labels on screen`);
  }

  // And it lets go when the camera leaves, which is the whole contract.
  await zoomOut();
  const after = await page.evaluate(() => window.ftDebug.inspect());
  if (after.ship >= 0) fail('zoomed away and the labels stayed on the hull');
  log(`inspector: offered close up only, labelled ${on.boxes} volumes, `
    + 'and let go when the camera left');
}

/**
 * The camera gestures that must never touch a plan.
 *
 * Middle drag on a desk and two fingers on a phone both mean "move the
 * camera", and the failure they are guarding against is not a camera that will
 * not move: it is a camera move that also picked a ship or dropped a
 * destination. So the plan is read before and after and must be untouched,
 * while the picture must have changed.
 */
async function checkCameraGestures() {
  const fail = (msg) => { console.log(`\nFAIL: ${msg}`); process.exit(1); };
  await sheet(false);
  await zoomOut(10);
  const box = await page.locator('#cv').boundingBox();
  const before = await page.evaluate(() => ({
    order: window.ftDebug.order(), selected: window.ftDebug.selected(),
    // Where a ship lands on screen IS the camera, read through the projection
    // the renderer uses rather than through its private state.
    at: window.ftDebug.screenOf(window.ftDebug.selected()),
  }));

  if (MOBILE) {
    // Two fingers, sliding together: pan without pinching.
    const a = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.55 };
    const b = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
    const client = await page.context().newCDPSession(page);
    const touch = (type, pts) => client.send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map(p => ({ x: p.x, y: p.y })),
    });
    await touch('touchStart', [a, b]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: a.x, y: a.y - i * 9 }, { x: b.x, y: b.y - i * 9 }]);
      await page.waitForTimeout(16);
    }
    await touch('touchEnd', []);
  } else {
    // Middle button, dragged across the map.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: 'middle' });
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box.x + box.width * 0.5 - i * 11, box.y + box.height * 0.5 - i * 7);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: 'middle' });
  }
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => ({
    order: window.ftDebug.order(), selected: window.ftDebug.selected(),
    at: window.ftDebug.screenOf(window.ftDebug.selected()),
  }));
  const gesture = MOBILE ? 'a two finger drag' : 'a middle button drag';
  if (after.selected !== before.selected) fail(`${gesture} changed the selected ship`);
  if (JSON.stringify(after.order) !== JSON.stringify(before.order)) {
    fail(`${gesture} changed the plan: ${JSON.stringify(before.order?.target)} `
      + `became ${JSON.stringify(after.order?.target)}`);
  }
  const moved = Math.hypot(after.at.x - before.at.x, after.at.y - before.at.y);
  if (moved < 12) fail(`${gesture} moved the camera ${moved.toFixed(1)} px, which is not a pan`);
  log(`${gesture} pans ${moved.toFixed(0)} px and leaves the plan alone`);
}

async function playMatch() {
  let outcome = 'ran out of turns';
  for (let t = 0; t < MAX_TURNS; t++) {
  const s = await state();
  if (s.phase === 'VICTORY' || s.phase === 'DEFEAT') { outcome = s.phase; break; }

  await sheet(true);

  // Aim at the first hostile still alive, chosen through the hostile list the
  // way a player does rather than left to whatever the client defaults to.
  const foes = page.locator('#hostiles .chip:not(.gone) .chipPick');
  const foeCount = await foes.count();
  if (foeCount === 0) { outcome = 'no hostiles left'; break; }
  await (MOBILE ? foes.first().tap() : foes.first().click());
  await page.waitForTimeout(150);

  const mineRows = page.locator('#fleet .chip:not(.gone) .chipPick');
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
    const row = page.locator('#fleet .chip:not(.gone) .chipPick').nth(i);
    if (!(await row.count())) continue;
    await (MOBILE ? row.tap() : row.click());
    await page.waitForTimeout(150);
    if (!(await page.evaluate(() => window.ftDebug.canPlan()))) continue;
    const foe = page.locator('#hostiles .chip:not(.gone) .chipPick').first();
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
    const row = page.locator('#fleet .chip:not(.gone) .chipPick').nth(i);
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
      // Once a match, aim somewhere other than the hull before queueing, and
      // check the pick reaches the plan. Subsystem targeting is worth nothing
      // if the chip is a light: the number on the order is the whole feature.
      if (!aimedAtAVolume) {
        // The engines, the way a player would: it is the volume whose loss
        // decides a fight. Taking the first chip aims at a belt, which is the
        // one pick that makes a shot WORSE than aiming at the hull.
        const engines = page.locator('#slotMenu .smaim .aimc[data-aim]', { hasText: /^engines/ });
        const chip = (await engines.count())
          ? engines.first()
          : page.locator('#slotMenu .smaim .aimc[data-aim]:not([data-aim="-1"])').first();
        if (await chip.count()) {
          await (MOBILE ? chip.tap() : chip.click());
          await page.waitForTimeout(140);
          aimedAtAVolume = await page.evaluate(() => window.ftDebug.aimSub() >= 0);
          if (!aimedAtAVolume) { outcome = 'the aim chip did not take'; break; }
        }
      }
      const mine = page.locator(`#slotMenu .srow[data-add="${w}"]`);
      const add = (await mine.count()) ? mine : page.locator('#slotMenu .srow[data-add]').first();
      if (await add.count()) {
        await (MOBILE ? add.tap() : add.click());
        await page.waitForTimeout(140);
        if (aimedAtAVolume && !aimedShotQueued) {
          const o = await page.evaluate(() => window.ftDebug.order());
          aimedShotQueued = (o?.weapons ?? []).some(x => x.targetSub >= 0);
        }
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

  // Cells come off a hull where it was hit, and the chunks fly. Sampled until
  // chunks are actually seen, because an early turn where nothing connects is
  // an early turn where nothing should fly: waiting for the first two turns
  // and giving up is a check that fails on a match that opened at long range.
  if (!chunksSeen) {
    await page.waitForTimeout(1500);
    const d = await page.evaluate(() => window.ftDebug.damage());
    chunksSeen = Math.max(chunksSeen, d.chunks);
  }

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
await checkReview();
// Again at the end, where a fought match has actually put systems out: the
// interesting half of the chip is the one that only exists after damage.
const listed = await checkFleetChips();
if (!listed) log('note: no system was knocked out this match, so the offline list stayed empty');
log('page errors    :', errors.length ? errors : 'none');

await page.screenshot({ path: MOBILE ? '/tmp/playthrough-mobile.png' : '/tmp/playthrough.png' });
await browser.close();

const won = final.phase === 'VICTORY';
if (!won || errors.length) {
  console.error(`\nFAIL: ${won ? 'page errors' : 'the match was not won'}`);
  process.exit(1);
}
console.log('\nPASS: played through to a victory.');
