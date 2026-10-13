// The data-contract modules load in the page (a relative ES module import from
// index.html) as well as in Node. Scan their source for anything a browser
// can't load, then import each to prove it loads and exports its API.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';

const MODULES = {
  'brand.js': ['parseBrand', 'neutralScale', 'toStaticPath', 'toPageUrl', 'fontStack', 'BRAND_COLOR_KEYS', 'MIN_NEUTRAL_STEPS'],
  'analysis.js': [
    'parseAudioAnalysis',
    'findTimeIndex',
    'withBeatGridFallback',
    'parseTimingOverrides',
    'applyTimingOverrides',
    'ENERGY_BANDS',
  ],
  'lyrics.js': ['parseLyrics', 'findActiveLine', 'findActiveWordIndex', 'WORD_SPAN_TOLERANCE'],
  'sections.js': ['parseSections', 'placeSections', 'sectionsWithinDuration', 'withWholeSongSection', 'WHOLE_SONG_SECTION'],
  'timing.js': [
    'secondsToFrame',
    'frameToSeconds',
    'lastEventIndexAtFrame',
    'framesSinceEvent',
    'getBeatState',
    'getEnergyAt',
    'beatFramesBetween',
    'downbeatFramesBetween',
    'parseTimingOverrides',
    'applyTimingOverrides',
  ],
  'lyric-timing.js': ['getLineById', 'getLineState', 'lineWords'],
  'pipeline.js': ['parsePipeline', 'DEFAULT_RENDER', 'DEFAULT_DRAFT', 'X264_PRESETS', 'FRAME_FORMATS', 'AUDIO_SAMPLE_RATES'],
};

const libUrl = (file) => new URL(`../src/lib/${file}`, import.meta.url);

/** Source with comments removed, so a word in a comment doesn't count. */
const code = (file) =>
  readFileSync(libUrl(file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const FORBIDDEN = [
  [/['"`]node:/, 'a node: import'],
  [/\brequire\s*\(/, 'require('],
  [/\bprocess\s*\./, 'process.'],
  [/remotion/i, 'a Remotion import'],
  [/\b(?:document|window|globalThis|navigator)\s*\./, 'a DOM or global object'],
];

describe('browser-safe modules', () => {
  for (const [file, exportsExpected] of Object.entries(MODULES)) {
    it(`src/lib/${file} has no node:, require(, process. or Remotion and imports only relative .js files`, () => {
      const src = code(file);
      for (const [pattern, what] of FORBIDDEN) assert.doesNotMatch(src, pattern, `${file} contains ${what}`);
      const specifiers = [...src.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const s of specifiers) assert.match(s, /^\.\/[\w-]+\.js$/, `${file} imports "${s}", not a relative .js file`);
      assert.doesNotMatch(src, /\bimport\s*\(/, `${file} uses a dynamic import`);
    });

    it(`src/lib/${file} loads and exports its API`, async () => {
      const mod = await import(libUrl(file).href);
      for (const name of exportsExpected) assert.ok(name in mod, `${file} exports ${name}`);
    });
  }

  it('the scan catches what it looks for (self-check on a bad sample)', () => {
    const bad = `import fs from 'node:fs';\nconst x = require('y');\nprocess.env.X;\nimport {random} from 'remotion';\ndocument.body;`;
    for (const [pattern, what] of FORBIDDEN) assert.match(bad, pattern, `scan for ${what} never matches`);
  });
});
