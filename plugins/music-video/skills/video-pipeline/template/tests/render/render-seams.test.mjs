// Frame exactness across chunk seams: a chunked `pnpm render` of the time-code
// fixture (4 chunks over 2 s) decodes, frame by frame from the final MP4, to
// exactly 4n for every frame n, including both sides of every seam and of a
// hard cut, and its frame count is project.js's frames. The stream is H.264
// High at the master's level, yuv420p, tagged BT.709 TV range.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {loadProject} from '../../scripts/lib/project.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, line, makeProject} from '../fixtures/engine-project.mjs';
import {frameProbe, probeTimeline} from '../fixtures/render-real.mjs';

const missing = captureEnvMissing();

describe('render frame exactness across chunk seams', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({
      pipeline: {fallbackSeconds: 2, render: {scale: 1, chunkSeconds: 0.5}},
      sections: [
        {id: 's1', scene: 'timecode', start: 0},
        {id: 's2', scene: 'timecode-cut', start: 1.1},
      ],
      lyrics: [line('s1-1', 'words under the code', 0.2, 0.9)],
    });
  });
  after(() => proj?.cleanup());

  it('every frame of the chunked render decodes to 4n, on both sides of every seam, and the count is project.js frames', {timeout: 240_000}, async () => {
    const out = join(proj.root, 'out/seams.mp4');
    const {result, output} = await quiet(() =>
      renderMain(['--scenes=tests/fixtures/scenes/timecode.js', '--out', out, '--pool=2'], {root: proj.root, envRoot: PROJECT_ROOT}),
    );
    assert.equal(result, 0, output.join('\n'));
    const {frames} = loadProject(proj.root).project;
    assert.equal(frames, 60);
    assert.ok(output.some((l) => /4 chunk\(s\), pool 2/.test(l)), 'rendered as 4 chunks');
    const {codes} = frameProbe('timecodes', out);
    assert.equal(codes.length, frames, 'decoded frame count = project.js frames');
    const wrong = codes.map((code, n) => [n, code]).filter(([n, code]) => code !== 4 * n);
    assert.deepEqual(wrong, [], `frames whose code isn't 4n: ${JSON.stringify(wrong)}`);
    for (const seam of [15, 30, 45]) assert.deepEqual([codes[seam - 1], codes[seam]], [4 * (seam - 1), 4 * seam], `seam at ${seam}`);
    const {stream} = probeTimeline(out);
    assert.equal(Number(stream.nb_frames), frames);
    // The encoded stream itself: H.264 High at level 4.1 (a 960x540 master at 30 fps: the lowest level that fits
    // and allows 50 Mbit/s), yuv420p, BT.709 TV range, all four tags.
    assert.deepEqual(
      [stream.profile, stream.level, stream.pix_fmt, stream.color_range, stream.color_space, stream.color_primaries, stream.color_transfer],
      ['High', 41, 'yuv420p', 'tv', 'bt709', 'bt709', 'bt709'],
    );
  });
});
