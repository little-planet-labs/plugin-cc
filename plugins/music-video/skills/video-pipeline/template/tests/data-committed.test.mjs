// The committed data files parse with the contract modules, on the template
// (no-track default) and on a finished project alike.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {applyTimingOverrides, parseAudioAnalysis, parseTimingOverrides} from '../src/lib/analysis.js';
import {parseBrand} from '../src/lib/brand.js';
import {parseLyrics} from '../src/lib/lyrics.js';
import {parsePipeline} from '../src/lib/pipeline.js';
import {parseSections, placeSections, sectionsWithinDuration, withWholeSongSection} from '../src/lib/sections.js';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

describe('committed data', () => {
  it('every committed data file parses', () => {
    const pipeline = parsePipeline(readJson('../src/pipeline.json'));
    const analysis = parseAudioAnalysis(readJson('../src/data/audio-analysis.json'));
    parseAudioAnalysis(readJson('../src/data/audio-analysis.default.json'));
    parseBrand(readJson('../src/brand.json'));
    parseLyrics(readJson('../src/data/lyrics.json'));
    parseSections(readJson('../src/data/sections.json'));
    const overrides = parseTimingOverrides(readJson('../src/data/timing-overrides.json'));
    if (analysis.source !== null) {
      assert.equal(analysis.fps, pipeline.fps, 'audio-analysis.json fps matches pipeline.json');
      applyTimingOverrides(analysis, overrides);
    }
  });

  it('the no-track default is 60 s at 120 BPM, silent, at the pipeline fps', () => {
    const def = parseAudioAnalysis(readJson('../src/data/audio-analysis.default.json'));
    const pipeline = parsePipeline(readJson('../src/pipeline.json'));
    assert.deepEqual(
      [def.source, def.durationSeconds, def.durationInFrames, def.tempo, def.beats.length, def.energy.low.length],
      [null, pipeline.fallbackSeconds, pipeline.fallbackSeconds * pipeline.fps, 120, 0, 0],
    );
  });

  it('sections.json places against the committed analysis (strictly when a track is analyzed)', () => {
    const analysis = parseAudioAnalysis(readJson('../src/data/audio-analysis.json'));
    const specs = withWholeSongSection(parseSections(readJson('../src/data/sections.json')));
    const usable = analysis.source === null ? sectionsWithinDuration(specs, analysis.fps, analysis.durationInFrames) : specs;
    const placed = placeSections(withWholeSongSection(usable), analysis.fps, analysis.durationInFrames);
    assert.equal(placed[0].from, 0);
    assert.equal(placed[placed.length - 1].to, analysis.durationInFrames);
  });
});
