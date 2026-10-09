// Addressing lyric lines by id and turning their timing into frames. Pure (no
// runtime imports besides the schema) so Node's test runner loads it directly.
// The hooks useLine / useLineOrNull (./hooks.ts) are thin wrappers over
// getLineState.
import type {LyricLine, LyricWord} from './lyrics-schema';

/**
 * Lyric line ids come from `pnpm align`: `<section id>-<n>`, numbered from 1
 * within each section of creative/lyrics.screen.txt (for example "verse-1-3",
 * "chorus-2-1", "intro-1"). Read the ids in src/data/lyrics.json; they change
 * when the lyric sections change.
 */

/** The line with `id`; throws an Error naming the id when it's missing. */
export const getLineById = (lines: readonly LyricLine[], id: string): LyricLine => {
  const line = lines.find((l) => l.id === id);
  if (!line) {
    throw new Error(`Lyric line "${id}" is not in lyrics.json (${lines.length} lines loaded).`);
  }
  return line;
};

/**
 * The line's words with timing. Returns `line.words` unchanged when the line
 * has aligned word timing. Otherwise ESTIMATES it: the whitespace-separated
 * tokens of `line.text`, with spans that tile [start, end] exactly in
 * proportion to each token's character count (punctuation counts).
 *
 * Invariant: for text with single spaces between tokens and none at the ends,
 * the tokens joined by ' ' equal `line.text`. An empty or blank text gives [].
 */
export const lineWords = (line: LyricLine): LyricWord[] => {
  if (line.words) return line.words;
  const tokens = line.text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const total = tokens.reduce((n, t) => n + t.length, 0);
  const span = line.end - line.start;
  let chars = 0;
  return tokens.map((text, i) => {
    const start = i === 0 ? line.start : line.start + (span * chars) / total;
    chars += text.length;
    const end = i === tokens.length - 1 ? line.end : line.start + (span * chars) / total;
    return {text, start, end};
  });
};

/** A line's timing at one frame, all in ABSOLUTE song frames. */
export type LineState = {
  line: LyricLine;
  /** `lineWords(line)`: aligned words, or estimated ones. */
  words: LyricWord[];
  /** Math.round(line.start * fps). */
  startFrame: number;
  /** Math.round(line.end * fps). */
  endFrame: number;
  /** Each word's [start, end) in absolute song frames (Math.round(sec * fps)), parallel to `words`. */
  wordFrames: {start: number; end: number}[];
  /** Index of the last word whose start frame <= the current frame; -1 before the first word. Stays on the last word after the line ends. */
  activeWordIndex: number;
  /** 0..1 from startFrame to endFrame, clamped (0 before, 1 after). */
  progress: number;
  /** startFrame <= frame < endFrame. */
  isActive: boolean;
};

/** Pure core of useLine: the state of line `id` at absolute song `frame`, or null when no line has that id. */
export const getLineState = (
  lines: readonly LyricLine[],
  id: string,
  frame: number,
  fps: number,
): LineState | null => {
  const line = lines.find((l) => l.id === id);
  if (!line) return null;
  const words = lineWords(line);
  const toFrame = (s: number) => Math.round(s * fps);
  const startFrame = toFrame(line.start);
  const endFrame = toFrame(line.end);
  const wordFrames = words.map((w) => ({start: toFrame(w.start), end: toFrame(w.end)}));
  let activeWordIndex = -1;
  wordFrames.forEach((w, i) => {
    if (w.start <= frame) activeWordIndex = i;
  });
  const length = endFrame - startFrame;
  const raw = length > 0 ? (frame - startFrame) / length : frame >= startFrame ? 1 : 0;
  const progress = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return {
    line,
    words,
    startFrame,
    endFrame,
    wordFrames,
    activeWordIndex,
    progress,
    isActive: frame >= startFrame && frame < endFrame,
  };
};
