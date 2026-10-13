// `pnpm preview [--in <mp4>] [--out <mp4>]`
//
// A 720p H.264 + AAC copy of a render that stays under chat upload limits
// (30 MB). The video bitrate is computed from the duration so the file lands
// near PREVIEW_TARGET_BYTES, and it's encoded in two passes so the size
// actually holds. Same video format as the master (H.264 High at the level
// that fits 720p, yuv420p, BT.709 TV range kept and tagged). The audio is the
// input's AAC decoded and encoded again at 128 kbit/s; the decoder honours
// the input's edit list and the new MP4 gets its own, so the audio stays
// sample-aligned (tests/render/render-av-sync.test.mjs measures it).
// Defaults: in = out/<outputName>.mp4 (the master), out = the input's name
// with "-preview" (out/<outputName>-preview.mp4). The preview never
// overwrites the master.
import {existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parsePipeline} from '../src/lib/pipeline.js';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {BT709_FRAME_TAGS, x264Args} from './lib/encode.mjs';
import {masterOutput, refuseMaster, samePath} from './lib/outputs.mjs';
import {readJson} from './lib/project.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Hard limit: the chat upload cap. */
export const PREVIEW_LIMIT_BYTES = 30_000_000;
/** What the bitrate aims for; the gap to the limit absorbs encoder overshoot. */
export const PREVIEW_TARGET_BYTES = 26_000_000;
export const PREVIEW_AUDIO_KBPS = 128;
/** No point going higher at 720p. */
export const PREVIEW_MAX_VIDEO_KBPS = 6000;
/** Below this, 720p kinetic type turns to mush: refuse rather than ship it. */
export const PREVIEW_MIN_VIDEO_KBPS = 300;
/** Preview height in px. */
export const PREVIEW_HEIGHT = 720;
/** Share of the byte budget left for MP4 container overhead. */
const CONTAINER_OVERHEAD = 0.02;

/** TV-range BT.709 in, TV-range BT.709 out, scaled to 720 lines (width keeps the aspect, even). */
export const PREVIEW_FILTER = `scale=-2:${PREVIEW_HEIGHT}:in_range=tv:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p,${BT709_FRAME_TAGS}`;

/**
 * Video and audio bitrates (kbps) that put a `durationSeconds` preview near
 * PREVIEW_TARGET_BYTES. Throws a CliError when the video is too long to fit
 * at a usable bitrate.
 */
export const previewBitrates = (durationSeconds) => {
  if (!(Number.isFinite(durationSeconds) && durationSeconds > 0)) {
    throw new CliError(`can't size the preview: duration is ${durationSeconds}`);
  }
  const totalKbps = ((PREVIEW_TARGET_BYTES * 8) / 1000 / durationSeconds) * (1 - CONTAINER_OVERHEAD);
  const videoKbps = Math.floor(Math.min(PREVIEW_MAX_VIDEO_KBPS, totalKbps - PREVIEW_AUDIO_KBPS));
  if (videoKbps < PREVIEW_MIN_VIDEO_KBPS) {
    throw new CliError(
      `a ${durationSeconds.toFixed(1)} s video only gets ${videoKbps} kbps of video in ${PREVIEW_TARGET_BYTES / 1e6} MB; ` +
        'too low for a readable 720p preview.',
    );
  }
  return {videoKbps, audioKbps: PREVIEW_AUDIO_KBPS};
};

const flagValue = (argv, i, name) => {
  const arg = argv[i];
  if (arg === name) {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) throw new CliError(`${name} needs a path`);
    return {value, next: i + 1};
  }
  if (arg.startsWith(`${name}=`)) {
    const value = arg.slice(name.length + 1);
    if (value === '') throw new CliError(`${name} needs a path`);
    return {value, next: i};
  }
  return null;
};

/**
 * `--in`, `--out` (either form); everything else is rejected. Paths resolve against `root`. The output must
 * end in .mp4, differ from the input, and never be the master out/<outputName>.mp4 (case-insensitive).
 */
export const parsePreviewArgs = (argv, {root = projectRoot} = {}) => {
  let input = null;
  let output = null;
  for (let i = 0; i < argv.length; i++) {
    const asIn = flagValue(argv, i, '--in');
    const asOut = asIn ? null : flagValue(argv, i, '--out');
    if (asIn) [input, i] = [asIn.value, asIn.next];
    else if (asOut) [output, i] = [asOut.value, asOut.next];
    else throw new CliError(`unexpected argument "${argv[i]}" (use --in <mp4> and --out <mp4>)`);
  }
  let outputName;
  try {
    ({outputName} = parsePipeline(readJson(root, 'src/pipeline.json')));
  } catch (err) {
    throw new CliError(err.message);
  }
  input = resolve(root, input ?? masterOutput(outputName));
  output = resolve(root, output ?? `${input.replace(/\.mp4$/i, '')}-preview.mp4`);
  if (!/\.mp4$/i.test(output)) throw new CliError(`--out must end in .mp4 (got ${output})`);
  if (samePath(output, input)) throw new CliError('--out must differ from --in');
  refuseMaster(output, root, outputName, 'a preview');
  return {input, output};
};

/** The input's duration, frame rate and size, from ffprobe. */
export const probeInput = async (ffprobeBin, file) => {
  const out = await capture(
    ffprobeBin,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', file],
    {label: 'ffprobe'},
  );
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new CliError(`ffprobe could not read ${file}`);
  }
  const v = parsed.streams?.[0];
  const duration = Number.parseFloat(parsed.format?.duration);
  const [num, den = '1'] = String(v?.r_frame_rate ?? '').split('/');
  const fps = Number(num) / Number(den);
  if (!v || !Number.isFinite(duration) || !(fps > 0) || !(v.width > 0) || !(v.height > 0)) throw new CliError(`ffprobe found no video in ${file}`);
  return {duration, fps, width: v.width, height: v.height};
};

/**
 * Write the preview. The two-pass log lives in a temp dir and ffmpeg writes a
 * partial file next to the output; both are registered in `cleanup` before
 * they can exist, and the output only appears once it's complete and under
 * the limit.
 */
export const preview = async ({input, output, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', tmpRoot = tmpdir()}, cleanup) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  const {duration, fps, width, height} = await probeInput(ffprobeBin, input);
  const {videoKbps, audioKbps} = previewBitrates(duration);
  const outWidth = 2 * Math.round((width * PREVIEW_HEIGHT) / height / 2);

  let tmp = null;
  cleanup.add(() => tmp && rmSync(tmp, {recursive: true, force: true}));
  tmp = mkdtempSync(join(tmpRoot, 'music-video-preview-'));
  const passlog = join(tmp, 'x264');
  mkdirSync(dirname(output), {recursive: true});
  const partial = join(dirname(output), `.partial-preview-${process.pid}.mp4`);
  cleanup.add(() => rmSync(partial, {force: true}));

  const video = ['-vf', PREVIEW_FILTER, ...x264Args({width: outWidth, height: PREVIEW_HEIGHT, fps, preset: 'medium', bitrateKbps: videoKbps})];
  console.log(`preview: ${duration.toFixed(1)} s at ${videoKbps} kbps video + ${audioKbps} kbps audio (two-pass)`);
  await run(
    ffmpegBin,
    ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', ...video, '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'null', '-'],
    {label: 'ffmpeg (pass 1)', cwd: tmp},
  );
  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...video,
      '-pass', '2', '-passlogfile', passlog,
      '-c:a', 'aac', '-b:a', `${audioKbps}k`,
      '-video_track_timescale', String(Math.round(fps)),
      '-movflags', '+faststart',
      partial,
    ],
    {label: 'ffmpeg (pass 2)', cwd: tmp},
  );
  const bytes = statSync(partial).size;
  if (bytes >= PREVIEW_LIMIT_BYTES) {
    throw new CliError(`preview came out at ${(bytes / 1e6).toFixed(1)} MB, over the ${PREVIEW_LIMIT_BYTES / 1e6} MB limit`);
  }
  renameSync(partial, output);
  console.log(`preview: wrote ${relative(process.cwd(), output) || output} (${(bytes / 1e6).toFixed(1)} MB)`);
};

export const main = (argv, overrides = {}) =>
  runCli('preview', async (cleanup) => {
    const args = parsePreviewArgs(argv, overrides);
    await preview({...args, ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
