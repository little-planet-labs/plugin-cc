import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {EASE_CAM} from './springs';

export type CircleFloodProps = {
  /** ABSOLUTE song frame the circle starts growing (radius 0). Nothing renders before it. */
  at: number;
  /** Frames to full size: the flood covers the whole frame from `at + frames` on. */
  frames: number;
  /** Source point in composition px (the element it floods out of). Default: the centre. */
  x?: number;
  y?: number;
  /** Fill colour (any CSS colour) behind the children; omit to reveal only the children. */
  color?: string;
  /** Easing of the radius. Default EASE_CAM. */
  easing?: (t: number) => number;
  /** What the circle reveals: the next shot, a backdrop. */
  children?: ReactNode;
  style?: CSSProperties;
};

/**
 * A circle wipe out of a source point. The radius eases from 0 to the distance
 * to the composition's farthest corner (times 1.05) over `frames`, so by
 * `at + frames` it covers every pixel, wherever the source sits. The size
 * comes from the composition, not a fixed 1920x1080. Put it above the outgoing
 * shot; once the flood is whole, the outgoing shot can stop rendering.
 */
export const CircleFlood = ({at, frames, x, y, color, easing = EASE_CAM, children, style}: CircleFloodProps) => {
  const frame = useSongFrame();
  const {width, height} = useVideoConfig();
  if (frame < at) return null;
  const cx = x ?? width / 2;
  const cy = y ?? height / 2;
  const full = Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy)) * 1.05;
  const t = frames > 0 ? Math.min(1, (frame - at) / frames) : 1;
  const r = full * easing(t);
  return (
    <AbsoluteFill style={{overflow: 'hidden', background: color, ...style, clipPath: `circle(${r.toFixed(1)}px at ${cx.toFixed(1)}px ${cy.toFixed(1)}px)`}}>
      {children}
    </AbsoluteFill>
  );
};
