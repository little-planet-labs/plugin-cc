// Shape of src/pipeline.json (what the page and the render scripts share) and
// its validation. Pure ES module (no DOM, no node: imports): the page and the
// Node scripts both import it.
//
// `render` and `draft` are optional, key by key: a missing key takes its value
// from DEFAULT_RENDER / DEFAULT_DRAFT. Everything else is required.

/** x264 `-preset` names, fastest first. */
export const X264_PRESETS = Object.freeze([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
  'placebo',
]);

/** Frame capture formats. */
export const FRAME_FORMATS = Object.freeze(['png', 'jpeg']);

/**
 * Sample rates fps must divide, so a video frame is a whole number of samples
 * at each: 22050 Hz is what scripts/analyze_audio.py analyses at (one energy
 * value per frame, hop = 22050 / fps), 48000 Hz is the render's audio rate.
 * Together: fps divides 150 (1, 2, 3, 5, 6, 10, 15, 25, 30, 50, 75, 150).
 */
export const AUDIO_SAMPLE_RATES = Object.freeze([22050, 48000]);

/**
 * @typedef {object} RenderSettings
 * @property {number} scale deviceScaleFactor of the capture (2 = 3840x2160 from a 1920x1080 page);
 *   width*scale and height*scale must be even integers (libx264 with yuv420p).
 * @property {number} crf x264 CRF, 0..51.
 * @property {string} preset x264 preset (X264_PRESETS).
 * @property {number} pool Hard cap on parallel chunk workers.
 * @property {number} chunkSeconds Length of one chunk, seconds.
 * @property {number} shutter Subframe-blur shutter, in (0, 1].
 * @property {'png' | 'jpeg'} format Frame capture format.
 * @property {string} audioBitrate AAC bitrate for the mux, e.g. "256k".
 * @property {number} retries Times a failed chunk is retried.
 *
 * @typedef {object} DraftSettings
 * @property {number} scale Same rule as RenderSettings.scale.
 * @property {number} crf
 * @property {string} preset
 * @property {'png' | 'jpeg'} format
 *
 * @typedef {object} Pipeline
 * @property {string} outputName The master is out/<outputName>.mp4.
 * @property {number} fps Integer dividing both 22050 and 48000 (AUDIO_SAMPLE_RATES), i.e. dividing 150.
 * @property {number} width Page width in CSS px; even.
 * @property {number} height Page height in CSS px; even.
 * @property {number} fallbackSeconds Length of the no-track default timing.
 * @property {string[]} audioCandidates Track paths relative to public/, in preference order.
 * @property {RenderSettings} render
 * @property {DraftSettings} draft
 */

/** @type {Readonly<RenderSettings>} */
export const DEFAULT_RENDER = Object.freeze({
  scale: 2,
  crf: 17,
  preset: 'medium',
  pool: 2,
  chunkSeconds: 20,
  shutter: 0.5,
  format: 'png',
  audioBitrate: '256k',
  retries: 2,
});

/** @type {Readonly<DraftSettings>} */
export const DEFAULT_DRAFT = Object.freeze({
  scale: 0.5,
  crf: 23,
  preset: 'veryfast',
  format: 'jpeg',
});

const TOP_KEYS = ['outputName', 'fps', 'width', 'height', 'fallbackSeconds', 'audioCandidates', 'render', 'draft'];

/** @returns {never} */
const fail = (path, expected, value) => {
  throw new Error(`pipeline.json: ${path} must be ${expected} (got ${JSON.stringify(value)})`);
};

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const onlyKeys = (rec, allowed, prefix) => {
  for (const key of Object.keys(rec)) {
    if (key !== '$comment' && !allowed.includes(key)) {
      throw new Error(`pipeline.json: ${prefix}${key} must be one of ${allowed.join(', ')} (unknown key)`);
    }
  }
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const positiveInt = (v, path) => (Number.isInteger(v) && v > 0 ? v : fail(path, 'a positive integer', v));

const evenInt = (v, path) => (Number.isInteger(v) && v > 0 && v % 2 === 0 ? v : fail(path, 'an even positive integer', v));

/** Up to 6 decimals, for messages: 1920 * 0.33 shows as 633.6, not 633.6000000000001. */
const show = (x) => Number(x.toFixed(6));

/** A scale whose output frame is width*scale x height*scale, both even integers. */
const frameScale = (v, path, width, height) => {
  const scale = positiveNum(v, path);
  const w = width * scale;
  const h = height * scale;
  const evenWhole = (x) => Math.abs(x - Math.round(x)) < 1e-9 && Math.round(x) % 2 === 0;
  if (!evenWhole(w) || !evenWhole(h)) {
    throw new Error(
      `pipeline.json: ${path} must make width*scale and height*scale even integers (got ${scale} -> ${show(w)}x${show(h)})`,
    );
  }
  return scale;
};

const positiveNum = (v, path) => (isNum(v) && v > 0 ? v : fail(path, 'a number > 0', v));

const crf = (v, path) => (isNum(v) && v >= 0 && v <= 51 ? v : fail(path, 'a number from 0 to 51', v));

const preset = (v, path) => (X264_PRESETS.includes(v) ? v : fail(path, `one of ${X264_PRESETS.join(', ')}`, v));

const format = (v, path) => (FRAME_FORMATS.includes(v) ? v : fail(path, '"png" or "jpeg"', v));

/** A path relative to public/: no leading "/", no ".." segment. */
const audioCandidate = (v, path) => {
  if (typeof v !== 'string' || v.trim() === '') return fail(path, 'a non-empty string', v);
  if (v.startsWith('/') || v.split(/[\\/]/).includes('..')) return fail(path, 'a path relative to public/, e.g. "audio/track.wav"', v);
  return v;
};

/** One file name: the master is out/<outputName>.mp4. */
const outputName = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return fail('outputName', 'a non-empty string', v);
  if (/[\\/]/.test(v) || v.startsWith('.')) return fail('outputName', 'a file name without "/" or "\\" that does not start with "."', v);
  return v;
};

/**
 * Validate raw JSON into a Pipeline, filling any missing `render` / `draft`
 * key from DEFAULT_RENDER / DEFAULT_DRAFT. Unknown keys (other than "$comment")
 * are rejected so a typo (or the retired `compositionId`) fails loudly. Errors
 * name the offending field.
 * @param {unknown} raw
 * @returns {Pipeline}
 */
export const parsePipeline = (raw) => {
  if (!isRecord(raw)) return fail('root', 'an object', raw);
  onlyKeys(raw, TOP_KEYS, '');

  const fps = positiveInt(raw.fps, 'fps');
  if (AUDIO_SAMPLE_RATES.some((rate) => rate % fps !== 0)) {
    fail('fps', `an integer dividing both ${AUDIO_SAMPLE_RATES.join(' and ')} (1, 2, 3, 5, 6, 10, 15, 25, 30, 50, 75 or 150)`, raw.fps);
  }
  const width = evenInt(raw.width, 'width');
  const height = evenInt(raw.height, 'height');

  const {audioCandidates} = raw;
  if (!Array.isArray(audioCandidates) || audioCandidates.length === 0) {
    fail('audioCandidates', 'a non-empty array of paths relative to public/', audioCandidates);
  }

  const renderRaw = raw.render === undefined ? {} : raw.render;
  if (!isRecord(renderRaw)) fail('render', 'an object', raw.render);
  onlyKeys(renderRaw, Object.keys(DEFAULT_RENDER), 'render.');
  const r = {...DEFAULT_RENDER, ...renderRaw};

  const draftRaw = raw.draft === undefined ? {} : raw.draft;
  if (!isRecord(draftRaw)) fail('draft', 'an object', raw.draft);
  onlyKeys(draftRaw, Object.keys(DEFAULT_DRAFT), 'draft.');
  const d = {...DEFAULT_DRAFT, ...draftRaw};

  if (!(isNum(r.shutter) && r.shutter > 0 && r.shutter <= 1)) fail('render.shutter', 'a number in (0, 1]', r.shutter);
  if (!(Number.isInteger(r.retries) && r.retries >= 0)) fail('render.retries', 'a non-negative integer', r.retries);
  if (!(typeof r.audioBitrate === 'string' && /^[1-9]\d*k$/.test(r.audioBitrate))) {
    fail('render.audioBitrate', 'a bitrate in kbit/s like "256k"', r.audioBitrate);
  }

  return {
    outputName: outputName(raw.outputName),
    fps,
    width,
    height,
    fallbackSeconds: positiveNum(raw.fallbackSeconds, 'fallbackSeconds'),
    audioCandidates: audioCandidates.map((p, i) => audioCandidate(p, `audioCandidates[${i}]`)),
    render: {
      scale: frameScale(r.scale, 'render.scale', width, height),
      crf: crf(r.crf, 'render.crf'),
      preset: preset(r.preset, 'render.preset'),
      pool: positiveInt(r.pool, 'render.pool'),
      chunkSeconds: positiveNum(r.chunkSeconds, 'render.chunkSeconds'),
      shutter: r.shutter,
      format: format(r.format, 'render.format'),
      audioBitrate: r.audioBitrate,
      retries: r.retries,
    },
    draft: {
      scale: frameScale(d.scale, 'draft.scale', width, height),
      crf: crf(d.crf, 'draft.crf'),
      preset: preset(d.preset, 'draft.preset'),
      format: format(d.format, 'draft.format'),
    },
  };
};
