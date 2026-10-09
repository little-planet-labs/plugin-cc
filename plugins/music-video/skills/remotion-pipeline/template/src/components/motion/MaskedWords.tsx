import {Fragment, type CSSProperties} from 'react';
import {useVideoConfig} from 'remotion';
import {useLine, useLyrics, useSongFrame} from '../../lib/hooks';
import {clamp01} from '../../lib/motion';
import {theme} from '../../theme';
import {settleFrames, springSettled, type SpringPreset} from './springs';

export type MaskedWordsProps = {
  /** Lyric line id from lyrics.json (e.g. "chorus-1-2"). */
  id: string;
  /** ABSOLUTE frame to start the exit; never later than the next line's start, which is the default. */
  until?: number;
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
/** Fade-out length before the exit frame. */
const EXIT_FRAMES = 4;

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

/**
 * A lyric line revealed word by word, each word rising out of its own mask on
 * the frame it is sung (useLine(id).wordFrames, absolute song frames). A word
 * is hidden before its reveal frame and partway up on it. Reveal frames are the
 * sung starts, pushed later only where two would land less than `stagger`
 * frames apart.
 *
 * Built to hold still and read cleanly:
 * - The mask leaves 0.45em below the line box (with a matching negative
 *   margin, so layout doesn't move), and each word's box reaches past its
 *   glyphs, so neither the mask nor a gradient fill cuts descenders or accents.
 * - From its spring's settle frame on (springSettled is exactly 1 there) the word
 *   carries no transform at all, so held text is pixel-still.
 * - text-wrap: balance keeps a wrapped line from stranding one word.
 *
 * The line shows from its first word until the next line starts (or `until`),
 * fading over the last 4 frames. Keep it out of camera, drift or pulse
 * wrappers; put a Scrim behind it if the background is busy.
 */
export const MaskedWords = ({
  id,
  until,
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
  const {fps} = useVideoConfig();
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
  const out = Math.min(until ?? Infinity, next ? Math.round(next.start * fps) : Infinity);
  if (first === undefined || frame < first || frame >= out) return null;
  const fade = clamp01((out - frame) / EXIT_FRAMES);

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
        ...(fade < 1 ? {opacity: fade} : {}),
      }}
    >
      {line.words.slice(a, b).map((w, k) => {
        const i = a + k;
        const at = reveal[i] as number;
        const shown = frame >= at;
        // Stillness follows the settle FRAME, not the value: an under-damped
        // preset passes 1 on its overshoot and must keep its transform there.
        const settled = frame >= at - LEAD_FRAMES + settle;
        const s = springSettled(frame, at - LEAD_FRAMES, fps, preset);
        const moving: CSSProperties =
          settled
            ? {}
            : {
                transform: `translateY(${((1 - s) * 100).toFixed(2)}%) rotate(${((1 - s) * 3).toFixed(2)}deg)`,
                transformOrigin: '0% 100%',
              };
        const fill: CSSProperties = accent?.includes(i)
          ? {
              backgroundImage: accentGradient,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: 'transparent',
            }
          : {};
        return (
          // Words of one line are a fixed, ordered list: index + text is a stable identity.
          <Fragment key={`${i}-${w.text}`}>
            {k > 0 ? ' ' : null}
            <span data-mask={i} style={{display: 'inline-block', verticalAlign: 'top', overflow: 'hidden', ...room(MASK_ROOM)}}>
              <span
                data-word={i}
                style={{
                  display: 'inline-block',
                  ...room(GLYPH_ROOM),
                  ...fill,
                  ...wordStyle,
                  ...moving,
                  visibility: shown ? undefined : 'hidden',
                }}
              >
                {w.text}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
};
