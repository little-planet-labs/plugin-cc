// Easings and springs land exactly: every easing is exactly 0 at u <= 0 and
// exactly 1 at u >= 1; a spring is exactly 0 up to its start and exactly 1
// from its settle time, and never overshoots past the raw spring's peak
// (bounded by e^(-z pi / sqrt(1 - z^2))) for damping >= 0.72.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {cubicBezier, EASE, ease, progress} from '../src/lib/ease.js';
import {MIN_DAMPING, spring, springConfig, springOvershoot, SPRING_PRESETS, springSettle} from '../src/lib/springs.js';
import {mulberry32} from '../src/lib/rng.js';

describe('easings', () => {
  for (const [name, fn] of Object.entries(EASE)) {
    it(`${name} is exactly 0 for u <= 0 and exactly 1 for u >= 1, and within [0, 1] between`, () => {
      for (const u of [-5, -1e-12, 0]) assert.equal(fn(u), 0, `${name}(${u})`);
      for (const u of [1, 1 + 1e-12, 7]) assert.equal(fn(u), 1, `${name}(${u})`);
      for (let i = 1; i < 200; i++) {
        const v = fn(i / 200);
        assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `${name}(${i / 200}) = ${v}`);
      }
    });
  }

  it('a custom easing function gets exact ends too (an easing that misses 0 and 1 at the ends)', () => {
    const sloppy = ease((u) => 1e-9 + u * 0.999999);
    assert.equal(sloppy(0), 0);
    assert.equal(sloppy(1), 1);
  });

  it('cubicBezier(.6, 0, .2, 1) is monotonic and lies on its curve (checked against an independent bisection)', () => {
    const f = cubicBezier(0.6, 0, 0.2, 1);
    const bx = (s) => 3 * 0.6 * s * (1 - s) ** 2 + 3 * 0.2 * s * s * (1 - s) + s ** 3;
    const by = (s) => 3 * s * s * (1 - s) + s ** 3;
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const u = i / 100;
      const v = f(u);
      assert.ok(v >= prev - 1e-12, `not monotonic at ${u}`);
      prev = v;
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 80; k++) (bx((lo + hi) / 2) < u ? (lo = (lo + hi) / 2) : (hi = (lo + hi) / 2));
      assert.ok(Math.abs(v - by((lo + hi) / 2)) < 1e-6, `off the curve at ${u}`);
    }
  });

  it('progress is exactly 0 up to t0 and exactly 1 from t0 + dur; a zero-length move is a step at t0', () => {
    assert.equal(progress(0.99, 1, 0.5), 0);
    assert.equal(progress(1, 1, 0.5), 0);
    assert.equal(progress(1.5, 1, 0.5), 1);
    assert.equal(progress(2, 1, 0.5, 'o5'), 1);
    assert.equal(progress(0.999, 1, 0), 0);
    assert.equal(progress(1, 1, 0), 1);
  });

  it('an unknown easing name fails naming it', () => {
    assert.throws(() => ease('bouncy'), /unknown easing "bouncy"/);
  });
});

describe('springs', () => {
  for (const name of Object.keys(SPRING_PRESETS)) {
    it(`${name}: exactly 0 up to its start, exactly 1 from start + settle, bounded overshoot between`, () => {
      const at = 3.2;
      const settle = springSettle(name);
      assert.ok(settle > 0.1 && settle < 1.5, `settle ${settle}s`);
      assert.equal(spring(at - 1, at, name), 0);
      assert.equal(spring(at, at, name), 0);
      assert.equal(spring(at + settle, at, name), 1);
      assert.equal(spring(at + settle + 1e-9, at, name), 1);
      assert.equal(spring(at + 50, at, name), 1);
      const bound = 1 + springOvershoot(name);
      for (let i = 1; i < 1000; i++) {
        const v = spring(at + (settle * i) / 1000, at, name);
        assert.ok(v >= 0 && v <= bound + 1e-12, `${name} at ${i / 1000} of settle: ${v} > ${bound}`);
      }
    });
  }

  it('random configs with damping >= 0.72 land exactly and stay under the overshoot bound (property)', () => {
    const r = mulberry32(72);
    for (let k = 0; k < 300; k++) {
      const cfg = {freq: 0.5 + r() * 6, damping: MIN_DAMPING + r() * 0.6};
      const settle = springSettle(cfg);
      const bound = 1 + springOvershoot(cfg);
      assert.ok(springOvershoot(cfg) <= Math.exp((-MIN_DAMPING * Math.PI) / Math.sqrt(1 - MIN_DAMPING ** 2)) + 1e-12);
      assert.equal(spring(settle, 0, cfg), 1);
      assert.equal(spring(-r(), 0, cfg), 0);
      for (let i = 0; i < 200; i++) {
        const v = spring(r() * settle, 0, cfg);
        assert.ok(v >= 0 && v <= bound + 1e-12, `${JSON.stringify(cfg)}: ${v}`);
      }
    }
  });

  it('damping below 0.72 is refused unless the bounce is deliberate', () => {
    assert.throws(() => springConfig({freq: 2, damping: 0.5}), /below 0\.72/);
    assert.deepEqual(springConfig({freq: 2, damping: 0.5}, {allowBounce: true}), {freq: 2, damping: 0.5});
    assert.throws(() => springConfig('wobbly'), /unknown spring preset "wobbly"/);
  });
});
