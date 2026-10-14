// Selectable pipeline configs (--pipeline=<path> in the scripts, ?pipeline= in
// the page): the path rule (a .json file under src/, inside the project, no
// "..", no dot segment, must exist), the alternate-config checks (same fps as
// src/pipeline.json, its own outputName), default output names per config, the
// masters of the two configs protecting each other, the flag on every script,
// and the render scripts handing the page the same config (the page's own
// ?pipeline= handling is tests/render/engine-pipeline.test.mjs). src/pipeline.json
// stays the default everywhere: the landscape defaults are pinned in
// tests/render-outputs.test.mjs and are unchanged.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, before, describe, it} from 'node:test';
import {parseBeatmapArgs, beatmapPath} from '../scripts/beatmap.mjs';
import {check} from '../scripts/check.mjs';
import {parseClipsArgs} from '../scripts/clips.mjs';
import {parseContactSheetArgs} from '../scripts/contact-sheet.mjs';
import {parseCritiqueArgs} from '../scripts/critique.mjs';
import {main as draftMain, parseDraftArgs} from '../scripts/draft.mjs';
import {parseJitterArgs} from '../scripts/jitter.mjs';
import {PROJECT_ROOT, venvPython} from '../scripts/lib/env.mjs';
import {buildManifest, defaultRenderOutput} from '../scripts/lib/outputs.mjs';
import {knownMasters, loadProject, readPipelineAt} from '../scripts/lib/project.mjs';
import {defaultMaster, defaultTextonly} from '../scripts/lib/qa.mjs';
import {parsePopsArgs} from '../scripts/pops.mjs';
import {parsePreviewArgs} from '../scripts/preview.mjs';
import {main as renderMain, parseRenderArgs, resolveRender} from '../scripts/render.mjs';
import {parseStillTestArgs} from '../scripts/still-test.mjs';
import {parseStillArgs, still} from '../scripts/still.mjs';
import {
  checkAlternatePipeline,
  DEFAULT_PIPELINE_PATH,
  DEFAULT_SCENES_PATH,
  isConfigScenes,
  parsePipeline,
  scenesInEffect,
  validatePipelinePath,
} from '../src/lib/pipeline.js';
import {freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {FIXTURE_PIPELINE, makeProject} from './fixtures/engine-project.mjs';
import {fakeFfmpeg, fakeFfprobe, fakePython, readFake, readLog} from './fixtures/render-fakes.mjs';

const VERTICAL = 'src/pipeline.vertical.json';
/** The fixture's alternate config: portrait, its own outputName and registry, a 1 s tail (so its frame count differs). */
const verticalFixture = (over = {}) => ({
  ...FIXTURE_PIPELINE,
  outputName: 'music-video-vertical',
  width: 540,
  height: 960,
  tailSeconds: 1,
  scenes: 'src/scenes-v/index.js',
  render: {scale: 1, chunkSeconds: 1},
  ...over,
});

let p;
let root;
before(() => {
  p = makeProject({
    pipeline: {outputName: 'music-video', render: {scale: 1, chunkSeconds: 1}},
    files: {
      [VERTICAL]: JSON.stringify(verticalFixture()),
      'src/pipeline.same-name.json': JSON.stringify({...FIXTURE_PIPELINE, outputName: 'MUSIC-VIDEO'}),
      'src/pipeline.other-fps.json': JSON.stringify({...FIXTURE_PIPELINE, outputName: 'other-fps', fps: 25}),
      'src/pipeline.broken.json': '{"outputName": "broken", "fps": "x"}',
      'src/pipeline.missing-scenes.json': JSON.stringify(verticalFixture({outputName: 'missing-scenes', scenes: 'src/scenes-gone/index.js'})),
      'src/data/not-a-config.json': '[]',
      // The vertical config's own clip list (pnpm clips defaults to it).
      'src/clips.vertical.json': JSON.stringify({clips: [{slug: 'one', start: 0, end: 1}]}),
      'src/pipeline.not-a-config.json': '[]',
      // The vertical fixture's own registry: every section key plays a scene that draws nothing.
      'src/scenes-v/index.js': 'export const SCENES = {};\nexport const DEFAULT_SCENE = {draw() {}};\n',
    },
  });
  root = p.root;
});
after(() => p?.cleanup());

const BAD_PATHS = [
  '../src/pipeline.vertical.json',
  'src/../pipeline.json',
  'src/../../etc/passwd.json',
  '/etc/pipeline.json',
  `${PROJECT_ROOT}/src/pipeline.json`,
  'pipeline.json',
  'public/pipeline.json',
  'tests/pipeline.json',
  'src/pipeline.js',
  'src/pipeline.json.bak',
  'src/pipeline',
  'src/.hidden.json',
  'src/.cache/pipeline.json',
  'src//pipeline.json',
  'src\\pipeline.json',
  'http://example.com/src/pipeline.json',
  'file:src/pipeline.json',
  'src/pipeline\0.json',
  '',
  'src/',
  // Percent-encoding, query and fragment characters: the page's fetch would decode or cut them.
  'src/%2e%2e/x.json',
  'src/%2e%2e/package.json',
  'src/pipeline.%2e%2e.json',
  'src/a?b.json',
  'src/a#b.json',
  'src/pipeline.x?.json',
  'src/pipeline.x#.json',
  // Only src/pipeline.json and src/pipeline.<name>.json, <name> = [a-z0-9][a-z0-9-]*.
  'src/foo.json',
  'src/sub/pipeline.x.json',
  'src/configs/social.json',
  'src/data/lyrics.json',
  'src/pipeline.Vertical.json',
  'src/pipeline.-x.json',
  'src/pipeline.a_b.json',
  'src/pipeline.a.b.json',
  'src/pipeline..json',
  'src/pipeline.json/',
  './src/../src/pipeline.json',
];

describe('the pipeline path rule (page and scripts)', () => {
  it('accepts a .json under src/ and normalizes a leading ./', () => {
    assert.equal(validatePipelinePath('src/pipeline.vertical.json'), 'src/pipeline.vertical.json');
    assert.equal(validatePipelinePath('./src/pipeline.vertical.json'), 'src/pipeline.vertical.json');
    assert.equal(validatePipelinePath('src/pipeline.json'), DEFAULT_PIPELINE_PATH);
    assert.equal(validatePipelinePath('src/pipeline.social-9x16.json'), 'src/pipeline.social-9x16.json');
  });
  it('rejects "..", absolute paths, anything outside src/, non-.json, dot segments, schemes, backslashes and NUL', () => {
    for (const bad of BAD_PATHS) assert.throws(() => validatePipelinePath(bad), /pipeline must be src\/pipeline\.json or src\/pipeline\.<name>\.json/, JSON.stringify(bad));
    assert.throws(() => validatePipelinePath(undefined), /pipeline must be/);
  });
  it('scripts/capture.py applies the same rule (pipeline_path), so the page size is never read from outside src/', (t) => {
    if (!existsSync(venvPython(PROJECT_ROOT))) return t.skip('no .venv: run pnpm setup:env');
    const cases = ['src/pipeline.vertical.json', './src/pipeline.vertical.json', 'src/pipeline.json', 'src/pipeline.social-9x16.json', ...BAD_PATHS.filter((b) => !b.includes('\0'))];
    const code = `import json, sys
sys.path.insert(0, ${JSON.stringify(join(PROJECT_ROOT, 'scripts'))})
from capture import CaptureError, pipeline_path
out = []
for c in json.loads(sys.argv[1]):
    try:
        out.append(pipeline_path(c))
    except CaptureError:
        out.append(None)
print(json.dumps(out))`;
    const res = spawnSync(venvPython(PROJECT_ROOT), ['-c', code, JSON.stringify(cases)], {encoding: 'utf8'});
    assert.equal(res.status, 0, res.stderr);
    const js = cases.map((c) => {
      try {
        return validatePipelinePath(c);
      } catch {
        return null;
      }
    });
    assert.deepEqual(JSON.parse(res.stdout), js);
  });
  it('a missing file, a file reached through a symlink out of the project, and a non-config are refused by the scripts', () => {
    assert.throws(() => readPipelineAt(root, 'src/pipeline.nope.json'), /--pipeline file src\/pipeline\.nope\.json does not exist/);
    const outside = join(freshDir('outside'), 'cfg.json');
    writeFileSync(outside, JSON.stringify(verticalFixture({outputName: 'escaped'})));
    symlinkSync(outside, join(root, 'src/pipeline.escape.json'));
    assert.throws(() => readPipelineAt(root, 'src/pipeline.escape.json'), /--pipeline file src\/pipeline\.escape\.json does not exist/);
    assert.throws(() => readPipelineAt(root, 'src/pipeline.not-a-config.json'), /^Error: src\/pipeline\.not-a-config\.json: root must be an object/);
    assert.throws(() => readPipelineAt(root, 'src/data/not-a-config.json'), /--pipeline must be src\/pipeline\.json or src\/pipeline\.<name>\.json/);
    assert.throws(() => readPipelineAt(root, '../x.json'), /--pipeline must be src\/pipeline\.json or/);
  });
  it('an alternate config must keep src/pipeline.json\'s fps and use its own outputName (case-insensitive); errors name its path', () => {
    assert.throws(() => readPipelineAt(root, 'src/pipeline.other-fps.json'), /src\/pipeline\.other-fps\.json: fps must be 30, the fps of src\/pipeline\.json \(got 25\)/);
    assert.throws(() => readPipelineAt(root, 'src/pipeline.same-name.json'), /outputName must differ from src\/pipeline\.json's \("music-video"\), so its master never overwrites out\/music-video\.mp4/);
    assert.throws(() => readPipelineAt(root, 'src/pipeline.broken.json'), /^Error: src\/pipeline\.broken\.json: fps must be a positive integer/);
    const base = parsePipeline(FIXTURE_PIPELINE);
    assert.doesNotThrow(() => checkAlternatePipeline(parsePipeline(verticalFixture()), base, VERTICAL));
  });
});

// The template ships src/pipeline.vertical.json; a project tunes it (or deletes it), so only what must hold for
// any vertical config is pinned here, on the template and on a finished project alike.
const COMMITTED_VERTICAL = join(PROJECT_ROOT, VERTICAL);
describe('the committed vertical config', {skip: existsSync(COMMITTED_VERTICAL) ? false : `no ${VERTICAL} in this project`}, () => {
  it('parses, is portrait, names its own registry, and drafts at even page sizes', () => {
    const v = parsePipeline(JSON.parse(readFileSync(COMMITTED_VERTICAL, 'utf8')));
    assert.ok(v.height > v.width, `${v.width}x${v.height} is portrait`);
    assert.equal(typeof v.scenes, 'string', 'it names its own scene registry');
    assert.ok([v.width * v.draft.scale, v.height * v.draft.scale, v.width * v.render.scale, v.height * v.render.scale].every((x) => Number.isInteger(x) && x % 2 === 0));
  });
  it('passes the alternate-config checks against the committed src/pipeline.json; its frames are the song plus its tail, over the same song data', () => {
    const {pipeline, project} = loadProject(PROJECT_ROOT, VERTICAL);
    const landscape = loadProject(PROJECT_ROOT);
    assert.notEqual(pipeline.outputName.toLowerCase(), landscape.pipeline.outputName.toLowerCase());
    assert.equal(pipeline.fps, landscape.pipeline.fps);
    assert.equal(project.audioFrames, project.analysis.durationInFrames);
    const withTail = Math.ceil((project.analysis.durationSeconds + pipeline.tailSeconds) * pipeline.fps - 1e-9);
    assert.equal(project.frames, pipeline.tailSeconds > 0 ? withTail : project.audioFrames);
    // Same song data: the sections and lyrics are the landscape config's frame for frame.
    assert.deepEqual(project.lyrics, landscape.project.lyrics);
    assert.deepEqual(project.sections.slice(0, -1), landscape.project.sections.slice(0, -1));
    assert.equal(project.audioFrames, landscape.project.audioFrames);
  });
});

describe('scenes in effect', () => {
  it('a config without `scenes` keeps every --scenes an alternate registry; one with `scenes` makes that registry the master\'s', () => {
    const plain = parsePipeline(FIXTURE_PIPELINE);
    const vertical = parsePipeline(verticalFixture());
    assert.equal('scenes' in plain, false, 'absent stays absent: the committed src/pipeline.json parses to exactly its own values');
    assert.equal(scenesInEffect(plain, null), DEFAULT_SCENES_PATH);
    assert.equal(scenesInEffect(plain, 'x/y.js'), 'x/y.js');
    assert.equal(scenesInEffect(vertical, null), 'src/scenes-v/index.js');
    assert.equal(isConfigScenes(plain, null), true);
    assert.equal(isConfigScenes(plain, DEFAULT_SCENES_PATH), false, 'src/pipeline.json: --scenes=src/scenes/index.js stays an alternate render, as before');
    assert.equal(isConfigScenes(vertical, 'src/scenes-v/index.js'), true);
    assert.equal(isConfigScenes(vertical, DEFAULT_SCENES_PATH), false);
    assert.throws(() => parsePipeline({...FIXTURE_PIPELINE, scenes: '../x.js'}), /pipeline\.json: scenes must be a project-relative module path/);
    assert.throws(() => parsePipeline({...FIXTURE_PIPELINE, scenes: 'src/scenes/index.json'}), /scenes must be/);
  });
});

describe('default outputs per config', () => {
  const render = (argv) => resolveRender(parseRenderArgs(argv), {root});
  it('every default name of an alternate config starts with its outputName and never meets a landscape one', () => {
    const v = ['--pipeline=src/pipeline.vertical.json'];
    const outs = {
      master: render(v).output,
      masterWithItsScenes: render([...v, '--scenes=src/scenes-v/index.js']).output,
      textonly: render([...v, '--textonly']).output,
      alternateScenes: render([...v, '--scenes=tests/fixtures/scenes/timecode.js']).output,
      partial: render([...v, '--frames=30-59']).output,
      draft: parseDraftArgs(v, {root}).output,
      draftPartial: parseDraftArgs([...v, '--frames=30-59'], {root}).output,
      preview: parsePreviewArgs(v, {root}).output,
    };
    assert.deepEqual(outs, {
      master: join(root, 'out/music-video-vertical.mp4'),
      masterWithItsScenes: join(root, 'out/music-video-vertical.mp4'),
      textonly: join(root, 'out/music-video-vertical-textonly.mp4'),
      alternateScenes: join(root, 'out/music-video-vertical-timecode.mp4'),
      partial: join(root, 'out/music-video-vertical-frames-30-59.mp4'),
      draft: join(root, 'out/music-video-vertical-draft.mp4'),
      draftPartial: join(root, 'out/music-video-vertical-draft-frames-30-59.mp4'),
      preview: join(root, 'out/music-video-vertical-preview.mp4'),
    });
    assert.equal(parsePreviewArgs(v, {root}).input, join(root, 'out/music-video-vertical.mp4'), 'the preview reads the vertical master');
    assert.equal(render(['--pipeline', 'src/pipeline.json']).output, join(root, 'out/music-video.mp4'), 'naming src/pipeline.json is the default');
  });
  it('the landscape names are what they were (no prefix without an alternate config)', () => {
    assert.equal(defaultRenderOutput({outputName: 'music-video'}), 'out/music-video.mp4');
    assert.equal(defaultRenderOutput({outputName: 'music-video', draft: true}), 'out/draft.mp4');
    assert.equal(defaultRenderOutput({outputName: 'music-video', scenes: 'src/posters.js'}), 'out/posters.mp4');
    assert.equal(defaultRenderOutput({outputName: 'music-video', textonly: true, range: {first: 0, last: 10}}), 'out/music-video-textonly-frames-0-9.mp4');
  });
  it('the render settings follow the config: page size x its render.scale, its tail in the frame count, its scenes', () => {
    const s = render(['--pipeline=src/pipeline.vertical.json']);
    assert.deepEqual([s.width, s.height, s.scale, s.fps, s.last, s.pipelinePath, s.scenes, s.scenesPath], [540, 960, 1, 30, 150, VERTICAL, null, 'src/scenes-v/index.js']);
    const l = render([]);
    assert.deepEqual([l.width, l.height, l.last, l.pipelinePath, l.scenesPath], [960, 540, 120, DEFAULT_PIPELINE_PATH, DEFAULT_SCENES_PATH]);
  });
  it('the QA scripts, contact sheet, beatmap and clips default to the selected config\'s files', () => {
    const v = '--pipeline=src/pipeline.vertical.json';
    assert.equal(defaultMaster(root, VERTICAL), join(root, 'out/music-video-vertical.mp4'));
    assert.equal(defaultTextonly(root, VERTICAL), join(root, 'out/music-video-vertical-textonly.mp4'));
    assert.equal(parseCritiqueArgs(['--tag=r1', v], {root}).input, join(root, 'out/music-video-vertical.mp4'));
    assert.equal(parseCritiqueArgs(['--tag=r1', v], {root}).pipeline, VERTICAL);
    assert.equal(parsePopsArgs([v], {root}).input, join(root, 'out/music-video-vertical.mp4'));
    assert.equal(parseJitterArgs(['--from=0', '--frames=2', v], {root}).input, join(root, 'out/music-video-vertical.mp4'));
    assert.deepEqual(
      [parseJitterArgs(['--all-lines', v], {root}).input, parseJitterArgs(['--all-lines', v], {root}).pipeline],
      [join(root, 'out/music-video-vertical-textonly.mp4'), VERTICAL],
    );
    assert.deepEqual(parseContactSheetArgs([v], {root}), {input: null, output: join(root, 'out/music-video-vertical-contact-sheet.png'), columns: 4, pipeline: VERTICAL});
    assert.deepEqual(parseContactSheetArgs([], {root}), {input: null, output: join(root, 'out/contact-sheet.png'), columns: 4}, 'landscape: unchanged');
    assert.equal(beatmapPath(VERTICAL, 'music-video-vertical'), 'creative/beatmap-music-video-vertical.md');
    assert.equal(beatmapPath(DEFAULT_PIPELINE_PATH, 'music-video'), 'creative/beatmap.md');
    assert.equal(parseClipsArgs([v], {root}).input, join(root, 'out/music-video-vertical.mp4'));
    assert.equal(parseClipsArgs(['--clips=c.json'], {root}).input, join(root, 'out/music-video.mp4'));
  });
  it('a render with an alternate config records it in the manifest; a landscape manifest has no pipeline key (unchanged shape)', () => {
    const base = {fps: 30, first: 0, last: 10, width: 4, height: 4, scale: 1, textonly: false, cuts: [], blurWindows: [], blur: true, source: 'src/scenes/index.js'};
    assert.equal('pipeline' in buildManifest(base), false);
    assert.equal(buildManifest({...base, pipeline: VERTICAL}).pipeline, VERTICAL);
  });
});

describe('the two masters protect each other', () => {
  const render = (argv) => resolveRender(parseRenderArgs(argv), {root});
  it('knownMasters lists src/pipeline.json, every src/pipeline.<name>.json that names an outputName, and the selected config', () => {
    const masters = knownMasters(root, {path: VERTICAL, outputName: 'music-video-vertical'});
    const byPath = Object.fromEntries(masters.map((m) => [m.path, m.outputName]));
    assert.equal(byPath['src/pipeline.json'], 'music-video');
    assert.equal(byPath[VERTICAL], 'music-video-vertical');
    assert.equal(byPath['src/pipeline.broken.json'], 'broken', 'an invalid sibling still protects the master it names');
    assert.equal(byPath['src/data/not-a-config.json'], undefined);
    assert.equal(byPath['src/pipeline.same-name.json'], undefined, 'a sibling repeating out/music-video.mp4 names no other master');
    const fromLandscape = knownMasters(root, {path: DEFAULT_PIPELINE_PATH, outputName: 'music-video'});
    assert.deepEqual(fromLandscape[0], {path: DEFAULT_PIPELINE_PATH, outputName: 'music-video'}, 'the selected config comes first');
    assert.equal(fromLandscape.filter((m) => m.outputName.toLowerCase() === 'music-video').length, 1);
  });
  it('a vertical render, draft, text-only render or preview never writes out/music-video.mp4', () => {
    const v = '--pipeline=src/pipeline.vertical.json';
    for (const out of ['out/music-video.mp4', 'OUT/Music-Video.MP4', join(root, 'out/music-video.mp4')]) {
      assert.throws(() => render([v, '--out', out]), /is the master video of src\/pipeline\.json \(out\/music-video\.mp4\); a render with src\/pipeline\.vertical\.json must go elsewhere/, out);
      assert.throws(() => parseDraftArgs([v, '--out', out], {root}), /master video of src\/pipeline\.json .*a draft must go elsewhere/, out);
      assert.throws(() => render([v, '--textonly', '--out', out]), /master video of src\/pipeline\.json/, out);
      assert.throws(() => parsePreviewArgs([v, '--out', out], {root}), /master video of src\/pipeline\.json .*a preview must go elsewhere/, out);
    }
  });
  it('a landscape render, draft or preview never writes out/music-video-vertical.mp4; each master render may write its own', () => {
    for (const out of ['out/music-video-vertical.mp4', 'out/MUSIC-VIDEO-VERTICAL.mp4']) {
      assert.throws(() => render(['--out', out]), /is the master video of src\/pipeline\.vertical\.json/, out);
      assert.throws(() => parseDraftArgs(['--out', out], {root}), /master video of src\/pipeline\.vertical\.json/, out);
      assert.throws(() => parsePreviewArgs(['--in=out/a.mp4', '--out', out], {root}), /master video of src\/pipeline\.vertical\.json/, out);
    }
    assert.equal(render(['--out', 'out/music-video.mp4']).output, join(root, 'out/music-video.mp4'));
    assert.equal(render(['--pipeline=src/pipeline.vertical.json', '--out', 'out/music-video-vertical.mp4']).output, join(root, 'out/music-video-vertical.mp4'));
  });
  it('the vertical config\'s own refusals still hold: a draft, an alternate-scenes or a partial render never writes its master', () => {
    const v = '--pipeline=src/pipeline.vertical.json';
    const master = 'out/music-video-vertical.mp4';
    assert.throws(() => parseDraftArgs([v, '--out', master], {root}), /a draft must go elsewhere/);
    assert.throws(() => render([v, '--scenes=tests/fixtures/scenes/timecode.js', '--out', master]), /an alternate-scenes render must go elsewhere/);
    assert.throws(() => render([v, '--frames=0-9', '--out', master]), /a partial render \(--frames\) must go elsewhere/);
    assert.throws(() => render([v, '--textonly', '--out', master]), /a text-only render must go elsewhere/);
  });
});

describe('--pipeline on every script', () => {
  it('each parser takes --pipeline in its flag style and refuses a bad path', () => {
    const good = 'src/pipeline.vertical.json';
    assert.equal(parseStillArgs([`--pipeline=${good}`]).pipeline, good);
    assert.equal(parseStillArgs(['--pipeline', good]).pipeline, good);
    assert.equal(parseRenderArgs([`--pipeline=${good}`]).pipeline, good);
    assert.equal(parseRenderArgs(['--pipeline', good], 'draft').pipeline, good);
    assert.equal(parseStillTestArgs([`--pipeline=${good}`]).pipeline, good);
    assert.deepEqual(parseBeatmapArgs([`--pipeline=${good}`, '--force']), {force: true, pipeline: good});
    assert.deepEqual(parseBeatmapArgs([]), {force: false}, 'landscape: unchanged');
    for (const bad of ['../x.json', 'public/x.json', 'src/x.js', 'src/%2e%2e/package.json', 'src/foo.json']) {
      const why = /--pipeline must be src\/pipeline\.json or src\/pipeline\.<name>\.json/;
      assert.throws(() => parseStillArgs([`--pipeline=${bad}`]), why, bad);
      assert.throws(() => parseRenderArgs([`--pipeline=${bad}`]), why, bad);
      assert.throws(() => parseRenderArgs([`--pipeline=${bad}`], 'draft'), why, bad);
      assert.throws(() => parseStillTestArgs([`--pipeline=${bad}`]), why, bad);
      assert.throws(() => parseBeatmapArgs([`--pipeline=${bad}`]), why, bad);
      assert.throws(() => parseCritiqueArgs(['--tag=r1', `--pipeline=${bad}`], {root}), why, bad);
      assert.throws(() => parsePopsArgs([`--pipeline=${bad}`], {root}), why, bad);
      assert.throws(() => parseJitterArgs(['--all-lines', `--pipeline=${bad}`], {root}), why, bad);
      assert.throws(() => parsePreviewArgs([`--pipeline=${bad}`], {root}), why, bad);
      assert.throws(() => parseContactSheetArgs([`--pipeline=${bad}`], {root}), why, bad);
      assert.throws(() => parseClipsArgs([`--pipeline=${bad}`], {root}), why, bad);
    }
    assert.throws(() => parseRenderArgs(['--pipeline=src/pipeline.a.json', '--pipeline=src/pipeline.b.json']), /--pipeline given twice/);
    assert.throws(() => parsePreviewArgs(['--pipeline=src/pipeline.a.json', '--pipeline=src/pipeline.b.json'], {root}), /--pipeline given twice/);
  });
  it('a missing config is refused even when --in makes it unnecessary, so a typo is never ignored', () => {
    for (const parse of [
      () => parsePopsArgs(['--in=a.mp4', '--pipeline=src/pipeline.typo.json'], {root}),
      () => parseCritiqueArgs(['--tag=r1', '--in=a.mp4', '--pipeline=src/pipeline.typo.json'], {root}),
      () => parseJitterArgs(['--all-lines', '--in=a.mp4', '--pipeline=src/pipeline.typo.json'], {root}),
      () => parseClipsArgs(['--in=a.mp4', '--pipeline=src/pipeline.typo.json'], {root}),
      () => parsePreviewArgs(['--in=out/a.mp4', '--pipeline=src/pipeline.typo.json'], {root}),
      () => resolveRender(parseRenderArgs(['--pipeline=src/pipeline.typo.json']), {root}),
    ]) {
      assert.throws(parse, /--pipeline file src\/pipeline\.typo\.json does not exist/);
    }
  });
  it('pnpm check takes --pipeline: the config parses, its own registry is checked, and a missing registry is reported', async () => {
    const plain = await check({root, scenes: 'src/scenes-v/index.js'});
    assert.deepEqual(plain.issues.filter((i) => i.startsWith('data:') || i.startsWith('scenes:')), []);
    const vertical = await check({root, pipeline: VERTICAL});
    assert.deepEqual(vertical.issues.filter((i) => i.startsWith('data:') || i.startsWith('scenes:')), [], 'its scenes (src/scenes-v/index.js) load and resolve');
    const missing = await check({root, pipeline: 'src/pipeline.missing-scenes.json'});
    assert.ok(missing.issues.some((i) => /^scenes: scene registry src\/scenes-gone\/index\.js \(the scenes of src\/pipeline\.missing-scenes\.json\) does not exist; write it, or pass --scenes=<module>/.test(i)), missing.issues.join('\n'));
    const gone = await check({root, pipeline: VERTICAL, scenes: 'src/scenes-nope/index.js'});
    assert.ok(gone.issues.includes('scenes: --scenes module src/scenes-nope/index.js does not exist'), gone.issues.join('\n'));
    const typo = await check({root, pipeline: 'src/pipeline.typo.json'});
    assert.ok(typo.issues.some((i) => /^data: --pipeline file src\/pipeline\.typo\.json does not exist/.test(i)), typo.issues.join('\n'));
  });
  it('a still or render whose config names a registry that does not exist stops before any browser, naming it', async () => {
    await assert.rejects(still(parseStillArgs(['--pipeline=src/pipeline.missing-scenes.json']), {root}), /scene registry src\/scenes-gone\/index\.js \(the scenes of src\/pipeline\.missing-scenes\.json\) does not exist/);
    const log = join(freshDir('missing-scenes'), 'events.log');
    const {result, output} = await quiet(() =>
      renderMain(['--pipeline=src/pipeline.missing-scenes.json'], {root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: 150}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
    );
    assert.equal(result, 1);
    assert.match(output.join('\n'), /scene registry src\/scenes-gone\/index\.js .* does not exist/);
    assert.deepEqual(readLog(log), [], 'no page was opened');
  });
});

describe('the page and the render agree on the config', () => {
  const go = async (main, argv, pageFrames) => {
    const log = join(freshDir('agree'), 'events.log');
    const r = await quiet(() =>
      main(argv, {root, envRoot: PROJECT_ROOT, pythonBin: fakePython({log, frames: pageFrames, sleepMs: 5}), ffmpegBin: fakeFfmpeg({log}), ffprobeBin: fakeFfprobe(), staggerMs: 0}),
    );
    return {...r, events: readLog(log)};
  };
  it('a vertical render passes --pipeline to the page-info call and to every chunk worker, and writes the vertical master at its size', async () => {
    const {result, output, events} = await go(renderMain, ['--pipeline=src/pipeline.vertical.json'], 150);
    assert.equal(result, 0, output.join('\n'));
    const info = events.find((e) => e.event === 'info');
    const starts = events.filter((e) => e.event === 'start');
    const pipelineArg = (flags) => flags[flags.indexOf('--pipeline') + 1];
    assert.equal(pipelineArg(info.flags), VERTICAL);
    assert.equal(info.flags.includes('--scenes'), false, 'no --scenes: the page loads the config\'s own registry');
    assert.ok(starts.length > 0);
    for (const s of starts) assert.equal(pipelineArg(s.flags), VERTICAL);
    assert.deepEqual(starts.map((s) => s.from).sort((a, b) => a - b), [0, 30, 60, 90, 120], '150 frames in 1 s chunks');
    const out = join(root, 'out/music-video-vertical.mp4');
    assert.deepEqual([readFake(out).frames, readFake(out).size], ['150', '540x960']);
    const manifest = JSON.parse(readFileSync(join(root, 'out/music-video-vertical.manifest.json'), 'utf8'));
    assert.deepEqual([manifest.pipeline, manifest.source, manifest.width, manifest.height, manifest.frames], [VERTICAL, 'src/scenes-v/index.js', 540, 960, 150]);
    assert.equal(existsSync(join(root, 'out/music-video.mp4')), false, 'the landscape master was not touched');
  });
  it('the frame-count cross-check uses the same config on both sides: a page on another config is refused', async () => {
    const {result, output, events} = await go(renderMain, ['--pipeline=src/pipeline.vertical.json'], 120);
    assert.equal(result, 1);
    assert.match(output.join('\n'), /the page has 120 frames but the project data gives 150; check src\/data and src\/pipeline\.vertical\.json/);
    assert.equal(events.filter((e) => e.event === 'start').length, 0, 'no worker started');
  });
  it('a landscape render passes no --pipeline (the page defaults to src/pipeline.json), exactly as before', async () => {
    const {result, output, events} = await go(draftMain, [], 120);
    assert.equal(result, 0, output.join('\n'));
    for (const e of events.filter((x) => x.event === 'info' || x.event === 'start')) assert.equal(e.flags.includes('--pipeline'), false);
    assert.equal(readFake(join(root, 'out/draft.mp4')).frames, '120');
  });
});
