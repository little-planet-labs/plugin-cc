// Temp project copies for the engine tests: the page (index.html, src/) and
// the fixture scene registries, with the test's own data files, so a test
// never depends on the data of the project it runs in (the template's empty
// data or a finished video's real song): pipeline, brand, every src/data file
// and public/ come from fixtures, never from the running project. Brand fonts default to
// `source: "local"` without files (the machine's fallback font), so no
// download is needed.
import {spawn} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browsersPath, playwrightEnv, PROJECT_ROOT, venvPython} from '../../scripts/lib/env.mjs';

export const FIXTURE_PIPELINE = Object.freeze({
  outputName: 'fixture',
  fps: 30,
  width: 960,
  height: 540,
  fallbackSeconds: 4,
  audioCandidates: ['audio/track.wav'],
  render: {scale: 1},
  draft: {scale: 0.5},
});

// A copy of the template's placeholder brand (never the running project's src/brand.json).
const templateBrand = () => JSON.parse(readFileSync(join(PROJECT_ROOT, 'tests/fixtures/data-brand.placeholder.json'), 'utf8'));

/** The no-track default analysis (the template's audio-analysis.default.json): no source, 60 s at 30 fps. */
export const NO_TRACK_ANALYSIS = Object.freeze({
  version: 1,
  source: null,
  generator: 'default (no track analyzed)',
  fps: 30,
  durationSeconds: 60,
  durationInFrames: 1800,
  tempo: 120,
  beatsPerBar: 4,
  beats: [],
  downbeats: [],
  onsets: [],
  bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
  energy: {low: [], mid: [], high: []},
});

/** A brand.json whose fonts need no download: a local family with no files (falls back to the system font). */
export const fixtureBrand = (overrides = {}) => {
  const b = templateBrand();
  b.fonts = {
    display: {family: 'Fixture Sans', source: 'local', weights: [400, 700]},
    body: {family: 'Fixture Sans', source: 'local', weights: [400, 700]},
  };
  return {...b, ...overrides};
};

/**
 * Words for a line: `text` split on spaces, spread evenly over [start, end].
 * @returns {{id: string, text: string, start: number, end: number, words: {text: string, start: number, end: number}[]}}
 */
export const line = (id, text, start, end) => {
  const tokens = text.split(' ');
  const step = (end - start) / tokens.length;
  const r = (x) => Math.round(x * 1000) / 1000;
  return {id, text, start, end, words: tokens.map((w, i) => ({text: w, start: r(start + i * step), end: r(start + (i + 1) * step)}))};
};

/**
 * Make a temp project. Returns {root, cleanup}. Without `analysis` the project has the no-track default
 * (NO_TRACK_ANALYSIS), so the timing is the fixture pipeline's fallback (4 s) unless a test says otherwise.
 * @param {{pipeline?: object, brand?: object, lyrics?: object[], sections?: object[], analysis?: object, overrides?: object,
 *   files?: Record<string, string>}} [o]
 */
export const makeProject = ({pipeline = {}, brand = fixtureBrand(), lyrics = [], sections = [], analysis = NO_TRACK_ANALYSIS, overrides = {}, files = {}} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'mv-engine-'));
  cpSync(join(PROJECT_ROOT, 'src'), join(root, 'src'), {recursive: true});
  cpSync(join(PROJECT_ROOT, 'index.html'), join(root, 'index.html'));
  cpSync(join(PROJECT_ROOT, 'tests/fixtures/scenes'), join(root, 'tests/fixtures/scenes'), {recursive: true});
  mkdirSync(join(root, 'public/fonts'), {recursive: true});
  const json = (rel, v) => writeFileSync(join(root, rel), `${JSON.stringify(v, null, 2)}\n`);
  json('src/pipeline.json', {...FIXTURE_PIPELINE, ...pipeline});
  json('src/brand.json', brand);
  json('src/data/lyrics.json', lyrics);
  json('src/data/sections.json', sections);
  json('src/data/audio-analysis.json', analysis);
  json('src/data/audio-analysis.default.json', NO_TRACK_ANALYSIS);
  json('src/data/timing-overrides.json', overrides);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), {recursive: true});
    writeFileSync(join(root, rel), text);
  }
  return {root, cleanup: () => rmSync(root, {recursive: true, force: true})};
};

/** Why the Chromium tests can't run here, or null. */
export const captureEnvMissing = () => {
  if (!existsSync(venvPython(PROJECT_ROOT))) return 'no .venv: run pnpm setup:env';
  const b = browsersPath(PROJECT_ROOT);
  if (!existsSync(b) || !readdirSync(b).some((d) => d.startsWith('chromium'))) return "no Playwright Chromium: run pnpm setup:env";
  return null;
};

/**
 * Run tests/fixtures/engine-probe.py and parse its JSON line.
 * @param {string} command
 * @param {Record<string, string | number | boolean>} args
 */
export const probe = (command, args) =>
  new Promise((resolve, reject) => {
    const argv = [join(PROJECT_ROOT, 'tests/fixtures/engine-probe.py'), command];
    for (const [k, v] of Object.entries(args)) {
      if (v === false || v === undefined) continue;
      // --key=value, so a value that starts with "--" (a Chromium switch) isn't read as an option.
      argv.push(v === true ? `--${k}` : `--${k}=${v}`);
    }
    const child = spawn(venvPython(PROJECT_ROOT), argv, {env: playwrightEnv(PROJECT_ROOT), stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`engine-probe ${command} exited ${code}: ${err.trim().split('\n').slice(-8).join('\n')}`));
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()));
      } catch (e) {
        reject(new Error(`engine-probe ${command}: no JSON (${e.message}); stderr: ${err.slice(-2000)}`));
      }
    });
  });
