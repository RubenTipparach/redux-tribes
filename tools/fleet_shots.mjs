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
const frames = (n) => page.evaluate(async (want) => {
  await new Promise((res) => {
    let seen = 0;
    const tick = () => { if (++seen >= want) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}, n);

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
    // The chips and the tool row are BRIGHTER than the ship, so a bounding
    // box taken over the shot with them in it is a box round the panel. They
    // are hidden for the photograph and nothing else: this tool takes
    // pictures, it does not drive the app.
    await page.evaluate(() => {
      for (const id of ['dzClasses', 'dzTools', 'dzHint', 'dzPick']) {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      }
    });
    await frames(40);
    // Playwright's own screenshot, not `canvas.toDataURL`. The yard is a WebGL
    // canvas without `preserveDrawingBuffer`, so reading it back after the
    // frame is composited hands you a blank image and no error: the first cut
    // of this sheet came out as four empty boxes with the right captions on
    // them.
    const png = await page.locator('#dzCanvas').screenshot();
    const row = rows.find((r) => r.key === key);
    shots.push({ key, length: row ? row.length : 1,
      url: 'data:image/png;base64,' + png.toString('base64') });
    console.log(`  ${key}  ${row ? row.length.toFixed(2) : '?'} u`);
  }
  const longest = Math.max(...shots.map((s) => s.length));
  const WIDEST = 820;
  // One page, laid out and photographed, because compositing PNGs in Node
  // means a decoder and a rasteriser this repository has no reason to carry.
  // The CROP happens here too, on a decoded PNG rather than on a live WebGL
  // buffer: what is drawn is the hull's own bounding box, scaled by the hull's
  // own length, so every rung is on one ruler and the camera is out of it.
  const html = `<body style="margin:0;background:#080b10;font:13px system-ui;color:#c8d4e2">
    <div style="padding:14px 18px 8px;font-size:14px;letter-spacing:.10em;text-transform:uppercase">
      ${faction} &middot; every rung to one scale</div>
    ${shots.map((s) => `<div style="display:flex;align-items:center;gap:16px;padding:10px 18px">
      <div style="width:170px;text-align:right;opacity:.85">${s.key}<br>
        <b style="font-size:15px">${s.length.toFixed(2)} u</b>
        <span style="opacity:.6">&middot; ${(s.length / longest).toFixed(2)}x</span></div>
      <canvas data-src="${s.url}" data-w="${Math.round(WIDEST * (s.length / longest))}"
        style="display:block"></canvas>
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
  const sheet = await browser.newPage({ viewport: { width: 1060, height: 900 } });
  await sheet.setContent(html);
  await sheet.waitForFunction((n) => window.drawn === n, shots.length, { timeout: 30000 });
  await sheet.waitForTimeout(200);
  const png = await sheet.screenshot({ fullPage: true });
  writeFileSync(`${OUT}/ladder-${faction}.png`, png);
  console.log(`  ladder-${faction}.png  ${(png.length / 1024).toFixed(0)} kB`);
  await sheet.close();
}

if (LADDER) {
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
