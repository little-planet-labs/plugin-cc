// `pnpm posters`
//
// The cover posters (YouTube thumbnails). src/posters.js is an alternate scene
// registry that also exports POSTERS, the poster list: [{n, slug, frame}, ...]
// (each poster's number, slug and the page frame that draws it). This script
// captures each poster at its frame on the src/pipeline.json page (1920x1080)
// through scripts/capture.py (the same capture path as `pnpm still`),
// lanczos-downscales it to 1280x720 into posters/poster-<n>-<slug>.png, and
// builds two review sheets:
//   posters/posters-sheet.png  every poster at 640 px, 2 across (1 for a single poster)
//   posters/posters-small.png  each poster at 360 px and at 168 px wide
//                              (YouTube's phone and sidebar sizes)
// The list is checked before any browser starts: an empty list, a missing
// src/posters.js, a repeated number, slug or frame, or a frame past the end of
// the video is refused, naming the problem. The page must be 16:9, so the
// 1280x720 posters are never stretched. Intermediates live in a temp dir
// under out/ that is removed on success, failure and SIGINT/SIGTERM. Every
// output is written in the temp dir first and renamed into posters/ only
// once all of them are complete; at that point any posters/poster-*.png the
// new list doesn't name (a poster since removed or renamed) is deleted, so
// posters/ always holds exactly the current list and the two sheets. Only
// the script's own poster-<n>-<slug>.png names are touched.
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateRegistry} from '../src/lib/registry.js';
import {CliError, run, runCli} from './lib/cli.mjs';
import {playwrightEnv} from './lib/env.mjs';
import {loadProject} from './lib/project.mjs';
import {requireCaptureEnv} from './still.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The poster registry, project-relative: SCENES, DEFAULT_SCENE and POSTERS. */
export const POSTER_SCENES = 'src/posters.js';

/** A poster slug: lowercase words of letters and digits joined by single hyphens. */
export const POSTER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Output file name of a poster. */
export const posterFile = ({n, slug}) => `poster-${n}-${slug}.png`;

/** Every name posterFile can produce: the only files in posters/ this script ever deletes. */
export const POSTER_FILE = /^poster-[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;

/**
 * The poster files in `names` (a posters/ listing) that `list` no longer names: poster-<n>-<slug>.png
 * names only (POSTER_FILE), so the sheets and any other file are never stale. Pure.
 * @param {string[]} names
 * @param {{n: number, slug: string}[]} list
 */
export const stalePosters = (names, list) => {
  const keep = new Set(list.map(posterFile));
  return names.filter((name) => POSTER_FILE.test(name) && !keep.has(name)).sort();
};

/** Poster size (YouTube's recommended thumbnail) and the review sizes. */
export const POSTER_SIZE = {width: 1280, height: 720};
export const SMALL_WIDTHS = [360, 168];

/** The overview sheet's grid for `count` posters: 2 columns (1 for a single poster), as many rows as needed. */
export const sheetGrid = (count) => {
  const columns = Math.min(2, count);
  return {columns, rows: Math.ceil(count / columns)};
};

/**
 * Validate src/posters.js's POSTERS (pure): a non-empty list of {n, slug, frame}, n a positive integer, slug
 * POSTER_SLUG, frame a whole page frame inside the video (0 .. frames - 1); no number, slug or frame twice.
 * Returns the entries as {n, slug, frame}, in list order. Throws a CliError naming the entry.
 * @param {unknown} posters
 * @param {{frames: number}} video
 * @returns {{n: number, slug: string, frame: number}[]}
 */
export const parsePosters = (posters, {frames}) => {
  if (!Array.isArray(posters)) throw new CliError(`${POSTER_SCENES} must export POSTERS, a list of {n, slug, frame} (got ${JSON.stringify(posters)})`);
  if (posters.length === 0) {
    throw new CliError(`${POSTER_SCENES} lists no posters (POSTERS is empty): add one {n, slug, frame} entry per poster, then run pnpm posters again`);
  }
  const seen = {n: new Set(), slug: new Set(), frame: new Set()};
  return posters.map((p, i) => {
    const at = `${POSTER_SCENES}: POSTERS[${i}]`;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new CliError(`${at} must be {n, slug, frame} (got ${JSON.stringify(p)})`);
    const {n, slug, frame} = p;
    if (!(Number.isInteger(n) && n >= 1)) throw new CliError(`${at}.n must be a whole number >= 1 (got ${JSON.stringify(n)})`);
    if (typeof slug !== 'string' || !POSTER_SLUG.test(slug)) {
      throw new CliError(`${at}.slug must be lowercase letters and digits joined by single hyphens, e.g. "title-card" (got ${JSON.stringify(slug)})`);
    }
    if (!(Number.isInteger(frame) && frame >= 0)) throw new CliError(`${at}.frame must be a whole page frame >= 0 (got ${JSON.stringify(frame)})`);
    if (frame >= frames) throw new CliError(`${at}.frame ${frame} is past the end of the video (frames 0..${frames - 1})`);
    for (const [key, value] of Object.entries({n, slug, frame})) {
      if (seen[key].has(value)) throw new CliError(`${at}.${key} ${JSON.stringify(value)} is used by another poster; each poster needs its own`);
      seen[key].add(value);
    }
    return {n, slug, frame};
  });
};

/** `pnpm posters` takes no arguments. */
export const parsePostersArgs = (argv) => {
  if (argv.length > 0) throw new CliError(`unexpected argument "${argv[0]}" (pnpm posters takes no arguments; the poster list is POSTERS in ${POSTER_SCENES})`);
  return {};
};

/** How many times loadPosters has imported src/posters.js in this process (its cache-busting query). */
let registryLoads = 0;

/**
 * The poster list and registry of the project at `root`, checked (no browser): src/posters.js imported in Node,
 * validateRegistry, POSTERS parsed against the video's frame count, and a 16:9 page.
 * @param {string} root
 */
export const loadPosters = async (root) => {
  const {pipeline, project} = loadProject(root);
  if (pipeline.width * POSTER_SIZE.height !== pipeline.height * POSTER_SIZE.width) {
    throw new CliError(`posters are 16:9 (${POSTER_SIZE.width}x${POSTER_SIZE.height}) but the src/pipeline.json page is ${pipeline.width}x${pipeline.height}`);
  }
  const file = join(root, POSTER_SCENES);
  if (!existsSync(file)) throw new CliError(`${POSTER_SCENES} doesn't exist: it holds the poster list (POSTERS) and the poster scenes`);
  let mod;
  try {
    // A fresh import every call (the query defeats the module cache), so a list edited since an earlier call
    // in the same process is read again.
    mod = await import(`${pathToFileURL(file).href}?load=${++registryLoads}`);
  } catch (err) {
    throw new CliError(`${POSTER_SCENES} failed to load in Node: ${err.message}`);
  }
  try {
    validateRegistry(mod, POSTER_SCENES);
  } catch (err) {
    throw new CliError(err.message);
  }
  return parsePosters(mod.POSTERS, {frames: project.frames});
};

export const posters = async ({root = projectRoot, envRoot = root, ffmpegBin = 'ffmpeg', pythonBin} = {}, cleanup) => {
  const list = await loadPosters(root);
  const python = pythonBin ?? requireCaptureEnv(envRoot);
  const outDir = join(root, 'posters');
  mkdirSync(join(root, 'out'), {recursive: true});
  let tmp = null;
  cleanup.add(() => tmp && rmSync(tmp, {recursive: true, force: true}));
  tmp = mkdtempSync(join(root, 'out', '.posters-'));
  const ff = (args, label) => run(ffmpegBin, ['-loglevel', 'error', '-y', ...args], {label});

  // 1. Capture every poster at 1920x1080 in one browser session.
  await run(
    python,
    [join(envRoot, 'scripts/capture.py'), '--root', root, '--scale', '1', '--scenes', POSTER_SCENES, '--frames', list.map((p) => p.frame).join(','), '--out-dir', tmp],
    {cwd: root, env: playwrightEnv(envRoot), label: 'capture'},
  );
  const capture = (p) => join(tmp, `frame-${String(p.frame).padStart(6, '0')}.png`);

  // 2. Downscale each to 1280x720 (lanczos). Numbered copies feed the sheets.
  const finals = join(tmp, 'final');
  mkdirSync(finals);
  for (const [i, p] of list.entries()) {
    await ff(['-i', capture(p), '-vf', `scale=${POSTER_SIZE.width}:${POSTER_SIZE.height}:flags=lanczos`, '-update', '1', join(finals, posterFile(p))], `ffmpeg (poster ${p.n})`);
    copyFileSync(join(finals, posterFile(p)), join(tmp, `seq-${i + 1}.png`));
  }

  // 3. The overview sheet: 640 px tiles, 2 across, white gutters.
  const grid = sheetGrid(list.length);
  await ff(
    [
      '-framerate', '1', '-start_number', '1', '-i', join(tmp, 'seq-%d.png'),
      '-vf', `scale=640:-1,tile=${grid.columns}x${grid.rows}:padding=12:color=white`, '-frames:v', '1', '-update', '1', join(finals, 'posters-sheet.png'),
    ],
    'ffmpeg (sheet)',
  );

  // 4. The small-size sheet: each poster at 360 px and 168 px, in 380x212 white cells, two columns.
  const columns = [];
  for (const w of SMALL_WIDTHS) {
    for (let i = 1; i <= list.length; i++) {
      await ff(['-i', join(tmp, `seq-${i}.png`), '-vf', `scale=${w}:-1:flags=lanczos,pad=380:212:10:6:white`, '-update', '1', join(tmp, `w${w}-${i}.png`)], `ffmpeg (${w} px tile ${i})`);
    }
    const col = join(tmp, `col${w}.png`);
    await ff(['-framerate', '1', '-start_number', '1', '-i', join(tmp, `w${w}-%d.png`), '-frames:v', '1', '-vf', `tile=1x${list.length}`, '-update', '1', col], `ffmpeg (${w} px column)`);
    columns.push(col);
  }
  await ff(['-i', columns[0], '-i', columns[1], '-filter_complex', 'hstack', '-update', '1', join(finals, 'posters-small.png')], 'ffmpeg (small sheet)');

  // 5. Everything is complete: drop the posters the list no longer names, then move the new set into posters/.
  mkdirSync(outDir, {recursive: true});
  const stale = stalePosters(readdirSync(outDir), list);
  for (const name of stale) {
    rmSync(join(outDir, name), {force: true});
    console.log(`posters: removed ${relative(process.cwd(), join(outDir, name)) || name} (not in POSTERS)`);
  }
  const names = [...list.map(posterFile), 'posters-sheet.png', 'posters-small.png'];
  for (const name of names) renameSync(join(finals, name), join(outDir, name));
  for (const name of names) console.log(`posters: wrote ${relative(process.cwd(), join(outDir, name)) || name}`);
  return {files: names.map((n) => join(outDir, n)), removed: stale.map((n) => join(outDir, n))};
};

export const main = (argv, overrides = {}) =>
  runCli('posters', async (cleanup) => {
    parsePostersArgs(argv);
    await posters(overrides, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
