// Pins the world-layer half of the motion kit (src/components/motion): the
// world/lyric layer split and textOnly mode, the world-only ShotTimeline,
// useShotCamera, SubframeBlur (which overrides only the timeline frame; the
// <Freeze> tests pin why it doesn't use Freeze) and Shatter. Rendered
// server-side through @remotion/player's <Thumbnail>, as in motion-kit.test.tsx.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Thumbnail} from '@remotion/player';
import type {ComponentType} from 'react';
import {renderToString} from 'react-dom/server';
import {AbsoluteFill, Freeze, getInputProps, Internals, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {
  buildShards,
  logZoom,
  LyricLayer,
  shotAt,
  shotCameraAt,
  ShotTimeline,
  shotWindows,
  offsetPolygon,
  Shatter,
  SHARD_OVERLAP,
  springSettled,
  SubframeBlur,
  subframeSamples,
  TextOnlyContext,
  useShotCamera,
  useTextOnly,
  WorldLayer,
  type Shot,
  type ShotProps,
  type TransitionSpec,
} from '../src/components/motion';
import {useSongFrame} from '../src/lib/hooks';
import {theme} from '../src/theme';
import {FPS} from './fixtures';

const renderAt = (component: ComponentType, frame: number, size: {width: number; height: number} = {width: 100, height: 100}, durationInFrames = 600): string =>
  renderToString(
    <Thumbnail
      component={component}
      frameToDisplay={frame}
      durationInFrames={durationInFrames}
      fps={FPS}
      compositionWidth={size.width}
      compositionHeight={size.height}
    />,
  );

// ---------------------------------------------------------------------------
// Fractional <Freeze> frames (what SubframeBlur samples with)
// ---------------------------------------------------------------------------

const FreezeProbe = ({id}: {id: string}) => {
  const song = useSongFrame();
  return (
    <i
      data-id={id}
      data-song={song}
      data-rel={useCurrentFrame()}
      data-spring={springSettled(song, 100, FPS, 'default')}
      data-zoom={logZoom(song, 100, 130, 1, 2)}
      data-lerp={interpolate(song, [100, 110], [0, 10], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}
    />
  );
};

const probes = (html: string) => {
  const out: Record<string, {song: number; rel: number; spring: number; zoom: number; lerp: number}> = {};
  for (const m of html.matchAll(/<i data-id="([^"]+)" data-song="([^"]+)" data-rel="([^"]+)" data-spring="([^"]+)" data-zoom="([^"]+)" data-lerp="([^"]+)"/g)) {
    out[m[1]!] = {song: Number(m[2]), rel: Number(m[3]), spring: Number(m[4]), zoom: Number(m[5]), lerp: Number(m[6])};
  }
  return out;
};

describe('fractional Freeze frames', () => {
  it('Freeze with a fractional frame inside a Sequence gives a fractional absolute useSongFrame and in-between helper values', () => {
    // Scenes live in a <Sequence from={section.from}>; Freeze's `frame` is local to it.
    const Tree = () => (
      <Sequence from={40}>
        <Freeze frame={64.25}>
          <FreezeProbe id="frac" />
        </Freeze>
        <Freeze frame={64}>
          <FreezeProbe id="whole" />
        </Freeze>
        <Freeze frame={65}>
          <FreezeProbe id="next" />
        </Freeze>
      </Sequence>
    );
    const p = probes(renderAt(Tree, 50));
    assert.equal(p.frac?.song, 104.25, 'absolute song frame = sequence from + frozen local frame, fraction kept');
    assert.equal(p.frac?.rel, 64.25, 'useCurrentFrame is the frozen local frame');
    assert.equal(p.whole?.song, 104);
    assert.equal(p.next?.song, 105);
    // The helpers interpolate between the whole frames instead of snapping to one of them.
    for (const k of ['spring', 'zoom', 'lerp'] as const) {
      const a = p.whole![k];
      const b = p.next![k];
      const x = p.frac![k];
      assert.ok(a !== b, `${k}: fixture moves between frames 104 and 105`);
      assert.ok(x > Math.min(a, b) && x < Math.max(a, b), `${k}: ${x} lies strictly between ${a} and ${b}`);
    }
    assert.equal(p.frac!.lerp, 4.25, 'interpolate is linear in the fractional frame');
  });

  it('Freeze inside nested Sequences adds only the innermost Sequence offset', () => {
    // Remotion 4.0.527 Freeze sets the timeline to frame + the innermost Sequence's
    // relativeFrom and zeroes cumulatedFrom, so it shifts relative frames and nested
    // Sequences; SubframeBlur therefore overrides only the timeline frame.
    const Tree = () => (
      <Sequence from={40}>
        <Sequence from={10}>
          <Freeze frame={5.5}>
            <FreezeProbe id="nested" />
          </Freeze>
        </Sequence>
      </Sequence>
    );
    const p = probes(renderAt(Tree, 60));
    assert.equal(p.nested?.song, 15.5, 'outer offset 40 is dropped');
    // An AbsoluteFill inside a composition is itself a <Sequence from={0}>: a Freeze in it adds nothing.
    const InFill = () => (
      <Sequence from={40}>
        <AbsoluteFill>
          <Freeze frame={64.25}>
            <FreezeProbe id="fill" />
          </Freeze>
        </AbsoluteFill>
      </Sequence>
    );
    assert.equal(probes(renderAt(InFill, 60)).fill?.song, 64.25);
  });
});

// ---------------------------------------------------------------------------
// WorldLayer / LyricLayer / textOnly
// ---------------------------------------------------------------------------

const TextOnlyProbe = () => <b data-text-only={String(useTextOnly())} />;

const Layers = ({textOnly}: {textOnly?: boolean}) => {
  const tree = (
    <>
      <WorldLayer style={{background: 'rgb(10, 20, 30)'}}>
        <div data-world-child="">backdrop</div>
      </WorldLayer>
      <LyricLayer>
        <span data-lyric-child="">sung words</span>
      </LyricLayer>
      <TextOnlyProbe />
    </>
  );
  return textOnly === undefined ? tree : <TextOnlyContext.Provider value={textOnly}>{tree}</TextOnlyContext.Provider>;
};

/** style="" of the element carrying data-layer="name". */
const layerStyle = (html: string, name: string) => html.match(new RegExp(`<div style="([^"]*)" data-layer="${name}"`))?.[1];

describe('world and lyric layers', () => {
  it('getInputProps returns an empty object in the node test environment and useTextOnly reads it as false', () => {
    // No window in node: Remotion 4.0.527 warns and returns {} (it would throw inside a browser <Player>).
    assert.equal(typeof window, 'undefined');
    assert.deepEqual(getInputProps(), {});
    assert.match(renderAt(() => <Layers />, 0), /data-text-only="false"/);
  });

  it('textOnly hides WorldLayer children behind black and keeps LyricLayer children', () => {
    const normal = renderAt(() => <Layers textOnly={false} />, 0);
    assert.match(normal, /data-world-child=""/);
    assert.match(normal, /data-lyric-child=""/);
    assert.match(layerStyle(normal, 'world')!, /background:rgb\(10, 20, 30\)/);

    const textOnly = renderAt(() => <Layers textOnly />, 0);
    assert.match(textOnly, /data-text-only="true"/);
    assert.doesNotMatch(textOnly, /data-world-child|backdrop/, 'world children are not rendered');
    const world = layerStyle(textOnly, 'world')!;
    assert.equal(theme.colors.black, '#000000');
    assert.match(world, /background:#000000/, `opaque black: ${world}`);
    assert.match(textOnly, /data-lyric-child="">sung words</, 'the lyric renders as usual');
  });

  it('LyricLayer sits above WorldLayer and neither layer carries a transform or filter', () => {
    const html = renderAt(() => <Layers textOnly={false} />, 0);
    const world = layerStyle(html, 'world')!;
    const lyric = layerStyle(html, 'lyric')!;
    const z = (style: string) => Number(style.match(/z-index:(-?\d+)/)?.[1]);
    assert.ok(z(lyric) > z(world), `lyric z ${z(lyric)} > world z ${z(world)}`);
    assert.match(lyric, /pointer-events:none/);
    for (const style of [world, lyric]) assert.doesNotMatch(style, /transform|filter|opacity|clip-path|blend/);
    // The style props refuse camera and transition properties at compile time.
    // @ts-expect-error transform is not a layer style
    const bad = <LyricLayer style={{transform: 'scale(1.1)'}} />;
    // @ts-expect-error filter is not a layer style
    const bad2 = <WorldLayer style={{filter: 'blur(4px)'}} />;
    assert.ok(bad && bad2);
  });
});

// ---------------------------------------------------------------------------
// ShotTimeline
// ---------------------------------------------------------------------------

// Text-free fixture shots: an empty, coloured box naming itself only in data attributes.
const shotComponent = (id: string) => {
  const C = ({start, from, to}: ShotProps) => <div data-shot={id} data-start={start} data-from={from} data-to={to} data-song={useSongFrame()} style={{position: 'absolute', inset: 0, background: 'rgb(1, 1, 1)'}} />;
  return C;
};

const KINDS: TransitionSpec[] = [
  {kind: 'iris', frames: 10, color: 'rgb(200, 0, 0)'},
  {kind: 'whip', frames: 8},
  {kind: 'zoom', frames: 12},
  {kind: 'wipe', frames: 10, angle: 30, edge: 'rgb(0, 200, 0)', edgeWidth: 6},
  {kind: 'diagonal', frames: 9},
  {kind: 'bars', frames: 12},
  {kind: 'slices', frames: 10},
  {kind: 'split', frames: 10},
  {kind: 'burn', frames: 10},
  {kind: 'cut'},
];

const makeShots = (spec: TransitionSpec): Shot[] => [
  {id: 'a', from: 100, Component: shotComponent('a')},
  {id: 'b', from: 140, Component: shotComponent('b'), in: spec},
  {id: 'c', from: 175, Component: shotComponent('c'), in: {kind: 'bars', frames: 15, count: 9}},
  {id: 'd', from: 220, Component: shotComponent('d'), in: {kind: 'diagonal', frames: 6, dir: 'left'}},
];

const shotsIn = (html: string) => [...html.matchAll(/data-shot="([^"]+)"/g)].map((m) => m[1]);

describe('ShotTimeline', () => {
  it('ShotTimeline shot windows tile from the first shot to the end with no gap or overlap', () => {
    for (const spec of KINDS) {
      const shots = makeShots(spec);
      const end = 260;
      const w = shotWindows(shots, end);
      assert.equal(w[0]!.from, 100);
      assert.equal(w[w.length - 1]!.to, end);
      for (let i = 1; i < w.length; i++) assert.equal(w[i]!.from, w[i - 1]!.to, `${spec.kind}: window ${w[i]!.id} starts where ${w[i - 1]!.id} ends`);
      // Frame by frame: outside transition windows exactly one shot is whole, the one whose window holds the frame.
      for (let f = 90; f < end + 5; f++) {
        const at = shotAt(shots, f, end);
        if (f < 100 || f >= end) {
          assert.equal(at, null, `${spec.kind}: nothing at ${f}`);
          continue;
        }
        const owner = w.findIndex((x) => x.from <= f && f < x.to);
        assert.ok(at, `${spec.kind}: something at ${f}`);
        assert.equal(at.current, owner, `${spec.kind}: frame ${f} belongs to ${w[owner]!.id}`);
        const next = w[owner + 1];
        const inTransition = next !== undefined && f >= next.start && next.start < next.from;
        assert.equal(Boolean(at.incoming), inTransition, `${spec.kind}: frame ${f} transition`);
        if (at.incoming) {
          assert.equal(at.incoming.index, owner + 1);
          assert.ok(at.incoming.t >= 0 && at.incoming.t < 1);
        }
      }
    }
  });

  it('ShotTimeline renders exactly the outgoing and incoming shots inside a transition window', () => {
    for (const spec of KINDS) {
      const shots = makeShots(spec);
      const Timeline = () => (
        <Sequence from={60}>
          <ShotTimeline shots={shots} end={260} />
        </Sequence>
      );
      const frames = spec.kind === 'cut' ? 0 : spec.frames;
      assert.deepEqual(shotsIn(renderAt(Timeline, 99, {width: 320, height: 180})), [], `${spec.kind}: nothing before the first shot`);
      assert.deepEqual(shotsIn(renderAt(Timeline, 139 - frames, {width: 320, height: 180})), ['a'], `${spec.kind}: a alone before the transition`);
      for (let f = 140 - frames; f < 140; f++) {
        // Distinct shots (split draws the outgoing shot's two halves).
        assert.deepEqual([...new Set(shotsIn(renderAt(Timeline, f, {width: 320, height: 180})))].sort(), ['a', 'b'], `${spec.kind}: frame ${f}`);
      }
      assert.deepEqual(shotsIn(renderAt(Timeline, 140, {width: 320, height: 180})), ['b'], `${spec.kind}: b whole on its from`);
      // Bars: 9 bars, all inside 160..175.
      for (let f = 160; f < 175; f++) assert.deepEqual(shotsIn(renderAt(Timeline, f, {width: 320, height: 180})).sort(), ['b', 'c'], `bars: frame ${f}`);
      assert.deepEqual(shotsIn(renderAt(Timeline, 259, {width: 320, height: 180})), ['d']);
    }
  });

  it('ShotTimeline renders no text of its own', () => {
    for (const spec of KINDS) {
      const Timeline = () => <ShotTimeline shots={makeShots(spec)} end={260} />;
      for (const f of [100, 135, 137, 165, 170, 216, 240]) {
        const html = renderAt(Timeline, f, {width: 320, height: 180});
        const text = html.replace(/<[^>]*>/g, '');
        assert.equal(text, '', `${spec.kind} at ${f}: "${text}"`);
        assert.doesNotMatch(html, /mix-blend-mode|plus-lighter/, `${spec.kind}: no blend modes`);
      }
    }
  });

  it('ShotTimeline passes each shot its window and renders the incoming shot live', () => {
    const shots = makeShots({kind: 'whip', frames: 8});
    const html = renderAt(() => <ShotTimeline shots={shots} />, 135, {width: 320, height: 180});
    // b is mid-transition at 135: it already reads the live song frame and knows its window.
    assert.match(html, /data-shot="b" data-start="132" data-from="140" data-to="175" data-song="135"/);
    assert.match(html, /data-shot="a" data-start="100" data-from="100" data-to="140" data-song="135"/);
  });

  it('ShotTimeline sizes transitions from the composition', () => {
    const Timeline = () => <ShotTimeline shots={makeShots({kind: 'whip', frames: 8, dir: 'left'})} />;
    // At progress 1/2 the eased slide is span * EASE_CAM(0.5): the span is the composition width.
    const offset = (width: number) => Number(renderAt(Timeline, 136, {width, height: 100}).match(/transform:translateX\((-?[\d.]+)px\)/)?.[1]);
    assert.ok(Math.abs(offset(640) / offset(320) - 2) < 1e-9, `${offset(640)} vs ${offset(320)}`);
  });

  it('ShotTimeline renders nothing before the first shot and brings a first-shot transition in from nothing', () => {
    const shots: Shot[] = [{id: 'a', from: 100, Component: shotComponent('a'), in: {kind: 'iris', frames: 10}}, {id: 'b', from: 150, Component: shotComponent('b')}];
    assert.equal(shotAt(shots, 89), null);
    assert.deepEqual(shotAt(shots, 90), {current: -1, incoming: {index: 0, t: 0}});
    const Timeline = () => <ShotTimeline shots={shots} />;
    assert.deepEqual(shotsIn(renderAt(Timeline, 89, {width: 320, height: 180})), []);
    assert.deepEqual(shotsIn(renderAt(Timeline, 95, {width: 320, height: 180})), ['a'], 'only the incoming shot, clipped by the iris');
    assert.match(renderAt(Timeline, 95, {width: 320, height: 180}), /clip-path:circle\(/);
    assert.deepEqual(shotWindows(shots, 200)[0], {id: 'a', start: 90, from: 100, to: 150});
  });

  it('ShotTimeline rejects unsorted shots and transitions longer than the previous shot, naming the id', () => {
    const C = shotComponent('x');
    assert.throws(() => shotWindows([{id: 'one', from: 50, Component: C}, {id: 'two', from: 40, Component: C}], 100), /"two"/);
    assert.throws(() => shotWindows([{id: 'one', from: 50, Component: C}, {id: 'dup', from: 50, Component: C}], 100), /"dup"/);
    assert.throws(() => shotWindows([{id: 'one', from: 50, Component: C}, {id: 'long', from: 60, Component: C, in: {kind: 'iris', frames: 12}}], 100), /"long"/);
  });
});

// ---------------------------------------------------------------------------
// useShotCamera
// ---------------------------------------------------------------------------

describe('useShotCamera', () => {
  it('useShotCamera is z0 at from, exactly 1 at to and after, and never increases', () => {
    for (const [from, to, z0] of [
      [100, 130, 1.08],
      [10, 11, 1.3],
      [0, 90, 1.02],
    ] as const) {
      assert.equal(shotCameraAt(from, from, to, z0), z0);
      assert.equal(shotCameraAt(from - 5, from, to, z0), z0);
      for (let f = to; f < to + 40; f++) assert.equal(shotCameraAt(f, from, to, z0), 1, `frame ${f}`);
      let last = Infinity;
      for (let f = from; f <= to; f += 0.25) {
        const z = shotCameraAt(f, from, to, z0);
        assert.ok(z <= last, `frame ${f}: ${z} after ${last}`);
        assert.ok(z >= 1 && z <= z0);
        last = z;
      }
      if (to - from > 2) assert.ok(shotCameraAt((from + to) / 2, from, to, z0) < z0 && shotCameraAt((from + to) / 2, from, to, z0) > 1, 'moving mid-way');
    }
    assert.equal(shotCameraAt(5, 0, 10), shotCameraAt(5, 0, 10, 1.08), 'z0 defaults to 1.08');
    // The hook reads the song frame.
    const Probe = () => <i data-z={useShotCamera(100, 130)} />;
    const z = (f: number) => Number(renderAt(() => <Sequence from={80}><Probe /></Sequence>, f).match(/data-z="([^"]+)"/)?.[1]);
    assert.equal(z(100), 1.08);
    assert.equal(z(130), 1);
    assert.equal(z(115), shotCameraAt(115, 100, 130));
  });
});

// ---------------------------------------------------------------------------
// SubframeBlur
// ---------------------------------------------------------------------------

describe('SubframeBlur', () => {
  it('SubframeBlur sample frames never leave the window and are centred on the frame', () => {
    const window = [100, 120] as const;
    for (let n = 3; n <= 6; n++) {
      for (const shutter of [0.5, 1, 2]) {
        for (const frame of [100, 101, 110, 118, 119]) {
          const s = subframeSamples(frame, {window, samples: n, shutter});
          assert.equal(s.length, n, `N ${n}`);
          for (const f of s) assert.ok(f >= 100 && f <= 119, `N ${n} shutter ${shutter} frame ${frame}: sample ${f}`);
          // Away from the edges the offsets are (j - (N-1)/2) * shutter / N: symmetric, summing to 0.
          if (frame >= 103 && frame <= 116) {
            s.forEach((f, j) => assert.ok(Math.abs(f - frame - ((j - (n - 1) / 2) * shutter) / n) < 1e-12));
            assert.ok(Math.abs(s.reduce((a, f) => a + f - frame, 0)) < 1e-12, 'centred');
          }
        }
      }
    }
    // Outside the window: one sample, the frame itself.
    assert.deepEqual(subframeSamples(99, {window, samples: 4}), [99]);
    assert.deepEqual(subframeSamples(120, {window, samples: 4}), [120]);
    // Defaults: 4 samples, a 180° shutter.
    assert.deepEqual(subframeSamples(110, {window}), [110 - 0.1875, 110 - 0.0625, 110 + 0.0625, 110 + 0.1875]);
  });

  const BlurProbe = () => <i data-probe={useSongFrame()} data-rel={useCurrentFrame()} />;
  const Blurred = ({samples}: {samples: number}) => (
    <Sequence from={40}>
      <Sequence from={10}>
        <SubframeBlur window={[100, 120]} samples={samples}>
          <BlurProbe />
        </SubframeBlur>
      </Sequence>
    </Sequence>
  );

  it('SubframeBlur renders N equally weighted plain-opacity layers frozen at the sample frames', () => {
    for (let n = 3; n <= 6; n++) {
      const html = renderAt(() => <Blurred samples={n} />, 110);
      const layers = [...html.matchAll(/data-sample="([^"]+)"[^>]*>|<div style="([^"]*)" data-sample="([^"]+)"/g)];
      const opacities = [...html.matchAll(/<div style="[^"]*opacity:([\d.]+)[^"]*" data-sample="([^"]+)"/g)].map((m) => ({o: Number(m[1]), f: Number(m[2])}));
      assert.equal(opacities.length, n, `N ${n}: ${layers.length} layers`);
      // Effective weight of layer k under the ones painted after it: o_k * prod_{j>k} (1 - o_j).
      const weights = opacities.map(({o}, k) => opacities.slice(k + 1).reduce((w, {o: oj}) => w * (1 - oj), o));
      for (const w of weights) assert.ok(Math.abs(w - 1 / n) < 1e-9, `N ${n}: weights ${weights.join(', ')}`);
      // Each layer's subtree reads its sample frame as the absolute song frame, even two Sequences deep.
      const probes = [...html.matchAll(/data-probe="([^"]+)"/g)].map((m) => Number(m[1]));
      assert.deepEqual(probes, subframeSamples(110, {window: [100, 120], samples: n}));
      assert.deepEqual(probes, opacities.map(({f}) => f));
      assert.doesNotMatch(html, /mix-blend-mode|plus-lighter|blend/i);
    }
    // Outside the window: the children once, unblurred, at the real frame.
    const outside = renderAt(() => <Blurred samples={4} />, 125);
    assert.deepEqual([...outside.matchAll(/data-probe="([^"]+)"/g)].map((m) => Number(m[1])), [125]);
    assert.doesNotMatch(outside, /data-sample/);
  });

  // A shot that reads its section-relative frame and holds a nested Sequence starting 5 frames into the section.
  const SectionProbe = () => (
    <>
      <i data-rel={useCurrentFrame()} data-song={useSongFrame()} />
      <Sequence from={5} layout="none">
        <b data-nested={useSongFrame()} />
      </Sequence>
    </>
  );
  const InSection = ({blur, nestedAt = 0}: {blur: boolean; nestedAt?: number}) => (
    <Sequence from={50}>
      <Sequence from={nestedAt}>
        {blur ? (
          <SubframeBlur window={[100, 120]} samples={4}>
            <SectionProbe />
          </SubframeBlur>
        ) : (
          <SectionProbe />
        )}
      </Sequence>
    </Sequence>
  );
  const readSection = (html: string) => ({
    rel: [...html.matchAll(/<i data-rel="([^"]+)" data-song="([^"]+)"/g)].map((m) => ({rel: Number(m[1]), song: Number(m[2])})),
    nested: [...html.matchAll(/data-nested="([^"]+)"/g)].map((m) => Number(m[1])),
  });

  it('SubframeBlur mutes audio inside the window', () => {
    // Remotion media read isInsideFreeze to mute themselves and skip registering their audio for the render.
    const FreezeProbe2 = () => <u data-frozen={String(Internals.useIsInsideFreeze())} data-at={useSongFrame()} />;
    const Tree = () => (
      <Sequence from={40}>
        <SubframeBlur window={[100, 120]} samples={5}>
          <FreezeProbe2 />
        </SubframeBlur>
      </Sequence>
    );
    const frozen = (f: number) => [...renderAt(Tree, f).matchAll(/data-frozen="(true|false)"/g)].map((m) => m[1]);
    for (const f of [100, 110, 119]) assert.deepEqual(frozen(f), Array(5).fill('true'), `frame ${f}: every sample muted`);
    for (const f of [99, 120, 150]) assert.deepEqual(frozen(f), ['false'], `frame ${f}: outside the window, not muted`);
  });

  it('SubframeBlur keeps the slot-0 element types and keys across the window edges', () => {
    // React keeps a subtree mounted when every element on its path keeps its type and key. The harness renders
    // each frame fresh (renderToString), so this compares that path frame to frame rather than watching a live
    // re-render: SubframeBlur and its inner wrapper are called in the probe's render and their elements inspected.
    type El = {type: unknown; key: string | null; props: {children?: unknown}};
    const child = <i data-child="" />;
    const captured: Record<number, unknown[]> = {};
    const Capture = ({frame}: {frame: number}) => {
      const root = SubframeBlur({children: child, window: [100, 120], samples: 4}) as El;
      const slot0 = (root.props.children as El[])[0]!;
      const wrapper = slot0.props.children as El;
      const inner = (wrapper.type as (p: unknown) => El)(wrapper.props);
      captured[frame] = [root.type, slot0.key, slot0.type, wrapper.type, inner.type, inner.props.children === child];
      return null;
    };
    for (const f of [99, 100, 119, 120]) renderAt(() => <Capture frame={f} />, f);
    assert.equal(captured[99]![1], 'sample-0');
    assert.equal(captured[99]![4], Internals.TimelineContext.Provider, 'the children always sit under the same provider');
    assert.equal(captured[99]![5], true);
    for (const [a, b] of [
      [99, 100],
      [119, 120],
    ] as const) {
      captured[a]!.forEach((v, i) => assert.equal(captured[b]![i], v, `frames ${a} -> ${b}: path element ${i}`));
    }
  });

  it('SubframeBlur samples match the unblurred render at Sequence depth', () => {
    for (const nestedAt of [0, 7]) {
      const offset = 50 + nestedAt;
      // Outside the window: identical to the unblurred tree, relative frames continuous across the window edges.
      for (const f of [99, 120, 121]) {
        const blurred = readSection(renderAt(() => <InSection blur nestedAt={nestedAt} />, f));
        const plain = readSection(renderAt(() => <InSection blur={false} nestedAt={nestedAt} />, f));
        assert.deepEqual(blurred, plain, `frame ${f}`);
        assert.deepEqual(blurred.rel, [{rel: f - offset, song: f}]);
      }
      // Inside: every sample reads exactly what the unblurred tree reads at that (fractional) frame.
      for (const f of [100, 101, 110, 119]) {
        const samples = subframeSamples(f, {window: [100, 120], samples: 4});
        const blurred = readSection(renderAt(() => <InSection blur nestedAt={nestedAt} />, f));
        assert.deepEqual(
          blurred.rel,
          samples.map((s) => ({rel: s - offset, song: s})),
          `frame ${f}: section-relative frames, not song-relative`,
        );
        // The nested Sequence starting at offset + 5 shows in every sample, as it does unblurred (f >= offset + 5).
        assert.deepEqual(blurred.nested, samples, `frame ${f}: nested Sequence`);
      }
    }
    // The nested marker's visibility follows the unblurred tree: hidden in samples before its start.
    const late = () => (
      <Sequence from={50}>
        <SubframeBlur window={[50, 70]} samples={4}>
          <SectionProbe />
        </SubframeBlur>
      </Sequence>
    );
    for (const f of [54, 55, 56]) {
      const samples = subframeSamples(f, {window: [50, 70], samples: 4});
      const blurred = readSection(renderAt(late, f));
      const plainAt = (s: number) => readSection(renderAt(() => <Sequence from={50}><SectionProbe /></Sequence>, s)).nested;
      assert.deepEqual(blurred.nested, samples.filter((s) => s >= 55), `frame ${f}: nested markers`);
      // Whole-frame cross-check: the unblurred tree shows the marker exactly from frame 55.
      assert.deepEqual(plainAt(54), []);
      assert.deepEqual(plainAt(55), [55]);
    }
  });
});

// ---------------------------------------------------------------------------
// Shatter
// ---------------------------------------------------------------------------

/** Ray-casting point-in-polygon. */
const inside = ([x, y]: readonly [number, number], poly: readonly (readonly [number, number])[]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Outward unit normals of a convex polygon's edges (edge i: pts[i] -> pts[i + 1]), repeated vertices dropped. */
const edgesOf = (points: readonly (readonly [number, number])[]) => {
  const pts = points.filter((p, i) => {
    const q = points[(i + points.length - 1) % points.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  let area = 0;
  pts.forEach(([x0, y0], i) => {
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    area += x0 * y1 - x1 * y0;
  });
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s = area > 0 ? 1 : -1;
    return {a, b, n: [(s * (b[1] - a[1])) / len, (-s * (b[0] - a[0])) / len] as const};
  });
};

describe('Shatter', () => {
  it('Shatter builds 64 shards deterministically per seed', () => {
    const a = buildShards({x: 300, y: 200, width: 640, height: 360, seed: 'seed-a'});
    assert.equal(a.length, 64);
    assert.deepEqual(buildShards({x: 300, y: 200, width: 640, height: 360, seed: 'seed-a'}), a, 'same seed, same shards');
    assert.notDeepEqual(buildShards({x: 300, y: 200, width: 640, height: 360, seed: 'other'}), a, 'another seed differs');
    for (const s of a) {
      assert.equal(s.points.length, 4);
      assert.ok(s.delay >= 0 && s.delay <= 0.12);
      assert.ok(Math.abs(s.rot) <= 2.5);
    }
  });

  it('Shatter shards cover the source rect at impact', () => {
    // Impacts at the centre, near a corner and off-centre, in two rect sizes.
    for (const [x, y, width, height] of [
      [320, 180, 640, 360],
      [20, 15, 640, 360],
      [1180, 520, 1920, 1080],
      [100, 900, 1920, 1080],
    ] as const) {
      const shards = buildShards({x, y, width, height, seed: `cover-${x}`});
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
          // Nudge off exact shared edges and vertices.
          const p = [Math.min(width, (i / steps) * width + 0.013), Math.min(height, (j / steps) * height + 0.017)] as const;
          assert.ok(
            shards.some((s) => inside(p, s.points)),
            `impact ${x},${y} in ${width}x${height}: point ${p.join(',')} is in no shard`,
          );
        }
      }
    }
  });

  it('Shatter drawn shards overlap every shared edge by at least SHARD_OVERLAP', () => {
    const eps = 1e-4;
    for (const [x, y, width, height] of [
      [320, 180, 640, 360],
      [20, 15, 640, 360],
    ] as const) {
      const shards = buildShards({x, y, width, height, seed: `seam-${x}`});
      const drawn = shards.map((sh) => offsetPolygon(sh.points, SHARD_OVERLAP));
      let shared = 0;
      shards.forEach((sh, k) => {
        for (const {a, b, n} of edgesOf(sh.points)) {
          // Along the whole edge, ends included, the drawn shard reaches SHARD_OVERLAP outside it, and no further.
          for (let t = 0; t <= 1; t += 0.05) {
            const px = a[0] + t * (b[0] - a[0]);
            const py = a[1] + t * (b[1] - a[1]);
            const out = [px + n[0] * (SHARD_OVERLAP - eps), py + n[1] * (SHARD_OVERLAP - eps)] as const;
            assert.ok(inside(out, drawn[k]!), `shard ${k}: ${SHARD_OVERLAP} px outside its edge at t ${t.toFixed(2)}`);
          }
          const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
          assert.ok(!inside([mid[0] + n[0] * (SHARD_OVERLAP + 0.05), mid[1] + n[1] * (SHARD_OVERLAP + 0.05)], drawn[k]!), `shard ${k}: offset is ${SHARD_OVERLAP} px, not more`);
          // The neighbour across this edge reaches SHARD_OVERLAP into this shard: the two overlap by twice it.
          const m = shards.findIndex((o, j) => j !== k && edgesOf(o.points).some((e) => Math.hypot(e.a[0] - b[0], e.a[1] - b[1]) < 1e-9 && Math.hypot(e.b[0] - a[0], e.b[1] - a[1]) < 1e-9));
          if (m < 0) continue;
          shared++;
          const into = [mid[0] - n[0] * (SHARD_OVERLAP - eps), mid[1] - n[1] * (SHARD_OVERLAP - eps)] as const;
          assert.ok(inside(into, drawn[m]!), `neighbour ${m} covers ${SHARD_OVERLAP} px into shard ${k}`);
        }
      });
      // 16 rays x 4 rings: 64 radial edges and 48 ring edges are shared, each seen from both sides.
      assert.equal(shared, 2 * (64 + 48), `${shared} shared edge sides`);
    }
    // The impact frame draws exactly these polygons (2-decimal CSS), untransformed.
    const C = () => (
      <Shatter at={100} x={320} y={180} seed="seam-320">
        <div data-world="" />
      </Shatter>
    );
    const html = renderAt(C, 100, {width: 640, height: 360});
    const expected = buildShards({x: 320, y: 180, width: 640, height: 360, seed: 'seam-320'}).map((sh) => offsetPolygon(sh.points, SHARD_OVERLAP));
    let checked = 0;
    for (const m of html.matchAll(/clip-path:polygon\(([^)]*)\);transform:translate\(0\.00px, 0\.00px\) rotate\(0\.0000rad\)[^"]*" data-shard="(\d+)"/g)) {
      const pts = m[1]!.split(', ').map((p) => p.split(' ').map((v) => Number.parseFloat(v)));
      const want = expected[Number(m[2])]!;
      assert.equal(pts.length, want.length);
      pts.forEach(([px, py], i) => assert.ok(Math.abs(px! - want[i]![0]) < 0.006 && Math.abs(py! - want[i]![1]) < 0.006));
      checked++;
    }
    assert.ok(checked >= 40, `${checked} untransformed shards checked on the impact frame`);
  });

  it('Shatter renders the children whole before the impact and clipped shards with a flash after', () => {
    const World = () => <div data-world="" />;
    const C = () => (
      <Sequence from={20}>
        <Shatter at={100} x={80} y={50} seed="s">
          <World />
        </Shatter>
      </Sequence>
    );
    const before = renderAt(C, 99, {width: 200, height: 120});
    assert.equal([...before.matchAll(/data-world=""/g)].length, 1);
    assert.doesNotMatch(before, /data-shard/);
    const atImpact = renderAt(C, 100, {width: 200, height: 120});
    // Every shard reaching into the frame renders (outer shards lying wholly outside it may be culled).
    const rendered = new Set([...atImpact.matchAll(/data-shard="(\d+)"/g)].map((m) => Number(m[1])));
    const reaching = buildShards({x: 80, y: 50, width: 200, height: 120, seed: 's'})
      .map((sh, k) => ({k, sh}))
      .filter(({sh}) => sh.points.some(([px, py]) => px >= 0 && px <= 200 && py >= 0 && py <= 120));
    assert.ok(reaching.length >= 40, `${reaching.length} shards reach into the frame`);
    for (const {k} of reaching) assert.ok(rendered.has(k), `shard ${k} renders on the impact frame`);
    assert.ok(rendered.size <= 64);
    assert.equal([...atImpact.matchAll(/data-world=""/g)].length, rendered.size, 'one copy of the world per rendered shard');
    assert.match(atImpact, /clip-path:polygon\(/);
    assert.match(atImpact, /data-shatter-flash=""/);
    assert.equal(renderAt(C, 130, {width: 200, height: 120}), renderAt(C, 130, {width: 200, height: 120}), 'deterministic');
    assert.doesNotMatch(atImpact, /mix-blend-mode|plus-lighter/);
    // Long after, the shards have flown off and are culled.
    assert.doesNotMatch(renderAt(C, 300, {width: 200, height: 120}), /data-shard/);
  });
});
