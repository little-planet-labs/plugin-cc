// The worker's orphan guard, for real: SIGKILL the render orchestrator
// mid-render (no cleanup can run in it), and every worker it started, with
// its Chromium and its ffmpeg, is gone within a bound, because each worker
// notices its parent is gone and shuts down. The temp folder it leaves is
// swept as stale afterwards.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {after, before, describe, it} from 'node:test';
import {processFamily} from '../../scripts/lib/cli.mjs';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {sweepStaleTemp} from '../../scripts/lib/outputs.mjs';
import {freshDir, isAlive, spawnNode, trackPid, waitFor} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

/** [pid, command] of every process. */
const processes = () =>
  execFileSync('ps', ['-A', '-o', 'pid=,command='], {encoding: 'utf8', maxBuffer: 1 << 26})
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, command]) => [Number(pid), command]);

describe('render orphan guard', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    // 1800 frames in two 900-frame chunks: each worker has far more than 10 s of work left when it's orphaned
    // (about 0.05 s/frame), so only the guard can make it stop within the bound.
    proj = makeProject({pipeline: {fallbackSeconds: 60, render: {scale: 1, chunkSeconds: 30}}, sections: [{id: 's1', scene: 'timecode', start: 0}]});
  });
  after(() => proj?.cleanup());

  it('SIGKILL to the orchestrator: every worker, Chromium and ffmpeg it started exits within 10 s; its temp folder is then swept as stale', {timeout: 180_000}, async (t) => {
    const driver = join(freshDir('orphan'), 'driver.mjs');
    const out = join(proj.root, 'out/orphan.mp4');
    writeFileSync(
      driver,
      `import {main} from ${JSON.stringify(pathToFileURL(join(PROJECT_ROOT, 'scripts/render.mjs')).href)};\n` +
        `process.exitCode = await main(['--scenes=tests/fixtures/scenes/timecode.js', '--pool=2', '--out', ${JSON.stringify(out)}], ` +
        `{root: ${JSON.stringify(proj.root)}, envRoot: ${JSON.stringify(PROJECT_ROOT)}});\n`,
    );
    const {child, exited} = spawnNode(driver);
    // Both workers running, each with its encoder (started once the page is open).
    let family = [];
    await waitFor(
      () => {
        const ps = processes();
        const workers = ps.filter(([, c]) => c.includes('render_chunk.py') && c.includes(proj.root)).map(([p]) => p);
        if (workers.length < 2) return false;
        family = workers.flatMap((w) => [...processFamily(w)]);
        const commands = new Map(ps);
        const encoders = family.filter((p) => /^(\S*\/)?ffmpeg\s/.test(commands.get(p) ?? ''));
        const browsers = family.filter((p) => /chrome|headless/i.test(commands.get(p) ?? ''));
        return encoders.length === 2 && browsers.length >= 2;
      },
      'two workers with their Chromium and ffmpeg',
      90_000,
    );
    family.forEach(trackPid);
    assert.ok(family.length >= 8, `the families: ${family.length} processes`);

    child.kill('SIGKILL');
    assert.equal(await exited, null, 'the orchestrator died without exiting');
    const start = Date.now();
    await waitFor(() => family.every((p) => !isAlive(p)), 'every worker family process to exit', 10_000);
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds < 10, `took ${seconds}s`);
    t.diagnostic(`worker families gone ${seconds.toFixed(2)} s after the SIGKILL`);

    const outDir = join(proj.root, 'out');
    const left = readdirSync(outDir).filter((d) => d.startsWith(`.render-${child.pid}-`));
    assert.equal(left.length, 1, 'the killed render left its temp folder');
    assert.deepEqual(sweepStaleTemp(outDir), left);
    assert.deepEqual(readdirSync(outDir), [], 'nothing else was written');
  });
});
