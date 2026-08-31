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
const REACHABLE = ['dzClose', 'dzPlate', 'dzArcs', 'dzTrack', 'dzTabParts',
  'dzTabArmour', 'dzTabStats', 'dzSave', 'dzReset', 'dzBare', 'dzStrip'];
/** Phone only: the desk layout has the panel beside the view and hides it. */
const REACHABLE_PHONE = [...REACHABLE, 'dzGrow'];

async function openShipyard(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#bShipyard');
  await page.waitForTimeout(1100);
}

/**
 * How much of the screen the model actually gets.
 *
 * The panel used to be a fixed 240 pixel sheet under a fixed 240 pixel view,
 * which gave the thing being edited 28 percent of a phone and the tool the
 * rest. The numbers here are the floor, not the target.
 */
async function checkViewport(page, label, floor) {
  const m = await page.evaluate(() => {
    const v = document.getElementById('dzView').getBoundingClientRect();
    return { h: Math.round(v.height), pct: Math.round(100 * v.height / innerHeight) };
  });
  if (m.pct < floor) fail(`${label}: the model gets only ${m.pct}% of the screen (${m.h}px)`);
  else ok(`${label}: the model gets ${m.pct}% of the screen (${m.h}px)`);
  return m;
}

async function checkLayout(page, label) {
  const innerWidthIsPhone = await page.evaluate(() => innerWidth <= 900);
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
    }, innerWidthIsPhone ? REACHABLE_PHONE : REACHABLE);
    for (const b of buried) fail(`${label} [${tab}]: ${b}`);
    if (!buried.length) ok(`${label} [${tab}]: every control reachable`);
  }

  await page.click('#dzTabArmour');
  await page.waitForTimeout(250);
  const pane = await page.evaluate(() => {
    const out = [];
    for (const sel of ['#dzMode button', '#dzFactions button', '#dzPaint button',
      '#dzArmour input', '#dzSliceAt', '#dzBrushAdd', '#dzBrushCut',
      '#dzMirrorX', '#dzMirrorY', '#dzOnion', '#dzDepth',
      '#dzSliceClear', '#dzDrawClear']) {
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
    // Attitude blocks are set INTO the skin. A flat block on a curved hull
    // leaves its corners a fraction proud; a block standing off the flank on
    // a pylon does not, and that is what this catches.
    if (d.flushProud > 1.5)
      fail(`${name}: an attitude block stands ${d.flushProud.toFixed(1)} cells off the hull`);
    else ok(`${name}: attitude blocks sit flush, worst corner ${d.flushProud.toFixed(2)} cells proud`);
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

/**
 * Gunnery: the arcs, and turrets that track.
 *
 * The arc numbers are `data.rs`'s own, so what is checked here is that the
 * preview obeys them: a turret swings, and it never swings past its limit.
 */
async function checkTurrets(page) {
  await (await page.$$('#dzClasses button'))[0].click();
  await page.waitForTimeout(450);
  // Two independent switches, and each has to work without the other.
  const read = () => page.evaluate(() => {
    const d = window.ftDebug.designer();
    return { arcs: d.arcs, target: d.target };
  });
  await page.click('#dzArcs'); await page.waitForTimeout(400);
  const onlyArcs = await read();
  await page.click('#dzArcs'); await page.click('#dzTrack');
  await page.waitForTimeout(400);
  const onlyTarget = await read();
  await page.click('#dzArcs'); await page.waitForTimeout(400);
  const both = await read();
  if (!(onlyArcs.arcs && !onlyArcs.target)) fail('the Arcs button did not turn on the arcs alone');
  else if (!(onlyTarget.target && !onlyTarget.arcs)) fail('the Target button did not turn on the target alone');
  else if (!(both.arcs && both.target)) fail('the two gunnery switches do not combine');
  else ok('Arcs and Target are independent switches');

  await page.waitForTimeout(700);
  const a = await page.evaluate(() => window.ftDebug.designer());
  if (!a.rigs.length) { fail('no turret rigs at all'); return; }
  await page.waitForTimeout(2600);
  const b = await page.evaluate(() => window.ftDebug.designer());

  const moved = a.rigs.some((r, n) => Math.abs(r.yaw - b.rigs[n].yaw) > 3);
  if (!moved) fail('the turrets did not move while tracking');
  else ok(`${a.rigs.length} turrets swing on the target`);

  // Easing, not snapping. Sampled across a second and a half so the claim
  // rests on frames where the turrets were actually moving: a single pair of
  // samples taken while they happen to sit still proves nothing.
  // Wait until something actually bears, so the samples land on frames where
  // the turrets are moving rather than sitting at rest with nothing in arc.
  for (let n = 0; n < 40; n++) {
    if ((await page.evaluate(() => window.ftDebug.designer().bearing)) > 0) break;
    await page.waitForTimeout(250);
  }
  const track = [];
  for (let n = 0; n < 14; n++) {
    track.push(await page.evaluate(() => window.ftDebug.designer().rigs.map(r => r.yaw)));
    await page.waitForTimeout(130);
  }
  let jump = 0, swept = 0;
  for (let n = 1; n < track.length; n++)
    for (let q = 0; q < track[0].length; q++) {
      const d = Math.abs(track[n][q] - track[n - 1][q]);
      jump = Math.max(jump, d);
      swept += d;
    }
  if (swept < 10) fail('the turrets barely moved across a second and a half of tracking');
  else if (jump > 30) fail(`a turret jumped ${jump.toFixed(0)} degrees between frames 130 ms apart`);
  else ok(`turrets ease rather than snap: ${swept.toFixed(0)} degrees swept, `
    + `worst step ${jump.toFixed(1)} in 130 ms`);

  // With the target off, every turret comes home to its mount's own forward.
  await page.click('#dzTrack');
  await page.waitForTimeout(1400);
  const home = await page.evaluate(() => window.ftDebug.designer());
  const away = home.rigs.filter(r => Math.abs(r.yaw - r.rest) > 6 || Math.abs(r.pitch) > 6);
  if (away.length) fail(`${away.length} turrets did not return to their mount's forward`);
  else ok('with nothing to track, every turret returns to straight ahead');
  await page.click('#dzTrack');
  await page.waitForTimeout(600);

  // Never past the limit, in either sample.
  const over = [];
  for (const snap of [a, b]) {
    for (const r of snap.rigs) {
      const wide = Math.abs(r.arcH[1] - r.arcH[0]) >= 360;
      if (!wide && (r.yaw < r.arcH[0] - 0.6 || r.yaw > r.arcH[1] + 0.6))
        over.push(`${r.key} at ${r.yaw} against ${r.arcH.join(' to ')}`);
    }
  }
  if (over.length) fail(`a turret swung past its arc: ${over.join('; ')}`);
  else ok('no turret swings past its own arc');

  if (!a.bearing && !b.bearing) fail('no turret ever bore on the target');
  else ok(`turrets bearing on the target: ${a.bearing} then ${b.bearing} of ${a.rigs.length}`);

  await page.click('#dzArcs');
  await page.click('#dzTrack');
  await page.waitForTimeout(400);
}

/**
 * The ship library: save a hull, find it in the lobby, open it back.
 *
 * The point is that a design SURVIVES the round trip. A save that returns 201
 * and a list that renders a row prove nothing on their own; loading it back
 * and finding the same class and the same part count does.
 */
/**
 * Drawing armour by hand.
 *
 * The property that matters is that the pencil COMPOSES with the generated
 * exterior and is fully reversible: draw a run, the plate count and the mass
 * go up and the grid changes; clear it, and every one of them comes back to
 * exactly where it started. A tool that can add but not undo is a tool nobody
 * dares use.
 */
async function checkDrawing(page) {
  await (await page.$$('#dzClasses button'))[0].click();
  await page.waitForTimeout(450);
  await page.click('#dzTabArmour');
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    document.getElementById('dzSliceCanvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);

  const read = () => page.evaluate(() => {
    const d = window.ftDebug.designer();
    return { plate: d.derived.plateCells, mass: +d.derived.mass.toFixed(5),
      hash: d.gridHash, drawn: d.drawn, cut: d.cutCells,
      slab: d.slab, z: d.slabZ, slabs: d.slabs, box: d.slabBox };
  });
  const before = await read();

  // Measure the canvas before every gesture: the pane reflows when the count
  // line changes, which silently moved a whole run onto the wrong cells.
  const box = async () => {
    await page.evaluate(() =>
      document.getElementById('dzSliceCanvas').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(120);
    const b = await (await page.$('#dzSliceCanvas')).boundingBox();
    return { ...b, cell: b.width / 32 };
  };
  const tap = async (i, row) => {
    const b = await box();
    await page.mouse.click(b.x + b.cell * (i + 0.5), b.y + b.cell * (row + 0.5));
    await page.waitForTimeout(420);
  };
  const run = async (row) => {
    const b = await box();
    await page.mouse.move(b.x + b.cell * 3.5, b.y + b.cell * (row + 0.5));
    await page.mouse.down();
    for (let n = 4; n < 13; n++)
      await page.mouse.move(b.x + b.cell * (n + 0.5), b.y + b.cell * (row + 0.5));
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  await run(16);
  const drawn = await read();
  if (!drawn.drawn) { fail('dragging across the slice drew nothing'); return; }
  if (drawn.plate <= before.plate)
    fail(`drawing ${drawn.drawn} cells did not raise the plate count (${before.plate})`);
  else if (drawn.mass <= before.mass)
    fail('drawn armour costs no mass, so the budget does not see it');
  else if (drawn.hash === before.hash)
    fail('drawing changed no cell in the grid');
  else ok(`drawing ${drawn.drawn} cells adds ${drawn.plate - before.plate} plate `
    + `and ${(drawn.mass - before.mass).toFixed(5)} mass`);

  // Cut into the plate the sliders laid, which is the other half of the tool.
  // Along the same row, which is known to cross the generated skin: the drawn
  // cells come off first and the run carries on into the shell behind them.
  await page.click('#dzBrushCut');
  await page.waitForTimeout(150);
  await run(16);
  const carved = await read();
  if (!carved.cut) fail('the cut brush removed nothing');
  else ok(`the cut brush takes ${carved.cut} cells out of the generated skin`);

  // And all the way back. This is the check the rest of it rests on.
  await page.click('#dzDrawClear');
  await page.waitForTimeout(700);
  const home = await read();
  if (home.drawn || home.cut) fail('Clear all left drawing behind');
  else if (home.plate !== before.plate || home.hash !== before.hash)
    fail(`clearing did not restore the hull: ${home.plate} plate against ${before.plate}`);
  else ok('and Clear all puts every cell back exactly as it was');

  await page.click('#dzBrushAdd');
  await page.waitForTimeout(150);

  // Armour has to reach the ship. A cell in the far corner of the lattice
  // touches nothing, and plate hanging in space is the defect the pylons were
  // written to end: a pencil that can make it is a pencil that will.
  await tap(1, 1);
  const orphan = await read();
  const said = await page.evaluate(() => window.ftDebug.designer().drawSaid);
  if (orphan.drawn) fail('a cell touching nothing was drawn anyway');
  else if (!said) fail('a refused cell was refused silently');
  else ok(`armour must reach the ship: "${said}"`);

  // And one against the hull is taken. z 32 on the Terran puts the skin at
  // column 6, so column 5 is the first empty cell that touches it.
  await tap(5, 16);
  const beside = await read();
  if (!beside.drawn) fail('a cell against the hull was refused');
  else ok('a cell against the hull is taken');

  // Thickness makes a slice DEEPER rather than overlapping the next one, so
  // the slabs tile the 64 cells of the lattice and there are fewer of them.
  // The cursor has to follow the z it was standing on, or the number under
  // the slider means something different before and after the drag.
  const slider = async (id, v) => {
    await page.evaluate(([i, n]) => {
      const e = document.getElementById(i);
      e.value = String(n); e.dispatchEvent(new Event('input', { bubbles: true }));
    }, [id, v]);
    await page.waitForTimeout(350);
  };
  const thin = await read();
  await slider('dzDepth', 6);
  const thick = await read();
  if (thick.slabs !== 11)
    fail(`thickness 6 gives ${thick.slabs} slabs, not the 11 that tile 64 cells`);
  else if (thick.z[1] - thick.z[0] !== 5)
    fail(`a thickness 6 slab spans z ${thick.z[0]} to ${thick.z[1]}`);
  else if (thin.z[0] < thick.z[0] || thin.z[0] > thick.z[1])
    fail(`the cursor left z ${thin.z[0]} for the slab z ${thick.z[0]} to ${thick.z[1]}`);
  else ok(`thickness 6 tiles 64 cells into ${thick.slabs} slabs of z `
    + `${thick.z[0]} to ${thick.z[1]}, still holding z ${thin.z[0]}`);

  // Tiling means the next slab starts where this one stopped. Overlapping
  // slices were the defect: the same cell drawn from two places.
  await page.click('#dzSliceUp');
  await page.waitForTimeout(300);
  const next = await read();
  if (next.z[0] !== thick.z[1] + 1)
    fail(`the next slab starts at z ${next.z[0]}, overlapping a slab ending at ${thick.z[1]}`);
  else ok(`slabs tile: z ${thick.z[0]} to ${thick.z[1]}, then ${next.z[0]} to ${next.z[1]}`);
  await page.click('#dzSliceDown');
  await page.waitForTimeout(300);

  // And the slab is drawn on the model, at the thickness the slider says, so
  // a number on the right has a place on the left.
  if (!thick.box) fail('no slab box on the model while the Armour tab is open');
  else if (!(thick.box.depth > thin.box.depth * 5.5))
    fail(`the slab box is ${thick.box.depth} deep at thickness 6 `
      + `against ${thin.box.depth} at 1, so it does not follow the slider`);
  else ok(`the slab box on the model grows ${thin.box.depth} to ${thick.box.depth} `
    + `units with the thickness`);

  // A stroke paints every z of the slab, not just the face of it.
  await tap(4, 16);
  const deep = await read();
  if (deep.drawn - beside.drawn < 4)
    fail(`a thickness 6 stroke drew ${deep.drawn - beside.drawn} cells, not a column`);
  else ok(`one tap at thickness 6 lays ${deep.drawn - beside.drawn} cells down the slab`);

  await slider('dzDepth', 1);
  await page.click('#dzDrawClear');
  await page.waitForTimeout(600);

  // Onion skin: it has to take a value and not throw drawing it.
  await slider('dzOnion', 3);
  const onion = await page.evaluate(() => window.ftDebug.designer().onion);
  if (onion !== 3) fail(`the onion slider reads ${onion}, not 3`);
  else ok('onion skin shows three slabs either side');

  // Symmetry is a toggle, off by default, and only mirrors x and y. With it
  // on, one tap is two cells; with both on, four. Back to z 32 first: the
  // thickness walk left the cursor on z 30, where a mount fills the mirror of
  // the cell being tapped, so a fair test of the mirror needs a symmetric cut.
  await slider('dzSliceAt', 32);
  const off = await read();
  if (off.z[0] !== 32) { fail(`the slice slider went to z ${off.z[0]}, not 32`); return; }
  if (off.drawn) { fail('Clear all left drawing behind before the mirror check'); return; }
  await page.click('#dzMirrorX');
  await page.waitForTimeout(200);
  await tap(5, 16);
  const mx = await read();
  if (mx.drawn !== 2)
    fail(`mirror x drew ${mx.drawn} cells from one tap, not 2`);
  else ok('mirror x paints the cell and its opposite number across the keel');

  await page.click('#dzDrawClear');
  await page.waitForTimeout(500);
  await page.click('#dzMirrorY');
  await page.waitForTimeout(200);
  await tap(5, 16);
  const mxy = await read();
  if (mxy.drawn !== 4)
    fail(`mirror x and y drew ${mxy.drawn} cells from one tap, not 4`);
  else ok('mirror x and y together paint all four quarters');

  await page.click('#dzMirrorX');
  await page.click('#dzMirrorY');
  await page.waitForTimeout(200);
  const backOff = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    return d.mirrorX || d.mirrorY;
  });
  if (backOff) fail('the mirror toggles do not turn off');
  await slider('dzOnion', 1);
  await page.click('#dzDrawClear');
  await page.waitForTimeout(600);
}

async function checkLibrary(page) {
  await (await page.$$('#dzClasses button'))[1].click();   // Karisen, not the default
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    return { classKey: d.classKey, parts: d.parts, hash: d.gridHash };
  });

  await page.click('#dzSave');
  await page.waitForTimeout(250);
  const suggested = await page.inputValue('#dzSaveName');
  if (!suggested) fail('the save bar opened with no suggested name');
  else ok(`the save bar suggests a name: "${suggested}"`);

  const name = `Harness ${Date.now().toString(36)}`;
  await page.fill('#dzSaveName', name);
  await page.click('#dzSaveGo');
  await page.waitForTimeout(1200);
  const slot = await page.evaluate(() => window.ftDebug.designer().slot);
  if (!slot.designId) {
    fail(`saving did not take: ${(await page.textContent('#dzSaid')).trim()}`);
    return;
  }
  ok(`saved to the library as "${slot.name}"`);
  const label = await page.textContent('#dzSave');
  if (label.trim() !== 'Save') fail(`after saving your own the button still reads "${label.trim()}"`);
  else ok('and the button becomes Save, because it is yours to update');

  // Out to the lobby: the row has to be there, and marked as mine.
  await page.click('#dzClose');
  await page.waitForTimeout(1200);
  const rows = await page.$$eval('#libList .libRow', rs => rs.map(r => ({
    name: r.querySelector('.n')?.textContent ?? '', sub: r.querySelector('.s')?.textContent ?? '',
  })));
  const row = rows.find(r => r.name.includes(name));
  if (!row) { fail('the saved design is not in the library list'); return; }
  if (!row.name.includes('yours')) fail('your own design is not marked as yours');
  else ok(`the library lists it: ${row.sub.replace(/\s+/g, ' ').slice(0, 70)}`);

  // And open it back. Same hull, or the round trip lost something.
  const idx = rows.indexOf(row);
  await (await page.$$('#libList .libRow button'))[idx * 2].click();
  await page.waitForTimeout(1600);
  const after = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    return { classKey: d.classKey, parts: d.parts, hash: d.gridHash, slot: d.slot };
  });
  if (after.classKey !== before.classKey || after.parts !== before.parts)
    fail(`the round trip changed the hull: ${before.classKey}/${before.parts} became `
      + `${after.classKey}/${after.parts}`);
  else if (after.hash !== before.hash)
    fail('the round trip changed the grid, so something in the record was lost');
  else ok(`opening it back gives the same hull: ${after.classKey}, ${after.parts} parts, same grid`);
  if (!after.slot.mine) fail('a design you saved does not come back marked as yours');

  await checkHullPick(page, name, before.classKey);
}

/**
 * Taking a saved hull into a practice level.
 *
 * The pick is worth nothing if it stops at the lobby, so this checks the thing
 * that matters: the ships the match spawns. A Karisen design picked and a
 * Terran fielded is a chooser that lights up and does nothing.
 */
async function checkHullPick(page, name, classKey) {
  await page.click('#dzClose');
  await page.waitForTimeout(1200);
  const chips = await page.$$eval('#practiceHull button', bs =>
    bs.map(b => (b.querySelector('.n')?.textContent ?? '').trim()));
  const at = chips.findIndex(t => t.includes(name));
  if (at < 0) { fail(`the saved hull is not offered on the practice screen: ${chips.join(', ')}`); return; }
  ok(`the practice screen offers the saved hull among ${chips.length} choices`);

  await (await page.$$('#practiceHull button'))[at].click();
  await page.waitForTimeout(250);
  await page.click('#bPractice');
  await page.waitForFunction(() => document.getElementById('lobby').classList.contains('hidden'),
    null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const flown = await page.evaluate(() => {
    const d = window.ftDebug;
    const side = d.side();
    return { side, mine: d.ships().filter(s => s.side === side).map(s => s.cls),
      foes: d.ships().filter(s => s.side !== side).map(s => s.cls),
      note: document.getElementById('hullNote').textContent };
  });
  const want = ['terran_frigate', 'karisen_frigate', 'rogue_frigate',
    'benefactor_frigate', 'freighter'].indexOf(classKey);
  if (!flown.mine.length) fail('the match spawned nothing for the player');
  else if (flown.mine.some(c => c !== want))
    fail(`picked a ${classKey} and flew classes ${flown.mine.join(', ')}`);
  else if (!flown.note.includes(name))
    fail(`the console does not say which design was taken out: "${flown.note}"`);
  else ok(`every hull the player fields is the picked ${classKey}, `
    + `and the panel says "${flown.note}"`);
  if (flown.foes.every(c => c === want) && want >= 0 && flown.foes.length)
    fail('the pick reached the other side as well, which is not a pick, it is a mod');
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
  if (w > 800) await checkViewport(page, label, 85);
  if (w > 800) {
    await checkShips(page);
    await checkGhostAndPicking(page);
    await checkTurrets(page);
    await checkModesAndRotation(page);
    await checkDrawing(page);
    await checkLibrary(page);
  } else {
    await checkViewport(page, label, 38);
    // One tap gives the model the screen, and a tab tapped after it brings the
    // sheet back rather than looking broken.
    await page.click('#dzGrow');
    await page.waitForTimeout(400);
    const wide = await checkViewport(page, label + ' collapsed', 80);
    void wide;
    await page.click('#dzTabArmour');
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => ({
      wide: document.getElementById('designer').classList.contains('wide'),
      armour: !document.getElementById('dzPaneArmour').classList.contains('hidden'),
    }));
    if (back.wide || !back.armour) fail(`${label}: a tab tapped while collapsed did not reopen the sheet`);
    else ok(`${label}: a tab reopens the collapsed sheet`);
    await page.click('#dzTabParts');
    await page.waitForTimeout(300);

    // With the card open, the controls drawn over the map still have to take
    // a tap. The fire slots went that way once and the heading dials after.
    const box = await (await page.$('#dzCanvas')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
    const open = await page.evaluate(() =>
      !document.getElementById('dzPick').classList.contains('hidden'));
    if (!open) fail(`${label}: a tap on the model said nothing`);
    else ok(`${label}: a tap on the model opens the card`);

    // The hint and the tool row share the bottom of the canvas, and at 390 the
    // hint wrapped to a second line that ran under the buttons.
    const overlap = await page.evaluate(() => {
      const a = document.getElementById('dzHint').getBoundingClientRect();
      const b = document.getElementById('dzTools').getBoundingClientRect();
      return Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left));
    });
    if (overlap > 0) fail(`${label}: the hint runs ${overlap}px under the tool row`);
    else ok(`${label}: the hint clears the tool row`);
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
