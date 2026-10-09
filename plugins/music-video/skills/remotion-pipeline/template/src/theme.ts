// Brand tokens for the video. Scenes read colors, fonts and type sizes from
// here only; never hard-code a color or font stack in a scene.
//
// Colors and fonts come from src/brand.json (validated by src/lib/brand.ts).
// Fonts load at render time (src/lib/fonts.ts): Google families through
// @remotion/google-fonts, local ones from public/ or the machine. Type sizes
// and the derived colors below are the video's own; the director may tune them.
import brandJson from './brand.json';
import {neutralScale, parseBrand, type BrandFont} from './lib/brand';
import {loadBrandFont} from './lib/fonts';

/** The validated brand.json. */
export const brand = parseBrand(brandJson);

const {colors, fonts} = brand;
/** Neutral steps, lightest first (at least 3). */
const neutral = neutralScale(colors.neutral);
const at = (i: number) => neutral[Math.max(0, Math.min(neutral.length - 1, i))] as string;

/** One load when display and body share a family: the union of their weights. */
const sameFamily = fonts.display.family === fonts.body.family && fonts.display.source === fonts.body.source;
const merged = (font: BrandFont): BrandFont =>
  sameFamily
    ? {...font, weights: [...new Set([...fonts.display.weights, ...fonts.body.weights])].sort((a, b) => a - b)}
    : font;
const displayStack = loadBrandFont(merged(fonts.display));
const bodyStack = sameFamily ? displayStack : loadBrandFont(fonts.body);

/** Nearest loaded display weight to `want` (the browser would synthesize a missing one). */
const nearestWeight = (want: number): number =>
  fonts.display.weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best));

export const theme = {
  colors: {
    /** Default video background. */
    background: colors.background,
    /** Raised surfaces on the background: cards, tiles, nodes. */
    surface: colors.surface,
    /** The main brand color. */
    primary: colors.primary,
    /** A darker shade of the brand color, for depth and glows behind primary. */
    primaryDeep: colors.primaryDeep,
    /** THE bright accent for hits. Use it sparingly. */
    accent: colors.accent,
    /** A second accent, for contrast with the first. */
    accentAlt: colors.accentAlt,
    /** Primary type on the background. */
    text: colors.text,
    /** Secondary type on the background. */
    textMuted: colors.textMuted,
    /** Type on the light backdrop: the darkest neutral. */
    textOnLight: at(neutral.length - 1),
    /** The neutral (gray) scale from brand.json, keyed by step number ("50", "500", ...). */
    neutral: colors.neutral,
    /** Neutral steps from brand.json, lightest first. */
    neutralScale: neutral,
    /** Light backdrop: the lightest neutral. */
    light: at(0),
    /** The second-lightest neutral: glows and lines on the light backdrop. */
    lightRaised: at(1),
    /** The darkest neutral: a gray "before" look. */
    neutralDark: at(neutral.length - 1),
    /** The second-darkest neutral: surfaces and lines on neutralDark. */
    neutralDarkRaised: at(neutral.length - 2),
    /** Full-frame flash color. */
    flash: colors.text,
    /** Pure black (not a brand token). */
    black: '#000000',
  },
  fonts: {
    /** Headlines, lyric hits. */
    display: displayStack,
    /** Smaller copy. */
    body: bodyStack,
  },
  /** Display weights, snapped to the nearest weight brand.json loads. */
  weights: {
    light: nearestWeight(300),
    regular: nearestWeight(400),
    semibold: nearestWeight(600),
    bold: nearestWeight(700),
    extraBold: nearestWeight(800),
  },
  /** Type sizes in px at 1920x1080. */
  sizes: {
    /** Minimum for a body lyric line. */
    lyric: 84,
    /** Smaller lyric (long lines), still the floor for legible body lyrics. */
    lyricSmall: 72,
    /** Cinematic wide-tracked caps. */
    cinematic: 96,
    /** A word that hits on a beat. */
    hit: 200,
    /** Biggest hit (e.g. the full-screen company name). */
    hitMax: 300,
  },
} as const;

export type Theme = typeof theme;
