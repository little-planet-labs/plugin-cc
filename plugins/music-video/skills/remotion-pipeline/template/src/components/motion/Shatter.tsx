import type {ReactNode} from 'react';
import {AbsoluteFill, random, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {theme} from '../../theme';

export type ShardPoint = readonly [number, number];

export type Shard = {
  /** Quad corners in source px: inner edge on ray i, outer on ray i, outer on ray i+1, inner on ray i+1. */
  points: readonly ShardPoint[];
  /** Centroid (mean of the corners), the shard's pivot. */
  cx: number;
  cy: number;
  /** Launch velocity in px per second (before gravity). */
  vx: number;
  vy: number;
  /** Spin in radians per second. */
  rot: number;
  /** Seconds after the impact before this shard moves. */
  delay: number;
};

export type ShardOptions = {
  /** Impact point in source px. */
  x: number;
  y: number;
  /** Source rect size in px (the rect is [0, width] x [0, height]). */
  width: number;
  height: number;
  /** Seed string for Remotion random(). Default 'shatter'. */
  seed?: string;
};

/** Radial rays and rings: 16 x 4 = 64 shards. */
const RAYS = 16;
const RINGS = 4;
/** Ring boundaries as fractions of the outer radius: small shards near the impact, larger ones outside. */
const RING_FRACTIONS = [0, 2 / 15, 13 / 45, 8 / 15, 1] as const;
/** Px each drawn shard edge sits outside the shard's exact edge, so neighbours sharing an edge overlap by twice this and no anti-aliased seam shows. */
export const SHARD_OVERLAP = 0.75;

/**
 * A convex polygon with every edge moved `px` outward, perpendicular to itself
 * (bevel joins: each corner becomes two points, one on each moved edge, so
 * even a sharp corner moves only `px`). Repeated consecutive vertices (the
 * shared centre point of the innermost ring's triangles) are dropped first.
 * Drawn edge k is original edge k shifted by px along its outward normal.
 */
export const offsetPolygon = (points: readonly ShardPoint[], px: number): ShardPoint[] => {
  const pts = points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length] as ShardPoint;
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-9;
  });
  const n = pts.length;
  if (n < 3) return [...pts];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i] as ShardPoint;
    const [x1, y1] = pts[(i + 1) % n] as ShardPoint;
    area += x0 * y1 - x1 * y0;
  }
  const sign = area > 0 ? 1 : -1;
  // Outward unit normal of edge i (pts[i] -> pts[i + 1]).
  const normal = (i: number): ShardPoint => {
    const [x0, y0] = pts[i % n] as ShardPoint;
    const [x1, y1] = pts[(i + 1) % n] as ShardPoint;
    const len = Math.hypot(x1 - x0, y1 - y0);
    return [(sign * (y1 - y0)) / len, (-sign * (x1 - x0)) / len];
  };
  const out: ShardPoint[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i] as ShardPoint;
    const before = normal(i + n - 1);
    const after = normal(i);
    out.push([x + before[0] * px, y + before[1] * px], [x + after[0] * px, y + after[1] * px]);
  }
  return out;
};

/**
 * The shard list for an impact, built purely from the seed (Remotion random):
 * 16 rays at i/16 of a turn plus a seeded jitter of (r - 0.5) * 0.25 rad, cut by
 * 4 rings. Ray i and ring boundary j share one jittered vertex (0.9..1.1 of the
 * ring radius; the centre and the outer boundary are not jittered), so the
 * shards tile the fan with no gaps. The outer radius is the distance to the
 * source rect's farthest corner divided by cos(half the widest ray gap), plus
 * 2%: every outer edge is a chord, and its nearest point still clears that
 * corner, so at impact the shards cover the whole rect.
 *
 * Per shard: velocity (centroid - impact) * (1.2 + r) per second with vy lifted
 * by 200 px/s, spin (r - 0.5) * 5 rad/s, delay r * 0.12 s. The 200 px/s lift
 * scales with height / 1080.
 */
export const buildShards = ({x, y, width, height, seed = 'shatter'}: ShardOptions): Shard[] => {
  const rnd = (key: string) => random(`${seed}-${key}`);
  const angles = Array.from({length: RAYS}, (_, i) => (i / RAYS) * 2 * Math.PI + (rnd(`ray-${i}`) - 0.5) * 0.25);
  let widest = 0;
  for (let i = 0; i < RAYS; i++) {
    const a0 = angles[i] as number;
    const a1 = i === RAYS - 1 ? (angles[0] as number) + 2 * Math.PI : (angles[i + 1] as number);
    widest = Math.max(widest, a1 - a0);
  }
  const far = Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y));
  const outer = (far / Math.cos(widest / 2)) * 1.02;
  const radius = (i: number, j: number): number => {
    const base = (RING_FRACTIONS[j] as number) * outer;
    if (j === 0 || j === RINGS) return base;
    return base * (0.9 + 0.2 * rnd(`ring-${i % RAYS}-${j}`));
  };
  const vertex = (i: number, j: number): ShardPoint => {
    const a = i === RAYS ? (angles[0] as number) + 2 * Math.PI : (angles[i] as number);
    const r = radius(i % RAYS, j);
    return [x + Math.cos(a) * r, y + Math.sin(a) * r];
  };
  const lift = 200 * (height / 1080);
  const shards: Shard[] = [];
  for (let i = 0; i < RAYS; i++) {
    for (let j = 0; j < RINGS; j++) {
      const points = [vertex(i, j), vertex(i, j + 1), vertex(i + 1, j + 1), vertex(i + 1, j)];
      const cx = points.reduce((s, p) => s + p[0], 0) / 4;
      const cy = points.reduce((s, p) => s + p[1], 0) / 4;
      const k = `shard-${i}-${j}`;
      const speed = 1.2 + rnd(`${k}-v`);
      shards.push({
        points,
        cx,
        cy,
        vx: (cx - x) * speed,
        vy: (cy - y) * speed - lift,
        rot: (rnd(`${k}-rot`) - 0.5) * 5,
        delay: rnd(`${k}-delay`) * 0.12,
      });
    }
  }
  return shards;
};

export type ShatterProps = {
  /** ABSOLUTE song frame of the impact. Before it the children render whole. */
  at: number;
  /** Impact point in composition px. Default: the centre. */
  x?: number;
  y?: number;
  /** Seed for the shard pattern. Default 'shatter'. */
  seed?: string;
  /** Flash colour over the frame at the impact. Default theme.colors.flash. */
  flash?: string;
  /** Peak flash opacity, decaying as e^(-8u) over seconds u since the impact. Default 0.6; 0 turns it off. */
  flashPeak?: number;
  /** WORLD content to break (a shot, a backdrop). Never the lyric. */
  children?: ReactNode;
};

/**
 * Breaks world content at an impact: 64 shards (buildShards), each a copy of the
 * children clipped to its polygon with CSS clip-path, flying out from the impact
 * point. Every drawn shard edge sits SHARD_OVERLAP (0.75) px outside the
 * shard's exact edge (offsetPolygon), so two shards sharing an edge overlap by
 * 1.5 px across it and the impact frame shows no seams (the overlapping copies
 * are identical there). buildShards stays the exact tiling. A shard at u
 * seconds after its delay sits at its rest position plus
 * (vx u, vy u + 900 u^2) and spins by rot * u around its centroid (gravity 900
 * px/s^2 scaled by height / 1080). A flash of `flash` at flashPeak * e^(-8u)
 * covers the frame. Sizes come from the composition. Shards entirely outside
 * the frame stop rendering; the children render once per visible shard, so keep
 * them cheap while it plays. What the shards uncover is whatever sits below
 * Shatter inside WorldLayer.
 */
export const Shatter = ({at, x, y, seed = 'shatter', flash = theme.colors.flash, flashPeak = 0.6, children}: ShatterProps) => {
  const frame = useSongFrame();
  const {width, height, fps} = useVideoConfig();
  if (frame < at) return <>{children}</>;
  const ix = x ?? width / 2;
  const iy = y ?? height / 2;
  const shards = buildShards({x: ix, y: iy, width, height, seed});
  const u = (frame - at) / fps;
  const gravity = 900 * (height / 1080);
  const flashOpacity = flashPeak * Math.exp(-8 * u);
  return (
    <AbsoluteFill data-shatter="">
      {shards.map((s, k) => {
        const v = Math.max(0, u - s.delay);
        const dx = s.vx * v;
        const dy = s.vy * v + gravity * v * v;
        const angle = s.rot * v;
        // Cull a shard whose (rotated) polygon lies entirely outside the frame.
        const reach = Math.max(...s.points.map(([px, py]) => Math.hypot(px - s.cx, py - s.cy))) + SHARD_OVERLAP;
        const cx = s.cx + dx;
        const cy = s.cy + dy;
        if (cx + reach < 0 || cx - reach > width || cy + reach < 0 || cy - reach > height) return null;
        const polygon = `polygon(${offsetPolygon(s.points, SHARD_OVERLAP)
          .map(([px, py]) => `${px.toFixed(2)}px ${py.toFixed(2)}px`)
          .join(', ')})`;
        return (
          // The shard list is fixed for a seed: its index is a stable identity.
          <AbsoluteFill
            key={`shard-${k}`}
            data-shard={k}
            style={{
              clipPath: polygon,
              transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${angle.toFixed(4)}rad)`,
              transformOrigin: `${s.cx.toFixed(2)}px ${s.cy.toFixed(2)}px`,
            }}
          >
            {children}
          </AbsoluteFill>
        );
      })}
      {flashOpacity > 0.002 ? <AbsoluteFill data-shatter-flash="" style={{background: flash, opacity: flashOpacity}} /> : null}
    </AbsoluteFill>
  );
};
