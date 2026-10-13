// `async with Capture(...)` on a page that fails to boot raises CaptureError
// and leaves no Chromium running (open() closes what it started).
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('Capture.open failure', {skip: missing ?? false}, () => {
  it('async with on an unknown scene key raises CaptureError and no tagged Chromium survives', async () => {
    const proj = makeProject({sections: [{id: 'x', scene: 'nope', start: 0}]});
    try {
      const r = await probe('asyncwith', {root: proj.root, scenes: 'tests/fixtures/scenes/timecode.js', marker: `--mv-asyncwith-${process.pid}`});
      assert.match(r.error ?? '', /page error: unknown scene key "nope"/);
      assert.deepEqual(r.alive, []);
    } finally {
      proj.cleanup();
    }
  });
});
