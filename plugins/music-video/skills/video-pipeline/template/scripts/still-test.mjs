// `pnpm still-test [--scale=2] [--lines=<id,...>] [--samples=3] [--scenes=<module>]`
//
// Held-text pixel check on the engine itself (no render needed): for every
// word of every lyric line, capture frames across the word's own hold window,
// the frames n with settled <= n / fps < exitStart in the page's own schedule
// (window.__mv.lines()[i].words), i.e. ceil(settled * fps) .. ceil(exitStart * fps) - 1,
// and compare them pixel for pixel. Once a word has settled it must not move,
// scale, blur or fade until its exit starts, so ANY nonzero difference is
// motion. Words are checked one by one because a line's words settle and
// leave at different times: a line whose last word settles after its first
// word starts to leave has no line-wide hold, but each word is still held.
//
// The page runs in text-only mode (world, fx and overlay layers draw nothing
// on black; the lyric layer as usual) at device scale --scale (default 2, so
// sub-pixel creep shows), through scripts/capture.py's Capture, each frame
// captured exactly as the render captures it. While a word is captured,
// every other line and every other word of its line is hidden (an injected
// visibility rule), so a paired line entering or a neighbour leaving never
// counts against it. Per word, --samples frames (default 3: the first, middle
// and last frame of its window) spread evenly over the window, or every frame
// of a shorter window.
//
// Prints a row per line (words checked, largest channel difference 0..255,
// most changed pixels, and every word that moved), the skipped words with the
// reason (a window shorter than 2 frames, or nothing drawn in any of its
// sampled frames), the words that never settle before their exit starts, and
// "lines with motion during hold: N". Exits 1 when N > 0, and when no word
// could be checked at all (a check of nothing is not a pass). --lines limits
// the check to those line ids. Needs `pnpm setup:env`; launches Chromium
// twice (once at scale 1 to read the schedule, once to capture).
import {existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateScenesPath} from '../src/lib/registry.js';
import {capture, CliError, runCli} from './lib/cli.mjs';
import {playwrightEnv, requireVenvPython} from './lib/env.mjs';
import {loadProject} from './lib/project.mjs';
import {holdRange, pageLines, parseFlags, spreadFrames} from './lib/qa.mjs';
import {requireCaptureEnv} from './still.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = '[--scale=<s>] [--lines=<id,...>] [--samples=<n>] [--scenes=<module>]';
/** The scene registry the page loads without --scenes. */
export const DEFAULT_SCENES = 'src/scenes/index.js';

/**
 * `--scale` (default 2), `--lines` (null: every line), `--samples` (default 3,
 * at least 2), `--scenes` (null: src/scenes/index.js).
 * @param {string[]} argv
 */
export const parseStillTestArgs = (argv) => {
  const {values} = parseFlags(argv, {values: ['--scale', '--lines', '--samples', '--scenes'], usage: USAGE});
  let scale = 2;
  if (values.has('--scale')) {
    const raw = values.get('--scale');
    scale = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || !(scale > 0)) throw new CliError(`--scale must be a number > 0 (got ${raw})`);
  }
  let samples = 3;
  if (values.has('--samples')) {
    const raw = values.get('--samples');
    samples = Number(raw);
    if (!/^\d+$/.test(raw) || samples < 2) throw new CliError(`--samples must be a whole number of frames, at least 2 (got ${raw})`);
  }
  let lines = null;
  if (values.has('--lines')) {
    lines = values.get('--lines').split(',');
    if (lines.some((id) => id === '')) throw new CliError(`--lines must be line ids separated by commas (got ${values.get('--lines')})`);
  }
  let scenes = null;
  if (values.has('--scenes')) {
    try {
      scenes = validateScenesPath(values.get('--scenes'));
    } catch (err) {
      throw new CliError(err.message);
    }
  }
  return {scale, lines, samples, scenes};
};

const secs = (t) => (t === null ? 'never' : `${t.toFixed(3)} s`);
/** "word 2 "text"" (1-based). */
export const wordName = (w) => `word ${w.word + 1} "${w.text}"`;

/**
 * Which frames to capture for each word (pure). Returns {checks: [{id, word,
 * text, first, last, count, frames}], skipped: [{id, word, text, reason}],
 * neverSettles: [{id, word, text, settled, exitStart}]}: a word is checked
 * when its own hold window (holdRange of its settled .. exitStart) has at
 * least 2 frames; a word whose exit starts at or before it settles is never
 * held (neverSettles); any other shorter window is skipped with its reason.
 * @param {{id: string, words: {index: number, text: string, settled: number, exitStart: number | null}[]}[]} lines
 * @param {{fps: number, frames: number, samples: number}} o
 */
export const stillTestPlan = (lines, {fps, frames, samples}) => {
  const checks = [];
  const skipped = [];
  const neverSettles = [];
  for (const line of lines) {
    for (const w of line.words) {
      const at = {id: line.id, word: w.index, text: w.text};
      if (w.exitStart !== null && w.exitStart <= w.settled) {
        neverSettles.push({...at, settled: w.settled, exitStart: w.exitStart});
        continue;
      }
      const r = holdRange(w.settled, w.exitStart, fps, frames);
      if (r.count < 2) {
        const span = r.count === 0 ? `hold window ${secs(w.settled)} to ${secs(w.exitStart)} holds no frame` : `hold window ${r.first}-${r.last} is 1 frame`;
        skipped.push({...at, reason: `${span} (shorter than 2 frames)`});
        continue;
      }
      checks.push({...at, first: r.first, last: r.last, count: r.count, frames: spreadFrames(r.first, r.last, samples)});
    }
  }
  return {checks, skipped, neverSettles};
};

const sameSchedule = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Run the check and print the report. Returns {info, lines, checked, skipped,
 * neverSettles, moving, movingWords}: `checked` [{id, word, text, first, last,
 * count, frames, maxDiff, changed, lit, litFirst, diffs}], `skipped` [{id, word,
 * text, reason}], `moving` the line ids with a word that changed, `movingWords`
 * those words. Throws a CliError (exit 1, with the result as `.result`) after
 * printing when a word moved or nothing was checked.
 * @param {ReturnType<typeof parseStillTestArgs>} opts
 * @param {Set<() => void>} cleanup
 * @param {{root?: string, envRoot?: string, pythonBin?: string, tmpRoot?: string}} [o]
 *   envRoot: where scripts/, .venv and .cache live (the project itself, except in tests).
 */
export const stillTest = async (opts, cleanup, {root = projectRoot, envRoot = root, pythonBin, tmpRoot = tmpdir()} = {}) => {
  loadProject(root); // the data must be valid before a browser starts; its errors name the file
  const scenes = opts.scenes ?? DEFAULT_SCENES;
  if (!existsSync(join(root, scenes))) throw new CliError(`scene registry ${scenes} doesn't exist`);
  const python = pythonBin ? requireVenvPython(envRoot, pythonBin) : requireCaptureEnv(envRoot);

  const page = await pageLines({root, envRoot, pythonBin: python, scenes: opts.scenes});
  const {fps, frames} = page.info;
  if (page.lines.some((l) => !Array.isArray(l.words))) throw new CliError("window.__mv.lines() has no word schedules; the engine is older than still-test");
  let lines = page.lines;
  if (opts.lines) {
    const known = new Set(lines.map((l) => l.id));
    const unknown = opts.lines.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new CliError(`--lines: no registered lyric line ${unknown.map((id) => `"${id}"`).join(', ')} (known: ${[...known].join(', ') || 'none'})`);
    lines = lines.filter((l) => opts.lines.includes(l.id));
  }
  const plan = stillTestPlan(lines, {fps, frames, samples: opts.samples});
  const skipped = [...plan.skipped];

  let results = [];
  if (plan.checks.length > 0) {
    const tmp = mkdtempSync(join(tmpRoot, 'music-video-still-test-'));
    cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
    const planFile = join(tmp, 'plan.json');
    writeFileSync(planFile, JSON.stringify({scale: opts.scale, scenes: opts.scenes, checks: plan.checks.map(({id, word, frames: f}) => ({id, word, frames: f}))}));
    const out = await capture(python, [join(envRoot, 'scripts/still_test.py'), 'check', '--root', root, '--plan', planFile], {
      cwd: root,
      env: playwrightEnv(envRoot),
      label: 'still_test.py check',
    });
    let checked;
    try {
      checked = JSON.parse(out.trim().split('\n').pop());
    } catch {
      throw new CliError('still_test.py check printed no results');
    }
    if (!sameSchedule(checked.lines, page.lines)) throw new CliError("the page's line schedule changed between two loads; the page isn't deterministic");
    results = checked.results;
    const key = (c) => `${c.id}:${c.word}:${c.frames.join(',')}`;
    if (results.map(key).join(' ') !== plan.checks.map(key).join(' ')) throw new CliError('still_test.py checked other frames than planned');
  }

  // A word is blank only when nothing is drawn in ANY of its sampled frames; a word that is blank on its first
  // hold frame and drawn later has changed during its hold, so its difference is motion, never a skip.
  const checked = [];
  plan.checks.forEach((c, i) => {
    const r = results[i];
    if (r.lit === 0) skipped.push({id: c.id, word: c.word, text: c.text, reason: `nothing drawn in hold frames ${c.first}-${c.last} (no lit pixel on the text-only page)`});
    else checked.push({...c, maxDiff: r.maxDiff, changed: r.changed, lit: r.lit, litFirst: r.litFirst, diffs: r.diffs});
  });
  const movingWords = checked.filter((w) => w.maxDiff > 0);
  const moving = [...new Set(movingWords.map((w) => w.id))];
  const linesChecked = [...new Set(checked.map((w) => w.id))];
  const wordCount = lines.reduce((n, l) => n + l.words.length, 0);

  console.log(
    `still-test: ${root}, scale ${opts.scale}, text-only, scenes ${scenes}; ${lines.length} line(s), ${wordCount} word(s), ` +
      `${opts.samples} sample(s) per held word, ${fps} fps`,
  );
  console.log(`${'line'.padEnd(22)} ${'words held'.padEnd(11)} ${'max diff'.padStart(8)} ${'changed px'.padStart(10)}`);
  for (const id of linesChecked) {
    const ws = checked.filter((w) => w.id === id);
    const total = lines.find((l) => l.id === id).words.length;
    const moved = ws.filter((w) => w.maxDiff > 0).map((w) => {
      const d = w.diffs.find((x) => x.maxDiff > 0);
      return `${wordName(w)} (frames ${w.first}-${w.last}: frame ${d.frame} differs from ${w.frames[0]})`;
    });
    console.log(
      `${id.padEnd(22)} ${`${ws.length}/${total}`.padEnd(11)} ${String(Math.max(...ws.map((w) => w.maxDiff))).padStart(8)} ` +
        `${String(Math.max(...ws.map((w) => w.changed))).padStart(10)}${moved.length > 0 ? `  MOTION: ${moved.join('; ')}` : ''}`,
    );
  }
  for (const s of skipped) console.log(`skipped ${s.id} ${wordName(s)}: ${s.reason}`);
  for (const n of plan.neverSettles) {
    console.log(`never settles before its exit: ${n.id} ${wordName(n)} (settles at ${secs(n.settled)}, exit starts at ${secs(n.exitStart)})`);
  }
  console.log(
    `lines with motion during hold: ${moving.length} (${checked.length} word(s) checked in ${linesChecked.length} line(s); ` +
      `${skipped.length} skipped; ${plan.neverSettles.length} never settle before their exit)`,
  );

  const result = {info: page.info, lines: page.lines, checked, skipped, neverSettles: plan.neverSettles, moving, movingWords};
  const fail = (message) => Object.assign(new CliError(message), {result});
  if (movingWords.length > 0) {
    throw fail(`${movingWords.length} word(s) in ${moving.length} line(s) changed during their hold: ${movingWords.map((w) => `${w.id} ${wordName(w)}`).join(', ')}`);
  }
  if (checked.length === 0) throw fail('no word was checked: none has a hold window of 2 frames or more with something drawn');
  return result;
};

export const main = (argv, overrides = {}) =>
  runCli('still-test', async (cleanup) => {
    await stillTest(parseStillTestArgs(argv), cleanup, overrides);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
