import {Fragment, type CSSProperties, type ReactNode} from 'react';
import {random, useVideoConfig} from 'remotion';
import {useLine, useLyrics, useSongFrame} from '../../lib/hooks';
import {lineWords} from '../../lib/lyric-timing';
import {clamp01} from '../../lib/motion';
import {theme} from '../../theme';
import {settleFrames, springSettled, type SpringPreset} from './springs';

/**
 * How each word leaves. 'up' / 'down' slide out inside the word's mask; the
 * travelling exits (left, right, scatter, fall, blur, shrink, suck) leave the
 * mask while they run. `{suckTo: [x, y]}` pulls every word into one point given
 * in px in the line block's own box (its content box as laid out: [0, 0] is
 * its top-left corner, before any transform), spinning 540° and shrinking to
 * 0.08 around it.
 */
export type MaskedExit = 'fade' | 'up' | 'down' | 'left' | 'right' | 'scatter' | 'fall' | 'blur' | 'shrink' | 'cut' | {suckTo: readonly [number, number]};

export type MaskedWordsProps = {
  /** Lyric line id from lyrics.json (e.g. "chorus-1-2"). */
  id: string;
  /** ABSOLUTE frame the line must be fully gone by (to clear ahead of a wipe edge). The earliest of exitBy, until and the next line's first word - 2 wins. */
  exitBy?: number;
  /** Legacy alias of exitBy: the ABSOLUTE frame from which the line renders nothing. */
  until?: number;
  /** How the words leave. Default 'fade'. */
  exit?: MaskedExit;
  /** Length of one word's exit in frames. Default round(0.3 s * fps), 9 at 30 fps. Ignored by 'cut'. */
  exitFrames?: number;
  /** Frames between two words' exit starts. Default round(0.035 s * fps), 1 at 30 fps. Ignored by 'cut': the whole line vanishes at E. */
  exitStagger?: number;
  /** Seed for the scatter and fall paths. Default the line id. */
  seed?: string;
  /** Only words [from, to) of the line, to split a line over two rows or shots. */
  range?: readonly [number, number];
  /** Minimum frames between two words' reveals when the sung starts crowd together. Default 2. */
  stagger?: number;
  /** Spring for the rise. Default 'snappy'. */
  preset?: SpringPreset;
  /** Indices (in the full line) of words drawn with `accentGradient` as a background-clip:text fill. */
  accent?: readonly number[];
  /** CSS gradient for accent words. Default primary to accent from the theme. */
  accentGradient?: string;
  /** Balanced wrapping (text-wrap: balance), so a last row never holds one stranded word. Default true. */
  balance?: boolean;
  /** Styles for the block (a centred text block). Font, size, colour and max width go here. */
  style?: CSSProperties;
  /** Extra styles for every word. */
  wordStyle?: CSSProperties;
};

/** Frames of spring that run, hidden behind the mask, before a word's reveal frame, so it is already rising there. */
const LEAD_FRAMES = 2;
/** The line is gone this many frames before the next line's first word. */
export const EXIT_GAP = 2;
/** The shortest exit worth playing; below it the exit collapses to a cut. */
const MIN_EXIT_FRAMES = 2;

/** Room the mask leaves around the line box: accents above, descenders (g j p q y) below. */
const MASK_ROOM = {top: '0.4em', side: '0.4em', bottom: '0.45em'} as const;
/** The word box reaches past its glyphs, so a background-clip:text gradient covers ascenders, accents and descenders. */
const GLYPH_ROOM = {top: '0.12em', side: '0.06em', bottom: '0.32em'} as const;

const room = (r: {top: string; side: string; bottom: string}): CSSProperties => ({
  paddingTop: r.top,
  paddingRight: r.side,
  paddingBottom: r.bottom,
  paddingLeft: r.side,
  marginTop: `-${r.top}`,
  marginRight: `-${r.side}`,
  marginBottom: `-${r.bottom}`,
  marginLeft: `-${r.side}`,
});

export type ExitPlanInput = {
  /** Reveal frame of each displayed word, in order. */
  reveals: readonly number[];
  /** Frame each displayed word's spring settles (no transform from then on). */
  settled: readonly number[];
  /** E: the frame the line must be gone by (Infinity: no exit). */
  end: number;
  /** Requested exit length per word in frames (0 = cut). */
  exitFrames: number;
  /** Requested frames between exit starts. */
  exitStagger: number;
};

/** Per displayed word: its exit starts at `start` and it is gone from `start + frames` (frames 0 = a cut). */
export type ExitPlan = {start: number; frames: number}[];

/**
 * Exit timing for one line (pure). Word k of n leaves over
 * [E - c X - (n - 1 - k) c G, E - (n - 1 - k) c G): the last word is gone
 * exactly at E, the others `c G` apart before it, and the line holds as long
 * as it can. c in (0, 1] compresses exit length X and stagger G together when
 * the hold is short:
 * 1. Largest c <= 1 with every word's exit starting at or after its settle
 *    frame, if that leaves an exit of at least 2 frames (or X when shorter).
 * 2. Otherwise the same with exits starting at least 1 frame after each
 *    word's reveal (a word revealed less than 2 frames before E just cuts at E).
 * 3. Otherwise the exit collapses to a cut: every word disappears at E.
 * No word's exit ever starts before its reveal, and nothing is visible from E.
 */
export const maskedExitPlan = ({reveals, settled, end, exitFrames, exitStagger}: ExitPlanInput): ExitPlan => {
  const n = reveals.length;
  if (!Number.isFinite(end)) return reveals.map(() => ({start: Infinity, frames: 0}));
  const X = Math.max(0, exitFrames);
  const G = Math.max(0, exitStagger);
  const minExit = X > 0 ? Math.min(X, MIN_EXIT_FRAMES) : 0;
  const plan = (c: number, cutAtEnd: (k: number) => boolean): ExitPlan =>
    reveals.map((_, k) => (cutAtEnd(k) ? {start: end, frames: 0} : {start: end - c * X - (n - 1 - k) * c * G, frames: c * X}));
  const fit = (lower: readonly number[], skip: (k: number) => boolean): number => {
    let c = 1;
    lower.forEach((low, k) => {
      if (skip(k)) return;
      const span = X + (n - 1 - k) * G;
      if (span > 0) c = Math.min(c, (end - low) / span);
      else if (low > end) c = -1;
    });
    return c;
  };
  const accept = (c: number) => c >= 0 && c * X >= minExit;
  // 1. Hold every word until it has settled.
  const never = () => false;
  const c1 = fit(settled, never);
  if (accept(c1)) return plan(c1, never);
  // 2. Hold every word at least one frame after its reveal; words revealed too late cut at E.
  const late = (k: number) => (reveals[k] as number) + 1 > end - minExit;
  const shown = reveals.map((r) => r + 1);
  const c2 = fit(shown, late);
  if (accept(c2)) return plan(c2, late);
  // 3. No room for an exit: cut at E.
  return plan(0, () => true);
};

const easeIn = (v: number) => v * v * v;
const easeOut = (v: number) => 1 - (1 - v) ** 3;
const easeInOut = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2);

type ExitLook = {transform?: string; opacity?: number; filter?: string; travels: boolean};

/**
 * One word's exit pose at progress v (0..1, exclusive). Distances are the
 * reference values at 1920x1080, scaled to the composition (x by width / 1920,
 * y by height / 1080). r1, r2 are the word's seeded randoms in [-1, 1].
 */
const exitLook = (kind: Exclude<MaskedExit, {suckTo: readonly [number, number]}>, v: number, r1: number, r2: number, sx: number, sy: number): ExitLook => {
  const e = easeIn(v);
  switch (kind) {
    case 'fade':
      return {opacity: 1 - easeInOut(v), travels: false};
    case 'up':
      return {transform: `translateY(${(-e * 118).toFixed(3)}%)`, travels: false};
    case 'down':
      return {transform: `translateY(${(e * 118).toFixed(3)}%)`, travels: false};
    case 'blur':
      return {opacity: 1 - easeOut(v), filter: `blur(${(easeOut(v) * 16).toFixed(2)}px)`, transform: `scale(${(1 + easeOut(v) * 0.04).toFixed(4)})`, travels: true};
    case 'scatter':
      return {
        transform: `translate(${(r1 * 700 * sx * e).toFixed(2)}px, ${(r2 * 420 * sy * e).toFixed(2)}px) rotate(${(r2 * 70 * e).toFixed(2)}deg) scale(${(1 - 0.5 * e).toFixed(3)})`,
        opacity: 1 - clamp01(v * 2.2),
        filter: `blur(${(clamp01(v * 3) * 12).toFixed(2)}px)`,
        travels: true,
      };
    case 'fall':
      return {
        transform: `translate(${(r1 * 60 * sx * e).toFixed(2)}px, ${(e * 900 * sy).toFixed(2)}px) rotate(${(r2 * 40 * e).toFixed(2)}deg)`,
        opacity: 1 - clamp01(v * 2.2),
        filter: `blur(${(clamp01(v * 3) * 12).toFixed(2)}px)`,
        travels: true,
      };
    case 'shrink':
      return {transform: `scale(${(1 - easeInOut(v) * 0.7).toFixed(4)})`, opacity: 1 - e, travels: true};
    case 'left':
      return {transform: `translateX(${(-e * 1400 * sx).toFixed(2)}px)`, opacity: 1 - clamp01(v * 1.5 - 0.5), travels: true};
    case 'right':
      return {transform: `translateX(${(e * 1400 * sx).toFixed(2)}px)`, opacity: 1 - clamp01(v * 1.5 - 0.5), travels: true};
    case 'cut':
      return {opacity: 0, travels: false};
  }
};

/** The suck pose of one word's copy layer at progress v: a spiral into the block-space point. */
const suckLook = (v: number, spin: number): CSSProperties => {
  const e = easeIn(v);
  return {
    transform: `rotate(${(e * 540 * spin).toFixed(2)}deg) scale(${(1 - 0.92 * e).toFixed(4)})`,
    opacity: 1 - clamp01(v * 1.8 - 0.4),
    filter: `blur(${(clamp01(v * 2.5) * 10).toFixed(2)}px)`,
  };
};

/**
 * A lyric line revealed word by word, each word rising out of its own mask on
 * the frame it is sung (useLine(id).wordFrames, absolute song frames), and
 * leaving with a designed exit. A word is hidden before its reveal frame and
 * partway up on it. Reveal frames are the sung starts, pushed later only where
 * two would land less than `stagger` frames apart.
 *
 * Timing rule: the line renders nothing from E = min(next line's first-word
 * frame - 2, exitBy, until), the next line being the next one in lyrics.json.
 * Each word's exit (`exit`, `exitFrames` long, `exitStagger` apart) ends by E,
 * starting as late as it can; a short hold compresses the exit and stagger, and
 * when even that can't fit the exit collapses to a cut at E (maskedExitPlan).
 * No word starts its exit before it has been revealed. Without a next line or
 * a bound, the line holds until its Sequence ends.
 *
 * Built to hold still and read cleanly:
 * - The mask leaves 0.45em below the line box (with a matching negative
 *   margin, so layout doesn't move), and each word's box reaches past its
 *   glyphs, so neither the mask nor a gradient fill cuts descenders or accents.
 * - From its spring's settle frame until its exit starts (springSettled is
 *   exactly 1 there) a word carries no transform, filter or opacity: held text
 *   is pixel-still.
 * - Exits never reflow: a word that has left keeps its box (visibility: hidden),
 *   and exits move words with transforms only.
 * - text-wrap: balance keeps a wrapped line from stranding one word.
 *
 * Put it in LyricLayer, out of camera, blur, transition, drift or pulse
 * wrappers; put a Scrim behind it if the background is busy.
 */
export const MaskedWords = ({
  id,
  exitBy,
  until,
  exit = 'fade',
  exitFrames,
  exitStagger,
  seed,
  range,
  stagger = 2,
  preset = 'snappy',
  accent,
  accentGradient = `linear-gradient(100deg, ${theme.colors.primary} 0%, ${theme.colors.accent} 100%)`,
  balance = true,
  style,
  wordStyle,
}: MaskedWordsProps) => {
  const frame = useSongFrame();
  const {fps, width, height} = useVideoConfig();
  const line = useLine(id);
  const lines = useLyrics();
  const settle = settleFrames(fps, preset);

  const reveal: number[] = [];
  line.wordFrames.forEach((w, i) => {
    const prev = reveal[i - 1];
    reveal.push(prev === undefined ? w.start : Math.max(w.start, prev + stagger));
  });
  const [a, b] = range ?? [0, line.words.length];
  const first = reveal[a];
  const next = lines[lines.findIndex((l) => l.id === id) + 1];
  const nextFirst = next ? Math.round((lineWords(next)[0]?.start ?? next.start) * fps) : Infinity;
  const end = Math.min(nextFirst - EXIT_GAP, exitBy ?? Infinity, until ?? Infinity);
  if (first === undefined || frame < first || frame >= end) return null;

  const shownReveals = reveal.slice(a, b);
  const suck = typeof exit === 'object' ? exit.suckTo : null;
  const kind = typeof exit === 'object' ? null : exit;
  const plan = maskedExitPlan({
    reveals: shownReveals,
    settled: shownReveals.map((r) => r - LEAD_FRAMES + settle),
    end,
    exitFrames: kind === 'cut' ? 0 : (exitFrames ?? Math.round(0.3 * fps)),
    exitStagger: kind === 'cut' ? 0 : (exitStagger ?? Math.round(0.035 * fps)),
  });
  const rand = (i: number, axis: string) => random(`${seed ?? id}-exit-${i}-${axis}`) * 2 - 1;
  const sx = width / 1920;
  const sy = height / 1080;

  const fillOf = (i: number): CSSProperties =>
    accent?.includes(i)
      ? {
          backgroundImage: accentGradient,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          color: 'transparent',
        }
      : {};

  /** Word k's exit progress at this frame: null before its exit, 'gone' after it, else v in (0, 1). */
  const exitProgress = (k: number): number | 'gone' | null => {
    const p = plan[k] as {start: number; frames: number};
    if (frame < p.start) return null;
    if (p.frames <= 0 || frame >= p.start + p.frames) return 'gone';
    return (frame - p.start + 1) / (p.frames + 1);
  };

  const words = line.words.slice(a, b);
  const copies: ReactNode[] = [];
  const body = words.map((w, k) => {
    const i = a + k;
    const at = reveal[i] as number;
    const shown = frame >= at;
    // Stillness follows the settle FRAME, not the value: an under-damped
    // preset passes 1 on its overshoot and must keep its transform there.
    const settled = frame >= at - LEAD_FRAMES + settle;
    const s = springSettled(frame, at - LEAD_FRAMES, fps, preset);
    const rise = settled ? null : `translateY(${((1 - s) * 100).toFixed(2)}%) rotate(${((1 - s) * 3).toFixed(2)}deg)`;
    const progress = shown ? exitProgress(k) : null;
    let look: ExitLook | null = null;
    if (typeof progress === 'number' && kind !== null) look = exitLook(kind, progress, rand(i, 'x'), rand(i, 'y'), sx, sy);
    if (typeof progress === 'number' && suck) {
      // The copy layer carries this word through the suck; the in-flow word keeps its box.
      copies.push(
        <div
          key={`suck-${i}`}
          aria-hidden
          data-suck={i}
          style={{position: 'absolute', inset: 0, transformOrigin: `${suck[0]}px ${suck[1]}px`, ...suckLook(progress, rand(i, 'spin') < 0 ? -1 : 1)}}
        >
          {words.map((cw, ck) => (
            // Same words, same order: the copy lays out exactly like the line.
            <Fragment key={`${a + ck}-${cw.text}`}>
              {ck > 0 ? ' ' : null}
              <span style={{display: 'inline-block', verticalAlign: 'top', overflow: 'visible', ...room(MASK_ROOM)}}>
                <span
                  data-copy-word={a + ck}
                  style={{
                    display: 'inline-block',
                    ...room(GLYPH_ROOM),
                    ...fillOf(a + ck),
                    ...wordStyle,
                    ...(rise && ck === k ? {transform: rise, transformOrigin: '0% 100%'} : {}),
                    visibility: ck === k ? undefined : 'hidden',
                  }}
                >
                  {cw.text}
                </span>
              </span>
            </Fragment>
          ))}
        </div>,
      );
    }
    const gone = progress === 'gone' || (typeof progress === 'number' && suck !== null);
    const transform = [rise, look?.transform].filter(Boolean).join(' ');
    const moving: CSSProperties = {
      ...(transform ? {transform, transformOrigin: rise ? '0% 100%' : '50% 50%'} : {}),
      ...(look?.opacity !== undefined ? {opacity: Math.max(0, look.opacity)} : {}),
      ...(look?.filter ? {filter: look.filter} : {}),
    };
    return (
      // Words of one line are a fixed, ordered list: index + text is a stable identity.
      <Fragment key={`${i}-${w.text}`}>
        {k > 0 ? ' ' : null}
        <span data-mask={i} style={{display: 'inline-block', verticalAlign: 'top', overflow: look?.travels ? 'visible' : 'hidden', ...room(MASK_ROOM)}}>
          <span
            data-word={i}
            style={{
              display: 'inline-block',
              ...room(GLYPH_ROOM),
              ...fillOf(i),
              ...wordStyle,
              ...moving,
              visibility: shown && !gone ? undefined : 'hidden',
            }}
          >
            {w.text}
          </span>
        </span>
      </Fragment>
    );
  });

  return (
    <div
      style={{
        textAlign: 'center',
        textWrap: balance ? 'balance' : 'wrap',
        fontFamily: theme.fonts.display,
        fontWeight: theme.weights.bold,
        fontSize: theme.sizes.lyric,
        lineHeight: 1.15,
        color: theme.colors.text,
        ...style,
      }}
    >
      {suck ? (
        <div data-line-body="" style={{position: 'relative'}}>
          {body}
          {copies}
        </div>
      ) : (
        body
      )}
    </div>
  );
};
