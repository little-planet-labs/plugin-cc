// `pnpm posters`: the poster list lives in the project (src/posters.js
// exports POSTERS next to SCENES / DEFAULT_SCENE), not in the script. The
// committed list is valid (on the template's one placeholder and on a
// finished project alike); bad lists are refused naming the entry; an empty
// list or a missing src/posters.js stops before any browser starts and writes
// nothing; a run with a new list leaves posters/ holding exactly that list and
// the two sheets (stale poster-<n>-<slug>.png files are removed, nothing else
// is touched); the script takes no arguments. The capture itself is
// tests/render/posters-capture.test.mjs.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {CliError} from '../scripts/lib/cli.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {loadProject} from '../scripts/lib/project.mjs';
import {loadPosters, main as postersMain, parsePosters, parsePostersArgs, POSTER_SCENES, posterFile, sheetGrid, stalePosters} from '../scripts/posters.mjs';
import {validateRegistry, validateScenesPath} from '../src/lib/registry.js';
import {fakeBin, freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

describe('the committed poster registry', () => {
  it('src/posters.js is a valid registry with a valid POSTERS list, every frame inside the video', async () => {
    assert.equal(validateScenesPath(POSTER_SCENES), 'src/posters.js');
    const mod = await import(new URL('../src/posters.js', import.meta.url).href);
    assert.doesNotThrow(() => validateRegistry(mod, POSTER_SCENES));
    const list = await loadPosters(PROJECT_ROOT);
    assert.ok(list.length > 0);
    const {project} = loadProject(PROJECT_ROOT);
    for (const p of list) assert.ok(p.frame < project.frames, `${posterFile(p)} at frame ${p.frame}`);
  });
});

describe('the poster list', () => {
  const FRAMES = 1800;
  it('keeps the entries in order and names each file poster-<n>-<slug>.png', () => {
    const list = parsePosters([{n: 1, slug: 'title-card', frame: 30}, {n: 2, slug: 'b2', frame: 0, extra: 'ignored'}], {frames: FRAMES});
    assert.deepEqual(list, [{n: 1, slug: 'title-card', frame: 30}, {n: 2, slug: 'b2', frame: 0}]);
    assert.deepEqual(list.map(posterFile), ['poster-1-title-card.png', 'poster-2-b2.png']);
  });
  it('an empty list is refused with a message that says what to add', () => {
    assert.throws(() => parsePosters([], {frames: FRAMES}), (err) => err instanceof CliError && /^src\/posters\.js lists no posters \(POSTERS is empty\): add one \{n, slug, frame\} entry per poster/.test(err.message));
  });
  it('refuses a missing list, bad numbers, slugs and frames, a frame past the end, and repeats, naming the entry', () => {
    const one = (p) => () => parsePosters([p], {frames: FRAMES});
    assert.throws(() => parsePosters(undefined, {frames: FRAMES}), /src\/posters\.js must export POSTERS, a list of \{n, slug, frame\}/);
    assert.throws(one(null), /POSTERS\[0\] must be \{n, slug, frame\}/);
    for (const n of [0, -1, 1.5, '1', null]) assert.throws(one({n, slug: 'a', frame: 0}), /POSTERS\[0\]\.n must be a whole number >= 1/, String(n));
    for (const slug of ['A', 'a b', 'a--b', '-a', 'a-', '', 'a/b', '../x', 7]) assert.throws(one({n: 1, slug, frame: 0}), /POSTERS\[0\]\.slug must be lowercase/, String(slug));
    for (const frame of [-1, 1.5, '30', null]) assert.throws(one({n: 1, slug: 'a', frame}), /POSTERS\[0\]\.frame must be a whole page frame >= 0/, String(frame));
    assert.throws(one({n: 1, slug: 'a', frame: FRAMES}), /POSTERS\[0\]\.frame 1800 is past the end of the video \(frames 0\.\.1799\)/);
    assert.doesNotThrow(one({n: 1, slug: 'a', frame: FRAMES - 1}));
    const two = (b) => () => parsePosters([{n: 1, slug: 'a', frame: 30}, b], {frames: FRAMES});
    assert.throws(two({n: 1, slug: 'b', frame: 60}), /POSTERS\[1\]\.n 1 is used by another poster/);
    assert.throws(two({n: 2, slug: 'a', frame: 60}), /POSTERS\[1\]\.slug "a" is used by another poster/);
    assert.throws(two({n: 2, slug: 'b', frame: 30}), /POSTERS\[1\]\.frame 30 is used by another poster/);
  });
  it('the overview sheet is 2 across (1 for a single poster), with as many rows as needed', () => {
    assert.deepEqual([1, 2, 3, 6, 7].map(sheetGrid), [{columns: 1, rows: 1}, {columns: 2, rows: 1}, {columns: 2, rows: 2}, {columns: 2, rows: 3}, {columns: 2, rows: 4}]);
  });
  it('stalePosters names only poster-<n>-<slug>.png files the list no longer has: never the sheets or other files', () => {
    const names = ['poster-1-placeholder.png', 'poster-1-title-card.png', 'poster-2-old.png', 'posters-sheet.png', 'posters-small.png', 'notes.txt', 'poster-x.png', 'poster-3-a.jpg', 'poster-01-a.png'];
    assert.deepEqual(stalePosters(names, [{n: 1, slug: 'title-card'}]), ['poster-1-placeholder.png', 'poster-2-old.png']);
    assert.deepEqual(stalePosters(names, [{n: 1, slug: 'placeholder'}, {n: 1, slug: 'title-card'}, {n: 2, slug: 'old'}]), []);
    assert.deepEqual(stalePosters([], [{n: 1, slug: 'a'}]), []);
  });
  it('takes no arguments', () => {
    assert.deepEqual(parsePostersArgs([]), {});
    assert.throws(() => parsePostersArgs(['--out', 'x']), CliError);
  });
});

describe('pnpm posters replaces the whole set', () => {
  it('a run with list A, then list B: posters/ holds exactly B\'s files and the two sheets, and reports what it removed', async () => {
    const p = makeProject();
    projects.push(p);
    // capture.py: writes frame-<n>.png for each --frames entry into --out-dir. ffmpeg: writes its last argument.
    const python = fakeBin(
      'python',
      `const at = (f) => args[args.indexOf(f) + 1];
for (const n of at('--frames').split(',')) fs.writeFileSync(at('--out-dir') + '/frame-' + String(n).padStart(6, '0') + '.png', 'png');`,
    );
    const ffmpeg = fakeBin('ffmpeg', 'fs.writeFileSync(args[args.length - 1], "png");');
    const registry = (posters) => `export const POSTERS = ${JSON.stringify(posters)};\nexport const SCENES = {};\nexport const DEFAULT_SCENE = {draw() {}};\n`;
    const run = async (posters) => {
      writeFileSync(join(p.root, 'src/posters.js'), registry(posters));
      const r = await quiet(() => postersMain([], {root: p.root, envRoot: PROJECT_ROOT, pythonBin: python, ffmpegBin: ffmpeg}));
      assert.equal(r.result, 0, r.output.join('\n'));
      return r.output.join('\n');
    };
    const dir = join(p.root, 'posters');
    await run([{n: 1, slug: 'placeholder', frame: 30}, {n: 2, slug: 'second', frame: 60}]);
    assert.deepEqual(readdirSync(dir).sort(), ['poster-1-placeholder.png', 'poster-2-second.png', 'posters-sheet.png', 'posters-small.png']);
    writeFileSync(join(dir, 'notes.txt'), 'not a poster');
    const out = await run([{n: 1, slug: 'title-card', frame: 30}]);
    assert.deepEqual(readdirSync(dir).sort(), ['notes.txt', 'poster-1-title-card.png', 'posters-sheet.png', 'posters-small.png'], 'B\'s poster, the sheets, and the file that is not a poster');
    assert.match(out, /posters: removed \S*posters\/poster-1-placeholder\.png \(not in POSTERS\)/);
    assert.match(out, /posters: removed \S*posters\/poster-2-second\.png \(not in POSTERS\)/);
    assert.deepEqual(readdirSync(join(p.root, 'out')), [], 'no temp folder left');
  });
});

describe('pnpm posters stops before the browser', () => {
  const run = async (files, {pipeline = {}} = {}) => {
    const p = makeProject({pipeline, files});
    projects.push(p);
    const log = join(freshDir('posters-python'), 'calls.log');
    // A python that records any call: nothing may reach the capture.
    const python = fakeBin('python', `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n'); process.exit(0);`);
    const r = await quiet(() => postersMain([], {root: p.root, envRoot: PROJECT_ROOT, pythonBin: python, ffmpegBin: python}));
    return {...r, root: p.root, called: existsSync(log)};
  };
  const registry = (posters) => `export const POSTERS = ${JSON.stringify(posters)};\nexport const SCENES = {};\nexport const DEFAULT_SCENE = {draw() {}};\n`;

  it('an empty POSTERS exits 1 with the clear message and writes nothing', async () => {
    const r = await run({'src/posters.js': registry([])});
    assert.equal(r.result, 1);
    assert.match(r.output.join('\n'), /posters: src\/posters\.js lists no posters \(POSTERS is empty\): add one \{n, slug, frame\} entry per poster/);
    assert.equal(r.called, false, 'no capture, no ffmpeg');
    assert.equal(existsSync(join(r.root, 'posters')), false);
    assert.equal(existsSync(join(r.root, 'out')), false);
  });
  it('a missing src/posters.js, a registry without POSTERS, a frame past the end and a page that is not 16:9 are refused the same way', async () => {
    const cases = [
      [{}, {}, /src\/posters\.js doesn't exist: it holds the poster list/],
      [{'src/posters.js': 'export const SCENES = {};\nexport const DEFAULT_SCENE = null;\n'}, {}, /src\/posters\.js must export POSTERS/],
      // The fixture project has the 4 s no-track timing: 120 frames.
      [{'src/posters.js': registry([{n: 1, slug: 'late', frame: 120}])}, {}, /POSTERS\[0\]\.frame 120 is past the end of the video \(frames 0\.\.119\)/],
      [{'src/posters.js': registry([{n: 1, slug: 'a', frame: 0}])}, {width: 540, height: 960}, /posters are 16:9 \(1280x720\) but the src\/pipeline\.json page is 540x960/],
    ];
    for (const [files, pipeline, why] of cases) {
      const p = makeProject({pipeline, files});
      projects.push(p);
      // makeProject copies this project's src/, src/posters.js included: the first case removes it.
      if (!('src/posters.js' in files)) rmSync(join(p.root, 'src/posters.js'));
      const r = await quiet(() => postersMain([], {root: p.root, envRoot: PROJECT_ROOT, pythonBin: '/nonexistent/python', ffmpegBin: '/nonexistent/ffmpeg'}));
      assert.equal(r.result, 1, String(why));
      assert.match(r.output.join('\n'), why);
      assert.equal(existsSync(join(p.root, 'posters')), false);
    }
  });
});
