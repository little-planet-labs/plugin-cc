// The pnpm scripts must leave no intermediate or temp files behind on any exit
// path: success, a failing child process, or SIGINT/SIGTERM. Real remotion,
// ffmpeg and python are replaced with tiny fake executables.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {after, describe, it} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {main as analyzeMain} from '../scripts/analyze.mjs';
import {main as renderMain, parseRenderArgs} from '../scripts/render.mjs';
import {contactSheetTimes, main as contactSheetMain, parseContactSheetArgs} from '../scripts/contact-sheet.mjs';
import {
  main as previewMain,
  parsePreviewArgs,
  PREVIEW_LIMIT_BYTES,
  PREVIEW_MAX_VIDEO_KBPS,
  PREVIEW_TARGET_BYTES,
  previewBitrates,
} from '../scripts/preview.mjs';
import {parseStillArgs} from '../scripts/still.mjs';
import {main as alignMain} from '../scripts/align.mjs';
import {main as setupAlignMain} from '../scripts/setup-align.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'music-video-scripts-test-'));
after(() => rmSync(scratch, {recursive: true, force: true}));

let n = 0;
const freshDir = (label: string) => {
  const dir = join(scratch, `${label}-${n++}`);
  mkdirSync(dir, {recursive: true});
  return dir;
};

/** A fake executable: a Node script with `body` (has `args` = argv after the script). */
const fakeBin = (name: string, body: string) => {
  const path = join(freshDir('bin'), name);
  writeFileSync(path, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

// remotion's argv: render <entry> <comp> <output> ...flags -> output is args[3].
const remotionWrites = (exitCode: number) => fakeBin('remotion', `fs.writeFileSync(args[3], 'mkv'); process.exit(${exitCode});`);
// ffmpeg's output path is its last argument.
const ffmpegWrites = (exitCode: number) =>
  fakeBin('ffmpeg', `fs.writeFileSync(args[args.length - 1], 'mp4'); process.exit(${exitCode});`);

/** Poll until `cond` holds. The deadline is only a safety net, never the assertion. */
const waitFor = async (cond: () => boolean, what: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid a fake wrote to `file`, or 0 until it has been fully written. */
const readPid = (file: string) => (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0);

// Fakes that trap or ignore signals would outlive a failing run; kill them all at the end.
const fakePids = new Set<number>();
after(() => {
  for (const pid of fakePids) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
});
/** Wait for a fake to write its pid, and remember it for the `after` sweep. */
const startedPid = async (file: string) => {
  await waitFor(() => readPid(file) > 0, 'the fake child to start');
  const pid = readPid(file);
  fakePids.add(pid);
  return pid;
};

/** Run a Node script as a separate process (signals can't be tested in-process). */
const spawnNode = (script: string, args: string[] = []) => {
  const child = spawn(process.execPath, [script, ...args], {stdio: 'ignore'});
  const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));
  return {child, exited};
};

/** A driver that runs `pnpm render` (via main) with a fake remotion. */
const renderDriver = (outDir: string, remotionBin: string) => {
  const driver = join(freshDir('driver'), 'driver.mjs');
  writeFileSync(
    driver,
    `import {main} from ${JSON.stringify(pathToFileURL(join(projectRoot, 'scripts/render.mjs')).href)};\n` +
      `process.exitCode = await main(['--out', ${JSON.stringify(join(outDir, 'video.mp4'))}], ` +
      `{root: ${JSON.stringify(projectRoot)}, remotionBin: ${JSON.stringify(remotionBin)}, ffmpegBin: 'ffmpeg'});\n`,
  );
  return driver;
};

const exitCodeFor = (signal: 'SIGINT' | 'SIGTERM') => (signal === 'SIGINT' ? 130 : 143);

const silence = <T>(fn: () => Promise<T>) => {
  const {log, error} = console;
  console.log = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.log = log;
    console.error = error;
  });
};

describe('parseRenderArgs', () => {
  it('accepts --out <path> and --out=<path>, forwards --flag=value', () => {
    assert.deepEqual(parseRenderArgs(['--out', 'out/a.mp4', '--frames=0-89'], {root: '/r'}), {
      output: '/r/out/a.mp4',
      passthrough: ['--frames=0-89'],
    });
    assert.equal(parseRenderArgs(['--out=out/b.mp4'], {root: '/r'}).output, '/r/out/b.mp4');
    assert.equal(parseRenderArgs([], {root: projectRoot}).output, join(projectRoot, 'out/music-video.mp4'));
  });
  it('rejects codec overrides, positional args, a missing --out value and non-mp4 output', () => {
    assert.throws(() => parseRenderArgs(['--codec=h265']), /--codec can't be overridden/);
    assert.throws(() => parseRenderArgs(['--audio-codec=mp3']), /--audio-codec can't be overridden/);
    assert.throws(() => parseRenderArgs(['--audio-codec', 'mp3']), /--audio-codec can't be overridden/);
    assert.throws(() => parseRenderArgs(['out/x.mp4']), /unexpected argument "out\/x\.mp4"/);
    assert.throws(() => parseRenderArgs(['--frames', '0-89']), /unexpected argument "0-89".*--flag=value/);
    assert.throws(() => parseRenderArgs(['--out']), /--out needs a path/);
    assert.throws(() => parseRenderArgs(['--out', '--frames=1']), /--out needs a path/);
    assert.throws(() => parseRenderArgs(['--out=x.mov']), /must end in \.mp4/);
  });
});

describe('render cleanup', () => {
  const run = (outDir: string, bins: {remotionBin: string; ffmpegBin: string}) =>
    silence(() => renderMain(['--out', join(outDir, 'video.mp4')], {root: projectRoot, ...bins}));

  it('remotion failing after writing the intermediate: exit 1, nothing left in the output dir', async () => {
    const outDir = freshDir('render-remotion-fails');
    const code = await run(outDir, {remotionBin: remotionWrites(1), ffmpegBin: ffmpegWrites(0)});
    assert.equal(code, 1);
    assert.deepEqual(readdirSync(outDir), []);
  });

  it('ffmpeg failing after writing a partial file: exit 1, no intermediate, no partial, no output', async () => {
    const outDir = freshDir('render-ffmpeg-fails');
    const code = await run(outDir, {remotionBin: remotionWrites(0), ffmpegBin: ffmpegWrites(1)});
    assert.equal(code, 1);
    assert.deepEqual(readdirSync(outDir), []);
  });

  it('ffmpeg missing entirely: exit 1, intermediate removed', async () => {
    const outDir = freshDir('render-no-ffmpeg');
    const code = await run(outDir, {remotionBin: remotionWrites(0), ffmpegBin: join(scratch, 'does-not-exist')});
    assert.equal(code, 1);
    assert.deepEqual(readdirSync(outDir), []);
  });

  it('success: only the final output remains', async () => {
    const outDir = freshDir('render-ok');
    const code = await run(outDir, {remotionBin: remotionWrites(0), ffmpegBin: ffmpegWrites(0)});
    assert.equal(code, 0);
    assert.deepEqual(readdirSync(outDir), ['video.mp4']);
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`${signal} mid-render: exits ${exitCodeFor(signal)} and removes the intermediate`, async () => {
      const outDir = freshDir(`render-${signal}`);
      // Fake remotion writes the intermediate, then hangs until killed.
      const remotionBin = fakeBin('remotion', `fs.writeFileSync(args[3], 'mkv'); setInterval(() => {}, 1000);`);
      const {child, exited} = spawnNode(renderDriver(outDir, remotionBin));
      await waitFor(() => readdirSync(outDir).some((f) => f.startsWith('.intermediate-')), 'the intermediate');
      child.kill(signal);
      assert.equal(await exited, exitCodeFor(signal));
      assert.deepEqual(readdirSync(outDir), []);
    });
  }
});

describe('signal shutdown', () => {
  // Invariants 1 and 3: the child outlives the signal by ~500 ms and re-creates the
  // intermediate; the wrapper must wait for it, so the file is gone for good.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    it(`cleanup runs only after every child has exited after a signal (${signal} exits ${exitCodeFor(signal)})`, async () => {
      const outDir = freshDir(`render-late-${signal}`);
      const pidFile = join(freshDir('pid'), 'remotion.pid');
      const remotionBin = fakeBin(
        'remotion',
        `const rewrite = () => setTimeout(() => { fs.writeFileSync(args[3], 'late mkv'); process.exit(1); }, 500);
process.on('SIGTERM', rewrite);
process.on('SIGINT', rewrite);
fs.writeFileSync(args[3], 'mkv');
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);`,
      );
      const {child, exited} = spawnNode(renderDriver(outDir, remotionBin));
      const pid = await startedPid(pidFile);
      child.kill(signal);
      assert.equal(await exited, exitCodeFor(signal));
      const childAliveAtExit = isAlive(pid);
      // If the wrapper left early, let the orphan finish so the assertion sees its write.
      await waitFor(() => !isAlive(pid), 'fake remotion to exit');
      assert.deepEqual(readdirSync(outDir), []);
      assert.equal(childAliveAtExit, false, 'the wrapper exited while its child was still running');
    });
  }

  /**
   * Drives runCli directly with a fake child. The fake runs `childBody`, writes its
   * pid (so the test knows its handlers are installed), then idles. The script's
   * cleanup removes `target` and logs whether the child was still alive.
   */
  const startCase = async (childBody: string, killGraceMs: number) => {
    const dir = freshDir('signal');
    const target = join(dir, 'temp.txt');
    const pidFile = join(dir, 'child.pid');
    const log = join(dir, 'cleanup.log');
    const bin = fakeBin('child', `${childBody}\nfs.writeFileSync(args[1], String(process.pid));\nsetInterval(() => {}, 1000);`);
    const driver = join(freshDir('driver'), 'driver.mjs');
    writeFileSync(
      driver,
      `import {appendFileSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {run, runCli} from ${JSON.stringify(pathToFileURL(join(projectRoot, 'scripts/lib/cli.mjs')).href)};
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

  it('a child that ignores the signal is SIGKILLed after the bounded wait, then cleanup runs', async () => {
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

  // Decided behavior: a second signal skips the rest of the grace period (SIGKILLs
  // the children now) but still waits for them, cleans up once, and exits with the
  // first signal's code.
  it("a second signal during the wait doesn't run cleanup twice or exit early with children alive", async () => {
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

  it("no orphaned timers: a child that exits promptly doesn't hold the wrapper for the grace period", async () => {
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
  it('no new child starts once a signal has arrived', async () => {
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
import {run, runCli} from ${JSON.stringify(pathToFileURL(join(projectRoot, 'scripts/lib/cli.mjs')).href)};
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
    if (readPid(pidSecond) > 0) fakePids.add(readPid(pidSecond));
    assert.equal(existsSync(marker), false, 'a child was started after the signal');
    assert.equal(isAlive(b), false);
    assert.equal(readFileSync(log, 'utf8'), 'cleanup childAlive=false\n');
    assert.equal(existsSync(target), false);
  });
});

describe('analyze cleanup', () => {
  /** A minimal project root with a (fake) track on disk. */
  const fakeRoot = () => {
    const root = freshDir('root');
    mkdirSync(join(root, 'src/data'), {recursive: true});
    mkdirSync(join(root, 'public/audio'), {recursive: true});
    cpSync(join(projectRoot, 'src/pipeline.json'), join(root, 'src/pipeline.json'));
    writeFileSync(join(root, 'src/data/audio-analysis.json'), 'ORIGINAL');
    writeFileSync(join(root, 'public/audio/track.wav'), '');
    return root;
  };
  const run = (root: string, tmpRoot: string, bins: {ffmpegBin: string; pythonBin: string}) =>
    silence(() => analyzeMain([], {root, tmpRoot, ...bins}));
  // analyze_audio.py's --out value follows the '--out' flag.
  const pythonWrites = (exitCode: number) =>
    fakeBin('python', `fs.writeFileSync(args[args.indexOf('--out') + 1], '{"ok":true}'); process.exit(${exitCode});`);

  for (const [label, bins] of [
    ['ffmpeg fails', () => ({ffmpegBin: ffmpegWrites(1), pythonBin: pythonWrites(0)})],
    ['python fails after writing output', () => ({ffmpegBin: ffmpegWrites(0), pythonBin: pythonWrites(1)})],
  ] as const) {
    it(`${label}: exit 1, temp dir removed, existing analysis untouched`, async () => {
      const root = fakeRoot();
      const tmpRoot = freshDir('tmp');
      const code = await run(root, tmpRoot, bins());
      assert.equal(code, 1);
      assert.deepEqual(readdirSync(tmpRoot), []);
      assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), 'ORIGINAL');
      assert.deepEqual(readdirSync(join(root, 'src/data')), ['audio-analysis.json']);
    });
  }

  it('success: temp dir removed, analysis replaced', async () => {
    const root = fakeRoot();
    const tmpRoot = freshDir('tmp');
    const code = await run(root, tmpRoot, {ffmpegBin: ffmpegWrites(0), pythonBin: pythonWrites(0)});
    assert.equal(code, 0);
    assert.deepEqual(readdirSync(tmpRoot), []);
    assert.equal(readFileSync(join(root, 'src/data/audio-analysis.json'), 'utf8'), '{"ok":true}');
  });

  it('missing venv is reported before any temp dir is created', async () => {
    const root = fakeRoot();
    const tmpRoot = freshDir('tmp');
    const code = await run(root, tmpRoot, {ffmpegBin: ffmpegWrites(0), pythonBin: join(root, 'nope/python')});
    assert.equal(code, 1);
    assert.equal(existsSync(tmpRoot) && readdirSync(tmpRoot).length, 0);
  });
});

describe('preview', () => {
  it('previewBitrates aims at ~26 MB: (video + audio) * duration stays under the target and the 30 MB limit', () => {
    for (const seconds of [30, 93, 131.16, 180, 400]) {
      const {videoKbps, audioKbps} = previewBitrates(seconds);
      const bytes = ((videoKbps + audioKbps) * 1000 * seconds) / 8;
      assert.ok(bytes <= PREVIEW_TARGET_BYTES, `${seconds}s -> ${bytes} bytes`);
      assert.ok(bytes < PREVIEW_LIMIT_BYTES);
      assert.ok(videoKbps <= PREVIEW_MAX_VIDEO_KBPS);
    }
    // A 131 s song gets the budget, not the cap: within 5% of the target.
    const {videoKbps, audioKbps} = previewBitrates(131.16);
    assert.ok(((videoKbps + audioKbps) * 1000 * 131.16) / 8 > PREVIEW_TARGET_BYTES * 0.95);
  });
  it('previewBitrates refuses a duration it cannot fit legibly, and a bad duration', () => {
    assert.throws(() => previewBitrates(3600), /too low for a readable 720p preview/);
    assert.throws(() => previewBitrates(0), /duration is 0/);
    assert.throws(() => previewBitrates(Number.NaN), /duration is NaN/);
  });
  it('parsePreviewArgs defaults to the render output and a -preview sibling', () => {
    assert.deepEqual(parsePreviewArgs([], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      output: join(projectRoot, 'out/music-video-preview.mp4'),
    });
    assert.deepEqual(parsePreviewArgs(['--in=out/a.mp4', '--out', 'out/b.mp4'], {root: '/r'}), {input: '/r/out/a.mp4', output: '/r/out/b.mp4'});
    assert.throws(() => parsePreviewArgs(['--in=a.mp4', '--out=a.mp4'], {root: '/r'}), /must differ/);
    assert.throws(() => parsePreviewArgs(['x'], {root: '/r'}), /unexpected argument "x"/);
  });

  const ffprobe = (seconds: string, exitCode = 0) => fakeBin('ffprobe', `process.stdout.write(${JSON.stringify(seconds)}); process.exit(${exitCode});`);
  // Pass 1 writes its log into the cwd (the temp dir); pass 2 writes the output (last arg).
  const ffmpegTwoPass = (pass2Exit: number, bytes = 10) =>
    fakeBin(
      'ffmpeg',
      `if (args.includes('1') && args[args.indexOf('-pass') + 1] === '1') { fs.writeFileSync(args[args.indexOf('-passlogfile') + 1] + '-0.log', 'log'); process.exit(0); }
fs.writeFileSync(args[args.length - 1], Buffer.alloc(${bytes})); process.exit(${pass2Exit});`,
    );
  const setup = () => {
    const dir = freshDir('preview');
    const input = join(dir, 'in.mp4');
    writeFileSync(input, 'mp4');
    return {dir, input, output: join(dir, 'in-preview.mp4'), tmpRoot: freshDir('tmp')};
  };
  const runPreview = (c: ReturnType<typeof setup>, bins: {ffmpegBin: string; ffprobeBin: string}) =>
    silence(() => previewMain(['--in', c.input, '--out', c.output], {root: projectRoot, tmpRoot: c.tmpRoot, ...bins}));

  it('success: only the preview is added; the pass log temp dir is removed', async () => {
    const c = setup();
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0), ffprobeBin: ffprobe('120.5\n')}), 0);
    assert.deepEqual(readdirSync(c.dir).sort(), ['in-preview.mp4', 'in.mp4']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
  it('pass 2 failing: exit 1, no partial, no output, temp dir removed', async () => {
    const c = setup();
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(1), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), ['in.mp4']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
  it('a result at or over 30 MB is refused and removed', async () => {
    const c = setup();
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0, PREVIEW_LIMIT_BYTES), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), ['in.mp4']);
  });
  it('a missing input is reported before anything is created', async () => {
    const c = setup();
    rmSync(c.input);
    assert.equal(await runPreview(c, {ffmpegBin: ffmpegTwoPass(0), ffprobeBin: ffprobe('120')}), 1);
    assert.deepEqual(readdirSync(c.dir), []);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
});

describe('contact sheet', () => {
  it('contactSheetTimes: each section start + 0.5 s, plus the middle of long sections, inside the video', () => {
    const sections = [
      {id: 'intro', start: 0},
      {id: 'verse-1', start: 4},
      {id: 'chorus-1', start: 30},
      {id: 'tiny', start: 59.9},
    ];
    assert.deepEqual(contactSheetTimes(sections, 60), [
      {label: 'intro', seconds: 0.5},
      {label: 'verse-1', seconds: 4.5},
      {label: 'verse-1 (middle)', seconds: 17},
      {label: 'chorus-1', seconds: 30.5},
      {label: 'chorus-1 (middle)', seconds: 44.95},
      {label: 'tiny', seconds: 59.95},
    ]);
    assert.deepEqual(contactSheetTimes([], 20), [
      {label: 'song', seconds: 0.5},
      {label: 'song (middle)', seconds: 10},
    ]);
    assert.deepEqual(contactSheetTimes([{id: 'a', start: 0}, {id: 'past', start: 90}], 60).map((s) => s.label), ['a', 'a (middle)']);
  });
  it('parseContactSheetArgs: defaults, --columns, bad values', () => {
    assert.deepEqual(parseContactSheetArgs([], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      output: join(projectRoot, 'out/contact-sheet.png'),
      columns: 4,
    });
    assert.equal(parseContactSheetArgs(['--in=a.mp4', '--columns=3', '--out', 'x.png'], {root: '/r'}).columns, 3);
    assert.throws(() => parseContactSheetArgs(['--in=a.mp4', '--columns=0'], {root: '/r'}), /positive integer/);
    assert.throws(() => parseContactSheetArgs(['--in=a.mp4', '--out=x.jpg'], {root: '/r'}), /\.png/);
    assert.throws(() => parseContactSheetArgs(['--frames=1'], {root: '/r'}), /unexpected argument/);
  });

  const fakeRoot = (sections: unknown) => {
    const root = freshDir('cs-root');
    mkdirSync(join(root, 'src/data'), {recursive: true});
    cpSync(join(projectRoot, 'src/pipeline.json'), join(root, 'src/pipeline.json'));
    writeFileSync(join(root, 'src/data/sections.json'), JSON.stringify(sections));
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out/music-video.mp4'), 'mp4');
    return root;
  };
  const ffprobe = fakeBin('ffprobe', `process.stdout.write('30.0'); process.exit(0);`);
  const ffmpeg = (failTile: boolean) =>
    fakeBin('ffmpeg', `const tile = args.some((a) => a.startsWith('tile=')); fs.writeFileSync(args[args.length - 1], 'png'); process.exit(tile && ${failTile} ? 1 : 0);`);

  it('success: only out/contact-sheet.png is added; the stills temp dir is removed', async () => {
    const root = fakeRoot([{id: 'a', scene: 'x', start: 0}, {id: 'b', scene: 'x', start: 10}]);
    const tmpRoot = freshDir('tmp');
    const code = await silence(() => contactSheetMain([], {root, tmpRoot, ffmpegBin: ffmpeg(false), ffprobeBin: ffprobe}));
    assert.equal(code, 0);
    assert.deepEqual(readdirSync(join(root, 'out')).sort(), ['contact-sheet.png', 'music-video.mp4']);
    assert.deepEqual(readdirSync(tmpRoot), []);
  });
  it('tiling failing: exit 1, no partial, no output, temp dir removed', async () => {
    const root = fakeRoot([]);
    const tmpRoot = freshDir('tmp');
    const code = await silence(() => contactSheetMain([], {root, tmpRoot, ffmpegBin: ffmpeg(true), ffprobeBin: ffprobe}));
    assert.equal(code, 1);
    assert.deepEqual(readdirSync(join(root, 'out')), ['music-video.mp4']);
    assert.deepEqual(readdirSync(tmpRoot), []);
  });
});

describe('still', () => {
  it('parseStillArgs: default out/still.png, --out in both forms, flags pass through', () => {
    assert.deepEqual(parseStillArgs(['--frame=120'], {root: '/r'}), {output: '/r/out/still.png', passthrough: ['--frame=120']});
    assert.equal(parseStillArgs(['--out=out/wip-1/f-120.png'], {root: '/r'}).output, '/r/out/wip-1/f-120.png');
    assert.equal(parseStillArgs(['--out', 'out/a.jpg'], {root: '/r'}).output, '/r/out/a.jpg');
    assert.throws(() => parseStillArgs(['120'], {root: '/r'}), /unexpected argument "120"/);
    assert.throws(() => parseStillArgs(['--out=x.mp4'], {root: '/r'}), /must end in \.png/);
  });
});

describe('align and setup:align', () => {
  it('align: a missing venv or an unknown argument fails before running anything', async () => {
    const root = freshDir('align-root');
    assert.equal(await silence(() => alignMain([], {root})), 1);
    assert.equal(await silence(() => alignMain(['--fast'], {root})), 1);
  });
  it('align: forwards to align_lyrics.py in the venv and reports its exit code', async () => {
    const root = freshDir('align-ok');
    const argsFile = join(root, 'args.json');
    const ok = fakeBin('python', `fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));`);
    assert.equal(await silence(() => alignMain(['calibrate'], {root, pythonBin: ok})), 0);
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')), [join(root, 'scripts/align_lyrics.py'), 'calibrate']);
    assert.equal(await silence(() => alignMain([], {root, pythonBin: fakeBin('python', 'process.exit(3);')})), 1);
  });
  it('setup:align: a venv it created is removed when the install fails; an existing one is kept', async () => {
    const root = freshDir('setup-root');
    // Fake "python": `-c` prints 3.14; `-m venv <dir>` creates <dir>/bin/python that fails pip.
    const python = fakeBin(
      'python3.14',
      `if (args[0] === '-c') { console.log('3.14'); process.exit(0); }
const dir = args[2]; fs.mkdirSync(dir + '/bin', {recursive: true});
fs.writeFileSync(dir + '/bin/python', '#!/bin/sh\nexit 1\n'); fs.chmodSync(dir + '/bin/python', 0o755);`,
    );
    assert.equal(await silence(() => setupAlignMain([], {root, pythonCandidates: [python]})), 1);
    assert.equal(existsSync(join(root, '.venv-align')), false);

    mkdirSync(join(root, '.venv-align/bin'), {recursive: true});
    writeFileSync(join(root, '.venv-align/bin/python'), '#!/bin/sh\nexit 1\n');
    chmodSync(join(root, '.venv-align/bin/python'), 0o755);
    assert.equal(await silence(() => setupAlignMain([], {root, pythonCandidates: [python]})), 1);
    assert.equal(existsSync(join(root, '.venv-align/bin/python')), true);
  });
});
