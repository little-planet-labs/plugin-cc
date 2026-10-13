// Held text: on a text-only capture, every frame across a line's hold window
// (lines() settled .. exitStart) is pixel-identical: once a word has settled
// it has no transform, filter or opacity change until its exit starts.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('held text', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      sections: [{id: 'a', scene: 'bright', start: 0}],
      lyrics: [line('a-1', 'Hold these quiet words', 0.3, 1.2), line('a-2', 'Next line later', 3.4, 3.9)],
    });
  });
  after(() => proj?.cleanup());

  for (const scale of [1, 2]) {
    it(`textonly frames across the hold window are pixel-identical (scale ${scale})`, async () => {
      const r = await probe('hold', {root: proj.root, scenes: 'tests/fixtures/scenes/timecode.js', line: 'a-1', textonly: true, scale});
      assert.ok(r.frames.length >= 10, `hold window covers ${r.frames.length} frames`);
      assert.ok(r.lit > 1000, 'the held line is on screen');
      assert.deepEqual(r.differ, [], `frames that differ from frame ${r.frames[0]}`);
    });
  }

  it("with enter 'none', frames across the hold window are pixel-identical and the window starts on the last word's reveal frame or later", async () => {
    const none = makeProject({
      sections: [{id: 'h', scene: 'exits', start: 0}],
      lyrics: [line('h-1', 'Hold these quiet words', 0.3, 1.2), line('h-2', 'Next line later', 3.4, 3.9)],
    });
    try {
      const r = await probe('hold', {root: none.root, scenes: 'tests/fixtures/scenes/engine-cases.js', line: 'h-1', textonly: true});
      const lastReveal = Math.round(r.info.fps * (0.3 + (3 * (1.2 - 0.3)) / 4));
      assert.ok(r.frames[0] >= lastReveal, `the hold starts on frame ${r.frames[0]}, before the last word's reveal frame ${lastReveal}`);
      assert.ok(r.frames.length >= 10 && r.lit > 1000);
      assert.deepEqual(r.differ, [], `frames that differ from frame ${r.frames[0]}`);
    } finally {
      none.cleanup();
    }
  });
});
