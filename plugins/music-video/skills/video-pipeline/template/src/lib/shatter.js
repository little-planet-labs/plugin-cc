// Shatter geometry: a seeded radial shard tiling of a rectangle, and each
// shard's pose after the impact. Pure ES module (no DOM, no node: imports).
// Ported from the old template's Shatter (64 shards, 16 rays x 4 rings).
import {rng as seeded} from './rng.js';

/** Radial rays and rings: 16 x 4 = 64 shards. */
export const RAYS = 16;
export const RINGS = 4;
/** Ring boundaries as fractions of the outer radius: small shards near the impact, larger ones outside. */
const RING_FRACTIONS = [0, 2 / 15, 13 / 45, 8 / 15, 1];
/** Px each drawn shard edge sits outside the shard's exact edge, so shared edges overlap and no seam shows. */
export const SHARD_OVERLAP = 0.75;

/**
 * @typedef {readonly [number, number]} Point
 * @typedef {object} Shard
 * @property {Point[]} points Quad corners: inner on ray i, outer on ray i, outer on ray i+1, inner on ray i+1.
 * @property {number} cx Centroid x (the pivot).
 * @property {number} cy Centroid y.
 * @property {number} vx Launch velocity px/s.
 * @property {number} vy Launch velocity px/s (negative is up).
 * @property {number} rot Spin rad/s.
 * @property {number} delay Seconds after the impact before it moves.
 */

/**
 * A convex polygon with every edge moved `px` outward (bevel joins). Repeated
 * consecutive vertices are dropped first.
 * @param {readonly Point[]} points
 * @param {number} px
 * @returns {Point[]}
 */
export const offsetPolygon = (points, px) => {
  const pts = points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-9;
  });
  const n = pts.length;
  if (n < 3) return [...pts];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const sign = area > 0 ? 1 : -1;
  const normal = (i) => {
    const [x0, y0] = pts[i % n];
    const [x1, y1] = pts[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    return [(sign * (y1 - y0)) / len, (-sign * (x1 - x0)) / len];
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    const before = normal(i + n - 1);
    const after = normal(i);
    out.push([x + before[0] * px, y + before[1] * px], [x + after[0] * px, y + after[1] * px]);
  }
  return out;
};

/**
 * The shard list for an impact at (x, y) on a width x height rect, built only
 * from the seed: 16 rays at i/16 of a turn plus a seeded jitter, cut by 4 rings
 * whose shared vertices are jittered 0.9..1.1 (so shards tile with no gaps).
 * The outer radius reaches past the farthest corner divided by cos(half the
 * widest ray gap), plus 2%: every outer edge is a chord that still clears that
 * corner, so at the impact the shards cover the whole rect.
 * @param {{x: number, y: number, width: number, height: number, seed?: string | number}} options
 * @returns {Shard[]}
 */
export const buildShards = ({x, y, width, height, seed = 'shatter'}) => {
  const r = seeded(seed);
  const angles = Array.from({length: RAYS}, (_, i) => (i / RAYS) * 2 * Math.PI + (r() - 0.5) * 0.25);
  let widest = 0;
  for (let i = 0; i < RAYS; i++) {
    const a1 = i === RAYS - 1 ? angles[0] + 2 * Math.PI : angles[i + 1];
    widest = Math.max(widest, a1 - angles[i]);
  }
  const far = Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y));
  const outer = (far / Math.cos(widest / 2)) * 1.02;
  const jitter = Array.from({length: RAYS}, () => Array.from({length: RINGS + 1}, (_, j) => (j === 0 || j === RINGS ? 1 : 0.9 + 0.2 * r())));
  const vertex = (i, j) => {
    const a = i === RAYS ? angles[0] + 2 * Math.PI : angles[i];
    const rad = RING_FRACTIONS[j] * outer * jitter[i % RAYS][j];
    return [x + Math.cos(a) * rad, y + Math.sin(a) * rad];
  };
  const lift = 200 * (height / 1080);
  const shards = [];
  for (let i = 0; i < RAYS; i++) {
    for (let j = 0; j < RINGS; j++) {
      const points = [vertex(i, j), vertex(i, j + 1), vertex(i + 1, j + 1), vertex(i + 1, j)];
      const cx = points.reduce((s, p) => s + p[0], 0) / 4;
      const cy = points.reduce((s, p) => s + p[1], 0) / 4;
      const speed = 1.2 + r();
      shards.push({points, cx, cy, vx: (cx - x) * speed, vy: (cy - y) * speed - lift, rot: (r() - 0.5) * 5, delay: r() * 0.12});
    }
  }
  return shards;
};

/**
 * A shard's offset and spin `u` seconds after the impact: at rest until its
 * delay, then (vx v, vy v + g v^2) and rot * v around its centroid, with
 * gravity g = 900 px/s^2 scaled by height / 1080.
 * @param {Shard} s
 * @param {number} u
 * @param {number} height
 * @returns {{dx: number, dy: number, angle: number}}
 */
export const shardPose = (s, u, height) => {
  const v = Math.max(0, u - s.delay);
  const g = 900 * (height / 1080);
  return {dx: s.vx * v, dy: s.vy * v + g * v * v, angle: s.rot * v};
};

/**
 * Whether point (px, py) lies inside a convex polygon (edges included).
 * @param {readonly Point[]} poly
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
export const insideConvex = (poly, px, py) => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const c = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
};
