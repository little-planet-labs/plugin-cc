// Shape of src/data/audio-analysis.json (written by scripts/analyze_audio.py;
// keep the two in sync) and of src/data/timing-overrides.json, with their
// validation. Pure ES module (no DOM, no node: imports): the page and the Node
// scripts both import it.

export const ENERGY_BANDS = Object.freeze(['low', 'mid', 'high']);

/**
 * @typedef {'low' | 'mid' | 'high'} EnergyBand
 *
 * @typedef {object} AudioAnalysis
 * @property {1} version
 * @property {string | null} source Track path relative to public/ (e.g. "audio/track.wav"), or null for the no-track default.
 * @property {string} generator
 * @property {number} fps
 * @property {number} durationSeconds
 * @property {number} durationInFrames ceil(durationSeconds * fps - 1e-9): the frame count of every render.
 * @property {number} tempo Estimated BPM.
 * @property {number} beatsPerBar Assumed meter used for downbeat estimation (4 = 4/4).
 * @property {number[]} beats Beat times in seconds, ascending.
 * @property {number[]} downbeats Estimated bar starts in seconds, ascending; a subset of `beats`.
 * @property {number[]} onsets Onset (transient) times in seconds, ascending.
 * @property {Record<EnergyBand, [number, number]>} bands Band edges in Hz, for reference.
 * @property {Record<EnergyBand, number[]>} energy One normalized 0..1 value per video frame, per band. Empty when there's no track.
 */

/** @returns {never} */
const fail = (path, expected) => {
  throw new Error(`audio-analysis.json: ${path} must be ${expected}. Re-run \`pnpm analyze\`.`);
};

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (obj, key) => {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(key, 'a finite number');
};

const ascendingNumbers = (v, path) => {
  if (!Array.isArray(v)) return fail(path, 'an array of numbers');
  let prev = -Infinity;
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < prev) {
      fail(path, 'an ascending array of finite numbers');
    }
    prev = x;
  }
  return v;
};

/**
 * Validate raw JSON into an AudioAnalysis, failing loudly on a stale or hand-edited file.
 * @param {unknown} raw
 * @returns {AudioAnalysis}
 */
export const parseAudioAnalysis = (raw) => {
  if (!isRecord(raw)) return fail('root', 'an object');
  if (raw.version !== 1) fail('version', '1');
  const source = raw.source;
  if (source !== null && typeof source !== 'string') fail('source', 'a string or null');
  const fps = num(raw, 'fps');
  const durationSeconds = num(raw, 'durationSeconds');
  const durationInFrames = num(raw, 'durationInFrames');
  const tempo = num(raw, 'tempo');
  const beatsPerBar = num(raw, 'beatsPerBar');
  if (fps <= 0) fail('fps', '> 0');
  if (durationSeconds <= 0) fail('durationSeconds', '> 0');
  if (!Number.isInteger(durationInFrames) || durationInFrames <= 0) fail('durationInFrames', 'a positive integer');
  if (tempo <= 0) fail('tempo', '> 0');
  if (!Number.isInteger(beatsPerBar) || beatsPerBar <= 0) fail('beatsPerBar', 'a positive integer');

  if (!isRecord(raw.energy)) return fail('energy', 'an object');
  if (!isRecord(raw.bands)) return fail('bands', 'an object');
  const energy = {};
  const bands = {};
  for (const band of ENERGY_BANDS) {
    const values = raw.energy[band];
    if (!Array.isArray(values) || values.some((x) => typeof x !== 'number' || !(x >= 0 && x <= 1))) {
      fail(`energy.${band}`, 'an array of numbers in 0..1');
    }
    energy[band] = values;
    const edges = raw.bands[band];
    if (!Array.isArray(edges) || edges.length !== 2 || edges.some((x) => typeof x !== 'number')) {
      fail(`bands.${band}`, 'a [lowHz, highHz] pair');
    }
    bands[band] = edges;
  }

  const beats = ascendingNumbers(raw.beats, 'beats');
  const downbeats = ascendingNumbers(raw.downbeats, 'downbeats');

  // Cross-field checks.
  for (const band of ENERGY_BANDS) {
    const n = energy[band].length;
    if (n !== 0 && n !== durationInFrames) {
      fail(`energy.${band}`, `empty or exactly durationInFrames (${durationInFrames}) long, got ${n}`);
    }
  }
  for (const d of downbeats) {
    if (findTimeIndex(beats, d) < 0) fail('downbeats', `a subset of beats (${d}s is not a beat)`);
  }
  if (beats.length > 0 && downbeats.length === 0) fail('downbeats', 'non-empty when beats are present');

  return {
    version: 1,
    source,
    generator: typeof raw.generator === 'string' ? raw.generator : 'unknown',
    fps,
    durationSeconds,
    durationInFrames,
    tempo,
    beatsPerBar,
    beats,
    downbeats,
    onsets: ascendingNumbers(raw.onsets, 'onsets'),
    bands,
    energy,
  };
};

/** Two times are the same event when within this many seconds (JSON values are rounded to ms). */
const SAME_TIME_EPSILON = 1e-6;

/**
 * Index of `t` in ascending `times` (within SAME_TIME_EPSILON), or -1.
 * @param {readonly number[]} times
 * @param {number} t
 * @returns {number}
 */
export const findTimeIndex = (times, t) => {
  let lo = 0;
  let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid];
    if (Math.abs(v - t) <= SAME_TIME_EPSILON) return mid;
    if (v < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
};

/**
 * When no beats were detected (the no-track default, or a beatless track), fill
 * in a steady grid at `tempo` so beat-driven scenes still animate in previews.
 * Downbeats follow every `beatsPerBar` beats from t=0. Energy stays as-is (empty = silence).
 * @param {AudioAnalysis} a
 * @returns {AudioAnalysis}
 */
export const withBeatGridFallback = (a) => {
  if (a.beats.length > 0) return a;
  const period = 60 / a.tempo;
  const beats = [];
  for (let i = 0; i * period < a.durationSeconds; i++) {
    beats.push(Math.round(i * period * 1000) / 1000);
  }
  const downbeats = beats.filter((_, i) => i % a.beatsPerBar === 0);
  return {...a, beats, downbeats};
};

// ---------------------------------------------------------------------------
// Hand corrections: src/data/timing-overrides.json
// ---------------------------------------------------------------------------

/**
 * Manual fixes applied on top of the detected analysis at load time. All times
 * are seconds from the start of the track. Every field is optional; `{}` means
 * "use the detection as-is". They affect the beat helpers, not sections.json.
 *
 * @typedef {object} TimingOverrides
 * @property {number} [firstBeat] Detected beats before this time are dropped (e.g. a free-time sung intro).
 * @property {number} [lastBeat] Detected beats after this time are dropped (e.g. a ringing outro).
 * @property {number[]} [downbeats] Bar starts ("the 1"). Each anchor snaps to the nearest detected beat,
 *   which must be within half a beat. Bars then count every `beatsPerBar` beats from the most recent
 *   anchor, so one anchor per section (verse, chorus, bridge) repairs a bar position that slipped on a
 *   missed or extra beat. Beats before the first anchor count backwards from it.
 */

const OVERRIDE_KEYS = new Set(['firstBeat', 'lastBeat', 'downbeats', '$comment']);

/** @returns {never} */
const overrideFail = (path, expected) => {
  throw new Error(`timing-overrides.json: ${path} must be ${expected}`);
};

const nonNegativeSeconds = (v, path) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : overrideFail(path, 'a number of seconds >= 0');

/**
 * @param {unknown} raw
 * @returns {TimingOverrides}
 */
export const parseTimingOverrides = (raw) => {
  if (!isRecord(raw)) return overrideFail('root', 'an object');
  for (const key of Object.keys(raw)) {
    if (!OVERRIDE_KEYS.has(key)) overrideFail(key, `one of ${[...OVERRIDE_KEYS].join(', ')} (unknown key)`);
  }
  /** @type {TimingOverrides} */
  const out = {};
  if (raw.firstBeat !== undefined) out.firstBeat = nonNegativeSeconds(raw.firstBeat, 'firstBeat');
  if (raw.lastBeat !== undefined) out.lastBeat = nonNegativeSeconds(raw.lastBeat, 'lastBeat');
  if (out.firstBeat !== undefined && out.lastBeat !== undefined && out.lastBeat <= out.firstBeat) {
    overrideFail('lastBeat', 'greater than firstBeat');
  }
  if (raw.downbeats !== undefined) {
    if (!Array.isArray(raw.downbeats)) return overrideFail('downbeats', 'an array of seconds');
    const anchors = raw.downbeats.map((v, i) => nonNegativeSeconds(v, `downbeats[${i}]`));
    anchors.forEach((v, i) => {
      if (i > 0 && v <= anchors[i - 1]) overrideFail('downbeats', 'strictly ascending');
    });
    out.downbeats = anchors;
  }
  return out;
};

const nearestIndex = (times, t) => {
  let best = -1;
  let bestDist = Infinity;
  // Binary search for the insertion point, then compare its neighbours.
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  for (const i of [lo - 1, lo]) {
    const v = times[i];
    if (v !== undefined && Math.abs(v - t) < bestDist) {
      best = i;
      bestDist = Math.abs(v - t);
    }
  }
  return best;
};

/**
 * Apply hand corrections. Throws (with the offending field) when an override can't be honoured.
 * @param {AudioAnalysis} a
 * @param {TimingOverrides} o
 * @returns {AudioAnalysis}
 */
export const applyTimingOverrides = (a, o) => {
  const lo = o.firstBeat ?? -Infinity;
  const hi = o.lastBeat ?? Infinity;
  const beats = a.beats.filter((t) => t >= lo - SAME_TIME_EPSILON && t <= hi + SAME_TIME_EPSILON);
  if (beats.length === 0 && a.beats.length > 0) {
    overrideFail('firstBeat/lastBeat', 'a range that keeps at least one detected beat');
  }

  let downbeats;
  if (o.downbeats && o.downbeats.length > 0) {
    const halfBeat = 30 / a.tempo;
    const anchorIdx = o.downbeats.map((t, k) => {
      const i = nearestIndex(beats, t);
      const nearest = beats[i];
      if (nearest === undefined || Math.abs(nearest - t) > halfBeat) {
        return overrideFail(
          `downbeats[${k}] (${t}s)`,
          `within half a beat (${halfBeat.toFixed(3)}s) of a detected beat${nearest === undefined ? '' : `; nearest is ${nearest}s`}`,
        );
      }
      return i;
    });
    anchorIdx.forEach((i, k) => {
      if (k > 0 && i <= anchorIdx[k - 1]) {
        overrideFail(`downbeats[${k}]`, 'on a later beat than the previous anchor (two anchors snapped to the same beat)');
      }
    });
    const idx = [];
    const first = anchorIdx[0];
    for (let i = first - a.beatsPerBar; i >= 0; i -= a.beatsPerBar) idx.unshift(i);
    anchorIdx.forEach((start, k) => {
      const end = anchorIdx[k + 1] ?? beats.length;
      for (let i = start; i < end; i += a.beatsPerBar) idx.push(i);
    });
    downbeats = idx.map((i) => beats[i]);
  } else {
    downbeats = a.downbeats.filter((t) => findTimeIndex(beats, t) >= 0);
    if (beats.length > 0 && downbeats.length === 0) {
      overrideFail('firstBeat/lastBeat', 'a range that keeps at least one detected downbeat (or add a downbeats anchor)');
    }
  }
  return {...a, beats, downbeats};
};
