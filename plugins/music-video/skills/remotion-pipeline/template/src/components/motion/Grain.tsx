import {useId} from 'react';
import {random, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';

export type GrainProps = {
  /** Overall strength, 0..1. Default 0.12. */
  opacity?: number;
  /** Seed string: two grains with different seeds never match. Default 'grain'. */
  seed?: string;
  /** feTurbulence base frequency: higher is finer. Default 0.85. */
  frequency?: number;
  /** New noise every `step` frames (2 or 3 reads more like film). Default 1. */
  step?: number;
};

/**
 * Film grain: SVG fractal noise drawn as light and dark speckles with plain
 * alpha. The noise seed comes from Remotion's random(`${seed}-${frame}`), so the
 * same song frame always draws the same grain. Filter ids are unique per
 * instance, so two shots overlapping in a wipe never share a filter.
 *
 * It uses no mix-blend-mode: blended layers over 3D-transformed or clipped
 * layers composite as grey slabs in headless Chrome. Put it BELOW the lyric
 * layer (background, grain and vignette, then text): grain that changes every
 * frame over the type makes held text crawl.
 */
export const Grain = ({opacity = 0.12, seed = 'grain', frequency = 0.85, step = 1}: GrainProps) => {
  const frame = useSongFrame();
  const {width, height} = useVideoConfig();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const light = `grain-light-${uid}`;
  const dark = `grain-dark-${uid}`;
  const tick = Math.floor(frame / Math.max(1, Math.round(step)));
  const noiseSeed = Math.floor(random(`${seed}-${tick}`) * 100000);
  const noise = <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={2} seed={noiseSeed} stitchTiles="stitch" />;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{position: 'absolute', left: 0, top: 0, opacity: Math.max(0, Math.min(1, opacity)), pointerEvents: 'none'}}
    >
      <filter id={light} x="0" y="0" width="100%" height="100%">
        {noise}
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.2 0 0 0 -1.15" />
      </filter>
      <filter id={dark} x="0" y="0" width="100%" height="100%">
        {noise}
        <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.2 0 0 0 1.05" />
      </filter>
      <rect width={width} height={height} filter={`url(#${light})`} />
      <rect width={width} height={height} filter={`url(#${dark})`} />
    </svg>
  );
};
