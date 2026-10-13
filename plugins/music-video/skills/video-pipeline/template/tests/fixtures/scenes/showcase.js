// Test fixture scene registry for the determinism tests: one scene that
// exercises most of the engine at once. Each section draws a seeded canvas
// world (gradient, rects, a camera push), a rotating DOM card, a shatter of the
// world at start + 0.6 s, a world shake, grain and vignette, and registers its
// lyric lines with a blur entrance; every section after the first comes in
// with a circle transition (colour ring) over the 0.5 s before its start.
import {rgba} from '../../../src/lib/color.js';

export const SCENES = {
  showcase: {
    setup(ctx) {
      ctx.state.src = ctx.canvas({offscreen: true});
      ctx.state.out = ctx.canvas();
      ctx.state.card = ctx.el('div', {
        style: {left: `${ctx.width * 0.6}px`, top: `${ctx.height * 0.2}px`, width: `${ctx.width * 0.2}px`, height: `${ctx.height * 0.3}px`,
          background: `linear-gradient(135deg, ${ctx.theme.colors.accent}, ${ctx.theme.colors.accentAlt})`, borderRadius: '24px'},
      });
      const r = ctx.rng('rects');
      ctx.state.rects = Array.from({length: 40}, () => ({x: r(), y: r(), w: r() * 0.2, h: r() * 0.2, c: r() < 0.5 ? ctx.theme.colors.primary : ctx.theme.colors.accent}));
      ctx.state.cam = ctx.camera([[ctx.section.start, 1.15, 0, 0], [ctx.section.end, 1, 30, -20]]);
      ctx.state.shatter = ctx.shatter({at: ctx.section.start + 0.6, x: ctx.width * 0.4, y: ctx.height * 0.5, seed: ctx.section.id});
      if (ctx.section.index > 0) ctx.transition({kind: 'circle', dur: 0.5, x: ctx.width * 0.3, y: ctx.height * 0.4, ring: {color: ctx.theme.colors.accent, width: 24}});
      for (const line of ctx.lines) ctx.lyric(line.id, {enter: 'blur', exit: 'scatter'});
    },
    draw(t, ctx) {
      const {width: W, height: H} = ctx;
      const s = ctx.state.src.get();
      s.save();
      ctx.cameraOnCanvas(s, ctx.state.cam(t));
      const g = s.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, ctx.theme.colors.background);
      g.addColorStop(1, ctx.theme.colors.primaryDeep);
      s.fillStyle = g;
      s.fillRect(0, 0, W, H);
      for (const q of ctx.state.rects) {
        s.fillStyle = rgba(q.c, 0.6);
        s.fillRect(q.x * W, q.y * H, q.w * W, q.h * H);
      }
      s.restore();
      const out = ctx.state.out.get();
      ctx.state.shatter.draw(out, ctx.state.src, t);
      ctx.style(ctx.state.card, 'transform', `rotate(${((t - ctx.section.start) * 90).toFixed(3)}deg)`);
      ctx.shake(ctx.state.out.el, t, {at: ctx.section.start + 0.6, amp: 20});
      ctx.setFx({grain: 0.08, vignette: 0.4});
    },
  },
};
export const DEFAULT_SCENE = null;
