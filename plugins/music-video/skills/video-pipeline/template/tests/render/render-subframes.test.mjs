// Subframes in the real master: on a fixture with two blur windows and hard
// cuts (one window ending on the cut at 1.0 s, one at [2.0, 2.5), after the cut at 1.5 s), the sample
// times each worker actually captured (its --sample-log) equal
// subframes(n) for every frame, hold more than one sample only inside a
// window, and never cross a cut. The manifest records the same windows and cuts.
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {crossedCut, subframeTimes} from '../../src/lib/subframes.js';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('render subframes', {skip: missing ?? false}, () => {
  let proj;
  let logs;
  before(() => {
    // 'moving' declares a 4-sample blur window over [start + 0.5, start + 1.0). Section starts are hard cuts.
    proj = makeProject({
      pipeline: {fallbackSeconds: 3, render: {scale: 1, chunkSeconds: 0.5, shutter: 0.5}},
      sections: [
        {id: 's1', scene: 'moving', start: 0},
        {id: 's2', scene: 'timecode', start: 1},
        {id: 's3', scene: 'moving', start: 1.5},
      ],
    });
    logs = mkdtempSync(join(tmpdir(), 'mv-samples-'));
  });
  after(() => {
    proj?.cleanup();
    if (logs) rmSync(logs, {recursive: true, force: true});
  });

  it('the captured sample times equal subframes(n) for every frame, multi-sample only inside windows, never across a cut', {timeout: 240_000}, async () => {
    const out = join(proj.root, 'out/blur.mp4');
    const {result, output} = await quiet(() =>
      renderMain(['--scenes=tests/fixtures/scenes/timecode.js', '--out', out], {root: proj.root, envRoot: PROJECT_ROOT, sampleLog: logs}),
    );
    assert.equal(result, 0, output.join('\n'));
    const manifest = JSON.parse(readFileSync(join(proj.root, 'out/blur.manifest.json'), 'utf8'));
    const fps = manifest.fps;
    assert.deepEqual(manifest.cuts, [30, 45]);
    assert.deepEqual(manifest.blurWindows, [{from: 15, to: 30, samples: 4}, {from: 60, to: 75, samples: 4}]);
    const windows = manifest.blurWindows.map((w) => ({a: w.from / fps, b: w.to / fps, samples: w.samples}));
    const cuts = manifest.cuts.map((f) => f / fps);

    const captured = new Map();
    for (const f of readdirSync(logs)) {
      for (const l of readFileSync(join(logs, f), 'utf8').trim().split('\n')) {
        const {n, samples} = JSON.parse(l);
        assert.equal(captured.has(n), false, `frame ${n} captured twice`);
        captured.set(n, samples);
      }
    }
    assert.equal(captured.size, manifest.frames, 'every frame logged once');
    let blurred = 0;
    for (let n = 0; n < manifest.frames; n++) {
      const got = captured.get(n);
      const want = subframeTimes(n, {fps, shutter: 0.5, windows, cuts});
      assert.equal(got.length, want.length, `frame ${n}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      got.forEach((t, j) => assert.ok(Math.abs(t - want[j]) < 1e-9, `frame ${n} sample ${j}: ${t} vs ${want[j]}`));
      const inWindow = manifest.blurWindows.some((w) => n >= w.from && n < w.to);
      assert.equal(got.length > 1, inWindow, `frame ${n}: ${got.length} samples, ${inWindow ? 'inside' : 'outside'} a window`);
      assert.equal(crossedCut(got, n / fps, cuts), null, `frame ${n} crosses a cut`);
      if (got.length > 1) blurred++;
    }
    assert.equal(blurred, 30, 'both windows were rendered with blur');
  });
});
