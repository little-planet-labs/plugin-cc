// Process helpers for the pnpm scripts: async child processes and a CLI runner
// that always cleans up temp files, whether the script succeeds, throws, or is
// interrupted (SIGINT/SIGTERM).
//
// Never call process.exit() from a script body: it skips `finally` blocks and
// leaks temp files. Throw instead; runCli reports the error and returns the exit code.
import {spawn} from 'node:child_process';
import {clearTimeout, setTimeout} from 'node:timers';

/** An error whose message is shown to the user as-is (no stack trace). */
export class CliError extends Error {}

/** How long children get to exit after a forwarded signal before they're SIGKILLed. */
export const KILL_GRACE_MS = 5000;

// Each running child, mapped to a promise that settles once it has exited.
const activeChildren = new Map();
// Set when a signal starts shutdown: from then on no new child may start, so the
// set of children cleanup waits for can only shrink.
let shuttingDown = false;

const killChildren = (signal) => {
  for (const child of activeChildren.keys()) child.kill(signal);
};

// Spawn a tracked child; resolve with its captured stdout ('' unless captured)
// when it exits 0, reject with a CliError otherwise.
const spawnTracked = (bin, args, {cwd, label = bin, captureStdout = false} = {}) =>
  new Promise((resolvePromise, reject) => {
    if (shuttingDown) {
      reject(new CliError(`${label} not started: interrupted`));
      return;
    }
    const child = spawn(bin, args, {cwd, stdio: captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit'});
    let settleExited;
    activeChildren.set(child, new Promise((r) => (settleExited = r)));
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
    shutdown = Promise.all(activeChildren.values()).then(() => {
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
