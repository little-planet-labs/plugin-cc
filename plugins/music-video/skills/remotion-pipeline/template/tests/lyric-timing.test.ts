import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {getLineById, getLineState, lineWords} from '../src/lib/lyric-timing';
import type {LyricLine} from '../src/lib/lyrics-schema';

const FPS = 30;

/** Asserts words tile [start, end]: first starts at start, each ends where the next starts, last ends at end. */
const assertTilesLine = (line: LyricLine) => {
  const words = lineWords(line);
  assert.equal(words[0]?.start, line.start);
  assert.equal(words[words.length - 1]?.end, line.end);
  words.forEach((w, i) => {
    assert.ok(w.end > w.start, `${w.text} has positive length`);
    const next = words[i + 1];
    if (next) assert.equal(w.end, next.start, `${w.text} ends where ${next.text} starts`);
  });
};

describe('lineWords', () => {
  it('lineWords estimates tokens that join back to the line text and tile [start, end]', () => {
    const lines: LyricLine[] = [
      {text: 'Hello, light up the night!', start: 33.2, end: 35.1},
      {text: 'Missing something? CamelCaseWords, snap!', start: 55, end: 58.9},
      {text: 'Go!', start: 128.4, end: 129.9},
    ];
    for (const line of lines) {
      const words = lineWords(line);
      assert.equal(words.map((w) => w.text).join(' '), line.text);
      assertTilesLine(line);
    }
    assert.deepEqual(lineWords(lines[2]!), [{text: 'Go!', start: 128.4, end: 129.9}]);
    // Proportional to character count (punctuation counts): "M-C-P," is 6 chars, "go" 2 -> 3:1.
    const [a, b] = lineWords({text: 'M-C-P, go', start: 0, end: 4});
    assert.deepEqual([a?.start, a?.end, b?.start, b?.end], [0, 3, 3, 4]);
  });

  it('lineWords returns explicit words unchanged', () => {
    const words = [
      {text: 'Takes', start: 30, end: 30.4},
      {text: 'the', start: 30.5, end: 30.6},
      {text: 'sky!', start: 30.6, end: 31.5},
    ];
    const line: LyricLine = {id: 'pre-4', text: 'Takes the sky!', start: 30, end: 31.5, words};
    assert.equal(lineWords(line), words);
  });

  it('gives no words for blank text', () => {
    assert.deepEqual(lineWords({text: '   ', start: 0, end: 1}), []);
  });
});

describe('getLineById', () => {
  const lines: LyricLine[] = [{id: 'intro-1', text: 'Lantern constellation', start: 2, end: 5}];
  it('finds a line by id', () => {
    assert.equal(getLineById(lines, 'intro-1'), lines[0]);
  });
  it('getLineById throws naming the missing id', () => {
    assert.throws(() => getLineById(lines, 'ch2-3'), /"ch2-3"/);
    assert.throws(() => getLineById([], 'intro-1'), /"intro-1"/);
  });
});

describe('getLineState', () => {
  const line: LyricLine = {
    id: 'v2-1',
    text: 'GoldenLanterns, snap!',
    start: 10,
    end: 12,
    words: [
      {text: 'GoldenLanterns,', start: 10, end: 11.2},
      {text: 'snap!', start: 11.5, end: 12},
    ],
  };
  it('reports frames, active word and progress', () => {
    const s = getLineState([line], 'v2-1', 340, FPS)!;
    assert.equal(s.startFrame, 300);
    assert.equal(s.endFrame, 360);
    assert.deepEqual(s.wordFrames, [
      {start: 300, end: 336},
      {start: 345, end: 360},
    ]);
    assert.equal(s.activeWordIndex, 0);
    assert.equal(s.progress, 40 / 60);
    assert.equal(s.isActive, true);
  });
  it('clamps before and after the line', () => {
    const before = getLineState([line], 'v2-1', 299, FPS)!;
    assert.deepEqual([before.activeWordIndex, before.progress, before.isActive], [-1, 0, false]);
    const after = getLineState([line], 'v2-1', 400, FPS)!;
    assert.deepEqual([after.activeWordIndex, after.progress, after.isActive], [1, 1, false]);
    assert.equal(getLineState([line], 'v2-1', 360, FPS)!.isActive, false); // end-exclusive
  });
  it('returns null for an unknown id', () => {
    assert.equal(getLineState([line], 'nope', 300, FPS), null);
  });
});
