// Helpers for the QA script tests (tests/qa-*.test.mjs and
// tests/render/qa-*.test.mjs): synthetic clips made by ffmpeg whose frames
// encode what a script must find (their own frame index as stripes, a flash,
// a pop, a cut, a block that moves during its hold), PNG decoding, the time
// code of tests/fixtures/scenes/timecode.js read back from any region of an
// image, and file listings.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {chunkEncoderArgs, concatArgs, concatList, muxArgs} from '../../scripts/lib/encode.mjs';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';
import {TIMECODE} from './scenes/timecode.js';

export const hasFfmpeg = ['ffmpeg', 'ffprobe'].every((bin) => spawnSync(bin, ['-version'], {stdio: 'ignore'}).status === 0);

/** Why the ffmpeg + numpy measurement tests can't run here, or null. */
export const measureEnvMissing = () => {
  if (!hasFfmpeg) return 'ffmpeg/ffprobe not on PATH';
  if (!existsSync(venvPython(PROJECT_ROOT))) return 'no .venv: run pnpm setup:env';
  return null;
};

/** The lower half of a frame shows its index as 8 vertical stripes (bit b white when set). */
export const INDEX_STRIPES = '255*bitand(N,pow(2,floor(X*8/W)))/pow(2,floor(X*8/W))';

/**
 * A synthetic clip in `dir`: 30 fps gray frames drawn by a geq luma expression
 * (N = frame index), x264 lossless (qp 0), so only what the expression draws differs.
 */
export const clip = (dir, name, size, seconds, lum, pixFmt = 'yuv420p') => {
  const file = join(dir, `${name}.mp4`);
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

/** An RGB image decoded from a PNG by ffmpeg: {width, height, px(x, y) -> [r, g, b]}. */
export const decodePng = (file) => {
  const png = readFileSync(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const res = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 1 << 28});
  assert.equal(res.status, 0, String(res.stderr));
  const data = res.stdout;
  assert.equal(data.length, width * height * 3);
  return {width, height, px: (x, y) => [data[(y * width + x) * 3], data[(y * width + x) * 3 + 1], data[(y * width + x) * 3 + 2]]};
};

/**
 * The time code (Math.round(t * fps * 4)) drawn by tests/fixtures/scenes/timecode.js,
 * read from the w x h region at (ox, oy) of `px(x, y) -> [r, g, b]` that shows a
 * whole frame (a contact-sheet tile, or a frame). Each bit is the mean of a
 * small square at its block's centre, as tests/fixtures/scenes/timecode_decode.py reads it.
 */
export const readTimecode = (px, ox, oy, w, h) => {
  const s = w * TIMECODE.strideOfWidth;
  const x0 = TIMECODE.x0Strides * s;
  const y0 = TIMECODE.y0OfHeight * h;
  const half = Math.max(1, Math.floor((s * 0.3) / 2));
  let value = 0;
  for (let k = 0; k < TIMECODE.bits; k++) {
    const col = k % TIMECODE.cols;
    const row = Math.floor(k / TIMECODE.cols);
    const cx = Math.round(x0 + (col + 0.5) * s);
    const cy = Math.round(y0 + (row + 0.5) * s);
    let sum = 0;
    let n = 0;
    for (let y = cy - half; y < cy + half; y++) {
      for (let x = cx - half; x < cx + half; x++) {
        const [r, g, b] = px(ox + x, oy + y);
        sum += (r + g + b) / 3;
        n++;
      }
    }
    if (sum / n > 127) value |= 1 << k;
  }
  return value;
};

/** Every file under `dir`, relative to it, sorted. */
export const listFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, {recursive: true, withFileTypes: true})
        .filter((e) => e.isFile())
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .sort()
    : [];

/**
 * A clip made the way `pnpm render` makes one, without a browser: rgb24
 * frames drawn by `lum(x, y, n)` (0..255 gray) are encoded in chunks by the
 * render's own ffmpeg argv (scripts/lib/encode.mjs chunkEncoderArgs: x264 with
 * B-frames, BT.709 TV range, an fps timescale), concatenated and muxed by its
 * concat and mux steps (no audio). Returns the MP4's path.
 * @param {string} dir
 * @param {string} name
 * @param {{width: number, height: number, frames: number, chunks?: number[], lum: (x: number, y: number, n: number) => number}} o
 *   chunks: the first frame of every chunk after the first.
 */
export const renderLikeClip = (dir, name, {width, height, frames, chunks = [], lum}) => {
  const starts = [0, ...chunks];
  const parts = starts.map((a, i) => {
    const b = starts[i + 1] ?? frames;
    const rgb = Buffer.alloc((b - a) * width * height * 3);
    for (let n = a; n < b; n++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const v = lum(x, y, n);
          const o = (((n - a) * height + y) * width + x) * 3;
          rgb[o] = rgb[o + 1] = rgb[o + 2] = v;
        }
      }
    }
    const out = join(dir, `${name}-chunk${i}.mp4`);
    const res = spawnSync('ffmpeg', chunkEncoderArgs({width, height, fps: 30, preset: 'medium', crf: 18, out}), {input: rgb, maxBuffer: 1 << 28});
    assert.equal(res.status, 0, `encoding ${name} chunk ${i}: ${res.stderr}`);
    return out;
  });
  const list = join(dir, `${name}-chunks.txt`);
  writeFileSync(list, concatList(parts));
  const joined = join(dir, `${name}-video.mp4`);
  let res = spawnSync('ffmpeg', concatArgs(list, 30, joined));
  assert.equal(res.status, 0, `concat ${name}: ${res.stderr}`);
  const out = join(dir, `${name}.mp4`);
  res = spawnSync('ffmpeg', muxArgs({video: joined, audio: null, audioBitrate: '256k', fps: 30, out}));
  assert.equal(res.status, 0, `mux ${name}: ${res.stderr}`);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=has_b_frames', '-of', 'default=nw=1:nk=1', out]);
  assert.ok(Number(String(probe.stdout).trim()) > 0, `${name}: the clip has no B-frames, so it can't stand in for a render`);
  return out;
};

/** The frame index drawn by INDEX_STRIPES in the lower half of `gray` (one w x h gray frame), read on row y. */
export const readStripes = (gray, w, y) => {
  let index = 0;
  for (let b = 0; b < 8; b++) if (gray[y * w + Math.floor(((b + 0.5) * w) / 8)] > 128) index += 2 ** b;
  return index;
};
