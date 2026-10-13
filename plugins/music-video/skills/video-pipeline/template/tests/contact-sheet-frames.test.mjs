// `pnpm contact-sheet` (ported from the 0.x template onto the placed
// sections): one still per section half a second in, one more at the middle
// of long sections, only inside the video's frames (a partial render's
// manifest says which), the legend printed, and nothing left but the sheet.
import assert from 'node:assert/strict';
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {contactSheetFrames, main as contactSheetMain, parseContactSheetArgs} from '../scripts/contact-sheet.mjs';
import {fakeBin, freshDir, quiet} from './fixtures/cli-fakes.mjs';
import {makeProject} from './fixtures/engine-project.mjs';

const projects = [];
after(() => projects.forEach((p) => p.cleanup()));

describe('contact sheet', () => {
  const sections = [
    {id: 'intro', from: 0, to: 120},
    {id: 'verse-1', from: 120, to: 900},
    {id: 'chorus-1', from: 900, to: 1797},
    {id: 'tiny', from: 1797, to: 1800},
  ];
  it('contactSheetFrames: each section start + 0.5 s (or its middle when shorter), plus the middle of long sections', () => {
    assert.deepEqual(contactSheetFrames(sections, {fps: 30, frames: 1800}), [
      {label: 'intro', frame: 15},
      {label: 'verse-1', frame: 135},
      {label: 'verse-1 (middle)', frame: 510},
      {label: 'chorus-1', frame: 915},
      {label: 'chorus-1 (middle)', frame: 1348},
      {label: 'tiny', frame: 1798},
    ]);
  });
  it('contactSheetFrames: a partial video covers only its own frames, sections clipped to it', () => {
    assert.deepEqual(contactSheetFrames(sections, {fps: 30, first: 100, frames: 150}), [
      {label: 'intro', frame: 110},
      {label: 'verse-1', frame: 135},
    ]);
    assert.deepEqual(contactSheetFrames(sections, {fps: 30, first: 2000, frames: 10}), []);
  });
  it('parseContactSheetArgs: defaults, --columns, bad values', () => {
    assert.deepEqual(parseContactSheetArgs([], {root: '/r'}), {input: null, output: '/r/out/contact-sheet.png', columns: 4});
    assert.equal(parseContactSheetArgs(['--in=a.mp4', '--columns=3', '--out', 'x.png'], {root: '/r'}).columns, 3);
    assert.throws(() => parseContactSheetArgs(['--columns=0'], {root: '/r'}), /positive integer/);
    assert.throws(() => parseContactSheetArgs(['--out=x.jpg'], {root: '/r'}), /\.png/);
    assert.throws(() => parseContactSheetArgs(['--frames=1'], {root: '/r'}), /unexpected argument/);
  });

  const project = (sectionSpecs) => {
    const p = makeProject({pipeline: {outputName: 'music-video'}, sections: sectionSpecs});
    projects.push(p);
    mkdirSync(join(p.root, 'out'));
    writeFileSync(join(p.root, 'out/music-video.mp4'), 'mp4');
    return p;
  };
  const ffprobe = fakeBin('ffprobe', `process.stdout.write('4.0'); process.exit(0);`);
  const ffmpeg = (failTile, argsLog) =>
    fakeBin(
      'ffmpeg',
      `fs.appendFileSync(${JSON.stringify(argsLog)}, JSON.stringify(args) + '\\n');
const tile = args.some((a) => a.startsWith('tile=')); fs.writeFileSync(args[args.length - 1], 'png'); process.exit(tile && ${failTile} ? 1 : 0);`,
    );

  it('success: only out/contact-sheet.png is added, the temp dir is removed, stills seek to exactly their frames, the legend is printed', async () => {
    const p = project([{id: 'a', scene: 'x', start: 0}, {id: 'b', scene: 'x', start: 2}]);
    const tmpRoot = freshDir('tmp');
    const argsLog = join(freshDir('args'), 'ffmpeg.jsonl');
    const {result, output} = await quiet(() => contactSheetMain([], {root: p.root, tmpRoot, ffmpegBin: ffmpeg(false, argsLog), ffprobeBin: ffprobe}));
    assert.equal(result, 0, output.join('\n'));
    assert.deepEqual(readdirSync(join(p.root, 'out')).sort(), ['contact-sheet.png', 'music-video.mp4']);
    assert.deepEqual(readdirSync(tmpRoot), []);
    const calls = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // Stills are extracted two at a time, so the calls may log in either order.
    const seeks = calls.filter((a) => a.includes('-ss')).map((a) => a[a.indexOf('-ss') + 1]).sort((x, y) => x - y);
    assert.deepEqual(seeks, [((15 - 0.25) / 30).toFixed(6), ((75 - 0.25) / 30).toFixed(6)], 'frames 15 and 75, a quarter frame early');
    assert.ok(output.some((l) => /^ {2}1 +0\.50 s +frame +15 +a$/.test(l)), output.join('\n'));
    assert.ok(output.some((l) => /^ {2}2 +2\.50 s +frame +75 +b$/.test(l)), output.join('\n'));
  });
  it('a partial render with a manifest: stills only inside its frames, seeking relative to its first frame', async () => {
    const p = project([{id: 'a', scene: 'x', start: 0}, {id: 'b', scene: 'x', start: 2}]);
    writeFileSync(join(p.root, 'out/music-video.manifest.json'), JSON.stringify({fps: 30, frames: 30, firstFrame: 50}));
    const argsLog = join(freshDir('args'), 'ffmpeg.jsonl');
    const {result} = await quiet(() => contactSheetMain([], {root: p.root, tmpRoot: freshDir('tmp'), ffmpegBin: ffmpeg(false, argsLog), ffprobeBin: ffprobe}));
    assert.equal(result, 0);
    const calls = readFileSync(argsLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    // Stills are extracted two at a time, so the calls may log in either order.
    const seeks = calls.filter((a) => a.includes('-ss')).map((a) => a[a.indexOf('-ss') + 1]).sort((x, y) => x - y);
    // The video holds page frames [50, 80). a = [0, 60) clipped to [50, 60): min(50 + 15, middle 55) = 55;
    // b = [60, 120) clipped to [60, 80): min(75, middle 70) = 70.
    assert.deepEqual(seeks, [((55 - 50 - 0.25) / 30).toFixed(6), ((70 - 50 - 0.25) / 30).toFixed(6)]);
  });
  it('tiling failing: exit 1, no partial, no output, temp dir removed', async () => {
    const p = project([]);
    const tmpRoot = freshDir('tmp');
    const {result} = await quiet(() => contactSheetMain([], {root: p.root, tmpRoot, ffmpegBin: ffmpeg(true, join(freshDir('args'), 'a.jsonl')), ffprobeBin: ffprobe}));
    assert.equal(result, 1);
    assert.deepEqual(readdirSync(join(p.root, 'out')), ['music-video.mp4']);
    assert.deepEqual(readdirSync(tmpRoot), []);
  });
});
