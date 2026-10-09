import type {CSSProperties} from 'react';
import {AbsoluteFill} from 'remotion';
import {useEnergy, useSongFrame} from '../../lib/hooks';
import {theme} from '../../theme';

/** Backdrop looks. 'deep' is the default video background; 'neutral' suits a gray "before" look. */
export type BackdropVariant = 'black' | 'deep' | 'brand' | 'neutral' | 'light';

/** `color` at `percent`% opacity (CSS color-mix, supported by the render's Chrome). */
const fade = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

const {colors} = theme;
const VARIANTS: Record<BackdropVariant, {base: string; glow: string; vignette: string}> = {
  black: {base: colors.black, glow: colors.primaryDeep, vignette: fade(colors.black, 50)},
  deep: {base: colors.background, glow: colors.surface, vignette: fade(colors.black, 55)},
  brand: {base: colors.primary, glow: colors.primaryDeep, vignette: fade(colors.primaryDeep, 45)},
  neutral: {base: colors.neutralDark, glow: colors.neutralDarkRaised, vignette: fade(colors.black, 50)},
  light: {base: colors.light, glow: colors.lightRaised, vignette: fade(colors.primary, 8)},
};

export type BackdropProps = {
  variant: BackdropVariant;
  /** Styles for the full-frame layer. */
  style?: CSSProperties;
};

/**
 * Full-frame background in theme colors with a soft radial glow that swells
 * with the low-band energy (and drifts slowly on its own), so static moments
 * still breathe. Render it first in a scene.
 */
export const Backdrop = ({variant, style}: BackdropProps) => {
  const {base, glow, vignette} = VARIANTS[variant];
  const frame = useSongFrame();
  const energy = useEnergy('low', {smoothFrames: 8});
  const drift = Math.sin(frame / 45) * 0.04;
  return (
    <AbsoluteFill style={{backgroundColor: base, overflow: 'hidden', ...style}}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 65% 60% at 50% 50%, ${glow} 0%, transparent 72%)`,
          opacity: Math.min(1, 0.5 + drift + energy * 0.5),
          transform: `scale(${1 + drift * 0.5 + energy * 0.12})`,
        }}
      />
      <AbsoluteFill style={{background: `radial-gradient(ellipse at center, transparent 55%, ${vignette} 100%)`}} />
    </AbsoluteFill>
  );
};
