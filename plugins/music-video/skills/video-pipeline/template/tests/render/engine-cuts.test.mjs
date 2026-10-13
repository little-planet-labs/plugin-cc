// Every section start with no incoming transition is a hard cut: cuts()
// lists it, a blur window spanning it is a boot error naming the window and
// the section, and a section with an incoming transition is not a cut.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const SCENES = 'tests/fixtures/scenes/engine-cases.js';

const withProject = async (sections, fn) => {
  const proj = makeProject({sections});
  try {
    return await fn(proj.root);
  } finally {
    proj.cleanup();
  }
};

describe('plain section starts are cuts', {skip: missing ?? false}, () => {
  it('cuts() includes plain boundaries and leaves out sections with an incoming transition', async () => {
    const r = await withProject(
      [{id: 'a', scene: 'plain', start: 0}, {id: 'b', scene: 'plain', start: 1}, {id: 'c', scene: 'faded', start: 2}, {id: 'd', scene: 'plain', start: 3}],
      (root) => probe('evalat', {root, scenes: SCENES, js: 'window.__mv.cuts()'}),
    );
    assert.deepEqual(r.values[0], [1, 3]);
  });

  it('a blur window spanning a plain boundary is a boot error naming the window and the section', async () => {
    const r = await withProject([{id: 'a', scene: 'blurry', start: 0}, {id: 'b', scene: 'plain', start: 2}], (root) => probe('boot', {root, scenes: SCENES}));
    assert.equal(r.ok, false);
    assert.match(r.error, /blur window \[1\.7, 2\.3\) \(section "a"\) has a hard cut inside it at 2s \(start of section "b", which has no incoming transition\)/);
  });

  it('the same window over a faded boundary boots', async () => {
    const r = await withProject([{id: 'a', scene: 'blurry', start: 0}, {id: 'b', scene: 'faded', start: 2}], (root) => probe('boot', {root, scenes: SCENES}));
    assert.equal(r.ok, true, r.error);
  });
});
