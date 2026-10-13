// Chunk boundaries (scripts/lib/pool.mjs chunkRanges): the chunks cover
// [first, last) exactly, with no gap or overlap, in order, for assorted frame
// counts and chunk sizes, including a range shorter than one chunk.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {chunkRanges} from '../scripts/lib/pool.mjs';

describe('chunk partition', () => {
  const cases = [
    [0, 7879, 600],
    [0, 120, 15],
    [0, 121, 15],
    [0, 119, 15],
    [300, 450, 600], // fewer frames than one chunk
    [5, 6, 600], // a single frame
    [0, 7, 1],
    [17, 1000, 333],
    [0, 60, 59],
    [0, 60, 61],
  ];
  for (const [first, last, size] of cases) {
    it(`[${first}, ${last}) in chunks of ~${size} frames: contiguous, no gap, no overlap, sizes within one frame`, () => {
      const chunks = chunkRanges(first, last, size);
      assert.equal(chunks.length, Math.ceil((last - first) / size));
      assert.equal(chunks[0].from, first);
      assert.equal(chunks.at(-1).to, last);
      chunks.forEach((c, k) => {
        assert.equal(c.index, k);
        assert.ok(c.to > c.from, `chunk ${k} is empty`);
        assert.ok(c.to - c.from <= size, `chunk ${k} is longer than ${size}`);
        if (k > 0) assert.equal(c.from, chunks[k - 1].to, `gap or overlap before chunk ${k}`);
      });
      // Every frame in exactly one chunk.
      const covered = chunks.flatMap((c) => Array.from({length: c.to - c.from}, (_, i) => c.from + i));
      assert.deepEqual(covered, Array.from({length: last - first}, (_, i) => first + i));
      const lengths = chunks.map((c) => c.to - c.from);
      assert.ok(Math.max(...lengths) - Math.min(...lengths) <= 1);
    });
  }

  it('refuses an empty or reversed range and a chunk under one frame', () => {
    assert.throws(() => chunkRanges(10, 10, 5), /can't chunk/);
    assert.throws(() => chunkRanges(10, 3, 5), /can't chunk/);
    assert.throws(() => chunkRanges(0, 10, 0), /at least one frame/);
  });
});
