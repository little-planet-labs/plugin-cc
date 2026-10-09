// Loads and validates the generated data files once, at module load.
import rawAnalysis from '../data/audio-analysis.json';
import rawDefaultAnalysis from '../data/audio-analysis.default.json';
import rawLyrics from '../data/lyrics.json';
import rawOverrides from '../data/timing-overrides.json';
import rawSections from '../data/sections.json';
import {
  applyTimingOverrides,
  parseAudioAnalysis,
  parseTimingOverrides,
  withBeatGridFallback,
  type AudioAnalysis,
} from './analysis-schema';
import {parseLyrics, type LyricLine} from './lyrics-schema';
import {parseSections, type SectionSpec} from './sections';

/** Analysis exactly as written by `pnpm analyze` (or the no-track default). */
export const rawAudioAnalysis: AudioAnalysis = parseAudioAnalysis(rawAnalysis);

export const timingOverrides = parseTimingOverrides(rawOverrides);

/**
 * Analysis scenes read: the raw analysis with timing-overrides.json applied
 * (only when a track was analyzed; overrides describe that track), plus a
 * steady beat grid when no beats were detected.
 */
export const audioAnalysis: AudioAnalysis = withBeatGridFallback(
  rawAudioAnalysis.source === null ? rawAudioAnalysis : applyTimingOverrides(rawAudioAnalysis, timingOverrides),
);

/** The no-track default (60s, 120 BPM grid, silent), used when the analysis doesn't match the audio on disk. */
export const fallbackAudioAnalysis: AudioAnalysis = withBeatGridFallback(parseAudioAnalysis(rawDefaultAnalysis));

export const lyrics: readonly LyricLine[] = parseLyrics(rawLyrics);

/** Which scene plays when (src/data/sections.json), validated. Placed onto frames by the composition. */
export const sections: readonly SectionSpec[] = parseSections(rawSections);
