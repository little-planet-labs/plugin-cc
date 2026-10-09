import {useMemo} from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Sequence,
  staticFile,
  useVideoConfig,
  type CalculateMetadataFunction,
} from 'remotion';
import {logoCandidates, LogoFilesContext, NO_LOGO_FILES, type LogoFiles, type LogoVariant} from './components/Logo';
import {audioAnalysis, fallbackAudioAnalysis, rawAudioAnalysis, sections} from './lib/data';
import {planAudio, type AudioTiming} from './lib/audio-plan';
import {AudioAnalysisContext} from './lib/hooks';
import {placeSections, sectionsWithinDuration, withWholeSongSection} from './lib/sections';
import pipeline from './pipeline.json';
import {resolveScene} from './scenes/registry';
import {brand, theme} from './theme';

export const COMPOSITION_ID = pipeline.compositionId;
export const VIDEO_WIDTH = pipeline.width;
export const VIDEO_HEIGHT = pipeline.height;
export const VIDEO_FPS = pipeline.fps;
export const FALLBACK_SECONDS = pipeline.fallbackSeconds;

export type MusicVideoProps = {
  /** Track path relative to public/, or null to render silent. Resolved by calculateMetadata. */
  audioSrc: string | null;
  /**
   * 'analysis': beat/energy/duration from src/data/audio-analysis.json.
   * 'fallback': the no-track default (pipeline.json fallbackSeconds, beat grid at its tempo), used when the audio on disk isn't the analyzed one.
   */
  timing: AudioTiming;
  /** Which brand.json logo files exist under public/. Resolved by calculateMetadata. */
  logos: LogoFiles;
};

export const DEFAULT_PROPS: MusicVideoProps = {audioSrc: null, timing: 'analysis', logos: NO_LOGO_FILES};

const staticFileExists = async (path: string): Promise<boolean> => {
  try {
    const res = await fetch(staticFile(path), {method: 'HEAD'});
    return res.ok;
  } catch {
    return false;
  }
};

/** Probe each brand.json logo variant; keep only the files that exist. */
const probeLogos = async (): Promise<LogoFiles> => {
  const candidates = logoCandidates(brand.logo);
  const entries = await Promise.all(
    (Object.entries(candidates) as [LogoVariant, string | null][]).map(
      async ([variant, path]) => [variant, path !== null && (await staticFileExists(path)) ? path : null] as const,
    ),
  );
  return Object.fromEntries(entries) as LogoFiles;
};

export const calculateMusicVideoMetadata: CalculateMetadataFunction<MusicVideoProps> = async ({props}) => {
  const candidates = pipeline.audioCandidates;
  const [present, logos] = await Promise.all([Promise.all(candidates.map(staticFileExists)), probeLogos()]);
  const plan = planAudio({
    analysis: rawAudioAnalysis,
    candidates,
    existing: candidates.filter((_, i) => present[i]),
    fps: VIDEO_FPS,
    fallbackSeconds: FALLBACK_SECONDS,
    fallbackTempo: fallbackAudioAnalysis.tempo,
  });
  if (plan.warning !== null) console.warn(plan.warning);
  return {durationInFrames: plan.durationInFrames, props: {...props, audioSrc: plan.audioSrc, timing: plan.timing, logos}};
};

/**
 * One <Sequence> per section of src/data/sections.json, tiling the whole video
 * (one whole-song section while sections.json is empty). With a real analyzed
 * track, placement is strict: a section that starts past the end
 * (sections.json stale for this track) stops the render with its id. On the
 * 60 s no-track / fallback timing, sections past the end are dropped so
 * previews still render.
 */
const Sections = ({strict}: {strict: boolean}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const placed = useMemo(() => {
    const specs = withWholeSongSection(sections);
    return placeSections(strict ? specs : sectionsWithinDuration(specs, fps, durationInFrames), fps, durationInFrames);
  }, [strict, fps, durationInFrames]);
  return placed.map((section) => {
    const Scene = resolveScene(section.scene);
    return (
      <Sequence key={section.id} from={section.from} durationInFrames={section.durationInFrames} name={section.id}>
        <Scene section={section} />
      </Sequence>
    );
  });
};

export const MusicVideo = ({audioSrc, timing, logos}: MusicVideoProps) => (
  <AudioAnalysisContext.Provider value={timing === 'fallback' ? fallbackAudioAnalysis : audioAnalysis}>
    <LogoFilesContext.Provider value={logos}>
      <AbsoluteFill style={{backgroundColor: theme.colors.background}}>
        {audioSrc === null ? null : <Html5Audio src={staticFile(audioSrc)} />}
        <Sections strict={timing === 'analysis' && rawAudioAnalysis.source !== null} />
      </AbsoluteFill>
    </LogoFilesContext.Provider>
  </AudioAnalysisContext.Provider>
);
