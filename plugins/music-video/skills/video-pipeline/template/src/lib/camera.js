// World camera maths: keyframed moves with zoom interpolated in log space, and
// a settle that lands on exactly 1. Pure ES module (no DOM, no node: imports).
// The camera moves the world layer only, never the lyric layer. Keyframe
// format and log-space zoom are ported from the howseen-ai/claude-motion-design
// engine (MIT, see NOTICE.md).
import {ease as easeOf, EASE} from './ease.js';

/**
 * @typedef {[number, number, number, number]} CameraKey [t seconds, zoom (> 0), x px, y px]
 * @typedef {{zoom: number, x: number, y: number}} CameraState
 */

/**
 * Validate camera keys: at least one, times strictly ascending, zoom > 0.
 * @param {readonly CameraKey[]} keys
 * @returns {readonly CameraKey[]}
 */
export const validateCameraKeys = (keys) => {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('camera: keys must be a non-empty array of [t, zoom, x, y]');
  keys.forEach((k, i) => {
    if (!Array.isArray(k) || k.length !== 4 || k.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`camera: keys[${i}] must be [t, zoom, x, y] numbers`);
    }
    if (!(k[1] > 0)) throw new Error(`camera: keys[${i}] zoom must be > 0 (got ${k[1]})`);
    if (i > 0 && !(k[0] > keys[i - 1][0])) throw new Error(`camera: keys[${i}] time must be after keys[${i - 1}]`);
  });
  return keys;
};

/**
 * The camera at t: before the first key it holds the first, after the last it
 * holds the last; between keys each segment is eased (default 'io'), x and y
 * linearly and zoom in log space, so a push-in reads as constant speed.
 * @param {readonly CameraKey[]} keys
 * @param {number} t
 * @param {string | ((u: number) => number)} [e]
 * @returns {CameraState}
 */
export const cameraAt = (keys, t, e) => {
  const fn = easeOf(e);
  const first = keys[0];
  if (t <= first[0]) return {zoom: first[1], x: first[2], y: first[3]};
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t < b[0]) {
      const u = fn((t - a[0]) / (b[0] - a[0]));
      return {
        zoom: Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * u),
        x: a[2] + (b[2] - a[2]) * u,
        y: a[3] + (b[3] - a[3]) * u,
      };
    }
  }
  const last = keys[keys.length - 1];
  return {zoom: last[1], x: last[2], y: last[3]};
};

/**
 * Zoom from z0 at t0 to z1 at t1 in log space (clamped outside the range).
 * @param {number} t
 * @param {number} t0
 * @param {number} t1
 * @param {number} z0
 * @param {number} z1
 * @param {string | ((u: number) => number)} [e] Default 'cam'.
 * @returns {number}
 */
export const logZoom = (t, t0, t1, z0, z1, e = EASE.cam) => {
  if (t <= t0 || t1 <= t0) return t >= t1 ? z1 : z0;
  if (t >= t1) return z1;
  const u = easeOf(e)((t - t0) / (t1 - t0));
  return Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * u);
};

/**
 * A shot's settle: z0 up to t0, then a log-space ease to EXACTLY 1 at t1 and
 * after (default ease 'enter': fast start, soft landing).
 * @param {number} t
 * @param {number} t0
 * @param {number} t1
 * @param {number} [z0]
 * @param {string | ((u: number) => number)} [e]
 * @returns {number}
 */
export const settleZoom = (t, t0, t1, z0 = 1.08, e = EASE.enter) => (t >= t1 ? 1 : logZoom(t, t0, t1, z0, 1, e));

/**
 * CSS transform for a camera state on a width x height element: zoom about
 * the centre (or origin ox, oy), then offset by (x, y). The pivot is built
 * into the transform, so the element needs `transform-origin: 0 0`
 * (ctx.applyCamera sets it).
 * @param {CameraState} k
 * @param {number} width
 * @param {number} height
 * @param {number} [ox]
 * @param {number} [oy]
 * @returns {string}
 */
export const cameraTransform = (k, width, height, ox = width / 2, oy = height / 2) =>
  `translate(${(ox + k.x).toFixed(3)}px,${(oy + k.y).toFixed(3)}px) scale(${k.zoom.toFixed(6)}) translate(${(-ox).toFixed(3)}px,${(-oy).toFixed(3)}px)`;
