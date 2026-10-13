// The scene registry: sections.json scene key -> scene definition.
//
// One definition per scene key, instantiated once per section that uses it
// (verse "1" and "2" share the key "verse"; instrumentals share
// "instrumental" with variants lead-in / break / tail, in ctx.section.variant).
// DEFAULT_SCENE plays every key missing from SCENES. While it is the
// placeholder, a fresh project renders end to end; once the real scenes are
// registered, set it to null so a missing key fails the boot, naming the key
// and the known keys.
//
// Scene modules must not touch the DOM at import time (`pnpm check` imports
// this file in Node to check the keys); do DOM work in setup(ctx).
import placeholder from './placeholder.js';

/** @type {Record<string, import('../lib/registry.js').SceneDefinition>} */
export const SCENES = {};

/** @type {import('../lib/registry.js').SceneDefinition | null} */
export const DEFAULT_SCENE = placeholder;
