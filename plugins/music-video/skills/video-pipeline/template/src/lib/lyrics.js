// Shape of src/data/lyrics.json: an array of lines with times in seconds from
// the start of the track. Per-word timing is optional. Pure ES module (no DOM,
// no node: imports): the page and the Node scripts both import it.

/**
 * @typedef {object} LyricWord
 * @property {string} text
 * @property {number} start Seconds from track start.
 * @property {number} end Seconds from track start; > start.
 *
 * @typedef {object} LyricLine
 * @property {string} [id] Stable id scenes address the line by: `<section id>-<n>` as written by
 *   `pnpm align` (e.g. "chorus-1-2"; see ./lyric-timing.js). Optional so hand-written, id-less data
 *   still parses; ids must be non-empty and unique.
 * @property {string} text
 * @property {number} start Seconds from track start.
 * @property {number} end Seconds from track start; > start.
 * @property {LyricWord[]} [words] Per-word timing, when aligned. Words are ascending and non-overlapping
 *   and lie within [start, end], give or take WORD_SPAN_TOLERANCE seconds.
 */

/**
 * How far (seconds) a word may poke outside its line's [start, end] before
 * parseLyrics rejects it. Forced aligners place line and word boundaries
 * independently, so a few frames of disagreement are normal; more than this
 * means the line or the word is misplaced.
 */
export const WORD_SPAN_TOLERANCE = 0.05;

/** Word overlap allowed (seconds): JSON times are rounded to the millisecond. */
const WORD_OVERLAP_EPSILON = 1e-3;

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @returns {LyricWord} */
const parseSpan = (raw, path) => {
  if (!isRecord(raw)) throw new Error(`lyrics.json: ${path} must be an object`);
  const {text, start, end} = raw;
  if (typeof text !== 'string') throw new Error(`lyrics.json: ${path}.text must be a string`);
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
    throw new Error(`lyrics.json: ${path}.start must be a number >= 0 (seconds)`);
  }
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) {
    throw new Error(`lyrics.json: ${path}.end must be a number > start (seconds)`);
  }
  return {text, start, end};
};

/**
 * Validate raw JSON into lyric lines. Lines must be sorted by start and not
 * overlap. `id`, when present, must be a non-empty string unique across the
 * file. `words`, when present, must be ascending, non-overlapping, and inside
 * the line's [start, end] within WORD_SPAN_TOLERANCE.
 * @param {unknown} raw
 * @returns {LyricLine[]}
 */
export const parseLyrics = (raw) => {
  if (!Array.isArray(raw)) throw new Error('lyrics.json: root must be an array');
  /** @type {LyricLine[]} */
  const lines = [];
  const idIndex = new Map();
  raw.forEach((item, i) => {
    const path = `[${i}]`;
    const span = parseSpan(item, path);
    const prev = lines[lines.length - 1];
    if (prev && span.start < prev.end) {
      throw new Error(`lyrics.json: ${path} starts before line ${i - 1} ends; lines must be sorted and non-overlapping`);
    }
    /** @type {LyricLine} */
    const line = {text: span.text, start: span.start, end: span.end};
    if (item.id !== undefined) {
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        throw new Error(`lyrics.json: ${path}.id must be a non-empty string`);
      }
      const dup = idIndex.get(item.id);
      if (dup !== undefined) {
        throw new Error(`lyrics.json: ${path}.id "${item.id}" duplicates [${dup}].id; ids must be unique`);
      }
      idIndex.set(item.id, i);
      line.id = item.id;
    }
    const rawWords = item.words;
    if (rawWords !== undefined) {
      if (!Array.isArray(rawWords)) throw new Error(`lyrics.json: ${path}.words must be an array`);
      const words = rawWords.map((w, j) => parseSpan(w, `${path}.words[${j}]`));
      words.forEach((w, j) => {
        const wPath = `${path}.words[${j}]`;
        if (w.start < span.start - WORD_SPAN_TOLERANCE || w.end > span.end + WORD_SPAN_TOLERANCE) {
          throw new Error(
            `lyrics.json: ${wPath} (${w.start}-${w.end}s) must lie within the line span ${span.start}-${span.end}s ` +
              `(tolerance ${WORD_SPAN_TOLERANCE}s)`,
          );
        }
        const prevWord = words[j - 1];
        if (prevWord && w.start < prevWord.end - WORD_OVERLAP_EPSILON) {
          throw new Error(
            `lyrics.json: ${wPath} starts at ${w.start}s, before words[${j - 1}] ends (${prevWord.end}s); ` +
              'words must be ascending and non-overlapping',
          );
        }
      });
      line.words = words;
    }
    lines.push(line);
  });
  return lines;
};

/**
 * The line whose [start, end) contains `seconds`, with its index; null between lines.
 * @param {readonly LyricLine[]} lines
 * @param {number} seconds
 * @returns {{line: LyricLine, index: number} | null}
 */
export const findActiveLine = (lines, seconds) => {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (seconds < line.start) hi = mid - 1;
    else if (seconds >= line.end) lo = mid + 1;
    else return {line, index: mid};
  }
  return null;
};

/**
 * Index of the word in `line` whose [start, end) contains `seconds`, or -1.
 * @param {LyricLine} line
 * @param {number} seconds
 * @returns {number}
 */
export const findActiveWordIndex = (line, seconds) =>
  line.words?.findIndex((w) => seconds >= w.start && seconds < w.end) ?? -1;
