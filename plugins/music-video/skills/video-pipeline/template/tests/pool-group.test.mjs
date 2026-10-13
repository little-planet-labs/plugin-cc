// scripts/lib/cli.mjs spawnGroup, which the pool starts every worker with:
// the worker leads its own process group, kill() reaches everything it
// started (also a child in a process group of its own, as Playwright starts
// Chromium), and `exited` settles only when that whole family is gone, so a
// pool slot is never given back while a worker's Chromium or ffmpeg lives;
// also a process whose parent died before any snapshot saw it (found by the
// family's environment token, which it inherited).
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {FAMILY_ENV, processFamily, processTable, spawnGroup} from '../scripts/lib/cli.mjs';
import {fakeBin, freshDir, isAlive, quiet, trackPid, waitFor} from './fixtures/cli-fakes.mjs';

const BOUNDED = {timeout: 30_000};

/**
 * A worker that starts a child in its group and a detached one ignoring SIGTERM, writes their pids, then
 * (once the detached one is ready) exits after `exitAfterStart` ms (0: idles, ignoring SIGTERM).
 */
const worker = (pidsFile, exitAfterStart = 0) =>
  fakeBin(
    'worker',
    `const {spawn} = require('node:child_process');
${exitAfterStart ? '' : "process.on('SIGTERM', () => {});"}
const sleeper = 'setInterval(() => {}, 1000)';
const same = spawn(process.execPath, ['-e', sleeper], {stdio: 'ignore'});
// It marks itself ready once its handler is installed (a SIGTERM before that would kill it).
const own = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], ''); " + sleeper, ${JSON.stringify(pidsFile)} + '.ready'], {stdio: 'ignore', detached: true});
fs.writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, same.pid, own.pid]));
${exitAfterStart ? `const ready = setInterval(() => { if (fs.existsSync(${JSON.stringify(pidsFile)} + '.ready')) { clearInterval(ready); setTimeout(() => process.exit(0), ${exitAfterStart}); } }, 10);` : 'setInterval(() => {}, 1000);'}`,
  );

/** The [worker, child, detached child] pids the worker wrote, once written. */
const readPids = async (file) => {
  let pids = [];
  await waitFor(() => {
    try {
      pids = JSON.parse(readFileSync(file, 'utf8'));
      return pids.length === 3 && existsSync(`${file}.ready`);
    } catch {
      return false;
    }
  }, 'the worker to start its children');
  pids.forEach(trackPid);
  return pids;
};

describe('process groups', () => {
  it('processFamily: the leader, its group, and every descendant, also one in a group of its own; nothing else', () => {
    const table = [
      [10, 1, 10], // leader
      [11, 10, 10], // in its group (ffmpeg)
      [12, 11, 12], // child of a member, own group (Chromium)
      [13, 12, 12], // Chromium's renderer
      [14, 1, 10], // a member re-parented after its parent died
      [20, 1, 20], // unrelated
      [21, 20, 20],
    ];
    assert.deepEqual([...processFamily(10, table)].sort((a, b) => a - b), [10, 11, 12, 13, 14]);
    assert.deepEqual([...processFamily(99, table)], []);
  });

  it('kill reaches the whole family, also a SIGTERM-ignoring child in its own group; exited waits for all of them', BOUNDED, async () => {
    const file = join(freshDir('group'), 'pids.json');
    const h = spawnGroup(worker(file), [], {stdio: 'ignore', killGraceMs: 500});
    const pids = await readPids(file);
    assert.equal(pids[0], h.pid);
    assert.ok(pids.every(isAlive));
    h.kill('SIGTERM');
    // The worker and the detached child ignore SIGTERM: only the escalation stops them.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(isAlive(pids[0]) && isAlive(pids[2]), 'the SIGTERM-ignoring processes are still there');
    h.kill('SIGKILL');
    const result = await h.exited;
    assert.equal(result.signal, 'SIGKILL');
    assert.deepEqual(pids.filter(isAlive), [], 'nothing of the family is left when exited settles');
  });

  // The detached child is re-parented to launchd when the worker exits: only the running snapshot remembers it.
  it('a worker that exits on its own leaves no straggler, also a re-parented one: exited settles only after its leftover children are gone', BOUNDED, async () => {
    const file = join(freshDir('group'), 'pids.json');
    const h = spawnGroup(worker(file, 600), [], {stdio: 'ignore', killGraceMs: 300, watchMs: 100});
    const result = await h.exited;
    const pids = await readPids(file);
    assert.equal(result.code, 0);
    assert.deepEqual(pids.filter(isAlive), [], 'the leftover children were stopped before exited settled');
  });

  it('a binary that cannot start resolves exited with an error instead of throwing', BOUNDED, async () => {
    const h = spawnGroup(join(freshDir('missing'), 'nope'), [], {stdio: 'ignore'});
    const result = await h.exited;
    assert.match(result.error, /could not run/);
  });

  /**
   * A worker that starts an intermediate which starts a detached grandchild (a group of its own, ignoring
   * SIGTERM) and SIGKILLs itself at once, so the grandchild is re-parented to launchd before any snapshot.
   * The grandchild writes its pid to `file` once its handler is installed. The worker exits only once that
   * file exists, so the grandchild is certainly running and orphaned when it does (`exitAfterMs` later;
   * 0: idles, ignoring SIGTERM).
   */
  const orphaningWorker = (file, exitAfterMs) =>
    fakeBin(
      'worker',
      `const {spawn} = require('node:child_process');
process.on('SIGTERM', () => {});
const grandchild = "process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";
const intermediate = "const {spawn} = require('node:child_process'); spawn(process.execPath, ['-e', process.argv[1], process.argv[2]], {stdio: 'ignore', detached: true}); process.kill(process.pid, 'SIGKILL');";
spawn(process.execPath, ['-e', intermediate, grandchild, ${JSON.stringify(file)}], {stdio: 'ignore'});
${exitAfterMs ? `const ready = setInterval(() => { if (fs.existsSync(${JSON.stringify(file)})) { clearInterval(ready); setTimeout(() => process.exit(0), ${exitAfterMs}); } }, 10);` : 'setInterval(() => {}, 1000);'}`,
    );
  // No periodic snapshot runs during these tests (watchMs far beyond them): only the snapshots taken at exit
  // and at kill can find the orphaned grandchild, and they can only find it by its family token.
  const NO_PERIODIC = 600_000;
  const grandchildPid = async (file) => {
    let pid = 0;
    await waitFor(() => {
      try {
        pid = Number(readFileSync(file, 'utf8'));
        return pid > 0;
      } catch {
        return false;
      }
    }, 'the grandchild to start');
    trackPid(pid);
    return pid;
  };

  it('a grandchild orphaned before any snapshot (its parent died at once) keeps exited from settling until it is gone (no periodic snapshot)', BOUNDED, async () => {
    const file = join(freshDir('orphaned'), 'grandchild.pid');
    const h = spawnGroup(orphaningWorker(file, 100), [], {stdio: 'ignore', killGraceMs: 1500, watchMs: NO_PERIODIC});
    const pid = await grandchildPid(file);
    const result = await h.exited;
    assert.equal(result.code, 0);
    assert.equal(isAlive(pid), false, 'exited settled while the re-parented grandchild was still running');
  });

  it('kill() reaches a grandchild orphaned before any snapshot (no periodic snapshot)', BOUNDED, async () => {
    const file = join(freshDir('orphaned'), 'grandchild.pid');
    const h = spawnGroup(orphaningWorker(file, 0), [], {stdio: 'ignore', killGraceMs: 60_000, watchMs: NO_PERIODIC});
    const pid = await grandchildPid(file);
    h.kill('SIGKILL');
    // Nothing else signals it: no periodic snapshot runs and the 60 s escalation is far off.
    await waitFor(() => !isAlive(pid), 'the grandchild to die from the kill', 10_000);
    const result = await h.exited;
    assert.equal(result.signal, 'SIGKILL');
  });

  it('processFamily finds a member by its environment token whatever its parent and group', () => {
    const table = [
      [10, 1, 10, 'worker'],
      [30, 1, 30, `chrome a b ${FAMILY_ENV}=tok-1 HOME=/x`], // re-parented, own group
      [31, 30, 30, '(chrome-helper)'], // its helper: args unreadable, found through its parent
      [40, 1, 40, `other ${FAMILY_ENV}=tok-10`], // another family's token
    ];
    assert.deepEqual([...processFamily(10, table, 'tok-1')].sort((a, b) => a - b), [10, 30, 31]);
    assert.deepEqual([...processFamily(10, table)].sort((a, b) => a - b), [10], 'without the token only the group and parent links count');
  });

  it('spawnGroup never gives up in the same pass as its SIGKILL: a slow family snapshot still waits for the killed processes to go', BOUNDED, async () => {
    const file = join(freshDir('slow'), 'child.pid');
    // The worker leaves a sleeping child in its group and exits at once: the child is a straggler to SIGKILL.
    const bin = fakeBin(
      'worker',
      `const {spawn} = require('node:child_process');
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
c.unref(); // the worker exits without waiting for it
fs.writeFileSync(${JSON.stringify(file)}, String(c.pid));`,
    );
    // Every snapshot takes 400 ms, longer than the whole 100 ms grace: the pass that sends the SIGKILL is already
    // past the old give-up point (exit + 2 x grace).
    const slowTable = () => {
      const until = Date.now() + 400;
      while (Date.now() < until);
      return processTable();
    };
    const {result: settled, output} = await quiet(async () => {
      const h = spawnGroup(bin, [], {stdio: 'ignore', killGraceMs: 100, watchMs: 600_000, table: slowTable});
      const result = await h.exited;
      const pid = Number(readFileSync(file, 'utf8'));
      trackPid(pid);
      return {result, pid, aliveAtSettle: isAlive(pid)};
    });
    assert.equal(settled.result.code, 0);
    assert.equal(settled.aliveAtSettle, false, 'exited settled while the SIGKILLed child still existed');
    assert.deepEqual(output.filter((l) => /still present after SIGKILL/.test(l)), [], 'gave up instead of waiting for the SIGKILL to take effect');
  });
});
