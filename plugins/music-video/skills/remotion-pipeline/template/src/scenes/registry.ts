// Which component plays each scene key of src/data/sections.json. The video
// director replaces the placeholder with the video's own scenes: add one entry
// per scene key that sections.json uses, then set DEFAULT_SCENE to null so a
// key without a component stops the render instead of silently falling back.
import type {SceneKey} from '../lib/sections';
import {Placeholder} from './Placeholder';
import type {SceneComponent} from './types';

/** The component for each scene key in sections.json. */
export const SCENES: Record<SceneKey, SceneComponent> = {
  placeholder: Placeholder,
};

/** Plays any scene key missing from SCENES, or null to make a missing key an error. */
export const DEFAULT_SCENE: SceneComponent | null = Placeholder;

/**
 * The component for `key`: SCENES[key], else `fallback`. Throws, naming the
 * key and the known keys, when neither exists.
 */
export const resolveScene = (
  key: SceneKey,
  scenes: Readonly<Record<SceneKey, SceneComponent>> = SCENES,
  fallback: SceneComponent | null = DEFAULT_SCENE,
): SceneComponent => {
  const scene = Object.hasOwn(scenes, key) ? scenes[key] : undefined;
  if (scene) return scene;
  if (fallback) return fallback;
  throw new Error(
    `No scene component for scene key "${key}" (sections.json). Known keys: ${Object.keys(scenes).join(', ') || '(none)'}. ` +
      'Add it to SCENES in src/scenes/registry.ts.',
  );
};
