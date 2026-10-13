// `pnpm beatmap`: creative/beatmap.md from the timing in effect. The same
// data gives the same bytes; candidate drops and accents land on known frames
// of a synthetic analysis; lines and sections carry their frames; it never
// replaces the file without --force and never leaves a partial file.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {beatmapMarkdown, energyCandidates, energyRise, main as beatmapMain, parseBeatmapArgs, risePeaks} from '../scripts/beatmap.mjs';
import {loadProject} from '../scripts/lib/project.mjs';
import {quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

// 20 s at 30 fps. Every band sits at 0.2 until frame 300 (10 s), then low and
// mid at 0.8 and high at 0.5, with a high-band burst to 1.0 on frames 450-452.
const analysis = () => {
  const frames = 600;
  const band = (after) => Array.from({length: frames}, (_, f) => (f < 300 ? 0.2 : after));
  const high = band(0.5);
  for (const f of [450, 451, 452]) high[f] = 1;
  const beats = Array.from({length: 40}, (_, i) => i * 0.5);
  return {
    version: 1,
    source: 'audio/track.wav',
    generator: 'test',
    fps: 30,
    durationSeconds: 20,
    durationInFrames: frames,
    tempo: 120,
    beatsPerBar: 4,
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    onsets: [],
    bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
    energy: {low: band(0.8), mid: band(0.8), high},
  };
};
const lyrics = [
  {id: 'verse-1-1', text: 'first line here', start: 1.016, end: 2.5},
  {id: 'verse-1-2', text: 'second line', start: 2.7, end: 4.983},
  {id: 'chorus-1-1', text: 'a | b', start: 10, end: 12},
];
const sections = [
  {id: 'verse-1', scene: 'verse', start: 0},
  {id: 'chorus-1', scene: 'chorus', start: 9.5, variant: '1'},
];
const fixture = (o = {}) => {
  const p = makeProject({lyrics, sections, analysis: analysis(), ...o});
  projects.push(p);
  return p.root;
};
const run = async (root, argv = []) => (await quiet(() => beatmapMain(argv, {root}))).result;
const target = (root) => join(root, 'creative/beatmap.md');

describe('beatmap', () => {
  it('parseBeatmapArgs: only --force', () => {
    assert.deepEqual(parseBeatmapArgs([]), {force: false});
    assert.deepEqual(parseBeatmapArgs(['--force']), {force: true});
    assert.throws(() => parseBeatmapArgs(['--out=x.md']), /unexpected argument "--out=x\.md"/);
    assert.throws(() => parseBeatmapArgs(['--force', '--force']), /--force given twice/);
  });

  it('beatmap refuses to overwrite an existing beatmap.md without --force and replaces it with --force', async () => {
    const root = fixture();
    mkdirSync(join(root, 'creative'));
    writeFileSync(target(root), 'MY NOTES\n');
    assert.equal(await run(root), 1);
    assert.equal(readFileSync(target(root), 'utf8'), 'MY NOTES\n');
    assert.deepEqual(readdirSync(join(root, 'creative')), ['beatmap.md'], 'temp file left behind');
    assert.equal(await run(root, ['--force']), 0);
    assert.match(readFileSync(target(root), 'utf8'), /^# Beat map\n/);
    assert.deepEqual(readdirSync(join(root, 'creative')), ['beatmap.md']);
  });

  it('beatmap leaves no partial file when the final rename fails', async () => {
    const root = fixture();
    // A non-empty directory where the file goes: --force gets past the existence check, the rename fails.
    mkdirSync(join(root, 'creative/beatmap.md'), {recursive: true});
    writeFileSync(join(root, 'creative/beatmap.md/keep.txt'), 'KEEP');
    assert.equal(await run(root, ['--force']), 1);
    assert.deepEqual(readdirSync(join(root, 'creative')), ['beatmap.md'], 'a partial file was left next to it');
    assert.equal(readFileSync(join(root, 'creative/beatmap.md/keep.txt'), 'utf8'), 'KEEP');
  });

  it('beatmap rows are the lyric lines in order with frames round(seconds * fps), and the sections with their placed frames', async () => {
    const root = fixture();
    assert.equal(await run(root), 0);
    const md = readFileSync(target(root), 'utf8');
    const linesSection = md.slice(md.indexOf('## Lines'), md.indexOf('## Layers'));
    const rows = linesSection.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| id ') && !l.startsWith('|---'));
    assert.deepEqual(rows, [
      '| verse-1-1 | 30–75 | 1.02–2.50 | first line here |  |  |  |  |',
      '| verse-1-2 | 81–149 | 2.70–4.98 | second line |  |  |  |  |',
      '| chorus-1-1 | 300–360 | 10.00–12.00 | a \\| b |  |  |  |  |',
    ]);
    assert.match(linesSection, /\| id \| frames \| seconds \| text \| world \| transition in \| text exit \| one-off accent \|/);
    assert.match(md, /\| verse-1 \| verse \| {2}\| 0–285 \| 0\.00–9\.50 \|/);
    assert.match(md, /\| chorus-1 \| chorus \| 1 \| 285–600 \| 9\.50–20\.00 \|/);
    assert.match(md, /- Duration: 20\.00 s, 600 frames/);
    assert.match(md, /Tempo: 120\.00 BPM\. Beat: 0\.500 s \(15\.00 frames\)\. Bar of 4 beats: 2\.000 s \(60\.00 frames\)\./);
    assert.match(md, /- Downbeats: 10, the first at frame 0 \(0\.00 s\)\./);
    assert.match(md, /Key changes: not detected\./);
    const layers = md.slice(md.indexOf('## Layers'));
    assert.equal(layers, '## Layers\n\n### World layer\n\n- Shots and transitions:\n- Camera:\n- One-off effects:\n\n### Lyric layer\n\n- Lines and their exits:\n');
  });

  it('beatmap output is byte-identical across runs and finds known energy jumps at their frames', async () => {
    const root = fixture();
    assert.equal(await run(root), 0);
    const first = readFileSync(target(root));
    assert.equal(await run(root, ['--force']), 0);
    assert.ok(readFileSync(target(root)).equals(first), 'two runs on the same data differ');

    const {drops, accents} = energyCandidates(analysis(), 30);
    // All three bands averaged rise by (0.6 + 0.6 + 0.3) / 3 * 48 = 24 dB exactly at frame 300.
    assert.equal(drops.length, 1);
    assert.equal(drops[0].frame, 300);
    assert.ok(Math.abs(drops[0].rise - 24) < 1e-9, `rise ${drops[0].rise}`);
    // Accents: the step at 300 in every band (low/mid +28.8 dB) and the high burst at 450 (+24 dB).
    assert.deepEqual(
      accents.map((a) => [a.frame, a.bands, Number(a.rise.toFixed(1))]),
      [
        [300, ['low', 'mid', 'high'], 28.8],
        [450, ['high'], 24],
      ],
    );
    assert.match(first.toString(), /\| 300 \| 10\.00 \| 24\.0 \| 300 \(\+0\) \|/);
    assert.match(first.toString(), /\| 450 \| 15\.00 \| high \| 24\.0 \| 450 \(\+0\) \|/);
    const {project} = loadProject(root);
    assert.equal(beatmapMarkdown({analysis: project.analysis, lyrics: project.lyrics, sections: project.sections, fps: 30}), first.toString());
  });

  it('beatmap reads the timing in effect: timing-overrides.json downbeats are the ones listed', async () => {
    const root = fixture({files: {'src/data/timing-overrides.json': JSON.stringify({downbeats: [0.5]})}});
    assert.equal(await run(root), 0);
    assert.match(readFileSync(target(root), 'utf8'), /- Downbeats: \d+, the first at frame 15 \(0\.50 s\)\./);
  });

  it('beatmap energy rise and peaks: a burst shorter than the window is placed on its first frame', () => {
    // A one-frame burst at frame 5: with W = 3 the rise is equal (1/3 * 48 = 16 dB) at frames 3, 4 and 5.
    const rise = energyRise([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], 3);
    assert.deepEqual(rise.slice(3, 6).map((r) => Number(r.toFixed(9))), [16, 16, 16]);
    assert.deepEqual(rise.slice(0, 3), [null, null, null], 'no rise without a full window before');
    assert.deepEqual(risePeaks(rise, 12, 3), [{frame: 5, rise: rise[5]}]);
    assert.deepEqual(risePeaks(rise, 17, 3), [], 'below the threshold');
  });

  it('beatmap stops on an analysis at another fps than pipeline.json, writing nothing', async () => {
    const root = fixture({analysis: {...analysis(), fps: 25, durationInFrames: 500, energy: {low: [], mid: [], high: []}}});
    const {result, output} = await quiet(() => beatmapMain([], {root}));
    assert.equal(result, 1);
    assert.match(output.join('\n'), /made at 25fps but pipeline\.json fps is 30/);
    assert.match(output.join('\n'), /run `pnpm analyze` first/);
    assert.equal(existsSync(join(root, 'creative')), false);
  });

  it('beatmap stops when a track is present but not analysed, writing nothing, naming pnpm analyze', async () => {
    // The no-track analysis, with public/audio/track.wav present: the page would fall back to a 4 s grid.
    const p = makeProject({lyrics, sections: [], files: {'public/audio/track.wav': 'RIFF'}});
    projects.push(p);
    const {result, output} = await quiet(() => beatmapMain([], {root: p.root}));
    assert.equal(result, 1);
    const text = output.join('\n');
    assert.match(text, /beatmap: warning: public\/audio\/track\.wav has not been analysed/, 'the project warning is printed');
    assert.match(text, /the timing in effect is the 4 s fallback grid, not an analysis of the track .*; run `pnpm analyze` first/);
    assert.equal(existsSync(join(p.root, 'creative')), false);
  });

  it('beatmap on the no-track default writes the fallback grid with a warning and neutral placeholders', async () => {
    const p = makeProject({lyrics: [], sections: []});
    projects.push(p);
    const {result, output} = await quiet(() => beatmapMain([], {root: p.root}));
    assert.equal(result, 0);
    assert.match(output.join('\n'), /no track and no analysis: writing the fallback grid; run `pnpm analyze`/);
    const md = readFileSync(target(p.root), 'utf8');
    assert.match(md, /- Track: none \(audio-analysis\.json is the no-track default; run `pnpm analyze`\)/);
    assert.match(md, /None in sections\.json \(the whole song plays as one section\)\./);
    assert.match(md, /None in lyrics\.json\./);
    assert.match(md, /### Candidate drops\n\nAll three bands averaged, W = 30 frames, rise ≥ 6 dB\.\n\nNone found\./);
  });
});
