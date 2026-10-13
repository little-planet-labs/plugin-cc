// One containment rule for the page and the Node scripts: an audio candidate
// that is a symlink counts as present for both when its real file is inside
// the project (and not under a dot-folder), and as absent for both when it
// points outside. The page's choice (__mv.audio) equals loadProject's.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {loadProject} from '../../scripts/lib/project.mjs';
import {captureEnvMissing, makeProject, probe} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

const analysis = {
  version: 1, source: 'audio/track.wav', generator: 'test', fps: 30, durationSeconds: 4, durationInFrames: 120, tempo: 120, beatsPerBar: 4,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], downbeats: [0, 2], onsets: [], bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
  energy: {low: [], mid: [], high: []},
};

describe('symlinked audio candidates', {skip: missing ?? false}, () => {
  let outside;
  before(() => {
    outside = mkdtempSync(join(tmpdir(), 'mv-outside-'));
    writeFileSync(join(outside, 'real.wav'), 'RIFF');
  });
  after(() => rmSync(outside, {recursive: true, force: true}));

  for (const [label, target, expected] of [
    ['inside the project', 'media/real.wav', 'audio/track.wav'],
    ['outside the project', null, null],
    ['inside a dot-folder of the project', '.hidden/real.wav', null],
  ]) {
    it(`a candidate symlinked ${label}: the page and loadProject agree (${expected ?? 'absent'})`, async () => {
      const proj = makeProject({analysis, sections: [{id: 's', scene: 'timecode', start: 0}]});
      try {
        mkdirSync(join(proj.root, 'public/audio'), {recursive: true});
        let real = join(outside, 'real.wav');
        if (target) {
          mkdirSync(join(proj.root, target, '..'), {recursive: true});
          writeFileSync(join(proj.root, target), 'RIFF');
          real = join(proj.root, target);
        }
        symlinkSync(real, join(proj.root, 'public/audio/track.wav'));
        const node = loadProject(proj.root).project;
        const page = await probe('evalat', {root: proj.root, scenes: 'tests/fixtures/scenes/timecode.js', js: 'window.__mv.frames'});
        assert.equal(node.audio, expected);
        assert.equal(page.audio, node.audio);
        assert.equal(page.timing, node.timing);
        assert.equal(page.values[0], node.frames);
      } finally {
        proj.cleanup();
      }
    });
  }
});
