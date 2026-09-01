// Every level is somewhere, and the lookup that says where cannot fall back
// quietly.
//
// `skyFor` and `backdropFor` both answer an unknown scenario with a default
// rather than throwing, which is right at runtime (a level with no entry
// should still be playable) and lethal at authoring time: a key spelled one
// way in the practice list and another in the table matches nothing, the
// default is served, and the level looks finished. `low_orbit` shipped like
// that against a scenario called `low-orbit`, so the one level whose entire
// premise is a heavy body below you had no body below it and wore the
// skirmish sky.
//
// Read off the SOURCE rather than by importing it: these modules pull in
// three, the tables are plain literals, and the question is how the keys are
// SPELLED. Bundling a renderer to answer that would be slower and no truer.
//
// Nothing here is a rule. A sky cannot change an outcome, so none of it is
// hashed. This is about the table agreeing with the menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(resolve(here, '..', 'src', f), 'utf8');

/** The keys of one top level object literal, quoted or bare. */
function keysOf(text, declaration) {
  const from = text.indexOf(declaration);
  assert.notEqual(from, -1, `could not find ${declaration}`);
  const open = text.indexOf('{', from);
  let depth = 0, end = open;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  const body = text.slice(open + 1, end);
  // Only the entries at depth one: a nested literal's own fields are not keys
  // of this table.
  const out = [];
  let d = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!d) {
      const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w$]*))\s*:/.exec(trimmed);
      if (m) out.push(m[1] ?? m[2] ?? m[3]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '[') d++;
      else if (ch === '}' || ch === ']') d--;
    }
  }
  return out;
}

// PRACTICE is an array of records rather than a table, so its keys come off a
// pattern instead of `keysOf`.
const practiceKeys = (() => {
  const text = src('app/lobby.ts');
  const from = text.indexOf('const PRACTICE');
  const body = text.slice(from, text.indexOf('];', from));
  return [...body.matchAll(/key:\s*'([^']+)'/g)].map(m => m[1]);
})();

const skies = keysOf(src('app/sky.ts'), 'export const SKIES');
const backdrops = keysOf(src('app/backdrop.ts'), 'export const BACKDROPS');

test('the practice list is what it looks like', () => {
  assert.ok(practiceKeys.length >= 5, `only found ${practiceKeys.length} practice levels`);
  assert.ok(practiceKeys.includes('low-orbit'), 'the level this test exists for is gone');
});

test('every practice level has a sky of its own', () => {
  for (const key of practiceKeys) {
    assert.ok(skies.includes(key),
      `no sky for the level '${key}', so it will quietly wear the default one`);
  }
});

test('every practice level has scenery of its own', () => {
  for (const key of practiceKeys) {
    assert.ok(backdrops.includes(key),
      `no backdrop for the level '${key}', so its sun and planets are somebody else's`);
  }
});

test('no table carries a key the menu never asks for', () => {
  for (const k of skies) {
    assert.ok(practiceKeys.includes(k), `sky '${k}' matches no level, so nothing will ever show it`);
  }
  for (const k of backdrops) {
    assert.ok(practiceKeys.includes(k),
      `backdrop '${k}' matches no level, so nothing will ever show it`);
  }
});
