// Scene registry for the render A/V test (tests/render/render-av-sync.test.mjs),
// copied into its temp project. Use with --scenes=tests/fixtures/render-scenes.js.
//
//   flash   a black world that turns white on exactly the frames nearest the
//           analysis onsets (Math.round(onset * fps)), and a DPR-aware canvas
//           square in the top-left corner (white on those frames too).
//           The test puts click times in the onsets, so a flash marks the
//           frame each click should land on.

const flash = {
  setup(ctx) {
    ctx.state.frames = new Set(ctx.analysis.onsets.map((s) => Math.round(s * ctx.fps)));
    ctx.state.bg = ctx.el('div', {style: {left: '0px', top: '0px', width: `${ctx.width}px`, height: `${ctx.height}px`, background: '#000000'}});
    ctx.state.c = ctx.canvas({width: ctx.width / 8, height: ctx.height / 8});
  },
  draw(t, ctx) {
    const on = ctx.state.frames.has(Math.round(t * ctx.fps));
    ctx.style(ctx.state.bg, 'background', on ? '#ffffff' : '#000000');
    const c = ctx.state.c.get();
    c.fillStyle = on ? '#ffffff' : '#000000';
    c.fillRect(0, 0, ctx.width / 8, ctx.height / 8);
  },
};

export const SCENES = {flash};
export const DEFAULT_SCENE = null;
