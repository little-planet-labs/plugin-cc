// Boot warnings (the page still renders): a lyric line that can never be
// shown (its exitBy falls before its first word) and a local font weight with
// no file are listed in window.__mv.warnings, naming the line / the font.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('boot warnings', {skip: missing ?? false}, () => {
  it('names a line that can never be shown and a local font weight without a file', async () => {
    // engine-cases 'exits' gives e-4 exitBy 4.2; here e-4 is sung from 4.5 s.
    const proj = makeProject({sections: [{id: 'e', scene: 'exits', start: 0}], lyrics: [line('e-4', 'sung too late', 4.5, 5)], pipeline: {fallbackSeconds: 6}});
    try {
      const r = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', js: 'window.__mv.ready'});
      assert.equal(r.values[0], true, 'the page still boots');
      assert.ok(r.warnings.some((w) => /^lyric "e-4" can never be shown: it must be gone \(4\.200s\) before its first word \(4\.500s\)/.test(w)), JSON.stringify(r.warnings));
      assert.ok(r.warnings.some((w) => /^brand\.json fonts\.display\/body: "Fixture Sans" weights 400, 700 have no file/.test(w)), JSON.stringify(r.warnings));
    } finally {
      proj.cleanup();
    }
  });

  it('names a single word that can never be shown (revealed on its line\'s exitBy)', async () => {
    // e-4 has exitBy 4.2 (engine-cases 'exits'); its second word is sung from 4.2 s.
    const proj = makeProject({sections: [{id: 'e', scene: 'exits', start: 0}], lyrics: [line('e-4', 'early late', 3.5, 4.9)], pipeline: {fallbackSeconds: 6}});
    try {
      const r = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', js: 'window.__mv.ready'});
      assert.ok(r.warnings.some((w) => /^lyric "e-4" word 2 "late" can never be shown: the line must be gone \(4\.200s\) by its reveal \(4\.200s\)/.test(w)), JSON.stringify(r.warnings));
      assert.ok(!r.warnings.some((w) => /word 1 "early"/.test(w)));
    } finally {
      proj.cleanup();
    }
  });

  it('names a word on screen for one frame at near-zero opacity, with its easing', async () => {
    // q-1: fade with enterEase qio, cut on the last word's reveal (2 s) -> "two" gets one frame at 50 fps.
    const proj = makeProject({pipeline: {fps: 50}, sections: [{id: 'q', scene: 'exits', start: 0}], lyrics: [line('q-1', 'one two', 1, 3)]});
    try {
      const r = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', js: 'window.__mv.ready'});
      assert.ok(r.warnings.some((w) => /^lyric "q-1" word 2 "two" is on screen for one frame at almost zero opacity \(enter "fade", enterEase "qio"\)/.test(w)), JSON.stringify(r.warnings));
      assert.ok(!r.warnings.some((w) => /word 1 "one"/.test(w)));
    } finally {
      proj.cleanup();
    }
  });
});
