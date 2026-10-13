import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  parseSections,
  placeSections,
  sectionsWithinDuration,
  WHOLE_SONG_SECTION,
  withWholeSongSection,
} from '../src/lib/sections.js';
import {beatFramesBetween, downbeatFramesBetween} from '../src/lib/timing.js';
import {gridAnalysis} from './fixtures/data-grid.mjs';

const FPS = 30;

/** Asserts `placed` covers [0, total) frame by frame: starts at 0, each ends where the next begins, last ends at total. */
const assertTiles = (placed, total) => {
  assert.ok(placed.length > 0);
  assert.equal(placed[0]?.from, 0);
  placed.forEach((s, i) => {
    assert.ok(Number.isInteger(s.from) && Number.isInteger(s.durationInFrames), `${s.id} integral`);
    assert.ok(s.durationInFrames > 0, `${s.id} non-empty`);
    assert.equal(s.to, s.from + s.durationInFrames, `${s.id} to = from + durationInFrames`);
    const next = placed[i + 1];
    assert.equal(s.to, next ? next.from : total, `${s.id} ends where the next starts`);
  });
  const covered = placed.reduce((n, s) => n + s.durationInFrames, 0);
  assert.equal(covered, total);
  // Every frame belongs to exactly one section.
  for (let f = 0; f < total; f++) {
    assert.equal(placed.filter((s) => s.from <= f && f < s.to).length, 1, `frame ${f} in exactly one section`);
  }
};

const spec = (id, start, scene = 'instrumental') => ({id, scene, start});

describe('placeSections', () => {
  it('placeSections tiles [0, durationInFrames) with no gaps or overlaps', () => {
    const fixtures = [
      {specs: [spec('a', 0)], fps: FPS, total: 90},
      {specs: [spec('a', 0), spec('b', 1), spec('c', 2.5)], fps: FPS, total: 120},
      // Non-integer frame starts: 0.517s * 30 = 15.51 -> 16, 1.249s -> 37.47 -> 37, 2.0166s -> 60.5 -> 61.
      {specs: [spec('a', 0), spec('b', 0.517), spec('c', 1.249), spec('d', 2.0166)], fps: FPS, total: 75},
      // Other fps.
      {specs: [spec('a', 0), spec('b', 0.333), spec('c', 7.77)], fps: 24, total: 200},
      // A last section one frame long.
      {specs: [spec('a', 0), spec('b', 3.95)], fps: FPS, total: 120},
    ];
    for (const {specs, fps, total} of fixtures) {
      const placed = placeSections(specs, fps, total);
      assertTiles(placed, total);
      placed.forEach((s, i) => assert.equal(s.from, Math.round(specs[i].start * fps)));
    }
    const placed = placeSections([spec('a', 0), spec('b', 0.517), spec('c', 1.249)], FPS, 75);
    assert.deepEqual(
      placed.map((s) => [s.from, s.to, s.durationInFrames, s.end]),
      [
        [0, 16, 16, 0.517],
        [16, 37, 21, 1.249],
        [37, 75, 38, 2.5],
      ],
    );
  });

  it('placeSections rejects a section that rounds to zero frames', () => {
    // 1.0s -> frame 30, 1.01s -> frame 30.3 -> 30: "b" has 0 frames.
    assert.throws(() => placeSections([spec('a', 0), spec('b', 1.0), spec('c', 1.01)], FPS, 120), /section "b".*0 frames/);
  });

  it('placeSections rejects no sections, and a first section off frame 0', () => {
    assert.throws(() => placeSections([], FPS, 120), /placeSections: no sections to place/);
    assert.throws(() => placeSections([spec('late-first', 0.02)], FPS, 120), /first section "late-first" must start at frame 0 \(got 1\)/);
  });

  it('placeSections rejects a section starting at or after the end, naming its id (analyzed track)', () => {
    assert.throws(() => placeSections([spec('a', 0), spec('late', 4)], FPS, 120), /section "late".*at or after the end/);
    assert.throws(() => placeSections([spec('a', 0), spec('later', 5)], FPS, 120), /section "later".*at or after the end/);
    // 3.99 s rounds to frame 120 (= the end): stale, even though 3.99 s < 4 s in seconds.
    assert.throws(() => placeSections([spec('a', 0), spec('rounds-to-end', 3.99)], FPS, 120), /section "rounds-to-end"/);
    // Just inside is fine.
    assertTiles(placeSections([spec('a', 0), spec('ok', 3.95)], FPS, 120), 120);
  });

  it('on fallback timing, sectionsWithinDuration drops sections at or after the end and the rest tile', () => {
    const specs = [spec('a', 0), spec('b', 3.95), spec('c', 4), spec('d', 9)];
    const kept = sectionsWithinDuration(specs, FPS, 120);
    assert.deepEqual(
      kept.map((s) => s.id),
      ['a', 'b'],
    );
    assertTiles(placeSections(kept, FPS, 120), 120);
    // The whole-song default on the 60 s fallback with a sections.json written for a longer track.
    const long = [spec('intro', 0), spec('verse-1', 30), spec('chorus-1', 59.99), spec('tail', 200)];
    const fallback = placeSections(sectionsWithinDuration(long, FPS, 1800), FPS, 1800);
    assert.deepEqual(
      fallback.map((s) => s.id),
      ['intro', 'verse-1'],
    );
    assertTiles(fallback, 1800);
  });

  it('a beat on a section boundary belongs to exactly one section, by rounded frame', () => {
    // b starts at 12.0166 s -> frame 360.498 -> 360. A beat at 12.016 s is BEFORE b's start in
    // seconds but rounds to frame 360, so it belongs to b (whose range holds frame 360), not a.
    // A beat at 11.99 s (frame 359.7 -> 360) also belongs to b; 11.98 s (359.4 -> 359) to a.
    // c starts at 20.02 s -> frame 600.6 -> 601: a beat at 20.016 s (600.48 -> 600) belongs to b.
    const beats = [11.98, 11.99, 12.016, 12.5, 20.016, 20.5];
    const analysis = {...gridAnalysis({beats, downbeats: [11.98]}), durationInFrames: 900};
    const placed = placeSections([spec('a', 0), spec('b', 12.0166), spec('c', 20.02)], FPS, 900);
    assert.deepEqual(
      placed.map((s) => [s.id, s.from, s.to]),
      [
        ['a', 0, 360],
        ['b', 360, 601],
        ['c', 601, 900],
      ],
    );
    const bySection = Object.fromEntries(placed.map((s) => [s.id, beatFramesBetween(analysis, s.from, s.to, FPS)]));
    assert.deepEqual(bySection, {a: [359], b: [360, 360, 375, 600], c: [615]});
    // Each beat lands in exactly one section, the one whose [from, to) holds its rounded frame.
    for (const t of beats) {
      const f = Math.round(t * FPS);
      const owners = placed.filter((s) => beatFramesBetween({...analysis, beats: [t]}, s.from, s.to, FPS).length === 1);
      assert.equal(owners.length, 1, `beat ${t}s in exactly one section`);
      assert.ok(owners[0].from <= f && f < owners[0].to, `beat ${t}s (frame ${f}) in ${owners[0].id}`);
    }
    // Downbeats follow the same rule.
    assert.deepEqual(downbeatFramesBetween(analysis, 0, 360, FPS), [359]);
    assert.deepEqual(downbeatFramesBetween({...analysis, downbeats: [12.016]}, 360, 601, FPS), [360]);
  });
});

describe('parseSections', () => {
  const ok = [
    {id: 'a', scene: 'intro', start: 0},
    {id: 'b', scene: 'chorus', start: 2.5, variant: 'first'},
  ];
  const withEntry = (i, patch) => ok.map((s, j) => (j === i ? {...s, ...patch} : s));

  it('accepts valid sections and keeps variants', () => {
    assert.deepEqual(parseSections(ok), [
      {id: 'a', scene: 'intro', start: 0},
      {id: 'b', scene: 'chorus', start: 2.5, variant: 'first'},
    ]);
  });

  it('parseSections rejects unsorted starts / duplicate ids / empty scene / first start != 0 / non-string variant', () => {
    assert.throws(() => parseSections(withEntry(1, {start: 0})), /\[1\]\.start must be greater than \[0\]\.start/);
    assert.throws(() => parseSections([...ok, {id: 'c', scene: 'intro', start: 1}]), /\[2\]\.start must be greater/);
    assert.throws(() => parseSections(withEntry(1, {id: 'a'})), /\[1\]\.id must be unique \("a" duplicates \[0\]\.id\)/);
    assert.throws(() => parseSections(withEntry(1, {scene: ''})), /\[1\]\.scene must be a non-empty string/);
    assert.throws(() => parseSections(withEntry(1, {scene: 3})), /\[1\]\.scene must be a non-empty string \(got 3\)/);
    assert.throws(() => parseSections(withEntry(0, {start: 0.5})), /\[0\]\.start must be 0 for the first section/);
    assert.throws(() => parseSections(withEntry(1, {variant: 2})), /\[1\]\.variant must be a string/);
  });

  it('rejects empty ids, unknown keys, bad starts and an empty file', () => {
    assert.throws(() => parseSections(withEntry(1, {id: ''})), /\[1\]\.id must be a non-empty string/);
    assert.throws(() => parseSections(withEntry(1, {strat: 3})), /\[1\]\.strat must be one of/);
    assert.throws(() => parseSections(withEntry(1, {start: '2'})), /\[1\]\.start must be a number/);
    assert.throws(() => parseSections({}), /root must be an array/);
  });

  // Contract parity: the rules the cases above didn't reach, each naming its field.
  it('parseSections rejects each invalid field with an error naming it', () => {
    const cases = [
      ['entry not an object', ['intro'], /sections\.json: \[0\] must be an object/],
      ['start negative', withEntry(1, {start: -1}), /sections\.json: \[1\]\.start must be a number of seconds >= 0/],
      ['start not finite', withEntry(1, {start: Number.NaN}), /sections\.json: \[1\]\.start must be a number of seconds >= 0/],
      ['id blank', withEntry(0, {id: '   '}), /sections\.json: \[0\]\.id must be a non-empty string/],
      ['scene blank', withEntry(0, {scene: ' '}), /sections\.json: \[0\]\.scene must be a non-empty string/],
    ];
    for (const [label, input, pattern] of cases) assert.throws(() => parseSections(input), pattern, label);
  });
});

describe('empty sections.json', () => {
  it('parses [] (nothing aligned yet) and plays one whole-song section', () => {
    assert.deepEqual(parseSections([]), []);
    assert.deepEqual(withWholeSongSection([]), [WHOLE_SONG_SECTION]);
    assertTiles(placeSections(withWholeSongSection([]), FPS, 1800), 1800);
  });
  it('withWholeSongSection leaves real sections alone', () => {
    const specs = [spec('a', 0), spec('b', 2)];
    assert.equal(withWholeSongSection(specs), specs);
  });
  it('accepts any non-empty scene key (the registry decides what plays)', () => {
    assert.deepEqual(parseSections([{id: 'a', scene: 'postChorus', start: 0}]), [{id: 'a', scene: 'postChorus', start: 0}]);
  });
});
