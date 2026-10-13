// Fonts gate and boot errors: a missing font file, a Google font without
// `pnpm fonts`, and an unknown scene key each make capture fail fast with the
// page's own error text (no wait for the ready timeout).
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {captureEnvMissing, fixtureBrand, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();
const FAST = 30; // seconds; the ready timeout is 120

const boot = async (o, scenes) => {
  const proj = makeProject(o);
  try {
    return await probe('boot', {root: proj.root, ...(scenes ? {scenes} : {})});
  } finally {
    proj.cleanup();
  }
};

describe('boot errors fail fast', {skip: missing ?? false}, () => {
  it('a missing local font file fails boot naming the file', async () => {
    const brand = fixtureBrand();
    brand.fonts.display = {family: 'Gone Sans', source: 'local', weights: [700], files: {700: 'public/brand/gone-700.woff2'}};
    const r = await boot({brand});
    assert.equal(r.ok, false);
    assert.match(r.error, /^page error: font file public\/brand\/gone-700\.woff2 \(Gone Sans 700\) did not load/);
    assert.ok(r.seconds < FAST, `took ${r.seconds}s`);
  });

  it('a Google font without public/fonts/fonts.json fails boot with "run pnpm fonts"', async () => {
    const brand = fixtureBrand();
    brand.fonts.body = {family: 'Inter', source: 'google', weights: [400]};
    const r = await boot({brand});
    assert.equal(r.ok, false);
    assert.match(r.error, /public\/fonts\/fonts\.json is missing .*run pnpm fonts/);
    assert.ok(r.seconds < FAST, `took ${r.seconds}s`);
  });

  it('a Google font weight missing from the manifest fails boot with "run pnpm fonts"', async () => {
    const brand = fixtureBrand();
    brand.fonts.body = {family: 'Inter', source: 'google', weights: [400]};
    const manifest = {version: 1, faces: [{family: 'Inter', weight: 700, style: 'normal', file: 'public/fonts/inter-700.woff2'}]};
    const r = await boot({brand, files: {'public/fonts/fonts.json': JSON.stringify(manifest)}});
    assert.equal(r.ok, false);
    assert.match(r.error, /font "Inter" weight 400 is not in public\/fonts\/fonts\.json; run pnpm fonts/);
  });

  it('an unknown scene key with DEFAULT_SCENE null fails boot naming the key and the known keys', async () => {
    const r = await boot({sections: [{id: 'intro', scene: 'nope', start: 0}]}, 'tests/fixtures/scenes/timecode.js');
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown scene key "nope" \(section "intro"\)/);
    assert.match(r.error, /Known keys: timecode, timecode-cut, moving, bright/);
    assert.ok(r.seconds < FAST, `took ${r.seconds}s`);
  });

  it('a scenes module outside the project is refused', async () => {
    const r = await boot({}, '../outside.js');
    assert.equal(r.ok, false);
    assert.match(r.error, /scenes must be a project-relative module path/);
  });
});
