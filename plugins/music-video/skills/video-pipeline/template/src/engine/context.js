// The per-section context a scene receives in setup(ctx) and draw(t, ctx).
// Everything time-related is in seconds on the absolute song timeline, and
// every beat, downbeat and section edge is snapped to the frame grid
// (k / fps), so "the frame a beat lands on" is the frame its hit shows.
import {cameraAt, cameraTransform, validateCameraKeys} from '../lib/camera.js';
import {progress} from '../lib/ease.js';
import {rng} from '../lib/rng.js';
import {shakeOffset} from '../lib/shake.js';
import {snapToFrame} from '../lib/subframes.js';
import {energyAtFrame, energySwell} from '../lib/swell.js';
import {beatFramesBetween, downbeatFramesBetween, getBeatState, lastEventIndexAtFrame} from '../lib/timing.js';
import {lineWords} from '../lib/lyric-timing.js';
import {flashAmount} from '../lib/pulse.js';
import {applyShake, createShatter} from './fx.js';
import {assertNotText, Canvas, makeEl, setStyle} from './layers.js';
import {makeLogo} from './logo.js';

/**
 * @typedef {object} ContextHost What the engine lends a context.
 * @property {import('../lib/project.js').Project} project
 * @property {import('./theme.js').Theme} theme
 * @property {import('../lib/brand.js').Brand} brand
 * @property {{render: boolean, textonly: boolean}} mode
 * @property {import('./text.js').LyricLayer} lyrics
 * @property {import('./fx.js').FxLayer} fx
 * @property {(t: number, label: string) => void} addCut
 * @property {(w: {a: number, b: number, samples: number, label: string}) => void} addBlur
 * @property {(p: Promise<unknown>) => void} addPending
 * @property {(msg: string) => void} warn
 * @property {() => boolean} inSetup True while scene setups run.
 */

/**
 * @param {object} o
 * @param {import('../lib/sections.js').PlacedSection} o.section
 * @param {number} o.index
 * @param {HTMLElement} o.root The section's own element in #world.
 * @param {ContextHost} o.host
 * @param {{transition: object | null, canvases: Canvas[]}} o.inst Engine-side instance record.
 */
export const makeContext = ({section, index, root, host, inst}) => {
  const {project, theme, brand, mode} = host;
  const {fps, width, height, analysis} = project;
  const frameTime = (s) => snapToFrame(s, fps);
  const snapAll = (times) => times.map(frameTime);
  const start = section.from / fps;
  const end = section.to / fps;
  const songBeats = snapAll(analysis.beats);
  const songDownbeats = snapAll(analysis.downbeats);
  const firstWordFrame = (l) => Math.round((lineWords(l)[0]?.start ?? l.start) * fps);
  const label = `section "${section.id}"`;
  const setupOnly = (what) => {
    if (!host.inSetup()) throw new Error(`${label}: ${what} can only be called in setup(ctx)`);
  };

  const ctx = {
    /** The section: id, scene key, variant, index, start/end (frame-aligned seconds), from/to (frames), rawStart (sections.json). */
    section: Object.freeze({
      id: section.id,
      scene: section.scene,
      variant: section.variant,
      index,
      start,
      end,
      from: section.from,
      to: section.to,
      durationInFrames: section.durationInFrames,
      rawStart: section.start,
    }),
    fps,
    width,
    height,
    /** Video length in seconds and frames. */
    duration: project.duration,
    frames: project.frames,
    /** true in capture mode (render=1), true when only the lyric layer shows (textonly=1). */
    render: mode.render,
    textonly: mode.textonly,
    theme,
    brand,
    /** The analysis in effect (overrides applied; the fallback grid when the track isn't analysed). */
    analysis,
    /** Beats / downbeats whose rounded frame lies in this section, as frame-aligned seconds. */
    // Membership by rounded frame (src/lib/timing.js): an event on a boundary belongs to exactly one section.
    beats: beatFramesBetween(analysis, section.from, section.to, fps).map((f) => f / fps),
    downbeats: downbeatFramesBetween(analysis, section.from, section.to, fps).map((f) => f / fps),
    /** Every beat / downbeat of the song, frame-aligned seconds. */
    song: Object.freeze({beats: songBeats, downbeats: songDownbeats}),
    /** Lyric lines whose first word is sung in this section, and every line in effect. */
    lines: project.lyrics.filter((l) => {
      const f = firstWordFrame(l);
      return f >= section.from && f < section.to;
    }),
    allLines: project.lyrics,
    /** The section's own element in #world; everything the scene makes goes inside it. */
    root,
    /** Free storage for the scene (setup writes, draw reads). */
    state: {},

    /** Seconds snapped to the frame grid. */
    frameTime,
    /** Eased progress of a move from t0 lasting dur (exact 0 before, exact 1 after). */
    progress,
    /** Beat state at t (src/lib/timing.js getBeatState at the frame of t). */
    beatAt: (t) => getBeatState(analysis, Math.round(t * fps), fps),
    /** Seconds since the most recent beat at or before t's frame (Infinity before the first). */
    sinceBeat: (t) => {
      const i = lastEventIndexAtFrame(analysis.beats, Math.round(t * fps), fps);
      return i < 0 ? Infinity : Math.max(0, t - songBeats[i]);
    },
    /** Seconds since the most recent downbeat (Infinity before the first). */
    sinceDownbeat: (t) => {
      const i = lastEventIndexAtFrame(analysis.downbeats, Math.round(t * fps), fps);
      return i < 0 ? Infinity : Math.max(0, t - songDownbeats[i]);
    },
    /** Band energy 0..1 at t ('low' | 'mid' | 'high'), interpolated between frames; 0 when silent. */
    energy: (t, band = 'low', smoothFrames = 1) => energyAtFrame(analysis, band, t * fps, smoothFrames),
    /** Slow 0..1 energy swell (bar-length triangle filter, no beat ripple). */
    swell: (t, options) => energySwell(analysis, t * fps, fps, options),
    /** A seeded PRNG unique to this section and seed. */
    rng: (seed = '') => rng(`${section.id}:${seed}`),

    /** Make an element in the section root: a tag name ('div') or an HTML string. */
    el: (spec, opts) => makeEl(root, spec, opts),
    /** A DPR-aware canvas in the section root ({z, width, height, x, y}); {offscreen: true} makes a detached one. */
    canvas: (opts = {}) => {
      const c = new Canvas(opts.offscreen ? null : root, opts);
      inst.canvases.push(c);
      return c;
    },
    /** Set an engine-cached style property on a world element (cheap when unchanged). */
    style: (el, prop, value) => setStyle(el, prop, value),
    /** The brand logo as an <img> in the section root ({variant, height, x, y, z}). */
    logo: (opts) => {
      setupOnly('ctx.logo');
      const {el, ready} = makeLogo(root, brand.logo, opts, host.warn);
      host.addPending(ready);
      return el;
    },

    /** Register a lyric line (setup only). See src/engine/text.js LyricStyle for the options. */
    lyric: (id, style) => {
      setupOnly('ctx.lyric');
      return host.lyrics.register(id, section.id, style);
    },
    /** Declare this section's incoming transition (setup only). See src/lib/transitions.js. */
    transition: (spec) => {
      setupOnly('ctx.transition');
      if (inst.transition) throw new Error(`${label} declares a second transition`);
      inst.transition = spec;
    },
    /** Register a hard cut at t (default: the section start), frame-aligned. */
    cut: (t = start) => {
      setupOnly('ctx.cut');
      host.addCut(frameTime(t), label);
    },
    /** Declare a motion-blur window [a, b) (snapped to frames) with 2..16 samples. */
    blur: (a, b, samples = 4) => {
      setupOnly('ctx.blur');
      host.addBlur({a: frameTime(a), b: frameTime(b), samples, label});
    },
    /** A camera from keys [[t, zoom, x, y], ...]: returns t => {zoom, x, y}. */
    camera: (keys, ease) => {
      validateCameraKeys(keys);
      return (t) => cameraAt(keys, t, ease);
    },
    /**
     * Apply a camera state to a full-page world element at (0, 0) (never the lyric layer). The transform
     * carries its own pivot, so the origin is pinned to the element's top-left corner.
     */
    applyCamera: (el, k) => {
      assertNotText(el, 'camera');
      setStyle(el, 'transformOrigin', '0px 0px');
      setStyle(el, 'transform', cameraTransform(k, width, height));
    },
    /** Apply a camera state to a 2D context (call before drawing the world). */
    cameraOnCanvas: (c, k) => {
      c.translate(width / 2 + k.x, height / 2 + k.y);
      c.scale(k.zoom, k.zoom);
      c.translate(-width / 2, -height / 2);
    },
    /** Shake offset {x, y, r} at t (exactly 0 outside [at, at + dur)). */
    shakeOffset,
    /** Shake a world element at t. */
    shake: (el, t, opts) => applyShake(el, t, opts),
    /** A seeded shatter: returns {draw(c2d, sourceCanvas, t)}. Flash defaults to the theme flash colour. */
    shatter: (opts) => createShatter({flash: theme.colors.flash, ...opts}),
    /** Grain and vignette levels for this seek (0..1). The topmost active section wins. */
    setFx: (levels) => host.fx.set(levels),
    /** A flash over everything (#over, off in textonly) at t: {at, peak = 0.4, decay = 8, color}. */
    flash: (t, opts) => host.fx.addFlash(flashAmount(t, opts), opts.color),
  };
  return ctx;
};
