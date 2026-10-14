// The theme on a portrait page: type sizes scale with the short side of the
// page (so 1080x1920 gets the 1920x1080 sizes, not 1.78x them), every existing
// key on every landscape page is exactly what it was, and safe.social is the
// documented Reels / TikTok inset scaled with the page. Lyric exit travel
// (motionScale) uses the same short-side scale, uniform on both axes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {buildTheme} from '../src/engine/theme.js';
import {parseBrand} from '../src/lib/brand.js';
import {EXITS, exitPose, motionScale} from '../src/lib/text-motion.js';

const brand = parseBrand(JSON.parse(readFileSync(new URL('../src/brand.json', import.meta.url), 'utf8')));
const fixtureBrand = parseBrand(JSON.parse(readFileSync(new URL('./fixtures/data-brand.placeholder.json', import.meta.url), 'utf8')));

/**
 * buildTheme(the placeholder brand fixture, 1920x1080) as printed before the short-side type scale, every key
 * (safe.social is new). The fixture, not src/brand.json, so a project's own brand never changes the reference.
 */
const LANDSCAPE_1080P = {
  colors: {
    background: '#14161F',
    surface: '#20232F',
    primary: '#3B4CCA',
    primaryDeep: '#262F80',
    accent: '#F2B134',
    accentAlt: '#E85D75',
    text: '#FFFFFF',
    textMuted: '#B8BCCB',
    textOnLight: '#1C1F28',
    neutral: {50: '#F5F6F8', 100: '#E9EBF0', 300: '#C3C7D3', 500: '#868B9C', 700: '#4A4F60', 900: '#1C1F28'},
    neutralScale: ['#F5F6F8', '#E9EBF0', '#C3C7D3', '#868B9C', '#4A4F60', '#1C1F28'],
    light: '#F5F6F8',
    lightRaised: '#E9EBF0',
    neutralDark: '#1C1F28',
    neutralDarkRaised: '#4A4F60',
    flash: '#FFFFFF',
    black: '#000000',
  },
  fonts: {display: '"Inter", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif'},
  weights: {light: 300, regular: 400, semibold: 600, bold: 700, extraBold: 800},
  sizes: {lyric: 84, lyricSmall: 72, cinematic: 96, hit: 200, hitMax: 300},
  safe: {action: {x: 96, y: 54}, title: {x: 192, y: 108}},
};

/** The sizes and safe areas as the theme computed them before (height-scaled type), the reference for any page. */
const before = ({width, height}) => {
  const sx = width / 1920;
  const sy = height / 1080;
  return {
    sizes: {lyric: Math.round(84 * sy), lyricSmall: Math.round(72 * sy), cinematic: Math.round(96 * sy), hit: Math.round(200 * sy), hitMax: Math.round(300 * sy)},
    safe: {action: {x: Math.round(96 * sx), y: Math.round(54 * sy)}, title: {x: Math.round(192 * sx), y: Math.round(108 * sy)}},
  };
};

/** A plain-object copy (the theme is frozen; JSON keeps exactly its keys and values). */
const plain = (v) => JSON.parse(JSON.stringify(v));
const withoutSocial = (t) => {
  const {social, ...safe} = plain(t).safe;
  void social;
  return {...plain(t), safe};
};

describe('theme: landscape unchanged', () => {
  it('1920x1080: every key and value is what it was; the only new key is safe.social', () => {
    const t = buildTheme(fixtureBrand, {width: 1920, height: 1080});
    assert.deepEqual(withoutSocial(t), LANDSCAPE_1080P);
    assert.deepEqual(Object.keys(t.safe), ['action', 'title', 'social']);
  });
  it('on every landscape page size the sizes and safe areas equal the old height-scaled values exactly', () => {
    for (const page of [
      {width: 1920, height: 1080},
      {width: 960, height: 540},
      {width: 3840, height: 2160},
      {width: 1280, height: 720},
      {width: 1440, height: 1080},
      {width: 2560, height: 1080},
      {width: 1000, height: 1000},
      {width: 640, height: 360},
    ]) {
      const t = plain(buildTheme(fixtureBrand, page));
      const ref = before(page);
      assert.deepEqual(t.sizes, ref.sizes, `${page.width}x${page.height}`);
      assert.deepEqual({action: t.safe.action, title: t.safe.title}, ref.safe, `${page.width}x${page.height}`);
    }
  });
});

describe('theme: portrait', () => {
  it('1080x1920 type sizes are the 1920x1080 sizes (short side 1080), not 1.78x them', () => {
    const portrait = buildTheme(brand, {width: 1080, height: 1920});
    const landscape = buildTheme(brand, {width: 1920, height: 1080});
    assert.deepEqual(plain(portrait.sizes), plain(landscape.sizes));
    assert.deepEqual(plain(portrait.sizes), {lyric: 84, lyricSmall: 72, cinematic: 96, hit: 200, hitMax: 300});
    assert.notDeepEqual(plain(portrait.sizes), before({width: 1080, height: 1920}).sizes, 'the old height scaling gave 149 px lyrics here');
    // Colours, fonts and weights don't depend on the page.
    assert.deepEqual(plain(portrait.colors), plain(landscape.colors));
    assert.deepEqual(plain(portrait.fonts), plain(landscape.fonts));
    assert.deepEqual(plain(portrait.weights), plain(landscape.weights));
  });
  it('a half-size 540x960 draft page gets half the sizes, like the 960x540 landscape draft', () => {
    assert.deepEqual(plain(buildTheme(brand, {width: 540, height: 960}).sizes), plain(buildTheme(brand, {width: 960, height: 540}).sizes));
    assert.equal(buildTheme(brand, {width: 540, height: 960}).sizes.lyric, 42);
  });
  it('action and title are 5% and 10% of each side: {54, 96} and {108, 192} at 1080x1920', () => {
    const t = buildTheme(brand, {width: 1080, height: 1920});
    assert.deepEqual(plain(t.safe.action), {x: 54, y: 96});
    assert.deepEqual(plain(t.safe.title), {x: 108, y: 192});
  });
  it('safe.social is top 220, right 160, bottom 420, left 64 at 1080x1920, scaled with the page on each axis', () => {
    assert.deepEqual(plain(buildTheme(brand, {width: 1080, height: 1920}).safe.social), {top: 220, right: 160, bottom: 420, left: 64});
    assert.deepEqual(plain(buildTheme(brand, {width: 540, height: 960}).safe.social), {top: 110, right: 80, bottom: 210, left: 32});
    assert.deepEqual(plain(buildTheme(brand, {width: 2160, height: 3840}).safe.social), {top: 440, right: 320, bottom: 840, left: 128});
    // The same fractions of the frame on another shape.
    assert.deepEqual(plain(buildTheme(brand, {width: 1920, height: 1080}).safe.social), {
      top: Math.round((220 * 1080) / 1920),
      right: Math.round((160 * 1920) / 1080),
      bottom: Math.round((420 * 1080) / 1920),
      left: Math.round((64 * 1920) / 1080),
    });
    assert.ok(Object.isFrozen(buildTheme(brand, {width: 1080, height: 1920}).safe.social));
  });
});

describe('lyric exit travel (motionScale)', () => {
  it('on 1920x1080 and every 16:9 page it is exactly the old width / 1920, height / 1080', () => {
    for (const [width, height] of [[1920, 1080], [960, 540], [3840, 2160], [1280, 720], [640, 360]]) {
      assert.deepEqual(motionScale({width, height}), {sx: width / 1920, sy: height / 1080}, `${width}x${height}`);
    }
  });
  it('on 1920x1080 every exit pose is byte-for-byte what the old per-axis scale gave', () => {
    const old = {sx: 1920 / 1920, sy: 1080 / 1080};
    for (const kind of EXITS) {
      for (const v of [0.01, 0.1, 0.25, 0.5, 0.77, 0.99]) {
        for (const [r1, r2] of [[-1, 1], [0.3, -0.7], [0.9, 0.05]]) {
          const word = {r1, r2, dx: 123.5, dy: -45.25};
          assert.deepEqual(exitPose(kind, v, {...word, ...motionScale({width: 1920, height: 1080})}), exitPose(kind, v, {...word, ...old}), `${kind} ${v}`);
        }
      }
    }
  });
  it('is uniform on a portrait page: 1 both ways on 1080x1920 (not 0.5625 across and 1.78 down), 0.5 on the 540x960 draft', () => {
    assert.deepEqual(motionScale({width: 1080, height: 1920}), {sx: 1, sy: 1});
    assert.deepEqual(motionScale({width: 540, height: 960}), {sx: 0.5, sy: 0.5});
    const fall = (page) => exitPose('fall', 0.5, {r1: 1, r2: 0, ...motionScale(page)}).transform;
    assert.equal(fall({width: 1080, height: 1920}), fall({width: 1920, height: 1080}), 'a word falls the same distance on the portrait page');
  });
});
