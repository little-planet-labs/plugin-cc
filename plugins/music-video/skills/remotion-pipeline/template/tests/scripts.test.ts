// The pnpm scripts must leave no intermediate or temp files behind on any exit
// path: success, a failing child process, or SIGINT/SIGTERM. Real remotion,
// ffmpeg and python are replaced with tiny fake executables.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {main as analyzeMain} from '../scripts/analyze.mjs';
import {main as renderMain, parseRenderArgs} from '../scripts/render.mjs';
import {jitter, main as jitterMain, parseJitterArgs} from '../scripts/jitter.mjs';
import {contactSheetTimes, main as contactSheetMain, parseContactSheetArgs} from '../scripts/contact-sheet.mjs';
import {
  main as previewMain,
  parsePreviewArgs,
  PREVIEW_LIMIT_BYTES,
  PREVIEW_MAX_VIDEO_KBPS,
  PREVIEW_TARGET_BYTES,
  previewBitrates,
} from '../scripts/preview.mjs';
import {main as stillMain, parseStillArgs} from '../scripts/still.mjs';
import {main as alignMain} from '../scripts/align.mjs';
import {main as setupAlignMain} from '../scripts/setup-align.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE_FPS = (JSON.parse(readFileSync(join(projectRoot, 'src/pipeline.json'), 'utf8')) as {fps: number}).fps;
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
// render probes the intermediate's frame rate; this fake reports `rate` (e.g. '30/1').
const ffprobeRate = (rate: string) => fakeBin('ffprobe', `process.stdout.write(${JSON.stringify(`${rate}\n`)});`);

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
      composition: null,
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
    silence(() => renderMain(['--out', join(outDir, 'video.mp4')], {root: projectRoot, ffprobeBin: ffprobeRate(`${PIPELINE_FPS}/1`), ...bins}));

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

describe('render --composition', () => {
  // A project root with a pipeline.json of known values, so default outputs land
  // in scratch and the expectations don't depend on the project's own settings.
  const pipelineRoot = () => {
    const root = freshDir('comp-root');
    mkdirSync(join(root, 'src'), {recursive: true});
    writeFileSync(join(root, 'src/pipeline.json'), JSON.stringify({compositionId: 'MusicVideo', outputName: 'music-video', fps: 30}));
    return root;
  };
  /**
   * Fakes that append their argv (one JSON line per call) to a log, then write
   * their output. The fake ffprobe reports the intermediate's frame rate as `rate`.
   */
  const capturing = (dir: string, rate: string) => {
    const remotionLog = join(dir, 'remotion.jsonl');
    const ffmpegLog = join(dir, 'ffmpeg.jsonl');
    const ffprobeLog = join(dir, 'ffprobe.jsonl');
    return {
      remotionLog,
      ffmpegLog,
      ffprobeLog,
      remotionBin: fakeBin('remotion', `fs.appendFileSync(${JSON.stringify(remotionLog)}, JSON.stringify(args) + '\\n'); fs.writeFileSync(args[3], 'mkv');`),
      ffmpegBin: fakeBin('ffmpeg', `fs.appendFileSync(${JSON.stringify(ffmpegLog)}, JSON.stringify(args) + '\\n'); fs.writeFileSync(args[args.length - 1], 'mp4');`),
      ffprobeBin: fakeBin('ffprobe', `fs.appendFileSync(${JSON.stringify(ffprobeLog)}, JSON.stringify(args) + '\\n'); process.stdout.write(${JSON.stringify(`${rate}\n`)});`),
    };
  };
  const calls = (log: string): string[][] =>
    existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : [];
  /** Run `pnpm render <argv>` against `root` with argv-capturing fakes. */
  const renderCapture = async (root: string, argv: string[], rate = '30/1') => {
    const fakes = capturing(freshDir('comp-log'), rate);
    const {remotionBin, ffmpegBin, ffprobeBin} = fakes;
    const code = await silence(() => renderMain(argv, {root, remotionBin, ffmpegBin, ffprobeBin}));
    return {code, remotion: calls(fakes.remotionLog), ffmpeg: calls(fakes.ffmpegLog), ffprobe: calls(fakes.ffprobeLog)};
  };
  // The ffmpeg remux exactly as render.mjs has always written it.
  const expectedFfmpeg = (outDir: string) => [
    '-v', 'error', '-y',
    '-i', join(outDir, `.intermediate-${process.pid}.mkv`),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'copy',
    '-video_track_timescale', '30',
    '-c:a', 'aac', '-b:a', '320k',
    '-movflags', '+faststart',
    join(outDir, `.partial-${process.pid}.mp4`),
  ];

  it('render without --composition keeps pipeline compositionId and default output', async () => {
    const root = pipelineRoot();
    assert.deepEqual(parseRenderArgs(['--frames=0-9'], {root}), {
      composition: null,
      output: join(root, 'out/music-video.mp4'),
      passthrough: ['--frames=0-9'],
    });
    const r = await renderCapture(root, ['--frames=0-9']);
    assert.equal(r.code, 0);
    const outDir = join(root, 'out');
    assert.deepEqual(r.remotion, [
      ['render', 'src/index.ts', 'MusicVideo', join(outDir, `.intermediate-${process.pid}.mkv`), '--codec=h264', '--audio-codec=pcm-16', '--frames=0-9'],
    ]);
    assert.deepEqual(r.ffmpeg, [expectedFfmpeg(outDir)]);
    // One frame-rate probe of the intermediate, between the two unchanged steps.
    assert.deepEqual(r.ffprobe, [
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', join(outDir, `.intermediate-${process.pid}.mkv`)],
    ]);
    assert.deepEqual(readdirSync(outDir), ['music-video.mp4']);
  });

  it('render refuses frame-rate overrides: --fps and --every-nth-frame are reserved', () => {
    for (const flag of ['--fps=60', '--every-nth-frame=2']) {
      assert.throws(() => parseRenderArgs([flag], {root: '/r'}), /can't be used: pnpm render writes the video at src\/pipeline\.json's fps/, flag);
    }
    // Size and length overrides don't touch the frame rate.
    assert.deepEqual(parseRenderArgs(['--width=1280', '--height=720', '--duration=90', '--out=x.mp4'], {root: '/r'}).passthrough, [
      '--width=1280',
      '--height=720',
      '--duration=90',
    ]);
  });

  it('a plain render whose intermediate is not at pipeline fps (Config.overrideFps) stops before the remux', async () => {
    const root = pipelineRoot();
    const r = await renderCapture(root, [], '60/1');
    assert.equal(r.code, 1);
    assert.equal(r.remotion.length, 1);
    assert.equal(r.ffprobe.length, 1);
    assert.deepEqual(r.ffmpeg, [], 'remuxed a 60 fps intermediate at the 30 fps timescale');
    assert.deepEqual(readdirSync(join(root, 'out')), []);
  });

  it('render --composition replaces only the composition argument', async () => {
    const root = pipelineRoot();
    const out = join(root, 'out/x.mp4');
    const main = await renderCapture(root, ['--frames=0-9', '--out', out]);
    const inline = await renderCapture(root, ['--composition=ConceptA', '--frames=0-9', '--out', out]);
    const spaced = await renderCapture(root, ['--frames=0-9', '--composition', 'ConceptA', '--out', out]);
    for (const r of [main, inline, spaced]) {
      assert.equal(r.code, 0);
      assert.equal(r.remotion.length, 1);
    }
    const [mainArgs] = main.remotion as [string[]];
    for (const r of [inline, spaced]) {
      const [args] = r.remotion as [string[]];
      assert.equal(args[2], 'ConceptA');
      assert.deepEqual([...args.slice(0, 2), ...args.slice(3)], [...mainArgs.slice(0, 2), ...mainArgs.slice(3)]);
      assert.deepEqual(r.ffmpeg, main.ffmpeg);
    }
    assert.equal(mainArgs[2], 'MusicVideo');
    assert.deepEqual(main.ffmpeg, [expectedFfmpeg(join(root, 'out'))]);
  });

  it('render --composition without --out defaults to out/<id>.mp4', async () => {
    const root = pipelineRoot();
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out/music-video.mp4'), 'MAIN');
    assert.equal(parseRenderArgs(['--composition=ConceptA'], {root}).output, join(root, 'out/ConceptA.mp4'));
    const r = await renderCapture(root, ['--composition=ConceptA']);
    assert.equal(r.code, 0);
    assert.deepEqual(readdirSync(join(root, 'out')).sort(), ['ConceptA.mp4', 'music-video.mp4']);
    assert.equal(readFileSync(join(root, 'out/music-video.mp4'), 'utf8'), 'MAIN');
    // Naming the main composition is the plain render; an id that collides with outputName must pass --out.
    assert.equal(parseRenderArgs(['--composition=MusicVideo'], {root}).output, join(root, 'out/music-video.mp4'));
    assert.throws(() => parseRenderArgs(['--composition=music-video'], {root}), /main video's output; pass --out/);
    // Default macOS volumes are case-insensitive: out/Music-Video.mp4 IS out/music-video.mp4.
    assert.throws(() => parseRenderArgs(['--composition=Music-Video'], {root}), /main video's output; pass --out/);
    assert.throws(() => parseRenderArgs(['--composition=MUSIC-VIDEO'], {root}), /main video's output; pass --out/);
    const collide = await renderCapture(root, ['--composition=Music-Video']);
    assert.equal(collide.code, 1);
    assert.deepEqual(collide.remotion, []);
    assert.equal(readFileSync(join(root, 'out/music-video.mp4'), 'utf8'), 'MAIN');
    assert.deepEqual(readdirSync(join(root, 'out')).sort(), ['ConceptA.mp4', 'music-video.mp4']);
    assert.equal(parseRenderArgs(['--composition=music-video', '--out=out/alt.mp4'], {root}).output, join(root, 'out/alt.mp4'));
  });

  it("render --composition stops when the composition's fps isn't pipeline.json's", async () => {
    const root = pipelineRoot();
    const outDir = join(root, 'out');
    const at60 = await renderCapture(root, ['--composition=Fast'], '60/1');
    assert.equal(at60.code, 1);
    assert.deepEqual(at60.ffprobe.map((a) => a[a.length - 1]), [join(outDir, `.intermediate-${process.pid}.mkv`)]);
    assert.deepEqual(at60.ffmpeg, [], 'remuxed a 60 fps intermediate at the 30 fps timescale');
    assert.deepEqual(readdirSync(outDir), [], 'output or temp files left behind');
    const at30 = await renderCapture(root, ['--composition=Fast'], '30/1');
    assert.equal(at30.code, 0);
    assert.deepEqual(readdirSync(outDir), ['Fast.mp4']);
  });

  // The same check against real ffprobe output for a real MKV, as Remotion writes it.
  const realProbeSkip = ['ffmpeg', 'ffprobe'].every((bin) => spawnSync(bin, ['-version'], {stdio: 'ignore'}).status === 0)
    ? false
    : 'ffmpeg/ffprobe not on PATH';
  it('render --composition probes the real intermediate frame rate', {skip: realProbeSkip}, async () => {
    const mkv = (rate: number) => {
      const file = join(freshDir('mkv'), `${rate}.mkv`);
      const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=s=64x36:r=${rate}:d=0.5`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
      assert.equal(res.status, 0, String(res.stderr));
      return file;
    };
    const run = async (source: string) => {
      const root = pipelineRoot();
      const remotionBin = fakeBin('remotion', `fs.copyFileSync(${JSON.stringify(source)}, args[3]);`);
      const code = await silence(() => renderMain(['--composition=Alt'], {root, remotionBin, ffmpegBin: ffmpegWrites(0), ffprobeBin: 'ffprobe'}));
      return {code, files: readdirSync(join(root, 'out'))};
    };
    assert.deepEqual(await run(mkv(60)), {code: 1, files: []});
    assert.deepEqual(await run(mkv(30)), {code: 0, files: ['Alt.mp4']});
  });

  it('render rejects --composition without a value', async () => {
    for (const argv of [['--composition'], ['--composition='], ['--composition', '--frames=0-9'], ['--frames=0-9', '--composition', '-x']]) {
      assert.throws(() => parseRenderArgs(argv, {root: '/r'}), /--composition needs a composition id/, JSON.stringify(argv));
    }
    assert.throws(() => parseRenderArgs(['--composition=../evil'], {root: '/r'}), /isn't a valid composition id/);
    const r = await renderCapture(pipelineRoot(), ['--composition']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.remotion, []);
  });

  it('render rejects a repeated --composition', async () => {
    assert.throws(() => parseRenderArgs(['--composition=A', '--composition=B'], {root: '/r'}), /--composition given twice \("A" and "B"\)/);
    assert.throws(() => parseRenderArgs(['--composition', 'A', '--composition=A'], {root: '/r'}), /--composition given twice/);
    const r = await renderCapture(pipelineRoot(), ['--composition=A', '--composition=B']);
    assert.equal(r.code, 1);
    assert.deepEqual(r.remotion, []);
  });

  it('render does not forward --composition to remotion', async () => {
    const root = pipelineRoot();
    const argv = ['--composition', 'ConceptA', '--frames=0-9', '--image-format=png'];
    assert.deepEqual(parseRenderArgs(argv, {root}).passthrough, ['--frames=0-9', '--image-format=png']);
    const r = await renderCapture(root, argv);
    assert.equal(r.code, 0);
    const [args] = r.remotion as [string[]];
    assert.deepEqual(args.slice(4), ['--codec=h264', '--audio-codec=pcm-16', '--frames=0-9', '--image-format=png']);
    assert.equal(args.filter((a) => a === 'ConceptA').length, 1);
    assert.ok(!args.some((a) => a.startsWith('--composition')), `forwarded: ${JSON.stringify(args)}`);
  });

  it('render forwards --image-format', async () => {
    const root = pipelineRoot();
    const out = join(root, 'out/master.mp4');
    const plain = await renderCapture(root, ['--out', out]);
    const png = await renderCapture(root, ['--image-format=png', '--out', out]);
    assert.equal(png.code, 0);
    const [plainArgs] = plain.remotion as [string[]];
    const [pngArgs] = png.remotion as [string[]];
    assert.deepEqual(pngArgs, [...plainArgs, '--image-format=png']);
    assert.deepEqual(png.ffmpeg, plain.ffmpeg);
  });
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
    assert.deepEqual(parseStillArgs(['--frame=120'], {root: '/r'}), {composition: null, output: '/r/out/still.png', passthrough: ['--frame=120']});
    assert.equal(parseStillArgs(['--out=out/wip-1/f-120.png'], {root: '/r'}).output, '/r/out/wip-1/f-120.png');
    assert.equal(parseStillArgs(['--out', 'out/a.jpg'], {root: '/r'}).output, '/r/out/a.jpg');
    assert.throws(() => parseStillArgs(['120'], {root: '/r'}), /unexpected argument "120"/);
    assert.throws(() => parseStillArgs(['--out=x.mp4'], {root: '/r'}), /must end in \.png/);
  });
  it('still --composition replaces only the composition argument (shared parsing with render)', async () => {
    assert.deepEqual(parseStillArgs(['--composition=ConceptA', '--frame=5'], {root: '/r'}), {
      composition: 'ConceptA',
      output: '/r/out/still.png',
      passthrough: ['--frame=5'],
    });
    assert.throws(() => parseStillArgs(['--composition'], {root: '/r'}), /--composition needs a composition id/);
    assert.throws(() => parseStillArgs(['--composition=', '--frame=5'], {root: '/r'}), /--composition needs a composition id/);
    assert.throws(() => parseStillArgs(['--composition=A', '--composition', 'B'], {root: '/r'}), /--composition given twice/);

    const root = freshDir('still-root');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/pipeline.json'), JSON.stringify({compositionId: 'MusicVideo', outputName: 'music-video', fps: 30}));
    const log = join(root, 'remotion.jsonl');
    const remotionBin = fakeBin('remotion', `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`);
    const out = join(root, 'out/f.png');
    assert.equal(await silence(() => stillMain(['--frame=5', '--out', out], {root, remotionBin})), 0);
    assert.equal(await silence(() => stillMain(['--composition', 'ConceptA', '--frame=5', '--out', out], {root, remotionBin})), 0);
    const [plain, concept] = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) as [string[], string[]];
    assert.deepEqual(plain, ['still', 'src/index.ts', 'MusicVideo', out, '--frame=5']);
    assert.deepEqual(concept, ['still', 'src/index.ts', 'ConceptA', out, '--frame=5']);
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

describe('parseJitterArgs', () => {
  it('reads --from as a frame or seconds, --frames, --crop, --max, --threshold; --in defaults to the render output', () => {
    assert.deepEqual(parseJitterArgs(['--from=120', '--frames', '30'], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      from: {frame: 120},
      frames: 30,
      crop: null,
      max: null,
      threshold: 225,
    });
    const all = parseJitterArgs(['--in', 'a.mp4', '--from', '40.5s', '--frames=10', '--crop=10,20,300,100', '--max', '0.25', '--threshold=200'], {root: '/r'});
    assert.deepEqual(all, {input: '/r/a.mp4', from: {seconds: 40.5}, frames: 10, crop: {x: 10, y: 20, w: 300, h: 100}, max: 0.25, threshold: 200});
  });
  it('rejects a missing --from or --frames, bad values, repeats and unknown args', () => {
    const r = {root: '/r'};
    assert.throws(() => parseJitterArgs(['--frames=10'], r), /--from is required/);
    assert.throws(() => parseJitterArgs(['--from=0'], r), /--frames is required/);
    assert.throws(() => parseJitterArgs(['--from=1.5', '--frames=10'], r), /--from must be a frame number/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=1'], r), /at least 2/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--crop=1,2,3'], r), /--crop must be x,y,w,h/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--max=-1'], r), /--max needs a value/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--max=abc'], r), /--max must be a number/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--threshold=256'], r), /--threshold must be an integer 0\.\.255/);
    assert.throws(() => parseJitterArgs(['--from=0', '--from=1', '--frames=10'], r), /--from given twice/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', 'x.mp4'], r), /unexpected argument "x\.mp4"/);
  });
  it('a missing venv fails with the setup command before anything is decoded', async () => {
    const dir = freshDir('jitter-novenv');
    const input = join(dir, 'in.mp4');
    writeFileSync(input, 'mp4');
    const tmpRoot = freshDir('tmp');
    await assert.rejects(
      jitter({input, from: {frame: 0}, frames: 2, crop: null, max: null, pythonBin: join(dir, '.venv/bin/python'), tmpRoot, ffmpegBin: join(dir, 'no-ffmpeg')}, new Set()),
      /Python venv missing.*pnpm setup:audio/,
    );
    assert.deepEqual(readdirSync(tmpRoot), []);
  });
});

const venvPython = join(projectRoot, '.venv/bin/python');
const hasFfmpeg = ['ffmpeg', 'ffprobe'].every((bin) => spawnSync(bin, ['-version'], {stdio: 'ignore'}).status === 0);
const jitterSkip = !hasFfmpeg
  ? 'ffmpeg/ffprobe not on PATH'
  : !existsSync(venvPython)
    ? '.venv missing: run `pnpm setup:audio` to measure jitter'
    : false;

describe('jitter measurements', {skip: jitterSkip}, () => {
  // 30-frame 320x180 clips: a frozen 120x80 testsrc card on black, drawn at
  // `scale`x and box-downscaled, so a 1 px offset at 2x is an exact half-pixel
  // shift (a quarter at 4x). Encoded losslessly (x264 qp 0) so only the motion
  // differs between frames.
  const clipsDir = freshDir('jitter-clips');
  const clip = (name: string, x: string, scale = 2) => {
    const file = join(clipsDir, `${name}.mp4`);
    const res = spawnSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=black:s=${320 * scale}x${180 * scale}:r=30:d=1,format=rgb24`,
      '-f', 'lavfi', '-i', `testsrc=s=${120 * scale}x${80 * scale}:r=30:d=1`,
      '-filter_complex',
      `[1]trim=end_frame=1,loop=loop=-1:size=1,setpts=N/30/TB[s];[0][s]overlay=x='${x}':y=${50 * scale}:shortest=1:eval=frame:format=rgb,scale=320:180:flags=area,format=yuv420p`,
      '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast',
      file,
    ]);
    assert.equal(res.status, 0, `ffmpeg failed to make ${name}: ${res.stderr}`);
    return file;
  };
  // The frame index, from the timestamp.
  const n = 'floor(t*30+0.5)';
  const clips = {static: '', quarter: '', half: '', one: '', step: ''};
  before(() => {
    clips.static = clip('static', '200');
    clips.quarter = clip('quarter', `400+${n}`, 4);
    clips.half = clip('half', `200+${n}`);
    clips.one = clip('one', `200+2*${n}`);
    // Still, except one 1 px jump between frames 10 and 11.
    clips.step = clip('step', '200+2*gte(t,10.5/30)');
  });
  const measure = (input: string, from: {frame: number} | {seconds: number}, frames: number, extra: {crop?: {x: number; y: number; w: number; h: number}; max?: number} = {}) =>
    silence(() => jitter({input, from, frames, crop: extra.crop ?? null, max: extra.max ?? null, root: projectRoot, tmpRoot: freshDir('tmp')}, new Set()));

  it('jitter reports no shift for a static clip', async () => {
    const {pairs} = await measure(clips.static, {frame: 0}, 10);
    assert.equal(pairs.length, 9);
    for (const p of pairs) {
      assert.ok(p.shift < 0.01, `pair ${p.from}->${p.to}: shift ${p.shift}`);
      assert.ok(p.diff < 0.01, `pair ${p.from}->${p.to}: diff ${p.diff}`);
    }
  });

  it('jitter detects a known sub-pixel shift', async () => {
    const one = await measure(clips.one, {frame: 0}, 10);
    for (const p of one.pairs) {
      assert.ok(Math.abs(p.dx - 1) < 0.05 && Math.abs(p.dy) < 0.05, `1 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
    }
    // The same motion seen through a crop that holds the card throughout.
    const cropped = await measure(clips.one, {frame: 0}, 10, {crop: {x: 80, y: 40, w: 200, h: 110}});
    for (const p of cropped.pairs) assert.ok(Math.abs(p.dx - 1) < 0.05, `cropped 1 px clip: dx ${p.dx}`);
    // Odd size and origin: the crop must not snap to the yuv420p chroma grid.
    const odd = await measure(clips.one, {frame: 0}, 10, {crop: {x: 81, y: 41, w: 201, h: 111}});
    assert.equal(odd.pairs.length, 9);
    for (const p of odd.pairs) assert.ok(Math.abs(p.dx - 1) < 0.05, `odd crop, 1 px clip: dx ${p.dx}`);
    const half = await measure(clips.half, {frame: 0}, 10);
    for (const p of half.pairs) {
      assert.ok(Math.abs(p.dx - 0.5) < 0.1 && Math.abs(p.dy) < 0.1, `0.5 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
    }
    const meanDx = half.pairs.reduce((a: number, p: {dx: number}) => a + p.dx, 0) / half.pairs.length;
    assert.ok(Math.abs(meanDx - 0.5) < 0.05, `0.5 px clip: mean dx ${meanDx}`);
    // A parabolic peak fit reads these as ~0.12 px; the Dirichlet fit in jitter.py doesn't.
    const quarter = await measure(clips.quarter, {frame: 0}, 10);
    for (const p of quarter.pairs) {
      assert.ok(Math.abs(p.dx - 0.25) < 0.1 && Math.abs(p.dy) < 0.1, `0.25 px clip, pair ${p.from}->${p.to}: dx ${p.dx} dy ${p.dy}`);
    }
  });

  it('jitter --from selects that exact frame, given as a frame or in seconds', async () => {
    const shiftFrom = async (from: {frame: number} | {seconds: number}) => {
      const {pairs, startFrame} = await measure(clips.step, from, 2);
      return {startFrame, shift: (pairs[0] as {shift: number}).shift};
    };
    const at9 = await shiftFrom({frame: 9});
    const at10 = await shiftFrom({frame: 10});
    const at11 = await shiftFrom({frame: 11});
    assert.ok(at9.shift < 0.01, `9->10: ${at9.shift}`);
    assert.ok(Math.abs(at10.shift - 1) < 0.05, `10->11: ${at10.shift}`);
    assert.ok(at11.shift < 0.01, `11->12: ${at11.shift}`);
    const seconds = await shiftFrom({seconds: 10 / 30});
    assert.equal(seconds.startFrame, 10);
    assert.ok(Math.abs(seconds.shift - 1) < 0.05, `10/30 s: ${seconds.shift}`);
    await assert.rejects(measure(clips.step, {frame: 25}, 10), /only 5 of 10 frames from frame 25/);
  });

  it('jitter --max fails above threshold', async () => {
    const run = (input: string, max: string) => {
      const tmpRoot = freshDir('tmp');
      return silence(() => jitterMain(['--in', input, '--from=0', '--frames=5', `--max=${max}`], {root: projectRoot, tmpRoot})).then((code) => {
        assert.deepEqual(readdirSync(tmpRoot), [], 'the decoded frames were left behind');
        return code;
      });
    };
    assert.equal(await run(clips.one, '0.5'), 1);
    assert.equal(await run(clips.one, '1.5'), 0);
    assert.equal(await run(clips.static, '0.05'), 0);
  });
});
