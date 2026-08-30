/**
 * The shipyard, driven in a real browser.
 *
 * The four unit suites cannot answer the questions this screen raises. Whether
 * a hull is LEGAL is arithmetic and `design.ts` covers it; whether a player can
 * reach the controls that make it legal, on a phone, with a sheet open, is a
 * question about layout, and two defects have already shipped that only a
 * browser could have caught: an absolutely positioned chip row laid over the
 * mode buttons so every tap landed on the row above, and a header that ran
 * Close off the right edge of a 390 pixel viewport with overflow hidden, which
 * left no way out of the screen at all.
 *
 * It OBSERVES through `window.ftDebug` and never writes through it. A harness
 * that can set state stops testing the app and starts testing itself.
 *
 *   node web/tests/shipyard.mjs        # against a server on 8123
 */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = process.env.BASE ?? 'http://localhost:8123/';
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;
const fail = (msg) => { console.log('  FAIL ' + msg); failures++; };
const ok = (msg) => console.log('  ok   ' + msg);

/** Every control a player needs, and the tap has to ARRIVE at it. */
const REACHABLE = ['dzClose', 'dzPlate', 'dzTabParts', 'dzTabArmour', 'dzTabStats',
  'dzReset', 'dzBare', 'dzStrip'];

async function openShipyard(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#bShipyard');
  await page.waitForTimeout(1100);
}

async function checkLayout(page, label) {
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) fail(`${label}: ${over}px of horizontal scroll`);
  else ok(`${label}: no horizontal scroll`);

  for (const tab of ['dzTabParts', 'dzTabArmour', 'dzTabStats']) {
    await page.click('#' + tab);
    await page.waitForTimeout(200);
    const buried = await page.evaluate((ids) => {
      const out = [];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) { out.push(`${id} missing`); continue; }
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) { out.push(`${id} has no size`); continue; }
        if (b.right > innerWidth + 0.5 || b.left < -0.5) {
          out.push(`${id} off screen (${b.left.toFixed(0)}..${b.right.toFixed(0)} of ${innerWidth})`);
          continue;
        }
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!(hit === el || el.contains(hit)))
          out.push(`${id} buried under ${hit ? (hit.id || hit.className || hit.tagName) : 'nothing'}`);
      }
      return out;
    }, REACHABLE);
    for (const b of buried) fail(`${label} [${tab}]: ${b}`);
    if (!buried.length) ok(`${label} [${tab}]: every control reachable`);
  }

  await page.click('#dzTabArmour');
  await page.waitForTimeout(250);
  const pane = await page.evaluate(() => {
    const out = [];
    for (const sel of ['#dzMode button', '#dzFactions button', '#dzPaint button',
      '#dzArmour input']) {
      const els = [...document.querySelectorAll(sel)];
      if (!els.length) { out.push(`${sel}: none rendered`); continue; }
      for (const el of els) {
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        if (b.right > innerWidth + 0.5) { out.push(`${sel}: runs off the right edge`); break; }
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!(hit === el || el.contains(hit))) {
          out.push(`${sel}: buried under ${hit ? (hit.id || hit.className) : 'nothing'}`);
          break;
        }
      }
    }
    return out;
  });
  for (const p of pane) fail(`${label} [armour]: ${p}`);
  if (!pane.length) ok(`${label} [armour]: mode, faction, swatches and sliders all reachable`);
}

async function checkShips(page) {
  const buttons = await page.$$('#dzClasses button');
  for (let n = 0; n < buttons.length; n++) {
    await (await page.$$('#dzClasses button'))[n].click();
    await page.waitForTimeout(450);
    const d = await page.evaluate(() => window.ftDebug.designer());
    const name = d.classKey;
    if (!d.derived.legal) {
      fail(`${name}: illegal out of the box (${d.derived.checks.filter(c => !c.ok).map(c => c.id).join(', ')})`);
    } else if (d.derived.mass < d.derived.massMax * 0.7) {
      fail(`${name}: only ${(100 * d.derived.mass / d.derived.massMax).toFixed(0)}% of its berth, so the budget teaches nothing`);
    } else {
      ok(`${name}: legal at ${(100 * d.derived.mass / d.derived.massMax).toFixed(0)}% of budget, hull ${d.derived.hull.toFixed(0)}`);
    }
    // The whole point of eight swatches is that eight of them are on the ship.
    if (d.livery < 8) fail(`${name}: only ${d.livery} of 8 swatches reach the hull`);
    else ok(`${name}: all 8 ${d.faction} swatches on the hull`);
    // Mounts live inside the frame. Only drives, retros, attitude jets, gun
    // rings and trunnions are allowed to stand proud of the hull.
    if (d.enclosedOutside > 0)
      fail(`${name}: ${d.enclosedOutside} cells of enclosed parts are outside the hull`);
    else ok(`${name}: every enclosed mount is inside the hull`);
  }
}

/** Ghost armour, and a tap that names what it landed on. */
async function checkGhostAndPicking(page) {
  await (await page.$$('#dzClasses button'))[0].click();
  await page.waitForTimeout(450);

  const states = [];
  for (let n = 0; n < 3; n++) {
    await page.click('#dzPlate');
    await page.waitForTimeout(500);
    states.push(await page.evaluate(() => {
      const d = window.ftDebug.designer();
      return { plate: d.plate, ghost: d.hist.ghost ?? 0, solid: d.hist.solid, skin: d.hist.skin };
    }));
  }
  const seq = states.map(s => s.plate).join(' -> ');
  if (seq !== 'ghost -> off -> on') fail(`the plate toggle cycles ${seq}, not ghost -> off -> on`);
  else ok('the plate toggle cycles on, ghost, off');
  const g = states[0];
  if (!g.ghost) fail('ghost mode draws no armour at all');
  else if (g.skin) fail('ghost mode still draws solid armour as well');
  else ok(`ghost draws ${g.ghost} cells of see through skin over ${g.solid} of structure`);

  // A tap on the model has to name what it hit. It is the only gesture a
  // phone has for this: no second button, no hover.
  await page.click('#dzPlate');           // back to ghost, where parts are visible
  await page.waitForTimeout(500);
  const box = await (await page.$('#dzCanvas')).boundingBox();
  let named = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.42, 0.52], [0.58, 0.48], [0.5, 0.44]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(350);
    const d = await page.evaluate(() => {
      const el = document.getElementById('dzPick');
      return { hidden: el.classList.contains('hidden'), text: el.textContent.trim(),
        socket: window.ftDebug.designer().socket, marks: window.ftDebug.designer().marks };
    });
    if (d.hidden) { fail('a tap on the hull said nothing at all'); return; }
    if (d.socket) { named = d; break; }
    named = named ?? d;
  }
  ok(`a tap on the model opens a card: "${named.text.split('\n')[0].slice(0, 48)}"`);

  // Selecting from the menu has to outline the part on the model.
  await page.click('#dzTabParts');
  await page.waitForTimeout(250);
  for (const sk of await page.$$('#dzSockets .dzsock')) {
    if ((await sk.textContent()) === 'UTL-BRG') { await sk.click(); break; }
  }
  await page.waitForTimeout(450);
  const sel = await page.evaluate(() => {
    const el = document.getElementById('dzPick');
    const d = window.ftDebug.designer();
    return { marks: d.marks, socket: d.socket, text: el.textContent.trim(),
      hidden: el.classList.contains('hidden') };
  });
  if (!sel.marks) fail('selecting a part from the menu draws no outline on the model');
  else if (sel.hidden) fail('selecting a part from the menu opens no card');
  else ok('selecting from the menu outlines the part and names it');

  await page.click('#dzPlate');
  await page.waitForTimeout(400);
}

async function checkModesAndRotation(page) {
  await (await page.$$('#dzClasses button'))[0].click();
  await page.waitForTimeout(400);
  await page.click('#dzTabArmour');
  await page.waitForTimeout(200);
  const wrapped = await page.evaluate(() => window.ftDebug.designer());
  await page.click('#dzMode button:nth-child(2)');
  await page.waitForTimeout(600);
  const bare = await page.evaluate(() => window.ftDebug.designer());
  if (bare.armour !== 'skin') fail('from scratch did not change the mode');
  else if (bare.derived.plateCells >= wrapped.derived.plateCells)
    fail(`from scratch kept ${bare.derived.plateCells} plate cells, so it is not from scratch`);
  else ok(`from scratch strips the exterior: ${wrapped.derived.plateCells} plate cells to ${bare.derived.plateCells}`);

  await page.click('#dzMode button:nth-child(1)');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => window.ftDebug.designer());
  if (back.derived.plateCells !== wrapped.derived.plateCells)
    fail(`class hull did not come back: ${back.derived.plateCells} against ${wrapped.derived.plateCells}`);
  else ok('class hull comes back exactly');

  // A turret is on a swivel: turning it has to move CELLS, not just a label.
  // The barbette under it is a drum and a drum is the same drum at 90 degrees,
  // so the part to turn is the gun on its trunnion.
  await page.click('#dzTabParts');
  await page.waitForTimeout(250);
  let picked = null;
  for (const sk of await page.$$('#dzSockets .dzsock')) {
    const t = await sk.textContent();
    if (t === 'WPN-BM1' || t === 'WPN-CN1') { await sk.click(); picked = t; break; }
  }
  if (!picked) { fail('no trunnion gun on the panel, so a gun cannot be reached at all'); return; }
  await page.waitForTimeout(350);
  const turn = await page.$$('.dzturn button');
  if (turn.length !== 2) { fail('no rotation control on a filled socket'); return; }
  const before = await page.evaluate(() => window.ftDebug.designer().gridHash);
  await turn[1].click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.ftDebug.designer());
  if (!after.parts) fail('rotating dropped the part');
  else if (after.gridHash === before) fail(`rotating the ${picked} changed nothing in the grid`);
  else ok(`a ${picked} turns 90 degrees and the cells move with it`);
  // And back, so the harness leaves the ship as it found it.
  await (await page.$$('.dzturn button'))[0].click();
  await page.waitForTimeout(400);
  const home = await page.evaluate(() => window.ftDebug.designer().gridHash);
  if (home !== before) fail('turning back did not restore the hull');
  else ok('and turns back to exactly where it started');
}

for (const [w, h, label] of [[1280, 900, 'desktop 1280x900'],
  [390, 844, 'phone 390x844'], [390, 560, 'phone landscape 390x560']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h },
    hasTouch: w < 800, isMobile: w < 800 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  console.log(label);
  await openShipyard(page);
  await checkLayout(page, label);
  if (w > 800) {
    await checkShips(page);
    await checkGhostAndPicking(page);
    await checkModesAndRotation(page);
  } else {
    // With the card open, the controls drawn over the map still have to take
    // a tap. The fire slots went that way once and the heading dials after.
    const box = await (await page.$('#dzCanvas')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
    const open = await page.evaluate(() =>
      !document.getElementById('dzPick').classList.contains('hidden'));
    if (!open) fail(`${label}: a tap on the model said nothing`);
    else ok(`${label}: a tap on the model opens the card`);
    await checkLayout(page, label + ' with the card open');
  }
  if (errs.length) { for (const e of errs.slice(0, 4)) fail(`page error: ${e}`); }
  else ok('no page errors');
  await ctx.close();
}

await browser.close();
console.log(failures ? `\nFAIL: ${failures} problem${failures === 1 ? '' : 's'} in the shipyard.`
  : '\nPASS: the shipyard holds up on a desktop and on a phone.');
process.exit(failures ? 1 : 0);
