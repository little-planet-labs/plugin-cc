// Lyric word poses: how a word enters, holds and leaves, as plain style values.
// Pure ES module (no DOM, no node: imports); src/engine/text.js writes these
// onto the word elements on every seek.
//
// The masked rise comes from the howseen-ai/claude-motion-design skill (MIT,
// see NOTICE.md). The rest of the entrance and exit vocabulary, its curves and
// distances, are ported from the earlier adaptation's showLine, with
// travelling distances scaled to the page size.
import {clamp, EASE, ease as easeOf} from './ease.js';
import {spring, springSettle} from './springs.js';

export const ENTRANCES = Object.freeze(['rise', 'drop', 'slam', 'blur', 'fade', 'side', 'zoom', 'flip', 'type', 'none']);
export const EXITS = Object.freeze(['fade', 'fall', 'up', 'down', 'blur', 'scatter', 'shrink', 'left', 'right', 'cut', 'suck']);

/**
 * @typedef {object} WordPose
 * @property {string} transform CSS transform ('none' when held).
 * @property {number} opacity 0..1 (exactly 1 when held).
 * @property {string} filter CSS filter ('none' when held).
 * @property {boolean} clip Whether the word is clipped to its mask box.
 * @property {number | null} chars For the 'type' entrance: how many characters show; null otherwise.
 */

/** A settled word: no transform, no filter, full opacity, unclipped. */
export const HELD = Object.freeze({transform: 'none', opacity: 1, filter: 'none', clip: false, chars: null});

/**
 * @typedef {object} EnterStyle
 * @property {string} [enter] One of ENTRANCES. Default 'rise'.
 * @property {number} [enterDur] Seconds per word. Default 0.42 (ignored with `spring` and by 'type').
 * @property {string | ((u: number) => number)} [enterEase] Default 'o5'.
 * @property {import('./springs.js').SpringSpec} [spring] Drive the entrance with this spring instead of the easing.
 */

/** Seconds per character group for the 'type' entrance: 80% of the sung word, 0.06..0.5 s. */
const typeDur = (wordDur) => Math.max(0.06, Math.min(0.5, wordDur * 0.8));

/**
 * Seconds from a word's reveal until it is fully settled (held from then on).
 * @param {EnterStyle} style
 * @param {number} wordDur The sung word's length in seconds.
 * @returns {number}
 */
export const enterSettle = (style, wordDur) => {
  const kind = style.enter ?? 'rise';
  if (kind === 'none') return 0;
  if (kind === 'type') return typeDur(wordDur);
  if (style.spring !== undefined) return springSettle(style.spring);
  return style.enterDur ?? 0.42;
};

/**
 * Entrance progress (0..1) `dt` seconds after the reveal: exactly 1 from the
 * settle time.
 * @param {EnterStyle} style
 * @param {number} dt
 * @param {number} wordDur
 * @returns {number}
 */
export const enterProgress = (style, dt, wordDur) => {
  const settle = enterSettle(style, wordDur);
  if (dt >= settle) return 1;
  if (dt < 0) return 0;
  if (style.spring !== undefined && style.enter !== 'type') return Math.min(1, spring(dt, 0, style.spring));
  return easeOf(style.enterEase, 'o5')(dt / settle);
};

const f = (v, d = 3) => v.toFixed(d);

/**
 * A word's opacity on its reveal frame, `lead` seconds into its entrance (the
 * engine starts entrances one frame before the reveal). A slow-in easing at a
 * high frame rate can leave this near 0, so a word on screen for only that
 * frame would not show.
 * @param {EnterStyle} style
 * @param {number} wordDur
 * @param {number} lead Seconds.
 * @returns {number}
 */
export const revealFrameOpacity = (style, wordDur, lead) => {
  const kind = style.enter ?? 'rise';
  const u = enterProgress(style, lead, wordDur);
  return enterPose(kind, u, {dt: lead, wordDur, chars: 1}).opacity;
};

/**
 * A word's pose during its entrance, at progress u (0 <= u < 1) and `dt`
 * seconds after its reveal. `chars` is the word's character count (for 'type').
 * At u >= 1 the pose is HELD.
 * @param {string} kind One of ENTRANCES.
 * @param {number} u
 * @param {{dt: number, wordDur: number, chars: number}} word
 * @returns {WordPose}
 */
export const enterPose = (kind, u, {dt, wordDur, chars}) => {
  if (kind === 'type') {
    const d = typeDur(wordDur);
    const shown = dt >= d ? chars : Math.min(chars, Math.floor((dt / d) * chars) + 1);
    return shown >= chars ? HELD : {...HELD, chars: shown};
  }
  if (u >= 1 || kind === 'none') return HELD;
  const w = 1 - u;
  switch (kind) {
    case 'rise':
      return {transform: `translateY(${f(w * 60)}%) rotate(${f(w * 4)}deg)`, opacity: clamp(u * 1.6), filter: 'none', clip: true, chars: null};
    case 'drop':
      return {transform: `translateY(${f(-w * 28)}%)`, opacity: clamp(u * 1.4), filter: 'none', clip: false, chars: null};
    case 'slam':
      return {
        transform: `scale(${f(1 + w * 0.22, 4)})`,
        opacity: clamp(u * 3),
        filter: u < 0.6 ? `blur(${f((1 - u / 0.6) * 10, 2)}px)` : 'none',
        clip: false,
        chars: null,
      };
    case 'blur':
      return {transform: `scale(${f(1 + w * 0.03, 4)})`, opacity: u, filter: `blur(${f(w * 14, 2)}px)`, clip: false, chars: null};
    case 'fade':
      return {transform: 'none', opacity: u, filter: 'none', clip: false, chars: null};
    case 'side':
      return {transform: `translateX(${f(w * -60)}px)`, opacity: u, filter: `blur(${f(w * 6, 2)}px)`, clip: false, chars: null};
    case 'zoom':
      return {transform: `scale(${f(0.4 + 0.6 * u, 4)})`, opacity: clamp(u * 2), filter: 'none', clip: false, chars: null};
    case 'flip':
      return {transform: `perspective(700px) rotateX(${f(w * -100)}deg)`, opacity: clamp(u * 4), filter: 'none', clip: false, chars: null};
    default:
      throw new Error(`unknown entrance "${kind}"; use one of ${ENTRANCES.join(', ')}`);
  }
};

/**
 * A word's pose during its exit at progress v (0 < v < 1). r1, r2 are the
 * word's seeded randoms in [-1, 1]; sx, sy scale travelling distances (page
 * width / 1920, height / 1080); for 'suck', (dx, dy) is the vector from the
 * word's centre to the target point.
 * @param {string} kind One of EXITS.
 * @param {number} v
 * @param {{r1: number, r2: number, sx: number, sy: number, dx?: number, dy?: number}} word
 * @returns {WordPose}
 */
export const exitPose = (kind, v, {r1, r2, sx, sy, dx = 0, dy = 0}) => {
  const e = EASE.in(v);
  const base = {transform: 'none', opacity: 1, filter: 'none', clip: false, chars: null};
  switch (kind) {
    case 'fade':
      return {...base, opacity: 1 - EASE.io(v)};
    case 'fall':
      return {
        ...base,
        transform: `translate(${f(r1 * 60 * sx * e, 2)}px,${f(e * 900 * sy, 2)}px) rotate(${f(r2 * 40 * e, 2)}deg)`,
        opacity: 1 - clamp(v * 2.2),
        filter: `blur(${f(clamp(v * 3) * 12, 2)}px)`,
      };
    case 'up':
      return {...base, transform: `translateY(${f(-e * 118)}%)`, clip: true};
    case 'down':
      return {...base, transform: `translateY(${f(e * 118)}%)`, clip: true};
    case 'blur':
      return {
        ...base,
        transform: `scale(${f(1 + EASE.out(v) * 0.04, 4)})`,
        opacity: 1 - EASE.out(v),
        filter: `blur(${f(EASE.out(v) * 16, 2)}px)`,
      };
    case 'scatter':
      return {
        ...base,
        transform: `translate(${f(r1 * 700 * sx * e, 2)}px,${f(r2 * 420 * sy * e, 2)}px) rotate(${f(r2 * 70 * e, 2)}deg) scale(${f(1 - 0.5 * e)})`,
        opacity: 1 - clamp(v * 2.2),
        filter: `blur(${f(clamp(v * 3) * 12, 2)}px)`,
      };
    case 'shrink':
      return {...base, transform: `scale(${f(1 - EASE.io(v) * 0.7, 4)})`, opacity: 1 - e};
    case 'left':
      return {...base, transform: `translateX(${f(-e * 1400 * sx, 2)}px)`, opacity: 1 - clamp(v * 1.5 - 0.5)};
    case 'right':
      return {...base, transform: `translateX(${f(e * 1400 * sx, 2)}px)`, opacity: 1 - clamp(v * 1.5 - 0.5)};
    case 'cut':
      return {...base, opacity: 0};
    case 'suck':
      return {
        ...base,
        transform: `translate(${f(dx * e, 2)}px,${f(dy * e, 2)}px) rotate(${f(e * 540 * (r1 > 0 ? 1 : -1), 2)}deg) scale(${f(1 - 0.92 * e, 4)})`,
        opacity: 1 - clamp(v * 1.8 - 0.4),
        filter: `blur(${f(clamp(v * 2.5) * 10, 2)}px)`,
      };
    default:
      throw new Error(`unknown exit "${kind}"; use one of ${EXITS.join(', ')}`);
  }
};
