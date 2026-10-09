import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Easing} from 'remotion';
import {beatKick, clamp01, decay, progressBetween, shakeOffset, springAt} from '../src/lib/motion';

describe('motion helpers', () => {
  it('clamp01 clamps (NaN -> 0)', () => {
    assert.deepEqual([clamp01(-1), clamp01(0.3), clamp01(2), clamp01(NaN)], [0, 0.3, 1, 0]);
  });

  it('progressBetween clamps to 0 before start and 1 after end', () => {
    assert.equal(progressBetween(5, 10, 20), 0);
    assert.equal(progressBetween(10, 10, 20), 0);
    assert.equal(progressBetween(15, 10, 20), 0.5);
    assert.equal(progressBetween(20, 10, 20), 1);
    assert.equal(progressBetween(99, 10, 20), 1);
    assert.equal(progressBetween(99, 10, 20, Easing.out(Easing.cubic)), 1);
    assert.equal(progressBetween(0, 10, 20, Easing.out(Easing.cubic)), 0);
    // Zero-length window is a step.
    assert.deepEqual([progressBetween(9, 10, 10), progressBetween(10, 10, 10)], [0, 1]);
  });

  it('springAt is 0 before at', () => {
    assert.equal(springAt(9, 10, 30), 0);
    assert.equal(springAt(-100, 10, 30), 0);
    assert.equal(springAt(10, 10, 30), 0); // a spring starts at rest on its first frame
    assert.ok(springAt(14, 10, 30) > 0);
    assert.ok(Math.abs(springAt(200, 10, 30) - 1) < 1e-3);
  });

  it('decay halves every half-life and is 0 with no event', () => {
    assert.equal(decay(0, 10), 1);
    assert.equal(decay(10, 10), 0.5);
    assert.equal(decay(Infinity, 10), 0);
    assert.equal(decay(-1, 10), 0);
  });

  it('beatKick peaks on the beat and is 0 at the next', () => {
    assert.equal(beatKick(0), 1);
    assert.equal(beatKick(1), 0);
    assert.equal(beatKick(0.5, 2), 0.25);
  });

  it('shakeOffset is deterministic and exactly zero outside its window', () => {
    const zero = {x: 0, y: 0, rotate: 0};
    assert.deepEqual(shakeOffset(99, 100, 'pos', 30, 10), zero);
    assert.deepEqual(shakeOffset(110, 100, 'pos', 30, 10), zero);
    assert.deepEqual(shakeOffset(500, 100, 'pos', 30, 10), zero);
    for (let f = 100; f < 110; f++) {
      const a = shakeOffset(f, 100, 'pos', 30, 10);
      assert.deepEqual(a, shakeOffset(f, 100, 'pos', 30, 10), `frame ${f} repeats`);
      assert.ok(Math.abs(a.x) <= 30 && Math.abs(a.y) <= 30, `frame ${f} within intensity`);
    }
    const first = shakeOffset(100, 100, 'pos', 30, 10);
    assert.ok(first.x !== 0 || first.y !== 0, 'moves inside the window');
    assert.notDeepEqual(first, shakeOffset(100, 100, 'other-seed', 30, 10));
  });
});
