// Closed-form springs that land on EXACTLY 1 at a finite settle time and stay
// there. Pure ES module (no DOM, no node: imports).
//
// A raw spring only approaches 1, so text held on it keeps creeping by
// sub-pixel amounts long after it looks settled, which reads as shimmer. These
// springs blend the remaining residual away over the second half of the settle
// time (a sine ease toward 1), so the value is exactly 1 from `at + settle`.
// The closed-form step response and the stiffness/damping presets come from the
// howseen-ai/claude-motion-design skill and example (MIT, see NOTICE.md); the
// forced landing on exactly 1 comes from the earlier adaptation.

/**
 * Presets as [frequency Hz, damping ratio], equivalent to the classic
 * stiffness/damping pairs (mass 1): snappy 320/30, default 170/26, heavy
 * 120/24 (both capped to an underdamped ratio so they still land with a hair
 * of overshoot) and playful 180/12 raised to ratio 0.74, because nothing in a
 * lyric video bounces like a cartoon (damping ratio >= 0.72 by default).
 */
export const SPRING_PRESETS = Object.freeze({
  snappy: Object.freeze({freq: 2.85, damping: 0.84}),
  default: Object.freeze({freq: 2.07, damping: 0.9}),
  heavy: Object.freeze({freq: 1.74, damping: 0.92}),
  playful: Object.freeze({freq: 2.4, damping: 0.74}),
});

/** The lowest damping ratio allowed unless `allowBounce` is set. */
export const MIN_DAMPING = 0.72;

/** Settle time numerator: the envelope e^(-zwt) is e^-4.2 (1.5%) at the settle time. */
const SETTLE_ENVELOPE = 4.2;

/** Fraction of the settle time from which the residual is blended toward 1. */
const BLEND_FROM = 0.45;

/**
 * @typedef {{freq: number, damping: number}} SpringConfig
 * @typedef {keyof typeof SPRING_PRESETS | SpringConfig} SpringSpec
 */

/**
 * A preset name or a {freq, damping} config, validated. Damping below
 * MIN_DAMPING throws unless `allowBounce`.
 * @param {SpringSpec} [spec]
 * @param {{allowBounce?: boolean}} [options]
 * @returns {SpringConfig}
 */
export const springConfig = (spec = 'default', {allowBounce = false} = {}) => {
  const cfg = typeof spec === 'string' ? SPRING_PRESETS[spec] : spec;
  if (!cfg) throw new Error(`unknown spring preset "${spec}"; use one of ${Object.keys(SPRING_PRESETS).join(', ')}`);
  const {freq, damping} = cfg;
  if (!(freq > 0) || !Number.isFinite(freq)) throw new Error(`spring freq must be a number > 0 (got ${freq})`);
  if (!(damping > 0) || !Number.isFinite(damping)) throw new Error(`spring damping must be a number > 0 (got ${damping})`);
  if (damping < MIN_DAMPING && !allowBounce) {
    throw new Error(`spring damping ${damping} is below ${MIN_DAMPING}; pass {allowBounce: true} for a deliberate bounce`);
  }
  return {freq, damping};
};

/**
 * Raw step response of a unit spring at tau seconds after the step (0 for
 * tau <= 0). Under-, critically and over-damped cases.
 * @param {number} tau
 * @param {SpringConfig} cfg
 * @returns {number}
 */
export const springStep = (tau, {freq, damping: z}) => {
  if (tau <= 0) return 0;
  const w = 2 * Math.PI * freq;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + ((z * w) / wd) * Math.sin(wd * tau));
  }
  if (z === 1) return 1 - Math.exp(-w * tau) * (1 + w * tau);
  const s = Math.sqrt(z * z - 1);
  const r1 = -w * (z - s);
  const r2 = -w * (z + s);
  return 1 + (r2 * Math.exp(r1 * tau) - r1 * Math.exp(r2 * tau)) / (r1 - r2);
};

/**
 * Seconds from the start until the spring is exactly 1.
 * @param {SpringSpec} [spec]
 * @param {{allowBounce?: boolean}} [options]
 * @returns {number}
 */
export const springSettle = (spec = 'default', options = {}) => {
  const {freq, damping} = springConfig(spec, options);
  return SETTLE_ENVELOPE / (Math.min(1, damping) * 2 * Math.PI * freq);
};

/**
 * Exactly 0 up to `at`, a spring toward 1 after it, and EXACTLY 1 from
 * `at + springSettle(spec)` on. Over the second half of the settle time the
 * residual is eased to zero (sine ease), so the landing has no visible step and
 * the value never exceeds the raw spring's overshoot.
 * @param {number} t Seconds.
 * @param {number} at Seconds: the spring starts here.
 * @param {SpringSpec} [spec]
 * @param {{allowBounce?: boolean}} [options]
 * @returns {number}
 */
export const spring = (t, at, spec = 'default', options = {}) => {
  const tau = t - at;
  if (tau <= 0) return 0;
  const cfg = springConfig(spec, options);
  const settle = springSettle(cfg, {allowBounce: true});
  if (tau >= settle) return 1;
  const s = springStep(tau, cfg);
  const k = (tau - settle * BLEND_FROM) / (settle * (1 - BLEND_FROM));
  if (k <= 0) return s;
  const smooth = 0.5 - 0.5 * Math.cos(Math.PI * k);
  return s + (1 - s) * smooth;
};

/**
 * The raw spring's peak overshoot above 1 (0 when damping >= 1):
 * e^(-z pi / sqrt(1 - z^2)). `spring` never exceeds 1 + this.
 * @param {SpringSpec} [spec]
 * @returns {number}
 */
export const springOvershoot = (spec = 'default') => {
  const {damping: z} = springConfig(spec, {allowBounce: true});
  return z >= 1 ? 0 : Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
};
