// Loads the brand fonts named in src/brand.json at render time.
//
// "google": looked up by family name in @remotion/google-fonts (pinned to the
// Remotion version) and loaded with loadFont(). The per-family module is only
// imported when it's needed (getAvailableFonts().load()), so any Google family
// works without editing code.
// "local": FontFace per weight from the files under public/, or nothing to load
// when the family is installed on the rendering machine.
//
// Each load holds a delayRender, so no frame renders before the font is ready,
// and a failure (unknown family, unavailable weight, missing file) cancels the
// render with the reason. On the server (tests: no `document`) nothing loads
// and only the CSS family stack is returned.
import {getAvailableFonts} from '@remotion/google-fonts';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';
import {toStaticPath, type BrandFont} from './brand';

/** The CSS font-family value for a brand font, with a generic fallback. */
export const fontStack = (font: BrandFont): string => `"${font.family}", system-ui, sans-serif`;

const loadGoogle = async (font: BrandFont): Promise<void> => {
  const entry = getAvailableFonts().find((f) => f.fontFamily === font.family);
  if (!entry) {
    throw new Error(
      `brand.json: "${font.family}" isn't a Google font known to @remotion/google-fonts. ` +
        'Check the exact family name on fonts.google.com, or use source "local".',
    );
  }
  const module = await entry.load();
  await module
    .loadFont('normal', {weights: font.weights.map(String), subsets: ['latin'], ignoreTooManyRequestsWarning: true})
    .waitUntilDone();
};

const loadLocal = async (font: BrandFont): Promise<void> => {
  if (!font.files) return; // installed on the rendering machine
  await Promise.all(
    Object.entries(font.files).map(async ([weight, file]) => {
      const face = new FontFace(font.family, `url(${staticFile(toStaticPath(file))})`, {weight});
      await face.load();
      document.fonts.add(face);
    }),
  );
};

/** Start loading `font` (once per family + source) and return its CSS font-family stack. */
const started = new Set<string>();
export const loadBrandFont = (font: BrandFont): string => {
  const key = `${font.source}:${font.family}:${font.weights.join(',')}`;
  if (typeof document !== 'undefined' && !started.has(key)) {
    started.add(key);
    const handle = delayRender(`Loading brand font ${font.family}`);
    (font.source === 'google' ? loadGoogle(font) : loadLocal(font)).then(
      () => continueRender(handle),
      (err: unknown) => cancelRender(err),
    );
  }
  return fontStack(font);
};
