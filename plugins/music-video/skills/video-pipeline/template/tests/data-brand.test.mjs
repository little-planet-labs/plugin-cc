import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {fontStack, neutralScale, parseBrand, toPageUrl, toStaticPath} from '../src/lib/brand.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const rawBrand = readJson('../src/brand.json');
const placeholderBrand = readJson('./fixtures/data-brand.placeholder.json');

// Mutable deep copies of the template's placeholder brand (a fixture, so these
// tests mean the same thing once src/brand.json holds a real company), edited
// freely to build invalid inputs.
const base = () => structuredClone(placeholderBrand);

describe('parseBrand', () => {
  it('accepts the committed brand.json and keeps every neutral step', () => {
    const brand = parseBrand(rawBrand);
    assert.ok(brand.name.trim() !== '');
    // Every step brand.json lists ("$comment" aside) survives parsing unchanged.
    const listed = {...rawBrand.colors.neutral};
    delete listed.$comment;
    assert.deepEqual(brand.colors.neutral, listed);
    assert.ok(Object.keys(brand.colors.neutral).length >= 3);
    assert.equal(brand.logo.path, rawBrand.logo.path);
  });

  it('accepts the placeholder brand and keeps every neutral step', () => {
    const brand = parseBrand(placeholderBrand);
    assert.equal(brand.name, 'Example Company');
    assert.deepEqual(Object.keys(brand.colors.neutral), ['50', '100', '300', '500', '700', '900']);
    assert.equal(brand.logo.path, 'public/brand/logo.svg');
  });

  it('accepts optional logo variants and local font files', () => {
    const raw = base();
    raw.logo = {path: 'public/brand/logo.svg', onDark: 'public/brand/logo-on-dark.svg', onLight: 'public/brand/logo-on-light.svg'};
    raw.fonts.body = {family: 'Brand Sans', source: 'local', weights: [400, 700], files: {'400': 'public/brand/fonts/r.woff2'}};
    const brand = parseBrand(raw);
    assert.equal(brand.logo.onDark, 'public/brand/logo-on-dark.svg');
    assert.deepEqual(brand.fonts.body.files, {'400': 'public/brand/fonts/r.woff2'});
  });

  it('rejects a missing or malformed color, naming the field', () => {
    const missing = base();
    delete missing.colors.accent;
    assert.throws(() => parseBrand(missing), /colors\.accent must be a hex color/);
    const bad = base();
    bad.colors.primary = 'blue';
    assert.throws(() => parseBrand(bad), /colors\.primary must be a hex color .*"blue"/);
  });

  it('neutral: any >= 3 numeric steps (sorted lightest first); fewer, or a non-numeric key, is rejected', () => {
    const raw = base();
    raw.colors.neutral = {'900': '#111111', '50': '#FAFAFA', '500': '#888888'};
    assert.deepEqual(neutralScale(parseBrand(raw).colors.neutral), ['#FAFAFA', '#888888', '#111111']);
    raw.colors.neutral = {'50': '#FAFAFA', '900': '#111111'};
    assert.throws(() => parseBrand(raw), /colors\.neutral must be at least 3 steps/);
    raw.colors.neutral = {light: '#FAFAFA', '500': '#888888', '900': '#111111'};
    assert.throws(() => parseBrand(raw), /colors\.neutral\.light must be keyed by a step number/);
  });

  it('rejects unknown keys, bad font source/weights and paths outside public/', () => {
    const typo = base();
    typo.colours = {};
    assert.throws(() => parseBrand(typo), /root\.colours must be one of/);
    const source = base();
    source.fonts.display.source = 'adobe';
    assert.throws(() => parseBrand(source), /fonts\.display\.source must be "google" or "local"/);
    const weight = base();
    weight.fonts.display.weights = [450];
    assert.throws(() => parseBrand(weight), /fonts\.display\.weights\[0\] must be 100/);
    const logo = base();
    logo.logo.path = 'brand/logo.svg';
    assert.throws(() => parseBrand(logo), /logo\.path must be a path under public\//);
    const files = base();
    files.fonts.display.files = {'400': 'public/x.woff2'};
    assert.throws(() => parseBrand(files), /fonts\.display\.files must be absent unless source is "local"/);
  });

  // Contract parity: every rule parseBrand enforces, one bad input each, with
  // the error naming the field (the cases above plus every rule they missed).
  it('parseBrand rejects each invalid field with an error naming it', () => {
    const local = (patch) => (r) => void (r.fonts.body = {family: 'Brand Sans', source: 'local', weights: [400], ...patch});
    const cases = [
      ['root not an object', () => ({replace: []}), /brand\.json: root must be an object/],
      ['name blank', (r) => void (r.name = '  '), /brand\.json: name must be a non-empty string/],
      ['colors not an object', (r) => void (r.colors = '#fff'), /brand\.json: colors must be an object/],
      ['unknown colors key', (r) => void (r.colors.highlight = '#fff'), /brand\.json: colors\.highlight must be one of .*unknown key/],
      ['neutral not an object', (r) => void (r.colors.neutral = ['#fff']), /brand\.json: colors\.neutral must be an object of step number/],
      ['neutral step not hex', (r) => void (r.colors.neutral['500'] = 'grey'), /brand\.json: colors\.neutral\.500 must be a hex color/],
      ['fonts not an object', (r) => void (r.fonts = 'Inter'), /brand\.json: fonts must be an object with display and body/],
      ['unknown fonts key', (r) => void (r.fonts.mono = r.fonts.body), /brand\.json: fonts\.mono must be one of/],
      ['font not an object', (r) => void (r.fonts.body = 'Inter'), /brand\.json: fonts\.body must be an object/],
      ['unknown font key', (r) => void (r.fonts.body.style = 'italic'), /brand\.json: fonts\.body\.style must be one of/],
      ['family blank', (r) => void (r.fonts.display.family = ''), /brand\.json: fonts\.display\.family must be a non-empty string/],
      ['weights empty', (r) => void (r.fonts.body.weights = []), /brand\.json: fonts\.body\.weights must be a non-empty array/],
      ['files not an object', local({files: ['public/a.woff2']}), /brand\.json: fonts\.body\.files must be an object of weight -> path/],
      ['files weight not listed', local({files: {'700': 'public/a.woff2'}}), /brand\.json: fonts\.body\.files\.700 must be a weight listed in fonts\.body\.weights/],
      ['files path outside public/', local({files: {'400': 'fonts/a.woff2'}}), /brand\.json: fonts\.body\.files\.400 must be a path under public\//],
      ['logo not an object', (r) => void (r.logo = 'public/brand/logo.svg'), /brand\.json: logo must be an object with a path/],
      ['unknown logo key', (r) => void (r.logo.mark = 'public/brand/m.svg'), /brand\.json: logo\.mark must be one of/],
      ['logo path with ..', (r) => void (r.logo.path = 'public/../secret.svg'), /brand\.json: logo\.path must be a path under public\//],
      ['onDark outside public/', (r) => void (r.logo.onDark = 'brand/d.svg'), /brand\.json: logo\.onDark must be a path under public\//],
      ['onLight outside public/', (r) => void (r.logo.onLight = '/abs/l.svg'), /brand\.json: logo\.onLight must be a path under public\//],
    ];
    for (const [label, mutate, pattern] of cases) {
      const raw = base();
      const input = mutate(raw)?.replace ?? raw;
      assert.throws(() => parseBrand(input), pattern, label);
    }
  });

  it('toStaticPath strips public/ and fontStack quotes the family with a fallback', () => {
    assert.equal(toStaticPath('public/brand/logo.svg'), 'brand/logo.svg');
    assert.equal(fontStack({family: 'Open Sans', source: 'google', weights: [400]}), '"Open Sans", system-ui, sans-serif');
  });

  it('toPageUrl keeps the project-relative path and percent-encodes each segment', () => {
    assert.equal(toPageUrl('public/brand/logo.svg'), 'public/brand/logo.svg');
    assert.equal(toPageUrl('public/fonts/Brand Sans #1.woff2'), 'public/fonts/Brand%20Sans%20%231.woff2');
  });
});
