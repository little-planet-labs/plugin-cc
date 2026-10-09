import type {AudioAnalysis} from '../src/lib/analysis-schema';

export const FPS = 30;

/** A steady grid: `count` beats every `period` seconds from `start`, downbeats every 4th from the first. */
export const gridAnalysis = ({
  count = 40,
  period = 0.5,
  start = 0,
  beats,
  downbeats,
}: {count?: number; period?: number; start?: number; beats?: number[]; downbeats?: number[]} = {}): AudioAnalysis => {
  const b = beats ?? Array.from({length: count}, (_, i) => Math.round((start + i * period) * 1000) / 1000);
  const last = b[b.length - 1] ?? 0;
  const durationSeconds = last + 1;
  return {
    version: 1,
    source: 'audio/track.wav',
    generator: 'test',
    fps: FPS,
    durationSeconds,
    durationInFrames: Math.ceil(durationSeconds * FPS),
    tempo: 60 / period,
    beatsPerBar: 4,
    beats: b,
    downbeats: downbeats ?? b.filter((_, i) => i % 4 === 0),
    onsets: [],
    bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
    energy: {low: [], mid: [], high: []},
  };
};
