// The lyric layer (#txt). Scenes register lines once at setup with
// ctx.lyric(id, style); after every setup ran, the engine builds each line's
// DOM, lays it out, and schedules it (src/lib/exits.js). On every seek it
// draws every registered line from its schedule, whichever section is active,
// so lines may cross section boundaries and textonly renders them as usual.
//
// Held text: from a word's settle time until its exit starts, the word has
// transform none, no filter (beyond its own wordCss filter) and opacity exactly
// 1, so held lines are pixel-still. Word masks leave 0.4em of room above and
// at the sides and 0.45em below for descenders. Masked word reveals come from
// the howseen-ai/claude-motion-design skill (MIT, see NOTICE.md); the word DOM
// (mask + inner span) is ported from the earlier adaptation.
import {lineWords} from '../lib/lyric-timing.js';
import {LyricRegistrations, unregisteredLinesError} from '../lib/registry.js';
import {hashString, rng} from '../lib/rng.js';
import {ENTER_LEAD_FRAMES, publicSchedules, scheduleLines} from '../lib/exits.js';
import {ENTRANCES, enterPose, enterProgress, exitPose, EXITS, HELD} from '../lib/text-motion.js';
import {setStyle} from './layers.js';

/** Seconds of tolerance when comparing t with schedule times (far below a frame at any fps). */
const T_EPS = 1e-7;

/** Mask room around each word (em): accents above, descenders (g j p q y) below. */
const MASK_ROOM = {top: 0.4, side: 0.4, bottom: 0.45};

const STYLE_KEYS = new Set([
  'x', 'y', 'w', 'anchor', 'align', 'font', 'size', 'weight', 'color', 'lineHeight', 'letterSpacing', 'italic', 'uppercase',
  'balance', 'css', 'wordCss', 'accent', 'accentColor', 'breaks', 'z',
  'enter', 'enterDur', 'enterEase', 'spring', 'exit', 'exitDur', 'stagger', 'exitAt', 'linger', 'exitBy', 'pairWith', 'lead', 'suckTo',
]);

/**
 * @typedef {object} LyricStyle Options for ctx.lyric(id, style); every key is optional.
 * @property {number} [x] Left edge of the line block, px. Default: title-safe inset.
 * @property {number} [y] Vertical position, px (see anchor). Default: page centre.
 * @property {number} [w] Block width, px. Default: page width minus both title-safe insets.
 * @property {'top' | 'center' | 'bottom'} [anchor] What y refers to. Default 'center'.
 * @property {'left' | 'center' | 'right'} [align] Default 'center'.
 * @property {'display' | 'body' | string} [font] Theme font role or a CSS font-family. Default 'display'.
 * @property {number} [size] px. Default theme.sizes.lyric.
 * @property {number} [weight] Default theme.weights.bold.
 * @property {string} [color] Default theme.colors.text.
 * @property {number} [lineHeight] Default 1.12.
 * @property {string} [letterSpacing] Default '-0.01em'.
 * @property {boolean} [italic]
 * @property {boolean} [uppercase]
 * @property {boolean} [balance] Balanced wrapping (no stranded last word). Default true.
 * @property {string} [css] Extra CSS for the block.
 * @property {(k: number, word: string) => string} [wordCss] Extra CSS per word (static: applied once).
 * @property {number[]} [accent] Word indices drawn in accentColor.
 * @property {string} [accentColor] Default theme.colors.accent.
 * @property {number[]} [breaks] Word indices to start a new row at.
 * @property {number} [z] Stacking order within #txt.
 * @property {string} [enter] Entrance: rise, drop, slam, blur, fade, side, zoom, flip, type, none. Default 'rise'.
 * @property {number} [enterDur] Default 0.42 s.
 * @property {string} [enterEase] Default 'o5'.
 * @property {string | {freq: number, damping: number}} [spring] Spring preset for the entrance instead of the easing.
 * @property {string | {suck: [number, number]}} [exit] Exit: fade, fall, up, down, blur, scatter, shrink, left, right, cut,
 *   suck (into suckTo), or {suck: [x, y]}. Default 'fade'.
 * @property {number} [exitDur] Default 0.35 s.
 * @property {number} [stagger] Seconds between words' exit starts. Default 0.035.
 * @property {number | 'hold'} [exitAt] Requested exit start; default last sung word + linger.
 * @property {number} [linger] Default 1.0 s.
 * @property {number} [exitBy] Absolute seconds the line must be gone by.
 * @property {string} [pairWith] The next line's id, shown together with this one.
 * @property {number} [lead] Reveal words this many seconds early. Default 0.
 * @property {[number, number]} [suckTo] Page px target for the suck exit. Default the block's centre.
 */

export class LyricLayer {
  /**
   * @param {object} o
   * @param {HTMLElement} o.txt
   * @param {readonly import('../lib/lyrics.js').LyricLine[]} o.lines Lines in effect, each with an id.
   * @param {import('./theme.js').Theme} o.theme
   * @param {{width: number, height: number}} o.page
   * @param {number} o.fps
   * @param {number} o.duration
   */
  constructor({txt, lines, theme, page, fps, duration}) {
    this.txt = txt;
    this.lines = lines;
    this.theme = theme;
    this.page = page;
    this.fps = fps;
    this.duration = duration;
    this.lead = ENTER_LEAD_FRAMES / fps;
    this.reg = new LyricRegistrations(lines);
    /** @type {Map<string, any>} */
    this.drawn = new Map();
    this.sched = new Map();
  }

  /**
   * Register a line (called through ctx.lyric during setup).
   * @param {string} id
   * @param {string} section
   * @param {LyricStyle} style
   */
  register(id, section, style = {}) {
    for (const k of Object.keys(style)) {
      if (!STYLE_KEYS.has(k)) throw new Error(`lyric "${id}": unknown style option "${k}"`);
    }
    const exitKind = typeof style.exit === 'object' && style.exit !== null ? 'suck' : (style.exit ?? 'fade');
    if (!ENTRANCES.includes(style.enter ?? 'rise')) throw new Error(`lyric "${id}": enter must be one of ${ENTRANCES.join(', ')}`);
    if (!EXITS.includes(exitKind)) throw new Error(`lyric "${id}": exit must be one of ${EXITS.join(', ')}`);
    const line = this.lines.find((l) => l.id === id);
    if (line && lineWords(line).length === 0) throw new Error(`lyric "${id}" has no words to show`);
    this.reg.register(id, section, {...style, exit: exitKind, suckTo: style.suckTo ?? (exitKind === 'suck' && typeof style.exit === 'object' ? style.exit.suck : undefined)});
    return {id, line};
  }

  /**
   * After every setup: check registrations (render mode: every line must be
   * registered), build and lay out the DOM, and schedule every line.
   * @param {{render: boolean}} mode
   * @returns {string[]} Warnings (preview mode: unregistered lines).
   */
  finalize({render}) {
    const missing = this.reg.missing(this.lines);
    const msg = unregisteredLinesError(missing);
    if (msg && render) throw new Error(msg);
    const options = this.reg.options();
    this.sched = scheduleLines(this.lines, options, {fps: this.fps, duration: this.duration});
    for (const line of this.lines) {
      const style = options.get(line.id);
      if (style) this.drawn.set(line.id, this.build(line, style));
    }
    for (const d of this.drawn.values()) this.layout(d);
    return msg ? [msg] : [];
  }

  /** @private */
  build(line, s) {
    const {theme, page} = this;
    const font = s.font === undefined || s.font === 'display' ? theme.fonts.display : s.font === 'body' ? theme.fonts.body : s.font;
    const st = {
      x: s.x ?? theme.safe.title.x,
      w: s.w ?? page.width - 2 * theme.safe.title.x,
      y: s.y ?? page.height / 2,
      anchor: s.anchor ?? 'center',
    };
    const el = document.createElement('div');
    el.className = 'ly';
    el.dataset.line = line.id;
    el.style.cssText =
      `position:absolute;left:${st.x}px;top:${st.y}px;width:${st.w}px;text-align:${s.align ?? 'center'};` +
      `font-family:${font};font-size:${s.size ?? theme.sizes.lyric}px;font-weight:${s.weight ?? theme.weights.bold};` +
      `line-height:${s.lineHeight ?? 1.12};letter-spacing:${s.letterSpacing ?? '-0.01em'};color:${s.color ?? theme.colors.text};` +
      `${s.italic ? 'font-style:italic;' : ''}${s.uppercase ? 'text-transform:uppercase;' : ''}` +
      `text-wrap:${s.balance === false ? 'wrap' : 'balance'};white-space:normal;visibility:hidden;` +
      `font-kerning:normal;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;${s.css ?? ''}`;
    if (s.z !== undefined) el.style.zIndex = String(s.z);
    const sched = this.sched.get(line.id);
    const seed = hashString(line.id);
    const words = sched.words.map((w, k) => {
      const m = document.createElement('span');
      m.className = 'wm';
      m.dataset.word = String(k);
      m.style.cssText =
        `display:inline-block;vertical-align:top;padding:${MASK_ROOM.top}em ${MASK_ROOM.side}em ${MASK_ROOM.bottom}em;` +
        `margin:-${MASK_ROOM.top}em -${MASK_ROOM.side}em -${MASK_ROOM.bottom}em`;
      const inner = document.createElement('span');
      inner.className = 'wi';
      inner.style.cssText = 'display:inline-block;transform-origin:50% 70%;visibility:hidden';
      if (s.accent?.includes(k)) inner.style.color = s.accentColor ?? theme.colors.accent;
      const extra = s.wordCss ? s.wordCss(k, w.text) : '';
      if (extra) inner.style.cssText += extra;
      let chars = null;
      if ((s.enter ?? 'rise') === 'type') {
        chars = [...w.text].map((ch) => {
          const c = document.createElement('span');
          c.textContent = ch;
          inner.appendChild(c);
          return c;
        });
      } else {
        inner.textContent = w.text;
      }
      m.appendChild(inner);
      el.appendChild(m);
      if (k < sched.words.length - 1) el.appendChild(s.breaks?.includes(k + 1) ? document.createElement('br') : document.createTextNode(' '));
      const r = rng(seed + k * 7919);
      return {m, inner, chars, sched: w, r1: r() * 2 - 1, r2: r() * 2 - 1, baseFilter: inner.style.filter || '', cx: 0, cy: 0};
    });
    this.txt.appendChild(el);
    return {line, s, st, el, words, sched};
  }

  /** @private Anchor the block and measure word centres (fonts are loaded by now). */
  layout(d) {
    const {el, st} = d;
    if (st.anchor === 'center') el.style.top = `${Math.round(st.y - el.offsetHeight / 2)}px`;
    else if (st.anchor === 'bottom') el.style.top = `${Math.round(st.y - el.offsetHeight)}px`;
    const target = d.s.suckTo ?? [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2];
    for (const w of d.words) {
      w.cx = el.offsetLeft + w.m.offsetLeft + w.m.offsetWidth / 2;
      w.cy = el.offsetTop + w.m.offsetTop + w.m.offsetHeight / 2;
      w.dx = target[0] - w.cx;
      w.dy = target[1] - w.cy;
    }
  }

  /** Draw every registered line at t. */
  draw(t) {
    const sx = this.page.width / 1920;
    const sy = this.page.height / 1080;
    for (const d of this.drawn.values()) {
      const {sched, s} = d;
      // Times compare with a hair of tolerance: t = n / fps and a bound like next - 2 / fps may differ in the last bit.
      const on = t >= sched.first - T_EPS && t < sched.exitEnd - T_EPS;
      setStyle(d.el, 'visibility', on ? 'visible' : 'hidden');
      if (!on) continue;
      const enter = s.enter ?? 'rise';
      for (const w of d.words) {
        const ws = w.sched;
        const gone = t >= (ws.exitDur > 0 ? ws.exitEnd : ws.exitStart) - T_EPS;
        if (t < ws.reveal - T_EPS || gone) {
          setStyle(w.inner, 'visibility', 'hidden');
          continue;
        }
        let pose;
        if (t > ws.exitStart + T_EPS) {
          pose = exitPose(s.exit, (t - ws.exitStart) / (ws.exitEnd - ws.exitStart), {r1: w.r1, r2: w.r2, sx, sy, dx: w.dx, dy: w.dy});
        } else {
          // The entrance runs from one frame before the reveal (ENTER_LEAD_FRAMES), so the reveal frame shows the word.
          const dt = Math.max(0, t - ws.reveal) + this.lead;
          // Held from the schedule's settle time (the same number lines() reports), so holds are exact.
          pose = t >= ws.settled - T_EPS ? HELD : enterPose(enter, enterProgress(s, dt, ws.sung), {dt, wordDur: ws.sung, chars: w.chars?.length ?? 0});
        }
        setStyle(w.inner, 'visibility', 'inherit');
        setStyle(w.inner, 'transform', pose.transform);
        setStyle(w.inner, 'opacity', pose.opacity >= 1 ? '1' : String(Math.max(0, Number(pose.opacity.toFixed(4)))));
        const filter = [w.baseFilter, pose.filter === 'none' ? '' : pose.filter].filter(Boolean).join(' ') || 'none';
        setStyle(w.inner, 'filter', filter);
        setStyle(w.m, 'clipPath', pose.clip ? 'inset(0)' : 'none');
        if (w.chars) {
          const shown = pose.chars ?? w.chars.length;
          w.chars.forEach((c, j) => setStyle(c, 'visibility', j < shown ? 'inherit' : 'hidden'));
        }
      }
    }
  }

  /** window.__mv.lines(): every registered line's schedule and its words' schedules, in lyrics.json order (src/lib/exits.js publicSchedules). */
  schedules() {
    return publicSchedules(this.sched.values());
  }
}
