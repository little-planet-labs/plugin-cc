// The placeholder scene: what a fresh project renders before the real scenes
// exist, and a short tour of the scene API. It plays every section whose
// scene key isn't in SCENES (src/scenes/index.js sets it as DEFAULT_SCENE).
//
// A scene is an object with setup(ctx) and draw(t, ctx):
// - setup runs once per section that uses the scene, before the first frame.
//   Make elements and canvases, register lyric lines, declare the transition,
//   cuts and blur windows here. Never touch the DOM at module top level.
// - draw runs on every seek while the section is on screen. It must be a pure
//   function of t (absolute song seconds): no Date, Math.random, timers or
//   requestAnimationFrame, no state carried from one draw to the next.
//   Seeded randomness comes from ctx.rng(seed) or src/lib/rng.js.
//
// What it shows: the brand background as a soft vertical gradient, one glow
// that swells slowly with the song's energy (nothing locked to the beat), a
// light vignette and grain, and every sung line of its section, centred inside
// title-safe in the theme's lyric style. No text other than the lyrics.
import {mix, rgba} from '../lib/color.js';

export default {
  setup(ctx) {
    // One full-page canvas in this section's root (#world). ctx.canvas()
    // handles devicePixelRatio; .get() hands back a cleared 2D context in CSS px.
    ctx.state.world = ctx.canvas();

    // Sections after the first fade in over the one before. A transition runs
    // over the frames BEFORE the section start, so this section is whole on
    // its first frame. Others: 'circle', 'wipe', 'diagonal', 'bars', 'whip',
    // 'zoom', 'cut' (see src/lib/transitions.js). Add blur: 4 for a
    // motion-blur window over a fast one.
    if (ctx.section.index > 0) ctx.transition({kind: 'fade', dur: 0.3});

    // Register every line whose first word is sung in this section. The
    // engine draws each registered line from its own schedule on every seek:
    // words rise in on the frames they are sung and the line fades out before
    // the next line's first word. Defaults: theme display font, lyric size,
    // bold, text colour, centred inside title-safe (see src/engine/text.js).
    for (const line of ctx.lines) ctx.lyric(line.id, {enter: 'rise', exit: 'fade'});
  },

  draw(t, ctx) {
    const {width: W, height: H, theme} = ctx;
    const c = ctx.state.world.get();

    // Background: the brand background, deepening toward primaryDeep at the bottom.
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.colors.background);
    bg.addColorStop(1, mix(theme.colors.background, theme.colors.primaryDeep, 0.55));
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // The glow breathes with the song: ctx.swell(t, {bars: 2}) is a slow 0..1
    // energy curve smoothed over two bars, so it rises and falls with the
    // sections and never pulses on the beat. When a direction asks for a
    // beat-locked accent, add pulse(ctx.sinceDownbeat(t)) from src/lib/pulse.js
    // (1 on each downbeat's frame, decaying to exactly 0).
    const swell = ctx.swell(t, {bars: 2});
    const r = H * (0.5 + 0.15 * swell);
    const x = W / 2;
    const y = H * 0.62;
    const glow = c.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, rgba(theme.colors.primary, 0.22 + 0.2 * swell));
    glow.addColorStop(1, rgba(theme.colors.primary, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    // Grain and vignette live in #fx, under the lyrics. Levels are set per draw.
    ctx.setFx({vignette: 0.35, grain: 0.035});
  },
};
