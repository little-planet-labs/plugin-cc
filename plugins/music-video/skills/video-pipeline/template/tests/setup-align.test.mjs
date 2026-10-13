// scripts/setup-align.mjs: a venv it created is removed when the install fails;
// an existing one is kept.
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {main as setupAlignMain} from '../scripts/setup-align.mjs';
import {fakeBin, freshDir, silence} from './fixtures/cli-fakes.mjs';

describe('setup:align', () => {
  it('setup:align: a venv it created is removed when the install fails; an existing one is kept', async () => {
    const root = freshDir('setup-root');
    // Fake "python": `-c` prints 3.14; `-m venv <dir>` creates <dir>/bin/python that fails pip.
    const python = fakeBin(
      'python3.14',
      `if (args[0] === '-c') { console.log('3.14'); process.exit(0); }
const dir = args[2]; fs.mkdirSync(dir + '/bin', {recursive: true});
fs.writeFileSync(dir + '/bin/python', '#!/bin/sh\\nexit 1\\n'); fs.chmodSync(dir + '/bin/python', 0o755);`,
    );
    assert.equal(await silence(() => setupAlignMain([], {root, pythonCandidates: [python]})), 1);
    assert.equal(existsSync(join(root, '.venv-align')), false);

    mkdirSync(join(root, '.venv-align/bin'), {recursive: true});
    writeFileSync(join(root, '.venv-align/bin/python'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(root, '.venv-align/bin/python'), 0o755);
    assert.equal(await silence(() => setupAlignMain([], {root, pythonCandidates: [python]})), 1);
    assert.equal(existsSync(join(root, '.venv-align/bin/python')), true);
  });

  it('setup:align rejects arguments before doing anything', async () => {
    const root = freshDir('setup-args');
    assert.equal(await silence(() => setupAlignMain(['--force'], {root, pythonCandidates: []})), 1);
    assert.equal(existsSync(join(root, '.venv-align')), false);
  });
});
