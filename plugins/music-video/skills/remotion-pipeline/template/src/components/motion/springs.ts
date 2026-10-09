// Springs that land and stay put, plus camera easings and log-space zoom.
// Pure functions of frame numbers, like src/lib/motion.ts.
import {Easing, interpolate, measureSpring, spring, type SpringConfig} from 'remotion';

/**
 * Spring presets (stiffness / damping, mass 1). snappy, default and heavy are
 * damped enough to land with at most a hair of overshoot; playful overshoots
 * by about 20%, so keep it for gag words.
 */
export const SPRING_PRESETS = {
  snappy: {stiffness: 320, damping: 30, mass: 1},
  default: {stiffness: 170, damping: 26, mass: 1},
  heavy: {stiffness: 120, damping: 24, mass: 1},
  playful: {stiffness: 180, damping: 12, mass: 1},
} as const satisfies Record<string, Partial<SpringConfig>>;

export type SpringPreset = keyof typeof SPRING_PRESETS;

/** Frames after its start until `preset` stays within 0.001 of rest (Remotion caches the measurement). */
export const settleFrames = (fps: number, preset: SpringPreset = 'default'): number =>
  Math.ceil(measureSpring({fps, config: SPRING_PRESETS[preset], threshold: 0.001}));

/**
 * Frames over which the last of the residual is eased away before the settle
 * frame. Time-based, about 0.2 s (6 at 30fps, 12 at 60fps, at least 2), and
 * capped at the settle length: a preset that settles in fewer frames than the
 * window (low fps) would otherwise start blending on frame `at` and be above 0
 * there. The blend's per-frame steps are on the order of 1e-3 of the move.
 */
const blendFrames = (fps: number, settle: number): number => Math.min(settle, Math.max(2, Math.round(0.2 * fps)));

/**
 * Exactly 0 before `at`, then a spring toward 1 that reaches EXACTLY 1 on its
 * settle frame (`at + settleFrames(fps, preset)`) and stays there. A raw
 * Remotion spring only approaches 1, so text held on it keeps creeping by
 * sub-pixel amounts long after it looks settled, which reads as shimmer. Over
 * the last few frames before the settle frame the remaining residual is eased
 * to zero, so the landing has no visible step.
 */
export const springSettled = (frame: number, at: number, fps: number, preset: SpringPreset = 'default'): number => {
  if (frame < at) return 0;
  const t = frame - at;
  const settle = settleFrames(fps, preset);
  if (t >= settle) return 1;
  const s = spring({frame: t, fps, config: SPRING_PRESETS[preset]});
  const blend = blendFrames(fps, settle);
  const k = (t - (settle - blend)) / blend;
  if (k <= 0) return s;
  const smooth = k * k * (3 - 2 * k);
  return s + (1 - s) * smooth;
};

/** Camera move between two rests: Easing.bezier(0.6, 0, 0.2, 1). Exactly 0 and 1 at the ends. */
export const EASE_CAM = Easing.bezier(0.6, 0, 0.2, 1);

/** Entrance: fast out, long settle. Easing.bezier(0.2, 0.8, 0.2, 1). Exactly 0 and 1 at the ends. */
export const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

/**
 * Zoom from `z0` at frame `from` to `z1` at frame `to`, interpolated in log
 * space (clamped outside the range), so a push-in reads as constant speed
 * instead of accelerating. With linear easing the midpoint is the geometric
 * mean sqrt(z0 * z1). Zooms must be > 0.
 */
export const logZoom = (
  frame: number,
  from: number,
  to: number,
  z0: number,
  z1: number,
  easing: (t: number) => number = EASE_CAM,
): number => {
  if (to <= from) return frame >= from ? z1 : z0;
  return Math.exp(
    interpolate(frame, [from, to], [Math.log(z0), Math.log(z1)], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing,
    }),
  );
};
