import {AbsoluteFill} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {theme} from '../../theme';

export type FlashProps = {
  /** ABSOLUTE song frame of the flash. */
  at: number;
  /** Fade-out length in frames. Default 8. */
  durationFrames?: number;
  /** Flash color. Default theme.colors.flash (the brand text color). */
  color?: string;
  /** Opacity on the first frame. Default 0.9. */
  peak?: number;
};

/** Full-frame flash overlay that peaks at `at` and fades out. Renders nothing outside [at, at + durationFrames). */
export const Flash = ({at, durationFrames = 8, color = theme.colors.flash, peak = 0.9}: FlashProps) => {
  const local = useSongFrame() - at;
  if (local < 0 || local >= durationFrames) return null;
  const opacity = peak * (1 - local / durationFrames) ** 2;
  return <AbsoluteFill style={{backgroundColor: color, opacity, pointerEvents: 'none'}} />;
};
