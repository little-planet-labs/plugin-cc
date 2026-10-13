// Lyric line schedules: when each word is revealed, settles, starts its exit
// and is gone, with the exit-compression rule. Pure ES module (no DOM, no
// node: imports). The engine draws lines from these schedules and exposes them
// as window.__mv.lines().
//
// The rule: a line's exit ends at least EXIT_GAP_FRAMES (2) frames before the
// next line's first word (the line after its pair, when two lines are shown
// together with pairWith), before `exitBy`, and before the end of the video.
// If the requested exit (exitAt, plus exit length and stagger) doesn't fit, it
// is re-anchored to end exactly on that bound, starting earlier but never
// before each word has settled; if even that can't fit, exit length and
// stagger shrink together; with no room at all the line cuts on the bound.
// No word's exit ever starts before that word was revealed, and every word is
// on screen for at least its reveal frame whenever the bound leaves a frame
// after the reveal (a word revealed too late for that is never shown, and the
// page warns at boot). Ported from the
// old template's maskedExitPlan and the earlier adaptation's showLine.
import {lineWords} from './lyric-timing.js';
import {enterSettle} from './text-motion.js';

/** The line is gone this many frames before the next line's first word. */
export const EXIT_GAP_FRAMES = 2;
/**
 * A word's entrance clock starts this many frames before its reveal (while it is still hidden), so on its reveal
 * frame the entrance is already under way and the word shows, instead of sitting at progress 0 (often opacity 0).
 */
export const ENTER_LEAD_FRAMES = 1;

/** The shortest exit worth playing; below it the exit collapses to a cut. */
export const MIN_EXIT_FRAMES = 2;

/** Default exit length (s), stagger between words' exit starts (s), and linger after the last sung word (s). */
export const DEFAULT_EXIT_DUR = 0.35;
export const DEFAULT_EXIT_STAGGER = 0.035;
export const DEFAULT_LINGER = 1.0;

const EPS = 1e-9;

/**
 * @typedef {{start: number, end: number, dur: number}} WordExit A word's exit starts at `start` (s) and it is gone from
 *   `end` (dur = end - start; 0: a cut). `end` is computed so it never exceeds the bound, exactly (no float hair).
 */

/**
 * Exit timing for one line's words (all seconds).
 * @param {object} input
 * @param {readonly number[]} input.reveals Reveal time of each word, ascending.
 * @param {readonly number[]} input.settled Time each word is fully settled.
 * @param {number} input.exitAt Requested exit start (Infinity: as late as the bound allows).
 * @param {number} input.exitDur Exit length per word (0: a cut).
 * @param {number} input.stagger Time between two words' exit starts.
 * @param {number} input.end The bound: nothing of the line is visible from here.
 * @param {number} input.fps
 * @returns {WordExit[]}
 */
export const exitPlan = ({reveals, settled, exitAt, exitDur, stagger, end, fps}) => {
  const n = reveals.length;
  const X = Math.max(0, exitDur);
  const G = Math.max(0, stagger);
  if (!Number.isFinite(end) && !Number.isFinite(exitAt)) return reveals.map(() => ({start: Infinity, end: Infinity, dur: 0}));
  const word = (start, stop) => {
    const e = Math.min(stop, end);
    const s0 = Math.min(start, e);
    return {start: s0, end: e, dur: e - s0};
  };

  // Every word stays on screen for its reveal frame: its exit may not start before the reveal, nor end before
  // reveal + 1 frame. Applied here, before any fitting, and as the lower bound of the hold stage below, so neither a
  // requested exit (even a zero-length cut at or before a reveal) nor compression can hide a word on its own frame.
  const frame = 1 / fps;

  // 1. The requested exit, moved later until every word has its reveal frame.
  if (Number.isFinite(exitAt)) {
    let s0 = exitAt;
    reveals.forEach((r, k) => {
      s0 = Math.max(s0, r - k * G, r + frame - k * G - X);
    });
    if (s0 + X + (n - 1) * G <= end + EPS) return reveals.map((_, k) => word(s0 + k * G, s0 + k * G + X));
  }

  // 2. Anchored on the bound: word k leaves over [E - cX - (n-1-k)cG, E - (n-1-k)cG). The last word's end is E itself.
  const minExit = X > 0 ? Math.min(X, MIN_EXIT_FRAMES / fps) : 0;
  const plan = (c, cutAtEnd) =>
    reveals.map((_, k) => {
      if (cutAtEnd(k)) return {start: end, end, dur: 0};
      const stop = k === n - 1 ? end : end - (n - 1 - k) * c * G;
      return word(stop - c * X, stop);
    });
  const fit = (lower, skip) => {
    let c = 1;
    lower.forEach((low, k) => {
      if (skip(k)) return;
      const span = X + (n - 1 - k) * G;
      if (span > 0) c = Math.min(c, (end - low) / span);
      else if (low > end + EPS) c = -1;
    });
    return c;
  };
  const accept = (c) => c >= 0 && c * X >= minExit - EPS;
  const never = () => false;
  // 2a. Hold every word until it has settled (and at least its reveal frame, for an instant entrance).
  const c1 = fit(
    settled.map((st, k) => Math.max(st, reveals[k] + frame)),
    never,
  );
  if (accept(c1)) return plan(c1, never);
  // 2b. Hold every word at least one frame after its reveal; words revealed too late cut on the bound.
  const late = (k) => reveals[k] + 1 / fps > end - minExit + EPS;
  const c2 = fit(
    reveals.map((r) => r + 1 / fps),
    late,
  );
  if (accept(c2)) return plan(c2, late);
  // 3. No room for an exit: cut on the bound.
  return plan(0, () => true);
};

/**
 * @typedef {object} LineOptions What a scene passes to ctx.lyric() that affects timing.
 * @property {string} [enter] Entrance kind (text-motion.js ENTRANCES).
 * @property {number} [enterDur]
 * @property {import('./springs.js').SpringSpec} [spring]
 * @property {string} [exit] Exit kind ('cut' means no exit animation).
 * @property {number} [exitDur] Seconds per word. Default DEFAULT_EXIT_DUR.
 * @property {number} [stagger] Seconds between words' exit starts. Default DEFAULT_EXIT_STAGGER.
 * @property {number | 'hold'} [exitAt] Requested exit start (s); 'hold' keeps the line until the bound.
 *   Default: last sung word's end + linger (the paired line's, with pairWith).
 * @property {number} [linger] Seconds the line stays after its last word is sung. Default DEFAULT_LINGER.
 * @property {number} [exitBy] Absolute seconds the line must be gone by (to clear ahead of a world event).
 * @property {string} [pairWith] Id of the NEXT line, shown together with this one; this line then
 *   clears for the line after it.
 * @property {number} [lead] Seconds to reveal every word ahead of its sung start. Default 0.
 */

/**
 * @typedef {object} WordSchedule
 * @property {string} text
 * @property {number} reveal
 * @property {number} settled
 * @property {number} exitStart
 * @property {number} exitDur
 * @property {number} exitEnd When this word is gone (exitStart + exitDur, never past the line's bound).
 * @property {number} sung Seconds the word is sung (end - start).
 *
 * @typedef {object} LineSchedule
 * @property {string} id
 * @property {number} first First word's reveal.
 * @property {number} settled When the last word is fully settled (held text from here).
 * @property {number} exitStart When the first word starts its exit.
 * @property {number} exitEnd When the last word is gone.
 * @property {number | null} next The next line's first word (after the pair), or null.
 * @property {WordSchedule[]} words
 */

const snap = (t, fps) => Math.round(t * fps) / fps;

/**
 * Schedule every registered line. Reveal times are word starts snapped to the
 * frame grid (minus `lead`), so a word appears on the frame it is sung.
 * Unregistered lines are not scheduled but still bound the line before them.
 * Throws naming the line when pairWith doesn't name the line right after it.
 * @param {readonly import('./lyrics.js').LyricLine[]} lines All lyric lines in order, each with an id.
 * @param {ReadonlyMap<string, LineOptions>} registrations
 * @param {{fps: number, duration: number}} video
 * @returns {Map<string, LineSchedule>}
 */
export const scheduleLines = (lines, registrations, {fps, duration}) => {
  const words = lines.map((l) => lineWords(l));
  const reveals = lines.map((l, i) => {
    const lead = registrations.get(l.id)?.lead ?? 0;
    return words[i].map((w) => snap(Math.max(0, w.start - lead), fps));
  });
  const out = new Map();
  lines.forEach((line, i) => {
    const opts = registrations.get(line.id);
    if (!opts || words[i].length === 0) return;
    let nextIndex = i + 1;
    let lastSungEnd = words[i][words[i].length - 1].end;
    if (opts.pairWith !== undefined) {
      if (lines[i + 1]?.id !== opts.pairWith) {
        throw new Error(
          `lyric "${line.id}": pairWith "${opts.pairWith}" must name the next line in lyrics.json` +
            ` (${lines[i + 1] ? `"${lines[i + 1].id}"` : 'there is none'})`,
        );
      }
      nextIndex = i + 2;
      const pw = words[i + 1];
      if (pw.length > 0) lastSungEnd = pw[pw.length - 1].end;
    }
    let next = null;
    for (let j = nextIndex; j < lines.length && next === null; j++) if (reveals[j].length > 0) next = reveals[j][0];
    // The bound is frame k - 2 of the next line's first word (frame k). Its two float spellings, next - 2 / fps and
    // (k - 2) / fps, can differ in the last bit either way; taking the smaller keeps exitEnd <= both exactly, so the
    // line is gone on frame k - 2 whichever way a caller computes it.
    const gap = next === null ? Infinity : Math.min(next - EXIT_GAP_FRAMES / fps, (Math.round(next * fps) - EXIT_GAP_FRAMES) / fps);
    const end = Math.min(gap, opts.exitBy ?? Infinity, duration);
    const cut = opts.exit === 'cut';
    const exitAt = opts.exitAt === 'hold' ? Infinity : (opts.exitAt ?? lastSungEnd + (opts.linger ?? DEFAULT_LINGER));
    const sung = words[i].map((w) => w.end - w.start);
    // Never before the reveal: an entrance that settles within the lead frame (enter 'none', a tiny enterDur, 'type'
    // at low fps) is held from its reveal, so the hold window never starts before the word is on screen.
    const settled = reveals[i].map((r, k) => Math.max(r, r - ENTER_LEAD_FRAMES / fps + enterSettle(opts, sung[k])));
    const plan = exitPlan({
      reveals: reveals[i],
      settled,
      exitAt,
      exitDur: cut ? 0 : (opts.exitDur ?? DEFAULT_EXIT_DUR),
      stagger: cut ? 0 : (opts.stagger ?? DEFAULT_EXIT_STAGGER),
      end,
      fps,
    });
    out.set(line.id, {
      id: line.id,
      first: reveals[i][0],
      settled: Math.max(...settled),
      exitStart: Math.min(...plan.map((p) => p.start)),
      exitEnd: Math.max(...plan.map((p) => p.end)),
      next,
      words: words[i].map((w, k) => ({
        text: w.text,
        reveal: reveals[i][k],
        settled: settled[k],
        exitStart: plan[k].start,
        exitDur: plan[k].dur,
        exitEnd: plan[k].end,
        sung: sung[k],
      })),
    });
  });
  return out;
};

/**
 * @typedef {object} PublicWord
 * @property {number} index Word index within the line (the `data-word` of its `.wm` mask).
 * @property {string} text
 * @property {number} reveal First frame time the word shows.
 * @property {number} settled From here the word is held (no transform, filter or opacity change).
 * @property {number} exitStart The word is held until here: its hold window is [settled, exitStart), which may be
 *   empty or negative when its exit starts before it settles (reported as is).
 * @property {number} exitEnd The word is gone from here.
 *
 * @typedef {{id: string, first: number, settled: number, exitStart: number, exitEnd: number, next: number | null,
 *   words: PublicWord[]}} PublicLine
 */

/**
 * The schedules as window.__mv.lines() reports them (seconds): the line-level fields, plus each word's own schedule,
 * from the same scheduleLines output the page draws.
 * @param {Iterable<LineSchedule>} schedules
 * @returns {PublicLine[]}
 */
export const publicSchedules = (schedules) =>
  [...schedules].map(({id, first, settled, exitStart, exitEnd, next, words}) => ({
    id,
    first,
    settled,
    exitStart,
    exitEnd,
    next,
    words: words.map((w, index) => ({index, text: w.text, reveal: w.reveal, settled: w.settled, exitStart: w.exitStart, exitEnd: w.exitEnd})),
  }));
