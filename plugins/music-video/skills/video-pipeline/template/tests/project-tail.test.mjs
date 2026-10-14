// pipeline.json tailSeconds: the video runs that many seconds past the end of
// the audio, over silence, so a closing animation can finish. One number
// (src/lib/project.js resolveProject, frames = ceil((audio seconds + tail) *
// fps)) drives the page, the render's chunks and --frames-total, the draft,
// still and the QA scripts; the last section runs through the tail; lyrics
// stay bound to the audio; the mux pads silence only when the range reaches
// the tail; tailSeconds 0 or absent is exactly the timing without a tail.
// The real-render half (audio untouched, A/V durations, scene frames in the
// tail) is tests/render/render-tail.test.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {parseAudioAnalysis} from '../src/lib/analysis.js';
import {scheduleLines} from '../src/lib/exits.js';
import {MAX_TAIL_SECONDS, parsePipeline} from '../src/lib/pipeline.js';
import {resolveProject, withLineIds} from '../src/lib/project.js';
import {placeSections, withWholeSongSection} from '../src/lib/sections.js';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {muxArgs} from '../scripts/lib/encode.mjs';
import {loadProject} from '../scripts/lib/project.mjs';
import {beatmapMarkdown} from '../scripts/beatmap.mjs';
import {contactSheetFrames} from '../scripts/contact-sheet.mjs';
import {main as draftMain} from '../scripts/draft.mjs';
import {main as renderMain, parseRenderArgs, resolveRender} from '../scripts/render.mjs';
import {still} from '../scripts/still.mjs';
import {freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {line, makeProject, NO_TRACK_ANALYSIS} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, readFake, readLog} from './fixtures/render-fakes.mjs';

const BOUNDED = {timeout: 60_000};
const WAV = 'audio/track.wav';
const MP3 = 'audio/track.mp3';
const TRACK = {'public/audio/track.wav': 'RIFF'};
const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

const defaultAnalysis = parseAudioAnalysis(JSON.parse(readFileSync(join(PROJECT_ROOT, 'src/data/audio-analysis.default.json'), 'utf8')));
const PIPE = {outputName: 'fixture', fps: 30, width: 960, height: 540, fallbackSeconds: 4, audioCandidates: [WAV, MP3]};
const pipelineWith = (over = {}) => parsePipeline({...PIPE, ...over});

/** An analysed track `seconds` long (durationInFrames as pnpm analyze writes it), beats every 0.5 s. */
const analysed = (seconds = 4.01, source = WAV, fps = 30) => {
  const beats = Array.from({length: Math.floor(seconds / 0.5) + 1}, (_, i) => i * 0.5).filter((b) => b < seconds);
  return parseAudioAnalysis({
    version: 1, source, generator: 'test', fps, durationSeconds: seconds, durationInFrames: Math.ceil(seconds * fps - 1e-9),
    tempo: 120, beatsPerBar: 4, beats, downbeats: beats.filter((_, i) => i % 4 === 0), onsets: [],
    bands: {low: [20, 250], mid: [250, 4000], high: [4000, 11025]}, energy: {low: [], mid: [], high: []},
  });
};
const SECTIONS = [{id: 'a', scene: 'x', start: 0}, {id: 'b', scene: 'x', start: 2}, {id: 'outro', scene: 'instrumental', start: 3.2, variant: 'tail'}];
const LYRICS = [line('a-1', 'one two three', 0.4, 1.6), line('b-1', 'four five', 2.1, 3.0)];

const resolve = ({pipeline = pipelineWith(), analysis = analysed(), present = [WAV], sections = SECTIONS, lyrics = LYRICS, overrides = {}} = {}) =>
  resolveProject({pipeline, analysis, defaultAnalysis, overrides, lyrics, sections, present});

/** The fields resolveProject returned before tailSeconds existed, computed the old way (frames = durationInFrames). */
const beforeTail = ({analysis, pipeline, sections, lyrics}) => {
  const frames = analysis.durationInFrames;
  return {
    fps: pipeline.fps,
    width: pipeline.width,
    height: pipeline.height,
    timing: 'analysis',
    analysis,
    audio: WAV,
    frames,
    durationInFrames: frames,
    duration: frames / pipeline.fps,
    sections: placeSections(withWholeSongSection(sections), pipeline.fps, frames),
    lyrics: withLineIds(lyrics),
    warnings: [],
  };
};
const TAIL_KEYS = ['audioFrames', 'audioEnd', 'tailFrames'];
const withoutTailKeys = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !TAIL_KEYS.includes(k)));

describe('tailSeconds', () => {
  it('tail-zero-unchanged: tailSeconds absent or 0 gives frames = ceil(audio seconds * fps) and the same project as before the tail existed', () => {
    for (const seconds of [4.01, 4, 7.3333, 131.15]) {
      const analysis = analysed(seconds);
      const absent = resolve({analysis, pipeline: pipelineWith()});
      const zero = resolve({analysis, pipeline: pipelineWith({tailSeconds: 0})});
      assert.equal(pipelineWith().tailSeconds, 0, 'absent parses to 0');
      assert.deepEqual(zero, absent, 'absent and 0 resolve identically');
      assert.equal(absent.frames, Math.ceil(seconds * 30 - 1e-9));
      assert.equal(absent.frames, analysis.durationInFrames);
      // Every field that existed before is deep-equal to the old computation; the new ones describe "no tail".
      assert.deepEqual(withoutTailKeys(absent), beforeTail({analysis, pipeline: pipelineWith(), sections: SECTIONS, lyrics: LYRICS}));
      assert.deepEqual([absent.audioFrames, absent.audioEnd, absent.tailFrames], [absent.frames, absent.duration, 0]);
    }
    // The fallback path too: 4 s fixture fallback = 120 frames.
    const fb = resolve({analysis: defaultAnalysis, present: [], pipeline: pipelineWith({tailSeconds: 0})});
    assert.deepEqual([fb.frames, fb.audioFrames, fb.tailFrames], [120, 120, 0]);
    // The mux without a tail is byte-for-byte today's: no audio filter.
    const o = {video: 'v.mp4', audio: 'a.wav', audioBitrate: '256k', fps: 30, out: 'o.mp4', durationSeconds: 4};
    assert.deepEqual(muxArgs({...o, pad: false}), muxArgs(o));
    assert.ok(!muxArgs(o).includes('-af'));
  });

  it('tail-mux-same-encode: the padded mux args equal the unpadded args except for the inserted -af apad=whole_dur=<duration>', () => {
    for (const o of [
      {video: 'v.mp4', audio: 'a.wav', audioBitrate: '256k', fps: 30, out: 'o.mp4', durationSeconds: 5},
      {video: 'v.mp4', audio: 'a.wav', audioBitrate: '128k', fps: 25, out: 'o.mp4', startSeconds: 3.666667, durationSeconds: 1.333333},
    ]) {
      const plain = muxArgs(o);
      const padded = muxArgs({...o, pad: true});
      const at = padded.indexOf('-af');
      assert.deepEqual(padded.slice(at, at + 2), ['-af', `apad=whole_dur=${o.durationSeconds.toFixed(6)}`]);
      assert.deepEqual([...padded.slice(0, at), ...padded.slice(at + 2)], plain, 'every other arg, in order, is the unpadded mux');
      assert.equal(padded.filter((x) => x === '-af' || x === '-filter:a' || x === '-filter_complex').length, 1, 'one audio filter, no other');
      // Inserted after the audio map, before the encoder settings it must not change.
      assert.equal(padded[at - 1], '1:a:0');
      assert.deepEqual(padded.slice(at + 2, at + 6), ['-c:a', 'aac', '-b:a', o.audioBitrate]);
    }
    // A silent mux has no audio to pad: pad changes nothing.
    const silent = {video: 'v.mp4', audio: null, audioBitrate: '256k', fps: 30, out: 'o.mp4'};
    assert.deepEqual(muxArgs({...silent, pad: true}), muxArgs(silent));
  });

  it('tail-frame-count: frames = ceil((audio seconds + tailSeconds) * fps); analysis, audio end and lyrics are untouched', () => {
    const cases = [
      // [audio seconds, tail, expected frames]
      [4.01, 2, Math.ceil((4.01 + 2) * 30)],
      [4, 2, 180],
      [4, 0.5, 135],
      [4, 1 / 3, 130],
      [4.01, 0.01, Math.ceil((4.01 + 0.01) * 30)],
      [4, MAX_TAIL_SECONDS, 1020],
    ];
    for (const [seconds, tail, frames] of cases) {
      const analysis = analysed(seconds);
      const none = resolve({analysis});
      const p = resolve({analysis, pipeline: pipelineWith({tailSeconds: tail})});
      assert.equal(p.frames, frames, `${seconds}s + ${tail}s`);
      assert.equal(p.durationInFrames, p.frames);
      assert.equal(p.duration, p.frames / 30);
      assert.equal(p.audioFrames, none.frames, 'audioFrames is the old frame count');
      assert.equal(p.audioEnd, none.duration);
      assert.equal(p.tailFrames, p.frames - none.frames);
      assert.deepEqual(p.analysis, none.analysis, 'the analysis (beats, energy, duration) is the audio\'s');
      assert.deepEqual(p.lyrics, none.lyrics);
      assert.deepEqual([p.audio, p.timing, p.warnings], [none.audio, none.timing, none.warnings]);
    }
  });

  it('tail-frame-count: scripts/lib/project.mjs loadProject (still, check, critique, contact-sheet, beatmap, render) gives the page\'s number', () => {
    const p = makeProject({pipeline: {tailSeconds: 2}, analysis: analysed(4.01), sections: SECTIONS, files: TRACK});
    projects.push(p);
    const {project, pipeline} = loadProject(p.root);
    assert.equal(pipeline.tailSeconds, 2);
    assert.equal(project.frames, Math.ceil(6.01 * 30));
    assert.equal(project.audioFrames, Math.ceil(4.01 * 30));
  });

  it('tail-frame-count: render and draft chunk [0, frames) including the tail, pass that count as --frames-total, and pad the mux only into the tail', BOUNDED, async () => {
    const p = makeProject({pipeline: {tailSeconds: 1, render: {scale: 1, chunkSeconds: 1}}, analysis: analysed(4), sections: SECTIONS, files: TRACK});
    projects.push(p);
    const frames = 150; // 4 s audio + 1 s tail at 30 fps
    assert.equal(resolveRender(parseRenderArgs([]), {root: p.root}).last, frames);
    const go = async (main, argv) => {
      const log = join(freshDir('tail'), 'events.log');
      const r = await quiet(() =>
        main(argv, {root: p.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames, sleepMs: 10}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
      );
      assert.equal(r.result, 0, r.output.join('\n'));
      const entries = readLog(log);
      const starts = entries.filter((e) => e.event === 'start');
      return {starts, ranges: starts.map((s) => [s.from, s.to]).sort((a, b) => a[0] - b[0]), mux: entries.find((e) => e.event === 'mux').args};
    };
    const pad = (args) => args[args.indexOf('-af') + 1];

    const full = await go(renderMain, []);
    assert.deepEqual(full.ranges, [[0, 30], [30, 60], [60, 90], [90, 120], [120, 150]], 'the chunks tile [0, 150) exactly, the tail included');
    for (const s of full.starts) assert.equal(s.flags[s.flags.indexOf('--frames-total') + 1], String(frames));
    assert.equal(pad(full.mux), 'apad=whole_dur=5.000000', 'a full render pads the audio to the video length');
    assert.equal(full.mux[full.mux.indexOf('-t') + 1], '5.000000');
    assert.equal(readFake(join(p.root, 'out/fixture.mp4')).frames, '150');

    const draft = await go(draftMain, []);
    assert.deepEqual(draft.ranges.at(-1), [120, 150]);
    for (const s of draft.starts) assert.equal(s.flags[s.flags.indexOf('--frames-total') + 1], String(frames));
    assert.equal(readFake(join(p.root, 'out/draft.mp4')).frames, '150');

    const inside = await go(renderMain, ['--frames=30-89']);
    assert.ok(!inside.mux.includes('-af'), 'a range that ends inside the audio is muxed exactly as before: no filter');
    const tail = await go(renderMain, ['--frames=110-149']);
    assert.deepEqual(tail.ranges, [[110, 130], [130, 150]], 'the chunks tile 110..149');
    assert.equal(pad(tail.mux), 'apad=whole_dur=1.333333');
    assert.deepEqual(tail.mux.slice(tail.mux.indexOf('-ss'), tail.mux.indexOf('-ss') + 4), ['-ss', '3.666667', '-t', '1.333333']);

    const log = join(freshDir('tail'), 'events.log');
    const past = await quiet(() =>
      renderMain(['--frames=140-150'], {root: p.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe()}),
    );
    assert.equal(past.result, 1);
    assert.match(past.output.join('\n'), /runs past the end of the video \(frames 0\.\.149\)/);
  });

  it('tail-frame-count: still (a QA script on project.frames) accepts the last tail frame and refuses the frame after it', async () => {
    const p = makeProject({pipeline: {tailSeconds: 2}, analysis: analysed(4), sections: SECTIONS, files: TRACK});
    projects.push(p);
    // envRoot without a venv: a frame inside the video gets past the frame check and stops at the capture env.
    const envRoot = freshDir('no-env');
    await assert.rejects(still({frame: 179, t: null, scale: 1, textonly: false, scenes: null, out: 'out/s.png'}, {root: p.root, envRoot}), /setup:env/);
    await assert.rejects(
      still({frame: 180, t: null, scale: 1, textonly: false, scenes: null, out: 'out/s.png'}, {root: p.root, envRoot}),
      /frame 180 is past the end of the video \(frames 0\.\.179, 6\.00s\)/,
    );
  });

  it('tail-frame-count: contact-sheet samples the tail through the last section; beatmap lists the tail, and is byte-identical without one', () => {
    const p = resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds: 2})});
    const last = p.sections.at(-1);
    assert.deepEqual([last.id, last.to], ['outro', 180]);
    const stills = contactSheetFrames(p.sections, {fps: 30, frames: p.frames});
    assert.deepEqual(stills.at(-1), {label: 'outro', frame: 111}, 'outro still at its start + 0.5 s');
    const tailLong = resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds: 12})});
    assert.deepEqual(contactSheetFrames(tailLong.sections, {fps: 30, frames: tailLong.frames}).at(-1), {label: 'outro (middle)', frame: Math.floor((96 + 480) / 2)}, 'a long tail gets a middle still inside it');

    const none = resolve({analysis: analysed(4)});
    const md = (q, frames) => beatmapMarkdown({analysis: q.analysis, lyrics: q.lyrics, sections: q.sections, fps: 30, frames});
    assert.equal(md(none, none.frames), md(none, undefined), 'no tail: no tail line');
    assert.ok(!md(none, none.frames).includes('Tail:'));
    const withTail = md(p, p.frames);
    assert.match(withTail, /^- Tail: 2\.00 s of silence after the audio \(pipeline\.json tailSeconds\), frames 120–180\. The video is 180 frames; the last section runs through the tail\.$/m);
    assert.match(withTail, /^\| outro \| instrumental \| tail \| 96–180 \| 3\.20–6\.00 \|$/m);
  });

  it('tail-sections-cover-video: every frame up to the last resolves to exactly one section, the tail to the last; lyric schedules are unchanged', () => {
    for (const sections of [SECTIONS, []]) {
      const p = resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds: 2}), sections});
      const none = resolve({analysis: analysed(4), sections});
      for (let f = 0; f < p.frames; f++) {
        const hits = p.sections.filter((s) => f >= s.from && f < s.to);
        assert.equal(hits.length, 1, `frame ${f}`);
        if (f >= p.audioFrames) assert.equal(hits[0], p.sections.at(-1), `tail frame ${f} belongs to the last section`);
      }
      assert.equal(p.sections.at(-1).to, p.frames);
      assert.equal(p.sections.at(-1).end, p.duration);
      // Every section but the last is placed exactly as without the tail.
      assert.deepEqual(p.sections.slice(0, -1), none.sections.slice(0, -1));
      assert.deepEqual(p.lyrics, none.lyrics);
    }
    // The engine bounds lyric exits by project.audioEnd: with a held last line, the schedule is the no-tail one.
    const p = resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds: 2})});
    const none = resolve({analysis: analysed(4)});
    const regs = new Map([['a-1', {}], ['b-1', {exitAt: 'hold'}]]);
    const tailSched = scheduleLines(p.lyrics, regs, {fps: 30, duration: p.audioEnd});
    assert.deepEqual(tailSched, scheduleLines(none.lyrics, regs, {fps: 30, duration: none.duration}));
    assert.ok(tailSched.get('b-1').exitEnd <= p.audioEnd + 1e-9, 'a held last line is gone by the end of the audio');
    const engine = readFileSync(join(PROJECT_ROOT, 'src/engine/engine.js'), 'utf8');
    assert.match(engine, /new LyricLayer\(\{.*duration: P\.audioEnd\}\)/, 'the page passes the audio end to the lyric layer');
  });

  it('tail-sections-cover-video: a section starting in the tail (after the audio) is still refused as stale, naming the audio end', () => {
    assert.throws(
      () => resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds: 2}), sections: [{id: 'a', scene: 'x', start: 0}, {id: 'late', scene: 'x', start: 4.5}]}),
      /section "late" starts at 4\.5s \(frame 135\), at or after the end of the audio \(120 frames, 4\.00s; the tail after it belongs to the last section\)/,
    );
  });

  it('tail-config-validation: negative, NaN, non-number or > 30 tailSeconds is refused naming the field; 0 and small positives are accepted', () => {
    for (const bad of [-1, -0.001, NaN, Infinity, '2', null, true, [], {}, 30.001, 31, 1e9]) {
      assert.throws(() => pipelineWith({tailSeconds: bad}), /^Error: pipeline\.json: tailSeconds must be a number of seconds from 0 to 30 \(got .*\)$/, String(bad));
    }
    for (const ok of [0, 0.01, 1 / 3, 2, 12.5, 30]) assert.equal(pipelineWith({tailSeconds: ok}).tailSeconds, ok);
    assert.equal(pipelineWith().tailSeconds, 0);
    assert.equal(MAX_TAIL_SECONDS, 30);
    // This project's committed pipeline.json parses with a tail in range (0 when it sets none, as the template ships).
    const committed = parsePipeline(JSON.parse(readFileSync(join(PROJECT_ROOT, 'src/pipeline.json'), 'utf8'))).tailSeconds;
    assert.ok(committed >= 0 && committed <= MAX_TAIL_SECONDS, String(committed));
  });

  it('tail-stale-timing-guard: tailSeconds never makes the analysis look stale; a changed track still falls back and renders refuse it', BOUNDED, async () => {
    for (const tailSeconds of [0, 2, 30]) {
      const p = resolve({analysis: analysed(4), pipeline: pipelineWith({tailSeconds})});
      assert.deepEqual([p.timing, p.audio, p.warnings], ['analysis', WAV, []], `tail ${tailSeconds}`);
      // Changed track: the analysed wav replaced by an mp3, or an analysis at another fps.
      const swapped = resolve({analysis: analysed(4), present: [MP3], pipeline: pipelineWith({tailSeconds})});
      assert.equal(swapped.timing, 'fallback');
      assert.ok(swapped.warnings.some((w) => /track\.mp3 has not been analysed/.test(w)), JSON.stringify(swapped.warnings));
      const otherFps = resolve({analysis: analysed(4, WAV, 25), pipeline: pipelineWith({tailSeconds})});
      assert.equal(otherFps.timing, 'fallback');
    }
    const p = makeProject({pipeline: {tailSeconds: 2}, files: TRACK}); // track present, no analysis of it
    projects.push(p);
    assert.throws(() => resolveRender(parseRenderArgs([]), {root: p.root}), /is present but the timing in effect is the fallback.*Run `pnpm analyze` before rendering/s);
    const ok = makeProject({pipeline: {tailSeconds: 2}, analysis: analysed(4), files: TRACK});
    projects.push(ok);
    assert.equal(resolveRender(parseRenderArgs([]), {root: ok.root}).project.timing, 'analysis');
  });

  it('tail-fallback-no-track: the no-track fallback grid gets the tail too (silent), with lines past the fallback length still dropped', BOUNDED, async () => {
    const lyrics = [line('a-1', 'kept', 1, 2), line('late-1', 'in the tail', 4.5, 5)];
    const p = resolve({analysis: defaultAnalysis, present: [], pipeline: pipelineWith({tailSeconds: 2}), sections: [], lyrics});
    assert.deepEqual([p.timing, p.audio, p.frames, p.audioFrames, p.tailFrames], ['fallback', null, 180, 120, 60]);
    assert.deepEqual(p.sections.map((s) => [s.id, s.from, s.to]), [['song', 0, 180]]);
    assert.deepEqual(p.lyrics.map((l) => l.id), ['a-1'], 'a line starting after the fallback audio end is dropped, as before');
    // Sections past the fallback length are dropped (not placed in the tail).
    const q = resolve({analysis: defaultAnalysis, present: [], pipeline: pipelineWith({tailSeconds: 2}), sections: [{id: 'a', scene: 'x', start: 0}, {id: 't', scene: 'x', start: 4.5}], lyrics: []});
    assert.deepEqual(q.sections.map((s) => [s.id, s.from, s.to]), [['a', 0, 180]]);

    // The silent no-track render covers the tail and has no audio input to pad.
    const proj = makeProject({pipeline: {tailSeconds: 2, render: {scale: 1, chunkSeconds: 2}}, analysis: NO_TRACK_ANALYSIS});
    projects.push(proj);
    const log = join(freshDir('tail-fb'), 'events.log');
    const r = await quiet(() =>
      renderMain([], {root: proj.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: 180, sleepMs: 10}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
    );
    assert.equal(r.result, 0, r.output.join('\n'));
    const mux = readLog(log).find((e) => e.event === 'mux').args;
    assert.equal(mux.filter((x, i) => mux[i - 1] === '-i').length, 1, 'only the video goes into the mux');
    assert.ok(!mux.includes('-af'));
    assert.deepEqual(readFake(join(proj.root, 'out/fixture.mp4')), {frames: '180', size: '960x540', audio: '0'});
  });
});
