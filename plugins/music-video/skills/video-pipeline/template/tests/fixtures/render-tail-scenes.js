// Scene registry for the tail render test (tests/render/render-tail.test.mjs),
// copied into its temp project. Use with --scenes=tests/fixtures/render-tail-scenes.js.
//
//   closer  a black world that turns white on every frame from ctx.audioEnd
//           (the end of the audio) on, so the frames a scene draws after the
//           audio are visible in the video; registers its lines with a held
//           exit (exitAt 'hold', as late as allowed), and writes ctx's video
//           and audio ends onto its root for the page probe.

const closer = {
  setup(ctx) {
    ctx.state.bg = ctx.el('div', {style: {left: '0px', top: '0px', width: `${ctx.width}px`, height: `${ctx.height}px`, background: '#000000'}});
    Object.assign(ctx.root.dataset, {audioEnd: String(ctx.audioEnd), audioFrames: String(ctx.audioFrames), duration: String(ctx.duration), frames: String(ctx.frames)});
    for (const line of ctx.lines) ctx.lyric(line.id, {exitAt: 'hold', size: 24});
  },
  draw(t, ctx) {
    ctx.style(ctx.state.bg, 'background', t >= ctx.audioEnd ? '#ffffff' : '#000000');
  },
};

export const SCENES = {closer};
export const DEFAULT_SCENE = null;
