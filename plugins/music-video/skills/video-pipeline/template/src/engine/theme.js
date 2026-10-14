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
  // Type scales with the short side of the page, specified at 1080: on any landscape page (width >= height) that
  // is exactly sy, as before; a 1080x1920 portrait page gets the 1920x1080 sizes rather than 1.78x them.
  const type = Math.min(width, height) / 1080;
  // safe.social is specified at 1080x1920 and scales with the page on each axis.
  const socialX = width / 1080;
  const socialY = height / 1920;
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
    /**
     * Type sizes in px, specified at 1920x1080 and scaled by the page's short side over 1080 (the page height on
     * any landscape page; on a 1080x1920 portrait page the same px as at 1920x1080).
     */
    sizes: Object.freeze({
      /** Body lyric line (the floor for comfortable reading is lyricSmall). */
      lyric: Math.round(84 * type),
      /** Smaller lyric (long lines), still legible. */
      lyricSmall: Math.round(72 * type),
      /** Cinematic wide-tracked caps. */
      cinematic: Math.round(96 * type),
      /** A word that hits on a beat. */
      hit: Math.round(200 * type),
      /** Biggest hit (e.g. the full-screen company name). */
      hitMax: Math.round(300 * type),
    }),
    /**
     * Safe areas as insets in px: text inside action-safe, lyrics and the logo inside title-safe. action and title
     * are 5% and 10% of each side (x of the width, y of the height), on any page shape: at 1080x1920 action is
     * {x: 54, y: 96} and title {x: 108, y: 192}.
     */
    safe: Object.freeze({
      action: Object.freeze({x: Math.round(96 * sx), y: Math.round(54 * sy)}),
      title: Object.freeze({x: Math.round(192 * sx), y: Math.round(108 * sy)}),
      /**
       * Social (Instagram Reels / TikTok) inset for 9:16 output: where the apps draw their own UI over the video,
       * so keep lyrics, the logo and anything that must be read out of it. At 1080x1920: top 220 (the app's header
       * row: "Reels" / "Following | For You", camera and search buttons), bottom 420 (account name, caption, audio
       * row and, on TikTok, the progress bar and tab bar), left 64, right 160 (the like / comment / share / audio
       * button column). AN APPROXIMATION, not an official figure: rounded-up estimates of those overlays on a
       * 1080x1920 frame; neither app publishes one fixed overlay size, and both change their UI, so check a real
       * post before relying on the edge pixels. Scaled with the page on each axis (x by width / 1080, y by
       * height / 1920); on a page that is not 9:16 it is the same fractions of the frame. Use it together with
       * title: in portrait, lyrics belong inside both.
       */
      social: Object.freeze({
        top: Math.round(220 * socialY),
        right: Math.round(160 * socialX),
        bottom: Math.round(420 * socialY),
        left: Math.round(64 * socialX),
      }),
    }),
  });
};

/** @typedef {ReturnType<typeof buildTheme>} Theme */
