// The QA scripts: pnpm critique, pops, beatmap, draft and jitter --all-lines.
// Unit tests use tiny fake executables, as tests/scripts.test.ts does; the
// measurement tests run real ffmpeg and the .venv's numpy on synthetic clips
// (tens to a few hundred px, a few seconds) whose frames encode what the
// script must find: their own frame index as bits, a flash, a pop, a cut, a
// block that moves during its hold.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Thumbnail} from '@remotion/player';
import {createElement} from 'react';
import {renderToString} from 'react-dom/server';
import {
  cadenceFrames,
  formatLabel,
  main as critiqueMain,
  OVERVIEW,
  parseCritiqueArgs,
  PHONE,
  STRIP,
  stripName,
  stripPlan,
} from '../scripts/critique.mjs';
import {CUT_TOLERANCE_FRAMES, findPops, main as popsMain, parsePopsArgs, pops} from '../scripts/pops.mjs';
import {beatmapMarkdown, energyCandidates, energyRise, main as beatmapMain, parseBeatmapArgs, risePeaks} from '../scripts/beatmap.mjs';
import {DRAFT_OUTPUT, main as draftMain, parseDraftArgs} from '../scripts/draft.mjs';
import {decodeGray, holdWindows, jitter, jitterAllLines, main as jitterMain, parseJitterArgs, resolveSettle, SPRING_PRESET_NAMES} from '../scripts/jitter.mjs';
import {main as renderMain} from '../scripts/render.mjs';
import {MaskedWords, settleFrames, SPRING_PRESETS} from '../src/components/motion';
import {LyricsContext} from '../src/lib/hooks';
import {lineWords} from '../src/lib/lyric-timing';
import type {LyricLine} from '../src/lib/lyrics-schema';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'music-video-qa-test-'));
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

/** Run `fn` with console output captured; resolves to [result, the printed lines]. */
const captured = async <T>(fn: () => Promise<T>): Promise<[T, string]> => {
  const {log, error, warn} = console;
  const lines: string[] = [];
  const keep = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  console.log = keep;
  console.error = keep;
  console.warn = keep;
  try {
    return [await fn(), lines.join('\n')];
  } finally {
    console.log = log;
    console.error = error;
    console.warn = warn;
  }
};

/** Every file under `dir`, relative to it. */
const listFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, {recursive: true, withFileTypes: true})
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .sort()
    : [];

const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(value));
};

/** A project root with src/pipeline.json and the given data files. */
const projectFixture = (data: {lyrics?: unknown; sections?: unknown; analysis?: unknown} = {}) => {
  const root = freshDir('root');
  writeJson(join(root, 'src/pipeline.json'), {compositionId: 'MusicVideo', outputName: 'music-video', fps: 30});
  writeJson(join(root, 'src/data/lyrics.json'), data.lyrics ?? []);
  writeJson(join(root, 'src/data/sections.json'), data.sections ?? []);
  if (data.analysis !== undefined) writeJson(join(root, 'src/data/audio-analysis.json'), data.analysis);
  return root;
};

const venvPython = join(projectRoot, '.venv/bin/python');
const hasFfmpeg = ['ffmpeg', 'ffprobe'].every((bin) => spawnSync(bin, ['-version'], {stdio: 'ignore'}).status === 0);
const realSkip = !hasFfmpeg ? 'ffmpeg/ffprobe not on PATH' : !existsSync(venvPython) ? '.venv missing: run `pnpm setup:audio`' : false;

/** A synthetic clip: 30 fps gray frames drawn by a geq luma expression (N = frame index), x264 lossless. */
const clip = (name: string, size: string, seconds: number, lum: string, pixFmt = 'yuv420p') => {
  const file = join(freshDir('clip'), `${name}.mp4`);
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${seconds},format=gray`,
    '-vf', `geq=lum='${lum}'`,
    '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', pixFmt,
    file,
  ]);
  assert.equal(res.status, 0, `ffmpeg failed to make ${name}: ${res.stderr}`);
  return file;
};

/**
 * A clip made the way `pnpm render` makes one: x264 with B-frames (crf 18, as
 * Remotion encodes) in an MKV with PCM audio, which is what Remotion writes,
 * then remuxed by render.mjs's own ffmpeg step (a fake remotion hands render()
 * the MKV), so the fixture can't drift from the real remux. 30 fps.
 */
const renderedClip = async (name: string, size: string, seconds: number, lum: string) => {
  const dir = freshDir('rendered');
  const mkv = join(dir, 'intermediate.mkv');
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${seconds},format=gray`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest',
    '-vf', `geq=lum='${lum}'`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-bf', '3', '-pix_fmt', 'yuv420p',
    '-c:a', 'pcm_s16le',
    mkv,
  ]);
  assert.equal(res.status, 0, `ffmpeg failed to make ${name}: ${res.stderr}`);
  const root = projectFixture();
  const out = join(root, 'out', `${name}.mp4`);
  const remotionBin = fakeBin('remotion', `fs.copyFileSync(${JSON.stringify(mkv)}, args[3]);`);
  const [code, output] = await captured(() => renderMain(['--out', out], {root, remotionBin}));
  assert.equal(code, 0, output);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=has_b_frames', '-of', 'default=nw=1:nk=1', out]);
  assert.ok(Number(String(probe.stdout).trim()) > 0, `${name}: the remuxed clip has no B-frames, so it can't stand in for a render`);
  return out;
};

/** The lower half of a frame shows its index as 8 vertical stripes (bit b white when set). */
const INDEX_STRIPES = '255*bitand(N,pow(2,floor(X*8/W)))/pow(2,floor(X*8/W))';

// ---------------------------------------------------------------------------
// critique
// ---------------------------------------------------------------------------

describe('critique arguments and plan', () => {
  it('parseCritiqueArgs: defaults, every flag, and the tag must be one safe path segment', () => {
    assert.deepEqual(parseCritiqueArgs(['--tag', 'r1'], {root: projectRoot}), {
      input: join(projectRoot, 'out/music-video.mp4'),
      tag: 'r1',
      strips: null,
      overviewEvery: 2,
      phoneEvery: 4,
    });
    assert.deepEqual(parseCritiqueArgs(['--in=out/d.mp4', '--tag=r2', '--strips=1.5,30', '--overview-every', '1', '--phone-every=0.5'], {root: '/r'}), {
      input: '/r/out/d.mp4',
      tag: 'r2',
      strips: [1.5, 30],
      overviewEvery: 1,
      phoneEvery: 0.5,
    });
    const r = {root: '/r'};
    assert.throws(() => parseCritiqueArgs([], r), /--tag is required/);
    for (const tag of ['a/b', '..', '.', '.hidden', '../x', 'a\\b', 'with space', 'x'.repeat(65)]) {
      assert.throws(() => parseCritiqueArgs([`--tag=${tag}`], r), /must be one path segment/, tag);
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
    assert.equal(cadenceFrames(0.001, 30, 5).length, 5, 'a cadence under one frame takes every frame');
    assert.deepEqual(cadenceFrames(0.001, 30, 5), [0, 1, 2, 3, 4]);
  });

  it('cadenceFrames rounds each tile from k * every * fps, so 29.97 fps does not drift', () => {
    const frames = cadenceFrames(2, 29.97, 6000);
    // A fixed rounded step of 60 would put tile 10 at 600 and tile 100 at 6000 (3.3 s late by then).
    assert.equal(frames[10], 599);
    assert.equal(frames[50], 2997);
    assert.equal(frames.length, 101, 'tiles below frame 6000: k * 59.94 rounds to 5994 at k = 100');
    frames.forEach((f: number, k: number) => assert.ok(Math.abs(f / 29.97 - 2 * k) <= 0.5 / 29.97 + 1e-9, `tile ${k} at frame ${f}`));
  });

  it('stripPlan: 12 frames from round((t - 0.1) * fps), clamped at 0, cut short at the end, skipped past it', () => {
    const {strips, skipped} = stripPlan([3, 0.05, 7.9, 9, 3.001], 30, 240);
    assert.deepEqual(
      strips.map((s: {name: string; start: number; frames: number[]; note: string | null}) => [s.name, s.start, s.frames.length, s.frames.at(-1), s.note]),
      [
        ['strip_0000.05.png', 0, 12, 11, null],
        ['strip_0003.00.png', 87, 12, 98, null],
        ['strip_0007.90.png', 234, 6, 239, 'only 6 frames before the end'],
      ],
    );
    // 3.001 s names the same file as 3 s and is dropped; 9 s starts after the last frame.
    assert.deepEqual(skipped, [{seconds: 9, reason: 'starts at frame 267, after the last frame (239)'}]);
  });
});

describe('critique cleanup and output location', () => {
  /**
   * Fakes for a 64x36, 90-frame video: ffprobe answers the probe; ffmpeg writes
   * exactly the rgb24 bytes its select and scale ask for, except on call
   * `failOn` (1-based), where it writes a partial file and exits 1.
   */
  const fakes = (dir: string, failOn: number) => ({
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
let frames = 0;
for (const t of expr.split('+')) { const b = t.match(/between\\(n,(\\d+),(\\d+)\\)/); frames += b ? Number(b[2]) - Number(b[1]) + 1 : 1; }
fs.writeFileSync(out, Buffer.alloc(frames * w * h * 3));`,
    ),
  });
  const setup = () => {
    const root = projectFixture();
    const input = join(freshDir('in'), 'in.mp4');
    writeFileSync(input, 'mp4');
    return {root, input, tmpRoot: freshDir('tmp'), dir: freshDir('state')};
  };

  it('critique: ffmpeg failing mid-way leaves no temp dir, no partial sheets and nothing under out/', async () => {
    const c = setup();
    const code = await captured(() =>
      critiqueMain(['--in', c.input, '--tag', 'r1', '--strips=1'], {root: c.root, tmpRoot: c.tmpRoot, pythonBin: venvPython, ...fakes(c.dir, 2)}),
    );
    assert.equal(code[0], 1);
    assert.equal(Number(readFileSync(join(c.dir, 'count'), 'utf8')), 2, 'the second decode was the one that failed');
    assert.deepEqual(readdirSync(c.tmpRoot), [], 'temp dir left behind');
    assert.deepEqual(readdirSync(join(c.root, 'out')), [], 'out/critique was created by the failed run and not removed');
  });

  it('critique failure cleanup removes only what it created under out/critique, never out/ or anything else', async () => {
    // out/ didn't exist: the failed run leaves an empty out/ (never removes it) and no out/critique.
    const fresh = setup();
    assert.equal((await captured(() => critiqueMain(['--in', fresh.input, '--tag', 'r1'], {root: fresh.root, tmpRoot: fresh.tmpRoot, pythonBin: venvPython, ...fakes(fresh.dir, 1)})))[0], 1);
    assert.equal(existsSync(join(fresh.root, 'out')), true, 'out/ was removed');
    assert.deepEqual(readdirSync(join(fresh.root, 'out')), []);
    // out/ and out/critique exist with other work: only the new tag directory goes.
    const c = setup();
    const keep = ['music-video.mp4', 'draft-r1.mp4', 'critique/r0/overview_01.png', 'critique/notes.txt'];
    for (const f of keep) writeJson(join(c.root, 'out', f), f);
    assert.equal((await captured(() => critiqueMain(['--in', c.input, '--tag', 'r1'], {root: c.root, tmpRoot: c.tmpRoot, pythonBin: venvPython, ...fakes(c.dir, 2)})))[0], 1);
    assert.deepEqual(listFiles(join(c.root, 'out')), [...keep].sort());
    for (const f of keep) assert.equal(readFileSync(join(c.root, 'out', f), 'utf8'), JSON.stringify(f), f);
    assert.equal(existsSync(join(c.root, 'out/critique/r1')), false);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique: the sheet builder failing after writing a sheet leaves an earlier run of the tag untouched', async () => {
    const c = setup();
    const tagDir = join(c.root, 'out/critique/r1');
    mkdirSync(tagDir, {recursive: true});
    writeFileSync(join(tagDir, 'overview_01.png'), 'OLD');
    // critique.py's argv: <script> <job.json>; write the first sheet into staging, then fail.
    const pythonBin = fakeBin('python', `const job = JSON.parse(fs.readFileSync(args[1], 'utf8')); fs.writeFileSync(job.sheets[0].out, 'NEW'); process.exit(1);`);
    const [code] = await captured(() => critiqueMain(['--in', c.input, '--tag', 'r1'], {root: c.root, tmpRoot: c.tmpRoot, pythonBin, ...fakes(c.dir, 0)}));
    assert.equal(code, 1);
    assert.deepEqual(listFiles(join(c.root, 'out')), ['critique/r1/overview_01.png']);
    assert.equal(readFileSync(join(tagDir, 'overview_01.png'), 'utf8'), 'OLD');
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique: a tag with / or .. is refused before anything is written', async () => {
    const c = setup();
    for (const tag of ['../escape', 'a/b', '..']) {
      const [code] = await captured(() => critiqueMain(['--in', c.input, '--tag', tag], {root: c.root, tmpRoot: c.tmpRoot, pythonBin: venvPython, ...fakes(c.dir, 0)}));
      assert.equal(code, 1, tag);
    }
    assert.equal(existsSync(join(c.root, 'out')), false);
    assert.equal(existsSync(join(c.dir, 'count')), false, 'ffmpeg ran');
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });

  it('critique: a missing venv or input fails before any temp dir', async () => {
    const c = setup();
    assert.equal((await captured(() => critiqueMain(['--in', c.input, '--tag', 'r1'], {root: c.root, tmpRoot: c.tmpRoot, pythonBin: join(c.root, 'nope')})))[0], 1);
    assert.equal((await captured(() => critiqueMain(['--in', join(c.root, 'none.mp4'), '--tag', 'r1'], {root: c.root, tmpRoot: c.tmpRoot, pythonBin: venvPython})))[0], 1);
    assert.deepEqual(readdirSync(c.tmpRoot), []);
  });
});

/** critique.py's label font and sheet geometry. */
type Font = {font: Record<string, string[]>; gap: number; scale: number; pad: number; glyphWidth: number; glyphHeight: number; advance: number};

/** An RGB image decoded from a PNG by ffmpeg. */
type Image = {width: number; height: number; px: (x: number, y: number) => [number, number, number]};

const decodePng = (file: string): Image => {
  const png = readFileSync(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const res = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 28});
  assert.equal(res.status, 0, String(res.stderr));
  const data = res.stdout;
  assert.equal(data.length, width * height * 3);
  return {width, height, px: (x, y) => [data[(y * width + x) * 3]!, data[(y * width + x) * 3 + 1]!, data[(y * width + x) * 3 + 2]!]};
};

describe('critique sheets', {skip: realSkip}, () => {
  // 161x91 (odd both ways, so yuv444p): the lower half shows the frame index
  // as 8 vertical stripes, bit b white when set; the upper half is mid-gray.
  const BARS = 'if(gt(Y,H/2),255*bitand(N,pow(2,floor(X*8/W)))/pow(2,floor(X*8/W)),128)';
  const W = 161;
  const H = 91;
  let source = '';
  let font: Font;
  before(() => {
    source = clip('bars', `${W}x${H}`, 8, BARS, 'yuv444p');
    const res = spawnSync(venvPython, [join(projectRoot, 'scripts/critique.py'), '--font']);
    assert.equal(res.status, 0, String(res.stderr));
    font = JSON.parse(String(res.stdout)) as Font;
  });

  const tileHeightFor = (tw: number, w = W, h = H) => Math.round((h * tw) / w);
  const origin = (k: number, cols: number, tw: number, th: number) => ({
    x: font.gap + (k % cols) * (tw + font.gap),
    y: font.gap + Math.floor(k / cols) * (th + font.gap),
  });
  /** The frame index a tile shows, from its 8 stripes. */
  const readIndex = (img: Image, o: {x: number; y: number}, tw: number, th: number) => {
    let index = 0;
    for (let b = 0; b < 8; b++) {
      const [r] = img.px(o.x + Math.floor(((b + 0.5) * tw) / 8), o.y + Math.floor(0.8 * th));
      if (r > 128) index += 2 ** b;
    }
    return index;
  };
  /** Decode `length` stamped characters at a tile's top-left corner by matching every glyph pixel. */
  const readLabel = (img: Image, o: {x: number; y: number}, length: number) => {
    let text = '';
    for (let i = 0; i < length; i++) {
      const rows: string[] = [];
      for (let r = 0; r < font.glyphHeight; r++) {
        let row = '';
        for (let c = 0; c < font.glyphWidth; c++) {
          const x = o.x + font.pad + i * font.advance * font.scale + c * font.scale + Math.floor(font.scale / 2);
          const y = o.y + font.pad + r * font.scale + Math.floor(font.scale / 2);
          row += img.px(x, y)[0] > 128 ? '#' : '.';
        }
        rows.push(row);
      }
      const match = Object.entries(font.font).find(([, glyph]) => glyph.every((g, r) => g === rows[r]));
      text += match ? match[0] : '?';
    }
    return text;
  };
  /** Check every tile of a sheet: its stripes show `frames[k]` and its label decodes to that frame's time. */
  const checkSheet = (file: string, frames: number[], layout: {width: number; cols: number}, src = {w: W, h: H}) => {
    const img = decodePng(file);
    const tw = layout.width;
    const th = tileHeightFor(tw, src.w, src.h);
    const cols = Math.min(layout.cols, frames.length);
    const rows = Math.ceil(frames.length / cols);
    assert.equal(img.width, font.gap + cols * (tw + font.gap), `${file}: width for ${cols} tiles of ${tw} px`);
    assert.equal(img.height, font.gap + rows * (th + font.gap), `${file}: height for ${rows} rows of ${th} px`);
    frames.forEach((frame, k) => {
      const o = origin(k, cols, tw, th);
      assert.equal(readIndex(img, o, tw, th), frame % 256, `${file} tile ${k}: frame`);
      const label = formatLabel(frame, 30);
      assert.equal(readLabel(img, o, label.length), label, `${file} tile ${k}: label`);
    });
    // Empty slots on a last sheet stay the gap colour.
    for (let k = frames.length; k < cols * rows; k++) {
      const o = origin(k, cols, tw, th);
      assert.deepEqual(img.px(o.x + Math.floor(tw / 2), o.y + Math.floor(th / 2)), [24, 24, 24], `${file} slot ${k} is empty`);
    }
    return img;
  };
  const runCritique = async (argv: string[], root = projectFixture()) => {
    const tmpRoot = freshDir('tmp');
    const [code, output] = await captured(() => critiqueMain(argv, {root, tmpRoot}));
    assert.deepEqual(readdirSync(tmpRoot), [], 'temp dir left behind');
    return {code, output, root, dir: (tag: string) => join(root, 'out/critique', tag)};
  };
  // pythonBin defaults to <root>/.venv/bin/python; fixture roots link to the project's venv.
  const rootWithVenv = (data?: Parameters<typeof projectFixture>[0]) => {
    const root = projectFixture(data);
    mkdirSync(join(root, '.venv/bin'), {recursive: true});
    writeFileSync(join(root, '.venv/bin/python'), `#!/bin/sh\nexec ${JSON.stringify(venvPython)} "$@"\n`);
    chmodSync(join(root, '.venv/bin/python'), 0o755);
    return root;
  };

  it('critique strip frames are exactly round((t - 0.1) * fps) .. +11, read back from each frame', async () => {
    const r = await runCritique(['--in', source, '--tag', 's', '--strips=3,4.567'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    // 3 s -> round(2.9 * 30) = 87; 4.567 s -> round(4.467 * 30) = 134.
    checkSheet(join(r.dir('s'), 'strip_0003.00.png'), Array.from({length: 12}, (_, k) => 87 + k), STRIP);
    checkSheet(join(r.dir('s'), 'strip_0004.57.png'), Array.from({length: 12}, (_, k) => 134 + k), STRIP);
  });

  it('critique overview and phone tiles cover the whole duration at their cadence', async () => {
    const root = rootWithVenv();
    // Defaults on 8 s (240 frames): ceil(8 / 2) = 4 overview tiles, ceil(8 / 4) = 2 phone tiles.
    const d = await runCritique(['--in', source, '--tag', 'd', '--strips=1'], root);
    assert.equal(d.code, 0, d.output);
    assert.deepEqual(listFiles(d.dir('d')), ['overview_01.png', 'phone_01.png', 'strip_0001.00.png']);
    checkSheet(join(d.dir('d'), 'overview_01.png'), [0, 60, 120, 180], OVERVIEW);
    checkSheet(join(d.dir('d'), 'phone_01.png'), [0, 120], PHONE);
    // Short cadences spill over sheets: 40 overview tiles (30 + 10), 20 phone tiles (15 + 5).
    const s = await runCritique(['--in', source, '--tag', 'c', '--strips=1', '--overview-every=0.2', '--phone-every=0.4'], root);
    assert.equal(s.code, 0, s.output);
    const every = (step: number) => Array.from({length: Math.ceil(240 / step)}, (_, k) => k * step);
    const overview = every(6);
    const phone = every(12);
    assert.equal(overview.length, 40);
    assert.equal(phone.length, 20);
    checkSheet(join(s.dir('c'), 'overview_01.png'), overview.slice(0, 30), OVERVIEW);
    checkSheet(join(s.dir('c'), 'overview_02.png'), overview.slice(30), OVERVIEW);
    checkSheet(join(s.dir('c'), 'phone_01.png'), phone.slice(0, 15), PHONE);
    checkSheet(join(s.dir('c'), 'phone_02.png'), phone.slice(15), PHONE);
    assert.deepEqual(listFiles(s.dir('c')), ['overview_01.png', 'overview_02.png', 'phone_01.png', 'phone_02.png', 'strip_0001.00.png']);
  });

  it('critique phone tiles are 360 px wide, overview 270 px and strip 320 px, with the source aspect', async () => {
    const r = await runCritique(['--in', source, '--tag', 'w', '--strips=2'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    assert.deepEqual([OVERVIEW.width, PHONE.width, STRIP.width], [270, 360, 320]);
    for (const [file, tw] of [['overview_01.png', 270], ['phone_01.png', 360], ['strip_0002.00.png', 320]] as const) {
      const img = decodePng(join(r.dir('w'), file));
      const th = tileHeightFor(tw);
      // The tile's last column is picture; the next one is the gap.
      assert.notDeepEqual(img.px(font.gap + tw - 1, font.gap + th - 2), [24, 24, 24], `${file}: column ${tw - 1} is inside the tile`);
      assert.deepEqual(img.px(font.gap + tw, font.gap + th - 2), [24, 24, 24], `${file}: column ${tw} is the gap`);
      assert.deepEqual(img.px(font.gap + 1, font.gap + th), [24, 24, 24], `${file}: row ${th} is the gap`);
    }
  });

  it('critique labels decode to each tile\'s own time and frame', async () => {
    const r = await runCritique(['--in', source, '--tag', 'l', '--strips=0.5,6', '--overview-every=0.5'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    // checkSheet decodes every stamped glyph and compares it with formatLabel of the frame the stripes show.
    checkSheet(join(r.dir('l'), 'overview_01.png'), Array.from({length: 16}, (_, k) => k * 15), OVERVIEW);
    checkSheet(join(r.dir('l'), 'strip_0000.50.png'), Array.from({length: 12}, (_, k) => 12 + k), STRIP);
    checkSheet(join(r.dir('l'), 'strip_0006.00.png'), Array.from({length: 12}, (_, k) => 177 + k), STRIP);
  });

  it('critique strips near the end are cut short and past the end skipped, with a message; t < 0.1 s starts at frame 0', async () => {
    const r = await runCritique(['--in', source, '--tag', 'e', '--strips=0.05,7.9,9'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    checkSheet(join(r.dir('e'), 'strip_0000.05.png'), Array.from({length: 12}, (_, k) => k), STRIP);
    checkSheet(join(r.dir('e'), 'strip_0007.90.png'), [234, 235, 236, 237, 238, 239], STRIP);
    assert.equal(existsSync(join(r.dir('e'), 'strip_0009.00.png')), false);
    assert.match(r.output, /strip_0007\.90\.png {2}frames 234-239 {2}\(only 6 frames before the end\)/);
    assert.match(r.output, /skipped strip at 9 s: starts at frame 267, after the last frame \(239\)/);
  });

  it('critique picks exact frames from a render.mjs-remuxed clip', async () => {
    const rendered = await renderedClip('critique-rendered', '160x96', 4, `if(gte(Y,48),${INDEX_STRIPES},0)`);
    const r = await runCritique(['--in', rendered, '--tag', 'rm', '--strips=0.1,0.2,2.1'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    const src = {w: 160, h: 96};
    // 0.1 s -> frame 0; 0.2 s -> frame 3; 2.1 s -> frame 60.
    checkSheet(join(r.dir('rm'), 'strip_0000.10.png'), Array.from({length: 12}, (_, k) => k), STRIP, src);
    checkSheet(join(r.dir('rm'), 'strip_0000.20.png'), Array.from({length: 12}, (_, k) => 3 + k), STRIP, src);
    checkSheet(join(r.dir('rm'), 'strip_0002.10.png'), Array.from({length: 12}, (_, k) => 60 + k), STRIP, src);
    checkSheet(join(r.dir('rm'), 'overview_01.png'), [0, 60], OVERVIEW, src);
  });

  it('critique handles an odd-sized source', async () => {
    const odd = clip('odd', '97x55', 2, BARS, 'yuv444p');
    const r = await runCritique(['--in', odd, '--tag', 'o', '--strips=1'], rootWithVenv());
    assert.equal(r.code, 0, r.output);
    const src = {w: 97, h: 55};
    // 55 * 270 / 97 = 153.1 -> 153; 55 * 360 / 97 = 204.1 -> 204; 55 * 320 / 97 = 181.4 -> 181 (odd heights).
    checkSheet(join(r.dir('o'), 'overview_01.png'), [0], OVERVIEW, src);
    checkSheet(join(r.dir('o'), 'phone_01.png'), [0], PHONE, src);
    checkSheet(join(r.dir('o'), 'strip_0001.00.png'), Array.from({length: 12}, (_, k) => 27 + k), STRIP, src);
  });

  it('critique writes only under out/critique/<tag>/, strips default to line and section starts, and a rerun drops stale sheets', async () => {
    const root = rootWithVenv({
      lyrics: [
        {id: 'v-1', text: 'one two', start: 1, end: 2},
        {id: 'v-2', text: 'three', start: 4.5, end: 5},
      ],
      sections: [
        {id: 'intro', scene: 'intro', start: 0},
        {id: 'verse-1', scene: 'verse', start: 1},
      ],
    });
    const before = listFiles(root);
    const r = await runCritique(['--in', source, '--tag', 'r1'], root);
    assert.equal(r.code, 0, r.output);
    const added = listFiles(root).filter((f) => !before.includes(f));
    // Line starts 1 and 4.5 s, section starts 0 and 1 s: three strips.
    assert.deepEqual(added, [
      'out/critique/r1/overview_01.png',
      'out/critique/r1/phone_01.png',
      'out/critique/r1/strip_0000.00.png',
      'out/critique/r1/strip_0001.00.png',
      'out/critique/r1/strip_0004.50.png',
    ]);
    assert.deepEqual(readdirSync(join(root, 'out')), ['critique']);
    assert.deepEqual(readdirSync(join(root, 'out/critique')), ['r1']);
    // A rerun with other strips replaces the sheets and removes the strips it didn't make; other files stay.
    writeFileSync(join(root, 'out/critique/r1/notes.txt'), 'mine');
    const again = await runCritique(['--in', source, '--tag', 'r1', '--strips=2'], root);
    assert.equal(again.code, 0, again.output);
    assert.deepEqual(listFiles(join(root, 'out/critique/r1')), ['notes.txt', 'overview_01.png', 'phone_01.png', 'strip_0002.00.png']);
  });
});

// ---------------------------------------------------------------------------
// pops
// ---------------------------------------------------------------------------

describe('pops arguments and detection rules', () => {
  it('parsePopsArgs: defaults, --cuts, --ratio, --fail, and bad values', () => {
    assert.deepEqual(parsePopsArgs([], {root: projectRoot}), {input: join(projectRoot, 'out/music-video.mp4'), cuts: [], ratio: 3, fail: false});
    assert.deepEqual(parsePopsArgs(['--in', 'a.mp4', '--cuts=10,250', '--ratio', '4.5', '--fail'], {root: '/r'}), {
      input: '/r/a.mp4',
      cuts: [10, 250],
      ratio: 4.5,
      fail: true,
    });
    const r = {root: '/r'};
    assert.throws(() => parsePopsArgs(['--cuts=1.5'], r), /--cuts must be frame numbers/);
    assert.throws(() => parsePopsArgs(['--ratio=1'], r), /--ratio must be a number > 1/);
    assert.throws(() => parsePopsArgs(['--fail', '--fail'], r), /--fail given twice/);
    assert.throws(() => parsePopsArgs(['--fail=1'], r), /unexpected argument "--fail=1"/);
    assert.throws(() => parsePopsArgs(['x.mp4'], r), /unexpected argument "x\.mp4"/);
  });

  it('findPops: a pop is numbered by the frame where the new picture appears; cuts excuse pops within ±1 frame, never flashes', () => {
    // d[i] = |f[i+1] - f[i]|. Frame 5 is new (d[4] spikes); frame 10 blinks (d[9] and d[10] big, skip[10] small).
    const d = [0.5, 0.5, 0.5, 0.5, 20, 0.5, 0.5, 0.5, 0.5, 30, 30, 0.5, 0.5, 0.5];
    const skip: (number | null)[] = d.map(() => 1).concat([1]);
    skip[0] = null;
    skip[skip.length - 1] = null;
    skip[10] = 0.4;
    const plain = findPops(d, skip, {fps: 30});
    assert.deepEqual(plain.pops.map((p: {frame: number}) => p.frame), [5]);
    assert.deepEqual(plain.flashes.map((f: {frame: number}) => f.frame), [10]);
    assert.equal(CUT_TOLERANCE_FRAMES, 1);
    for (const cut of [4, 5, 6]) {
      const r = findPops(d, skip, {fps: 30, cuts: [cut]});
      assert.deepEqual(r.pops, [], `cut ${cut}`);
      assert.deepEqual(r.cuts.map((c: {frame: number; cut: number}) => [c.frame, c.cut]), [[5, cut]]);
    }
    const far = findPops(d, skip, {fps: 30, cuts: [7, 10]});
    assert.deepEqual(far.pops.map((p: {frame: number}) => p.frame), [5], 'a cut 2 frames away does not excuse the pop');
    assert.deepEqual(far.flashes.map((f: {frame: number}) => f.frame), [10], 'a cut does not excuse a flash');
    assert.deepEqual(far.missedCuts, [7, 10]);
  });
});

describe('pops on real clips', {skip: realSkip}, () => {
  const clips = {events: '', still: '', pan: '', cut: ''};
  before(() => {
    // A 30x30 white block sliding 1 px per frame on dark gray; frame 30 is all white (a one-frame
    // flash); from frame 50 the block is 60 px further on (a pop).
    clips.events = clip('events', '320x180', 3, 'if(eq(N,30),255,if(between(X,20+N+60*gte(N,50),50+N+60*gte(N,50))*between(Y,60,90),255,64))');
    clips.still = clip('still', '320x180', 2, '96+40*sin(X/9)*cos(Y/7)');
    clips.pan = clip('pan', '320x180', 3, '128+80*sin((X+2*N)/12)');
    // Two still pictures with a hard cut: frame 45 is the first frame of the second.
    clips.cut = clip('cut', '320x180', 3, 'if(lt(N,45),128+80*sin(X/9),128+80*cos(Y/5))');
  });
  const measure = async (input: string, extra: {cuts?: number[]} = {}) => {
    const tmpRoot = freshDir('tmp');
    const cleanup = new Set<() => void>();
    try {
      const [result] = await captured(() => pops({input, cuts: extra.cuts ?? [], root: projectRoot, tmpRoot}, cleanup));
      return result;
    } finally {
      for (const fn of cleanup) fn();
      assert.deepEqual(readdirSync(tmpRoot), []);
    }
  };
  const frames = (list: {frame: number}[]) => list.map((p) => p.frame);

  it('pops detects an injected one-frame flash and a pop spike at their frames', async () => {
    const r = await measure(clips.events);
    assert.equal(r.frames, 90);
    assert.deepEqual(frames(r.flashes), [30]);
    assert.deepEqual(frames(r.pops), [50]);
  });

  it('pops flags nothing on a still clip or a slow pan', async () => {
    for (const input of [clips.still, clips.pan]) {
      const r = await measure(input);
      assert.deepEqual([frames(r.pops), frames(r.flashes)], [[], []], input);
    }
  });

  it('pops reports a hard cut as a pop unless it is listed with --cuts (±1 frame)', async () => {
    assert.deepEqual(frames((await measure(clips.cut)).pops), [45]);
    for (const cut of [44, 45, 46]) {
      const r = await measure(clips.cut, {cuts: [cut]});
      assert.deepEqual(frames(r.pops), [], `--cuts=${cut}`);
      assert.deepEqual(r.cuts.map((c: {frame: number; cut: number}) => [c.frame, c.cut]), [[45, cut]]);
    }
    assert.deepEqual(frames((await measure(clips.cut, {cuts: [47]})).pops), [45], 'a cut 2 frames off is not this one');
  });

  it('pops --fail exits 1 on an unexpected finding and 0 when clean or when every finding is a listed cut', async () => {
    const code = async (argv: string[]) => {
      const tmpRoot = freshDir('tmp');
      const [c] = await captured(() => popsMain(argv, {root: projectRoot, tmpRoot}));
      assert.deepEqual(readdirSync(tmpRoot), []);
      return c;
    };
    assert.equal(await code(['--in', clips.events, '--fail']), 1);
    assert.equal(await code(['--in', clips.events, '--fail', '--cuts=50']), 1, 'the flash is still a finding');
    assert.equal(await code(['--in', clips.cut, '--fail']), 1);
    assert.equal(await code(['--in', clips.cut, '--fail', '--cuts=45']), 0);
    assert.equal(await code(['--in', clips.pan, '--fail']), 0);
    assert.equal(await code(['--in', clips.events]), 0, 'without --fail findings are only listed');
  });
});

// ---------------------------------------------------------------------------
// beatmap
// ---------------------------------------------------------------------------

describe('beatmap', () => {
  // 20 s at 30 fps. Every band sits at 0.2 until frame 300 (10 s), then low and
  // mid at 0.8 and high at 0.5, with a high-band burst to 1.0 on frames 450-452.
  const analysis = () => {
    const frames = 600;
    const band = (after: number) => Array.from({length: frames}, (_, f) => (f < 300 ? 0.2 : after));
    const high = band(0.5);
    for (const f of [450, 451, 452]) high[f] = 1;
    const beats = Array.from({length: 40}, (_, i) => i * 0.5);
    return {
      version: 1,
      source: 'audio/track.wav',
      generator: 'test',
      fps: 30,
      durationSeconds: 20,
      durationInFrames: frames,
      tempo: 120,
      beatsPerBar: 4,
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      onsets: [],
      bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
      energy: {low: band(0.8), mid: band(0.8), high},
    };
  };
  const lyrics = [
    {id: 'verse-1-1', text: 'first line here', start: 1.016, end: 2.5},
    {id: 'verse-1-2', text: 'second line', start: 2.7, end: 4.983},
    {id: 'chorus-1-1', text: 'a | b', start: 10, end: 12},
  ];
  const sections = [
    {id: 'verse-1', scene: 'verse', start: 0},
    {id: 'chorus-1', scene: 'chorus', start: 9.5, variant: '1'},
  ];
  const fixture = () => projectFixture({lyrics, sections, analysis: analysis()});
  const run = (root: string, argv: string[] = []) => captured(() => beatmapMain(argv, {root})).then(([code]) => code);
  const target = (root: string) => join(root, 'creative/beatmap.md');

  it('parseBeatmapArgs: only --force', () => {
    assert.deepEqual(parseBeatmapArgs([]), {force: false});
    assert.deepEqual(parseBeatmapArgs(['--force']), {force: true});
    assert.throws(() => parseBeatmapArgs(['--out=x.md']), /unexpected argument "--out=x\.md"/);
    assert.throws(() => parseBeatmapArgs(['--force', '--force']), /--force given twice/);
  });

  it('beatmap refuses to overwrite an existing beatmap.md without --force and replaces it with --force', async () => {
    const root = fixture();
    mkdirSync(join(root, 'creative'));
    writeFileSync(target(root), 'MY NOTES\n');
    assert.equal(await run(root), 1);
    assert.equal(readFileSync(target(root), 'utf8'), 'MY NOTES\n');
    assert.deepEqual(readdirSync(join(root, 'creative')), ['beatmap.md'], 'temp file left behind');
    assert.equal(await run(root, ['--force']), 0);
    assert.match(readFileSync(target(root), 'utf8'), /^# Beat map\n/);
    assert.deepEqual(readdirSync(join(root, 'creative')), ['beatmap.md']);
  });

  it('beatmap rows are the lyric lines in order with frames round(seconds * fps)', async () => {
    const root = fixture();
    assert.equal(await run(root), 0);
    const md = readFileSync(target(root), 'utf8');
    const linesSection = md.slice(md.indexOf('## Lines'), md.indexOf('## Layers'));
    const rows = linesSection.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| id ') && !l.startsWith('|---'));
    assert.deepEqual(rows, [
      '| verse-1-1 | 30–75 | 1.02–2.50 | first line here |  |  |  |  |',
      '| verse-1-2 | 81–149 | 2.70–4.98 | second line |  |  |  |  |',
      '| chorus-1-1 | 300–360 | 10.00–12.00 | a \\| b |  |  |  |  |',
    ]);
    assert.match(linesSection, /\| id \| frames \| seconds \| text \| world \| transition in \| text exit \| one-off accent \|/);
    assert.match(md, /\| verse-1 \| verse \| {2}\| 0–285 \| 0\.00–9\.50 \|/);
    assert.match(md, /\| chorus-1 \| chorus \| 1 \| 285–600 \| 9\.50–20\.00 \|/);
    assert.match(md, /Tempo: 120\.00 BPM\. Beat: 0\.500 s \(15\.00 frames\)\. Bar of 4 beats: 2\.000 s \(60\.00 frames\)\./);
    assert.match(md, /Key changes: not detected\./);
    const layers = md.slice(md.indexOf('## Layers'));
    assert.equal(layers, '## Layers\n\n### WorldLayer\n\n- Shots and transitions:\n- Camera:\n- One-off effects:\n\n### LyricLayer\n\n- Lines and their exits:\n');
  });

  it('beatmap output is byte-identical across runs and finds a known energy jump at its frame', async () => {
    const root = fixture();
    assert.equal(await run(root), 0);
    const first = readFileSync(target(root));
    assert.equal(await run(root, ['--force']), 0);
    assert.ok(readFileSync(target(root)).equals(first), 'two runs on the same data differ');

    const {drops, accents} = energyCandidates(analysis(), 30);
    // All three bands averaged rise by (0.6 + 0.6 + 0.3) / 3 * 48 = 24 dB exactly at frame 300.
    assert.equal(drops.length, 1);
    assert.equal(drops[0].frame, 300);
    assert.ok(Math.abs(drops[0].rise - 24) < 1e-9, `rise ${drops[0].rise}`);
    // Accents: the step at 300 in every band (low/mid +28.8 dB) and the high burst at 450 (+24 dB).
    assert.deepEqual(
      accents.map((a: {frame: number; bands: string[]; rise: number}) => [a.frame, a.bands, Number(a.rise.toFixed(1))]),
      [
        [300, ['low', 'mid', 'high'], 28.8],
        [450, ['high'], 24],
      ],
    );
    assert.match(first.toString(), /\| 300 \| 10\.00 \| 24\.0 \| 300 \(\+0\) \|/);
    assert.equal(beatmapMarkdown({analysis: analysis(), lyrics, sections, fps: 30}), first.toString());
  });

  it('beatmap energy rise and peaks: a burst shorter than the window is placed on its first frame', () => {
    // A one-frame burst at frame 5: with W = 3 the rise is equal (1/3 * 48 = 16 dB) at frames 3, 4 and 5.
    const rise = energyRise([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], 3);
    assert.deepEqual(rise.slice(3, 6).map((r: number | null) => Number(r!.toFixed(9))), [16, 16, 16]);
    assert.deepEqual(rise.slice(0, 3), [null, null, null], 'no rise without a full window before');
    assert.deepEqual(risePeaks(rise, 12, 3), [{frame: 5, rise: rise[5]}]);
    assert.deepEqual(risePeaks(rise, 17, 3), [], 'below the threshold');
  });

  it('beatmap stops on an analysis at another fps than pipeline.json', async () => {
    const root = projectFixture({lyrics, sections, analysis: {...analysis(), fps: 25, durationInFrames: 500, energy: {low: [], mid: [], high: []}}});
    assert.equal(await run(root), 1);
    assert.equal(existsSync(join(root, 'creative')), false);
  });
});

// ---------------------------------------------------------------------------
// draft
// ---------------------------------------------------------------------------

describe('draft', () => {
  /** argv-logging fakes, as the render tests use; ffprobe reports `rate` for the intermediate. */
  const capturing = (rate: string) => {
    const dir = freshDir('draft-log');
    const log = (name: string) => join(dir, `${name}.jsonl`);
    const append = (name: string) => `fs.appendFileSync(${JSON.stringify(log(name))}, JSON.stringify(args) + '\\n');`;
    return {
      bins: {
        remotionBin: fakeBin('remotion', `${append('remotion')} fs.writeFileSync(args[3], 'mkv');`),
        ffmpegBin: fakeBin('ffmpeg', `${append('ffmpeg')} fs.writeFileSync(args[args.length - 1], 'mp4');`),
        ffprobeBin: fakeBin('ffprobe', `${append('ffprobe')} process.stdout.write(${JSON.stringify(`${rate}\n`)});`),
      },
      calls: (name: string): string[][] =>
        existsSync(log(name)) ? readFileSync(log(name), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]) : [],
    };
  };
  const pipelineRoot = () => {
    const root = projectFixture();
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out/music-video.mp4'), 'MAIN');
    return root;
  };
  const draft = async (root: string, argv: string[], rate = '30/1') => {
    const f = capturing(rate);
    const [code] = await captured(() => draftMain(argv, {root, ...f.bins}));
    return {code, remotion: f.calls('remotion'), ffmpeg: f.calls('ffmpeg'), ffprobe: f.calls('ffprobe')};
  };

  it('draft forwards --scale=0.5 through render\'s parse, probe and remux path', async () => {
    const root = pipelineRoot();
    const r = await draft(root, ['--frames=0-9', '--props={"textOnly":true}']);
    assert.equal(r.code, 0);
    const outDir = join(root, 'out');
    const intermediate = join(outDir, `.intermediate-${process.pid}.mkv`);
    assert.deepEqual(r.remotion, [
      ['render', 'src/index.ts', 'MusicVideo', intermediate, '--codec=h264', '--audio-codec=pcm-16', '--frames=0-9', '--props={"textOnly":true}', '--scale=0.5'],
    ]);
    assert.deepEqual(r.ffprobe.map((a) => a[a.length - 1]), [intermediate], 'the intermediate frame rate was not probed');
    assert.equal(r.ffmpeg.length, 1);
    assert.equal(r.ffmpeg[0]![r.ffmpeg[0]!.length - 1], join(outDir, `.partial-${process.pid}.mp4`));
    assert.deepEqual(readdirSync(outDir).sort(), ['draft.mp4', 'music-video.mp4']);
    assert.equal(readFileSync(join(outDir, 'music-video.mp4'), 'utf8'), 'MAIN');
    // --composition passes through like render; reserved flags are refused like render.
    const concept = await draft(root, ['--composition=ConceptA', '--out', 'out/draft-a.mp4']);
    assert.equal(concept.code, 0);
    assert.equal(concept.remotion[0]![2], 'ConceptA');
    assert.equal(concept.remotion[0]!.at(-1), '--scale=0.5');
    for (const flag of ['--codec=h265', '--fps=60', '--output=x.mp4']) {
      const refused = await draft(root, [flag]);
      assert.equal(refused.code, 1, flag);
      assert.deepEqual(refused.remotion, [], flag);
    }
  });

  it('draft stops when the intermediate is not at pipeline fps, before the remux', async () => {
    const root = pipelineRoot();
    const r = await draft(root, [], '60/1');
    assert.equal(r.code, 1);
    assert.equal(r.remotion.length, 1);
    assert.equal(r.ffprobe.length, 1);
    assert.deepEqual(r.ffmpeg, []);
    assert.deepEqual(readdirSync(join(root, 'out')), ['music-video.mp4']);
  });

  it('draft never defaults onto the main output and refuses an --out that is the main output, case-insensitively', async () => {
    const root = pipelineRoot();
    assert.equal(DRAFT_OUTPUT, 'out/draft.mp4');
    assert.equal(parseDraftArgs([], {root}).output, join(root, 'out/draft.mp4'));
    assert.equal(parseDraftArgs(['--composition=Alt'], {root}).output, join(root, 'out/draft.mp4'));
    assert.equal(parseDraftArgs(['--out', 'out/draft-r2.mp4'], {root}).output, join(root, 'out/draft-r2.mp4'));
    for (const out of ['out/music-video.mp4', 'out/Music-Video.mp4', 'OUT/MUSIC-VIDEO.mp4', join(root, 'out/music-video.mp4')]) {
      assert.throws(() => parseDraftArgs(['--out', out], {root}), /is the main video's output/, out);
      const r = await draft(root, [`--out=${out}`]);
      assert.equal(r.code, 1, out);
      assert.deepEqual(r.remotion, [], `${out}: rendered`);
    }
    assert.equal(readFileSync(join(root, 'out/music-video.mp4'), 'utf8'), 'MAIN');
    assert.throws(() => parseDraftArgs(['--scale=1'], {root}), /always renders at --scale=0\.5/);
    assert.throws(() => parseDraftArgs(['--scale', '0.25'], {root}), /always renders at --scale=0\.5/);
  });
});

// ---------------------------------------------------------------------------
// jitter --all-lines
// ---------------------------------------------------------------------------

describe('jitter --all-lines arguments', () => {
  it('parseJitterArgs --all-lines: defaults, overrides, and exclusive with --from/--frames', () => {
    assert.deepEqual(parseJitterArgs(['--all-lines', '--in', 'out/text-only.mp4'], {root: '/r'}), {
      input: '/r/out/text-only.mp4',
      allLines: true,
      crop: null,
      max: null,
      threshold: 225,
      settle: {preset: 'snappy'},
      exitFrames: null,
      exitStagger: null,
      stagger: null,
    });
    const all = parseJitterArgs(['--all-lines', '--in=t.mp4', '--crop=0,0,100,50', '--max=0.5', '--settle=heavy', '--exit-frames', '0', '--exit-stagger=3', '--stagger=4'], {root: '/r'});
    assert.deepEqual([all.crop, all.max, all.settle, all.exitFrames, all.exitStagger, all.stagger], [{x: 0, y: 0, w: 100, h: 50}, 0.5, {preset: 'heavy'}, 0, 3, 4]);
    assert.deepEqual(parseJitterArgs(['--all-lines', '--in=t.mp4', '--settle=20'], {root: '/r'}).settle, {frames: 20});
    const r = {root: '/r'};
    assert.throws(() => parseJitterArgs(['--all-lines', '--from=0'], r), /--from can't be used with --all-lines/);
    assert.throws(() => parseJitterArgs(['--frames=10', '--all-lines'], r), /--frames can't be used with --all-lines/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--all-lines'], r), /--all-lines given twice/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--settle=bouncy'], r), /--settle must be a number of frames or a spring preset/);
    assert.throws(() => parseJitterArgs(['--all-lines', '--exit-frames=1.5'], r), /--exit-frames must be a whole number/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--settle=10'], r), /--settle only applies with --all-lines/);
    assert.throws(() => parseJitterArgs(['--from=0', '--frames=10', '--exit-frames=3'], r), /--exit-frames only applies with --all-lines/);
  });

  it('jitter --all-lines default settle equals springs.ts settleFrames(fps, "snappy")', async () => {
    assert.deepEqual(parseJitterArgs(['--all-lines'], {root: projectRoot}).settle, {preset: 'snappy'});
    for (const fps of [24, 25, 30, 50, 60]) {
      assert.equal(await resolveSettle({preset: 'snappy'}, fps), settleFrames(fps, 'snappy'), `${fps} fps`);
    }
    assert.equal(await resolveSettle({preset: 'snappy'}, 30), 15, 'the snappy spring at 30 fps changed; check MaskedWords and the docs');
    assert.deepEqual([...SPRING_PRESET_NAMES].sort(), Object.keys(SPRING_PRESETS).sort());
    assert.equal(await resolveSettle({preset: 'heavy'}, 30), settleFrames(30, 'heavy'));
    assert.equal(await resolveSettle({frames: 7}, 30), 7);
  });
});

// Lines for the hold-window formula, at 30 fps with settle 15, exit 9 frames 1 apart, reveal stagger 2.
const HOLD_LINES: LyricLine[] = [
  // Words at frames 30, 42, 42: the third reveal is pushed to 44 by the stagger.
  {
    id: 'a-1',
    text: 'one two three',
    start: 1,
    end: 2,
    words: [
      {text: 'one', start: 1, end: 1.4},
      {text: 'two', start: 1.4, end: 1.41},
      {text: 'three', start: 1.41, end: 2},
    ],
  },
  // Words at 90 and 96; the next line's first word at 120 leaves no hold.
  {id: 'b-1', text: 'four five', start: 3, end: 3.5, words: [{text: 'four', start: 3, end: 3.2}, {text: 'five', start: 3.2, end: 3.5}]},
  // No word timing: lineWords estimates 'x' at 4.0 s and 'y' at 4.5 s (frames 120, 135).
  {id: 'c-1', text: 'x y', start: 4, end: 5},
  // The last line: words at 180 and 183, sung end 6.5 s.
  {id: 'd-1', text: 'six seven', start: 6, end: 6.5, words: [{text: 'six', start: 6, end: 6.1}, {text: 'seven', start: 6.1, end: 6.5}]},
];
const HOLD_TIMING = {fps: 30, totalFrames: 300, settle: 15, exitFrames: 9, exitStagger: 1, stagger: 2};

describe('jitter --all-lines hold windows', () => {
  it('jitter --all-lines hold windows follow the MaskedWords formula: stagger-pushed reveal, estimated words, too-short skip, last line', () => {
    const w = holdWindows(HOLD_LINES, lineWords, HOLD_TIMING);
    assert.deepEqual(w, [
      // start = 44 - 2 + 15 = 57; end = (90 - 2) - 9 - 2 * 1 = 77.
      {id: 'a-1', start: 57, end: 77, frames: 20, skip: null},
      // start = 96 - 2 + 15 = 109; end = (120 - 2) - 9 - 1 = 108: no hold.
      {id: 'b-1', start: 109, end: 108, frames: 0, skip: 'hold window 109-108 is shorter than 2 frames'},
      // start = 135 - 2 + 15 = 148; end = (180 - 2) - 9 - 1 = 168.
      {id: 'c-1', start: 148, end: 168, frames: 20, skip: null},
      // start = 183 - 2 + 15 = 196; end = round((6.5 + 1) * 30) = 225.
      {id: 'd-1', start: 196, end: 225, frames: 29, skip: null},
    ]);
    // The last line's end is clamped to the video; a hold that starts after the video is skipped as such.
    assert.equal(holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, totalFrames: 210})[3]!.end, 210);
    assert.equal(holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, totalFrames: 150})[3]!.skip, 'hold starts at frame 196, after the last frame (149)');
    // Exactly 2 frames is measured; 1 is skipped (b-1 with shorter exits).
    assert.deepEqual(holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, exitFrames: 6})[1], {id: 'b-1', start: 109, end: 111, frames: 2, skip: null});
    assert.equal(holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, exitFrames: 7})[1]!.skip, 'hold window 109-110 is shorter than 2 frames');
    // A cut exit (no exit frames, no stagger) holds until E.
    assert.equal(holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, exitFrames: 0, exitStagger: 0})[0]!.end, 88);
  });

  it('jitter --all-lines hold windows are exactly the frames MaskedWords draws every word still', () => {
    /** style="" of each word span of line `id` rendered at `frame`, by word index. */
    const wordStyles = (id: string, frame: number): string[] => {
      const html = renderToString(
        createElement(Thumbnail, {
          component: () => createElement(LyricsContext.Provider, {value: HOLD_LINES}, createElement(MaskedWords, {id})),
          frameToDisplay: frame,
          durationInFrames: 300,
          fps: 30,
          compositionWidth: 400,
          compositionHeight: 200,
        }),
      );
      return [...html.matchAll(/<span data-word="(\d+)" style="([^"]*)"/g)].map((m) => m[2]!);
    };
    const MOVING = /transform|opacity|filter|visibility:hidden/;
    const windows = holdWindows(HOLD_LINES, lineWords, {...HOLD_TIMING, settle: settleFrames(30, 'snappy')});
    for (const w of windows.filter((x) => x.skip === null && x.id !== 'd-1')) {
      const start = w.start!;
      const end = w.end!;
      for (let f = start; f < end; f++) {
        const styles = wordStyles(w.id, f);
        assert.ok(styles.length > 0, `${w.id} frame ${f}: nothing drawn`);
        styles.forEach((s, i) => assert.doesNotMatch(s, MOVING, `${w.id} frame ${f}, word ${i} moves inside the hold`));
      }
      assert.ok(wordStyles(w.id, start - 1).some((s) => /transform/.test(s)), `${w.id}: the last word has settled before frame ${start}`);
      assert.match(wordStyles(w.id, end)[0]!, MOVING, `${w.id}: the first word hasn't started leaving at frame ${end}`);
    }
    // The last line has no exit: still from its settle frame on.
    const last = windows[3]!;
    assert.ok(wordStyles('d-1', last.start! - 1).some((s) => /transform/.test(s)));
    for (const f of [last.start!, last.end! - 1]) wordStyles('d-1', f).forEach((s) => assert.doesNotMatch(s, MOVING));
  });
});

describe('jitter --all-lines on a text-only clip', {skip: realSkip}, () => {
  // 320x180 black, 6 s. Each line is a white block, drawn from its first reveal until it must be gone:
  // a-1 frames 15-72 (still), b-1 frames 75-132 (sliding 1 px per frame), c-1 frames 135-169 (still;
  // the window runs to frame 180, so its last frames are blank).
  const lyrics = [
    {id: 'a-1', text: 'one two three', start: 0.5, end: 1, words: [{text: 'one', start: 0.5, end: 0.6}, {text: 'two', start: 0.6, end: 0.7}, {text: 'three', start: 0.7, end: 1}]},
    {id: 'b-1', text: 'four five six', start: 2.5, end: 3, words: [{text: 'four', start: 2.5, end: 2.52}, {text: 'five', start: 2.52, end: 2.6}, {text: 'six', start: 2.6, end: 3}]},
    {id: 'c-1', text: 'seven eight', start: 4.5, end: 5, words: [{text: 'seven', start: 4.5, end: 4.6}, {text: 'eight', start: 4.6, end: 5}]},
  ];
  let input = '';
  before(() => {
    input = clip(
      'text-only',
      '320x180',
      6,
      '255*(between(N,15,72)*between(X,40,79)*between(Y,40,59)+between(N,75,132)*between(X,N+45,N+84)*between(Y,80,99)+between(N,135,169)*between(X,200,239)*between(Y,120,139))',
    );
  });
  const root = () => projectFixture({lyrics});

  it('jitter --all-lines reports only the line that moves during its hold, and --max fails on it', async () => {
    const tmpRoot = freshDir('tmp');
    const cleanup = new Set<() => void>();
    const [result, output] = await captured(() => jitterAllLines({input, crop: null, max: null, root: root(), tmpRoot, pythonBin: venvPython}, cleanup));
    for (const fn of cleanup) fn();
    assert.deepEqual(readdirSync(tmpRoot), []);
    assert.equal(result.settle, settleFrames(30, 'snappy'));
    // a-1: reveals 15, 18, 21 -> 34..61; b-1: reveals 75, 77 (pushed), 79 -> 92..121; c-1: 151..169, blank from 170.
    assert.deepEqual(
      result.lines.map((l) => [l.id, l.start, l.measuredEnd, l.note]),
      [
        ['a-1', 34, 62, null],
        ['b-1', 92, 122, null],
        ['c-1', 151, 170, 'blank from frame 170'],
      ],
    );
    const [a, b, c] = result.lines as {mean: number; max: number}[];
    assert.ok(a!.max < 0.001 && c!.max < 0.001, `still lines moved: ${a!.max}, ${c!.max}`);
    assert.ok(Math.abs(b!.mean - 1) < 0.05 && Math.abs(b!.max - 1) < 0.05, `b-1: mean ${b!.mean} max ${b!.max}`);
    assert.deepEqual(result.moving, ['b-1']);
    assert.deepEqual(result.skipped, []);
    assert.match(output, /lines with motion during hold: 1 /);

    const code = async (max: string) => {
      const t = freshDir('tmp');
      const [c2, out] = await captured(() => jitterMain(['--all-lines', '--in', input, `--max=${max}`], {root: root(), tmpRoot: t, pythonBin: venvPython}));
      assert.deepEqual(readdirSync(t), []);
      return [c2, out] as const;
    };
    const [over, overOut] = await code('0.5');
    assert.equal(over, 1);
    assert.match(overOut, /1 line\(s\) moved more than --max 0\.5 px in one frame during the hold: b-1/);
    assert.equal((await code('1.5'))[0], 0);
  });

  it('jitter --all-lines skips and lists windows that start blank or are too short', async () => {
    // Settle 34, exits of 18 frames: a-1 holds from 21 - 2 + 34 = 53 to (75 - 2) - 18 - 2 = 53 (no hold);
    // b-1 from 111 to 113; c-1 from 138 - 2 + 34 = 170, after its block is gone (frame 169).
    const [result, output] = await captured(() =>
      jitterAllLines({input, crop: null, max: null, settle: {frames: 34}, exitFrames: 18, root: root(), tmpRoot: freshDir('tmp'), pythonBin: venvPython}, new Set()),
    );
    assert.deepEqual(result.lines.map((l) => [l.id, l.start, l.measuredEnd]), [['b-1', 111, 113]]);
    assert.deepEqual(result.skipped.map((s: {id: string}) => s.id), ['a-1', 'c-1']);
    assert.match(output, /skipped a-1: hold window 53-53 is shorter than 2 frames/);
    assert.match(output, /skipped c-1: blank at the start of its hold \(frame 170\)/);
  });

  it('jitter --all-lines without a text-only render names the command to make one', async () => {
    const [code, output] = await captured(() => jitterMain(['--all-lines', '--in', join(scratch, 'missing.mp4')], {root: root(), tmpRoot: freshDir('tmp'), pythonBin: venvPython}));
    assert.equal(code, 1);
    assert.match(output, /pnpm render --props='\{"textOnly":true\}' --out out\/text-only\.mp4/);
  });
});

describe('jitter on a render.mjs-remuxed clip', {skip: realSkip}, () => {
  // 160x96, 4 s, made like a render (renderedClip). Lower half: the frame index as stripes.
  // Upper left: a block that slides 1 px per frame until frame 34, then holds.
  // Upper right: a block that holds, except one 1 px step between frames 60 and 61.
  const LUM =
    `if(gte(Y,48),${INDEX_STRIPES},` +
    '255*between(Y,10,29)*(between(X,10+min(N,34),29+min(N,34))+between(X,100+gte(N,61),119+gte(N,61))))';
  let input = '';
  before(async () => {
    input = await renderedClip('jitter-rendered', '160x96', 4, LUM);
  });
  /** Indices of the frames decodeGray returns from `startFrame`, read from the stripes. */
  const decodedIndices = async (startFrame: number, frames: number) => {
    const out = join(freshDir('decode'), 'frames.gray');
    await silenceAll(() => decodeGray({input, fps: 30, startTime: 0, startFrame, frames, area: {x: 0, y: 0, w: 160, h: 96}, out}));
    const data = readFileSync(out);
    assert.equal(data.length, frames * 160 * 96);
    return Array.from({length: frames}, (_, i) => {
      let index = 0;
      for (let b = 0; b < 8; b++) if (data[i * 160 * 96 + 72 * 160 + Math.floor((b + 0.5) * 20)]! > 128) index += 2 ** b;
      return index;
    });
  };
  const silenceAll = <T>(fn: () => Promise<T>) => captured(fn).then(([v]) => v);
  const lyrics = [
    // Reveals 15, 18, 21: holds from 21 - 2 + 15 = 34 to (75 - 2) - 9 - 2 = 62.
    {id: 'a-1', text: 'one two three', start: 0.5, end: 1, words: [{text: 'one', start: 0.5, end: 0.6}, {text: 'two', start: 0.6, end: 0.7}, {text: 'three', start: 0.7, end: 1}]},
    // Reveals 75, 77, 79: holds from 92 to the end of the clip (3 s + 1 s = frame 120).
    {id: 'b-1', text: 'four five six', start: 2.5, end: 3, words: [{text: 'four', start: 2.5, end: 2.52}, {text: 'five', start: 2.52, end: 2.6}, {text: 'six', start: 2.6, end: 3}]},
  ];

  it("jitter --all-lines decodes exactly the window's frames on a render.mjs-remuxed clip", async () => {
    // The shared decode, at the starts a plain half-frame seek got wrong (it returned n - 1).
    for (const start of [0, 1, 4, 34, 61, 92]) {
      assert.deepEqual(await decodedIndices(start, 3), [start, start + 1, start + 2], `window from frame ${start}`);
    }
    // End to end: a-1's hold starts on the slide's last frame (34). Decoding from 33 would add the
    // 33 -> 34 slide as the first pair and report a-1 as moving.
    const [result] = await captured(() =>
      jitterAllLines({input, crop: {x: 0, y: 0, w: 80, h: 48}, max: 0.5, root: projectFixture({lyrics}), tmpRoot: freshDir('tmp'), pythonBin: venvPython}, new Set()),
    );
    assert.deepEqual(result.lines.map((l) => [l.id, l.start, l.measuredEnd, l.pairs[0]!.from]), [
      ['a-1', 34, 62, 34],
      ['b-1', 92, 120, 92],
    ]);
    for (const l of result.lines) assert.ok(l.max < 0.05, `${l.id}: max shift ${l.max} during a still hold`);
    assert.deepEqual(result.moving, []);
  });

  it('jitter --from/--frames decodes exactly the requested frames on a render.mjs-remuxed clip', async () => {
    const measure = async (from: {frame: number} | {seconds: number}) => {
      const cleanup = new Set<() => void>();
      const [r] = await captured(() =>
        jitter({input, from, frames: 2, crop: {x: 80, y: 0, w: 80, h: 48}, max: null, root: projectRoot, tmpRoot: freshDir('tmp'), pythonBin: venvPython}, cleanup),
      );
      for (const fn of cleanup) fn();
      return r.pairs[0]!.shift as number;
    };
    // The step is between 60 and 61: only the pair 60 -> 61 moves.
    assert.ok(Math.abs((await measure({frame: 60})) - 1) < 0.1, '60 -> 61 holds the step');
    assert.ok((await measure({frame: 61})) < 0.05, '61 -> 62 must be still (a seek landing on 60 sees the step)');
    assert.ok((await measure({frame: 59})) < 0.05, '59 -> 60 must be still');
    assert.ok((await measure({seconds: 61 / 30})) < 0.05, 'seconds resolve to the same exact frame');
    for (const start of [1, 4, 61]) {
      const indices = await decodedIndices(start, 2);
      assert.deepEqual(indices, [start, start + 1], `--from ${start}`);
    }
  });
});

describe('QA scripts under plain node', () => {
  it('QA scripts load src/lib and springs.ts under plain node (type stripping, no tsx)', () => {
    const root = projectFixture({
      lyrics: [{id: 'v-1', text: 'x y', start: 1, end: 2}],
      sections: [{id: 'verse-1', scene: 'verse', start: 0}],
      analysis: {
        version: 1, source: 'audio/track.wav', generator: 'test', fps: 30, durationSeconds: 4, durationInFrames: 120,
        tempo: 120, beatsPerBar: 4, beats: [0, 0.5], downbeats: [0], onsets: [],
        bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]}, energy: {low: [], mid: [], high: []},
      },
    });
    const url = (f: string) => JSON.stringify(pathToFileURL(join(projectRoot, f)).href);
    const script = `
const qa = await import(${url('scripts/lib/qa.mjs')});
const {resolveSettle} = await import(${url('scripts/jitter.mjs')});
await import(${url('scripts/critique.mjs')});
await import(${url('scripts/beatmap.mjs')});
const root = ${JSON.stringify(root)};
const [lyrics, sections, analysis] = await Promise.all([qa.readLyrics(root), qa.readSections(root), qa.readAnalysis(root)]);
const lineWords = await qa.loadLineWords();
console.log(JSON.stringify({
  lyrics: lyrics.length, sections: sections.length, tempo: analysis.tempo,
  words: lineWords(lyrics[0]).map((w) => w.start), settle: await resolveSettle({preset: 'snappy'}, 30),
}));`;
    // A fresh node: no --import tsx (spawn doesn't inherit execArgv) and no NODE_OPTIONS.
    const env = {...process.env};
    delete env.NODE_OPTIONS;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {env, encoding: 'utf8'});
    assert.equal(res.status, 0, `plain node failed:\n${res.stderr}`);
    assert.deepEqual(JSON.parse(res.stdout.trim().split('\n').at(-1)!), {lyrics: 1, sections: 1, tempo: 120, words: [1, 1.5], settle: 15});
  });
});
