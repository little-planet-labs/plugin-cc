// The project's data files read from disk and resolved exactly as the page
// resolves them (src/lib/project.js): the frame count, the audio choice and
// the placed sections. For the Node scripts (check, still, and the render
// scripts).
//
// The pipeline config is src/pipeline.json unless a script was given
// --pipeline=<path> (parsePipelineFlag): an alternate config under src/,
// checked exactly as the page checks ?pipeline= (src/lib/pipeline.js), plus
// "the file exists" (the same project-file rule the page's server applies).
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseAudioAnalysis, parseTimingOverrides} from '../../src/lib/analysis.js';
import {parseBrand} from '../../src/lib/brand.js';
import {parseLyrics} from '../../src/lib/lyrics.js';
import {checkAlternatePipeline, DEFAULT_PIPELINE_PATH, parsePipeline, PIPELINE_PATH, validatePipelinePath} from '../../src/lib/pipeline.js';
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
 * A --pipeline value checked by validatePipelinePath's rule (src/pipeline.json or src/pipeline.<name>.json),
 * as a CliError. Returns the normalized path. That the file exists is checked when it is read (readPipelineAt).
 * @param {string} value
 */
export const parsePipelineFlag = (value) => {
  try {
    return validatePipelinePath(value);
  } catch (err) {
    throw new CliError(`--${err.message}`);
  }
};

/**
 * A config file, parsed. An alternate one (any path but src/pipeline.json) must be a regular file inside the
 * project (symlinks resolved, the rule the page's server applies), is checked against src/pipeline.json
 * (checkAlternatePipeline: the same fps, its own outputName), and its errors name its path.
 * @param {string} [root]
 * @param {string} [path] Project-relative, validated (parsePipelineFlag).
 * @returns {import('../../src/lib/pipeline.js').Pipeline}
 */
export const readPipelineAt = (root = PROJECT_ROOT, path = DEFAULT_PIPELINE_PATH) => {
  if (path === DEFAULT_PIPELINE_PATH) return parse(parsePipeline, readJson(root, path));
  const checked = parsePipelineFlag(path);
  if (projectFile(root, checked) === null) throw new CliError(`--pipeline file ${checked} does not exist`);
  let selected;
  try {
    selected = parsePipeline(readJson(root, checked));
  } catch (err) {
    throw err instanceof CliError ? err : new CliError(err.message.replace(/^pipeline\.json:/, `${checked}:`));
  }
  const base = parse(parsePipeline, readJson(root, DEFAULT_PIPELINE_PATH));
  parse(() => checkAlternatePipeline(selected, base, checked));
  return selected;
};

/** File names in src/ of the configs validatePipelinePath accepts: pipeline.json and pipeline.<name>.json. */
export const SIBLING_PIPELINE = new RegExp(`^${PIPELINE_PATH.source.slice('^src\\/'.length)}`);

/**
 * The masters a render or a derived output must respect, as [{path, outputName}]: `selected`'s first, then
 * src/pipeline.json's and every src/pipeline.<name>.json's, one entry per master file (outputNames compared
 * case-insensitively, as the file system does; the first config naming it is kept, so a sibling that
 * repeats the selected config's outputName is the selected master, not another one). A sibling config that
 * can't be read or has no string outputName is skipped (it names no master); an invalid one that names
 * one still protects it.
 * @param {string} root
 * @param {{path: string, outputName: string}} selected
 * @returns {{path: string, outputName: string}[]}
 */
export const knownMasters = (root, selected) => {
  const out = new Map([[selected.path, selected.outputName]]);
  const names = new Set([selected.outputName.toLowerCase()]);
  const add = (path) => {
    if (out.has(path)) return;
    try {
      const {outputName} = JSON.parse(readFileSync(join(root, path), 'utf8'));
      if (typeof outputName === 'string' && outputName.trim() !== '' && !names.has(outputName.toLowerCase())) {
        out.set(path, outputName);
        names.add(outputName.toLowerCase());
      }
    } catch {
      // unreadable: it names no master
    }
  };
  add(DEFAULT_PIPELINE_PATH);
  let siblings = [];
  try {
    siblings = readdirSync(join(root, 'src')).filter((n) => SIBLING_PIPELINE.test(n)).sort();
  } catch {
    // no src/: nothing more to protect
  }
  for (const n of siblings) add(`src/${n}`);
  return [...out].map(([path, outputName]) => ({path, outputName}));
};

/**
 * Every data file, validated, plus the timing in effect.
 * @param {string} [root]
 * @param {string} [pipelinePath] The config, project-relative (default src/pipeline.json).
 * @returns {{pipeline: import('../../src/lib/pipeline.js').Pipeline, brand: import('../../src/lib/brand.js').Brand,
 *   sectionSpecs: import('../../src/lib/sections.js').SectionSpec[], project: import('../../src/lib/project.js').Project}}
 */
export const loadProject = (root = PROJECT_ROOT, pipelinePath = DEFAULT_PIPELINE_PATH) => {
  const pipeline = readPipelineAt(root, pipelinePath);
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
