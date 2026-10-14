// The cover-poster registry for `pnpm posters` (scripts/posters.mjs): the
// poster list and the scenes that draw them. It is an alternate scene
// registry (the same SCENES / DEFAULT_SCENE shape as src/scenes/index.js),
// loaded on the src/pipeline.json page; the video's own registry is not
// involved.
//
// POSTERS lists each poster: n (its number, 1, 2, ...), slug (lowercase
// letters and digits joined by single hyphens) and frame (the page frame that
// draws it). `pnpm posters` captures each poster at its frame and writes
// posters/poster-<n>-<slug>.png. The poster scene picks what to draw from t
// (frame / fps): with poster k at frame 30 k on a 30 fps page, poster k is
// t in [k, k + 1). Every section plays DEFAULT_SCENE here, so any frame of the
// video can hold a poster.
//
// The template ships one placeholder poster that proves the capture works.
// Replace it with the project's poster scene and list one entry per poster.
// Like every registry, nothing here may touch the DOM at import time.
import placeholder from './posters/placeholder.js';

/** @type {{n: number, slug: string, frame: number}[]} */
export const POSTERS = [{n: 1, slug: 'placeholder', frame: 30}];

/** @type {Record<string, import('./lib/registry.js').SceneDefinition>} */
export const SCENES = {};

/** @type {import('./lib/registry.js').SceneDefinition | null} */
export const DEFAULT_SCENE = placeholder;
