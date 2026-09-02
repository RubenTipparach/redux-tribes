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
import { readFileSync, writeFileSync } from 'node:fs';
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
const { FRAMES, RUNG, stockFor, rasterise, derive, mountsOf, partsOf, useCore } = design;
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
    // What the core is actually handed, so a fixture can be GENERATED from
    // the fleet rather than typed out of a screenshot of it.
    geo: { plateCells: r.plateCells, ext: [...r.extent], radiusCells: r.radiusCells,
      fouled: r.fouled },
    partList: partsOf(d),
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

/**
 * A float Rust will accept. `8` is an integer literal and an `f32` field wants
 * `8.0`, and a generated table that does not compile is a table nobody will
 * regenerate.
 */
const f32 = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

/**
 * What a class's table entry SHOULD say, from what its stock hull derives.
 *
 * Nine of these are the stock ship's own numbers outright: hull, the six
 * flight stats, marines, capacity and boarding range are what a scenario
 * spawns, and if they disagree with the yard then the hull a briefing fields
 * flies unlike the one a level seats.
 *
 * Two are not, and cannot be, because they are GATES rather than outputs. The
 * class radius is the sphere a design must fit inside and the class mass is
 * the berth it must weigh less than, so both carry headroom over the stock
 * hull on purpose: a stock ship exactly on its own ceiling is a ship a player
 * cannot add one part to. Eight percent and eighty five percent are what the
 * authored table already used, measured across the seventeen it was written
 * by hand for.
 */
const SPHERE_ROOM = 1.08;
const BERTH_FILL = 0.85;
const wanted = (r) => ({
  hull: +r.hull.toFixed(4),
  radius: +(Math.ceil(r.radius * SPHERE_ROOM * 10) / 10).toFixed(4),
  mass: +(Math.ceil((r.mass / BERTH_FILL) * 100) / 100).toFixed(4),
  rung_cell: r.cell,
  yaw_rate: r.yaw,
  pitch_rate: r.pitch,
  accel_fwd: r.accelFwd,
  accel_retro: r.accelRetro,
  accel_lat: r.accelLat,
  max_speed: r.maxSpeed,
  boarding_range: r.boardingRange,
  marines: r.marines,
  boarding_capacity: r.capacity,
});

/**
 * Rewrite the radius a class's VOLUMES are sized to, wherever they live.
 *
 * `hull_subs` and `civil_subs` take a radius and scale the whole layout by it,
 * and nothing linked that argument to the class's own radius: the Rogue
 * frigate's volumes were sized to 3.5 against a hull that collided at 3.2, and
 * its drive bay cleared the plating by five hundredths of a unit. Measure the
 * radius and that slack goes, so the two have to be the same number rather
 * than two numbers that happen to agree.
 */
const patchSubs = (src, blockKey, radius) => {
  const at = src.indexOf(`    key: "${blockKey}",`);
  if (at < 0) throw new Error(`no class block for ${blockKey}`);
  const end = src.indexOf('};', at);
  const m = /\n\s*subsystems: &([A-Z0-9_]+),/.exec(src.slice(at, end));
  if (!m) throw new Error(`no subsystems on ${blockKey}`);
  const re = new RegExp(`(static ${m[1]}: \\[SubDef; \\d+\\] = [a-z_]+\\()[0-9.]+`);
  if (!re.test(src)) throw new Error(`no sub table ${m[1]}`);
  return src.replace(re, `$1${radius}`);
};

/** Rewrite one `field: value,` inside one `static C_*: ShipClass = {...};`. */
const patchRust = (src, blockKey, field, value) => {
  const at = src.indexOf(`    key: "${blockKey}",`);
  if (at < 0) throw new Error(`no class block for ${blockKey}`);
  const end = src.indexOf('};', at);
  const head = src.slice(0, at), body = src.slice(at, end), tail = src.slice(end);
  const re = new RegExp(`(\\n\\s*${field}: )[^,]+,`);
  if (!re.test(body)) throw new Error(`no field ${field} on ${blockKey}`);
  return head + body.replace(re, `$1${value},`) + tail;
};

if (process.argv.includes('--sync') || process.argv.includes('--check')) {
  // The one command that makes CLAUDE.md's claim true rather than hopeful:
  // "a class's hull, radius, mass, flight envelope, marines, capacity and
  // boarding range in data.rs are what derive(stockFor(key)) actually
  // produces, measured rather than guessed". Seventeen were, once, by hand.
  // Twenty three cannot be, and the day one of them drifted nothing would
  // have said so, because no suite compares the two.
  const dataPath = resolve(root, 'engine/sim_core/src/data.rs');
  const designPath = resolve(web, 'src/app/design.ts');
  let rust = readFileSync(dataPath, 'utf8');
  let ts = readFileSync(designPath, 'utf8');
  const drift = [];
  for (const r of rows) {
    const want = wanted(r);
    for (const [field, value] of Object.entries(want)) {
      const isInt = field === 'marines' || field === 'boarding_capacity';
      const lit = isInt ? String(value) : f32(value);
      const before = rust;
      rust = patchRust(rust, r.key, field, lit);
      if (before !== rust) drift.push(`${r.key}.${field} -> ${lit}`);
    }
    const beforeSubs = rust;
    rust = patchSubs(rust, r.key, f32(want.radius));
    if (beforeSubs !== rust) drift.push(`${r.key} volumes sized to ${want.radius}`);
    // The frame's copy of the two gates, which the editor draws its budget bar
    // from before it has asked the core anything. sim.test.mjs pins them to
    // 1e-4 of each other; if they part, a hull reads legal and is refused.
    const at = ts.indexOf(`classKey: '${r.key}',`);
    if (at < 0) throw new Error(`no frame for ${r.key}`);
    const end = ts.indexOf('note:', at);
    const head = ts.slice(0, at), body = ts.slice(at, end), tail = ts.slice(end);
    const fixed = body
      .replace(/radius: [0-9.]+,/, `radius: ${want.radius},`)
      .replace(/massMax: [0-9.]+,/, `massMax: ${want.mass},`);
    if (fixed !== body) drift.push(`${r.key} frame gates`);
    ts = head + fixed + tail;
  }
  if (process.argv.includes('--check')) {
    if (!drift.length) {
      console.log(`the class table matches the fleet (${rows.length} classes)`);
    } else {
      console.log(`the class table has drifted from the fleet:`);
      for (const d of drift) console.log('  ' + d);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(dataPath, rust);
    writeFileSync(designPath, ts);
    console.log(drift.length
      ? `rewrote ${drift.length} field${drift.length === 1 ? '' : 's'} from the fleet`
      : `nothing to rewrite: the class table already matches`);
  }
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--fixtures')) {
  // The `engine/sim_core/tests/design.rs` table, generated. The file's own
  // header says the fixtures come from the editor, and hand copying twenty
  // three of them at fourteen digits each is how a table stops meaning that.
  const ID = {
    terran_frigate: 'TerranFrigate', karisen_frigate: 'KarisenFrigate',
    rogue_frigate: 'RogueFrigate', benefactor_frigate: 'BenefactorFrigate',
    freighter: 'Freighter',
    terran_corvette: 'TerranCorvette', terran_destroyer: 'TerranDestroyer',
    terran_cruiser: 'TerranCruiser',
    karisen_corvette: 'KarisenCorvette', karisen_destroyer: 'KarisenDestroyer',
    karisen_cruiser: 'KarisenCruiser',
    rogue_corvette: 'RogueCorvette', rogue_destroyer: 'RogueDestroyer',
    rogue_cruiser: 'RogueCruiser',
    benefactor_corvette: 'BenefactorCorvette',
    benefactor_destroyer: 'BenefactorDestroyer',
    benefactor_cruiser: 'BenefactorCruiser',
    civil_lighter: 'CivilLighter', civil_hauler: 'CivilHauler',
    civil_boxship: 'CivilBoxship', civil_tanker: 'CivilTanker',
    civil_miner: 'CivilMiner', civil_liner: 'CivilLiner',
  };
  for (const r of rows) {
    const d = stockFor(r.key);
    const st = derive(d);
    console.log(`        (ShipClassId::${ID[r.key] ?? r.key},`);
    console.log(`         &[${r.partList.join(', ')}],`);
    console.log(`         Geometry { plate_cells: ${r.geo.plateCells}, `
      // Through `f32` like every other float. A radius that lands on a whole
      // number prints as `22` in JavaScript and Rust refuses an integer where
      // it wants an f32, so the generated table would not compile on exactly
      // the hulls whose numbers came out roundest.
      + `ext: [${r.geo.ext.join(', ')}], radius_cells: ${f32(r.geo.radiusCells)}, `
      + `fouled: ${r.geo.fouled} },`);
    console.log(`         Expect { mass: ${f32(st.mass)}, hull: ${f32(st.hull)}, `
      + `radius: ${f32(st.radius)}, accel_fwd: ${f32(st.accelFwd)}, `
      + `accel_retro: ${f32(st.accelRetro)}, accel_lat: ${f32(st.accelLat)}, `
      + `max_speed: ${f32(st.maxSpeed)}, yaw: ${f32(st.yaw)}, pitch: ${f32(st.pitch)}, `
      + `reach_u: ${f32(st.reachU)}, marines: ${st.marines}, capacity: ${st.capacity}, `
      + `boarding_range: ${f32(st.boardingRange)}, legal: ${st.legal} }),`);
  }
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
