import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {findActiveLine, findActiveWordIndex, parseLyrics} from '../src/lib/lyrics-schema';

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
    const first = lines[0]!;
    assert.equal(findActiveWordIndex(first, 1.2), 0);
    assert.equal(findActiveWordIndex(first, 1.5), 1);
    assert.equal(findActiveWordIndex(lines[1]!, 3.5), -1);
  });
});
