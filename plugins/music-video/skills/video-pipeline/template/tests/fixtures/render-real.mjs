// Helpers for the real render tests (tests/render/render-*.test.mjs): a
// synthetic click track, audio decoding and lag measurement, ffprobe of the
// frame timestamps, and the frame probes in render-probe.py.
import {execFileSync, spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';

export const RATE = 48_000;

/** A short windowed chirp (2 ms, 1 kHz to 8 kHz): sharp, but survives AAC. */
const click = () => {
  const n = Math.round(0.002 * RATE);
  return Array.from({length: n}, (_, i) => {
    const t = i / RATE;
    const f = 1000 + (7000 * i) / n;
    return 0.8 * Math.sin(2 * Math.PI * f * t) * Math.sin((Math.PI * i) / n) ** 2;
  });
};

/**
 * Mono samples `seconds` long at RATE with a click starting at each time in `clicks` (rounded to a sample).
 * @returns {Float32Array}
 */
export const clickTrack = (seconds, clicks) => {
  const s = new Float32Array(Math.round(seconds * RATE));
  const c = click();
  for (const t of clicks) {
    const at = Math.round(t * RATE);
    c.forEach((v, i) => (s[at + i] += v));
  }
  return s;
};

/** Write mono float samples as a 16-bit PCM WAV at RATE. */
export const writeWav = (file, samples) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
};

/** The first audio stream of `file`, decoded (edit list honoured, the ffmpeg default) to mono float at RATE. */
export const decodeAudio = (file) => {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  });
  return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
};

/**
 * The lag (seconds) of `got` against `ref` around sample `at`: the shift in [-maxLag, maxLag] samples that
 * maximises the cross-correlation over a window of +-`half` samples. Positive = `got` is late. The default
 * reach (4096 samples, 85 ms) covers AAC priming (1024 or 2048 samples) so a priming bug reports its true lag.
 */
export const lagAt = (ref, got, at, {half = 2400, maxLag = 4096} = {}) => {
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let score = 0;
    for (let i = at - half; i < at + half; i++) {
      const j = i + lag;
      if (i >= 0 && i < ref.length && j >= 0 && j < got.length) score += ref[i] * got[j];
    }
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return best / RATE;
};

/** ffprobe of the video stream: stream fields and every frame's pts and duration (in time-base units). */
export const probeTimeline = (file) => {
  const s = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,avg_frame_rate,time_base,start_time,nb_frames,width,height,profile,level,pix_fmt,color_range,color_space,color_primaries,color_transfer:frame=pts,duration', '-of', 'json', file], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    }),
  );
  return {stream: s.streams[0], frames: s.frames};
};

/** Run tests/fixtures/render-probe.py and parse its JSON line. */
export const frameProbe = (command, file) => {
  const r = spawnSync(venvPython(PROJECT_ROOT), [join(PROJECT_ROOT, 'tests/fixtures/render-probe.py'), command, file], {encoding: 'utf8', maxBuffer: 1 << 26});
  if (r.status !== 0) throw new Error(`render-probe ${command} exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};
