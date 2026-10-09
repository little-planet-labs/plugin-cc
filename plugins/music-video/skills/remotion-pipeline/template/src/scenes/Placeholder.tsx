// A neutral stand-in so a fresh project renders end to end: the logo (or the
// company name when there's no logo file) pulsing on the beat, the lyric line
// being sung with the current word in the accent color, and a bar counter.
// The video director replaces it with the video's own scenes.
import {useContext} from 'react';
import {AbsoluteFill} from 'remotion';
import {Logo, LogoFilesContext, pickLogo} from '../components/Logo';
import {Backdrop, BeatPulse, KineticText} from '../components/kinetic';
import {useBeat, useLyric} from '../lib/hooks';
import {brand, theme} from '../theme';
import type {SceneComponent} from './types';

const BarCounter = () => {
  const {beatIndex, beatInBar} = useBeat();
  return (
    <div style={{display: 'flex', gap: 24}}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: beatIndex >= 0 && i === beatInBar ? theme.colors.accent : theme.colors.surface,
          }}
        />
      ))}
    </div>
  );
};

const Lyric = () => {
  const active = useLyric();
  if (active === null) return null;
  const words = active.line.words ?? [{text: active.line.text, start: active.line.start, end: active.line.end}];
  return (
    <KineticText size={theme.sizes.lyricSmall} style={{maxWidth: 1600}}>
      {words.map((w, i) => (
        <span key={`${w.start}-${w.text}`} style={{color: i === active.wordIndex ? theme.colors.accent : undefined}}>
          {i > 0 ? ' ' : ''}
          {w.text}
        </span>
      ))}
    </KineticText>
  );
};

export const Placeholder: SceneComponent = () => {
  const hasLogo = pickLogo(useContext(LogoFilesContext), 'onDark') !== null;
  return (
    <AbsoluteFill>
      <Backdrop variant="deep" />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', gap: 72, padding: 120}}>
        <BeatPulse strength={0.08}>
          {hasLogo ? (
            <Logo variant="onDark" height={160} />
          ) : (
            <KineticText size={theme.sizes.hit}>
              {brand.name}
            </KineticText>
          )}
        </BeatPulse>
        <Lyric />
        <BarCounter />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
