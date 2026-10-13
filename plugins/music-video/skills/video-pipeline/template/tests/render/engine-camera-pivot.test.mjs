// The camera zooms about its key point, the same on DOM as on canvas: a dot
// at the page centre stays at the centre under ctx.applyCamera at zoom 2.236
// (it moved to (-113, -64) when the transform's pivot doubled with the CSS
// default origin), and the zoom transition keeps its centre fixed on both the
// outgoing and the incoming section.
import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const CENTRE = `(id) => { const el = document.getElementById(id); if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }`;

describe('camera and zoom transition pivot', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    // a: camera from 0.5 s (zoom 1) to 1.0 s (zoom 2.236). b at 2 s comes in with a zoom transition over [1.4, 2.0).
    proj = makeProject({sections: [{id: 'a', scene: 'pivot', start: 0}, {id: 'b', scene: 'pivot', start: 2}]});
  });
  after(() => proj?.cleanup());

  it('a dot at the camera pivot stays put under applyCamera zoom', async () => {
    const r = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', times: '0.2,0.75,1.2', js: `(${CENTRE})('pivot-dot')`});
    for (const [x, y] of r.values) {
      assert.ok(Math.abs(x - 480) < 0.01 && Math.abs(y - 270) < 0.01, `dot centre at (${x}, ${y}), expected (480, 270)`);
    }
  });

  it('the zoom transition scales both sections about its centre', async () => {
    const r = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/engine-cases.js', times: '1.55,1.7,1.85', js: `[(${CENTRE})('pivot-dot'), (${CENTRE})('pivot-dot-in')]`});
    for (const pair of r.values) {
      for (const c of pair) {
        assert.ok(c !== null, 'both sections are drawn mid-transition');
        assert.ok(Math.abs(c[0] - 480) < 0.01 && Math.abs(c[1] - 270) < 0.01, `centre at (${c}), expected (480, 270)`);
      }
    }
  });
});
