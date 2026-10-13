// Shared helpers for the QA scripts (critique, pops, still-test, jitter,
// beatmap): argument parsing in one style, an exact frame count from ffprobe,
// the render manifest sidecar (scripts/lib/outputs.mjs writes it), the default
// inputs, the hold-window frame rule, and the page's own line schedule
// (window.__mv.lines(), read through scripts/capture.py by still_test.py).
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parsePipeline} from '../../src/lib/pipeline.js';
import {capture, CliError} from './cli.mjs';
import {playwrightEnv, PROJECT_ROOT} from './env.mjs';
import {defaultRenderOutput, manifestPath, masterOutput} from './outputs.mjs';
import {readJson} from './project.mjs';

/**
 * Parse `--flag value` / `--flag=value` (each value flag at most once) and bare
 * switches. A value may not start with '-' (so `--max -1` reads as a missing
 * value, never as a negative number). Returns {values: Map, switches: Set}.
 * @param {string[]} argv
 * @param {{values?: string[], switches?: string[], usage: string}} spec
 */
export const parseFlags = (argv, {values: valueFlags = [], switches: switchFlags = [], usage}) => {
  const values = new Map();
  const switches = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (switchFlags.includes(arg)) {
      if (switches.has(arg)) throw new CliError(`${arg} given twice; pass it once`);
      switches.add(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const [name, inline] = eq === -1 ? [arg, null] : [arg.slice(0, eq), arg.slice(eq + 1)];
    if (!valueFlags.includes(name)) throw new CliError(`unexpected argument "${arg}" (use ${usage})`);
    const value = inline ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('-')) throw new CliError(`${name} needs a value`);
    if (values.has(name)) throw new CliError(`${name} given twice; pass it once`);
    values.set(name, value);
  }
  return {values, switches};
};

/**
 * Width, height, frame rate, start time (seconds, 0 when absent) and exact
 * frame count of the first video stream. The count comes from
 * `-count_packets` (one packet per frame; demuxes the file without decoding
 * it), not from duration * fps, which rounds.
 * @param {string} ffprobeBin
 * @param {string} file
 * @returns {Promise<{width: number, height: number, fps: number, frames: number, startTime: number}>}
 */
export const probeVideoInfo = async (ffprobeBin, file) => {
  const out = await capture(
    ffprobeBin,
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,r_frame_rate,start_time,nb_read_packets', '-of', 'json', file],
    {label: 'ffprobe'},
  );
  let stream;
  try {
    stream = JSON.parse(out).streams?.[0];
  } catch {
    stream = undefined;
  }
  const [num, den] = String(stream?.r_frame_rate ?? '').split('/').map(Number);
  const fps = num / (den ?? 1);
  const frames = Number(stream?.nb_read_packets);
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height) || !Number.isFinite(fps) || fps <= 0) {
    throw new CliError(`ffprobe found no video stream with a frame rate in ${file}`);
  }
  if (!Number.isInteger(frames) || frames <= 0) throw new CliError(`ffprobe counted no video frames in ${file}`);
  const startTime = Number(stream.start_time);
  return {width: stream.width, height: stream.height, fps, frames, startTime: Number.isFinite(startTime) ? startTime : 0};
};

/** src/pipeline.json, parsed (outputName and fps for the defaults). */
export const readPipeline = (root = PROJECT_ROOT) => {
  try {
    return parsePipeline(readJson(root, 'src/pipeline.json'));
  } catch (err) {
    throw err instanceof CliError ? err : new CliError(err.message);
  }
};

/** The master video, out/<outputName>.mp4, absolute. */
export const defaultMaster = (root = PROJECT_ROOT) => resolve(root, masterOutput(readPipeline(root).outputName));

/** The text-only render, out/<outputName>-textonly.mp4, absolute. */
export const defaultTextonly = (root = PROJECT_ROOT) => resolve(root, defaultRenderOutput({outputName: readPipeline(root).outputName, textonly: true}));

const isFrame = (v) => Number.isInteger(v) && v >= 0;

/**
 * The manifest sidecar of `video` (<video without .mp4>.manifest.json), or
 * null when there is none. Throws a CliError naming the file when it can't be
 * read or doesn't have the pinned shape. `firstFrame` defaults to 0.
 * @param {string} video
 * @returns {{path: string, fps: number, frames: number, width: number, height: number, scale: number, textonly: boolean,
 *   cuts: number[], blurWindows: {from: number, to: number, samples: number}[], source: string, firstFrame: number} | null}
 */
export const readManifest = (video) => {
  const path = manifestPath(video);
  if (!existsSync(path)) return null;
  let m;
  try {
    m = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError(`${path} could not be read (${err.message})`);
  }
  const bad = (what) => new CliError(`${path}: ${what}`);
  if (m === null || typeof m !== 'object') throw bad('not a JSON object');
  if (!(typeof m.fps === 'number' && m.fps > 0)) throw bad('fps must be a number > 0');
  if (!(Number.isInteger(m.frames) && m.frames > 0)) throw bad('frames must be an integer > 0');
  if (!Array.isArray(m.cuts) || !m.cuts.every(isFrame)) throw bad('cuts must be a list of frame numbers');
  const firstFrame = m.firstFrame ?? 0;
  if (!isFrame(firstFrame)) throw bad('firstFrame must be a frame number');
  return {...m, path, firstFrame, textonly: m.textonly === true, source: typeof m.source === 'string' ? m.source : null};
};

/**
 * The manifest of `video`, checked against the video itself (probeVideoInfo):
 * a sidecar whose frame rate or frame count differs belongs to an earlier
 * render, so it is refused rather than trusted. Null when there is none.
 * @param {string} video
 * @param {{fps: number, frames: number}} info
 */
export const manifestFor = (video, info) => {
  const m = readManifest(video);
  if (m === null) return null;
  if (Math.abs(m.fps - info.fps) > 1e-6 || m.frames !== info.frames) {
    throw new CliError(
      `${m.path} describes ${m.frames} frames at ${m.fps} fps but ${video} has ${info.frames} at ${info.fps}; ` +
        'it belongs to an earlier render (render again, or delete the sidecar)',
    );
  }
  return m;
};

/** manifestFor, or a CliError naming the missing sidecar. */
export const requireManifest = (video, info, why) => {
  const m = manifestFor(video, info);
  if (m === null) throw new CliError(`${manifestPath(video)} doesn't exist (${why}); pnpm render and pnpm draft write it next to the video`);
  return m;
};

/**
 * Times within this many seconds of a frame boundary count as on it (float error in k / fps). The same tolerance
 * the engine uses when it draws a held word (src/engine/text.js T_EPS).
 */
export const HOLD_EPS = 1e-7;

/**
 * The frames of a hold window [settled, exitStart) at `fps`: every n with
 * settled <= n / fps < exitStart, i.e. ceil(settled * fps) .. ceil(exitStart * fps) - 1,
 * with HOLD_EPS of tolerance so a time that is a whole frame up to float error
 * lands on that frame. exitStart null (or Infinity) runs to the last frame;
 * the window is clipped to [0, frames). `count` is 0 for an empty window.
 * @param {number} settled
 * @param {number | null} exitStart
 * @param {number} fps
 * @param {number} frames Total frames of the video.
 * @returns {{first: number, last: number, count: number}}
 */
export const holdRange = (settled, exitStart, fps, frames) => {
  const first = Math.max(0, Math.ceil((settled - HOLD_EPS) * fps));
  const end = exitStart === null || !Number.isFinite(exitStart) ? frames : Math.min(frames, Math.ceil((exitStart - HOLD_EPS) * fps));
  return {first, last: end - 1, count: Math.max(0, end - first)};
};

/**
 * `samples` frames spread evenly over first..last (both included), ascending
 * and distinct: k = 0..samples-1 at first + round(k * (last - first) / (samples - 1)).
 * A window with no more frames than `samples` gives every frame.
 * @param {number} first
 * @param {number} last
 * @param {number} samples At least 2.
 */
export const spreadFrames = (first, last, samples) => {
  const n = last - first + 1;
  if (n <= samples) return Array.from({length: n}, (_, k) => first + k);
  const out = [];
  for (let k = 0; k < samples; k++) {
    const f = first + Math.round((k * (last - first)) / (samples - 1));
    if (out[out.length - 1] !== f) out.push(f);
  }
  return out;
};

/**
 * The page's own line schedule and video info, from a headless page
 * (scripts/still_test.py lines: Capture, textonly, scale 1). `lines` is
 * window.__mv.lines() ({id, first, settled, exitStart, exitEnd, next, words:
 * [{index, text, reveal, settled, exitStart, exitEnd}]}, seconds; a non-finite
 * time comes back as null).
 * @param {{root: string, envRoot?: string, pythonBin: string, scenes?: string | null}} o
 * @returns {Promise<{info: {fps: number, frames: number, width: number, height: number, duration: number},
 *   lines: {id: string, first: number, settled: number, exitStart: number | null, exitEnd: number | null, next: number | null,
 *     words: {index: number, text: string, reveal: number, settled: number, exitStart: number | null, exitEnd: number | null}[]}[]}>}
 */
export const pageLines = async ({root, envRoot = root, pythonBin, scenes = null}) => {
  const args = [join(envRoot, 'scripts/still_test.py'), 'lines', '--root', root];
  if (scenes) args.push('--scenes', scenes);
  const out = await capture(pythonBin, args, {cwd: root, env: playwrightEnv(envRoot), label: 'still_test.py lines'});
  try {
    return JSON.parse(out.trim().split('\n').pop());
  } catch {
    throw new CliError('still_test.py lines printed no schedule');
  }
};
