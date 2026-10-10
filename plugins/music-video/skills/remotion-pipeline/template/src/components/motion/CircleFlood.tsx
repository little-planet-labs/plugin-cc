import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {EASE_CAM} from './springs';

export type FloodContract = {
  /** Target point in composition px: the circle shrinks into it. */
  x: number;
  y: number;
  /** ABSOLUTE song frame the shrink starts. */
  at: number;
  /** Frames to shrink: the radius is exactly 0, and nothing renders, from `at + frames` on. */
  frames: number;
  /** Easing of the shrink (radius and centre). Default EASE_CAM (ease-in-out). */
  easing?: (t: number) => number;
};

export type FloodRing = {
  /** Ring colour (any CSS colour). */
  color: string;
  /** Ring width in px, ahead of the flood's edge. */
  width: number;
};

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
  /** After growing, shrink back to radius 0 at a target point (the next object). */
  contractTo?: FloodContract;
  /** A coloured ring `width` px wide leading the edge. */
  ring?: FloodRing;
  /** What the circle reveals: the next shot, a backdrop. */
  children?: ReactNode;
  style?: CSSProperties;
};

export type FloodGeometry = {
  /** Radius of the flood in px. */
  r: number;
  /** Centre in composition px. */
  cx: number;
  cy: number;
  /** Ring progress factor: 1 while growing or full, falling to 0 as it contracts. */
  ringScale: number;
};

/**
 * The flood's circle at `frame` (pure), or null when nothing renders: before
 * `at`, and from `contractTo.at + contractTo.frames` on. Growing: the radius
 * eases from 0 to 1.05 times the distance from the source to the farthest
 * corner of a width x height frame. Contracting: from the radius it had at
 * `contractTo.at`, the radius eases to exactly 0 while the centre eases from
 * the source to the target.
 */
export const floodGeometry = (
  frame: number,
  {at, frames, x, y, easing = EASE_CAM, contractTo}: Pick<CircleFloodProps, 'at' | 'frames' | 'x' | 'y' | 'easing' | 'contractTo'>,
  width: number,
  height: number,
): FloodGeometry | null => {
  if (frame < at) return null;
  const cx = x ?? width / 2;
  const cy = y ?? height / 2;
  const full = Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy)) * 1.05;
  const grown = (f: number) => full * easing(frames > 0 ? Math.min(1, Math.max(0, (f - at) / frames)) : 1);
  if (!contractTo || frame < contractTo.at) return {r: grown(frame), cx, cy, ringScale: 1};
  const end = contractTo.at + contractTo.frames;
  if (frame >= end) return null;
  const ease = contractTo.easing ?? EASE_CAM;
  const k = ease(contractTo.frames > 0 ? (frame - contractTo.at) / contractTo.frames : 1);
  return {
    r: grown(contractTo.at) * (1 - k),
    cx: cx + (contractTo.x - cx) * k,
    cy: cy + (contractTo.y - cy) * k,
    ringScale: 1 - k,
  };
};

/**
 * A circle wipe out of a source point. The radius eases from 0 to the distance
 * to the composition's farthest corner (times 1.05) over `frames`, so by
 * `at + frames` it covers every pixel, wherever the source sits. The size
 * comes from the composition, not a fixed 1920x1080. Put it above the outgoing
 * shot; once the flood is whole, the outgoing shot can stop rendering.
 *
 * `contractTo` shrinks it again into a target point: the radius reaches exactly
 * 0 at `contractTo.at + contractTo.frames` (nothing renders from then on) while
 * the centre moves from the source to the target. `ring` draws a band of colour
 * `ring.width` px wide just outside the edge (it starts with the flood, and
 * narrows to nothing as it contracts).
 *
 * The default easing is a camera ease (slow start). A flood meant to be mostly
 * full on a hit wants EASE_OUT over about 0.3 s, starting about 0.2 s before
 * the hit. World content: put it inside WorldLayer, never over the lyric.
 */
export const CircleFlood = ({at, frames, x, y, color, easing, contractTo, ring, children, style}: CircleFloodProps) => {
  const frame = useSongFrame();
  const {width, height} = useVideoConfig();
  const g = floodGeometry(frame, {at, frames, x, y, easing, contractTo}, width, height);
  if (g === null) return null;
  const circle = (r: number) => `circle(${r.toFixed(1)}px at ${g.cx.toFixed(1)}px ${g.cy.toFixed(1)}px)`;
  const ringR = ring && g.r > 0 ? g.r + ring.width * g.ringScale : 0;
  return (
    <>
      {ring && ringR > 0 ? <AbsoluteFill data-flood-ring="" style={{background: ring.color, clipPath: circle(ringR)}} /> : null}
      <AbsoluteFill style={{overflow: 'hidden', background: color, ...style, clipPath: circle(g.r)}}>{children}</AbsoluteFill>
    </>
  );
};
