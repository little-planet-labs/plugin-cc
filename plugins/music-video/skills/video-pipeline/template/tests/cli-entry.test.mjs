// Invoking a script by any path to it runs it: through a symlinked directory,
// argv[1] keeps the link while import.meta.url is the real path, and a plain
// comparison of the two made the script exit 0 without running.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, readFileSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {freshDir, projectRoot} from './fixtures/cli-fakes.mjs';

/** A copy of the project's scripts and src, reached through a symlink: returns [realRoot, linkedRoot]. */
const linkedProject = () => {
  const real = realpathSync(freshDir('real-project'));
  cpSync(join(projectRoot, 'scripts'), join(real, 'scripts'), {recursive: true});
  cpSync(join(projectRoot, 'src'), join(real, 'src'), {recursive: true});
  const link = join(realpathSync(freshDir('link-parent')), 'project-link');
  symlinkSync(real, link, 'dir');
  assert.notEqual(realpathSync(link), link);
  return [real, link];
};

const runScript = (root, script, args) =>
  spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {encoding: 'utf8', cwd: root});

describe('script entry points', () => {
  it('analyze --reset run through a symlinked project path actually resets the analysis', () => {
    const [real, link] = linkedProject();
    writeFileSync(join(real, 'src/data/audio-analysis.json'), 'STALE');
    const r = runScript(link, 'analyze.mjs', ['--reset']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /analyze: restored default \(no-track\) analysis/);
    assert.equal(
      readFileSync(join(real, 'src/data/audio-analysis.json'), 'utf8'),
      readFileSync(join(real, 'src/data/audio-analysis.default.json'), 'utf8'),
    );
  });

  for (const [script, message] of [
    ['align.mjs', /align: unexpected arguments: --bogus/],
    ['setup-env.mjs', /setup:env: unexpected argument "--bogus"/],
    ['setup-align.mjs', /setup:align: unexpected argument "--bogus"/],
  ]) {
    it(`${script} run through a symlinked project path runs main (its argument error appears, exit 1)`, () => {
      const [, link] = linkedProject();
      const r = runScript(link, script, ['--bogus']);
      assert.equal(r.status, 1, `exit ${r.status}; stderr: ${r.stderr}`);
      assert.match(r.stderr, message);
    });
  }
});
