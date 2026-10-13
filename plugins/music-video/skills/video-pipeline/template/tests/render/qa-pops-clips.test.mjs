// `pnpm pops` on real clips (ffmpeg + the .venv's numpy): a pop and a
// one-frame flash injected at known frames are found at those frames and
// nowhere else; still and slowly panning clips report nothing; a hard cut is a
// pop unless it is listed (by hand or from the render's manifest sidecar,
// --cuts=auto), within ±1 frame; --fail exits 1 only on an unexcused finding.
import assert from 'node:assert/strict';
import {readdirSync, writeFileSync} from 'node:fs';
import {before, describe, it} from 'node:test';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {buildManifest, manifestPath} from '../../scripts/lib/outputs.mjs';
import {main as popsMain, pops} from '../../scripts/pops.mjs';
import {freshDir, quiet} from '../fixtures/cli-fakes.mjs';
import {clip, measureEnvMissing} from '../fixtures/qa-clips.mjs';

const missing = measureEnvMissing();
const python = venvPython(PROJECT_ROOT);

describe('pops on real clips', {skip: missing ?? false}, () => {
  const clips = {events: '', still: '', pan: '', cut: ''};
  before(() => {
    const dir = freshDir('pops-clips');
    // A 30x30 white block sliding 1 px per frame on dark gray; frame 30 is all white (a one-frame
    // flash); from frame 50 the block is 60 px further on (a pop).
    clips.events = clip(dir, 'events', '320x180', 3, 'if(eq(N,30),255,if(between(X,20+N+60*gte(N,50),50+N+60*gte(N,50))*between(Y,60,90),255,64))');
    clips.still = clip(dir, 'still', '320x180', 2, '96+40*sin(X/9)*cos(Y/7)');
    clips.pan = clip(dir, 'pan', '320x180', 3, '128+80*sin((X+2*N)/12)');
    // Two still pictures with a hard cut: frame 45 is the first frame of the second.
    clips.cut = clip(dir, 'cut', '320x180', 3, 'if(lt(N,45),128+80*sin(X/9),128+80*cos(Y/5))');
  });
  const measure = async (input, cuts = []) => {
    const tmpRoot = freshDir('tmp');
    const cleanup = new Set();
    try {
      return (await quiet(() => pops({input, cuts, root: PROJECT_ROOT, tmpRoot, pythonBin: python}, cleanup))).result;
    } finally {
      for (const fn of cleanup) fn();
      assert.deepEqual(readdirSync(tmpRoot), []);
    }
  };
  const frames = (list) => list.map((p) => p.frame);
  /** Write the sidecar a render of `input` (90 frames) would, with hard cuts at `cuts` (video frames). */
  const sidecar = (input, cuts) =>
    writeFileSync(
      manifestPath(input),
      JSON.stringify(buildManifest({fps: 30, first: 0, last: 90, width: 320, height: 180, scale: 1, textonly: false, cuts: cuts.map((f) => f / 30), blurWindows: [], blur: false, source: 'src/scenes/index.js'})),
    );

  it('pops detects an injected one-frame flash and a pop spike at their frames', async () => {
    const r = await measure(clips.events);
    assert.equal(r.frames, 90);
    assert.deepEqual(frames(r.flashes), [30]);
    assert.deepEqual(frames(r.pops), [50]);
  });

  it('pops flags nothing on a still clip or a slow pan', async () => {
    for (const input of [clips.still, clips.pan]) {
      const r = await measure(input);
      assert.deepEqual([frames(r.pops), frames(r.flashes)], [[], []], input);
    }
  });

  it('pops reports a hard cut as a pop unless it is listed with --cuts (±1 frame)', async () => {
    assert.deepEqual(frames((await measure(clips.cut)).pops), [45]);
    for (const cut of [44, 45, 46]) {
      const r = await measure(clips.cut, [cut]);
      assert.deepEqual(frames(r.pops), [], `--cuts=${cut}`);
      assert.deepEqual(r.cuts.map((c) => [c.frame, c.cut]), [[45, cut]]);
    }
    assert.deepEqual(frames((await measure(clips.cut, [47])).pops), [45], 'a cut 2 frames off is not this one');
  });

  it("pops --cuts=auto reads the cuts from the render's manifest sidecar", async () => {
    sidecar(clips.cut, [45]);
    const listed = await measure(clips.cut, 'auto');
    assert.deepEqual(listed.listedCuts, [45]);
    assert.deepEqual(frames(listed.pops), []);
    assert.deepEqual(listed.cuts.map((c) => [c.frame, c.cut]), [[45, 45]]);
    sidecar(clips.cut, [20]);
    const other = await measure(clips.cut, 'auto');
    assert.deepEqual(frames(other.pops), [45], 'the sidecar cut is elsewhere, so the pop is a finding');
    assert.deepEqual(other.missedCuts, [20]);
    // A flash next to a sidecar cut is still a flash.
    sidecar(clips.events, [30, 50]);
    const events = await measure(clips.events, 'auto');
    assert.deepEqual([frames(events.pops), frames(events.flashes)], [[], [30]]);
  });

  it('pops --fail exits 1 on an unexpected finding and 0 when clean or when every finding is a listed cut', async () => {
    const code = async (argv) => {
      const tmpRoot = freshDir('tmp');
      const {result} = await quiet(() => popsMain(argv, {root: PROJECT_ROOT, tmpRoot, pythonBin: python}));
      assert.deepEqual(readdirSync(tmpRoot), []);
      return result;
    };
    assert.equal(await code(['--in', clips.events, '--fail']), 1);
    assert.equal(await code(['--in', clips.events, '--fail', '--cuts=50']), 1, 'the flash is still a finding');
    assert.equal(await code(['--in', clips.pan, '--fail']), 0);
    assert.equal(await code(['--in', clips.events]), 0, 'without --fail findings are only listed');
    const cut = clip(freshDir('pops-cut'), 'cut2', '320x180', 3, 'if(lt(N,45),128+80*sin(X/9),128+80*cos(Y/5))');
    assert.equal(await code(['--in', cut, '--fail']), 1);
    assert.equal(await code(['--in', cut, '--fail', '--cuts=45']), 0);
    sidecar(cut, [45]);
    assert.equal(await code(['--in', cut, '--fail', '--cuts=auto']), 0);
  });
});
