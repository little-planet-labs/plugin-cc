import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {getLineById, getLineState, lineWords} from '../src/lib/lyric-timing.js';
import {findActiveLine, findActiveWordIndex, parseLyrics} from '../src/lib/lyrics.js';

const FPS = 30;

const lines = parseLyrics([
  {text: 'one two', start: 1, end: 2, words: [{text: 'one', start: 1, end: 1.5}, {text: 'two', start: 1.5, end: 2}]},
  {text: 'three', start: 3, end: 4},
]);

describe('parseLyrics', () => {
  it('accepts the shipped empty array', () => {
    assert.deepEqual(parseLyrics([]), []);
  });
  it('rejects overlapping lines and bad spans', () => {
    assert.throws(() => parseLyrics([{text: 'a', start: 0, end: 2}, {text: 'b', start: 1, end: 3}]), /non-overlapping/);
    assert.throws(() => parseLyrics([{text: 'a', start: 2, end: 1}]), /end/);
    assert.throws(() => parseLyrics([{text: 'a', start: 0, end: 1, words: [{text: 'x', start: 0}]}]), /words\[0\]\.end/);
  });

  it('parseLyrics rejects duplicate ids / words outside the line span / overlapping words', () => {
    assert.throws(
      () => parseLyrics([{id: 'v1-1', text: 'a', start: 0, end: 1}, {id: 'v1-1', text: 'b', start: 1, end: 2}]),
      /\[1\]\.id "v1-1" duplicates \[0\]\.id/,
    );
    assert.throws(() => parseLyrics([{id: '', text: 'a', start: 0, end: 1}]), /\[0\]\.id must be a non-empty string/);
    assert.throws(() => parseLyrics([{id: 7, text: 'a', start: 0, end: 1}]), /\[0\]\.id must be a non-empty string/);
    // Outside the span by more than the 0.05 s tolerance, on either side.
    assert.throws(
      () => parseLyrics([{text: 'a b', start: 1, end: 2, words: [{text: 'a', start: 0.9, end: 1.5}, {text: 'b', start: 1.5, end: 2}]}]),
      /\[0\]\.words\[0\].*within the line span/,
    );
    assert.throws(
      () => parseLyrics([{text: 'a b', start: 1, end: 2, words: [{text: 'a', start: 1, end: 1.5}, {text: 'b', start: 1.5, end: 2.1}]}]),
      /\[0\]\.words\[1\].*within the line span/,
    );
    // Overlap (and therefore out of order).
    assert.throws(
      () => parseLyrics([{text: 'a b', start: 1, end: 2, words: [{text: 'a', start: 1, end: 1.6}, {text: 'b', start: 1.5, end: 2}]}]),
      /\[0\]\.words\[1\] starts at 1\.5s, before words\[0\] ends/,
    );
    assert.throws(
      () => parseLyrics([{text: 'a b', start: 1, end: 2, words: [{text: 'a', start: 1.5, end: 2}, {text: 'b', start: 1, end: 1.4}]}]),
      /\[0\]\.words\[1\] starts at 1s, before words\[0\] ends/,
    );
  });

  it('accepts ids, words within the 0.05 s tolerance, and still the old shape (no id, no words)', () => {
    assert.deepEqual(parseLyrics([{text: 'old', start: 0, end: 1}]), [{text: 'old', start: 0, end: 1}]);
    const [line] = parseLyrics([
      {id: 'pre-4', text: 'a b', start: 1, end: 2, words: [{text: 'a', start: 0.96, end: 1.5}, {text: 'b', start: 1.5, end: 2.04}]},
    ]);
    assert.equal(line?.id, 'pre-4');
    assert.equal(line?.words?.length, 2);
  });

  // Contract parity: the rules the cases above didn't reach, each naming its field.
  it('parseLyrics rejects each invalid field with an error naming it', () => {
    const cases = [
      ['root not an array', {}, /lyrics\.json: root must be an array/],
      ['line not an object', ['a'], /lyrics\.json: \[0\] must be an object/],
      ['text not a string', [{text: 3, start: 0, end: 1}], /lyrics\.json: \[0\]\.text must be a string/],
      ['start negative', [{text: 'a', start: -1, end: 1}], /lyrics\.json: \[0\]\.start must be a number >= 0/],
      ['start not finite', [{text: 'a', start: Number.POSITIVE_INFINITY, end: 1}], /lyrics\.json: \[0\]\.start must be a number >= 0/],
      ['end equal to start', [{text: 'a', start: 1, end: 1}], /lyrics\.json: \[0\]\.end must be a number > start/],
      ['words not an array', [{text: 'a', start: 0, end: 1, words: {}}], /lyrics\.json: \[0\]\.words must be an array/],
      ['word not an object', [{text: 'a', start: 0, end: 1, words: ['a']}], /lyrics\.json: \[0\]\.words\[0\] must be an object/],
      ['word text not a string', [{text: 'a', start: 0, end: 1, words: [{text: null, start: 0, end: 1}]}], /lyrics\.json: \[0\]\.words\[0\]\.text must be a string/],
      ['second line overlaps', [{text: 'a', start: 0, end: 1}, {text: 'b', start: 0.5, end: 2}], /lyrics\.json: \[1\] starts before line 0 ends/],
    ];
    for (const [label, input, pattern] of cases) assert.throws(() => parseLyrics(input), pattern, label);
  });
});

describe('findActiveLine / findActiveWordIndex', () => {
  it('finds the line containing the time, end-exclusive', () => {
    assert.equal(findActiveLine(lines, 0.5), null);
    assert.equal(findActiveLine(lines, 1)?.index, 0);
    assert.equal(findActiveLine(lines, 2), null);
    assert.equal(findActiveLine(lines, 3.99)?.index, 1);
    assert.equal(findActiveLine([], 1), null);
  });
  it('finds the active word, -1 without word timing', () => {
    const first = lines[0];
    assert.equal(findActiveWordIndex(first, 1.2), 0);
    assert.equal(findActiveWordIndex(first, 1.5), 1);
    assert.equal(findActiveWordIndex(lines[1], 3.5), -1);
  });
});

/** Asserts words tile [start, end]: first starts at start, each ends where the next starts, last ends at end. */
const assertTilesLine = (line) => {
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
    const estimated = [
      {text: 'Hello, light up the night!', start: 33.2, end: 35.1},
      {text: 'Missing something? CamelCaseWords, snap!', start: 55, end: 58.9},
      {text: 'Go!', start: 128.4, end: 129.9},
    ];
    for (const line of estimated) {
      const words = lineWords(line);
      assert.equal(words.map((w) => w.text).join(' '), line.text);
      assertTilesLine(line);
    }
    assert.deepEqual(lineWords(estimated[2]), [{text: 'Go!', start: 128.4, end: 129.9}]);
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
    const line = {id: 'pre-4', text: 'Takes the sky!', start: 30, end: 31.5, words};
    assert.equal(lineWords(line), words);
  });

  it('gives no words for blank text', () => {
    assert.deepEqual(lineWords({text: '   ', start: 0, end: 1}), []);
  });
});

describe('getLineById', () => {
  const byId = [{id: 'intro-1', text: 'Lantern constellation', start: 2, end: 5}];
  it('finds a line by id', () => {
    assert.equal(getLineById(byId, 'intro-1'), byId[0]);
  });
  it('getLineById throws naming the missing id', () => {
    assert.throws(() => getLineById(byId, 'ch2-3'), /"ch2-3"/);
    assert.throws(() => getLineById([], 'intro-1'), /"intro-1"/);
  });
});

describe('getLineState', () => {
  const line = {
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
    const s = getLineState([line], 'v2-1', 340, FPS);
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
    const before = getLineState([line], 'v2-1', 299, FPS);
    assert.deepEqual([before.activeWordIndex, before.progress, before.isActive], [-1, 0, false]);
    const after = getLineState([line], 'v2-1', 400, FPS);
    assert.deepEqual([after.activeWordIndex, after.progress, after.isActive], [1, 1, false]);
    assert.equal(getLineState([line], 'v2-1', 360, FPS).isActive, false); // end-exclusive
  });
  it('returns null for an unknown id', () => {
    assert.equal(getLineState([line], 'nope', 300, FPS), null);
  });
});
