// The page's layer stack and DOM helpers. Nothing here touches the DOM at
// import time (so `pnpm check` can import scene modules in Node); call
// initLayers() first.
//
//   #stage
//     #world  z1  scenes, backdrops, camera, transitions, shatter, shake
//     #fx     z2  grain, vignette (always under the text)
//     #txt    z3  lyrics only
//     #over   z4  rare overlays above the text (a flash that must cover everything); off in textonly
//
// In textonly mode #world, #fx and #over draw nothing and the stage is opaque
// black; #txt renders as usual. Layer stack and lazy DPR canvases are ported
// from the earlier adaptation.

/** @type {{stage: HTMLElement, world: HTMLElement, fx: HTMLElement, txt: HTMLElement, over: HTMLElement} | null} */
let L = null;
let size = {width: 1920, height: 1080};

/**
 * Size the stage and layers to the page (CSS px) and apply textonly.
 * @param {{width: number, height: number, textonly: boolean, background: string}} options
 */
export const initLayers = ({width, height, textonly, background}) => {
  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`index.html is missing #${id}`);
    return el;
  };
  L = {stage: $('stage'), world: $('world'), fx: $('fx'), txt: $('txt'), over: $('over')};
  size = {width, height};
  for (const el of Object.values(L)) {
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }
  L.stage.style.background = textonly ? '#000000' : background;
  document.body.style.background = '#000000';
  if (textonly) {
    L.world.style.display = 'none';
    L.fx.style.display = 'none';
    L.over.style.display = 'none';
  }
};

/** The layer elements (after initLayers). */
export const layers = () => {
  if (!L) throw new Error('layers used before initLayers()');
  return L;
};

/** Page size in CSS px. */
export const pageSize = () => size;

/** Throw unless `el` is outside the lyric layer: camera, shake, shatter and transitions are world-only. */
export const assertNotText = (el, what) => {
  if (L && el instanceof Node && L.txt.contains(el)) throw new Error(`${what} works on world content only, never on the lyric layer`);
};

/**
 * Create an element. `spec` is a tag name or an HTML string (one root element).
 * @param {HTMLElement} parent
 * @param {string} spec
 * @param {{z?: number, style?: Partial<CSSStyleDeclaration> | string, className?: string, text?: string}} [opts]
 * @returns {HTMLElement}
 */
export const makeEl = (parent, spec, opts = {}) => {
  let el;
  if (spec.trim().startsWith('<')) {
    const tpl = document.createElement('template');
    tpl.innerHTML = spec.trim();
    el = /** @type {HTMLElement} */ (tpl.content.firstElementChild);
    if (!el) throw new Error(`el(): no element in ${JSON.stringify(spec.slice(0, 40))}`);
  } else {
    el = document.createElement(spec);
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
  }
  if (opts.className) el.className = opts.className;
  if (typeof opts.style === 'string') el.style.cssText += opts.style;
  else if (opts.style) Object.assign(el.style, opts.style);
  if (opts.text !== undefined) el.textContent = opts.text;
  if (opts.z !== undefined) el.style.zIndex = String(opts.z);
  parent.appendChild(el);
  return el;
};

/**
 * A canvas whose backing store is sized to devicePixelRatio and exists only
 * while its section is on screen. get() returns the 2D context reset to its
 * defaults (pixels and all state, CanvasRenderingContext2D.reset()) with the
 * DPR transform set, in CSS px coordinates.
 */
export class Canvas {
  /**
   * @param {HTMLElement | null} parent null: an offscreen canvas (a source for shatter).
   * @param {{z?: number, width?: number, height?: number, x?: number, y?: number}} [opts]
   */
  constructor(parent, {z, width = size.width, height = size.height, x = 0, y = 0} = {}) {
    this.w = width;
    this.h = height;
    this.el = document.createElement('canvas');
    Object.assign(this.el.style, {position: 'absolute', left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`});
    if (z !== undefined) this.el.style.zIndex = String(z);
    if (parent) parent.appendChild(this.el);
    this.on = false;
    /** @type {CanvasRenderingContext2D | null} */
    this.ctx = null;
  }

  /** Device pixel ratio used for the backing store. */
  get dpr() {
    return window.devicePixelRatio || 1;
  }

  /** @returns {CanvasRenderingContext2D} */
  get() {
    const dpr = this.dpr;
    if (!this.on) {
      this.el.width = Math.max(1, Math.round(this.w * dpr));
      this.el.height = Math.max(1, Math.round(this.h * dpr));
      this.ctx = this.el.getContext('2d');
      this.on = true;
    }
    const c = /** @type {CanvasRenderingContext2D} */ (this.ctx);
    // Every draw starts from a blank, default context: reset() clears the pixels and every piece of state
    // (clip region, path, save stack, styles, font, line dash, transform), so nothing an earlier seek left
    // behind can change this frame.
    c.reset();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  /** Drop the backing store (the engine calls this when the section leaves the screen). */
  release() {
    if (this.on) {
      this.el.width = 0;
      this.el.height = 0;
      this.on = false;
      this.ctx = null;
    }
  }
}

const styleCache = new WeakMap();

/** Set a style property only when it changed (the engine owns these properties). */
export const setStyle = (el, prop, value) => {
  let cache = styleCache.get(el);
  if (!cache) styleCache.set(el, (cache = {}));
  if (cache[prop] !== value) {
    el.style[prop] = value;
    cache[prop] = value;
  }
};
