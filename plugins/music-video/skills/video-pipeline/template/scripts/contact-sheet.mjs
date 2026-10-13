// `pnpm contact-sheet [--in <mp4>] [--out <png>] [--columns=<n>]`
//
// One still per section (half a second in, so entrances have started), plus
// one at the middle of every long section, pulled from the FINAL video with
// ffmpeg and tiled into one PNG. The sections are the project's placed
// sections (scripts/lib/project.mjs, the same frame ranges the page uses). The
// legend (tile number -> time and section) is printed. Defaults: in =
// out/<outputName>.mp4, out = out/contact-sheet.png, 4 columns.
//
// A render of part of the video (pnpm render --frames=a-b) has a manifest
// saying which page frame its first frame shows; the sheet then covers only
// the sections in that range, at the right frames. Without a manifest the
// video is taken to start at frame 0.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';
import {probeDuration} from './lib/encode.mjs';
import {manifestPath, masterOutput} from './lib/outputs.mjs';
import {loadProject} from './lib/project.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Seconds after a section's start for its still. */
export const START_OFFSET_SECONDS = 0.5;
/** Sections at least this long also get a still at their midpoint. */
export const LONG_SECTION_SECONDS = 12;
/** Width of one tile in px (height follows the video's aspect ratio). */
export const TILE_WIDTH = 480;
/** How many ffmpeg still extractions run at once. */
const PARALLEL_STILLS = 2;

/**
 * The stills to take: [{label, frame}] in time order, `frame` being the page
 * frame (video frame + first). Each section, clipped to the video's frames
 * [first, first + frames), gets one still at min(start + START_OFFSET_SECONDS,
 * its middle frame); a clipped section of LONG_SECTION_SECONDS or more gets a
 * second at its middle frame. Sections outside the video are skipped.
 * @param {{id: string, from: number, to: number}[]} sections Placed sections (frames).
 * @param {{fps: number, first?: number, frames: number}} video
 * @returns {{label: string, frame: number}[]}
 */
export const contactSheetFrames = (sections, {fps, first = 0, frames}) => {
  const end = first + frames;
  const offset = Math.round(START_OFFSET_SECONDS * fps);
  const out = [];
  for (const s of sections) {
    const a = Math.max(s.from, first);
    const b = Math.min(s.to, end);
    if (b <= a) continue;
    const mid = Math.floor((a + b) / 2);
    out.push({label: s.id, frame: Math.min(a + offset, mid)});
    if (b - a >= LONG_SECTION_SECONDS * fps) out.push({label: `${s.id} (middle)`, frame: mid});
  }
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
  if (!/\.png$/i.test(output)) throw new CliError(`--out must end in .png (got ${output})`);
  return {input: input === null ? null : resolve(root, input), output, columns};
};

/** Which page frames the video holds: from its manifest, else frame 0 for its probed duration. */
const videoSpan = async (input, fps, ffprobeBin) => {
  const sidecar = manifestPath(input);
  if (existsSync(sidecar)) {
    let m;
    try {
      m = JSON.parse(readFileSync(sidecar, 'utf8'));
    } catch (err) {
      throw new CliError(`${sidecar} is not valid JSON: ${err.message}`);
    }
    if (m.fps !== fps || !Number.isInteger(m.frames) || m.frames < 1) throw new CliError(`${sidecar} doesn't match this project (fps ${m.fps}, frames ${m.frames})`);
    return {first: Number.isInteger(m.firstFrame) ? m.firstFrame : 0, frames: m.frames};
  }
  return {first: 0, frames: Math.max(1, Math.round((await probeDuration(ffprobeBin, input)) * fps))};
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
  const {pipeline, project} = loadProject(root);
  const file = input ?? resolve(root, masterOutput(pipeline.outputName));
  if (!existsSync(file)) throw new CliError(`${file} doesn't exist. Run \`pnpm render\` first (or pass --in).`);
  const {fps} = project;
  const span = await videoSpan(file, fps, ffprobeBin);
  const stills = contactSheetFrames(project.sections, {fps, ...span});
  if (stills.length === 0) throw new CliError(`no section falls inside ${file}`);

  let tmp = null;
  cleanup.add(() => tmp && rmSync(tmp, {recursive: true, force: true}));
  tmp = mkdtempSync(join(tmpRoot, 'music-video-contact-sheet-'));
  mkdirSync(dirname(output), {recursive: true});
  const partial = join(dirname(output), `.partial-contact-sheet-${process.pid}.png`);
  cleanup.add(() => rmSync(partial, {force: true}));

  const tile = (i) => join(tmp, `tile-${String(i).padStart(3, '0')}.png`);
  for (let from = 0; from < stills.length; from += PARALLEL_STILLS) {
    await Promise.all(
      stills.slice(from, from + PARALLEL_STILLS).map(({frame}, k) => {
        // A quarter frame before the frame's timestamp: the decoder skips everything earlier, so exactly this frame comes out.
        const seek = Math.max(0, (frame - span.first - 0.25) / fps);
        return run(
          ffmpegBin,
          ['-v', 'error', '-y', '-ss', seek.toFixed(6), '-i', file, '-frames:v', '1', '-vf', `scale=${TILE_WIDTH}:-2`, tile(from + k)],
          {label: `ffmpeg (still at frame ${frame})`},
        );
      }),
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
  stills.forEach(({label, frame}, i) =>
    console.log(`${String(i + 1).padStart(3)}  ${(frame / fps).toFixed(2).padStart(7)} s  frame ${String(frame).padStart(6)}  ${label}`),
  );
  console.log(`contact-sheet: wrote ${relative(process.cwd(), output) || output} (${stills.length} stills, ${cols}x${rows}, left to right, top to bottom)`);
  return {stills, output};
};

export const main = (argv, overrides = {}) =>
  runCli('contact-sheet', async (cleanup) => {
    const args = parseContactSheetArgs(argv, overrides);
    await contactSheet({...args, ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
