// The render pool: chunk ranges and a hard cap on parallel chunk workers.
//
// The cap is a semaphore over the worker handles this process started and
// still tracks: a slot is taken (synchronously) before a worker is spawned and
// given back only after that worker's exit event (and its whole process
// family is gone, see spawnGroup in cli.mjs) and its chunk has been checked.
// Nothing here asks the shell how many jobs run: a zsh `jobs -r` count once
// read zero inside a subshell and launched 24 4K chunks at once.
import {clearTimeout, setTimeout} from 'node:timers';
import {CliError, KILL_GRACE_MS} from './cli.mjs';

/** Default stagger between two worker starts, so two Chromiums don't boot at the same instant. */
export const STAGGER_MS = 1500;

/**
 * Split frames [first, last) into chunks of about `chunkFrames` frames:
 * n = ceil(len / chunkFrames) chunks, chunk k = [first + floor(len*k/n), first + floor(len*(k+1)/n)),
 * so they tile the range with no gap or overlap and differ in length by at most one frame.
 * @param {number} first
 * @param {number} last Exclusive.
 * @param {number} chunkFrames
 * @returns {{index: number, from: number, to: number}[]}
 */
export const chunkRanges = (first, last, chunkFrames) => {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last <= first) {
    throw new CliError(`can't chunk the frame range [${first}, ${last})`);
  }
  if (!Number.isInteger(chunkFrames) || chunkFrames < 1) throw new CliError(`a chunk must be at least one frame (got ${chunkFrames})`);
  const len = last - first;
  const n = Math.ceil(len / chunkFrames);
  return Array.from({length: n}, (_, k) => ({index: k, from: first + Math.floor((len * k) / n), to: first + Math.floor((len * (k + 1)) / n)}));
};

/** A pool size: a positive integer, else a CliError naming where it came from. */
export const poolSize = (value, where) => {
  if (!Number.isInteger(value) || value < 1) throw new CliError(`${where} must be a whole number of workers, at least 1 (got ${value})`);
  return value;
};

/**
 * @template T
 * @typedef {object} PoolOptions
 * @property {T[]} items Work items (chunks), started in order.
 * @property {number} cap At most this many workers alive at once (>= 1).
 * @property {number} retries Extra attempts a failed item gets (>= 0).
 * @property {(item: T, attempt: number) => {pid?: number, exited: Promise<{code: number | null, signal: string | null, error: string | null}>,
 *   kill: (signal: NodeJS.Signals) => void}} start Start a worker (cli.mjs spawnGroup). May throw (e.g. interrupted).
 * @property {(item: T) => Promise<string | null>} check After a worker exits 0: null when its output is good, else why not.
 * @property {(item: T) => void} discard Remove a failed attempt's output (it is never used).
 * @property {(item: T) => string} [name] For messages.
 * @property {number} [staggerMs] Minimum gap between two starts while another worker is alive.
 * @property {number} [killGraceMs] On a fatal failure: SIGTERM, then SIGKILL after this long.
 * @property {(msg: string) => void} [log]
 */

/**
 * Run every item through at most `cap` workers. An item whose worker exits
 * nonzero, or whose output fails `check`, is discarded and queued again at the
 * front, alone (the others are untouched), up to `retries` more times. When an
 * item runs out of attempts, or `start`/`check` throws, every live worker is
 * stopped (SIGTERM, SIGKILL after the grace), waited for, and the error is
 * thrown. Resolves when every item has passed `check`.
 * @template T
 * @param {PoolOptions<T>} o
 */
export const runPool = async ({items, cap, retries, start, check, discard, name = String, staggerMs = STAGGER_MS, killGraceMs = KILL_GRACE_MS, log = () => {}}) => {
  poolSize(cap, 'the pool size');
  if (!Number.isInteger(retries) || retries < 0) throw new CliError(`retries must be a whole number >= 0 (got ${retries})`);
  const queue = items.map((item) => ({item, attempts: 0}));
  /** @type {Set<{item: T, attempts: number, handle?: ReturnType<PoolOptions<T>['start']>}>} */
  const live = new Set();
  const outcomes = [];
  let wake = null;
  let stopping = false;
  let lastStart = -Infinity;

  // Remove a failed attempt's output. A failure to remove it is fatal (a stale file must not linger).
  const drop = (entry, outcome) => {
    try {
      discard(entry.item);
      return outcome;
    } catch (err) {
      return {entry, fatal: err};
    }
  };

  // One slot: start, wait for the exit event, check. Never rejects.
  const runSlot = async (entry) => {
    entry.attempts += 1;
    try {
      entry.handle = start(entry.item, entry.attempts);
    } catch (err) {
      return {entry, fatal: err};
    }
    const result = await entry.handle.exited;
    if (stopping) return drop(entry, {entry, reason: 'stopped'});
    if (result.error || result.code !== 0) {
      return drop(entry, {entry, reason: result.error ?? (result.signal ? `killed by ${result.signal}` : `exit code ${result.code}`)});
    }
    let reason;
    try {
      reason = await check(entry.item);
    } catch (err) {
      return drop(entry, {entry, fatal: err});
    }
    return reason === null ? {entry, reason} : drop(entry, {entry, reason});
  };

  const launch = (entry) => {
    live.add(entry); // the slot is taken before the process exists
    lastStart = Date.now();
    runSlot(entry)
      .catch((err) => ({entry, fatal: err})) // a `start` handle whose exited rejects
      .then((outcome) => {
        live.delete(entry);
        outcomes.push(outcome);
        wake?.();
      });
  };

  const stopAll = async () => {
    stopping = true;
    const waiting = [...live].map((e) => e.handle?.exited).filter(Boolean);
    for (const e of live) e.handle?.kill('SIGTERM');
    const escalate = setTimeout(() => {
      for (const e of live) e.handle?.kill('SIGKILL');
    }, killGraceMs);
    await Promise.all(waiting);
    // Let every slot finish its bookkeeping (discard) before returning.
    while (live.size > 0) await new Promise((r) => (wake = r));
    clearTimeout(escalate);
  };

  for (;;) {
    while (outcomes.length > 0) {
      const {entry, reason = null, fatal} = outcomes.shift();
      if (fatal) {
        await stopAll();
        throw fatal;
      }
      if (reason === null) {
        log(`${name(entry.item)} done`);
        continue;
      }
      if (entry.attempts > retries) {
        await stopAll();
        throw new CliError(`${name(entry.item)} failed ${entry.attempts} time(s), last: ${reason}`);
      }
      log(`${name(entry.item)} failed (${reason}); retrying it alone (attempt ${entry.attempts + 1} of ${retries + 1})`);
      queue.unshift(entry);
    }
    if (queue.length === 0 && live.size === 0) return;
    const wait = live.size === 0 ? 0 : lastStart + staggerMs - Date.now();
    if (queue.length > 0 && live.size < cap && wait <= 0) {
      launch(queue.shift());
      continue;
    }
    // Sleep until a slot settles, or the stagger allows the next start.
    await new Promise((r) => {
      wake = r;
      if (queue.length > 0 && live.size < cap) {
        const t = setTimeout(r, wait);
        wake = () => {
          clearTimeout(t);
          r();
        };
      }
    });
    wake = null;
  }
};
