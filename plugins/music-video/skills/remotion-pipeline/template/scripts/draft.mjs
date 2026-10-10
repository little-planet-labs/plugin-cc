// `pnpm draft [--out <path>] [--composition=<id>] [--frames=a-b] [--props=<json>] [--remotion-flag=value …]`
//
// A half-scale draft (960x540 from a 1080p composition) for judging timing
// and motion quickly. It is `pnpm render` with --scale=0.5 added: the same
// argument parsing, reserved flags, frame-rate probe of the intermediate and
// audio-safe remux (render.mjs's parseRenderArgs and render, not a copy), so
// a draft's audio sits exactly where the master's does.
//
// The output defaults to out/draft.mp4 and is never the main video: an --out
// that resolves to out/<outputName>.mp4 (compared case-insensitively, as
// default macOS volumes are) is refused. --scale is fixed at 0.5; use
// `pnpm render --scale=<n>` for another size. Per critique round:
// `pnpm draft --out out/draft-r<n>.mp4`.
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, runCli} from './lib/cli.mjs';
import {defaultOutput, parseRenderArgs, render} from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DRAFT_OUTPUT = 'out/draft.mp4';
export const DRAFT_SCALE = '--scale=0.5';

/**
 * parseRenderArgs with the draft's default output and --scale=0.5 appended to
 * the Remotion flags. A user --scale and an output that is the main video are
 * CliErrors; everything else is validated exactly as `pnpm render` does.
 */
export const parseDraftArgs = (argv, {root = projectRoot} = {}) => {
  for (const arg of argv) {
    if (arg === '--scale' || arg.startsWith('--scale=')) {
      throw new CliError(`pnpm draft always renders at ${DRAFT_SCALE}; use \`pnpm render --scale=<n> --out <path>\` for another scale`);
    }
  }
  const hasOut = argv.some((a) => a === '--out' || a.startsWith('--out='));
  const args = parseRenderArgs(hasOut ? argv : [...argv, `--out=${DRAFT_OUTPUT}`], {root});
  if (args.output.toLowerCase() === resolve(root, defaultOutput(root)).toLowerCase()) {
    throw new CliError(`${args.output} is the main video's output; a draft must go elsewhere (default ${DRAFT_OUTPUT})`);
  }
  return {...args, passthrough: [...args.passthrough, DRAFT_SCALE]};
};

export const main = (argv, overrides = {}) =>
  runCli('draft', async (cleanup) => {
    const args = parseDraftArgs(argv, overrides);
    await render({...args, ...overrides}, cleanup);
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
