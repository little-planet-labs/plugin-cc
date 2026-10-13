// `pnpm still` end to end on a fixture project: --frame and --t pick the same
// frame, --out folders are created, the PNG is the page size times --scale,
// no temp file is left next to it, and a frame past the end is refused.
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {parseStillArgs, still} from '../../scripts/still.mjs';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (path) => {
  const b = readFileSync(path);
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('pnpm still', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({sections: [{id: 's', scene: 'timecode', start: 0}]});
  });
  after(() => proj?.cleanup());
  const where = () => ({root: proj.root, envRoot: PROJECT_ROOT});
  const log = console.log;

  it('writes the frame to --out (creating folders) at page size x scale, leaving no temp file', async () => {
    console.log = () => {};
    try {
      const r = await still(parseStillArgs(['--t=1.0', '--scale=2', '--scenes=tests/fixtures/scenes/timecode.js', '--out', 'out/a/b/still.png']), where());
      assert.equal(r.frame, 30);
      const out = join(proj.root, 'out/a/b/still.png');
      assert.deepEqual(pngSize(out), [1920, 1080]);
      assert.deepEqual(readdirSync(join(proj.root, 'out/a/b')), ['still.png']);
      const r2 = await still(parseStillArgs(['--frame=30', '--scenes=tests/fixtures/scenes/timecode.js', '--out=out/c.png']), where());
      assert.equal(r2.frame, 30);
      assert.deepEqual(pngSize(join(proj.root, 'out/c.png')), [960, 540]);
    } finally {
      console.log = log;
    }
  });

  it('refuses a frame past the end of the video', async () => {
    await assert.rejects(still(parseStillArgs(['--frame=120', '--scenes=tests/fixtures/scenes/timecode.js']), where()), /frame 120 is past the end of the video \(frames 0\.\.119/);
    assert.equal(existsSync(join(proj.root, 'out/still.png')), false);
  });
});
