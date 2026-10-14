// pipeline.json tailSeconds end to end: a 2 s stereo 44.1 kHz noise-and-tone
// track that runs to its last sample, with a 1 s tail, renders through `pnpm
// render` to 90 frames (the page, the chunks and the mux agree); the muxed
// audio keeps the source's rate and channels, is sample-identical to today's
// unpadded mux of the same source up to 2048 samples before the end and
// within 0.05 over those last 2048 (AAC's final MDCT frames), sits at lag 0
// against the source, and is digital silence from 2048 samples after the end
// (AAC ringing before that is bounded too); the audio stream lasts as long as
// the video within one frame, and the scene draws every tail frame.
// Partial ranges into the tail pad the same way. On the page, the last
// section covers the tail and lyric schedules are those without a tail.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {muxArgs} from '../../scripts/lib/encode.mjs';
import {loadProject} from '../../scripts/lib/project.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';
import {frameProbe, lagAt, RATE as LAG_RATE} from '../fixtures/render-real.mjs';

const missing = captureEnvMissing();
const FPS = 30;
const SECONDS = 2;
const TAIL = 1;
const FRAMES = (SECONDS + TAIL) * FPS; // 90
const AUDIO_FRAMES = SECONDS * FPS; // 60
/** Times (seconds) where the lag against the source is measured; also the analysis onsets. */
const CLICKS = [0.5123, 1.3377, 1.7311];
const SCENES = 'tests/fixtures/render-tail-scenes.js';
/** The source: not the render's 48 kHz mono, so a resample or a channel change shows. */
const RATE = 44_100;
const CHANNELS = 2;
/** AAC frames overlap (MDCT): the last 2048 samples before the end of the source may differ once silence follows. */
const AAC_OVERLAP = 2048;
/** Bound on the difference over those last 2048 samples, and on AAC's ringing over the first 2048 after the end. */
const EDGE_BOUND = 0.05;

/**
 * Interleaved stereo int16-exact float samples `seconds` long at RATE: seeded white noise plus a different tone per
 * channel, full scale up to the very last sample (nothing silent near the end to hide a change there).
 */
const noiseTrack = (seconds) => {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n * CHANNELS);
  let x = 0x9e3779b9;
  const next = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < CHANNELS; c++) {
      const v = 0.4 * next() + 0.3 * Math.sin((2 * Math.PI * (c === 0 ? 440 : 660) * i) / RATE);
      out[i * CHANNELS + c] = Math.round(v * 32767) / 32768;
    }
  }
  return out;
};

/** Write interleaved float samples as a 16-bit PCM WAV at RATE with CHANNELS. */
const writeWav = (file, samples) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(CHANNELS, 22);
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * CHANNELS * 2, 28);
  h.writeUInt16LE(CHANNELS * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  mkdirSync(join(file, '..'), {recursive: true});
  writeFileSync(file, Buffer.concat([h, data]));
};

/** One channel of interleaved samples. */
const channel = (samples, c) => samples.filter((_, i) => i % CHANNELS === c);

const analysis = {
  version: 1,
  source: 'audio/track.wav',
  generator: 'test',
  fps: FPS,
  durationSeconds: SECONDS,
  durationInFrames: SECONDS * FPS,
  tempo: 120,
  beatsPerBar: 4,
  beats: [],
  downbeats: [],
  onsets: CLICKS,
  bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
  energy: {low: [], mid: [], high: []},
};
const lyrics = [line('t-1', 'closing words', 1.0, 1.6)];

/** Decode the first audio stream at its own rate and channel count (no -ar / -ac: nothing resampled or mixed). */
const decodeNative = (file) => {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-'], {maxBuffer: 1 << 30});
  return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
};
const streams = (file) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration,sample_rate,channels,nb_frames', '-of', 'json', file], {encoding: 'utf8'})).streams;
const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('render with a tail', {skip: missing ?? false}, () => {
  let proj;
  let flat;
  let source;
  before(() => {
    const common = {
      analysis,
      lyrics,
      sections: [{id: 'end', scene: 'closer', start: 0}],
      files: {[SCENES]: readFileSync(join(PROJECT_ROOT, SCENES), 'utf8')},
    };
    proj = makeProject({...common, pipeline: {tailSeconds: TAIL, render: {scale: 0.5, chunkSeconds: 1}}});
    flat = makeProject({...common, pipeline: {render: {scale: 0.5, chunkSeconds: 1}}});
    source = noiseTrack(SECONDS);
    for (const p of [proj, flat]) writeWav(join(p.root, 'public/audio/track.wav'), source);
  });
  after(() => {
    proj?.cleanup();
    flat?.cleanup();
  });

  const render = (argv) => quiet(() => renderMain([`--scenes=${SCENES}`, '--pool=2', ...argv], {root: proj.root, envRoot: PROJECT_ROOT}));

  it('tail-frame-count + tail-audio-untouched + tail-av-durations-match: a full render has ceil((2 + 1) * 30) frames, the source audio untouched, silence after it, and A/V durations within a frame', {timeout: 240_000}, async (t) => {
    const {project} = loadProject(proj.root);
    assert.deepEqual([project.frames, project.audioFrames], [FRAMES, AUDIO_FRAMES]);
    const out = join(proj.root, 'out/tail.mp4');
    const {result, output} = await render(['--out', out]);
    assert.equal(result, 0, output.join('\n'));

    // The page, the chunks and the file agree on one frame count.
    const manifest = JSON.parse(readFileSync(join(proj.root, 'out/tail.manifest.json'), 'utf8'));
    assert.equal(manifest.frames, FRAMES);
    const s = streams(out);
    const v = s.find((x) => x.codec_type === 'video');
    const a = s.find((x) => x.codec_type === 'audio');
    assert.equal(Number(v.nb_frames), FRAMES);

    // tail-av-durations-match: audio stream duration = video duration within one frame.
    t.diagnostic(`video ${v.duration} s, audio ${a.duration} s`);
    assert.ok(Math.abs(Number(a.duration) - Number(v.duration)) <= 1 / FPS, `audio ${a.duration} s vs video ${v.duration} s`);
    const got = decodeNative(out);
    assert.equal(Number(a.sample_rate), RATE, 'no resampling: the source rate (44.1 kHz, not the render default)');
    assert.equal(Number(a.channels), CHANNELS, 'no channel change: stereo stays stereo');
    const frames = got.length / CHANNELS;
    assert.ok(Math.abs(frames / RATE - FRAMES / FPS) <= 1 / FPS, `decoded ${frames / RATE} s for a ${FRAMES / FPS} s video`);

    // tail-audio-untouched: up to 2048 samples before the end of the source the decode is sample-identical to
    // today's mux of the same source (no tail, no filter, same encoder and bitrate): no gain change, no shift.
    const ref = join(proj.root, 'out/reference.mp4');
    execFileSync('ffmpeg', muxArgs({video: out, audio: join(proj.root, 'public/audio/track.wav'), audioBitrate: '256k', fps: FPS, out: ref, durationSeconds: SECONDS}));
    const want = decodeNative(ref);
    const end = SECONDS * RATE * CHANNELS; // interleaved index of the first sample after the source
    const head = end - AAC_OVERLAP * CHANNELS;
    assert.ok(want.length >= end, 'the reference covers the whole source');
    let firstDiff = -1;
    for (let i = 0; i < head && firstDiff < 0; i++) if (got[i] !== want[i]) firstDiff = i;
    assert.equal(firstDiff, -1, `the head differs from the untailed mux at sample ${firstDiff / CHANNELS} (channel ${firstDiff % CHANNELS})`);
    // The last 2048 samples of the source, where AAC's final frames overlap what follows: within EDGE_BOUND.
    let edge = 0;
    for (let i = head; i < end; i++) edge = Math.max(edge, Math.abs(got[i] - want[i]));
    t.diagnostic(`last ${AAC_OVERLAP} samples: max |padded - unpadded| ${edge}`);
    assert.ok(edge <= EDGE_BOUND, `the last ${AAC_OVERLAP} samples differ by ${edge}`);
    // And it is the source in place: lag 0 at each probe time on both channels (cross-correlation, as render-av-sync does).
    const lags = [0, 1].flatMap((c) => CLICKS.map((at) => lagAt(channel(source, c), channel(got, c), Math.round(at * RATE))));
    // lagAt reports seconds at its own 48 kHz; at 44.1 kHz only 0 matters here.
    t.diagnostic(`lags (samples): ${lags.map((l) => Math.round(l * LAG_RATE)).join(', ')}`);
    lags.forEach((lag) => assert.equal(lag, 0, `off by ${Math.round(lag * LAG_RATE)} samples`));
    // The tail: AAC's ringing right after the end is bounded, and from 2048 samples on it is digital silence.
    const ring = got.subarray(end, end + AAC_OVERLAP * CHANNELS);
    const tail = got.subarray(end + AAC_OVERLAP * CHANNELS);
    t.diagnostic(`ringing over the first ${AAC_OVERLAP} tail samples: max |x| ${maxAbs(ring)}; tail after: ${tail.length / CHANNELS} samples, max |x| ${maxAbs(tail)}`);
    assert.ok(maxAbs(ring) <= EDGE_BOUND, `ringing after the end reaches ${maxAbs(ring)}`);
    assert.ok(tail.length / CHANNELS >= TAIL * RATE - 2 * AAC_OVERLAP);
    assert.equal(maxAbs(tail), 0, 'the tail is digital silence');

    // tail-sections-cover-video: the scene drew every frame after the end of the audio (white from audioEnd on).
    const {luma} = frameProbe('luma', out);
    assert.equal(luma.length, FRAMES);
    const lit = luma.map((y, n) => [n, y]).filter(([, y]) => y > 128).map(([n]) => n);
    assert.deepEqual(lit, Array.from({length: FRAMES - AUDIO_FRAMES}, (_, k) => AUDIO_FRAMES + k), 'the tail frames, and only they, are white');
  });

  it('tail-av-durations-match: partial renders that reach the tail pad silence to their own length; one inside the audio is unpadded', {timeout: 240_000}, async (t) => {
    // Straddling the end of the audio: 1.5 s .. 3 s.
    const straddle = join(proj.root, 'out/straddle.mp4');
    let r = await render(['--out', straddle, '--frames=45-89']);
    assert.equal(r.result, 0, r.output.join('\n'));
    let s = streams(straddle);
    let v = s.find((x) => x.codec_type === 'video');
    let a = s.find((x) => x.codec_type === 'audio');
    t.diagnostic(`straddle: video ${v.duration} s, audio ${a.duration} s`);
    assert.ok(Math.abs(Number(a.duration) - Number(v.duration)) <= 1 / FPS);
    const got = decodeNative(straddle);
    const offset = 45 / FPS;
    const left = channel(got, 0);
    const lag = lagAt(channel(source, 0).subarray(Math.round(offset * RATE)), left, Math.round((CLICKS[2] - offset) * RATE));
    assert.equal(lag, 0, `off by ${Math.round(lag * LAG_RATE)} samples at ${CLICKS[2]}s`);
    assert.equal(maxAbs(got.subarray((Math.round((SECONDS - offset) * RATE) + AAC_OVERLAP) * CHANNELS)), 0, 'silence after the source');

    // Entirely in the tail: 2.333 s .. 3 s, all silence, still as long as the video.
    const inTail = join(proj.root, 'out/in-tail.mp4');
    r = await render(['--out', inTail, '--frames=70-89']);
    assert.equal(r.result, 0, r.output.join('\n'));
    s = streams(inTail);
    v = s.find((x) => x.codec_type === 'video');
    a = s.find((x) => x.codec_type === 'audio');
    t.diagnostic(`in tail: video ${v.duration} s, audio ${a.duration} s`);
    assert.equal(Number(v.nb_frames), 20);
    assert.ok(Math.abs(Number(a.duration) - Number(v.duration)) <= 1 / FPS);
    assert.equal(maxAbs(decodeNative(inTail)), 0);
  });

  it('tail-sections-cover-video: on the page the last section is drawn through the tail, ctx and __mv expose the audio end, and lyric schedules equal the no-tail page', {timeout: 120_000}, async () => {
    const js =
      "[[...document.querySelectorAll('#world .scene')].filter((e) => e.style.display !== 'none').map((e) => e.dataset.section), " +
      'window.__mv.frames, window.__mv.audioFrames, window.__mv.audioEnd, window.__mv.duration, ' +
      "{...document.querySelector('#world .scene').dataset}]";
    const times = [0, 1.9, 2, 2.5, (FRAMES - 1) / FPS].join(',');
    const withTail = await probe('evalat', {root: proj.root, scenes: SCENES, times, js});
    const without = await probe('evalat', {root: flat.root, scenes: SCENES, times: '0', js});
    for (const [visible, frames, audioFrames, audioEnd, duration, data] of withTail.values) {
      assert.deepEqual(visible, ['end'], 'the last section is on screen at every time, the tail included');
      assert.deepEqual([frames, audioFrames, audioEnd, duration], [FRAMES, AUDIO_FRAMES, SECONDS, FRAMES / FPS]);
      assert.deepEqual(data, {section: 'end', audioEnd: '2', audioFrames: '60', duration: '3', frames: '90'}, 'ctx.audioEnd / audioFrames / duration / frames');
    }
    assert.deepEqual(without.values[0].slice(1, 5), [AUDIO_FRAMES, AUDIO_FRAMES, SECONDS, SECONDS], 'no tail: the audio end is the video end');
    assert.deepEqual(withTail.lines, without.lines, 'a held line exits by the end of the audio, exactly as without a tail');
    assert.ok(withTail.lines[0].exitEnd <= SECONDS + 1e-9);
  });
});
