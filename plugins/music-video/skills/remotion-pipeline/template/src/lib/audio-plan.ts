// Decides which audio file plays, which timing the hooks use, and how long the
// video is, from the analysis and the files on disk. Pure, so every case is
// table-tested (tests/audio-plan.test.ts); calculateMetadata only probes files.

export type AudioTiming = 'analysis' | 'fallback';

export type AudioPlanInput = {
  /** The loaded (raw) analysis. */
  analysis: {source: string | null; fps: number; durationInFrames: number};
  /** Candidate paths (relative to public/), in preference order. */
  candidates: readonly string[];
  /** The subset of `candidates` that exists on disk. */
  existing: readonly string[];
  fps: number;
  fallbackSeconds: number;
  /** Tempo of the fallback beat grid, for the warning. */
  fallbackTempo: number;
};

export type AudioPlan = {
  /** Path relative to public/ to play, or null for silence. */
  audioSrc: string | null;
  timing: AudioTiming;
  durationInFrames: number;
  /** Something the user should fix, or null. */
  warning: string | null;
};

export const planAudio = ({
  analysis,
  candidates,
  existing,
  fps,
  fallbackSeconds,
  fallbackTempo,
}: AudioPlanInput): AudioPlan => {
  const {source} = analysis;
  if (source !== null && analysis.fps !== fps) {
    throw new Error(
      `audio-analysis.json was generated at ${analysis.fps}fps but the video is ${fps}fps. Re-run \`pnpm analyze\`.`,
    );
  }
  const fallbackFrames = fallbackSeconds * fps;
  const fallbackLabel = `${fallbackSeconds}s, ${fallbackTempo} BPM grid`;

  // Prefer the file the analysis came from, then the others in candidate order.
  const ordered = source === null ? candidates : [source, ...candidates.filter((p) => p !== source)];
  const audioSrc = ordered.find((p) => existing.includes(p)) ?? null;

  if (audioSrc === null) {
    return source === null
      ? {audioSrc, timing: 'analysis', durationInFrames: fallbackFrames, warning: null}
      : {
          audioSrc,
          timing: 'analysis',
          durationInFrames: analysis.durationInFrames,
          warning: `audio-analysis.json is for public/${source}, which is missing. Rendering silent with its analyzed timing.`,
        };
  }
  if (audioSrc === source) {
    return {audioSrc, timing: 'analysis', durationInFrames: analysis.durationInFrames, warning: null};
  }
  // Audio on disk isn't the analyzed track: its beats would be wrong, so don't use them.
  return {
    audioSrc,
    timing: 'fallback',
    durationInFrames: fallbackFrames,
    warning:
      `public/${audioSrc} has not been analyzed (analysis is for ${source === null ? 'no track' : `public/${source}`}). ` +
      `Using fallback timing (${fallbackLabel}); run \`pnpm analyze\`.`,
  };
};
