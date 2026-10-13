// The one rule for which project files may be served to the page or counted
// as present: the REAL file (symlinks resolved) must be a regular file inside
// the REAL project root, and its real path relative to that root must have no
// segment starting with "." (.venv, .cache, .git, dot-files). scripts/serve.mjs,
// scripts/lib/project.mjs (audio presence) and scripts/capture.py (the page's
// own requests) all apply it, so the page and the Node scripts always agree on
// which audio file exists and therefore on the frame count.
import {realpathSync, statSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';

/**
 * The real path of project file `rel` (a path relative to `root`), or null
 * when it is missing, not a regular file, outside the project once symlinks
 * are resolved, or reached through a dot segment.
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
export const projectFile = (root, rel) => {
  if (rel.split(/[\\/]/).some((p) => p.startsWith('.') && p !== '') || rel.includes('\0')) return null;
  let realRoot;
  let real;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(resolve(root, rel));
  } catch {
    return null;
  }
  const r = relative(realRoot, real);
  if (r === '' || isAbsolute(r) || r.split(sep).some((p) => p.startsWith('.'))) return null;
  try {
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
};
