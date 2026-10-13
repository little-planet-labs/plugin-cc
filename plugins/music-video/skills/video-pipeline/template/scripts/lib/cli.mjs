// Process helpers for the pnpm scripts: async child processes and a CLI runner
// that always cleans up temp files, whether the script succeeds, throws, or is
// interrupted (SIGINT/SIGTERM).
//
// Never call process.exit() from a script body: it skips `finally` blocks and
// leaks temp files. Throw instead; runCli reports the error and returns the exit code.
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {clearInterval, clearTimeout, setInterval, setTimeout} from 'node:timers';

/** An error whose message is shown to the user as-is (no stack trace). */
export class CliError extends Error {}

/** How long children get to exit after a forwarded signal before they're SIGKILLed. */
export const KILL_GRACE_MS = 5000;

/**
 * After spawnGroup SIGKILLs a family's stragglers, how long (at least) it waits
 * for them to disappear before giving up. A SIGKILLed process is gone within
 * milliseconds (measured 5-6 ms for a re-parented node process), so this only
 * bounds one SIGKILL can't remove; it leaves room for several family snapshots
 * (about 0.1 s each with ps -E, slower under load).
 */
export const KILL_SETTLE_MS = 2000;

// Each running child, mapped to {exited, kill}: a promise that settles once it
// (and, for a process group, everything in it) has exited, and how to signal it.
const activeChildren = new Map();
// Set when a signal starts shutdown: from then on no new child may start, so the
// set of children cleanup waits for can only shrink.
let shuttingDown = false;

const killChildren = (signal) => {
  for (const {kill} of activeChildren.values()) kill(signal);
};

// Spawn a tracked child; resolve with its captured stdout ('' unless captured)
// when it exits 0, reject with a CliError otherwise. `env` replaces the child's
// environment (default: inherit process.env, so PIP_USE_DEPRECATED and the like pass through).
const spawnTracked = (bin, args, {cwd, env, label = bin, captureStdout = false} = {}) =>
  new Promise((resolvePromise, reject) => {
    if (shuttingDown) {
      reject(new CliError(`${label} not started: interrupted`));
      return;
    }
    const child = spawn(bin, args, {cwd, env, stdio: captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    let settleExited;
    activeChildren.set(child, {exited: new Promise((r) => (settleExited = r)), kill: (signal) => child.kill(signal)});
    const gone = () => {
      activeChildren.delete(child);
      settleExited();
    };
    let stdout = '';
    if (captureStdout) child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', (err) => {
      gone();
      reject(new CliError(`could not run ${label}: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      gone();
      if (code === 0) resolvePromise(stdout);
      else reject(new CliError(`${label} failed (${signal ? `signal ${signal}` : `exit code ${code}`})`));
    });
  });

/**
 * Run a command and resolve when it exits 0; reject with a CliError otherwise.
 * stdio is inherited so progress output streams through.
 */
export const run = async (bin, args, options) => {
  await spawnTracked(bin, args, options);
};

/**
 * Run a command and resolve with its stdout when it exits 0 (stderr streams
 * through); reject with a CliError otherwise. Same tracking and signal
 * handling as `run`.
 */
export const capture = (bin, args, options = {}) => spawnTracked(bin, args, {...options, captureStdout: true});

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The environment variable spawnGroup marks a family with: every process the
 * child starts inherits it (Playwright's driver passes its environment on to
 * Chromium, and Chromium to its helpers), so a member is found by it whoever
 * its parent is now. ps -E shows the environment of the user's own processes
 * (not of platform binaries such as /bin/sleep, which the parent and group
 * links still cover).
 */
export const FAMILY_ENV = 'MV_PROCESS_FAMILY';

/**
 * Every process as [pid, ppid, pgid, command-and-environment], from
 * `ps -A -ww -E` (empty when ps fails).
 * @returns {[number, number, number, string][]}
 */
export const processTable = () => {
  let out;
  try {
    out = execFileSync('ps', ['-A', '-ww', '-E', '-o', 'pid=,ppid=,pgid=,command='], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28});
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, pid, ppid, pgid, command]) => [Number(pid), Number(ppid), Number(pgid), command]);
};

/**
 * The live processes that belong to the family of `leader`: the leader, every
 * member of its process group, every process carrying FAMILY_ENV=`token` in
 * its environment, and, transitively, every child of one of them. The group
 * misses Chromium (Playwright starts it in a process group of its own) and the
 * parent link is lost once a parent dies (the child is re-parented to
 * launchd); the token survives both.
 * @param {number} leader
 * @param {(number | string)[][]} [table] [pid, ppid, pgid, command?] rows (default: ps).
 * @param {string | null} [token]
 * @returns {Set<number>}
 */
export const processFamily = (leader, table = processTable(), token = null) => {
  const mark = token === null ? null : new RegExp(`(^|\\s)${FAMILY_ENV}=${token}(\\s|$)`);
  const family = new Set(
    table.filter(([pid, , pgid, command]) => pid === leader || pgid === leader || (mark !== null && mark.test(String(command ?? '')))).map(([pid]) => pid),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of table) {
      if (!family.has(pid) && family.has(ppid)) {
        family.add(pid);
        grew = true;
      }
    }
  }
  family.delete(process.pid);
  return family;
};

/**
 * Start `bin` as the leader of a new process group (spawn `detached`), tracked
 * like `run`: a signal to the CLI reaches it, and shutdown waits for it. Use it
 * for a child that starts processes of its own (a render worker with its
 * Chromium and ffmpeg), so stopping it stops all of them.
 *
 * The child gets a unique FAMILY_ENV token in its environment, which every
 * process it starts inherits. Returns {pid, exited, kill}. The family
 * (processFamily: group, token and parent links) is snapshotted every
 * `watchMs` while the child runs, at every kill and while waiting for exit,
 * and remembered, so a process re-parented after its parent died (a Chromium
 * whose Playwright driver crashed) is still reached, also one started and
 * orphaned between two snapshots. kill(signal) signals the whole group and
 * every remembered process. exited never rejects: it resolves to {code,
 * signal, error} once the child has exited AND no process of its family is
 * left; stragglers still alive `killGraceMs` after the child exited are
 * SIGKILLed, and then get at least KILL_SETTLE_MS (measured from the SIGKILL,
 * never ending in the pass that sent it) to disappear before the wait gives up
 * with a message. Throws a CliError once a signal has started shutdown (no
 * new child may start). `table` replaces the process-table read (tests).
 * @param {string} bin
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, label?: string, stdio?: import('node:child_process').StdioOptions,
 *   killGraceMs?: number, watchMs?: number, table?: () => (number | string)[][]}} [options]
 * @returns {{pid: number | undefined, exited: Promise<{code: number | null, signal: string | null, error: string | null}>,
 *   kill: (signal: NodeJS.Signals) => void}}
 */
export const spawnGroup = (bin, args, {cwd, env, label = bin, stdio = 'inherit', killGraceMs = KILL_GRACE_MS, watchMs = 2000, table: readTable = processTable} = {}) => {
  if (shuttingDown) throw new CliError(`${label} not started: interrupted`);
  const token = randomUUID();
  const child = spawn(bin, args, {cwd, env: {...(env ?? process.env), [FAMILY_ENV]: token}, stdio, detached: true});
  // Pids seen in the family and still alive at the last snapshot (a dead one is dropped, so a reused pid isn't hit).
  const known = new Set();
  const remember = () => {
    if (child.pid === undefined) return;
    const table = readTable();
    const live = new Set(table.map(([pid]) => pid));
    for (const pid of known) if (!live.has(pid)) known.delete(pid);
    for (const pid of processFamily(child.pid, table, token)) known.add(pid);
  };
  const watch = setInterval(remember, watchMs);
  watch.unref();
  const signalAll = (signal) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      // the group is already empty
    }
    for (const pid of known) {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  };
  const kill = (signal) => {
    remember();
    signalAll(signal);
  };
  let settle;
  const exited = new Promise((r) => (settle = r));
  activeChildren.set(child, {exited, kill});
  let finished = false;
  const finish = async (result) => {
    if (finished) return;
    finished = true;
    clearInterval(watch);
    if (child.pid !== undefined) {
      // Wait for the rest of the family (the group's members and anything they started) to go.
      const deadline = Date.now() + killGraceMs;
      let killedAt = null; // when the stragglers were SIGKILLed
      for (;;) {
        remember();
        for (const pid of known) if (!isAlive(pid)) known.delete(pid);
        if (known.size === 0) break;
        if (killedAt === null) {
          if (Date.now() >= deadline) {
            killedAt = Date.now();
            signalAll('SIGKILL');
          }
        } else if (Date.now() - killedAt >= Math.max(killGraceMs, KILL_SETTLE_MS)) {
          // A process SIGKILL can't remove (a zombie whose parent never reaps it) must not hang the CLI. Measured
          // from the SIGKILL and never in the pass that sent it: a slow snapshot can't skip the killed processes' exit.
          console.error(`${label}: process(es) ${[...known].join(', ')} still present after SIGKILL`);
          break;
        }
        await sleep(100);
      }
    }
    activeChildren.delete(child);
    settle(result);
  };
  child.on('error', (err) => void finish({code: null, signal: null, error: `could not run ${label}: ${err.message}`}));
  child.on('exit', (code, signal) => void finish({code, signal, error: null}));
  return {pid: child.pid, exited, kill};
};

/**
 * Run `main(cleanup)` as a CLI. `cleanup` is a Set of synchronous functions the
 * script registers as it creates temp files; they all run exactly once on
 * success, on error, and on SIGINT/SIGTERM. On a signal, cleanup waits until every
 * child has exited (a child still running could re-create a file cleanup removed):
 * the signal is forwarded, and children still alive after `killGraceMs` are SIGKILLed.
 * Resolves to the exit code; the entry point assigns it to process.exitCode.
 */
export const runCli = async (name, main, {killGraceMs = KILL_GRACE_MS} = {}) => {
  const cleanup = new Set();
  let cleaned = false;
  const runCleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanup) {
      try {
        fn();
      } catch (err) {
        console.error(`${name}: cleanup failed: ${err.message}`);
      }
    }
  };

  // Settles never: shutdown ends the process once the children are gone.
  let shutdown = null;
  const onSignal = (signal) => {
    if (shutdown) {
      // A second signal (e.g. Ctrl-C pressed again) means "stop now": skip the rest
      // of the grace period. Shutdown still waits for the killed children to exit,
      // cleans up once, and exits with the first signal's code. The handlers stay
      // installed (not `once`) so a second signal never takes Node's default exit,
      // which would skip cleanup and orphan the children.
      killChildren('SIGKILL');
      return;
    }
    shuttingDown = true;
    killChildren(signal);
    const escalate = setTimeout(() => killChildren('SIGKILL'), killGraceMs);
    shutdown = Promise.all([...activeChildren.values()].map((c) => c.exited)).then(() => {
      clearTimeout(escalate);
      runCleanup();
      console.error(`${name}: interrupted (${signal})`);
      // A signal handler has no `finally` left to skip: cleanup already ran.
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  let code = 0;
  try {
    await main(cleanup);
  } catch (err) {
    console.error(`${name}: ${err instanceof CliError ? err.message : (err?.stack ?? String(err))}`);
    code = 1;
  } finally {
    // After a signal, main usually ends as soon as its child is killed. Cleanup and
    // the exit belong to the shutdown, which waits for every child, so park here.
    if (shutdown) await shutdown;
    runCleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  return code;
};
