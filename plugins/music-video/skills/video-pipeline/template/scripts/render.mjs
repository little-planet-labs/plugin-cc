// `pnpm render [--out <mp4>] [--scale=<s>] [--crf=<n>] [--preset=<name>] [--pool=<n>] [--chunk-seconds=<s>]
//              [--frames=<a>-<b>] [--textonly] [--scenes=<module>]`
//
// The master: out/<outputName>.mp4 (src/pipeline.json), 3840x2160 by default
// (render.scale 2 on the 1920x1080 page), motion blur exactly where the page
// declares it (window.__mv.subframes), H.264 High at the level that fits,
// BT.709 TV range, constant frame rate at pipeline fps, and AAC encoded from
// the source audio file in the final mux. A manifest sidecar
// (<video>.manifest.json) is written next to it.
//
// How: the frame range is cut into chunks of about render.chunkSeconds, and a
// pool of at most render.pool (default 2) workers renders them
// (scripts/render_chunk.py: one Chromium and one ffmpeg each, frames piped as
// rgb24, nothing on disk). Each chunk is verified by its decoded frame count;
// a failed chunk is retried alone (render.retries times). The verified chunks
// are concatenated (stream copy), counted again, muxed with the audio and
// checked once more, and only then renamed into place. Any failure or
// SIGINT/SIGTERM stops every worker with its Chromium and ffmpeg, removes the
// temp folder (out/.render-*) and writes nothing.
//
// --textonly (lyric layer on black) defaults to out/<outputName>-textonly.mp4
// and --scenes=<module> (an alternate scene registry) to out/<module
// basename>.mp4; neither may write the master. --frames=<a>-<b> renders
// frames a..b (inclusive) with the matching span of the audio; without --out
// the range is added to the default name (out/<outputName>-frames-<a>-<b>.mp4,
// out/<outputName>-textonly-frames-<a>-<b>.mp4, ...), so a partial render
// never replaces a full one. A partial render may not write the master even
// with an explicit --out.
import {existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {X264_PRESETS} from '../src/lib/pipeline.js';
import {validateScenesPath} from '../src/lib/registry.js';
import {capture, CliError, run, runCli, spawnGroup} from './lib/cli.mjs';
import {chunkEncoderArgs, concatArgs, concatList, countFrames, muxArgs, probeVideo} from './lib/encode.mjs';
import {playwrightEnv} from './lib/env.mjs';
import {projectFile} from './lib/files.mjs';
import {buildManifest, defaultRenderOutput, manifestPath, refuseMaster, sweepStaleTemp, tempPrefix} from './lib/outputs.mjs';
import {chunkRanges, poolSize, runPool} from './lib/pool.mjs';
import {loadProject} from './lib/project.mjs';
import {requireCaptureEnv} from './still.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Above this many parallel workers, warn: each runs a Chromium and an encoder. */
export const POOL_WARN_ABOVE = 2;

export const RENDER_USAGE =
  'Usage: pnpm render [--out <mp4>] [--scale=<s>] [--crf=<n>] [--preset=<name>] [--pool=<n>] [--chunk-seconds=<s>] ' +
  '[--frames=<a>-<b>] [--textonly] [--scenes=<module>]';
export const DRAFT_USAGE = 'Usage: pnpm draft [--out <mp4>] [--pool=<n>] [--chunk-seconds=<s>] [--frames=<a>-<b>] [--scenes=<module>]';

/** Flags each script takes (render: the master; draft: the half-scale preview render). */
const FLAGS = {
  render: ['out', 'scale', 'crf', 'preset', 'pool', 'chunk-seconds', 'frames', 'textonly', 'scenes'],
  draft: ['out', 'pool', 'chunk-seconds', 'frames', 'scenes'],
};
const BOOLEAN = new Set(['textonly']);

/**
 * Parse render / draft arguments (`--name=value` or `--name value`; --textonly is a switch).
 * @param {string[]} argv
 * @param {'render' | 'draft'} [mode]
 * @returns {{out: string | null, scale: number | null, crf: number | null, preset: string | null, pool: number | null,
 *   chunkSeconds: number | null, frames: {a: number, b: number} | null, textonly: boolean, scenes: string | null}}
 */
export const parseRenderArgs = (argv, mode = 'render') => {
  const usage = mode === 'draft' ? DRAFT_USAGE : RENDER_USAGE;
  const allowed = FLAGS[mode];
  const o = {out: null, scale: null, crf: null, preset: null, pool: null, chunkSeconds: null, frames: null, textonly: false, scenes: null};
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg);
    if (!m || !allowed.includes(m[1])) throw new CliError(`unexpected argument "${arg}". ${usage}`);
    const name = m[1];
    if (seen.has(name)) throw new CliError(`--${name} given twice. ${usage}`);
    seen.add(name);
    if (BOOLEAN.has(name)) {
      if (m[2] !== undefined) throw new CliError(`--${name} takes no value. ${usage}`);
      o.textonly = true;
      continue;
    }
    let v = m[2];
    if (v === undefined) {
      v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new CliError(`--${name} needs a value. ${usage}`);
      i++;
    }
    const num = () => {
      const x = Number(v);
      if (v.trim() === '' || !Number.isFinite(x)) throw new CliError(`--${name} needs a number (got ${JSON.stringify(v)})`);
      return x;
    };
    if (name === 'out') {
      if (v === '') throw new CliError(`--out needs a path. ${usage}`);
      o.out = v;
    } else if (name === 'scale') {
      o.scale = num();
      if (!(o.scale > 0)) throw new CliError(`--scale must be > 0 (got ${v})`);
    } else if (name === 'crf') {
      o.crf = num();
      if (o.crf < 0 || o.crf > 51) throw new CliError(`--crf must be from 0 to 51 (got ${v})`);
    } else if (name === 'preset') {
      if (!X264_PRESETS.includes(v)) throw new CliError(`--preset must be one of ${X264_PRESETS.join(', ')} (got ${JSON.stringify(v)})`);
      o.preset = v;
    } else if (name === 'pool') {
      o.pool = poolSize(num(), '--pool');
    } else if (name === 'chunk-seconds') {
      o.chunkSeconds = num();
      if (!(o.chunkSeconds > 0)) throw new CliError(`--chunk-seconds must be > 0 (got ${v})`);
    } else if (name === 'frames') {
      const r = /^(\d+)(?:-(\d+))?$/.exec(v);
      if (!r) throw new CliError(`--frames needs a frame range like 300-449 (inclusive) or one frame (got ${JSON.stringify(v)})`);
      const a = Number(r[1]);
      const b = r[2] === undefined ? a : Number(r[2]);
      if (b < a) throw new CliError(`--frames ${v}: the last frame is before the first`);
      o.frames = {a, b};
    } else if (name === 'scenes') {
      try {
        o.scenes = validateScenesPath(v);
      } catch (err) {
        throw new CliError(err.message);
      }
    }
  }
  return o;
};

/** width*scale and height*scale as even integers, or a CliError (libx264 + yuv420p need even sizes). */
const outputSize = (width, height, scale, where) => {
  const w = width * scale;
  const h = height * scale;
  const ok = (x) => Math.abs(x - Math.round(x)) < 1e-9 && Math.round(x) % 2 === 0;
  if (!ok(w) || !ok(h)) throw new CliError(`${where} ${scale} gives ${Number(w.toFixed(6))}x${Number(h.toFixed(6))}; both must be even whole numbers`);
  return {width: Math.round(w), height: Math.round(h)};
};

/**
 * Everything a render needs, from the parsed flags and src/pipeline.json: the settings in effect, the
 * frame range [first, last), the output (absolute) and the project.
 * @param {ReturnType<typeof parseRenderArgs>} opts
 * @param {{root?: string, mode?: 'render' | 'draft'}} [where]
 */
export const resolveRender = (opts, {root = projectRoot, mode = 'render'} = {}) => {
  const {pipeline, project} = loadProject(root);
  // Fallback timing (no analysis, or one made for another file or fps) with a track present would put the
  // fallback length of video over the whole song. Only the no-track fallback renders, silent.
  if (project.timing === 'fallback' && project.audio !== null) {
    throw new CliError(
      `public/${project.audio} is present but the timing in effect is the fallback (${project.warnings.join(' ') || 'no analysis'}). ` +
        'Run `pnpm analyze` before rendering.',
    );
  }
  const draft = mode === 'draft';
  const base = draft ? pipeline.draft : pipeline.render;
  const scale = draft ? pipeline.draft.scale : (opts.scale ?? pipeline.render.scale);
  const size = outputSize(pipeline.width, pipeline.height, scale, draft ? 'pipeline.json draft.scale' : opts.scale !== null ? '--scale' : 'pipeline.json render.scale');
  const pool = opts.pool ?? poolSize(pipeline.render.pool, 'pipeline.json render.pool');
  let first = 0;
  let last = project.frames;
  if (opts.frames) {
    if (opts.frames.b >= project.frames) {
      throw new CliError(`--frames ${opts.frames.a}-${opts.frames.b} runs past the end of the video (frames 0..${project.frames - 1})`);
    }
    first = opts.frames.a;
    last = opts.frames.b + 1;
  }
  const range = opts.frames ? {first, last} : null;
  // Only a full plain render may write the master.
  const what = draft
    ? 'a draft'
    : opts.textonly
      ? 'a text-only render'
      : opts.scenes
        ? 'an alternate-scenes render'
        : range
          ? 'a partial render (--frames)'
          : null;
  const output = resolve(root, opts.out ?? defaultRenderOutput({outputName: pipeline.outputName, textonly: opts.textonly, scenes: opts.scenes, range, draft}));
  if (!/\.mp4$/i.test(output)) throw new CliError(`--out must end in .mp4 (got ${opts.out})`);
  if (what) refuseMaster(output, root, pipeline.outputName, what);
  return {
    mode,
    project,
    pipeline,
    fps: project.fps,
    first,
    last,
    scale,
    width: size.width,
    height: size.height,
    crf: draft ? base.crf : (opts.crf ?? base.crf),
    preset: draft ? base.preset : (opts.preset ?? base.preset),
    format: base.format,
    blur: !draft,
    pool,
    chunkSeconds: opts.chunkSeconds ?? pipeline.render.chunkSeconds,
    retries: pipeline.render.retries,
    audioBitrate: pipeline.render.audioBitrate,
    textonly: opts.textonly,
    scenes: opts.scenes,
    output,
  };
};

/** The page's own view of the video (frames, cuts, blur windows), read once before the pool starts. */
const pageInfo = async (python, envRoot, root, s) => {
  const args = [join(envRoot, 'scripts/capture.py'), '--root', root, '--info', '--json'];
  if (s.textonly) args.push('--textonly');
  if (s.scenes) args.push('--scenes', s.scenes);
  const out = await capture(python, args, {cwd: root, env: playwrightEnv(envRoot), label: 'capture --info'});
  try {
    return JSON.parse(out.trim().split('\n').pop()).info;
  } catch {
    throw new CliError('capture --info printed no page info');
  }
};

const show = (file) => relative(process.cwd(), file) || file;

/**
 * Render `s` (from resolveRender). The temp folder is registered in `cleanup`
 * before it exists; the video and its manifest appear only when complete.
 * @param {ReturnType<typeof resolveRender>} s
 * @param {Set<() => void>} cleanup
 * @param {{root?: string, envRoot?: string, pythonBin?: string, ffmpegBin?: string, ffprobeBin?: string,
 *   staggerMs?: number, killGraceMs?: number, sampleLog?: string | null}} [o]
 *   envRoot: where scripts/, .venv and .cache live (the project itself, except in tests). sampleLog: a folder
 *   for the workers' captured sample times (tests).
 */
export const render = async (s, cleanup, {root = projectRoot, envRoot = root, pythonBin, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', staggerMs, killGraceMs, sampleLog = null} = {}) => {
  const started = Date.now();
  const name = s.mode === 'draft' ? 'draft' : 'render';
  if (s.scenes && !existsSync(join(root, s.scenes))) throw new CliError(`--scenes module ${s.scenes} does not exist`);
  const python = pythonBin ?? requireCaptureEnv(envRoot);
  if (s.pool > POOL_WARN_ABOVE) {
    console.error(`${name}: warning: pool ${s.pool}: each worker runs a Chromium and an encoder; this machine-load default is ${POOL_WARN_ABOVE}`);
  }
  const {project, fps, first, last} = s;

  const info = await pageInfo(python, envRoot, root, s);
  if (info.frames !== project.frames) {
    throw new CliError(`the page has ${info.frames} frames but the project data gives ${project.frames}; check src/data and src/pipeline.json`);
  }
  const audio = project.audio === null ? null : projectFile(root, `public/${project.audio}`);
  if (project.audio !== null && audio === null) throw new CliError(`public/${project.audio} disappeared`);
  if (audio === null) console.error(`${name}: no audio file (${s.pipeline.audioCandidates.map((p) => `public/${p}`).join(', ')}): the video will be silent`);

  mkdirSync(dirname(s.output), {recursive: true});
  // Temp folders of renders that were SIGKILLed (no cleanup ran); live ones (their pid is alive) are kept.
  for (const stale of sweepStaleTemp(dirname(s.output))) console.log(`${name}: removed ${stale}, left by a render that is no longer running`);
  let tmp = null;
  cleanup.add(() => tmp && rmSync(tmp, {recursive: true, force: true}));
  tmp = mkdtempSync(join(dirname(s.output), tempPrefix(name)));

  const chunkFrames = Math.max(1, Math.round(s.chunkSeconds * fps));
  const chunks = chunkRanges(first, last, chunkFrames);
  const chunkFile = (c) => join(tmp, `chunk-${String(c.index).padStart(4, '0')}.mp4`);
  const label = (c) => `chunk ${c.index + 1}/${chunks.length} [${c.from}, ${c.to})`;
  console.log(
    `${name}: frames ${first}..${last - 1} (${last - first}) at ${s.width}x${s.height}, ${chunks.length} chunk(s), ` +
      `pool ${s.pool}, crf ${s.crf}, ${s.preset}${s.blur ? '' : ', no motion blur'}${s.textonly ? ', text only' : ''}`,
  );

  await runPool({
    items: chunks,
    cap: s.pool,
    retries: s.retries,
    name: label,
    staggerMs,
    killGraceMs,
    log: (msg) => console.log(`${name}: ${msg}`),
    start: (c, attempt) => {
      const encoder = [ffmpegBin, ...chunkEncoderArgs({width: s.width, height: s.height, fps, preset: s.preset, crf: s.crf, out: chunkFile(c), master: s.mode !== 'draft'})];
      const args = [
        join(envRoot, 'scripts/render_chunk.py'),
        '--root', root,
        '--from', String(c.from),
        '--to', String(c.to),
        '--frames-total', String(project.frames),
        '--scale', String(s.scale),
        '--format', s.format,
        '--encoder', JSON.stringify(encoder),
      ];
      if (!s.blur) args.push('--single');
      if (s.textonly) args.push('--textonly');
      if (s.scenes) args.push('--scenes', s.scenes);
      if (sampleLog) args.push('--sample-log', join(sampleLog, `chunk-${c.from}.jsonl`));
      console.log(`${name}: ${label(c)} started${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return spawnGroup(python, args, {cwd: root, env: playwrightEnv(envRoot), label: label(c), stdio: ['ignore', 'inherit', 'inherit'], killGraceMs});
    },
    check: async (c) => {
      const got = await countFrames(ffprobeBin, chunkFile(c));
      return got === c.to - c.from ? null : `decoded ${got} frames, expected ${c.to - c.from}`;
    },
    discard: (c) => rmSync(chunkFile(c), {force: true}),
  });

  const list = join(tmp, 'chunks.txt');
  writeFileSync(list, concatList(chunks.map(chunkFile)));
  const joined = join(tmp, 'video.mp4');
  await run(ffmpegBin, concatArgs(list, fps, joined), {label: 'ffmpeg (concat)'});
  const joinedFrames = await countFrames(ffprobeBin, joined);
  if (joinedFrames !== last - first) throw new CliError(`the joined chunks have ${joinedFrames} frames, expected ${last - first}`);

  const partial = join(tmp, 'final.mp4');
  await run(
    ffmpegBin,
    muxArgs({
      video: joined,
      audio,
      audioBitrate: s.audioBitrate,
      fps,
      out: partial,
      startSeconds: first / fps,
      durationSeconds: (last - first) / fps,
    }),
    {label: 'ffmpeg (mux)'},
  );
  const final = await probeVideo(ffprobeBin, partial);
  const problems = [];
  if (final.frames !== last - first) problems.push(`${final.frames} frames, expected ${last - first}`);
  if (final.width !== s.width || final.height !== s.height) problems.push(`${final.width}x${final.height}, expected ${s.width}x${s.height}`);
  if (final.rFrameRate !== `${fps}/1` || final.avgFrameRate !== `${fps}/1`) problems.push(`frame rate ${final.rFrameRate} (average ${final.avgFrameRate}), expected ${fps}/1`);
  if (final.hasAudio !== (audio !== null)) problems.push(audio === null ? 'an unexpected audio stream' : 'no audio stream');
  if (problems.length > 0) throw new CliError(`the muxed video is wrong: ${problems.join('; ')}`);

  const manifest = buildManifest({
    fps,
    first,
    last,
    width: s.width,
    height: s.height,
    scale: s.scale,
    textonly: s.textonly,
    cuts: info.cuts,
    blurWindows: info.blurWindows,
    blur: s.blur,
    source: s.scenes ?? 'src/scenes/index.js',
  });
  const manifestTmp = join(tmp, 'manifest.json');
  writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(manifestTmp, manifestPath(s.output));
  renameSync(partial, s.output);
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `${name}: wrote ${show(s.output)} (${last - first} frames, ${s.width}x${s.height}, ${audio === null ? 'silent' : basename(audio)}) ` +
      `in ${seconds.toFixed(1)} s (${(seconds / (last - first)).toFixed(2)} s/frame)`,
  );
  return {output: s.output, manifest, chunks, seconds};
};

export const main = (argv, overrides = {}) =>
  runCli(
    'render',
    async (cleanup) => {
      const s = resolveRender(parseRenderArgs(argv, 'render'), {root: overrides.root ?? projectRoot, mode: 'render'});
      await render(s, cleanup, overrides);
    },
    overrides.killGraceMs === undefined ? {} : {killGraceMs: overrides.killGraceMs},
  );

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
