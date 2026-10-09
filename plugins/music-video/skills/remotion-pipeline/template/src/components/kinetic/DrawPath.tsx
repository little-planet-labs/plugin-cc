import {getLength} from '@remotion/paths';
import {useMemo, type CSSProperties} from 'react';
import {Easing} from 'remotion';
import {progressBetween} from '../../lib/motion';
import {useKineticWindow, type KineticTimingProps} from './window';

const DEFAULT_EASING = Easing.inOut(Easing.cubic);

export type DrawPathProps = KineticTimingProps & {
  /** SVG path data, in the coordinates of the enclosing <svg>'s viewBox. */
  d: string;
  /** ABSOLUTE song frame by which the path is fully drawn. */
  endAt: number;
  /** Stroke color. Default currentColor. */
  stroke?: string;
  /** Stroke width in viewBox units. Default 4. */
  strokeWidth?: number;
  /** Line caps. Default 'round'. */
  strokeLinecap?: 'butt' | 'round' | 'square';
  /** Line joins. Default 'round'. */
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  /** Shapes progress 0..1 between `at` and `endAt`. Default Easing.inOut(Easing.cubic). */
  easing?: (t: number) => number;
  /** Styles for the <path> (e.g. a drop-shadow filter for glow). opacity is owned by the exit. */
  style?: CSSProperties;
};

/**
 * Draws an SVG path on, from its start to its end, between `at` and `endAt`
 * (absolute song frames) with eased progress: a dash the path's length
 * (@remotion/paths getLength) whose offset runs from the full length to 0.
 * Renders a bare <path>, so place it inside an <svg>. Renders nothing before
 * `at`; fully drawn (dashoffset 0) from `endAt` on.
 */
export const DrawPath = ({
  d,
  at,
  endAt,
  exitAt,
  exitFrames,
  stroke = 'currentColor',
  strokeWidth = 4,
  strokeLinecap = 'round',
  strokeLinejoin = 'round',
  easing = DEFAULT_EASING,
  style,
}: DrawPathProps) => {
  const length = useMemo(() => getLength(d), [d]);
  const w = useKineticWindow({at, exitAt, exitFrames});
  if (!w.visible) return null;
  const p = progressBetween(w.frame, at, endAt, easing);
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeLinejoin={strokeLinejoin}
      strokeDasharray={length}
      strokeDashoffset={length * (1 - p)}
      style={{...style, opacity: 1 - w.exit}}
    />
  );
};
