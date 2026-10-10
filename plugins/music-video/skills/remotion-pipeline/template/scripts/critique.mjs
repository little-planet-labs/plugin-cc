// `pnpm critique --tag <name> [--in <mp4>] [--strips=<s,…>] [--overview-every=2] [--phone-every=4]`
//
// QA contact sheets for one critique round, written to out/critique/<tag>/:
// - overview_NN.png: a frame every --overview-every seconds (default 2) from
//   frame 0, 270 px wide, 6 x 5 per sheet;
// - phone_NN.png: a frame every --phone-every seconds (default 4), 360 px
//   wide (legibility at phone size), 5 x 3 per sheet;
// - strip_SSSS.SS.png: 12 consecutive frames from round((t - 0.1) * fps),
//   320 px wide, 6 x 2, for every t in --strips (seconds), or by default every
//   lyric line start (src/data/lyrics.json) and section start
//   (src/data/sections.json). Seconds are zero-padded to 7 characters so the
//   names sort in time order.
// Every tile is labelled with its time and frame ("0:12.40 f372"). Labels
// exist only on these sheets, never in the video.
//
// Frame-exact: ffmpeg decodes the whole file once per sheet kind and keeps
// frames by index (select on n, passthrough timing), so no seek can land on a
// neighbouring frame. scripts/critique.py (numpy, in the .venv from
// `pnpm setup:audio`) stamps the labels and writes the PNGs.
//
// The sheets are built in out/critique/<tag>/.partial-<pid>/ and moved into
// place only when every one is complete; sheets left from an earlier run of
// the same tag that this run didn't produce are then removed. A failed run
// leaves the tag directory as it was. Defaults: --in out/<outputName>.mp4.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';
import {probeVideoInfo, readLyrics, readSections} from './lib/qa.mjs';
import {defaultOutput} from './render.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

/** Tile width in px and sheet grid for each kind. */
export const OVERVIEW = {width: 270, cols: 6, rows: 5};
export const PHONE = {width: 360, cols: 5, rows: 3};
export const STRIP = {width: 320, cols: 6, rows: 2};
/** Frames per strip, and how far before t it starts. */
export const STRIP_FRAMES = 12;
export const STRIP_LEAD_SECONDS = 0.1;

const FLAGS = ['--in', '--tag', '--strips', '--overview-every', '--phone-every'];
/** One path segment: letters, digits, '.', '_', '-', not starting with '.' (so never '.' or '..'). */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const positiveSeconds = (name, raw) => {
  const v = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw) || !(v > 0)) throw new CliError(`${name} must be a number of seconds > 0 (got ${raw})`);
  return v;
};

/**
 * `--tag` (required), `--in`, `--strips`, `--overview-every`,
 * `--phone-every`, each as `--flag value` or `--flag=value`, at most once.
 * `strips` is null (use the lyric and section starts) or seconds.
 */
export const parseCritiqueArgs = (argv, {root = projectRoot} = {}) => {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (!FLAGS.includes(name)) {
      throw new CliError(
        `unexpected argument "${arg}" (use --tag <name> [--in <mp4>] [--strips=<s,…>] [--overview-every=<s>] [--phone-every=<s>])`,
      );
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('-')) throw new CliError(`${name} needs a value`);
    if (values.has(name)) throw new CliError(`${name} given twice; pass it once`);
    values.set(name, value);
  }
  const tag = values.get('--tag');
  if (tag === undefined) throw new CliError('--tag is required: the round name, e.g. --tag r1 (sheets go to out/critique/<tag>/)');
  if (!TAG.test(tag)) {
    throw new CliError(`--tag "${tag}" must be one path segment: letters, digits, '.', '_' or '-', not starting with '.' (e.g. r1)`);
  }
  let strips = null;
  const stripsRaw = values.get('--strips');
  if (stripsRaw !== undefined) {
    strips = stripsRaw.split(',').map((s) => {
      if (!/^\d+(\.\d+)?$/.test(s)) throw new CliError(`--strips must be seconds separated by commas, e.g. --strips=12.4,30 (got ${stripsRaw})`);
      return Number(s);
    });
  }
  const overviewEvery = values.has('--overview-every') ? positiveSeconds('--overview-every', values.get('--overview-every')) : 2;
  const phoneEvery = values.has('--phone-every') ? positiveSeconds('--phone-every', values.get('--phone-every')) : 4;
  // Resolved last, after every check: the default reads src/pipeline.json.
  return {input: resolve(root, values.get('--in') ?? defaultOutput(root)), tag, strips, overviewEvery, phoneEvery};
};

/** A tile label: the frame's time as m:ss.cc and its frame number, e.g. "1:02.50 f1875". */
export const formatLabel = (frame, fps) => {
  const cs = Math.round((frame / fps) * 100);
  const m = Math.floor(cs / 6000);
  const s = ((cs % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${m}:${s} f${frame}`;
};

/** strip_<seconds>.png, seconds with 2 decimals zero-padded to 7 characters. */
export const stripName = (seconds) => `strip_${seconds.toFixed(2).padStart(7, '0')}.png`;

/**
 * The frames nearest k * every seconds, k = 0, 1, 2, …, below `total`:
 * round(k * every * fps) per tile, so a fractional fps (29.97) doesn't drift
 * the way a fixed rounded step would. A cadence under one frame gives every frame once.
 */
export const cadenceFrames = (every, fps, total) => {
  const out = [];
  for (let k = 0; ; k++) {
    const f = Math.round(k * every * fps);
    if (f >= total) break;
    if (out[out.length - 1] !== f) out.push(f);
  }
  return out;
};

/**
 * The strips for `seconds` (ascending, deduplicated by name and start frame).
 * Each starts at max(0, round((t - 0.1) * fps)) and holds STRIP_FRAMES
 * consecutive frames, cut short at the last frame. A strip starting at or past
 * the end is skipped. Returns {strips: [{seconds, name, start, frames, note}], skipped: [{seconds, reason}]}.
 */
export const stripPlan = (seconds, fps, total) => {
  const strips = [];
  const skipped = [];
  const names = new Set();
  const starts = new Set();
  for (const t of [...seconds].sort((a, b) => a - b)) {
    const name = stripName(t);
    const start = Math.max(0, Math.round((t - STRIP_LEAD_SECONDS) * fps));
    if (names.has(name) || starts.has(start)) continue;
    if (start >= total) {
      skipped.push({seconds: t, reason: `starts at frame ${start}, after the last frame (${total - 1})`});
      continue;
    }
    names.add(name);
    starts.add(start);
    const end = Math.min(start + STRIP_FRAMES, total);
    const frames = Array.from({length: end - start}, (_, k) => start + k);
    const note = frames.length < STRIP_FRAMES ? `only ${frames.length} frames before the end` : null;
    strips.push({seconds: t, name, start, frames, note});
  }
  return {strips, skipped};
};

/** Split tiles into sheets of at most cols x rows; a sheet with fewer tiles shrinks to what it needs. */
const sheetsOf = (tiles, {cols, rows}) => {
  const out = [];
  for (let k = 0; k < tiles.length; k += cols * rows) {
    const chunk = tiles.slice(k, k + cols * rows);
    const c = Math.min(cols, chunk.length);
    out.push({cols: c, rows: Math.ceil(chunk.length / c), tiles: chunk});
  }
  return out;
};

/** A select expression keeping exactly `frames` (ascending): runs of consecutive frames become between(). */
const selectExpr = (frames) => {
  const terms = [];
  let a = frames[0];
  for (let i = 1; i <= frames.length; i++) {
    if (frames[i] !== frames[i - 1] + 1) {
      const b = frames[i - 1];
      terms.push(a === b ? `eq(n,${a})` : `between(n,${a},${b})`);
      a = frames[i];
    }
  }
  return terms.join('+');
};

/** Tile height for `tileWidth`, keeping the video's aspect ratio. */
const tileHeight = (video, tileWidth) => Math.max(1, Math.round((video.height * tileWidth) / video.width));

/**
 * Write the sheets. Throws a CliError (after cleanup has nothing left to
 * leave behind) when a decode, the sheet builder, or the inputs fail.
 * Returns {dir, sheets: [names], strips, skipped}.
 */
export const critique = async (
  {
    input,
    tag,
    strips: stripSeconds,
    overviewEvery = 2,
    phoneEvery = 4,
    root = projectRoot,
    tmpRoot = tmpdir(),
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    pythonBin = join(root, '.venv/bin/python'),
  },
  cleanup,
) => {
  if (!TAG.test(tag)) throw new CliError(`--tag "${tag}" must be one path segment`);
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` or \`pnpm draft\` first (or pass --in).`);
  if (!existsSync(pythonBin)) throw new CliError('Python venv missing (critique needs its numpy). Run `pnpm setup:audio` first.');

  let seconds = stripSeconds;
  if (seconds === null || seconds === undefined) {
    const [lyrics, sections] = await Promise.all([readLyrics(root), readSections(root)]);
    seconds = [...lyrics.map((l) => l.start), ...sections.map((s) => s.start)];
  }
  const video = await probeVideoInfo(ffprobeBin, input);
  const {fps, frames: total} = video;
  const {strips, skipped} = stripPlan(seconds, fps, total);

  const kinds = [
    {kind: 'overview', layout: OVERVIEW, frames: cadenceFrames(overviewEvery, fps, total)},
    {kind: 'phone', layout: PHONE, frames: cadenceFrames(phoneEvery, fps, total)},
  ];
  const stripFrames = [...new Set(strips.flatMap((s) => s.frames))].sort((a, b) => a - b);
  if (stripFrames.length > 0) kinds.push({kind: 'strip', layout: STRIP, frames: stripFrames});

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-critique-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));

  // The output directory: remember the topmost directory at or below
  // out/critique that this run creates, so a failed run removes exactly what it
  // made there. out/ itself, and anything outside out/critique/<tag>, is never removed.
  const critiqueDir = join(root, 'out/critique');
  const tagDir = join(critiqueDir, tag);
  const firstCreated = !existsSync(critiqueDir) ? critiqueDir : !existsSync(tagDir) ? tagDir : null;
  let finished = false;
  cleanup.add(() => {
    if (!finished && firstCreated) rmSync(firstCreated, {recursive: true, force: true});
  });
  const staging = join(tagDir, `.partial-${process.pid}`);
  cleanup.add(() => rmSync(staging, {recursive: true, force: true}));
  mkdirSync(staging, {recursive: true});

  const sheets = [];
  for (const {kind, layout, frames} of kinds) {
    const tw = layout.width;
    const th = tileHeight(video, tw);
    const raw = join(tmp, `${kind}.rgb`);
    await run(
      ffmpegBin,
      [
        '-v', 'error', '-y',
        '-i', input,
        '-map', '0:v:0',
        '-vf', `select='${selectExpr(frames)}',scale=${tw}:${th}:flags=area,format=rgb24`,
        '-fps_mode', 'passthrough',
        '-f', 'rawvideo',
        raw,
      ],
      {label: `ffmpeg (${kind} frames)`},
    );
    const bytes = existsSync(raw) ? statSync(raw).size : 0;
    if (bytes !== frames.length * tw * th * 3) {
      throw new CliError(`ffmpeg decoded ${Math.floor(bytes / (tw * th * 3))} of the ${frames.length} ${kind} frames from ${input}`);
    }
    const index = new Map(frames.map((f, i) => [f, i]));
    const tile = (f) => ({index: index.get(f), label: formatLabel(f, fps)});
    if (kind === 'strip') {
      for (const s of strips) {
        const [sheet] = sheetsOf(s.frames.map(tile), layout);
        sheets.push({name: s.name, raw, tileWidth: tw, tileHeight: th, ...sheet});
      }
    } else {
      sheetsOf(frames.map(tile), layout).forEach((sheet, k) => {
        sheets.push({name: `${kind}_${String(k + 1).padStart(2, '0')}.png`, raw, tileWidth: tw, tileHeight: th, ...sheet});
      });
    }
  }

  const job = join(tmp, 'job.json');
  writeFileSync(job, JSON.stringify({sheets: sheets.map(({name, ...s}) => ({...s, out: join(staging, name)}))}));
  await run(pythonBin, [join(scriptsDir, 'critique.py'), job], {label: 'critique.py'});
  for (const {name} of sheets) {
    if (!existsSync(join(staging, name))) throw new CliError(`critique.py did not write ${name}`);
  }

  for (const {name} of sheets) renameSync(join(staging, name), join(tagDir, name));
  const written = new Set(sheets.map((s) => s.name));
  const stale = readdirSync(tagDir).filter((f) => /^(overview|phone)_\d+\.png$|^strip_[\d.]+\.png$/.test(f) && !written.has(f));
  for (const f of stale) rmSync(join(tagDir, f), {force: true});
  finished = true;

  const count = (kind) => sheets.filter((s) => s.name.startsWith(`${kind}_`)).length;
  console.log(
    `critique: ${tagDir}: ${count('overview')} overview, ${count('phone')} phone, ${strips.length} strip sheet(s) ` +
      `from ${input} (${total} frames at ${fps} fps)`,
  );
  for (const s of strips) {
    console.log(`  ${s.name}  frames ${s.frames[0]}-${s.frames[s.frames.length - 1]}${s.note ? `  (${s.note})` : ''}`);
  }
  for (const s of skipped) console.log(`  skipped strip at ${s.seconds} s: ${s.reason}`);
  if (stale.length > 0) console.log(`  removed ${stale.length} sheet(s) left from an earlier run: ${stale.join(', ')}`);
  return {dir: tagDir, sheets: sheets.map((s) => s.name), strips, skipped};
};

export const main = (argv, overrides = {}) =>
  runCli('critique', async (cleanup) => {
    await critique({...parseCritiqueArgs(argv, overrides), ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
