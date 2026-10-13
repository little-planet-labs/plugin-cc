// Engine helpers: the camera interpolates zoom in log space and holds its end
// keys; settleZoom lands on exactly 1; shake and flashes are exactly 0 outside
// their span; the shatter's 64 shards cover the whole frame at the impact;
// colour helpers; the theme scales sizes and safe areas; the font plan needs
// the manifest for Google fonts; `pnpm still` arguments.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {cameraAt, settleZoom, validateCameraKeys} from '../src/lib/camera.js';
import {contrast, hexToRgba, mix, rgba} from '../src/lib/color.js';
import {flashAmount, pulse} from '../src/lib/pulse.js';
import {hash, mulberry32, rng} from '../src/lib/rng.js';
import {shakeOffset} from '../src/lib/shake.js';
import {buildShards, insideConvex, offsetPolygon, SHARD_OVERLAP} from '../src/lib/shatter.js';
import {parseBrand} from '../src/lib/brand.js';
import {buildTheme} from '../src/engine/theme.js';
import {fontWarnings, planFonts} from '../src/engine/fonts.js';
import {parseStillArgs} from '../scripts/still.mjs';

describe('camera', () => {
  it('zoom moves in log space: the eased midpoint of a linear segment is the geometric mean', () => {
    const keys = [[0, 1, 0, 0], [2, 4, 100, -50]];
    const mid = cameraAt(keys, 1, 'linear');
    assert.ok(Math.abs(mid.zoom - 2) < 1e-12);
    assert.deepEqual([mid.x, mid.y], [50, -25]);
    assert.deepEqual(cameraAt(keys, -1), {zoom: 1, x: 0, y: 0});
    assert.deepEqual(cameraAt(keys, 9), {zoom: 4, x: 100, y: -50});
  });
  it('settleZoom is z0 up to t0 and exactly 1 from t1', () => {
    assert.equal(settleZoom(0, 1, 2, 1.2), 1.2);
    assert.equal(settleZoom(2, 1, 2, 1.2), 1);
    assert.equal(settleZoom(5, 1, 2, 1.2), 1);
  });
  it('keys are validated', () => {
    assert.throws(() => validateCameraKeys([[0, 0, 0, 0]]), /zoom must be > 0/);
    assert.throws(() => validateCameraKeys([[1, 1, 0, 0], [1, 2, 0, 0]]), /time must be after/);
  });
});

describe('shake, flash, pulse', () => {
  it('shake is exactly 0 before its impact and from impact + dur on, and moves between', () => {
    const o = {at: 2, dur: 0.4, amp: 20};
    assert.deepEqual(shakeOffset(1.99, o), {x: 0, y: 0, r: 0});
    assert.deepEqual(shakeOffset(2.4, o), {x: 0, y: 0, r: 0});
    assert.deepEqual(shakeOffset(9, o), {x: 0, y: 0, r: 0});
    const r = mulberry32(3);
    let moved = 0;
    for (let i = 0; i < 50; i++) {
      const s = shakeOffset(2 + r() * 0.4, o);
      assert.ok(Math.abs(s.x) <= 20 && Math.abs(s.y) <= 20);
      if (s.x !== 0) moved++;
    }
    assert.ok(moved > 40);
    assert.deepEqual(shakeOffset(2.1, o), shakeOffset(2.1, o), 'a pure function of t');
  });
  it('a flash is 0 before its hit and exactly 0 once it decays below 0.002; a pulse likewise', () => {
    assert.equal(flashAmount(0.9, {at: 1}), 0);
    assert.equal(flashAmount(1, {at: 1}), 0.4);
    assert.equal(flashAmount(2, {at: 1}), 0);
    assert.equal(pulse(Infinity), 0);
    assert.equal(pulse(0), 1);
    assert.equal(pulse(5), 0);
  });
});

describe('shatter', () => {
  it('the 64 shards cover every sampled point of the frame at the impact (seeded, same every time)', () => {
    for (const [x, y, seed] of [[960, 540, 'a'], [10, 1000, 'b'], [1900, 20, 3]]) {
      const shards = buildShards({x, y, width: 1920, height: 1080, seed});
      assert.equal(shards.length, 64);
      assert.deepEqual(buildShards({x, y, width: 1920, height: 1080, seed}), shards);
      const polys = shards.map((s) => offsetPolygon(s.points, SHARD_OVERLAP));
      for (let py = 0; py <= 1080; py += 27) {
        for (let px = 0; px <= 1920; px += 32) {
          assert.ok(polys.some((p) => insideConvex(p, px, py)), `(${px}, ${py}) uncovered (impact ${x},${y})`);
        }
      }
    }
  });
});

describe('colour, rng', () => {
  it('parses hex forms, mixes and applies alpha', () => {
    assert.deepEqual(hexToRgba('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(hexToRgba('#11223380'), [17, 34, 51, 128 / 255]);
    assert.equal(rgba('#000000', 0.5), 'rgba(0,0,0,0.5)');
    assert.equal(mix('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
    assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
    assert.throws(() => hexToRgba('red'), /not a hex colour/);
  });
  it('seeded generators repeat; hash is stateless', () => {
    assert.deepEqual([rng('x')(), rng('x')()], [rng('x')(), rng('x')()]);
    assert.notEqual(rng('x')(), rng('y')());
    assert.equal(hash(12, 3), hash(12, 3));
  });
});

describe('theme and fonts', () => {
  // The template's placeholder brand (a fixture copy), never the running project's src/brand.json.
  const brand = parseBrand(JSON.parse(readFileSync(new URL('./fixtures/data-brand.placeholder.json', import.meta.url), 'utf8')));
  it('takes colours from the brand and scales sizes and safe areas to the page', () => {
    const t = buildTheme(brand, {width: 1920, height: 1080});
    assert.equal(t.colors.background, brand.colors.background);
    assert.equal(t.sizes.lyric, 84);
    assert.deepEqual(t.safe.title, {x: 192, y: 108});
    assert.equal(t.weights.bold, 700);
    const small = buildTheme(brand, {width: 960, height: 540});
    assert.equal(small.sizes.lyric, 42);
    assert.deepEqual(small.safe.title, {x: 96, y: 54});
  });
  it('a local font weight without a file is a warning naming it; Google fonts and listed files are not', () => {
    assert.deepEqual(fontWarnings(brand), []);
    const local = {...brand, fonts: {display: {family: 'B', source: 'local', weights: [400, 700], files: {400: 'public/b.woff2'}}, body: {family: 'B', source: 'local', weights: [400], files: {400: 'public/b.woff2'}}}};
    assert.deepEqual(fontWarnings(local), ['brand.json fonts.display/body: "B" weight 700 has no file; the machine\'s installed fonts (or a fallback) will be used']);
    // A family shared by display and body is loaded as one group (planFonts): a file listed on either role covers the weight.
    const shared = {...brand, fonts: {display: {family: 'B', source: 'local', weights: [400], files: {400: 'public/b4.woff2'}}, body: {family: 'B', source: 'local', weights: [400, 700], files: {700: 'public/b7.woff2'}}}};
    assert.deepEqual(fontWarnings(shared), []);
    assert.deepEqual(planFonts(shared, null).map((p) => [p.weight, p.file]).sort(), [[400, 'public/b4.woff2'], [700, 'public/b7.woff2']]);
  });
  it('the font plan needs the manifest for Google families and every weight in it', () => {
    assert.throws(() => planFonts(brand, null), /public\/fonts\/fonts\.json is missing .*run pnpm fonts/);
    const faces = [300, 400, 600, 700, 800].map((weight) => ({family: 'Inter', weight, style: 'normal', file: `public/fonts/i-${weight}.woff2`}));
    assert.equal(planFonts(brand, {faces}).length, 5, 'display and body share Inter: one face per weight');
    assert.throws(() => planFonts(brand, {faces: faces.slice(1)}), /font "Inter" weight 300 is not in public\/fonts\/fonts\.json; run pnpm fonts/);
  });
});

describe('pnpm still arguments', () => {
  it('parses frame, t, scale, textonly, scenes and out in both forms', () => {
    assert.deepEqual(parseStillArgs([]), {frame: null, t: null, scale: 1, textonly: false, scenes: null, out: 'out/still.png'});
    assert.deepEqual(parseStillArgs(['--frame=12', '--scale=2', '--textonly', '--scenes=src/scenes/alt.js', '--out', 'out/x.png']), {
      frame: 12, t: null, scale: 2, textonly: true, scenes: 'src/scenes/alt.js', out: 'out/x.png',
    });
    assert.equal(parseStillArgs(['--t', '1.5']).t, 1.5);
    assert.equal(parseStillArgs(['--out=out/y.png']).out, 'out/y.png');
  });
  it('refuses bad values with a plain message', () => {
    assert.throws(() => parseStillArgs(['--frame=-1']), /--frame needs a frame number >= 0/);
    assert.throws(() => parseStillArgs(['--frame=1', '--t=1']), /give --frame or --t, not both/);
    assert.throws(() => parseStillArgs(['--out=out/x.jpg']), /--out must end in \.png/);
    assert.throws(() => parseStillArgs(['--scenes=../x.js']), /scenes must be a project-relative module path/);
    assert.throws(() => parseStillArgs(['--bogus']), /unexpected argument "--bogus"/);
    assert.throws(() => parseStillArgs(['--out']), /--out needs a value/);
  });
});

describe('energy swell (ported from useEnergySwell)', () => {
  const analysisWith = (tempo, frames, fn) => ({
    tempo,
    beatsPerBar: 4,
    energy: {low: Array.from({length: frames}, (_, f) => fn(f)), mid: Array.from({length: frames}, (_, f) => fn(f)), high: []},
  });

  it('no beat-rate ripple: a pulse on every beat is flattened to a near-constant swell', async () => {
    const {energySwell} = await import('../src/lib/swell.js');
    for (const tempo of [120, 130, 97]) {
      const fps = 30;
      const beat = (60 / tempo) * fps;
      // 0.5 +/- 0.4 at the beat rate (input ripple 0.8 peak to peak).
      const a = analysisWith(tempo, 1200, (f) => 0.5 + 0.4 * Math.cos((2 * Math.PI * f) / beat));
      const mid = Array.from({length: 400}, (_, i) => energySwell(a, 400 + i, fps));
      const ripple = Math.max(...mid) - Math.min(...mid);
      assert.ok(ripple < 0.8 * 0.05, `${tempo} BPM: swell ripple ${ripple.toFixed(4)} is not below 5% of the input's 0.8`);
      assert.ok(Math.abs(mid[0] - 0.5) < 0.02);
    }
  });

  it('holds the end values: a constant song swells to that constant on the first and last frames (no dip at the ends)', async () => {
    const {energySwell} = await import('../src/lib/swell.js');
    const a = analysisWith(120, 300, () => 0.7);
    for (const f of [0, 1, 150, 298, 299]) assert.ok(Math.abs(energySwell(a, f, 30) - 0.7) < 1e-12, `frame ${f}: ${energySwell(a, f, 30)}`);
    const ramp = analysisWith(120, 300, (f) => (f < 150 ? 0.2 : 0.9));
    assert.ok(Math.abs(energySwell(ramp, 0, 30) - 0.2) < 1e-12, 'the first frame is the start level, not pulled toward 0');
    assert.ok(Math.abs(energySwell(ramp, 299, 30) - 0.9) < 1e-12, 'the last frame is the end level');
  });
});
