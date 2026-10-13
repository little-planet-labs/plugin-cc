// `pnpm still-test` on the real engine (Chromium), word by word: a correct
// page passes with every word whose own hold window has 2+ frames checked (so
// it can't pass by checking nothing), the shorter windows listed as skipped
// and the words whose exit starts before they settle listed apart; a scene
// that moves a held word by 0.25 px, fades a held line by 1/255, moves the
// held first word of a line that has no line-wide hold, or keeps a line blank
// at the start of its hold and draws it later, is reported by line and word
// and exits 1; a paired line entering during a line's hold, or a neighbouring
// word entering or leaving, doesn't count against a word (each word is
// isolated); and the frames compared are exactly the window's: the first
// differing frame is the frame the motion starts on.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../../scripts/lib/env.mjs';
import {main as stillTestMain, parseStillTestArgs, stillTest} from '../../scripts/still-test.mjs';
import {freshDir, quiet} from '../fixtures/cli-fakes.mjs';
import {captureEnvMissing, line, makeProject, probe} from '../fixtures/engine-project.mjs';
import {MOTION} from '../fixtures/qa-scenes/held-motion.js';

const FRAMES = 480;
const missing = captureEnvMissing();
const MOTION_SCENES = 'tests/fixtures/qa-scenes/held-motion.js';
const STILL_SCENES = 'tests/fixtures/qa-scenes/held-still.js';

describe('still-test on the engine', {skip: missing ?? false}, () => {
  let proj;
  let schedule;
  before(async () => {
    proj = makeProject({
      pipeline: {fallbackSeconds: 16},
      sections: [{id: 's', scene: 'held', start: 0}],
      lyrics: [
        line('s-1', 'Still words stay', 0.3, 1.0),
        line('m-1', 'Moving words here', 2.6, 3.3),
        line('o-1', 'Fading words now', 5.0, 5.7),
        // Shown together: p-2 enters while p-1 is held.
        line('p-1', 'Pair top line', 7.3, 7.6),
        line('p-2', 'Pair bottom line', 8.0, 8.4),
        // Its words leave one by one from 10.6 s, before the last one settles: no line-wide hold.
        line('w-1', 'Wide spread words here', 9.6, 11.6),
        line('b-1', 'Blank then shown', 12.9, 13.2),
        // Gone 2 frames before the next line, 0.1 s later: it never settles before its exit.
        line('q-1', 'Quick', 14.6, 14.7),
        line('r-1', 'Last line', 14.8, 15.0),
      ],
      files: Object.fromEntries([MOTION_SCENES, STILL_SCENES].map((f) => [f, readFileSync(join(PROJECT_ROOT, f), 'utf8')])),
    });
    // The page's schedule, read independently of still-test (U1's probe).
    schedule = (await probe('evalat', {root: proj.root, scenes: MOTION_SCENES, textonly: true, times: '0', js: '1'})).lines;
  });
  after(() => proj?.cleanup());

  /** Frames n with settled <= n / fps < exitStart, by scanning every frame of the video. */
  const holdFrames = (w) =>
    Array.from({length: FRAMES}, (_, n) => n).filter((n) => n / 30 >= w.settled - 1e-9 && (w.exitStart === null || n / 30 < w.exitStart - 1e-9));
  const words = () => schedule.flatMap((l) => l.words.map((w) => ({id: l.id, ...w})));
  const key = (w) => `${w.id}:${w.word ?? w.index}`;
  /** The words a MOTION entry changes: its word (or all of the line's) whose hold starts before `at` and ends at or after it. */
  const expectedMoving = () =>
    Object.entries(MOTION).flatMap(([id, m]) => {
      const at = Math.round(m.at * 30);
      return words()
        .filter((w) => w.id === id && (m.word === undefined || w.index === m.word))
        .filter((w) => {
          const f = holdFrames(w);
          return f.length >= 2 && f[0] < at && at <= f.at(-1);
        })
        .map(key);
    });
  const run = async (argv) => {
    const tmpRoot = freshDir('tmp');
    const r = await quiet(() => stillTestMain(argv, {root: proj.root, envRoot: PROJECT_ROOT, tmpRoot}));
    assert.deepEqual(readdirSync(tmpRoot), [], 'temp dir left behind');
    return r;
  };
  /** stillTest itself (for its result), with its cleanup run and no temp dir left behind. */
  const direct = async (argv) => {
    const tmpRoot = freshDir('tmp');
    const cleanup = new Set();
    try {
      return (await quiet(() => stillTest(parseStillTestArgs(argv), cleanup, {root: proj.root, envRoot: PROJECT_ROOT, tmpRoot}))).result;
    } catch (err) {
      if (!err.result) throw err;
      return {...err.result, error: err.message};
    } finally {
      for (const fn of cleanup) fn();
      assert.deepEqual(readdirSync(tmpRoot), [], 'temp dir left behind');
    }
  };

  it("the fixture: each motion falls inside held words' windows, w-1 has no line-wide hold, p-2 enters during p-1's, q-1 never settles", () => {
    const byId = Object.fromEntries(schedule.map((l) => [l.id, l]));
    for (const id of Object.keys(MOTION)) assert.ok(expectedMoving().some((k) => k.startsWith(`${id}:`)), `${id}: its motion falls inside no held word's window`);
    const w = byId['w-1'];
    assert.ok(w.settled > w.exitStart, `w-1 has a line-level window (${w.settled} .. ${w.exitStart})`);
    assert.ok(holdFrames(w.words[0]).length >= 10, 'w-1 word 1 is held');
    const enters = Math.round(byId['p-2'].first * 30);
    const pairWord = holdFrames(byId['p-1'].words[0]);
    assert.ok(pairWord[0] < enters && enters <= pairWord.at(-1), `p-2 enters at frame ${enters}, inside p-1 word 1's hold ${pairWord[0]}-${pairWord.at(-1)}`);
    assert.ok(byId['q-1'].words[0].exitStart <= byId['q-1'].words[0].settled, 'q-1 settles before its exit');
  });

  it("still-test passes a correct engine page with every word's own hold window checked, frames exact, and the rest listed", async () => {
    const r = await direct([`--scenes=${STILL_SCENES}`]);
    assert.equal(r.error, undefined, r.error);
    const all = words();
    const held = all.filter((w) => holdFrames(w).length >= 2);
    const never = all.filter((w) => w.exitStart !== null && w.exitStart <= w.settled);
    const short = all.filter((w) => holdFrames(w).length < 2 && !never.includes(w));
    assert.ok(held.length >= 20 && never.some((w) => w.id === 'q-1'), JSON.stringify(schedule));
    assert.deepEqual(r.checked.map(key), held.map(key), "every word with a hold window of 2+ frames was checked");
    for (const c of r.checked) {
      const f = holdFrames(all.find((w) => key(w) === key(c)));
      assert.deepEqual([c.first, c.last], [f[0], f.at(-1)], `${key(c)}: hold window frames`);
      assert.deepEqual(c.frames, [f[0], f[Math.round((f.length - 1) / 2)], f.at(-1)].filter((x, i, a) => a.indexOf(x) === i), `${key(c)}: sampled first, middle, last`);
      assert.ok(c.litFirst > 100, `${key(c)}: the word is on screen (${c.litFirst} lit px)`);
      assert.equal(c.maxDiff, 0, key(c));
    }
    assert.deepEqual(r.neverSettles.map(key), never.map(key), 'words whose exit starts before they settle are listed apart');
    assert.deepEqual(r.skipped.map(key), short.map(key), 'every other word without a hold window of 2+ frames is listed as skipped');
    assert.deepEqual(r.moving, []);
    const {result, output} = await run([`--scenes=${STILL_SCENES}`, '--scale=1']);
    assert.equal(result, 0, output.join('\n'));
    assert.match(output.join('\n'), new RegExp(`lines with motion during hold: 0 \\(${held.length} word\\(s\\) checked in \\d+ line\\(s\\); ${short.length} skipped; ${never.length} never settle`));
    assert.match(output.join('\n'), /never settles before its exit: q-1 word 1 "Quick"/);
  });

  it('still-test reports a held word moved by 0.25 px and a held line faded by 1/255, by line and word, and exits 1', async () => {
    const r = await direct([`--scenes=${MOTION_SCENES}`]);
    assert.match(r.error, /word\(s\) in 4 line\(s\) changed during their hold: m-1 word 2 "words"/);
    assert.deepEqual(r.moving, ['m-1', 'o-1', 'w-1', 'b-1']);
    assert.deepEqual(r.movingWords.map(key), expectedMoving());
    const byKey = Object.fromEntries(r.checked.map((c) => [key(c), c]));
    for (const k of ['s-1:0', 's-1:1', 's-1:2', 'm-1:0', 'm-1:2', 'w-1:1', 'w-1:2', 'w-1:3']) assert.equal(byKey[k]?.maxDiff, 0, `${k} stays clean next to the moving words`);
    for (const k of Object.keys(byKey).filter((x) => x.startsWith('p-1:'))) assert.equal(byKey[k].maxDiff, 0, `${k}: p-2 entering does not count against p-1`);
    for (const k of Object.keys(byKey).filter((x) => x.startsWith('o-1:'))) assert.equal(byKey[k].maxDiff, 1, `${k}: opacity 254/255 changes the text by exactly 1 level`);
    const {result, output} = await run([`--scenes=${MOTION_SCENES}`]);
    assert.equal(result, 1);
    assert.match(output.join('\n'), /lines with motion during hold: 4 \(/);
    assert.match(output.join('\n'), /m-1 .* MOTION: word 2 "words" \(frames \d+-\d+: frame \d+ differs from \d+\)/);
  });

  it("still-test checks every word's own hold window: a held first word moved 0.25 px in a line whose line-level window is empty is reported by line and word, and exits 1", async () => {
    const r = await direct([`--scenes=${MOTION_SCENES}`, '--lines=w-1']);
    assert.match(r.error, /1 word\(s\) in 1 line\(s\) changed during their hold: w-1 word 1 "Wide"/);
    assert.deepEqual(r.movingWords.map(key), ['w-1:0']);
    assert.deepEqual(r.checked.map(key), ['w-1:0', 'w-1:1', 'w-1:2', 'w-1:3'], 'every word of the line is checked');
  });

  it('still-test reports a line that is blank on its first hold frame and visible later as motion, and exits 1', async () => {
    const r = await direct([`--scenes=${MOTION_SCENES}`, '--lines=b-1']);
    assert.match(r.error, /changed during their hold: b-1 word 1 "Blank"/);
    assert.ok(r.checked.length >= 1);
    for (const c of r.checked) {
      assert.equal(c.litFirst, 0, `${key(c)} is blank on its first hold frame`);
      assert.ok(c.lit > 100 && c.maxDiff > 0, `${key(c)}: drawn later, so it changed (lit ${c.lit}, max diff ${c.maxDiff})`);
    }
    assert.deepEqual(r.skipped, []);
  });

  it('still-test compares exactly the hold frames: the first differing frame is the frame the motion starts on', async () => {
    for (const [id, m] of Object.entries(MOTION)) {
      const r = await direct([`--scenes=${MOTION_SCENES}`, `--lines=${id}`, '--samples=1000', '--scale=1']);
      const at = Math.round(m.at * 30);
      for (const k of expectedMoving().filter((x) => x.startsWith(`${id}:`))) {
        const c = r.checked.find((x) => key(x) === k);
        assert.deepEqual(c.frames, holdFrames(words().find((w) => key(w) === k)), `${k}: every frame of the window`);
        const changed = c.diffs.filter((d) => d.maxDiff > 0).map((d) => d.frame);
        assert.deepEqual(changed, c.frames.filter((f) => f >= at), `${k}: frames that differ from ${c.frames[0]}`);
      }
    }
  });
});
