// scripts/setup-env.mjs against fakes: a system "python" that makes a fake
// venv, whose interpreter answers the installed-package check, pip and
// playwright (logging every call), plus fake ffmpeg and ffprobe.
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {main as setupEnvMain, parseEncoders} from '../scripts/setup-env.mjs';
import {browsersPath} from '../scripts/lib/env.mjs';
import {fakeBin, freshDir, missingPath, projectRoot, quiet} from './fixtures/cli-fakes.mjs';

/**
 * The venv interpreter. Its state lives in the venv: pip install writes
 * .fake-installed (so the package check passes afterwards) and playwright
 * install writes INSTALLATION_COMPLETE into the browser directory under
 * PLAYWRIGHT_BROWSERS_PATH. `config.json` next to the venv's bin/ sets exit
 * codes. Every call is appended to `log` as JSON.
 */
const venvPythonBody = (log) => `
const path = require('node:path');
const venv = path.resolve(__dirname, '..');
const cfg = fs.existsSync(path.join(venv, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(venv, 'config.json'), 'utf8')) : {};
const note = (entry) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
if (args[0] === '-I' && args[1] === '-c') {
  note({call: 'package-check', requirements: args[3]});
  process.stdout.write(fs.existsSync(path.join(venv, '.fake-installed')) ? '[]' : '["librosa==1.0.0 (installed: None)"]');
  process.exit(0);
}
if (args[0] === '-m' && args[1] === 'pip') {
  note({call: 'pip', args: args.slice(2), PIP_USE_DEPRECATED: process.env.PIP_USE_DEPRECATED ?? null});
  if (cfg.pipExit) process.exit(cfg.pipExit);
  fs.writeFileSync(path.join(venv, '.fake-installed'), '');
  process.exit(0);
}
if (args[0] === '-m' && args[1] === 'playwright') {
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const dir = path.join(browsers, 'chromium_headless_shell-1243');
  if (args.includes('--dry-run')) {
    note({call: 'playwright-dry-run', args: args.slice(2), browsers});
    console.log('Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243)\\n  Install location:    ' + dir + '\\n  Download url:        https://example.invalid/x.zip\\n');
    process.exit(0);
  }
  note({call: 'playwright-install', args: args.slice(2), browsers});
  if (cfg.playwrightExit) process.exit(cfg.playwrightExit);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'INSTALLATION_COMPLETE'), '');
  process.exit(0);
}
process.exit(9);
`;

/** A test case: a project root, a fake system python that creates fake venvs, and the call log. */
const setupCase = (label) => {
  const root = freshDir(label);
  mkdirSync(join(root, 'scripts'), {recursive: true});
  cpSync(join(projectRoot, 'scripts/requirements.txt'), join(root, 'scripts/requirements.txt'));
  const log = join(root, 'calls.log');
  const venvPythonSrc = fakeBin('venv-python', venvPythonBody(log));
  const systemPython = fakeBin(
    'python3.14',
    `if (args[0] === '-c') { console.log('3.14'); process.exit(0); }
if (args[0] === '-m' && args[1] === 'venv') {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({call: 'venv', dir: args[2]}) + '\\n');
  fs.mkdirSync(args[2] + '/bin', {recursive: true});
  fs.copyFileSync(${JSON.stringify(venvPythonSrc)}, args[2] + '/bin/python');
  fs.chmodSync(args[2] + '/bin/python', 0o755);
  process.exit(0);
}
process.exit(9);`,
  );
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** Make an existing venv (as if from an earlier setup) whose interpreter is the fake. */
  const existingVenv = (config = {}) => {
    mkdirSync(join(root, '.venv/bin'), {recursive: true});
    cpSync(venvPythonSrc, join(root, '.venv/bin/python'));
    writeFileSync(join(root, '.venv/config.json'), JSON.stringify(config));
  };
  return {root, systemPython, calls, existingVenv};
};

const ENCODERS = (names) =>
  `Encoders:\n V..... = Video\n A..... = Audio\n ------\n${names.map((n) => ` V....D ${n.padEnd(20)} ${n} encoder`).join('\n')}\n`;
const ffmpegWith = (names) => fakeBin('ffmpeg', `if (args.includes('-encoders')) process.stdout.write(${JSON.stringify(ENCODERS(names))}); process.exit(0);`);
const goodFfprobe = () => fakeBin('ffprobe', `process.stdout.write('ffprobe version 8.0'); process.exit(0);`);

/** Run setup:env on a case with working ffmpeg/ffprobe unless overridden. */
const setup = (c, overrides = {}) =>
  quiet(() =>
    setupEnvMain([], {
      root: c.root,
      pythonCandidates: [c.systemPython],
      ffmpegBin: ffmpegWith(['libx264', 'libx264rgb', 'aac', 'aac_at']),
      ffprobeBin: goodFfprobe(),
      ...overrides,
    }),
  );

const installs = (calls) => calls.filter((e) => e.call === 'pip' || e.call === 'playwright-install' || e.call === 'venv');

describe('setup:env', () => {
  it('setup:env creates the venv, installs the pins and the headless shell into the project cache', async () => {
    const c = setupCase('fresh');
    const {result, output} = await setup(c);
    assert.equal(result, 0, output.join('\n'));
    const calls = installs(c.calls());
    assert.deepEqual(
      calls.map((e) => e.call),
      ['venv', 'pip', 'playwright-install'],
    );
    assert.equal(calls[0].dir, join(c.root, '.venv'));
    assert.deepEqual(calls[1].args, ['install', '--disable-pip-version-check', '-q', '-r', join(c.root, 'scripts/requirements.txt')]);
    assert.deepEqual(calls[2].args, ['install', '--only-shell', 'chromium']);
    assert.equal(calls[2].browsers, join(c.root, '.cache/ms-playwright'));
    assert.equal(browsersPath(c.root), join(c.root, '.cache/ms-playwright'));
    assert.equal(existsSync(join(c.root, '.cache/ms-playwright/chromium_headless_shell-1243/INSTALLATION_COMPLETE')), true);
  });

  it('a second setup:env run on a ready project runs no venv, pip or playwright install', async () => {
    const c = setupCase('twice');
    assert.equal((await setup(c)).result, 0);
    const before = c.calls().length;
    const {result, output} = await setup(c);
    assert.equal(result, 0, output.join('\n'));
    const second = c.calls().slice(before);
    assert.deepEqual(installs(second), [], 'the second run installed something');
    // It did check: the package check and the browser dry run each ran once.
    assert.deepEqual(
      second.map((e) => e.call),
      ['package-check', 'playwright-dry-run'],
    );
    assert.match(output.join('\n'), /already installed/);
  });

  it('a ready venv with no browser installs only the browser', async () => {
    const c = setupCase('no-browser');
    c.existingVenv();
    writeFileSync(join(c.root, '.venv/.fake-installed'), '');
    assert.equal((await setup(c)).result, 0);
    assert.deepEqual(
      installs(c.calls()).map((e) => e.call),
      ['playwright-install'],
    );
  });

  it('setup:env: a venv it created is removed when the install fails; an existing one is kept', async () => {
    // Created by this run, pip fails: removed.
    const fresh = setupCase('created-fails');
    const failingVenvPython = fakeBin('python3.14', `if (args[0] === '-c') { console.log('3.14'); process.exit(0); }
fs.mkdirSync(args[2] + '/bin', {recursive: true});
fs.writeFileSync(args[2] + '/bin/python', '#!/bin/sh\\nexit 1\\n'); fs.chmodSync(args[2] + '/bin/python', 0o755);`);
    const created = await setup(fresh, {pythonCandidates: [failingVenvPython]});
    assert.equal(created.result, 1);
    assert.match(created.output.join('\n'), /pip install failed/);
    assert.equal(existsSync(join(fresh.root, '.venv')), false);

    // Existing venv, pip fails: kept.
    const existing = setupCase('existing-fails');
    existing.existingVenv({pipExit: 1});
    const kept = await setup(existing);
    assert.equal(kept.result, 1);
    assert.equal(existsSync(join(existing.root, '.venv/bin/python')), true);
    assert.deepEqual(
      installs(existing.calls()).map((e) => e.call),
      ['pip'],
    );
  });

  it('a created venv whose packages installed is kept when the browser install fails', async () => {
    const c = setupCase('browser-fails');
    // Configure the venv the fake system python is about to create.
    mkdirSync(join(c.root, '.venv'), {recursive: true});
    writeFileSync(join(c.root, '.venv/config.json'), JSON.stringify({playwrightExit: 1}));
    const {result, output} = await setup(c);
    assert.equal(result, 1);
    assert.match(output.join('\n'), /playwright install failed/);
    assert.equal(existsSync(join(c.root, '.venv/bin/python')), true);
    assert.equal(existsSync(join(c.root, '.venv/.fake-installed')), true);
  });

  for (const [label, overrides, named] of [
    ['a missing ffmpeg', () => ({ffmpegBin: missingPath('ffmpeg')}), /missing: ffmpeg \(could not run/],
    ['a missing ffprobe', () => ({ffprobeBin: missingPath('ffprobe')}), /missing: ffprobe \(could not run/],
    ['an ffmpeg without libx264', () => ({ffmpegBin: ffmpegWith(['libx264rgb', 'aac'])}), /missing: ffmpeg has no libx264 encoder/],
    ['an ffmpeg without aac', () => ({ffmpegBin: ffmpegWith(['libx264', 'aac_at'])}), /missing: ffmpeg has no aac encoder/],
  ]) {
    it(`setup:env fails on ${label} with a message naming it, before creating or installing anything`, async () => {
      const c = setupCase('tools');
      const {result, output} = await setup(c, overrides());
      assert.equal(result, 1);
      assert.match(output.join('\n'), named);
      assert.deepEqual(c.calls(), []);
      assert.equal(existsSync(join(c.root, '.venv')), false);
    });
  }

  it('setup:env names both tools when ffmpeg and ffprobe are missing', async () => {
    const c = setupCase('no-tools');
    const {result, output} = await setup(c, {ffmpegBin: missingPath('ffmpeg'), ffprobeBin: missingPath('ffprobe')});
    assert.equal(result, 1);
    assert.match(output.join('\n'), /ffmpeg \(could not run .*; ffprobe \(could not run/);
  });

  it('PIP_USE_DEPRECATED from the environment reaches pip unchanged', async () => {
    const c = setupCase('pip-env');
    const saved = process.env.PIP_USE_DEPRECATED;
    process.env.PIP_USE_DEPRECATED = 'legacy-certs';
    try {
      assert.equal((await setup(c)).result, 0);
    } finally {
      if (saved === undefined) delete process.env.PIP_USE_DEPRECATED;
      else process.env.PIP_USE_DEPRECATED = saved;
    }
    assert.equal(c.calls().find((e) => e.call === 'pip').PIP_USE_DEPRECATED, 'legacy-certs');
  });

  it('setup:env rejects arguments before doing anything', async () => {
    const c = setupCase('args');
    const {result} = await quiet(() => setupEnvMain(['--force'], {root: c.root, pythonCandidates: [c.systemPython]}));
    assert.equal(result, 1);
    assert.deepEqual(c.calls(), []);
  });

  it('parseEncoders reads the encoder table and skips the legend', () => {
    const names = parseEncoders(' V..... = Video\n A..... = Audio\n ------\n V....D libx264              libx264 H.264\n A....D aac                  AAC\n');
    assert.deepEqual([...names], ['libx264', 'aac']);
  });
});
