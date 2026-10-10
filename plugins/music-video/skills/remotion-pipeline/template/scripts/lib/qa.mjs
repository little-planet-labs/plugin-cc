// Shared helpers for the QA scripts (critique, pops, beatmap, jitter
// --all-lines): an exact frame count from ffprobe, and the src/data/*.json
// readers. The readers reuse the composition's own validators
// (src/lib/*.ts, loaded through Node's built-in type stripping, Node >= 22.18),
// so a script and the render can't disagree about what the data means.
import {readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {capture, CliError} from './cli.mjs';

/**
 * Width, height, frame rate, start time (seconds, 0 when absent) and exact
 * frame count of the first video stream.
 * The count comes from `-count_packets` (one packet per frame; demuxes the
 * file without decoding it), not from duration * fps, which rounds.
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

const readJson = (root, rel) => {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (err) {
    throw new CliError(`can't read ${rel}: ${err.message}`);
  }
};

/** Validate with one of src/lib's parsers; its message (which names the problem) becomes a CliError. */
const validated = async (rel, raw, modulePath, exportName) => {
  const mod = await import(modulePath);
  try {
    return mod[exportName](raw);
  } catch (err) {
    // The parsers' messages already name the file (e.g. "lyrics.json: [3].id ...").
    throw new CliError(err.message.includes(basename(rel)) ? err.message : `${rel}: ${err.message}`);
  }
};

/** src/data/lyrics.json through src/lib/lyrics-schema.ts parseLyrics. */
export const readLyrics = (root) => validated('src/data/lyrics.json', readJson(root, 'src/data/lyrics.json'), '../../src/lib/lyrics-schema.ts', 'parseLyrics');

/** src/data/sections.json through src/lib/sections.ts parseSections. */
export const readSections = (root) => validated('src/data/sections.json', readJson(root, 'src/data/sections.json'), '../../src/lib/sections.ts', 'parseSections');

/** src/data/audio-analysis.json through src/lib/analysis-schema.ts parseAudioAnalysis. */
export const readAnalysis = (root) =>
  validated('src/data/audio-analysis.json', readJson(root, 'src/data/audio-analysis.json'), '../../src/lib/analysis-schema.ts', 'parseAudioAnalysis');

/** `lineWords` from src/lib/lyric-timing.ts: aligned word timings, or the estimate the hooks use. */
export const loadLineWords = async () => (await import('../../src/lib/lyric-timing.ts')).lineWords;
