// SIGINT / SIGTERM to `pnpm render` mid-pool: every worker and everything it
// started is killed (a grandchild in the worker's process group, standing in
// for ffmpeg, and one in a process group of its own that ignores SIGTERM,
// standing in for Playwright's Chromium), the temp folder is removed, no
// output is written, and the exit code is 130 / 143.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {exitCodeFor, freshDir, isAlive, spawnNode, trackPid, waitFor} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, readLog} from './fixtures/render-fakes.mjs';

const BOUNDED = {timeout: 60_000};
const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

const renderUrl = pathToFileURL(join(PROJECT_ROOT, 'scripts/render.mjs')).href;

describe('render signal shutdown', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    it(`${signal} mid-render kills every worker and grandchild, removes the temp folder, writes nothing, exits ${exitCodeFor(signal)}`, BOUNDED, async () => {
      const p = makeProject({pipeline: {render: {scale: 1, chunkSeconds: 0.5}}});
      projects.push(p);
      const log = join(freshDir('signal'), 'events.log');
      const overrides = {
        root: p.root,
        envRoot: PROJECT_ROOT,
        pythonBin: fakePython({log, frames: 120, sleepMs: 60_000, grandchildren: true}),
        ffmpegBin: fakeFfmpeg({log}),
        ffprobeBin: fakeFfprobe(),
        staggerMs: 0,
        killGraceMs: 1000,
      };
      const driver = join(freshDir('driver'), 'driver.mjs');
      writeFileSync(
        driver,
        `import {main} from ${JSON.stringify(renderUrl)};\nprocess.exitCode = await main(['--pool=2'], ${JSON.stringify(overrides)});\n`,
      );
      const {child, exited} = spawnNode(driver);
      // Two workers running, each with its two grandchildren.
      await waitFor(() => readLog(log).filter((e) => e.event === 'grandchild').length === 4, 'two workers and their grandchildren', 20_000);
      const entries = readLog(log);
      const pids = [...entries.filter((e) => e.event === 'start').map((e) => e.pid), ...entries.filter((e) => e.event === 'grandchild').map((e) => e.pid)];
      pids.forEach(trackPid);
      assert.equal(pids.length, 6);
      assert.ok(pids.every(isAlive), 'all running before the signal');
      const outDir = join(p.root, 'out');
      assert.ok(readdirSync(outDir).some((f) => f.startsWith('.render-')), 'the temp folder exists mid-render');

      child.kill(signal);
      assert.equal(await exited, exitCodeFor(signal));
      const alive = pids.filter(isAlive);
      assert.deepEqual(alive, [], 'every worker and grandchild is gone when the render exits');
      assert.deepEqual(readdirSync(outDir), [], 'no output, no manifest, no temp folder');
      assert.equal(readLog(log).filter((e) => e.event === 'start').length, 2, 'no worker started after the signal');
      assert.equal(existsSync(join(outDir, 'fixture.mp4')), false);
    });
  }
});
