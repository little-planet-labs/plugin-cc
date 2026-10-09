// `pnpm render [--out <path>] [--remotion-flag=value …]`
//
// Why not plain `remotion render … out.mp4`: Remotion 4.0.527 encodes AAC with
// libfdk_aac to a raw ADTS file (renderer/dist/compress-audio.js: `-c:a
// libfdk_aac -f adts`) and then stream-copies it into the MP4
// (stitch-frames-to-video.js: `-c:a copy`). ADTS can't carry the encoder's
// 2048-sample priming delay, so the MP4 gets no edit list and every sound
// plays ~42.7 ms (2048 samples @ 48 kHz) late: a constant audio/visual lag.
//
// Instead, Remotion renders lossless PCM into an intermediate MKV, and ffmpeg's
// native AAC encoder writes the final MP4 itself. Encoding straight into MP4
// records the priming in an edit list, so audio starts at t=0 sample-exactly.
//
// MKV stores timestamps in milliseconds (33/34 ms per frame at 30fps). Writing
// the MP4 video track with a timescale equal to the fps rounds every timestamp
// back to an exact frame number, so the output is constant-frame-rate.
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Flags this wrapper owns; passing them through would break the audio/CFR handling. */
const RESERVED_FLAGS = ['--codec', '--audio-codec', '--separate-audio-to', '--sequence', '--output'];

/** src/pipeline.json, shared with the composition and the other scripts. */
export const readPipeline = (root = projectRoot) => JSON.parse(readFileSync(join(root, 'src/pipeline.json'), 'utf8'));

/** The render's default output, relative to the project: out/<pipeline.outputName>.mp4. */
export const defaultOutput = (root = projectRoot) => `out/${readPipeline(root).outputName}.mp4`;

/**
 * Split argv into the output path and the flags forwarded to `remotion render`.
 * Throws a CliError for anything this wrapper can't safely forward.
 */
export const parseRenderArgs = (argv, {root = projectRoot} = {}) => {
  let out = null;
  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) throw new CliError('--out needs a path, e.g. --out out/test.mp4');
      out = value;
      i++;
      continue;
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
      if (out === '') throw new CliError('--out needs a path, e.g. --out=out/test.mp4');
      continue;
    }
    if (!arg.startsWith('-')) {
      throw new CliError(
        `unexpected argument "${arg}". The entry, composition and output are fixed; ` +
          'use --out <path> for the output and --flag=value form for Remotion flags (e.g. --frames=0-89).',
      );
    }
    const name = arg.split('=')[0];
    if (RESERVED_FLAGS.includes(name)) {
      throw new CliError(`${name} can't be overridden: pnpm render fixes the codecs to avoid audio lag and keep exact 30fps.`);
    }
    passthrough.push(arg);
  }
  out ??= defaultOutput(root);
  if (!out.endsWith('.mp4')) throw new CliError(`--out must end in .mp4 (got ${out})`);
  return {output: resolve(root, out), passthrough};
};

/**
 * Render `output` (an .mp4). The intermediate MKV and the partial MP4 are
 * registered in `cleanup` before anything can create them, so they're removed
 * on every exit path.
 */
export const render = async (
  {output, passthrough, root = projectRoot, remotionBin = join(root, 'node_modules/.bin/remotion'), ffmpegBin = 'ffmpeg'},
  cleanup,
) => {
  const {fps, compositionId} = readPipeline(root);
  if (!Number.isInteger(fps)) throw new CliError(`src/pipeline.json fps must be an integer for exact CFR output (got ${fps})`);

  mkdirSync(dirname(output), {recursive: true});
  const intermediate = join(dirname(output), `.intermediate-${process.pid}.mkv`);
  // ffmpeg writes here and it's renamed into place only on success, so a failed
  // render never leaves a truncated file at `output`.
  const partial = join(dirname(output), `.partial-${process.pid}.mp4`);
  cleanup.add(() => rmSync(intermediate, {force: true}));
  cleanup.add(() => rmSync(partial, {force: true}));

  await run(
    remotionBin,
    ['render', 'src/index.ts', compositionId, intermediate, '--codec=h264', '--audio-codec=pcm-16', ...passthrough],
    {cwd: root, label: 'remotion render'},
  );
  if (!existsSync(intermediate)) throw new CliError(`remotion did not write ${intermediate}`);

  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      '-i', intermediate,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy',
      '-video_track_timescale', String(fps),
      '-c:a', 'aac', '-b:a', '320k',
      '-movflags', '+faststart',
      partial,
    ],
    {label: 'ffmpeg'},
  );
  renameSync(partial, output);
  console.log(`render: wrote ${output}`);
};

export const main = (argv, overrides = {}) =>
  runCli('render', async (cleanup) => {
    const args = parseRenderArgs(argv, overrides);
    await render({...args, ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
