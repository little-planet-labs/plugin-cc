// `pnpm render [--composition=<id>] [--out <path>] [--remotion-flag=value …]`
//
// --composition renders another composition registered in src/Root.tsx (a
// concept round, an alternate cut) through the same codec path; without
// --out it goes to out/<id>.mp4, never onto the main video.
// Text-heavy masters: --image-format=png passes through to Remotion (frames
// are captured as PNG instead of JPEG, so high-contrast type has no ringing;
// about 50% slower and a larger file).
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
import {capture, CliError, run, runCli} from './lib/cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Flags this wrapper owns; passing them through would break the audio/CFR handling. */
const RESERVED_FLAGS = ['--codec', '--audio-codec', '--separate-audio-to', '--sequence', '--output'];

/**
 * Remotion flags that change the intermediate's frame rate (Remotion 4.0.527:
 * --fps via override-fps.js; --every-nth-frame divides it, render-media.js
 * `composition.fps / everyNthFrame`). The remux writes the video track at
 * pipeline.json's fps, so either would desync picture and sound. --width,
 * --height, --scale and --duration change only size or length, which nothing
 * downstream assumes (preview scales to 720p, contact-sheet and jitter probe
 * the file), so they stay allowed.
 */
const FRAME_RATE_FLAGS = ['--fps', '--every-nth-frame'];

/** src/pipeline.json, shared with the composition and the other scripts. */
export const readPipeline = (root = projectRoot) => JSON.parse(readFileSync(join(root, 'src/pipeline.json'), 'utf8'));

/** The render's default output, relative to the project: out/<pipeline.outputName>.mp4. */
export const defaultOutput = (root = projectRoot) => `out/${readPipeline(root).outputName}.mp4`;

/** Remotion's own rule for composition ids (remotion/dist/cjs/validation/validate-composition-id.js). */
const COMPOSITION_ID = /^[a-zA-Z0-9\u4E00-\u9FFF-]+$/;

/**
 * Take `--composition <id>` / `--composition=<id>` out of argv. Shared by
 * `pnpm render` and `pnpm still`. Returns the id (null when absent) and the
 * remaining args, in order. A missing, empty or flag-like value, an id
 * Remotion would reject, and a repeated flag are CliErrors.
 */
export const takeComposition = (argv) => {
  let composition = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== '--composition' && !arg.startsWith('--composition=')) {
      rest.push(arg);
      continue;
    }
    const value = arg === '--composition' ? argv[++i] : arg.slice('--composition='.length);
    if (value === undefined || value === '' || value.startsWith('-')) {
      throw new CliError('--composition needs a composition id, e.g. --composition=ConceptA');
    }
    if (composition !== null) throw new CliError(`--composition given twice ("${composition}" and "${value}"); pass it once`);
    if (!COMPOSITION_ID.test(value)) {
      throw new CliError(`--composition "${value}" isn't a valid composition id (a-z, A-Z, 0-9, CJK characters and -)`);
    }
    composition = value;
  }
  return {composition, rest};
};

/**
 * Split argv into the composition, the output path and the flags forwarded to
 * `remotion render`. Throws a CliError for anything this wrapper can't safely
 * forward. `composition` is null (pipeline.json's compositionId) unless
 * --composition is given; a composition other than the main one defaults to
 * out/<id>.mp4 so it never overwrites the main video.
 */
export const parseRenderArgs = (argv, {root = projectRoot} = {}) => {
  const {composition, rest} = takeComposition(argv);
  let out = null;
  const passthrough = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--out') {
      const value = rest[i + 1];
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
        `unexpected argument "${arg}". The entry is fixed; use --composition=<id> for another composition, ` +
          '--out <path> for the output and --flag=value form for Remotion flags (e.g. --frames=0-89).',
      );
    }
    const name = arg.split('=')[0];
    if (FRAME_RATE_FLAGS.includes(name)) {
      throw new CliError(`${name} can't be used: pnpm render writes the video at src/pipeline.json's fps, so another frame rate would desync the audio.`);
    }
    if (RESERVED_FLAGS.includes(name)) {
      throw new CliError(`${name} can't be overridden: pnpm render fixes the codecs to avoid audio lag and keep exact 30fps.`);
    }
    passthrough.push(arg);
  }
  if (out === null && composition !== null && composition !== readPipeline(root).compositionId) {
    out = `out/${composition}.mp4`;
    // Case-insensitive: on default macOS volumes (APFS, case-insensitive)
    // out/Music-Video.mp4 is the same file as out/music-video.mp4.
    if (resolve(root, out).toLowerCase() === resolve(root, defaultOutput(root)).toLowerCase()) {
      throw new CliError(`out/${composition}.mp4 is the main video's output; pass --out <path> for composition ${composition}`);
    }
  }
  out ??= defaultOutput(root);
  if (!out.endsWith('.mp4')) throw new CliError(`--out must end in .mp4 (got ${out})`);
  return {composition, output: resolve(root, out), passthrough};
};

/** The first video stream's r_frame_rate as a number (e.g. "30/1" -> 30), from ffprobe. */
export const probeFrameRate = async (ffprobeBin, file) => {
  const out = await capture(ffprobeBin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', file], {
    label: 'ffprobe',
  });
  const [num, den = '1'] = out.trim().split('/');
  const rate = Number(num) / Number(den);
  if (!Number.isFinite(rate) || rate <= 0) throw new CliError(`ffprobe gave no frame rate for ${file} (got ${JSON.stringify(out.trim())})`);
  return rate;
};

/**
 * Render `output` (an .mp4). The intermediate MKV and the partial MP4 are
 * registered in `cleanup` before anything can create them, so they're removed
 * on every exit path.
 *
 * The remux writes the video track at pipeline.json's fps. An intermediate
 * at any other frame rate would come out silently out of sync with its audio,
 * so it's probed first and a mismatch stops the render before the remux.
 */
export const render = async (
  {
    composition,
    output,
    passthrough,
    root = projectRoot,
    remotionBin = join(root, 'node_modules/.bin/remotion'),
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
  },
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
    ['render', 'src/index.ts', composition ?? compositionId, intermediate, '--codec=h264', '--audio-codec=pcm-16', ...passthrough],
    {cwd: root, label: 'remotion render'},
  );
  if (!existsSync(intermediate)) throw new CliError(`remotion did not write ${intermediate}`);
  // Every render: Config.overrideFps() or a composition with its own fps
  // changes the rate without any flag this wrapper could refuse.
  const rate = await probeFrameRate(ffprobeBin, intermediate);
  if (rate !== fps) {
    throw new CliError(
      `composition ${composition ?? compositionId} renders at ${rate} fps; pnpm render needs src/pipeline.json fps (${fps}) ` +
        '(check --composition, and Config.overrideFps / Config.setEveryNthFrame in remotion.config.ts)',
    );
  }

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
