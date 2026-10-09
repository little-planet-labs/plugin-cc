import type {CSSProperties} from 'react';
import {progressBetween} from '../../lib/motion';
import {useKineticWindow, type KineticTimingProps} from './window';

/** Cursor blink period after typing ends, in frames (on for half, off for half). */
const BLINK_FRAMES = 30;

export type TypewriterProps = KineticTimingProps & {
  /** The text to type. Only lyric text or exact feature names on screen. */
  text: string;
  /** ABSOLUTE song frame by which every character is shown. */
  endAt: number;
  /** Show a block cursor: solid while typing, blinking (frame-deterministic) after. Default true. */
  cursor?: boolean;
  /** Cursor color. Default currentColor. */
  cursorColor?: string;
  /** Styles for the wrapper (an inline-block div); put font styles here or wrap in KineticText. */
  style?: CSSProperties;
};

/**
 * Types `text` character by character, linearly: the first character appears
 * at `at`, all are shown by `endAt`. Untyped characters are laid out but
 * hidden, so centered text doesn't shift while typing. Renders nothing
 * before `at`.
 */
export const Typewriter = ({text, at, endAt, exitAt, exitFrames, cursor = true, cursorColor, style}: TypewriterProps) => {
  const w = useKineticWindow({at, exitAt, exitFrames});
  if (!w.visible) return null;
  const chars = Array.from(text);
  const shown = Math.min(chars.length, Math.floor(progressBetween(w.frame, at, endAt) * chars.length) + 1);
  const typing = w.frame < endAt;
  const cursorOn = typing || Math.floor((w.frame - endAt) / BLINK_FRAMES) % 2 === 0;
  return (
    <div style={{display: 'inline-block', whiteSpace: 'pre-wrap', ...style, opacity: 1 - w.exit}}>
      <span>{chars.slice(0, shown).join('')}</span>
      {cursor ? (
        <span
          style={{
            display: 'inline-block',
            width: '0.06em',
            height: '0.9em',
            marginLeft: '0.04em',
            marginRight: '-0.1em',
            verticalAlign: '-0.1em',
            backgroundColor: cursorColor ?? 'currentColor',
            opacity: cursorOn ? 1 : 0,
          }}
        />
      ) : null}
      <span style={{visibility: 'hidden'}}>{chars.slice(shown).join('')}</span>
    </div>
  );
};
