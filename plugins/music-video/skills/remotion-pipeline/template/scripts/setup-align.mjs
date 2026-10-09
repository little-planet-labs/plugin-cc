// `pnpm setup:align` – one-time setup for `pnpm align`:
//   1. creates .venv-align (Python 3.14 preferred: scripts/requirements-align.txt
//      is pinned and tested there) unless it exists,
//   2. installs the pinned requirements into it,
//   3. downloads the alignment models from the k2-fsa/sherpa-onnx GitHub
//      releases into .cache/models (~1.4 GB extracted; archives are deleted
//      after extraction).
// A venv created by a run that then fails is removed, so the next run starts
// clean. Behind a TLS-intercepting proxy or in a sandbox, pip may need
// `PIP_USE_DEPRECATED=legacy-certs pnpm setup:align`.
import {existsSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {capture, CliError, run, runCli} from './lib/cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

export const setupAlign = async ({root = projectRoot, pythonCandidates = ['python3.14', 'python3']}, cleanup) => {
  const venv = join(root, '.venv-align');
  const python = join(venv, 'bin/python');
  let created = false;
  let installed = false;
  cleanup.add(() => {
    if (created && !installed) rmSync(venv, {recursive: true, force: true});
  });
  if (!existsSync(python)) {
    const found = await findPython(pythonCandidates);
    if (found.version !== '3.14') {
      console.warn(`setup:align: using Python ${found.version}; the pins in scripts/requirements-align.txt are tested on 3.14`);
    }
    created = true;
    await run(found.bin, ['-m', 'venv', venv], {label: 'python -m venv'});
  }
  await run(
    python,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', join(root, 'scripts/requirements-align.txt')],
    {label: 'pip install'},
  );
  installed = true;
  await run(python, [join(root, 'scripts/align_lyrics.py'), 'fetch-models'], {cwd: root, label: 'model download'});
  console.log('setup:align: ready. Run `pnpm align` after `pnpm analyze`.');
};

export const main = (argv, overrides = {}) =>
  runCli('setup:align', async (cleanup) => {
    if (argv.length > 0) throw new CliError(`unexpected argument "${argv[0]}"`);
    await setupAlign(overrides, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
