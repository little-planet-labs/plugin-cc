// `pnpm clips`: the clip list (validation, frame snapping, fades), a
// committed src/clips.vertical.json when the project has one (its content is
// the director's: only its shape and fit are pinned here), the per-config defaults (list, master,
// manifest name), the ffmpeg command, and an end-to-end cut of a synthetic
// master whose frames show their own index and whose audio is a chirp:
// every clip has exactly end - start frames, starting on the right frame,
// audio as long as the video and sample-aligned with the master, faded to
// silence at both cuts, and nothing is left behind on a failure or refusal.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {
  AUDIO_TOLERANCE_SECONDS,
  checkClipsFit,
  clipFfmpegArgs,
  clipFile,
  clipListFor,
  clipsManifestName,
  cutClips,
  main as clipsMain,
  parseClipList,
  parseClipsArgs,
} from '../scripts/clips.mjs';
import {PROJECT_ROOT} from '../scripts/lib/env.mjs';
import {loadProject} from '../scripts/lib/project.mjs';
import {fakeBin, freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {FIXTURE_PIPELINE, makeProject} from './fixtures/engine-project.mjs';
import {hasFfmpeg, INDEX_STRIPES} from './fixtures/qa-clips.mjs';

const FPS = 30;
const VERTICAL = 'src/pipeline.vertical.json';

describe('the clip list', () => {
  it('snaps start and end to the nearest frame, end exclusive, and fills the fades from the file, then the defaults', () => {
    const list = parseClipList(
      {
        fadeOut: 0.3,
        clips: [
          {slug: 'a', start: 10.553, end: 50.2},
          {slug: 'b-2', start: 2.017, end: 7.349, fadeIn: 0, fadeOut: 0.05, note: 'between frames', $comment: 'x'},
        ],
      },
      {fps: FPS},
    );
    assert.deepEqual(list[0], {slug: 'a', start: 317 / 30, end: 1506 / 30, startFrame: 317, endFrame: 1506, frames: 1189, seconds: 1189 / 30, fadeIn: 0.15, fadeOut: 0.3, note: null});
    assert.deepEqual(
      [list[1].startFrame, list[1].endFrame, list[1].frames, list[1].fadeIn, list[1].fadeOut, list[1].note],
      [61, 220, 159, 0, 0.05, 'between frames'],
    );
    assert.deepEqual(parseClipList({clips: [{slug: 'x', start: 0, end: 1}]}, {fps: FPS})[0].fadeOut, 0.4, 'the default fade-out');
  });
  it('refuses a start not before its end (after snapping), bad slugs, repeats, unknown keys, bad numbers and fades longer than the clip', () => {
    const one = (clip, extra = {}) => () => parseClipList({...extra, clips: [clip]}, {fps: FPS, where: 'c.json'});
    assert.throws(one({slug: 'a', start: 5, end: 5}), /^Error: c\.json: clips\[0\] "a" must start before it ends: start 5 s and end 5 s are frames 150 and 150 at 30 fps/);
    assert.throws(one({slug: 'a', start: 5, end: 4}), /must start before it ends/);
    assert.throws(one({slug: 'a', start: 1.0, end: 1.01}), /must start before it ends: start 1 s and end 1\.01 s are frames 30 and 30/, 'the same frame once snapped');
    assert.throws(one({slug: 'a', start: -1, end: 4}), /clips\[0\]\.start must be song seconds >= 0/);
    assert.throws(one({slug: 'a', start: 0, end: '4'}), /clips\[0\]\.end must be song seconds/);
    for (const slug of ['A', 'a b', 'a--b', '-a', 'a-', '', 'a/b', '../x', 7]) assert.throws(one({slug, start: 0, end: 1}), /clips\[0\]\.slug must be lowercase/, String(slug));
    assert.throws(one({slug: 'a', start: 0, end: 1, fadein: 1}), /clips\[0\]\.fadein is not a known key/);
    assert.throws(one({slug: 'a', start: 0, end: 1, fadeOut: -0.1}), /clips\[0\]\.fadeOut must be a number of seconds >= 0/);
    assert.throws(one({slug: 'a', start: 0, end: 1, fadeIn: 0.6, fadeOut: 0.5}), /fadeIn 0\.6 s \+ fadeOut 0\.5 s is longer than the clip \(1\.000 s\)/);
    assert.throws(one({slug: 'a', start: 0, end: 1, note: 3}), /clips\[0\]\.note must be a string/);
    assert.throws(() => parseClipList({clips: [{slug: 'a', start: 0, end: 1}, {slug: 'a', start: 1, end: 2}]}, {fps: FPS}), /clips\[1\]\.slug "a" is used twice/);
    assert.throws(() => parseClipList({clips: []}, {fps: FPS}), /clips must be a non-empty list/);
    assert.throws(() => parseClipList([], {fps: FPS}), /root must be an object/);
    assert.throws(() => parseClipList({clips: [{slug: 'a', start: 0, end: 1}], extra: 1}, {fps: FPS}), /extra is not a known key/);
  });
  it('checkClipsFit refuses an end past the master\'s last frame and accepts one ending on it', () => {
    const list = parseClipList({clips: [{slug: 'a', start: 0, end: 4}]}, {fps: FPS});
    assert.doesNotThrow(() => checkClipsFit(list, {frames: 120, fps: FPS, input: 'm.mp4'}));
    assert.throws(() => checkClipsFit(list, {frames: 119, fps: FPS, input: 'm.mp4'}), /clip "a" ends at frame 120 \(4\.000 s\) but m\.mp4 has 119 frames/);
  });
});

// The clip list is written per song (the template ships none). When this project has one, only its shape and
// its fit in the vertical video are pinned; its content is the director's.
const COMMITTED_LIST = join(PROJECT_ROOT, 'src/clips.vertical.json');
describe('the committed src/clips.vertical.json', {skip: existsSync(COMMITTED_LIST) ? false : 'no src/clips.vertical.json in this project'}, () => {
  it('is the vertical config\'s own list, parses, and every clip fits in the vertical video', () => {
    assert.equal(clipListFor(VERTICAL), 'src/clips.vertical.json');
    const {pipeline, project} = loadProject(PROJECT_ROOT, VERTICAL);
    const list = parseClipList(JSON.parse(readFileSync(COMMITTED_LIST, 'utf8')), {fps: pipeline.fps});
    assert.ok(list.length > 0);
    assert.doesNotThrow(() => checkClipsFit(list, {frames: project.frames, fps: pipeline.fps, input: `out/${pipeline.outputName}.mp4`}));
  });
});

describe('clips arguments and the ffmpeg command', () => {
  let p;
  before(() => {
    p = makeProject({
      pipeline: {outputName: 'music-video'},
      files: {
        [VERTICAL]: JSON.stringify({...FIXTURE_PIPELINE, outputName: 'music-video-vertical', width: 540, height: 960}),
        // The vertical config's own clip list; the landscape config has none (src/clips.json).
        'src/clips.vertical.json': JSON.stringify({clips: [{slug: 'one', start: 0, end: 1}]}),
      },
    });
  });
  after(() => p?.cleanup());
  it('the clip list and the manifest name follow the config', () => {
    assert.equal(clipListFor('src/pipeline.json'), 'src/clips.json');
    assert.equal(clipListFor(VERTICAL), 'src/clips.vertical.json');
    assert.equal(clipListFor('src/pipeline.square-1x1.json'), 'src/clips.square-1x1.json');
    assert.equal(clipsManifestName('music-video-vertical'), 'music-video-vertical-clips.manifest.json');
    assert.notEqual(clipsManifestName('music-video'), clipsManifestName('music-video-vertical'));
  });
  it('defaults: the config\'s own clip list (refused when it has none), its master, out/clips; every flag in both forms', () => {
    const root = p.root;
    assert.deepEqual(parseClipsArgs([`--pipeline=${VERTICAL}`], {root}), {
      pipeline: VERTICAL,
      clips: join(root, 'src/clips.vertical.json'),
      input: join(root, 'out/music-video-vertical.mp4'),
      outDir: join(root, 'out/clips'),
    });
    assert.throws(() => parseClipsArgs([], {root}), /src\/pipeline\.json has no clip list: src\/clips\.json doesn't exist \(write it, or pass --clips <json>\)/, 'landscape never falls back to the vertical list');
    assert.deepEqual(parseClipsArgs(['--clips=c.json'], {root}), {pipeline: 'src/pipeline.json', clips: join(root, 'c.json'), input: join(root, 'out/music-video.mp4'), outDir: join(root, 'out/clips')});
    assert.deepEqual(parseClipsArgs(['--pipeline', VERTICAL, '--clips', 'c.json', '--in', 'm.mp4', '--out-dir', 'x'], {root}), {
      pipeline: VERTICAL,
      clips: join(root, 'c.json'),
      input: join(root, 'm.mp4'),
      outDir: join(root, 'x'),
    });
    assert.deepEqual(parseClipsArgs(['--clips=c.json', '--in=m.mp4', '--out-dir=x'], {root}).outDir, join(root, 'x'));
    assert.throws(() => parseClipsArgs(['--clips=c.txt'], {root}), /--clips must be a \.json file/);
    assert.throws(() => parseClipsArgs(['--in=a.mp4', '--in=b.mp4'], {root}), /--in given twice/);
    assert.throws(() => parseClipsArgs(['--frames=1'], {root}), /unexpected argument "--frames=1"/);
    assert.throws(() => parseClipsArgs(['--in'], {root}), /--in needs a value/);
  });
  it('cuts by frame number and sample number from the file\'s start, fades the audio, and encodes CFR H.264 + AAC 48 kHz with +faststart', () => {
    const [clip] = parseClipList({clips: [{slug: 'verse-chorus', start: 10.553, end: 50.2, fadeOut: 0.25}]}, {fps: FPS});
    const args = clipFfmpegArgs({input: 'in.mp4', clip, fps: FPS, width: 1080, height: 1920, out: 'out.mp4'});
    const at = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(at('-t'), '51.200000', 'reads one second past the clip');
    assert.ok(args.indexOf('-t') < args.indexOf('-i'), '-t limits the input');
    const graph = at('-filter_complex');
    assert.match(graph, /\[0:v:0\]trim=start_frame=317:end_frame=1506,setpts=PTS-STARTPTS,/);
    assert.match(graph, /\[0:a:0\]aresample=48000,atrim=start_sample=507200:end_sample=2409600,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0\.150000,afade=t=out:st=39\.383333:d=0\.250000\[a\]/);
    assert.doesNotMatch(graph, /fade=t=out[^[]*\[v\]|\bfade=/, 'no video fade');
    for (const [flag, value] of [
      ['-c:v', 'libx264'],
      ['-crf', '18'],
      ['-pix_fmt', 'yuv420p'],
      ['-r', '30'],
      ['-fps_mode', 'cfr'],
      ['-c:a', 'aac'],
      ['-b:a', '256k'],
      ['-ar', '48000'],
      ['-video_track_timescale', '30'],
      ['-movie_timescale', '48000'],
      ['-movflags', '+faststart'],
    ]) {
      assert.equal(at(flag), value, flag);
    }
    assert.equal(args[args.length - 1], 'out.mp4');
    const silent = clipFfmpegArgs({input: 'in.mp4', clip: {...clip, fadeIn: 0, fadeOut: 0}, fps: FPS, width: 1080, height: 1920, out: 'o.mp4'});
    assert.doesNotMatch(silent[silent.indexOf('-filter_complex') + 1], /afade/, 'a zero fade adds no filter');
  });
});

describe('cutting clips', {skip: hasFfmpeg ? false : 'ffmpeg/ffprobe not on PATH'}, () => {
  const W = 128;
  const H = 192;
  let p;
  let root;
  let master;
  const ffmpeg = (args) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], {maxBuffer: 1 << 28});
    assert.equal(r.status, 0, String(r.stderr));
    return r.stdout;
  };
  /** A 4 s, 120-frame master: each frame shows its index as 8 stripes; the audio is a chirp (no period to alias on). */
  const makeMaster = (file, {fps = FPS, audio = true} = {}) => {
    ffmpeg([
      '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=4,format=gray`,
      ...(audio ? ['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*(300+500*t)*t):s=48000:d=4'] : []),
      '-vf', `geq=lum='${INDEX_STRIPES}'`,
      '-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', String(2 * fps),
      ...(audio ? ['-c:a', 'aac', '-b:a', '256k'] : []),
      '-video_track_timescale', String(fps), '-movflags', '+faststart',
      file,
    ]);
    return file;
  };
  /** The index each frame of `file` shows, read from its stripes. */
  const frameIndices = (file) => {
    const raw = ffmpeg(['-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-fps_mode', 'passthrough', '-']);
    const n = raw.length / (W * H);
    const y = Math.floor(H / 2);
    return Array.from({length: n}, (_, f) => {
      let v = 0;
      for (let b = 0; b < 8; b++) if (raw[f * W * H + y * W + Math.floor(((b + 0.5) * W) / 8)] > 128) v |= 1 << b;
      return v;
    });
  };
  const pcm = (file) => {
    const raw = ffmpeg(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
    return Int16Array.from({length: raw.length / 2}, (_, i) => raw.readInt16LE(2 * i));
  };
  const probe = (file) =>
    JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,nb_read_packets,duration,r_frame_rate,avg_frame_rate,width,height', '-of', 'json', file], {encoding: 'utf8'}).stdout)
      .streams;
  const writeList = (name, list) => {
    const f = join(freshDir('clip-lists'), name);
    writeFileSync(f, JSON.stringify(list));
    return f;
  };
  const LIST = {clips: [{slug: 'early', start: 1.5, end: 2.7}, {slug: 'odd-times', start: 0.517, end: 3.349, fadeIn: 0.05, fadeOut: 0.2}, {slug: 'whole', start: 0, end: 4}]};

  before(() => {
    p = makeProject({
      pipeline: {outputName: 'music-video'},
      files: {
        [VERTICAL]: JSON.stringify({...FIXTURE_PIPELINE, outputName: 'music-video-vertical', width: 540, height: 960}),
        // A sibling config whose master is where a clip would go (out/music-video-vertical-early.mp4).
        'src/pipeline.clash.json': JSON.stringify({...FIXTURE_PIPELINE, outputName: 'music-video-vertical-early'}),
      },
    });
    root = p.root;
    master = makeMaster(join(freshDir('masters'), 'master.mp4'));
  });
  after(() => p?.cleanup());

  const run = (argv) => quiet(() => clipsMain(argv, {root}));

  it('every clip has exactly end - start frames starting on its start frame, CFR, and audio as long as the video, aligned and faded', async () => {
    const outDir = freshDir('clips-out');
    const {result, output} = await run([`--pipeline=${VERTICAL}`, '--in', master, '--clips', writeList('ok.json', LIST), '--out-dir', outDir]);
    assert.equal(result, 0, output.join('\n'));
    const manifestName = 'music-video-vertical-clips.manifest.json';
    assert.deepEqual(readdirSync(outDir).sort(), [manifestName, ...['early', 'odd-times', 'whole'].map((s) => clipFile('music-video-vertical', s))].sort(), 'only the clips and the manifest; no temp folder');
    const manifest = JSON.parse(readFileSync(join(outDir, manifestName), 'utf8'));
    assert.deepEqual(
      manifest.clips.map((c) => [c.slug, c.startFrame, c.endFrame, c.frames, c.seconds]),
      [['early', 45, 81, 36, 1.2], ['odd-times', 16, 100, 84, 2.8], ['whole', 0, 120, 120, 4]],
    );
    assert.deepEqual([manifest.pipeline, manifest.fps, manifest.width, manifest.height], [VERTICAL, 30, W, H]);
    const source = pcm(master);
    const peak = source.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    for (const c of manifest.clips) {
      const file = join(root, c.file);
      assert.deepEqual(frameIndices(file), Array.from({length: c.frames}, (_, k) => c.startFrame + k), `${c.slug}: frame-exact`);
      const [v, a] = ['video', 'audio'].map((t) => probe(file).find((s) => s.codec_type === t));
      assert.deepEqual([Number(v.nb_read_packets), v.r_frame_rate, v.avg_frame_rate, v.width, v.height], [c.frames, '30/1', '30/1', W, H], c.slug);
      assert.ok(Math.abs(Number(a.duration) - c.frames / FPS) <= AUDIO_TOLERANCE_SECONDS, `${c.slug}: audio ${a.duration} s, video ${c.frames / FPS} s`);
      assert.ok(Math.abs(Number(v.duration) - c.frames / FPS) < 1e-6, `${c.slug}: video ${v.duration} s`);
      const clip = pcm(file);
      const n = c.frames * 1600;
      assert.ok(clip.length >= n, `${c.slug}: ${clip.length} samples decoded`);
      // No pop: both cuts start and end at (near) silence.
      const ms = 48;
      const edge = (a0) => Math.max(...Array.from({length: ms}, (_, i) => Math.abs(clip[a0 + i])));
      assert.ok(edge(0) < peak * 0.05, `${c.slug}: first ms peaks at ${edge(0)} of ${peak}`);
      assert.ok(edge(n - ms) < peak * 0.05, `${c.slug}: last ms peaks at ${edge(n - ms)} of ${peak}`);
      // In sync: the unfaded middle matches the master at the clip's own offset, not a sample either side.
      const mid = Math.floor(n / 2);
      const len = 4800;
      const err = (d) => {
        let s = 0;
        for (let i = 0; i < len; i++) s += Math.abs(clip[mid + i] - source[c.startFrame * 1600 + mid + d + i]);
        return s / len;
      };
      const offsets = Array.from({length: 97}, (_, i) => i - 48);
      const best = offsets.reduce((b, d) => (err(d) < err(b) ? d : b), 0);
      assert.equal(best, 0, `${c.slug}: audio is ${best} samples off the master`);
    }
  });

  it('two configs cutting into one folder keep both manifests and both sets of clips', async () => {
    const outDir = freshDir('shared');
    const list = writeList('two.json', {clips: [{slug: 'early', start: 1.5, end: 2.7}]});
    const landscape = await run(['--in', master, '--clips', list, '--out-dir', outDir]);
    assert.equal(landscape.result, 0, landscape.output.join('\n'));
    const vertical = await run([`--pipeline=${VERTICAL}`, '--in', master, '--clips', list, '--out-dir', outDir]);
    assert.equal(vertical.result, 0, vertical.output.join('\n'));
    assert.deepEqual(readdirSync(outDir).sort(), [
      'music-video-clips.manifest.json',
      'music-video-early.mp4',
      'music-video-vertical-clips.manifest.json',
      'music-video-vertical-early.mp4',
    ]);
    const read = (n) => JSON.parse(readFileSync(join(outDir, n), 'utf8'));
    assert.deepEqual([read('music-video-clips.manifest.json').pipeline, read('music-video-clips.manifest.json').clips[0].file.endsWith('music-video-early.mp4')], ['src/pipeline.json', true]);
    assert.deepEqual([read('music-video-vertical-clips.manifest.json').pipeline, read('music-video-vertical-clips.manifest.json').clips[0].file.endsWith('music-video-vertical-early.mp4')], [VERTICAL, true]);
  });

  it('refuses a clip past the master\'s end, another fps, a partial render, a master without audio, and writes nothing', async () => {
    const cases = [
      [master, {clips: [{slug: 'late', start: 3, end: 4.1}]}, /clip "late" ends at frame 123 \(4\.100 s\) but .* has 120 frames/],
      [makeMaster(join(freshDir('m25'), 'm25.mp4'), {fps: 25}), LIST, /is at 25 fps but src\/pipeline\.vertical\.json is at 30/],
      [makeMaster(join(freshDir('silent'), 'silent.mp4'), {audio: false}), LIST, /has no audio stream/],
    ];
    const partial = join(freshDir('partial'), 'partial.mp4');
    writeFileSync(partial, readFileSync(master));
    writeFileSync(partial.replace(/\.mp4$/, '.manifest.json'), JSON.stringify({fps: 30, frames: 120, cuts: [], firstFrame: 30, width: W, height: H}));
    cases.push([partial, LIST, /is a partial render \(its first frame is song frame 30\); cut clips from a full render/]);
    for (const [input, list, why] of cases) {
      const outDir = join(freshDir('refused'), 'clips');
      const {result, output} = await run([`--pipeline=${VERTICAL}`, '--in', input, '--clips', writeList('l.json', list), '--out-dir', outDir]);
      assert.equal(result, 1, output.join('\n'));
      assert.match(output.join('\n'), why);
      assert.equal(existsSync(outDir), false, 'the output folder was not even created');
    }
  });

  it('never writes a config\'s master or the input video', async () => {
    const list = writeList('early.json', {clips: [{slug: 'early', start: 1.5, end: 2.7}]});
    const clash = await run([`--pipeline=${VERTICAL}`, '--in', master, '--clips', list, '--out-dir', join(root, 'out')]);
    assert.equal(clash.result, 1);
    assert.match(clash.output.join('\n'), /out\/music-video-vertical-early\.mp4 is the master video of src\/pipeline\.clash\.json .*a clip must go elsewhere/);
    const dir = freshDir('self');
    const input = join(dir, 'music-video-vertical-early.mp4');
    writeFileSync(input, readFileSync(master));
    const self = await run([`--pipeline=${VERTICAL}`, '--in', input, '--clips', list, '--out-dir', dir]);
    assert.equal(self.result, 1);
    assert.match(self.output.join('\n'), /is the input video; clips must go elsewhere/);
    assert.deepEqual(readdirSync(dir), ['music-video-vertical-early.mp4']);
    assert.equal(existsSync(join(root, 'out/music-video-vertical-early.mp4')), false);
  });

  it('a failed encode leaves no clip, no manifest and no temp folder', async () => {
    const outDir = freshDir('failed');
    const failing = fakeBin('ffmpeg', 'fs.writeFileSync(args[args.length - 1], "partial"); process.exit(1);');
    const {result, output} = await quiet(() =>
      clipsMain([`--pipeline=${VERTICAL}`, '--in', master, '--clips', writeList('ok.json', LIST), '--out-dir', outDir], {root, ffmpegBin: failing}),
    );
    assert.equal(result, 1, output.join('\n'));
    assert.match(output.join('\n'), /ffmpeg \(clip early\) failed/);
    assert.deepEqual(readdirSync(outDir), []);
  });
});
