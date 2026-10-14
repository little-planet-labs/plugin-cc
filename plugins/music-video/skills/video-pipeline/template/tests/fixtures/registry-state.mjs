// The scene registry's state rule, which holds for the template and for every
// built project alike:
// - template state (src/scenes/placeholder.js exists): the placeholder is the
//   registered DEFAULT_SCENE;
// - built state (placeholder.js deleted, as the build instructions say):
//   DEFAULT_SCENE is null and every scene key sections.json uses (the
//   whole-song "song" key when it is empty) is in SCENES;
// - either way the registry passes validateRegistry and every section's key
//   resolves to a scene.
// registryStateProblems is pure (so tests can feed it broken registries);
// loadRegistryState reads one project root.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveScene, validateRegistry} from '../../src/lib/registry.js';
import {parseSections, withWholeSongSection} from '../../src/lib/sections.js';

/**
 * @param {{mod: object, placeholder: object | null, sections: {id: string, scene: string}[], name?: string}} o
 *   placeholder: placeholder.js's default export, or null when the file doesn't exist.
 * @returns {string[]} What is wrong; empty when the registry is in a valid state.
 */
export const registryStateProblems = ({mod, placeholder, sections, name = 'src/scenes/index.js'}) => {
  let reg;
  try {
    reg = validateRegistry(mod, name);
  } catch (err) {
    return [err.message];
  }
  const problems = [];
  if (placeholder !== null) {
    if (reg.DEFAULT_SCENE !== placeholder) problems.push('placeholder.js exists but is not the registered DEFAULT_SCENE');
  } else {
    if (reg.DEFAULT_SCENE !== null) problems.push('placeholder.js is gone but DEFAULT_SCENE is not null');
    for (const s of withWholeSongSection(sections)) {
      if (!Object.hasOwn(reg.SCENES, s.scene)) problems.push(`scene key "${s.scene}" (section "${s.id}") is not in SCENES`);
    }
  }
  for (const s of withWholeSongSection(sections)) {
    try {
      resolveScene(reg, s.scene, s.id);
    } catch (err) {
      problems.push(err.message);
    }
  }
  return [...new Set(problems)];
};

/** The registry, placeholder and sections of the project at `root`, imported in Node. */
export const loadRegistryState = async (root) => {
  const mod = await import(pathToFileURL(join(root, 'src/scenes/index.js')).href);
  const placeholderPath = join(root, 'src/scenes/placeholder.js');
  const placeholder = existsSync(placeholderPath) ? (await import(pathToFileURL(placeholderPath).href)).default : null;
  const sections = parseSections(JSON.parse(readFileSync(join(root, 'src/data/sections.json'), 'utf8')));
  return {mod, placeholder, sections};
};
