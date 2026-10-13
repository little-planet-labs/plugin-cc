// The engine's pure modules (src/lib) load in the page and in Node: no node:
// imports, no require, no process, no DOM globals, relative .js imports only.
// The DOM engine and scene modules don't touch the DOM at import time (so
// `pnpm check` can import a scene registry in Node).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

const LIB = ['ease.js', 'springs.js', 'rng.js', 'color.js', 'camera.js', 'shake.js', 'swell.js', 'shatter.js', 'pulse.js', 'subframes.js', 'text-motion.js', 'exits.js', 'registry.js', 'transitions.js', 'project.js'];
const ENGINE = ['context.js', 'engine.js', 'fonts.js', 'fx.js', 'layers.js', 'logo.js', 'preview.js', 'text.js', 'theme.js'];

const code = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('browser-safe engine modules', () => {
  for (const file of LIB) {
    it(`src/lib/${file} has no node:, require(, process. or DOM globals and imports only relative .js files`, async () => {
      const src = code(`lib/${file}`);
      for (const [re, what] of [
        [/['"`]node:/, 'a node: import'],
        [/\brequire\s*\(/, 'require('],
        [/\bprocess\s*\./, 'process.'],
        [/\b(?:document|window|globalThis|navigator)\s*\./, 'a DOM global'],
      ]) {
        assert.doesNotMatch(src, re, `${file} contains ${what}`);
      }
      for (const m of src.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\/[\w-]+\.js$/, `${file} imports ${m[1]}`);
      await import(new URL(`../src/lib/${file}`, import.meta.url).href);
    });
  }
  for (const file of ENGINE) {
    it(`src/engine/${file} imports in Node without touching the DOM`, async () => {
      await import(new URL(`../src/engine/${file}`, import.meta.url).href);
    });
  }
  it('the scene registry and placeholder import in Node', async () => {
    const mod = await import(new URL('../src/scenes/index.js', import.meta.url).href);
    assert.equal(typeof mod.DEFAULT_SCENE.setup, 'function');
  });
});
