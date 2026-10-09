import type {CSSProperties, ReactNode} from 'react';
import {Easing} from 'remotion';
import {progressBetween} from '../../lib/motion';
import {useKineticWindow, type KineticTimingProps} from './window';

export type FadeUpProps = KineticTimingProps & {
  children?: ReactNode;
  /** Length of the fade-in in frames. Default 24 (0.8 s). */
  durationFrames?: number;
  /** How far it rises, in px. Default 36. */
  rise?: number;
  /** Styles for the wrapper (an inline-block div). transform, opacity and filter are owned by the animation. */
  style?: CSSProperties;
};

/** Slow cinematic entrance: fades up from below while un-blurring. Renders nothing before `at`. */
export const FadeUp = ({at, exitAt, exitFrames, durationFrames = 24, rise = 36, style, children}: FadeUpProps) => {
  const w = useKineticWindow({at, exitAt, exitFrames});
  if (!w.visible) return null;
  const p = progressBetween(w.frame, at, at + durationFrames, Easing.out(Easing.cubic));
  const blur = (1 - p) * 10 + w.exit * 10;
  return (
    <div
      style={{
        display: 'inline-block',
        ...style,
        transform: `translateY(${(1 - p) * rise - w.exit * rise * 0.5}px)`,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        opacity: p * (1 - w.exit),
      }}
    >
      {children}
    </div>
  );
};
