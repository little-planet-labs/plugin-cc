// Held text, as poses: from a word's settle time its pose is HELD (transform
// none, opacity exactly 1, filter none, unclipped) for every entrance and
// every spring preset; before it, the pose moves; exits start from v > 0.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {ENTRANCES, enterPose, enterProgress, enterSettle, exitPose, EXITS, HELD} from '../src/lib/text-motion.js';

describe('word poses', () => {
  for (const enter of ENTRANCES) {
    for (const spring of [undefined, 'snappy', 'heavy']) {
      it(`${enter}${spring ? ` (spring ${spring})` : ''}: HELD from the settle time on`, () => {
        const style = {enter, spring};
        const sung = 0.4;
        const settle = enterSettle(style, sung);
        for (const dt of [settle, settle + 1e-9, settle + 0.5, settle + 30]) {
          assert.equal(enterProgress(style, dt, sung), 1);
          assert.deepEqual(enterPose(enter, enterProgress(style, dt, sung), {dt, wordDur: sung, chars: 5}), HELD);
        }
        if (enter !== 'none' && settle > 0) {
          const mid = enterPose(enter, enterProgress(style, settle / 4, sung), {dt: settle / 4, wordDur: sung, chars: 5});
          assert.notDeepEqual(mid, HELD, 'the entrance moves before it settles');
        }
      });
    }
  }

  it('HELD is no transform, opacity exactly 1, no filter, no clip', () => {
    assert.deepEqual(HELD, {transform: 'none', opacity: 1, filter: 'none', clip: false, chars: null});
  });

  for (const exit of EXITS) {
    it(`exit ${exit} returns a valid pose mid-way`, () => {
      const p = exitPose(exit, 0.5, {r1: 0.3, r2: -0.7, sx: 1, sy: 1, dx: 100, dy: -50});
      assert.ok(p.opacity >= 0 && p.opacity <= 1);
      assert.equal(typeof p.transform, 'string');
    });
  }
});
