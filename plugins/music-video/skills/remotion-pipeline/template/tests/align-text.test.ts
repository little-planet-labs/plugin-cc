// scripts/lyric_sections.py (the lyric parsing and section logic of `pnpm
// align`) run with the system Python: it has no audio dependencies.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';

const scripts = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'scripts');
const python = ['python3.14', 'python3'].find((bin) => spawnSync(bin, ['--version']).status === 0);

/** Run `expr` (a Python expression over lyric_sections as L, with `arg` bound) and parse its JSON. */
const py = <T = unknown>(expr: string, arg: unknown = null): T => {
  const code = `import json, sys\nsys.path.insert(0, ${JSON.stringify(scripts)})\nimport lyric_sections as L\narg = json.loads(sys.stdin.read())\nprint(json.dumps(${expr}))`;
  const r = spawnSync(python as string, ['-I', '-c', code], {input: JSON.stringify(arg), encoding: 'utf8'});
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as T;
};

const LYRICS = `[Intro]
[Cinematic, slow, soaring vocal]
First light
[Verse 1]
[Playful]
Hello (hello) world
Spelled M-C-P

[Chorus]
Sing it loud
Sing it out
Sing it loud
[Instrumental Break]
[Verse 2]
Second verse
[Chorus]
Sing it loud
[Female vocal, build]
[End]`;

describe('lyric_sections.py', {skip: python ? false : 'no python3 on PATH'}, () => {
  it('reads [Section] tags, ignores delivery cues and parenthesized ad-libs', () => {
    const secs = py('[(s["tag"], s["scene"], s["number"], s["lines"]) for s in L.parse_lyrics(arg)]', LYRICS);
    assert.deepEqual(secs, [
      ['Intro', 'intro', null, ['First light']],
      ['Verse 1', 'verse', 1, ['Hello world', 'Spelled M-C-P']],
      ['Chorus', 'chorus', null, ['Sing it loud', 'Sing it out', 'Sing it loud']],
      ['Instrumental Break', 'instrumental', null, []],
      ['Verse 2', 'verse', 2, ['Second verse']],
      ['Chorus', 'chorus', null, ['Sing it loud']],
      ['End', 'end', null, []],
    ]);
  });

  it('parse_tag: known kinds whole or by last word, cues are None', () => {
    assert.deepEqual(
      py('[L.parse_tag(t) for t in arg]', ['Pre-Chorus', 'Final Chorus', 'Verse 3: rap', 'Playful', 'Female vocal, build', 'Post Chorus']),
      [['preChorus', null], ['chorus', null], ['verse', 3], null, null, ['postChorus', null]],
    );
  });

  it('assigns section ids/variants and line ids with -r2 for a repeated line', () => {
    const out = py<[unknown, unknown]>(
      `(lambda secs: (L.assign_ids(secs), [(s["id"], s["variant"]) for s in secs], [l["id"] for l in L.lyric_lines(secs, [[l.split(" ") for l in s["lines"]] for s in secs])])[1:])(L.parse_lyrics(arg))`,
      LYRICS,
    );
    assert.deepEqual(out[0], [
      ['intro', null],
      ['verse-1', '1'],
      ['chorus-1', '1'],
      ['instrumental', null],
      ['verse-2', '2'],
      ['chorus-2', '2'],
      ['end', null],
    ]);
    assert.deepEqual(out[1], ['intro-1', 'verse-1-1', 'verse-1-2', 'chorus-1-1', 'chorus-1-2', 'chorus-1-1-r2', 'verse-2-1', 'chorus-2-1']);
  });

  it('line_units: hyphens and camelCase split for the acoustic model, punctuation-only tokens join the previous word', () => {
    assert.deepEqual(py('L.line_units(arg[0], arg[1])', ['Go - M-C-P DataSync', ['Go', '-', 'M-C-P', 'DataSync']]), [
      ['Go -', ['go']],
      ['M-C-P', ['m', 'c', 'p']],
      ['DataSync', ['data', 'sync']],
    ]);
    assert.throws(() => py('L.line_units(arg, arg.split(" "))', 'open 24/7'), /spell it the way it's sung/);
  });

  // Lines: one sung section from 6 s, a 10 s gap, a second from 22 s, ending 30 s; track 40 s.
  const line = (id: string, start: number, end: number) => ({id, text: 'x', start, end, words: [{text: 'x', start, end}]});
  const sectionsArg = {
    secs: [
      {id: 'intro', scene: 'intro', variant: null, tag: 'Intro', lines: []},
      {id: 'verse-1', scene: 'verse', variant: '1', tag: 'Verse 1', lines: ['x']},
      {id: 'verse-2', scene: 'verse', variant: '2', tag: 'Verse 2', lines: ['x']},
    ],
    lines: [line('verse-1-1', 6.1, 10), line('verse-2-1', 22.2, 30)],
    lineSection: [1, 2],
    analysis: {downbeats: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38]},
    duration: 40,
  };
  const buildSections = (arg: typeof sectionsArg) =>
    py('L.build_sections(arg["secs"], arg["lines"], arg["lineSection"], arg["analysis"], arg["duration"])', arg);

  it('gaps of 4 s+ become instrumental sections on downbeats; a line-less tag names its gap', () => {
    assert.deepEqual(buildSections(sectionsArg), [
      {id: 'intro', scene: 'instrumental', start: 0, variant: 'lead-in'},
      {id: 'verse-1', scene: 'verse', start: 6, variant: '1'},
      {id: 'instrumental-1', scene: 'instrumental', start: 10, variant: 'break'},
      {id: 'verse-2', scene: 'verse', start: 22, variant: '2'},
      {id: 'instrumental-2', scene: 'instrumental', start: 30, variant: 'tail'},
    ]);
  });

  it('short gaps stay in the sung section; a pickup starts 0.05 s before the word', () => {
    const arg = {
      ...sectionsArg,
      lines: [line('verse-1-1', 1.0, 10), line('verse-2-1', 11.5, 37)],
      analysis: {downbeats: [0, 4, 8, 12, 16]},
    };
    assert.deepEqual(buildSections(arg), [
      {id: 'verse-1', scene: 'verse', start: 0, variant: '1'},
      {id: 'verse-2', scene: 'verse', start: 11.45, variant: '2'},
    ]);
  });
});
