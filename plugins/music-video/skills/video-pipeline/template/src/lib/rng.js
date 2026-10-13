// Seeded randomness and noise: the only randomness allowed in the page.
// Pure ES module (no DOM, no node: imports). mulberry32 is the seeded PRNG the
// howseen-ai/claude-motion-design skill prescribes (MIT, see NOTICE.md); the
// integer hash and the 1D value noise come from the earlier adaptation;
// hashString is FNV-1a.

/**
 * mulberry32: a fast 32-bit PRNG. Same seed, same sequence, on every machine.
 * @param {number} seed Any number; only its low 32 bits matter.
 * @returns {() => number} Next value in [0, 1).
 */
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * FNV-1a hash of a string to an unsigned 32-bit integer.
 * @param {string} s
 * @returns {number}
 */
export const hashString = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/**
 * A PRNG seeded from any value: numbers seed directly, strings are hashed.
 * @param {number | string} seed
 * @returns {() => number}
 */
export const rng = (seed) => mulberry32(typeof seed === 'string' ? hashString(seed) : seed);

/**
 * Stateless hash of an integer (and an optional stream number) to [0, 1).
 * Use it for per-frame values: hash(frame, 3) is the same on every seek.
 * @param {number} i
 * @param {number} [s]
 * @returns {number}
 */
export const hash = (i, s = 0) => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * Smooth 1D value noise in [-1, 1]: continuous in x, the same for the same x.
 * @param {number} x
 * @param {number} [s] Stream number.
 * @returns {number}
 */
export const noise1 = (x, s = 0) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, s);
  return (a + (hash(i + 1, s) - a) * u) * 2 - 1;
};

/**
 * Three octaves of noise1, roughly in [-1, 1].
 * @param {number} x
 * @param {number} [s]
 * @returns {number}
 */
export const fbm = (x, s = 0) => noise1(x, s) * 0.6 + noise1(x * 2.1, s + 7) * 0.28 + noise1(x * 4.3, s + 13) * 0.12;
