// `pnpm jitter` on real clips (ffmpeg + the .venv's numpy), no browser:
// the estimator reads no shift on a static clip and known sub-pixel shifts
// (1, 0.5 and 0.25 px) within the tested tolerance; --from picks that exact
// frame, given as a frame or in seconds, also on a clip encoded the way the
// render encodes (x264 with B-frames, chunked, concatenated and muxed by the
// render's own ffmpeg steps); --max gates; and --all-lines, given a schedule,
// measures each line's hold window, reports only the line that moves, and
// skips (and lists) windows that are too short or start blank; jitter.py's
// peak memory doesn't grow with the window's length.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {before, describe, it} from 'node:test';
import {spawnSync} from 'node:child_process';
import {decodeGray, jitter, jitterAllLines, main as jitterMain} from '../../scripts/jitter.mjs';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {freshDir, quiet, silence} from '../fixtures/cli-fakes.mjs';
import {clip, measureEnvMissing, readStripes, renderLikeClip} from '../fixtures/qa-clips.mjs';

const missing = measureEnvMissing();
const python = venvPython(PROJECT_ROOT);

describe('jitter measurements', {skip: missing ?? false}, () => {
  // 30-frame 320x180 clips: a frozen 120x80 testsrc card on black, drawn at
  // `scale`x and box-downscaled, so a 1 px offset at 2x is an exact half-pixel
  // shift (a quarter at 4x). Encoded losslessly (x264 qp 0) so only the motion
  // differs between frames.
  let clipsDir;
  const card = (name, x, scale = 2) => {
    const file = join(clipsDir, `${name}.mp4`);
    const res = spawnSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${320 * scale}x${180 * scale}:r=30:d=1,format=rgb24`,
      '-f', 'lavfi', '-i', `testsrc=s=${120 * scale}x${80 * scale}:r=30:d=1`,
      '-filter_complex',
      `[1]trim=end_frame=1,loop=loop=-1:size=1,setpts=N/30/TB[s];[0][s]overlay=x='${x}':y=${50 * scale}:shortest=1:eval=frame:format=rgb,scale=320:180:flags=area,format=yuv420p`,
      '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast',
      file,
    ]);
    assert.equal(res.status, 0, `ffmpeg failed to make ${name}: ${res.stderr}`);
    return file;
  };
  // The frame index, from the timestamp.
  const n = 'floor(t*30+0.5)';
  const clips = {static: '', quarter: '', half: '', one: '', step: ''};
  before(() => {
    clipsDir = freshDir('jitter-clips');
    clips.static = card('static', '200');
    clips.quarter = card('quarter', `400+${n}`, 4);
    clips.half = card('half', `200+${n}`);
    clips.one = card('one', `200+2*${n}`);
    // Still, except one 1 px jump between frames 10 and 11.
    clips.step = card('step', '200+2*gte(t,10.5/30)');
  });
  const measure = (input, from, frames, extra = {}) =>
    silence(() => jitter({input, from, frames, crop: extra.crop ?? null, max: extra.max ?? null, root: PROJECT_ROOT, tmpRoot: freshDir('tmp'), pythonBin: python}, new Set()));

  it('jitter reports no shift for a static clip', async () => {
    const {pairs} = await measure(clips.static, {frame: 0}, 10);
    assert.equal(pairs.length, 9);
    for (const p of pairs) {
      assert.ok(p.shift < 0.01, `pair ${p.from}->${p.to}: shift ${p.shift}`);
      assert.ok(p.diff < 0.01, `pair ${p.from}->${p.to}: diff ${p.diff}`);
    }
  });

  it('jitter detects a known sub-pixel shift (1, 0.5 and 0.25 px), also through odd crops', async () => {
    const one = await measure(clips.one, {frame: 0}, 10);
    for (const p of one.pairs) assert.ok(Math.abs(p.dx - 1) < 0.05 && Math.abs(p.dy) < 0.05, `1 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
    const cropped = await measure(clips.one, {frame: 0}, 10, {crop: {x: 80, y: 40, w: 200, h: 110}});
    for (const p of cropped.pairs) assert.ok(Math.abs(p.dx - 1) < 0.05, `cropped 1 px clip: dx ${p.dx}`);
    // Odd size and origin: the crop must not snap to the yuv420p chroma grid.
    const odd = await measure(clips.one, {frame: 0}, 10, {crop: {x: 81, y: 41, w: 201, h: 111}});
    assert.equal(odd.pairs.length, 9);
    for (const p of odd.pairs) assert.ok(Math.abs(p.dx - 1) < 0.05, `odd crop, 1 px clip: dx ${p.dx}`);
    const half = await measure(clips.half, {frame: 0}, 10);
    for (const p of half.pairs) assert.ok(Math.abs(p.dx - 0.5) < 0.1 && Math.abs(p.dy) < 0.1, `0.5 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
    const meanDx = half.pairs.reduce((a, p) => a + p.dx, 0) / half.pairs.length;
    assert.ok(Math.abs(meanDx - 0.5) < 0.05, `0.5 px clip: mean dx ${meanDx}`);
    // A parabolic peak fit reads these as ~0.12 px; the Dirichlet fit in jitter.py doesn't.
    const quarter = await measure(clips.quarter, {frame: 0}, 10);
    for (const p of quarter.pairs) assert.ok(Math.abs(p.dx - 0.25) < 0.1 && Math.abs(p.dy) < 0.1, `0.25 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
  });

  it('jitter --from selects that exact frame, given as a frame or in seconds', async () => {
    const shiftFrom = async (from) => {
      const {pairs, startFrame} = await measure(clips.step, from, 2);
      return {startFrame, shift: pairs[0].shift};
    };
    const at9 = await shiftFrom({frame: 9});
    const at10 = await shiftFrom({frame: 10});
    const at11 = await shiftFrom({frame: 11});
    assert.ok(at9.shift < 0.01, `9->10: ${at9.shift}`);
    assert.ok(Math.abs(at10.shift - 1) < 0.05, `10->11: ${at10.shift}`);
    assert.ok(at11.shift < 0.01, `11->12: ${at11.shift}`);
    const seconds = await shiftFrom({seconds: 10 / 30});
    assert.equal(seconds.startFrame, 10);
    assert.ok(Math.abs(seconds.shift - 1) < 0.05, `10/30 s: ${seconds.shift}`);
    await assert.rejects(measure(clips.step, {frame: 25}, 10), /only 5 of 10 frames from frame 25/);
  });

  it('jitter --max fails above threshold', async () => {
    const run = async (input, max) => {
      const tmpRoot = freshDir('tmp');
      const code = await silence(() => jitterMain(['--in', input, '--from=0', '--frames=5', `--max=${max}`], {root: PROJECT_ROOT, tmpRoot, pythonBin: python}));
      assert.deepEqual(readdirSync(tmpRoot), [], 'the decoded frames were left behind');
      return code;
    };
    assert.equal(await run(clips.one, '0.5'), 1);
    assert.equal(await run(clips.one, '1.5'), 0);
    assert.equal(await run(clips.static, '0.05'), 0);
  });
});

describe('jitter on a clip encoded the way the render encodes', {skip: missing ?? false}, () => {
  // 160x96, 120 frames in 3 chunks (seams at 40 and 80). Lower half: the frame index as stripes.
  // Upper right: a block that holds, except one 1 px step between frames 60 and 61.
  const W = 160;
  const H = 96;
  let input = '';
  before(() => {
    input = renderLikeClip(freshDir('render-like'), 'steps', {
      width: W,
      height: H,
      frames: 120,
      chunks: [40, 80],
      lum: (x, y, n) => {
        if (y >= 48) return (n >> Math.floor((x * 8) / W)) & 1 ? 255 : 0;
        const bx = 100 + (n >= 61 ? 1 : 0);
        return y >= 10 && y < 30 && x >= bx && x < bx + 20 ? 255 : 0;
      },
    });
  });
  /** Indices of the frames decodeGray returns from `startFrame`, read from the stripes. */
  const decodedIndices = async (startFrame, frames) => {
    const out = join(freshDir('decode'), 'frames.gray');
    await silence(() => decodeGray({input, fps: 30, startTime: 0, startFrame, frames, area: {x: 0, y: 0, w: W, h: H}, out}));
    const data = readFileSync(out);
    assert.equal(data.length, frames * W * H);
    return Array.from({length: frames}, (_, i) => readStripes(data.subarray(i * W * H, (i + 1) * W * H), W, 72));
  };

  it('jitter --from decodes exactly the requested frames, on both sides of the chunk seams', async () => {
    for (const start of [0, 1, 4, 38, 39, 40, 41, 61, 79, 80, 117]) {
      assert.deepEqual(await decodedIndices(start, 3), [start, start + 1, start + 2], `window from frame ${start}`);
    }
    const shift = async (from) => {
      const {result} = await quiet(() =>
        jitter({input, from, frames: 2, crop: {x: 80, y: 0, w: 80, h: 48}, max: null, root: PROJECT_ROOT, tmpRoot: freshDir('tmp'), pythonBin: python}, new Set()),
      );
      return result.pairs[0].shift;
    };
    // The step is between 60 and 61: only the pair 60 -> 61 moves.
    assert.ok(Math.abs((await shift({frame: 60})) - 1) < 0.1, '60 -> 61 holds the step');
    assert.ok((await shift({frame: 61})) < 0.05, '61 -> 62 must be still (a seek landing on 60 sees the step)');
    assert.ok((await shift({frame: 59})) < 0.05, '59 -> 60 must be still');
    assert.ok((await shift({seconds: 61 / 30})) < 0.05, 'seconds resolve to the same exact frame');
  });
});

describe('jitter --all-lines on a text-only clip (schedule given)', {skip: missing ?? false}, () => {
  // 320x180 black, 6 s (180 frames). Each line is a white block: a-1 frames 15-72 (still), b-1 frames
  // 75-132 (sliding 1 px per frame), c-1 frames 135-169 (still; its hold runs to the end, so its last frames are blank).
  let input = '';
  before(() => {
    input = clip(
      freshDir('text-only'),
      'text-only',
      '320x180',
      6,
      '255*(between(N,15,72)*between(X,40,79)*between(Y,40,59)+between(N,75,132)*between(X,N+45,N+84)*between(Y,80,99)+between(N,135,169)*between(X,200,239)*between(Y,120,139))',
    );
  });
  const schedule = (lines) => ({info: {fps: 30, frames: 180, width: 320, height: 180, duration: 6}, lines});
  const HOLDS = [
    {id: 'a-1', settled: 34 / 30, exitStart: 62 / 30},
    {id: 'b-1', settled: 92 / 30, exitStart: 122 / 30},
    {id: 'c-1', settled: 151 / 30, exitStart: null},
  ];
  const go = (lines, extra = {}) =>
    quiet(() => jitterAllLines({input, crop: null, max: null, root: PROJECT_ROOT, tmpRoot: freshDir('tmp'), pythonBin: python, schedule: schedule(lines), ...extra}, new Set()));

  it('jitter --all-lines reports only the line that moves during its hold', async () => {
    const {result, output} = await go(HOLDS);
    assert.deepEqual(
      result.lines.map((l) => [l.id, l.start, l.measuredEnd, l.note]),
      [
        ['a-1', 34, 62, null],
        ['b-1', 92, 122, null],
        ['c-1', 151, 170, 'blank from frame 170'],
      ],
    );
    const [a, b, c] = result.lines;
    assert.ok(a.max < 0.001 && c.max < 0.001, `still lines moved: ${a.max}, ${c.max}`);
    assert.ok(Math.abs(b.mean - 1) < 0.05 && Math.abs(b.max - 1) < 0.05, `b-1: mean ${b.mean} max ${b.max}`);
    assert.deepEqual(result.moving, ['b-1']);
    assert.deepEqual(result.skipped, []);
    assert.match(output.join('\n'), /lines with motion during hold: 1 /);
  });

  it('jitter --all-lines --max exits 1 naming the line, 0 under a looser bound', async () => {
    const code = async (max) => {
      const tmpRoot = freshDir('tmp');
      const r = await quiet(() => jitterMain(['--all-lines', '--in', input, `--max=${max}`], {root: PROJECT_ROOT, tmpRoot, pythonBin: python, schedule: schedule(HOLDS)}));
      assert.deepEqual(readdirSync(tmpRoot), []);
      return [r.result, r.output.join('\n')];
    };
    const [over, text] = await code('0.5');
    assert.equal(over, 1);
    assert.match(text, /1 line\(s\) moved more than --max 0\.5 px in one frame during the hold: b-1/);
    assert.equal((await code('1.5'))[0], 0);
  });

  it('jitter --all-lines skips and lists windows that are too short or start blank', async () => {
    const {result, output} = await go([
      {id: 'a-1', settled: 53 / 30, exitStart: 53 / 30},
      {id: 'b-1', settled: 111 / 30, exitStart: 113 / 30},
      {id: 'c-1', settled: 170 / 30, exitStart: null},
    ]);
    assert.deepEqual(result.lines.map((l) => [l.id, l.start, l.measuredEnd]), [['b-1', 111, 113]]);
    assert.deepEqual(result.skipped.map((s) => s.id), ['a-1', 'c-1']);
    const text = output.join('\n');
    assert.match(text, /skipped a-1: line-level window empty \(settled at 1\.767 s, exit starts at 1\.767 s\); words are held individually: use pnpm still-test/);
    assert.match(text, /skipped c-1: blank at the start of its hold \(frame 170\)/);
  });
});

describe('jitter.py memory', {skip: missing ?? false}, () => {
  /** Peak RSS in bytes of jitter.py measuring `frames` frames of w x h noise, and its frame count. */
  const peakRss = (frames, w, h) => {
    const dir = freshDir('jitter-mem');
    const raw = join(dir, 'frames.gray');
    // Deterministic noise (an LCG), shifted 1 px per frame so every pair has a real FFT peak.
    const base = Buffer.alloc(w * h);
    let x = 12345;
    for (let i = 0; i < base.length; i++) base[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    const data = Buffer.alloc(frames * w * h);
    for (let f = 0; f < frames; f++) for (let i = 0; i < w * h; i++) data[f * w * h + i] = base[(i + f) % (w * h)];
    writeFileSync(raw, data);
    const script = [
      'import resource, runpy, sys',
      `sys.argv = ['jitter.py', ${JSON.stringify(raw)}, '--width', '${w}', '--height', '${h}']`,
      'try:',
      `    runpy.run_path(${JSON.stringify(join(PROJECT_ROOT, 'scripts/jitter.py'))}, run_name='__main__')`,
      'except SystemExit as e:',
      '    assert not e.code, e.code',
      'rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss',
      "print('RSS', rss if sys.platform == 'darwin' else rss * 1024, file=sys.stderr)",
    ].join('\n');
    const res = spawnSync(python, ['-I', '-c', script], {encoding: 'utf8', maxBuffer: 1 << 26});
    assert.equal(res.status, 0, res.stderr);
    return {rss: Number(/RSS (\d+)/.exec(res.stderr)[1]), frames: JSON.parse(res.stdout).frames};
  };

  it('jitter.py keeps peak memory bounded by a frame pair', () => {
    const w = 960;
    const h = 540;
    const floatFrame = w * h * 8;
    const short = peakRss(6, w, h);
    const long = peakRss(24, w, h);
    assert.deepEqual([short.frames, long.frames], [6, 24]);
    // Loading the whole window as float64 would add 18 frames (about 75 MB) here.
    assert.ok(long.rss - short.rss < floatFrame, `peak RSS grew by ${((long.rss - short.rss) / 1e6).toFixed(1)} MB from 6 to 24 frames (one float frame is ${(floatFrame / 1e6).toFixed(1)} MB)`);
  });
});
