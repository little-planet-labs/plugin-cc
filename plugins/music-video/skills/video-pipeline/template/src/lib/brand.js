// Shape of src/brand.json (the company's brand tokens) and its validation.
// Pure ES module (no DOM, no node: imports): the page and the Node scripts both
// import it. The theme is the only reader in the page; scenes take colors and
// fonts from the theme.

/** The neutral (gray) scale needs at least this many steps: a light, a middle and a dark one. */
export const MIN_NEUTRAL_STEPS = 3;

/** The semantic colors every brand.json must define (besides `neutral`). */
export const BRAND_COLOR_KEYS = Object.freeze([
  'background',
  'surface',
  'primary',
  'primaryDeep',
  'accent',
  'accentAlt',
  'text',
  'textMuted',
]);

/**
 * @typedef {'background' | 'surface' | 'primary' | 'primaryDeep' | 'accent' | 'accentAlt' | 'text' | 'textMuted'} BrandColorKey
 *
 * @typedef {object} BrandFont
 * @property {string} family CSS family name; for `source: "google"` exactly as Google Fonts lists it (e.g. "Open Sans").
 * @property {'google' | 'local'} source "google": downloaded into public/fonts/ by `pnpm fonts`.
 *   "local": font files under public/ listed in `files`. Check the license either way.
 * @property {number[]} weights Weights to load (100..900). The first is the fallback when a scene asks for one that isn't loaded.
 * @property {Record<string, string>} [files] Local fonts only: weight -> file path under public/
 *   (e.g. {"400": "public/brand/fonts/Brand-Regular.woff2"}).
 *
 * @typedef {object} BrandLogo
 * @property {string} path Project-relative path under public/, e.g. "public/brand/logo.svg".
 * @property {string} [onDark] Variant for dark backgrounds (same path rules).
 * @property {string} [onLight] Variant for light backgrounds (same path rules).
 *
 * @typedef {object} Brand
 * @property {string} name
 * @property {Record<BrandColorKey, string> & {neutral: Record<string, string>}} colors
 * @property {{display: BrandFont, body: BrandFont}} fonts
 * @property {BrandLogo} logo
 */

/** @returns {never} */
const fail = (path, expected) => {
  throw new Error(`brand.json: ${path} must be ${expected}`);
};

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const color = (v, path) =>
  typeof v === 'string' && COLOR.test(v) ? v : fail(path, `a hex color like "#1A2B3C" (got ${JSON.stringify(v)})`);

const nonEmpty = (v, path) => (typeof v === 'string' && v.trim() !== '' ? v : fail(path, 'a non-empty string'));

/** A path under public/: returns it unchanged. */
const publicPath = (v, path) => {
  const s = nonEmpty(v, path);
  if (!s.startsWith('public/') || s.includes('..')) fail(path, `a path under public/, e.g. "public/brand/logo.svg" (got ${JSON.stringify(s)})`);
  return s;
};

const onlyKeys = (rec, allowed, path) => {
  for (const key of Object.keys(rec)) {
    if (key !== '$comment' && !allowed.includes(key)) fail(`${path}.${key}`, `one of ${allowed.join(', ')} (unknown key)`);
  }
};

/** @returns {BrandFont} */
const parseFont = (raw, path) => {
  if (!isRecord(raw)) return fail(path, 'an object');
  onlyKeys(raw, ['family', 'source', 'weights', 'files'], path);
  const family = nonEmpty(raw.family, `${path}.family`);
  const {source, weights, files} = raw;
  if (source !== 'google' && source !== 'local') fail(`${path}.source`, `"google" or "local" (got ${JSON.stringify(source)})`);
  if (!Array.isArray(weights) || weights.length === 0) return fail(`${path}.weights`, 'a non-empty array of weights');
  weights.forEach((w, i) => {
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 100 || w > 900 || w % 100 !== 0) {
      fail(`${path}.weights[${i}]`, `100, 200, ... or 900 (got ${JSON.stringify(w)})`);
    }
  });
  /** @type {BrandFont} */
  const font = {family, source, weights};
  if (files !== undefined) {
    if (source !== 'local') fail(`${path}.files`, 'absent unless source is "local"');
    if (!isRecord(files)) return fail(`${path}.files`, 'an object of weight -> path under public/');
    const out = {};
    for (const [weight, file] of Object.entries(files)) {
      if (!weights.includes(Number(weight))) fail(`${path}.files.${weight}`, `a weight listed in ${path}.weights`);
      out[weight] = publicPath(file, `${path}.files.${weight}`);
    }
    font.files = out;
  }
  return font;
};

/**
 * Validate raw JSON into a Brand. Every semantic color, the required neutral
 * steps, both fonts and the logo path are required; colors are hex. Unknown
 * keys (other than "$comment") are rejected so a typo fails loudly. Errors
 * name the offending field.
 * @param {unknown} raw
 * @returns {Brand}
 */
export const parseBrand = (raw) => {
  if (!isRecord(raw)) return fail('root', 'an object');
  onlyKeys(raw, ['name', 'colors', 'fonts', 'logo'], 'root');
  const name = nonEmpty(raw.name, 'name');

  const {colors} = raw;
  if (!isRecord(colors)) return fail('colors', 'an object');
  onlyKeys(colors, [...BRAND_COLOR_KEYS, 'neutral'], 'colors');
  const semantic = {};
  for (const key of BRAND_COLOR_KEYS) semantic[key] = color(colors[key], `colors.${key}`);
  const {neutral} = colors;
  if (!isRecord(neutral)) return fail('colors.neutral', 'an object of step number -> hex color, e.g. {"50": ..., "500": ..., "900": ...}');
  const neutralOut = {};
  for (const [step, value] of Object.entries(neutral)) {
    if (step === '$comment') continue;
    if (!/^\d+$/.test(step)) fail(`colors.neutral.${step}`, 'keyed by a step number as a string, e.g. "500"');
    neutralOut[step] = color(value, `colors.neutral.${step}`);
  }
  if (Object.keys(neutralOut).length < MIN_NEUTRAL_STEPS) {
    fail('colors.neutral', `at least ${MIN_NEUTRAL_STEPS} steps (a light, a middle and a dark one)`);
  }

  const {fonts} = raw;
  if (!isRecord(fonts)) return fail('fonts', 'an object with display and body');
  onlyKeys(fonts, ['display', 'body'], 'fonts');
  const display = parseFont(fonts.display, 'fonts.display');
  const body = parseFont(fonts.body, 'fonts.body');

  const {logo} = raw;
  if (!isRecord(logo)) return fail('logo', 'an object with a path');
  onlyKeys(logo, ['path', 'onDark', 'onLight'], 'logo');
  /** @type {BrandLogo} */
  const logoOut = {path: publicPath(logo.path, 'logo.path')};
  if (logo.onDark !== undefined) logoOut.onDark = publicPath(logo.onDark, 'logo.onDark');
  if (logo.onLight !== undefined) logoOut.onLight = publicPath(logo.onLight, 'logo.onLight');

  return {name, colors: {...semantic, neutral: neutralOut}, fonts: {display, body}, logo: logoOut};
};

/**
 * The neutral scale's colors from lightest (lowest step number) to darkest.
 * @param {Record<string, string>} neutral
 * @returns {string[]}
 */
export const neutralScale = (neutral) =>
  Object.entries(neutral)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, value]) => value);

/**
 * "public/brand/logo.svg" -> "brand/logo.svg": the path relative to public/
 * (the form pipeline.json's audioCandidates use).
 * @param {string} projectPath
 * @returns {string}
 */
export const toStaticPath = (projectPath) => projectPath.replace(/^public\//, '');

/**
 * A project-relative path (e.g. brand.json's "public/brand/logo.svg") as a URL
 * relative to index.html, which sits at the project root: each segment
 * percent-encoded, so names with spaces or "#" load from CSS url() and fetch().
 * @param {string} projectPath
 * @returns {string}
 */
export const toPageUrl = (projectPath) => projectPath.split('/').map(encodeURIComponent).join('/');

/**
 * The CSS font-family value for a brand font, with a generic fallback.
 * @param {BrandFont} font
 * @returns {string}
 */
export const fontStack = (font) => `"${font.family}", system-ui, sans-serif`;
