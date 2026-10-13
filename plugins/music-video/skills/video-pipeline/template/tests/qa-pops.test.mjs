// `pnpm pops` without real media: its arguments, the detection rules on
// hand-made difference series (a pop is numbered by the frame where the new
// picture appears; a cut within ±1 frame excuses a pop, never a flash), and
// --cuts=auto reading the render's manifest sidecar, with fake ffmpeg,
// ffprobe and pops.py. Real clips: tests/render/qa-pops-clips.test.mjs.
import assert from 'node:assert/strict';
import {readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {buildManifest, manifestPath} from '../scripts/lib/outputs.mjs';
import {CUT_TOLERANCE_FRAMES, findPops, main as popsMain, parsePopsArgs} from '../scripts/pops.mjs';
import {fakeBin, freshDir, projectRoot, quiet} from './fixtures/cli-fakes.mjs';

/** d and skip for 15 frames: frame 5 is new (d[4] spikes); frame 10 blinks (d[9] and d[10] big, skip[10] small). */
const SERIES = (() => {
  const d = [0.5, 0.5, 0.5, 0.5, 20, 0.5, 0.5, 0.5, 0.5, 30, 30, 0.5, 0.5, 0.5];
  const skip = d.map(() => 1).concat([1]);
  skip[0] = null;
  skip[skip.length - 1] = null;
  skip[10] = 0.4;
  return {d, skip};
})();

describe('pops arguments and detection rules', () => {
  it('parsePopsArgs: defaults (the master), --cuts frames or auto, --ratio, --fail, and bad values', () => {
    assert.deepEqual(parsePopsArgs([], {root: projectRoot}), {input: join(projectRoot, 'out/music-video.mp4'), cuts: [], ratio: 3, fail: false});
    assert.deepEqual(parsePopsArgs(['--in', 'a.mp4', '--cuts=10,250', '--ratio', '4.5', '--fail'], {root: '/r'}), {
      input: '/r/a.mp4',
      cuts: [10, 250],
      ratio: 4.5,
      fail: true,
    });
    assert.equal(parsePopsArgs(['--in=a.mp4', '--cuts', 'auto'], {root: '/r'}).cuts, 'auto');
    const r = {root: '/r'};
    assert.throws(() => parsePopsArgs(['--in=a.mp4', '--cuts=1.5'], r), /--cuts must be frame numbers/);
    assert.throws(() => parsePopsArgs(['--in=a.mp4', '--cuts=auto,3'], r), /--cuts must be frame numbers/);
    assert.throws(() => parsePopsArgs(['--in=a.mp4', '--ratio=1'], r), /--ratio must be a number > 1/);
    assert.throws(() => parsePopsArgs(['--fail', '--fail'], r), /--fail given twice/);
    assert.throws(() => parsePopsArgs(['--fail=1'], r), /unexpected argument "--fail=1"/);
    assert.throws(() => parsePopsArgs(['x.mp4'], r), /unexpected argument "x\.mp4"/);
  });

  it('findPops: a pop is numbered by the frame where the new picture appears; cuts excuse pops within ±1 frame, never flashes', () => {
    const {d, skip} = SERIES;
    const plain = findPops(d, skip, {fps: 30});
    assert.deepEqual(plain.pops.map((p) => p.frame), [5]);
    assert.deepEqual(plain.flashes.map((f) => f.frame), [10]);
    assert.equal(CUT_TOLERANCE_FRAMES, 1);
    for (const cut of [4, 5, 6]) {
      const r = findPops(d, skip, {fps: 30, cuts: [cut]});
      assert.deepEqual(r.pops, [], `cut ${cut}`);
      assert.deepEqual(r.cuts.map((c) => [c.frame, c.cut]), [[5, cut]]);
    }
    const far = findPops(d, skip, {fps: 30, cuts: [7, 10]});
    assert.deepEqual(far.pops.map((p) => p.frame), [5], 'a cut 2 frames away does not excuse the pop');
    assert.deepEqual(far.flashes.map((f) => f.frame), [10], 'a cut does not excuse a flash');
    assert.deepEqual(far.missedCuts, [7, 10]);
  });

  it('findPops: the thresholds are d[i] > ratio * max(d[i-1], d[i+1], 0.3) and d[i] > 2', () => {
    const skip = (n) => Array.from({length: n + 1}, (_, i) => (i === 0 || i === n ? null : 100));
    // 2.0 is not > 2; 2.01 is, and beats 3 * 0.3 (the neighbour floor) with neighbours at 0.
    assert.deepEqual(findPops([0, 0, 2.0, 0, 0], skip(5), {fps: 30}).pops, []);
    assert.deepEqual(findPops([0, 0, 2.01, 0, 0], skip(5), {fps: 30}).pops.map((p) => p.frame), [3]);
    // Exactly ratio x the larger neighbour is not a pop; a bit more is.
    assert.deepEqual(findPops([1, 1, 6, 2, 1], skip(5), {fps: 30}).pops, []);
    assert.deepEqual(findPops([1, 1, 6.01, 2, 1], skip(5), {fps: 30}).pops.map((p) => p.frame), [3]);
    assert.deepEqual(findPops([1, 1, 6.01, 2, 1], skip(5), {fps: 30, ratio: 4}).pops, []);
    // The first and last pairs are never tested.
    assert.deepEqual(findPops([50, 0, 0, 0, 50], skip(5), {fps: 30}).pops, []);
  });
});

describe('pops --cuts=auto', () => {
  /** Fakes for a 90-frame 30 fps video whose differences are SERIES padded to 90 frames. */
  const setup = () => {
    const dir = freshDir('pops');
    const input = join(dir, 'draft.mp4');
    writeFileSync(input, 'mp4');
    const d = [...SERIES.d, ...Array(89 - SERIES.d.length).fill(0.5)];
    const skip = [...SERIES.skip.slice(0, -1), ...Array(90 - SERIES.skip.length).fill(1), null];
    return {
      input,
      tmpRoot: freshDir('tmp'),
      bins: {
        ffprobeBin: fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '30/1', nb_read_packets: '90'}]}));`),
        ffmpegBin: fakeBin('ffmpeg', `fs.writeFileSync(args[args.length - 1], Buffer.alloc(90 * 180 * 180));`),
        pythonBin: fakeBin('python', `process.stdout.write(${JSON.stringify(JSON.stringify({frames: 90, d, skip}))});`),
      },
    };
  };
  const sidecar = (input, cuts, extra = {}) =>
    writeFileSync(
      manifestPath(input),
      JSON.stringify({
        ...buildManifest({fps: 30, first: 0, last: 90, width: 64, height: 36, scale: 0.5, textonly: false, cuts: cuts.map((f) => f / 30), blurWindows: [], blur: false, source: 'src/scenes/index.js'}),
        ...extra,
      }),
    );
  const run = (c, argv) => quiet(() => popsMain(['--in', c.input, ...argv], {root: projectRoot, tmpRoot: c.tmpRoot, ...c.bins}));

  it('pops --cuts=auto takes the cuts from the manifest sidecar: a listed cut excuses the pop, never the flash', async () => {
    const c = setup();
    sidecar(c.input, [5]);
    const excused = await run(c, ['--cuts=auto', '--fail']);
    assert.equal(excused.result, 1, 'the flash at frame 10 still fails');
    const text = excused.output.join('\n');
    assert.match(text, /cuts from .*draft\.manifest\.json: 5/);
    assert.match(text, /cut 5: pop at frame 5/);
    assert.match(text, /pops \(frame = first frame of the new picture\): 0/);
    assert.match(text, /one-frame flashes: 1\n {2}frame 10 /);
    assert.match(text, /0 unexpected pop\(s\) and 1 flash\(es\) found \(--fail\)/);
    // A cut elsewhere doesn't excuse the pop.
    sidecar(c.input, [40]);
    const other = await run(c, ['--cuts=auto']);
    assert.equal(other.result, 0, 'without --fail findings are only listed');
    assert.match(other.output.join('\n'), /pops \(frame = first frame of the new picture\): 1\n {2}frame 5 /);
    assert.match(other.output.join('\n'), /no pop at listed cut\(s\): 40/);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('pops --cuts=auto without a sidecar fails naming it; a sidecar of another render is refused', async () => {
    const c = setup();
    const missing = await run(c, ['--cuts=auto']);
    assert.equal(missing.result, 1);
    assert.match(missing.output.join('\n'), /draft\.manifest\.json doesn't exist \(--cuts=auto reads the cuts from it\)/);
    sidecar(c.input, [5], {frames: 120});
    const stale = await run(c, ['--cuts=auto']);
    assert.equal(stale.result, 1);
    assert.match(stale.output.join('\n'), /describes 120 frames at 30 fps but .* has 90 at 30; it belongs to an earlier render/);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('pops --fail exits 1 only when a finding is not excused', async () => {
    const c = setup();
    // SERIES without the flash: only the pop at 5.
    const d = [0.5, 0.5, 0.5, 0.5, 20, ...Array(84).fill(0.5)];
    const skip = [null, ...Array(88).fill(1), null];
    c.bins.pythonBin = fakeBin('python', `process.stdout.write(${JSON.stringify(JSON.stringify({frames: 90, d, skip}))});`);
    assert.equal((await run(c, ['--fail'])).result, 1, 'an unlisted pop fails');
    assert.equal((await run(c, ['--fail', '--cuts=6'])).result, 0, 'a pop at a listed cut (±1) passes');
    sidecar(c.input, [4]);
    assert.equal((await run(c, ['--fail', '--cuts=auto'])).result, 0);
    sidecar(c.input, []);
    assert.equal((await run(c, ['--fail', '--cuts=auto'])).result, 1, 'a manifest with no cuts excuses nothing');
  });
});

describe('pops frame count', () => {
  it('pops fails when the decoded frames are not every frame ffprobe counted', async () => {
    const dir = freshDir('pops-count');
    const input = join(dir, 'v.mp4');
    writeFileSync(input, 'mp4');
    const d = Array(88).fill(0.5);
    const skip = [null, ...Array(87).fill(1), null];
    const bins = {
      ffprobeBin: fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '30/1', nb_read_packets: '90'}]}));`),
      ffmpegBin: fakeBin('ffmpeg', `fs.writeFileSync(args[args.length - 1], Buffer.alloc(89 * 180 * 180));`),
      pythonBin: fakeBin('python', `process.stdout.write(${JSON.stringify(JSON.stringify({frames: 89, d, skip}))});`),
    };
    const {result, output} = await quiet(() => popsMain(['--in', input], {root: projectRoot, tmpRoot: freshDir('tmp'), ...bins}));
    assert.equal(result, 1);
    assert.match(output.join('\n'), /ffmpeg decoded 89 frames from .*v\.mp4 but ffprobe counted 90; nothing was checked/);
  });
});
