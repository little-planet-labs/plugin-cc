// `pnpm jitter --from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]`
//
// Measures how much a held picture moves from frame to frame, to catch held
// lyrics that shimmer (unsettled springs, beat-punch scaling, grain over type).
// ffmpeg decodes `--frames` frames from `--from` (an absolute frame number, or
// seconds with an `s` suffix, e.g. 12.5s) of the crop as 8-bit gray into a temp
// file; scripts/jitter.py (numpy, in the .venv from `pnpm setup:audio`) measures
// each consecutive pair: the sub-pixel shift by phase correlation, the shift of
// the bright-pixel centroid (light text on a dark ground; pixels > --threshold,
// default 225) and the mean absolute pixel difference.
//
// --max <px> makes it a check: exit 1 when any pair's phase-correlation shift
// is larger. Scaling and flicker don't translate, so read the diff column for
// those. Defaults: --in out/<pipeline.outputName>.mp4, whole frame.
import {existsSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {defaultOutput} from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FLAGS = ['--in', '--from', '--frames', '--crop', '--max', '--threshold'];

/**
 * `--in`, `--from`, `--frames`, `--crop`, `--max`, `--threshold`, each as
 * `--flag value` or `--flag=value`, each at most once. `from` is
 * {frame} or {seconds}; `crop` is null for the whole frame.
 */
export const parseJitterArgs = (argv, {root = projectRoot} = {}) => {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (!FLAGS.includes(name)) {
      throw new CliError(
        `unexpected argument "${arg}" (use --from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>])`,
      );
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('-')) throw new CliError(`${name} needs a value`);
    if (values.has(name)) throw new CliError(`${name} given twice; pass it once`);
    values.set(name, value);
  }

  const fromRaw = values.get('--from');
  if (fromRaw === undefined) throw new CliError('--from is required: an absolute frame (e.g. --from=1200) or seconds (e.g. --from=40s)');
  let from;
  if (/^\d+$/.test(fromRaw)) from = {frame: Number(fromRaw)};
  else if (/^\d+(\.\d+)?s$/.test(fromRaw)) from = {seconds: Number(fromRaw.slice(0, -1))};
  else throw new CliError(`--from must be a frame number (1200) or seconds with an s (40s, 40.5s); got ${fromRaw}`);

  const framesRaw = values.get('--frames');
  if (framesRaw === undefined) throw new CliError('--frames is required: how many frames to measure, at least 2');
  const frames = Number(framesRaw);
  if (!Number.isInteger(frames) || frames < 2) throw new CliError(`--frames must be an integer of at least 2 (got ${framesRaw})`);

  let crop = null;
  const cropRaw = values.get('--crop');
  if (cropRaw !== undefined) {
    const parts = cropRaw.split(',');
    if (parts.length !== 4 || !parts.every((p) => /^\d+$/.test(p))) {
      throw new CliError(`--crop must be x,y,w,h in whole pixels (got ${cropRaw})`);
    }
    const [x, y, w, h] = parts.map(Number);
    if (w < 2 || h < 2) throw new CliError(`--crop width and height must be at least 2 (got ${cropRaw})`);
    crop = {x, y, w, h};
  }

  let max = null;
  const maxRaw = values.get('--max');
  if (maxRaw !== undefined) {
    max = Number(maxRaw);
    if (!Number.isFinite(max) || max < 0) throw new CliError(`--max must be a number of pixels >= 0 (got ${maxRaw})`);
  }

  let threshold = 225;
  const thresholdRaw = values.get('--threshold');
  if (thresholdRaw !== undefined) {
    threshold = Number(thresholdRaw);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
      throw new CliError(`--threshold must be an integer 0..255 (got ${thresholdRaw})`);
    }
  }

  return {input: resolve(root, values.get('--in') ?? defaultOutput(root)), from, frames, crop, max, threshold};
};

/** Width, height and frame rate of the first video stream, from ffprobe. */
export const probeVideo = async (ffprobeBin, file) => {
  const out = await capture(
    ffprobeBin,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', file],
    {label: 'ffprobe'},
  );
  const stream = JSON.parse(out).streams?.[0];
  const [num, den] = String(stream?.r_frame_rate ?? '').split('/').map(Number);
  const fps = num / (den ?? 1);
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height) || !Number.isFinite(fps) || fps <= 0) {
    throw new CliError(`ffprobe found no video stream with a frame rate in ${file}`);
  }
  return {width: stream.width, height: stream.height, fps};
};

const stats = (values) => {
  const finite = values.filter((v) => v !== null);
  if (finite.length === 0) return null;
  return {mean: finite.reduce((a, b) => a + b, 0) / finite.length, max: Math.max(...finite)};
};

const fmt = (v, digits = 3) => (v === null ? '-' : v.toFixed(digits));

/**
 * Measure and print. Returns {startFrame, fps, crop, pairs}; each pair is
 * {from, to, dx, dy, shift, centroidShift, diff} (frames absolute, centroidShift
 * null when no pixel is above the threshold). Throws a CliError when `max`
 * is set and a shift exceeds it, after printing the table.
 */
export const jitter = async (
  {
    input,
    from,
    frames,
    crop,
    max, // px, or null/undefined for no check
    threshold = 225,
    root = projectRoot,
    tmpRoot = tmpdir(),
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    pythonBin = join(root, '.venv/bin/python'),
  },
  cleanup,
) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  if (!existsSync(pythonBin)) throw new CliError('Python venv missing (jitter needs its numpy). Run `pnpm setup:audio` first.');

  const video = await probeVideo(ffprobeBin, input);
  const startFrame = from.frame ?? Math.round(from.seconds * video.fps);
  const area = crop ?? {x: 0, y: 0, w: video.width, h: video.height};
  if (area.x + area.w > video.width || area.y + area.h > video.height) {
    throw new CliError(`--crop ${area.x},${area.y},${area.w},${area.h} doesn't fit the ${video.width}x${video.height} video`);
  }

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-jitter-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const raw = join(tmp, 'frames.gray');

  // Input seek to half a frame before the first wanted frame: ffmpeg decodes
  // from the keyframe before it and drops every frame earlier than the seek
  // point, so the first frame out is exactly `startFrame`.
  const seek = startFrame > 0 ? ['-ss', String((startFrame - 0.5) / video.fps)] : [];
  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      ...seek,
      '-i', input,
      '-map', '0:v:0',
      // Gray first: cropping yuv420p rounds odd sizes and origins to the chroma grid.
      '-vf', `format=gray,crop=${area.w}:${area.h}:${area.x}:${area.y}`,
      '-frames:v', String(frames),
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo',
      raw,
    ],
    {label: 'ffmpeg'},
  );
  const got = existsSync(raw) ? Math.floor(statSync(raw).size / (area.w * area.h)) : 0;
  if (got < frames) {
    throw new CliError(`only ${got} of ${frames} frames from frame ${startFrame} exist in ${input}; start earlier or measure fewer`);
  }

  const out = await capture(
    pythonBin,
    [join(root, 'scripts/jitter.py'), raw, '--width', String(area.w), '--height', String(area.h), '--threshold', String(threshold)],
    {label: 'jitter.py'},
  );
  const pairs = JSON.parse(out).pairs.map((p, i) => ({from: startFrame + i, to: startFrame + i + 1, ...p}));

  console.log(
    `jitter: ${input}, frames ${startFrame}-${startFrame + frames - 1} (${(startFrame / video.fps).toFixed(3)} s), ` +
      `crop ${area.x},${area.y},${area.w},${area.h}`,
  );
  console.log('frames        dx       dy    shift  centroid    diff');
  for (const p of pairs) {
    console.log(
      `${`${p.from}->${p.to}`.padEnd(11)} ${fmt(p.dx).padStart(7)}  ${fmt(p.dy).padStart(7)}  ${fmt(p.shift).padStart(7)}  ` +
        `${fmt(p.centroidShift).padStart(8)}  ${fmt(p.diff, 2).padStart(6)}`,
    );
  }
  const shift = stats(pairs.map((p) => p.shift));
  const centroidShift = stats(pairs.map((p) => p.centroidShift));
  const diff = stats(pairs.map((p) => p.diff));
  console.log(
    `shift px: mean ${fmt(shift.mean)} max ${fmt(shift.max)} | centroid px: ` +
      `${centroidShift ? `mean ${fmt(centroidShift.mean)} max ${fmt(centroidShift.max)}` : `- (no pixel above ${threshold})`} | ` +
      `diff: mean ${fmt(diff.mean, 2)} max ${fmt(diff.max, 2)}`,
  );

  if (max !== null && max !== undefined && shift.max > max) {
    const worst = pairs.find((p) => p.shift === shift.max);
    throw new CliError(`shift of ${fmt(shift.max)} px (frames ${worst.from}->${worst.to}) is over --max ${max} px`);
  }
  return {startFrame, fps: video.fps, crop: area, pairs};
};

export const main = (argv, overrides = {}) =>
  runCli('jitter', async (cleanup) => {
    await jitter({...parseJitterArgs(argv, overrides), ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
