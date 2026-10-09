// `pnpm contact-sheet [--in <mp4>] [--out <png>] [--columns=<n>]`
//
// One still per section of src/data/sections.json (half a second in, so
// entrances have started), plus one at the midpoint of every long section,
// pulled from the FINAL render with ffmpeg and tiled into one PNG. The legend
// (tile number -> section and time) is printed. Defaults: in =
// out/<pipeline.outputName>.mp4, out = out/contact-sheet.png, 4 columns.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';
import {probeDuration} from './preview.mjs';
import {defaultOutput} from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Seconds after a section's start for its still. */
export const START_OFFSET_SECONDS = 0.5;
/** Sections at least this long also get a still at their midpoint. */
export const LONG_SECTION_SECONDS = 12;
/** Width of one tile in px (height follows the video's aspect ratio). */
export const TILE_WIDTH = 480;
/** How many ffmpeg still extractions run at once. */
const PARALLEL_STILLS = 4;

/**
 * The stills to take: [{label, seconds}] in time order. Each section gets one
 * at min(start + START_OFFSET_SECONDS, its midpoint); sections of
 * LONG_SECTION_SECONDS or more get a second at the midpoint. An empty
 * sections list counts as one section over the whole video. Times stay
 * inside [0, duration).
 */
export const contactSheetTimes = (sections, durationSeconds, fps = 30) => {
  const specs = sections.length > 0 ? sections : [{id: 'song', start: 0}];
  const last = Math.max(0, durationSeconds - 1 / fps);
  const out = [];
  specs.forEach((s, i) => {
    if (s.start >= durationSeconds) return;
    const end = Math.min(specs[i + 1]?.start ?? durationSeconds, durationSeconds);
    const mid = (s.start + end) / 2;
    out.push({label: s.id, seconds: Math.min(s.start + START_OFFSET_SECONDS, mid, last)});
    if (end - s.start >= LONG_SECTION_SECONDS) out.push({label: `${s.id} (middle)`, seconds: Math.min(mid, last)});
  });
  return out;
};

/** `--in`, `--out`, `--columns=<n>`; paths resolve against `root`. */
export const parseContactSheetArgs = (argv, {root = projectRoot} = {}) => {
  let input = null;
  let output = null;
  let columns = 4;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (!['--in', '--out', '--columns'].includes(name)) {
      throw new CliError(`unexpected argument "${arg}" (use --in <mp4>, --out <png>, --columns=<n>)`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('-')) throw new CliError(`${name} needs a value`);
    if (name === '--in') input = value;
    else if (name === '--out') output = value;
    else {
      columns = Number(value);
      if (!Number.isInteger(columns) || columns < 1) throw new CliError(`--columns must be a positive integer (got ${value})`);
    }
  }
  output = resolve(root, output ?? 'out/contact-sheet.png');
  if (!output.endsWith('.png')) throw new CliError(`--out must end in .png (got ${output})`);
  return {input: resolve(root, input ?? defaultOutput(root)), output, columns};
};

/** Section starts from src/data/sections.json ([{id, start}]), minimally checked. */
const readSections = (root) => {
  const raw = JSON.parse(readFileSync(join(root, 'src/data/sections.json'), 'utf8'));
  if (!Array.isArray(raw)) throw new CliError('src/data/sections.json must be an array');
  return raw.map((s, i) => {
    if (typeof s?.id !== 'string' || typeof s?.start !== 'number') {
      throw new CliError(`src/data/sections.json [${i}] needs a string id and a numeric start`);
    }
    return {id: s.id, start: s.start};
  });
};

/**
 * Extract the stills into a temp dir and tile them. The temp dir and the
 * partial PNG are registered in `cleanup` before they can exist; the output
 * only appears once it's complete.
 */
export const contactSheet = async (
  {input, output, columns, root = projectRoot, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', tmpRoot = tmpdir()},
  cleanup,
) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  const {fps} = JSON.parse(readFileSync(join(root, 'src/pipeline.json'), 'utf8'));
  const duration = await probeDuration(ffprobeBin, input);
  const stills = contactSheetTimes(readSections(root), duration, fps);

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-contact-sheet-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  mkdirSync(dirname(output), {recursive: true});
  const partial = join(dirname(output), `.partial-contact-sheet-${process.pid}.png`);
  cleanup.add(() => rmSync(partial, {force: true}));

  const tile = (i) => join(tmp, `tile-${String(i).padStart(3, '0')}.png`);
  for (let from = 0; from < stills.length; from += PARALLEL_STILLS) {
    await Promise.all(
      stills.slice(from, from + PARALLEL_STILLS).map(({seconds}, k) =>
        run(
          ffmpegBin,
          ['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', input, '-frames:v', '1', '-vf', `scale=${TILE_WIDTH}:-2`, tile(from + k)],
          {label: `ffmpeg (still at ${seconds.toFixed(2)} s)`},
        ),
      ),
    );
  }
  const cols = Math.min(columns, stills.length);
  const rows = Math.ceil(stills.length / cols);
  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      '-framerate', '1', '-i', join(tmp, 'tile-%03d.png'),
      '-vf', `tile=${cols}x${rows}:padding=8:margin=8:color=black`,
      '-frames:v', '1', '-update', '1',
      partial,
    ],
    {label: 'ffmpeg (tile)'},
  );
  renameSync(partial, output);
  stills.forEach(({label, seconds}, i) => console.log(`${String(i + 1).padStart(3)}  ${seconds.toFixed(2).padStart(7)} s  ${label}`));
  console.log(`contact-sheet: wrote ${output} (${stills.length} stills, ${cols}x${rows}, left to right, top to bottom)`);
};

export const main = (argv, overrides = {}) =>
  runCli('contact-sheet', async (cleanup) => {
    const args = parseContactSheetArgs(argv, overrides);
    await contactSheet({...args, ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
