// The scene registry, the Logo, and the placeholder scene rendered through
// @remotion/player's <Thumbnail> (same harness as hooks.test.tsx).
//
// Runs in both project states: the template (src/scenes/Placeholder.tsx plays
// every key) and a finished video (Placeholder.tsx deleted, DEFAULT_SCENE null,
// every sections.json key registered; see scene-authoring).
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {describe, it, type TestContext} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {Logo, LogoFilesContext, logoCandidates, NO_LOGO_FILES, pickLogo, type LogoFiles} from '../src/components/Logo';
import {sections} from '../src/lib/data';
import {LyricsContext} from '../src/lib/hooks';
import {withWholeSongSection} from '../src/lib/sections';
import {DEFAULT_SCENE, resolveScene} from '../src/scenes/registry';
import type {SceneComponent} from '../src/scenes/types';
import {brand} from '../src/theme';
import {FPS} from './fixtures';

const PLACEHOLDER_FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src/scenes/Placeholder.tsx');

/**
 * The Placeholder component while src/scenes/Placeholder.tsx exists. Once it's
 * deleted, nothing may still play it: DEFAULT_SCENE must be null (a registry
 * that still imported it would fail to load before any test ran). Only then is
 * the test skipped. Imported by URL so typecheck passes in both states.
 */
const placeholderOrSkip = async (t: TestContext): Promise<SceneComponent | null> => {
  if (!existsSync(PLACEHOLDER_FILE)) {
    assert.equal(DEFAULT_SCENE, null, 'src/scenes/Placeholder.tsx is gone, so DEFAULT_SCENE in src/scenes/registry.ts must be null');
    t.skip('src/scenes/Placeholder.tsx was deleted once the scenes were built, and DEFAULT_SCENE is null');
    return null;
  }
  const mod = (await import(pathToFileURL(PLACEHOLDER_FILE).href)) as {Placeholder: SceneComponent};
  return mod.Placeholder;
};

const renderAt = (component: ComponentType, frame: number): string =>
  renderToString(
    <Thumbnail component={component} frameToDisplay={frame} durationInFrames={600} fps={FPS} compositionWidth={100} compositionHeight={100} />,
  );

const A: SceneComponent = () => 'A';
const B: SceneComponent = () => 'B';

describe('resolveScene', () => {
  it('returns the registered component, else the fallback', () => {
    assert.equal(resolveScene('a', {a: A}, B), A);
    assert.equal(resolveScene('missing', {a: A}, B), B);
  });
  it('throws naming the key and the known keys when there is no fallback', () => {
    assert.throws(() => resolveScene('verse', {a: A}, null), /scene key "verse".*Known keys: a/);
  });
  it('ignores inherited object keys', () => {
    assert.throws(() => resolveScene('toString', {}, null), /"toString"/);
  });
  it('the template ships a placeholder that plays every key', async (t) => {
    const Placeholder = await placeholderOrSkip(t);
    if (Placeholder === null) return;
    assert.equal(DEFAULT_SCENE, Placeholder, 'src/scenes/Placeholder.tsx exists but no longer plays unknown keys: delete it');
    assert.equal(resolveScene('anything'), Placeholder);
  });
  it('every sections.json scene key resolves', () => {
    // [] (nothing aligned yet) plays the whole-song section, as the composition does.
    const keys = [...new Set(withWholeSongSection(sections).map((s) => s.scene))];
    assert.ok(keys.length > 0);
    for (const key of keys) {
      const Scene = resolveScene(key);
      assert.equal(typeof Scene, 'function', `scene key "${key}"`);
    }
  });
});

describe('Logo', () => {
  const files: LogoFiles = {default: 'brand/logo.svg', onDark: null, onLight: 'brand/light.svg'};
  it('pickLogo prefers the variant, falls back to the default, else null', () => {
    assert.equal(pickLogo(files, 'onLight'), 'brand/light.svg');
    assert.equal(pickLogo(files, 'onDark'), 'brand/logo.svg');
    assert.equal(pickLogo(NO_LOGO_FILES, 'default'), null);
  });
  it('logoCandidates maps brand.json paths to static paths', () => {
    assert.deepEqual(logoCandidates({path: 'public/brand/logo.svg', onDark: 'public/brand/d.svg'}), {
      default: 'brand/logo.svg',
      onDark: 'brand/d.svg',
      onLight: null,
    });
  });
  // Remotion's <Img> sets src after mount, so server-rendered markup shows the element, not the file.
  it('renders nothing without a logo file, an <img> with one', () => {
    const none = () => <Logo />;
    assert.doesNotMatch(renderAt(none, 0), /<img/);
    const some = () => (
      <LogoFilesContext.Provider value={files}>
        <Logo variant="onLight" />
      </LogoFilesContext.Provider>
    );
    assert.match(renderAt(some, 0), /<img/);
  });
});

describe('Placeholder scene', () => {
  const section = {id: 'song', scene: 'song', start: 0, end: 20, from: 0, durationInFrames: 600};
  it('shows the company name without a logo, and the active lyric', async (t) => {
    const Scene = await placeholderOrSkip(t);
    if (Scene === null) return;
    const lines = [{id: 'verse-1', text: 'Hello night', start: 1, end: 3}];
    const comp = () => (
      <LyricsContext.Provider value={lines}>
        <Scene section={section} />
      </LyricsContext.Provider>
    );
    const atLyric = renderAt(comp, 60);
    assert.match(atLyric, new RegExp(brand.name));
    assert.match(atLyric, /Hello night/);
    assert.doesNotMatch(renderAt(comp, 150), /Hello night/);
  });
});
