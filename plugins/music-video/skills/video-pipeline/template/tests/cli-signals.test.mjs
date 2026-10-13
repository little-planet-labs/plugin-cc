// scripts/lib/cli.mjs signal shutdown: on SIGINT/SIGTERM the children get the
// signal, those still alive after the grace period are SIGKILLed, cleanup runs
// exactly once and only after every child has exited, no new child starts, and
// the exit code is 130 (SIGINT) or 143 (SIGTERM).
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, it} from 'node:test';
import {capture, CliError, run, runCli} from '../scripts/lib/cli.mjs';
import {
  exitCodeFor,
  fakeBin,
  freshDir,
  isAlive,
  missingPath,
  projectRoot,
  readPid,
  silence,
  spawnNode,
  startedPid,
  trackPid,
  waitFor,
} from './fixtures/cli-fakes.mjs';

// A regression that leaves a child alive (or the wrapper waiting forever) fails here
// instead of hanging the run.
const BOUNDED = {timeout: 30_000};

const cliUrl = pathToFileURL(join(projectRoot, 'scripts/lib/cli.mjs')).href;

/**
 * Drives runCli in a separate process with a fake child. The fake runs
 * `childBody`, writes its pid (so the test knows its handlers are installed),
 * then idles. The script writes `target` before starting the child; its cleanup
 * removes `target` and logs whether the child was still alive.
 */
const startCase = async (childBody, killGraceMs) => {
  const dir = freshDir('signal');
  const target = join(dir, 'temp.txt');
  const pidFile = join(dir, 'child.pid');
  const log = join(dir, 'cleanup.log');
  const bin = fakeBin('child', `${childBody}\nfs.writeFileSync(args[1], String(process.pid));\nsetInterval(() => {}, 1000);`);
  const driver = join(freshDir('driver'), 'driver.mjs');
  writeFileSync(
    driver,
    `import {appendFileSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {run, runCli} from ${JSON.stringify(cliUrl)};
const [bin, target, pidFile, log, graceMs] = process.argv.slice(2);
const childAlive = () => {
  try {
    process.kill(Number(readFileSync(pidFile, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
};
process.exitCode = await runCli('driver', async (cleanup) => {
  writeFileSync(target, 'temp');
  cleanup.add(() => {
    rmSync(target, {force: true});
    appendFileSync(log, 'cleanup childAlive=' + childAlive() + '\\n');
  });
  await run(bin, [target, pidFile]);
}, {killGraceMs: Number(graceMs)});
`,
  );
  const {child, exited} = spawnNode(driver, [bin, target, pidFile, log, String(killGraceMs)]);
  return {wrapper: child, exited, pid: await startedPid(pidFile), dir, target, log};
};

describe('signal shutdown', () => {
  // The child outlives the signal by ~500 ms and re-creates the temp file; the
  // wrapper must wait for it, so the file is gone for good.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    it(`cleanup runs only after every child has exited after a signal (${signal} exits ${exitCodeFor(signal)})`, BOUNDED, async () => {
      const c = await startCase(
        `const rewrite = () => setTimeout(() => { fs.writeFileSync(args[0], 'late'); process.exit(1); }, 500);
process.on('SIGTERM', rewrite);
process.on('SIGINT', rewrite);`,
        60_000,
      );
      c.wrapper.kill(signal);
      assert.equal(await c.exited, exitCodeFor(signal));
      const childAliveAtExit = isAlive(c.pid);
      // If the wrapper left early, let the orphan finish so the assertion sees its write.
      await waitFor(() => !isAlive(c.pid), 'the fake child to exit');
      assert.equal(existsSync(c.target), false, 'the child re-created the temp file after cleanup');
      assert.equal(childAliveAtExit, false, 'the wrapper exited while its child was still running');
      // The child got the forwarded signal (it exited through its own handler, after rewriting).
      assert.equal(readFileSync(c.log, 'utf8'), 'cleanup childAlive=false\n');
    });
  }

  it('a child that ignores the signal is SIGKILLed after the bounded wait, then cleanup runs', BOUNDED, async () => {
    const graceMs = 300;
    const c = await startCase(`process.on('SIGTERM', () => {});`, graceMs);
    const start = Date.now();
    c.wrapper.kill('SIGTERM');
    assert.equal(await c.exited, 143);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= graceMs - 50, `exited after ${elapsed} ms, before the ${graceMs} ms grace period`);
    assert.ok(elapsed < graceMs + 5_000, `exited after ${elapsed} ms, far past the ${graceMs} ms grace period`);
    assert.equal(isAlive(c.pid), false);
    assert.equal(readFileSync(c.log, 'utf8'), 'cleanup childAlive=false\n');
    assert.equal(existsSync(c.target), false);
  });

  it('the child receives the forwarded signal itself', BOUNDED, async () => {
    const c = await startCase(
      `process.on('SIGINT', () => { fs.writeFileSync(args[0] + '.got-SIGINT', ''); process.exit(0); });`,
      60_000,
    );
    c.wrapper.kill('SIGINT');
    assert.equal(await c.exited, 130);
    assert.equal(existsSync(`${c.target}.got-SIGINT`), true);
  });

  // Decided behavior: a second signal skips the rest of the grace period (SIGKILLs
  // the children now) but still waits for them, cleans up once, and exits with the
  // first signal's code.
  it("a second signal during the wait doesn't run cleanup twice or exit early with children alive", BOUNDED, async () => {
    const c = await startCase(
      `const onSignal = () => fs.writeFileSync(args[0] + '.signalled', '');
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);`,
      60_000,
    );
    const start = Date.now();
    c.wrapper.kill('SIGTERM');
    // The child seeing the forwarded signal means the wrapper is now in its wait.
    await waitFor(() => existsSync(join(c.dir, 'temp.txt.signalled')), 'the forwarded signal');
    c.wrapper.kill('SIGINT');
    assert.equal(await c.exited, 143);
    assert.ok(Date.now() - start < 30_000, 'the second signal did not cut the grace period short');
    assert.equal(isAlive(c.pid), false);
    assert.equal(readFileSync(c.log, 'utf8'), 'cleanup childAlive=false\n');
    assert.equal(existsSync(c.target), false);
  });

  it("no orphaned timers: a child that exits promptly doesn't hold the wrapper for the grace period", BOUNDED, async () => {
    const c = await startCase('', 60_000);
    const start = Date.now();
    c.wrapper.kill('SIGINT');
    assert.equal(await c.exited, 130);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10_000, `exited after ${elapsed} ms: something waited on the 60 s grace timer`);
    assert.equal(readFileSync(c.log, 'utf8'), 'cleanup childAlive=false\n');
  });

  // The guard matters only with concurrent children: A dies on the signal, main reacts
  // by starting another child, while shutdown is still waiting for B (which ignores
  // SIGTERM until the grace period SIGKILLs it).
  it('no new child starts once a signal has arrived', BOUNDED, async () => {
    const dir = freshDir('second-child');
    const target = join(dir, 'temp.txt');
    const log = join(dir, 'cleanup.log');
    const pidA = join(dir, 'a.pid');
    const pidB = join(dir, 'b.pid');
    const pidSecond = join(dir, 'second.pid');
    const marker = join(dir, 'second-child-ran');
    const idle = `fs.writeFileSync(args[0], String(process.pid));\nsetInterval(() => {}, 1000);`;
    const binA = fakeBin('child-a', idle);
    const binB = fakeBin('child-b', `process.on('SIGTERM', () => {});\n${idle}`);
    const secondBin = fakeBin('second', `fs.writeFileSync(${JSON.stringify(pidSecond)}, String(process.pid));\nfs.writeFileSync(${JSON.stringify(marker)}, '');`);
    const driver = join(freshDir('driver'), 'driver.mjs');
    writeFileSync(
      driver,
      `import {appendFileSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {run, runCli} from ${JSON.stringify(cliUrl)};
const [binA, binB, secondBin, target, pidA, pidB, log] = process.argv.slice(2);
const bAlive = () => {
  try {
    process.kill(Number(readFileSync(pidB, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
};
process.exitCode = await runCli('driver', async (cleanup) => {
  writeFileSync(target, 'temp');
  cleanup.add(() => {
    rmSync(target, {force: true});
    appendFileSync(log, 'cleanup childAlive=' + bAlive() + '\\n');
  });
  const b = run(binB, [pidB]).catch(() => {});
  await run(binA, [pidA]).catch(() => {});
  await run(secondBin, []).catch(() => {});
  await b;
}, {killGraceMs: 3000});
`,
    );
    const {child, exited} = spawnNode(driver, [binA, binB, secondBin, target, pidA, pidB, log]);
    await startedPid(pidA);
    const b = await startedPid(pidB);
    child.kill('SIGTERM');
    assert.equal(await exited, 143);
    if (readPid(pidSecond) > 0) trackPid(readPid(pidSecond));
    assert.equal(existsSync(marker), false, 'a child was started after the signal');
    assert.equal(isAlive(b), false);
    assert.equal(readFileSync(log, 'utf8'), 'cleanup childAlive=false\n');
    assert.equal(existsSync(target), false);
  });
});

describe('runCli and the child helpers (in process)', () => {
  it('cleanup runs exactly once on success and on failure; a CliError prints without a stack and exits 1', async () => {
    let runs = 0;
    assert.equal(await silence(() => runCli('t', (cleanup) => void cleanup.add(() => runs++))), 0);
    assert.equal(runs, 1);
    const failing = await silence(() =>
      runCli('t', (cleanup) => {
        cleanup.add(() => runs++);
        throw new CliError('plain message');
      }),
    );
    assert.equal(failing, 1);
    assert.equal(runs, 2);
  });

  it('capture returns stdout; run and capture reject a failing or missing command with a CliError', async () => {
    assert.equal(await capture(fakeBin('echo', `process.stdout.write('hi ' + args.join(','));`), ['a', 'b']), 'hi a,b');
    await assert.rejects(run(fakeBin('fail', 'process.exit(4);'), [], {label: 'fail'}), (e) => e instanceof CliError && /fail failed \(exit code 4\)/.test(e.message));
    await assert.rejects(capture(missingPath('nope'), []), (e) => e instanceof CliError && /could not run/.test(e.message));
  });

  it('env replaces the child environment; without it the child inherits process.env', async () => {
    const printEnv = fakeBin('env', `process.stdout.write(JSON.stringify([process.env.U4_PROBE ?? null, process.env.PATH ? 'path' : null]));`);
    process.env.U4_PROBE = 'inherited';
    try {
      assert.deepEqual(JSON.parse(await capture(printEnv, [])), ['inherited', 'path']);
      assert.deepEqual(JSON.parse(await capture(printEnv, [], {env: {...process.env, U4_PROBE: 'given'}})), ['given', 'path']);
    } finally {
      delete process.env.U4_PROBE;
    }
  });
});
