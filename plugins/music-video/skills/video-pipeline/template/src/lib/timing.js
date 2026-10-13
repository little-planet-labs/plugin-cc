// Pure, deterministic timing math. Everything is derived from a frame number,
// never from wall-clock time. Pure ES module (no DOM, no node: imports): the
// page and the Node scripts both import it.
//
// Hand corrections (src/data/timing-overrides.json) are parsed and applied by
// ./analysis.js; they're re-exported here so beat code finds them in one place.
import {findTimeIndex} from './analysis.js';

export {applyTimingOverrides, parseTimingOverrides} from './analysis.js';

/** @typedef {import('./analysis.js').AudioAnalysis} AudioAnalysis */
/** @typedef {import('./analysis.js').EnergyBand} EnergyBand */

/**
 * Seconds -> nearest video frame. A beat at 0.51s at 30fps lands on frame 15.
 * @param {number} seconds
 * @param {number} fps
 * @returns {number}
 */
export const secondsToFrame = (seconds, fps) => Math.round(seconds * fps);

/**
 * Video frame -> seconds (start of that frame).
 * @param {number} frame
 * @param {number} fps
 * @returns {number}
 */
export const frameToSeconds = (frame, fps) => frame / fps;

/**
 * Index of the last event whose (rounded) frame is <= `frame`, or -1 if none.
 * `times` must be ascending seconds. Quantizing to frames keeps "which beat are
 * we in" consistent with "is this frame on a beat".
 * @param {readonly number[]} times
 * @param {number} frame
 * @param {number} fps
 * @returns {number}
 */
export const lastEventIndexAtFrame = (times, frame, fps) => {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (secondsToFrame(times[mid], fps) <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/**
 * Frames elapsed since the most recent event at or before `frame`; Infinity if none yet.
 * @param {readonly number[]} times
 * @param {number} frame
 * @param {number} fps
 * @returns {number}
 */
export const framesSinceEvent = (times, frame, fps) => {
  const i = lastEventIndexAtFrame(times, frame, fps);
  return i < 0 ? Infinity : frame - secondsToFrame(times[i], fps);
};

/** Index of the last time <= t (ascending times), or -1. */
const lastIndexAtOrBefore = (times, t) => {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t + 1e-6) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/**
 * @typedef {object} BeatState
 * @property {number} beatIndex Index into `analysis.beats` of the current beat; -1 before the first beat.
 * @property {number} phase Progress from the current beat to the next, 0..1. Before the first beat it ramps toward 1 over one beat period.
 * @property {boolean} isOnBeat True on exactly one frame per beat: the frame the beat rounds to.
 * @property {number} beatInBar 0-based position in the bar (0 = downbeat); -1 before the first beat.
 * @property {number} barIndex 0-based bar number (= index into analysis.downbeats for a full bar); negative for pickup beats; -1 before the first beat.
 * @property {boolean} isOnDownbeat True on the frame of a downbeat.
 * @property {number} beatDuration Length of the current beat in seconds.
 */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

const floorDiv = (a, b) => Math.floor(a / b);

const mod = (a, b) => ((a % b) + b) % b;

/**
 * @param {AudioAnalysis} analysis
 * @param {number} frame
 * @param {number} fps
 * @returns {BeatState}
 */
export const getBeatState = (analysis, frame, fps) => {
  const {beats, beatsPerBar} = analysis;
  const period = 60 / analysis.tempo;
  const t = frameToSeconds(frame, fps);
  const i = lastEventIndexAtFrame(beats, frame, fps);

  if (i < 0) {
    const first = beats[0];
    const phase = first === undefined ? 0 : clamp01(1 - (first - t) / period);
    return {beatIndex: -1, phase, isOnBeat: false, beatInBar: -1, barIndex: -1, isOnDownbeat: false, beatDuration: period};
  }

  const start = beats[i];
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
 * @param {AudioAnalysis} analysis
 * @param {EnergyBand} band
 * @param {number} frame
 * @param {number} [smoothFrames]
 * @returns {number}
 */
export const getEnergyAt = (analysis, band, frame, smoothFrames = 1) => {
  const values = analysis.energy[band];
  if (frame < 0 || frame >= values.length) return 0;
  const n = Math.max(1, Math.floor(smoothFrames));
  let sum = 0;
  let count = 0;
  for (let f = frame; f > frame - n && f >= 0; f--) {
    sum += values[f];
    count++;
  }
  return sum / count;
};

const framesInRange = (times, fromFrame, toFrame, fps) => {
  const out = [];
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
 * matches how sections tile the video: a beat that rounds onto a section's
 * first frame belongs to it, one that rounds onto the next section's first
 * frame doesn't. For a placed section pass (section.from, section.to).
 * @param {AudioAnalysis} analysis
 * @param {number} fromFrame
 * @param {number} toFrame
 * @param {number} fps
 * @returns {number[]}
 */
export const beatFramesBetween = (analysis, fromFrame, toFrame, fps) => framesInRange(analysis.beats, fromFrame, toFrame, fps);

/**
 * Like beatFramesBetween, for downbeats (bar starts).
 * @param {AudioAnalysis} analysis
 * @param {number} fromFrame
 * @param {number} toFrame
 * @param {number} fps
 * @returns {number[]}
 */
export const downbeatFramesBetween = (analysis, fromFrame, toFrame, fps) =>
  framesInRange(analysis.downbeats, fromFrame, toFrame, fps);
