// `pnpm critique --tag <name> [--in <mp4>] [--strips=<s,...>] [--overview-every=2] [--phone-every=4]`
//
// QA contact sheets for one critique round, written to out/critique/<tag>/:
// - overview_NN.png: a frame every --overview-every seconds (default 2) from
//   the first frame, 270 px wide, 6 x 5 per sheet;
// - phone_NN.png: a frame every --phone-every seconds (default 4), 360 px
//   wide (legibility at phone size), 5 x 3 per sheet;
// - strip_SSSS.SS.png: 12 consecutive frames from round((t - 0.1) * fps),
//   320 px wide, 6 x 2, for every t in --strips (seconds), or by default every
//   lyric line start and section start (the timing in effect, scripts/lib/project.mjs).
//   Seconds are zero-padded to 7 characters so the names sort in time order.
// Every tile is labelled with its time and frame ("0:12.40 f372"). Labels
// exist only on these sheets, never in the video.
//
// Frames and times are the page's (song) frames: a partial render
// (`--frames=<a>-<b>`) has a manifest sidecar whose firstFrame says which page
// frame its first frame shows, and labels, strips and the overview cadence
// follow it. Without a sidecar the video starts at frame 0. Strips that start
// before or after the rendered frames are skipped (listed when given with
// --strips, counted when they are the defaults).
//
// Frame-exact: ffmpeg decodes the whole file once per sheet kind and keeps
// frames by index (select on n, passthrough timing), so no seek can land on a
// neighbouring frame. scripts/critique.py (numpy, in the .venv from
// `pnpm setup:env`) stamps the labels and writes the PNGs.
//
// The new tag directory is built whole in out/critique/.partial-<tag>-<pid>/
// (with the earlier run's non-sheet files, such as notes, copied in) and
// swapped in for the old one with directory renames, so the tag directory is
// always one run's complete set of sheets, never a mix; sheets of an earlier
// run that this run didn't produce are gone with it. A failed run leaves the
// tag directory as it was. Defaults: --in out/<outputName>.mp4.
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';
import {requireVenvPython} from './lib/env.mjs';
import {loadProject} from './lib/project.mjs';
import {defaultMaster, manifestFor, parseFlags, probeVideoInfo} from './lib/qa.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

/** Tile width in px and sheet grid for each kind. */
export const OVERVIEW = {width: 270, cols: 6, rows: 5};
export const PHONE = {width: 360, cols: 5, rows: 3};
export const STRIP = {width: 320, cols: 6, rows: 2};
/** Frames per strip, and how far before t it starts. */
export const STRIP_FRAMES = 12;
export const STRIP_LEAD_SECONDS = 0.1;

const USAGE = '--tag <name> [--in <mp4>] [--strips=<s,...>] [--overview-every=<s>] [--phone-every=<s>]';
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
  const {values} = parseFlags(argv, {values: ['--in', '--tag', '--strips', '--overview-every', '--phone-every'], usage: USAGE});
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
  const input = values.has('--in') ? resolve(root, values.get('--in')) : defaultMaster(root);
  return {input, tag, strips, overviewEvery, phoneEvery};
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
 * The frames nearest k * every seconds, k = 0, 1, 2, ..., below `total`:
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
 * The strips for `seconds` (ascending, deduplicated by name and start frame),
 * in page frames. Each starts at max(0, round((t - 0.1) * fps)) and holds
 * STRIP_FRAMES consecutive frames, cut short at the video's last frame. The
 * video shows page frames first .. first + total - 1; a strip starting outside
 * them is skipped. Returns {strips: [{seconds, name, start, frames, note}], skipped: [{seconds, reason}]}.
 * @param {number[]} seconds
 * @param {number} fps
 * @param {number} total Frames in the video.
 * @param {number} [first] Page frame of the video's first frame (the manifest's firstFrame).
 */
export const stripPlan = (seconds, fps, total, first = 0) => {
  const strips = [];
  const skipped = [];
  const names = new Set();
  const starts = new Set();
  const end = first + total;
  for (const t of [...seconds].sort((a, b) => a - b)) {
    const name = stripName(t);
    const start = Math.max(0, Math.round((t - STRIP_LEAD_SECONDS) * fps));
    if (names.has(name) || starts.has(start)) continue;
    if (start < first) {
      skipped.push({seconds: t, reason: `starts at frame ${start}, before the first rendered frame (${first})`});
      continue;
    }
    if (start >= end) {
      skipped.push({seconds: t, reason: `starts at frame ${start}, after the last frame (${end - 1})`});
      continue;
    }
    names.add(name);
    starts.add(start);
    const stop = Math.min(start + STRIP_FRAMES, end);
    const frames = Array.from({length: stop - start}, (_, k) => start + k);
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
export const selectExpr = (frames) => {
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

/** The sheets critique writes (anything else in a tag directory is the user's and is kept). */
export const SHEET_NAME = /^(overview|phone)_\d+\.png$|^strip_[\d.]+\.png$/;

/**
 * Publish a complete tag directory in one step. `staging` holds every new
 * sheet; the files of an earlier run at `tagDir` that aren't sheets (notes)
 * are copied into it, then the earlier directory is renamed to `aside`, the
 * staging directory renamed to `tagDir`, and `aside` removed. A reader sees
 * the old directory or the new one, never a mix (and, for that instant, none).
 * If the second rename fails the earlier directory is renamed back and the
 * error rethrown. Returns the earlier run's sheets the new one doesn't have.
 * `rename` is renameSync (tests pass one that fails).
 * @param {{staging: string, tagDir: string, aside: string, rename?: (from: string, to: string) => void}} o
 * @returns {string[]}
 */
export const publishTagDir = ({staging, tagDir, aside, rename = renameSync}) => {
  let stale = [];
  const hadOld = existsSync(tagDir);
  if (hadOld) {
    const fresh = new Set(readdirSync(staging));
    for (const f of readdirSync(tagDir)) {
      if (SHEET_NAME.test(f)) {
        if (!fresh.has(f)) stale.push(f);
      } else if (!fresh.has(f)) cpSync(join(tagDir, f), join(staging, f), {recursive: true, preserveTimestamps: true});
    }
    stale = stale.sort();
    rename(tagDir, aside);
  }
  try {
    rename(staging, tagDir);
  } catch (err) {
    if (hadOld) renameSync(aside, tagDir);
    throw err;
  }
  if (hadOld) rmSync(aside, {recursive: true, force: true});
  return stale;
};

/** Tile height for `tileWidth`, keeping the video's aspect ratio. */
const tileHeight = (video, tileWidth) => Math.max(1, Math.round((video.height * tileWidth) / video.width));

/**
 * Write the sheets. Throws a CliError (after cleanup has nothing left to
 * leave behind) when a decode, the sheet builder, or the inputs fail.
 * Returns {dir, sheets: [names], strips, skipped, first}.
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
    pythonBin,
  },
  cleanup,
) => {
  if (!TAG.test(tag)) throw new CliError(`--tag "${tag}" must be one path segment`);
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` or \`pnpm draft\` first (or pass --in).`);
  const python = requireVenvPython(root, pythonBin);

  const explicit = stripSeconds !== null && stripSeconds !== undefined;
  let seconds = stripSeconds;
  if (!explicit) {
    const {project} = loadProject(root);
    seconds = [...project.lyrics.map((l) => l.start), ...project.sections.map((s) => s.start)];
  }
  const video = await probeVideoInfo(ffprobeBin, input);
  const {fps, frames: total} = video;
  const first = manifestFor(input, video)?.firstFrame ?? 0;
  const {strips, skipped} = stripPlan(seconds, fps, total, first);

  // Video frame indices (what ffmpeg's n counts) for each kind; labels show page frames (index + first).
  const kinds = [
    {kind: 'overview', layout: OVERVIEW, frames: cadenceFrames(overviewEvery, fps, total)},
    {kind: 'phone', layout: PHONE, frames: cadenceFrames(phoneEvery, fps, total)},
  ];
  const stripFrames = [...new Set(strips.flatMap((s) => s.frames.map((f) => f - first)))].sort((a, b) => a - b);
  if (stripFrames.length > 0) kinds.push({kind: 'strip', layout: STRIP, frames: stripFrames});

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-critique-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));

  // The output directory: remember the topmost directory at or below
  // out/critique that this run creates, so a failed run removes exactly what it
  // made there. out/ itself, and anything outside out/critique/<tag>, is never removed.
  // The new tag directory is built whole beside it and swapped in by publishTagDir.
  const critiqueDir = join(root, 'out/critique');
  const tagDir = join(critiqueDir, tag);
  const firstCreated = !existsSync(critiqueDir) ? critiqueDir : !existsSync(tagDir) ? tagDir : null;
  let finished = false;
  cleanup.add(() => {
    if (!finished && firstCreated) rmSync(firstCreated, {recursive: true, force: true});
  });
  const staging = join(critiqueDir, `.partial-${tag}-${process.pid}`);
  const aside = join(critiqueDir, `.previous-${tag}-${process.pid}`);
  cleanup.add(() => {
    rmSync(staging, {recursive: true, force: true});
    // Interrupted mid-swap: put the earlier run back.
    if (existsSync(aside) && !existsSync(tagDir)) renameSync(aside, tagDir);
    rmSync(aside, {recursive: true, force: true});
  });
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
    const tile = (v) => ({index: index.get(v), label: formatLabel(v + first, fps)});
    if (kind === 'strip') {
      for (const s of strips) {
        const [sheet] = sheetsOf(s.frames.map((f) => tile(f - first)), layout);
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
  await run(python, [join(scriptsDir, 'critique.py'), job], {label: 'critique.py'});
  for (const {name} of sheets) {
    if (!existsSync(join(staging, name))) throw new CliError(`critique.py did not write ${name}`);
  }

  const stale = publishTagDir({staging, tagDir, aside});
  finished = true;

  const count = (kind) => sheets.filter((s) => s.name.startsWith(`${kind}_`)).length;
  console.log(
    `critique: ${tagDir}: ${count('overview')} overview, ${count('phone')} phone, ${strips.length} strip sheet(s) ` +
      `from ${input} (${total} frames at ${fps} fps${first > 0 ? `, page frames ${first}-${first + total - 1}` : ''})`,
  );
  for (const s of strips) {
    console.log(`  ${s.name}  frames ${s.frames[0]}-${s.frames[s.frames.length - 1]}${s.note ? `  (${s.note})` : ''}`);
  }
  if (explicit) for (const s of skipped) console.log(`  skipped strip at ${s.seconds} s: ${s.reason}`);
  else if (skipped.length > 0) console.log(`  ${skipped.length} line/section start(s) outside frames ${first}-${first + total - 1}: no strip`);
  if (stale.length > 0) console.log(`  removed ${stale.length} sheet(s) left from an earlier run: ${stale.join(', ')}`);
  return {dir: tagDir, sheets: sheets.map((s) => s.name), strips, skipped, first};
};

export const main = (argv, overrides = {}) =>
  runCli('critique', async (cleanup) => {
    await critique({...parseCritiqueArgs(argv, overrides), ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
