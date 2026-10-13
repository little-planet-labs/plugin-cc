// Test fixture scene registry for tests/render/qa-still-test.test.mjs (copy it
// into a fixture project and load it with ?scenes=tests/fixtures/qa-scenes/held-motion.js;
// held-still.js is the same scene without the motion).
//
// One scene, `held`, registers every lyric line of its section (fade in, fade
// out, with the per-line options in OPTIONS: p-1 is shown together with p-2,
// which enters during p-1's hold; w-1 starts leaving word by word before its
// last word has settled, so it has no line-wide hold although each word is
// held) and then breaks the held-text rule on purpose for the lines in
// MOTION, from `at` seconds on (a whole frame: at * 30 is an integer):
//   translate     moves word `word` of the line by that many CSS px (sub-pixel);
//   opacity       sets the whole line's opacity;
//   hiddenBefore  keeps the whole line at opacity 0 until `at`, so its words
//                 are blank on their first hold frames and drawn later.
// It reaches into the lyric layer's own elements (#txt .ly[data-line],
// .wm[data-word]), which a real scene must never do; that is the defect
// still-test has to report.
export const MOTION = {
  'm-1': {at: 4, translate: 0.25, word: 1},
  'o-1': {at: 6.4, opacity: 254 / 255},
  'w-1': {at: 10.3, translate: 0.25, word: 0},
  'b-1': {at: 13.8, hiddenBefore: true},
};

/** Per-line lyric options: a pair, the second line lower on the page; a line whose words leave one by one, early. */
export const OPTIONS = {
  'p-1': {pairWith: 'p-2', y: 200},
  'p-2': {y: 380},
  'w-1': {exitAt: 10.6, stagger: 0.6, exitDur: 0.3},
};

/** The `held` scene, breaking the rule for the lines in `motion` (MOTION's shape; {} for a correct scene). */
export const heldScene = (motion) => ({
  setup(ctx) {
    for (const line of ctx.lines) ctx.lyric(line.id, {enter: 'fade', exit: 'fade', ...OPTIONS[line.id]});
  },
  draw(t) {
    for (const [id, m] of Object.entries(motion)) {
      const el = [...document.querySelectorAll('#txt .ly')].find((e) => e.dataset.line === id);
      if (!el) continue;
      const on = t >= m.at - 1e-9;
      if (m.translate !== undefined) el.querySelector(`.wm[data-word="${m.word}"]`).style.translate = on ? `${m.translate}px 0px` : '';
      if (m.opacity !== undefined) el.style.opacity = on ? String(m.opacity) : '';
      if (m.hiddenBefore) el.style.opacity = on ? '' : '0';
    }
  },
});

export const SCENES = {held: heldScene(MOTION)};
export const DEFAULT_SCENE = null;
