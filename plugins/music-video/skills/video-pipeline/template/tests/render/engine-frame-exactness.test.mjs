// Frame exactness (single process): capture n shows the page at exactly
// n / fps. The time-code fixture draws Math.round(t * fps * 4), so every
// captured frame must decode to exactly 4n, including the frames on either
// side of a section boundary (frame 45) and of a hard cut (frame 75).
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('frame exactness', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      sections: [
        {id: 's1', scene: 'timecode', start: 0},
        {id: 's2', scene: 'timecode', start: 1.5},
        {id: 's3', scene: 'timecode-cut', start: 2.5},
      ],
      lyrics: [line('s1-1', 'words under the code', 0.4, 1.2), line('s3-1', 'after the cut', 2.6, 3.4)],
    });
  });
  after(() => proj?.cleanup());

  it('every captured frame n = 0..90 decodes to the time code 4n, across a section boundary and a cut', async () => {
    const r = await probe('timecode', {root: proj.root, scenes: 'tests/fixtures/scenes/timecode.js', frames: '0-90'});
    assert.deepEqual(r.info.cuts, [1.5, 2.5], 'a plain section start (s2) and the timecode-cut section (s3) are cuts');
    assert.equal(r.codes.length, 91);
    const wrong = r.frames.map((n, i) => [n, r.codes[i]]).filter(([n, code]) => code !== 4 * n);
    assert.deepEqual(wrong, [], `frames whose code isn't 4n: ${JSON.stringify(wrong)}`);
    assert.deepEqual(r.console, []);
  });
});
