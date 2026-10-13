// The timing in effect for a project: which analysis drives the beats, which
// audio file plays, how many frames the video has, and where the sections
// fall. Pure ES module (no DOM, no node: imports). The page and the render
// scripts both call resolveProject, so it is the single source of the frame
// count and the audio choice. Ported from the old template's data.ts and
// audio-plan.ts.
import {applyTimingOverrides, withBeatGridFallback} from './analysis.js';
import {placeSections, sectionsWithinDuration, withWholeSongSection} from './sections.js';

/** @typedef {import('./analysis.js').AudioAnalysis} AudioAnalysis */
/** @typedef {import('./analysis.js').TimingOverrides} TimingOverrides */
/** @typedef {import('./lyrics.js').LyricLine} LyricLine */
/** @typedef {import('./sections.js').SectionSpec} SectionSpec */
/** @typedef {import('./sections.js').PlacedSection} PlacedSection */
/** @typedef {import('./pipeline.js').Pipeline} Pipeline */

/**
 * @typedef {object} Project
 * @property {number} fps
 * @property {number} width
 * @property {number} height
 * @property {'analysis' | 'fallback'} timing 'analysis': src/data/audio-analysis.json (with timing-overrides.json).
 *   'fallback': the no-track default at pipeline fps, fallbackSeconds long, a steady beat grid at its tempo.
 * @property {AudioAnalysis} analysis The analysis scenes read (always at pipeline fps).
 * @property {string | null} audio Track path relative to public/ to play and mux, or null for silence.
 * @property {number} frames Frame count of every render (= analysis.durationInFrames).
 * @property {number} durationInFrames Same as frames.
 * @property {number} duration Seconds: frames / fps.
 * @property {PlacedSection[]} sections Placed on the frame timeline, tiling [0, frames).
 * @property {LyricLine[]} lyrics Lines in effect, each with an id.
 * @property {string[]} warnings Things the user should fix; the render goes on.
 */

/**
 * The no-track timing at pipeline fps: the default analysis's tempo and meter,
 * `fallbackSeconds` long (ceil(fallbackSeconds * fps) frames), silent, with a
 * steady beat grid.
 * @param {AudioAnalysis} defaultAnalysis
 * @param {Pipeline} pipeline
 * @returns {AudioAnalysis}
 */
export const fallbackAnalysis = (defaultAnalysis, pipeline) =>
  withBeatGridFallback({
    ...defaultAnalysis,
    source: null,
    fps: pipeline.fps,
    durationSeconds: pipeline.fallbackSeconds,
    durationInFrames: Math.ceil(pipeline.fallbackSeconds * pipeline.fps - 1e-9),
    beats: [],
    downbeats: [],
    onsets: [],
    energy: {low: [], mid: [], high: []},
  });

/**
 * Lyric lines with ids: lines without one get "line-<n>" (1-based position).
 * Throws when that collides with a real id.
 * @param {readonly LyricLine[]} lines
 * @returns {LyricLine[]}
 */
export const withLineIds = (lines) => {
  const ids = new Set(lines.map((l) => l.id).filter((id) => id !== undefined));
  return lines.map((l, i) => {
    if (l.id !== undefined) return l;
    const id = `line-${i + 1}`;
    if (ids.has(id)) throw new Error(`lyrics.json: [${i}] has no id and "${id}" is taken; give every line an id`);
    return {...l, id};
  });
};

/**
 * Resolve the timing in effect.
 *
 * Audio: the analysed file when it is present, else the first present
 * candidate, else silence. Timing:
 * - analysed track present (its source is the chosen file) and analysed at
 *   pipeline fps: the analysis, with timing-overrides.json applied, plus a
 *   beat grid when no beats were detected; sections placed strictly (a
 *   section past the end throws, naming it);
 * - analysed track missing and nothing else present: the analysis, silent,
 *   with a warning;
 * - no analysis (source null): the fallback timing; a warning when a file is
 *   present (it hasn't been analysed);
 * - a present file that isn't the analysed one, or an analysis made at another
 *   fps: the fallback timing, with a warning.
 * On fallback timing, sections and lyric lines that start past the end are
 * dropped so previews still render.
 *
 * @param {object} input
 * @param {Pipeline} input.pipeline
 * @param {AudioAnalysis} input.analysis Parsed src/data/audio-analysis.json.
 * @param {AudioAnalysis} input.defaultAnalysis Parsed src/data/audio-analysis.default.json.
 * @param {TimingOverrides} input.overrides Parsed src/data/timing-overrides.json.
 * @param {readonly LyricLine[]} input.lyrics Parsed src/data/lyrics.json.
 * @param {readonly SectionSpec[]} input.sections Parsed src/data/sections.json.
 * @param {readonly string[]} input.present Which of pipeline.audioCandidates exist under public/.
 * @returns {Project}
 */
export const resolveProject = ({pipeline, analysis, defaultAnalysis, overrides, lyrics, sections, present}) => {
  const {fps, fallbackSeconds} = pipeline;
  const warnings = [];
  const {source} = analysis;
  const candidates = pipeline.audioCandidates;
  const ordered = source === null ? candidates : [source, ...candidates.filter((p) => p !== source)];
  const audio = ordered.find((p) => candidates.includes(p) && present.includes(p)) ?? null;
  const fallback = fallbackAnalysis(defaultAnalysis, pipeline);
  const fallbackLabel = `${fallbackSeconds}s, ${fallback.tempo} BPM grid`;

  /** @type {'analysis' | 'fallback'} */
  let timing;
  if (source !== null && analysis.fps !== fps) {
    timing = 'fallback';
    warnings.push(
      `audio-analysis.json was made at ${analysis.fps}fps but pipeline.json fps is ${fps}. ` +
        `Using fallback timing (${fallbackLabel}); run \`pnpm analyze\`.`,
    );
  } else if (audio === null) {
    timing = source === null ? 'fallback' : 'analysis';
    if (source !== null) warnings.push(`audio-analysis.json is for public/${source}, which is missing. Rendering silent with its analysed timing.`);
  } else if (audio === source) {
    timing = 'analysis';
  } else {
    timing = 'fallback';
    warnings.push(
      `public/${audio} has not been analysed (analysis is for ${source === null ? 'no track' : `public/${source}`}). ` +
        `Using fallback timing (${fallbackLabel}); run \`pnpm analyze\`.`,
    );
  }

  const inEffect = timing === 'analysis' ? withBeatGridFallback(applyTimingOverrides(analysis, overrides)) : fallback;
  const frames = inEffect.durationInFrames;
  const duration = frames / fps;
  const specs = withWholeSongSection(sections);
  const placed = placeSections(timing === 'analysis' ? specs : sectionsWithinDuration(specs, fps, frames), fps, frames);

  let lines = withLineIds(lyrics);
  if (timing === 'fallback') {
    const kept = lines.filter((l) => l.start < duration);
    if (kept.length < lines.length) warnings.push(`${lines.length - kept.length} lyric line(s) start after the ${fallbackSeconds}s fallback timing and are left out.`);
    lines = kept;
  }

  return {
    fps,
    width: pipeline.width,
    height: pipeline.height,
    timing,
    analysis: inEffect,
    audio,
    frames,
    durationInFrames: frames,
    duration,
    sections: placed,
    lyrics: lines,
    warnings,
  };
};
