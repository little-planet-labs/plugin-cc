// Subframe hints: outside every blur window subframes(n) is [n / fps];
// inside a window the samples follow tc + (j - (N-1)/2) * s / (fps N),
// clamped into [a, b - 1/fps], and none lands on the other side of any cut
// than tc (property test over random windows, cuts and frames). A window with
// a cut strictly inside is rejected.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {mulberry32} from '../src/lib/rng.js';
import {crossedCut, subframeTimes, validateBlurWindows, windowForFrame} from '../src/lib/subframes.js';

const FPS_CHOICES = [24, 25, 30, 50, 60];

describe('subframeTimes', () => {
  it('outside every window a frame is one sample at exactly n / fps', () => {
    const windows = [{a: 1, b: 2, samples: 4}];
    for (const n of [0, 29, 60, 61, 100]) assert.deepEqual(subframeTimes(n, {fps: 30, shutter: 0.5, windows, cuts: []}), [n / 30]);
  });

  it('inside a window the samples follow the formula (centred on tc, spread over the shutter)', () => {
    const t = subframeTimes(45, {fps: 30, shutter: 0.5, windows: [{a: 1, b: 2, samples: 4}], cuts: []});
    const tc = 1.5;
    assert.deepEqual(t, [0, 1, 2, 3].map((j) => tc + ((j - 1.5) * 0.5) / (30 * 4)));
  });

  it('random windows, cuts and frames: formula, clamping into [a, b - 1/fps], never across a cut (property)', () => {
    const r = mulberry32(2026);
    for (let trial = 0; trial < 3000; trial++) {
      const fps = FPS_CHOICES[Math.floor(r() * FPS_CHOICES.length)];
      const shutter = 0.05 + r() * 0.95;
      const total = 200;
      const windows = Array.from({length: 1 + Math.floor(r() * 3)}, () => {
        const ia = Math.floor(r() * (total - 2));
        const ib = ia + 1 + Math.floor(r() * 20);
        return {a: ia / fps, b: Math.min(ib, total) / fps, samples: 2 + Math.floor(r() * 15)};
      });
      // Cuts only where no window has them strictly inside (as the engine guarantees), plus frame 0 at times.
      const cuts = [];
      for (let k = 0; k < 4; k++) {
        const ic = Math.floor(r() * total);
        if (windows.every((w) => !(ic > Math.round(w.a * fps) && ic < Math.round(w.b * fps)))) cuts.push(ic / fps);
      }
      cuts.sort((x, y) => x - y);
      validateBlurWindows(windows, cuts, fps);
      const n = Math.floor(r() * total);
      const tc = n / fps;
      const got = subframeTimes(n, {fps, shutter, windows, cuts});
      const w = windowForFrame(n, windows, fps);
      if (w === null) {
        assert.deepEqual(got, [tc]);
        continue;
      }
      assert.equal(got.length, w.samples);
      got.forEach((t, j) => {
        const raw = tc + ((j - (w.samples - 1) / 2) * shutter) / (fps * w.samples);
        const clamped = Math.min(Math.max(raw, w.a), w.b - 1 / fps);
        assert.ok(t >= w.a - 1e-12 && t <= w.b - 1 / fps + 1e-12, `sample ${t} outside [${w.a}, ${w.b - 1 / fps}]`);
        const crossesAt = cuts.find((c) => clamped < c !== tc < c);
        if (crossesAt === undefined) assert.equal(t, clamped, 'unclamped by any cut: follows the formula');
        else assert.equal(t, crossesAt, 'moved onto the cut, on tc\'s side');
        for (const c of cuts) assert.equal(t < c, tc < c, `sample ${t} crosses cut ${c} (tc ${tc})`);
      });
      assert.equal(crossedCut(got, tc, cuts), null);
    }
  });

  it('a sample before a cut that sits on tc is moved onto the cut', () => {
    const t = subframeTimes(30, {fps: 30, shutter: 1, windows: [{a: 1, b: 2, samples: 4}], cuts: [1]});
    assert.ok(t.every((x) => x >= 1));
    assert.equal(t[0], 1);
  });

  it('the window with the most samples governs overlapping windows', () => {
    const windows = [{a: 0, b: 2, samples: 2}, {a: 1, b: 1.5, samples: 8}];
    assert.equal(subframeTimes(35, {fps: 30, shutter: 0.5, windows, cuts: []}).length, 8);
    assert.equal(subframeTimes(10, {fps: 30, shutter: 0.5, windows, cuts: []}).length, 2);
  });
});

describe('validateBlurWindows', () => {
  it('rejects a window with a hard cut strictly inside, naming the window', () => {
    assert.throws(() => validateBlurWindows([{a: 1, b: 2, samples: 4, label: 'section "x"'}], [1.5], 30), /blur window \[1, 2\) \(section "x"\) has a hard cut inside it at 1\.5s/);
  });
  it('names who made the cut when told', () => {
    assert.throws(() => validateBlurWindows([{a: 1, b: 2, samples: 4, label: 'section "a"'}], [1.5], 30, () => 'start of section "b"'), /at 1\.5s \(start of section "b"\)/);
  });
  it('accepts a cut on a window edge', () => {
    validateBlurWindows([{a: 1, b: 2, samples: 4}], [1, 2], 30);
  });
  it('rejects unaligned edges, empty windows and sample counts outside 2..16', () => {
    assert.throws(() => validateBlurWindows([{a: 1.01, b: 2, samples: 4}], [], 30), /frame-aligned/);
    assert.throws(() => validateBlurWindows([{a: 1, b: 1, samples: 4}], [], 30), /b must be after a/);
    assert.throws(() => validateBlurWindows([{a: 1, b: 2, samples: 1}], [], 30), /samples must be an integer from 2 to 16/);
    assert.throws(() => validateBlurWindows([{a: 1, b: 2, samples: 17}], [], 30), /samples must be an integer from 2 to 16/);
  });
});
