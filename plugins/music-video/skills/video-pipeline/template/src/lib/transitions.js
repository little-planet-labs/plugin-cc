// Section transitions as pure style values: given a transition spec and t,
// the clip-path / opacity / transform / filter of the incoming section's root
// (and, for whip and zoom, the outgoing one), plus the optional colour ring
// and wipe blade. Pure ES module (no DOM, no node: imports); src/engine/
// transitions.js writes them to the DOM.
//
// Ported from the old template's ShotTimeline and CircleFlood and the earlier
// adaptation's TR helpers. The rule that a circle flood clears the farthest
// corner x1.05 comes from the howseen-ai/claude-motion-design skill (MIT, see
// NOTICE.md).
import {clamp, ease as easeOf} from './ease.js';

export const TRANSITIONS = Object.freeze(['cut', 'fade', 'circle', 'iris', 'wipe', 'diagonal', 'bars', 'whip', 'zoom']);

/**
 * @typedef {object} TransitionSpec
 * @property {string} kind One of TRANSITIONS ('iris' is 'circle').
 * @property {number} [at] Seconds the transition starts. Default: the section start minus dur, so the
 *   incoming section is whole on its first frame.
 * @property {number} [dur] Seconds. Default 0.4 (0 for 'cut').
 * @property {number} [end] Seconds the transition ends (set by the engine: at + dur, or exactly the
 *   section start for the default timing, so the last transition frame is never a float hair short).
 * @property {string | ((u: number) => number)} [ease] Default 'cam'.
 * @property {number} [blur] Subframe samples (2..16) for a motion-blur window over the transition's span.
 * @property {number} [x] circle / zoom: centre px. Default the page centre.
 * @property {number} [y]
 * @property {{color: string, width: number}} [ring] circle: a colour band `width` px wide leading the edge.
 * @property {{x: number, y: number, at: number, dur: number, ease?: string}} [contractTo] circle: shrink to
 *   radius exactly 0 at (x, y) from `at` over `dur` (the element is invisible from at + dur).
 * @property {'left' | 'right' | 'top' | 'bottom'} [from] wipe: the side the edge starts from. Default 'left'.
 * @property {{color: string, width: number}} [edge] wipe: a coloured blade on the edge.
 * @property {number} [slope] diagonal: horizontal run of the edge as a fraction of the width. Default 0.35.
 * @property {'right' | 'left'} [dir] diagonal: sweep direction. Default 'right'.
 * @property {number} [count] bars: 5..9. Default 7.
 * @property {number} [stagger] bars: seconds between bars. Default 0.035 (compressed so every bar gets half the span).
 * @property {boolean} [vertical] bars: vertical bars.
 * @property {'left' | 'right' | 'up' | 'down'} [toward] whip: direction of travel. Default 'left'.
 * @property {number} [blurPx] whip: peak CSS blur in px. Default 20.
 */

/**
 * @typedef {{clipPath: string, opacity: string, transform: string, filter: string}} RootStyle
 *   '' means "not set". Transforms carry their own pivot: apply them with `transform-origin: 0 0`.
 * @typedef {object} TransitionFrame
 * @property {RootStyle} incoming
 * @property {RootStyle | null} outgoing
 * @property {{clipPath: string, background: string} | null} ring
 * @property {{left: number, top: number, width: number, height: number, transform: string, background: string} | null} blade
 * @property {boolean} done True from the moment the incoming section is whole (and the transition is over).
 */

const NONE = Object.freeze({clipPath: '', opacity: '', transform: '', filter: ''});

const DIRS = {from: ['left', 'right', 'top', 'bottom'], dir: ['right', 'left'], toward: ['left', 'right', 'up', 'down']};

/**
 * Validate a spec and fill defaults (except `at`, which the engine fills from
 * the section). Throws naming the field.
 * @param {TransitionSpec} spec
 * @param {string} [where] For messages.
 * @returns {TransitionSpec & {kind: string, dur: number}}
 */
export const normalizeTransition = (spec, where = 'the transition') => {
  if (typeof spec !== 'object' || spec === null) throw new Error(`${where} must be an object with a kind`);
  const kind = spec.kind === 'iris' ? 'circle' : spec.kind;
  if (!TRANSITIONS.includes(kind)) throw new Error(`${where}: kind must be one of ${TRANSITIONS.join(', ')} (got ${JSON.stringify(spec.kind)})`);
  const dur = kind === 'cut' ? 0 : (spec.dur ?? 0.4);
  if (!(typeof dur === 'number' && dur >= 0 && Number.isFinite(dur))) throw new Error(`${where}: dur must be seconds >= 0`);
  if (kind !== 'cut' && dur === 0) throw new Error(`${where}: dur must be > 0 for ${kind} (use kind 'cut' for a hard cut)`);
  if (spec.at !== undefined && !Number.isFinite(spec.at)) throw new Error(`${where}: at must be seconds`);
  for (const [key, allowed] of Object.entries(DIRS)) {
    if (spec[key] !== undefined && !allowed.includes(spec[key])) throw new Error(`${where}: ${key} must be one of ${allowed.join(', ')}`);
  }
  if (spec.count !== undefined && !(Number.isInteger(spec.count) && spec.count >= 5 && spec.count <= 9)) {
    throw new Error(`${where}: count must be an integer from 5 to 9`);
  }
  if (spec.blur !== undefined && !(Number.isInteger(spec.blur) && spec.blur >= 2 && spec.blur <= 16)) {
    throw new Error(`${where}: blur must be a sample count from 2 to 16`);
  }
  easeOf(spec.ease, 'cam');
  return {...spec, kind, dur};
};

/** Distance from (cx, cy) to the farthest corner of a w x h frame, times 1.05. */
export const farCorner = (cx, cy, w, h) => Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)) * 1.05;

const circle = (r, cx, cy) => `circle(${Math.max(0, r).toFixed(2)}px at ${cx.toFixed(2)}px ${cy.toFixed(2)}px)`;

/**
 * Circle geometry at t: radius eases from 0 to farCorner over [at, at + dur];
 * with contractTo it then eases to exactly 0 while the centre moves to the
 * target. null before `at` and from the contract's end (nothing shows).
 * @param {TransitionSpec & {at: number, dur: number}} s
 * @param {number} t
 * @param {number} width
 * @param {number} height
 * @returns {{r: number, cx: number, cy: number, ringScale: number, full: boolean} | null}
 */
export const circleGeometry = (s, t, width, height) => {
  if (t < s.at) return null;
  const end = s.end ?? s.at + s.dur;
  const cx = s.x ?? width / 2;
  const cy = s.y ?? height / 2;
  const R = farCorner(cx, cy, width, height);
  const grow = (tt) => (tt >= end ? R : R * easeOf(s.ease, 'cam')(clamp((tt - s.at) / (end - s.at))));
  const c = s.contractTo;
  if (!c || t < c.at) {
    const r = grow(t);
    return {r, cx, cy, ringScale: 1, full: t >= end};
  }
  if (t >= c.at + c.dur) return null;
  const k = easeOf(c.ease, 'cam')((t - c.at) / c.dur);
  return {r: grow(c.at) * (1 - k), cx: cx + (c.x - cx) * k, cy: cy + (c.y - cy) * k, ringScale: 1 - k, full: false};
};

/**
 * The transition's styles at t.
 * @param {TransitionSpec & {kind: string, at: number, dur: number}} s Normalized, with `at`.
 * @param {number} t
 * @param {{width: number, height: number}} size
 * @returns {TransitionFrame}
 */
export const transitionFrame = (s, t, {width: W, height: H}) => {
  const style = (o) => ({...NONE, ...o});
  const out = {incoming: NONE, outgoing: null, ring: null, blade: null, done: false};
  if (s.kind === 'cut') return {...out, incoming: t < s.at ? style({opacity: '0'}) : NONE, done: t >= s.at};
  if (s.kind === 'circle') {
    const g = circleGeometry(s, t, W, H);
    if (g === null) return {...out, incoming: style({clipPath: 'circle(0px at 0px 0px)'}), done: false};
    if (g.full && !s.contractTo) return {...out, done: true};
    const ring = s.ring && g.r > 0 ? {clipPath: circle(g.r + s.ring.width * g.ringScale, g.cx, g.cy), background: s.ring.color} : null;
    return {...out, incoming: style({clipPath: circle(g.r, g.cx, g.cy)}), ring};
  }
  const end = s.end ?? s.at + s.dur;
  if (t >= end) return {...out, done: true};
  const u = clamp((t - s.at) / (end - s.at));
  const p = easeOf(s.ease, 'cam')(u);
  switch (s.kind) {
    case 'fade':
      return {...out, incoming: style({opacity: String(Number(p.toFixed(4)))})};
    case 'wipe': {
      const from = s.from ?? 'left';
      const horiz = from === 'left' || from === 'right';
      const span = horiz ? W : H;
      const ew = s.edge?.width ?? 0;
      const pos = -ew + (span + 2 * ew) * p;
      const pct = (clamp(1 - pos / span) * 100).toFixed(3);
      const clipPath = {left: `inset(0 ${pct}% 0 0)`, right: `inset(0 0 0 ${pct}%)`, top: `inset(0 0 ${pct}% 0)`, bottom: `inset(${pct}% 0 0 0)`}[from];
      const edgeAt = from === 'left' || from === 'top' ? pos : span - pos;
      const blade =
        s.edge && ew > 0
          ? horiz
            ? {left: edgeAt - ew / 2, top: 0, width: ew, height: H, transform: '', background: s.edge.color}
            : {left: 0, top: edgeAt - ew / 2, width: W, height: ew, transform: '', background: s.edge.color}
          : null;
      return {...out, incoming: style({clipPath}), blade};
    }
    case 'diagonal': {
      const slope = (s.slope ?? 0.35) * W;
      const margin = 0.02 * W;
      const x = -slope - margin + (W + 2 * margin + slope) * p;
      const poly =
        s.dir === 'left'
          ? `polygon(${(W - x - slope).toFixed(2)}px 0px, ${W}px 0px, ${W}px ${H}px, ${(W - x).toFixed(2)}px ${H}px)`
          : `polygon(0px 0px, ${(x + slope).toFixed(2)}px 0px, ${x.toFixed(2)}px ${H}px, 0px ${H}px)`;
      return {...out, incoming: style({clipPath: poly})};
    }
    case 'bars': {
      const n = s.count ?? 7;
      const span = end - s.at;
      const stagger = Math.min(s.stagger ?? 0.035, span / (2 * (n - 1)));
      const run = span - (n - 1) * stagger;
      const fn = easeOf(s.ease, 'cam');
      let d = '';
      for (let i = 0; i < n; i++) {
        const e = fn(clamp((t - s.at - i * stagger) / run));
        if (s.vertical) {
          const x0 = (W / n) * i;
          d += `M${x0.toFixed(2)} 0H${(x0 + W / n + 1).toFixed(2)}V${(H * e).toFixed(2)}H${x0.toFixed(2)}Z`;
        } else {
          const y0 = (H / n) * i;
          d += `M0 ${y0.toFixed(2)}H${(W * e).toFixed(2)}V${(y0 + H / n + 1).toFixed(2)}H0Z`;
        }
      }
      return {...out, incoming: style({clipPath: `path('${d}')`})};
    }
    case 'whip': {
      const toward = s.toward ?? 'left';
      const horiz = toward === 'left' || toward === 'right';
      const sign = toward === 'left' || toward === 'up' ? -1 : 1;
      const span = horiz ? W : H;
      const blur = `blur(${((s.blurPx ?? 20) * Math.sin(Math.PI * p)).toFixed(2)}px)`;
      const tr = (v) => (horiz ? `translateX(${v.toFixed(2)}px)` : `translateY(${v.toFixed(2)}px)`);
      return {
        ...out,
        incoming: style({transform: tr(-sign * span * (1 - p)), filter: blur}),
        outgoing: style({transform: tr(sign * span * p), filter: blur}),
      };
    }
    case 'zoom': {
      const cx = s.x ?? W / 2;
      const cy = s.y ?? H / 2;
      const ramp = (a, b) => clamp((p - a) / (b - a));
      const outScale = Math.exp(p * Math.log(5));
      const inScale = Math.exp(Math.log(0.82) * (1 - ramp(0.3, 1)));
      const blur = 18 * Math.sin(Math.PI * p);
      return {
        ...out,
        incoming: style({
          transform: `translate(${W / 2}px,${H / 2}px) scale(${inScale.toFixed(5)}) translate(${-W / 2}px,${-H / 2}px)`,
          opacity: String(Number(ramp(0.3, 0.65).toFixed(4))),
          filter: `blur(${(blur * 0.4).toFixed(2)}px)`,
        }),
        outgoing: style({
          transform: `translate(${cx}px,${cy}px) scale(${outScale.toFixed(5)}) translate(${-cx}px,${-cy}px)`,
          opacity: String(Number((1 - ramp(0.35, 0.7)).toFixed(4))),
          filter: `blur(${(blur * 0.6).toFixed(2)}px)`,
        }),
      };
    }
    default:
      throw new Error(`unknown transition kind "${s.kind}"`);
  }
};
