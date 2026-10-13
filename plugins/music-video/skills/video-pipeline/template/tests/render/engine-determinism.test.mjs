// Determinism: the same t renders identical pixels across two separate page
// loads and after a different seek history (far ahead, back to 0, half way),
// at scale 1 and at scale 2, on a scene with a canvas world under a camera,
// a rotating DOM card, a shatter, a shake, grain, a circle transition with a
// colour ring caught mid-way, and lyric text mid-entrance.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const SCENES = 'tests/fixtures/scenes/showcase.js';
// 10: a-1's first word mid blur-entrance; 24: 0.2 s after the shatter; 52: the circle transition into b mid-way; 70: b-1 entering.
const FRAMES = '10,24,52,70';

describe('determinism', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      sections: [
        {id: 'a', scene: 'showcase', start: 0},
        {id: 'b', scene: 'showcase', start: 2},
      ],
      lyrics: [line('a-1', 'Steady words hold still', 0.3, 1.5), line('b-1', 'Second line arrives', 2.2, 3.2)],
    });
  });
  after(() => proj?.cleanup());

  for (const scale of [1, 2]) {
    it(`the same frames hash identically across two page loads and after a different seek history (scale ${scale})`, async () => {
      const first = await probe('hash', {root: proj.root, scenes: SCENES, frames: FRAMES, scale, history: true});
      const second = await probe('hash', {root: proj.root, scenes: SCENES, frames: FRAMES, scale});
      assert.equal(new Set(first.hashes).size, 4, 'the probed frames differ from each other (the scene moves)');
      assert.deepEqual(second.hashes, first.hashes, 'second page load');
      assert.deepEqual(first.after_history, first.hashes, 'after seeking far ahead and back');
      assert.deepEqual(first.console, []);
    });
  }

  it('a canvas drawn carelessly (unrestored t-dependent clip, styles set only on some frames) still hashes identically across loads and seek histories', async () => {
    const leaky = makeProject({sections: [{id: 'l', scene: 'leaky', start: 0}]});
    try {
      const args = {root: leaky.root, scenes: 'tests/fixtures/scenes/engine-cases.js', frames: '3,4,10,11'};
      const first = await probe('hash', {...args, history: true});
      const second = await probe('hash', args);
      assert.equal(new Set(first.hashes).size, 4);
      assert.deepEqual(second.hashes, first.hashes, 'second page load');
      assert.deepEqual(first.after_history, first.hashes, 'after a different seek history');
    } finally {
      leaky.cleanup();
    }
  });
});
