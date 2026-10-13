// Brand tokens for the video. Scenes read colours, fonts, type sizes and safe
// areas from here only; never hard-code a colour or font stack in a scene.
// Colours and fonts come from src/brand.json (validated by src/lib/brand.js);
// sizes and the derived colours are the video's own, and the director may add
// direction-specific tokens. No DOM: buildTheme is a pure function.
import {fontStack, neutralScale} from '../lib/brand.js';

/**
 * @param {import('../lib/brand.js').Brand} brand
 * @param {{width: number, height: number}} page Page size in CSS px.
 */
export const buildTheme = (brand, {width, height}) => {
  const {colors, fonts} = brand;
  const neutral = neutralScale(colors.neutral);
  const at = (i) => neutral[Math.max(0, Math.min(neutral.length - 1, i))];
  const nearest = (font, want) => font.weights.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best));
  const sx = width / 1920;
  const sy = height / 1080;
  return Object.freeze({
    colors: Object.freeze({
      /** Default video background (also the stage colour). */
      background: colors.background,
      /** Raised surfaces on the background: cards, tiles, nodes. */
      surface: colors.surface,
      /** The main brand colour. */
      primary: colors.primary,
      /** A darker shade of the brand colour, for depth and glows behind primary. */
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
      /** The neutral scale from brand.json, keyed by step ("50", "500", ...). */
      neutral: colors.neutral,
      /** Neutral steps, lightest first. */
      neutralScale: neutral,
      /** Light backdrop: the lightest neutral. */
      light: at(0),
      /** The second-lightest neutral: glows and lines on the light backdrop. */
      lightRaised: at(1),
      /** The darkest neutral: a grey "before" look. */
      neutralDark: at(neutral.length - 1),
      /** The second-darkest neutral: surfaces and lines on neutralDark. */
      neutralDarkRaised: at(neutral.length - 2),
      /** Full-frame flash colour. */
      flash: colors.text,
      /** Pure black (not a brand token). */
      black: '#000000',
    }),
    fonts: Object.freeze({
      /** Headlines, lyric hits. */
      display: fontStack(fonts.display),
      /** Smaller copy. */
      body: fontStack(fonts.body),
    }),
    /** Display weights, snapped to the nearest weight brand.json loads. */
    weights: Object.freeze({
      light: nearest(fonts.display, 300),
      regular: nearest(fonts.display, 400),
      semibold: nearest(fonts.display, 600),
      bold: nearest(fonts.display, 700),
      extraBold: nearest(fonts.display, 800),
    }),
    /** Type sizes in px, specified at 1920x1080 and scaled to the page height. */
    sizes: Object.freeze({
      /** Body lyric line (the floor for comfortable reading is lyricSmall). */
      lyric: Math.round(84 * sy),
      /** Smaller lyric (long lines), still legible. */
      lyricSmall: Math.round(72 * sy),
      /** Cinematic wide-tracked caps. */
      cinematic: Math.round(96 * sy),
      /** A word that hits on a beat. */
      hit: Math.round(200 * sy),
      /** Biggest hit (e.g. the full-screen company name). */
      hitMax: Math.round(300 * sy),
    }),
    /** Safe areas as insets in px: text inside action-safe, lyrics and the logo inside title-safe. */
    safe: Object.freeze({
      action: Object.freeze({x: Math.round(96 * sx), y: Math.round(54 * sy)}),
      title: Object.freeze({x: Math.round(192 * sx), y: Math.round(108 * sy)}),
    }),
  });
};

/** @typedef {ReturnType<typeof buildTheme>} Theme */
