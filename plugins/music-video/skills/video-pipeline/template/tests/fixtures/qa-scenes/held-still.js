// Test fixture scene registry for tests/render/qa-still-test.test.mjs: the
// `held` scene of held-motion.js without any motion (a correct scene).
import {heldScene} from './held-motion.js';

export const SCENES = {held: heldScene({})};
export const DEFAULT_SCENE = null;
