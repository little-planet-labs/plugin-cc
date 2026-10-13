// Chunk failure handling in `pnpm render` (fake workers, ffmpeg and ffprobe):
// a failed chunk is retried alone, a chunk with the wrong decoded frame count
// counts as failed and is never concatenated, a chunk past the retry limit
// fails the render with no output and no temp folder, the joined and muxed
// videos are counted again before anything is written, and temp folders left
// by a render that is no longer running are swept at the next start. A
// render on fallback timing with a track present is refused before anything
// starts, a no-track fallback render is silent, and the mux always cuts the
// audio to the video's span.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {main as renderMain} from '../scripts/render.mjs';
import {main as draftMain} from '../scripts/draft.mjs';
import {freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, launchesByChunk, readFake, readLog} from './fixtures/render-fakes.mjs';

const BOUNDED = {timeout: 60_000};
const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

// 120 frames (fixture fallback timing: 4 s at 30 fps) in 0.5 s chunks: 8 chunks of 15 frames, from 0, 15, ... 105.
const CHUNK_STARTS = [0, 15, 30, 45, 60, 75, 90, 105];

const setup = ({behaviour = '{}', ffmpeg = {}, main = renderMain, argv = []} = {}) => {
  const p = makeProject({pipeline: {render: {scale: 1, chunkSeconds: 0.5}}});
  projects.push(p);
  const log = join(freshDir('chunks'), 'events.log');
  const run = () =>
    quiet(() =>
      main(argv, {
        root: p.root,
        envRoot: PROJECT_ROOT,
        pythonBin: fakePython({log, frames: 120, sleepMs: 60, behaviour}),
        ffmpegBin: fakeFfmpeg({log, ...ffmpeg}),
        ffprobeBin: fakeFfprobe(),
        staggerMs: 0,
        killGraceMs: 2000,
      }),
    );
  const outDir = join(p.root, 'out');
  return {p, log, run, outDir, output: join(outDir, 'fixture.mp4')};
};

const outFiles = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

describe('chunk failure', () => {
  it('a worker failing its first attempt for one chunk causes exactly one retry of that chunk and no relaunch of any other', BOUNDED, async () => {
    const c = setup({behaviour: 'from === 30 && attempt === 1 ? {code: 1} : {}'});
    const {result, output} = await c.run();
    assert.equal(result, 0, output.join('\n'));
    assert.deepEqual(launchesByChunk(c.log), Object.fromEntries(CHUNK_STARTS.map((f) => [f, f === 30 ? 2 : 1])));
    assert.equal(readFake(c.output).frames, '120');
    assert.deepEqual(outFiles(c.outDir), ['fixture.manifest.json', 'fixture.mp4'], 'only the video and its manifest; no temp folder left');
  });

  it('a worker that exits 0 with the wrong frame count is treated as failed, retried, and its file never reaches the concat list', BOUNDED, async () => {
    const c = setup({behaviour: "from === 45 && attempt === 1 ? {frames: 14} : from === 90 && attempt === 1 ? {write: false} : {}"});
    const {result, output} = await c.run();
    assert.equal(result, 0, output.join('\n'));
    assert.deepEqual(launchesByChunk(c.log), Object.fromEntries(CHUNK_STARTS.map((f) => [f, f === 45 || f === 90 ? 2 : 1])));
    const concats = readLog(c.log).filter((e) => e.event === 'concat');
    assert.equal(concats.length, 1);
    assert.equal(concats[0].files.length, 8);
    assert.deepEqual(concats[0].files.map((f) => f.frames), CHUNK_STARTS.map(() => 15), 'every concatenated chunk had its expected 15 frames');
    assert.ok(output.some((l) => /chunk 4\/8 \[45, 60\) failed \(decoded 14 frames, expected 15\)/.test(l)), output.join('\n'));
    assert.ok(output.some((l) => /chunk 7\/8 \[90, 105\) failed \(decoded -1 frames, expected 15\)/.test(l)), output.join('\n'));
    assert.equal(readFake(c.output).frames, '120');
  });

  it('a chunk that fails past the retry limit fails the render: exit 1, no output, temp folder gone, the other chunks not relaunched', BOUNDED, async () => {
    const c = setup({behaviour: 'from === 60 ? {code: 3} : {}'});
    const {result, output} = await c.run();
    assert.equal(result, 1);
    assert.ok(output.some((l) => /chunk 5\/8 \[60, 75\) failed 3 time\(s\), last: exit code 3/.test(l)), output.join('\n'));
    const launches = launchesByChunk(c.log);
    assert.equal(launches[60], 3, 'one attempt plus pipeline render.retries (2) retries');
    for (const [from, n] of Object.entries(launches)) if (Number(from) !== 60) assert.equal(n, 1, `chunk ${from} relaunched`);
    assert.deepEqual(outFiles(c.outDir), [], 'no video, no manifest, no .render-* temp folder');
    assert.equal(readLog(c.log).filter((e) => e.event === 'concat').length, 0, 'nothing was concatenated');
  });

  it('joined chunks with the wrong total are refused before the mux; nothing is written', BOUNDED, async () => {
    const c = setup({ffmpeg: {concatShort: true}});
    const {result, output} = await c.run();
    assert.equal(result, 1);
    assert.ok(output.some((l) => /the joined chunks have 119 frames, expected 120/.test(l)), output.join('\n'));
    assert.equal(readLog(c.log).filter((e) => e.event === 'mux').length, 0);
    assert.deepEqual(outFiles(c.outDir), []);
  });

  it('a failing mux leaves no output and no temp folder', BOUNDED, async () => {
    const c = setup({ffmpeg: {failOn: 'mux'}});
    const {result} = await c.run();
    assert.equal(result, 1);
    assert.deepEqual(outFiles(c.outDir), []);
  });

  it('a partial range renders exactly frames a..b, chunked from a, and muxes the matching audio span', BOUNDED, async () => {
    const c = setup({argv: ['--frames=20-79']});
    const {result, output} = await c.run();
    assert.equal(result, 0, output.join('\n'));
    const runs = readLog(c.log).filter((e) => e.event === 'start');
    assert.deepEqual(runs.map((r) => [r.from, r.to]).sort((a, b) => a[0] - b[0]), [[20, 35], [35, 50], [50, 65], [65, 80]]);
    const out = join(c.outDir, 'fixture-frames-20-79.mp4');
    assert.equal(readFake(out).frames, '60');
    assert.equal(existsSync(c.output), false, 'a partial render never defaults onto the master');
  });

  it('pnpm draft runs through the same pool and chunk checks: draft scale and settings, one capture per frame, out/draft.mp4', BOUNDED, async () => {
    const c = setup({main: draftMain, behaviour: 'from === 15 && attempt === 1 ? {code: 1} : {}'});
    const {result, output} = await c.run();
    assert.equal(result, 0, output.join('\n'));
    const starts = readLog(c.log).filter((e) => e.event === 'start');
    assert.equal(launchesByChunk(c.log)[15], 2);
    for (const s of starts) {
      assert.ok(s.flags.includes('--single'), 'a draft captures once per frame');
      assert.equal(s.flags[s.flags.indexOf('--scale') + 1], '0.5');
      assert.equal(s.flags[s.flags.indexOf('--format') + 1], 'jpeg');
      assert.equal(s.encoder[s.encoder.indexOf('-s') + 1], '480x270');
      assert.equal(s.encoder[s.encoder.indexOf('-crf') + 1], '23');
      assert.equal(s.encoder[s.encoder.indexOf('-preset') + 1], 'veryfast');
    }
    assert.equal(readFake(join(c.outDir, 'draft.mp4')).frames, '120');
    assert.equal(existsSync(c.output), false);
  });

  it('temp folders left by a render that is no longer running are removed at the next start; a live one is kept', BOUNDED, async () => {
    const c = setup();
    const dead = spawnSync(process.execPath, ['-e', '']).pid; // exited: its pid is no longer alive
    const stale = [`.render-${dead}-abc123`, `.draft-${dead}-def456`];
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); // another render, still running
    const live = `.render-${other.pid}-live01`;
    for (const d of [...stale, live, 'keep-me']) mkdirSync(join(c.outDir, d, 'inner'), {recursive: true});
    let result;
    let output;
    try {
      ({result, output} = await c.run());
    } finally {
      other.kill('SIGKILL');
    }
    assert.equal(result, 0, output.join('\n'));
    assert.deepEqual(outFiles(c.outDir), [live, 'fixture.manifest.json', 'fixture.mp4', 'keep-me'].sort());
    for (const d of stale) assert.ok(output.some((l) => l === `render: removed ${d}, left by a render that is no longer running`), output.join('\n'));
  });
});

describe('timing and audio', () => {
  // A 4 s analysis of public/audio/track.wav at 30 fps (120 frames), as pnpm analyze writes it.
  const analysis = (fps = 30) => ({
    version: 1,
    source: 'audio/track.wav',
    generator: 'test',
    fps,
    durationSeconds: 4,
    durationInFrames: 4 * fps,
    tempo: 120,
    beatsPerBar: 4,
    beats: [],
    downbeats: [],
    onsets: [],
    bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]},
    energy: {low: [], mid: [], high: []},
  });
  const project = (o) => {
    const p = makeProject({pipeline: {render: {scale: 1, chunkSeconds: 1}}, ...o});
    projects.push(p);
    return p;
  };
  const go = (p, main, argv) => {
    const log = join(freshDir('timing'), 'events.log');
    return quiet(() =>
      main(argv, {root: p.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: 120, sleepMs: 10}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
    ).then((r) => ({...r, log}));
  };
  const TRACK = {'public/audio/track.wav': 'RIFF'};

  it('a render on fallback timing with a track present is refused, naming pnpm analyze, before any Chromium starts', BOUNDED, async () => {
    const cases = [
      // No analysis for the track (the template's default analysis has no source).
      [project({files: TRACK}), renderMain, [], /public\/audio\/track\.wav has not been analysed/],
      [project({files: TRACK}), draftMain, [], /public\/audio\/track\.wav has not been analysed/],
      [project({files: TRACK}), renderMain, ['--frames=0-29'], /public\/audio\/track\.wav has not been analysed/],
      // An analysis made at another fps.
      [project({files: TRACK, analysis: analysis(25)}), renderMain, [], /was made at 25fps but pipeline\.json fps is 30/],
    ];
    for (const [p, main, argv, why] of cases) {
      const {result, output, log} = await go(p, main, argv);
      assert.equal(result, 1, `${argv.join(' ')}: ${output.join('\n')}`);
      const message = output.join('\n');
      assert.match(message, /public\/audio\/track\.wav is present but the timing in effect is the fallback/);
      assert.match(message, why);
      assert.match(message, /Run `pnpm analyze` before rendering/);
      assert.deepEqual(readLog(log), [], 'nothing was started: no page info, no worker');
      assert.deepEqual(outFiles(join(p.root, 'out')), []);
    }
  });

  it('a no-track fallback render is allowed and silent', BOUNDED, async () => {
    const p = project({});
    const {result, output, log} = await go(p, renderMain, []);
    assert.equal(result, 0, output.join('\n'));
    const mux = readLog(log).find((e) => e.event === 'mux');
    assert.deepEqual(mux.args.filter((x, i) => mux.args[i - 1] === '-i').length, 1, 'only the video goes into the mux');
    assert.equal(readFake(join(p.root, 'out/fixture.mp4')).audio, '0');
    assert.ok(output.some((l) => /the video will be silent/.test(l)), output.join('\n'));
  });

  it('the mux always cuts the source audio to frames / fps (and starts it at the first frame of a partial render)', BOUNDED, async () => {
    const p = project({files: TRACK, analysis: analysis()});
    const muxOf = async (argv) => {
      const {result, output, log} = await go(p, renderMain, argv);
      assert.equal(result, 0, output.join('\n'));
      return readLog(log).find((e) => e.event === 'mux').args;
    };
    const full = await muxOf([]);
    const wav = join(p.root, 'public/audio/track.wav');
    const audioIn = (args) => args.slice(args.findIndex((x, i) => i > 0 && args[i - 1] === '-i') + 1, args.lastIndexOf(realpathSync(wav)) + 1);
    assert.deepEqual(audioIn(full), ['-t', '4.000000', '-i', realpathSync(wav)], 'full render: 120 frames / 30 fps');
    assert.deepEqual(audioIn(await muxOf(['--frames=30-89'])), ['-ss', '1.000000', '-t', '2.000000', '-i', realpathSync(wav)]);
  });
});
