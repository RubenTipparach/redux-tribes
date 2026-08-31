// Bundle the client. esbuild only: no framework, no plugin chain, because the
// simulation lives in wasm and the renderer is three.js talking to it.
import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync, cpSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

// EVERYTHING in public/ ships, rather than a list of names here. The names
// were listed once and `server/Dockerfile` copied a different set into the
// client stage, so the first committed texture typechecked, passed four suites
// and then failed the image build with ENOENT on `public/ember.png`. One rule
// now: a file in public/ ships, and adding an asset is dropping it in there.
cpSync('public', 'dist', { recursive: true });
copyFileSync('index.html', 'dist/index.html');

// A directory copy cannot fail the way a named copy does, so the assets the
// client cannot run without are asserted instead. This is a GUARD, not the
// shipping list: anything else in public/ went out with the copy above and
// does not need naming. What it catches is the same drift as before, one step
// later, where an image is missing an asset and the page half loads.
for (const need of ['sim_core.wasm', 'ember.png']) {
  if (!existsSync(`dist/${need}`)) {
    console.error(`build.mjs: web/public/${need} is missing, so dist/ is not shippable.`);
    console.error('If this is the image build, the client stage did not receive web/public/.');
    process.exit(1);
  }
}

const opts = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('watching');
} else {
  await build(opts);
}
