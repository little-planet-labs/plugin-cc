// Renders kinetic components server-side through @remotion/player's
// <Thumbnail> (same harness as hooks.test.tsx) to pin that entrances are
// gated on ABSOLUTE song frames, also inside a <Sequence>.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {Sequence} from 'remotion';
import {DrawPath, FadeUp, Flash, SlamIn, SnapIn, StampWords, Typewriter} from '../src/components/kinetic';
import {FPS} from './fixtures';

const renderAt = (component: ComponentType, frame: number): string =>
  renderToString(
    <Thumbnail
      component={component}
      frameToDisplay={frame}
      durationInFrames={600}
      fps={FPS}
      compositionWidth={100}
      compositionHeight={100}
    />,
  );

// Each component sits inside a Sequence offset so `at` must be read as song time, not local time.
const Slam = () => (
  <Sequence from={30}>
    <SlamIn at={50} exitAt={80}>
      SLAMWORD
    </SlamIn>
  </Sequence>
);

const Stamp = () => (
  <Sequence from={30}>
    <StampWords
      words={[
        {text: 'STAMPONE', at: 50},
        {text: 'STAMPTWO', at: 60},
      ]}
    />
  </Sequence>
);

const Others = () => (
  <Sequence from={30}>
    <SnapIn at={50}>SNAPWORD</SnapIn>
    <FadeUp at={50}>FADEWORD</FadeUp>
    <Typewriter text="TYPEWORD" at={50} endAt={58} />
    <Flash at={50} color="rgb(1, 2, 3)" />
  </Sequence>
);

/**
 * Rendered text with tags removed. Components split text across spans
 * (Typewriter: typed part, cursor, hidden remainder), so a regex over raw
 * HTML could miss text a broken component emits; this can't.
 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '');

describe('kinetic components', () => {
  it('kinetic components render nothing before `at`', () => {
    const slamBefore = renderAt(Slam, 49);
    assert.doesNotMatch(slamBefore, /SLAMWORD/);
    assert.match(renderAt(Slam, 50), /SLAMWORD/);

    const stampBefore = renderAt(Stamp, 49);
    assert.doesNotMatch(stampBefore, /STAMPONE|STAMPTWO/);

    const others = renderAt(Others, 49);
    assert.doesNotMatch(textOf(others), /SNAPWORD|FADEWORD|TYPEWORD/);
    assert.doesNotMatch(textOf(others), /T|Y|P/); // not even Typewriter's first character
    assert.doesNotMatch(others, /rgb\(1, 2, 3\)/);
    const othersOn = renderAt(Others, 50);
    for (const s of ['SNAPWORD', 'FADEWORD', 'TYPEWORD']) assert.ok(textOf(othersOn).includes(s), s);
    assert.ok(othersOn.includes('rgb(1, 2, 3)'), 'Flash');
    // Typewriter shows its first character at `at`, the rest laid out but hidden.
    assert.match(othersOn, /<span>T<\/span>/);
  });

  it('SlamIn is gone after its exit', () => {
    assert.match(renderAt(Slam, 85), /SLAMWORD/); // mid-exit (exitAt 80 + 6 frames)
    assert.doesNotMatch(renderAt(Slam, 86), /SLAMWORD/);
  });

  it('StampWords reserves space for words not yet in, then shows them', () => {
    const mid = renderAt(Stamp, 55);
    // The second word is laid out but hidden until its own frame.
    assert.match(mid, /visibility:hidden[^>]*>STAMPTWO/);
    assert.doesNotMatch(mid, /visibility:hidden[^>]*>STAMPONE/);
    assert.doesNotMatch(renderAt(Stamp, 60), /visibility:hidden[^>]*>STAMPTWO/);
  });
});

// A 100-unit horizontal line, drawn from frame 50 to 60, inside a Sequence offset.
const Draw = () => (
  <Sequence from={30}>
    <svg viewBox="0 0 100 10">
      <DrawPath d="M 0 5 L 100 5" at={50} endAt={60} />
    </svg>
  </Sequence>
);

const dashOffset = (html: string): number | null => {
  const m = html.match(/<path [^>]*stroke-dashoffset="([^"]+)"/);
  return m ? Number(m[1]) : null;
};

describe('DrawPath', () => {
  it('DrawPath renders nothing before at and full length after endAt', () => {
    assert.doesNotMatch(renderAt(Draw, 49), /<path/);
    const start = renderAt(Draw, 50);
    assert.match(start, /stroke-dasharray="100"/);
    assert.equal(dashOffset(start), 100); // nothing drawn yet
    assert.equal(dashOffset(renderAt(Draw, 55)), 50); // Easing.inOut(cubic) is 0.5 at the midpoint
    assert.equal(dashOffset(renderAt(Draw, 60)), 0);
    assert.equal(dashOffset(renderAt(Draw, 90)), 0);
  });
});
