// Behaviours ported from the old Remotion template, checked in the page:
// - ctx.beats / ctx.downbeats: an event on a section boundary belongs to
//   exactly one section, by rounded frame (12.016 s at 30 fps is frame 360);
// - ctx.logo: a variant missing from brand.json falls back to logo.path, a
//   present one is used, and a missing file is hidden with a warning, never a
//   boot error;
// - lyric exits never reflow: while one word travels out (left, fall,
//   shrink, suck) and after it is gone, every word's mask box stays put and
//   the words still held don't move.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {captureEnvMissing, fixtureBrand, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const SCENES = 'tests/fixtures/scenes/engine-cases.js';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#f00"/></svg>';

const withProject = async (o, fn) => {
  const proj = makeProject(o);
  try {
    return await fn(proj.root);
  } finally {
    proj.cleanup();
  }
};

describe('ported behaviours', {skip: missing ?? false}, () => {
  it('a beat or downbeat on a section boundary belongs to exactly one section, by rounded frame', async () => {
    const analysis = {
      version: 1, source: 'audio/track.wav', generator: 'test', fps: 30, durationSeconds: 20, durationInFrames: 600, tempo: 120, beatsPerBar: 4,
      beats: [11.5, 11.983, 12.016, 12.5], downbeats: [11.983, 12.016], onsets: [],
      bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]}, energy: {low: [], mid: [], high: []},
    };
    const r = await withProject(
      {analysis, files: {'public/audio/track.wav': 'RIFF'}, sections: [{id: 'a', scene: 'beats', start: 0}, {id: 'b', scene: 'beats', start: 12}]},
      (root) => probe('evalat', {root, scenes: SCENES, js: "[...document.querySelectorAll('[data-section]')].map((r) => [r.dataset.section, JSON.parse(r.dataset.beats), JSON.parse(r.dataset.downbeats)])"}),
    );
    assert.equal(r.timing, 'analysis');
    const [[, aBeats, aDown], [, bBeats, bDown]] = r.values[0];
    assert.deepEqual(aBeats, [345 / 30, 359 / 30], 'a: 11.5 s and 11.983 s (frame 359)');
    assert.deepEqual(bBeats, [360 / 30, 375 / 30], 'b: 12.016 s (frame 360) and 12.5 s');
    assert.deepEqual(aDown, [359 / 30]);
    assert.deepEqual(bDown, [360 / 30], 'the boundary downbeat is in b only');
  });

  const LOGOS = "[...document.querySelectorAll('img[data-variant]')].map((i) => [i.dataset.variant, decodeURIComponent(new URL(i.src).pathname), getComputedStyle(i).display, i.naturalWidth])";

  it('ctx.logo: a missing onDark variant falls back to logo.path; a present one is used', async () => {
    const fallback = await withProject(
      {brand: fixtureBrand({logo: {path: 'public/brand/logo.svg'}}), files: {'public/brand/logo.svg': SVG}, sections: [{id: 's', scene: 'logos', start: 0}]},
      (root) => probe('evalat', {root, scenes: SCENES, js: LOGOS}),
    );
    assert.deepEqual(fallback.values[0], [['onDark', '/public/brand/logo.svg', 'block', 200], ['default', '/public/brand/logo.svg', 'block', 200]]);
    const variant = await withProject(
      {
        brand: fixtureBrand({logo: {path: 'public/brand/logo.svg', onDark: 'public/brand/logo-dark.svg'}}),
        files: {'public/brand/logo.svg': SVG, 'public/brand/logo-dark.svg': SVG},
        sections: [{id: 's', scene: 'logos', start: 0}],
      },
      (root) => probe('evalat', {root, scenes: SCENES, js: LOGOS}),
    );
    assert.equal(variant.values[0][0][1], '/public/brand/logo-dark.svg');
  });

  it('ctx.logo: a missing file is hidden with a warning, and the page still boots', async () => {
    const r = await withProject(
      {brand: fixtureBrand({logo: {path: 'public/brand/missing.svg'}}), sections: [{id: 's', scene: 'logos', start: 0}]},
      (root) => probe('evalat', {root, scenes: SCENES, js: `[window.__mv.ready, ${LOGOS}]`}),
    );
    const [ready, logos] = r.values[0];
    assert.equal(ready, true);
    assert.deepEqual(logos.map((l) => l[2]), ['none', 'none']);
    assert.ok(r.warnings.includes('logo public/brand/missing.svg did not load; it is left out'), JSON.stringify(r.warnings));
  });

  for (const exit of ['left', 'fall', 'shrink', 'suck']) {
    it(`exit ${exit}: no word's mask box moves and held words stay put while a word exits and after it is gone`, async () => {
      const id = `x-${exit}`;
      const RECTS = `(() => { const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; };
        return [...document.querySelectorAll('[data-line="${id}"] .wm')].map((m) => [r(m), r(m.firstElementChild)]); })()`;
      // 1.9: all held. 2.15: word 0 mid-exit. 2.45: word 0 gone, word 1 mid-exit. 2.75: words 0-1 gone, word 2 mid-exit.
      const r = await withProject(
        {sections: [{id: 'x', scene: 'exits', start: 0}], lyrics: [line(id, 'four steady words here', 0.3, 1.1)]},
        (root) => probe('evalat', {root, scenes: SCENES, times: '1.9,2.15,2.45,2.75', js: RECTS}),
      );
      const [held, ...later] = r.values;
      later.forEach((rects, i) => {
        rects.forEach(([mask, word], k) => {
          assert.deepEqual(mask, held[k][0], `t#${i + 1}: word ${k}'s mask box moved`);
          if (k > i) assert.deepEqual(word, held[k][1], `t#${i + 1}: held word ${k} moved while word ${i} exits`);
        });
        assert.notDeepEqual(rects[i][1], held[i][1], `t#${i + 1}: word ${i} is mid-exit (its own box moves)`);
      });
    });
  }
});
