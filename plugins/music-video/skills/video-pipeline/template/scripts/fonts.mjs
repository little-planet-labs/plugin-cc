// `pnpm fonts`
//
// Downloads every `source: "google"` family and weight in src/brand.json from
// the Google Fonts CSS2 API (woff2, every unicode-range subset) into
// public/fonts/, and writes public/fonts/fonts.json, the manifest the page
// loads faces from. The page never fetches fonts from the network at render
// time. Everything is downloaded into a temp folder first and moved into place
// only when every face arrived, so a failure leaves the previous fonts (or
// nothing) and no partial files. Files a previous run downloaded that the new
// manifest no longer lists are removed.
//
// MV_FONTS_BASE overrides the API base (default https://fonts.googleapis.com),
// e.g. for tests against a local server.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CliError, runCli} from './lib/cli.mjs';
import {PROJECT_ROOT} from './lib/env.mjs';
import {readJson} from './lib/project.mjs';
import {parseBrand} from '../src/lib/brand.js';

export const DEFAULT_BASE = 'https://fonts.googleapis.com';
/** A current desktop Chrome: the CSS2 API returns woff2 only to browsers it knows support it. */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TIMEOUT_MS = 60_000;

/**
 * The Google families to download: display and body merged when they share a family.
 * @param {import('../src/lib/brand.js').Brand} brand
 * @returns {{family: string, weights: number[]}[]}
 */
export const googleFamilies = (brand) => {
  const map = new Map();
  for (const role of ['display', 'body']) {
    const f = brand.fonts[role];
    if (f.source !== 'google') continue;
    const set = map.get(f.family) ?? new Set();
    f.weights.forEach((w) => set.add(w));
    map.set(f.family, set);
  }
  return [...map].map(([family, set]) => ({family, weights: [...set].sort((a, b) => a - b)}));
};

/** The CSS2 API URL for one family and its weights. */
export const cssUrl = (base, family, weights) =>
  `${base.replace(/\/+$/, '')}/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weights.join(';')}&display=swap`;

/**
 * The @font-face blocks of a CSS2 response.
 * @param {string} css
 * @returns {{family: string, style: string, weight: number, url: string, unicodeRange?: string, subset?: string}[]}
 */
export const parseFontCss = (css) => {
  const faces = [];
  const re = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const body = m[2];
    const prop = (name) => new RegExp(`${name}\\s*:\\s*([^;]+);?`, 'i').exec(body)?.[1].trim();
    const family = prop('font-family')?.replace(/^['"]|['"]$/g, '');
    const weight = Number(prop('font-weight'));
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(\s*['"]?woff2['"]?\s*\)/i.exec(prop('src') ?? '')?.[1];
    if (!family || !Number.isFinite(weight) || !url) continue;
    const face = {family, style: prop('font-style') ?? 'normal', weight, url};
    const range = prop('unicode-range');
    if (range) face.unicodeRange = range;
    if (m[1]) face.subset = m[1];
    faces.push(face);
  }
  return faces;
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const get = async (url, what, accept) => {
  let res;
  try {
    res = await fetch(url, {headers: {'User-Agent': USER_AGENT, Accept: accept}, signal: AbortSignal.timeout(TIMEOUT_MS)});
  } catch (err) {
    throw new CliError(`${what}: could not reach ${url} (${err.cause?.code ?? err.message})`);
  }
  if (!res.ok) throw new CliError(`${what}: ${url} answered HTTP ${res.status}`);
  return res;
};

/**
 * Download the brand's Google fonts into `root`/public/fonts and write the manifest.
 * @param {{root?: string, base?: string, log?: (msg: string) => void}} [opts]
 * @param {Set<() => void>} [cleanup] runCli's cleanup set (the temp folder is registered in it).
 * @returns {Promise<{faces: number, files: number, manifest: object | null}>}
 */
export const downloadFonts = async ({root = PROJECT_ROOT, base = process.env.MV_FONTS_BASE || DEFAULT_BASE, log = console.log} = {}, cleanup = new Set()) => {
  let brand;
  try {
    brand = parseBrand(readJson(root, 'src/brand.json'));
  } catch (err) {
    throw new CliError(err.message);
  }
  const families = googleFamilies(brand);
  if (families.length === 0) {
    log('fonts: brand.json has no Google fonts; nothing to download (local fonts load from their files)');
    return {faces: 0, files: 0, manifest: null};
  }
  const fontsDir = join(root, 'public/fonts');
  mkdirSync(fontsDir, {recursive: true});
  const tmp = join(fontsDir, `.fonts-tmp-${process.pid}`);
  const removeTmp = () => rmSync(tmp, {recursive: true, force: true});
  cleanup.add(removeTmp);
  removeTmp();
  mkdirSync(tmp);
  try {
    const faces = [];
    const files = new Map(); // url -> file name
    for (const {family, weights} of families) {
      const css = await (await get(cssUrl(base, family, weights), `Google Fonts CSS for "${family}"`, 'text/css,*/*;q=0.1')).text();
      const found = parseFontCss(css).filter((f) => f.family === family && f.style === 'normal');
      for (const w of weights) {
        if (!found.some((f) => f.weight === w)) throw new CliError(`Google Fonts returned no woff2 face for "${family}" weight ${w}; check brand.json`);
      }
      for (const f of found) {
        if (!weights.includes(f.weight)) continue;
        let name = files.get(f.url);
        if (!name) {
          const hash = createHash('sha256').update(f.url).digest('hex').slice(0, 10);
          name = `${slug(family)}-${f.subset ? `${slug(f.subset)}-` : ''}${hash}.woff2`;
          const data = Buffer.from(await (await get(f.url, `font file for "${family}" ${f.weight}`, 'font/woff2,*/*;q=0.1')).arrayBuffer());
          if (data.subarray(0, 4).toString('latin1') !== 'wOF2') throw new CliError(`font file for "${family}" ${f.weight} (${f.url}) is not woff2`);
          writeFileSync(join(tmp, name), data);
          files.set(f.url, name);
        }
        const face = {family, weight: f.weight, style: 'normal', file: `public/fonts/${name}`};
        if (f.unicodeRange) face.unicodeRange = f.unicodeRange;
        faces.push(face);
      }
    }
    const manifest = {
      version: 1,
      generator: 'pnpm fonts (Google Fonts CSS2 API)',
      families: Object.fromEntries(families.map(({family, weights}) => [family, weights])),
      faces,
    };
    writeFileSync(join(tmp, 'fonts.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    // Everything arrived: move the files into place, the manifest last.
    let previous = null;
    try {
      previous = JSON.parse(readFileSync(join(fontsDir, 'fonts.json'), 'utf8'));
    } catch {
      previous = null;
    }
    for (const name of new Set(files.values())) renameSync(join(tmp, name), join(fontsDir, name));
    renameSync(join(tmp, 'fonts.json'), join(fontsDir, 'fonts.json'));
    const keep = new Set(faces.map((f) => f.file));
    for (const old of previous?.faces ?? []) {
      const file = typeof old?.file === 'string' ? old.file : '';
      if (/^public\/fonts\/[^/]+\.woff2$/.test(file) && !keep.has(file)) rmSync(join(root, file), {force: true});
    }
    const rel = relative(root, fontsDir).split(sep).join('/');
    log(`fonts: ${faces.length} face${faces.length === 1 ? '' : 's'} (${files.size} file${files.size === 1 ? '' : 's'}) for ${families.map((f) => `${f.family} ${f.weights.join('/')}`).join(', ')} -> ${rel}/`);
    return {faces: faces.length, files: files.size, manifest};
  } finally {
    removeTmp();
    cleanup.delete(removeTmp);
  }
};

export const main = (argv) =>
  runCli('fonts', async (cleanup) => {
    if (argv.length > 0) throw new CliError(`unexpected argument "${argv[0]}". Usage: pnpm fonts`);
    if (!existsSync(join(PROJECT_ROOT, 'src/brand.json'))) throw new CliError('src/brand.json is missing');
    await downloadFonts({}, cleanup);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
