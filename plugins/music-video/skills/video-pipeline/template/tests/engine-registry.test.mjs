// Scene registry and lyric registration (the pure validators the page's boot
// calls; the boot itself is exercised in Chromium by
// tests/render/engine-boot-errors.test.mjs): an unknown scene key without a
// DEFAULT_SCENE fails naming the key and the known keys; a duplicate line
// registration fails naming the id and both sections; in render mode an
// unregistered line fails naming its id; a registration of an id that isn't in
// lyrics.json fails naming it.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {describe, it} from 'node:test';
import {LyricRegistrations, resolveScene, unregisteredLinesError, validateRegistry, validateScenesPath} from '../src/lib/registry.js';
import {LyricLayer} from '../src/engine/text.js';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {loadRegistryState, registryStateProblems} from './fixtures/registry-state.mjs';

const fixtureRoot = (state) => join(PROJECT_ROOT, 'tests/fixtures/registry-states', state);

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

  it("registry state: this project's registry is valid for its state (placeholder as the default, or deleted with DEFAULT_SCENE null and every sections.json key registered)", async () => {
    assert.deepEqual(registryStateProblems(await loadRegistryState(PROJECT_ROOT)), []);
  });

  it('registry state, template: placeholder.js is the registered default and plays the whole-song section', async () => {
    const state = await loadRegistryState(fixtureRoot('template'));
    assert.notEqual(state.placeholder, null, 'the template fixture has placeholder.js');
    assert.deepEqual(registryStateProblems(state), []);
    const reg = validateRegistry(state.mod);
    assert.equal(reg.DEFAULT_SCENE, state.placeholder);
    assert.equal(resolveScene(reg, 'song', 'song'), state.placeholder);
  });

  it('registry state, built: no placeholder, DEFAULT_SCENE null, every sections.json key registered', async () => {
    const state = await loadRegistryState(fixtureRoot('built'));
    assert.equal(state.placeholder, null, 'the built fixture has no placeholder.js');
    assert.deepEqual(registryStateProblems(state), []);
    const reg = validateRegistry(state.mod);
    assert.equal(reg.DEFAULT_SCENE, null);
    for (const s of state.sections) assert.equal(resolveScene(reg, s.scene, s.id), reg.SCENES[s.scene]);
  });

  it('registry state: each broken state is reported, in both branches', async () => {
    const template = await loadRegistryState(fixtureRoot('template'));
    const built = await loadRegistryState(fixtureRoot('built'));
    const other = {draw() {}};
    // Template branch: a placeholder that isn't the default (another default, or none at all).
    assert.deepEqual(registryStateProblems({...template, mod: {SCENES: {}, DEFAULT_SCENE: other}}), ['placeholder.js exists but is not the registered DEFAULT_SCENE']);
    const none = registryStateProblems({...template, mod: {SCENES: {}, DEFAULT_SCENE: null}});
    assert.equal(none[0], 'placeholder.js exists but is not the registered DEFAULT_SCENE');
    assert.match(none[1], /unknown scene key "song" \(section "song"\)/);
    // Built branch: a leftover default, and a sections.json key with no scene.
    assert.deepEqual(registryStateProblems({...built, mod: {...built.mod, DEFAULT_SCENE: other}}), ['placeholder.js is gone but DEFAULT_SCENE is not null']);
    const {chorus, ...rest} = built.mod.SCENES;
    void chorus;
    const missing = registryStateProblems({...built, mod: {SCENES: rest, DEFAULT_SCENE: null}});
    assert.equal(missing[0], 'scene key "chorus" (section "chorus-1") is not in SCENES');
    assert.match(missing[1], /unknown scene key "chorus" \(section "chorus-1"\)/);
    // An empty sections.json in the built state needs the whole-song key "song".
    assert.deepEqual(registryStateProblems({...built, sections: []}).slice(0, 1), ['scene key "song" (section "song") is not in SCENES']);
    // Either branch: an invalid registry is reported by validateRegistry's own message.
    assert.deepEqual(registryStateProblems({...built, mod: {SCENES: {verse: {setup() {}}}, DEFAULT_SCENE: null}}), ['scene "verse" has no draw(t, ctx) function']);
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
