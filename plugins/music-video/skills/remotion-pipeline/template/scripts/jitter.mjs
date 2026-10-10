// `pnpm jitter --from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]`
// `pnpm jitter --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]
//              [--settle <frames | preset>] [--exit-frames <n>] [--exit-stagger <n>] [--stagger <n>]`
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
//
// --all-lines measures every lyric line of src/data/lyrics.json over its hold:
// the frames where all its words have settled and none has started to leave,
// as MaskedWords times them (see holdWindows). Run it on a text-only render,
// where the world is black and only the lyric draws:
//   pnpm render --props='{"textOnly":true}' --out out/text-only.mp4
//   pnpm jitter --all-lines --in out/text-only.mp4
// It prints each line's mean and max pair shift and "lines with motion during
// hold: N" (a line moves when its mean shift is over 0.01 px, the same pass
// mark as a single window). --max <px> exits 1 when any line's largest pair
// shift is over it, as in the single-window mode. A frame with no pixel above
// 48 (of 255) is blank, not motion: a line's window ends at its first blank
// frame, and a window that starts blank is skipped. Lines whose window is
// shorter than 2 frames are skipped too; both are listed. --settle (frames,
// or a spring preset name; default the 'snappy' settle), --exit-frames,
// --exit-stagger and --stagger match scenes that pass other MaskedWords props.
// --all-lines can't be combined with --from or --frames.
import {existsSync, mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {loadLineWords, probeVideoInfo, readLyrics} from './lib/qa.mjs';
import {defaultOutput} from './render.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

const FLAGS = ['--in', '--from', '--frames', '--crop', '--max', '--threshold'];
/** Value flags that only mean something with --all-lines. */
const ALL_LINES_FLAGS = ['--settle', '--exit-frames', '--exit-stagger', '--stagger'];

/** MaskedWords' spring presets (src/components/motion/springs.ts SPRING_PRESETS). */
export const SPRING_PRESET_NAMES = ['snappy', 'default', 'heavy', 'playful'];
/** MaskedWords: frames of spring before a word's reveal (LEAD_FRAMES), and the gap before the next line (EXIT_GAP). */
export const LEAD_FRAMES = 2;
export const EXIT_GAP = 2;
/** The last line has no next line to exit before: its window ends this long after its sung end. */
export const LAST_LINE_TAIL_SECONDS = 1;
/** A frame whose brightest pixel is at most this (0..255) is blank: the lyric isn't there. */
export const BLANK_LEVEL = 48;
/** A line whose mean pair shift is above this, in px, has motion during its hold. */
export const MOTION_MEAN_PX = 0.01;

const nonNegativeInt = (name, raw) => {
  if (!/^\d+$/.test(raw)) throw new CliError(`${name} must be a whole number of frames >= 0 (got ${raw})`);
  return Number(raw);
};

/**
 * `--in`, `--from`, `--frames`, `--crop`, `--max`, `--threshold`, each as
 * `--flag value` or `--flag=value`, each at most once. `from` is
 * {frame} or {seconds}; `crop` is null for the whole frame.
 * With `--all-lines`: no --from/--frames; returns {input, allLines: true, crop,
 * max, threshold, settle, exitFrames, exitStagger, stagger}, where settle is
 * {frames} or {preset} and the others are null for MaskedWords' defaults.
 */
export const parseJitterArgs = (argv, {root = projectRoot} = {}) => {
  const values = new Map();
  let allLines = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all-lines') {
      if (allLines) throw new CliError('--all-lines given twice; pass it once');
      allLines = true;
      continue;
    }
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (!FLAGS.includes(name) && !ALL_LINES_FLAGS.includes(name)) {
      throw new CliError(
        `unexpected argument "${arg}" (use --from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>], ` +
          'or --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--settle <frames | preset>] [--exit-frames <n>] [--exit-stagger <n>] [--stagger <n>])',
      );
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('-')) throw new CliError(`${name} needs a value`);
    if (values.has(name)) throw new CliError(`${name} given twice; pass it once`);
    values.set(name, value);
  }

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
  // Resolved last, after every check: the default reads src/pipeline.json.
  const input = () => resolve(root, values.get('--in') ?? defaultOutput(root));

  if (allLines) {
    for (const name of ['--from', '--frames']) {
      if (values.has(name)) throw new CliError(`${name} can't be used with --all-lines: --all-lines measures every line's own hold window`);
    }
    let settle = {preset: 'snappy'};
    const settleRaw = values.get('--settle');
    if (settleRaw !== undefined) {
      if (SPRING_PRESET_NAMES.includes(settleRaw)) settle = {preset: settleRaw};
      else if (/^\d+$/.test(settleRaw)) settle = {frames: Number(settleRaw)};
      else throw new CliError(`--settle must be a number of frames or a spring preset (${SPRING_PRESET_NAMES.join(', ')}); got ${settleRaw}`);
    }
    const optionalInt = (name) => (values.has(name) ? nonNegativeInt(name, values.get(name)) : null);
    const exitFrames = optionalInt('--exit-frames');
    const exitStagger = optionalInt('--exit-stagger');
    const stagger = optionalInt('--stagger');
    return {input: input(), allLines: true, crop, max, threshold, settle, exitFrames, exitStagger, stagger};
  }

  for (const name of ALL_LINES_FLAGS) {
    if (values.has(name)) throw new CliError(`${name} only applies with --all-lines`);
  }
  const fromRaw = values.get('--from');
  if (fromRaw === undefined) throw new CliError('--from is required: an absolute frame (e.g. --from=1200) or seconds (e.g. --from=40s), or use --all-lines');
  let from;
  if (/^\d+$/.test(fromRaw)) from = {frame: Number(fromRaw)};
  else if (/^\d+(\.\d+)?s$/.test(fromRaw)) from = {seconds: Number(fromRaw.slice(0, -1))};
  else throw new CliError(`--from must be a frame number (1200) or seconds with an s (40s, 40.5s); got ${fromRaw}`);

  const framesRaw = values.get('--frames');
  if (framesRaw === undefined) throw new CliError('--frames is required: how many frames to measure, at least 2');
  const frames = Number(framesRaw);
  if (!Number.isInteger(frames) || frames < 2) throw new CliError(`--frames must be an integer of at least 2 (got ${framesRaw})`);

  return {input: input(), from, frames, crop, max, threshold};
};

/** Width, height, frame rate and start time (seconds, 0 when absent) of the first video stream, from ffprobe. */
export const probeVideo = async (ffprobeBin, file) => {
  const out = await capture(
    ffprobeBin,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,start_time', '-of', 'json', file],
    {label: 'ffprobe'},
  );
  const stream = JSON.parse(out).streams?.[0];
  const [num, den] = String(stream?.r_frame_rate ?? '').split('/').map(Number);
  const fps = num / (den ?? 1);
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height) || !Number.isFinite(fps) || fps <= 0) {
    throw new CliError(`ffprobe found no video stream with a frame rate in ${file}`);
  }
  const startTime = Number(stream.start_time);
  return {width: stream.width, height: stream.height, fps, startTime: Number.isFinite(startTime) ? startTime : 0};
};

const stats = (values) => {
  const finite = values.filter((v) => v !== null);
  if (finite.length === 0) return null;
  return {mean: finite.reduce((a, b) => a + b, 0) / finite.length, max: Math.max(...finite)};
};

const fmt = (v, digits = 3) => (v === null ? '-' : v.toFixed(digits));

/**
 * Decode `frames` consecutive frames of `area`, starting exactly at frame
 * `startFrame`, as raw 8-bit gray into `out`.
 *
 * A plain input seek to half a frame before `startFrame` is not exact: on
 * render.mjs output (x264 with B-frames, remuxed with -video_track_timescale)
 * ffmpeg 8.1 returned frame startFrame - 1 for many frames. Instead ffmpeg seeks
 * about a second early, keeps the file's own timestamps (-copyts), and the
 * select filter drops every frame before startFrame's timestamp
 * (`startTime` + startFrame / fps, less half a frame), so the first frame out
 * is exactly `startFrame` wherever the seek landed.
 */
export const decodeGray = async ({input, fps, startTime = 0, startFrame, frames, area, out, ffmpegBin = 'ffmpeg'}) => {
  const seekSeconds = Math.max(0, (startFrame - Math.ceil(fps)) / fps);
  const firstTime = startTime + (startFrame - 0.5) / fps;
  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      ...(seekSeconds > 0 ? ['-ss', seekSeconds.toFixed(6)] : []),
      '-i', input,
      '-copyts',
      '-map', '0:v:0',
      // Gray before the crop: cropping yuv420p rounds odd sizes and origins to the chroma grid.
      '-vf', `select='gte(t,${firstTime.toFixed(6)})',format=gray,crop=${area.w}:${area.h}:${area.x}:${area.y}`,
      '-frames:v', String(frames),
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo',
      out,
    ],
    {label: 'ffmpeg'},
  );
};

/**
 * Decode `frames` frames from `startFrame` of `area` into a raw file in `dir`
 * (decodeGray) and measure them with jitter.py. The raw file is removed before
 * returning. Returns {pairs (frames absolute), peaks (per frame)}.
 */
const measureWindow = async ({input, fps, startTime, startFrame, frames, area, threshold, dir, ffmpegBin, pythonBin}) => {
  const raw = join(dir, 'frames.gray');
  try {
    await decodeGray({input, fps, startTime, startFrame, frames, area, out: raw, ffmpegBin});
    const got = existsSync(raw) ? Math.floor(statSync(raw).size / (area.w * area.h)) : 0;
    if (got < frames) {
      throw new CliError(`only ${got} of ${frames} frames from frame ${startFrame} exist in ${input}; start earlier or measure fewer`);
    }
    const out = await capture(
      pythonBin,
      [join(scriptsDir, 'jitter.py'), raw, '--width', String(area.w), '--height', String(area.h), '--threshold', String(threshold)],
      {label: 'jitter.py'},
    );
    const result = JSON.parse(out);
    return {pairs: result.pairs.map((p, i) => ({from: startFrame + i, to: startFrame + i + 1, ...p})), peaks: result.peaks};
  } finally {
    rmSync(raw, {force: true});
  }
};

const checkedArea = (crop, video) => {
  const area = crop ?? {x: 0, y: 0, w: video.width, h: video.height};
  if (area.x + area.w > video.width || area.y + area.h > video.height) {
    throw new CliError(`--crop ${area.x},${area.y},${area.w},${area.h} doesn't fit the ${video.width}x${video.height} video`);
  }
  return area;
};

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
  const area = checkedArea(crop, video);

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-jitter-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const {pairs} = await measureWindow({input, fps: video.fps, startTime: video.startTime, startFrame, frames, area, threshold, dir: tmp, ffmpegBin, pythonBin});

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

/**
 * Each line's hold window [start, end) in absolute frames (pure), timed as
 * MaskedWords times a line with its default props (src/components/motion/MaskedWords.tsx):
 * - reveals: the words' sung start frames (round(seconds * fps), estimated
 *   from the text by `lineWords` when the line has no word timing), each
 *   pushed to at least `stagger` frames after the previous reveal;
 * - start: the last word's settle frame, lastReveal - LEAD_FRAMES + settle;
 * - end: the first word's earliest exit start, E - exitFrames - (n - 1) * exitStagger,
 *   with E = nextLineFirstWord - EXIT_GAP (a short hold compresses the exit to
 *   start later, so this end is never late). The last line ends at its sung
 *   end + LAST_LINE_TAIL_SECONDS. Every end is clamped to `totalFrames`.
 * A window shorter than 2 frames, one starting after the video, or a line
 * without words has a `skip` reason. Windows are song frames, so measure a
 * full-length render.
 *
 * @param {{id?: string, text: string, start: number, end: number, words?: {text: string, start: number, end: number}[]}[]} lines
 * @param {(line: any) => {start: number}[]} lineWords
 * @param {{fps: number, totalFrames: number, settle: number, exitFrames: number, exitStagger: number, stagger: number}} timing
 * @returns {{id: string, start: number | null, end: number | null, frames: number, skip: string | null}[]}
 */
export const holdWindows = (lines, lineWords, {fps, totalFrames, settle, exitFrames, exitStagger, stagger}) =>
  lines.map((line, idx) => {
    const id = line.id ?? `[${idx}]`;
    const words = lineWords(line);
    if (words.length === 0) return {id, start: null, end: null, frames: 0, skip: 'no words'};
    const reveals = [];
    for (const w of words) {
      const at = Math.round(w.start * fps);
      reveals.push(reveals.length === 0 ? at : Math.max(at, reveals[reveals.length - 1] + stagger));
    }
    const start = reveals[reveals.length - 1] - LEAD_FRAMES + settle;
    const next = lines[idx + 1];
    let end;
    if (next) {
      const nextFirst = Math.round((lineWords(next)[0]?.start ?? next.start) * fps);
      end = nextFirst - EXIT_GAP - exitFrames - (words.length - 1) * exitStagger;
    } else {
      end = Math.round((line.end + LAST_LINE_TAIL_SECONDS) * fps);
    }
    end = Math.min(end, totalFrames);
    const frames = Math.max(0, end - start);
    let skip = null;
    if (start >= totalFrames) skip = `hold starts at frame ${start}, after the last frame (${totalFrames - 1})`;
    else if (frames < 2) skip = `hold window ${start}-${end} is shorter than 2 frames`;
    return {id, start, end, frames, skip};
  });

/**
 * Settle frames for `settle` ({frames} or {preset}), from src/components/motion/springs.ts settleFrames.
 *
 * @param {{frames?: number, preset?: string}} settle
 * @param {number} fps
 * @returns {Promise<number>}
 */
export const resolveSettle = async (settle, fps) => {
  if (settle.frames !== undefined) return settle.frames;
  const {settleFrames} = await import('../src/components/motion/springs.ts');
  return settleFrames(fps, settle.preset);
};

/**
 * --all-lines: measure every line's hold window and print one row per line.
 * Returns {fps, settle, exitFrames, exitStagger, stagger, lines, moving, skipped}:
 * lines measured ({id, start, end, measuredEnd, pairs, mean, max, note}),
 * `moving` the ids with mean shift > MOTION_MEAN_PX, `skipped` ({id, reason}).
 * Throws a CliError after printing when `max` is set and a line's largest pair shift exceeds it.
 *
 * @param {{input: string, crop: {x: number, y: number, w: number, h: number} | null, max: number | null, threshold?: number,
 *   settle?: {frames?: number, preset?: string}, exitFrames?: number | null, exitStagger?: number | null, stagger?: number | null,
 *   root?: string, tmpRoot?: string, ffmpegBin?: string, ffprobeBin?: string, pythonBin?: string}} options
 * @param {Set<() => void>} cleanup
 */
export const jitterAllLines = async (
  {
    input,
    crop,
    max,
    threshold = 225,
    settle = {preset: 'snappy'},
    exitFrames = null,
    exitStagger = null,
    stagger = null,
    root = projectRoot,
    tmpRoot = tmpdir(),
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    pythonBin = join(root, '.venv/bin/python'),
  },
  cleanup,
) => {
  if (!existsSync(input)) {
    throw new CliError(`${input} doesn't exist. Render the text-only video first: pnpm render --props='{"textOnly":true}' --out out/text-only.mp4`);
  }
  if (!existsSync(pythonBin)) throw new CliError('Python venv missing (jitter needs its numpy). Run `pnpm setup:audio` first.');
  const [lyrics, lineWords] = await Promise.all([readLyrics(root), loadLineWords()]);
  if (lyrics.length === 0) throw new CliError('src/data/lyrics.json has no lines; run `pnpm align` first');
  const video = await probeVideoInfo(ffprobeBin, input);
  const {fps} = video;
  const area = checkedArea(crop, video);
  const timing = {
    fps,
    totalFrames: video.frames,
    settle: await resolveSettle(settle, fps),
    exitFrames: exitFrames ?? Math.round(0.3 * fps),
    exitStagger: exitStagger ?? Math.round(0.035 * fps),
    stagger: stagger ?? 2,
  };
  const windows = holdWindows(lyrics, lineWords, timing);

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-jitter-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const lines = [];
  const skipped = [];
  for (const w of windows) {
    if (w.skip) {
      skipped.push({id: w.id, reason: w.skip});
      continue;
    }
    const {pairs, peaks} = await measureWindow({input, fps, startTime: video.startTime, startFrame: w.start, frames: w.frames, area, threshold, dir: tmp, ffmpegBin, pythonBin});
    const blank = peaks.findIndex((p) => p <= BLANK_LEVEL);
    if (blank === 0) {
      skipped.push({id: w.id, reason: `blank at the start of its hold (frame ${w.start}): no pixel above ${BLANK_LEVEL}`});
      continue;
    }
    const kept = blank === -1 ? w.frames : blank;
    if (kept < 2) {
      skipped.push({id: w.id, reason: `blank from frame ${w.start + blank}, leaving fewer than 2 held frames`});
      continue;
    }
    const held = pairs.slice(0, kept - 1);
    const shift = stats(held.map((p) => p.shift));
    lines.push({
      id: w.id,
      start: w.start,
      end: w.end,
      measuredEnd: w.start + kept,
      pairs: held,
      mean: shift.mean,
      max: shift.max,
      note: blank === -1 ? null : `blank from frame ${w.start + blank}`,
    });
  }

  console.log(
    `jitter --all-lines: ${input}, crop ${area.x},${area.y},${area.w},${area.h}; settle ${timing.settle}, ` +
      `exit ${timing.exitFrames} frames, stagger ${timing.exitStagger}, reveal stagger ${timing.stagger}`,
  );
  console.log(`${'line'.padEnd(22)} ${'frames'.padEnd(13)} ${'mean px'.padStart(8)} ${'max px'.padStart(8)}`);
  for (const l of lines) {
    console.log(
      `${l.id.padEnd(22)} ${`${l.start}-${l.measuredEnd - 1}`.padEnd(13)} ${fmt(l.mean).padStart(8)} ${fmt(l.max).padStart(8)}` +
        `${l.mean > MOTION_MEAN_PX ? '  MOTION' : ''}${l.note ? `  (${l.note})` : ''}`,
    );
  }
  for (const s of skipped) console.log(`skipped ${s.id}: ${s.reason}`);
  const moving = lines.filter((l) => l.mean > MOTION_MEAN_PX).map((l) => l.id);
  console.log(`lines with motion during hold: ${moving.length} (of ${lines.length} measured, ${skipped.length} skipped; mean shift > ${MOTION_MEAN_PX} px)`);

  if (max !== null && max !== undefined) {
    const over = lines.filter((l) => l.max > max);
    if (over.length > 0) {
      throw new CliError(`${over.length} line(s) moved more than --max ${max} px in one frame during the hold: ${over.map((l) => `${l.id} (${fmt(l.max)} px)`).join(', ')}`);
    }
  }
  return {...timing, lines, moving, skipped};
};

export const main = (argv, overrides = {}) =>
  runCli('jitter', async (cleanup) => {
    const args = parseJitterArgs(argv, overrides);
    if (args.allLines) await jitterAllLines({...args, ...overrides}, cleanup);
    else await jitter({...args, ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
