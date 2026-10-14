// `pnpm still-test` without Chromium: its arguments, the frames it plans to
// capture (exactly each word's own hold window, sampled evenly), and the
// report and exit code, with a fake still_test.py playing the page. The real
// engine check is tests/render/qa-still-test.test.mjs.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {spreadFrames} from '../scripts/lib/qa.mjs';
import {main as stillTestMain, parseStillTestArgs, stillTestPlan} from '../scripts/still-test.mjs';
import {fakeBin, freshDir, projectRoot, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

/** A schedule line (as window.__mv.lines() gives it) from its words; the line-level fields as the engine derives them. */
const schedLine = (id, words) => {
  const exits = words.map((w) => w.exitStart).filter((t) => t !== null);
  return {
    id,
    first: 0,
    settled: Math.max(...words.map((w) => w.settled)),
    exitStart: exits.length === 0 ? null : Math.min(...exits),
    exitEnd: null,
    next: null,
    words: words.map((w, index) => ({index, text: w.text, reveal: 0, settled: w.settled, exitStart: w.exitStart, exitEnd: null})),
  };
};

describe('still-test arguments and plan', () => {
  it('parseStillTestArgs: defaults scale 2, every line, 3 samples, the project scenes; bad values', () => {
    assert.deepEqual(parseStillTestArgs([]), {scale: 2, lines: null, samples: 3, scenes: null, pipeline: 'src/pipeline.json'});
    assert.deepEqual(parseStillTestArgs(['--scale=1', '--lines', 'a-1,b-2', '--samples=5', '--scenes=tests/s.js']), {
      scale: 1,
      lines: ['a-1', 'b-2'],
      samples: 5,
      scenes: 'tests/s.js',
      pipeline: 'src/pipeline.json',
    });
    assert.throws(() => parseStillTestArgs(['--samples=1']), /--samples must be a whole number of frames, at least 2/);
    assert.throws(() => parseStillTestArgs(['--samples=2.5']), /--samples must be a whole number/);
    assert.throws(() => parseStillTestArgs(['--scale=0']), /--scale must be a number > 0/);
    assert.throws(() => parseStillTestArgs(['--lines=a,,b']), /--lines must be line ids/);
    assert.throws(() => parseStillTestArgs(['--scenes=/abs.js']), /project-relative module path/);
    assert.throws(() => parseStillTestArgs(['--frames=3']), /unexpected argument "--frames=3"/);
  });

  it('spreadFrames: first, middle and last for 3; evenly spread for more; every frame of a short window', () => {
    assert.deepEqual(spreadFrames(41, 65, 3), [41, 53, 65]);
    assert.deepEqual(spreadFrames(10, 20, 2), [10, 20]);
    assert.deepEqual(spreadFrames(0, 9, 4), [0, 3, 6, 9]);
    assert.deepEqual(spreadFrames(5, 6, 3), [5, 6]);
    assert.deepEqual(spreadFrames(5, 7, 10), [5, 6, 7]);
  });

  it("stillTestPlan checks every word over its own window ceil(settled * fps) .. ceil(exitStart * fps) - 1, even when the line-level window is empty", () => {
    // w-1: the second word settles (2.5 s) after the first starts to leave (2.0 s): no line-wide hold, but both words are held.
    const lines = [
      schedLine('w-1', [
        {text: 'one', settled: 1.0, exitStart: 2.0},
        {text: 'two', settled: 2.5, exitStart: 3.0 + 1e-12},
      ]),
      schedLine('a-5', [{text: 'end', settled: 5.5 - 1e-12, exitStart: null}]),
    ];
    assert.ok(lines[0].settled > lines[0].exitStart, 'the fixture line has no line-level window');
    const {checks, skipped, neverSettles} = stillTestPlan(lines, {fps: 30, frames: 170, samples: 3});
    assert.deepEqual(checks, [
      {id: 'w-1', word: 0, text: 'one', first: 30, last: 59, count: 30, frames: [30, 45, 59]},
      {id: 'w-1', word: 1, text: 'two', first: 75, last: 89, count: 15, frames: [75, 82, 89]},
      {id: 'a-5', word: 0, text: 'end', first: 165, last: 169, count: 5, frames: [165, 167, 169]},
    ]);
    assert.deepEqual([skipped, neverSettles], [[], []]);
  });

  it('stillTestPlan: a word whose exit starts before it settles is listed as never settling, apart from windows shorter than 2 frames', () => {
    const {checks, skipped, neverSettles} = stillTestPlan(
      [
        schedLine('q-1', [
          {text: 'late', settled: 4.12, exitStart: 3.72},
          {text: 'same', settled: 3.5, exitStart: 3.5},
          {text: 'brief', settled: 1, exitStart: 1.03},
          {text: 'between', settled: 1.01, exitStart: 1.02},
        ]),
      ],
      {fps: 30, frames: 300, samples: 3},
    );
    assert.deepEqual(checks, []);
    assert.deepEqual(neverSettles, [
      {id: 'q-1', word: 0, text: 'late', settled: 4.12, exitStart: 3.72},
      {id: 'q-1', word: 1, text: 'same', settled: 3.5, exitStart: 3.5},
    ]);
    assert.deepEqual(skipped, [
      {id: 'q-1', word: 2, text: 'brief', reason: 'hold window 30-30 is 1 frame (shorter than 2 frames)'},
      {id: 'q-1', word: 3, text: 'between', reason: 'hold window 1.010 s to 1.020 s holds no frame (shorter than 2 frames)'},
    ]);
  });
});

describe('still-test report and exit code', () => {
  const LINES = [
    schedLine('a-1', [
      {text: 'Hold', settled: 1.2, exitStart: 2.2},
      {text: 'these', settled: 1.3533333333333333, exitStart: 2.235},
    ]),
    schedLine('a-2', [
      {text: 'Next', settled: 4.12, exitStart: 3.72},
      {text: 'line', settled: 3.6, exitStart: 3.62},
    ]),
    schedLine('a-3', [
      {text: 'Last', settled: 5, exitStart: 6},
      {text: 'one', settled: 5.1, exitStart: null},
    ]),
  ];
  /**
   * A fake still_test.py: `lines` prints LINES; `check` copies the plan to
   * <dir>/plan.json and reports each word as `behaviour["<line>:<word>"]` says:
   * {move: index of the first sampled frame that differs (by `diff`, default 1),
   * lit, litFirst}, or a clean, lit word.
   */
  const fakePython = (dir, behaviour = {}, {lines = LINES, checkLines = lines} = {}) =>
    fakeBin(
      'python',
      `const info = {fps: 30, frames: 240, width: 960, height: 540, duration: 8};
if (args[1] === 'lines') { console.log(JSON.stringify({info, lines: ${JSON.stringify(lines)}})); process.exit(0); }
const plan = JSON.parse(fs.readFileSync(args[args.indexOf('--plan') + 1], 'utf8'));
fs.writeFileSync(${JSON.stringify(join(dir, 'plan.json'))}, JSON.stringify(plan));
const behaviour = ${JSON.stringify(behaviour)};
const results = plan.checks.map(({id, word, frames}) => {
  const b = behaviour[id + ':' + word] ?? {};
  const lit = b.lit ?? 500;
  const litFirst = b.litFirst ?? lit;
  const diffs = frames.slice(1).map((frame, k) => {
    const moved = b.move !== undefined && k + 1 >= b.move;
    return {frame, maxDiff: moved ? (b.diff ?? 1) : 0, changed: moved ? 7 : 0, lit};
  });
  return {id, word, frames, maxDiff: Math.max(0, ...diffs.map((d) => d.maxDiff)), changed: Math.max(0, ...diffs.map((d) => d.changed)),
    lit: Math.max(litFirst, ...diffs.map((d) => d.lit)), litFirst, diffs};
});
console.log(JSON.stringify({info, lines: ${JSON.stringify(checkLines)}, results}));`,
    );
  const project = () => {
    const p = makeProject({});
    projects.push(p);
    return p.root;
  };
  const run = async (argv, python) => {
    const tmpRoot = freshDir('tmp');
    const r = await quiet(() => stillTestMain(argv, {root: project(), envRoot: projectRoot, pythonBin: python, tmpRoot}));
    assert.deepEqual(readdirSync(tmpRoot), [], 'temp dir left behind');
    return {code: r.result, text: r.output.join('\n')};
  };

  it("still-test passes a still page with every word's own hold window checked, and lists skipped and never-settling words apart", async () => {
    const dir = freshDir('st');
    const r = await run(['--scale=1'], fakePython(dir));
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')), {
      scale: 1,
      scenes: null,
      checks: [
        {id: 'a-1', word: 0, frames: [36, 51, 65]},
        {id: 'a-1', word: 1, frames: [41, 54, 67]},
        {id: 'a-3', word: 0, frames: [150, 165, 179]},
        {id: 'a-3', word: 1, frames: [153, 196, 239]},
      ],
    });
    assert.match(r.text, /a-1 +2\/2 +0 +0\n/);
    assert.match(r.text, /a-3 +2\/2 +0 +0\n/);
    assert.match(r.text, /skipped a-2 word 2 "line": hold window 108-108 is 1 frame \(shorter than 2 frames\)/);
    assert.match(r.text, /never settles before its exit: a-2 word 1 "Next" \(settles at 4\.120 s, exit starts at 3\.720 s\)/);
    assert.match(r.text, /lines with motion during hold: 0 \(4 word\(s\) checked in 2 line\(s\); 1 skipped; 1 never settle before their exit\)/);
  });

  it('still-test reports a word that changes during its hold by line and word, and exits 1', async () => {
    const r = await run([], fakePython(freshDir('st'), {'a-3:1': {move: 2}}));
    assert.equal(r.code, 1);
    assert.match(r.text, /a-3 +2\/2 +1 +7 {2}MOTION: word 2 "one" \(frames 153-239: frame 239 differs from 153\)/);
    assert.match(r.text, /lines with motion during hold: 1 \(/);
    assert.match(r.text, /1 word\(s\) in 1 line\(s\) changed during their hold: a-3 word 2 "one"/);
  });

  it('still-test reports a line that is blank on its first hold frame and visible later as motion, and exits 1', async () => {
    const r = await run([], fakePython(freshDir('st'), {'a-1:0': {litFirst: 0, move: 1, diff: 255}}));
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /a-1 +2\/2 +255 +7 {2}MOTION: word 1 "Hold" \(frames 36-65: frame 51 differs from 36\)/);
    assert.doesNotMatch(r.text, /skipped a-1/);
    assert.match(r.text, /changed during their hold: a-1 word 1 "Hold"/);
  });

  it('still-test never passes by checking nothing: a word blank in every sampled frame is skipped, and no checked word at all exits 1', async () => {
    const blank = await run([], fakePython(freshDir('st'), {'a-1:0': {lit: 0}}));
    assert.equal(blank.code, 0, blank.text);
    assert.match(blank.text, /skipped a-1 word 1 "Hold": nothing drawn in hold frames 36-65 \(no lit pixel on the text-only page\)/);
    assert.match(blank.text, /\(3 word\(s\) checked in 2 line\(s\); 2 skipped; 1 never settle/);
    const none = await run([], fakePython(freshDir('st'), {'a-1:0': {lit: 0}, 'a-1:1': {lit: 0}, 'a-3:0': {lit: 0}, 'a-3:1': {lit: 0}}));
    assert.equal(none.code, 1);
    assert.match(none.text, /no word was checked/);
    const noHolds = await run(['--lines=a-2'], fakePython(freshDir('st')));
    assert.equal(noHolds.code, 1);
    assert.match(noHolds.text, /no word was checked/);
  });

  it('still-test --lines checks only those ids and refuses an unknown one', async () => {
    const dir = freshDir('st');
    const r = await run(['--lines=a-3', '--samples=2'], fakePython(dir));
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')).checks, [
      {id: 'a-3', word: 0, frames: [150, 179]},
      {id: 'a-3', word: 1, frames: [153, 239]},
    ]);
    const bad = await run(['--lines=a-3,zz-9'], fakePython(freshDir('st')));
    assert.equal(bad.code, 1);
    assert.match(bad.text, /--lines: no registered lyric line "zz-9" \(known: a-1, a-2, a-3\)/);
  });

  it('still-test stops when the page gives another schedule on the second load, or has no word schedules', async () => {
    const changed = [{...LINES[0], words: [{...LINES[0].words[0], settled: 1.4}, LINES[0].words[1]]}, LINES[1], LINES[2]];
    const r = await run([], fakePython(freshDir('st'), {}, {checkLines: changed}));
    assert.equal(r.code, 1);
    assert.match(r.text, /line schedule changed between two loads/);
    const old = LINES.map(({words, ...l}) => l);
    const noWords = await run([], fakePython(freshDir('st'), {}, {lines: old}));
    assert.equal(noWords.code, 1);
    assert.match(noWords.text, /has no word schedules/);
  });
});
