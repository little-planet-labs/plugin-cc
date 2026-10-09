import type {CSSProperties, ReactNode} from 'react';
import {useVideoConfig} from 'remotion';
import {clamp01, springAt} from '../../lib/motion';
import {useKineticWindow, type KineticTimingProps} from './window';

/** Stiff spring: settles in 3-4 frames with a small overshoot. */
export const SNAP_SPRING = {damping: 15, stiffness: 520, mass: 0.35} as const;

export type SnapInProps = KineticTimingProps & {
  children?: ReactNode;
  /** Styles for the wrapper (an inline-block div). transform, opacity and filter are owned by the animation. */
  style?: CSSProperties;
};

/** A very fast 3-4 frame snap from 70% scale with a small overshoot. Renders nothing before `at`. */
export const SnapIn = ({at, exitAt, exitFrames, style, children}: SnapInProps) => {
  const {fps} = useVideoConfig();
  const w = useKineticWindow({at, exitAt, exitFrames});
  if (!w.visible) return null;
  const inv = 1 - springAt(w.frame, at, fps, SNAP_SPRING);
  const scale = (1 - inv * 0.3) * (1 - w.exit * 0.15);
  const blur = Math.max(0, inv) * 6 + w.exit * 8;
  return (
    <div
      style={{
        display: 'inline-block',
        ...style,
        transform: `scale(${scale})`,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        opacity: clamp01((w.local + 1) / 2) * (1 - w.exit),
      }}
    >
      {children}
    </div>
  );
};
