// Decaying hits: flashes and beat pulses that fall to EXACTLY 0. Pure ES
// module (no DOM, no node: imports).

/** Below this a decaying value is 0 (so a flash ends on a definite frame). */
const FLOOR = 0.002;

/**
 * A flash: 0 before `at`, `peak` at `at`, then peak * e^(-decay * u), and
 * exactly 0 once that falls below 0.002. Keep peaks around 0.4 over text: a
 * near-white frame on a hit hides the lyric on the frame people screenshot.
 * @param {number} t
 * @param {{at: number, peak?: number, decay?: number}} options Defaults: peak 0.4, decay 8 per second.
 * @returns {number}
 */
export const flashAmount = (t, {at, peak = 0.4, decay = 8}) => {
  if (t < at) return 0;
  const v = peak * Math.exp(-decay * (t - at));
  return v < FLOOR ? 0 : v;
};

/**
 * A pulse after the most recent event: 1 on the event, e^(-decay * since)
 * after it, exactly 0 below 0.002 or when there is no event yet (since =
 * Infinity). Feed it ctx.sinceBeat(t) or ctx.sinceDownbeat(t).
 * @param {number} since Seconds since the event.
 * @param {number} [decay] Per second. Default 6.
 * @returns {number}
 */
export const pulse = (since, decay = 6) => {
  if (!(since >= 0) || !Number.isFinite(since)) return 0;
  const v = Math.exp(-decay * since);
  return v < FLOOR ? 0 : v;
};
