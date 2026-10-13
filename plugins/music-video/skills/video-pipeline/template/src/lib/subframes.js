// Subframe (motion blur) hints: which times to capture and average for a
// frame. Pure ES module (no DOM, no node: imports). The page's
// window.__mv.subframes(n) is this function; the renderer captures exactly
// what it returns and re-checks the cut rule.
//
// Blur is opt-in per window: outside every declared window a frame is one
// capture at n / fps. The adaptive-subframe and never-across-a-cut rules come
// from the howseen-ai/claude-motion-design render template (MIT, see NOTICE.md).

/** Samples a window may ask for. */
export const MIN_SAMPLES = 2;
export const MAX_SAMPLES = 16;

/**
 * @typedef {{a: number, b: number, samples: number, label?: string}} BlurWindow
 *   [a, b) in frame-aligned seconds; samples 2..16; label names who declared it (for errors).
 */

/** Seconds snapped to the nearest frame time k / fps. */
export const snapToFrame = (t, fps) => Math.round(t * fps) / fps;

const isFrameAligned = (t, fps) => Math.abs(t * fps - Math.round(t * fps)) < 1e-6;

/**
 * Validate blur windows against the hard cuts: frame-aligned ends, a < b,
 * integer samples in 2..16, and no cut strictly inside (a < c < b; a cut on
 * `a` is fine: the window starts with the cut). Throws naming the window.
 * @param {readonly BlurWindow[]} windows
 * @param {readonly number[]} cuts Frame-aligned seconds.
 * @param {number} fps
 * @param {(cut: number) => string} [cutLabel] Who made a cut (for the message).
 */
export const validateBlurWindows = (windows, cuts, fps, cutLabel) => {
  for (const w of windows) {
    const name = `blur window [${w.a}, ${w.b})${w.label ? ` (${w.label})` : ''}`;
    if (!Number.isFinite(w.a) || !Number.isFinite(w.b) || !isFrameAligned(w.a, fps) || !isFrameAligned(w.b, fps)) {
      throw new Error(`${name}: a and b must be frame-aligned seconds (k / ${fps})`);
    }
    if (!(w.b > w.a)) throw new Error(`${name}: b must be after a`);
    if (!Number.isInteger(w.samples) || w.samples < MIN_SAMPLES || w.samples > MAX_SAMPLES) {
      throw new Error(`${name}: samples must be an integer from ${MIN_SAMPLES} to ${MAX_SAMPLES} (got ${w.samples})`);
    }
    const ia = Math.round(w.a * fps);
    const ib = Math.round(w.b * fps);
    for (const c of cuts) {
      const ic = Math.round(c * fps);
      if (ic > ia && ic < ib) {
        const who = cutLabel?.(c);
        throw new Error(`${name} has a hard cut inside it at ${c}s${who ? ` (${who})` : ''}; end the window at the cut or start it there`);
      }
    }
  }
};

/**
 * The window that governs frame n: among the windows whose [a, b) holds n / fps
 * (compared as frame indices), the one with the most samples, earliest first.
 * @param {number} n
 * @param {readonly BlurWindow[]} windows
 * @param {number} fps
 * @returns {BlurWindow | null}
 */
export const windowForFrame = (n, windows, fps) => {
  let best = null;
  for (const w of windows) {
    const ia = Math.round(w.a * fps);
    const ib = Math.round(w.b * fps);
    if (n >= ia && n < ib && (best === null || w.samples > best.samples)) best = w;
  }
  return best;
};

/**
 * Sample times (seconds) for frame n. Outside every blur window: [n / fps].
 * Inside window [a, b) with N samples and shutter s:
 *   tc + (j - (N - 1) / 2) * s / (fps * N), j = 0..N-1, tc = n / fps,
 * each clamped into [a, b - 1/fps], and a sample on the other side of a cut
 * than tc is moved to tc's side (onto the cut when tc is at or after it).
 * With s <= 1 a sample is within half a frame of tc, so only a cut exactly on
 * tc can be crossed (by the samples before it).
 * @param {number} n Frame index.
 * @param {{fps: number, shutter: number, windows: readonly BlurWindow[], cuts: readonly number[]}} options
 * @returns {number[]}
 */
export const subframeTimes = (n, {fps, shutter, windows, cuts}) => {
  const tc = n / fps;
  const w = windowForFrame(n, windows, fps);
  if (w === null) return [tc];
  const N = w.samples;
  const lo = w.a;
  const hi = w.b - 1 / fps;
  const out = [];
  for (let j = 0; j < N; j++) {
    let t = tc + ((j - (N - 1) / 2) * shutter) / (fps * N);
    t = t < lo ? lo : t > hi ? hi : t;
    for (const c of cuts) {
      if (t < c !== tc < c) t = tc >= c ? c : tc;
    }
    out.push(t);
  }
  return out;
};

/**
 * Whether any sample lies on the other side of a cut than tc.
 * @param {readonly number[]} samples
 * @param {number} tc
 * @param {readonly number[]} cuts
 * @returns {number | null} The first crossed cut, or null.
 */
export const crossedCut = (samples, tc, cuts) => {
  for (const c of cuts) {
    for (const t of samples) if (t < c !== tc < c) return c;
  }
  return null;
};
