import {useMemo, type ReactNode} from 'react';
import {AbsoluteFill, Internals, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';

export type SubframeOptions = {
  /** [from, to): ABSOLUTE song frames the samples may come from. Pass a shot's or transition's range, so no sample crosses a cut. */
  window: readonly [number, number];
  /** Samples per frame, 3..6 (rounded and clamped). Default 4. */
  samples?: number;
  /** Shutter as a fraction of one frame: 0.5 = a 180° shutter. Default 0.5. */
  shutter?: number;
};

/** Sample count actually used: an integer in 3..6. */
const sampleCount = (samples: number | undefined): number => Math.min(6, Math.max(3, Math.round(samples ?? 4)));

/**
 * The song frames SubframeBlur renders for `frame`: N offsets centred on the
 * frame, (j - (N - 1) / 2) * shutter / N frames for j = 0..N-1, each clamped
 * into [from, to - 1]. A frame outside [from, to) gets one sample, the frame
 * itself, unblurred. An empty window (to <= from) never blurs.
 */
export const subframeSamples = (frame: number, {window, samples, shutter = 0.5}: SubframeOptions): number[] => {
  const [from, to] = window;
  if (to <= from || frame < from || frame >= to) return [frame];
  const n = sampleCount(samples);
  const last = to - 1;
  return Array.from({length: n}, (_, j) => Math.min(last, Math.max(from, frame + ((j - (n - 1) / 2) * shutter) / n)));
};

export type SubframeBlurProps = SubframeOptions & {
  /** WORLD content only. Never text meant to be read. */
  children: ReactNode;
};

/**
 * Motion blur for world content around a transition: inside `window` it renders
 * the children N times, each one seeing the timeline at one sample frame (a
 * fractional song frame such as 104.125), and averages them with plain
 * opacity: layer k (0-based, in paint order) at opacity 1 / (k + 1), which
 * gives every sample the same weight 1 / N over an opaque bottom layer. No
 * mix-blend-mode, no plus-lighter. Outside the window it renders the children
 * once, unblurred. The element structure is the same on both sides (sample
 * slot 0 keeps its key and element types), so the children are not remounted
 * when the window opens or closes.
 *
 * Only visuals are sampled. Each sample overrides only the timeline frame and
 * leaves every Sequence offset as it is, so useSongFrame(), useCurrentFrame()
 * (still relative to the enclosing Sequence), nested <Sequence>/<Series>/<Loop>
 * and useVideoConfig() read what they read without the blur, at any depth.
 * Inside the window the samples count as frozen (Remotion's isInsideFreeze),
 * so audio and video SOUND inside SubframeBlur is muted there and drops out of
 * the render's mix: put <Audio>/<Html5Audio>, and any video whose sound you
 * want, outside SubframeBlur as siblings. (Unfrozen, the N samples would
 * register the same audio asset N times at fractional frames.) Remotion's
 * <Freeze> is not used: it also zeroes the Sequence offsets of everything
 * inside it.
 *
 * Rules:
 * - World only. Put it inside WorldLayer (around a shot or ShotTimeline), never
 *   around MaskedWords or anything holding the lyric: averaged copies of moving
 *   text read as smear, and held text must stay pixel-still.
 * - The window must not cross a cut: pass the range of the shot or transition
 *   being blurred, and every sample stays inside it.
 * - No sound inside it (above).
 * - Wrap full-frame content (a shot): the children sit in a full-frame layer
 *   in and out of the window. Averaging is exact for opaque content; over
 *   transparent areas the stack's alpha is an approximation.
 * - Each sample renders the whole subtree: N times the cost, only in the window.
 */
export const SubframeBlur = ({children, window, samples, shutter}: SubframeBlurProps) => {
  const frame = useSongFrame();
  const at = subframeSamples(frame, {window, samples, shutter});
  const blurring = at.length > 1;
  return (
    <AbsoluteFill data-subframe-blur="">
      {at.map((f, k) => (
        // One layer per sample slot: slot 0 keeps this key and these element types in and out of the window.
        <AbsoluteFill key={`sample-${k}`} data-sample={blurring ? f : undefined} style={{opacity: 1 / (k + 1)}}>
          <AtSongFrame frame={f} active={blurring}>
            {children}
          </AtSongFrame>
        </AbsoluteFill>
      ))}
    </AbsoluteFill>
  );
};

/**
 * While `active`, shows its children the timeline at ABSOLUTE song frame
 * `frame`, leaving the Sequence context untouched (unlike <Freeze>, which also
 * zeroes cumulatedFrom), and reports not playing and inside a freeze, which
 * mutes media sound. Inactive, it passes the timeline through unchanged. It
 * renders the same provider either way, so toggling never remounts children.
 */
const AtSongFrame = ({frame, active, children}: {frame: number; active: boolean; children: ReactNode}) => {
  const timeline = Internals.useTimelineContext();
  const {id} = useVideoConfig();
  const value = useMemo(
    () => (active ? {...timeline, isPlaying: () => false, isInsideFreeze: true, frame: {[id]: frame}} : timeline),
    [active, timeline, id, frame],
  );
  return <Internals.TimelineContext.Provider value={value}>{children}</Internals.TimelineContext.Provider>;
};
