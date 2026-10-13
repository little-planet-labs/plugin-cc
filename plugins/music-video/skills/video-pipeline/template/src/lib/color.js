// Colour helpers for hex colours from brand.json. Pure ES module (no DOM, no
// node: imports).

/**
 * "#RGB", "#RGBA", "#RRGGBB" or "#RRGGBBAA" -> [r, g, b, a] (0..255, alpha 0..1).
 * @param {string} hex
 * @returns {[number, number, number, number]}
 */
export const hexToRgba = (hex) => {
  let h = String(hex).replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h)) throw new Error(`not a hex colour: ${JSON.stringify(hex)}`);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
};

const css = ([r, g, b], a) => (a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${Number(a.toFixed(4))})`);

/**
 * The colour with alpha `a` (multiplied with its own alpha), as a CSS rgba().
 * @param {string} hex
 * @param {number} a
 * @returns {string}
 */
export const rgba = (hex, a) => {
  const c = hexToRgba(hex);
  return css(c, Math.max(0, Math.min(1, a * c[3])));
};

/**
 * Linear mix of two hex colours at u (0 = a, 1 = b), as a CSS colour.
 * @param {string} a
 * @param {string} b
 * @param {number} u
 * @returns {string}
 */
export const mix = (a, b, u) => {
  const A = hexToRgba(a);
  const B = hexToRgba(b);
  const k = Math.max(0, Math.min(1, u));
  const ch = (i) => Math.round(A[i] + (B[i] - A[i]) * k);
  return css([ch(0), ch(1), ch(2)], A[3] + (B[3] - A[3]) * k);
};

/**
 * WCAG relative luminance (0 black .. 1 white) of a hex colour.
 * @param {string} hex
 * @returns {number}
 */
export const luminance = (hex) => {
  const [r, g, b] = hexToRgba(hex).map((v, i) => (i < 3 ? v / 255 : v));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * WCAG contrast ratio of two hex colours (1..21). Body lyrics want >= 4.5.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
