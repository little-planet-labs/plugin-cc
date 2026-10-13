// A/V sync end to end: a project with a synthetic 48 kHz click track (clicks
// at times that aren't frame-aligned) renders through `pnpm render`; the
// muxed audio, decoded with its edit list, lines up with the source WAV to
// under 1 ms at every click; the video is constant frame rate at pipeline fps,
// starts at 0 and has project.js's frame count; a flash drawn on the frame
// nearest each click lands on frame round(click * fps). A partial range
// (--frames) carries the matching span of audio, and `pnpm preview` (AAC
// decoded and encoded again) stays under 1 ms too.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {loadProject} from '../../scripts/lib/project.mjs';
import {main as previewMain} from '../../scripts/preview.mjs';
import {main as renderMain} from '../../scripts/render.mjs';
import {quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, makeProject} from '../fixtures/engine-project.mjs';
import {clickTrack, decodeAudio, frameProbe, lagAt, probeTimeline, RATE, writeWav} from '../fixtures/render-real.mjs';

const missing = captureEnvMissing();
const FPS = 30;
const SECONDS = 4;
const CLICKS = [0.5123, 1.3377, 2.2049, 3.1011];

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

describe('render A/V sync', {skip: missing ?? false}, () => {
  let proj;
  let source;
  const ms = (s) => `${(s * 1000).toFixed(3)} ms`;
  before(() => {
    proj = makeProject({
      analysis,
      pipeline: {render: {scale: 0.5, chunkSeconds: 1}},
      sections: [{id: 's1', scene: 'flash', start: 0}],
      files: {'tests/fixtures/render-scenes.js': readFileSync(join(PROJECT_ROOT, 'tests/fixtures/render-scenes.js'), 'utf8')},
    });
    mkdirSync(join(proj.root, 'public/audio'), {recursive: true});
    source = clickTrack(SECONDS, CLICKS);
    writeWav(join(proj.root, 'public/audio/track.wav'), source);
  });
  after(() => proj?.cleanup());

  const render = (argv) => quiet(() => renderMain(['--scenes=tests/fixtures/render-scenes.js', '--pool=2', ...argv], {root: proj.root, envRoot: PROJECT_ROOT}));

  it('full render: audio within 1 ms of the source at every click; CFR at pipeline fps from 0 with project.js frames; flashes on round(click * fps)', {timeout: 240_000}, async (t) => {
    const out = join(proj.root, 'out/av.mp4');
    const {result, output} = await render(['--out', out]);
    assert.equal(result, 0, output.join('\n'));
    const {project} = loadProject(proj.root);
    assert.equal(project.audio, 'audio/track.wav');

    const got = decodeAudio(out);
    const lags = CLICKS.map((c) => lagAt(source, got, Math.round(c * RATE)));
    t.diagnostic(`lags: ${lags.map(ms).join(', ')}`);
    lags.forEach((lag, i) => assert.ok(Math.abs(lag) < 0.001, `click at ${CLICKS[i]}s is off by ${ms(lag)}`));

    const {stream, frames} = probeTimeline(out);
    assert.equal(stream.r_frame_rate, `${FPS}/1`);
    assert.equal(stream.avg_frame_rate, `${FPS}/1`);
    assert.equal(Number(stream.start_time), 0);
    assert.equal(Number(stream.nb_frames), project.frames);
    assert.equal(frames.length, project.frames);
    const [num, den] = stream.time_base.split('/').map(Number);
    const tick = den / num / FPS; // one frame in time-base units
    assert.ok(Number.isInteger(tick), `time base ${stream.time_base} holds whole frames`);
    const pts = frames.map((f) => Number(f.pts)).sort((a, b) => a - b);
    assert.deepEqual(pts, frames.map((_, n) => n * tick), 'frame n at exactly n / fps');
    assert.deepEqual([...new Set(frames.map((f) => Number(f.duration)))], [tick], 'every frame lasts exactly 1 / fps');

    const {luma} = frameProbe('luma', out);
    const lit = luma.map((v, n) => [n, v]).filter(([, v]) => v > 128).map(([n]) => n);
    assert.deepEqual(lit, CLICKS.map((t) => Math.round(t * FPS)), 'the flash frames');
  });

  it('a partial range (--frames) carries the matching span of the source audio, within 1 ms', {timeout: 240_000}, async (t) => {
    const out = join(proj.root, 'out/av-part.mp4');
    const {result, output} = await render(['--out', out, '--frames=30-89']);
    assert.equal(result, 0, output.join('\n'));
    const got = decodeAudio(out);
    const offset = 30 / FPS;
    const inside = CLICKS.filter((c) => c > offset + 0.1 && c < 90 / FPS - 0.1);
    assert.equal(inside.length, 2);
    const lags = inside.map((c) => lagAt(source.subarray(Math.round(offset * RATE)), got, Math.round((c - offset) * RATE)));
    t.diagnostic(`lags: ${lags.map(ms).join(', ')}`);
    lags.forEach((lag, i) => assert.ok(Math.abs(lag) < 0.001, `click at ${inside[i]}s is off by ${ms(lag)} in the partial render`));
    assert.equal(probeTimeline(out).frames.length, 60);
  });

  it('pnpm preview of the render keeps the audio within 1 ms of the source', {timeout: 240_000}, async (t) => {
    const out = join(proj.root, 'out/av.mp4');
    const prev = join(proj.root, 'out/av-preview.mp4');
    const {result, output} = await quiet(() => previewMain(['--in', out, '--out', prev], {root: proj.root}));
    assert.equal(result, 0, output.join('\n'));
    const got = decodeAudio(prev);
    const lags = CLICKS.map((c) => lagAt(source, got, Math.round(c * RATE)));
    t.diagnostic(`lags: ${lags.map(ms).join(', ')}`);
    lags.forEach((lag, i) => assert.ok(Math.abs(lag) < 0.001, `preview: click at ${CLICKS[i]}s is off by ${ms(lag)}`));
    const {stream} = probeTimeline(prev);
    assert.deepEqual([stream.height, stream.r_frame_rate, stream.avg_frame_rate], [720, `${FPS}/1`, `${FPS}/1`]);
  });
});
