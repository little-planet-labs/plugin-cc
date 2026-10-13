// `pnpm pops [--in <mp4>] [--cuts=<frame,...>|auto] [--ratio=3] [--fail]`
//
// Lists pop spikes and one-frame flashes in a rendered video: the glitches a
// viewer sees as a jump or a blink, such as a layer that renders one frame
// early, a transition that lands a frame off, or a stray frame of the wrong shot.
//
// ffmpeg decodes every frame to 180x180 gray (aspect ignored) into a temp
// file; scripts/pops.py (numpy, in the .venv from `pnpm setup:env`)
// computes d[i] = mean |f[i+1] - f[i]| (0..255) and, for each frame n,
// skip[n] = mean |f[n+1] - f[n-1]|. Then:
// - pop at frame i+1 (the frame where the new picture first appears) when
//   d[i] > ratio * max(d[i-1], d[i+1], 0.3) and d[i] > 2. The first and last
//   pairs have only one neighbour and aren't tested.
// - flash at frame n when min(d[n-1], d[n]) > 2 and
//   skip[n] < 0.35 * min(d[n-1], d[n]): frame n differs from both neighbours,
//   which look alike.
// --cuts lists intended hard cuts as frame numbers of the video (the first
// frame of the new shot, the same numbering as a pop); --cuts=auto takes them
// from the render's manifest sidecar (<video>.manifest.json, written by
// pnpm render and pnpm draft; its cuts are video frames too). A pop within
// ±1 frame of a listed cut is reported separately as that cut and doesn't
// count as a finding. Flashes are never excused by a cut: a clean cut can't
// produce one, so a flash next to a cut is a stray frame. --fail exits 1 when
// any pop or flash isn't excused. Frames are the video's; a partial render's
// manifest says which page frame its frame 0 is, and the header prints it.
// Defaults: --in out/<outputName>.mp4, --ratio 3.
import {existsSync, mkdtempSync, realpathSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {requireVenvPython} from './lib/env.mjs';
import {defaultMaster, manifestFor, parseFlags, probeVideoInfo, requireManifest} from './lib/qa.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

/** Side of the square gray frames the differences are measured on, in px. */
export const POP_SIZE = 180;
/** A pop's difference must exceed ratio x its larger neighbour, the neighbour floor at least. */
export const POP_NEIGHBOUR_FLOOR = 0.3;
/** Smallest difference (0..255 mean) that can be a pop or a flash. */
export const POP_MIN_DIFF = 2;
/** A flash's n-1 vs n+1 difference must be under this fraction of its two steps. */
export const FLASH_SKIP_RATIO = 0.35;
/** A pop this many frames or fewer from a listed cut is that cut. */
export const CUT_TOLERANCE_FRAMES = 1;

const USAGE = '[--in <mp4>] [--cuts=<frame,...>|auto] [--ratio=<n>] [--fail]';

/**
 * `--in`, `--cuts`, `--ratio` (as `--flag value` or `--flag=value`, at most
 * once) and the bare `--fail`. `cuts` is a list of frames or 'auto'.
 */
export const parsePopsArgs = (argv, {root = projectRoot} = {}) => {
  const {values, switches} = parseFlags(argv, {values: ['--in', '--cuts', '--ratio'], switches: ['--fail'], usage: USAGE});
  let cuts = [];
  const cutsRaw = values.get('--cuts');
  if (cutsRaw === 'auto') cuts = 'auto';
  else if (cutsRaw !== undefined) {
    cuts = cutsRaw.split(',').map((s) => {
      if (!/^\d+$/.test(s)) throw new CliError(`--cuts must be frame numbers separated by commas, e.g. --cuts=240,612, or auto (got ${cutsRaw})`);
      return Number(s);
    });
  }
  let ratio = 3;
  const ratioRaw = values.get('--ratio');
  if (ratioRaw !== undefined) {
    ratio = Number(ratioRaw);
    if (!/^\d+(\.\d+)?$/.test(ratioRaw) || !(ratio > 1)) throw new CliError(`--ratio must be a number > 1 (got ${ratioRaw})`);
  }
  const input = values.has('--in') ? resolve(root, values.get('--in')) : defaultMaster(root);
  return {input, cuts, ratio, fail: switches.has('--fail')};
};

/**
 * Pops and flashes from the differences (pure). `d[i]` = mean |f[i+1] - f[i]|,
 * `skip[n]` = mean |f[n+1] - f[n-1]| (null at the ends). Returns
 * {pops, flashes, cuts, missedCuts}: pops and flashes not excused by a cut,
 * each {frame, seconds, diff, ...}; `cuts` the pops matched to a listed cut
 * ({frame, cut, ...}); `missedCuts` the listed cuts no pop matched.
 *
 * @param {number[]} d
 * @param {(number | null)[]} skip
 * @param {{fps: number, ratio?: number, cuts?: number[]}} options
 */
export const findPops = (d, skip, {fps, ratio = 3, cuts = []}) => {
  const found = [];
  for (let i = 1; i < d.length - 1; i++) {
    const neighbours = Math.max(d[i - 1], d[i + 1], POP_NEIGHBOUR_FLOOR);
    if (d[i] > ratio * neighbours && d[i] > POP_MIN_DIFF) found.push({frame: i + 1, seconds: (i + 1) / fps, diff: d[i], neighbours});
  }
  const flashes = [];
  for (let n = 1; n < d.length; n++) {
    const step = Math.min(d[n - 1], d[n]);
    const s = skip[n];
    if (s === null || s === undefined) continue;
    if (step > POP_MIN_DIFF && s < FLASH_SKIP_RATIO * step) flashes.push({frame: n, seconds: n / fps, diff: step, skip: s});
  }
  const pops = [];
  const matched = [];
  const used = new Set();
  for (const p of found) {
    const cut = cuts.find((c) => Math.abs(p.frame - c) <= CUT_TOLERANCE_FRAMES);
    if (cut === undefined) pops.push(p);
    else {
      matched.push({...p, cut});
      used.add(cut);
    }
  }
  return {pops, flashes, cuts: matched, missedCuts: cuts.filter((c) => !used.has(c))};
};

const f2 = (v) => v.toFixed(2);

/**
 * Decode, measure, print. Returns findPops' result plus {frames, fps, listedCuts, first}.
 * With `fail`, throws a CliError (exit 1) after printing when any pop or flash
 * isn't excused by a cut.
 *
 * @param {{input: string, cuts?: number[] | 'auto', ratio?: number, fail?: boolean, root?: string, tmpRoot?: string,
 *   ffmpegBin?: string, ffprobeBin?: string, pythonBin?: string}} options
 * @param {Set<() => void>} cleanup
 */
export const pops = async (
  {input, cuts = [], ratio = 3, fail = false, root = projectRoot, tmpRoot = tmpdir(), ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', pythonBin},
  cleanup,
) => {
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Run \`pnpm render\` or \`pnpm draft\` first (or pass --in).`);
  const python = requireVenvPython(root, pythonBin);
  const info = await probeVideoInfo(ffprobeBin, input);
  const {fps} = info;
  const manifest = cuts === 'auto' ? requireManifest(input, info, '--cuts=auto reads the cuts from it') : manifestFor(input, info);
  const listedCuts = cuts === 'auto' ? manifest.cuts : cuts;
  const first = manifest?.firstFrame ?? 0;

  const tmp = mkdtempSync(join(tmpRoot, 'music-video-pops-'));
  cleanup.add(() => rmSync(tmp, {recursive: true, force: true}));
  const raw = join(tmp, 'frames.gray');
  await run(
    ffmpegBin,
    [
      '-v', 'error', '-y',
      '-i', input,
      '-map', '0:v:0',
      '-vf', `scale=${POP_SIZE}:${POP_SIZE}:flags=area,format=gray`,
      '-fps_mode', 'passthrough',
      '-f', 'rawvideo',
      raw,
    ],
    {label: 'ffmpeg'},
  );
  if (!existsSync(raw) || statSync(raw).size < 3 * POP_SIZE * POP_SIZE) throw new CliError(`fewer than 3 frames decoded from ${input}; nothing to compare`);
  const out = await capture(python, [join(scriptsDir, 'pops.py'), raw, '--width', String(POP_SIZE), '--height', String(POP_SIZE)], {label: 'pops.py'});
  const {frames, d, skip} = JSON.parse(out);
  // Every frame must have been measured: a short decode would shift or hide findings near the end.
  if (frames !== info.frames) throw new CliError(`ffmpeg decoded ${frames} frames from ${input} but ffprobe counted ${info.frames}; nothing was checked`);
  const result = findPops(d, skip, {fps, ratio, cuts: listedCuts});

  console.log(`pops: ${input}, ${frames} frames at ${fps} fps, ratio ${ratio}${first > 0 ? ` (video frame 0 is page frame ${first}; frames below are video frames)` : ''}`);
  console.log(`pops (frame = first frame of the new picture): ${result.pops.length}`);
  for (const p of result.pops) console.log(`  frame ${p.frame}  ${f2(p.seconds)} s  diff ${f2(p.diff)}  neighbours ${f2(p.neighbours)}`);
  console.log(`one-frame flashes: ${result.flashes.length}`);
  for (const f of result.flashes) console.log(`  frame ${f.frame}  ${f2(f.seconds)} s  diff ${f2(f.diff)}  n-1 vs n+1 ${f2(f.skip)}`);
  if (cuts === 'auto') console.log(`cuts from ${manifest.path}: ${listedCuts.length === 0 ? 'none' : listedCuts.join(', ')}`);
  if (listedCuts.length > 0) {
    console.log(`intended cuts (±${CUT_TOLERANCE_FRAMES} frame): ${result.cuts.length} of ${listedCuts.length} found`);
    for (const c of result.cuts) console.log(`  cut ${c.cut}: pop at frame ${c.frame}  diff ${f2(c.diff)}`);
    if (result.missedCuts.length > 0) console.log(`  no pop at listed cut(s): ${result.missedCuts.join(', ')}`);
  }
  const findings = result.pops.length + result.flashes.length;
  if (fail && findings > 0) {
    throw new CliError(`${result.pops.length} unexpected pop(s) and ${result.flashes.length} flash(es) found (--fail)`);
  }
  return {...result, frames, fps, listedCuts, first};
};

export const main = (argv, overrides = {}) =>
  runCli('pops', async (cleanup) => {
    await pops({...parsePopsArgs(argv, overrides), ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
