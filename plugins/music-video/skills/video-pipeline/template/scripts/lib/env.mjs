// Where the project-local environment lives, for every script that needs it:
// the Python venv made by `pnpm setup:env` (librosa for analyze, Playwright for
// capture, numpy and Pillow for the QA scripts) and Playwright's browsers in
// .cache/ms-playwright. Never read PLAYWRIGHT_BROWSERS_PATH from the user's
// environment: browsers always come from the project.
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CliError} from './cli.mjs';

/** The project root (the directory holding package.json). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The project's Python venv. */
export const venvDir = (root = PROJECT_ROOT) => join(root, '.venv');

/** The venv's interpreter. */
export const venvPython = (root = PROJECT_ROOT) => join(venvDir(root), 'bin/python');

/** Playwright's browser cache (PLAYWRIGHT_BROWSERS_PATH). */
export const browsersPath = (root = PROJECT_ROOT) => join(root, '.cache/ms-playwright');

/** `base` (default process.env) with PLAYWRIGHT_BROWSERS_PATH pointing at the project's browsers. */
export const playwrightEnv = (root = PROJECT_ROOT, base = process.env) => ({...base, PLAYWRIGHT_BROWSERS_PATH: browsersPath(root)});

/** The venv's interpreter, or a CliError naming the setup command when the venv is missing. */
export const requireVenvPython = (root = PROJECT_ROOT, pythonBin = venvPython(root)) => {
  if (!existsSync(pythonBin)) throw new CliError('Python venv missing. Run `pnpm setup:env` first.');
  return pythonBin;
};
