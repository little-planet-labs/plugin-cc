import type {CSSProperties} from 'react';
import {useVideoConfig} from 'remotion';
import {theme} from '../../theme';

export type ScrimProps = {
  /** Width and height (px) of the text block it backs. The feather extends past them. */
  width: number;
  height: number;
  /** Centre of the text block (px). Default: the centre of the composition. */
  cx?: number;
  cy?: number;
  /** Backing colour, any CSS colour. Default theme.colors.black. */
  color?: string;
  /** Opacity at the centre, 0..1. Default 0.55. */
  strength?: number;
  /**
   * 'radial' (default): one ellipse twice the block's size, densest at the
   * centre and feathered to nothing at its edge. 'linear': a full-width band
   * twice the block's height, feathered at the top and bottom.
   */
  shape?: 'radial' | 'linear';
  style?: CSSProperties;
};

/**
 * One soft, feathered backing behind a whole text block, so light text reads
 * over a busy background. Never put a background on each line or word: per-line
 * bands show as stacked slabs with hard edges, and a word mask clips a blurred
 * text-shadow into rectangles. Place it before the text, in the same layer.
 */
export const Scrim = ({width, height, cx, cy, color = theme.colors.black, strength = 0.55, shape = 'radial', style}: ScrimProps) => {
  const video = useVideoConfig();
  const x = cx ?? video.width / 2;
  const y = cy ?? video.height / 2;
  const a = Math.max(0, Math.min(1, strength));
  const solid = `color-mix(in srgb, ${color} ${(a * 100).toFixed(1)}%, transparent)`;
  const mid = `color-mix(in srgb, ${color} ${(a * 60).toFixed(1)}%, transparent)`;
  const box: CSSProperties =
    shape === 'linear'
      ? {
          left: 0,
          width: video.width,
          top: y - height,
          height: height * 2,
          background: `linear-gradient(to bottom, transparent 0%, ${mid} 22%, ${solid} 50%, ${mid} 78%, transparent 100%)`,
        }
      : {
          left: x - width,
          top: y - height,
          width: width * 2,
          height: height * 2,
          background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${solid} 0%, ${mid} 45%, transparent 100%)`,
        };
  return <div style={{position: 'absolute', pointerEvents: 'none', ...box, ...style}} />;
};
