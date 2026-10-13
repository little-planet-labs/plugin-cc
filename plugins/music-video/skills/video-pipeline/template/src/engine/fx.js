// World and fx-layer effects: grain and vignette (in #fx, always under the
// text), the over-the-text flash (#over), shake and shatter (world only).
// No blend modes anywhere: blended layers composite as grey slabs in headless
// Chrome. Grain is plain light and dark speckles at an opacity.
import {rgba} from '../lib/color.js';
import {flashAmount} from '../lib/pulse.js';
import {hash, rng} from '../lib/rng.js';
import {shakeOffset} from '../lib/shake.js';
import {buildShards, offsetPolygon, shardPose, SHARD_OVERLAP} from '../lib/shatter.js';
import {assertNotText, makeEl, pageSize, setStyle} from './layers.js';

const GRAIN_TILE = 256;

/**
 * The fx layer: one grain div and one vignette div in #fx, one flash div in
 * #over. Scenes set levels on every draw (ctx.setFx, ctx.flash); the engine
 * resets them before each seek, so a level never leaks from an earlier seek.
 */
export class FxLayer {
  /**
   * @param {{fx: HTMLElement, over: HTMLElement}} layerEls
   * @param {number} fps
   * @param {string} flashColor
   */
  constructor({fx, over}, fps, flashColor) {
    this.fps = fps;
    this.flashColor = flashColor;
    const tile = document.createElement('canvas');
    tile.width = GRAIN_TILE;
    tile.height = GRAIN_TILE;
    const g = tile.getContext('2d');
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    const r = rng('grain');
    for (let i = 0; i < img.data.length; i += 4) {
      const light = r() < 0.5;
      const v = light ? 255 : 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(r() * 256);
    }
    g.putImageData(img, 0, 0);
    this.grain = makeEl(fx, 'div', {
      style: `inset:0;width:100%;height:100%;background-image:url(${tile.toDataURL()});background-size:${GRAIN_TILE}px ${GRAIN_TILE}px;opacity:0`,
    });
    this.vignette = makeEl(fx, 'div', {
      style: 'inset:0;width:100%;height:100%;background:radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,1) 100%);opacity:0',
    });
    this.flash = makeEl(over, 'div', {style: 'inset:0;width:100%;height:100%;opacity:0'});
    this.reset();
  }

  /** Levels back to off. */
  reset() {
    this.level = {grain: 0, vignette: 0};
    this.flashLevel = 0;
    this.flashFill = this.flashColor;
  }

  /** @param {{grain?: number, vignette?: number}} levels 0..1 each. */
  set(levels) {
    if (levels.grain !== undefined) this.level.grain = Math.max(0, Math.min(1, levels.grain));
    if (levels.vignette !== undefined) this.level.vignette = Math.max(0, Math.min(1, levels.vignette));
  }

  /** Raise the over-the-text flash to at least `a` this seek. */
  addFlash(a, color) {
    if (a > this.flashLevel) {
      this.flashLevel = Math.min(1, a);
      this.flashFill = color ?? this.flashColor;
    }
  }

  /** Write this seek's levels. Grain moves to a new hashed offset every frame. */
  draw(t) {
    const f = Math.round(t * this.fps);
    setStyle(this.grain, 'backgroundPosition', `${Math.floor(hash(f, 3) * GRAIN_TILE)}px ${Math.floor(hash(f, 5) * GRAIN_TILE)}px`);
    setStyle(this.grain, 'opacity', String(Number(this.level.grain.toFixed(4))));
    setStyle(this.vignette, 'opacity', String(Number(this.level.vignette.toFixed(4))));
    setStyle(this.flash, 'background', this.flashFill);
    setStyle(this.flash, 'opacity', String(Number(this.flashLevel.toFixed(4))));
  }
}

/**
 * Apply a shake to a world element (sets its transform; compose by hand with
 * shakeOffset when the element has its own transform).
 * @param {HTMLElement} el
 * @param {number} t
 * @param {import('../lib/shake.js').ShakeOptions} options
 */
export const applyShake = (el, t, options) => {
  assertNotText(el, 'shake');
  const s = shakeOffset(t, options);
  setStyle(el, 'transform', s.x === 0 && s.y === 0 && s.r === 0 ? 'none' : `translate(${s.x.toFixed(2)}px,${s.y.toFixed(2)}px) rotate(${s.r.toFixed(3)}deg)`);
};

/**
 * A seeded shatter of a source canvas onto a target 2D context (world only).
 * Before `at` it draws the source whole; from `at` the 64 shards fly out
 * under gravity, and an optional flash decays on top.
 * @param {{at: number, x?: number, y?: number, seed?: string | number, flash?: string, flashPeak?: number}} options
 */
export const createShatter = ({at, x, y, seed = 'shatter', flash, flashPeak = 0.6}) => {
  const {width, height} = pageSize();
  const ix = x ?? width / 2;
  const iy = y ?? height / 2;
  const shards = buildShards({x: ix, y: iy, width, height, seed});
  const polys = shards.map((s) => offsetPolygon(s.points, SHARD_OVERLAP));
  const reach = shards.map((s) => Math.max(...s.points.map(([px, py]) => Math.hypot(px - s.cx, py - s.cy))) + SHARD_OVERLAP);
  return {
    shards,
    /**
     * @param {CanvasRenderingContext2D} c Target context (from a world canvas's get()).
     * @param {HTMLCanvasElement | {el: HTMLCanvasElement}} source What breaks: a canvas drawn this seek.
     * @param {number} t
     */
    draw(c, source, t) {
      if (c.canvas && c.canvas.isConnected) assertNotText(c.canvas, 'shatter');
      const src = 'el' in source ? source.el : source;
      if (t < at) {
        c.drawImage(src, 0, 0, width, height);
        return;
      }
      const u = t - at;
      shards.forEach((s, k) => {
        const {dx, dy, angle} = shardPose(s, u, height);
        const cx = s.cx + dx;
        const cy = s.cy + dy;
        if (cx + reach[k] < 0 || cx - reach[k] > width || cy + reach[k] < 0 || cy - reach[k] > height) return;
        c.save();
        c.translate(cx, cy);
        c.rotate(angle);
        c.translate(-s.cx, -s.cy);
        c.beginPath();
        polys[k].forEach(([px, py], i) => (i === 0 ? c.moveTo(px, py) : c.lineTo(px, py)));
        c.closePath();
        c.clip();
        c.drawImage(src, 0, 0, width, height);
        c.restore();
      });
      const a = flash ? flashAmount(t, {at, peak: flashPeak}) : 0;
      if (a > 0) {
        c.fillStyle = rgba(flash, a);
        c.fillRect(0, 0, width, height);
      }
    },
  };
};
