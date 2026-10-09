// Renders real Remotion trees (via @remotion/player's <Thumbnail>, server-side)
// to pin how the hooks see time under nesting. Guards the use of
// Internals.useTimelinePosition() in src/lib/hooks.ts across Remotion upgrades.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {Freeze, Loop, Sequence, Series, useCurrentFrame} from 'remotion';
import {
  AudioAnalysisContext,
  LyricsContext,
  useBeat,
  useEnergy,
  useLine,
  useLineOrNull,
  useSectionBeats,
  useSongFrame,
} from '../src/lib/hooks';
import type {PlacedSection} from '../src/lib/sections';
import type {LyricLine} from '../src/lib/lyrics-schema';
import {FPS, gridAnalysis} from './fixtures';

const Probe = ({id}: {id: string}) => {
  const beat = useBeat();
  return (
    <i
      data-id={id}
      data-song={useSongFrame()}
      data-rel={useCurrentFrame()}
      data-beat={beat.beatIndex}
      data-energy={useEnergy('low')}
    />
  );
};

/** Render `component` at `frame`; return each probe's attributes by id. */
const renderAt = (component: ComponentType, frame: number) => {
  const html = renderToString(
    <Thumbnail
      component={component}
      frameToDisplay={frame}
      durationInFrames={600}
      fps={FPS}
      compositionWidth={100}
      compositionHeight={100}
    />,
  );
  const out: Record<string, {song: number; rel: number; beat: number; energy: number}> = {};
  for (const m of html.matchAll(/<i data-id="([^"]+)" data-song="(-?\d+)" data-rel="(-?\d+)" data-beat="(-?\d+)" data-energy="([\d.]+)"/g)) {
    out[m[1]!] = {song: Number(m[2]), rel: Number(m[3]), beat: Number(m[4]), energy: Number(m[5])};
  }
  return out;
};

// 120 BPM -> a beat every 15 frames. Low energy ramps 0..1 over the 600 frames so it encodes the frame.
const analysis = {
  ...gridAnalysis({count: 40}),
  durationInFrames: 600,
  energy: {low: Array.from({length: 600}, (_, i) => i / 599), mid: [], high: []},
};

const Nested = () => (
  <AudioAnalysisContext.Provider value={analysis}>
    <Probe id="root" />
    <Sequence from={10}>
      <Probe id="seq" />
      <Sequence from={7}>
        <Probe id="seq-seq" />
      </Sequence>
    </Sequence>
    <Series>
      <Series.Sequence durationInFrames={20}>
        <Probe id="series-1" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={200}>
        <Probe id="series-2" />
      </Series.Sequence>
    </Series>
    <Loop durationInFrames={30}>
      <Probe id="loop" />
    </Loop>
    <Freeze frame={12}>
      <Probe id="freeze" />
    </Freeze>
  </AudioAnalysisContext.Provider>
);

describe('useSongFrame / useBeat / useEnergy under nesting', () => {
  const r = renderAt(Nested, 95);

  it('returns the absolute frame inside Sequence, nested Sequence, Series and Loop', () => {
    for (const id of ['root', 'seq', 'seq-seq', 'series-2', 'loop']) {
      assert.equal(r[id]?.song, 95, id);
    }
    // Sanity: the relative frame really is offset, so the test exercises the nesting.
    assert.equal(r['seq']?.rel, 85);
    assert.equal(r['seq-seq']?.rel, 78);
    assert.equal(r['series-2']?.rel, 75);
    assert.equal(r['loop']?.rel, 5);
  });

  it('beat and energy follow song time, not the local frame', () => {
    for (const id of ['root', 'seq', 'seq-seq', 'series-2', 'loop']) {
      assert.equal(r[id]?.beat, 6, id); // frame 95 = 3.17s -> beat 6 (3.0s)
      assert.ok(Math.abs((r[id]?.energy ?? -1) - 95 / 599) < 1e-9, id);
    }
  });

  it('inside Freeze returns the frozen frame', () => {
    assert.equal(r['freeze']?.song, 12);
    assert.equal(r['freeze']?.beat, 0);
  });

  it('a Series member that is not active is not rendered', () => {
    assert.equal(r['series-1'], undefined);
  });
});

describe('AudioAnalysisContext', () => {
  it('hooks read the analysis provided by the composition', () => {
    const halfTime = gridAnalysis({count: 20, period: 1}); // 60 BPM: beat every 30 frames
    const WithHalfTime = () => (
      <AudioAnalysisContext.Provider value={halfTime}>
        <Probe id="p" />
      </AudioAnalysisContext.Provider>
    );
    assert.equal(renderAt(WithHalfTime, 95)['p']?.beat, 3);
    assert.equal(renderAt(Nested, 95)['root']?.beat, 6);
  });
});

// ---------------------------------------------------------------------------
// useLine / useLineOrNull
// ---------------------------------------------------------------------------

const lyricFixture: LyricLine[] = [
  {
    id: 'ch1-1',
    text: 'Hello, power',
    start: 3,
    end: 4,
    words: [
      {text: 'Hello,', start: 3, end: 3.4},
      {text: 'power', start: 3.5, end: 4},
    ],
  },
  {id: 'ch1-2', text: 'Lantern Fireworks', start: 5, end: 6},
];

const LineProbe = ({id, line}: {id: string; line: string}) => {
  const s = useLine(line);
  return (
    <b
      data-id={id}
      data-rel={useCurrentFrame()}
      data-start={s.startFrame}
      data-end={s.endFrame}
      data-words={s.wordFrames.map((w) => `${w.start}-${w.end}`).join(',')}
      data-active={s.activeWordIndex}
      data-progress={s.progress}
      data-is-active={String(s.isActive)}
    />
  );
};

const NullProbe = ({line}: {line: string}) => {
  const s = useLineOrNull(line);
  return <u data-null={String(s === null)} />;
};

const renderLines = (component: ComponentType, frame: number) => {
  const html = renderToString(
    <Thumbnail
      component={component}
      frameToDisplay={frame}
      durationInFrames={600}
      fps={FPS}
      compositionWidth={100}
      compositionHeight={100}
    />,
  );
  const out: Record<string, Record<string, string>> = {};
  for (const m of html.matchAll(/<b ([^>]*)>/g)) {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
    out[attrs['id']!] = attrs;
  }
  return {lines: out, html};
};

const NestedLines = () => (
  <LyricsContext.Provider value={lyricFixture}>
    <LineProbe id="root" line="ch1-1" />
    <Sequence from={40}>
      <Sequence from={20}>
        <LineProbe id="seq-seq" line="ch1-1" />
        <LineProbe id="estimated" line="ch1-2" />
        <NullProbe line="br-9" />
      </Sequence>
    </Sequence>
  </LyricsContext.Provider>
);

describe('useLine / useLineOrNull', () => {
  it('useLine reports absolute word frames and activeWordIndex under a Sequence offset', () => {
    const {lines} = renderLines(NestedLines, 100);
    for (const id of ['root', 'seq-seq']) {
      const s = lines[id]!;
      assert.equal(s['start'], '90', id);
      assert.equal(s['end'], '120', id);
      assert.equal(s['words'], '90-102,105-120', id);
      assert.equal(s['active'], '0', id);
      assert.equal(Number(s['progress']), 10 / 30, id);
      assert.equal(s['is-active'], 'true', id);
    }
    // Sanity: the nested probe's local frame really is offset.
    assert.equal(lines['seq-seq']!['rel'], '40');
    // Second word once its start frame is reached; -1 before the first word.
    assert.equal(renderLines(NestedLines, 105).lines['seq-seq']!['active'], '1');
    assert.equal(renderLines(NestedLines, 89).lines['root']!['active'], '-1');
    // A line without word timing gets estimated words in absolute frames.
    assert.equal(lines['estimated']!['words'], '150-163,163-180');
  });

  it('useLineOrNull returns null for a missing id; useLine throws naming it', () => {
    assert.match(renderLines(NestedLines, 100).html, /<u data-null="true"/);
    const Missing = () => (
      <LyricsContext.Provider value={lyricFixture}>
        <LineProbe id="x" line="out-4" />
      </LyricsContext.Provider>
    );
    // renderToString doesn't throw here: <Thumbnail> renders inside a Suspense
    // boundary, so React records the error in the boundary's fallback template
    // (data-msg) for client rendering instead. Assert on that message.
    const {html, lines} = renderLines(Missing, 0);
    assert.equal(lines['x'], undefined);
    assert.match(html, /data-msg="[^"]*Lyric line &quot;out-4&quot; is not in lyrics\.json/);
  });

  it('without a provider reads lyrics.json, and useLineOrNull returns null for an id not in it', () => {
    const Shipped = () => <NullProbe line="no-such-line" />;
    assert.match(renderLines(Shipped, 0).html, /<u data-null="true"/);
  });
});

// ---------------------------------------------------------------------------
// useSectionBeats
// ---------------------------------------------------------------------------

describe('useSectionBeats', () => {
  it('useSectionBeats works under a Sequence offset', () => {
    // Beats every 0.5 s (15 frames); downbeats every 2 s (60 frames).
    const section: PlacedSection = {id: 's', scene: 'chorus', start: 2, end: 4, from: 60, durationInFrames: 60};
    const BeatsProbe = () => {
      const {beats, downbeats} = useSectionBeats(section);
      return <s data-beats={beats.join(',')} data-downbeats={downbeats.join(',')} data-rel={useCurrentFrame()} />;
    };
    const WithSection = () => (
      <AudioAnalysisContext.Provider value={gridAnalysis({count: 40})}>
        <Sequence from={section.from} durationInFrames={section.durationInFrames}>
          <BeatsProbe />
        </Sequence>
      </AudioAnalysisContext.Provider>
    );
    const html = renderToString(
      <Thumbnail
        component={WithSection}
        frameToDisplay={70}
        durationInFrames={600}
        fps={FPS}
        compositionWidth={100}
        compositionHeight={100}
      />,
    );
    // Absolute frames, half-open [from, from + durationInFrames) = [60, 120): frame 120 belongs to the next section.
    assert.match(html, /data-beats="60,75,90,105" data-downbeats="60" data-rel="10"/);
  });
});

describe('useSectionBeats frame-space contract', () => {
  it("useSectionBeats includes a beat that rounds onto the section's first frame and excludes one that rounds onto the next section's", () => {
    // Sections at 0, 2.4 s (frame 72) and 3.4 s (frame 102). Beats at 2.39 s (-> frame 72, before
    // b's start in seconds but on its first frame), 2.9 s (-> 87) and 3.395 s (-> 102, c's first frame).
    const analysis = gridAnalysis({beats: [2.39, 2.9, 3.395], downbeats: [2.39]});
    const b: PlacedSection = {id: 'b', scene: 'verse1', start: 2.4, end: 3.4, from: 72, durationInFrames: 30};
    const Probe = () => {
      const {beats, downbeats} = useSectionBeats(b);
      return <s data-beats={beats.join(',')} data-downbeats={downbeats.join(',')} />;
    };
    const Comp = () => (
      <AudioAnalysisContext.Provider value={analysis}>
        <Sequence from={b.from} durationInFrames={b.durationInFrames}>
          <Probe />
        </Sequence>
      </AudioAnalysisContext.Provider>
    );
    const html = renderToString(
      <Thumbnail component={Comp} frameToDisplay={80} durationInFrames={600} fps={FPS} compositionWidth={100} compositionHeight={100} />,
    );
    assert.match(html, /data-beats="72,87" data-downbeats="72"/);
  });
});
