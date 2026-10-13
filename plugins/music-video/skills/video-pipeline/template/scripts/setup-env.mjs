// `pnpm setup:env` – one-time environment setup for analyze, the renders and the
// QA scripts:
//   1. checks that ffmpeg and ffprobe run and that ffmpeg has the libx264 and
//      aac encoders (before anything is downloaded),
//   2. creates .venv (Python 3.14 preferred: scripts/requirements.txt is pinned
//      and tested there) unless it exists,
//   3. installs the pinned requirements into it, unless every pin is already
//      installed,
//   4. installs the browser a headless Playwright chromium.launch() uses (the
//      Chromium headless shell, plus the small ffmpeg build Playwright pairs
//      with it) into .cache/ms-playwright, unless it's already there.
// A second run on a ready project downloads nothing. A venv created by a run
// whose package install then fails is removed, so the next run starts clean; an
// existing venv is kept. Behind a TLS-intercepting proxy or in a sandbox, pip
// may need `PIP_USE_DEPRECATED=legacy-certs pnpm setup:env` (the environment is
// passed through to pip unchanged).
import {existsSync, realpathSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';
import {browsersPath, playwrightEnv, PROJECT_ROOT, venvDir, venvPython} from './lib/env.mjs';

/** Encoders the render pipeline needs from ffmpeg. */
export const REQUIRED_ENCODERS = ['libx264', 'aac'];

/** The playwright install arguments for what a headless chromium.launch() uses. */
export const BROWSER_INSTALL_ARGS = ['install', '--only-shell', 'chromium'];

/** The same, printing what it would install instead of installing it. */
const BROWSER_DRY_RUN_ARGS = ['install', '--dry-run', '--only-shell', 'chromium'];

/** Encoder names from `ffmpeg -encoders` output (the rows after the "------" line). */
export const parseEncoders = (text) => {
  const lines = text.split('\n');
  const rule = lines.findIndex((l) => /^\s*-{3,}\s*$/.test(l));
  const names = new Set();
  for (const line of lines.slice(rule + 1)) {
    const m = /^\s*\S{6}\s+(\S+)/.exec(line);
    if (m && m[1] !== '=') names.add(m[1]);
  }
  return names;
};

/** Fails with one message naming everything missing: ffmpeg, ffprobe, or an ffmpeg encoder. */
const checkTools = async ({ffmpegBin, ffprobeBin}) => {
  const missing = [];
  let encoders = null;
  try {
    encoders = parseEncoders(await capture(ffmpegBin, ['-hide_banner', '-encoders'], {label: 'ffmpeg'}));
  } catch {
    missing.push(`ffmpeg (could not run "${ffmpegBin}")`);
  }
  try {
    await capture(ffprobeBin, ['-version'], {label: 'ffprobe'});
  } catch {
    missing.push(`ffprobe (could not run "${ffprobeBin}")`);
  }
  if (encoders) {
    const lacking = REQUIRED_ENCODERS.filter((name) => !encoders.has(name));
    if (lacking.length > 0) missing.push(`ffmpeg has no ${lacking.join(' or ')} encoder`);
  }
  if (missing.length > 0) {
    throw new CliError(`missing: ${missing.join('; ')}. Install an ffmpeg and ffprobe built with libx264 and aac (e.g. Homebrew's ffmpeg).`);
  }
};

/** The first interpreter that runs, from `candidates`. */
const findPython = async (candidates) => {
  for (const bin of candidates) {
    try {
      const version = (await capture(bin, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {label: bin})).trim();
      return {bin, version};
    } catch {
      // try the next one
    }
  }
  throw new CliError(`no Python found (tried ${candidates.join(', ')}); install Python 3.14`);
};

// Prints a JSON list of the requirements file's `name==version` pins that aren't
// installed at exactly that version (empty when the venv is complete).
const PINS_PROBE = `
import importlib.metadata as m, json, sys
out = []
for line in open(sys.argv[1], encoding="utf8"):
    line = line.split("#", 1)[0].strip()
    if not line:
        continue
    name, _, want = line.partition("==")
    try:
        have = m.version(name.strip())
    except m.PackageNotFoundError:
        have = None
    if have != want.strip():
        out.append(f"{line} (installed: {have})")
print(json.dumps(out))
`;

/** The pins that still need installing; a probe that can't run counts as "all of them". */
const missingPins = async (python, requirements) => {
  try {
    const out = JSON.parse(await capture(python, ['-I', '-c', PINS_PROBE, requirements], {label: 'installed-package check'}));
    return Array.isArray(out) ? out : ['(unreadable package check)'];
  } catch {
    return ['(package check failed)'];
  }
};

/**
 * Browser directories Playwright would install that aren't complete yet,
 * read from `playwright install --dry-run` (it prints each "Install location:"
 * without downloading); Playwright writes INSTALLATION_COMPLETE into a browser
 * directory once it's fully extracted. A dry run that can't run, or lists
 * nothing, counts as "not installed".
 */
const pendingBrowsers = async (python, env) => {
  let out;
  try {
    out = await capture(python, ['-m', 'playwright', ...BROWSER_DRY_RUN_ARGS], {env, label: 'playwright install --dry-run'});
  } catch {
    return ['(dry run failed)'];
  }
  const dirs = [...out.matchAll(/Install location:\s+(.+?)\s*$/gm)].map((m) => m[1]);
  if (dirs.length === 0) return ['(dry run listed no browsers)'];
  return dirs.filter((dir) => !existsSync(join(dir, 'INSTALLATION_COMPLETE')));
};

export const setupEnv = async (
  {
    root = PROJECT_ROOT,
    pythonCandidates = ['python3.14', 'python3'],
    ffmpegBin = 'ffmpeg',
    ffprobeBin = 'ffprobe',
    requirements = join(root, 'scripts/requirements.txt'),
  },
  cleanup,
) => {
  await checkTools({ffmpegBin, ffprobeBin});

  const venv = venvDir(root);
  const python = venvPython(root);
  let created = false;
  let installed = false;
  cleanup.add(() => {
    if (created && !installed) rmSync(venv, {recursive: true, force: true});
  });
  if (!existsSync(python)) {
    const found = await findPython(pythonCandidates);
    if (found.version !== '3.14') {
      console.warn(`setup:env: using Python ${found.version}; the pins in scripts/requirements.txt are tested on 3.14`);
    }
    created = true;
    await run(found.bin, ['-m', 'venv', venv], {label: 'python -m venv'});
  }
  const pins = await missingPins(python, requirements);
  if (pins.length === 0) {
    console.log('setup:env: Python packages already installed');
  } else {
    await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', requirements], {label: 'pip install'});
  }
  installed = true;

  const env = playwrightEnv(root);
  if ((await pendingBrowsers(python, env)).length === 0) {
    console.log('setup:env: headless Chromium already installed');
  } else {
    await run(python, ['-m', 'playwright', ...BROWSER_INSTALL_ARGS], {env, label: 'playwright install'});
  }
  console.log(`setup:env: ready (.venv, browsers in ${browsersPath(root)}).`);
};

export const main = (argv, overrides = {}) =>
  runCli('setup:env', async (cleanup) => {
    if (argv.length > 0) throw new CliError(`unexpected argument "${argv[0]}"`);
    await setupEnv(overrides, cleanup);
  });

// realpath: Node resolves symlinks for import.meta.url but not for argv[1].
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
