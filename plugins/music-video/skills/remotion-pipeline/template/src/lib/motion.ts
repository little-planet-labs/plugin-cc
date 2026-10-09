// Pure, frame-driven animation math shared by the kinetic components
// (src/components/kinetic) and scenes. Every function is a function of frame
// numbers only: no wall-clock time, no Math.random (random() is seeded).
import {random, spring, type SpringConfig} from 'remotion';

/** Clamp to [0, 1]. NaN becomes 0. */
export const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);

/**
 * 0 at or before `startFrame`, 1 at or after `endFrame`, linear in between,
 * then shaped by `easing` (e.g. Remotion's Easing.out(Easing.cubic)). When
 * endFrame <= startFrame it's a step at startFrame.
 */
export const progressBetween = (
  frame: number,
  startFrame: number,
  endFrame: number,
  easing?: (t: number) => number,
): number => {
  if (endFrame <= startFrame) return frame >= startFrame ? 1 : 0;
  const t = clamp01((frame - startFrame) / (endFrame - startFrame));
  return easing ? easing(t) : t;
};

/**
 * Remotion spring() that starts at `atFrame`: 0 before it, then springs
 * toward 1 (overshooting when the config is under-damped).
 */
export const springAt = (frame: number, atFrame: number, fps: number, config?: Partial<SpringConfig>): number => {
  if (frame < atFrame) return 0;
  return spring({frame: frame - atFrame, fps, config});
};

/**
 * Exponential decay: 1 at 0 frames since the event, 0.5 after
 * `halfLifeFrames`, toward 0 after. 0 for negative or infinite input (no
 * event yet; useFramesSinceOnset() returns Infinity before the first onset).
 */
export const decay = (framesSince: number, halfLifeFrames: number): number => {
  if (!(framesSince >= 0) || !Number.isFinite(framesSince)) return 0;
  if (halfLifeFrames <= 0) return framesSince === 0 ? 1 : 0;
  return 0.5 ** (framesSince / halfLifeFrames);
};

/**
 * A kick that peaks (1) on the beat and falls to 0 by the next one:
 * (1 - phase) ** power, with `phase` from useBeat(). Higher power = snappier.
 */
export const beatKick = (phase: number, power = 3): number => (1 - clamp01(phase)) ** power;

export type ShakeOffset = {x: number; y: number; rotate: number};

/**
 * Deterministic camera-shake offset: random jitter (seeded by `seed` and the
 * frame) of up to `intensityPx` (and intensityPx * 0.04 degrees of rotation),
 * fading out linearly over `durationFrames`. Exactly {0, 0, 0} outside
 * [atFrame, atFrame + durationFrames).
 */
export const shakeOffset = (
  frame: number,
  atFrame: number,
  seed: string | number,
  intensityPx: number,
  durationFrames: number,
): ShakeOffset => {
  const local = frame - atFrame;
  if (local < 0 || local >= durationFrames) return {x: 0, y: 0, rotate: 0};
  const falloff = (1 - local / durationFrames) ** 1.5;
  const jitter = (axis: string) => (random(`shake-${seed}-${axis}-${local}`) * 2 - 1) * falloff;
  return {
    x: jitter('x') * intensityPx,
    y: jitter('y') * intensityPx,
    rotate: jitter('r') * intensityPx * 0.04,
  };
};
