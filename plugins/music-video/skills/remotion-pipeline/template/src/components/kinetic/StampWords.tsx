import type {CSSProperties} from 'react';
import {useSongFrame} from '../../lib/hooks';
import {SlamIn, type SlamFrom} from './SlamIn';

/** One stamped word: its text and the ABSOLUTE song frame it slams in on. */
export type StampWord = {text: string; at: number};

export type StampWordsProps = {
  /** Words in reading order, each with its own entrance frame (e.g. useLine(id).wordFrames[i].start). */
  words: readonly StampWord[];
  /** ABSOLUTE song frame the whole row starts its exit. */
  exitAt?: number;
  /** Exit length in frames. Default 6. */
  exitFrames?: number;
  /** Space between words: px number or CSS length. Default '0.28em'. */
  gap?: number | string;
  /** Where each word slams in from. Default 'scale'. */
  from?: SlamFrom;
  /** SlamIn intensity per word. Default 1. */
  intensity?: number;
  /** Styles for the row (a wrapping, centered flex container); font styles inherit to the words. */
  style?: CSSProperties;
  /** Styles for each word's wrapper. */
  wordStyle?: CSSProperties;
};

/**
 * A wrapping, centered row of words, each slamming in at its own frame. Words
 * not yet in keep their space (invisible), so the row never reflows. Renders
 * nothing before the first word's frame.
 */
export const StampWords = ({words, exitAt, exitFrames, gap = '0.28em', from, intensity, style, wordStyle}: StampWordsProps) => {
  const frame = useSongFrame();
  const first = words.reduce((min, w) => Math.min(min, w.at), Infinity);
  if (words.length === 0 || frame < first) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'baseline',
        columnGap: gap,
        rowGap: '0.08em',
        ...style,
      }}
    >
      {words.map((w, i) => (
        <SlamIn
          // Words are a fixed, ordered list: position + text + frame is a stable identity.
          key={`${i}-${w.at}-${w.text}`}
          at={w.at}
          exitAt={exitAt}
          exitFrames={exitFrames}
          from={from}
          intensity={intensity}
          reserveSpace
          style={wordStyle}
        >
          {w.text}
        </SlamIn>
      ))}
    </div>
  );
};
