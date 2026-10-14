// `pnpm draft [--out <mp4>] [--pool=<n>] [--chunk-seconds=<s>] [--frames=<a>-<b>] [--scenes=<module>] [--pipeline=<config>]`
//
// A quick render for judging timing and motion: pipeline.json `draft` settings
// (scale 0.5 = 960x540 from the 1920x1080 page, CRF 23, veryfast, JPEG
// captures), one capture per frame (no motion blur). It is `pnpm render`'s
// pipeline (scripts/render.mjs render(), not a copy): the same chunked pool
// with its cap and retries, chunk verification, concat, and the same audio
// mux, so a draft's audio sits exactly where the master's does.
//
// The output defaults to out/draft.mp4 (out/draft-frames-<a>-<b>.mp4 with
// --frames) and is never the master: an --out that
// resolves to out/<outputName>.mp4 (compared case-insensitively) is refused.
// Per critique round: `pnpm draft --out out/draft-r<n>.mp4`.
//
// --pipeline=<config> drafts with another config (its page size and `draft`
// settings; src/pipeline.vertical.json drafts at 540x960). Its default output
// is out/<outputName>-draft.mp4, and no draft ever writes any config's master.
import {realpathSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runCli} from './lib/cli.mjs';
import {parseRenderArgs, render, resolveRender} from './render.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The draft's settings (resolveRender in draft mode).
 * @param {string[]} argv
 * @param {{root?: string}} [where]
 */
export const parseDraftArgs = (argv, {root = projectRoot} = {}) => resolveRender(parseRenderArgs(argv, 'draft'), {root, mode: 'draft'});

export const main = (argv, overrides = {}) =>
  runCli(
    'draft',
    async (cleanup) => {
      await render(parseDraftArgs(argv, {root: overrides.root ?? projectRoot}), cleanup, overrides);
    },
    overrides.killGraceMs === undefined ? {} : {killGraceMs: overrides.killGraceMs},
  );

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
