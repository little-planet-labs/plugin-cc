// Fixture: the template's starting state (tests/engine-registry.test.mjs). A
// placeholder scene registered as DEFAULT_SCENE; no DOM at import time.
export default {
  setup(ctx) {
    ctx.state.made = true;
  },
  draw() {},
};
