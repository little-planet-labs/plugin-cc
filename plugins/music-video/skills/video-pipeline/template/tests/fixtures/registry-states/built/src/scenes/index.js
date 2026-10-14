// Fixture: a built project's state. placeholder.js is deleted, DEFAULT_SCENE is
// null, and every sections.json scene key has a scene. No DOM at import time.
const scene = (name) => ({
  setup(ctx) {
    ctx.state.name = name;
  },
  draw() {},
});

export const SCENES = {instrumental: scene('instrumental'), verse: scene('verse'), chorus: scene('chorus')};
export const DEFAULT_SCENE = null;
