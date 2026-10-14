// `pnpm check [--scenes=<module>] [--pipeline=<config>]`
//
// Fast checks before any render, no browser needed:
// 1. Every data file parses (src/lib parsers) and the timing in effect
//    resolves (src/lib/project.js); its warnings are printed. The pipeline
//    config is src/pipeline.json, or --pipeline=<config> (an alternate config
//    under src/, checked against src/pipeline.json: same fps, own outputName).
// 2. The scene registry (--scenes, else the config's `scenes`, else
//    src/scenes/index.js) loads in Node and every sections.json scene key
//    resolves to SCENES or DEFAULT_SCENE.
// 3. Nothing in the page's source (src/**/*.js|mjs|css|html and index.html)
//    depends on a clock or blends layers: Date, performance.now, Math.random,
//    crypto.getRandomValues / randomUUID, setTimeout / setInterval /
//    requestIdleCallback, requestAnimationFrame
//    (allowed only in src/engine/preview.js, the preview HUD's clock), WAAPI
//    .animate(), CSS transition / animation / @keyframes, mix-blend-mode,
//    background-blend-mode, plus-lighter, and canvas globalCompositeOperation other than source-over
//    and the alpha-masking ops (destination-in/out, source-in/atop,
//    destination-atop), which only cut alpha inside one canvas and never blend
//    with the layers beneath it.
// Each finding prints as file:line: what. Exit code 1 when anything is found.
import {existsSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveScene, validateRegistry, validateScenesPath} from '../src/lib/registry.js';
import {withWholeSongSection} from '../src/lib/sections.js';
import {DEFAULT_PIPELINE_PATH, scenesInEffect} from '../src/lib/pipeline.js';
import {CliError, runCli} from './lib/cli.mjs';
import {PROJECT_ROOT} from './lib/env.mjs';
import {loadProject, parsePipelineFlag} from './lib/project.mjs';

/** The one file allowed to use requestAnimationFrame (the preview HUD's clock). */
export const PREVIEW_CLOCK_MODULE = 'src/engine/preview.js';

/** Composite operations that only mask alpha within one canvas (no colour blending). */
export const ALLOWED_COMPOSITE = Object.freeze(['source-over', 'destination-in', 'destination-out', 'source-in', 'source-atop', 'destination-atop']);

const SEEDED = 'use a seeded rng (src/lib/rng.js or ctx.rng)';
const CLOCK = 'a clock: derive everything from t';

/** Patterns over JS code (comments and string contents blanked out). */
const JS_CODE_RULES = [
  [/\bDate\b/, `Date (${CLOCK})`],
  [/\bperformance\s*\.\s*now\b/, `performance.now (${CLOCK})`],
  [/\bMath\s*\.\s*random\b/, `Math.random (${SEEDED})`],
  [/\{[^{}]*\brandom\b[^{}]*\}\s*=\s*Math\b/, `random destructured from Math (${SEEDED})`],
  [/\bgetRandomValues\b/, `crypto.getRandomValues (${SEEDED})`],
  [/\brandomUUID\b/, `crypto.randomUUID (${SEEDED})`],
  [/\bbackgroundBlendMode\b/, 'backgroundBlendMode (blend modes composite as grey slabs in headless Chrome)'],
  [/\bsetTimeout\b/, `setTimeout (${CLOCK})`],
  [/\bsetInterval\b/, `setInterval (${CLOCK})`],
  [/\brequestIdleCallback\b/, `requestIdleCallback (${CLOCK})`],
  [/\.\s*animate\s*\(/, 'element.animate() (a Web Animation runs on its own clock)'],
  [/\bmixBlendMode\b/, 'mixBlendMode (blend modes composite as grey slabs in headless Chrome)'],
  [/\.\s*style\s*\.\s*(?:webkit)?(?:transition|animation)\w*\b/i, 'a CSS transition/animation set from script (runs on its own clock)'],
  [/\b(?:transition|animation)(?:Property|Duration|Delay|TimingFunction|Name|IterationCount|PlayState)\b/, 'a CSS transition/animation property (runs on its own clock)'],
];
const RAF_RULE = [/\brequestAnimationFrame\b/, `requestAnimationFrame (${CLOCK}; only ${PREVIEW_CLOCK_MODULE} may use it)`];

/** Patterns over CSS text: stylesheets, <style> blocks, style attributes, and CSS inside JS strings. */
const CSS_RULES = [
  [/(?:^|[\s;{'"`])(?:-webkit-)?transition(?:-[a-z-]+)?\s*:/i, 'CSS transition (runs on its own clock)'],
  [/(?:^|[\s;{'"`])(?:-webkit-)?animation(?:-[a-z-]+)?\s*:/i, 'CSS animation (runs on its own clock)'],
  [/@(?:-webkit-)?keyframes\b/i, '@keyframes (runs on its own clock)'],
  [/mix-blend-mode/i, 'mix-blend-mode (blend modes composite as grey slabs in headless Chrome)'],
  [/plus-lighter/i, 'plus-lighter (a blend mode)'],
  [/background-blend-mode/i, 'background-blend-mode (blend modes composite as grey slabs in headless Chrome)'],
];
/** A whole JS string that names a CSS property (el.style.setProperty('transition', ...)). */
const PROPERTY_STRING = /^(?:-webkit-)?(?:transition|animation)(?:-[a-z-]+)?$/i;

const COMPOSITE = /\bglobalCompositeOperation\s*=(?!=)\s*(?:(['"`])([^'"`]*)\1)?/g;

/** Line number (1-based) of offset `i` in `text`. */
const lineAt = (text, i) => {
  let n = 1;
  for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) n++;
  return n;
};

/**
 * Split JS into code (comments and string/template contents replaced by
 * spaces, newlines kept, so offsets and lines are unchanged) and the string
 * literals with their offsets.
 * @param {string} src
 * @returns {{code: string, strings: {text: string, start: number}[]}}
 */
export const splitJs = (src) => {
  const out = src.split('');
  const strings = [];
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let lastSignificant = '';
  const regexAllowed = () => lastSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSignificant) || /\b(?:return|typeof|case|in|of|delete|void|throw|new|do|else)$/.test(lastSignificant);
  const stack = []; // template-literal nesting: brace depth per ${
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (stack.length && ch === '}' && stack[stack.length - 1] === 0) {
      stack.pop();
      i = readTemplate(i + 1);
      continue;
    }
    if (stack.length && ch === '{') stack[stack.length - 1]++;
    if (stack.length && ch === '}') stack[stack.length - 1]--;
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== ch && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      strings.push({text: src.slice(i + 1, k), start: i + 1});
      blank(i + 1, k);
      i = k + 1;
      lastSignificant = 'x';
      continue;
    }
    if (ch === '`') {
      i = readTemplate(i + 1);
      lastSignificant = 'x';
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && src[k] !== '\n') {
        if (src[k] === '\\') k += 2;
        else if (src[k] === '[') (inClass = true), k++;
        else if (src[k] === ']') (inClass = false), k++;
        else if (src[k] === '/' && !inClass) break;
        else k++;
      }
      blank(i + 1, k);
      i = k + 1;
      lastSignificant = 'x';
      continue;
    }
    if (!/\s/.test(ch)) {
      const word = /[\w$]/.test(ch) ? /^[\w$]+/.exec(src.slice(i))[0] : ch;
      lastSignificant = word;
      i += word.length;
      continue;
    }
    i++;
  }
  return {code: out.join(''), strings};

  // Reads template text from `k` until the closing backtick or a `${`; returns the next index.
  function readTemplate(k) {
    const begin = k;
    while (k < src.length && src[k] !== '`') {
      if (src[k] === '\\') {
        k += 2;
        continue;
      }
      if (src[k] === '$' && src[k + 1] === '{') {
        strings.push({text: src.slice(begin, k), start: begin});
        blank(begin, k);
        stack.push(0);
        return k + 2;
      }
      k++;
    }
    strings.push({text: src.slice(begin, k), start: begin});
    blank(begin, k);
    return k + 1;
  }
};

const cssFindings = (css, base, text, offset) => {
  const found = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const [re, what] of CSS_RULES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of clean.matchAll(g)) found.push({line: lineAt(text, offset + m.index), what});
  }
  return found;
};

/**
 * Findings in one JS source.
 * @param {string} src
 * @param {{allowRaf?: boolean, text?: string, offset?: number}} [opts] text/offset map lines into an enclosing file.
 * @returns {{line: number, what: string}[]}
 */
export const scanJs = (src, {allowRaf = false, text = src, offset = 0} = {}) => {
  const {code, strings} = splitJs(src);
  const found = [];
  const rules = allowRaf ? JS_CODE_RULES : [...JS_CODE_RULES, RAF_RULE];
  for (const [re, what] of rules) {
    for (const m of code.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) found.push({line: lineAt(text, offset + m.index), what});
  }
  for (const s of strings) {
    found.push(...cssFindings(s.text, s.start, text, offset + s.start));
    if (PROPERTY_STRING.test(s.text.trim())) found.push({line: lineAt(text, offset + s.start), what: `"${s.text.trim()}" (a CSS transition/animation property)`});
  }
  for (const m of src.matchAll(COMPOSITE)) {
    if (code.slice(m.index, m.index + 'globalCompositeOperation'.length) !== 'globalCompositeOperation') continue;
    const value = m[2];
    if (value === undefined) found.push({line: lineAt(text, offset + m.index), what: 'globalCompositeOperation set from a non-literal (use one of the allowed literal ops)'});
    else if (!ALLOWED_COMPOSITE.includes(value)) {
      found.push({line: lineAt(text, offset + m.index), what: `globalCompositeOperation "${value}" (a blend; allowed: ${ALLOWED_COMPOSITE.join(', ')})`});
    }
  }
  return found;
};

/**
 * Findings in one CSS source.
 * @param {string} src
 * @returns {{line: number, what: string}[]}
 */
export const scanCss = (src) => cssFindings(src, 0, src, 0);

/**
 * Findings in one HTML source: inline <script> as JS, <style> and style=""
 * as CSS, on*="" handlers as JS.
 * @param {string} src
 * @param {{allowRaf?: boolean}} [opts]
 * @returns {{line: number, what: string}[]}
 */
export const scanHtml = (src, {allowRaf = false} = {}) => {
  const text = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const found = [];
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    found.push(...scanJs(m[1], {allowRaf, text, offset: m.index + m[0].indexOf(m[1], m[0].indexOf('>'))}));
  }
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    found.push(...cssFindings(m[1], 0, text, m.index + m[0].indexOf(m[1], m[0].indexOf('>'))));
  }
  for (const m of text.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) found.push(...cssFindings(m[2], 0, text, m.index + m[0].indexOf(m[2])));
  for (const m of text.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi)) found.push(...scanJs(m[2], {allowRaf, text, offset: m.index + m[0].indexOf(m[2])}));
  return found;
};

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/**
 * Scan the page source under `root`: src/**\/*.(js|mjs|css|html) and index.html.
 * @param {string} root
 * @returns {{files: number, found: {file: string, line: number, what: string}[]}}
 */
export const scanProject = (root) => {
  const files = walk(join(root, 'src')).filter((p) => /\.(?:m?js|css|html)$/.test(p));
  const index = join(root, 'index.html');
  try {
    if (statSync(index).isFile()) files.push(index);
  } catch {
    // no index.html: nothing to scan there
  }
  const found = [];
  for (const p of files) {
    const rel = relative(root, p).split(sep).join('/');
    const src = readFileSync(p, 'utf8');
    const allowRaf = rel === PREVIEW_CLOCK_MODULE;
    const hits = p.endsWith('.css') ? scanCss(src) : p.endsWith('.html') ? scanHtml(src, {allowRaf}) : scanJs(src, {allowRaf});
    for (const h of hits) found.push({file: rel, ...h});
  }
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return {files: files.length, found};
};

/**
 * Every check. Returns the findings and warnings; never throws for a finding.
 * @param {{root?: string, scenes?: string, pipeline?: string}} [opts] scenes: the registry to check (default: the
 *   config's `scenes`, else src/scenes/index.js); pipeline: the config (default src/pipeline.json).
 */
export const check = async ({root = PROJECT_ROOT, scenes, pipeline: pipelinePath = DEFAULT_PIPELINE_PATH} = {}) => {
  const issues = [];
  const warnings = [];
  let specs = null;
  let lines = 0;
  let config = null;
  try {
    const {project, sectionSpecs, pipeline} = loadProject(root, pipelinePath);
    warnings.push(...project.warnings);
    specs = sectionSpecs;
    lines = project.lyrics.length;
    config = pipeline;
  } catch (err) {
    issues.push(`data: ${err.message}`);
  }
  try {
    const path = validateScenesPath(config === null ? (scenes ?? 'src/scenes/index.js') : scenesInEffect(config, scenes));
    if (!existsSync(resolve(root, path))) {
      if (scenes !== undefined) throw new Error(`--scenes module ${path} does not exist`);
      // The config's own registry (e.g. src/scenes-vertical/index.js) is written per project: say so plainly.
      const whose = config?.scenes ? ` (the scenes of ${pipelinePath})` : '';
      throw new Error(`scene registry ${path}${whose} does not exist; write it, or pass --scenes=<module> to use another`);
    }
    let mod;
    try {
      mod = await import(pathToFileURL(resolve(root, path)).href);
    } catch (err) {
      throw new Error(`${path} failed to load in Node (${err.message}). Scene modules must not touch the DOM at import time.`);
    }
    const registry = validateRegistry(mod, path);
    for (const s of withWholeSongSection(specs ?? [])) {
      try {
        resolveScene(registry, s.scene, s.id);
      } catch (err) {
        issues.push(`scenes: ${err.message}`);
      }
    }
  } catch (err) {
    issues.push(`scenes: ${err.message}`);
  }
  const scan = scanProject(root);
  for (const f of scan.found) issues.push(`${f.file}:${f.line}: ${f.what}`);
  return {issues, warnings, files: scan.files, sections: specs ? withWholeSongSection(specs).length : 0, lines};
};

export const main = (argv) =>
  runCli('check', async () => {
    let scenes;
    let pipeline;
    for (const arg of argv) {
      if (arg.startsWith('--scenes=')) scenes = arg.slice('--scenes='.length);
      else if (arg.startsWith('--pipeline=')) pipeline = parsePipelineFlag(arg.slice('--pipeline='.length));
      else throw new CliError(`unexpected argument "${arg}". Usage: pnpm check [--scenes=<module>] [--pipeline=<config>]`);
    }
    const r = await check({scenes, pipeline});
    for (const w of r.warnings) console.warn(`check: warning: ${w}`);
    for (const issue of r.issues) console.error(issue);
    if (r.issues.length > 0) throw new CliError(`${r.issues.length} problem${r.issues.length > 1 ? 's' : ''} found`);
    console.log(`check: ok (${r.files} source files scanned, ${r.sections} section${r.sections === 1 ? '' : 's'}, ${r.lines} lyric line${r.lines === 1 ? '' : 's'})`);
  });

// realpath: Node runs the main module from its real path, so a symlinked project path must still match.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
