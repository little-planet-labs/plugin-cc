import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {parseAudioAnalysis, withBeatGridFallback, type AudioAnalysis} from '../src/lib/analysis-schema';
import {
  beatFramesBetween,
  downbeatFramesBetween,
  framesSinceEvent,
  getBeatState,
  getEnergyAt,
  lastEventIndexAtFrame,
  secondsToFrame,
} from '../src/lib/timing';

const FPS = 30;

const base = (overrides: Partial<AudioAnalysis> = {}): AudioAnalysis => ({
  version: 1,
  source: 'audio/track.wav',
  generator: 'test',
  fps: FPS,
  durationSeconds: 4,
  durationInFrames: 120,
  tempo: 120,
  beatsPerBar: 4,
  // Pickup beat at 0.25s, then 120 BPM; first downbeat is the second beat.
  beats: [0.25, 0.75, 1.25, 1.75, 2.25, 2.75],
  downbeats: [0.75, 2.75],
  onsets: [0.25, 0.75, 1.0],
  bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
  energy: {low: [0, 0.5, 1, 0.5, ...new Array<number>(116).fill(0)], mid: [], high: new Array<number>(120).fill(0.2)},
  ...overrides,
});

describe('secondsToFrame', () => {
  it('rounds to the nearest frame', () => {
    assert.equal(secondsToFrame(0.5, FPS), 15);
    assert.equal(secondsToFrame(0.51, FPS), 15);
    assert.equal(secondsToFrame(0.52, FPS), 16);
  });
});

describe('lastEventIndexAtFrame', () => {
  it('is -1 before the first event and quantizes events to frames', () => {
    const times = [0.25, 0.75];
    assert.equal(lastEventIndexAtFrame(times, 7, FPS), -1); // 0.25s rounds to frame 8 (7.5 -> 8)
    assert.equal(lastEventIndexAtFrame(times, 8, FPS), 0);
    assert.equal(lastEventIndexAtFrame(times, 22, FPS), 0);
    assert.equal(lastEventIndexAtFrame(times, 23, FPS), 1); // 22.5 -> 23
    assert.equal(lastEventIndexAtFrame(times, 1000, FPS), 1);
    assert.equal(lastEventIndexAtFrame([], 10, FPS), -1);
  });
});

describe('getBeatState', () => {
  const a = base();

  it('flags exactly one on-beat frame per beat', () => {
    const onBeatFrames: number[] = [];
    for (let f = 0; f < 120; f++) if (getBeatState(a, f, FPS).isOnBeat) onBeatFrames.push(f);
    assert.deepEqual(onBeatFrames, a.beats.map((b) => secondsToFrame(b, FPS)));
  });

  it('beatIndex agrees with isOnBeat on the beat frame', () => {
    const s = getBeatState(a, secondsToFrame(1.25, FPS), FPS);
    assert.equal(s.beatIndex, 2);
    assert.equal(s.isOnBeat, true);
    assert.ok(s.phase < 0.05);
  });

  it('phase runs 0..1 across a beat', () => {
    const mid = getBeatState(a, 30, FPS); // 1.0s, halfway between 0.75 and 1.25
    assert.equal(mid.beatIndex, 1);
    assert.ok(Math.abs(mid.phase - 0.5) < 1e-9);
    assert.equal(mid.isOnBeat, false);
  });

  it('before the first beat: index -1, phase ramps toward 1', () => {
    const s0 = getBeatState(a, 0, FPS);
    assert.equal(s0.beatIndex, -1);
    assert.equal(s0.beatInBar, -1);
    assert.ok(Math.abs(s0.phase - 0.5) < 1e-9); // 0.25s before a beat of 0.5s period
  });

  it('counts bars from the first downbeat, pickup beats are negative bars', () => {
    const pickup = getBeatState(a, secondsToFrame(0.25, FPS), FPS);
    assert.equal(pickup.beatInBar, 3);
    assert.equal(pickup.barIndex, -1);
    const down = getBeatState(a, secondsToFrame(0.75, FPS), FPS);
    assert.equal(down.beatInBar, 0);
    assert.equal(down.barIndex, 0);
    assert.equal(down.isOnDownbeat, true);
    const nextDown = getBeatState(a, secondsToFrame(2.75, FPS), FPS);
    assert.equal(nextDown.barIndex, 1);
    assert.equal(nextDown.isOnDownbeat, true);
    const offBeat = getBeatState(a, secondsToFrame(1.25, FPS), FPS);
    assert.equal(offBeat.isOnDownbeat, false);
  });

  it('after the last beat uses the tempo period and clamps phase at 1', () => {
    const s = getBeatState(a, 119, FPS);
    assert.equal(s.beatIndex, 5);
    assert.equal(s.beatDuration, 0.5);
    assert.equal(s.phase, 1);
  });
});

describe('getEnergyAt', () => {
  const a = base();
  it('returns the per-frame value and 0 outside the data', () => {
    assert.equal(getEnergyAt(a, 'low', 2), 1);
    assert.equal(getEnergyAt(a, 'low', -1), 0);
    assert.equal(getEnergyAt(a, 'low', 120), 0);
    assert.equal(getEnergyAt(a, 'mid', 0), 0); // empty band = silence
  });
  it('smooths over a trailing window, truncated at frame 0', () => {
    assert.equal(getEnergyAt(a, 'low', 2, 3), 0.5);
    assert.equal(getEnergyAt(a, 'low', 0, 3), 0);
    assert.equal(getEnergyAt(a, 'low', 1, 3), 0.25);
  });
});

describe('framesSinceEvent', () => {
  it('is Infinity before the first event, then frames since the latest', () => {
    assert.equal(framesSinceEvent([1], 29, FPS), Infinity);
    assert.equal(framesSinceEvent([1], 30, FPS), 0);
    assert.equal(framesSinceEvent([1], 35, FPS), 5);
  });
});

describe('withBeatGridFallback', () => {
  it('synthesizes a tempo grid with downbeats when no beats exist', () => {
    const g = withBeatGridFallback(base({beats: [], downbeats: [], durationSeconds: 2}));
    assert.deepEqual(g.beats, [0, 0.5, 1, 1.5]);
    assert.deepEqual(g.downbeats, [0]);
  });
  it('leaves detected beats untouched', () => {
    const a = base();
    assert.equal(withBeatGridFallback(a), a);
  });
});

describe('parseAudioAnalysis', () => {
  it('accepts the checked-in default and a valid analysis', async () => {
    const {readFile} = await import('node:fs/promises');
    const def = JSON.parse(await readFile(new URL('../src/data/audio-analysis.default.json', import.meta.url), 'utf8'));
    const parsed = parseAudioAnalysis(def);
    assert.equal(parsed.source, null);
    assert.equal(parsed.durationInFrames, 1800);
    assert.deepEqual(parseAudioAnalysis(base()), base());
  });
  it('rejects unsorted beats and out-of-range energy', () => {
    assert.throws(() => parseAudioAnalysis({...base(), beats: [1, 0.5]}), /beats/);
    assert.throws(() => parseAudioAnalysis({...base(), energy: {...base().energy, low: [1.5]}}), /energy\.low/);
    assert.throws(() => parseAudioAnalysis({...base(), version: 2}), /version/);
  });
  it('rejects energy whose length differs from durationInFrames (empty is allowed)', () => {
    assert.throws(() => parseAudioAnalysis({...base(), energy: {...base().energy, high: [0.1, 0.2]}}), /energy\.high.*120.*got 2/);
    assert.doesNotThrow(() => parseAudioAnalysis({...base(), energy: {low: [], mid: [], high: []}}));
  });
  it('rejects downbeats that are not beats, and beats without downbeats', () => {
    assert.throws(() => parseAudioAnalysis({...base(), downbeats: [0.75, 2.7]}), /downbeats.*2\.7s is not a beat/);
    assert.throws(() => parseAudioAnalysis({...base(), downbeats: []}), /downbeats.*non-empty/);
  });
});

describe('beatFramesBetween / downbeatFramesBetween', () => {
  it('beatFramesBetween is half-open and returns absolute frames', () => {
    const a = base(); // beats 0.25, 0.75, ..., 2.75 s -> frames 8, 23, 38, 53, 68, 83; downbeats 0.75, 2.75 -> 23, 83
    assert.deepEqual(beatFramesBetween(a, 23, 68, FPS), [23, 38, 53]); // from included, to (68) excluded
    assert.deepEqual(beatFramesBetween(a, 0, 1000, FPS), [8, 23, 38, 53, 68, 83]);
    assert.deepEqual(beatFramesBetween(a, 24, 38, FPS), []);
    assert.deepEqual(downbeatFramesBetween(a, 23, 83, FPS), [23]); // 83 excluded
    assert.deepEqual(downbeatFramesBetween(a, 0, 84, FPS), [23, 83]);
  });

  it('filters on the rounded frame, not the time in seconds', () => {
    // 0.74 s rounds to frame 22, 0.7666 s rounds to 23: both are before 0.775 s in seconds,
    // but only the second lands on a section that starts at frame 23.
    const a = base({beats: [0.74, 0.7666, 1.25], downbeats: [0.7666]});
    assert.deepEqual(beatFramesBetween(a, 23, 38, FPS), [23]);
    assert.deepEqual(beatFramesBetween(a, 22, 23, FPS), [22]);
    assert.deepEqual(downbeatFramesBetween(a, 23, 38, FPS), [23]);
  });
});
