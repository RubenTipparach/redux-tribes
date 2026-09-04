/**
 * The fleet, as a page somebody can read: every hull, its picture, its
 * numbers, and what makes its yard distinct.
 *
 * The fleet was documented in three places and none of them was about the
 * SHIPS. `docs/DESIGN.md` reconstructs the archived Unity game, CLAUDE.md
 * carries the design language as prose for whoever changes the code next, and
 * `measure_fleet.mjs` prints a table of figures with no pictures beside them.
 * `docs/SHIP_DESIGNER.md` was worse than absent: it still describes five
 * classes on a 7/256 cell, which the per class lattices replaced.
 *
 *   node tools/fleet_handbook.mjs                    # renders and writes
 *   node tools/fleet_handbook.mjs --shots DIR        # reuse renders
 *   node tools/fleet_handbook.mjs --out fleet.html   # somewhere else
 *
 * It needs a server, the same one every other harness here drives:
 *
 *   npm --prefix web run build
 *   PORT=8123 DATABASE_PATH=":memory:" CLIENT_DIR=web/dist node server/dist/index.js &
 *
 * EVERY NUMBER ON THE PAGE IS MEASURED, not transcribed. The dimensions,
 * masses, hulls and mount lists come from `derive(stockFor(key))` through the
 * core, exactly as `measure_fleet.mjs --check` does, and the hull sections are
 * the real `profile` stations off each frame. A handbook with its own copy of
 * the fleet's numbers is a handbook that is wrong by the end of the week, and
 * that is the whole reason this is a generator rather than a file.
 *
 * The OUTPUT is not committed, for the reason `fleet_shots.mjs` gives about
 * its own PNGs: the source of these pictures is the ship, the ship is already
 * in the repository, and a few megabytes of renders go stale the moment a
 * colour moves. Run it when you want to look at the fleet.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const web = resolve(root, 'web');
const { build } = createRequire(resolve(web, 'package.json'))('esbuild');

const arg = (name, dflt) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : dflt;
};
const OUT = resolve(arg('out', '/tmp/fleet-handbook.html'));
const SHOTS = arg('shots', null);

/** Bundle a client module into memory and import it, so this reads the real
 *  source rather than a hand copy of it. */
const load = async (rel) => {
  const out = await build({
    entryPoints: [resolve(web, rel)],
    bundle: true, format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
  });
  return import('data:text/javascript;base64,'
    + Buffer.from(out.outputFiles[0].text).toString('base64'));
};

// ------------------------------------------------------------- the yards --

/**
 * What a yard IS, in the words the code is already written in.
 *
 * The only authored prose in this tool, and it is authored here rather than
 * derived because "Rogue ships are built to take a hull rather than kill it"
 * is a design intention and no measurement will ever produce it. Everything
 * around it on the page is measured, and where a claim here can be checked
 * against the fleet it is: `evidence` names the figure that carries it, and
 * the page prints that figure next to the sentence rather than asking anyone
 * to take it on trust.
 */
const YARDS = [
  {
    key: 'terran',
    name: 'Terran Commonwealth',
    code: 'TCNS',
    hue: '#0095E9',
    hueDark: '#0095E9',
    line: 'A working navy that solved the problem once and then built it bigger.',
    section: 'Wide and flat. The broadest deck in the fleet for its depth, which is what puts guns on the centreline and keeps them there.',
    ladder: 'Adds beam batteries at every rung and changes nothing else. A heavy cruiser is a frigate with eight mounts instead of three.',
    decor: 'Stepped strakes and vertical fluting down the deck and flanks, laid clear of the centreline so nothing stands in front of a gun.',
    finish: 'Riveted plate. A standard, applied everywhere, by people who have built a lot of these.',
    evidence: 'mounts',
  },
  {
    key: 'karisen',
    name: 'Karisen Empire',
    code: 'IKS',
    hue: '#D2560A',
    hueDark: '#D2560A',
    line: 'Long, narrow and near round, and it fights at a distance it chose.',
    section: 'The longest hull per unit of beam in the fleet. Almost circular in section, which is the cheapest shape to pressurise and the worst to hide.',
    ladder: 'Keeps two beams forever and adds MISSILE CELLS. The cruiser carries the same pair of turrets its corvette does, behind four cells of ordnance.',
    decor: 'A rail that overruns the hull at both ends, so the silhouette reads longer than the ship.',
    finish: 'Corrugated. It plates all four long faces and the corrugation gives the hull a direction.',
    evidence: 'ordnance',
  },
  {
    key: 'rogue',
    name: 'Rogue Interests',
    code: 'RIS',
    hue: '#6B5FA8',
    hueDark: '#6B5FA8',
    line: 'Built to take a hull, not to kill it. The least ship in the game and the most marines on it.',
    section: 'Short and very broad. It gives up length for beam, which is berths and clamps rather than magazine.',
    ladder: 'Adds BERTHS AND CLAMPS and almost no guns. A Rogue heavy cruiser fields four mounts against a Terran eight.',
    decor: 'A gantry welded across the beam and blisters set abaft the gun rings, where they cannot foul an arc.',
    finish: 'Battered and barely metallic. Nothing here was built new.',
    evidence: 'boarding',
  },
  {
    key: 'benefactor',
    name: 'Benefactors',
    code: 'BNS',
    hue: '#1A7A3E',
    hueDark: '#2FA85B',
    line: 'The one hull in the fleet that looks engineered rather than fabricated.',
    section: 'Deeper than it is wide, which is the opposite of everyone else and the reason its belts are so thick.',
    ladder: 'Adds BELT AND CALIBRE, and gets slower at every step. It is the only ladder that trades speed away on purpose.',
    decor: 'Wings swept off the keel line.',
    finish: 'Ablative hex, tight and glossy.',
    evidence: 'plate',
  },
  {
    key: 'civil',
    name: 'Civil Yards',
    code: 'CIV',
    hue: '#8B7A3F',
    hueDark: '#C0A24A',
    line: 'Not a ladder. Seven trades, and the shape follows the cargo.',
    section: 'Nearly square, because a container is.',
    ladder: 'There is no ladder. A tanker is a bulge round a cylinder, a liner is a wall of windows, a boxship is a rack, and none of them is a rung of the others.',
    decor: 'Rack rails to stack boxes on.',
    finish: 'Grip deck, with almost no specular.',
    evidence: 'unarmed',
  },
];

const RUNGS = [
  { key: 'corvette', name: 'Corvette', lattice: '24 x 24 x 48' },
  { key: 'frigate', name: 'Frigate', lattice: '32 x 32 x 64' },
  { key: 'destroyer', name: 'Destroyer', lattice: '48 x 48 x 96' },
  { key: 'cruiser', name: 'Heavy cruiser', lattice: '64 x 64 x 128' },
];

// ------------------------------------------------------------ the fleet --

console.log('measuring the fleet');
const measured = JSON.parse(execFileSync('node',
  [resolve(here, 'measure_fleet.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }));

const D = await load('src/app/design.ts');
const T = await load('src/sim/types.ts');
D.useCore(() => null);

const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');
const ships = [];
for (const row of measured) {
  const d = D.stockFor(row.key);
  const frame = D.frameFor(row.key);
  const socks = D.socketsOf(frame, d.parts);
  const mounts = [], jobs = {};
  for (const p of d.parts) {
    const m = D.moduleById(p.module);
    if (!m) continue;
    if (m.weapon) {
      const g = D.gunByKey(m.weapon);
      const sock = socks.find(s => s.id === p.socket);
      mounts.push({ name: m.name, gun: g ? g.name : m.weapon,
        where: sock ? sock.label : p.socket });
    }
    const job = m.purpose ?? 'structure';
    jobs[job] = (jobs[job] ?? 0) + 1;
  }
  const fin = D.finishesOf(d);
  const finName = (D.FINISHES.find(f => f.key === fin.armour) ?? {}).name ?? fin.armour;
  ships.push({
    ...row,
    mountList: mounts,
    jobs,
    finish: finName,
    paint: hex(d.paint),
    // The real hull stations, in lattice cells: [z, half beam, half depth].
    // This is what the page draws its plan and section views from, so the
    // silhouette on the page is the silhouette the rasteriser builds.
    profile: frame.profile.map(s => [s[0], s[1], s[2]]),
  });
}

const palettes = Object.fromEntries(D.FACTION_PAINT.map(f =>
  [f.key, f.swatches.map(hex)]));
const gunSpec = D.GUNS.map(g => ({ name: g.name, dmg: g.dmg, batch: g.batch,
  range: g.range, cooldown: g.cooldown, pen: g.pen,
  allRound: Math.abs(g.arcH[1] - g.arcH[0]) >= 360 }));

console.log(`  ${ships.length} hulls measured`);

// ------------------------------------------------------------ the shots --

/**
 * A picture per hull, re-encoded small enough to put IN the page.
 *
 * `fleet_shots.mjs` writes 1100x760 PNGs at about 180 kB each, which is 4 MB
 * of fleet before any text. They go through a canvas and come out WebP, which
 * is what makes a self contained file a reasonable thing to hand somebody:
 * the page has to work with no server behind it, so every image is a data URI
 * and every byte of them is a byte of the file.
 */
const shotDir = SHOTS ?? (() => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-shots-'));
  console.log('rendering the fleet (this drives the real shipyard, so it is slow)');
  execFileSync('node', [resolve(here, 'fleet_shots.mjs'), '--out', dir],
    { stdio: 'inherit' });
  return dir;
})();

const have = new Set(readdirSync(shotDir).filter(f => f.endsWith('.png')));
const missing = ships.filter(s => !have.has(`${s.key}.png`)).map(s => s.key);
if (missing.length) {
  console.error(`no render for ${missing.join(', ')} in ${shotDir}`);
  process.exit(1);
}

console.log('re-encoding the renders');
const pw = (await import('/opt/node22/lib/node_modules/playwright/index.js')).default;
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const art = {};
for (const s of ships) {
  const png = readFileSync(join(shotDir, `${s.key}.png`)).toString('base64');
  art[s.key] = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    // Trim the dead space around the hull first: the shipyard frames each ship
    // to fill its view, so most of a 1100x760 render is empty sky and it is
    // the expensive part of the file.
    const probe = document.createElement('canvas');
    probe.width = img.width; probe.height = img.height;
    const pc = probe.getContext('2d', { willReadFrequently: true });
    pc.drawImage(img, 0, 0);
    const px = pc.getImageData(0, 0, img.width, img.height).data;
    // The ground is the darkest thing in the frame, so anything appreciably
    // above it is ship. A generous threshold, because a Rogue hull is nearly
    // as dark as the sky behind it.
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const lum = px[i] * 0.3 + px[i + 1] * 0.6 + px[i + 2] * 0.1;
        if (lum < 26) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = img.width - 1; y1 = img.height - 1; }
    const pad = 12;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(img.width - 1, x1 + pad); y1 = Math.min(img.height - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const scale = Math.min(1, 720 / cw);
    const c = document.createElement('canvas');
    c.width = Math.round(cw * scale); c.height = Math.round(ch * scale);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x0, y0, cw, ch, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/webp', 0.82), w: c.width, h: c.height };
  }, `data:image/png;base64,${png}`);
  process.stdout.write(`  ${s.key} ${Math.round(art[s.key].url.length / 1024)} kB\r`);
}
await browser.close();
console.log(`  ${ships.length} renders, `
  + `${Math.round(Object.values(art).reduce((a, v) => a + v.url.length, 0) / 1024)} kB total`);

// ------------------------------------------------------------- the page --

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, dp = 2) => Number(v).toFixed(dp);

const data = { ships, yards: YARDS, rungs: RUNGS, palettes, guns: gunSpec, art };
const html = readFileSync(resolve(here, 'fleet_handbook.template.html'), 'utf8')
  .replace('/*__DATA__*/', () => JSON.stringify(data));

writeFileSync(OUT, html);
console.log(`\n${OUT}  ${Math.round(html.length / 1024)} kB`);
console.log(`${ships.length} hulls, ${YARDS.length} yards`);
