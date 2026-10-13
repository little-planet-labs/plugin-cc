// `pnpm beatmap [--force]`
//
// Writes creative/beatmap.md: a skeleton for planning the video against the
// music, from the timing in effect (scripts/lib/project.mjs: the analysis with
// timing-overrides.json applied, the lyric lines and the placed sections,
// exactly as the page sees them). It holds the tempo and bar length,
// candidate drops and accents found in the band energy, the sections and one
// row per lyric line (frames and seconds, with empty columns to fill in), and
// a layer list to fill in. Frames are absolute song frames,
// round(seconds * fps) at src/pipeline.json's fps.
//
// Energy jumps: pnpm analyze stores each band's energy as 0..1 over a 48 dB
// range, so energy * 48 is dB above the band's floor. The rise at frame f is
// (mean over [f, f + W) - mean over [f - W, f)) * 48 dB:
// - candidate drops: W = 1 s on the mean of the three bands, rise >= 6 dB;
// - candidate accents: W = 0.1 s per band, rise >= 12 dB, the 24 largest.
// A candidate is the largest rise within its window either side; on a tie
// the later frame wins (a burst shorter than W rises equally from W - 1
// frames before it, and the later frame is where it starts). Key changes
// can't be read from band energy and aren't listed. The output is
// deterministic: the same data gives the same bytes.
//
// It prints the project's timing warnings. With no track at all (no audio
// file and the no-track analysis) it writes the skeleton on the fallback grid
// with a warning; when the timing in effect is the fallback for any other
// reason (a track that hasn't been analysed, an analysis at another fps) it
// stops, naming `pnpm analyze`, and writes nothing. It never replaces an existing
// creative/beatmap.md without --force, and writes through a temp file renamed
// into place.
import {existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CliError, runCli} from './lib/cli.mjs';
import {loadProject, readJson} from './lib/project.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BEATMAP_PATH = 'creative/beatmap.md';
/** dB spanned by energy 0..1 (scripts/analyze_audio.py ENERGY_RANGE_DB). */
export const ENERGY_RANGE_DB = 48;
export const DROP_WINDOW_SECONDS = 1;
export const DROP_MIN_DB = 6;
export const ACCENT_WINDOW_SECONDS = 0.1;
export const ACCENT_MIN_DB = 12;
/** Accents in one band closer than this keep only the largest. */
export const ACCENT_SPACING_SECONDS = 0.5;
export const ACCENT_LIMIT = 24;

/** Only `--force`. */
export const parseBeatmapArgs = (argv) => {
  let force = false;
  for (const arg of argv) {
    if (arg !== '--force') throw new CliError(`unexpected argument "${arg}" (the only flag is --force, to replace an existing ${BEATMAP_PATH})`);
    if (force) throw new CliError('--force given twice; pass it once');
    force = true;
  }
  return {force};
};

/**
 * Rise in dB at every frame: (mean of values[f, f + w) - mean of values[f - w, f)) * 48,
 * or null where either window would leave the data.
 */
export const energyRise = (values, w) => {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1] + v);
  return values.map((_, f) => {
    if (f - w < 0 || f + w > values.length) return null;
    const after = (prefix[f + w] - prefix[f]) / w;
    const before = (prefix[f] - prefix[f - w]) / w;
    return (after - before) * ENERGY_RANGE_DB;
  });
};

/**
 * Frames whose rise is at least `minDb` and the largest within `radius`
 * frames either side; on a tie the later frame wins.
 */
export const risePeaks = (rise, minDb, radius) => {
  const out = [];
  rise.forEach((r, f) => {
    if (r === null || r < minDb) return;
    for (let g = Math.max(0, f - radius); g <= Math.min(rise.length - 1, f + radius); g++) {
      const q = rise[g];
      if (q === null || g === f) continue;
      if (q > r || (q === r && g > f)) return;
    }
    out.push({frame: f, rise: r});
  });
  return out;
};

/** Candidate drops and accents from the analysis (see the header for the rules). */
export const energyCandidates = (analysis, fps) => {
  const {low, mid, high} = analysis.energy;
  const n = Math.min(low.length, mid.length, high.length);
  const wDrop = Math.max(1, Math.round(DROP_WINDOW_SECONDS * fps));
  const overall = Array.from({length: n}, (_, f) => (low[f] + mid[f] + high[f]) / 3);
  const drops = risePeaks(energyRise(overall, wDrop), DROP_MIN_DB, wDrop);

  const wAccent = Math.max(1, Math.round(ACCENT_WINDOW_SECONDS * fps));
  const spacing = Math.max(1, Math.round(ACCENT_SPACING_SECONDS * fps));
  const byFrame = new Map();
  for (const band of ['low', 'mid', 'high']) {
    for (const p of risePeaks(energyRise(analysis.energy[band].slice(0, n), wAccent), ACCENT_MIN_DB, spacing)) {
      const at = byFrame.get(p.frame);
      if (at) {
        at.bands.push(band);
        at.rise = Math.max(at.rise, p.rise);
      } else byFrame.set(p.frame, {frame: p.frame, bands: [band], rise: p.rise});
    }
  }
  const all = [...byFrame.values()];
  const accents = [...all]
    .sort((a, b) => b.rise - a.rise || a.frame - b.frame)
    .slice(0, ACCENT_LIMIT)
    .sort((a, b) => a.frame - b.frame);
  return {drops, accents, accentTotal: all.length, wDrop, wAccent};
};

const nearest = (frames, f) => {
  let best = null;
  for (const g of frames) if (best === null || Math.abs(g - f) < Math.abs(best - f)) best = g;
  return best;
};
const s2 = (seconds) => seconds.toFixed(2);
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const offset = (target, f) => (target === null ? '-' : `${target} (${target - f >= 0 ? '+' : ''}${target - f})`);

/**
 * The beatmap's Markdown (pure, deterministic).
 * @param {{analysis: import('../src/lib/analysis.js').AudioAnalysis, lyrics: {id: string, text: string, start: number, end: number}[],
 *   sections: {id: string, scene: string, variant?: string, start: number, end: number, from: number, to: number}[] | null, fps: number}} o
 *   sections: the placed sections, or null when sections.json is empty (the whole song is one section).
 */
export const beatmapMarkdown = ({analysis, lyrics, sections, fps}) => {
  const frame = (s) => Math.round(s * fps);
  const total = analysis.durationInFrames;
  const beat = 60 / analysis.tempo;
  const beatFrames = analysis.beats.map(frame);
  const downbeatFrames = analysis.downbeats.map(frame);
  const out = [];
  out.push('# Beat map', '');
  out.push(
    'Generated by `pnpm beatmap` from src/data/audio-analysis.json (with timing-overrides.json), src/data/lyrics.json and src/data/sections.json. ' +
      `Frames are absolute song frames at ${fps} fps: frame = round(seconds × ${fps}). ` +
      '`pnpm beatmap --force` regenerates this file and replaces everything in it.',
    '',
  );

  out.push('## Timing', '');
  out.push(`- Track: ${analysis.source ?? 'none (audio-analysis.json is the no-track default; run `pnpm analyze`)'}`);
  out.push(`- Duration: ${s2(analysis.durationSeconds)} s, ${total} frames`);
  out.push(
    `- Tempo: ${analysis.tempo.toFixed(2)} BPM. Beat: ${beat.toFixed(3)} s (${(beat * fps).toFixed(2)} frames). ` +
      `Bar of ${analysis.beatsPerBar} beats: ${(beat * analysis.beatsPerBar).toFixed(3)} s (${(beat * analysis.beatsPerBar * fps).toFixed(2)} frames).`,
  );
  out.push(
    downbeatFrames.length > 0
      ? `- Downbeats: ${downbeatFrames.length}, the first at frame ${downbeatFrames[0]} (${s2(analysis.downbeats[0])} s).`
      : '- Downbeats: none in the analysis.',
  );
  out.push('');

  const {drops, accents, accentTotal, wDrop, wAccent} = energyCandidates(analysis, fps);
  out.push('## Energy jumps', '');
  out.push(
    `Rise = (mean energy over the next W frames − mean over the previous W) × ${ENERGY_RANGE_DB} dB ` +
      `(pnpm analyze maps each band's top ${ENERGY_RANGE_DB} dB onto 0..1). These are candidates from the analysis.`,
    '',
  );
  out.push('### Candidate drops', '');
  out.push(`All three bands averaged, W = ${wDrop} frames, rise ≥ ${DROP_MIN_DB} dB.`, '');
  if (drops.length === 0) out.push('None found.');
  else {
    out.push('| frame | seconds | rise dB | nearest downbeat frame |', '|---|---|---|---|');
    for (const d of drops) out.push(`| ${d.frame} | ${s2(d.frame / fps)} | ${d.rise.toFixed(1)} | ${offset(nearest(downbeatFrames, d.frame), d.frame)} |`);
  }
  out.push('');
  out.push('### Candidate accents', '');
  out.push(
    `Per band, W = ${wAccent} frames, rise ≥ ${ACCENT_MIN_DB} dB, at most one per band per ${ACCENT_SPACING_SECONDS} s; ` +
      `the ${ACCENT_LIMIT} largest, in time order${accentTotal > accents.length ? ` (${accents.length} of ${accentTotal})` : ''}.`,
    '',
  );
  if (accents.length === 0) out.push('None found.');
  else {
    out.push('| frame | seconds | band | rise dB | nearest beat frame |', '|---|---|---|---|---|');
    for (const a of accents) {
      out.push(`| ${a.frame} | ${s2(a.frame / fps)} | ${a.bands.join(', ')} | ${a.rise.toFixed(1)} | ${offset(nearest(beatFrames, a.frame), a.frame)} |`);
    }
  }
  out.push('');
  out.push('Key changes: not detected. Band energy carries no pitch information.', '');

  out.push('## Sections', '');
  if (sections === null) out.push('None in sections.json (the whole song plays as one section).');
  else {
    out.push('| id | scene | variant | frames | seconds |', '|---|---|---|---|---|');
    for (const s of sections) {
      out.push(`| ${cell(s.id)} | ${cell(s.scene)} | ${cell(s.variant ?? '')} | ${s.from}–${s.to} | ${s2(s.start)}–${s2(s.end)} |`);
    }
  }
  out.push('');

  out.push('## Lines', '');
  if (lyrics.length === 0) out.push('None in lyrics.json.');
  else {
    out.push('| id | frames | seconds | text | world | transition in | text exit | one-off accent |', '|---|---|---|---|---|---|---|---|');
    for (const l of lyrics) {
      out.push(`| ${cell(l.id)} | ${frame(l.start)}–${frame(l.end)} | ${s2(l.start)}–${s2(l.end)} | ${cell(l.text)} |  |  |  |  |`);
    }
  }
  out.push('');

  out.push('## Layers', '');
  out.push('### World layer', '');
  out.push('- Shots and transitions:', '- Camera:', '- One-off effects:', '');
  out.push('### Lyric layer', '');
  out.push('- Lines and their exits:', '');
  return out.join('\n');
};

/** Write creative/beatmap.md under `root`. Returns the path written. */
export const beatmap = async ({force = false, root = projectRoot}, cleanup) => {
  const target = join(root, BEATMAP_PATH);
  if (existsSync(target) && !force) throw new CliError(`${BEATMAP_PATH} already exists; pass --force to replace it`);
  const {sectionSpecs, project} = loadProject(root);
  const {fps} = project;
  for (const w of project.warnings) console.warn(`beatmap: warning: ${w}`);
  if (project.timing === 'fallback') {
    // The fallback grid is a plan only when there is no track at all; with a track present (not analysed, or
    // analysed at another fps) it would plan the video against the wrong tempo and length.
    const noTrack = project.audio === null && readJson(root, 'src/data/audio-analysis.json').source === null;
    if (!noTrack) {
      throw new CliError(
        `the timing in effect is the ${project.duration.toFixed(0)} s fallback grid, not an analysis of the track` +
          `${project.warnings.length > 0 ? ' (see the warnings above)' : ''}; run \`pnpm analyze\` first`,
      );
    }
    console.warn('beatmap: no track and no analysis: writing the fallback grid; run `pnpm analyze` for real tempo and energy');
  }
  const markdown = beatmapMarkdown({analysis: project.analysis, lyrics: project.lyrics, sections: sectionSpecs.length === 0 ? null : project.sections, fps});

  mkdirSync(dirname(target), {recursive: true});
  const partial = join(dirname(target), `.beatmap.md.partial-${process.pid}`);
  cleanup.add(() => rmSync(partial, {force: true}));
  writeFileSync(partial, markdown);
  renameSync(partial, target);
  console.log(`beatmap: wrote ${target} (${project.lyrics.length} lines, ${sectionSpecs.length} sections)`);
  return target;
};

export const main = (argv, overrides = {}) =>
  runCli('beatmap', async (cleanup) => {
    await beatmap({...parseBeatmapArgs(argv), ...overrides}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
