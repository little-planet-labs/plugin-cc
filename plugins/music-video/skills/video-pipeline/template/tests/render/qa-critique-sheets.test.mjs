// `pnpm critique` on real clips (ffmpeg + the .venv's numpy): every tile of
// every sheet shows exactly the frame its plan says (each synthetic frame
// draws its own index as 8 stripes, read back from the PNG) and carries that
// frame's label (every stamped glyph decoded with critique.py's own font);
// strips start at round((t - 0.1) * fps), clamp at 0 and are cut short at the
// end; overview and phone tiles keep their cadence and width; a rerun drops
// stale sheets. A real engine render is checked in qa-real-render.test.mjs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {formatLabel, main as critiqueMain, OVERVIEW, PHONE, STRIP} from '../../scripts/critique.mjs';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {manifestPath} from '../../scripts/lib/outputs.mjs';
import {freshDir, quiet} from '../fixtures/cli-fakes.mjs';
import {makeProject} from '../fixtures/engine-project.mjs';
import {clip, decodePng, listFiles, measureEnvMissing} from '../fixtures/qa-clips.mjs';

const missing = measureEnvMissing();
const python = venvPython(PROJECT_ROOT);
const projects = [];
after(() => projects.forEach((p) => p.cleanup()));
const project = (o = {}) => {
  const p = makeProject(o);
  projects.push(p);
  return p.root;
};

describe('critique sheets', {skip: missing ?? false}, () => {
  // 161x91 (odd both ways, so yuv444p): the lower half shows the frame index
  // as 8 vertical stripes, bit b white when set; the upper half is mid-gray.
  const BARS = 'if(gt(Y,H/2),255*bitand(N,pow(2,floor(X*8/W)))/pow(2,floor(X*8/W)),128)';
  const W = 161;
  const H = 91;
  let source = '';
  let font;
  before(() => {
    source = clip(freshDir('clip'), 'bars', `${W}x${H}`, 8, BARS, 'yuv444p');
    const res = spawnSync(python, [join(PROJECT_ROOT, 'scripts/critique.py'), '--font']);
    assert.equal(res.status, 0, String(res.stderr));
    font = JSON.parse(String(res.stdout));
  });

  const tileHeightFor = (tw, w = W, h = H) => Math.round((h * tw) / w);
  const origin = (k, cols, tw, th) => ({x: font.gap + (k % cols) * (tw + font.gap), y: font.gap + Math.floor(k / cols) * (th + font.gap)});
  /** The frame index a tile shows, from its 8 stripes. */
  const readIndex = (img, o, tw, th) => {
    let index = 0;
    for (let b = 0; b < 8; b++) {
      const [r] = img.px(o.x + Math.floor(((b + 0.5) * tw) / 8), o.y + Math.floor(0.8 * th));
      if (r > 128) index += 2 ** b;
    }
    return index;
  };
  /** Decode `length` stamped characters at a tile's top-left corner by matching every glyph pixel. */
  const readLabel = (img, o, length) => {
    let text = '';
    for (let i = 0; i < length; i++) {
      const rows = [];
      for (let r = 0; r < font.glyphHeight; r++) {
        let row = '';
        for (let c = 0; c < font.glyphWidth; c++) {
          const x = o.x + font.pad + i * font.advance * font.scale + c * font.scale + Math.floor(font.scale / 2);
          const y = o.y + font.pad + r * font.scale + Math.floor(font.scale / 2);
          row += img.px(x, y)[0] > 128 ? '#' : '.';
        }
        rows.push(row);
      }
      const match = Object.entries(font.font).find(([, glyph]) => glyph.every((g, r) => g === rows[r]));
      text += match ? match[0] : '?';
    }
    return text;
  };
  /**
   * Check every tile of a sheet: its stripes show `frames[k]` (mod 256) and its label decodes to the label of
   * `labels[k]` (default the same frame).
   */
  const checkSheet = (file, frames, layout, {src = {w: W, h: H}, labels = frames} = {}) => {
    const img = decodePng(file);
    const tw = layout.width;
    const th = tileHeightFor(tw, src.w, src.h);
    const cols = Math.min(layout.cols, frames.length);
    const rows = Math.ceil(frames.length / cols);
    assert.equal(img.width, font.gap + cols * (tw + font.gap), `${file}: width for ${cols} tiles of ${tw} px`);
    assert.equal(img.height, font.gap + rows * (th + font.gap), `${file}: height for ${rows} rows of ${th} px`);
    frames.forEach((frame, k) => {
      const o = origin(k, cols, tw, th);
      assert.equal(readIndex(img, o, tw, th), frame % 256, `${file} tile ${k}: frame`);
      const label = formatLabel(labels[k], 30);
      assert.equal(readLabel(img, o, label.length), label, `${file} tile ${k}: label`);
    });
    for (let k = frames.length; k < cols * rows; k++) {
      const o = origin(k, cols, tw, th);
      assert.deepEqual(img.px(o.x + Math.floor(tw / 2), o.y + Math.floor(th / 2)), [24, 24, 24], `${file} slot ${k} is empty`);
    }
    return img;
  };
  const runCritique = async (argv, root = project()) => {
    const tmpRoot = freshDir('tmp');
    const {result, output} = await quiet(() => critiqueMain(argv, {root, tmpRoot, pythonBin: python}));
    assert.deepEqual(readdirSync(tmpRoot), [], 'temp dir left behind');
    return {code: result, output: output.join('\n'), root, dir: (tag) => join(root, 'out/critique', tag)};
  };
  const range = (a, n) => Array.from({length: n}, (_, k) => a + k);

  it('critique strip frames are exactly round((t - 0.1) * fps) .. +11, read back from each frame', async () => {
    const r = await runCritique(['--in', source, '--tag', 's', '--strips=3,4.567']);
    assert.equal(r.code, 0, r.output);
    // 3 s -> round(2.9 * 30) = 87; 4.567 s -> round(4.467 * 30) = 134.
    checkSheet(join(r.dir('s'), 'strip_0003.00.png'), range(87, 12), STRIP);
    checkSheet(join(r.dir('s'), 'strip_0004.57.png'), range(134, 12), STRIP);
  });

  it('critique overview and phone tiles cover the whole duration at their cadence', async () => {
    const root = project();
    // Defaults on 8 s (240 frames): ceil(8 / 2) = 4 overview tiles, ceil(8 / 4) = 2 phone tiles.
    const d = await runCritique(['--in', source, '--tag', 'd', '--strips=1'], root);
    assert.equal(d.code, 0, d.output);
    assert.deepEqual(listFiles(d.dir('d')), ['overview_01.png', 'phone_01.png', 'strip_0001.00.png']);
    checkSheet(join(d.dir('d'), 'overview_01.png'), [0, 60, 120, 180], OVERVIEW);
    checkSheet(join(d.dir('d'), 'phone_01.png'), [0, 120], PHONE);
    // Short cadences spill over sheets: 40 overview tiles (30 + 10), 20 phone tiles (15 + 5).
    const s = await runCritique(['--in', source, '--tag', 'c', '--strips=1', '--overview-every=0.2', '--phone-every=0.4'], root);
    assert.equal(s.code, 0, s.output);
    const every = (step) => Array.from({length: Math.ceil(240 / step)}, (_, k) => k * step);
    const overview = every(6);
    const phone = every(12);
    assert.equal(overview.length, 40);
    assert.equal(phone.length, 20);
    checkSheet(join(s.dir('c'), 'overview_01.png'), overview.slice(0, 30), OVERVIEW);
    checkSheet(join(s.dir('c'), 'overview_02.png'), overview.slice(30), OVERVIEW);
    checkSheet(join(s.dir('c'), 'phone_01.png'), phone.slice(0, 15), PHONE);
    checkSheet(join(s.dir('c'), 'phone_02.png'), phone.slice(15), PHONE);
    assert.deepEqual(listFiles(s.dir('c')), ['overview_01.png', 'overview_02.png', 'phone_01.png', 'phone_02.png', 'strip_0001.00.png']);
  });

  it('critique phone tiles are 360 px wide, overview 270 px and strip 320 px, with the source aspect', async () => {
    const r = await runCritique(['--in', source, '--tag', 'w', '--strips=2']);
    assert.equal(r.code, 0, r.output);
    assert.deepEqual([OVERVIEW.width, PHONE.width, STRIP.width], [270, 360, 320]);
    for (const [file, tw] of [['overview_01.png', 270], ['phone_01.png', 360], ['strip_0002.00.png', 320]]) {
      const img = decodePng(join(r.dir('w'), file));
      const th = tileHeightFor(tw);
      // The tile's last column is picture; the next one is the gap.
      assert.notDeepEqual(img.px(font.gap + tw - 1, font.gap + th - 2), [24, 24, 24], `${file}: column ${tw - 1} is inside the tile`);
      assert.deepEqual(img.px(font.gap + tw, font.gap + th - 2), [24, 24, 24], `${file}: column ${tw} is the gap`);
      assert.deepEqual(img.px(font.gap + 1, font.gap + th), [24, 24, 24], `${file}: row ${th} is the gap`);
    }
  });

  it("critique labels decode to each tile's own time and frame", async () => {
    const r = await runCritique(['--in', source, '--tag', 'l', '--strips=0.5,6', '--overview-every=0.5']);
    assert.equal(r.code, 0, r.output);
    checkSheet(join(r.dir('l'), 'overview_01.png'), Array.from({length: 16}, (_, k) => k * 15), OVERVIEW);
    checkSheet(join(r.dir('l'), 'strip_0000.50.png'), range(12, 12), STRIP);
    checkSheet(join(r.dir('l'), 'strip_0006.00.png'), range(177, 12), STRIP);
  });

  it('critique strips near the end are cut short and past the end skipped, with a message; t < 0.1 s starts at frame 0', async () => {
    const r = await runCritique(['--in', source, '--tag', 'e', '--strips=0.05,7.9,9']);
    assert.equal(r.code, 0, r.output);
    checkSheet(join(r.dir('e'), 'strip_0000.05.png'), range(0, 12), STRIP);
    checkSheet(join(r.dir('e'), 'strip_0007.90.png'), [234, 235, 236, 237, 238, 239], STRIP);
    assert.equal(existsSync(join(r.dir('e'), 'strip_0009.00.png')), false);
    assert.match(r.output, /strip_0007\.90\.png {2}frames 234-239 {2}\(only 6 frames before the end\)/);
    assert.match(r.output, /skipped strip at 9 s: starts at frame 267, after the last frame \(239\)/);
  });

  it('critique on a partial render: tiles show video frames, labels the page frames the manifest maps them to', async () => {
    const dir = freshDir('partial');
    const partial = clip(dir, 'partial', `${W}x${H}`, 3, BARS, 'yuv444p');
    // The 90 frames show page frames 300..389.
    writeFileSync(manifestPath(partial), JSON.stringify({fps: 30, frames: 90, width: W, height: H, scale: 1, textonly: false, cuts: [], blurWindows: [], source: 'src/scenes/index.js', firstFrame: 300}));
    const r = await runCritique(['--in', partial, '--tag', 'p', '--strips=10.5,5']);
    assert.equal(r.code, 0, r.output);
    // 10.5 s -> page frame 312 = video frame 12.
    checkSheet(join(r.dir('p'), 'strip_0010.50.png'), range(12, 12), STRIP, {labels: range(312, 12)});
    checkSheet(join(r.dir('p'), 'overview_01.png'), [0, 60], OVERVIEW, {labels: [300, 360]});
    assert.match(r.output, /skipped strip at 5 s: starts at frame 147, before the first rendered frame \(300\)/);
  });

  it('critique handles an odd-sized source', async () => {
    const odd = clip(freshDir('clip'), 'odd', '97x55', 2, BARS, 'yuv444p');
    const r = await runCritique(['--in', odd, '--tag', 'o', '--strips=1']);
    assert.equal(r.code, 0, r.output);
    const src = {w: 97, h: 55};
    // 55 * 270 / 97 = 153.1 -> 153; 55 * 360 / 97 = 204.1 -> 204; 55 * 320 / 97 = 181.4 -> 181 (odd heights).
    checkSheet(join(r.dir('o'), 'overview_01.png'), [0], OVERVIEW, {src});
    checkSheet(join(r.dir('o'), 'phone_01.png'), [0], PHONE, {src});
    checkSheet(join(r.dir('o'), 'strip_0001.00.png'), range(27, 12), STRIP, {src});
  });

  it('critique writes only under out/critique/<tag>/, strips default to line and section starts, and a rerun drops stale sheets', async () => {
    // fallbackSeconds 8: the timing in effect must reach the 4.5 s line (the no-track fallback drops lines past its end).
    const root = project({
      pipeline: {fallbackSeconds: 8},
      lyrics: [
        {id: 'v-1', text: 'one two', start: 1, end: 2},
        {id: 'v-2', text: 'three', start: 4.5, end: 5},
      ],
      sections: [
        {id: 'intro', scene: 'intro', start: 0},
        {id: 'verse-1', scene: 'verse', start: 1},
      ],
    });
    const before = listFiles(root);
    const r = await runCritique(['--in', source, '--tag', 'r1'], root);
    assert.equal(r.code, 0, r.output);
    const added = listFiles(root).filter((f) => !before.includes(f));
    assert.deepEqual(added, [
      'out/critique/r1/overview_01.png',
      'out/critique/r1/phone_01.png',
      'out/critique/r1/strip_0000.00.png',
      'out/critique/r1/strip_0001.00.png',
      'out/critique/r1/strip_0004.50.png',
    ]);
    checkSheet(join(r.dir('r1'), 'strip_0004.50.png'), range(132, 12), STRIP);
    writeFileSync(join(root, 'out/critique/r1/notes.txt'), 'mine');
    const again = await runCritique(['--in', source, '--tag', 'r1', '--strips=2'], root);
    assert.equal(again.code, 0, again.output);
    assert.deepEqual(listFiles(join(root, 'out/critique/r1')), ['notes.txt', 'overview_01.png', 'phone_01.png', 'strip_0002.00.png']);
  });
});
