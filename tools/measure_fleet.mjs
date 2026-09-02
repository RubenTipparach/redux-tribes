/**
 * What every stock hull actually MEASURES, printed as a table.
 *
 * `data.rs` carries each class's hull, radius, mass, flight envelope, marines,
 * capacity and boarding range, and CLAUDE.md says those are what
 * `derive(stockFor(key))` really produces rather than numbers somebody liked
 * the look of. That claim needs a way to be checked, and re-deriving it by
 * hand after every frame edit is how a table drifts: this is the one command
 * that answers it.
 *
 * It also prints the WORLD size of each hull, which no test asserted and no
 * table recorded. A rung is a cell size, so a class's real length is its
 * lattice extent times that cell, and the tier ladder (a destroyer half again
 * a frigate, a cruiser twice it) is a claim about THAT number rather than
 * about the rung on its own: a longer profile at a bigger cell is bigger
 * twice over, and nothing said so until this printed both.
 *
 *   node tools/measure_fleet.mjs            # the table
 *   node tools/measure_fleet.mjs --json     # the same, machine readable
 *   node tools/measure_fleet.mjs --rust     # the data.rs rows, to paste
 *
 * Needs `web/public/sim_core.wasm`, which `npm --prefix web run sim` builds:
 * the arithmetic is the core's (ADR-2) and this asks it rather than repeating
 * it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const web = resolve(root, 'web');

// esbuild is the client's dev dependency and this tool lives outside it, so
// it is resolved from `web/` rather than from here. Running the tool from the
// repository root is the whole point: it prints a table about the fleet, and
// the fleet is not a thing you are inside `web/` to look at.
const { build } = createRequire(resolve(web, 'package.json'))('esbuild');

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

const { Sim } = await load('src/sim/wasm.ts');
const design = await load('src/app/design.ts');
const types = await load('src/sim/types.ts');
const { FRAMES, RUNG, stockFor, rasterise, derive, mountsOf, useCore } = design;
const { CLASS_KEYS } = types;

const sim = await Sim.load(readFileSync(resolve(web, 'public/sim_core.wasm')));
const match = sim.match();
useCore((classIdx, geo, parts) => sim.derive(classIdx, geo, parts));

const rows = FRAMES.map((f) => {
  const d = stockFor(f.classKey);
  const r = rasterise(d);
  const stats = derive(d);
  const cell = RUNG[f.rung];
  const [ex, ey, ez] = r.extent;
  const idx = CLASS_KEYS.indexOf(f.classKey);
  const core = idx >= 0 ? match.classInfo(idx) : null;
  return {
    key: f.classKey,
    name: f.name,
    faction: f.faction,
    tier: f.tier,
    rung: f.rung,
    cell,
    latticeExtent: [ex, ey, ez],
    // Length, beam and depth in world units: the size a player actually sees.
    world: [ex * cell, ey * cell, ez * cell].map((v) => +v.toFixed(3)),
    length: +(ez * cell).toFixed(3),
    beam: +(ex * cell).toFixed(3),
    depth: +(ey * cell).toFixed(3),
    plateCells: r.plateCells,
    parts: d.parts.length,
    mounts: mountsOf(d).length,
    mass: +stats.mass.toFixed(6),
    massMax: stats.massMax,
    hull: +stats.hull.toFixed(3),
    radius: +stats.radius.toFixed(6),
    frameRadius: f.radius,
    marines: stats.marines,
    capacity: stats.capacity,
    boardingRange: +stats.boardingRange.toFixed(3),
    accelFwd: +stats.accelFwd.toFixed(4),
    accelRetro: +stats.accelRetro.toFixed(4),
    accelLat: +stats.accelLat.toFixed(4),
    maxSpeed: +stats.maxSpeed.toFixed(4),
    yaw: +stats.yaw.toFixed(4),
    pitch: +stats.pitch.toFixed(4),
    legal: stats.legal,
    failed: stats.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`),
    coreRadius: core ? +core.radius.toFixed(6) : null,
    coreMass: core ? +core.mass.toFixed(6) : null,
    coreHull: core ? +core.hull.toFixed(3) : null,
    coreMounts: core ? core.mountCount : null,
  };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--rust')) {
  for (const r of rows) {
    console.log(`// ${r.name}: ${r.length} u long, ${r.beam} beam, ${r.depth} deep`);
    console.log(`hull: ${r.hull}, radius: ${r.radius}, mass: ${r.mass}, `
      + `rung_cell: ${r.cell}, marines: ${r.marines}, capacity: ${r.capacity}, `
      + `boarding_range: ${r.boardingRange},`);
  }
} else {
  // A rung is quoted against ITS OWN NAVY'S frigate, which is the only
  // comparison the ladder actually claims: a Rogue is the shortest hull in the
  // game at every rung, so measuring its cruiser against a Terran frigate says
  // something true about Rogues and nothing at all about the ladder.
  const frigateOf = (fac) => rows.find((r) => r.faction === fac && r.tier === 'frigate')
    ?? rows.find((r) => r.faction === fac) ?? rows[0];
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log(pad('class', 22) + num('len', 7) + num('beam', 7) + num('deep', 7)
    + num('xFrig', 7) + num('radius', 9) + num('mass', 9) + num('/max', 7)
    + num('plate', 7) + num('mounts', 7) + '  legal');
  console.log('-'.repeat(96));
  for (const r of rows) {
    const ok = r.legal ? 'yes' : 'NO';
    const agree = r.coreRadius !== null
      && Math.abs(r.coreRadius - r.frameRadius) < 1e-4
      && Math.abs(r.coreMass - r.massMax) < 1e-4;
    console.log(pad(r.key, 22) + num(r.length.toFixed(2), 7) + num(r.beam.toFixed(2), 7)
      + num(r.depth.toFixed(2), 7)
      + num((r.length / frigateOf(r.faction).length).toFixed(2), 7)
      + num(r.radius.toFixed(3), 9) + num(r.mass.toFixed(3), 9)
      + num((r.mass / r.massMax).toFixed(2), 7)
      + num(r.plateCells, 7) + num(r.mounts, 7) + '  ' + ok
      + (agree ? '' : '  <- frame and core disagree'));
    for (const why of r.failed) console.log(' '.repeat(24) + 'x ' + why);
  }
}
