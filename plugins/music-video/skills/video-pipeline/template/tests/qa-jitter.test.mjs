// `pnpm jitter` without real media: its arguments (single window and
// --all-lines), the --all-lines windows (the page's own hold schedule mapped
// onto the video's frames, clipped to a partial render), and the failures that
// must come before anything is decoded. Measurements on real clips:
// tests/render/qa-jitter-estimator.test.mjs and qa-real-render.test.mjs.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {allLinesWindows, jitter, jitterAllLines, main as jitterMain, parseJitterArgs} from '../scripts/jitter.mjs';
import {holdRange} from '../scripts/lib/qa.mjs';
import {fakeBin, freshDir, projectRoot, quiet} from './fixtures/cli-fakes.mjs';

describe('jitter arguments', () => {
  it('reads --from as a frame or seconds, --frames, --crop, --max, --threshold; --in defaults to the master', () => {
    assert.deepEqual(parseJitterArgs(['--from=120', '--frames', '30'], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      from: {frame: 120},
      frames: 30,
      crop: null,
      max: null,
      threshold: 225,
    });
    const all = parseJitterArgs(['--in', 'a.mp4', '--from', '40.5s', '--frames=10', '--crop=10,20,300,100', '--max', '0.25', '--threshold=200'], {root: '/r'});
    assert.deepEqual(all, {input: '/r/a.mp4', from: {seconds: 40.5}, frames: 10, crop: {x: 10, y: 20, w: 300, h: 100}, max: 0.25, threshold: 200});
  });

  it('rejects a missing --from or --frames, bad values, repeats and unknown args', () => {
    const r = {root: '/r'};
    assert.throws(() => parseJitterArgs(['--frames=10'], r), /--from is required/);
    assert.throws(() => parseJitterArgs(['--from=0'], r), /--frames is required/);
    assert.throws(() => parseJitterArgs(['--from=1.5', '--frames=10'], r), /--from must be a frame number/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=1'], r), /at least 2/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--crop=1,2,3'], r), /--crop must be x,y,w,h/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--max=-1'], r), /--max needs a value/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--max=abc'], r), /--max must be a number/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--threshold=256'], r), /--threshold must be an integer 0\.\.255/);
    assert.throws(() => parseJitterArgs(['--from=0', '--from=1', '--frames=10'], r), /--from given twice/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', 'x.mp4'], r), /unexpected argument "x\.mp4"/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--scenes=a.js'], r), /--scenes only applies with --all-lines/);
  });

  it('parseJitterArgs --all-lines: defaults to the text-only render, --scenes, and exclusive with --from/--frames', () => {
    assert.deepEqual(parseJitterArgs(['--all-lines'], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video-textonly.mp4'),
      allLines: true,
      crop: null,
      max: null,
      threshold: 225,
      scenes: null,
    });
    const all = parseJitterArgs(['--all-lines', '--in=t.mp4', '--crop=0,0,100,50', '--max=0.5', '--scenes', './tests/x.js'], {root: '/r'});
    assert.deepEqual([all.input, all.crop, all.max, all.scenes], ['/r/t.mp4', {x: 0, y: 0, w: 100, h: 50}, 0.5, 'tests/x.js']);
    const r = {root: '/r'};
    assert.throws(() => parseJitterArgs(['--all-lines', '--from=0'], r), /--from can't be used with --all-lines/);
    assert.throws(() => parseJitterArgs(['--frames=10', '--all-lines'], r), /--frames can't be used with --all-lines/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--all-lines'], r), /--all-lines given twice/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--scenes=../x.js'], r), /project-relative module path/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--settle=10'], r), /unexpected argument "--settle=10"/);
  });
});

describe('jitter --all-lines windows', () => {
  // At 30 fps: a-1 holds [1.3533, 2.2) -> frames 41..65; b-1 never settles before its exit; c-1 is the last line,
  // held to the end; d-1 settles exactly on frame 90 (3.0 s, written as 90 / 30 + 1e-12) until 3.1 s (frame 93, excluded).
  const LINES = [
    {id: 'a-1', settled: 1.3533333333333333, exitStart: 2.2},
    {id: 'b-1', settled: 4.12, exitStart: 3.72},
    {id: 'd-1', settled: 90 / 30 + 1e-12, exitStart: 3.1},
    {id: 'c-1', settled: 5, exitStart: null},
  ];

  it('allLinesWindows on a full render: exactly the frames n with settled <= n / fps < exitStart', () => {
    const w = allLinesWindows(LINES, {fps: 30, pageFrames: 180, frames: 180});
    assert.deepEqual(
      w.map((x) => [x.id, x.start, x.end, x.frames, x.skip, x.note]),
      [
        ['a-1', 41, 66, 25, null, null],
        ['b-1', null, null, 0, 'line-level window empty (settled at 4.120 s, exit starts at 3.720 s); words are held individually: use pnpm still-test', null],
        ['d-1', 90, 93, 3, null, null],
        ['c-1', 150, 180, 30, null, null],
      ],
    );
    // The same frames a brute-force scan of the definition finds.
    for (const x of w.filter((y) => y.skip === null)) {
      const line = LINES.find((l) => l.id === x.id);
      const brute = Array.from({length: 180}, (_, n) => n).filter((n) => n / 30 >= line.settled - 1e-6 && (line.exitStart === null || n / 30 < line.exitStart - 1e-6));
      assert.deepEqual([x.start, x.end - 1], [brute[0], brute.at(-1)], x.id);
    }
  });

  it('allLinesWindows on a partial render: shifted by firstFrame, clipped to it, lines outside it skipped', () => {
    // The video shows page frames 50..99.
    const w = allLinesWindows(LINES, {fps: 30, pageFrames: 180, first: 50, frames: 50});
    assert.deepEqual(
      w.map((x) => [x.id, x.start, x.end, x.skip, x.note]),
      [
        ['a-1', 0, 16, null, 'hold frames 41-65 clipped to the rendered frames 50-99'],
        ['b-1', null, null, 'line-level window empty (settled at 4.120 s, exit starts at 3.720 s); words are held individually: use pnpm still-test', null],
        ['d-1', 40, 43, null, null],
        ['c-1', null, null, 'hold frames 150-179 are outside the rendered frames 50-99', null],
      ],
    );
    const one = allLinesWindows([{id: 'e-1', settled: 1, exitStart: 2}], {fps: 30, pageFrames: 180, first: 59, frames: 50});
    assert.equal(one[0].skip, 'only 1 held frame inside the rendered frames 59-108 (hold frames 30-59)');
    assert.equal(allLinesWindows([{id: 'f-1', settled: 1, exitStart: 1.03}], {fps: 30, pageFrames: 180, frames: 180})[0].skip, 'hold window 30-30 is shorter than 2 frames');
    assert.equal(allLinesWindows([{id: 'f-3', settled: 1.01, exitStart: 1.02}], {fps: 30, pageFrames: 180, frames: 180})[0].skip, 'hold window 1.010 s to 1.020 s holds no frame');
    assert.equal(allLinesWindows([{id: 'f-2', settled: 1, exitStart: 1.04}], {fps: 30, pageFrames: 180, frames: 180})[0].frames, 2, 'exactly 2 frames is measured');
  });

  it('holdRange: ceil(settled * fps) .. ceil(exitStart * fps) - 1, robust to float error on a frame boundary', () => {
    assert.deepEqual(holdRange(34 / 30, 2, 30, 300), {first: 34, last: 59, count: 26});
    // Times a hair off a boundary land on it either way.
    assert.deepEqual(holdRange(34 / 30 + 1e-12, 2 - 1e-12, 30, 300), {first: 34, last: 59, count: 26});
    assert.deepEqual(holdRange(34 / 30 - 1e-12, 2 + 1e-12, 30, 300), {first: 34, last: 59, count: 26});
    // Between frames: the first frame at or after settled, the last before exitStart.
    assert.deepEqual(holdRange(1.01, 1.99, 30, 300), {first: 31, last: 59, count: 29});
    assert.deepEqual(holdRange(5, null, 30, 160), {first: 150, last: 159, count: 10});
    // The tolerance is the engine's own (T_EPS, 1e-7 s): a time 2e-7 s past a frame boundary is past it.
    assert.deepEqual(holdRange(34 / 30 + 2e-7, 2, 30, 300).first, 35);
    assert.deepEqual(holdRange(34 / 30 + 5e-8, 2, 30, 300).first, 34);
    assert.deepEqual(holdRange(2, 1, 30, 300).count, 0);
  });
});

describe('jitter failures before decoding', () => {
  it('a missing venv fails with the setup command before anything is decoded', async () => {
    const dir = freshDir('jitter-novenv');
    const input = join(dir, 'in.mp4');
    writeFileSync(input, 'mp4');
    const tmpRoot = freshDir('tmp');
    await assert.rejects(
      jitter({input, from: {frame: 0}, frames: 2, crop: null, max: null, pythonBin: join(dir, '.venv/bin/python'), tmpRoot, ffmpegBin: join(dir, 'no-ffmpeg')}, new Set()),
      /Python venv missing.*pnpm setup:env/,
    );
    assert.deepEqual(readdirSync(tmpRoot), []);
  });

  it('jitter --all-lines without a text-only render names the command to make one', async () => {
    const {result, output} = await quiet(() => jitterMain(['--all-lines', '--in', join(freshDir('none'), 'missing.mp4')], {root: projectRoot, tmpRoot: freshDir('tmp')}));
    assert.equal(result, 1);
    assert.match(output.join('\n'), /Render the text-only video first: pnpm render --textonly/);
  });

  it('jitter --all-lines refuses a video at another fps than the page, or longer than it, before decoding', async () => {
    const dir = freshDir('jitter-fps');
    const input = join(dir, 't.mp4');
    writeFileSync(input, 'mp4');
    const ffprobeBin = fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '25/1', nb_read_packets: '90'}]}));`);
    const ffmpegBin = fakeBin('ffmpeg', `fs.writeFileSync(${JSON.stringify(join(dir, 'ran'))}, '1'); process.exit(1);`);
    const pythonBin = fakeBin('python', 'process.exit(1);');
    const schedule = {info: {fps: 30, frames: 300}, lines: [{id: 'a-1', settled: 1, exitStart: 2}]};
    const go = (s) => jitterAllLines({input, crop: null, max: null, root: projectRoot, tmpRoot: freshDir('tmp'), ffprobeBin, ffmpegBin, pythonBin, schedule: s}, new Set());
    await assert.rejects(go(schedule), /is at 25 fps but the page runs at 30/);
    const ffprobe30 = fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '30/1', nb_read_packets: '400'}]}));`);
    await assert.rejects(
      jitterAllLines({input, crop: null, max: null, root: projectRoot, tmpRoot: freshDir('tmp'), ffprobeBin: ffprobe30, ffmpegBin, pythonBin, schedule}, new Set()),
      /shows page frames 0-399 but the page has 300/,
    );
    assert.equal(readdirSync(dir).includes('ran'), false, 'ffmpeg ran');
  });
});

describe('jitter --all-lines never passes having measured nothing', () => {
  const setup = (frames, manifest) => {
    const dir = freshDir('jitter-none');
    const input = join(dir, 't.mp4');
    writeFileSync(input, 'mp4');
    if (manifest) writeFileSync(join(dir, 't.manifest.json'), JSON.stringify({fps: 30, frames, width: 64, height: 36, scale: 1, textonly: true, cuts: [], blurWindows: [], source: 'src/scenes/index.js', ...manifest}));
    return {
      dir,
      input,
      ffprobeBin: fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '30/1', nb_read_packets: '${frames}'}]}));`),
      ffmpegBin: fakeBin('ffmpeg', `fs.writeFileSync(${JSON.stringify(join(dir, 'ran'))}, '1'); process.exit(1);`),
      pythonBin: fakeBin('python', 'process.exit(1);'),
    };
  };
  const go = (c, lines, extra = {}) =>
    quiet(() => jitterMain(['--all-lines', '--in', c.input, ...(extra.argv ?? [])], {root: projectRoot, tmpRoot: freshDir('tmp'), ...c, schedule: {info: {fps: 30, frames: 300}, lines}}));

  it('jitter --all-lines exits 1 when every line is skipped or outside the rendered frames', async () => {
    // Page frames 0..59 rendered; one line held at frames 150..179, one with no line-wide hold, one too short.
    const c = setup(60, {firstFrame: 0});
    const lines = [
      {id: 'a-1', settled: 5, exitStart: 6},
      {id: 'b-1', settled: 4.12, exitStart: 3.72},
      {id: 'c-1', settled: 1, exitStart: 1.03},
    ];
    for (const argv of [[], ['--max=10']]) {
      const {result, output} = await go(c, lines, {argv});
      const text = output.join('\n');
      assert.equal(result, 1, `${argv}: ${text}`);
      assert.match(text, /1 line\(s\) held outside the rendered frames 0-59: not measured/);
      assert.match(text, /skipped b-1: line-level window empty .*use pnpm still-test/);
      assert.match(text, /lines with motion during hold: 0 \(of 0 measured, 2 skipped, 1 outside the rendered frames;/);
      assert.match(text, /no line was measured: every line was skipped or held outside the rendered frames/);
    }
    assert.equal(existsSync(join(c.dir, 'ran')), false, 'ffmpeg ran');
  });

  it('jitter --all-lines refuses a video shorter than the page without a manifest: a partial render that lost its sidecar', async () => {
    const c = setup(90, null);
    const {result, output} = await go(c, [{id: 'a-1', settled: 1, exitStart: 2}]);
    assert.equal(result, 1);
    assert.match(output.join('\n'), /t\.mp4 has 90 frames but the page has 300, and no manifest sidecar \(.*t\.manifest\.json\) says which page frames it shows: it is probably a partial render whose sidecar is gone/);
    assert.equal(existsSync(join(c.dir, 'ran')), false, 'ffmpeg ran');
  });
});
