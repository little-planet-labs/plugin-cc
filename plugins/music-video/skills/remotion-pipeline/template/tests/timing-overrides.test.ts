import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {applyTimingOverrides, parseAudioAnalysis, parseTimingOverrides} from '../src/lib/analysis-schema';
import {getBeatState, secondsToFrame} from '../src/lib/timing';
import {FPS, gridAnalysis} from './fixtures';

const at = (a: ReturnType<typeof gridAnalysis>, seconds: number) => getBeatState(a, secondsToFrame(seconds, FPS), FPS);

describe('getBeatState bar position re-anchors from the most recent downbeat', () => {
  // 120 BPM, beats 0..9.5s. Downbeats as a detector might emit them after a
  // missed/extra beat: regular until 4s, then the next bar starts at 5.5s.
  const a = gridAnalysis({count: 20, downbeats: [0, 2, 4, 5.5, 7.5, 9.5]});

  it('counts from the latest downbeat, not the first', () => {
    assert.equal(at(a, 5.5).beatInBar, 0);
    assert.equal(at(a, 5.5).isOnDownbeat, true);
    assert.equal(at(a, 6).beatInBar, 1);
    assert.equal(at(a, 7.5).isOnDownbeat, true);
    assert.equal(at(a, 7.5).barIndex, 4);
  });

  it('a short bar before an anchor keeps counting until the anchor', () => {
    assert.equal(at(a, 5).beatInBar, 2);
    assert.equal(at(a, 5).barIndex, 2);
    assert.equal(at(a, 5).isOnDownbeat, false);
  });

  it('a long gap between downbeats keeps cycling every beatsPerBar beats', () => {
    const sparse = gridAnalysis({count: 20, downbeats: [0, 8]});
    assert.equal(at(sparse, 2).beatInBar, 0);
    assert.equal(at(sparse, 2).barIndex, 1);
    assert.equal(at(sparse, 8).barIndex, 1); // downbeats[1]
  });

  it('throws instead of guessing when downbeats are not beats', () => {
    const broken = {...gridAnalysis({count: 8}), downbeats: [0.25]};
    assert.throws(() => at(broken, 1), /subset of analysis\.beats/);
  });
});

describe('parseTimingOverrides', () => {
  it('accepts {} and the full shape, with a $comment', () => {
    assert.deepEqual(parseTimingOverrides({}), {});
    assert.deepEqual(parseTimingOverrides({$comment: 'x', firstBeat: 1, lastBeat: 90, downbeats: [1, 9.2]}), {
      firstBeat: 1,
      lastBeat: 90,
      downbeats: [1, 9.2],
    });
  });
  it('rejects unknown keys, bad numbers, and bad ordering', () => {
    assert.throws(() => parseTimingOverrides({downbeat: [1]}), /downbeat.*unknown key/);
    assert.throws(() => parseTimingOverrides({firstBeat: -1}), /firstBeat/);
    assert.throws(() => parseTimingOverrides({firstBeat: 5, lastBeat: 5}), /lastBeat.*greater than firstBeat/);
    assert.throws(() => parseTimingOverrides({downbeats: [3, 2]}), /strictly ascending/);
    assert.throws(() => parseTimingOverrides({downbeats: 'x'}), /downbeats/);
  });
});

describe('applyTimingOverrides', () => {
  it('firstBeat/lastBeat drop beats outside the range and keep downbeats a subset', () => {
    const out = applyTimingOverrides(gridAnalysis({count: 20}), {firstBeat: 3, lastBeat: 7.9});
    assert.equal(out.beats[0], 3);
    assert.equal(out.beats[out.beats.length - 1], 7.5);
    assert.deepEqual(out.downbeats, [4, 6]);
    assert.doesNotThrow(() => parseAudioAnalysis(out));
  });

  it('anchors snap to the nearest beat within half a beat and extend backwards and forwards', () => {
    const out = applyTimingOverrides(gridAnalysis({count: 20}), {downbeats: [1.1, 6.4]});
    // 1.1 -> beat 1.0; backwards: none fits (1.0 - 4 beats < 0); forwards every 4 beats until the next anchor.
    // 6.4 -> beat 6.5; then 8.5.
    assert.deepEqual(out.downbeats, [1, 3, 5, 6.5, 8.5]);
    assert.doesNotThrow(() => parseAudioAnalysis(out));
  });

  it('beats before the first anchor are pickups counted back from it', () => {
    const out = applyTimingOverrides(gridAnalysis({count: 20}), {downbeats: [2.5]});
    assert.deepEqual(out.downbeats, [0.5, 2.5, 4.5, 6.5, 8.5]);
    assert.equal(at(out, 0).beatInBar, 3);
    assert.equal(at(out, 0).barIndex, -1);
  });

  it('rejects an anchor with no beat within half a beat, or two anchors on one beat', () => {
    const sparse = gridAnalysis({beats: [0, 0.5, 1, 1.5, 5, 5.5, 6, 6.5]});
    assert.throws(() => applyTimingOverrides(sparse, {downbeats: [3]}), /downbeats\[0\] \(3s\).*nearest is 1\.5s/);
    assert.throws(() => applyTimingOverrides(gridAnalysis(), {downbeats: [1, 1.1]}), /same beat/);
  });

  it('rejects a range that removes every beat', () => {
    assert.throws(() => applyTimingOverrides(gridAnalysis({count: 8}), {firstBeat: 50}), /at least one detected beat/);
  });

  it('repairs a bar slip from one missed beat (the bridge case)', () => {
    // True grid: 0.5s beats, bars every 2s. The tracker missed the beat at 6.0s, so
    // auto downbeats (every 4th detected beat) slip by one beat from there on.
    const beats = Array.from({length: 24}, (_, i) => i * 0.5).filter((t) => t !== 6);
    const slipped = gridAnalysis({beats});
    assert.equal(at(slipped, 8).isOnDownbeat, false); // wrong: 8.0s is a real bar start
    const fixed = applyTimingOverrides(slipped, {downbeats: [0, 8]});
    assert.equal(at(fixed, 8).isOnDownbeat, true);
    assert.equal(at(fixed, 10).isOnDownbeat, true);
    assert.equal(at(fixed, 10.5).beatInBar, 1);
  });
});
