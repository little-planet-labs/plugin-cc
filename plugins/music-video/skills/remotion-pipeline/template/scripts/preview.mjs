// `pnpm preview [--in <mp4>] [--out <mp4>]`
//
// A 720p H.264 + AAC copy of the final render that stays under chat upload
// limits (30 MB). The video bitrate is computed from the duration so the file
// lands near PREVIEW_TARGET_BYTES, and it's encoded in two passes so the size
// actually holds. Defaults: in = out/<pipeline.outputName>.mp4 (what
// `pnpm render` writes), out = the same name with "-preview".
import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {defaultOutput} from './render.mjs';

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
/** Share of the byte budget left for MP4 container overhead. */
const CONTAINER_OVERHEAD = 0.02;

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

/** `--in`, `--out` (either form); everything else is rejected. Paths resolve against `root`. */
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
  input = resolve(root, input ?? defaultOutput(root));
  output = resolve(root, output ?? input.replace(/\.mp4$/, '') + '-preview.mp4');
  if (!output.endsWith('.mp4')) throw new CliError(`--out must end in .mp4 (got ${output})`);
  if (output === input) throw new CliError('--out must differ from --in');
  return {input, output};
};

/** Duration of a media file in seconds, from ffprobe. */
export const probeDuration = async (ffprobeBin, file) => {
  const out = await capture(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
    label: 'ffprobe',
  });
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new CliError(`ffprobe gave no duration for ${file}`);
  return seconds;
};

/**
 * Write the preview. The two-pass log lives in a temp dir and ffmpeg writes a
 * partial file next to the output; both are registered in `cleanup` before
 * they can exist, and the output only appears once it's complete and under
 * the limit.
 */
export const preview = async ({input, output, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', tmpRoot = tmpdir()}, cleanup) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  const duration = await probeDuration(ffprobeBin, input);
  const {videoKbps, audioKbps} = previewBitrates(duration);

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-preview-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const passlog = join(tmp, 'x264');
  mkdirSync(dirname(output), {recursive: true});
  const partial = join(dirname(output), `.partial-preview-${process.pid}.mp4`);
  cleanup.add(() => rmSync(partial, {force: true}));

  const video = ['-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${videoKbps}k`, '-pix_fmt', 'yuv420p'];
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
  console.log(`preview: wrote ${output} (${(bytes / 1e6).toFixed(1)} MB)`);
};

export const main = (argv, overrides = {}) =>
  runCli('preview', async (cleanup) => {
    const args = parsePreviewArgs(argv, overrides);
    await preview({...args, ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
