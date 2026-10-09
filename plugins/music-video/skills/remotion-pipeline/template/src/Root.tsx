import {Composition} from 'remotion';
import {
  calculateMusicVideoMetadata,
  COMPOSITION_ID,
  DEFAULT_PROPS,
  FALLBACK_SECONDS,
  MusicVideo,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from './MusicVideo';

export const RemotionRoot = () => (
  <Composition
    id={COMPOSITION_ID}
    component={MusicVideo}
    width={VIDEO_WIDTH}
    height={VIDEO_HEIGHT}
    fps={VIDEO_FPS}
    // Replaced by calculateMetadata from the audio analysis (fallback: pipeline.json fallbackSeconds).
    durationInFrames={FALLBACK_SECONDS * VIDEO_FPS}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={calculateMusicVideoMetadata}
  />
);
