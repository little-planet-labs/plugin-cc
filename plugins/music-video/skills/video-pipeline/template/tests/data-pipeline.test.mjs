import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {DEFAULT_DRAFT, DEFAULT_RENDER, parsePipeline} from '../src/lib/pipeline.js';

const committed = JSON.parse(readFileSync(new URL('../src/pipeline.json', import.meta.url), 'utf8'));

/** The required top-level keys only, no render/draft. */
const minimal = () => ({
  outputName: 'music-video',
  fps: 30,
  width: 1920,
  height: 1080,
  fallbackSeconds: 60,
  audioCandidates: ['audio/track.wav', 'audio/track.mp3'],
});

describe('parsePipeline', () => {
  it('the committed pipeline.json parses to exactly its own values', () => {
    const p = parsePipeline(committed);
    const {$comment, ...expected} = committed;
    void $comment;
    assert.deepEqual(p, expected);
    // The committed render/draft blocks are the defaults.
    assert.deepEqual(p.render, {...DEFAULT_RENDER});
    assert.deepEqual(p.draft, {...DEFAULT_DRAFT});
  });

  it('pipeline defaults: missing render/draft blocks, and missing keys inside them, take the defaults', () => {
    assert.deepEqual(DEFAULT_RENDER, {scale: 2, crf: 17, preset: 'medium', pool: 2, chunkSeconds: 20, shutter: 0.5, format: 'png', audioBitrate: '256k', retries: 2});
    assert.deepEqual(DEFAULT_DRAFT, {scale: 0.5, crf: 23, preset: 'veryfast', format: 'jpeg'});
    const bare = parsePipeline(minimal());
    assert.deepEqual(bare.render, {...DEFAULT_RENDER});
    assert.deepEqual(bare.draft, {...DEFAULT_DRAFT});
    const partial = parsePipeline({...minimal(), render: {scale: 1, pool: 4}, draft: {crf: 28}});
    assert.deepEqual(partial.render, {...DEFAULT_RENDER, scale: 1, pool: 4});
    assert.deepEqual(partial.draft, {...DEFAULT_DRAFT, crf: 28});
    // Empty blocks are allowed too.
    assert.deepEqual(parsePipeline({...minimal(), render: {}, draft: {}}).render, {...DEFAULT_RENDER});
  });

  it('the defaults are frozen and parsing never shares them with the result', () => {
    assert.ok(Object.isFrozen(DEFAULT_RENDER) && Object.isFrozen(DEFAULT_DRAFT));
    const p = parsePipeline(minimal());
    p.render.pool = 9;
    p.draft.scale = 1;
    assert.equal(DEFAULT_RENDER.pool, 2);
    assert.equal(parsePipeline(minimal()).draft.scale, 0.5);
  });

  it('accepts the boundary values of each ranged field', () => {
    const p = parsePipeline({
      ...minimal(),
      fps: 150,
      render: {crf: 0, shutter: 1, retries: 0, format: 'jpeg', preset: 'ultrafast', audioBitrate: '96k'},
      draft: {crf: 51, format: 'png', preset: 'placebo'},
    });
    assert.deepEqual([p.fps, p.render.crf, p.render.shutter, p.render.retries, p.draft.crf], [150, 0, 1, 0, 51]);
  });

  it("pipeline rejects an fps analyze_audio.py can't use: it must divide both 22050 and 48000", () => {
    // analyze_audio.py writes one energy value per frame with hop = 22050 / fps; the render
    // audio is 48000 Hz. The fps that divide both are exactly the divisors of 150.
    for (const fps of [1, 2, 3, 5, 6, 10, 15, 25, 30, 50, 75, 150]) assert.equal(parsePipeline({...minimal(), fps}).fps, fps);
    for (const fps of [24, 60, 48000, 7, 300, 45]) {
      assert.throws(() => parsePipeline({...minimal(), fps}), new RegExp(`pipeline\\.json: fps must be .*22050.*48000.*\\(got ${fps}\\)`), `fps ${fps}`);
    }
  });

  it('pipeline requires even page dimensions and a scale that keeps the output frame even (libx264 + yuv420p)', () => {
    for (const scale of [2, 1, 0.5]) {
      const p = parsePipeline({...minimal(), render: {scale}, draft: {scale}});
      assert.deepEqual([p.render.scale, p.draft.scale], [scale, scale]);
    }
    assert.throws(
      () => parsePipeline({...minimal(), draft: {scale: 0.33}}),
      /pipeline\.json: draft\.scale must make width\*scale and height\*scale even integers \(got 0\.33 -> 633\.6x356\.4\)/,
    );
    // Whole but odd: an even page whose scaled side is an odd integer.
    assert.throws(() => parsePipeline({...minimal(), height: 1082, render: {scale: 0.5}}), /pipeline\.json: render\.scale must make .*960x541/);
    assert.throws(() => parsePipeline({...minimal(), render: {scale: 1.5}, width: 1922}), /pipeline\.json: render\.scale must make .*2883x1620/);
    assert.throws(() => parsePipeline({...minimal(), width: 1921}), /pipeline\.json: width must be an even positive integer \(got 1921\)/);
    assert.throws(() => parsePipeline({...minimal(), height: 1079}), /pipeline\.json: height must be an even positive integer \(got 1079\)/);
  });

  it('pipeline rejects each invalid field with an error naming it', () => {
    const top = (patch) => ({...minimal(), ...patch});
    const render = (patch) => ({...minimal(), render: patch});
    const draft = (patch) => ({...minimal(), draft: patch});
    const cases = [
      ['root', [], /pipeline\.json: root must be an object/],
      ['compositionId is gone', top({compositionId: 'MusicVideo'}), /pipeline\.json: compositionId must be one of .*unknown key/],
      ['outputName missing', top({outputName: undefined}), /pipeline\.json: outputName must be a non-empty string/],
      ['outputName with a slash', top({outputName: 'out/video'}), /pipeline\.json: outputName must be a file name/],
      ['outputName hidden', top({outputName: '.video'}), /pipeline\.json: outputName must be a file name/],
      ['fps 0', top({fps: 0}), /pipeline\.json: fps must be a positive integer/],
      ['fps fractional', top({fps: 29.97}), /pipeline\.json: fps must be a positive integer/],
      ['fps string', top({fps: '30'}), /pipeline\.json: fps must be a positive integer/],
      ['width 0', top({width: 0}), /pipeline\.json: width must be an even positive integer/],
      ['height fractional', top({height: 1080.5}), /pipeline\.json: height must be an even positive integer/],
      ['fallbackSeconds 0', top({fallbackSeconds: 0}), /pipeline\.json: fallbackSeconds must be a number > 0/],
      ['audioCandidates empty', top({audioCandidates: []}), /pipeline\.json: audioCandidates must be a non-empty array/],
      ['audioCandidates not an array', top({audioCandidates: 'audio/track.wav'}), /pipeline\.json: audioCandidates must be a non-empty array/],
      ['audioCandidates blank entry', top({audioCandidates: ['audio/track.wav', '']}), /pipeline\.json: audioCandidates\[1\] must be a non-empty string/],
      ['audioCandidates non-string', top({audioCandidates: [3]}), /pipeline\.json: audioCandidates\[0\] must be a non-empty string/],
      ['audioCandidates escaping public/', top({audioCandidates: ['../track.wav']}), /pipeline\.json: audioCandidates\[0\] must be a path relative to public\//],
      ['audioCandidates absolute', top({audioCandidates: ['/tmp/track.wav']}), /pipeline\.json: audioCandidates\[0\] must be a path relative to public\//],
      ['render not an object', top({render: 2}), /pipeline\.json: render must be an object/],
      ['unknown render key', render({fps: 60}), /pipeline\.json: render\.fps must be one of .*unknown key/],
      ['render.scale 0', render({scale: 0}), /pipeline\.json: render\.scale must be a number > 0/],
      ['render.scale negative', render({scale: -2}), /pipeline\.json: render\.scale must be a number > 0/],
      ['render.crf below 0', render({crf: -1}), /pipeline\.json: render\.crf must be a number from 0 to 51/],
      ['render.crf above 51', render({crf: 52}), /pipeline\.json: render\.crf must be a number from 0 to 51/],
      ['render.preset', render({preset: 'fastest'}), /pipeline\.json: render\.preset must be one of ultrafast/],
      ['render.pool 0', render({pool: 0}), /pipeline\.json: render\.pool must be a positive integer/],
      ['render.pool fractional', render({pool: 1.5}), /pipeline\.json: render\.pool must be a positive integer/],
      ['render.chunkSeconds 0', render({chunkSeconds: 0}), /pipeline\.json: render\.chunkSeconds must be a number > 0/],
      ['render.shutter 0', render({shutter: 0}), /pipeline\.json: render\.shutter must be a number in \(0, 1\]/],
      ['render.shutter above 1', render({shutter: 1.01}), /pipeline\.json: render\.shutter must be a number in \(0, 1\]/],
      ['render.format', render({format: 'webp'}), /pipeline\.json: render\.format must be "png" or "jpeg"/],
      ['render.retries negative', render({retries: -1}), /pipeline\.json: render\.retries must be a non-negative integer/],
      ['render.retries fractional', render({retries: 0.5}), /pipeline\.json: render\.retries must be a non-negative integer/],
      ['render.audioBitrate', render({audioBitrate: 256}), /pipeline\.json: render\.audioBitrate must be a bitrate/],
      ['draft not an object', top({draft: 'fast'}), /pipeline\.json: draft must be an object/],
      ['unknown draft key', draft({pool: 4}), /pipeline\.json: draft\.pool must be one of .*unknown key/],
      ['draft.scale 0', draft({scale: 0}), /pipeline\.json: draft\.scale must be a number > 0/],
      ['draft.crf above 51', draft({crf: 60}), /pipeline\.json: draft\.crf must be a number from 0 to 51/],
      ['draft.preset', draft({preset: 'quick'}), /pipeline\.json: draft\.preset must be one of/],
      ['draft.format', draft({format: 'gif'}), /pipeline\.json: draft\.format must be "png" or "jpeg"/],
    ];
    for (const [label, input, pattern] of cases) assert.throws(() => parsePipeline(input), pattern, label);
  });
});
