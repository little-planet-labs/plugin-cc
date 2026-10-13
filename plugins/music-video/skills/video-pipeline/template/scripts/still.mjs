// `pnpm still [--frame=<n> | --t=<seconds>] [--scale=<s>] [--textonly] [--scenes=<module>] [--out <png>]`
//
// One frame of the video as a PNG (default out/still.png, frame 0), captured
// exactly as the render captures it (scripts/capture.py: subframe blur inside
// blur windows included). --frame is an absolute frame; --t picks the frame
// nearest that time (Math.round(t * fps)). --scale is the device scale
// (default 1; 2 = a 4K still from a 1920x1080 page). The PNG is written to a
// temp name and renamed, and folders are created.
import {existsSync, readdirSync, realpathSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateScenesPath} from '../src/lib/registry.js';
import {CliError, run, runCli} from './lib/cli.mjs';
import {browsersPath, playwrightEnv, requireVenvPython} from './lib/env.mjs';
import {loadProject} from './lib/project.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = 'Usage: pnpm still [--frame=<n> | --t=<seconds>] [--scale=<s>] [--textonly] [--scenes=<module>] [--out <png>]';

/**
 * @param {string[]} argv
 * @returns {{frame: number | null, t: number | null, scale: number, textonly: boolean, scenes: string | null, out: string}}
 */
export const parseStillArgs = (argv) => {
  const o = {frame: null, t: null, scale: 1, textonly: false, scenes: null, out: 'out/still.png'};
  const value = (arg, name, i) => {
    if (arg === `--${name}`) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new CliError(`--${name} needs a value. ${USAGE}`);
      return [v, i + 1];
    }
    return [arg.slice(name.length + 3), i];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = /^--([a-z]+)/.exec(arg)?.[1];
    if (arg === '--textonly') {
      o.textonly = true;
      continue;
    }
    if (!name || !['frame', 't', 'scale', 'scenes', 'out'].includes(name) || (arg !== `--${name}` && !arg.startsWith(`--${name}=`))) {
      throw new CliError(`unexpected argument "${arg}". ${USAGE}`);
    }
    const [v, next] = value(arg, name, i);
    i = next;
    if (name === 'frame') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) throw new CliError(`--frame needs a frame number >= 0 (got ${JSON.stringify(v)})`);
      o.frame = n;
    } else if (name === 't') {
      const t = Number(v);
      if (!Number.isFinite(t) || t < 0) throw new CliError(`--t needs seconds >= 0 (got ${JSON.stringify(v)})`);
      o.t = t;
    } else if (name === 'scale') {
      const s = Number(v);
      if (!(s > 0) || !Number.isFinite(s)) throw new CliError(`--scale needs a number > 0 (got ${JSON.stringify(v)})`);
      o.scale = s;
    } else if (name === 'scenes') {
      try {
        o.scenes = validateScenesPath(v);
      } catch (err) {
        throw new CliError(err.message);
      }
    } else {
      if (v === '') throw new CliError(`--out needs a path. ${USAGE}`);
      o.out = v;
    }
  }
  if (o.frame !== null && o.t !== null) throw new CliError('give --frame or --t, not both');
  if (!/\.png$/i.test(o.out)) throw new CliError(`--out must end in .png (got ${o.out})`);
  return o;
};

/** Fail with "run pnpm setup:env" when the venv or Playwright's Chromium is missing. */
export const requireCaptureEnv = (root) => {
  const python = requireVenvPython(root);
  const browsers = browsersPath(root);
  const hasChromium = existsSync(browsers) && readdirSync(browsers).some((d) => d.startsWith('chromium'));
  if (!hasChromium) throw new CliError("Playwright's Chromium is missing. Run `pnpm setup:env` first.");
  return python;
};

/**
 * @param {ReturnType<typeof parseStillArgs>} opts
 * @param {{root?: string, envRoot?: string}} [where] root: the project captured; envRoot: where .venv and
 *   .cache/ms-playwright live (the same project, except in tests).
 */
export const still = async (opts, {root = projectRoot, envRoot = root} = {}) => {
  const {project} = loadProject(root);
  const frame = opts.frame ?? (opts.t === null ? 0 : Math.round(opts.t * project.fps));
  if (frame >= project.frames) {
    throw new CliError(`frame ${frame} is past the end of the video (frames 0..${project.frames - 1}, ${project.duration.toFixed(2)}s)`);
  }
  if (opts.scenes && !existsSync(join(root, opts.scenes))) throw new CliError(`--scenes module ${opts.scenes} does not exist`);
  const python = requireCaptureEnv(envRoot);
  const out = resolve(root, opts.out);
  const args = [join(envRoot, 'scripts/capture.py'), '--root', root, '--scale', String(opts.scale), '--frame', String(frame), '--out', out];
  if (opts.textonly) args.push('--textonly');
  if (opts.scenes) args.push('--scenes', opts.scenes);
  await run(python, args, {cwd: root, env: playwrightEnv(envRoot), label: 'capture'});
  console.log(`still: frame ${frame} (${(frame / project.fps).toFixed(3)}s) -> ${relative(process.cwd(), out) || out}`);
  return {frame, out};
};

export const main = (argv, overrides = {}) =>
  runCli('still', async () => {
    await still(parseStillArgs(argv), overrides);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
