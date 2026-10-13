// The QA scripts run their main when invoked by any path: through a symlinked
// project directory argv[1] keeps the link while import.meta.url is the real
// path, and a plain comparison made a script exit 0 without running.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, realpathSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {freshDir, projectRoot} from './fixtures/cli-fakes.mjs';

describe('QA script entry points', () => {
  const real = realpathSync(freshDir('qa-real-project'));
  cpSync(join(projectRoot, 'scripts'), join(real, 'scripts'), {recursive: true});
  cpSync(join(projectRoot, 'src'), join(real, 'src'), {recursive: true});
  const link = join(realpathSync(freshDir('qa-link-parent')), 'project-link');
  symlinkSync(real, link, 'dir');

  for (const script of ['critique', 'pops', 'still-test', 'jitter', 'beatmap']) {
    it(`${script}.mjs run through a symlinked project path runs main (its argument error appears, exit 1)`, () => {
      const r = spawnSync(process.execPath, [join(link, 'scripts', `${script}.mjs`), '--bogus'], {encoding: 'utf8', cwd: link});
      assert.equal(r.status, 1, `exit ${r.status}; stderr: ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`^${script}: unexpected argument "--bogus"`, 'm'));
    });
  }
});
