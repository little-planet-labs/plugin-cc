import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {planAudio, type AudioPlan, type AudioPlanInput} from '../src/lib/audio-plan';

const WAV = 'audio/track.wav';
const MP3 = 'audio/track.mp3';
const base = {candidates: [WAV, MP3], fps: 30, fallbackSeconds: 60, fallbackTempo: 120};
const analyzed = (source: string | null) => ({source, fps: 30, durationInFrames: 3935});

type Case = {
  name: string;
  source: string | null;
  existing: string[];
  expect: Omit<AudioPlan, 'warning'> & {warning: RegExp | null};
};

const cases: Case[] = [
  {
    name: 'no analysis, no file: silent 60s default',
    source: null,
    existing: [],
    expect: {audioSrc: null, timing: 'analysis', durationInFrames: 1800, warning: null},
  },
  {
    name: 'no analysis, a file present: play it with fallback timing and warn',
    source: null,
    existing: [MP3],
    expect: {audioSrc: MP3, timing: 'fallback', durationInFrames: 1800, warning: /track\.mp3 has not been analyzed \(analysis is for no track\)/},
  },
  {
    name: 'analyzed wav present: use the analysis',
    source: WAV,
    existing: [WAV],
    expect: {audioSrc: WAV, timing: 'analysis', durationInFrames: 3935, warning: null},
  },
  {
    name: 'analyzed mp3 present: use the analysis',
    source: MP3,
    existing: [MP3],
    expect: {audioSrc: MP3, timing: 'analysis', durationInFrames: 3935, warning: null},
  },
  {
    name: 'analyzed mp3, both present: prefer the analyzed file over candidate order',
    source: MP3,
    existing: [WAV, MP3],
    expect: {audioSrc: MP3, timing: 'analysis', durationInFrames: 3935, warning: null},
  },
  {
    name: 'analyzed wav missing, mp3 present: play mp3 with fallback timing, message says so',
    source: WAV,
    existing: [MP3],
    expect: {
      audioSrc: MP3,
      timing: 'fallback',
      durationInFrames: 1800,
      warning: /track\.mp3 has not been analyzed \(analysis is for public\/audio\/track\.wav\)\. Using fallback timing/,
    },
  },
  {
    name: 'no analysis, both present: first candidate, fallback timing',
    source: null,
    existing: [WAV, MP3],
    expect: {audioSrc: WAV, timing: 'fallback', durationInFrames: 1800, warning: /track\.wav has not been analyzed/},
  },
  {
    name: 'analyzed file missing, nothing on disk: silent with the analyzed timing',
    source: WAV,
    existing: [],
    expect: {audioSrc: null, timing: 'analysis', durationInFrames: 3935, warning: /track\.wav, which is missing\. Rendering silent with its analyzed timing/},
  },
];

describe('planAudio', () => {
  for (const c of cases) {
    it(c.name, () => {
      const plan = planAudio({...base, analysis: analyzed(c.source), existing: c.existing});
      const {warning, ...rest} = c.expect;
      assert.deepEqual({...plan, warning: undefined}, {...rest, warning: undefined});
      if (warning === null) assert.equal(plan.warning, null);
      else assert.match(plan.warning ?? '', warning);
    });
  }

  it('the fallback warning reports the fallback tempo and length, not a hard-coded value', () => {
    const input: AudioPlanInput = {...base, fallbackTempo: 96, fallbackSeconds: 45, analysis: analyzed(null), existing: [WAV]};
    const plan = planAudio(input);
    assert.match(plan.warning ?? '', /\(45s, 96 BPM grid\)/);
    assert.equal(plan.durationInFrames, 45 * 30);
  });

  it('rejects an analysis made at a different fps', () => {
    assert.throws(
      () => planAudio({...base, analysis: {source: WAV, fps: 25, durationInFrames: 100}, existing: [WAV]}),
      /generated at 25fps but the video is 30fps/,
    );
  });
});
