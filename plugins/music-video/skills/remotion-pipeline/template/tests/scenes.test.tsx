// The scene registry, the Logo, and the placeholder scene rendered through
// @remotion/player's <Thumbnail> (same harness as hooks.test.tsx).
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {Logo, LogoFilesContext, logoCandidates, NO_LOGO_FILES, pickLogo, type LogoFiles} from '../src/components/Logo';
import {LyricsContext} from '../src/lib/hooks';
import {DEFAULT_SCENE, resolveScene, SCENES} from '../src/scenes/registry';
import type {SceneComponent} from '../src/scenes/types';
import {brand} from '../src/theme';
import {FPS} from './fixtures';

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
  it('the template ships a placeholder that plays every key', () => {
    assert.ok(DEFAULT_SCENE);
    assert.equal(resolveScene('anything'), DEFAULT_SCENE);
    assert.equal(SCENES.placeholder, DEFAULT_SCENE);
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
  const Scene = DEFAULT_SCENE as SceneComponent;
  it('shows the company name without a logo, and the active lyric', () => {
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
