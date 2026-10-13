// The render pool's hard cap (scripts/lib/pool.mjs): with cap N, real worker
// processes (fakes that log their own start and end) never overlap more than
// N at any instant, and the pool does reach N (it isn't serialised by
// accident), with and without a stagger. The workers hold until the test
// releases them, so reaching N never depends on how fast processes start. The default cap is 2, a pool below
// 1 is refused, a pool above 2 warns, and a failing discard fails the pool
// cleanly.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {spawnGroup} from '../scripts/lib/cli.mjs';
import {poolSize, runPool} from '../scripts/lib/pool.mjs';
import {main as renderMain, parseRenderArgs, resolveRender} from '../scripts/render.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {fakeBin, freshDir, quiet, silence, waitFor} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, maxOverlap, readLog, workerRuns} from './fixtures/render-fakes.mjs';

const BOUNDED = {timeout: 60_000};

/**
 * A worker that logs {event: 'start'} as it starts, holds until `release` exists (forever when it never does),
 * then logs {event: 'end'} and exits 0. Times come from the worker's own clock.
 */
const holder = (log, release) =>
  fakeBin(
    'worker',
    `const now = () => performance.timeOrigin + performance.now();
const say = (event) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({event, item: Number(args[0]), pid: process.pid, time: now()}) + '\\n');
say('start');
const t = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(release)})) {
    clearInterval(t);
    say('end');
  }
}, 10);`,
  );
const started = (log) => readLog(log).filter((e) => e.event === 'start').length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

describe('pool cap', () => {
  for (const [cap, staggerMs] of [[1, 20], [2, 20], [3, 20], [2, 0], [3, 0]]) {
    it(`with cap ${cap} and 7 chunks (stagger ${staggerMs} ms), workers never overlap more than ${cap} and do reach ${cap}`, BOUNDED, async () => {
      const dir = freshDir('pool');
      const log = join(dir, 'runs.log');
      const release = join(dir, 'release');
      const bin = holder(log, release);
      const items = Array.from({length: 7}, (_, i) => i);
      const done = runPool({
        items,
        cap,
        retries: 0,
        staggerMs,
        start: (item) => spawnGroup(bin, [String(item)], {stdio: 'ignore'}),
        check: async () => null,
        discard: () => {},
      });
      // The first workers hold: the pool must fill exactly to the cap, and start nothing more while they run.
      await waitFor(() => started(log) >= cap, `${cap} workers to start`, 30_000);
      await sleep(300);
      assert.equal(started(log), cap, 'a worker beyond the cap started while the first ones were running');
      writeFileSync(release, '');
      await done;
      const runs = workerRuns(log);
      assert.deepEqual(runs.map((r) => r.item).sort(), items, 'every chunk ran exactly once');
      assert.equal(maxOverlap(runs), cap, `max overlap from the workers' own start/end times`);
    });
  }

  it('a discard that throws fails the pool cleanly: it rejects with that error and the other workers are stopped and waited for', BOUNDED, async () => {
    const dir = freshDir('pool');
    const log = join(dir, 'runs.log');
    // The healthy worker runs until it is killed; the failing one exits only once the healthy one is running,
    // so the fatal discard always finds a live worker to stop.
    const healthy = holder(log, join(dir, 'never-released'));
    const failing = fakeBin(
      'fail',
      `const t = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(log)}) && fs.readFileSync(${JSON.stringify(log)}, 'utf8').includes('"event":"start","item":0')) process.exit(2);
}, 10);`,
    );
    const handles = [];
    let healthyEnded = false;
    let healthyEndedBeforeReject = null;
    await assert.rejects(
      runPool({
        items: [0, 1],
        cap: 2,
        retries: 2,
        staggerMs: 0,
        killGraceMs: 500,
        start: (item) => {
          const h = spawnGroup(item === 1 ? failing : healthy, [String(item)], {stdio: 'ignore'});
          if (item === 0) h.exited.then(() => (healthyEnded = true));
          handles.push(h);
          return h;
        },
        check: async () => null,
        discard: () => {
          throw new Error('EACCES: could not remove the chunk');
        },
      }).catch((err) => {
        healthyEndedBeforeReject = healthyEnded;
        throw err;
      }),
      /EACCES: could not remove the chunk/,
    );
    const settled = await Promise.all(handles.map((h) => h.exited));
    assert.equal(settled.length, 2, 'no retry was started after the fatal discard');
    assert.equal(settled[1].code, 2, 'the failing worker failed on its own');
    assert.equal(settled[0].signal, 'SIGTERM', 'the healthy worker (which never ends by itself) was stopped by the pool');
    assert.equal(healthyEndedBeforeReject, true, 'the pool waited for the stopped worker before rejecting');
  });

  it('a pool below 1 is refused: --pool=0, pipeline render.pool 0, and runPool cap 0', async () => {
    assert.throws(() => parseRenderArgs(['--pool=0']), /--pool must be a whole number of workers, at least 1/);
    assert.throws(() => parseRenderArgs(['--pool=1.5']), /--pool must be a whole number/);
    assert.throws(() => poolSize(0, 'x'), /at least 1/);
    await assert.rejects(runPool({items: [1], cap: 0, retries: 0, start: () => assert.fail('started'), check: async () => null, discard: () => {}}), /at least 1/);
    const p = makeProject({pipeline: {render: {scale: 1, pool: 0}}});
    projects.push(p);
    assert.throws(() => resolveRender(parseRenderArgs([]), {root: p.root}), /render\.pool must be a positive integer/);
  });

  it('the default cap is 2 when neither --pool nor pipeline.json sets it, and a render then runs exactly 2 workers at once', BOUNDED, async () => {
    const p = makeProject({pipeline: {render: {scale: 1, chunkSeconds: 0.5}}});
    projects.push(p);
    assert.equal(resolveRender(parseRenderArgs([]), {root: p.root}).pool, 2);
    assert.equal(resolveRender(parseRenderArgs(['--pool=3']), {root: p.root}).pool, 3);
    const dir = freshDir('render-default');
    const log = join(dir, 'events.log');
    const hold = join(dir, 'release');
    const done = silence(() =>
      renderMain([], {
        root: p.root,
        envRoot: PROJECT_ROOT,
        pythonBin: fakePython({log, frames: 120, sleepMs: 0, holdFile: hold}),
        ffmpegBin: fakeFfmpeg({log}),
        ffprobeBin: fakeFfprobe(),
        staggerMs: 20,
      }),
    );
    // The first workers hold until released: exactly 2 start, and no third while they run.
    const workerStarts = () => readLog(log).filter((e) => e.event === 'start').length;
    await waitFor(() => workerStarts() >= 2, 'two workers to start', 30_000);
    await sleep(300);
    assert.equal(workerStarts(), 2, 'a third worker started while two were running');
    writeFileSync(hold, '');
    const code = await done;
    assert.equal(code, 0);
    const runs = workerRuns(log);
    assert.equal(runs.length, 8, '120 frames in 15-frame chunks');
    assert.equal(maxOverlap(runs), 2);
  });

  it('a pool above 2 is allowed but warns that each worker runs a Chromium and an encoder; 2 does not warn', BOUNDED, async () => {
    const p = makeProject({pipeline: {render: {scale: 1, chunkSeconds: 1}}});
    projects.push(p);
    const go = async (argv) => {
      const log = join(freshDir('render-warn'), 'events.log');
      const {result, output} = await quiet(() =>
        renderMain(argv, {root: p.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: 120, sleepMs: 10}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
      );
      assert.equal(result, 0, output.join('\n'));
      return output.filter((l) => /warning: pool/.test(l));
    };
    assert.deepEqual(await go(['--pool=3']), ['render: warning: pool 3: each worker runs a Chromium and an encoder; this machine-load default is 2']);
    assert.deepEqual(await go(['--pool=2']), []);
  });
});
