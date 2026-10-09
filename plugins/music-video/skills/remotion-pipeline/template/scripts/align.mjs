// `pnpm align [calibrate]` – align creative/lyrics.screen.txt to the track and
// write src/data/lyrics.json and src/data/sections.json (scripts/align_lyrics.py,
// in .venv-align from `pnpm setup:align`). Run `pnpm analyze` first: sections
// snap to its downbeats. The Python side writes each output atomically and
// removes its temp files; this wrapper forwards Ctrl-C/SIGTERM to it.
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const align = async ({root = projectRoot, pythonBin = join(root, '.venv-align/bin/python'), args = []}) => {
  if (!existsSync(pythonBin)) throw new CliError('alignment venv missing. Run `pnpm setup:align` first.');
  await run(pythonBin, [join(root, 'scripts/align_lyrics.py'), ...args], {cwd: root, label: 'align_lyrics.py'});
};

export const main = (argv, overrides = {}) =>
  runCli('align', async () => {
    if (argv.length > 0 && !(argv.length === 1 && argv[0] === 'calibrate')) {
      throw new CliError(`unexpected arguments: ${argv.join(' ')} (only "calibrate" is accepted)`);
    }
    await align({...overrides, args: argv});
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
