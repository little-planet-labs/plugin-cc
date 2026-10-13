// `pnpm jitter --from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]`
// `pnpm jitter --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>] [--scenes=<module>]`
//
// Measures how much a held picture moves from frame to frame, to catch held
// lyrics that shimmer (unsettled springs, beat-punch scaling, grain over type).
// ffmpeg decodes `--frames` frames from `--from` (a frame of the MP4 being
// measured, or seconds with an `s` suffix, e.g. 12.5s) of the crop as 8-bit
// gray into a temp file; scripts/jitter.py (numpy, in the .venv from
// `pnpm setup:env`) measures each consecutive pair: the sub-pixel shift by
// phase correlation, the shift of the bright-pixel centroid (light text on a
// dark ground; pixels > --threshold, default 225) and the mean absolute pixel
// difference. On a partial render (`pnpm render --frames=<a>-<b>`) frame 0 of
// the MP4 is page frame a: give --from as a frame of the MP4 (page frame - a);
// the header prints the page frames when the manifest sidecar says so.
//
// --max <px> makes it a check: exit 1 when any pair's phase-correlation shift
// is larger. Scaling and flicker don't translate, so read the diff column for
// those. Defaults: --in out/<outputName>.mp4, whole frame.
//
// --all-lines measures every lyric line over its hold window: the frames n
// with settled <= n / fps < exitStart in the page's own schedule
// (window.__mv.lines(), read from a headless page through scripts/capture.py,
// so it needs `pnpm setup:env` and launches Chromium). Run it on a text-only
// render, where the world is black and only the lyric draws:
//   pnpm render --textonly        (writes out/<outputName>-textonly.mp4)
//   pnpm jitter --all-lines       (reads it by default)
// The page is opened with the scene registry the render used (the manifest's
// source; --scenes overrides, default src/scenes/index.js), and the windows
// are mapped from page frames to the video's frames with the manifest's
// firstFrame, so a partial render (--frames=<a>-<b>, written to
// out/<outputName>-textonly-frames-<a>-<b>.mp4: pass it with --in) measures the
// lines whose hold falls inside it (windows clipped to it; lines outside it are
// skipped).
// It prints each line's mean and max pair shift and "lines with motion during
// hold: N" (a line moves when its mean shift is over 0.01 px, the same pass
// mark as a single window). --max <px> exits 1 when any line's largest pair
// shift is over it. A frame with no pixel above 48 (of 255) is blank, not
// motion: a line's window ends at its first blank frame, and a window that
// starts blank is skipped. Lines whose window is shorter than 2 frames are
// skipped too, and so are lines with no line-wide hold at all (the last word
// settles after the first word starts to leave; each word is still held, and
// pnpm still-test checks words one by one); every skip is listed with its
// reason, except lines held entirely outside a partial render, which are
// counted. It exits 1 when no line could be measured. Without a manifest the
// video must show the whole page (a shorter one is refused as a partial render
// that lost its sidecar). --all-lines can't be combined with --from or --frames.
import {existsSync, mkdtempSync, realpathSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateScenesPath} from '../src/lib/registry.js';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {requireVenvPython} from './lib/env.mjs';
import {manifestPath} from './lib/outputs.mjs';
import {defaultMaster, defaultTextonly, holdRange, manifestFor, pageLines, parseFlags, probeVideoInfo} from './lib/qa.mjs';
import {requireCaptureEnv} from './still.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

/** A frame whose brightest pixel is at most this (0..255) is blank: the lyric isn't there. */
export const BLANK_LEVEL = 48;
/** A line whose mean pair shift is above this, in px, has motion during its hold. */
export const MOTION_MEAN_PX = 0.01;
/** The scene registry the page loads when neither --scenes nor a manifest names one. */
export const DEFAULT_SCENES = 'src/scenes/index.js';

const USAGE =
  '--from <frame | seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>], ' +
  'or --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>] [--scenes=<module>]';

/**
 * `--in`, `--from`, `--frames`, `--crop`, `--max`, `--threshold`, each as
 * `--flag value` or `--flag=value`, each at most once. `from` is
 * {frame} or {seconds}; `crop` is null for the whole frame.
 * With `--all-lines`: no --from/--frames; returns {input, allLines: true, crop,
 * max, threshold, scenes} (scenes null: the manifest's, else DEFAULT_SCENES).
 */
export const parseJitterArgs = (argv, {root = projectRoot} = {}) => {
  const {values, switches} = parseFlags(argv, {
    values: ['--in', '--from', '--frames', '--crop', '--max', '--threshold', '--scenes'],
    switches: ['--all-lines'],
    usage: USAGE,
  });
  const allLines = switches.has('--all-lines');

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

  if (allLines) {
    for (const name of ['--from', '--frames']) {
      if (values.has(name)) throw new CliError(`${name} can't be used with --all-lines: --all-lines measures every line's own hold window`);
    }
    let scenes = null;
    if (values.has('--scenes')) {
      try {
        scenes = validateScenesPath(values.get('--scenes'));
      } catch (err) {
        throw new CliError(err.message);
      }
    }
    // Resolved last, after every check: the default reads src/pipeline.json.
    const input = values.has('--in') ? resolve(root, values.get('--in')) : defaultTextonly(root);
    return {input, allLines: true, crop, max, threshold, scenes};
  }

  if (values.has('--scenes')) throw new CliError('--scenes only applies with --all-lines');
  const fromRaw = values.get('--from');
  if (fromRaw === undefined) throw new CliError('--from is required: a frame (e.g. --from=1200) or seconds (e.g. --from=40s), or use --all-lines');
  let from;
  if (/^\d+$/.test(fromRaw)) from = {frame: Number(fromRaw)};
  else if (/^\d+(\.\d+)?s$/.test(fromRaw)) from = {seconds: Number(fromRaw.slice(0, -1))};
  else throw new CliError(`--from must be a frame number (1200) or seconds with an s (40s, 40.5s); got ${fromRaw}`);

  const framesRaw = values.get('--frames');
  if (framesRaw === undefined) throw new CliError('--frames is required: how many frames to measure, at least 2');
  const frames = Number(framesRaw);
  if (!Number.isInteger(frames) || frames < 2) throw new CliError(`--frames must be an integer of at least 2 (got ${framesRaw})`);

  const input = values.has('--in') ? resolve(root, values.get('--in')) : defaultMaster(root);
  return {input, from, frames, crop, max, threshold};
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
 * x264 output with B-frames ffmpeg 8 can return frame startFrame - 1.
 * Instead ffmpeg seeks about a second early, keeps the file's own timestamps
 * (-copyts), and the select filter drops every frame before startFrame's
 * timestamp (`startTime` + startFrame / fps, less half a frame), so the first
 * frame out is exactly `startFrame` wherever the seek landed.
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
 * returning. Returns {pairs (video frames), peaks (per frame)}.
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
 * {from, to, dx, dy, shift, centroidShift, diff} (video frames, centroidShift
 * null when no pixel is above the threshold). Throws a CliError when `max`
 * is set and a shift exceeds it, after printing the table.
 */
export const jitter = async (
  {input, from, frames, crop, max, threshold = 225, root = projectRoot, tmpRoot = tmpdir(), ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', pythonBin},
  cleanup,
) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  const python = requireVenvPython(root, pythonBin);

  const video = await probeVideoInfo(ffprobeBin, input);
  const first = manifestFor(input, video)?.firstFrame ?? 0;
  const startFrame = from.frame ?? Math.round(from.seconds * video.fps);
  const area = checkedArea(crop, video);

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-jitter-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const {pairs} = await measureWindow({input, fps: video.fps, startTime: video.startTime, startFrame, frames, area, threshold, dir: tmp, ffmpegBin, pythonBin: python});

  console.log(
    `jitter: ${input}, frames ${startFrame}-${startFrame + frames - 1} (${(startFrame / video.fps).toFixed(3)} s)` +
      `${first > 0 ? ` = page frames ${first + startFrame}-${first + startFrame + frames - 1}` : ''}, crop ${area.x},${area.y},${area.w},${area.h}`,
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
 * Each line's hold window in the video's frames (pure). The page window is
 * holdRange(settled, exitStart) over the page's `pageFrames`; the video shows
 * page frames first .. first + frames - 1, so a window is shifted by -first
 * and clipped to the video. Returns, per line, {id, page: {first, last} | null,
 * start, end (video frames, end exclusive), frames, skip, note}: `skip` is the
 * reason a line can't be measured (a window under 2 frames, or outside the
 * rendered frames, which also sets `outside`), `note` says when a window was clipped.
 * @param {{id: string, settled: number, exitStart: number | null}[]} lines
 * @param {{fps: number, pageFrames: number, first?: number, frames: number}} video
 */
export const allLinesWindows = (lines, {fps, pageFrames, first = 0, frames}) =>
  lines.map((line) => {
    const r = holdRange(line.settled, line.exitStart, fps, pageFrames);
    const none = {id: line.id, page: null, start: null, end: null, frames: 0, note: null};
    if (line.exitStart !== null && line.exitStart <= line.settled) {
      // The line's last word settles after its first word starts to leave: no frame holds the whole line still.
      return {
        ...none,
        skip: `line-level window empty (settled at ${fmtTime(line.settled)}, exit starts at ${fmtTime(line.exitStart)}); words are held individually: use pnpm still-test`,
      };
    }
    if (r.count < 2) {
      const reason = r.count === 0 ? `hold window ${fmtTime(line.settled)} to ${fmtTime(line.exitStart)} holds no frame` : `hold window ${r.first}-${r.last} is shorter than 2 frames`;
      return {...none, skip: reason};
    }
    const page = {first: r.first, last: r.last};
    const start = Math.max(r.first, first) - first;
    const end = Math.min(r.last + 1, first + frames) - first;
    const rendered = `${first}-${first + frames - 1}`;
    if (end - start <= 0) return {...none, page, outside: true, skip: `hold frames ${r.first}-${r.last} are outside the rendered frames ${rendered}`};
    const clipped = start + first !== r.first || end + first !== r.last + 1;
    if (end - start < 2) return {...none, page, skip: `only ${end - start} held frame inside the rendered frames ${rendered} (hold frames ${r.first}-${r.last})`};
    return {id: line.id, page, start, end, frames: end - start, skip: null, note: clipped ? `hold frames ${r.first}-${r.last} clipped to the rendered frames ${rendered}` : null};
  });

const fmtTime = (t) => (t === null || !Number.isFinite(t) ? 'never' : `${t.toFixed(3)} s`);

/**
 * --all-lines: measure every line's hold window and print one row per line.
 * Returns {fps, first, scenes, lines, moving, skipped}: lines measured ({id,
 * start, end, measuredEnd (video frames), page, pairs, mean, max, note}),
 * `moving` the ids with mean shift > MOTION_MEAN_PX, `skipped` ({id, reason}).
 * Throws a CliError (with the result as `.result`) after printing when no line
 * was measured, or when `max` is set and a line's largest pair shift exceeds it. `schedule` (tests) replaces the page call: {info: {fps, frames}, lines}.
 *
 * @param {{input: string, crop: {x: number, y: number, w: number, h: number} | null, max: number | null, threshold?: number,
 *   scenes?: string | null, root?: string, envRoot?: string, tmpRoot?: string, ffmpegBin?: string, ffprobeBin?: string,
 *   pythonBin?: string, schedule?: {info: {fps: number, frames: number}, lines: object[]} | null}} options
 * @param {Set<() => void>} cleanup
 */
export const jitterAllLines = async (
  {
    input,
    crop,
    max,
    threshold = 225,
    scenes = null,
    root = projectRoot,
    envRoot = root,
    tmpRoot = tmpdir(),
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    pythonBin,
    schedule = null,
  },
  cleanup,
) => {
  if (!existsSync(input)) {
    throw new CliError(`${input} doesn't exist. Render the text-only video first: pnpm render --textonly (or pass --in)`);
  }
  const python = schedule || pythonBin ? requireVenvPython(envRoot, pythonBin) : requireCaptureEnv(envRoot);
  const video = await probeVideoInfo(ffprobeBin, input);
  const {fps} = video;
  const manifest = manifestFor(input, video);
  const first = manifest?.firstFrame ?? 0;
  const registry = scenes ?? manifest?.source ?? DEFAULT_SCENES;
  if (manifest && !manifest.textonly) {
    console.warn(`jitter: ${input} is not a text-only render; world motion behind the text reads as line motion (pnpm render --textonly)`);
  }
  if (!existsSync(join(root, registry))) throw new CliError(`scene registry ${registry} doesn't exist (pass --scenes=<module>)`);
  const page = schedule ?? (await pageLines({root, envRoot, pythonBin: python, scenes: registry}));
  if (Math.abs(page.info.fps - fps) > 1e-6) throw new CliError(`${input} is at ${fps} fps but the page runs at ${page.info.fps}; render it again`);
  if (manifest === null && video.frames < page.info.frames) {
    throw new CliError(
      `${input} has ${video.frames} frames but the page has ${page.info.frames}, and no manifest sidecar (${manifestPath(input)}) says which ` +
        'page frames it shows: it is probably a partial render whose sidecar is gone; render it again (pnpm render --textonly)',
    );
  }
  if (first + video.frames > page.info.frames) {
    throw new CliError(`${input} shows page frames ${first}-${first + video.frames - 1} but the page has ${page.info.frames}; render it again`);
  }
  if (page.lines.length === 0) throw new CliError('the page registers no lyric lines; nothing to measure');
  const area = checkedArea(crop, video);
  const windows = allLinesWindows(page.lines, {fps, pageFrames: page.info.frames, first, frames: video.frames});

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-jitter-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const lines = [];
  const skipped = [];
  for (const w of windows) {
    if (w.skip) {
      skipped.push({id: w.id, reason: w.skip, outside: w.outside === true});
      continue;
    }
    const {pairs, peaks} = await measureWindow({input, fps, startTime: video.startTime, startFrame: w.start, frames: w.frames, area, threshold, dir: tmp, ffmpegBin, pythonBin: python});
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
    const notes = [w.note, blank === -1 ? null : `blank from frame ${w.start + blank}`].filter(Boolean);
    lines.push({
      id: w.id,
      start: w.start,
      end: w.end,
      measuredEnd: w.start + kept,
      page: w.page,
      pairs: held,
      mean: shift.mean,
      max: shift.max,
      note: notes.length > 0 ? notes.join('; ') : null,
    });
  }

  console.log(
    `jitter --all-lines: ${input}, crop ${area.x},${area.y},${area.w},${area.h}; schedule from ${registry}` +
      `${first > 0 ? `; video frame 0 is page frame ${first} (frames below are video frames)` : ''}`,
  );
  console.log(`${'line'.padEnd(22)} ${'frames'.padEnd(13)} ${'mean px'.padStart(8)} ${'max px'.padStart(8)}`);
  for (const l of lines) {
    console.log(
      `${l.id.padEnd(22)} ${`${l.start}-${l.measuredEnd - 1}`.padEnd(13)} ${fmt(l.mean).padStart(8)} ${fmt(l.max).padStart(8)}` +
        `${l.mean > MOTION_MEAN_PX ? '  MOTION' : ''}${l.note ? `  (${l.note})` : ''}`,
    );
  }
  // Lines held entirely outside a partial render are counted, not listed one by one.
  const outside = skipped.filter((s) => s.outside);
  for (const s of skipped.filter((x) => !x.outside)) console.log(`skipped ${s.id}: ${s.reason}`);
  if (outside.length > 0) console.log(`${outside.length} line(s) held outside the rendered frames ${first}-${first + video.frames - 1}: not measured`);
  const moving = lines.filter((l) => l.mean > MOTION_MEAN_PX).map((l) => l.id);
  console.log(
    `lines with motion during hold: ${moving.length} (of ${lines.length} measured, ${skipped.length - outside.length} skipped` +
      `${outside.length > 0 ? `, ${outside.length} outside the rendered frames` : ''}; mean shift > ${MOTION_MEAN_PX} px)`,
  );

  const result = {fps, first, scenes: registry, windows, lines, moving, skipped};
  const fail = (message) => Object.assign(new CliError(message), {result});
  if (lines.length === 0) throw fail('no line was measured: every line was skipped or held outside the rendered frames');
  if (max !== null && max !== undefined) {
    const over = lines.filter((l) => l.max > max);
    if (over.length > 0) {
      throw fail(`${over.length} line(s) moved more than --max ${max} px in one frame during the hold: ${over.map((l) => `${l.id} (${fmt(l.max)} px)`).join(', ')}`);
    }
  }
  return result;
};

export const main = (argv, overrides = {}) =>
  runCli('jitter', async (cleanup) => {
    const args = parseJitterArgs(argv, overrides);
    if (args.allLines) await jitterAllLines({...args, ...overrides}, cleanup);
    else await jitter({...args, ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
