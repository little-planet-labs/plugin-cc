// Helpers for the script tests (cli-*, analyze-*, align-*, setup-*): a scratch
// directory per test process, fake executables, and process utilities. Real
// ffmpeg, python, pip and playwright are replaced with tiny Node scripts.
import {spawn} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {after} from 'node:test';
import {fileURLToPath} from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const scratch = mkdtempSync(join(tmpdir(), 'music-video-scripts-test-'));
after(() => rmSync(scratch, {recursive: true, force: true}));

let n = 0;
/** A new empty directory under this process's scratch directory. */
export const freshDir = (label) => {
  const dir = join(scratch, `${label}-${n++}`);
  mkdirSync(dir, {recursive: true});
  return dir;
};

/** A path under scratch that doesn't exist. */
export const missingPath = (name) => join(scratch, 'does-not-exist', name);

/** A fake executable: a Node script with `body` (has `fs` and `args` = argv after the script). */
export const fakeBin = (name, body, dir = freshDir('bin')) => {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

/** Poll until `cond` holds. The deadline is only a safety net, never the assertion. */
export const waitFor = async (cond, what, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

export const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid a fake wrote to `file`, or 0 until it has been fully written. */
export const readPid = (file) => (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0);

// Fakes that trap or ignore signals would outlive a failing run; kill them all at the end.
const fakePids = new Set();
after(() => {
  for (const pid of fakePids) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
});
/** Remember a fake's pid for the end-of-file sweep. */
export const trackPid = (pid) => fakePids.add(pid);
/** Wait for a fake to write its pid, and remember it for the sweep. */
export const startedPid = async (file) => {
  await waitFor(() => readPid(file) > 0, 'the fake child to start');
  const pid = readPid(file);
  fakePids.add(pid);
  return pid;
};

/** Run a Node script as a separate process (signals can't be tested in-process). */
export const spawnNode = (script, args = []) => {
  const child = spawn(process.execPath, [script, ...args], {stdio: 'ignore'});
  const exited = new Promise((res) => child.on('exit', (code) => res(code)));
  return {child, exited};
};

export const exitCodeFor = (signal) => (signal === 'SIGINT' ? 130 : 143);

/**
 * Run `fn` with console.log/warn/error captured instead of printed. Resolves to
 * {result, output} where output is everything logged, one entry per call.
 */
export const quiet = async (fn) => {
  const {log, warn, error} = console;
  const output = [];
  const keep = (...args) => output.push(args.join(' '));
  console.log = keep;
  console.warn = keep;
  console.error = keep;
  try {
    return {result: await fn(), output};
  } finally {
    console.log = log;
    console.warn = warn;
    console.error = error;
  }
};

/** Like quiet, resolving to fn's result only. */
export const silence = async (fn) => (await quiet(fn)).result;
