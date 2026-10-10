// A world-only shot list on absolute song frames. Shot i plays from `from` until
// the next shot's `from`. A shot's `in` transition runs over the frames BEFORE
// its `from`, with both shots rendered live, so the transition lands exactly on
// the impact frame and the incoming shot is whole (and already moving) from it.
import type {ComponentType, CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, interpolate, useVideoConfig} from 'remotion';
import {useSongFrame} from '../../lib/hooks';
import {clamp01} from '../../lib/motion';
import {theme} from '../../theme';
import {EASE_CAM} from './springs';

export type TransitionSpec =
  /** Hard cut on `from`. */
  | {kind: 'cut'}
  /** A straight edge sweeping across at `angle` degrees (0 = left to right), with an optional coloured blade (`edge`, `edgeWidth` px) on it. */
  | {kind: 'wipe'; frames: number; angle?: number; edge?: string; edgeWidth?: number; glow?: boolean}
  /** A slanted edge (horizontal run `slope` x width over the frame's height, default 0.35) sweeping left to right, or right to left with dir 'left'. */
  | {kind: 'diagonal'; frames: number; slope?: number; dir?: 'right' | 'left'}
  /** `count` horizontal bars (5..9, default 7), or vertical ones, each starting `stagger` seconds after the last (default 0.035 s); all finish on `from`. */
  | {kind: 'bars'; frames: number; count?: number; stagger?: number; vertical?: boolean}
  /** Circle flood from (cx, cy) until it clears the farthest corner; an optional colour ring leads it. */
  | {kind: 'iris'; frames: number; cx?: number; cy?: number; color?: string}
  /** Zoom-through: the camera flies into (cx, cy) of the outgoing shot, the incoming settles from slightly small. */
  | {kind: 'zoom'; frames: number; cx?: number; cy?: number}
  /** Whip pan: both shots slide, with a blur that peaks mid-move. */
  | {kind: 'whip'; frames: number; dir?: 'left' | 'right' | 'up' | 'down'; blur?: number}
  /** Coloured bars slice across, the next shot follows a few frames behind. Colours default to primary, accent, accentAlt. */
  | {kind: 'slices'; frames: number; count?: number; colors?: readonly string[]; vertical?: boolean}
  /** The outgoing shot splits along the middle and the halves fly apart. */
  | {kind: 'split'; frames: number; vertical?: boolean}
  /** Crossfade through a coloured glow (plain opacity) that peaks mid-transition, never on `from`. Colour defaults to theme.colors.flash. */
  | {kind: 'burn'; frames: number; color?: string; peak?: number};

/** What a shot component receives: its own window in ABSOLUTE song frames. */
export type ShotProps = {
  /** Frame the shot first renders: its transition start, or `from` without one. Start a useShotCamera settle here. */
  start: number;
  /** Frame the shot is whole. */
  from: number;
  /** Frame the next shot is whole (or the timeline's `end`): this shot's last frame is `to - 1`. */
  to: number;
};

export type Shot = {
  id: string;
  /** ABSOLUTE song frame the shot is whole (its impact frame). */
  from: number;
  /** World content only: no lyric text. */
  Component: ComponentType<ShotProps>;
  in?: TransitionSpec;
};

/** Frames a transition runs before its shot's `from` (0 for a cut or none). */
export const transitionFrames = (t: TransitionSpec | undefined): number => (t && t.kind !== 'cut' ? Math.max(0, t.frames) : 0);

/**
 * Throws, naming the shot id, unless the shots are sorted by strictly
 * increasing `from` and every `in` transition fits inside the previous shot's
 * window (frames <= from - previous from), so at most two shots ever render.
 * The first shot's transition comes in from nothing.
 */
export const validateShots = (shots: readonly Shot[]): void => {
  shots.forEach((shot, i) => {
    if (!Number.isFinite(shot.from)) throw new Error(`ShotTimeline: shot "${shot.id}" has a non-finite from (${shot.from}).`);
    const prev = shots[i - 1];
    if (prev && shot.from <= prev.from) {
      throw new Error(`ShotTimeline: shot "${shot.id}" (from ${shot.from}) must start after "${prev.id}" (from ${prev.from}); sort the shots by from.`);
    }
    const frames = transitionFrames(shot.in);
    if (prev && frames > shot.from - prev.from) {
      throw new Error(`ShotTimeline: shot "${shot.id}" has a ${frames}-frame transition, longer than "${prev.id}" plays (${shot.from - prev.from} frames).`);
    }
  });
};

export type ShotWindow = ShotProps & {id: string};

/**
 * Each shot's window: [from, to) tiles [first.from, end) with no gap or
 * overlap, and `start` (= from - its transition's frames) is where it first
 * renders, inside the previous shot's window.
 */
export const shotWindows = (shots: readonly Shot[], end: number): ShotWindow[] => {
  validateShots(shots);
  return shots.map((shot, i) => ({
    id: shot.id,
    start: shot.from - transitionFrames(shot.in),
    from: shot.from,
    to: shots[i + 1]?.from ?? end,
  }));
};

export type ShotFrame = {
  /** Index of the shot that is whole (or, in a transition, outgoing; -1 when the first shot transitions in from nothing). */
  current: number;
  /** In a transition: the incoming shot's index and progress t in [0, 1). */
  incoming?: {index: number; t: number};
};

/**
 * What renders at `frame` (pure): the whole shot, or the outgoing and incoming
 * shots mid-transition. null before the first shot's start and from `end` on.
 */
export const shotAt = (shots: readonly Shot[], frame: number, end = Infinity): ShotFrame | null => {
  validateShots(shots);
  if (shots.length === 0 || frame >= end) return null;
  let current = -1;
  for (let i = 0; i < shots.length; i++) if ((shots[i] as Shot).from <= frame) current = i;
  const next = shots[current + 1];
  if (next) {
    const frames = transitionFrames(next.in);
    if (frames > 0 && frame >= next.from - frames) return {current, incoming: {index: current + 1, t: (frame - (next.from - frames)) / frames}};
  }
  return current < 0 ? null : {current};
};

type Size = {width: number; height: number};

/** Half-plane clip polygon: the part of a w x h frame where x cos(a) + y sin(a) <= d. */
const halfPlane = ({width: w, height: h}: Size, angleDeg: number, d: number): string => {
  const a = (angleDeg * Math.PI) / 180;
  const n = [Math.cos(a), Math.sin(a)] as const;
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const side = ([x, y]: [number, number]) => x * n[0] + y * n[1] - d;
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const p = corners[i] as [number, number];
    const q = corners[(i + 1) % 4] as [number, number];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if (sp * sq < 0) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  if (out.length < 3) return 'polygon(0 0, 0 0, 0 0)';
  return `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
};

const projRange = ({width: w, height: h}: Size, angleDeg: number) => {
  const a = (angleDeg * Math.PI) / 180;
  const vals = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => (x as number) * Math.cos(a) + (y as number) * Math.sin(a));
  return [Math.min(...vals), Math.max(...vals)] as const;
};

const farCorner = ({width: w, height: h}: Size, cx: number, cy: number) =>
  Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)) * 1.05;

const Layer = ({style, children}: {style?: CSSProperties; children?: ReactNode}) => (
  <AbsoluteFill style={{overflow: 'hidden', ...style}}>{children}</AbsoluteFill>
);

/** Bar i's progress (0..1, eased) at transition progress t of a `frames`-long transition. */
const barProgress = (t: number, frames: number, i: number, staggerFrames: number, count: number): number => {
  const run = frames - (count - 1) * staggerFrames;
  return EASE_CAM(clamp01((t * frames - i * staggerFrames) / run));
};

/** Renders `outgoing` -> `incoming` at progress t (0..1). */
const TransitionFrame = ({
  spec,
  t,
  size,
  fps,
  outgoing,
  incoming,
}: {
  spec: TransitionSpec;
  t: number;
  size: Size;
  fps: number;
  outgoing: ReactNode;
  incoming: ReactNode;
}) => {
  const {width: W, height: H} = size;
  const p = EASE_CAM(clamp01(t));
  switch (spec.kind) {
    case 'cut':
      return <>{incoming}</>;
    case 'wipe': {
      const angle = spec.angle ?? 0;
      const [lo, hi] = projRange(size, angle);
      const ew = spec.edgeWidth ?? 0;
      const d = lo - ew + (hi - lo + 2 * ew) * p;
      const a = (angle * Math.PI) / 180;
      // Point on the edge nearest the frame centre.
      const c0 = (W / 2) * Math.cos(a) + (H / 2) * Math.sin(a);
      const ex = W / 2 + Math.cos(a) * (d - c0);
      const ey = H / 2 + Math.sin(a) * (d - c0);
      const reach = Math.hypot(W, H);
      return (
        <>
          {outgoing}
          <Layer style={{clipPath: halfPlane(size, angle, d)}}>{incoming}</Layer>
          {spec.edge && ew > 0 ? (
            <div
              data-blade=""
              style={{
                position: 'absolute',
                left: ex - ew / 2,
                top: ey - reach,
                width: ew,
                height: 2 * reach,
                transform: `rotate(${angle}deg)`,
                background: spec.edge,
                boxShadow: spec.glow ? `0 0 ${(ew * 3).toFixed(0)}px ${ew.toFixed(0)}px ${spec.edge}` : undefined,
              }}
            />
          ) : null}
        </>
      );
    }
    case 'diagonal': {
      const slope = (spec.slope ?? 0.35) * W;
      const margin = 0.02 * W;
      // The edge runs from (x + slope, 0) to (x, H); x sweeps until the edge clears the frame.
      const x = -slope - margin + (W + 2 * margin + slope) * p;
      const poly =
        spec.dir === 'left'
          ? `polygon(${(W - x - slope).toFixed(1)}px 0px, ${W}px 0px, ${W}px ${H}px, ${(W - x).toFixed(1)}px ${H}px)`
          : `polygon(0px 0px, ${(x + slope).toFixed(1)}px 0px, ${x.toFixed(1)}px ${H}px, 0px ${H}px)`;
      return (
        <>
          {outgoing}
          <Layer style={{clipPath: poly}}>{incoming}</Layer>
        </>
      );
    }
    case 'bars': {
      const n = Math.min(9, Math.max(5, Math.round(spec.count ?? 7)));
      const frames = Math.max(1, spec.frames);
      // Every bar gets at least half the transition, so a short one compresses the stagger.
      const staggerFrames = Math.min((spec.stagger ?? 0.035) * fps, frames / (2 * (n - 1)));
      let d = '';
      for (let i = 0; i < n; i++) {
        const e = barProgress(t, frames, i, staggerFrames, n);
        if (spec.vertical) {
          const x0 = (W / n) * i;
          d += `M ${x0.toFixed(1)} 0 H ${(x0 + W / n + 1).toFixed(1)} V ${(H * e).toFixed(1)} H ${x0.toFixed(1)} Z `;
        } else {
          const y0 = (H / n) * i;
          d += `M 0 ${y0.toFixed(1)} H ${(W * e).toFixed(1)} V ${(y0 + H / n + 1).toFixed(1)} H 0 Z `;
        }
      }
      return (
        <>
          {outgoing}
          <Layer style={{clipPath: `path('${d}')`}}>{incoming}</Layer>
        </>
      );
    }
    case 'iris': {
      const cx = spec.cx ?? W / 2;
      const cy = spec.cy ?? H / 2;
      const R = farCorner(size, cx, cy);
      const lead = spec.color ? 0.18 : 0;
      const rRing = R * clamp01(p * (1 + lead));
      const r = R * clamp01(p * (1 + lead) - lead);
      return (
        <>
          {outgoing}
          {spec.color ? <Layer style={{clipPath: `circle(${rRing.toFixed(1)}px at ${cx}px ${cy}px)`, background: spec.color}} /> : null}
          <Layer style={{clipPath: `circle(${r.toFixed(1)}px at ${cx}px ${cy}px)`}}>{incoming}</Layer>
        </>
      );
    }
    case 'zoom': {
      const cx = spec.cx ?? W / 2;
      const cy = spec.cy ?? H / 2;
      const outScale = Math.exp(interpolate(p, [0, 1], [0, Math.log(5)]));
      const outOpacity = interpolate(p, [0.35, 0.7], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const inOpacity = interpolate(p, [0.3, 0.65], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
      const inScale = Math.exp(interpolate(p, [0.3, 1], [Math.log(0.82), 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
      const blur = 18 * Math.sin(Math.PI * p);
      return (
        <>
          <Layer style={{transform: `scale(${outScale})`, transformOrigin: `${cx}px ${cy}px`, opacity: outOpacity, filter: `blur(${(blur * 0.6).toFixed(1)}px)`}}>
            {outgoing}
          </Layer>
          <Layer style={{transform: `scale(${inScale})`, opacity: inOpacity, filter: `blur(${(blur * 0.4).toFixed(1)}px)`}}>{incoming}</Layer>
        </>
      );
    }
    case 'whip': {
      const dir = spec.dir ?? 'left';
      const horiz = dir === 'left' || dir === 'right';
      const sign = dir === 'left' || dir === 'up' ? -1 : 1;
      const span = horiz ? W : H;
      const blur = (spec.blur ?? 20) * Math.sin(Math.PI * p);
      const tr = (v: number) => (horiz ? `translateX(${v}px)` : `translateY(${v}px)`);
      return (
        <>
          <Layer style={{transform: tr(sign * span * p), filter: `blur(${blur.toFixed(1)}px)`}}>{outgoing}</Layer>
          <Layer style={{transform: tr(-sign * span * (1 - p)), filter: `blur(${blur.toFixed(1)}px)`}}>{incoming}</Layer>
        </>
      );
    }
    case 'slices': {
      const colors = spec.colors ?? [theme.colors.primary, theme.colors.accent, theme.colors.accentAlt];
      const n = spec.count ?? colors.length;
      const stagger = 0.35;
      const bars = (lag: number) => {
        let d = '';
        for (let i = 0; i < n; i++) {
          const e = EASE_CAM(clamp01(t * (1 + stagger + lag) - (i / Math.max(1, n - 1)) * stagger - lag));
          if (spec.vertical) {
            const x0 = (W / n) * i;
            d += `M ${x0.toFixed(1)} 0 H ${(x0 + W / n + 1).toFixed(1)} V ${(H * e).toFixed(1)} H ${x0.toFixed(1)} Z `;
          } else {
            const y0 = (H / n) * i;
            d += `M 0 ${y0.toFixed(1)} H ${(W * e).toFixed(1)} V ${(y0 + H / n + 1).toFixed(1)} H 0 Z `;
          }
        }
        return `path('${d || 'M 0 0 Z'}')`;
      };
      return (
        <>
          {outgoing}
          {colors.map((c, i) => (
            // The colour list is fixed for the transition: position + colour is a stable identity.
            <Layer key={`${i}-${c}`} style={{clipPath: bars(i * 0.12), background: c}} />
          ))}
          <Layer style={{clipPath: bars(colors.length * 0.12)}}>{incoming}</Layer>
        </>
      );
    }
    case 'split': {
      const v = spec.vertical ?? false;
      const off = (v ? W : H) * 0.5 * p;
      return (
        <>
          {incoming}
          <Layer style={{clipPath: v ? 'inset(0 50% 0 0)' : 'inset(0 0 50% 0)', transform: v ? `translateX(${-off}px)` : `translateY(${-off}px)`}}>{outgoing}</Layer>
          <Layer style={{clipPath: v ? 'inset(0 0 0 50%)' : 'inset(50% 0 0 0)', transform: v ? `translateX(${off}px)` : `translateY(${off}px)`}}>{outgoing}</Layer>
        </>
      );
    }
    case 'burn': {
      const color = spec.color ?? theme.colors.flash;
      const peak = spec.peak ?? 0.85;
      const glow = peak * Math.sin(Math.PI * clamp01(t));
      return (
        <>
          {outgoing}
          <Layer style={{opacity: p}}>{incoming}</Layer>
          <AbsoluteFill
            data-burn=""
            style={{background: `radial-gradient(ellipse 70% 60% at 50% 45%, ${color} 0%, ${color} 25%, transparent 75%)`, opacity: glow}}
          />
        </>
      );
    }
  }
};

export type ShotTimelineProps = {
  /** Shots sorted by strictly increasing `from` (it throws naming the first out-of-order id). */
  shots: readonly Shot[];
  /** ABSOLUTE frame the last shot ends (passed to it as `to`). Default Infinity: it plays until its Sequence ends. */
  end?: number;
};

/**
 * Plays a world-only shot list: each shot from its `from` until the next
 * shot's `from` (the last until `end`), each `in` transition over the frames
 * before its shot's `from`, with the outgoing and incoming shots both
 * rendered live (the incoming one is already moving when it appears).
 * Nothing renders before the first shot's start (its `from`, or its
 * transition start: a first-shot transition comes in from nothing, over
 * whatever is below the timeline).
 *
 * Transitions: cut, wipe (angle, blade), diagonal, bars, iris (colour ring),
 * zoom, whip, slices, split, burn. Sizes come from the composition, colours
 * default from the theme, and it renders no text of its own. It belongs inside
 * WorldLayer; the lyric goes in LyricLayer, so a whip, zoom or iris never moves,
 * scales, blurs or covers it. Shot components receive {start, from, to}.
 */
export const ShotTimeline = ({shots, end = Infinity}: ShotTimelineProps) => {
  const frame = useSongFrame();
  const {width, height, fps} = useVideoConfig();
  const at = shotAt(shots, frame, end);
  if (at === null) return null;
  const windows = shotWindows(shots, end);
  const render = (i: number) => {
    const shot = shots[i] as Shot;
    const w = windows[i] as ShotWindow;
    return <shot.Component key={shot.id} start={w.start} from={w.from} to={w.to} />;
  };
  if (at.incoming) {
    const next = shots[at.incoming.index] as Shot;
    return (
      <AbsoluteFill data-shot-timeline="" style={{overflow: 'hidden'}}>
        <TransitionFrame
          spec={next.in as TransitionSpec}
          t={at.incoming.t}
          size={{width, height}}
          fps={fps}
          outgoing={at.current >= 0 ? render(at.current) : null}
          incoming={render(at.incoming.index)}
        />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill data-shot-timeline="" style={{overflow: 'hidden'}}>
      {render(at.current)}
    </AbsoluteFill>
  );
};
