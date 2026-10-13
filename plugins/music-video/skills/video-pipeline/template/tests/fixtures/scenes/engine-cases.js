// Test fixture scene registry for engine regression cases (U1's own; other
// units should use timecode.js).
//
//   pivot    a full-page world container under a camera that zooms 2.236x
//            about the page centre from start + 0.5 s, with a 10 px dot at
//            the centre (#pivot-dot); comes in with a zoom transition
//            (x, y = page centre) when it isn't the first section
//   leaky    a canvas drawn the careless way: a t-dependent clip that is never
//            restored, fillStyle set only on even frames, a stroke with a line
//            dash set only sometimes; Canvas.get() must still give a fresh context
//   plain    a flat world colour, no transition (so its start is a hard cut)
//   faded    a flat world colour with an incoming 0.3 s fade
//   blurry   like plain, plus a 4-sample blur window over [end - 0.3 s, end + 0.3 s),
//            which crosses into the next section
//   exits    registers its section's lines with per-line options from OPTIONS
//            below (pairs, exitBy, short exits), white text on black
const flat = (color) => ({
  setup(ctx) {
    ctx.el('div', {style: {left: '0px', top: '0px', width: `${ctx.width}px`, height: `${ctx.height}px`, background: color}});
    for (const line of ctx.lines) ctx.lyric(line.id, {});
  },
  draw() {},
});

/** Per-line lyric options for the 'exits' scene, by line id. */
export const OPTIONS = {
  'e-1': {exit: 'fade'},
  'e-2': {pairWith: 'e-3', exit: 'scatter'},
  'e-3': {exit: 'scatter', y: 700},
  'e-4': {exitBy: 4.2, exitAt: 'hold'},
  'e-5': {exit: 'up', exitDur: 0.6, stagger: 0.08},
  'e-6': {exit: 'fall'},
  // A cut requested exactly on the last word's reveal (2 s when the words are at 1 s and 2 s).
  'c-1': {exit: 'cut', exitAt: 2},
  // Instant entrance: held from each word's reveal frame.
  'h-1': {enter: 'none'},
  // A slow-in fade whose last word gets one frame (a cut on its reveal): the page warns.
  'q-1': {enter: 'fade', enterEase: 'qio', exit: 'cut', exitAt: 2},
  // Exits that travel, one word at a time (0.3 s apart), from 2 s: the other words must not reflow.
  'x-left': {exit: 'left', exitAt: 2, exitDur: 0.3, stagger: 0.3},
  'x-fall': {exit: 'fall', exitAt: 2, exitDur: 0.3, stagger: 0.3},
  'x-shrink': {exit: 'shrink', exitAt: 2, exitDur: 0.3, stagger: 0.3},
  'x-suck': {exit: 'suck', exitAt: 2, exitDur: 0.3, stagger: 0.3, suckTo: [100, 100]},
};

export const SCENES = {
  pivot: {
    setup(ctx) {
      const {width: W, height: H} = ctx;
      ctx.state.world = ctx.el('div', {style: {left: '0px', top: '0px', width: `${W}px`, height: `${H}px`, background: '#202020'}});
      const dot = document.createElement('div');
      dot.id = ctx.section.index === 0 ? 'pivot-dot' : 'pivot-dot-in';
      Object.assign(dot.style, {position: 'absolute', left: `${W / 2 - 5}px`, top: `${H / 2 - 5}px`, width: '10px', height: '10px', background: '#ff0000'});
      ctx.state.world.appendChild(dot);
      ctx.state.cam = ctx.camera([[ctx.section.start + 0.5, 1, 0, 0], [ctx.section.start + 1, 2.236, 0, 0]], 'linear');
      if (ctx.section.index > 0) ctx.transition({kind: 'zoom', dur: 0.6, x: W / 2, y: H / 2});
    },
    draw(t, ctx) {
      ctx.applyCamera(ctx.state.world, ctx.state.cam(t));
    },
  },
  leaky: {
    setup(ctx) {
      ctx.state.c = ctx.canvas();
    },
    draw(t, ctx) {
      const c = ctx.state.c.get();
      const f = Math.round(t * ctx.fps);
      c.beginPath();
      c.rect((f % 7) * 40, (f % 5) * 30, ctx.width / 2, ctx.height / 2);
      c.clip();
      if (f % 2 === 0) c.fillStyle = `rgb(${(f * 37) % 255},80,160)`;
      c.fillRect(0, 0, ctx.width, ctx.height);
      if (f % 3 === 0) c.setLineDash([12, 6]);
      c.lineWidth = 3 + (f % 4);
      c.strokeRect(20, 20, ctx.width - 40, ctx.height - 40);
      c.font = f % 2 ? '40px serif' : c.font;
      c.translate(5, 5);
    },
  },
  plain: flat('#334455'),
  faded: {...flat('#553344'), setup(ctx) {
    flat('#553344').setup(ctx);
    ctx.transition({kind: 'fade', dur: 0.3});
  }},
  blurry: {...flat('#445533'), setup(ctx) {
    flat('#445533').setup(ctx);
    ctx.blur(ctx.section.end - 0.3, ctx.section.end + 0.3, 4);
  }},
  // Writes its ctx.beats / ctx.downbeats (frame-aligned seconds) onto its root as JSON, for the tests to read.
  beats: {
    setup(ctx) {
      ctx.root.dataset.beats = JSON.stringify(ctx.beats);
      ctx.root.dataset.downbeats = JSON.stringify(ctx.downbeats);
    },
    draw() {},
  },
  // Two logos: the onDark variant (falls back to logo.path when brand.json has none) and the default.
  logos: {
    setup(ctx) {
      ctx.logo({variant: 'onDark', height: 80}).dataset.variant = 'onDark';
      ctx.logo({variant: 'default', height: 80, y: 120}).dataset.variant = 'default';
    },
    draw() {},
  },
  exits: {
    setup(ctx) {
      ctx.el('div', {style: {left: '0px', top: '0px', width: `${ctx.width}px`, height: `${ctx.height}px`, background: '#000000'}});
      for (const line of ctx.lines) ctx.lyric(line.id, OPTIONS[line.id] ?? {});
    },
    draw() {},
  },
};
export const DEFAULT_SCENE = null;
