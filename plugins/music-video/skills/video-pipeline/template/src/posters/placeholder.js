// The placeholder poster: what `pnpm posters` captures before the project's
// own posters exist (src/posters.js sets it as DEFAULT_SCENE). It draws the
// brand background as a vertical gradient with one primary-colour glow, a
// vignette and grain, and no text: a poster's only words are the ones the
// project's own poster scene draws. The lyric lines are registered but
// hidden, because every sung line must be registered by some scene and a
// poster shows none of them.
//
// A poster scene follows the scene rules (src/scenes/placeholder.js): setup
// once per section, draw a pure function of t. To draw several posters, pick
// the poster from t, e.g. poster k at frame 30 k:
//   const k = Math.round(t * ctx.fps / 30);
import {mix, rgba} from '../lib/color.js';

export default {
  setup(ctx) {
    ctx.state.world = ctx.canvas();
    for (const line of ctx.lines) ctx.lyric(line.id, {css: 'opacity:0'});
  },

  draw(t, ctx) {
    const {width: W, height: H, theme} = ctx;
    const c = ctx.state.world.get();

    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.colors.background);
    bg.addColorStop(1, mix(theme.colors.background, theme.colors.primaryDeep, 0.7));
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const r = H * 0.7;
    const glow = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
    glow.addColorStop(0, rgba(theme.colors.primary, 0.45));
    glow.addColorStop(1, rgba(theme.colors.primary, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    ctx.setFx({vignette: 0.3, grain: 0.02});
  },
};
