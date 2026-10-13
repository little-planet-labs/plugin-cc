// `pnpm preview` (ported from the 0.x template): the bitrate aims at ~26 MB,
// a result at or over 30 MB is refused, a duration that can't fit legibly is
// refused, the encode keeps the master's video format, and nothing but the
// finished preview is ever left behind.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {
  main as previewMain,
  parsePreviewArgs,
  PREVIEW_FILTER,
  PREVIEW_LIMIT_BYTES,
  PREVIEW_MAX_VIDEO_KBPS,
  PREVIEW_TARGET_BYTES,
  previewBitrates,
} from '../scripts/preview.mjs';
import {fakeBin, freshDir, silence} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

let p;
before(() => {
  p = makeProject({pipeline: {outputName: 'music-video'}});
});
after(() => p?.cleanup());

describe('preview', () => {
  it('previewBitrates aims at ~26 MB: (video + audio) * duration stays under the target and the 30 MB limit', () => {
    for (const seconds of [5, 30, 93, 131.16, 180, 262.64, 400]) {
      const {videoKbps, audioKbps} = previewBitrates(seconds);
      const bytes = ((videoKbps + audioKbps) * 1000 * seconds) / 8;
      assert.ok(bytes <= PREVIEW_TARGET_BYTES, `${seconds}s -> ${bytes} bytes`);
      assert.ok(bytes < PREVIEW_LIMIT_BYTES);
      assert.ok(videoKbps <= PREVIEW_MAX_VIDEO_KBPS);
    }
    // A 262 s song gets the budget, not the cap: within 5% of the target.
    const {videoKbps, audioKbps} = previewBitrates(262.64);
    assert.ok(((videoKbps + audioKbps) * 1000 * 262.64) / 8 > PREVIEW_TARGET_BYTES * 0.95);
  });
  it('previewBitrates refuses a duration it cannot fit legibly, and a bad duration', () => {
    assert.throws(() => previewBitrates(3600), /too low for a readable 720p preview/);
    assert.throws(() => previewBitrates(0), /duration is 0/);
    assert.throws(() => previewBitrates(Number.NaN), /duration is NaN/);
  });
  it('parsePreviewArgs defaults to the master and a -preview sibling; rejects unknown arguments', () => {
    assert.deepEqual(parsePreviewArgs([], {root: p.root}), {input: join(p.root, 'out/music-video.mp4'), output: join(p.root, 'out/music-video-preview.mp4')});
    assert.deepEqual(parsePreviewArgs(['--in=out/a.mp4', '--out', 'out/b.mp4'], {root: p.root}), {input: join(p.root, 'out/a.mp4'), output: join(p.root, 'out/b.mp4')});
    assert.equal(parsePreviewArgs(['--in=out/draft.mp4'], {root: p.root}).output, join(p.root, 'out/draft-preview.mp4'));
    assert.throws(() => parsePreviewArgs(['x'], {root: p.root}), /unexpected argument "x"/);
    assert.throws(() => parsePreviewArgs(['--out=a.mov'], {root: p.root}), /must end in \.mp4/);
  });

  // The input probe: JSON with one video stream and the format duration.
  const ffprobe = (seconds, exitCode = 0) =>
    fakeBin('ffprobe', `process.stdout.write(${JSON.stringify(JSON.stringify({streams: [{width: 3840, height: 2160, r_frame_rate: '30/1'}], format: {duration: seconds}}))}); process.exit(${exitCode});`);
  // Pass 1 writes its log next to the passlogfile; pass 2 writes the output (last arg). Both record their args.
  const ffmpegTwoPass = (pass2Exit, bytes = 10, argsFile = null) =>
    fakeBin(
      'ffmpeg',
      `${argsFile ? `fs.appendFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args) + '\\n');` : ''}
if (args[args.indexOf('-pass') + 1] === '1') { fs.writeFileSync(args[args.indexOf('-passlogfile') + 1] + '-0.log', 'log'); process.exit(0); }
fs.writeFileSync(args[args.length - 1], Buffer.alloc(${bytes})); process.exit(${pass2Exit});`,
    );
  const setup = () => {
    const dir = freshDir('preview');
    const input = join(dir, 'in.mp4');
    writeFileSync(input, 'mp4');
    return {dir, input, output: join(dir, 'in-preview.mp4'), tmpRoot: freshDir('tmp')};
  };
  const runPreview = (c, bins) => silence(() => previewMain(['--in', c.input, '--out', c.output], {root: p.root, tmpRoot: c.tmpRoot, ...bins}));

  it('success: only the preview is added; the pass log temp dir is removed; 720p H.264 High, TV-range BT.709 kept and tagged, AAC', async () => {
    const c = setup();
    const argsFile = join(freshDir('args'), 'ffmpeg.jsonl');
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0, 10, argsFile), ffprobeBin: ffprobe('120.5')}), 0);
    assert.deepEqual(readdirSync(c.dir).sort(), ['in-preview.mp4', 'in.mp4']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
    const pass2 = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))[1];
    const v = (f) => pass2[pass2.indexOf(f) + 1];
    assert.equal(v('-vf'), PREVIEW_FILTER);
    assert.match(PREVIEW_FILTER, /^scale=-2:720:in_range=tv:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p,setparams=/);
    assert.deepEqual([v('-profile:v'), v('-level:v'), v('-pix_fmt'), v('-color_range'), v('-colorspace'), v('-color_primaries'), v('-color_trc'), v('-c:a')],
      ['high', '3.1', 'yuv420p', 'tv', 'bt709', 'bt709', 'bt709', 'aac']);
    assert.equal(v('-b:v'), `${previewBitrates(120.5).videoKbps}k`);
  });
  it('pass 2 failing: exit 1, no partial, no output, temp dir removed', async () => {
    const c = setup();
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(1), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), ['in.mp4']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
  it('a result at or over 30 MB is refused and removed', async () => {
    const c = setup();
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0, PREVIEW_LIMIT_BYTES), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), ['in.mp4']);
  });
  it('a video too long to fit legibly is refused before anything is encoded', async () => {
    const c = setup();
    const argsFile = join(freshDir('args'), 'ffmpeg.jsonl');
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0, 10, argsFile), ffprobeBin: ffprobe('3600')}), 1);
    assert.equal(existsSync(argsFile), false, 'ffmpeg never ran');
    assert.deepEqual(readdirSync(c.dir), ['in.mp4']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
  it('a missing input is reported before anything is created', async () => {
    const c = setup();
    rmSync(c.input);
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), []);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
});
