// lines() exit ends are inside the bound exactly (exitEnd <= next - 2/fps
// with no epsilon) on compressed lines, a pair and an exitBy, and the
// textonly frames at round(next * fps) - 2 and - 1 are entirely black (the
// line is really gone on screen, not just in the schedule).
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const SCENES = 'tests/fixtures/scenes/engine-cases.js';

describe('exit bound on screen', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    // Tight gaps force compression; e-2/e-3 are a pair; e-4 has exitBy 4.2 before e-5 at 4.6.
    proj = makeProject({
      pipeline: {fallbackSeconds: 77},
      sections: [{id: 'e', scene: 'exits', start: 0}],
      lyrics: [
        line('e-1', 'tight gap words here', 0.3, 1.21),
        line('e-2', 'paired top line', 1.31, 2.0),
        line('e-3', 'paired bottom line', 2.05, 2.6),
        line('e-4', 'held until exit by', 2.9, 3.6),
        line('e-5', 'long exit squeezed in', 4.6, 5.33),
        line('e-6', 'last line falls', 5.41, 6.0),
        // The reference project's chorus-1-3 / chorus-1-4, whose exit end once landed at 72.10000000000001 against a 72.1 bound.
        {id: 'chorus-1-3', text: 'to service your request', start: 68.61, end: 71.744, words: [
          {text: 'to', start: 68.61, end: 69.04}, {text: 'service', start: 69.04, end: 69.48}, {text: 'your', start: 69.95, end: 70.304}, {text: 'request', start: 70.46, end: 71.744}]},
        {id: 'chorus-1-4', text: "You're down and so am I", start: 72.15, end: 76.064, words: [
          {text: "You're", start: 72.15, end: 72.56}, {text: 'down', start: 72.56, end: 73.2}, {text: 'and', start: 73.22, end: 73.68},
          {text: 'so', start: 73.68, end: 74.16}, {text: 'am', start: 74.34, end: 74.62}, {text: 'I', start: 74.62, end: 76.064}]},
      ],
    });
  });
  after(() => proj?.cleanup());

  it('every exitEnd is <= next - 2/fps exactly, and <= exitBy', async () => {
    const r = await probe('evalat', {root: proj.root, scenes: SCENES, js: 'window.__mv.fps'});
    const fps = r.values[0];
    const by = Object.fromEntries(r.lines.map((l) => [l.id, l]));
    for (const l of r.lines) {
      if (l.next === null) continue;
      assert.ok(l.exitEnd <= l.next - 2 / fps, `${l.id}: exitEnd ${l.exitEnd} > ${l.next - 2 / fps}`);
      assert.ok(l.exitEnd <= (Math.round(l.next * fps) - 2) / fps, `${l.id}: exitEnd ${l.exitEnd} past frame ${Math.round(l.next * fps) - 2}`);
    }
    assert.ok(by['e-4'].exitEnd <= 4.2);
    assert.equal(by['e-2'].next, by['e-3'].next, 'the pair clears for the same next line');
    assert.ok(by['chorus-1-3'].exitEnd <= 2163 / fps, `chorus-1-3 exitEnd ${by['chorus-1-3'].exitEnd} past 72.1 (frame 2163)`);
  });

  it('textonly frames round(next*fps) - 2 and - 1 are black after each line with a next', async () => {
    const info = await probe('evalat', {root: proj.root, scenes: SCENES, js: 'window.__mv.fps'});
    const fps = info.values[0];
    // Between e-2's exit and e-3's first word the pair's other line is on screen, so skip e-2.
    const frames = info.lines.filter((l) => l.next !== null && l.id !== 'e-2').flatMap((l) => [Math.round(l.next * fps) - 2, Math.round(l.next * fps) - 1]);
    const r = await probe('lit', {root: proj.root, scenes: SCENES, textonly: true, frames: frames.join(',')});
    r.frames.forEach((n, i) => assert.equal(r.lit[i], 0, `frame ${n} has ${r.lit[i]} lit pixels`));
    assert.deepEqual(r.console, []);
  });

  it('a cut requested on the last word\'s reveal still shows that word, lit, on its reveal frame', async () => {
    const cut = makeProject({sections: [{id: 'c', scene: 'exits', start: 0}], lyrics: [line('c-1', 'one two', 1, 3)]});
    try {
      const box = `(() => { const w = document.querySelectorAll('[data-line="c-1"] .wm')[1]; const r = w.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`;
      const r = await probe('lit', {root: cut.root, scenes: SCENES, textonly: true, frames: '60,61', js: box});
      assert.ok(r.lit_in_box[0] > 200, `"two" lit pixels on its reveal frame 60: ${r.lit_in_box[0]}`);
      assert.equal(r.lit[1], 0, 'the cut lands on the next frame');
    } finally {
      cut.cleanup();
    }
  });
});
