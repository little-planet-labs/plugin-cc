// scripts/align.mjs: the `pnpm align` wrapper around align_lyrics.py in .venv-align.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {main as alignMain} from '../scripts/align.mjs';
import {fakeBin, freshDir, quiet, silence} from './fixtures/cli-fakes.mjs';

describe('align', () => {
  it('align: a missing venv or an unknown argument fails before running anything', async () => {
    const root = freshDir('align-root');
    const missing = await quiet(() => alignMain([], {root}));
    assert.equal(missing.result, 1);
    assert.match(missing.output.join('\n'), /alignment venv missing\. Run `pnpm setup:align` first\./);
    // An unknown argument fails even with a working interpreter, which never runs.
    const log = join(root, 'ran');
    const python = fakeBin('python', `fs.writeFileSync(${JSON.stringify(log)}, 'ran');`);
    const unknown = await quiet(() => alignMain(['--fast'], {root, pythonBin: python}));
    assert.equal(unknown.result, 1);
    assert.match(unknown.output.join('\n'), /unexpected arguments: --fast/);
    assert.throws(() => readFileSync(log), /ENOENT/);
  });

  it('align: forwards to align_lyrics.py in the venv and reports its exit code', async () => {
    const root = freshDir('align-ok');
    const argsFile = join(root, 'args.json');
    const ok = fakeBin('python', `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`);
    assert.equal(await silence(() => alignMain(['calibrate'], {root, pythonBin: ok})), 0);
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')), [join(root, 'scripts/align_lyrics.py'), 'calibrate']);
    assert.equal(await silence(() => alignMain([], {root, pythonBin: fakeBin('python', 'process.exit(3);')})), 1);
  });
});
