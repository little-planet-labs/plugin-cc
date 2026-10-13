// Camera shake for world content. Pure ES module (no DOM, no node: imports).
import {hashString, noise1} from './rng.js';

/**
 * @typedef {object} ShakeOptions
 * @property {number} at Seconds: the impact.
 * @property {number} [amp] Peak offset in px. Default 14.
 * @property {number} [dur] Seconds until the shake is exactly 0. Default 0.45.
 * @property {number} [freq] Wobbles per second. Default 16.
 * @property {number} [rot] Peak rotation in degrees. Default 0.
 * @property {string | number} [seed] Default 'shake'.
 *
 * @typedef {{x: number, y: number, r: number}} ShakeOffset
 */

const ZERO = Object.freeze({x: 0, y: 0, r: 0});

/**
 * The shake offset at t: exactly {0, 0, 0} before `at` and from `at + dur` on;
 * in between seeded smooth noise under a (1 - u)^3 envelope, so it decays to 0
 * without a step. Several impacts: add the offsets of each.
 * @param {number} t
 * @param {ShakeOptions} options
 * @returns {ShakeOffset}
 */
export const shakeOffset = (t, {at, amp = 14, dur = 0.45, freq = 16, rot = 0, seed = 'shake'}) => {
  if (!(dur > 0) || t < at || t >= at + dur) return ZERO;
  const u = (t - at) / dur;
  const env = (1 - u) ** 3;
  const s = typeof seed === 'number' ? seed : hashString(String(seed));
  const x = (t - at) * freq;
  return {x: amp * env * noise1(x, s % 9973), y: amp * env * noise1(x, (s % 9973) + 31), r: rot * env * noise1(x, (s % 9973) + 57)};
};
