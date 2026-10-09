// Pure, deterministic timing math. Everything is derived from a frame number,
// never from wall-clock time. Hooks in ./hooks.ts wrap these for components;
// tests in tests/ exercise them directly.
import {findTimeIndex, type AudioAnalysis, type EnergyBand} from './analysis-schema';

/** Seconds → nearest video frame. A beat at 0.51s at 30fps lands on frame 15. */
export const secondsToFrame = (seconds: number, fps: number): number => Math.round(seconds * fps);

/** Video frame → seconds (start of that frame). */
export const frameToSeconds = (frame: number, fps: number): number => frame / fps;

/**
 * Index of the last event whose (rounded) frame is <= `frame`, or -1 if none.
 * `times` must be ascending seconds. Quantizing to frames keeps "which beat are
 * we in" consistent with "is this frame on a beat".
 */
export const lastEventIndexAtFrame = (times: readonly number[], frame: number, fps: number): number => {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (secondsToFrame(times[mid] as number, fps) <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/** Frames elapsed since the most recent event at or before `frame`; Infinity if none yet. */
export const framesSinceEvent = (times: readonly number[], frame: number, fps: number): number => {
  const i = lastEventIndexAtFrame(times, frame, fps);
  return i < 0 ? Infinity : frame - secondsToFrame(times[i] as number, fps);
};

/** Index of the last time <= t (ascending times), or -1. */
const lastIndexAtOrBefore = (times: readonly number[], t: number): number => {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= t + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

export type BeatState = {
  /** Index into `analysis.beats` of the current beat; -1 before the first beat. */
  beatIndex: number;
  /** Progress from the current beat to the next, 0..1. Before the first beat it ramps toward 1 over one beat period. */
  phase: number;
  /** True on exactly one frame per beat: the frame the beat rounds to. */
  isOnBeat: boolean;
  /** 0-based position in the bar (0 = downbeat); -1 before the first beat. */
  beatInBar: number;
  /** 0-based bar number (= index into analysis.downbeats for a full bar); negative for pickup beats; -1 before the first beat. */
  barIndex: number;
  /** True on the frame of a downbeat. */
  isOnDownbeat: boolean;
  /** Length of the current beat in seconds. */
  beatDuration: number;
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const floorDiv = (a: number, b: number) => Math.floor(a / b);

const mod = (a: number, b: number) => ((a % b) + b) % b;

export const getBeatState = (analysis: AudioAnalysis, frame: number, fps: number): BeatState => {
  const {beats, beatsPerBar} = analysis;
  const period = 60 / analysis.tempo;
  const t = frameToSeconds(frame, fps);
  const i = lastEventIndexAtFrame(beats, frame, fps);

  if (i < 0) {
    const first = beats[0];
    const phase = first === undefined ? 0 : clamp01(1 - (first - t) / period);
    return {beatIndex: -1, phase, isOnBeat: false, beatInBar: -1, barIndex: -1, isOnDownbeat: false, beatDuration: period};
  }

  const start = beats[i] as number;
  const next = beats[i + 1] ?? start + period;
  const beatDuration = next - start;
  const phase = clamp01((t - start) / beatDuration);
  const isOnBeat = secondsToFrame(start, fps) === frame;

  // Bar position counts from the most recent downbeat at or before this beat, so
  // a hand-placed anchor (timing-overrides.json) re-syncs everything after it.
  // Beats before the first downbeat are pickups counted back from it.
  const {downbeats} = analysis;
  let d = lastIndexAtOrBefore(downbeats, start);
  if (d < 0) d = 0;
  const downbeatTime = downbeats[d];
  const downbeatIndex = downbeatTime === undefined ? -1 : findTimeIndex(beats, downbeatTime);
  if (downbeatIndex < 0) {
    throw new Error('getBeatState: analysis.downbeats must be a non-empty subset of analysis.beats');
  }
  const sinceDownbeat = i - downbeatIndex;
  const beatInBar = mod(sinceDownbeat, beatsPerBar);
  const barIndex = d + floorDiv(sinceDownbeat, beatsPerBar);

  return {beatIndex: i, phase, isOnBeat, beatInBar, barIndex, isOnDownbeat: isOnBeat && beatInBar === 0, beatDuration};
};

/**
 * Normalized 0..1 band energy at `frame`. Returns 0 when there's no analysis
 * data or the frame is outside the track. `smoothFrames` > 1 averages the
 * trailing window (this frame and the N-1 before it) to tame flicker.
 */
export const getEnergyAt = (
  analysis: AudioAnalysis,
  band: EnergyBand,
  frame: number,
  smoothFrames = 1,
): number => {
  const values = analysis.energy[band];
  if (frame < 0 || frame >= values.length) return 0;
  const n = Math.max(1, Math.floor(smoothFrames));
  let sum = 0;
  let count = 0;
  for (let f = frame; f > frame - n && f >= 0; f--) {
    sum += values[f] as number;
    count++;
  }
  return sum / count;
};

const framesInRange = (times: readonly number[], fromFrame: number, toFrame: number, fps: number): number[] => {
  const out: number[] = [];
  for (const t of times) {
    const f = secondsToFrame(t, fps);
    if (f >= toFrame) break; // times ascend, so rounded frames never descend
    if (f >= fromFrame) out.push(f);
  }
  return out;
};

/**
 * ABSOLUTE song frames (secondsToFrame) of the beats whose ROUNDED frame f
 * satisfies fromFrame <= f < toFrame, ascending. Filtering in frame space
 * matches what a <Sequence from={fromFrame} durationInFrames={toFrame - fromFrame}>
 * renders: a beat that rounds onto a section's first frame belongs to it,
 * one that rounds onto the next section's first frame doesn't. For a placed
 * section pass (section.from, section.from + section.durationInFrames), or
 * use useSectionBeats.
 */
export const beatFramesBetween = (analysis: AudioAnalysis, fromFrame: number, toFrame: number, fps: number): number[] =>
  framesInRange(analysis.beats, fromFrame, toFrame, fps);

/** Like beatFramesBetween, for downbeats (bar starts). */
export const downbeatFramesBetween = (
  analysis: AudioAnalysis,
  fromFrame: number,
  toFrame: number,
  fps: number,
): number[] => framesInRange(analysis.downbeats, fromFrame, toFrame, fps);
