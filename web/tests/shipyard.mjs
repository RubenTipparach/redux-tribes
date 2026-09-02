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

/**
 * Wait for FRAMES, not for milliseconds.
 *
 * A turret eases per frame with a clamped delta, which is right: a tab that
 * was in the background comes back with seconds in the gap and a turret should
 * not teleport across it. So a wall clock wait measures the machine rather
 * than the easing. This suite runs headless on a software rasteriser where the
 * yard draws single digit frames a second, and 2.6 seconds of waiting was four
 * frames of movement: the check was reading the renderer's speed and calling
 * it a turret that would not turn.
 *
 * A page that stops drawing entirely hangs here rather than failing fast, and
 * that is the right trade: the whole suite runs under a timeout, and a yard
 * that has stopped rendering is a failure worth seeing as one.
 */
async function frames(page, n) {
  await page.evaluate(async (want) => {
    await new Promise(res => {
      let seen = 0;
      const tick = () => { if (++seen >= want) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }, n);
}

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

/**
 * Back to a known hull.
 *
 * These used to be `#dzClasses button` index 0, which WAS the Terran frigate
 * when the picker was one flat row of five. It is now the Terran NAVY chip,
 * and picking the navy you are already on returns immediately, so every reset
 * became a silent no op that left whatever hull the last check had built.
 */
async function toClass(page, navy, tier) {
  await page.locator('#dzClasses .dzrow').first().locator('button')
    .filter({ hasText: navy }).first().click();
  await page.waitForTimeout(300);
  await page.locator('#dzClasses .dzrow.tier button')
    .filter({ hasText: new RegExp(`^${tier}$`) }).first().click();
  await page.waitForTimeout(300);
}
const toTerranFrigate = (page) => toClass(page, 'Terran', 'Frigate');

async function checkLayout(page, label) {
  const innerWidthIsPhone = await page.evaluate(() => innerWidth <= 900);
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) fail(`${label}: ${over}px of horizontal scroll`);
  else ok(`${label}: no horizontal scroll`);

  // THE MODEL IS A CONTROL TOO. Everything below probes buttons, so anything
  // drawn over the canvas could grow without bound and this would keep saying
  // every control is reachable while the ship could not be turned by thumb.
  // The class picker did exactly that: three wrapped rows of chips over a
  // 222px canvas at 390x560, and the centre of the view returned a button.
  const centre = await page.evaluate(() => {
    const v = document.getElementById('dzView').getBoundingClientRect();
    const hit = document.elementFromPoint(v.left + v.width / 2, v.top + v.height / 2);
    const cv = document.getElementById('dzCanvas');
    return hit === cv || cv.contains(hit) ? null
      : (hit ? `${hit.tagName}${hit.id ? '#' + hit.id : ''} "${(hit.textContent || '').trim().slice(0, 24)}"` : 'nothing');
  });
  if (centre) fail(`${label}: the centre of the view hits ${centre}, not the model`);
  else ok(`${label}: the centre of the view is the model, so it can be turned`);

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

/**
 * Every class the game ships, opened from the picker and checked.
 *
 * Walks the picker the way a player does, navy then rung, rather than by
 * index: the tier row is rebuilt when a navy is picked, so a flat index walk
 * ran off the end of a list that had changed under it. It also closes the
 * thing the index walk could not say at all, which is that every class is
 * REACHABLE: a hull with no way to it is a hull nobody can fly.
 */
async function checkShips(page) {
  const navyRow = () => page.locator('#dzClasses .dzrow').first().locator('button');
  const tierRow = () => page.locator('#dzClasses .dzrow.tier').locator('button');
  const navies = await navyRow().count();
  const seen = new Set();
  for (let f = 0; f < navies; f++) {
    await navyRow().nth(f).click();
    await page.waitForTimeout(450);
    const tiers = await tierRow().count();
    for (let t = 0; t < tiers; t++) {
    await tierRow().nth(t).click();
    await page.waitForTimeout(450);
    const d = await page.evaluate(() => window.ftDebug.designer());
    const name = d.classKey;
    seen.add(name);
    if (!d.derived.legal) {
      fail(`${name}: illegal out of the box (${d.derived.checks.filter(c => !c.ok).map(c => c.id).join(', ')})`);
    } else if (d.derived.mass < d.derived.massMax * 0.7) {
      fail(`${name}: only ${(100 * d.derived.mass / d.derived.massMax).toFixed(0)}% of its berth, so the budget teaches nothing`);
    } else {
      ok(`${name}: legal at ${(100 * d.derived.mass / d.derived.massMax).toFixed(0)}% of budget, hull ${d.derived.hull.toFixed(0)}`);
    }
    // The whole point of eight swatches is that eight of them are on the ship.
    //
    // This asserted the opposite until the livery landed: exactly ONE tone,
    // the picked one. That rule existed because the scheme before it derived
    // colours from position and left the pick invisible. What replaced it
    // keeps the pick as role `hull` and rotates the other seven round the
    // palette from there, so both halves are checkable: the whole palette is
    // on the ship, AND the colour the player chose is one of them.
    const tones = d.armourTones;
    if (tones.length !== 8) {
      fail(`${name}: the livery laid ${tones.length} of 8 swatches: `
        + `${tones.map(t => '0x' + t.toString(16)).join(', ') || 'nothing'}`);
    } else if (!tones.includes(d.paint)) {
      fail(`${name}: picked 0x${d.paint.toString(16)} and it is not on the hull: `
        + `${tones.map(t => '0x' + t.toString(16)).join(', ')}`);
    } else ok(`${name}: the whole ${d.faction} palette is on the hull, `
      + `the picked 0x${d.paint.toString(16)} among it`);
    // The yard DRAWS the windows, which for a long time it did not.
    //
    // Three screens went through `hullMesh` and got them for free; the yard
    // built its own boxes and asked nothing, so a player fitting a bridge saw
    // no viewport appear and had no way to tell whether the room was doing
    // anything. Counted off the MESHES rather than off the design, because a
    // design whose rooms all carry windows is exactly what the broken screen
    // had: asking the design reported healthy numbers throughout.
    const panes = Object.values(d.windows ?? {}).reduce((a, c) => a + c, 0);
    if (panes < 1) {
      fail(`${name}: the yard drew no windows at all`);
    } else {
      ok(`${name}: ${panes} panes drawn in the yard, `
        + Object.entries(d.windows).map(([k, n]) => `${k} ${n}`).join(', '));
    }
    // Mounts live inside the frame. Only drives, retros, attitude thrusters, gun
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
  const all = await page.evaluate(() => window.ftDebug.classes());
  const missed = all.filter(k => !seen.has(k));
  if (missed.length) fail(`the picker never reaches ${missed.join(', ')}`);
  else ok(`all ${all.length} classes reachable from the picker, and legal out of the box`);
}

/** Ghost armour, and a tap that names what it landed on. */
async function checkGhostAndPicking(page) {
  await toTerranFrigate(page);
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
  await toTerranFrigate(page);
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

  await frames(page, 12);
  const first = await page.evaluate(() => window.ftDebug.designer());
  if (!first.rigs.length) { fail('no turret rigs at all'); return; }

  // Sampled across a LAP of the target, not at two instants.
  //
  // The preview's target orbits in about seven seconds of wall time and a
  // turret at rest when nothing is in arc is the feature, not a fault. Two
  // snapshots 48 frames apart therefore both land in the stretch where every
  // mount sits at zero, on a renderer slow enough that 48 frames is most of a
  // minute: the check reported turrets that never moved and never bore while
  // a poll over the same period watched them sweep 343 degrees and two of the
  // three bear. Ask over a window that contains the answer.
  const laps = [];
  for (let n = 0; n < 30; n++) {
    laps.push(await page.evaluate(() => window.ftDebug.designer().rigs));
    await page.waitForTimeout(400);
  }
  const spread = first.rigs.map((_r, q) => {
    const seen = laps.map(l => l[q].yaw);
    return Math.max(...seen) - Math.min(...seen);
  });
  const bore = Math.max(...laps.map(l => l.filter(r => r.bears).length));
  if (!spread.some(d => d > 3)) fail('the turrets did not move while tracking');
  else ok(`${first.rigs.length} turrets swing on the target, `
    + `${spread.map(d => d.toFixed(0)).join('/')} degrees of travel each`);

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

  // With the target off, every turret comes home to its MOUNT's own forward,
  // which is zero in the mount's frame whatever facing it was bolted at. This
  // used to compare against a `rest` field the app never published, so it was
  // NaN against a threshold and passed on every hull without looking.
  await page.click('#dzTrack');
  await page.waitForTimeout(1400);
  const home = await page.evaluate(() => window.ftDebug.designer());
  const away = home.rigs.filter(r => Math.abs(r.yaw) > 6 || Math.abs(r.pitch) > 6);
  if (away.length) fail(`${away.length} turrets did not return to their mount's forward: `
    + away.map(r => `${r.key} at ${r.yaw}, ${r.pitch}`).join('; '));
  else ok('with nothing to track, every turret returns to straight ahead');
  await page.click('#dzTrack');
  await page.waitForTimeout(600);

  // Never past the limit. Measured on the BARREL in the ship's frame, because
  // that is the frame the authored arc is in, and only while a mount bears:
  // one that cannot is parked at its own forward, which is allowed to be
  // anywhere the design bolted it.
  const over = [];
  for (const snap of laps) {
    for (const r of snap) {
      if (!r.bears) continue;
      const wide = Math.abs(r.arcH[1] - r.arcH[0]) >= 360;
      if (!wide && (r.shipYaw < r.arcH[0] - 0.6 || r.shipYaw > r.arcH[1] + 0.6))
        over.push(`${r.key} at ${r.shipYaw} against ${r.arcH.join(' to ')}`);
    }
  }
  if (over.length) fail(`a turret swung past its arc: ${over[0]}`);
  else ok('no turret swings past its own arc');

  if (!bore) fail('no turret ever bore on the target');
  else ok(`${bore} of ${first.rigs.length} turrets bear on the target at once`);

  await page.click('#dzArcs');
  await page.click('#dzTrack');
  await page.waitForTimeout(400);
}

/**
 * The orbit, which has to be an ORBIT.
 *
 * The camera framed the hull as it PROJECTS from wherever it was standing,
 * which fits tightly and turns horribly: a frigate is six units long and two
 * across, so the distance that just contains it swings by a factor of three
 * between bow on and broadside, and turning the model pulled the camera in and
 * pushed it back out the whole way round. A player turning a thing to look at
 * it does not expect the thing to breathe.
 *
 * So: drag the model a long way round and watch the distance. And zoom in
 * past everything, and watch it stop at the plating rather than going inside.
 */
async function checkOrbitIsSteady(page) {
  await toTerranFrigate(page);
  await page.waitForTimeout(500);
  const cam = () => page.evaluate(() => window.ftDebug.designer().cam);
  const box = await (await page.$('#dzCanvas')).boundingBox();
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const seen = [];
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  for (let n = 0; n < 8; n++) {
    await page.mouse.move(mid.x + (n + 1) * 40, mid.y + (n % 3) * 12);
    await page.waitForTimeout(120);
    seen.push(await cam());
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dists = seen.map(c => c.dist);
  const lo = Math.min(...dists), hi = Math.max(...dists);
  const turned = Math.abs((seen[seen.length - 1]?.yaw ?? 0) - (seen[0]?.yaw ?? 0));
  if (turned < 1) fail(`the drag only turned the model ${turned.toFixed(2)} rad`);
  else if (hi - lo > 0.01 * hi) {
    fail(`the camera breathed from ${lo.toFixed(2)} to ${hi.toFixed(2)} u across `
      + `${turned.toFixed(1)} rad of orbit`);
  } else {
    ok(`the orbit holds ${lo.toFixed(2)} u across ${turned.toFixed(1)} rad of turning`);
  }

  // And zooming all the way in stops outside the hull rather than inside it.
  const before = (await cam()).dist;
  for (let n = 0; n < 40; n++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  const after = await cam();
  const half = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    return d.derived.radius;
  });
  if (!(after.dist < before)) fail('the wheel did not zoom in at all');
  else if (after.dist < 0.2) fail(`zoomed to ${after.dist} u, which is inside the ship`);
  else ok(`zoom stops at ${after.dist.toFixed(2)} u on a hull of about ${half.toFixed(2)} u`);
}

/**
 * The firing arcs a turret finds for itself.
 *
 * Three properties, and none of them is visible to the unit suites. The scan
 * has to SETTLE rather than run per edit, because it is a frame's work and the
 * pencil fires an edit per cell dragged through. It has to find something: a
 * turret bolted to a hull has that hull in its way, and a mask of nothing
 * would be a scan that silently did nothing. And it has to MOVE with the
 * metal, which is the one that says the rays are hitting the ship the player
 * drew rather than a lattice somebody described.
 */
async function checkArcScan(page) {
  await toTerranFrigate(page);
  await page.waitForTimeout(500);
  const settled = async () => {
    for (let n = 0; n < 60; n++) {
      const d = await page.evaluate(() => window.ftDebug.designer().arcScan);
      if (!d.pending) return d;
      await page.waitForTimeout(120);
    }
    return null;
  };
  const plated = await settled();
  if (!plated) { fail('the arc scan never settled on a fresh hull'); return; }

  const clear = plated.blocked.filter(b => b <= 0);
  const total = plated.blocked.filter(b => b >= 100);
  if (!plated.blocked.length) fail('no turret was scanned at all');
  else if (clear.length) fail(`${clear.length} turrets found nothing in the way at all`);
  else if (total.length) fail(`${total.length} turrets came out unable to fire anywhere`);
  else ok(`each turret is blocked by its own hull: ${plated.blocked.map(b => b.toFixed(0) + '%').join(', ')}`);

  // The arcs draw the mask itself, so turning them on has to put a shadow on
  // the screen for every mount that has one.
  await page.click('#dzArcs');
  await page.waitForTimeout(500);
  const drawn = await page.evaluate(() => window.ftDebug.designer().arcScan.drawn);
  if (drawn !== plated.blocked.length) fail(`${drawn} shadows drawn for ${plated.blocked.length} turrets`);
  else ok(`the blocked cone is drawn for all ${drawn} turrets`);
  await page.click('#dzArcs');
  await page.waitForTimeout(300);

  // Take the plate off and the same turrets see further. This is the check
  // that the rays are actually crossing the player's own voxels: a mask
  // computed from the class rather than from the picture would not move.
  // The Terran is the class for it, because all three of its guns are on
  // trunnions: a hull with an enclosed launcher carries a mount that is
  // deliberately not scanned, and comparing a zero against a zero proves
  // nothing.
  await page.click('#dzBare');
  const bare = await settled();
  if (!bare) fail('the arc scan never settled after the plate came off');
  else {
    // Every mount opens or stays where it is, and the ship as a whole opens by
    // a real margin. Not "every one of them opens": a mount whose own barbette
    // is the thing standing in its way is barely helped by taking the plating
    // off, and that is the correct answer rather than a defect. The Terran's
    // port gun sits on a drum three courses thick in its own inboard
    // direction, so the armour behind it was never what it could not see
    // through. Requiring all three to move made the suite report a hull whose
    // arcs had got BETTER (29 percent blocked to 25.8) as a regression.
    const worse = bare.blocked.filter((b, n) => b > plated.blocked[n] + 0.5).length;
    const total = plated.blocked.reduce((x, y) => x + y, 0)
      - bare.blocked.reduce((x, y) => x + y, 0);
    const widened = bare.blocked.filter((b, n) => b < plated.blocked[n] - 0.5).length;
    if (worse || total < 2) {
      fail(`the plate coming off freed only ${widened} of ${bare.blocked.length} turrets `
        + `(${worse} got worse, ${total.toFixed(1)} points in all): `
        + `${plated.blocked.join(', ')} to ${bare.blocked.join(', ')}`);
    } else {
      ok(`taking the plate off opens ${widened} of ${bare.blocked.length} arcs and none closes, `
        + `${total.toFixed(1)} points in all: ${plated.blocked.map(b => b.toFixed(0)).join('/')}`
        + ` to ${bare.blocked.map(b => b.toFixed(0)).join('/')} percent blocked`);
    }
  }
  await page.click('#dzReset');
  await page.waitForTimeout(600);

  // And the debounce, which is the whole reason the scan is affordable. A run
  // of nine cells is nine edits; it must cost ONE scan, and none of them while
  // the finger is still down.
  await page.click('#dzTabArmour');
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    document.getElementById('dzSliceCanvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  const scans = async () => page.evaluate(() => window.ftDebug.designer().arcScan.scans);
  const was = await scans();
  const b = await (await page.$('#dzSliceCanvas')).boundingBox();
  const cell = b.width / 32, row = 32 - 1 - 20;
  await page.mouse.move(b.x + cell * 3.5, b.y + cell * (row + 0.5));
  await page.mouse.down();
  for (let n = 4; n < 13; n++) {
    await page.mouse.move(b.x + cell * (n + 0.5), b.y + cell * (row + 0.5));
    // Deliberately slower than the settle. A debounce that was only a timer
    // would fire in the middle of this, which is the failure the flag fixes.
    await page.waitForTimeout(120);
  }
  const during = await page.evaluate(() => window.ftDebug.designer().arcScan);
  await page.mouse.up();
  if (during.scans !== was) fail(`the pencil scanned ${during.scans - was} times mid stroke`);
  else if (!during.pending) fail('a stroke that changed the hull left the arcs claiming to be current');
  else if (!during.drawing) fail('the pencil was down and the designer did not know it');
  else ok('nothing is scanned while the pencil is down');

  for (let n = 0; n < 60; n++) {
    if ((await scans()) > was) break;
    await page.waitForTimeout(120);
  }
  const after = await scans();
  if (after !== was + 1) fail(`a nine cell run cost ${after - was} scans`);
  else ok('and one scan lands once the stroke settles');
  await page.click('#dzReset');
  await page.waitForTimeout(600);
  await page.click('#dzTabParts');
  await page.waitForTimeout(300);
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
  await toTerranFrigate(page);
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
  // (i, j) are CELLS, and y grows upward on the ship and downward on a canvas,
  // so a row is NY - 1 - j. Taking the row for the cell aimed a whole check at
  // the mirror of the cell it named, which passed only because the hull is
  // symmetric about that axis.
  const tap = async (i, j) => {
    const b = await box();
    await page.mouse.click(b.x + b.cell * (i + 0.5), b.y + b.cell * (32 - 1 - j + 0.5));
    await page.waitForTimeout(420);
  };
  const run = async (j) => {
    const b = await box();
    const row = 32 - 1 - j;
    await page.mouse.move(b.x + b.cell * 3.5, b.y + b.cell * (row + 0.5));
    await page.mouse.down();
    for (let n = 4; n < 13; n++)
      await page.mouse.move(b.x + b.cell * (n + 0.5), b.y + b.cell * (row + 0.5));
    await page.mouse.up();
    await page.waitForTimeout(500);
  };

  /**
   * A cell the pencil should accept, found rather than hardcoded.
   *
   * The column that is "just outside the skin" moves whenever the raster does,
   * and a harness that names one goes on testing something else entirely: the
   * turret carve shifted it by a cell and three checks started aiming at a
   * part. Empty through the whole slab, clear of every turret box, touching
   * something solid, and with its mirror images equally clear when a mirror is
   * on, because the count a mirrored tap must produce is the whole assertion.
   */
  const findEdge = (mx = false, my = false) => page.evaluate(([mirX, mirY]) => {
    const d = window.ftDebug.designer();
    const [za, zb] = d.slabZ;
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const inT = (i, j, k) => d.turrets.some(t =>
      i >= t.i0 && i <= t.i1 && j >= t.j0 && j <= t.j1 && k >= t.k0 && k <= t.k1);
    const free = (i, j) => {
      for (let k = za; k <= zb; k++) {
        if (d.cellAt(i, j, k) || inT(i, j, k)) return false;
        if (!N.some(([a, b, c]) => d.cellAt(i + a, j + b, k + c))) return false;
      }
      return true;
    };
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
      const cols = [[i, j]];
      if (mirX) cols.push([31 - i, j]);
      if (mirY) cols.push([i, 31 - j]);
      if (mirX && mirY) cols.push([31 - i, 31 - j]);
      const uniq = [...new Set(cols.map(c => c.join(',')))].map(t => t.split(',').map(Number));
      if (uniq.length !== cols.length) continue;      // on a mirror plane
      if (uniq.every(([a, b]) => free(a, b))) return { i, j, cells: uniq.length };
    }
    return null;
  }, [mx, my]);

  /** A row that crosses generated plate, so a cut has something to take. */
  const findPlateRow = () => page.evaluate(() => {
    const d = window.ftDebug.designer();
    const k = d.slabZ[0];
    for (let j = 0; j < 32; j++) {
      let n = 0;
      for (let i = 3; i < 13; i++) { const m = d.cellAt(i, j, k); if (m === 1 || m === 7) n++; }
      if (n >= 3) return j;
    }
    return 16;
  });
  const plateRow = await findPlateRow();
  await run(plateRow);
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
  await run(plateRow);
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

  // A turret swings through its own box, so nothing else may be in it. Three
  // things have to hold at once: the generated exterior carves round them, the
  // pencil refuses a cell inside one with a reason, and the gate stays green
  // on a hull the editor built.
  const gun = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    return { turrets: d.turrets, fouled: d.fouled,
      gate: (d.derived.checks.find(c => c.id === 'turrets') ?? {}).ok };
  });
  if (!gun.turrets.length) fail('the Terran shows no turret boxes at all');
  else if (gun.fouled) fail(`${gun.fouled} cells of armour are inside a turret`);
  else if (!gun.gate) fail('the turret gate is red on a hull the editor built');
  else ok(`${gun.turrets.length} turret boxes, nothing standing in any of them`);

  // And the pencil refuses one. The cell is chosen rather than hoped for: in a
  // turret box, empty, and touching something solid, so the refusal that comes
  // back can only be the turret and not the connectivity rule.
  const aim = await page.evaluate(() => {
    const d = window.ftDebug.designer();
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const t of d.turrets) {
      for (let k = t.k0; k <= t.k1; k++) for (let j = t.j0; j <= t.j1; j++) {
        for (let i = t.i0; i <= t.i1; i++) {
          if (d.cellAt(i, j, k)) continue;
          if (!N.some(([a, b, c]) => d.cellAt(i + a, j + b, k + c))) continue;
          return { i, j, k };
        }
      }
    }
    return null;
  });
  if (!aim) {
    fail('no empty cell inside any turret box, so the pencil cannot be tested against one');
  } else {
    await page.evaluate((k) => {
      const e = document.getElementById('dzSliceAt');
      e.value = String(k); e.dispatchEvent(new Event('input', { bubbles: true }));
    }, aim.k);
    await page.waitForTimeout(300);
    const was = await read();
    await tap(aim.i, aim.j);
    const now = await read();
    const said = await page.evaluate(() => window.ftDebug.designer().drawSaid);
    if (now.drawn !== was.drawn)
      fail(`a cell inside a turret at ${aim.i},${aim.j},${aim.k} was drawn anyway`);
    else if (!/turret/.test(said))
      fail(`a cell inside a turret was refused without saying so: "${said}"`);
    else ok(`the pencil refuses a turret's box: "${said}"`);
  }
  await page.evaluate(() => {
    const e = document.getElementById('dzSliceAt');
    e.value = '32'; e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(250);

  // Armour has to reach the ship. A cell in the far corner of the lattice
  // touches nothing, and plate hanging in space is the defect the pylons were
  // written to end: a pencil that can make it is a pencil that will.
  await tap(1, 1);
  const orphan = await read();
  const said = await page.evaluate(() => window.ftDebug.designer().drawSaid);
  if (orphan.drawn) fail('a cell touching nothing was drawn anyway');
  else if (!said) fail('a refused cell was refused silently');
  else ok(`armour must reach the ship: "${said}"`);

  // And one against the hull is taken, at a cell the harness went and found:
  // naming a column made three checks aim at a part the moment the raster
  // moved under them.
  const edge = await findEdge();
  if (!edge) { fail('no empty cell against the hull anywhere on this slab'); return; }
  await tap(edge.i, edge.j);
  const beside = await read();
  if (!beside.drawn) fail(`a cell against the hull at ${edge.i},${edge.j} was refused`);
  else ok(`a cell against the hull is taken (${edge.i}, ${edge.j})`);

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
  const deepAt = await findEdge();
  if (!deepAt) { fail('no cell to draw a column at'); return; }
  await tap(deepAt.i, deepAt.j);
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
  const one = await findEdge(true, false);
  if (!one) { fail('no cell whose mirror across the keel is drawable too'); return; }
  await tap(one.i, one.j);
  const mx = await read();
  if (mx.drawn !== 2)
    fail(`mirror x drew ${mx.drawn} cells from one tap at ${one.i},${one.j}, not 2`);
  else ok('mirror x paints the cell and its opposite number across the keel');

  await page.click('#dzDrawClear');
  await page.waitForTimeout(500);
  await page.click('#dzMirrorY');
  await page.waitForTimeout(200);
  const four = await findEdge(true, true);
  if (!four) { fail('no cell whose four quarters are all drawable'); return; }
  await tap(four.i, four.j);
  const mxy = await read();
  if (mxy.drawn !== 4)
    fail(`mirror x and y drew ${mxy.drawn} cells from one tap at ${four.i},${four.j}, not 4`);
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
  // Karisen, deliberately NOT class index 0: checkHullPick's "a design is a
  // ship, not a uniform" half is skipped when the picked class is the one the
  // scenario already seats, so saving a Terran here would quietly disable it.
  await toClass(page, 'Karisen', 'Frigate');
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

  await checkHullPick(page, name, before.classKey, await page.evaluate(() =>
    window.ftDebug.designer().derived.hull));
}

/**
 * Taking a saved hull into a practice level.
 *
 * The pick is worth nothing if it stops at the lobby, so this checks the thing
 * that matters: the ships the match spawns. A Karisen design picked and a
 * Terran fielded is a chooser that lights up and does nothing.
 */
async function checkHullPick(page, name, classKey, hull) {
  await page.click('#dzClose');
  await page.waitForTimeout(1200);
  // Tapping a level opens its briefing: the roster it seats, and a hull per
  // ship. The pick lives there now rather than in one chooser above the list,
  // because it is a choice per SHIP.
  await page.click('#bPractice');
  await page.waitForTimeout(700);
  // The FIRST ship's card. A flat index across every row would land in
  // whichever row it happened to fall in, which is how a check about swapping
  // one ship ends up swapping another.
  const row = page.locator('#briefShips .briefRow').first();
  const chips = await row.locator('.picks button .n').allTextContents();
  const at = chips.findIndex(t => t.includes(name));
  if (at < 0) { fail(`the saved hull is not offered in the briefing: ${chips.join(', ')}`); return; }
  ok(`the briefing offers the saved hull among ${chips.length} choices`);

  await row.locator('.picks button').nth(at).click();
  await page.waitForTimeout(250);
  await page.click('#briefGo');
  await page.waitForFunction(() => document.getElementById('lobby').classList.contains('hidden'),
    null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const flown = await page.evaluate(() => {
    const d = window.ftDebug;
    const side = d.side();
    return { side, mine: d.ships().filter(s => s.side === side).map(s => s.cls),
      hulls: d.ships().filter(s => s.side === side).map(s => s.hull),
      foes: d.ships().filter(s => s.side !== side).map(s => s.cls),
      note: document.getElementById('hullNote').textContent };
  });
  // Asked of the app rather than listed again here. This was a third copy of
  // `ALL_CLASSES` order, in a test, and a class added anywhere else made it
  // silently compare against -1.
  const want = (await page.evaluate(() => window.ftDebug.classes())).indexOf(classKey);
  // The picked SHIP, and only it. A design is a ship rather than a uniform:
  // swapping the first hull must leave the one beside it as authored.
  if (!flown.mine.length) fail('the match spawned nothing for the player');
  else if (flown.mine[0] !== want)
    fail(`picked a ${classKey} for the first ship and it flew class ${flown.mine[0]}`);
  else if (flown.mine.length > 1 && flown.mine[1] === want && want !== 0)
    fail('the pick reached the ship beside it, which is not a swap, it is a uniform');
  else if (!flown.note.includes(name))
    fail(`the console does not say which design was taken out: "${flown.note}"`);
  else ok(`the picked ship flies the ${classKey}, the one beside it does not, `
    + `and the panel says "${flown.note}"`);

  // And it is the DESIGN, not just its class: the hull points the editor
  // showed are the hull points that ship spawned with, because the core
  // derived them once and both asked it.
  if (!flown.hulls.length) fail('no hull points to compare');
  else if (Math.abs(flown.hulls[0] - hull) > 0.5)
    fail(`the editor said hull ${hull.toFixed(1)} and the ship spawned with `
      + `${flown.hulls[0].toFixed(1)}`);
  else ok(`and it spawns with the hull the editor derived: ${hull.toFixed(1)}`);
  if (flown.foes.every(c => c === want) && want >= 0 && flown.foes.length)
    fail('the pick reached the other side as well, which is not a pick, it is a mod');
}

async function checkModesAndRotation(page) {
  await toTerranFrigate(page);
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

  // Picking another swatch repaints the hull to THAT colour, and picking the
  // same one twice is not a repaint. A palette that suggests rather than sets
  // is the thing this replaced.
  // Plate on first: with the exterior hidden there is no armour to have a
  // colour, and a check that passes because nothing was drawn is not a check.
  for (let n = 0; n < 3; n++) {
    if (await page.evaluate(() => window.ftDebug.designer().showPlate)) break;
    await page.click('#dzPlate');
    await page.waitForTimeout(350);
  }
  const swatches = await page.$$('#dzPaint button');
  if (swatches.length < 8) fail(`only ${swatches.length} swatches offered, not 8`);
  else {
    const before = await page.evaluate(() => window.ftDebug.designer().armourTones);
    await swatches[3].click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.ftDebug.designer());
    // A different pick has to REPAINT the ship, not merely be present on it.
    // The palette is a cycle and the livery is a rotation of it, so the SET of
    // eight tones is the same set whichever swatch is picked: what changes is
    // which role wears which, and the only way to see that from outside is
    // where the picked colour lands. So: the pick is on the hull, the whole
    // palette is on the hull, and the broad plating is a different colour from
    // the one it was.
    const plate = await page.evaluate(() => window.ftDebug.designer().hullTone);
    if (!after.armourTones.includes(after.paint))
      fail(`the fourth swatch set paint 0x${after.paint.toString(16)} and it is not `
        + `on the hull: ${after.armourTones.map(t => '0x' + t.toString(16)).join(', ') || 'nothing'}`);
    else if (after.armourTones.length !== 8)
      fail(`after a repick the hull wears ${after.armourTones.length} of 8 swatches`);
    else if (plate !== after.paint)
      fail(`the broad plating is 0x${plate.toString(16)}, not the picked `
        + `0x${after.paint.toString(16)}`);
    else ok(`a picked swatch is the hull's own plating: 0x${(before[0] ?? 0).toString(16)} `
      + `to 0x${after.paint.toString(16)}, with all eight on the ship`);
    // Re-queried: picking a swatch rebuilds the palette, so the handles taken
    // before the click are pointing at buttons that no longer exist.
    await (await page.$$('#dzPaint button'))[0].click();
    await page.waitForTimeout(300);
  }

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
  const stock = await page.evaluate(() => window.ftDebug.designer().gridHash);

  // The gun has to be one no quarter turn leaves alone, or "the cells moved"
  // is a question about the shape rather than about the control. A beam
  // turret is a square barrel, so rolling it about its own long axis is a
  // SYMMETRY that lands every cell back where it was: a real no-op that reads
  // exactly like a dead button, and it failed this check for that reason. The
  // projectile turret is 5 by 4 by 9 and is unchanged by nothing.
  const gunNamed = (name) => page.locator('#dzPalette .dzpart', { hasText: name }).first();
  if (!(await gunNamed('Projectile turret').count())) {
    fail('no projectile turret offered for a trunnion');
    return;
  }
  await gunNamed('Projectile turret').click();
  await page.waitForTimeout(700);
  picked = 'WPN-CN1';
  const axes = await page.$$eval('.dzturn', rows => rows.map(r => r.dataset.axis));
  if (axes.join(',') !== 'yaw,pitch,roll') {
    fail(`a filled socket offers ${axes.join(', ') || 'no'} rotation, not all three axes`);
    return;
  }
  // Each axis on its own, from upright and back to it. Turning all three and
  // then undoing them would pass on a control that moved the wrong axis, since
  // the hull comes home either way.
  const start = await page.evaluate(() => window.ftDebug.designer().gridHash);
  const moved = [];
  for (const axis of ['yaw', 'pitch', 'roll']) {
    const before = await page.evaluate(() => window.ftDebug.designer().gridHash);
    await (await page.$$(`.dzturn[data-axis="${axis}"] button`))[1].click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.ftDebug.designer());
    const said = await page.$eval('#dzTurnSaid', e => e.textContent).catch(() => '');
    if (said) { fail(`${axis} on a ${picked} was refused: ${said}`); return; }
    if (!after.parts) { fail(`turning a ${picked} in ${axis} dropped the part`); return; }
    if (after.gridHash === before) {
      fail(`turning the ${picked} in ${axis} changed nothing in the grid`);
      return;
    }
    moved.push(`${axis} ${after.gridHash.toString(16)}`);
    // And back, so the next axis is judged from upright too.
    await (await page.$$(`.dzturn[data-axis="${axis}"] button`))[0].click();
    await page.waitForTimeout(450);
    const home = await page.evaluate(() => window.ftDebug.designer().gridHash);
    if (home !== before) { fail(`turning back in ${axis} did not restore the hull`); return; }
  }
  // Three different hulls, not one control wired to three rows. A pitch that
  // silently did a yaw would move the cells and come home and look identical
  // to a pitch that worked.
  const hashes = new Set(moved.map(m => m.split(' ')[1]));
  if (hashes.size !== 3) fail(`three axes gave ${hashes.size} distinct hulls: ${moved.join(', ')}`);
  else ok(`a ${picked} turns on all three axes, ${moved.join(', ')}, and comes home`);
  // And the beam back, so the harness leaves the ship as it found it. Against
  // the hash taken BEFORE the swap, since `start` is the cannon's hull.
  await gunNamed('Beam turret').click();
  await page.waitForTimeout(700);
  const end = await page.evaluate(() => window.ftDebug.designer().gridHash);
  if (end !== stock) fail('the ship was not left as it was found');
  else ok('and the socket comes back to the gun it started with');
}


/**
 * The architect, at whatever size this pass is running.
 *
 * It is a MODE of this screen rather than a screen of its own, so it inherits
 * the canvas, the orbit and the bottom sheet and is checked here with them.
 * What is asked is the thing a picture cannot answer: that the controls take a
 * tap at 390 px, that a nudge moves the HULL and not merely a number, and that
 * leaving takes the edit with it.
 */
async function checkArchitect(page, label) {
  await page.goto(new URL('architect/terran_frigate', BASE).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  const opened = await page.evaluate(() => window.ftDebug?.architect?.());
  if (!opened) { fail(`${label}: the architect did not open`); return; }
  ok(`${label}: the architect opens on ${opened.classKey}, ${opened.sockets.length} stations`);

  // Select a drive, which is a station with a part on it: moving one that
  // holds nothing would move no cells and prove nothing about the hull.
  await page.evaluate(() => [...document.querySelectorAll('#dzArchList button')]
    .find(x => x.textContent.includes('drive'))?.click());
  await page.waitForTimeout(400);

  // Every control the architect adds has to ARRIVE, which on a phone is the
  // whole question: the file row sat under twenty nine scrolling stations the
  // first time and was off the screen at both sizes.
  const probe = await page.evaluate(() => {
    const ids = ['dzArchXDown', 'dzArchXUp', 'dzArchYDown', 'dzArchYUp',
      'dzArchZDown', 'dzArchZUp', 'dzArchKind', 'dzArchExport', 'dzArchImport',
      'dzArchRevert'];
    const rows = [...document.querySelectorAll('#dzArchList button')];
    const bad = [];
    for (const el of [...ids.map(i => document.getElementById(i)), ...rows]) {
      if (!el) { bad.push('missing'); continue; }
      // A row in a scrolling box is reached by scrolling to it, which is what
      // a person does. The station list always scrolls; the selected station's
      // controls do too once the sheet is short enough to need it.
      if (el.closest('#dzArchList, #dzArchFoot')) el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const name = el.id || el.textContent.trim().slice(0, 18);
      if (!r.width || !r.height) { bad.push(name + ': zero size'); continue; }
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
        bad.push(name + ': off screen'); continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (!(el === hit || el.contains(hit))) {
        bad.push(name + ': covered by ' + (hit?.id || hit?.tagName || 'nothing'));
      }
    }
    return { bad, n: ids.length + rows.length };
  });
  if (probe.bad.length) fail(`${label}: architect controls unreachable: ${probe.bad.slice(0, 3).join('; ')}`);
  else ok(`${label}: all ${probe.n} architect controls take a tap`);

  // A nudge has to move the SHIP, not just the readout. The grid hash is over
  // the occupancy lattice, so it changes when a cell does and not otherwise.
  const before = await page.evaluate(() => window.ftDebug.designer()?.gridHash);
  await page.click('#dzArchZUp');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.ftDebug.designer()?.gridHash);
  const now = await page.evaluate(() => window.ftDebug.architect());
  if (before === after) fail(`${label}: moving a station did not move the hull`);
  else if (!now.edited) fail(`${label}: the frame does not read as edited`);
  else ok(`${label}: a station moves and the hull follows (${before} to ${after})`);

  // Export names a file. The download itself is the browser's business; what
  // this asks is that the button is wired and the JSON is the frame.
  const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await page.click('#dzArchExport');
  const got = await dl;
  if (!got) fail(`${label}: Export JSON produced no file`);
  else ok(`${label}: exports ${got.suggestedFilename()}`);

  // Revert puts the authored frame back, which is the way out of a bad edit.
  await page.click('#dzArchRevert');
  await page.waitForTimeout(700);
  const back = await page.evaluate(() => window.ftDebug.architect());
  if (back.edited) fail(`${label}: Revert left the frame edited`);
  else ok(`${label}: Revert restores the frame this build authored`);

  // And leaving must take the override with it, or a hull a player can SEE and
  // the hull the core spawns would be two ships.
  await page.goto(new URL('ship/terran_frigate', BASE).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const gone = await page.evaluate(() => window.ftDebug.architect());
  if (gone !== null) fail(`${label}: the architect is still open after leaving it`);
  else ok(`${label}: leaving the architect clears the frame it was showing`);
}

for (const [w, h, label] of [[1280, 900, 'desktop 1280x900'],
  [390, 844, 'phone 390x844'], [390, 560, 'phone landscape 390x560']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h },
    hasTouch: w < 800, isMobile: w < 800 });
  const page = await ctx.newPage();
  // The real settle is a second and a half by design; a harness that waited it
  // out on every edit would spend its afternoon doing so. Timing is what is
  // under test in the debounce check, not the constant.
  await page.addInitScript(() => { window.ftArcSettle = 250; });
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
    await checkOrbitIsSteady(page);
    await checkArcScan(page);
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
  await checkArchitect(page, label);
  if (errs.length) { for (const e of errs.slice(0, 4)) fail(`page error: ${e}`); }
  else ok('no page errors');
  await ctx.close();
}

await browser.close();
console.log(failures ? `\nFAIL: ${failures} problem${failures === 1 ? '' : 's'} in the shipyard.`
  : '\nPASS: the shipyard holds up on a desktop and on a phone.');
process.exit(failures ? 1 : 0);
