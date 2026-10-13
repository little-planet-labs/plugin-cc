// Where the render scripts write, and the rule that protects the master:
// a draft, preview, text-only or alternate-scenes output never resolves to
// out/<outputName>.mp4. Paths are compared canonically: symlinks resolved
// (/tmp is /private/tmp, an out/ linked to another drive, a linked project
// folder) and case-insensitively (default macOS volumes are, so
// out/Music-Video.mp4 IS out/music-video.mp4); when both files exist, by
// device and inode too.
import {readdirSync, realpathSync, rmSync, statSync} from 'node:fs';
import {basename, dirname, extname, join, relative, resolve} from 'node:path';
import {CliError} from './cli.mjs';

/** The master, relative to the project: out/<outputName>.mp4. */
export const masterOutput = (outputName) => `out/${outputName}.mp4`;

/** The draft's default output. */
export const DRAFT_OUTPUT = 'out/draft.mp4';

/**
 * `p` with every symlink resolved: the real path of its nearest existing
 * ancestor, plus the components below it that don't exist yet.
 * @param {string} p
 */
export const canonicalPath = (p) => {
  const abs = resolve(p);
  let base = abs;
  for (;;) {
    try {
      const real = realpathSync(base);
      const rest = relative(base, abs);
      return rest === '' ? real : join(real, rest);
    } catch {
      const up = dirname(base);
      if (up === base) return abs;
      base = up;
    }
  }
};

const fileId = (p) => {
  try {
    const st = statSync(p);
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
};

/** Whether two paths name the same file: canonical paths compared case-insensitively, or the same device and inode. */
export const samePath = (a, b) => {
  if (canonicalPath(a).toLowerCase() === canonicalPath(b).toLowerCase()) return true;
  const ia = fileId(a);
  return ia !== null && ia === fileId(b);
};

/**
 * Refuse `output` (absolute) when it is the master `out/<outputName>.mp4` of `root`.
 * @param {string} output
 * @param {string} root
 * @param {string} outputName
 * @param {string} what What is being written, e.g. "a draft".
 */
export const refuseMaster = (output, root, outputName, what) => {
  if (samePath(output, resolve(root, masterOutput(outputName)))) {
    throw new CliError(`${output} is the master video (${masterOutput(outputName)}); ${what} must go elsewhere (pass --out <path>)`);
  }
};

/**
 * The default output of a render (relative to the project):
 * - an alternate scene registry: out/<module basename>.mp4
 * - text-only: out/<outputName>-textonly.mp4 (out/<module basename>-textonly.mp4 with --scenes)
 * - otherwise the master, out/<outputName>.mp4
 * - a draft (`draft: true`): out/draft.mp4
 * A partial range (--frames) adds -frames-<a>-<b> (a, b inclusive) to every one of these, so a partial
 * render never replaces the full render of its kind (and never defaults onto the master).
 * @param {{outputName: string, textonly?: boolean, scenes?: string | null, range?: {first: number, last: number} | null,
 *   draft?: boolean}} o range: [first, last) frames when partial.
 */
export const defaultRenderOutput = ({outputName, textonly = false, scenes = null, range = null, draft = false}) => {
  const suffix = range ? `-frames-${range.first}-${range.last - 1}` : '';
  if (draft) return `${DRAFT_OUTPUT.replace(/\.mp4$/, '')}${suffix}.mp4`;
  const base = scenes ? basename(scenes, extname(scenes)) : outputName;
  return `out/${base}${textonly ? '-textonly' : ''}${suffix}.mp4`;
};

/** `<video without .mp4>.manifest.json`. */
export const manifestPath = (video) => `${video.replace(/\.mp4$/i, '')}.manifest.json`;

/**
 * The sidecar written next to every render (the shape pinned in the design):
 * {fps, frames, width, height, scale, textonly, cuts: [frame], blurWindows: [{from, to, samples}], source},
 * plus firstFrame: the page frame shown at video frame 0 (0 unless --frames). Cuts and blur windows are
 * video frames (page frame - firstFrame) inside the rendered range; blurWindows lists only blur that was
 * rendered (a draft renders none).
 * @param {{fps: number, first: number, last: number, width: number, height: number, scale: number, textonly: boolean,
 *   cuts: number[], blurWindows: {a: number, b: number, samples: number}[], blur: boolean, source: string}} o
 *   cuts and blurWindows in seconds as the page reports them.
 */
export const buildManifest = ({fps, first, last, width, height, scale, textonly, cuts, blurWindows, blur, source}) => {
  const frames = last - first;
  const toVideo = (seconds) => Math.round(seconds * fps) - first;
  return {
    fps,
    frames,
    width,
    height,
    scale,
    textonly,
    cuts: cuts.map(toVideo).filter((f) => f > 0 && f < frames),
    blurWindows: blur
      ? blurWindows
          .map((w) => ({from: Math.max(0, toVideo(w.a)), to: Math.min(frames, toVideo(w.b)), samples: w.samples}))
          .filter((w) => w.to > w.from)
      : [],
    source,
    firstFrame: first,
  };
};

/** The prefix of a render's temp folder next to its output: `.<name>-<pid>-` (mkdtemp adds a random suffix). */
export const tempPrefix = (name) => `.${name}-${process.pid}-`;

const TEMP_FOLDER = /^\.(render|draft)-(\d+)-./;

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/**
 * Remove the temp folders (`.render-<pid>-*`, `.draft-<pid>-*`) in `dir` left by
 * a render whose process is gone (one killed with SIGKILL can't clean up).
 * A folder whose pid is alive, this process's included, is never touched.
 * @param {string} dir
 * @returns {string[]} The names removed.
 */
export const sweepStaleTemp = (dir) => {
  let names;
  try {
    names = readdirSync(dir, {withFileTypes: true});
  } catch {
    return [];
  }
  const removed = [];
  for (const d of names) {
    const m = TEMP_FOLDER.exec(d.name);
    if (!m || !d.isDirectory()) continue;
    const pid = Number(m[2]);
    if (pid === process.pid || pidAlive(pid)) continue;
    rmSync(join(dir, d.name), {recursive: true, force: true});
    removed.push(d.name);
  }
  return removed;
};
