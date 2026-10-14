// `pnpm posters` end to end on a fixture project whose src/posters.js lists
// three posters (an odd count) on a 960x540 page: each poster is captured at
// its own frame (the fixture scene paints the page a grey level of its frame),
// written as posters/poster-<n>-<slug>.png at 1280x720, with the overview sheet
// on a 2-across grid and the small-size sheet; nothing is left in out/. A
// second run with another list leaves posters/ holding exactly that list and
// the two sheets.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {main as postersMain} from '../../scripts/posters.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

const POSTERS = [
  {n: 1, slug: 'first', frame: 10},
  {n: 2, slug: 'second', frame: 40},
  {n: 3, slug: 'third', frame: 75},
];

/** Every section plays one scene that fills the page with grey level 2 x frame (frame 10: 20, 40: 80, 75: 150). */
const registry = (posters) => `export const POSTERS = ${JSON.stringify(posters)};
const grey = {
  setup(ctx) { ctx.state.c = ctx.canvas(); },
  draw(t, ctx) {
    const v = 2 * Math.round(t * ctx.fps);
    const c = ctx.state.c.get();
    c.fillStyle = \`rgb(\${v}, \${v}, \${v})\`;
    c.fillRect(0, 0, ctx.width, ctx.height);
  },
};
export const SCENES = {};
export const DEFAULT_SCENE = grey;
`;

const pngSize = (path) => {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const centre = (path) => {
  const [w, h] = pngSize(path);
  return [...execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `crop=1:1:${w / 2}:${h / 2}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
};

describe('pnpm posters', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({files: {'src/posters.js': registry(POSTERS)}});
  });
  after(() => proj?.cleanup());

  it('captures each poster at its own frame into posters/ at 1280x720, with both review sheets, and leaves no temp files', {timeout: 120_000}, async () => {
    const {result, output} = await quiet(() => postersMain([], {root: proj.root, envRoot: PROJECT_ROOT}));
    assert.equal(result, 0, output.join('\n'));
    const dir = join(proj.root, 'posters');
    assert.deepEqual(readdirSync(dir).sort(), ['poster-1-first.png', 'poster-2-second.png', 'poster-3-third.png', 'posters-sheet.png', 'posters-small.png']);
    for (const p of POSTERS) {
      const file = join(dir, `poster-${p.n}-${p.slug}.png`);
      assert.deepEqual(pngSize(file), [1280, 720], file);
      const v = 2 * p.frame;
      assert.deepEqual(centre(file), [v, v, v], `poster ${p.n} shows frame ${p.frame}`);
    }
    // 2 across x 2 down of 640x360 tiles with a 12 px gutter; small sheet: two 380 px columns of three 212 px cells.
    assert.deepEqual(pngSize(join(dir, 'posters-sheet.png')), [2 * 640 + 12, 2 * 360 + 12]);
    assert.deepEqual(pngSize(join(dir, 'posters-small.png')), [2 * 380, 3 * 212]);
    assert.deepEqual(existsSync(join(proj.root, 'out')) ? readdirSync(join(proj.root, 'out')) : [], [], 'the temp folder is gone');
  });

  it('a second run with another list replaces the set: posters/ holds exactly the new posters and the two sheets', {timeout: 120_000}, async () => {
    writeFileSync(join(proj.root, 'src/posters.js'), registry([{n: 1, slug: 'title-card', frame: 20}]));
    const {result, output} = await quiet(() => postersMain([], {root: proj.root, envRoot: PROJECT_ROOT}));
    assert.equal(result, 0, output.join('\n'));
    const dir = join(proj.root, 'posters');
    assert.deepEqual(readdirSync(dir).sort(), ['poster-1-title-card.png', 'posters-sheet.png', 'posters-small.png']);
    assert.deepEqual(centre(join(dir, 'poster-1-title-card.png')), [40, 40, 40], 'the new poster shows frame 20');
    assert.deepEqual(pngSize(join(dir, 'posters-sheet.png')), [640, 360], 'one poster: a 1 x 1 sheet');
  });
});
