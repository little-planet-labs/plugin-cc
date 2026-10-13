// Scene registry and lyric registration (the pure validators the page's boot
// calls; the boot itself is exercised in Chromium by
// tests/render/engine-boot-errors.test.mjs): an unknown scene key without a
// DEFAULT_SCENE fails naming the key and the known keys; a duplicate line
// registration fails naming the id and both sections; in render mode an
// unregistered line fails naming its id; a registration of an id that isn't in
// lyrics.json fails naming it.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {LyricRegistrations, resolveScene, unregisteredLinesError, validateRegistry, validateScenesPath} from '../src/lib/registry.js';
import {LyricLayer} from '../src/engine/text.js';
import * as templateRegistry from '../src/scenes/index.js';

const scene = {draw() {}};
const lines = [
  {id: 'v-1', text: 'one two', start: 1, end: 2},
  {id: 'v-2', text: 'three', start: 3, end: 4},
  {id: 'v-3', text: ' ', start: 5, end: 6},
];

describe('scene registry', () => {
  it('a key in SCENES resolves to its scene; a missing key resolves to DEFAULT_SCENE when there is one', () => {
    const reg = validateRegistry({SCENES: {verse: scene}, DEFAULT_SCENE: {draw() {}}});
    assert.equal(resolveScene(reg, 'verse'), scene);
    assert.equal(resolveScene(reg, 'chorus'), reg.DEFAULT_SCENE);
  });

  it('an unknown key with DEFAULT_SCENE null fails naming the key, the section and the known keys', () => {
    const reg = validateRegistry({SCENES: {verse: scene, chorus: scene}, DEFAULT_SCENE: null});
    assert.throws(() => resolveScene(reg, 'bridge', 'bridge-1'), /unknown scene key "bridge" \(section "bridge-1"\).*Known keys: verse, chorus/);
  });

  it('an inherited object key is not a scene ("constructor" is unknown)', () => {
    const reg = validateRegistry({SCENES: {}, DEFAULT_SCENE: null});
    assert.throws(() => resolveScene(reg, 'constructor'), /unknown scene key "constructor"/);
  });

  it('registry exports are validated: SCENES object, DEFAULT_SCENE present, draw functions', () => {
    assert.throws(() => validateRegistry({DEFAULT_SCENE: null}, 'x.js'), /x\.js must export SCENES/);
    assert.throws(() => validateRegistry({SCENES: {}}, 'x.js'), /x\.js must export DEFAULT_SCENE/);
    assert.throws(() => validateRegistry({SCENES: {a: {setup() {}}}, DEFAULT_SCENE: null}), /scene "a" has no draw\(t, ctx\) function/);
    assert.throws(() => validateRegistry({SCENES: {a: {draw() {}, pre: -1}}, DEFAULT_SCENE: null}), /scene "a": pre must be seconds >= 0/);
  });

  it('the template registry is valid and its placeholder is the default', () => {
    const reg = validateRegistry(templateRegistry, 'src/scenes/index.js');
    assert.equal(typeof reg.DEFAULT_SCENE?.draw, 'function');
    assert.equal(resolveScene(reg, 'song'), reg.DEFAULT_SCENE);
  });

  it('a scenes path must stay inside the project', () => {
    assert.equal(validateScenesPath('./src/scenes/alt.js'), 'src/scenes/alt.js');
    for (const bad of ['../x.js', '/etc/x.js', 'http://evil/x.js', 'src/../../x.js', 'src\\x.js', 'src/scenes/index.ts', '']) {
      assert.throws(() => validateScenesPath(bad), /scenes must/, bad);
    }
  });
});

describe('lyric registration', () => {
  it('a duplicate registration fails naming the id and both sections', () => {
    const reg = new LyricRegistrations(lines);
    reg.register('v-1', 'verse-1', {});
    assert.throws(() => reg.register('v-1', 'verse-2', {}), /lyric "v-1" is registered twice \(sections "verse-1" and "verse-2"\)/);
  });

  it('an id that is not in lyrics.json fails naming it', () => {
    const reg = new LyricRegistrations(lines);
    assert.throws(() => reg.register('v-9', 'verse-1', {}), /lyric "v-9" \(section "verse-1"\) is not a line id in lyrics\.json/);
  });

  it('render mode: an unregistered line (with words) is an error naming it; blank lines need no registration', () => {
    const reg = new LyricRegistrations(lines);
    reg.register('v-1', 's', {});
    assert.deepEqual(reg.missing(lines), ['v-2']);
    assert.match(unregisteredLinesError(reg.missing(lines)), /lyric line not registered by any scene: v-2/);
    reg.register('v-2', 's', {});
    assert.equal(unregisteredLinesError(reg.missing(lines)), null);
  });

  it('the lyric layer refuses unknown style options and unknown entrances/exits, naming the line', () => {
    const layer = new LyricLayer({txt: null, lines, theme: {}, page: {width: 1920, height: 1080}, fps: 30, duration: 10});
    assert.throws(() => layer.register('v-1', 's', {colour: 'red'}), /lyric "v-1": unknown style option "colour"/);
    assert.throws(() => layer.register('v-1', 's', {enter: 'spin'}), /enter must be one of/);
    assert.throws(() => layer.register('v-1', 's', {exit: 'melt'}), /exit must be one of/);
    layer.register('v-1', 's', {exit: {suck: [10, 20]}});
    assert.throws(() => layer.register('v-1', 's2', {}), /registered twice/);
    assert.throws(() => layer.finalize({render: true}), /not registered by any scene: v-2/);
  });
});
