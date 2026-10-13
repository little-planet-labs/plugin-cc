// Blur only in hinted windows: outside every blur window a captured frame is
// byte-identical to one plain capture at n / fps; inside a window it equals
// the exact average of the captures at subframes(n); and the capture core
// refuses a sample list that crosses a hard cut.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const SCENES = 'tests/fixtures/scenes/timecode.js';

describe('subframe blur', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    // 'moving' declares a 4-sample window over [0.5, 1.0) = frames 15..29; 'timecode-cut' cuts at 3.0 s.
    proj = makeProject({sections: [{id: 'm', scene: 'moving', start: 0}, {id: 'c', scene: 'timecode-cut', start: 3}]});
  });
  after(() => proj?.cleanup());

  it('frames outside the window equal one plain capture; frames inside equal the average of their subframe captures', async () => {
    const r = await probe('blur', {root: proj.root, scenes: SCENES, frames: '10,14,15,20,29,30'});
    assert.deepEqual(r.windows, [{a: 0.5, b: 1, samples: 4}]);
    const at = Object.fromEntries(r.results.map((f) => [f.frame, f]));
    for (const n of [10, 14, 30]) {
      assert.equal(at[n].samples.length, 1, `frame ${n} has one sample`);
      assert.equal(at[n].equals_plain, true, `frame ${n} equals a plain capture`);
    }
    for (const n of [15, 20, 29]) {
      assert.equal(at[n].samples.length, 4, `frame ${n} has 4 samples`);
      assert.equal(at[n].samples_differ, true, `frame ${n}: the box moves between samples`);
      assert.equal(at[n].equals_average, true, `frame ${n} equals the average of its sample captures`);
      assert.equal(at[n].equals_plain, false, `frame ${n} is blurred, not a plain capture`);
    }
    assert.deepEqual(r.console, []);
  });

  it('capture refuses a sample list that crosses a hard cut', async () => {
    const r = await probe('crosscut', {root: proj.root, scenes: SCENES});
    assert.equal(r.cut, 3);
    assert.equal(r.refused, true);
    assert.match(r.message, /cross the hard cut at 3/);
  });
});
