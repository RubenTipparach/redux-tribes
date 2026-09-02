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
 *
 * The shots are NOT committed. They are a thing to look at while working, and
 * a directory of megabytes of PNGs that go stale the moment a colour moves is
 * not a thing a repository should carry (GUIDELINES 3 wants the source of an
 * asset beside it; the source of these is the ship, and it is already here).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
const WIDE = has('mobile') ? { width: 390, height: 844 } : { width: 1100, height: 760 };

mkdirSync(OUT, { recursive: true });

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
for (const key of classes) {
  await page.goto(new URL(`ship/${key}`, BASE).href, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  // Give the model the whole screen, so the shot is of a ship rather than of
  // a ship beside a panel.
  const grow = page.locator('#dzGrow');
  if (await grow.count() && await grow.isVisible()) await grow.click().catch(() => {});
  if (BARE) await page.locator('#dzPlate').click().catch(() => {});
  await frames(40);
  const canvas = page.locator('#dzCanvas');
  const shot = await canvas.screenshot();
  const name = `${key}${BARE ? '-bare' : ''}.png`;
  writeFileSync(`${OUT}/${name}`, shot);
  console.log(`  ${name}  ${(shot.length / 1024).toFixed(0)} kB`);
}

await browser.close();
