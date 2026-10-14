// `pnpm critique` without real media: its arguments, the frame plan (strip
// frames round((t - 0.1) * fps) .. +11, clamped at 0, cut short at the end,
// skipped past it; the overview and phone cadence; page frames on a partial
// render), and what a failed run leaves behind, with fake ffmpeg, ffprobe and
// sheet builder. The sheets themselves are tested on real clips in
// tests/render/qa-critique-sheets.test.mjs.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {after, describe, it} from 'node:test';
import {cadenceFrames, formatLabel, main as critiqueMain, parseCritiqueArgs, publishTagDir, selectExpr, stripName, stripPlan} from '../scripts/critique.mjs';
import {fakeBin, freshDir, projectRoot, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';
import {listFiles} from './fixtures/qa-clips.mjs';

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));
const project = (o = {}) => {
  const p = makeProject({pipeline: {outputName: 'music-video'}, ...o});
  projects.push(p);
  return p.root;
};

describe('critique arguments and plan', () => {
  it('parseCritiqueArgs: defaults (the master), every flag, and the tag must be one safe path segment', () => {
    assert.deepEqual(parseCritiqueArgs(['--tag', 'r1'], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      tag: 'r1',
      strips: null,
      overviewEvery: 2,
      phoneEvery: 4,
      pipeline: 'src/pipeline.json',
    });
    assert.deepEqual(parseCritiqueArgs(['--in=out/d.mp4', '--tag=r2', '--strips=1.5,30', '--overview-every', '1', '--phone-every=0.5'], {root: '/r'}), {
      input: '/r/out/d.mp4',
      tag: 'r2',
      strips: [1.5, 30],
      overviewEvery: 1,
      phoneEvery: 0.5,
      pipeline: 'src/pipeline.json',
    });
    const r = {root: '/r'};
    assert.throws(() => parseCritiqueArgs(['--in=x.mp4'], r), /--tag is required/);
    for (const tag of ['a/b', '..', '.', '.hidden', '../x', 'a\\b', 'with space', 'x'.repeat(65)]) {
      assert.throws(() => parseCritiqueArgs([`--tag=${tag}`, '--in=x.mp4'], r), /must be one path segment/, tag);
    }
    assert.throws(() => parseCritiqueArgs(['--tag=r1', '--strips=1,x'], r), /--strips must be seconds/);
    assert.throws(() => parseCritiqueArgs(['--tag=r1', '--strips', '-1'], r), /--strips needs a value/);
    assert.throws(() => parseCritiqueArgs(['--tag=r1', '--overview-every=0'], r), /--overview-every must be a number of seconds > 0/);
    assert.throws(() => parseCritiqueArgs(['--tag=r1', '--tag=r2'], r), /--tag given twice/);
    assert.throws(() => parseCritiqueArgs(['--tag=r1', 'x.mp4'], r), /unexpected argument "x\.mp4"/);
  });

  it('formatLabel, stripName and cadenceFrames', () => {
    assert.equal(formatLabel(0, 30), '0:00.00 f0');
    assert.equal(formatLabel(372, 30), '0:12.40 f372');
    assert.equal(formatLabel(1875, 30), '1:02.50 f1875');
    // 59.999 s rounds to the next minute, never "0:60.00".
    assert.equal(formatLabel(59999, 1000), '1:00.00 f59999');
    assert.equal(formatLabel(3599, 60), '0:59.98 f3599');
    assert.equal(stripName(12.4), 'strip_0012.40.png');
    assert.equal(stripName(0.05), 'strip_0000.05.png');
    assert.deepEqual(cadenceFrames(2, 30, 240), [0, 60, 120, 180]);
    assert.deepEqual(cadenceFrames(2, 30, 241), [0, 60, 120, 180, 240]);
    assert.deepEqual(cadenceFrames(0.001, 30, 5), [0, 1, 2, 3, 4], 'a cadence under one frame takes every frame once');
  });

  it('cadenceFrames rounds each tile from k * every * fps, so 29.97 fps does not drift', () => {
    const frames = cadenceFrames(2, 29.97, 6000);
    // A fixed rounded step of 60 would put tile 10 at 600 and tile 100 at 6000 (3.3 s late by then).
    assert.equal(frames[10], 599);
    assert.equal(frames[50], 2997);
    assert.equal(frames.length, 101, 'tiles below frame 6000: k * 59.94 rounds to 5994 at k = 100');
    frames.forEach((f, k) => assert.ok(Math.abs(f / 29.97 - 2 * k) <= 0.5 / 29.97 + 1e-9, `tile ${k} at frame ${f}`));
  });

  it('stripPlan: 12 frames from round((t - 0.1) * fps), clamped at 0, cut short at the end, skipped past it', () => {
    const {strips, skipped} = stripPlan([3, 0.05, 7.9, 9, 3.001], 30, 240);
    assert.deepEqual(
      strips.map((s) => [s.name, s.start, s.frames, s.note]),
      [
        ['strip_0000.05.png', 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], null],
        ['strip_0003.00.png', 87, Array.from({length: 12}, (_, k) => 87 + k), null],
        ['strip_0007.90.png', 234, [234, 235, 236, 237, 238, 239], 'only 6 frames before the end'],
      ],
    );
    // 3.001 s names the same file as 3 s and is dropped; 9 s starts after the last frame.
    assert.deepEqual(skipped, [{seconds: 9, reason: 'starts at frame 267, after the last frame (239)'}]);
  });

  it('stripPlan on a partial render: page frames, strips outside the rendered frames skipped, cut short at its end', () => {
    // The video shows page frames 300..389 (manifest firstFrame 300, 90 frames).
    const {strips, skipped} = stripPlan([5, 10.1, 10, 12.9, 13.1], 30, 90, 300);
    assert.deepEqual(
      strips.map((s) => [s.name, s.frames[0], s.frames.at(-1), s.frames.length]),
      [
        ['strip_0010.10.png', 300, 311, 12],
        ['strip_0012.90.png', 384, 389, 6],
      ],
    );
    assert.deepEqual(skipped, [
      {seconds: 5, reason: 'starts at frame 147, before the first rendered frame (300)'},
      {seconds: 10, reason: 'starts at frame 297, before the first rendered frame (300)'},
      {seconds: 13.1, reason: 'starts at frame 390, after the last frame (389)'},
    ]);
  });

  it('selectExpr keeps exactly the listed frames: runs become between(), singles eq()', () => {
    assert.equal(selectExpr([0, 60, 120]), 'eq(n,0)+eq(n,60)+eq(n,120)');
    assert.equal(selectExpr([3, 4, 5, 9, 11, 12]), 'between(n,3,5)+eq(n,9)+between(n,11,12)');
  });
});

describe('critique cleanup and output location', () => {
  /**
   * Fakes for a 64x36, 90-frame video: ffprobe answers the probe; ffmpeg writes
   * exactly the rgb24 bytes its select and scale ask for, except on call
   * `failOn` (1-based), where it writes a partial file and exits 1. Every
   * ffmpeg call's select expression is appended to `selects`.
   */
  const fakes = (dir, failOn) => ({
    ffprobeBin: fakeBin('ffprobe', `process.stdout.write(JSON.stringify({streams: [{width: 64, height: 36, r_frame_rate: '30/1', nb_read_packets: '90'}]}));`),
    ffmpegBin: fakeBin(
      'ffmpeg',
      `const count = ${JSON.stringify(join(dir, 'count'))};
const k = (fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : 0) + 1;
fs.writeFileSync(count, String(k));
const out = args[args.length - 1];
if (k === ${failOn}) { fs.writeFileSync(out, 'partial'); process.exit(1); }
const vf = args[args.indexOf('-vf') + 1];
const [, w, h] = vf.match(/scale=(\\d+):(\\d+)/);
const expr = vf.match(/select='([^']*)'/)[1];
fs.appendFileSync(${JSON.stringify(join(dir, 'selects'))}, expr + '\\n');
let frames = 0;
for (const t of expr.split('+')) { const b = t.match(/between\\(n,(\\d+),(\\d+)\\)/); frames += b ? Number(b[2]) - Number(b[1]) + 1 : 1; }
fs.writeFileSync(out, Buffer.alloc(frames * w * h * 3));`,
    ),
  });
  /** A sheet builder that writes every sheet the job lists and records the job. */
  const okPython = (dir) =>
    fakeBin('python', `const job = JSON.parse(fs.readFileSync(args[1], 'utf8')); fs.writeFileSync(${JSON.stringify(join(dir, 'job.json'))}, JSON.stringify(job)); for (const s of job.sheets) fs.writeFileSync(s.out, 'PNG');`);
  const setup = (o) => {
    const root = project(o);
    const input = join(freshDir('in'), 'in.mp4');
    writeFileSync(input, 'mp4');
    return {root, input, tmpRoot: freshDir('tmp'), dir: freshDir('state')};
  };
  const run = (c, argv, extra) => quiet(() => critiqueMain(argv, {root: c.root, tmpRoot: c.tmpRoot, ...extra}));

  it('critique: ffmpeg failing mid-way leaves no temp dir, no partial sheets and nothing under out/', async () => {
    const c = setup();
    const {result} = await run(c, ['--in', c.input, '--tag', 'r1', '--strips=1'], {pythonBin: okPython(c.dir), ...fakes(c.dir, 2)});
    assert.equal(result, 1);
    assert.equal(Number(readFileSync(join(c.dir, 'count'), 'utf8')), 2, 'the second decode was the one that failed');
    assert.deepEqual(readdirSync(c.tmpRoot), [], 'temp dir left behind');
    assert.deepEqual(readdirSync(join(c.root, 'out')), [], 'out/critique was created by the failed run and not removed');
  });

  it('critique failure cleanup removes only what it created under out/critique, never out/ or anything else', async () => {
    const fresh = setup();
    assert.equal((await run(fresh, ['--in', fresh.input, '--tag', 'r1'], {pythonBin: okPython(fresh.dir), ...fakes(fresh.dir, 1)})).result, 1);
    assert.equal(existsSync(join(fresh.root, 'out')), true, 'out/ was removed');
    assert.deepEqual(readdirSync(join(fresh.root, 'out')), []);
    const c = setup();
    const keep = ['music-video.mp4', 'draft-r1.mp4', 'critique/r0/overview_01.png', 'critique/notes.txt'];
    for (const f of keep) {
      mkdirSync(dirname(join(c.root, 'out', f)), {recursive: true});
      writeFileSync(join(c.root, 'out', f), f);
    }
    assert.equal((await run(c, ['--in', c.input, '--tag', 'r1'], {pythonBin: okPython(c.dir), ...fakes(c.dir, 2)})).result, 1);
    assert.deepEqual(listFiles(join(c.root, 'out')), [...keep].sort());
    for (const f of keep) assert.equal(readFileSync(join(c.root, 'out', f), 'utf8'), f, f);
    assert.equal(existsSync(join(c.root, 'out/critique/r1')), false);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique: the sheet builder failing after writing a sheet leaves an earlier run of the tag untouched', async () => {
    const c = setup();
    const tagDir = join(c.root, 'out/critique/r1');
    mkdirSync(tagDir, {recursive: true});
    writeFileSync(join(tagDir, 'overview_01.png'), 'OLD');
    const pythonBin = fakeBin('python', `const job = JSON.parse(fs.readFileSync(args[1], 'utf8')); fs.writeFileSync(job.sheets[0].out, 'NEW'); process.exit(1);`);
    const {result} = await run(c, ['--in', c.input, '--tag', 'r1'], {pythonBin, ...fakes(c.dir, 0)});
    assert.equal(result, 1);
    assert.deepEqual(listFiles(join(c.root, 'out')), ['critique/r1/overview_01.png']);
    assert.equal(readFileSync(join(tagDir, 'overview_01.png'), 'utf8'), 'OLD');
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique replaces the tag directory whole and removes stale sheets of the tag, keeping other files', async () => {
    const c = setup({lyrics: [{id: 'v-1', text: 'one two', start: 1, end: 2}], sections: [{id: 'intro', scene: 'x', start: 0}]});
    const tagDir = join(c.root, 'out/critique/r1');
    mkdirSync(tagDir, {recursive: true});
    for (const f of ['overview_01.png', 'overview_02.png', 'strip_0009.00.png', 'notes.txt']) writeFileSync(join(tagDir, f), 'OLD');
    const before = statSync(tagDir).ino;
    const {result, output} = await run(c, ['--in', c.input, '--tag', 'r1'], {pythonBin: okPython(c.dir), ...fakes(c.dir, 0)});
    assert.equal(result, 0, output.join('\n'));
    assert.notEqual(statSync(tagDir).ino, before, 'the tag directory was patched in place instead of replaced whole');
    assert.deepEqual(readdirSync(join(c.root, 'out/critique')), ['r1'], 'a staging or previous directory was left behind');
    // Default strips: line start 1 s and section start 0 s.
    assert.deepEqual(listFiles(tagDir), ['notes.txt', 'overview_01.png', 'phone_01.png', 'strip_0000.00.png', 'strip_0001.00.png']);
    assert.equal(readFileSync(join(tagDir, 'overview_01.png'), 'utf8'), 'PNG');
    assert.equal(readFileSync(join(tagDir, 'notes.txt'), 'utf8'), 'OLD');
    assert.ok(output.some((l) => /removed 2 sheet\(s\) left from an earlier run: overview_02\.png, strip_0009\.00\.png/.test(l)), output.join('\n'));
    // The decodes asked for exactly the planned frames: overview every 60, phone every 120, strips 0..11 and 27..38.
    assert.deepEqual(readFileSync(join(c.dir, 'selects'), 'utf8').trim().split('\n'), ['eq(n,0)+eq(n,60)', 'eq(n,0)', 'between(n,0,11)+between(n,27,38)']);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique publishes the tag directory in one swap: a failed swap restores the earlier run untouched', () => {
    const dir = freshDir('publish');
    const make = (name, files) => {
      mkdirSync(join(dir, name), {recursive: true});
      for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, name, f), text);
    };
    const contents = (name) => Object.fromEntries(readdirSync(join(dir, name)).sort().map((f) => [f, readFileSync(join(dir, name, f), 'utf8')]));
    const OLD = {'overview_01.png': 'OLD', 'strip_0009.00.png': 'OLD', 'notes.txt': 'mine'};
    make('r1', OLD);
    make('new', {'overview_01.png': 'NEW', 'phone_01.png': 'NEW'});
    // The second rename (staging into place) fails after the first moved the old directory aside.
    let calls = 0;
    const failing = (from, to) => {
      if (++calls === 2) throw new Error('rename failed');
      renameSync(from, to);
    };
    assert.throws(() => publishTagDir({staging: join(dir, 'new'), tagDir: join(dir, 'r1'), aside: join(dir, 'aside'), rename: failing}), /rename failed/);
    assert.equal(calls, 2);
    assert.deepEqual(contents('r1'), OLD, 'the earlier run was not restored whole');
    assert.equal(existsSync(join(dir, 'aside')), false);
    // A good swap: the new sheets, the user's notes, nothing of the old sheets.
    rmSync(join(dir, 'new'), {recursive: true});
    make('new', {'overview_01.png': 'NEW', 'phone_01.png': 'NEW'});
    const stale = publishTagDir({staging: join(dir, 'new'), tagDir: join(dir, 'r1'), aside: join(dir, 'aside')});
    assert.deepEqual(stale, ['strip_0009.00.png']);
    assert.deepEqual(contents('r1'), {'notes.txt': 'mine', 'overview_01.png': 'NEW', 'phone_01.png': 'NEW'});
    assert.deepEqual(readdirSync(dir).sort(), ['r1']);
    // No earlier run: the staging directory simply becomes the tag directory.
    make('first', {'overview_01.png': 'FIRST'});
    assert.deepEqual(publishTagDir({staging: join(dir, 'first'), tagDir: join(dir, 'r2'), aside: join(dir, 'aside2')}), []);
    assert.deepEqual(contents('r2'), {'overview_01.png': 'FIRST'});
  });

  it('critique on a partial render labels page frames and decodes the matching video frames', async () => {
    const c = setup();
    // 90 video frames showing page frames 300..389.
    writeFileSync(c.input.replace(/\.mp4$/, '.manifest.json'), JSON.stringify({fps: 30, frames: 90, width: 64, height: 36, scale: 1, textonly: false, cuts: [], blurWindows: [], source: 'src/scenes/index.js', firstFrame: 300}));
    const {result, output} = await run(c, ['--in', c.input, '--tag', 'p', '--strips=10.5'], {pythonBin: okPython(c.dir), ...fakes(c.dir, 0)});
    assert.equal(result, 0, output.join('\n'));
    const job = JSON.parse(readFileSync(join(c.dir, 'job.json'), 'utf8'));
    const strip = job.sheets.find((s) => s.out.endsWith('strip_0010.50.png'));
    // round(10.4 * 30) = 312: video frames 12..23, labelled with page frames 312..323.
    assert.deepEqual(strip.tiles.map((t) => t.label), Array.from({length: 12}, (_, k) => formatLabel(312 + k, 30)));
    assert.deepEqual(strip.tiles.map((t) => t.index), Array.from({length: 12}, (_, k) => k));
    const overview = job.sheets.find((s) => s.out.endsWith('overview_01.png'));
    assert.deepEqual(overview.tiles.map((t) => t.label), [formatLabel(300, 30), formatLabel(360, 30)]);
    assert.deepEqual(readFileSync(join(c.dir, 'selects'), 'utf8').trim().split('\n').at(-1), 'between(n,12,23)');
  });

  it('critique: a tag with / or .. is refused before anything is written', async () => {
    const c = setup();
    for (const tag of ['../escape', 'a/b', '..']) {
      assert.equal((await run(c, ['--in', c.input, '--tag', tag], {pythonBin: okPython(c.dir), ...fakes(c.dir, 0)})).result, 1, tag);
    }
    assert.equal(existsSync(join(c.root, 'out')), false);
    assert.equal(existsSync(join(c.dir, 'count')), false, 'ffmpeg ran');
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique: a missing venv or input fails with the command to run, before any temp dir', async () => {
    const c = setup();
    const noVenv = await run(c, ['--in', c.input, '--tag', 'r1'], {pythonBin: join(c.root, 'nope')});
    assert.equal(noVenv.result, 1);
    assert.match(noVenv.output.join('\n'), /pnpm setup:env/);
    const noInput = await run(c, ['--in', join(c.root, 'none.mp4'), '--tag', 'r1'], {pythonBin: okPython(c.dir)});
    assert.equal(noInput.result, 1);
    assert.match(noInput.output.join('\n'), /none\.mp4 doesn't exist\. Run `pnpm render` or `pnpm draft` first/);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
});
