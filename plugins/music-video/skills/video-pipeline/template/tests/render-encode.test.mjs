// Encoder arguments (scripts/lib/encode.mjs): the H.264 level table gives a
// valid level, the lowest that fits, for 720p, 1080p and 2160p at the
// pipeline fps (drafts and previews); a master takes the lowest that fits and
// allows at least MASTER_MIN_HIGH_BR_KBPS (1080p30 -> 4.1); every encode is High profile, yuv420p, BT.709 TV range with
// the colour tags; CRF and preset come from pipeline.json unless a flag
// overrides them, and reach the worker's encoder; the mux encodes AAC from
// the source file with no -shortest and no audio filter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {chunkEncoderArgs, concatList, H264_LEVELS, h264Level, HIGH_BR_FACTOR, MASTER_MIN_HIGH_BR_KBPS, muxArgs, RGB_TO_BT709_TV, x264Args} from '../scripts/lib/encode.mjs';
import {main as draftMain} from '../scripts/draft.mjs';
import {main as renderMain} from '../scripts/render.mjs';
import {freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, readLog} from './fixtures/render-fakes.mjs';

const PIPELINE_FPS = JSON.parse(readFileSync(join(PROJECT_ROOT, 'src/pipeline.json'), 'utf8')).fps;
const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

const mbs = (w, h) => Math.ceil(w / 16) * Math.ceil(h / 16);
const fits = (l, w, h, fps) => mbs(w, h) <= l.maxFS && mbs(w, h) * fps <= l.maxMBPS && Math.max(Math.ceil(w / 16), Math.ceil(h / 16)) <= Math.sqrt(8 * l.maxFS);
const value = (args, flag) => args[args.indexOf(flag) + 1];

describe('H.264 level', () => {
  for (const [w, h, fps, want] of [
    [1280, 720, PIPELINE_FPS, '3.1'],
    [1920, 1080, PIPELINE_FPS, '4'],
    [3840, 2160, PIPELINE_FPS, '5.1'],
    [960, 540, PIPELINE_FPS, '3.1'],
    [1920, 1080, 60, '4.2'],
    [3840, 2160, 60, '5.2'],
    [1280, 720, 60, '3.2'],
  ]) {
    it(`${w}x${h} at ${fps} fps -> level ${want}: its limits fit and the level below does not`, () => {
      const l = h264Level(w, h, fps);
      assert.equal(l.level, want);
      assert.ok(fits(l, w, h, fps));
      const i = H264_LEVELS.indexOf(l);
      assert.ok(i === 0 || !fits(H264_LEVELS[i - 1], w, h, fps), 'not the lowest level that fits');
    });
  }
  for (const [w, h, fps, want] of [
    [1920, 1080, PIPELINE_FPS, '4.1'],
    [3840, 2160, PIPELINE_FPS, '5.1'],
    [960, 540, PIPELINE_FPS, '4.1'],
    [1920, 1080, 60, '4.2'],
  ]) {
    it(`a master at ${w}x${h} ${fps} fps -> level ${want}: the lowest that fits and allows at least ${MASTER_MIN_HIGH_BR_KBPS / 1000} Mbit/s (High)`, () => {
      const l = h264Level(w, h, fps, {minHighBRKbps: MASTER_MIN_HIGH_BR_KBPS});
      assert.equal(l.level, want);
      assert.ok(fits(l, w, h, fps));
      assert.ok(l.maxBR * HIGH_BR_FACTOR >= MASTER_MIN_HIGH_BR_KBPS);
      const i = H264_LEVELS.indexOf(l);
      const below = H264_LEVELS[i - 1];
      assert.ok(!fits(below, w, h, fps) || below.maxBR * HIGH_BR_FACTOR < MASTER_MIN_HIGH_BR_KBPS, 'not the lowest qualifying level');
    });
  }
  it('the table matches H.264 Table A-1 at the levels the renders use, and refuses sizes beyond level 6.2', () => {
    const at = (lv) => H264_LEVELS.find((l) => l.level === lv);
    assert.deepEqual(at('3.1'), {level: '3.1', maxMBPS: 108000, maxFS: 3600, maxBR: 14000, maxCPB: 14000});
    assert.deepEqual(at('4'), {level: '4', maxMBPS: 245760, maxFS: 8192, maxBR: 20000, maxCPB: 25000});
    assert.deepEqual(at('4.1'), {level: '4.1', maxMBPS: 245760, maxFS: 8192, maxBR: 50000, maxCPB: 62500});
    assert.deepEqual(at('5.1'), {level: '5.1', maxMBPS: 983040, maxFS: 36864, maxBR: 240000, maxCPB: 240000});
    assert.throws(() => h264Level(16384, 16384, 150), /beyond every H\.264 level/);
  });
});

describe('encoder arguments', () => {
  it('x264: High profile at the fitting level, yuv420p, 2 s GOP, BT.709 tags, VBV within the level, CRF or bitrate', () => {
    const a = x264Args({width: 3840, height: 2160, fps: 30, preset: 'medium', crf: 17});
    assert.equal(value(a, '-c:v'), 'libx264');
    assert.equal(value(a, '-profile:v'), 'high');
    assert.equal(value(a, '-level:v'), '5.1');
    assert.equal(value(a, '-pix_fmt'), 'yuv420p');
    assert.equal(value(a, '-g'), '60');
    assert.equal(value(a, '-crf'), '17');
    assert.equal(value(a, '-preset'), 'medium');
    assert.equal(value(a, '-maxrate'), `${240000 * HIGH_BR_FACTOR}k`);
    for (const [flag, v] of [['-color_range', 'tv'], ['-colorspace', 'bt709'], ['-color_primaries', 'bt709'], ['-color_trc', 'bt709']]) assert.equal(value(a, flag), v);
    assert.deepEqual(x264Args({width: 3840, height: 2160, fps: 30, preset: 'medium', crf: 17, master: true}), a, 'a 2160p30 master stays at 5.1');
    // The preview's encode: 720p at its bitrate, plain lowest fit.
    const b = x264Args({width: 1280, height: 720, fps: 30, preset: 'medium', bitrateKbps: 5000});
    assert.equal(value(b, '-b:v'), '5000k');
    assert.equal(b.includes('-crf'), false);
    assert.deepEqual([value(b, '-level:v'), value(b, '-maxrate')], ['3.1', `${14000 * HIGH_BR_FACTOR}k`]);
  });
  it('the chunk encoder reads rgb24 at the output size and fps and converts to TV-range BT.709 yuv420p, tagged', () => {
    const a = chunkEncoderArgs({width: 1920, height: 1080, fps: 30, preset: 'slow', crf: 20, out: '/t/c.mp4', master: true});
    assert.deepEqual(a.slice(a.indexOf('-f'), a.indexOf('-i') + 2), ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-framerate', '30', '-i', '-']);
    assert.equal(value(a, '-vf'), RGB_TO_BT709_TV);
    assert.match(RGB_TO_BT709_TV, /^scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709$/);
    assert.equal(value(a, '-video_track_timescale'), '30');
    assert.deepEqual([value(a, '-level:v'), value(a, '-maxrate'), value(a, '-bufsize')], ['4.1', '62500k', '78125k'], 'a 1080p30 master: level 4.1, VBV at its High limits');
    assert.equal(a.at(-1), '/t/c.mp4');
    const d = chunkEncoderArgs({width: 960, height: 540, fps: 30, preset: 'veryfast', crf: 23, out: '/t/d.mp4'});
    assert.deepEqual([value(d, '-level:v'), value(d, '-maxrate')], ['3.1', '17500k'], 'a draft chunk: plain lowest fit');
  });
  it('the mux: AAC from the source file at the pipeline bitrate, video stream copy, +faststart, CFR timescale; no -shortest, no audio filter or copy', () => {
    const a = muxArgs({video: '/t/v.mp4', audio: '/p/public/audio/track.wav', audioBitrate: '256k', fps: 30, out: '/t/f.mp4', durationSeconds: 7880 / 30});
    assert.deepEqual(a.filter((x, i) => a[i - 1] === '-i'), ['/t/v.mp4', '/p/public/audio/track.wav']);
    assert.equal(value(a, '-c:a'), 'aac');
    assert.equal(value(a, '-b:a'), '256k');
    assert.equal(value(a, '-c:v'), 'copy');
    assert.equal(value(a, '-movflags'), '+faststart');
    assert.equal(value(a, '-video_track_timescale'), '30');
    for (const banned of ['-shortest', '-af', '-filter:a', '-ss']) assert.equal(a.includes(banned), false, banned);
    assert.deepEqual(a.slice(a.indexOf('-t'), a.indexOf('/p/public/audio/track.wav') + 1), ['-t', '262.666667', '-i', '/p/public/audio/track.wav'], 'a full render: the audio is cut to the video length');
    const part = muxArgs({video: 'v', audio: 'a.wav', audioBitrate: '256k', fps: 30, out: 'f', startSeconds: 1, durationSeconds: 2});
    assert.deepEqual(part.slice(part.indexOf('-ss'), part.indexOf('a.wav') + 1), ['-ss', '1.000000', '-t', '2.000000', '-i', 'a.wav'], 'the span is cut on the input side');
    const silent = muxArgs({video: 'v', audio: null, audioBitrate: '256k', fps: 30, out: 'f'});
    assert.equal(silent.includes('-c:a'), false);
    assert.throws(() => muxArgs({video: 'v', audio: 'a.wav', audioBitrate: '256k', fps: 30, out: 'f'}), /needs the video's duration/);
  });
  it('concat list entries quote paths for the concat demuxer', () => {
    assert.equal(concatList(['/a/b.mp4', "/a/it's.mp4"]), "file '/a/b.mp4'\nfile '/a/it'\\''s.mp4'\n");
  });

  it('CRF, preset and level reach the worker encoder: from pipeline.json by default, from --crf / --preset when given; master 4.1, draft lowest fit', {timeout: 60_000}, async () => {
    const p = makeProject({pipeline: {width: 1920, height: 1080, render: {scale: 1, chunkSeconds: 2, crf: 19, preset: 'faster'}, draft: {scale: 0.5}}});
    projects.push(p);
    const encoders = async (argv, main = renderMain) => {
      const log = join(freshDir('enc'), 'events.log');
      const {result, output} = await quiet(() =>
        main(argv, {root: p.root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: 120, sleepMs: 10}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
      );
      assert.equal(result, 0, output.join('\n'));
      return readLog(log).filter((e) => e.event === 'start').map((e) => e.encoder);
    };
    for (const e of await encoders([])) assert.deepEqual([value(e, '-crf'), value(e, '-preset'), value(e, '-profile:v'), e[e.lastIndexOf('-pix_fmt') + 1], value(e, '-vf')], ['19', 'faster', 'high', 'yuv420p', RGB_TO_BT709_TV]);
    for (const e of await encoders(['--crf=24', '--preset=slow'])) assert.deepEqual([value(e, '-crf'), value(e, '-preset')], ['24', 'slow']);
    for (const e of await encoders([])) assert.deepEqual([value(e, '-s'), value(e, '-level:v'), value(e, '-maxrate')], ['1920x1080', '4.1', '62500k'], 'master 1080p30');
    for (const e of await encoders(['--textonly'])) assert.equal(value(e, '-level:v'), '4.1', 'a text-only render is a master');
    for (const e of await encoders([], draftMain)) assert.deepEqual([value(e, '-s'), value(e, '-level:v'), value(e, '-maxrate')], ['960x540', '3.1', '17500k'], 'draft 960x540');
  });
});
