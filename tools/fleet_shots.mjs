/**
 * A picture of every hull in the fleet, from the shipyard, in one pass.
 *
 * "Vary the silhouette by faction" and "use the whole palette" are claims
 * about what a ship LOOKS like, and no unit suite can answer either: the
 * numbers can be perfect while every hull on the ladder reads as the same
 * grey lozenge. So there is a command that renders them all and writes the
 * files out, and the answer is looked at rather than asserted.
 *
 * It drives the real screen at its real address, `/ship/<classKey>`, which is
 * the same route a player reaches a stock hull by. Nothing is stubbed and
 * nothing is written through `ftDebug`: the tool takes photographs.
 *
 *   npm --prefix web run build
 *   PORT=8123 DATABASE_PATH=":memory:" CLIENT_DIR=web/dist node server/dist/index.js &
 *   node tools/fleet_shots.mjs                       # every class, to /tmp
 *   node tools/fleet_shots.mjs --out shots           # somewhere else
 *   node tools/fleet_shots.mjs --only terran_cruiser # one hull
 *   node tools/fleet_shots.mjs --bare                # armour off, the frame
 *   node tools/fleet_shots.mjs --ladder terran       # the rungs, to one scale
 *   node tools/fleet_shots.mjs --map                 # the FIELD, not the yard
 *   node tools/fleet_shots.mjs --map --fleet a,b,c,d # ...seating named hulls
 *
 * `--ladder` is the one that answers "are they actually bigger". The shipyard
 * FRAMES each hull to fill the view, so a corvette and a heavy cruiser come
 * out the same size on screen and the picture cannot answer the question at
 * all. So it crops each shot to the hull, rescales it by the hull's measured
 * world length, and lays the rungs on one baseline: what you are looking at
 * is then the ladder rather than the camera.
 *
 * The shots are NOT committed. They are a thing to look at while working, and
 * a directory of megabytes of PNGs that go stale the moment a colour moves is
 * not a thing a repository should carry (GUIDELINES 3 wants the source of an
 * asset beside it; the source of these is the ship, and it is already here).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
import pw from '/opt/node22/lib/node_modules/playwright/index.js';

const BASE = process.env.BASE ?? 'http://localhost:8123/';
const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const OUT = arg('out', '/tmp/fleet-shots');
const ONLY = arg('only', null);
const BARE = has('bare');
const LADDER = arg('ladder', null);
const MAP = has('map');
const FLEET = arg('fleet', null);
const WIDE = has('mobile') ? { width: 390, height: 844 } : { width: 1100, height: 760 };

mkdirSync(OUT, { recursive: true });

// The lengths are the measured ones, read from the same place the table is:
// a picture claiming a ladder and a table claiming another would be two
// answers to one question.
const rows = JSON.parse(execSync('node ' + resolve(here, 'measure_fleet.mjs') + ' --json',
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: WIDE, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('  page error: ' + e.message));

/** Wait for FRAMES, never for a deadline: this runs on a software rasteriser
 *  where the yard draws single digits a second, and a wall clock wait there
 *  measures the machine rather than the picture settling. */
/**
 * Take the console's own furniture out of the photograph.
 *
 * A STYLE TAG rather than `el.style.visibility`, and that is the whole point:
 * an inline style belongs to one element instance, and the picker is rebuilt
 * on every refresh, so a hide set before a class was opened was gone by the
 * time the shutter fired. Every shot in the fleet had the class picker, the
 * tool row and the hint line printed across it, and because the chips are the
 * BRIGHTEST thing in the frame, the bounding box `--ladder` crops to was a box
 * round the panel rather than round the ship.
 *
 * A rule in the document survives any number of rebuilds, which is what makes
 * it right rather than merely working today.
 */
const CHROME = ['#dzClasses', '#dzTools', '#dzHint', '#dzPick'];
const hideChrome = (pg) => pg.addInitScript((sel) => {
  const put = () => {
    if (document.getElementById('shotChrome')) return;
    const st = document.createElement('style');
    st.id = 'shotChrome';
    st.textContent = `${sel} { visibility:hidden !important; }`;
    document.head.append(st);
  };
  if (document.head) put();
  else document.addEventListener('DOMContentLoaded', put, { once: true });
}, CHROME.join(','));

const frames = (n) => page.evaluate(async (want) => {
  await new Promise((res) => {
    let seen = 0;
    const tick = () => { if (++seen >= want) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}, n);

/** Zoom the map by `n` notches, out for a positive count and in for a
 *  negative one. The wheel handler is a fixed 1.1x per EVENT rather than a
 *  function of the delta, so one big scroll is one step and the way anywhere
 *  is to send several. */
const wheel = async (n) => {
  const box = await page.locator('#cv').boundingBox().catch(() => null);
  const at = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: WIDE.width / 2, y: WIDE.height / 2 };
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < Math.abs(n); i++) await page.mouse.wheel(0, n > 0 ? 120 : -120);
};

/** Swing the camera round by a right button drag, which is what the map gives
 *  a mouse for orbiting. The context menu is already suppressed over the
 *  canvas, so this is the same gesture a player makes. */
const orbitBy = async (dx, dy) => {
  const box = await page.locator('#cv').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + dx, cy + dy, { steps: 16 });
  await page.mouse.up({ button: 'right' });
};

/** Wheel until the camera is `want` units out, whatever it started from.
 *
 * A fixed count of notches cannot frame a fleet whose rungs differ by four
 * times in length, and `focusOn` does not land at a fixed distance either: it
 * takes the SMALLER of where the camera already was and a span off the ship's
 * radius, so how close a focus gets depends on where the last shot left it.
 * So the target is a distance, read back off the camera. */
const closeTo = async (want) => {
  let c = null;
  for (let i = 0; i < 60; i++) {
    c = await page.evaluate(() => window.ftDebug.camera());
    if (Math.abs(Math.log(c.goalDist / want)) < 0.05) break;
    await wheel(c.goalDist > want ? -1 : 1);
  }
  // Then wait for the camera to ARRIVE. A zoom sets a goal and the position
  // eases toward it, so aiming at a hull the moment the goal changes aims
  // through a camera that is still moving: the projection is stale by the
  // time the click lands and the press hits empty space.
  for (let i = 0; i < 60; i++) {
    c = await page.evaluate(() => window.ftDebug.camera());
    if (Math.abs(c.dist - c.goalDist) < 0.02 * c.goalDist) break;
    await frames(6);
  }
  return c ? c.dist : 0;
};

// Armed BEFORE the first navigation and never touched again. The chips, the
// tool row and the hint line are the brightest things in the frame, so a
// bounding box taken with them in it is a box round the panel rather than
// round the ship, and `--ladder` crops to exactly that box.
//
// An init script rather than a style tag or an inline style, and that is the
// whole fix: this tool navigates once per hull, and BOTH of those die with the
// document. The per hull loop never hid anything at all and the ladder path
// hid it once, before the first `goto` threw it away, so every shot this tool
// has ever written had the console's own furniture printed across it.
await hideChrome(page);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// The class list comes off the app rather than out of a copy here: a tool with
// its own list of ships is a list that goes stale the day one is added.
const keys = await page.evaluate(() => window.ftDebug?.classes?.() ?? null);
const classes = ONLY ? [ONLY] : (keys ?? []);
if (!classes.length) {
  console.log('no classes: is the server up, and does ftDebug expose classes()?');
  await browser.close();
  process.exit(1);
}

console.log(`${classes.length} hull${classes.length === 1 ? '' : 's'} -> ${OUT}`);

/**
 * The rungs of one navy, cropped and rescaled to a single world scale.
 *
 * The crop is what makes it honest. Each hull is photographed at whatever
 * distance the yard framed it at, so the pixels say nothing about size; the
 * bounding box of the non background pixels is the hull, and scaling that box
 * by the hull's own length puts every rung on one ruler.
 */
async function ladder(faction) {
  const rungs = classes.filter((k) => k.startsWith(`${faction}_`)
    || (faction === 'civil' && (k === 'freighter' || k.startsWith('civil_'))));
  if (!rungs.length) { console.log(`no hulls for ${faction}`); return; }
  const shots = [];
  for (const key of rungs) {
    await page.goto(new URL(`ship/${key}`, BASE).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const grow = page.locator('#dzGrow');
    if (await grow.count() && await grow.isVisible()) await grow.click().catch(() => {});
    await frames(40);
    // Playwright's own screenshot, not `canvas.toDataURL`. The yard is a WebGL
    // canvas without `preserveDrawingBuffer`, so reading it back after the
    // frame is composited hands you a blank image and no error: the first cut
    // of this sheet came out as four empty boxes with the right captions on
    // them.
    const png = await page.locator('#dzCanvas').screenshot();
    const row = rows.find((r) => r.key === key);
    shots.push({ key, length: row ? row.length : 1, cell: row ? row.cell : 0,
      lattice: row ? row.lattice : null, plate: row ? row.plateCells : 0,
      url: 'data:image/png;base64,' + png.toString('base64') });
    console.log(`  ${key}  ${row ? row.length.toFixed(2) : '?'} u`);
  }
  const longest = Math.max(...shots.map((s) => s.length));
  const WIDEST = 820;
  /**
   * Pixels per WORLD UNIT, the same for every row.
   *
   * Each hull is drawn at `WIDEST * length / longest`, so this is constant down
   * the sheet, which is what lets one reference square be a ruler rather than a
   * decoration: a box of this many pixels is one unit on every row.
   */
  const PPU = WIDEST / longest;
  /** One unit, as a box tiled with THAT CLASS's own voxel.
   *
   *  The hulls alone cannot answer "are the voxels the same size", because the
   *  sheet normalises them to their own lengths and a bigger ship drawn from
   *  bigger blocks looks the same as a bigger ship with more of them. The grid
   *  inside this box is the answer: same outer square everywhere, and the
   *  squares inside it are four times coarser on a cruiser than on a frigate. */
  const cube = (cell) => {
    const side = Math.max(8, PPU);
    const vox = Math.max(1, cell * PPU);
    return `<div style="width:${side.toFixed(1)}px;height:${side.toFixed(1)}px;`
      + 'border:1px solid #6ea8d8;box-sizing:border-box;'
      + `background-image:repeating-linear-gradient(to right,#6ea8d855 0 1px,transparent 1px ${vox.toFixed(2)}px),`
      + `repeating-linear-gradient(to bottom,#6ea8d855 0 1px,transparent 1px ${vox.toFixed(2)}px)"></div>`
      + `<div style="font-size:10px;opacity:.75;margin-top:3px">1 u</div>`
      + `<div style="font-size:10px;opacity:.55">voxel ${cell.toFixed(4)}</div>`
      + `<div style="font-size:10px;opacity:.55">${(1 / cell).toFixed(1)} per u</div>`;
  };
  // One page, laid out and photographed, because compositing PNGs in Node
  // means a decoder and a rasteriser this repository has no reason to carry.
  // The CROP happens here too, on a decoded PNG rather than on a live WebGL
  // buffer: what is drawn is the hull's own bounding box, scaled by the hull's
  // own length, so every rung is on one ruler and the camera is out of it.
  const html = `<body style="margin:0;background:#080b10;font:13px system-ui;color:#c8d4e2">
    <div style="padding:14px 18px 8px;font-size:14px;letter-spacing:.10em;text-transform:uppercase">
      ${faction} &middot; every rung to one scale</div>
    <div style="padding:0 18px 10px;font-size:11px;opacity:.7;max-width:900px">
      Every hull is cropped to itself and rescaled by its MEASURED length, so the
      picture is the ladder rather than the camera. The blue box on each row is
      one world unit at that same scale, tiled with that class's own voxel: same
      box everywhere, and the grid inside it is what says whether a voxel is the
      same size from rung to rung. It is, so the grids match and the LATTICE is
      what differs: a bigger ship is more cells, and the plate count beside each
      name is how many of them its skin actually costs.</div>
    ${shots.map((s) => `<div style="display:flex;align-items:center;gap:16px;padding:10px 18px">
      <div style="width:170px;flex:0 0 170px;text-align:right;opacity:.85">${s.key}<br>
        <b style="font-size:15px">${s.length.toFixed(2)} u</b>
        <span style="opacity:.6">&middot; ${(s.length / longest).toFixed(2)}x</span><br>
        <span style="font-size:11px;opacity:.65">${s.lattice ? s.lattice.join(' x ') : ''}</span><br>
        <span style="font-size:11px;opacity:.5">${s.plate} plate cells</span></div>
      <div style="width:${Math.max(8, PPU).toFixed(0)}px;flex:0 0 auto;text-align:left">
        ${cube(s.cell)}</div>
      <canvas data-src="${s.url}" data-w="${Math.round(WIDEST * (s.length / longest))}"
        style="display:block;flex:0 0 auto"></canvas>
    </div>`).join('')}
    <script>
    window.drawn = 0;
    for (const cv of document.querySelectorAll('canvas')) {
      const want = +cv.dataset.w;
      const im = new Image();
      im.onload = () => {
        const g = document.createElement('canvas');
        g.width = im.width; g.height = im.height;
        const gx = g.getContext('2d');
        gx.drawImage(im, 0, 0);
        const px = gx.getImageData(0, 0, im.width, im.height).data;
        let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
        for (let y = 0; y < im.height; y++) {
          for (let x = 0; x < im.width; x++) {
            const i = (y * im.width + x) * 4;
            // The yard's ground is near black; anything brighter is the ship.
            if (px[i] + px[i + 1] + px[i + 2] < 110) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        if (x1 < 0) { window.drawn++; return; }
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        cv.width = want;
        cv.height = Math.max(1, Math.round(ch * want / cw));
        cv.getContext('2d').drawImage(im, x0, y0, cw, ch, 0, 0, cv.width, cv.height);
        window.drawn++;
      };
      im.src = cv.dataset.src;
    }
    </script></body>`;
  // Wide enough for the LONGEST row, computed rather than guessed: label, gaps,
  // the reference cube, the widest hull and the page padding.
  //
  // The sheet was a flat 1060 and the cruiser row wanted 1123, so the row
  // overflowed and the flex items shrank to fit: the canvas came out 757 px
  // where the scale called for 820, and the biggest hull on every ladder was
  // drawn 7.7 percent small. `flex:0 0` above is the other half of it, because
  // a row that still overflowed would squeeze rather than scroll, and the one
  // thing this sheet exists to do is put every rung on one ruler.
  const sheetW = Math.ceil(170 + 16 + Math.max(8, PPU) + 16 + WIDEST + 36 + 8);
  const sheet = await browser.newPage({ viewport: { width: sheetW, height: 900 } });
  await sheet.setContent(html);
  await sheet.waitForFunction((n) => window.drawn === n, shots.length, { timeout: 30000 });
  await sheet.waitForTimeout(200);
  // The sheet's whole claim is that every rung is on ONE RULER, so it checks
  // rather than asserts: what a canvas was ASKED to be against what it ended up
  // on the page. They parted once, silently, because a flex row that overflows
  // shrinks its items instead of scrolling, and the biggest hull on every
  // ladder came out 7.7 percent small.
  const laid = await sheet.evaluate(() => [...document.querySelectorAll('canvas')]
    .map((c) => ({ want: +c.dataset.w, got: Math.round(c.getBoundingClientRect().width) })));
  const off = laid.filter((l) => Math.abs(l.want - l.got) > 1);
  if (off.length) {
    console.log(`  SCALE BROKEN: ${off.length} of ${laid.length} rows are not at their own scale`);
    for (const l of off) console.log(`    wanted ${l.want}px, laid out at ${l.got}px`);
  } else {
    console.log(`  every rung on one ruler: ${laid.length} rows at ${PPU.toFixed(1)} px per unit`);
  }
  const png = await sheet.screenshot({ fullPage: true });
  writeFileSync(`${OUT}/ladder-${faction}.png`, png);
  console.log(`  ladder-${faction}.png  ${(png.length / 1024).toFixed(0)} kB`);
  await sheet.close();
}

/**
 * The battlefield, which is the picture the yard cannot take.
 *
 * The shipyard lights a hull from a studio rig with no sky and no environment,
 * on purpose and for a measured reason. The map has a baked nebula, three
 * lights and bloom, and it is where a player actually looks at a ship: a
 * livery that reads in the yard and washes out on the field is a livery that
 * does not work.
 *
 * `--fleet` seats named hulls through the briefing's own chips rather than
 * through any back door, which is what makes a shot of four navies a shot of
 * the game: a skirmish authored as two frigates a side answers "does a Terran
 * read differently from a Karisen" with four of the same ship.
 */
async function battlefield() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('#bPractice');
  await page.waitForSelector('#briefing:not(.hidden)', { timeout: 15000 });

  if (FLEET) {
    const want = FLEET.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (let i = 0; i < want.length; i++) {
      // Re-queried per row on purpose: a pick re-renders the whole briefing,
      // so a handle taken before the click is a handle onto a dead node.
      const got = await page.evaluate(({ n, name }) => {
        const row = document.querySelectorAll('#briefShips .briefRow')[n];
        if (!row) return null;
        const chip = [...row.querySelectorAll('.picks button')].find(
          (b) => (b.querySelector('.n')?.textContent ?? '').toLowerCase().includes(name));
        if (!chip) return null;
        chip.click();
        return chip.querySelector('.n').textContent;
      }, { n: i, name: want[i] });
      console.log(`  ship ${i + 1}: ${got ?? `no chip matching "${want[i]}"`}`);
      await page.waitForTimeout(150);
    }
  }

  await page.click('#briefGo');
  await page.waitForFunction(
    () => document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 30000 });
  await frames(80);

  const wide = await page.screenshot();
  writeFileSync(`${OUT}/map-wide.png`, wide);
  console.log(`  map-wide.png  ${(wide.length / 1024).toFixed(0)} kB`);

  // Then one close up per hull, because the wide shot is what the FIELD looks
  // like and the question here is what a SHIP looks like on it.
  const keys = await page.evaluate(() => window.ftDebug.classes());
  const fleet = await page.evaluate(() => window.ftDebug.ships());
  for (const s of fleet) {
    // Back out until the hull is inside the CANVAS, then check afterwards
    // which hull the press actually landed on, and try again if it was the
    // wrong one.
    //
    // Three traps, and the first wrote a wrong picture under a right name.
    // A focus locks the camera on its ship, so from there the next hull sits
    // off to one side; `screenOf` answers in page pixels and the map canvas
    // is a 560 pixel column inside an 1100 pixel page, so an aim of 889 is a
    // click on the EVENTS panel rather than a miss anyone can see. Bounds are
    // the canvas rect for that reason. Backing out is what brings a hull in,
    // since the offset from a locked focus shrinks as the camera retreats,
    // which is why that is a loop rather than one step. And backing far
    // enough out to see a hull puts its neighbour on top of it: a side's two
    // ships start eleven units apart and a cruiser's pick sphere is seven
    // across, so a press aimed at the far one lands on the near one. Backing
    // off does not help there and repeating the press helps less, since the
    // ray is unchanged: the retry ORBITS first, and further each time.
    const box = await page.locator('#cv').boundingBox();
    let at = null;
    let hit = false;
    for (let attempt = 0; attempt < 4 && !hit; attempt++) {
      if (attempt === 0) await closeTo(150);
      // A repeat of a press that missed misses again: the camera has not
      // moved, so the ray is the same ray. What defeats one hull standing in
      // front of another is a different ANGLE, and further each time.
      else await orbitBy(140 * attempt, 60);
      at = null;
      for (let tries = 0; tries < 12; tries++) {
        await frames(10);
        const seen = await page.evaluate((id) => window.ftDebug.screenOf(id), s.id);
        if (seen && seen.x > box.x + 12 && seen.y > box.y + 12
          && seen.x < box.x + box.width - 12 && seen.y < box.y + box.height - 12) {
          at = seen;
          break;
        }
        if ((await page.evaluate(() => window.ftDebug.camera())).goalDist > 880) break;
        await wheel(4);
      }
      if (!at) break;
      // First press names the hull, second goes and looks at it.
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(400);
      await page.mouse.dblclick(at.x, at.y);
      await frames(60);
      const c = await page.evaluate(() => window.ftDebug.camera());
      hit = c.follow === s.id;
      if (!hit) {
        console.log(`  ship ${s.id}: pressed ${at.x | 0},${at.y | 0} at ${c.dist} u`
          + ` and the camera followed ${c.follow}`);
      }
    }
    if (!at) { console.log(`  ship ${s.id}: never came onto the canvas`); continue; }
    if (!hit) { console.log(`  ship ${s.id}: every press landed on another hull`); continue; }
    // Frame the ship by its own LENGTH, and inside twelve units either way.
    // A focus lands well outside the movement envelope, and inside the
    // envelope the hull reads through a green wash: the shell fades below
    // twenty units and is gone by twelve. The labels go too, since a double
    // click turns them on and they are drawn over the thing being looked at.
    const row = rows.find((r) => r.key === keys[s.cls]);
    const want = Math.max(3.5, Math.min(11.5, 0.85 * (row ? row.length : 8)));
    const got = await closeTo(want);
    const labels = page.locator('#bInspect');
    if (await labels.count() && await labels.isVisible()
      && (await labels.getAttribute('class') ?? '').includes('on')) {
      await labels.click().catch(() => {});
    }
    // And take the pointer off the canvas, or the shot carries the hover tip
    // for whatever cell it was left over. `pointerleave` is what puts it down.
    await page.mouse.move(WIDE.width - 60, 200);
    await frames(90);
    const png = await page.screenshot();
    const name = `map-${s.id}-${keys[s.cls] ?? s.cls}`;
    writeFileSync(`${OUT}/${name}.png`, png);
    console.log(`  ${name}.png  side ${s.side}  ${got.toFixed(1)} u out`
      + `  ${(png.length / 1024).toFixed(0)} kB`);
  }
}

if (MAP) {
  await battlefield();
} else if (LADDER) {
  await ladder(LADDER);
} else {
  for (const key of classes) {
    await page.goto(new URL(`ship/${key}`, BASE).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const grow = page.locator('#dzGrow');
    if (await grow.count() && await grow.isVisible()) await grow.click().catch(() => {});
    if (BARE) await page.locator('#dzPlate').click().catch(() => {});
    await frames(40);
    const shot = await page.locator('#dzCanvas').screenshot();
    const name = `${key}${BARE ? '-bare' : ''}.png`;
    writeFileSync(`${OUT}/${name}`, shot);
    console.log(`  ${name}  ${(shot.length / 1024).toFixed(0)} kB`);
  }
}

await browser.close();
