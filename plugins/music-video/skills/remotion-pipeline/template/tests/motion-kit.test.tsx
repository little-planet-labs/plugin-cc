// Pins the properties the optional motion kit (src/components/motion) exists
// for: springs that land on exactly 1 and stay, masks that don't clip glyphs,
// held words with no transform, deterministic blend-free grain, an energy swell
// with no beat ripple, and a circle flood that clears the frame. Components are
// rendered server-side through @remotion/player's <Thumbnail>, as in
// kinetic.test.tsx and hooks.test.tsx.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {Sequence, spring} from 'remotion';
import {
  CircleFlood,
  floodGeometry,
  Grain,
  logZoom,
  MaskedWords,
  maskedExitPlan,
  Scrim,
  settleFrames,
  SPRING_PRESETS,
  springSettled,
  useEnergySwell,
  type MaskedExit,
  type SpringPreset,
} from '../src/components/motion';
import type {AudioAnalysis} from '../src/lib/analysis-schema';
import {AudioAnalysisContext, LyricsContext} from '../src/lib/hooks';
import type {LyricLine} from '../src/lib/lyrics-schema';
import {theme} from '../src/theme';
import {FPS, gridAnalysis} from './fixtures';

const renderAt = (component: ComponentType, frame: number, size: {width: number; height: number} = {width: 100, height: 100}, durationInFrames = 600): string =>
  renderToString(
    <Thumbnail
      component={component}
      frameToDisplay={frame}
      durationInFrames={durationInFrames}
      fps={FPS}
      compositionWidth={size.width}
      compositionHeight={size.height}
    />,
  );

const PRESETS = Object.keys(SPRING_PRESETS) as SpringPreset[];

// ---------------------------------------------------------------------------
// springSettled
// ---------------------------------------------------------------------------

describe('springSettled', () => {
  it('springSettled returns exactly 1 from the settle frame for every preset', () => {
    for (const fps of [30, 60]) {
      for (const preset of PRESETS) {
        const at = 100;
        const settle = settleFrames(fps, preset);
        assert.ok(settle > 0 && Number.isInteger(settle), `${preset}@${fps}: settle frame ${settle}`);
        for (let f = at - 20; f < at; f++) {
          assert.equal(springSettled(f, at, fps, preset), 0, `${preset}@${fps}: frame ${f} is before at`);
        }
        assert.equal(springSettled(at + settle, at, fps, preset), 1, `${preset}@${fps}: settle frame`);
        // Mid-way it is still moving: the exact 1 is where the spring lands, not a constant.
        assert.notEqual(springSettled(at + Math.floor(settle / 2), at, fps, preset), 1, `${preset}@${fps}: moving mid-way`);
      }
    }
  });

  it('springSettled never moves after settling', () => {
    for (const preset of PRESETS) {
      const at = 37;
      const settle = settleFrames(FPS, preset);
      for (let f = at + settle; f <= at + settle + 120; f++) {
        assert.equal(springSettled(f, at, FPS, preset), 1, `${preset}: frame ${f}`);
      }
    }
  });

  it('springSettled eases into the settle frame without a snap', () => {
    // Without the residual blend the value jumps the last ~0.001 in one frame
    // at the settle frame, larger than any step the spring itself takes there.
    for (const fps of [24, 30, 60]) {
      for (const preset of PRESETS) {
        const settle = settleFrames(fps, preset);
        const raw = (t: number) => spring({frame: t, fps, config: SPRING_PRESETS[preset]});
        const v = (t: number) => springSettled(t, 0, fps, preset);
        const step = (f: (t: number) => number, t: number) => Math.abs(f(t) - f(t - 1));
        // The step INTO the settle frame is no bigger than the spring's own step just before it.
        assert.ok(step(v, settle) <= step(raw, settle - 1), `${preset}@${fps}: settle step ${step(v, settle)} vs natural ${step(raw, settle - 1)}`);
        // Over the last 0.2 s, no step is bigger than the largest step the spring itself takes there.
        const window = Math.round(0.2 * fps);
        let natural = 0;
        for (let t = settle - window; t <= settle; t++) natural = Math.max(natural, step(raw, t));
        for (let t = settle - window + 1; t <= settle + 1; t++) {
          assert.ok(step(v, t) <= natural, `${preset}@${fps}: frame ${t} steps ${step(v, t)} > natural ${natural}`);
        }
      }
    }
  });

  it('springSettled overshoot stays small except playful', () => {
    const peak = (preset: SpringPreset) => {
      let max = 0;
      for (let f = 0; f <= settleFrames(FPS, preset) + 5; f++) max = Math.max(max, springSettled(f, 0, FPS, preset));
      return max;
    };
    for (const preset of ['snappy', 'default', 'heavy'] as const) {
      assert.ok(peak(preset) <= 1.01, `${preset} peaks at ${peak(preset)}`);
    }
    // The bound is meaningful: the under-damped preset does overshoot.
    assert.ok(peak('playful') > 1.1, `playful peaks at ${peak('playful')}`);
  });
});

// ---------------------------------------------------------------------------
// logZoom
// ---------------------------------------------------------------------------

describe('logZoom', () => {
  it('logZoom interpolates geometric mean at the midpoint with linear easing', () => {
    const linear = (t: number) => t;
    assert.ok(Math.abs(logZoom(5, 0, 10, 1, 4, linear) - 2) < 1e-12, 'sqrt(1 * 4) = 2, not the arithmetic 2.5');
    assert.ok(Math.abs(logZoom(130, 100, 160, 0.5, 8, linear) - 2) < 1e-12, 'sqrt(0.5 * 8) = 2');
    // Ends and clamping.
    assert.ok(Math.abs(logZoom(0, 0, 10, 1, 4, linear) - 1) < 1e-12);
    assert.ok(Math.abs(logZoom(10, 0, 10, 1, 4, linear) - 4) < 1e-12);
    assert.ok(Math.abs(logZoom(-5, 0, 10, 1, 4, linear) - 1) < 1e-12);
    assert.ok(Math.abs(logZoom(50, 0, 10, 1, 4, linear) - 4) < 1e-12);
  });
});

// ---------------------------------------------------------------------------
// MaskedWords
// ---------------------------------------------------------------------------

// Word starts at 2.0, 2.3, 2.6 s -> frames 60, 69, 78. The next line starts at 4 s (frame 120).
const lines: LyricLine[] = [
  {
    id: 'v-1',
    text: 'Jumping quickly gypsy',
    start: 2,
    end: 3,
    words: [
      {text: 'Jumping', start: 2, end: 2.3},
      {text: 'quickly', start: 2.3, end: 2.6},
      {text: 'gypsy', start: 2.6, end: 3},
    ],
  },
  {
    id: 'v-2',
    text: 'all at once',
    start: 4,
    end: 4.5,
    // Sung starts round to frames 120, 120 and 121: the stagger spreads the reveals to 120, 122, 124.
    words: [
      {text: 'all', start: 4, end: 4.005},
      {text: 'at', start: 4.01, end: 4.02},
      {text: 'once', start: 4.02, end: 4.5},
    ],
  },
];
const WORD_STARTS = [60, 69, 78];

// Inside a Sequence so the word frames must be read as song time, not local time.
const Words = () => (
  <LyricsContext.Provider value={lines}>
    <Sequence from={30}>
      <MaskedWords id="v-1" accent={[2]} />
    </Sequence>
  </LyricsContext.Provider>
);

const Crowded = () => (
  <LyricsContext.Provider value={lines}>
    <MaskedWords id="v-2" />
  </LyricsContext.Provider>
);

/** style="" of each element carrying `data-<attr>="i"`, by i. */
const stylesBy = (html: string, attr: 'word' | 'mask'): Record<number, string> => {
  const out: Record<number, string> = {};
  for (const m of html.matchAll(new RegExp(`<span data-${attr}="(\\d+)" style="([^"]*)"`, 'g'))) out[Number(m[1])] = m[2]!;
  return out;
};

const emOf = (style: string, prop: string): number => {
  const m = style.match(new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)em`));
  assert.ok(m, `${prop} in ${style}`);
  return Number(m[1]);
};

describe('MaskedWords', () => {
  it('MaskedWords mask leaves room below the line for descenders', () => {
    const html = renderAt(Words, 120 - 10);
    const masks = stylesBy(html, 'mask');
    const words = stylesBy(html, 'word');
    assert.deepEqual(Object.keys(masks).map(Number), [0, 1, 2]);
    for (const [i, style] of Object.entries(masks)) {
      assert.match(style, /overflow:hidden/, `mask ${i} clips`);
      const pb = emOf(style, 'padding-bottom');
      assert.ok(pb >= 0.4, `mask ${i}: ${pb}em below the line`);
      assert.equal(emOf(style, 'margin-bottom'), -pb, `mask ${i}: matching negative margin`);
      // Room above too, for accents and the entrance rotation.
      const pt = emOf(style, 'padding-top');
      assert.ok(pt > 0);
      assert.equal(emOf(style, 'margin-top'), -pt);
    }
    // The gradient word (background-clip:text) has a box reaching past its glyphs, so the fill covers descenders.
    const accent = words[2]!;
    assert.match(accent, /background-clip:text/);
    const wpb = emOf(accent, 'padding-bottom');
    assert.ok(wpb >= 0.25, `gradient box reaches ${wpb}em below the line box`);
    assert.equal(emOf(accent, 'margin-bottom'), -wpb);
    const wpt = emOf(accent, 'padding-top');
    assert.ok(wpt > 0);
    assert.equal(emOf(accent, 'margin-top'), -wpt);
    // And the mask leaves more room below than the gradient box needs.
    assert.ok(emOf(masks[2]!, 'padding-bottom') > wpb);
  });

  it('MaskedWords settled words carry no transform', () => {
    // Discriminates: a word that has just been revealed is still rising.
    const rising = stylesBy(renderAt(Words, WORD_STARTS[1]!), 'word');
    assert.match(rising[1]!, /transform:translateY/);
    // Long after the last word's snappy spring settled, before the first exit
    // starts (default fade: 9 frames, 1 apart, ending at 118 -> word 0 leaves at 107).
    const settledFrame = WORD_STARTS[2]! + settleFrames(FPS, 'snappy') + 2;
    assert.ok(settledFrame + 3 < 107);
    const held = stylesBy(renderAt(Words, settledFrame), 'word');
    assert.deepEqual(Object.keys(held).map(Number), [0, 1, 2]);
    for (const [i, style] of Object.entries(held)) {
      assert.doesNotMatch(style, /transform/, `word ${i}: ${style}`);
      assert.doesNotMatch(style, /visibility/, `word ${i} is shown`);
    }
    // Held frames render identically.
    assert.equal(renderAt(Words, settledFrame), renderAt(Words, settledFrame + 3));
  });

  it('MaskedWords keeps the transform until the settle frame, overshoot included', () => {
    // Playful overshoots by about 20% and dips back under 1 before it settles:
    // stillness must follow the settle FRAME, not the spring's value.
    const Playful = () => (
      <LyricsContext.Provider value={lines}>
        <MaskedWords id="v-1" preset="playful" />
      </LyricsContext.Provider>
    );
    const reveal = WORD_STARTS[0]!;
    // The spring starts LEAD_FRAMES (2) before the reveal, hidden behind the mask.
    const springStart = reveal - 2;
    const settle = springStart + settleFrames(FPS, 'playful');
    assert.ok(settle + 10 < 107, 'settles before the first exit starts');
    let overshootFrames = 0;
    for (let f = reveal; f < settle; f++) {
      const style = stylesBy(renderAt(Playful, f), 'word')[0]!;
      const m = style.match(/transform:translateY\((-?[\d.]+)%\)/);
      assert.ok(m, `frame ${f} (settle ${settle}) still moving: ${style}`);
      const y = Number(m[1]);
      if (springSettled(f, springStart, FPS, 'playful') > 1) {
        overshootFrames++;
        assert.ok(y < 0, `frame ${f}: overshoot lifts the word (translateY ${y}%)`);
      }
    }
    assert.ok(overshootFrames >= 3, `${overshootFrames} overshoot frames`);
    for (let f = settle; f < settle + 10; f++) {
      assert.doesNotMatch(stylesBy(renderAt(Playful, f), 'word')[0]!, /transform/, `frame ${f} is settled`);
    }
  });

  it('MaskedWords reveals each word on its start frame, not before', () => {
    assert.equal(renderAt(Words, WORD_STARTS[0]! - 1).includes('Jumping'), false, 'nothing before the first word');
    WORD_STARTS.forEach((start, i) => {
      const before = stylesBy(renderAt(Words, start - 1), 'word');
      if (i > 0) assert.match(before[i]!, /visibility:hidden/, `word ${i} hidden at ${start - 1}`);
      const on = stylesBy(renderAt(Words, start), 'word');
      assert.doesNotMatch(on[i]!, /visibility:hidden/, `word ${i} shown at ${start}`);
      // Partway up on its start frame, not still entirely below the mask (translateY 100%).
      const y = Number(on[i]!.match(/translateY\(([\d.]+)%\)/)?.[1]);
      assert.ok(y > 0 && y < 80, `word ${i} at translateY ${y}% on its start frame`);
      // Later words are still hidden.
      for (let j = i + 1; j < WORD_STARTS.length; j++) assert.match(on[j]!, /visibility:hidden/, `word ${j} hidden at ${start}`);
    });
  });

  it('MaskedWords is gone 2 frames before the next line starts', () => {
    // The next line's first word is at frame 120: the line renders nothing from 118 on.
    assert.equal(renderAt(Words, 117).includes('Jumping'), true);
    assert.equal(renderAt(Words, 118).includes('Jumping'), false);
    assert.equal(renderAt(Words, 120).includes('Jumping'), false);
  });

  it('MaskedWords staggers words sung on the same frame 2 frames apart', () => {
    const hidden = (f: number) => {
      const s = stylesBy(renderAt(Crowded, f), 'word');
      return [0, 1, 2].map((i) => /visibility:hidden/.test(s[i] ?? ''));
    };
    assert.deepEqual(hidden(120), [false, true, true]);
    assert.deepEqual(hidden(121), [false, true, true]);
    assert.deepEqual(hidden(122), [false, false, true]);
    assert.deepEqual(hidden(123), [false, false, true]);
    assert.deepEqual(hidden(124), [false, false, false]);
  });
});

// ---------------------------------------------------------------------------
// MaskedWords exits
// ---------------------------------------------------------------------------

const EXITS: MaskedExit[] = ['fade', 'up', 'down', 'left', 'right', 'scatter', 'fall', 'blur', 'shrink', 'cut', {suckTo: [40, -200]}];
const exitName = (e: MaskedExit) => (typeof e === 'string' ? e : 'suck');
const TRAVELLING = new Set(['left', 'right', 'scatter', 'fall', 'blur', 'shrink']);

const Exiting = ({exit, ...rest}: {exit: MaskedExit; exitBy?: number; until?: number; seed?: string}) => (
  <LyricsContext.Provider value={lines}>
    <Sequence from={30}>
      <MaskedWords id="v-1" exit={exit} {...rest} />
    </Sequence>
  </LyricsContext.Provider>
);

/** Style of a word with every property an exit may set removed: what's left decides layout. */
const layoutOf = (style: string) =>
  style
    .split(';')
    .filter((d) => d && !/^(transform|transform-origin|opacity|filter|visibility):/.test(d))
    .join(';');

const EXIT_STYLE = /transform|opacity|filter|visibility:hidden/;

describe('MaskedWords exits', () => {
  // v-1: reveals 60, 69, 78; the next line's first word is at 120, so E = 118.
  // Default exit: 9 frames, 1 frame apart, the last word gone at 118: word 0
  // leaves from 107, word 1 from 108, word 2 from 109. A cut: the whole line vanishes at 118.
  it('MaskedWords renders nothing from 2 frames before the next line for every exit kind', () => {
    for (const exit of EXITS) {
      const C = () => <Exiting exit={exit} />;
      for (const f of [118, 119, 120, 150]) assert.doesNotMatch(renderAt(C, f), /data-word|data-copy-word/, `${exitName(exit)}: frame ${f}`);
      // A cut has no exit frames: the whole line is held on 117 and gone on 118.
      const firstExit = exit === 'cut' ? 118 : 107;
      // Before its exit starts the whole line is visible and held still.
      const held = stylesBy(renderAt(C, firstExit - 1), 'word');
      assert.deepEqual(Object.keys(held).map(Number), [0, 1, 2], exitName(exit));
      for (const [i, style] of Object.entries(held)) assert.doesNotMatch(style, EXIT_STYLE, `${exitName(exit)}: word ${i} held at ${firstExit - 1}: ${style}`);
      if (exit === 'cut') continue;
      // On its first exit frame word 0 is visibly leaving, the others still held.
      const leaving = stylesBy(renderAt(C, firstExit), 'word');
      assert.match(leaving[0]!, EXIT_STYLE, `${exitName(exit)}: word 0 leaves at ${firstExit}`);
      assert.doesNotMatch(leaving[1]!, EXIT_STYLE, `${exitName(exit)}: word 1 still held at ${firstExit}`);
      // The last word is still on screen on the last frame before E.
      assert.ok(renderAt(C, 117).includes('gypsy'), `${exitName(exit)}: last word on at 117`);
    }
  });

  it('MaskedWords cut removes the whole line at once, ignoring exitStagger', () => {
    const C = () => (
      <LyricsContext.Provider value={lines}>
        <MaskedWords id="v-1" exit="cut" exitStagger={4} />
      </LyricsContext.Provider>
    );
    for (const f of [110, 114, 117]) {
      const words = stylesBy(renderAt(C, f), 'word');
      assert.deepEqual(Object.keys(words).map(Number), [0, 1, 2]);
      for (const [i, style] of Object.entries(words)) assert.doesNotMatch(style, EXIT_STYLE, `word ${i} still on at ${f}`);
    }
    assert.doesNotMatch(renderAt(C, 118), /data-word/);
  });

  it('MaskedWords holds the last line with no exit when nothing bounds it', () => {
    // v-2 is the last line in lyrics order and has no exitBy or until.
    for (const exit of EXITS) {
      const C = () => (
        <LyricsContext.Provider value={lines}>
          <MaskedWords id="v-2" exit={exit} />
        </LyricsContext.Provider>
      );
      for (const f of [200, 400, 599]) {
        const words = stylesBy(renderAt(C, f), 'word');
        assert.deepEqual(Object.keys(words).map(Number), [0, 1, 2], `${exitName(exit)} at ${f}`);
        for (const [i, style] of Object.entries(words)) assert.doesNotMatch(style, EXIT_STYLE, `${exitName(exit)}: word ${i} held at ${f}`);
      }
    }
  });

  it('MaskedWords exits move words without reflowing the others and release the mask only for travelling exits', () => {
    const heldLayout = Object.values(stylesBy(renderAt(() => <Exiting exit="fade" />, 100), 'word')).map(layoutOf);
    for (const exit of EXITS) {
      const name = exitName(exit);
      const C = () => <Exiting exit={exit} />;
      // Frame 112: word 0 is mid-exit (or gone) for every non-cut kind.
      const html = renderAt(C, 112);
      const words = stylesBy(html, 'word');
      assert.deepEqual(Object.values(words).map(layoutOf), heldLayout, `${name}: word boxes unchanged`);
      const mask0 = stylesBy(html, 'mask')[0]!;
      if (TRAVELLING.has(name)) assert.match(mask0, /overflow:visible/, `${name}: mask released while travelling`);
      else assert.match(mask0, /overflow:hidden/, `${name}: mask kept`);
      if (name === 'up' || name === 'down') assert.match(words[0]!, /translateY\(/, name);
      // A word that has not started its exit keeps its mask.
      const held = stylesBy(renderAt(C, 106), 'mask');
      for (const style of Object.values(held)) assert.match(style, /overflow:hidden/, `${name}: held mask clips`);
    }
    // Suck: a copy layer spirals word 0 into the block-space point; the in-flow word keeps its box, hidden.
    const suck = renderAt(() => <Exiting exit={{suckTo: [40, -200]}} />, 112);
    assert.match(suck, /data-suck="0" style="[^"]*transform-origin:40px -200px;[^"]*transform:rotate\(/);
    assert.match(stylesBy(suck, 'word')[0]!, /visibility:hidden/);
  });

  it('MaskedWords earlier exitBy wins over the next line', () => {
    for (const exit of EXITS) {
      for (const bound of [{exitBy: 100}, {until: 100}, {exitBy: 100, until: 140}]) {
        const C = () => <Exiting exit={exit} {...bound} />;
        assert.doesNotMatch(renderAt(C, 100), /data-word/, `${exitName(exit)} ${JSON.stringify(bound)}: gone at 100`);
        assert.match(renderAt(C, 85), /data-word/, `${exitName(exit)}: still on at 85`);
      }
      // A later bound doesn't extend the line past the next line's rule.
      const late = () => <Exiting exit={exit} exitBy={200} />;
      assert.doesNotMatch(renderAt(late, 118), /data-word/, `${exitName(exit)}: exitBy 200 still gone at 118`);
    }
  });

  it('MaskedWords scatter and fall are deterministic per seed', () => {
    for (const exit of ['scatter', 'fall'] as const) {
      const at = (seed?: string) => renderAt(() => <Exiting exit={exit} seed={seed} />, 113);
      assert.equal(at('a'), at('a'), `${exit}: same seed, same frame`);
      assert.notEqual(at('a'), at('b'), `${exit}: another seed differs`);
      assert.equal(at(), at('v-1'), `${exit}: the seed defaults to the line id`);
      assert.match(at('a'), /data-word="0" style="[^"]*transform:translate\(/, exit);
    }
  });

  it('MaskedWords meets the 2-frame rule on a very short hold', () => {
    // Words at frames 60, 63, 66 and the next line at 69: E = 67, before any word settles.
    const short: LyricLine[] = [
      {id: 's-1', text: 'go go go', start: 2, end: 2.25, words: [{text: 'go', start: 2, end: 2.1}, {text: 'go', start: 2.1, end: 2.2}, {text: 'go', start: 2.2, end: 2.25}]},
      {id: 's-2', text: 'now', start: 2.3, end: 2.6, words: [{text: 'now', start: 2.3, end: 2.6}]},
    ];
    for (const exit of EXITS) {
      const C = () => (
        <LyricsContext.Provider value={short}>
          <MaskedWords id="s-1" exit={exit} />
        </LyricsContext.Provider>
      );
      for (const f of [67, 68, 69]) assert.doesNotMatch(renderAt(C, f), /data-word/, `${exitName(exit)}: frame ${f}`);
      assert.match(renderAt(C, 66), /data-word/, `${exitName(exit)}: on at 66`);
      // Every word is on screen, not yet leaving, on its reveal frame.
      [60, 63, 66].forEach((r, i) => {
        const style = stylesBy(renderAt(C, r), 'word')[i]!;
        assert.doesNotMatch(style, /visibility:hidden|opacity|filter/, `${exitName(exit)}: word ${i} shown at ${r}: ${style}`);
      });
    }
  });

  it('maskedExitPlan never starts an exit before the reveal and ends every exit by E', () => {
    // Holds from generous to none: settle 13 frames after each reveal.
    for (let end = 40; end <= 140; end += 3) {
      for (const [X, G] of [
        [9, 1],
        [12, 3],
        [4, 0],
        [0, 2],
      ] as const) {
        const reveals = [30, 34, 38, 45];
        const plan = maskedExitPlan({reveals, settled: reveals.map((r) => r + 13), end, exitFrames: X, exitStagger: G});
        plan.forEach((p, k) => {
          const r = reveals[k]!;
          assert.ok(p.start + p.frames <= end + 1e-9, `end ${end} X ${X}: word ${k} ends at ${p.start + p.frames}`);
          assert.ok(p.start >= Math.min(r, end), `end ${end} X ${X}: word ${k} starts ${p.start} before its reveal ${r}`);
          assert.ok(p.frames <= X + 1e-9);
        });
        // With room to spare, the full exit plays and the last word leaves exactly at E.
        if (end >= 45 + 13 + X + 3 * G) {
          assert.equal(plan[3]!.start + plan[3]!.frames, end);
          assert.equal(plan[3]!.frames, X);
          assert.equal(plan[0]!.start, end - X - 3 * G);
        }
      }
    }
  });

  it('maskedExitPlan collapses to a cut when not even a compressed exit fits', () => {
    // Reveals at 60 and 62, gone by 61: no room for any exit.
    assert.deepEqual(maskedExitPlan({reveals: [60, 62], settled: [73, 75], end: 61, exitFrames: 9, exitStagger: 1}), [
      {start: 61, frames: 0},
      {start: 61, frames: 0},
    ]);
    const C = () => (
      <LyricsContext.Provider
        value={[
          {id: 'c-1', text: 'no time', start: 2, end: 2.07, words: [{text: 'no', start: 2, end: 2.03}, {text: 'time', start: 2.07, end: 2.09}]},
          {id: 'c-2', text: 'next', start: 2.1, end: 2.5},
        ]}
      >
        <MaskedWords id="c-1" exit="scatter" />
      </LyricsContext.Provider>
    );
    const at60 = stylesBy(renderAt(C, 60), 'word');
    assert.doesNotMatch(at60[0]!, /opacity|filter|visibility:hidden/, 'word 0 shown at 60');
    assert.doesNotMatch(renderAt(C, 61), /data-word/, 'cut at E = 63 - 2');
  });
});

// ---------------------------------------------------------------------------
// Grain
// ---------------------------------------------------------------------------

const grainAt = (seed: string, frame: number, pair = false) =>
  renderAt(
    () => (
      <>
        <Grain seed={seed} />
        {pair ? <Grain seed={seed} /> : null}
      </>
    ),
    frame,
  );

describe('Grain', () => {
  it('Grain is deterministic per frame and seed', () => {
    const a = grainAt('film', 10);
    assert.match(a, /<feTurbulence[^>]*seed="\d+"/);
    assert.equal(grainAt('film', 10), a, 'same frame and seed, same markup');
    assert.notEqual(grainAt('film', 11), a, 'another frame re-seeds');
    assert.notEqual(grainAt('other', 10), a, 'another seed differs');
    // Two instances never share a filter id.
    const ids = [...grainAt('film', 10, true).matchAll(/<filter id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4, `filter ids ${ids.join(', ')}`);
  });

  it('Grain uses no mix-blend-mode', () => {
    for (const frame of [0, 10, 11, 250]) {
      const html = grainAt('film', frame, true);
      assert.match(html, /<svg/, 'it rendered');
      assert.doesNotMatch(html, /mix-blend-mode|mixBlendMode|blend/i);
    }
  });
});

// ---------------------------------------------------------------------------
// useEnergySwell
// ---------------------------------------------------------------------------

// 117 BPM: a beat every 15.38 frames, a bar of 61.5 frames, so the bar is NOT a
// whole number of frames. Energy = a slow section swell (period 600 frames)
// plus a strong beat-period oscillation.
const BEAT_PERIOD = (60 / 117) * FPS;
const SWELL_FRAMES = 900;
const slow = (f: number) => 0.5 + 0.1 * Math.sin((2 * Math.PI * f) / 600);
const energyAt = (f: number) => slow(f) + 0.35 * Math.sin((2 * Math.PI * f) / BEAT_PERIOD);
const swellAnalysis: AudioAnalysis = {
  ...gridAnalysis({count: 56, period: 60 / 117}),
  durationInFrames: SWELL_FRAMES,
  energy: {
    low: Array.from({length: SWELL_FRAMES}, (_, f) => energyAt(f)),
    mid: Array.from({length: SWELL_FRAMES}, (_, f) => energyAt(f)),
    high: [],
  },
};

const SwellProbe = () => <i data-swell={useEnergySwell()} />;
const Swell = () => (
  <AudioAnalysisContext.Provider value={swellAnalysis}>
    <SwellProbe />
  </AudioAnalysisContext.Provider>
);

/** Amplitude of the `period` component of `xs` (Hann-windowed DFT, so the slow swell doesn't leak in). */
const amplitudeAt = (xs: readonly number[], period: number): number => {
  const n = xs.length;
  let re = 0;
  let im = 0;
  let wsum = 0;
  xs.forEach((x, k) => {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    re += w * x * Math.cos((2 * Math.PI * k) / period);
    im += w * x * Math.sin((2 * Math.PI * k) / period);
    wsum += w;
  });
  return (2 * Math.hypot(re, im)) / wsum;
};

describe('useEnergySwell', () => {
  it('useEnergySwell removes beat-rate ripple', () => {
    const frames = Array.from({length: 240}, (_, k) => 300 + k);
    const swell = frames.map((f) => {
      const m = renderAt(Swell, f, undefined, SWELL_FRAMES).match(/data-swell="([^"]+)"/);
      assert.ok(m, `frame ${f}`);
      return Number(m[1]);
    });
    const raw = frames.map(energyAt);
    const rawBeat = amplitudeAt(raw, BEAT_PERIOD);
    const swellBeat = amplitudeAt(swell, BEAT_PERIOD);
    assert.ok(rawBeat > 0.3, `the fixture has a strong beat ripple (${rawBeat})`);
    assert.ok(swellBeat <= 0.1 * rawBeat, `beat amplitude ${swellBeat} vs ${rawBeat} raw`);
    // The slow section swell survives: the hook follows it closely.
    frames.forEach((f, k) => assert.ok(Math.abs(swell[k]! - slow(f)) < 0.01, `frame ${f}: ${swell[k]} vs ${slow(f)}`));
  });
});

describe('useEnergySwell at the ends of the track', () => {
  it('useEnergySwell holds the end values at the first and last frame', () => {
    // Constant energy: a filter that read 0 past either end would give about half of it there.
    const level = 0.37;
    const frames = 300;
    const flat: AudioAnalysis = {
      ...gridAnalysis({count: 20, period: 0.5}),
      durationInFrames: frames,
      energy: {low: Array(frames).fill(level) as number[], mid: Array(frames).fill(level) as number[], high: []},
    };
    const Flat = () => (
      <AudioAnalysisContext.Provider value={flat}>
        <SwellProbe />
      </AudioAnalysisContext.Provider>
    );
    for (const f of [0, 1, 150, frames - 2, frames - 1]) {
      const m = renderAt(Flat, f, undefined, frames).match(/data-swell="([^"]+)"/);
      assert.ok(m, `frame ${f}`);
      assert.ok(Math.abs(Number(m[1]) - level) < 1e-12, `frame ${f}: ${m[1]} vs ${level}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scrim
// ---------------------------------------------------------------------------

describe('Scrim', () => {
  it('Scrim is one feathered gradient element centred on the block', () => {
    const size = {width: 1000, height: 600};
    const gradientBoxes = (html: string) => [...html.matchAll(/<div style="([^"]*gradient\([^"]*)"/g)].map((m) => m[1]!);
    // React writes 0 without a unit.
    const px = (style: string, prop: string) => Number(style.match(new RegExp(`(?:^|;)${prop}:(-?[\\d.]+)(?:px)?(?:;|$)`))?.[1]);

    // Radial: one box twice the block's size, centred on (cx, cy), fading to transparent.
    const radial = gradientBoxes(renderAt(() => <Scrim width={300} height={100} cx={400} cy={200} />, 0, size));
    assert.equal(radial.length, 1, 'a single backing element');
    const r = radial[0]!;
    assert.match(r, /background:radial-gradient\(/);
    assert.match(r, /transparent 100%/, 'feathered to nothing at its edge');
    assert.ok(r.includes(theme.colors.black), 'default colour from the theme');
    assert.equal(px(r, 'left') + px(r, 'width') / 2, 400);
    assert.equal(px(r, 'top') + px(r, 'height') / 2, 200);
    assert.equal(px(r, 'width'), 600);
    assert.equal(px(r, 'height'), 200);

    // Default centre is the composition's; linear is one full-width band.
    const linear = gradientBoxes(renderAt(() => <Scrim width={300} height={100} shape="linear" color="rgb(1, 2, 3)" />, 0, size));
    assert.equal(linear.length, 1);
    const l = linear[0]!;
    assert.match(l, /background:linear-gradient\(to bottom, transparent 0%/);
    assert.match(l, /transparent 100%/);
    assert.ok(l.includes('rgb(1, 2, 3)'));
    assert.equal(px(l, 'left'), 0);
    assert.equal(px(l, 'width'), 1000);
    assert.equal(px(l, 'top') + px(l, 'height') / 2, 300);
  });
});

// ---------------------------------------------------------------------------
// CircleFlood
// ---------------------------------------------------------------------------

describe('CircleFlood', () => {
  it('CircleFlood clears the farthest corner by its end frame', () => {
    // A 400x300 composition (not 1920x1080) with the source near the top-left.
    const size = {width: 400, height: 300};
    const Flood = () => (
      <Sequence from={50}>
        <CircleFlood at={100} frames={12} x={60} y={40} color="rgb(9, 8, 7)" />
      </Sequence>
    );
    const radius = (frame: number) => {
      const m = renderAt(Flood, frame, size).match(/clip-path:circle\(([\d.]+)px at 60\.0px 40\.0px\)/);
      return m ? Number(m[1]) : null;
    };
    const farthest = Math.hypot(400 - 60, 300 - 40);
    assert.equal(radius(99), null, 'nothing before `at`');
    assert.equal(radius(100), 0);
    const mid = radius(106)!;
    assert.ok(mid > 0 && mid < farthest, `mid-way radius ${mid}`);
    const end = radius(112)!;
    assert.ok(end >= farthest, `end radius ${end} clears the farthest corner (${farthest})`);
    assert.ok(end <= farthest * 1.06, `end radius ${end} comes from this composition's size`);
    assert.equal(radius(140), end, 'stays whole');
  });
});

describe('CircleFlood contractTo', () => {
  // 400x300, grows from (60, 40) over 100..112, shrinks into (300, 200) over 130..140.
  const size = {width: 400, height: 300};
  const contract = {x: 300, y: 200, at: 130, frames: 10};
  const Flood = () => (
    <Sequence from={50}>
      <CircleFlood at={100} frames={12} x={60} y={40} color="rgb(9, 8, 7)" contractTo={contract} ring={{color: 'rgb(1, 2, 3)', width: 14}} />
    </Sequence>
  );
  const circles = (frame: number) =>
    [...renderAt(Flood, frame, size).matchAll(/clip-path:circle\(([\d.]+)px at ([\d.]+)px ([\d.]+)px\)/g)].map((m) => ({r: Number(m[1]), cx: Number(m[2]), cy: Number(m[3])}));

  it('CircleFlood with contractTo shrinks to radius 0 at the target by at + frames', () => {
    const opts = {at: 100, frames: 12, x: 60, y: 40, contractTo: contract};
    assert.equal(floodGeometry(140, opts, 400, 300), null, 'nothing at at + frames');
    assert.equal(floodGeometry(150, opts, 400, 300), null, 'nor after');
    assert.deepEqual(circles(140), [], 'nothing rendered at at + frames');
    // Whole between the grow and the shrink.
    const full = Math.hypot(400 - 60, 300 - 40) * 1.05;
    const whole = floodGeometry(125, opts, 400, 300)!;
    assert.ok(Math.abs(whole.r - full) < 1e-9 && whole.cx === 60 && whole.cy === 40);
    // Shrinking: the radius falls to 0 and the centre travels to the target.
    let lastR = Infinity;
    let lastD = Infinity;
    for (let f = 130; f < 140; f++) {
      const g = floodGeometry(f, opts, 400, 300)!;
      const d = Math.hypot(g.cx - 300, g.cy - 200);
      assert.ok(g.r <= lastR && d <= lastD, `frame ${f}: r ${g.r}, distance ${d}`);
      lastR = g.r;
      lastD = d;
    }
    const lastFrame = floodGeometry(139, opts, 400, 300)!;
    assert.ok(lastFrame.r > 0, `positive just before the end (${lastFrame.r})`);
    const limit = floodGeometry(140 - 1e-9, opts, 400, 300)!;
    assert.ok(limit.r < 1e-3 && Math.hypot(limit.cx - 300, limit.cy - 200) < 1e-3, 'the radius reaches 0 at the target');
    // Rendered: the last frame's flood and ring sit near the target, the ring outside the flood.
    const [ring, flood] = circles(139);
    assert.ok(ring && flood, 'ring and flood render at 139');
    assert.ok(flood.r > 0 && ring.r >= flood.r);
    assert.ok(Math.hypot(flood.cx - 300, flood.cy - 200) < Math.hypot(60 - 300, 40 - 200) * 0.1, `centre ${flood.cx},${flood.cy} near the target`);
  });

  it('CircleFlood ring leads the edge while growing', () => {
    const [ring, flood] = circles(106);
    assert.ok(ring && flood);
    assert.equal(Math.round((ring.r - flood.r) * 10) / 10, 14, 'ring width ahead of the edge');
    assert.match(renderAt(Flood, 106, size), /background:rgb\(1, 2, 3\);clip-path:circle\([^"]*" data-flood-ring=""/, 'the ring has its own colour');
    // Without contractTo the flood stays whole (existing behaviour).
    const Plain = () => <CircleFlood at={100} frames={12} x={60} y={40} />;
    assert.match(renderAt(Plain, 200, size), /clip-path:circle/);
  });
});

// ---------------------------------------------------------------------------
// Determinism scan
// ---------------------------------------------------------------------------

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/components/motion');

/** Source with comments removed (the kit's files hold no string containing comment markers). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /\bMath\.random\b/],
  ['Date', /\bDate\b/],
  ['performance.now', /\bperformance\.now\b/],
  ['timers', /\b(setTimeout|setInterval|requestAnimationFrame)\b/],
  ['CSS @keyframes', /@keyframes/],
  ['CSS animation', /\banimation(Name|Duration|Delay|TimingFunction|IterationCount)?\s*:|\banimation-[a-z-]+\s*:|['"`]animation\s*:/],
  ['CSS transition', /\btransition(Property|Duration|Delay|TimingFunction)?\s*:|\btransition-[a-z-]+\s*:|['"`]transition\s*:/],
];

describe('motion kit determinism', () => {
  it('kit has no Math.random, Date or CSS animation', () => {
    const files = readdirSync(KIT_DIR, {recursive: true, encoding: 'utf8'}).filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length >= 12, `scanned ${files.join(', ')}`);
    // The patterns can match: each one catches its own offender.
    const offenders = [
      'const x = Math.random();',
      'const t = Date.now();',
      'performance.now()',
      'setTimeout(f, 1)',
      '@keyframes spin {}',
      "style={{animation: 'spin 1s'}}",
      "style={{transition: 'opacity 1s'}}",
    ];
    FORBIDDEN.forEach(([name, re], i) => assert.match(offenders[i]!, re, `${name} pattern`));
    for (const f of files) {
      const src = code(readFileSync(join(KIT_DIR, f), 'utf8'));
      for (const [name, re] of FORBIDDEN) assert.doesNotMatch(src, re, `${f} uses ${name}`);
    }
  });
});
