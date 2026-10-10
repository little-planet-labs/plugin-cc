// Slow, energy-driven movement for backgrounds, with nothing locked to the beat.
import {useVideoConfig} from 'remotion';
import type {AudioAnalysis, EnergyBand} from '../../lib/analysis-schema';
import {useAudioAnalysis, useSongFrame} from '../../lib/hooks';
import {getEnergyAt} from '../../lib/timing';

export type EnergySwellOptions = {
  /** Filter length in bars (each of the two passes). Default 1. Longer = slower swells. */
  bars?: number;
  /** Band weights, normalized to sum 1. Default {low: 0.4, mid: 0.6}. */
  weights?: Partial<Record<EnergyBand, number>>;
};

const DEFAULT_WEIGHTS: Partial<Record<EnergyBand, number>> = {low: 0.4, mid: 0.6};

/** One bar in frames from the analysis tempo and meter (2 s when the tempo is unusable). */
const barFrames = (analysis: AudioAnalysis, fps: number): number => {
  const seconds = analysis.tempo > 0 && Number.isFinite(analysis.tempo) ? (60 / analysis.tempo) * Math.max(1, analysis.beatsPerBar) : 2;
  return Math.max(1, Math.round(seconds * fps));
};

/**
 * The swell at `frame`: the weighted band energy averaged over a centred box
 * one bar long, then averaged again over another bar. Two box passes make one
 * triangle kernel, 2N - 1 frames wide with weights (N - |k|) / N^2. A box one
 * bar long nulls the bar frequency and its harmonics, the beat among them, and
 * the second pass flattens what leaks through when the bar isn't a whole number
 * of frames. Frames past either end of the track repeat the end value, so the
 * swell doesn't dip at the start and end of the song.
 */
const energySwellAt = (analysis: AudioAnalysis, frame: number, fps: number, options: EnergySwellOptions): number => {
  const weights = Object.entries(options.weights ?? DEFAULT_WEIGHTS).filter(([, w]) => (w ?? 0) > 0) as [EnergyBand, number][];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return 0;
  const n = Math.max(1, Math.round((options.bars ?? 1) * barFrames(analysis, fps)));
  let sum = 0;
  for (const [band, w] of weights) {
    const last = analysis.energy[band].length - 1;
    if (last < 0) continue;
    let acc = 0;
    for (let k = -(n - 1); k <= n - 1; k++) {
      const f = Math.min(last, Math.max(0, Math.round(frame) + k));
      acc += (n - Math.abs(k)) * getEnergyAt(analysis, band, f);
    }
    sum += (w / total) * (acc / (n * n));
  }
  return sum;
};

/**
 * Heavily smoothed 0..1 low/mid energy at the current song frame, for slow
 * background movement (a glow that blooms with the chorus, a 2-3% scale swell
 * on the backdrop). The filter spans two bars, so there is no beat-period
 * ripple: it rises and falls with the song's sections. It gives smoothed
 * movement where beat-locked pulsing is off (the default on slow songs without
 * heavy beats, unless the brief asks for pulsing). Keep lyrics out of
 * anything it scales.
 */
export const useEnergySwell = (options: EnergySwellOptions = {}): number => {
  const analysis = useAudioAnalysis();
  const frame = useSongFrame();
  const {fps} = useVideoConfig();
  return energySwellAt(analysis, frame, fps, options);
};
