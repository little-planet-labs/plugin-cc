// scripts/analyze.mjs leaves no temp files behind on any exit path, never
// leaves a half-written analysis, and checks the venv before creating anything.
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {main as analyzeMain} from '../scripts/analyze.mjs';
import {fakeBin, freshDir, projectRoot, quiet, silence} from './fixtures/cli-fakes.mjs';

/** A minimal project root with a (fake) track on disk. */
const fakeRoot = () => {
  const root = freshDir('root');
  mkdirSync(join(root, 'src/data'), {recursive: true});
  mkdirSync(join(root, 'public/audio'), {recursive: true});
  cpSync(join(projectRoot, 'src/pipeline.json'), join(root, 'src/pipeline.json'));
  writeFileSync(join(root, 'src/data/audio-analysis.json'), 'ORIGINAL');
  writeFileSync(join(root, 'public/audio/track.wav'), '');
  return root;
};
const run = (root, tmpRoot, bins) => silence(() => analyzeMain([], {root, tmpRoot, ...bins}));
// ffmpeg's output path is its last argument.
const ffmpegWrites = (exitCode) => fakeBin('ffmpeg', `fs.writeFileSync(args[args.length - 1], 'wav'); process.exit(${exitCode});`);
// analyze_audio.py's --out value follows the '--out' flag.
const pythonWrites = (exitCode) =>
  fakeBin('python', `fs.writeFileSync(args[args.indexOf('--out') + 1], '{"ok":true}'); process.exit(${exitCode});`);

describe('analyze cleanup', () => {
  for (const [label, bins] of [
    ['ffmpeg fails', () => ({ffmpegBin: ffmpegWrites(1), pythonBin: pythonWrites(0)})],
    ['python fails after writing output', () => ({ffmpegBin: ffmpegWrites(0), pythonBin: pythonWrites(1)})],
  ]) {
    it(`${label}: exit 1, temp dir removed, existing analysis untouched`, async () => {
      const root = fakeRoot();
      const tmpRoot = freshDir('tmp');
      const code = await run(root, tmpRoot, bins());
      assert.equal(code, 1);
      assert.deepEqual(readdirSync(tmpRoot), []);
      assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), 'ORIGINAL');
      assert.deepEqual(readdirSync(join(root, 'src/data')), ['audio-analysis.json']);
    });
  }

  it('success: temp dir removed, analysis replaced', async () => {
    const root = fakeRoot();
    const tmpRoot = freshDir('tmp');
    // The temp dir exists while the children run (so the test sees it removed, not never made).
    const seen = join(root, 'seen-tmp');
    const python = fakeBin(
      'python',
      `fs.writeFileSync(${JSON.stringify(seen)}, String(fs.readdirSync(${JSON.stringify(tmpRoot)}).length));
fs.writeFileSync(args[args.indexOf('--out') + 1], '{"ok":true}');`,
    );
    const code = await run(root, tmpRoot, {ffmpegBin: ffmpegWrites(0), pythonBin: python});
    assert.equal(code, 0);
    assert.equal(readFileSync(seen, 'utf8'), '1');
    assert.deepEqual(readdirSync(tmpRoot), []);
    assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), '{"ok":true}');
    assert.deepEqual(readdirSync(join(root, 'src/data')), ['audio-analysis.json']);
  });

  it('missing venv is reported before any temp dir is created', async () => {
    const root = fakeRoot();
    const tmpRoot = freshDir('tmp');
    const ffmpegLog = join(root, 'ffmpeg-ran');
    const ffmpeg = fakeBin('ffmpeg', `fs.writeFileSync(${JSON.stringify(ffmpegLog)}, '');`);
    const {result, output} = await quiet(() => analyzeMain([], {root, tmpRoot, ffmpegBin: ffmpeg, pythonBin: join(root, 'nope/python')}));
    assert.equal(result, 1);
    assert.match(output.join('\n'), /Python venv missing\. Run `pnpm setup:env` first\./);
    assert.deepEqual(readdirSync(tmpRoot), []);
    assert.equal(existsSync(ffmpegLog), false, 'ffmpeg ran without a venv');
  });

  it('an invalid pipeline.json fails naming the field, before the temp dir or ffmpeg', async () => {
    const root = fakeRoot();
    const tmpRoot = freshDir('tmp');
    const pipeline = JSON.parse(readFileSync(join(root, 'src/pipeline.json'), 'utf8'));
    writeFileSync(join(root, 'src/pipeline.json'), JSON.stringify({...pipeline, fps: 24}));
    const ffmpegLog = join(root, 'ffmpeg-ran');
    const ffmpeg = fakeBin('ffmpeg', `fs.writeFileSync(${JSON.stringify(ffmpegLog)}, '');`);
    const {result, output} = await quiet(() => analyzeMain([], {root, tmpRoot, ffmpegBin: ffmpeg, pythonBin: pythonWrites(0)}));
    assert.equal(result, 1);
    assert.match(output.join('\n'), /^analyze: pipeline\.json: fps must be an integer dividing both 22050 and 48000 .*\(got 24\)$/m);
    assert.doesNotMatch(output.join('\n'), /\n\s+at /, 'printed a stack trace');
    assert.deepEqual(readdirSync(tmpRoot), []);
    assert.equal(existsSync(ffmpegLog), false, 'ffmpeg ran with an invalid pipeline.json');
    assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), 'ORIGINAL');
  });

  it('--reset restores the no-track default, byte for byte, without needing a venv or a track', async () => {
    const root = fakeRoot();
    const def = readFileSync(join(projectRoot, 'src/data/audio-analysis.default.json'), 'utf8');
    writeFileSync(join(root, 'src/data/audio-analysis.default.json'), def);
    const code = await silence(() => analyzeMain(['--reset'], {root, pythonBin: join(root, 'nope/python')}));
    assert.equal(code, 0);
    assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), def);
  });
});
