// Shared entrance/exit timing for the kinetic components. Every kinetic
// component is placed by ABSOLUTE song frames (`at`, `exitAt`), read through
// useSongFrame(), so it lands on the same frame whatever <Sequence> it sits in.
import {Easing} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {progressBetween} from '../../lib/motion';

/** Default length of the quick exit animation, in frames (0.2 s at 30fps). */
export const DEFAULT_EXIT_FRAMES = 6;

/** Props every entrance component shares. */
export type KineticTimingProps = {
  /** ABSOLUTE song frame of the entrance. Nothing is visible before it. */
  at: number;
  /** ABSOLUTE song frame the exit animation starts; invisible from exitAt + exitFrames on. Omit to stay on screen. */
  exitAt?: number;
  /** Length of the exit animation in frames. Default DEFAULT_EXIT_FRAMES (6). */
  exitFrames?: number;
};

export type KineticWindow = {
  /** Absolute song frame. */
  frame: number;
  /** Frames since `at` (negative before it). */
  local: number;
  /** at <= frame < exitAt + exitFrames. */
  visible: boolean;
  /** 0..1 progress of the exit animation (eased in); 0 before exitAt or without one. */
  exit: number;
};

/** Where the current frame sits relative to an entrance at `at` and an optional exit. */
export const useKineticWindow = ({at, exitAt, exitFrames = DEFAULT_EXIT_FRAMES}: KineticTimingProps): KineticWindow => {
  const frame = useSongFrame();
  const exitEnd = exitAt === undefined ? Infinity : exitAt + Math.max(0, exitFrames);
  return {
    frame,
    local: frame - at,
    visible: frame >= at && frame < exitEnd,
    exit: exitAt === undefined ? 0 : progressBetween(frame, exitAt, exitEnd, Easing.in(Easing.cubic)),
  };
};
