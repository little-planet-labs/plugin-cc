// src/lib/project.js, the timing in effect (ported from the old template's
// audio-plan and data rules): fallback timing when there is no analysed track,
// when the present file isn't the analysed one, and when the analysis was made
// at another fps; timing overrides only with a source; the analysed file, else
// the first present candidate, is chosen; frames = durationInFrames, including
// fallbackSeconds * fps for a no-track project at any fps.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {parseAudioAnalysis} from '../src/lib/analysis.js';
import {parsePipeline} from '../src/lib/pipeline.js';
import {fallbackAnalysis, resolveProject, withLineIds} from '../src/lib/project.js';
import {gridAnalysis} from './fixtures/data-grid.mjs';

const WAV = 'audio/track.wav';
const MP3 = 'audio/track.mp3';
const defaultAnalysis = parseAudioAnalysis(JSON.parse(readFileSync(new URL('../src/data/audio-analysis.default.json', import.meta.url), 'utf8')));
const pipelineAt = (over = {}) => parsePipeline({...JSON.parse(readFileSync(new URL('../src/pipeline.json', import.meta.url), 'utf8')), ...over});

/** An analysed track: 131.15 s at 30 fps = 3935 frames, beats every 0.5 s. */
const analysed = (source, fps = 30) => {
  const a = gridAnalysis({count: 260});
  return parseAudioAnalysis({...a, source, fps, durationSeconds: 131.15, durationInFrames: Math.ceil(131.15 * fps - 1e-9), energy: {low: [], mid: [], high: []}});
};

const resolve = ({analysis = defaultAnalysis, present = [], pipeline = pipelineAt(), overrides = {}, lyrics = [], sections = [], fallback = defaultAnalysis} = {}) =>
  resolveProject({pipeline, analysis, defaultAnalysis: fallback, overrides, lyrics, sections, present});

const cases = [
  {name: 'no analysis, no file: silent fallback (60 s default), no warning', source: null, present: [], expect: {audio: null, timing: 'fallback', frames: 1800, warning: null}},
  {name: 'no analysis, a file present: play it with fallback timing and warn', source: null, present: [MP3], expect: {audio: MP3, timing: 'fallback', frames: 1800, warning: /track\.mp3 has not been analysed \(analysis is for no track\)/}},
  {name: 'analysed wav present: use the analysis', source: WAV, present: [WAV], expect: {audio: WAV, timing: 'analysis', frames: 3935, warning: null}},
  {name: 'analysed mp3 present: use the analysis', source: MP3, present: [MP3], expect: {audio: MP3, timing: 'analysis', frames: 3935, warning: null}},
  {name: 'analysed mp3, both present: prefer the analysed file over candidate order', source: MP3, present: [WAV, MP3], expect: {audio: MP3, timing: 'analysis', frames: 3935, warning: null}},
  {
    name: 'analysed wav missing, mp3 present: play the mp3 with fallback timing, and say so',
    source: WAV,
    present: [MP3],
    expect: {audio: MP3, timing: 'fallback', frames: 1800, warning: /track\.mp3 has not been analysed \(analysis is for public\/audio\/track\.wav\)\. Using fallback timing/},
  },
  {name: 'no analysis, both present: the first candidate, fallback timing', source: null, present: [WAV, MP3], expect: {audio: WAV, timing: 'fallback', frames: 1800, warning: /track\.wav has not been analysed/}},
  {
    name: 'analysed file missing, nothing on disk: silent with the analysed timing',
    source: WAV,
    present: [],
    expect: {audio: null, timing: 'analysis', frames: 3935, warning: /track\.wav, which is missing\. Rendering silent with its analysed timing/},
  },
];

describe('resolveProject: audio and timing', () => {
  for (const c of cases) {
    it(c.name, () => {
      const p = resolve({analysis: c.source === null ? defaultAnalysis : analysed(c.source), present: c.present});
      assert.equal(p.audio, c.expect.audio);
      assert.equal(p.timing, c.expect.timing);
      assert.equal(p.frames, c.expect.frames);
      assert.equal(p.durationInFrames, p.frames);
      assert.equal(p.analysis.durationInFrames, p.frames, 'frames = the in-effect analysis durationInFrames');
      assert.equal(p.duration, p.frames / p.fps);
      if (c.expect.warning === null) assert.deepEqual(p.warnings, []);
      else assert.ok(p.warnings.some((w) => c.expect.warning.test(w)), JSON.stringify(p.warnings));
    });
  }

  it('the fallback warning reports the fallback tempo and length, not a hard-coded value', () => {
    const slow = {...defaultAnalysis, tempo: 96};
    const p = resolve({pipeline: pipelineAt({fallbackSeconds: 45}), analysis: slow, fallback: slow, present: [WAV]});
    assert.ok(p.warnings.some((w) => /\(45s, 96 BPM grid\)/.test(w)), JSON.stringify(p.warnings));
    assert.equal(p.frames, 45 * 30);
  });

  it('an analysis made at another fps falls back to the fallback timing with a warning, still playing the file', () => {
    const p = resolve({pipeline: pipelineAt({fps: 25}), analysis: analysed(WAV, 30), present: [WAV]});
    assert.equal(p.timing, 'fallback');
    assert.equal(p.audio, WAV);
    assert.equal(p.frames, 60 * 25);
    assert.equal(p.analysis.fps, 25);
    assert.ok(p.warnings.some((w) => /made at 30fps but pipeline\.json fps is 25.*pnpm analyze/.test(w)), JSON.stringify(p.warnings));
  });

  it('a no-track project at another fps gets fallbackSeconds * fps frames (the committed default is fixed at 30 fps)', () => {
    for (const fps of [25, 50, 10]) {
      const p = resolve({pipeline: pipelineAt({fps})});
      assert.equal(p.frames, 60 * fps);
      assert.equal(p.analysis.fps, fps);
      assert.deepEqual(p.warnings, []);
    }
    assert.equal(resolve({pipeline: pipelineAt({fallbackSeconds: 2.5, fps: 6})}).frames, 15);
  });

  it('the fallback timing is a steady beat grid at the default tempo over fallbackSeconds', () => {
    const fb = fallbackAnalysis(defaultAnalysis, pipelineAt({fallbackSeconds: 4}));
    assert.deepEqual(fb.beats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    assert.deepEqual(fb.downbeats, [0, 2]);
    assert.equal(fb.source, null);
  });
});

describe('resolveProject: overrides, sections, lyrics', () => {
  it('timing overrides apply only with an analysed source', () => {
    const p = resolve({analysis: analysed(WAV), present: [WAV], overrides: {firstBeat: 10}});
    assert.ok(p.analysis.beats[0] >= 10);
    const q = resolve({overrides: {firstBeat: 10}});
    assert.equal(q.analysis.beats[0], 0, 'the no-track grid ignores overrides');
  });

  it('with an analysed track, sections are placed strictly: a section past the end throws, naming it', () => {
    assert.throws(() => resolve({analysis: analysed(WAV), present: [WAV], sections: [{id: 'a', scene: 'x', start: 0}, {id: 'late', scene: 'x', start: 500}]}), /section "late" starts at 500s/);
  });

  it('on fallback timing, sections and lyric lines past the end are dropped (with a warning for the lines)', () => {
    const p = resolve({
      sections: [{id: 'a', scene: 'x', start: 0}, {id: 'b', scene: 'x', start: 30}, {id: 'late', scene: 'x', start: 90}],
      lyrics: [{id: 'a-1', text: 'hi', start: 1, end: 2}, {id: 'late-1', text: 'gone', start: 95, end: 96}],
    });
    assert.deepEqual(p.sections.map((s) => [s.id, s.from, s.to]), [['a', 0, 900], ['b', 900, 1800]]);
    assert.deepEqual(p.lyrics.map((l) => l.id), ['a-1']);
    assert.ok(p.warnings.some((w) => /1 lyric line\(s\) start after/.test(w)));
  });

  it('an empty sections.json plays one whole-song section', () => {
    const p = resolve();
    assert.deepEqual(p.sections.map((s) => [s.id, s.scene, s.from, s.to]), [['song', 'song', 0, 1800]]);
  });

  it('lines without an id get line-<n>; a collision with a real id fails', () => {
    assert.deepEqual(withLineIds([{text: 'a', start: 0, end: 1}, {id: 'x', text: 'b', start: 1, end: 2}]).map((l) => l.id), ['line-1', 'x']);
    assert.throws(() => withLineIds([{text: 'a', start: 0, end: 1}, {id: 'line-1', text: 'b', start: 1, end: 2}]), /"line-1" is taken/);
  });
});
