import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import rawBrand from '../src/brand.json';
import {neutralScale, parseBrand, toStaticPath} from '../src/lib/brand';
import {fontStack} from '../src/lib/fonts';

// Mutable deep copies, edited freely to build invalid inputs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const base = (): any => structuredClone(rawBrand);

describe('parseBrand', () => {
  it('accepts the committed placeholder brand.json and keeps every neutral step', () => {
    const brand = parseBrand(rawBrand);
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

  it('toStaticPath strips public/ and fontStack quotes the family with a fallback', () => {
    assert.equal(toStaticPath('public/brand/logo.svg'), 'brand/logo.svg');
    assert.equal(fontStack({family: 'Open Sans', source: 'google', weights: [400]}), '"Open Sans", system-ui, sans-serif');
  });
});
