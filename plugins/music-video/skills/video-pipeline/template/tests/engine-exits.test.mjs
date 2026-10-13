// Exit compression: for any line, its exit ends at least 2 frames before the
// next line's first word (the line after its pair with pairWith), before
// exitBy and before the end of the video; an exit never starts before the
// word it moves was revealed; with no room the exit becomes a cut on the
// bound; short holds compress exit length and stagger. Property test over
// generated lines, plus named cases.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {DEFAULT_EXIT_DUR, exitPlan, EXIT_GAP_FRAMES, publicSchedules, scheduleLines} from '../src/lib/exits.js';
import {mulberry32} from '../src/lib/rng.js';
import {ENTRANCES, revealFrameOpacity} from '../src/lib/text-motion.js';

const EPS = 1e-9;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** n lines with sorted, non-overlapping words; gaps from 0 to 2 s (some tiny). */
const genLines = (r, n) => {
  let t = r() * 1.5;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const words = [];
    const count = 1 + Math.floor(r() * 8);
    for (let k = 0; k < count; k++) {
      const dur = 0.05 + r() * 0.5;
      words.push({text: `w${k}`, start: r3(t), end: r3(t + dur)});
      t += dur + (r() < 0.3 ? 0 : r() * 0.1);
    }
    lines.push({id: `l${i}`, text: words.map((w) => w.text).join(' '), start: words[0].start, end: words[words.length - 1].end, words});
    t += r() < 0.3 ? 0.01 + r() * 0.05 : r() * 2;
  }
  return {lines, end: t};
};

const ENTERS = ['rise', 'fade', 'slam', 'type', 'none', 'blur'];
const EXITS_ = ['fade', 'cut', 'up', 'scatter', 'suck'];

const genOptions = (r, lines, i, duration) => {
  const o = {enter: ENTERS[Math.floor(r() * ENTERS.length)], exit: EXITS_[Math.floor(r() * EXITS_.length)]};
  if (r() < 0.3) o.spring = ['snappy', 'default', 'heavy', 'playful'][Math.floor(r() * 4)];
  if (r() < 0.5) o.exitDur = r() * 0.8;
  if (r() < 0.5) o.stagger = r() * 0.1;
  const p = r();
  if (p < 0.2) o.exitAt = 'hold';
  else if (p < 0.5) o.exitAt = lines[i].start + (r() - 0.3) * 3;
  if (r() < 0.2) o.exitBy = lines[i].start + r() * 4;
  if (r() < 0.2) o.lead = r() * 0.1;
  if (r() < 0.2) o.linger = r() * 2;
  if (r() < 0.25 && lines[i + 1]) o.pairWith = lines[i + 1].id;
  return o;
};

describe('scheduleLines (property)', () => {
  it('every line clears 2 frames before the next line, exitBy and the video end, and no word leaves before it is revealed', () => {
    const r = mulberry32(17);
    let compressed = 0;
    let cuts = 0;
    let shownChecked = 0;
    for (let trial = 0; trial < 1500; trial++) {
      const fps = [24, 25, 30, 60][Math.floor(r() * 4)];
      const {lines, end} = genLines(r, 1 + Math.floor(r() * 7));
      const duration = end + r() * 3;
      const regs = new Map();
      lines.forEach((l, i) => {
        if (r() < 0.9) regs.set(l.id, genOptions(r, lines, i, duration));
      });
      const sched = scheduleLines(lines, regs, {fps, duration});
      for (const [id, s] of sched) {
        const i = lines.findIndex((l) => l.id === id);
        const opts = regs.get(id);
        const nextIndex = opts.pairWith ? i + 2 : i + 1;
        // The next line's first reveal, as the engine computes it (snapped, minus its own lead).
        const nl = lines[nextIndex];
        const next = nl ? Math.round(Math.max(0, nl.words[0].start - (regs.get(nl.id)?.lead ?? 0)) * fps) / fps : null;
        assert.equal(s.next, next, `${id}: next`);
        // Exact: no epsilon on the bound.
        if (next !== null) {
          assert.ok(s.exitEnd <= next - EXIT_GAP_FRAMES / fps, `${id}: exit ends ${s.exitEnd}, next first word ${next}`);
          assert.ok(s.exitEnd <= (Math.round(next * fps) - EXIT_GAP_FRAMES) / fps, `${id}: exit ends ${s.exitEnd}, after frame round(next*fps) - 2`);
        }
        assert.ok(s.exitEnd <= duration, `${id}: past the end`);
        if (opts.exitBy !== undefined) assert.ok(s.exitEnd <= opts.exitBy, `${id}: past exitBy`);
        // The line's bound, as the schedule computes it.
        const gap = next === null ? Infinity : Math.min(next - EXIT_GAP_FRAMES / fps, (Math.round(next * fps) - EXIT_GAP_FRAMES) / fps);
        const bound = Math.min(gap, opts.exitBy ?? Infinity, duration);
        for (const w of s.words) {
          assert.ok(w.exitEnd <= bound, `${id}/${w.text}: exitEnd ${w.exitEnd} past the bound ${bound}`);
          assert.ok(w.exitEnd <= s.exitEnd && w.exitStart <= w.exitEnd);
          // Room for the reveal frame (compared on the frame grid): the word must be on screen on that frame, for a whole frame.
          if ((w.reveal + 1 / fps) * fps <= bound * fps + 1e-6) {
            assert.ok(w.exitStart >= w.reveal - EPS, `${id}/${w.text}: exit at ${w.exitStart} before its reveal ${w.reveal}`);
            assert.ok(w.exitEnd > w.reveal + 1e-7, `${id}/${w.text}: hidden on its reveal frame (reveal ${w.reveal}, gone ${w.exitEnd})`);
            assert.ok(w.exitEnd * fps >= (w.reveal + 1 / fps) * fps - 1e-6, `${id}/${w.text}: on screen less than one frame (${w.reveal}..${w.exitEnd})`);
            shownChecked++;
          }
          if (w.exitDur > 0 && w.exitDur < (opts.exitDur ?? DEFAULT_EXIT_DUR) - EPS) compressed++;
          if (w.exitDur === 0 && opts.exit !== 'cut') cuts++;
        }
      }
    }
    assert.ok(compressed > 100, `the generator exercises compression (${compressed} compressed word exits)`);
    assert.ok(shownChecked > 5000, `reveal-frame visibility checked on ${shownChecked} words`);
    assert.ok(cuts > 50, `the generator exercises no-room cuts (${cuts})`);
  });
});

describe('exitPlan cases', () => {
  it('an exit end never passes the bound, exactly, even when floats would land a hair past it (reference chorus-1-3 case)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 20000; i++) {
      const fpsI = [24, 25, 30, 60][i % 4];
      const end = Math.round(r() * 300 * fpsI) / fpsI - 2 / fpsI;
      const reveals = [end - 1 - r(), end - 0.5 - r() * 0.4].sort((a, b) => a - b);
      const plan = exitPlan({reveals, settled: reveals.map((x) => x + 0.3), exitAt: r() < 0.5 ? Infinity : end - r() * 0.6, exitDur: r() * 0.5, stagger: r() * 0.1, end, fps: fpsI});
      for (const p of plan) assert.ok(p.end <= end, `${p.end} > ${end}`);
    }
  });

  const fps = 30;
  it('a requested exit that fits is kept as asked', () => {
    const plan = exitPlan({reveals: [1, 1.2], settled: [1.4, 1.6], exitAt: 3, exitDur: 0.3, stagger: 0.05, end: 10, fps});
    assert.deepEqual(plan.map((p) => [p.start, p.end]), [[3, 3.3], [3.05, 3.05 + 0.3]]);
  });

  it('an exit that would run into the next line is re-anchored to end on the bound, after every word settled', () => {
    const plan = exitPlan({reveals: [1, 1.2], settled: [1.4, 1.6], exitAt: Infinity, exitDur: 0.3, stagger: 0.05, end: 2.5, fps});
    assert.equal(plan[1].end, 2.5, 'the last word is gone exactly on the bound');
    assert.ok(plan.every((p) => Math.abs(p.dur - 0.3) < EPS));
    assert.ok(plan[0].start >= 1.4);
  });

  it('a short hold shrinks exit length and stagger together', () => {
    const plan = exitPlan({reveals: [1, 1.1], settled: [1.3, 1.4], exitAt: Infinity, exitDur: 0.3, stagger: 0.05, end: 1.55, fps});
    assert.ok(plan[0].dur < 0.3 && plan[0].dur >= 2 / fps - EPS);
    assert.ok(plan[1].start >= 1.4 - EPS && plan[1].start + plan[1].dur <= 1.55 + EPS);
  });

  it('with no room the line becomes a cut on the bound', () => {
    const plan = exitPlan({reveals: [1.5, 1.5], settled: [1.9, 1.9], exitAt: Infinity, exitDur: 0.3, stagger: 0.05, end: 1.5 + 1 / fps, fps});
    const E = 1.5 + 1 / fps;
    assert.deepEqual(plan, [{start: E, end: E, dur: 0}, {start: E, end: E, dur: 0}]);
  });

  it('a word revealed too late for any exit cuts on the bound while earlier words still play theirs', () => {
    const plan = exitPlan({reveals: [1, 1.5], settled: [1.4, 1.9], exitAt: Infinity, exitDur: 0.3, stagger: 0.05, end: 1.5 + 1 / fps, fps});
    assert.equal(plan[1].dur, 0);
    assert.equal(plan[1].start, 1.5 + 1 / fps);
    assert.ok(plan[0].dur > 0 && plan[0].start >= 1 + 1 / fps - EPS && plan[0].start + plan[0].dur <= 1.5 + 1 / fps + EPS);
  });

  it('a requested exit before a word is revealed is moved later, to that word', () => {
    const plan = exitPlan({reveals: [1, 2], settled: [1.3, 2.3], exitAt: 0.5, exitDur: 0.2, stagger: 0, end: 10, fps});
    assert.ok(plan.every((p) => p.start >= 2));
  });
});

describe('publicSchedules (window.__mv.lines())', () => {
  it('keeps the line fields and lists every word with the schedule scheduleLines computed for it', () => {
    const r = mulberry32(5);
    const {lines} = genLines(r, 6);
    const regs = new Map(lines.map((l, i) => [l.id, genOptions(r, lines, i, 30)]));
    const sched = scheduleLines(lines, regs, {fps: 30, duration: 30});
    const pub = publicSchedules(sched.values());
    assert.deepEqual(pub.map((l) => l.id), [...sched.keys()]);
    for (const p of pub) {
      const s = sched.get(p.id);
      const {words, ...line} = p;
      assert.deepEqual(line, {id: s.id, first: s.first, settled: s.settled, exitStart: s.exitStart, exitEnd: s.exitEnd, next: s.next});
      assert.deepEqual(
        words,
        s.words.map((w, index) => ({index, text: w.text, reveal: w.reveal, settled: w.settled, exitStart: w.exitStart, exitEnd: w.exitEnd})),
      );
      assert.equal(line.settled, Math.max(...words.map((w) => w.settled)));
      assert.equal(line.exitStart, Math.min(...words.map((w) => w.exitStart)));
    }
  });
});

describe('settle times', () => {
  it('every word settles on or after its reveal, for every entrance, at 15, 24, 30 and 60 fps', () => {
    const words = [{text: 'a', start: 1, end: 1.02}, {text: 'bb', start: 1.4, end: 1.9}, {text: 'ccc', start: 2.2, end: 2.21}];
    const lines = [{id: 'l', text: 'a bb ccc', start: 1, end: 2.21, words}];
    for (const fps of [15, 24, 30, 60]) {
      for (const enter of ENTRANCES) {
        for (const extra of [{}, {enterDur: 0.001}, {spring: 'snappy'}]) {
          const opts = {enter, ...extra};
          const s = scheduleLines(lines, new Map([['l', opts]]), {fps, duration: 10}).get('l');
          for (const w of s.words) assert.ok(w.settled >= w.reveal, `${fps}fps ${JSON.stringify(opts)} ${w.text}: settled ${w.settled} < reveal ${w.reveal}`);
          assert.ok(s.settled >= s.words[s.words.length - 1].reveal, `${fps}fps ${JSON.stringify(opts)}: the hold starts before the last word is revealed`);
        }
      }
    }
  });

  it('a slow-in easing at a high frame rate gives a near-zero opacity on the reveal frame; the default does not', () => {
    assert.ok(revealFrameOpacity({enter: 'fade', enterEase: 'qio'}, 0.5, 1 / 50) < 0.5 / 255);
    assert.ok(revealFrameOpacity({enter: 'rise'}, 0.5, 1 / 50) > 0.3);
    assert.equal(revealFrameOpacity({enter: 'none'}, 0.5, 1 / 50), 1);
  });
});

describe('scheduleLines cases', () => {
  const fps = 30;

  it('a requested cut at or before a word\'s reveal still shows every word for its reveal frame', () => {
    const lines = [
      {id: 'c', text: 'one two three', start: 1, end: 4, words: [{text: 'one', start: 1, end: 2}, {text: 'two', start: 2, end: 3}, {text: 'three', start: 3, end: 4}]},
    ];
    for (const exitAt of [0, 1, 1.5, 2, 3]) {
      for (const exit of ['cut', 'fade']) {
        for (const enter of ['rise', 'none']) {
          const opts = {exit, exitAt, enter, ...(exit === 'fade' ? {exitDur: 0.01} : {})};
          const s = scheduleLines(lines, new Map([['c', opts]]), {fps, duration: 10}).get('c');
          for (const w of s.words) {
            assert.ok(w.exitStart >= w.reveal, `${JSON.stringify(opts)} ${w.text}: exit starts ${w.exitStart} before reveal ${w.reveal}`);
            assert.ok(w.exitEnd >= w.reveal + 1 / fps, `${JSON.stringify(opts)} ${w.text}: gone at ${w.exitEnd}, before its reveal frame ends (${w.reveal + 1 / fps})`);
          }
        }
      }
    }
  });

  it('the inspector\'s repro: words at 1 s and 2 s with exit cut at 0, 1.5 or 2 keep "two" on screen on frame 60', () => {
    const lines = [{id: 'c', text: 'one two', start: 1, end: 3, words: [{text: 'one', start: 1, end: 2}, {text: 'two', start: 2, end: 3}]}];
    for (const exitAt of [0, 1.5, 2]) {
      const two = scheduleLines(lines, new Map([['c', {exit: 'cut', exitAt}]]), {fps, duration: 10}).get('c').words[1];
      assert.equal(two.reveal, 2);
      assert.ok(two.exitEnd > 2 && two.exitEnd >= 2 + 1 / fps, `exitAt ${exitAt}: "two" gone at ${two.exitEnd}`);
    }
  });

  it('a word revealed with no frame left before the bound is the only case that is never shown', () => {
    const lines = [
      {id: 'a', text: 'one two', start: 1, end: 2.1, words: [{text: 'one', start: 1, end: 2}, {text: 'two', start: 2, end: 2.1}]},
      {id: 'b', text: 'next', start: 2.0667, end: 3, words: [{text: 'next', start: 2.0667, end: 3}]},
    ];
    const s = scheduleLines(lines, new Map([['a', {}]]), {fps, duration: 10}).get('a');
    assert.ok(s.words[0].exitEnd > s.words[0].reveal, '"one" is shown');
    assert.ok(s.words[1].exitEnd <= s.words[1].reveal, '"two" (revealed on the bound frame) is not');
  });
  const L = (id, start, n, step = 0.3) => ({
    id,
    text: Array.from({length: n}, (_, k) => `w${k}`).join(' '),
    start,
    end: r3(start + n * step),
    words: Array.from({length: n}, (_, k) => ({text: `w${k}`, start: r3(start + k * step), end: r3(start + (k + 1) * step)})),
  });

  it('pairWith: the pair clears 2 frames before the line after it, and both lines exit together', () => {
    const lines = [L('a', 1, 3), L('b', 2, 3), L('c', 4, 2)];
    const s = scheduleLines(lines, new Map([['a', {pairWith: 'b'}], ['b', {}], ['c', {}]]), {fps, duration: 10});
    assert.equal(s.get('a').next, 4);
    assert.equal(s.get('b').next, 4);
    assert.ok(s.get('a').exitEnd <= 4 - 2 / fps + EPS);
    assert.ok(Math.abs(s.get('a').exitEnd - s.get('b').exitEnd) < 0.2);
  });

  it('pairWith must name the very next line', () => {
    const lines = [L('a', 1, 3), L('b', 2, 3), L('c', 4, 2)];
    assert.throws(() => scheduleLines(lines, new Map([['a', {pairWith: 'c'}]]), {fps, duration: 10}), /pairWith "c" must name the next line in lyrics\.json \("b"\)/);
  });

  it('exitBy clears the line ahead of a world event', () => {
    const lines = [L('a', 1, 3), L('b', 6, 2)];
    const s = scheduleLines(lines, new Map([['a', {exitBy: 2.5, exitAt: 'hold'}]]), {fps, duration: 10});
    assert.ok(s.get('a').exitEnd <= 2.5 + EPS);
  });

  it('reveals are word starts snapped to the frame grid, and the default exit is the last word + linger', () => {
    const lines = [L('a', 1.01, 2), L('b', 9, 1)];
    const s = scheduleLines(lines, new Map([['a', {}]]), {fps, duration: 10}).get('a');
    assert.equal(s.first, 30 / 30);
    assert.ok(Math.abs(s.exitStart - (1.61 + 1.0)) < EPS);
  });

  it('an unregistered next line still bounds the line before it', () => {
    const lines = [L('a', 1, 3), L('b', 2.2, 2)];
    const s = scheduleLines(lines, new Map([['a', {}]]), {fps, duration: 10}).get('a');
    assert.equal(s.next, 2.2);
    assert.ok(s.exitEnd <= 2.2 - 2 / fps + EPS);
  });
});
