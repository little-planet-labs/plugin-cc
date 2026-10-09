import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {useBeat} from '../../lib/hooks';
import {beatKick} from '../../lib/motion';

export type BeatPulseProps = {
  children?: ReactNode;
  /** Extra scale at the peak of a beat (0.06 = +6%). Default 0.06. */
  strength?: number;
  /** Multiplier for the downbeat (beat 1 of the bar). Default 1.8. */
  downbeatBoost?: number;
  /** Kick curve power; higher = snappier decay. Default 3. */
  power?: number;
  /** Render as a centered full-frame layer instead of an inline-block. Default false. */
  fill?: boolean;
  /** Styles for the wrapper; transform is owned by the pulse. */
  style?: CSSProperties;
};

/** Scales its children with the beat: a kick on every beat (bigger on downbeats) that decays by the next. */
export const BeatPulse = ({children, strength = 0.06, downbeatBoost = 1.8, power = 3, fill = false, style}: BeatPulseProps) => {
  const beat = useBeat();
  const kick = beat.beatIndex < 0 ? 0 : beatKick(beat.phase, power) * (beat.beatInBar === 0 ? downbeatBoost : 1);
  const transform = `scale(${1 + kick * strength})`;
  return fill ? (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', ...style, transform}}>{children}</AbsoluteFill>
  ) : (
    <div style={{display: 'inline-block', ...style, transform}}>{children}</div>
  );
};
