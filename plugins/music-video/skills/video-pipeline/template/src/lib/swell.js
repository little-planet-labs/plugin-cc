// Slow, energy-driven movement for backgrounds, with nothing locked to the
// beat. Pure ES module (no DOM, no node: imports). Ported from the old
// template's useEnergySwell.
import {getEnergyAt} from './timing.js';

/** @typedef {import('./analysis.js').AudioAnalysis} AudioAnalysis */
/** @typedef {import('./analysis.js').EnergyBand} EnergyBand */

const DEFAULT_WEIGHTS = Object.freeze({low: 0.4, mid: 0.6});

/** One bar in frames from the analysis tempo and meter (2 s when the tempo is unusable). */
const barFrames = (analysis, fps) => {
  const seconds = analysis.tempo > 0 && Number.isFinite(analysis.tempo) ? (60 / analysis.tempo) * Math.max(1, analysis.beatsPerBar) : 2;
  return Math.max(1, Math.round(seconds * fps));
};

/**
 * Band energy at a frame, linearly interpolated between frames for a
 * fractional frame (subframe samples), 0 outside the track.
 * @param {AudioAnalysis} analysis
 * @param {EnergyBand} band
 * @param {number} frame Possibly fractional.
 * @param {number} [smoothFrames]
 * @returns {number}
 */
export const energyAtFrame = (analysis, band, frame, smoothFrames = 1) => {
  const f0 = Math.floor(frame);
  const u = frame - f0;
  const a = getEnergyAt(analysis, band, f0, smoothFrames);
  return u === 0 ? a : a + (getEnergyAt(analysis, band, f0 + 1, smoothFrames) - a) * u;
};

/**
 * Heavily smoothed 0..1 low/mid energy at `frame`: the weighted band energy
 * averaged over a centred box one bar long, twice (a triangle kernel 2N - 1
 * frames wide), so the beat and its harmonics are nulled and it rises and falls
 * with the song's sections. Frames past either end repeat the end value.
 * @param {AudioAnalysis} analysis
 * @param {number} frame
 * @param {number} fps
 * @param {{bars?: number, weights?: Partial<Record<EnergyBand, number>>}} [options]
 * @returns {number}
 */
export const energySwell = (analysis, frame, fps, options = {}) => {
  const weights = Object.entries(options.weights ?? DEFAULT_WEIGHTS).filter(([, w]) => (w ?? 0) > 0);
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return 0;
  const n = Math.max(1, Math.round((options.bars ?? 1) * barFrames(analysis, fps)));
  const center = Math.round(frame);
  let sum = 0;
  for (const [band, w] of weights) {
    const last = analysis.energy[band].length - 1;
    if (last < 0) continue;
    let acc = 0;
    for (let k = -(n - 1); k <= n - 1; k++) {
      const f = Math.min(last, Math.max(0, center + k));
      acc += (n - Math.abs(k)) * getEnergyAt(analysis, band, f);
    }
    sum += (w / total) * (acc / (n * n));
  }
  return sum;
};
