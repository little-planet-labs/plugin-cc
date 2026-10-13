// The interactive preview (index.html without render=1, through `pnpm
// serve`): it boots, shows the HUD and scrubber, and the arrow keys step one
// frame (Shift: 0.5 s), with the HUD reading time, frame, bar and section.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cpSync} from 'node:fs';
import {after, before, describe, it} from 'node:test';
import {join} from 'node:path';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

describe('preview HUD', {skip: missing ?? false}, () => {
  let proj;
  let server;
  let url;
  before(async () => {
    proj = makeProject({sections: [{id: 'intro', scene: 'timecode', start: 0}], lyrics: [line('intro-1', 'a preview line', 0.5, 1.5)]});
    // serve.mjs serves the project it lives in: run a copy inside the fixture project.
    cpSync(join(PROJECT_ROOT, 'scripts'), join(proj.root, 'scripts'), {recursive: true});
    server = spawn(process.execPath, [join(proj.root, 'scripts/serve.mjs'), '--port', '0'], {stdio: ['ignore', 'pipe', 'inherit']});
    url = await new Promise((resolve, reject) => {
      let out = '';
      server.stdout.on('data', (d) => {
        out += d;
        const m = /http:\/\/127\.0\.0\.1:\d+\/index\.html/.exec(out);
        if (m) resolve(m[0]);
      });
      server.on('close', () => reject(new Error(`serve exited: ${out}`)));
    });
  });
  after(() => {
    server?.kill('SIGINT');
    proj?.cleanup();
  });

  it('boots without render=1, shows the HUD, and steps a frame / half a second with the arrow keys', async () => {
    const r = await probe('preview', {url: `${url}?scenes=tests/fixtures/scenes/timecode.js&t=1`});
    assert.deepEqual(r.state, {ready: true, error: null});
    assert.deepEqual(r.errors, []);
    assert.equal(r.scrub, 'block');
    assert.match(r.hud[0], /^1\.000s\s+f30\s+bar 1\s+intro\s+paused$/);
    assert.match(r.hud[1], /^1\.033s\s+f31\s/);
    assert.match(r.hud[2], /^1\.533s\s+f46\s/);
  });
});
