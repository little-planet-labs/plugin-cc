// Test fixture scene registry (use with ?scenes=tests/fixtures/scenes/timecode.js
// or --scenes=tests/fixtures/scenes/timecode.js). Shared with other tests:
// keep it general and change it only compatibly.
//
// Every scene here draws a TIME CODE: the binary value of
// Math.round(t * fps * 4) (quarter-frame resolution, so a capture taken at the
// wrong time decodes to a value that isn't 4n) as 20 large black/white
// blocks, LSB first, in 2 rows of 10, robust to x264 at small sizes.
// Layout in fractions of the page width W and height H (mirrored by
// tests/fixtures/scenes/timecode_decode.py; keep the two in sync):
//   stride s = W / 16; block = 0.8 s, centred in its cell
//   cell (col, row) = bit col + 10 * row; its top-left at (3 s + col * s, 0.15 H + row * s)
// The code sits on a black panel; every scene registers its section's lyric
// lines low on the page (y = 0.82 H), clear of the code.
//
// Scenes:
//   timecode       the code on a mid-grey world
//   timecode-cut   the same, and every section using it starts with a hard cut
//   moving         the code plus a white square sweeping across, with a
//                  4-sample blur window over [start + 0.5 s, start + 1.0 s)
//   bright         a white world with grain, vignette and a flash on #over at
//                  start + 0.2 s; no code (for textonly tests)

export const TIMECODE = Object.freeze({bits: 20, cols: 10, strideOfWidth: 1 / 16, blockOfStride: 0.8, x0Strides: 3, y0OfHeight: 0.15});

const timecodeSetup = (ctx) => {
  const {width: W, height: H} = ctx;
  const s = W * TIMECODE.strideOfWidth;
  const rows = TIMECODE.bits / TIMECODE.cols;
  const x0 = TIMECODE.x0Strides * s;
  const y0 = TIMECODE.y0OfHeight * H;
  ctx.el('div', {style: {left: '0px', top: '0px', width: `${W}px`, height: `${H}px`, background: '#808080'}});
  ctx.el('div', {style: {left: `${x0}px`, top: `${y0}px`, width: `${TIMECODE.cols * s}px`, height: `${rows * s}px`, background: '#000000'}});
  ctx.state.cells = Array.from({length: TIMECODE.bits}, (_, k) => {
    const col = k % TIMECODE.cols;
    const row = Math.floor(k / TIMECODE.cols);
    const b = s * TIMECODE.blockOfStride;
    return ctx.el('div', {
      style: {left: `${x0 + col * s + (s - b) / 2}px`, top: `${y0 + row * s + (s - b) / 2}px`, width: `${b}px`, height: `${b}px`, background: '#000000'},
    });
  });
  for (const line of ctx.lines) ctx.lyric(line.id, {y: H * 0.82, size: Math.round(H / 14), enter: 'fade', exit: 'fade'});
};

const timecodeDraw = (t, ctx) => {
  const v = Math.round(t * ctx.fps * 4);
  ctx.state.cells.forEach((cell, k) => ctx.style(cell, 'background', (v >> k) & 1 ? '#ffffff' : '#000000'));
};

const timecode = {setup: timecodeSetup, draw: timecodeDraw};

const moving = {
  setup(ctx) {
    timecodeSetup(ctx);
    const size = ctx.height / 6;
    ctx.state.box = ctx.el('div', {style: {left: '0px', top: `${ctx.height * 0.55}px`, width: `${size}px`, height: `${size}px`, background: '#ffffff'}});
    const a = ctx.section.start + 0.5;
    ctx.blur(a, a + 0.5, 4);
  },
  draw(t, ctx) {
    timecodeDraw(t, ctx);
    const x = (t - ctx.section.start) * ctx.width * 0.6;
    ctx.style(ctx.state.box, 'transform', `translateX(${x.toFixed(3)}px)`);
  },
};

const bright = {
  setup(ctx) {
    ctx.state.c = ctx.canvas();
    for (const line of ctx.lines) ctx.lyric(line.id, {enter: 'rise', exit: 'fade'});
  },
  draw(t, ctx) {
    const c = ctx.state.c.get();
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, ctx.width, ctx.height);
    ctx.setFx({grain: 0.2, vignette: 0.5});
    ctx.flash(t, {at: ctx.section.start + 0.2, peak: 0.5});
  },
};

export const SCENES = {timecode, 'timecode-cut': {...timecode, cut: true}, moving, bright};
export const DEFAULT_SCENE = null;
