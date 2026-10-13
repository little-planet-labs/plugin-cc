// Easings and progress helpers. Pure ES module (no DOM, no node: imports): the
// page and the Node scripts both import it.
//
// Every easing returns EXACTLY 0 for u <= 0 and EXACTLY 1 for u >= 1. An
// easing that returns 1e-9 at u = 0 makes an `if (value > 0)` guard fire early
// (an element appears seconds before its cue), and one that lands on
// 0.9999999 keeps held things creeping by sub-pixels. The io/out/in/o5
// easings and the exact-ends rule come from the howseen-ai/claude-motion-design
// skill and example (MIT, see NOTICE.md); i2, expo, sine and qio from the
// earlier adaptation.

/** Clamp `x` into [a, b] (default [0, 1]). */
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

/** Linear interpolation from a to b at u (not clamped). */
export const lerp = (a, b, u) => a + (b - a) * u;

/** Where x sits between a and b, clamped to [0, 1]; 1 when a === b and x >= a. */
export const inv = (a, b, x) => (b === a ? (x >= a ? 1 : 0) : clamp((x - a) / (b - a)));

/** Wrap an easing so both ends are exact. */
const exact = (fn) => (u) => (u <= 0 ? 0 : u >= 1 ? 1 : fn(u));

/**
 * A CSS-style cubic-bezier(x1, y1, x2, y2) easing, solved per call (Newton
 * steps, falling back to bisection), with exact 0 and 1 at the ends.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {(u: number) => number}
 */
export const cubicBezier = (x1, y1, x2, y2) => {
  const bx = (s) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  const dbx = (s) => 3 * x1 * (1 - s) ** 2 + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s;
  return exact((u) => {
    let s = u;
    for (let i = 0; i < 8; i++) {
      const d = dbx(s);
      if (Math.abs(d) < 1e-7) break;
      const next = s - (bx(s) - u) / d;
      if (next < 0 || next > 1) break;
      s = next;
    }
    if (Math.abs(bx(s) - u) > 1e-7) {
      let lo = 0;
      let hi = 1;
      s = u;
      for (let i = 0; i < 60; i++) {
        if (bx(s) < u) lo = s;
        else hi = s;
        s = (lo + hi) / 2;
      }
    }
    return by(s);
  });
};

/**
 * Named easings. io: cubic in-out (the default), out / in: cubic, o5: quintic
 * out (entrances), i2: quadratic in, expo: exponential out, sine: sine in-out,
 * qio: quartic in-out, linear, cam: cubic-bezier(.6, 0, .2, 1) for camera
 * moves between rests, enter: cubic-bezier(.2, .8, .2, 1) fast-out long-settle.
 */
export const EASE = Object.freeze({
  linear: exact((u) => u),
  io: exact((u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)),
  out: exact((u) => 1 - (1 - u) ** 3),
  in: exact((u) => u * u * u),
  o5: exact((u) => 1 - (1 - u) ** 5),
  i2: exact((u) => u * u),
  expo: exact((u) => 1 - 2 ** (-10 * u)),
  sine: exact((u) => 0.5 - 0.5 * Math.cos(Math.PI * u)),
  qio: exact((u) => (u < 0.5 ? 8 * u ** 4 : 1 - (-2 * u + 2) ** 4 / 2)),
  cam: cubicBezier(0.6, 0, 0.2, 1),
  enter: cubicBezier(0.2, 0.8, 0.2, 1),
});

/**
 * An easing by name (a key of EASE) or a function, which is wrapped so its ends
 * are exact. Throws naming the unknown name.
 * @param {string | ((u: number) => number) | undefined} e
 * @param {keyof typeof EASE} [fallback]
 * @returns {(u: number) => number}
 */
export const ease = (e, fallback = 'io') => {
  if (e === undefined || e === null) return EASE[fallback];
  if (typeof e === 'function') return exact(e);
  const fn = EASE[e];
  if (!fn) throw new Error(`unknown easing "${e}"; use one of ${Object.keys(EASE).join(', ')} or a function`);
  return fn;
};

/**
 * Eased progress of a move that starts at t0 and lasts dur seconds: exactly 0
 * up to t0, exactly 1 from t0 + dur. A zero-length move is a step at t0.
 * @param {number} t
 * @param {number} t0
 * @param {number} dur
 * @param {string | ((u: number) => number)} [e] Easing (default 'io').
 * @returns {number}
 */
export const progress = (t, t0, dur, e) => {
  if (!(dur > 0)) return t >= t0 ? 1 : 0;
  return ease(e)((t - t0) / dur);
};
