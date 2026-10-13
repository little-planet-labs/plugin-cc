// Output safety and the render arguments: a draft, preview, text-only or
// alternate-scenes output never resolves to the master out/<outputName>.mp4
// (case-insensitive, relative and absolute), the default outputs are distinct
// from the master, a partial render's default never replaces the full render
// of its kind, and the manifest sidecar has the pinned shape.
import assert from 'node:assert/strict';
import {linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {parseDraftArgs} from '../scripts/draft.mjs';
import {buildManifest, canonicalPath, defaultRenderOutput, manifestPath, samePath} from '../scripts/lib/outputs.mjs';
import {parsePreviewArgs} from '../scripts/preview.mjs';
import {parseRenderArgs, resolveRender} from '../scripts/render.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

let p;
let root;
// out/ is a symlink to a folder elsewhere (an external drive, say), and the master exists there with a hard link
// under yet another name, so every spelling of the master can be tried.
let ext;
let alias;
before(() => {
  p = makeProject({pipeline: {outputName: 'music-video', render: {scale: 1}}});
  root = p.root;
  ext = mkdtempSync(join(tmpdir(), 'mv-ext-out-'));
  symlinkSync(ext, join(root, 'out'));
  writeFileSync(join(ext, 'music-video.mp4'), 'master');
  mkdirSync(join(ext, 'other'));
  alias = join(ext, 'other', 'alias.mp4');
  linkSync(join(ext, 'music-video.mp4'), alias);
});
after(() => {
  p?.cleanup();
  if (ext) rmSync(ext, {recursive: true, force: true});
});

const master = () => join(root, 'out/music-video.mp4');
const render = (argv) => resolveRender(parseRenderArgs(argv), {root});

describe('output safety', () => {
  const masterForms = () => [
    'out/music-video.mp4',
    'OUT/Music-Video.MP4',
    './out/../out/music-video.mp4',
    master(),
    master().toUpperCase().replace(root.toUpperCase(), root),
    join(realpathSync(root), 'out/music-video.mp4'), // the project through its real path (/var -> /private/var)
    join(ext, 'music-video.mp4'), // through the folder out/ links to
    join(realpathSync(ext), 'MUSIC-VIDEO.mp4'),
    alias, // a hard link to the existing master
  ];

  it('the test spellings really differ from the master as strings', () => {
    for (const f of masterForms().slice(5)) assert.notEqual(f, master());
    assert.notEqual(realpathSync(root), root, 'the temp project is reached through a symlink (/var -> /private/var)');
    assert.equal(canonicalPath(join(root, 'out/not-yet/x.mp4')), join(realpathSync(ext), 'not-yet/x.mp4'), 'a path that does not exist yet resolves through its nearest existing ancestor');
  });

  it('pnpm draft refuses an --out that resolves to the master (case-insensitive, relative and absolute)', () => {
    for (const out of masterForms()) assert.throws(() => parseDraftArgs(['--out', out], {root}), /is the master video .*a draft must go elsewhere/, out);
  });
  it('pnpm render --textonly and --scenes refuse an --out that resolves to the master', () => {
    for (const out of masterForms()) {
      assert.throws(() => render(['--textonly', `--out=${out}`]), /a text-only render must go elsewhere/, out);
      assert.throws(() => render(['--scenes=tests/fixtures/scenes/timecode.js', `--out=${out}`]), /an alternate-scenes render must go elsewhere/, out);
    }
  });
  it('an alternate scene registry whose basename is the output name is refused rather than written onto the master', () => {
    assert.throws(() => render(['--scenes=tests/alt/MUSIC-VIDEO.js']), /alternate-scenes render must go elsewhere/);
  });
  it('pnpm preview refuses an --out that resolves to the master, and an --out equal to --in', () => {
    for (const out of masterForms()) assert.throws(() => parsePreviewArgs(['--in', 'out/x.mp4', '--out', out], {root}), /a preview must go elsewhere|must differ/, out);
    assert.throws(() => parsePreviewArgs(['--in=out/a.mp4', '--out=OUT/A.mp4'], {root}), /must differ/);
    assert.throws(() => parsePreviewArgs(['--in=out/a.mp4', `--out=${join(realpathSync(ext), 'a.mp4')}`], {root}), /must differ/, 'through the symlinked out/');
  });

  it('the default outputs are distinct from the master', () => {
    assert.equal(render([]).output, master(), 'a full render without flags writes the master');
    const defaults = {
      draft: parseDraftArgs([], {root}).output,
      textonly: render(['--textonly']).output,
      scenes: render(['--scenes=tests/fixtures/scenes/timecode.js']).output,
      scenesTextonly: render(['--scenes=tests/fixtures/scenes/timecode.js', '--textonly']).output,
      partial: render(['--frames=30-59']).output,
      preview: parsePreviewArgs([], {root}).output,
    };
    assert.deepEqual(defaults, {
      draft: join(root, 'out/draft.mp4'),
      textonly: join(root, 'out/music-video-textonly.mp4'),
      scenes: join(root, 'out/timecode.mp4'),
      scenesTextonly: join(root, 'out/timecode-textonly.mp4'),
      partial: join(root, 'out/music-video-frames-30-59.mp4'),
      preview: join(root, 'out/music-video-preview.mp4'),
    });
    for (const [k, v] of Object.entries(defaults)) assert.equal(samePath(v, master()), false, k);
    assert.equal(parsePreviewArgs([], {root}).input, master(), 'the preview reads the master by default');
  });

  it('a partial render (--frames) puts its range in every default name, so it never replaces the full render of its kind', () => {
    const scenes = '--scenes=tests/fixtures/scenes/timecode.js';
    const kinds = {
      master: [[], (a) => render(a).output],
      textonly: [['--textonly'], (a) => render(a).output],
      scenes: [[scenes], (a) => render(a).output],
      scenesTextonly: [[scenes, '--textonly'], (a) => render(a).output],
      draft: [[], (a) => parseDraftArgs(a, {root}).output],
    };
    const partial = {};
    for (const [kind, [argv, out]] of Object.entries(kinds)) {
      const full = out(argv);
      partial[kind] = out([...argv, '--frames=30-59']);
      assert.equal(samePath(partial[kind], full), false, `${kind}: the partial default replaces the full render`);
      assert.equal(samePath(partial[kind], master()), false, `${kind}: the partial default is the master`);
    }
    assert.deepEqual(partial, {
      master: join(root, 'out/music-video-frames-30-59.mp4'),
      textonly: join(root, 'out/music-video-textonly-frames-30-59.mp4'),
      scenes: join(root, 'out/timecode-frames-30-59.mp4'),
      scenesTextonly: join(root, 'out/timecode-textonly-frames-30-59.mp4'),
      draft: join(root, 'out/draft-frames-30-59.mp4'),
    });
    assert.equal(parseDraftArgs(['--frames=30-59', '--out', 'out/x.mp4'], {root}).output, join(root, 'out/x.mp4'), 'an explicit --out is kept');
  });

  it('an explicit --out on a plain render may name the master (it is the master render)', () => {
    for (const out of masterForms()) assert.equal(samePath(render(['--out', out]).output, master()), true, out);
  });
  it('a partial plain render (--frames) refuses an --out that resolves to the master', () => {
    for (const out of masterForms()) {
      assert.throws(() => render(['--frames=0-9', '--out', out]), /is the master video .*a partial render \(--frames\) must go elsewhere/, out);
    }
    assert.throws(() => render(['--frames=0-119', '--out=out/music-video.mp4']), /a partial render \(--frames\) must go elsewhere/, 'even a range covering every frame');
  });
});

describe('render arguments', () => {
  it('parses every flag in both forms and rejects unknown, repeated and malformed ones', () => {
    const o = parseRenderArgs(['--out', 'out/a.mp4', '--scale=1', '--crf', '20', '--preset=slow', '--pool=1', '--chunk-seconds=5', '--frames=10-20', '--textonly', '--scenes=./tests/x.js']);
    assert.deepEqual(o, {out: 'out/a.mp4', scale: 1, crf: 20, preset: 'slow', pool: 1, chunkSeconds: 5, frames: {a: 10, b: 20}, textonly: true, scenes: 'tests/x.js'});
    assert.deepEqual(parseRenderArgs(['--frames=7']).frames, {a: 7, b: 7});
    assert.throws(() => parseRenderArgs(['--nope']), /unexpected argument "--nope"/);
    assert.throws(() => parseRenderArgs(['--crf=1', '--crf=2']), /--crf given twice/);
    assert.throws(() => parseRenderArgs(['--crf=99']), /--crf must be from 0 to 51/);
    assert.throws(() => parseRenderArgs(['--preset=quick']), /--preset must be one of/);
    assert.throws(() => parseRenderArgs(['--frames=9-3']), /last frame is before the first/);
    assert.throws(() => parseRenderArgs(['--frames=a-b']), /--frames needs a frame range/);
    assert.throws(() => parseRenderArgs(['--scenes=/abs.js']), /project-relative/);
    assert.throws(() => parseRenderArgs(['--textonly=1']), /takes no value/);
    assert.throws(() => parseRenderArgs(['--out']), /--out needs a value/);
    assert.throws(() => parseRenderArgs(['--scale=1'], 'draft'), /unexpected argument "--scale=1"\. Usage: pnpm draft/);
    assert.throws(() => parseRenderArgs(['--textonly'], 'draft'), /unexpected argument/);
  });
  it('resolveRender: pipeline settings unless a flag overrides them; --scale must keep the frame even; --frames inside the video', () => {
    const s = render([]);
    assert.deepEqual([s.scale, s.width, s.height, s.crf, s.preset, s.format, s.pool, s.chunkSeconds, s.retries, s.audioBitrate, s.blur, s.first, s.last],
      [1, 960, 540, 17, 'medium', 'png', 2, 20, 2, '256k', true, 0, 120]);
    const o = render(['--scale=2', '--crf=21', '--preset=fast', '--frames=30-59']);
    assert.deepEqual([o.width, o.height, o.crf, o.preset, o.first, o.last], [1920, 1080, 21, 'fast', 30, 60]);
    assert.throws(() => render(['--scale=0.33']), /--scale 0.33 gives 316.8x178.2; both must be even whole numbers/);
    assert.throws(() => render(['--frames=100-120']), /runs past the end of the video \(frames 0\.\.119\)/);
    assert.throws(() => render(['--out=out/a.mov']), /--out must end in \.mp4/);
    const d = parseDraftArgs([], {root});
    assert.deepEqual([d.scale, d.width, d.height, d.crf, d.preset, d.format, d.blur], [0.5, 480, 270, 23, 'veryfast', 'jpeg', false]);
  });
});

describe('manifest', () => {
  it('has the pinned shape: integer frames for cuts and blur windows, in video frames; firstFrame for a partial range', () => {
    assert.equal(manifestPath('/x/out/music-video.mp4'), '/x/out/music-video.manifest.json');
    const full = buildManifest({fps: 30, first: 0, last: 120, width: 3840, height: 2160, scale: 2, textonly: false,
      cuts: [1.5, 2.5], blurWindows: [{a: 2, b: 2.5, samples: 4}], blur: true, source: 'src/scenes/index.js'});
    assert.deepEqual(full, {fps: 30, frames: 120, width: 3840, height: 2160, scale: 2, textonly: false, cuts: [45, 75],
      blurWindows: [{from: 60, to: 75, samples: 4}], source: 'src/scenes/index.js', firstFrame: 0});
    const part = buildManifest({fps: 30, first: 50, last: 80, width: 960, height: 540, scale: 1, textonly: true,
      cuts: [1.5, 2.5, 3], blurWindows: [{a: 2, b: 3, samples: 4}, {a: 0, b: 1, samples: 2}], blur: true, source: 'tests/x.js'});
    assert.deepEqual(part.cuts, [25], 'only cuts strictly inside the range, as video frames');
    assert.deepEqual(part.blurWindows, [{from: 10, to: 30, samples: 4}], 'clipped to the range');
    assert.equal(part.firstFrame, 50);
    assert.deepEqual(buildManifest({fps: 30, first: 0, last: 120, width: 1, height: 1, scale: 1, textonly: false, cuts: [], blurWindows: [{a: 2, b: 3, samples: 4}], blur: false, source: 's'}).blurWindows, [], 'a draft renders no blur');
  });
  it('defaultRenderOutput names', () => {
    assert.equal(defaultRenderOutput({outputName: 'v'}), 'out/v.mp4');
    assert.equal(defaultRenderOutput({outputName: 'v', range: {first: 0, last: 150}}), 'out/v-frames-0-149.mp4');
    assert.equal(defaultRenderOutput({outputName: 'v', textonly: true, range: {first: 0, last: 150}}), 'out/v-textonly-frames-0-149.mp4');
    assert.equal(defaultRenderOutput({outputName: 'v', scenes: 'alt/cut-b.js', range: {first: 5, last: 6}}), 'out/cut-b-frames-5-5.mp4');
    assert.equal(defaultRenderOutput({outputName: 'v', draft: true}), 'out/draft.mp4');
    assert.equal(defaultRenderOutput({outputName: 'v', draft: true, range: {first: 0, last: 150}}), 'out/draft-frames-0-149.mp4');
  });
});
