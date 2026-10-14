// The page with ?pipeline=: an alternate config sets the page size, fps and
// frame count (tail included) and loads its own scene registry; the page
// refuses a ?pipeline= outside src/ (src/engine/main.js), and an
// alternate config at another fps or with src/pipeline.json's outputName;
// without ?pipeline= it is src/pipeline.json, as before.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT, playwrightEnv, venvPython} from '../../scripts/lib/env.mjs';
import {captureEnvMissing, FIXTURE_PIPELINE, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

/** Open the page through Capture and report its info or its error. `query` replaces the page's own ?pipeline=. */
const PROBE = `import asyncio, json, sys
sys.path.insert(0, ${JSON.stringify(join(PROJECT_ROOT, 'scripts'))})
from capture import Capture, CaptureError
root, pipeline, query, shot, scenes = (a or None for a in sys.argv[1:6])
async def go():
    cap = Capture(root, pipeline=pipeline, scenes=scenes, timeout=60)
    if query is not None:
        # Bypass Python's own check so the page's check is what runs; the viewport comes from src/pipeline.json.
        cap.pipeline = query
        cap._page_size = lambda: (960, 540)
    try:
        info = await cap.open()
        out = {"ok": True, "width": info["width"], "height": info["height"], "frames": info["frames"], "fps": info["fps"]}
        if shot:
            from capture import save_image
            save_image(await cap.frame(0), shot)
        return out
    except CaptureError as err:
        return {"ok": False, "error": str(err)}
    finally:
        await cap.close()
print(json.dumps(asyncio.run(go())))`;

const open = (root, {pipeline = '', query = '', shot = '', scenes = ''} = {}) => {
  const r = spawnSync(venvPython(PROJECT_ROOT), ['-c', PROBE, root, pipeline, query, shot, scenes], {encoding: 'utf8', env: playwrightEnv(PROJECT_ROOT)});
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

describe('the page with ?pipeline=', {skip: missing ?? false}, () => {
  let p;
  before(() => {
    const alt = (o) => JSON.stringify({...FIXTURE_PIPELINE, outputName: 'vertical', width: 540, height: 960, tailSeconds: 1, scenes: 'src/scenes-v/index.js', ...o});
    p = makeProject({
      pipeline: {outputName: 'music-video'},
      files: {
        'src/pipeline.vertical.json': alt({}),
        'src/pipeline.fps25.json': alt({outputName: 'fps25', fps: 25}),
        'src/pipeline.same.json': alt({outputName: 'Music-Video'}),
        'src/pipeline.no-registry.json': alt({outputName: 'no-registry', scenes: 'src/scenes-gone/index.js'}),
        // Draws the whole frame in one colour, so a capture shows which registry the page loaded.
        'src/scenes-v/index.js':
          "export const SCENES = {};\nexport const DEFAULT_SCENE = {setup(ctx) { ctx.state.c = ctx.canvas(); }, draw(t, ctx) { const c = ctx.state.c.get(); c.fillStyle = '#00ff00'; c.fillRect(0, 0, ctx.width, ctx.height); }};\n",
      },
    });
  });
  after(() => p?.cleanup());

  it('without ?pipeline= the page is src/pipeline.json: 960x540, 120 frames', () => {
    assert.deepEqual(open(p.root, {scenes: 'src/scenes-v/index.js'}), {ok: true, width: 960, height: 540, frames: 120, fps: 30});
  });
  it('an alternate config sets the page size and the frame count (its tail), and the page loads the config\'s own registry', () => {
    const shot = join(p.root, 'out/v.png');
    assert.deepEqual(open(p.root, {pipeline: 'src/pipeline.vertical.json', shot}), {ok: true, width: 540, height: 960, frames: 150, fps: 30});
    const png = readFileSync(shot);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [540, 960]);
    const rgb = spawnSync('ffmpeg', ['-v', 'error', '-i', shot, '-vf', 'crop=1:1:270:480', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 20}).stdout;
    assert.deepEqual([...rgb], [0, 255, 0], 'the centre pixel is the vertical registry\'s green');
  });
  it('the page refuses any ?pipeline= but src/pipeline.json or src/pipeline.<name>.json (encoded .., ?, #, other folders), with the path rule\'s own error (main.js checks it before the engine loads)', () => {
    for (const bad of ['../src/pipeline.vertical.json', 'public/x.json', 'src/pipeline.vertical.js', 'src/.x.json', 'http://example.com/src/a.json', 'src/%2e%2e/package.json', 'src/a?b.json', 'src/foo.json']) {
      const r = open(p.root, {query: bad});
      assert.equal(r.ok, false, bad);
      assert.match(r.error, /page error: pipeline must be src\/pipeline\.json or src\/pipeline\.<name>\.json/, bad);
    }
  });
  it('the page refuses an alternate config at another fps, one reusing src/pipeline.json\'s outputName, and a missing registry', () => {
    const fps = open(p.root, {pipeline: 'src/pipeline.fps25.json'});
    assert.equal(fps.ok, false);
    assert.match(fps.error, /page error: src\/pipeline\.fps25\.json: fps must be 30, the fps of src\/pipeline\.json \(got 25\)/);
    const same = open(p.root, {pipeline: 'src/pipeline.same.json'});
    assert.match(same.error, /page error: src\/pipeline\.same\.json: outputName must differ from src\/pipeline\.json's/);
    const gone = open(p.root, {pipeline: 'src/pipeline.no-registry.json'});
    assert.match(gone.error, /page error: scene registry src\/scenes-gone\/index\.js failed to load/);
  });
});
