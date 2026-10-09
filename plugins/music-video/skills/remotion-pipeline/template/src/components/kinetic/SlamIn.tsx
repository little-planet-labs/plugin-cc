import type {CSSProperties, ReactNode} from 'react';
import {useVideoConfig} from 'remotion';
import {clamp01, springAt} from '../../lib/motion';
import {useKineticWindow, type KineticTimingProps} from './window';

/** Direction a SlamIn / StampWords word arrives from. 'scale' crashes down from big. */
export type SlamFrom = 'scale' | 'up' | 'down' | 'left' | 'right';

/** Under-damped spring: lands in ~5 frames with ~20% overshoot. */
export const SLAM_SPRING = {damping: 11, stiffness: 220, mass: 0.7} as const;

export type SlamInProps = KineticTimingProps & {
  children?: ReactNode;
  /** Where it slams in from. Default 'scale' (starts ~2.6x, crashes to 1 with a bounce). */
  from?: SlamFrom;
  /** Multiplies the travel, scale and blur. Default 1; 0.5 = subtler, 1.5 = harder. */
  intensity?: number;
  /** Before `at` (and after the exit), render the children invisibly so surrounding layout doesn't jump. Default false (render nothing). */
  reserveSpace?: boolean;
  /** Styles for the wrapper (an inline-block div). transform, opacity and filter are owned by the animation. */
  style?: CSSProperties;
};

/**
 * The default "word hits on a beat": a big overshoot slam with an entrance
 * blur for a motion-blur feel. Renders nothing before `at`.
 */
export const SlamIn = ({at, exitAt, exitFrames, from = 'scale', intensity = 1, reserveSpace = false, style, children}: SlamInProps) => {
  const {fps} = useVideoConfig();
  const w = useKineticWindow({at, exitAt, exitFrames});
  if (!w.visible) {
    return reserveSpace ? <div style={{display: 'inline-block', ...style, visibility: 'hidden'}}>{children}</div> : null;
  }
  const s = springAt(w.frame, at, fps, SLAM_SPRING);
  const inv = 1 - s; // 1 -> 0, briefly negative on the overshoot
  const travel = (px: number) => inv * px * intensity;
  const x = from === 'left' ? -travel(560) : from === 'right' ? travel(560) : 0;
  const y = from === 'up' ? travel(360) : from === 'down' ? -travel(360) : 0;
  const scale = (from === 'scale' ? 1 + inv * 1.6 * intensity : 1 + inv * 0.25 * intensity) * (1 + w.exit * 0.25);
  const blur = Math.max(0, inv) * 14 * intensity + w.exit * 12;
  const opacity = clamp01((w.local + 1) / 3) * (1 - w.exit);
  return (
    <div
      style={{
        display: 'inline-block',
        ...style,
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        opacity,
      }}
    >
      {children}
    </div>
  );
};
