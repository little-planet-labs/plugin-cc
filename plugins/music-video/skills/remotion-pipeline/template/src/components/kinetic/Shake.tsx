import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {shakeOffset} from '../../lib/motion';

export type ShakeProps = {
  /** ABSOLUTE song frame the shake hits. */
  at: number;
  /** How long it rings out, in frames. Default 12. */
  durationFrames?: number;
  /** Peak offset in px. Default 24. */
  intensity?: number;
  /** Seed for the jitter; give each shake its own so they differ. */
  seed: string | number;
  children?: ReactNode;
  /** Styles for the full-frame wrapper; transform is owned by the shake. */
  style?: CSSProperties;
};

/**
 * Camera shake: a full-frame wrapper whose children jitter (deterministic,
 * seeded) from `at` for `durationFrames`, fading out. Children always render;
 * only the shake is gated on `at`. Nest Shakes for several hits.
 */
export const Shake = ({at, durationFrames = 12, intensity = 24, seed, children, style}: ShakeProps) => {
  const {x, y, rotate} = shakeOffset(useSongFrame(), at, seed, intensity, durationFrames);
  return (
    <AbsoluteFill style={{...style, transform: `translate(${x}px, ${y}px) rotate(${rotate}deg)`}}>{children}</AbsoluteFill>
  );
};
