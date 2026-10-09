// `pnpm still [--frame=<n>] [--out <png>] [--remotion-flag=value …]`
//
// One frame of the composition as a PNG (default out/still.png, frame 0).
// Stills have no audio, so this is a plain `remotion still`; the wrapper only
// fixes the entry and composition and lets you choose the output, e.g.
// `pnpm still --frame=1200 --out=out/wip-1/f-1200.png`.
import {mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, run, runCli} from './lib/cli.mjs';
import {readPipeline} from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Output path and the flags forwarded to `remotion still`. */
export const parseStillArgs = (argv, {root = projectRoot} = {}) => {
  let out = 'out/still.png';
  const passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg.startsWith('--out=')) {
      const value = arg === '--out' ? argv[++i] : arg.slice('--out='.length);
      if (value === undefined || value === '' || value.startsWith('-')) throw new CliError('--out needs a path, e.g. --out=out/wip-1/f-120.png');
      out = value;
      continue;
    }
    if (!arg.startsWith('-')) {
      throw new CliError(`unexpected argument "${arg}". Use --out <path> and --flag=value form for Remotion flags (e.g. --frame=120).`);
    }
    if (arg.split('=')[0] === '--output') throw new CliError('use --out <path>');
    passthrough.push(arg);
  }
  if (!/\.(png|jpe?g|webp)$/.test(out)) throw new CliError(`--out must end in .png, .jpg or .webp (got ${out})`);
  return {output: resolve(root, out), passthrough};
};

export const still = async ({output, passthrough, root = projectRoot, remotionBin = join(root, 'node_modules/.bin/remotion')}) => {
  mkdirSync(dirname(output), {recursive: true});
  await run(remotionBin, ['still', 'src/index.ts', readPipeline(root).compositionId, output, ...passthrough], {
    cwd: root,
    label: 'remotion still',
  });
};

export const main = (argv, overrides = {}) =>
  runCli('still', async () => {
    await still({...parseStillArgs(argv, overrides), ...overrides});
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
