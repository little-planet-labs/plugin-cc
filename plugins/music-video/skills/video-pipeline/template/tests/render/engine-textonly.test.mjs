// Text-only: with textonly=1 every pixel outside the lyric layer's visible
// word boxes (each word's mask box) is exactly black, while the same frame
// without textonly paints the world there; the lyric pixels are present; a
// frame with no active line (even one with a flash on #over) is entirely black.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('textonly', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      sections: [{id: 'a', scene: 'bright', start: 0}],
      lyrics: [line('a-1', 'Bright world words', 0.5, 1.5), line('a-2', 'Another line here', 2.0, 3.0)],
    });
  });
  after(() => proj?.cleanup());

  it('outside the word boxes a textonly frame is exactly black, the world shows there without textonly, and lyrics are lit', async () => {
    // 0: before any line; 6: the #over flash peak, no line; 20, 30: a-1 entering / held; 70: a-2.
    const r = await probe('textonly', {root: proj.root, scenes: 'tests/fixtures/scenes/timecode.js', frames: '0,6,20,30,70', textonly: true});
    for (const f of r.results) {
      assert.equal(f.outside_nonblack, 0, `frame ${f.frame}: ${f.outside_nonblack} non-black pixels outside the word boxes`);
      assert.ok(f.normal_outside_nonblack >= 0.99 * f.outside_pixels, `frame ${f.frame}: the world should paint outside the boxes without textonly`);
    }
    const byFrame = Object.fromEntries(r.results.map((f) => [f.frame, f]));
    for (const n of [0, 6]) {
      assert.equal(byFrame[n].boxes, 0, `frame ${n} has no active line`);
      assert.equal(byFrame[n].inside_lit, 0, `frame ${n} is entirely black`);
    }
    for (const n of [20, 30, 70]) {
      assert.ok(byFrame[n].boxes > 0 && byFrame[n].inside_lit > 500, `frame ${n}: lyric pixels present (${byFrame[n].inside_lit})`);
    }
    assert.deepEqual(r.console, []);
  });
});
