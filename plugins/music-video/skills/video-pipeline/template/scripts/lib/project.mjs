// The project's data files read from disk and resolved exactly as the page
// resolves them (src/lib/project.js): the frame count, the audio choice and
// the placed sections. For the Node scripts (check, still, and the render
// scripts).
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseAudioAnalysis, parseTimingOverrides} from '../../src/lib/analysis.js';
import {parseBrand} from '../../src/lib/brand.js';
import {parseLyrics} from '../../src/lib/lyrics.js';
import {parsePipeline} from '../../src/lib/pipeline.js';
import {resolveProject} from '../../src/lib/project.js';
import {parseSections} from '../../src/lib/sections.js';
import {CliError} from './cli.mjs';
import {PROJECT_ROOT} from './env.mjs';
import {projectFile} from './files.mjs';

/** Read and parse one JSON file under the project, naming it in errors. */
export const readJson = (root, rel) => {
  const path = join(root, rel);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new CliError(`${rel} could not be read (${err.code ?? err.message})`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError(`${rel} is not valid JSON: ${err.message}`);
  }
};

/** Run a parser, turning its Error into a CliError (the parsers name the file and field). */
const parse = (fn, raw) => {
  try {
    return fn(raw);
  } catch (err) {
    throw new CliError(err.message);
  }
};

/**
 * Every data file, validated, plus the timing in effect.
 * @param {string} [root]
 * @returns {{pipeline: import('../../src/lib/pipeline.js').Pipeline, brand: import('../../src/lib/brand.js').Brand,
 *   sectionSpecs: import('../../src/lib/sections.js').SectionSpec[], project: import('../../src/lib/project.js').Project}}
 */
export const loadProject = (root = PROJECT_ROOT) => {
  const pipeline = parse(parsePipeline, readJson(root, 'src/pipeline.json'));
  const brand = parse(parseBrand, readJson(root, 'src/brand.json'));
  const analysis = parse(parseAudioAnalysis, readJson(root, 'src/data/audio-analysis.json'));
  const defaultAnalysis = parse(parseAudioAnalysis, readJson(root, 'src/data/audio-analysis.default.json'));
  const overrides = parse(parseTimingOverrides, readJson(root, 'src/data/timing-overrides.json'));
  const lyrics = parse(parseLyrics, readJson(root, 'src/data/lyrics.json'));
  const sectionSpecs = parse(parseSections, readJson(root, 'src/data/sections.json'));
  // Same rule the page sees through serve / capture (scripts/lib/files.mjs), so both agree on the audio and frame count.
  const present = pipeline.audioCandidates.filter((p) => projectFile(root, `public/${p}`) !== null);
  const project = parse(
    (input) => resolveProject(input),
    {pipeline, analysis, defaultAnalysis, overrides, lyrics, sections: sectionSpecs, present},
  );
  return {pipeline, brand, sectionSpecs, project};
};
