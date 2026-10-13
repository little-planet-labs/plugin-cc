// scripts/capture.py on SIGTERM / SIGINT mid-capture: it cancels, closes the
// browser and exits 143 / 130, and no Chromium process it started survives.
// Its Chromium is tagged with a unique switch so the test can find it.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {playwrightEnv, PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';

const missing = captureEnvMissing();

/** Pids whose command line contains `marker`. */
const pids = (marker) => {
  try {
    return execFileSync('pgrep', ['-f', marker.replace(/^-+/, '')], {encoding: 'utf8'}).trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

const until = async (fn, ms, what) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe('capture.py signal shutdown', {skip: missing ?? false}, () => {
  let proj;
  before(() => {
    proj = makeProject({sections: [{id: 's', scene: 'timecode', start: 0}]});
  });
  after(() => proj?.cleanup());

  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]]) {
    it(`${signal} mid-capture closes Chromium and exits ${code}`, {timeout: 60_000}, async () => {
      const marker = `--mv-capture-test-${process.pid}-${signal}`;
      const outDir = mkdtempSync(join(tmpdir(), 'mv-signal-'));
      let child = null;
      try {
        child = spawn(
          venvPython(PROJECT_ROOT),
          [join(PROJECT_ROOT, 'scripts/capture.py'), '--root', proj.root, '--scenes', 'tests/fixtures/scenes/timecode.js', '--frames', '0-119', '--out-dir', outDir, `--chromium-arg=${marker}`],
          {env: playwrightEnv(PROJECT_ROOT), stdio: ['ignore', 'ignore', 'pipe']},
        );
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d));
        const exited = new Promise((r) => child.on('close', (c) => r(c)));
        await until(() => readdirSync(outDir).some((f) => f.endsWith('.png')), 30_000, 'the first frame');
        assert.ok(pids(marker).some((p) => p !== child.pid), 'Chromium (tagged) is running before the signal');
        child.kill(signal);
        assert.equal(await exited, code, stderr);
        await until(() => pids(marker).length === 0, 10_000, 'tagged Chromium processes to exit');
        assert.ok(readdirSync(outDir).length < 120, 'the capture stopped early');
      } finally {
        // A failed assertion must not leave the capture running (it would refill outDir).
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await new Promise((r) => child.once('close', r));
        }
        rmSync(outDir, {recursive: true, force: true});
      }
    });
  }
});
