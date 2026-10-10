// The world camera's settle over a shot.
import {useSongFrame} from '../../lib/hooks';
import {EASE_OUT, logZoom} from './springs';

/**
 * Pure core of useShotCamera: `z0` at and before `from`, a log-space settle
 * (logZoom) to exactly 1 at `to` and after. With z0 >= 1 and a monotonic
 * easing it never increases over the shot. Zooms must be > 0.
 */
export const shotCameraAt = (frame: number, from: number, to: number, z0 = 1.08, easing: (t: number) => number = EASE_OUT): number => {
  if (frame >= to) return 1;
  if (frame <= from) return z0;
  return logZoom(frame, from, to, z0, 1, easing);
};

/**
 * World camera scale for one shot: starts at `z0` on frame `from` (ABSOLUTE song
 * frame; pass the shot's transition start, so the incoming shot is already
 * settling while the transition reveals it) and lands on exactly 1.0 at `to`,
 * staying there. Interpolated in log space with EASE_OUT by default: fastest
 * at the start, landing softly. Apply it as `transform: scale(z)` on a wrapper
 * INSIDE WorldLayer, never on LyricLayer or anything holding the lyric.
 */
export const useShotCamera = (from: number, to: number, z0 = 1.08, easing: (t: number) => number = EASE_OUT): number =>
  shotCameraAt(useSongFrame(), from, to, z0, easing);
