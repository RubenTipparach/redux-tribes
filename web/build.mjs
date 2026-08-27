// Bundle the client. esbuild only: no framework, no plugin chain, because the
// simulation lives in wasm and the renderer is three.js talking to it.
import { build, context } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });
copyFileSync('public/sim_core.wasm', 'dist/sim_core.wasm');
copyFileSync('index.html', 'dist/index.html');

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
