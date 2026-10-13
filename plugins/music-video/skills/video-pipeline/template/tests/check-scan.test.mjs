// `pnpm check`'s determinism scan: the template's page source is clean (and
// src/engine, src/lib and src/scenes contain no Date, performance.now,
// Math.random, timers or rAF outside src/engine/preview.js); the scanner
// catches each banned pattern (so it is not a scanner that can't match); and
// `pnpm check` passes on the template and fails, with file:line, on a project
// seeded with each banned pattern.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {check, scanCss, scanHtml, scanJs, scanProject} from '../scripts/check.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';

const JS_HITS = [
  ['const now = Date.now();', /Date/],
  ['const d = new Date();', /Date/],
  ['const t = performance.now();', /performance\.now/],
  ['const r = Math.random();', /Math\.random/],
  ['const {random} = Math;', /random destructured from Math/],
  ['const {floor, random: rand} = Math;', /random destructured from Math/],
  ['crypto.getRandomValues(buf);', /crypto\.getRandomValues/],
  ['const id = crypto.randomUUID();', /crypto\.randomUUID/],
  ["el.style.backgroundBlendMode = 'multiply';", /backgroundBlendMode/],
  ["el.style.cssText = 'background-blend-mode: screen';", /background-blend-mode/],
  ['setTimeout(() => {}, 10);', /setTimeout/],
  ['setInterval(tick, 10);', /setInterval/],
  ['requestIdleCallback(work);', /requestIdleCallback/],
  ['requestAnimationFrame(draw);', /requestAnimationFrame/],
  ['el.animate([{opacity: 0}], 300);', /animate\(\)/],
  ["el.style.transition = 'opacity 1s';", /transition\/animation set from script/],
  ["el.style.animation = 'spin 1s';", /transition\/animation set from script/],
  ["el.style.transitionDuration = '1s';", /transition\/animation/],
  ["el.style.cssText = 'opacity:0;transition: opacity 1s';", /CSS transition/],
  ['el.innerHTML = `<div style="animation: spin 1s"></div>`;', /CSS animation/],
  ["const css = '@keyframes spin { to { transform: rotate(1turn) } }';", /@keyframes/],
  ["el.style.mixBlendMode = 'screen';", /mixBlendMode/],
  ["el.style.cssText = 'mix-blend-mode: overlay';", /mix-blend-mode/],
  ["el.style.cssText = 'mix-blend-mode: plus-lighter';", /plus-lighter/],
  ["el.style.setProperty('transition', 'all 1s');", /a CSS transition\/animation property/],
  ["c.globalCompositeOperation = 'lighter';", /globalCompositeOperation "lighter"/],
  ["c.globalCompositeOperation = 'screen';", /globalCompositeOperation "screen"/],
  ['c.globalCompositeOperation = mode;', /non-literal/],
];

const JS_CLEAN = [
  "c.globalCompositeOperation = 'source-over';",
  "c.globalCompositeOperation = 'destination-out';",
  '// Date.now() and Math.random() are banned: this is a comment',
  '/* setTimeout(fn) in a block comment */ const x = 1;',
  "ctx.transition({kind: 'wipe', dur: 0.4});",
  "const spec = {transition: 'fade', updateDate: 1};",
  "const msg = 'the transition starts at 2s';",
  'const re = /Date|Math.random/;',
  'const elapsed = t - start; const update = 1;',
];

describe('determinism scanner', () => {
  for (const [src, what] of JS_HITS) {
    it(`catches: ${src}`, () => {
      const hits = scanJs(src);
      assert.ok(hits.some((h) => what.test(h.what)), `no hit matching ${what} in ${JSON.stringify(hits)}`);
      assert.equal(hits[0].line, 1);
    });
  }
  for (const src of JS_CLEAN) {
    it(`allows: ${src}`, () => assert.deepEqual(scanJs(src), []));
  }

  it('allows requestAnimationFrame only where told (the preview clock module)', () => {
    assert.equal(scanJs('requestAnimationFrame(tick);', {allowRaf: true}).length, 0);
    assert.equal(scanJs('requestAnimationFrame(tick);').length, 1);
  });

  it('reports the right line in multi-line sources, through template literals', () => {
    const src = 'const a = `x ${1 + 2} y`;\n\nconst b = 2;\nMath.random();\n';
    assert.deepEqual(scanJs(src).map((h) => h.line), [4]);
  });

  it('catches CSS transitions, animations, @keyframes and blend modes in stylesheets', () => {
    const css = '.a { color: red; }\n.b { transition: opacity 1s; }\n.c { animation-name: spin; }\n@keyframes spin {}\n.d { mix-blend-mode: screen; }\n.e { background-blend-mode: multiply; }\n';
    assert.deepEqual(scanCss(css).map((h) => h.line).sort(), [2, 3, 4, 5, 6]);
    assert.deepEqual(scanCss('/* transition: none */ .a { color: red }'), []);
  });

  it('scans HTML: inline scripts, <style>, style="" and on* handlers', () => {
    const html = '<style>\n.a{transition:all 1s}\n</style>\n<div style="animation: x 1s"></div>\n<script>\nMath.random();\n</script>\n<img onload="setTimeout(f)">\n';
    const hits = scanHtml(html);
    assert.deepEqual(hits.map((h) => h.line).sort((a, b) => a - b), [2, 4, 6, 8]);
  });

  it('the template page source (src/ and index.html) is clean', () => {
    const {files, found} = scanProject(PROJECT_ROOT);
    assert.ok(files > 20, `scanned ${files} files`);
    assert.deepEqual(found, []);
  });
});

describe('pnpm check', () => {
  it('passes on the template', async () => {
    const r = await check({root: PROJECT_ROOT});
    assert.deepEqual(r.issues, []);
    const cli = spawnSync(process.execPath, [join(PROJECT_ROOT, 'scripts/check.mjs')], {encoding: 'utf8'});
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /check: ok/);
  });

  it('fails on a project seeded with each banned pattern, printing file:line for each', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv-check-'));
    try {
      for (const p of ['src', 'scripts', 'index.html']) cpSync(join(PROJECT_ROOT, p), join(root, p), {recursive: true});
      writeFileSync(join(root, 'src/scenes/bad.js'), JS_HITS.map(([src]) => src).join('\n') + '\n');
      writeFileSync(join(root, 'src/scenes/bad.css'), '.x { transition: opacity 1s; }\n');
      const cli = spawnSync(process.execPath, [join(root, 'scripts/check.mjs')], {encoding: 'utf8'});
      assert.equal(cli.status, 1);
      JS_HITS.forEach((_, i) => assert.match(cli.stderr, new RegExp(`src/scenes/bad\\.js:${i + 1}: `), `line ${i + 1} reported`));
      assert.match(cli.stderr, /src\/scenes\/bad\.css:1: CSS transition/);
      assert.match(cli.stderr, /check: \d+ problems found/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('fails when a sections.json scene key has no scene and DEFAULT_SCENE is null', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mv-check-'));
    try {
      for (const p of ['src', 'scripts', 'index.html']) cpSync(join(PROJECT_ROOT, p), join(root, p), {recursive: true});
      writeFileSync(join(root, 'src/data/sections.json'), JSON.stringify([{id: 'intro', scene: 'intro', start: 0}]));
      writeFileSync(join(root, 'src/scenes/index.js'), 'export const SCENES = {};\nexport const DEFAULT_SCENE = null;\n');
      const r = await check({root});
      assert.ok(r.issues.some((i) => /scenes: unknown scene key "intro" \(section "intro"\)/.test(i)), JSON.stringify(r.issues));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it('reports bad data with the parser message', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mv-check-'));
    try {
      for (const p of ['src', 'scripts', 'index.html']) cpSync(join(PROJECT_ROOT, p), join(root, p), {recursive: true});
      writeFileSync(join(root, 'src/data/sections.json'), JSON.stringify([{id: 'a', scene: 'x', start: 3}]));
      const r = await check({root});
      assert.ok(r.issues.some((i) => /^data: sections\.json: \[0\]\.start must be 0/.test(i)), JSON.stringify(r.issues));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
