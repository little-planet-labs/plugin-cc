// `pnpm clips [--pipeline=<config>] [--clips <json>] [--in <mp4>] [--out-dir <dir>]`
//
// Short clips cut from a finished render, for social posts. The clip list
// names each clip by slug with a start and an end in song seconds; each is
// written to <out-dir>/<outputName>-<slug>.mp4 (default out/clips/), plus
// <out-dir>/<outputName>-clips.manifest.json listing every clip with its frame
// range and duration (one manifest per config, so two configs can share the
// folder). Defaults follow the config (--pipeline, default src/pipeline.json):
// --in its master (out/<outputName>.mp4) and --clips its own list,
// src/clips.<name>.json for src/pipeline.<name>.json (src/clips.json for
// src/pipeline.json); without --clips a config with no list is refused. The
// vertical clips are `pnpm clips --pipeline=src/pipeline.vertical.json`
// (src/clips.vertical.json).
//
// The clip list:
//   {"$comment"?, "fadeIn"?: s, "fadeOut"?: s,
//    "clips": [{"slug", "start", "end", "fadeIn"?, "fadeOut"?, "note"?, "$comment"?}, ...]}
// start and end are seconds of the song (= of the master: a full render's
// frame n is song frame n); each is snapped to the nearest whole frame at the
// config's fps (Math.round(seconds * fps), the rounding the sections use), so
// a clip that starts on a section's start time starts on that section's first
// frame. The clip is frames [start, end): end is the first frame NOT in it.
// fadeIn / fadeOut are audio fades in seconds (defaults 0.15 and 0.4; the
// file's top-level values replace the defaults, a clip's own replace those),
// so neither cut point pops. The picture has hard cuts at both ends, no fades.
//
// Every clip is re-encoded, frame-exactly: ffmpeg decodes the master from its
// first frame, keeps frames [start, end) by frame number (trim start_frame /
// end_frame) and the audio samples [start, end) * 48000 / fps by sample number
// (fps divides 48000, src/lib/pipeline.js), and encodes H.264 High yuv420p
// BT.709 (CRF 18, the master's level rule) at a constant fps, with AAC
// 256 kbit/s 48 kHz and +faststart. The MP4's movie timescale is 48000 so the
// audio edit list is sample-exact. Each clip is checked before anything is
// published: exactly end - start frames, r_frame_rate and avg_frame_rate
// fps/1, the master's size, an audio stream whose duration is the video's to
// within AUDIO_TOLERANCE_SECONDS.
//
// Refused: a start not before its end (after snapping), an end past the
// master's last frame, a master at another fps than the config, a partial
// render (its manifest's firstFrame isn't 0, so its frames aren't song
// frames), a master without audio, and any output that is a config's master
// or the input. Clips and the manifest are written into a temp folder inside
// the output folder and renamed into place only when every clip has passed;
// the temp folder is removed on success, failure and SIGINT/SIGTERM.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {PIPELINE_PATH} from '../src/lib/pipeline.js';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {BT709_FRAME_TAGS, probeVideo, x264Args} from './lib/encode.mjs';
import {refuseMasters, samePath} from './lib/outputs.mjs';
import {knownMasters, readPipelineAt} from './lib/project.mjs';
import {defaultMaster, manifestFor, parseFlags, probeVideoInfo, qaInput} from './lib/qa.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where clips go without --out-dir. */
export const DEFAULT_CLIPS_DIR = 'out/clips';

/**
 * A config's own clip list, the default --clips: src/clips.<name>.json for src/pipeline.<name>.json,
 * src/clips.json for src/pipeline.json.
 * @param {string} pipelinePath A path validatePipelinePath accepts.
 */
export const clipListFor = (pipelinePath) => {
  const name = PIPELINE_PATH.exec(pipelinePath)?.[1];
  return name === undefined ? 'src/clips.json' : `src/clips.${name}.json`;
};

/** The manifest written next to a config's clips: <outputName>-clips.manifest.json. */
export const clipsManifestName = (outputName) => `${outputName}-clips.manifest.json`;
/** Audio fades, seconds, when neither the clip nor the file sets one. */
export const DEFAULT_FADE_IN = 0.15;
export const DEFAULT_FADE_OUT = 0.4;
/** Encode settings. */
export const CLIP_CRF = 18;
export const CLIP_PRESET = 'medium';
export const CLIP_AUDIO_BITRATE = '256k';
export const CLIP_AUDIO_RATE = 48000;
/** How far the audio stream's duration may be from the video's (ffprobe prints 6 decimals). */
export const AUDIO_TOLERANCE_SECONDS = 0.001;
/** A slug: lowercase words of letters and digits joined by single hyphens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const USAGE = '[--pipeline=<config>] [--clips <json>] [--in <mp4>] [--out-dir <dir>]';

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a clip list and snap its times to frames (pure). Throws an Error naming `where` and the field.
 * Returns one entry per clip, in file order: {slug, start, end (snapped seconds), startFrame, endFrame
 * (exclusive), frames, seconds, fadeIn, fadeOut, note}.
 * @param {unknown} raw
 * @param {{fps: number, where?: string}} o
 * @returns {{slug: string, start: number, end: number, startFrame: number, endFrame: number, frames: number,
 *   seconds: number, fadeIn: number, fadeOut: number, note: string | null}[]}
 */
export const parseClipList = (raw, {fps, where = 'clips file'}) => {
  const fail = (path, expected, value) => {
    throw new Error(`${where}: ${path} must be ${expected} (got ${JSON.stringify(value)})`);
  };
  const only = (rec, allowed, prefix) => {
    for (const key of Object.keys(rec)) {
      if (!allowed.includes(key)) throw new Error(`${where}: ${prefix}${key} is not a known key (allowed: ${allowed.join(', ')})`);
    }
  };
  const fade = (v, path, fallback) => {
    if (v === undefined) return fallback;
    return isNum(v) && v >= 0 ? v : fail(path, 'a number of seconds >= 0', v);
  };
  if (!isRecord(raw)) fail('root', 'an object with a "clips" list', raw);
  only(raw, ['$comment', 'fadeIn', 'fadeOut', 'clips'], '');
  const fadeIn = fade(raw.fadeIn, 'fadeIn', DEFAULT_FADE_IN);
  const fadeOut = fade(raw.fadeOut, 'fadeOut', DEFAULT_FADE_OUT);
  if (!Array.isArray(raw.clips) || raw.clips.length === 0) fail('clips', 'a non-empty list', raw.clips);
  const seen = new Set();
  return raw.clips.map((c, i) => {
    const at = `clips[${i}]`;
    if (!isRecord(c)) fail(at, 'an object', c);
    only(c, ['$comment', 'slug', 'start', 'end', 'fadeIn', 'fadeOut', 'note'], `${at}.`);
    if (typeof c.slug !== 'string' || !SLUG.test(c.slug)) fail(`${at}.slug`, 'lowercase letters and digits joined by single hyphens, e.g. "verse-1-chorus"', c.slug);
    if (seen.has(c.slug)) throw new Error(`${where}: ${at}.slug "${c.slug}" is used twice; each clip needs its own`);
    seen.add(c.slug);
    if (!(isNum(c.start) && c.start >= 0)) fail(`${at}.start`, 'song seconds >= 0', c.start);
    if (!isNum(c.end)) fail(`${at}.end`, 'song seconds', c.end);
    if (c.note !== undefined && typeof c.note !== 'string') fail(`${at}.note`, 'a string', c.note);
    const startFrame = Math.round(c.start * fps);
    const endFrame = Math.round(c.end * fps);
    if (endFrame <= startFrame) {
      throw new Error(
        `${where}: ${at} "${c.slug}" must start before it ends: start ${c.start} s and end ${c.end} s are frames ${startFrame} and ${endFrame} at ${fps} fps`,
      );
    }
    const frames = endFrame - startFrame;
    const seconds = frames / fps;
    const clip = {
      slug: c.slug,
      start: startFrame / fps,
      end: endFrame / fps,
      startFrame,
      endFrame,
      frames,
      seconds,
      fadeIn: fade(c.fadeIn, `${at}.fadeIn`, fadeIn),
      fadeOut: fade(c.fadeOut, `${at}.fadeOut`, fadeOut),
      note: c.note ?? null,
    };
    if (clip.fadeIn + clip.fadeOut > seconds + 1e-9) {
      throw new Error(`${where}: ${at} "${c.slug}": fadeIn ${clip.fadeIn} s + fadeOut ${clip.fadeOut} s is longer than the clip (${seconds.toFixed(3)} s)`);
    }
    return clip;
  });
};

/**
 * Refuse clips that run past the master (pure): every endFrame must be at most `frames`.
 * @param {ReturnType<typeof parseClipList>} list
 * @param {{frames: number, fps: number, input: string}} video
 */
export const checkClipsFit = (list, {frames, fps, input}) => {
  for (const c of list) {
    if (c.endFrame > frames) {
      throw new CliError(
        `clip "${c.slug}" ends at frame ${c.endFrame} (${c.end.toFixed(3)} s) but ${input} has ${frames} frames ` +
          `(${(frames / fps).toFixed(3)} s); end it earlier`,
      );
    }
  }
};

/** The clip's file name: <outputName>-<slug>.mp4. */
export const clipFile = (outputName, slug) => `${outputName}-${slug}.mp4`;

/**
 * The ffmpeg argv (without the binary) that cuts `clip` from `input` into `out`: frames
 * [startFrame, endFrame) by frame number and audio samples [startFrame, endFrame) * 48000 / fps by sample
 * number, both from the start of the file, with the audio fades, re-encoded at a constant fps.
 * @param {{input: string, clip: ReturnType<typeof parseClipList>[number], fps: number, width: number, height: number, out: string}} o
 */
export const clipFfmpegArgs = ({input, clip, fps, width, height, out}) => {
  const perFrame = CLIP_AUDIO_RATE / fps;
  const fades = [
    ...(clip.fadeIn > 0 ? [`afade=t=in:st=0:d=${clip.fadeIn.toFixed(6)}`] : []),
    ...(clip.fadeOut > 0 ? [`afade=t=out:st=${(clip.seconds - clip.fadeOut).toFixed(6)}:d=${clip.fadeOut.toFixed(6)}`] : []),
  ];
  // To BT.709 TV range, tagged, like every video the scripts write: a no-op on a master (already BT.709 TV); an
  // untagged input is read the way ffmpeg reads untagged video (BT.601) and converted.
  const video =
    `[0:v:0]trim=start_frame=${clip.startFrame}:end_frame=${clip.endFrame},setpts=PTS-STARTPTS,` +
    `scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,${BT709_FRAME_TAGS}[v]`;
  const audio = [
    '[0:a:0]',
    [
      `aresample=${CLIP_AUDIO_RATE}`,
      `atrim=start_sample=${clip.startFrame * perFrame}:end_sample=${clip.endFrame * perFrame}`,
      'asetpts=PTS-STARTPTS',
      ...fades,
    ].join(','),
    '[a]',
  ].join('');
  return [
    '-v', 'error', '-y',
    // Read only as far as the clip needs (one second past its end): frames are still counted from the first.
    '-t', ((clip.endFrame + fps) / fps).toFixed(6),
    '-i', input,
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    ...x264Args({width, height, fps, preset: CLIP_PRESET, crf: CLIP_CRF, master: true}),
    '-r', String(fps), '-fps_mode', 'cfr',
    '-c:a', 'aac', '-b:a', CLIP_AUDIO_BITRATE, '-ar', String(CLIP_AUDIO_RATE),
    '-video_track_timescale', String(fps),
    '-movie_timescale', String(CLIP_AUDIO_RATE),
    '-movflags', '+faststart',
    out,
  ];
};

/**
 * `--pipeline`, `--clips`, `--in`, `--out-dir` (each `--flag value` or `--flag=value`, at most once). Paths
 * resolve against `root`; `input` defaults to the config's master and `clips` to the config's own list
 * (clipListFor), which must then exist. Returns {pipeline, clips, input, outDir}.
 * @param {string[]} argv
 * @param {{root?: string}} [where]
 */
export const parseClipsArgs = (argv, {root = projectRoot} = {}) => {
  const {values} = parseFlags(argv, {values: ['--pipeline', '--clips', '--in', '--out-dir'], usage: USAGE});
  if (values.has('--clips') && !/\.json$/i.test(values.get('--clips'))) throw new CliError(`--clips must be a .json file (got ${values.get('--clips')})`);
  const outDir = resolve(root, values.get('--out-dir') ?? DEFAULT_CLIPS_DIR);
  // Resolved last, after every check: the defaults read the pipeline config.
  const {pipeline, input} = qaInput(values, root, defaultMaster);
  let clips;
  if (values.has('--clips')) clips = resolve(root, values.get('--clips'));
  else {
    const own = clipListFor(pipeline);
    clips = resolve(root, own);
    if (!existsSync(clips)) throw new CliError(`${pipeline} has no clip list: ${own} doesn't exist (write it, or pass --clips <json>)`);
  }
  return {pipeline, clips, input, outDir};
};

/** The audio stream's duration in seconds (null when there is no audio stream). */
const probeAudioSeconds = async (ffprobeBin, file) => {
  const out = await capture(ffprobeBin, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'json', file], {label: 'ffprobe'});
  let stream;
  try {
    stream = JSON.parse(out).streams?.[0];
  } catch {
    stream = undefined;
  }
  const seconds = Number.parseFloat(stream?.duration);
  return stream === undefined ? null : Number.isFinite(seconds) ? seconds : NaN;
};

const show = (file) => relative(process.cwd(), file) || file;

/**
 * Cut every clip. Returns {outDir, manifest, files}. The temp folder is registered in `cleanup` before it
 * exists; nothing appears in `outDir` until every clip has been cut and checked.
 * @param {ReturnType<typeof parseClipsArgs>} opts
 * @param {Set<() => void>} cleanup
 * @param {{root?: string, ffmpegBin?: string, ffprobeBin?: string}} [o]
 */
export const cutClips = async ({pipeline: pipelinePath, clips: clipsPath, input, outDir}, cleanup, {root = projectRoot, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe'} = {}) => {
  const pipeline = readPipelineAt(root, pipelinePath);
  const {fps, outputName} = pipeline;
  let raw;
  try {
    raw = JSON.parse(readFileSync(clipsPath, 'utf8'));
  } catch (err) {
    throw new CliError(`${show(clipsPath)} could not be read (${err.code ?? err.message})`);
  }
  let list;
  try {
    list = parseClipList(raw, {fps, where: show(clipsPath)});
  } catch (err) {
    throw new CliError(err.message);
  }
  if (!existsSync(input)) throw new CliError(`${input} doesn't exist. Render it first (pnpm render --pipeline=${pipelinePath}) or pass --in.`);

  const video = await probeVideoInfo(ffprobeBin, input);
  if (Math.abs(video.fps - fps) > 1e-6) throw new CliError(`${input} is at ${video.fps} fps but ${pipelinePath} is at ${fps}; clip times are song frames at ${fps} fps`);
  const sidecar = manifestFor(input, video);
  if (sidecar !== null && sidecar.firstFrame !== 0) {
    throw new CliError(`${input} is a partial render (its first frame is song frame ${sidecar.firstFrame}); cut clips from a full render`);
  }
  if (Math.abs(video.startTime) > 1e-6) throw new CliError(`${input}'s video starts at ${video.startTime} s, not 0; its frames aren't song frames`);
  if ((await probeAudioSeconds(ffprobeBin, input)) === null) throw new CliError(`${input} has no audio stream`);
  checkClipsFit(list, {frames: video.frames, fps, input: show(input)});

  const masters = knownMasters(root, {path: pipelinePath, outputName});
  const outputs = list.map((c) => join(outDir, clipFile(outputName, c.slug)));
  const manifestFile = join(outDir, clipsManifestName(outputName));
  for (const out of [...outputs, manifestFile]) {
    refuseMasters(out, root, masters, 'a clip');
    if (samePath(out, input)) throw new CliError(`${out} is the input video; clips must go elsewhere (pass --out-dir <dir>)`);
  }

  mkdirSync(outDir, {recursive: true});
  let tmp = null;
  cleanup.add(() => tmp && rmSync(tmp, {recursive: true, force: true}));
  tmp = mkdtempSync(join(outDir, `.clips-${process.pid}-`));

  for (const [i, c] of list.entries()) {
    const part = join(tmp, clipFile(outputName, c.slug));
    console.log(`clips: ${c.slug}: frames ${c.startFrame}..${c.endFrame - 1} (${c.start.toFixed(3)}-${c.end.toFixed(3)} s, ${c.seconds.toFixed(3)} s)`);
    await run(ffmpegBin, clipFfmpegArgs({input, clip: c, fps, width: video.width, height: video.height, out: part}), {label: `ffmpeg (clip ${c.slug})`});
    const got = await probeVideo(ffprobeBin, part);
    const audioSeconds = await probeAudioSeconds(ffprobeBin, part);
    const problems = [];
    if (got.frames !== c.frames) problems.push(`${got.frames} frames, expected ${c.frames}`);
    if (got.width !== video.width || got.height !== video.height) problems.push(`${got.width}x${got.height}, expected ${video.width}x${video.height}`);
    if (got.rFrameRate !== `${fps}/1` || got.avgFrameRate !== `${fps}/1`) problems.push(`frame rate ${got.rFrameRate} (average ${got.avgFrameRate}), expected ${fps}/1`);
    if (audioSeconds === null) problems.push('no audio stream');
    else if (!(Math.abs(audioSeconds - c.seconds) <= AUDIO_TOLERANCE_SECONDS)) problems.push(`audio is ${audioSeconds} s, the video ${c.seconds.toFixed(6)} s`);
    if (problems.length > 0) throw new CliError(`clip "${c.slug}" came out wrong: ${problems.join('; ')}`);
    list[i] = {...c, audioSeconds};
  }

  const manifest = {
    input: relative(root, input) || input,
    pipeline: pipelinePath,
    fps,
    width: video.width,
    height: video.height,
    clips: list.map((c, i) => ({
      slug: c.slug,
      file: relative(root, outputs[i]) || outputs[i],
      startFrame: c.startFrame,
      endFrame: c.endFrame,
      frames: c.frames,
      start: Number(c.start.toFixed(6)),
      end: Number(c.end.toFixed(6)),
      seconds: Number(c.seconds.toFixed(6)),
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      ...(c.note === null ? {} : {note: c.note}),
    })),
  };
  writeFileSync(join(tmp, clipsManifestName(outputName)), `${JSON.stringify(manifest, null, 2)}\n`);
  list.forEach((c, i) => renameSync(join(tmp, clipFile(outputName, c.slug)), outputs[i]));
  renameSync(join(tmp, clipsManifestName(outputName)), manifestFile);
  for (const [i, c] of list.entries()) console.log(`clips: wrote ${show(outputs[i])} (${c.frames} frames, ${c.seconds.toFixed(3)} s)`);
  console.log(`clips: wrote ${show(manifestFile)}`);
  return {outDir, manifest, files: outputs};
};

export const main = (argv, overrides = {}) =>
  runCli('clips', async (cleanup) => {
    await cutClips(parseClipsArgs(argv, {root: overrides.root ?? projectRoot}), cleanup, overrides);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
