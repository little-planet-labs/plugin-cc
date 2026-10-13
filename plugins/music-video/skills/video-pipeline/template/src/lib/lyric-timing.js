// Addressing lyric lines by id and turning their timing into frames. Pure ES
// module (no DOM, no node: imports): the page and the Node scripts both import it.

/** @typedef {import('./lyrics.js').LyricLine} LyricLine */
/** @typedef {import('./lyrics.js').LyricWord} LyricWord */

/**
 * Lyric line ids come from `pnpm align`: `<section id>-<n>`, numbered from 1
 * within each section of creative/lyrics.screen.txt (for example "verse-1-3",
 * "chorus-2-1", "intro-1"). Read the ids in src/data/lyrics.json; they change
 * when the lyric sections change.
 */

/**
 * The line with `id`; throws an Error naming the id when it's missing.
 * @param {readonly LyricLine[]} lines
 * @param {string} id
 * @returns {LyricLine}
 */
export const getLineById = (lines, id) => {
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
 * @param {LyricLine} line
 * @returns {LyricWord[]}
 */
export const lineWords = (line) => {
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

/**
 * A line's timing at one frame, all in ABSOLUTE song frames.
 * @typedef {object} LineState
 * @property {LyricLine} line
 * @property {LyricWord[]} words `lineWords(line)`: aligned words, or estimated ones.
 * @property {number} startFrame Math.round(line.start * fps).
 * @property {number} endFrame Math.round(line.end * fps).
 * @property {{start: number, end: number}[]} wordFrames Each word's [start, end) in absolute song frames
 *   (Math.round(sec * fps)), parallel to `words`.
 * @property {number} activeWordIndex Index of the last word whose start frame <= the current frame;
 *   -1 before the first word. Stays on the last word after the line ends.
 * @property {number} progress 0..1 from startFrame to endFrame, clamped (0 before, 1 after).
 * @property {boolean} isActive startFrame <= frame < endFrame.
 */

/**
 * The state of line `id` at absolute song `frame`, or null when no line has that id.
 * @param {readonly LyricLine[]} lines
 * @param {string} id
 * @param {number} frame
 * @param {number} fps
 * @returns {LineState | null}
 */
export const getLineState = (lines, id, frame, fps) => {
  const line = lines.find((l) => l.id === id);
  if (!line) return null;
  const words = lineWords(line);
  const toFrame = (s) => Math.round(s * fps);
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
