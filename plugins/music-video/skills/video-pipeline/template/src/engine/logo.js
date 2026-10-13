// The brand logo from brand.json's `logo` paths (files under public/). A
// missing file shows nothing (and warns); the page still renders.
import {toPageUrl} from '../lib/brand.js';
import {makeEl} from './layers.js';

/**
 * Create the logo as an <img> in `parent`. Returns the element and a promise
 * that settles once it is decoded (or failed, in which case it is hidden).
 * @param {HTMLElement} parent
 * @param {import('../lib/brand.js').BrandLogo} logo
 * @param {{variant?: 'default' | 'onDark' | 'onLight', height?: number, x?: number, y?: number, z?: number}} [opts]
 * @param {(msg: string) => void} [warn]
 * @returns {{el: HTMLImageElement, ready: Promise<boolean>}}
 */
export const makeLogo = (parent, logo, {variant = 'default', height = 96, x = 0, y = 0, z} = {}, warn = () => {}) => {
  const path = (variant !== 'default' && logo[variant]) || logo.path;
  const el = /** @type {HTMLImageElement} */ (makeEl(parent, 'img', {z, style: {left: `${x}px`, top: `${y}px`, height: `${height}px`, width: 'auto'}}));
  el.alt = '';
  el.decoding = 'sync';
  el.src = toPageUrl(path);
  const ready = el.decode().then(
    () => true,
    () => {
      el.style.display = 'none';
      warn(`logo ${path} did not load; it is left out`);
      return false;
    },
  );
  return {el, ready};
};
