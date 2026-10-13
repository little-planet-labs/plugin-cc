// The QA scripts on real engine renders (Chromium + ffmpeg): a `pnpm draft`
// of the time-code fixture (every frame draws its own time code) and a
// partial `pnpm render --textonly --frames=<a>-<b>`.
// - critique: every strip and overview tile of the draft decodes to the frame
//   its plan says (round((t - 0.1) * fps) + k for strips);
// - jitter: --from decodes exactly the requested frame of the draft, as a
//   frame or in seconds;
// - pops --cuts=auto: the cuts are the draft's manifest cuts;
// - jitter --all-lines: on the partial text-only render the windows are the
//   page's own hold frames (window.__mv.lines(), read independently through
//   U1's probe) shifted by the manifest's firstFrame and clipped to the
//   rendered frames, and the engine's held lines don't move.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {main as critiqueMain, STRIP} from '../../scripts/critique.mjs';
import {main as draftMain} from '../../scripts/draft.mjs';
import {decodeGray, jitter, jitterAllLines} from '../../scripts/jitter.mjs';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {manifestPath} from '../../scripts/lib/outputs.mjs';
import {pops} from '../../scripts/pops.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {freshDir, quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';
import {decodePng, readTimecode} from '../fixtures/qa-clips.mjs';

const missing = captureEnvMissing();
const python = venvPython(PROJECT_ROOT);
const TIMECODE_SCENES = 'tests/fixtures/scenes/timecode.js';

describe('QA scripts on a real draft of the time-code fixture', {skip: missing ?? false}, () => {
  let proj;
  let draft;
  before(async () => {
    proj = makeProject({
      pipeline: {fallbackSeconds: 4},
      sections: [
        {id: 's1', scene: 'timecode', start: 0},
        {id: 's2', scene: 'timecode-cut', start: 2},
      ],
      lyrics: [line('s1-1', 'words under the code', 0.4, 1.2), line('s2-1', 'more words here', 2.4, 3.0)],
    });
    draft = join(proj.root, 'out/draft-r1.mp4');
    const {result, output} = await quiet(() => draftMain([`--scenes=${TIMECODE_SCENES}`, '--out', draft, '--pool=2', '--chunk-seconds=1.5'], {root: proj.root, envRoot: PROJECT_ROOT}));
    assert.equal(result, 0, output.join('\n'));
  });
  after(() => proj?.cleanup());

  it('critique strips and overview tiles of a real draft show exactly their planned frames', {timeout: 120_000}, async () => {
    const {result, output} = await quiet(() => critiqueMain(['--in', draft, '--tag', 'r1', '--strips=0.05,1.234,2,3.95'], {root: proj.root, tmpRoot: freshDir('tmp'), pythonBin: python}));
    assert.equal(result, 0, output.join('\n'));
    const dir = join(proj.root, 'out/critique/r1');
    const gap = 4;
    const sheet = (file, frames, layout) => {
      const img = decodePng(join(dir, file));
      const tw = layout.width;
      const th = Math.round((270 * tw) / 480);
      const cols = Math.min(layout.cols, frames.length);
      const got = frames.map((_, k) => readTimecode(img.px, gap + (k % cols) * (tw + gap), gap + Math.floor(k / cols) * (th + gap), tw, th));
      assert.deepEqual(got, frames.map((f) => 4 * f), `${file}: time codes (4 x frame) of its tiles`);
    };
    const strip = (start, n = 12) => Array.from({length: n}, (_, k) => start + k);
    // 0.05 s clamps to frame 0; 1.234 s -> round(1.134 * 30) = 34; 2 s -> 57 (across the cut at 60); 3.95 s -> 116, cut short at 119.
    sheet('strip_0000.05.png', strip(0), STRIP);
    sheet('strip_0001.23.png', strip(34), STRIP);
    sheet('strip_0002.00.png', strip(57), STRIP);
    sheet('strip_0003.95.png', strip(116, 4), STRIP);
    sheet('overview_01.png', [0, 60], {width: 270, cols: 6});
  });

  it('jitter --from decodes exactly the requested frame of a real draft, as a frame or in seconds', {timeout: 120_000}, async () => {
    const W = 480;
    const H = 270;
    for (const start of [0, 1, 29, 44, 45, 59, 60, 61, 89, 90, 117]) {
      const out = join(freshDir('decode'), 'frames.gray');
      await quiet(() => decodeGray({input: draft, fps: 30, startTime: 0, startFrame: start, frames: 2, area: {x: 0, y: 0, w: W, h: H}, out}));
      const data = readFileSync(out);
      const codes = [0, 1].map((i) => readTimecode((x, y) => {
        const v = data[i * W * H + y * W + x];
        return [v, v, v];
      }, 0, 0, W, H));
      assert.deepEqual(codes, [4 * start, 4 * start + 4], `decode from frame ${start}`);
    }
    for (const from of [{frame: 61}, {seconds: 61 / 30}]) {
      const {result} = await quiet(() => jitter({input: draft, from, frames: 2, crop: null, max: null, root: proj.root, tmpRoot: freshDir('tmp'), pythonBin: python}, new Set()));
      assert.equal(result.startFrame, 61);
      assert.deepEqual([result.pairs[0].from, result.pairs[0].to], [61, 62]);
    }
  });

  it("pops --cuts=auto takes the draft manifest's cuts", {timeout: 120_000}, async () => {
    const manifest = JSON.parse(readFileSync(manifestPath(draft), 'utf8'));
    assert.deepEqual(manifest.cuts, [60], 'the hard cut at section s2');
    const cleanup = new Set();
    const {result, output} = await quiet(() => pops({input: draft, cuts: 'auto', root: proj.root, tmpRoot: freshDir('tmp'), pythonBin: python}, cleanup));
    for (const fn of cleanup) fn();
    assert.deepEqual(result.listedCuts, [60]);
    assert.equal(result.frames, 120);
    assert.match(output.join('\n'), /cuts from .*draft-r1\.manifest\.json: 60/);
  });
});

describe('jitter --all-lines on a real partial text-only render', {skip: missing ?? false}, () => {
  let proj;
  let video;
  let schedule;
  const FIRST = 15;
  const LAST = 104;
  before(async () => {
    proj = makeProject({
      pipeline: {fallbackSeconds: 6, render: {scale: 1}},
      sections: [{id: 's1', scene: 'timecode', start: 0}],
      lyrics: [
        // Held well inside the rendered frames 15..104.
        line('s1-1', 'Hold these quiet words', 0.3, 1.2),
        // Held from about frame 100: clipped to the end of the range.
        line('s1-2', 'Next line later', 2.2, 2.7),
        // Held after the range: skipped.
        line('s1-3', 'Last one', 4.0, 4.3),
      ],
    });
    video = join(proj.root, 'out/textonly-part.mp4');
    const {result, output} = await quiet(() =>
      renderMain([`--scenes=${TIMECODE_SCENES}`, '--textonly', `--frames=${FIRST}-${LAST}`, '--out', video, '--pool=2', '--chunk-seconds=1.5'], {root: proj.root, envRoot: PROJECT_ROOT}),
    );
    assert.equal(result, 0, output.join('\n'));
    schedule = (await probe('evalat', {root: proj.root, scenes: TIMECODE_SCENES, textonly: true, times: '0', js: '1'})).lines;
  });
  after(() => proj?.cleanup());

  it("jitter --all-lines windows equal the engine's hold schedule, mapped through the manifest's firstFrame and clipped to the render", {timeout: 180_000}, async () => {
    const manifest = JSON.parse(readFileSync(manifestPath(video), 'utf8'));
    assert.deepEqual([manifest.firstFrame, manifest.frames, manifest.textonly, manifest.source], [FIRST, LAST - FIRST + 1, true, TIMECODE_SCENES]);
    const {result, output} = await quiet(() => jitterAllLines({input: video, crop: null, max: null, root: proj.root, envRoot: PROJECT_ROOT, tmpRoot: freshDir('tmp')}, new Set()));
    const text = output.join('\n');
    assert.equal(result.scenes, TIMECODE_SCENES, 'the page was opened with the scenes the render used');
    // Expected, by scanning every page frame against the independently read schedule.
    const expected = schedule.map((l) => {
      const held = Array.from({length: 180}, (_, n) => n).filter((n) => n / 30 >= l.settled - 1e-9 && n / 30 < l.exitStart - 1e-9);
      const inside = held.filter((n) => n >= FIRST && n <= LAST).map((n) => n - FIRST);
      return {id: l.id, held, inside};
    });
    const [a, b, c] = expected;
    assert.ok(a.inside.length === a.held.length && a.held.length >= 10, `s1-1 held ${a.held[0]}-${a.held.at(-1)} inside the range`);
    assert.ok(b.inside.length >= 2 && b.inside.length < b.held.length, `s1-2 held ${b.held[0]}-${b.held.at(-1)} is clipped`);
    assert.equal(c.inside.length, 0, `s1-3 held ${c.held[0]}-${c.held.at(-1)} is outside`);
    const measured = Object.fromEntries(result.lines.map((l) => [l.id, l]));
    for (const e of [a, b]) {
      assert.deepEqual([measured[e.id].start, measured[e.id].end - 1], [e.inside[0], e.inside.at(-1)], `${e.id}: video frames`);
      assert.deepEqual(measured[e.id].page, {first: e.held[0], last: e.held.at(-1)}, `${e.id}: page frames`);
      assert.ok(measured[e.id].max < 0.01, `${e.id}: the engine's held line moved ${measured[e.id].max} px`);
    }
    assert.match(measured['s1-2'].note, /clipped to the rendered frames 15-104/);
    assert.deepEqual(result.skipped.map((s) => [s.id, s.outside]), [['s1-3', true]]);
    assert.match(result.skipped[0].reason, /hold frames \d+-\d+ are outside the rendered frames 15-104/);
    assert.match(text, /1 line\(s\) held outside the rendered frames 15-104: not measured/);
    assert.deepEqual(result.moving, []);
    assert.match(text, /lines with motion during hold: 0 \(of 2 measured, 0 skipped, 1 outside the rendered frames;/);
  });
});
