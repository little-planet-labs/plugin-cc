// Brand fonts, loaded from local files only (never the network at render
// time): `source: "google"` faces from public/fonts/fonts.json (written by
// `pnpm fonts`), `source: "local"` faces from brand.json `files`. Every face is
// loaded explicitly through FontFace before the page reports ready.
import {toPageUrl} from '../lib/brand.js';

export const MANIFEST_PATH = 'public/fonts/fonts.json';

/**
 * @typedef {{family: string, weight: number, style: string, unicodeRange?: string, file: string, from: string}} FacePlan
 *   file: project-relative path; from: where it was declared (for messages).
 */

/**
 * The brand's font families as loaded: display and body sharing a family and
 * source form one group with the union of their weights and files (pure).
 * @param {import('../lib/brand.js').Brand} brand
 * @returns {{font: import('../lib/brand.js').BrandFont, weights: Set<number>, files: Record<string, string>, roles: string[]}[]}
 */
export const fontGroups = (brand) => {
  const groups = new Map();
  for (const role of ['display', 'body']) {
    const font = brand.fonts[role];
    const key = `${font.source}:${font.family}`;
    const g = groups.get(key) ?? {font, weights: new Set(), files: {}, roles: []};
    font.weights.forEach((w) => g.weights.add(w));
    Object.assign(g.files, font.files ?? {});
    g.roles.push(role);
    groups.set(key, g);
  }
  return [...groups.values()];
};

/**
 * The faces to load for a brand (pure). Display and body sharing a family and
 * source load once, with the union of their weights. Google families need the
 * manifest; a weight with no face in it throws with "run pnpm fonts". Local
 * families load the files brand.json lists (a weight without a file is left to
 * the machine's installed fonts).
 * @param {import('../lib/brand.js').Brand} brand
 * @param {{faces: {family: string, weight: number, style: string, unicodeRange?: string, file: string}[]} | null} manifest
 * @returns {FacePlan[]}
 */
export const planFonts = (brand, manifest) => {
  const plan = [];
  for (const {font, weights, files, roles} of fontGroups(brand)) {
    const from = `brand.json fonts.${roles.join('/')}`;
    if (font.source === 'google') {
      if (!manifest) throw new Error(`${MANIFEST_PATH} is missing (needed for "${font.family}", ${from}); run pnpm fonts`);
      for (const w of [...weights].sort((a, b) => a - b)) {
        const faces = manifest.faces.filter((f) => f.family === font.family && f.weight === w && (f.style ?? 'normal') === 'normal');
        if (faces.length === 0) throw new Error(`font "${font.family}" weight ${w} is not in ${MANIFEST_PATH}; run pnpm fonts`);
        for (const f of faces) plan.push({family: font.family, weight: w, style: 'normal', unicodeRange: f.unicodeRange, file: f.file, from});
      }
    } else {
      for (const [w, file] of Object.entries(files)) plan.push({family: font.family, weight: Number(w), style: 'normal', file, from: `${from}.files.${w}`});
    }
  }
  return plan;
};

/**
 * Warnings for a brand's fonts (pure): a `source: "local"` weight with no file
 * in `files` is left to whatever the rendering machine has installed.
 * @param {import('../lib/brand.js').Brand} brand
 * @returns {string[]}
 */
export const fontWarnings = (brand) => {
  const out = [];
  // The same merged groups planFonts loads: a weight with a file on either role of a shared family is covered.
  for (const {font, weights, files, roles} of fontGroups(brand)) {
    if (font.source !== 'local') continue;
    const missing = [...weights].sort((a, b) => a - b).filter((w) => !Object.hasOwn(files, String(w)));
    if (missing.length) {
      out.push(
        `brand.json fonts.${roles.join('/')}: "${font.family}" weight${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ` +
          `ha${missing.length > 1 ? 've' : 's'} no file; the machine's installed fonts (or a fallback) will be used`,
      );
    }
  }
  return out;
};

/**
 * Load every brand face and wait for document.fonts.ready. Throws a plain
 * reason (naming the file and "run pnpm fonts") when a face can't load.
 * @param {import('../lib/brand.js').Brand} brand
 * @returns {Promise<FacePlan[]>}
 */
export const loadFonts = async (brand) => {
  const needsManifest = brand.fonts.display.source === 'google' || brand.fonts.body.source === 'google';
  let manifest = null;
  if (needsManifest) {
    const res = await fetch(MANIFEST_PATH);
    if (res.ok) {
      try {
        manifest = await res.json();
      } catch {
        throw new Error(`${MANIFEST_PATH} is not valid JSON; run pnpm fonts`);
      }
      if (!Array.isArray(manifest?.faces)) throw new Error(`${MANIFEST_PATH} has no faces list; run pnpm fonts`);
    }
  }
  const plan = planFonts(brand, manifest);
  await Promise.all(
    plan.map(async (p) => {
      const descriptors = {weight: String(p.weight), style: p.style};
      if (p.unicodeRange) descriptors.unicodeRange = p.unicodeRange;
      const face = new FontFace(p.family, `url("${toPageUrl(p.file)}")`, descriptors);
      try {
        await face.load();
      } catch {
        const hint = p.from.includes('.files.') ? `check ${p.from}` : 'run pnpm fonts';
        throw new Error(`font file ${p.file} (${p.family} ${p.weight}) did not load; ${hint}`);
      }
      document.fonts.add(face);
    }),
  );
  await document.fonts.ready;
  return plan;
};
