// Per-word hold windows: window.__mv.lines() reports each word's own
// schedule (reveal, settled, exitStart, exitEnd), and it is what the page
// draws: hidden the frame before its reveal, shown on it, gone from its
// exitEnd, and on every frame of its own [settled, exitStart) held (transform
// none, opacity 1, no filter) and pixel-identical when only that word shows.
// The fixture's words are staggered so the line-level hold window
// [max settled, min exitStart) is empty while the early words hold for many
// frames.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('per-word hold windows', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    const words = [['wide', 0.3], ['open', 0.9], ['staggered', 1.5], ['words', 2.1]].map(([text, start]) => ({text, start, end: start + 0.4}));
    proj = makeProject({
      sections: [{id: 'w', scene: 'exits', start: 0}],
      lyrics: [
        {id: 'w-1', text: 'wide open staggered words', start: 0.3, end: 2.5, words},
        {id: 'w-2', text: 'next', start: 2.6, end: 3.2, words: [{text: 'next', start: 2.6, end: 3.2}]},
      ],
    });
  });
  after(() => proj?.cleanup());

  it('lines() words match the drawn words, and each word is pixel-still across its own hold window', async () => {
    const r = await probe('wordhold', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', line: 'w-1', textonly: true});
    assert.ok(r.line.settled >= r.line.exitStart, 'the line-level hold window is empty (the case this field is for)');
    assert.deepEqual(r.line.words.map((w) => [w.index, w.text]), [[0, 'wide'], [1, 'open'], [2, 'staggered'], [3, 'words']]);
    assert.ok(r.words[0].held.length >= 30, `the first word holds ${r.words[0].held.length} frames`);
    for (const w of r.words) {
      assert.equal(w.hidden_before_reveal, true, `${w.text}: hidden the frame before its reveal`);
      assert.equal(w.visible_on_reveal, true, `${w.text}: shown on its reveal frame`);
      assert.equal(w.hidden_from_exit_end, true, `${w.text}: gone from its exitEnd`);
      assert.equal(w.held_pose_ok, true, `${w.text}: held pose across [settled, exitStart)`);
      assert.deepEqual(w.differ, [], `${w.text}: frames that differ across its hold window`);
      if (w.held.length > 0) assert.ok(w.lit > 100, `${w.text}: lit while held`);
    }
  });
});
