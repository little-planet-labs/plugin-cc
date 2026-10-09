import {createContext, useContext, useMemo} from 'react';
import {Internals, useVideoConfig} from 'remotion';
import type {AudioAnalysis, EnergyBand} from './analysis-schema';
import {audioAnalysis, lyrics} from './data';
import {getLineById, getLineState, type LineState} from './lyric-timing';
import {findActiveLine, findActiveWordIndex, type LyricLine} from './lyrics-schema';
import type {PlacedSection} from './sections';
import {
  beatFramesBetween,
  downbeatFramesBetween,
  frameToSeconds,
  framesSinceEvent,
  getBeatState,
  getEnergyAt,
  type BeatState,
} from './timing';

/**
 * The analysis the beat/energy hooks read. Defaults to the loaded analysis; the
 * composition swaps in the fallback when the analysis doesn't match the audio.
 */
export const AudioAnalysisContext = createContext<AudioAnalysis>(audioAnalysis);

export const useAudioAnalysis = (): AudioAnalysis => useContext(AudioAnalysisContext);

/**
 * Absolute frame in the song, whatever <Sequence>/<Series>/<Loop>/<TransitionSeries>
 * the caller sits in (useCurrentFrame() is relative to the nearest one). Inside
 * <Freeze> it returns the frozen frame, so frozen visuals stay frozen.
 *
 * Uses Remotion's Internals.useTimelinePosition(), which is exactly what
 * useCurrentFrame() subtracts the sequence offset from
 * (remotion/dist/cjs/use-current-frame.js). It's an internal API: remotion is
 * pinned exactly, and tests/hooks.test.tsx pins this behavior. Re-run the tests
 * on every Remotion upgrade.
 */
export const useSongFrame = (): number => Internals.useTimelinePosition();

/** Current song time in seconds. */
export const useSongTime = (): number => {
  const {fps} = useVideoConfig();
  return frameToSeconds(useSongFrame(), fps);
};

/** Beat index, phase 0..1, on-beat / on-downbeat flags and bar position for the current frame. */
export const useBeat = (): BeatState => {
  const {fps} = useVideoConfig();
  return getBeatState(useAudioAnalysis(), useSongFrame(), fps);
};

/** Normalized 0..1 energy of a band at the current frame (0 with no track). */
export const useEnergy = (band: EnergyBand, options?: {smoothFrames?: number}): number =>
  getEnergyAt(useAudioAnalysis(), band, useSongFrame(), options?.smoothFrames);

/** Frames since the last detected onset (transient); Infinity before the first. */
export const useFramesSinceOnset = (): number => {
  const {fps} = useVideoConfig();
  return framesSinceEvent(useAudioAnalysis().onsets, useSongFrame(), fps);
};

/**
 * The lyric lines the lyric hooks read. Defaults to src/data/lyrics.json;
 * tests (or a preview) can provide other lines.
 */
export const LyricsContext = createContext<readonly LyricLine[]>(lyrics);

/** The lyric lines in effect (lyrics.json unless a LyricsContext provider overrides it). */
export const useLyrics = (): readonly LyricLine[] => useContext(LyricsContext);

export type ActiveLyric = {line: LyricLine; index: number; wordIndex: number};

/**
 * The lyric line active right now, or null between lines. `wordIndex` is the
 * word whose [start, end) CONTAINS the current time: -1 without word timing
 * and -1 in the gaps between words.
 *
 * Index semantics differ from useLine: useLine(id).activeWordIndex is the
 * LAST WORD THAT HAS STARTED (it never drops back to -1 in a gap, and works
 * with estimated word timing). Scenes revealing words cumulatively should use
 * useLine; use useLyric().wordIndex only to highlight the word being sung.
 */
export const useLyric = (): ActiveLyric | null => {
  const lines = useLyrics();
  const t = useSongTime();
  const active = findActiveLine(lines, t);
  return active ? {...active, wordIndex: findActiveWordIndex(active.line, t)} : null;
};

/**
 * Timing of lyric line `id` (ids as in lyrics.json) at the current frame, in
 * ABSOLUTE song frames, whatever <Sequence> nesting the caller is in:
 * `{line, words, startFrame, endFrame, wordFrames, activeWordIndex, progress, isActive}`.
 * `words` are aligned word timings, or estimates from the text when the line
 * has none (see lineWords). Feed `wordFrames[i].start` to a kinetic
 * component's `at` to land word i on its sung frame.
 *
 * `activeWordIndex` is the index of the last word whose start frame <= now
 * (-1 before the first word; stays on the last word after the line), NOT the
 * word containing now as in useLyric().wordIndex. See useLyric.
 *
 * Throws (naming the id) when lyrics.json has no such line. Use
 * useLineOrNull while lyric data may be missing.
 */
export const useLine = (id: string): LineState => {
  const lines = useLyrics();
  const {fps} = useVideoConfig();
  const state = getLineState(lines, id, useSongFrame(), fps);
  if (state === null) {
    getLineById(lines, id); // throws, naming the missing id
    throw new Error(`Lyric line "${id}" is missing`);
  }
  return state;
};

/** Like useLine, but returns null when lyrics.json has no line `id`, so a scene can degrade gracefully. */
export const useLineOrNull = (id: string): LineState | null => {
  const lines = useLyrics();
  const {fps} = useVideoConfig();
  return getLineState(lines, id, useSongFrame(), fps);
};

/**
 * The beats and downbeats that land inside `section`'s frames, as ABSOLUTE
 * song frames: exactly those whose rounded frame f satisfies
 * section.from <= f < section.from + section.durationInFrames (the frames its
 * <Sequence> renders), from the analysis in effect. Use them as kinetic
 * components' `at` to hit on the beat.
 */
export const useSectionBeats = (section: PlacedSection): {beats: number[]; downbeats: number[]} => {
  const analysis = useAudioAnalysis();
  const {fps} = useVideoConfig();
  const {from, durationInFrames} = section;
  return useMemo(
    () => ({
      beats: beatFramesBetween(analysis, from, from + durationInFrames, fps),
      downbeats: downbeatFramesBetween(analysis, from, from + durationInFrames, fps),
    }),
    [analysis, from, durationInFrames, fps],
  );
};
