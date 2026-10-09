import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import rawAnalysis from '../src/data/audio-analysis.json';
import rawSections from '../src/data/sections.json';
import {parseAudioAnalysis} from '../src/lib/analysis-schema';
import {
  parseSections,
  placeSections,
  sectionsWithinDuration,
  WHOLE_SONG_SECTION,
  withWholeSongSection,
  type PlacedSection,
  type SectionSpec,
} from '../src/lib/sections';

const FPS = 30;

/** Asserts `placed` covers [0, total) frame by frame: starts at 0, each ends where the next begins, last ends at total. */
const assertTiles = (placed: readonly PlacedSection[], total: number) => {
  assert.ok(placed.length > 0);
  assert.equal(placed[0]?.from, 0);
  placed.forEach((s, i) => {
    assert.ok(Number.isInteger(s.from) && Number.isInteger(s.durationInFrames), `${s.id} integral`);
    assert.ok(s.durationInFrames > 0, `${s.id} non-empty`);
    const next = placed[i + 1];
    assert.equal(s.from + s.durationInFrames, next ? next.from : total, `${s.id} ends where the next starts`);
  });
  const covered = placed.reduce((n, s) => n + s.durationInFrames, 0);
  assert.equal(covered, total);
};

const spec = (id: string, start: number, scene: SectionSpec['scene'] = 'instrumental'): SectionSpec => ({id, scene, start});

describe('placeSections', () => {
  it('placeSections tiles [0, durationInFrames) with no gaps or overlaps', () => {
    const fixtures: {specs: SectionSpec[]; fps: number; total: number}[] = [
      {specs: [spec('a', 0)], fps: FPS, total: 90},
      {specs: [spec('a', 0), spec('b', 1), spec('c', 2.5)], fps: FPS, total: 120},
      // Non-integer frame starts: 0.517s * 30 = 15.51 -> 16, 1.249s -> 37.47 -> 37, 2.0166s -> 60.5 -> 61.
      {specs: [spec('a', 0), spec('b', 0.517), spec('c', 1.249), spec('d', 2.0166)], fps: FPS, total: 75},
      // Other fps.
      {specs: [spec('a', 0), spec('b', 0.333), spec('c', 7.77)], fps: 24, total: 200},
    ];
    for (const {specs, fps, total} of fixtures) {
      const placed = placeSections(specs, fps, total);
      assertTiles(placed, total);
      placed.forEach((s, i) => assert.equal(s.from, Math.round((specs[i] as SectionSpec).start * fps)));
    }
    const placed = placeSections([spec('a', 0), spec('b', 0.517), spec('c', 1.249)], FPS, 75);
    assert.deepEqual(
      placed.map((s) => [s.from, s.durationInFrames, s.end]),
      [
        [0, 16, 0.517],
        [16, 21, 1.249],
        [37, 38, 2.5],
      ],
    );
  });

  it('placeSections rejects a section that rounds to zero frames', () => {
    // 1.0s -> frame 30, 1.01s -> frame 30.3 -> 30: "b" has 0 frames.
    assert.throws(() => placeSections([spec('a', 0), spec('b', 1.0), spec('c', 1.01)], FPS, 120), /section "b".*0 frames/);
  });

  it('placeSections rejects a section starting at or after the end', () => {
    assert.throws(() => placeSections([spec('a', 0), spec('late', 4)], FPS, 120), /section "late".*at or after the end/);
    assert.throws(() => placeSections([spec('a', 0), spec('later', 5)], FPS, 120), /section "later".*at or after the end/);
    // Just inside is fine.
    assertTiles(placeSections([spec('a', 0), spec('ok', 3.95)], FPS, 120), 120);
  });

  it('sectionsWithinDuration drops only sections starting at or after the end', () => {
    const specs = [spec('a', 0), spec('b', 3.95), spec('c', 4), spec('d', 9)];
    assert.deepEqual(
      sectionsWithinDuration(specs, FPS, 120).map((s) => s.id),
      ['a', 'b'],
    );
  });
});

describe('parseSections', () => {
  const ok = [
    {id: 'a', scene: 'intro', start: 0},
    {id: 'b', scene: 'chorus', start: 2.5, variant: 'first'},
  ];
  const withEntry = (i: number, patch: Record<string, unknown>) =>
    ok.map((s, j) => (j === i ? {...s, ...patch} : s));

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

describe('committed data', () => {
  it('the committed sections.json parses and places against the analyzed duration', (t) => {
    const analysis = parseAudioAnalysis(rawAnalysis);
    if (analysis.source === null) {
      t.skip('no analyzed track (audio-analysis.json is the no-track default)');
      return;
    }
    const specs = withWholeSongSection(parseSections(rawSections));
    const placed = placeSections(specs, analysis.fps, analysis.durationInFrames);
    assertTiles(placed, analysis.durationInFrames);
  });
});
