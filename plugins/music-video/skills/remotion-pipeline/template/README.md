# Music video

A beat-synced kinetic-typography music video, as long as the track, at 1920x1080 and 30fps (`src/pipeline.json`), built with [Remotion](https://www.remotion.dev/) 4.

This project holds the deterministic pipeline: audio analysis, lyric alignment, typed beat/energy/lyric hooks, a brand theme read from `src/brand.json`, an optional kinetic-typography kit, and the render, preview and contact-sheet scripts. The scenes are the video's own: `src/scenes/` starts with one neutral placeholder that plays every section.

## Quickstart for a new video

```sh
cp -R <plugin>/skills/remotion-pipeline/template ~/videos/<company>-music-video
cd ~/videos/<company>-music-video
pnpm install
pnpm setup:audio    # one time: .venv/ with librosa (scripts/requirements.txt)
pnpm setup:align    # one time: .venv-align/ (Python 3.14) + ~1.4 GB of models in .cache/models
```

1. Fill in `src/brand.json` (it ships as a neutral placeholder) and put the logo at the path it names (`public/brand/logo.svg`).
2. Write `creative/lyrics.screen.txt` (on-screen spellings) and `creative/lyrics.suno.txt` (the same text with sung respellings; it's what goes into Suno).
3. Drop the song in as `public/audio/track.wav` (or `track.mp3`).
4. `pnpm analyze`: beats, downbeats, onsets and band energy into `src/data/audio-analysis.json`.
5. `pnpm align`: line and word timings into `src/data/lyrics.json`, sections into `src/data/sections.json`.
6. Build the scenes in `src/scenes/` and register them in `src/scenes/registry.ts`.
7. `pnpm render`, then `pnpm preview` (a 720p copy under 30 MB) and `pnpm contact-sheet` (one PNG of stills).

Requirements: Node 22.18 or newer, pnpm, Python 3.12+ for `setup:audio`, Python 3.14 for `setup:align` (its pins are tested there), `curl`, `tar`, and `ffmpeg` + `ffprobe` with libx264 on `PATH`. On the first render, Remotion downloads Chrome Headless Shell (~190 MB) into `node_modules/.remotion/`.

## Scripts

| Script | Does |
|---|---|
| `pnpm setup:audio` | Creates `.venv/` and installs the analysis pins. |
| `pnpm setup:align` | Creates `.venv-align/` (removed again if the install fails), installs the alignment pins, downloads the models from the k2-fsa/sherpa-onnx GitHub releases into `.cache/models/`, and deletes the archives after extracting them. Re-run it to resume an interrupted download. |
| `pnpm analyze` | Decodes the track with ffmpeg and writes `src/data/audio-analysis.json`. Re-run whenever the track changes. |
| `pnpm analyze:reset` | Restores the no-track default analysis (60 s, 120 BPM grid). |
| `pnpm align` | Aligns `creative/lyrics.screen.txt` to the track; writes `src/data/lyrics.json` and `src/data/sections.json`, plus diagnostics in `creative/alignment/`. Needs `pnpm analyze` first. `pnpm align calibrate` re-measures the model timing bias (macOS `say`). |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Checks. The tests cover the timing math, schemas, hooks under nesting, the scripts' cleanup, and the lyric and section logic of `pnpm align`. |
| `pnpm still` | One frame as a PNG: `--frame=<n>` (absolute frame) and `--out <path>` (default `out/still.png`), e.g. `pnpm still --frame=1200 --out=out/wip-1/f-1200.png`. Other Remotion flags pass through as `--flag=value`. |
| `pnpm render` | The full video into `out/music-video.mp4` (`--out <path>`, `--frames=0-299`, other Remotion flags as `--flag=value`). Always render through this script; see Gotchas. |
| `pnpm preview` | A 720p H.264 copy of the render, `out/music-video-preview.mp4`, sized for ~26 MB and refused at 30 MB (`--in`, `--out`). |
| `pnpm contact-sheet` | Stills from the final MP4 at every section start (+0.5 s) and the middle of sections of 12 s or more, tiled 4 across into `out/contact-sheet.png`; prints which tile is which (`--in`, `--out`, `--columns=<n>`). |

Every script cleans up its temp files on success, on failure and on Ctrl-C, and writes its output under a temporary name that's renamed into place only once complete.

## File contract

| Path | Written by | What it is |
|---|---|---|
| `src/brand.json` | you / the research step | Brand tokens: `name`, `colors` (`background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted`, hex; `neutral`: at least 3 steps keyed by step number strings), `fonts.display` / `fonts.body` (`family`, `source: "google" \| "local"`, `weights`, and for local fonts an optional `files` map of weight to a path under `public/`), `logo` (`path`, optional `onDark`, `onLight`, all under `public/`). Schema and errors: `src/lib/brand.ts`. |
| `public/brand/logo*.svg` | you / the research step | Logo files named in `brand.json`. A missing file renders nothing. |
| `public/audio/track.wav` or `track.mp3` | you | The song. Keep exactly one. Never edited. |
| `creative/lyrics.screen.txt` | you / the lyricist | Suno-style `[Section]` tags plus lines, in screen spellings. What `pnpm align` reads. |
| `creative/lyrics.suno.txt` | you / the lyricist | The same sections and lines in sung spellings. `pnpm align` uses it for the acoustic model only, token by token, so every line needs the same number of words as its screen line. |
| `src/data/audio-analysis.json` | `pnpm analyze` | Duration, tempo, beats, downbeats (4/4 assumed), onsets, per-frame low/mid/high energy. |
| `src/data/audio-analysis.default.json` | committed | The no-track default. |
| `src/data/lyrics.json` | `pnpm align` | `[]` until aligned. Lines `{id, text, start, end, words: [{text, start, end}]}`, seconds. |
| `src/data/sections.json` | `pnpm align` | `[]` until aligned (one whole-song section plays). `[{id, scene, start, variant?}]`, seconds, first `start` 0. |
| `src/data/timing-overrides.json` | you, by hand | `{}` by default. Beat anchors (see below). |
| `creative/alignment/*.json` | `pnpm align` | `transcript.json` (what the singer actually sang), `verification.json` (timing cross-checks, possible lyrics missing from the text), `align-words.json`. |

### How `pnpm align` reads the lyrics

- A bracketed tag is a **section** when its first part (before `,`, `:`, ` - ` or `(`) is a section kind, as a whole or by its last word: intro, verse, pre-chorus, chorus, post-chorus, hook, refrain, bridge, breakdown, outro, end, and the instrumental kinds instrumental, interlude, break, solo, drop, build. `[Verse 2]`, `[Final Chorus]` and `[Instrumental Break]` are sections. Every other tag (`[Playful]`, `[Gang vocals]`, `[Half-time, dramatic]`, `[Female vocal, build]`) is a delivery cue and is ignored.
- Parenthesized text in a line is a backing-vocal ad-lib (Suno's convention). It's dropped: not aligned, not shown.
- **Section ids** are the kind in kebab case plus the tag's number (`verse-2`) or, for a kind that occurs more than once without numbers, its occurrence (`chorus-1`, `chorus-2`). The `scene` key is the kind (`verse`, `preChorus`, `chorus`, ...). A repeated kind gets `variant` `"1"`, `"2"`, ...
- **Line ids** are `<section id>-<n>`, numbered within the section. A line that repeats an earlier line of the same section reuses that line's id with `-r2`, `-r3`: a chorus of "A / B / A / C" is `chorus-1-1`, `chorus-1-2`, `chorus-1-1-r2`, `chorus-1-3`.
- **Instrumentals**: any stretch of 4 s or more without sung words becomes a section with scene `instrumental` and variant `lead-in`, `break` or `tail`. A line-less tag at that spot (`[Instrumental]`, `[Break]`, `[End]`) gives it its id; otherwise it's `instrumental-<n>`.
- Sung spellings: each screen word is aligned using the word at the same position in `lyrics.suno.txt`. Without that file, `creative/brief.json`'s `pronunciation` (`{screen, sung}`) is applied. Hyphens and camelCase split for the model (`M-C-P` is three letters, `DataSync` two words). Numbers have no pronunciation: spell them out in the sung file (`twenty four seven`).

## Writing scenes

Import from `src/lib`:

| Helper | Returns |
|---|---|
| `useSongFrame()` / `useSongTime()` | absolute song frame or seconds, whatever `<Sequence>`/`<Series>`/`<Loop>` you're in |
| `useBeat()` | `beatIndex`, `phase` (0..1 to the next beat), `isOnBeat`, `isOnDownbeat`, `beatInBar`, `barIndex`, `beatDuration` |
| `useEnergy('low' \| 'mid' \| 'high', {smoothFrames?})` | 0..1 band energy this frame |
| `useFramesSinceOnset()` | frames since the last transient |
| `useLyric()` | the active line and the word being sung (`wordIndex`, -1 between words) |
| `useLine(id)` / `useLineOrNull(id)` | one line: `startFrame`, `endFrame`, `words`, `wordFrames` (absolute frames), `activeWordIndex` (last word started), `progress`, `isActive` |
| `useSectionBeats(section)` | the section's beats and downbeats as absolute frames |
| `beatFramesBetween`, `downbeatFramesBetween` | the same, pure, over a half-open frame range, filtered on the ROUNDED frame |
| `clamp01`, `progressBetween`, `springAt`, `decay`, `beatKick`, `shakeOffset` | motion math (`src/lib/motion.ts`) |
| `useAudioAnalysis()`, `AudioAnalysisContext`, `LyricsContext` | the data in effect (contexts let tests and previews swap it) |
| `secondsToFrame`, `frameToSeconds`, `getBeatState`, `getEnergyAt`, `getLineState`, `lineWords` | pure versions, for arbitrary frames |

Theme (`src/theme.ts`): `theme.colors` (`background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted`, `textOnLight`, `light`, `lightRaised`, `neutralDark`, `neutralDarkRaised`, `neutral`, `neutralScale`, `flash`, `black`), `theme.fonts.display` / `body` (CSS stacks; the fonts load at render time), `theme.weights` (snapped to the loaded weights), `theme.sizes`. `brand` is the parsed `brand.json`.

`<Logo variant? height? />` (`src/components/Logo.tsx`) shows the brand.json logo (`default`, `onDark`, `onLight`, falling back to `path`), or nothing if the file is missing.

The optional kit in `src/components/kinetic`: `Backdrop` (`black`/`deep`/`brand`/`neutral`/`light`, with an energy-reactive glow), `KineticText`, `SlamIn`, `SnapIn`, `FadeUp`, `Typewriter`, `StampWords`, `Shake`, `BeatPulse`, `Flash`, `DrawPath`. Entrances take `at` / `exitAt` as ABSOLUTE song frames (e.g. `useLine('chorus-1-2').wordFrames[0].start`) and render nothing before `at`.

Scenes: each is a `SceneComponent` (`src/scenes/types.ts`) that receives its placed `section` (`id`, `scene`, `variant`, `from`, `durationInFrames`, `start`, `end`). The composition (`src/MusicVideo.tsx`) puts each section of `sections.json` in a `<Sequence>` and picks the component with `resolveScene(section.scene)`: `SCENES[key]` from `src/scenes/registry.ts`, else `DEFAULT_SCENE`. Register every scene key `sections.json` uses, delete the placeholder, then set `DEFAULT_SCENE = null` so a missing key stops the render.

Rules:

- Time is frames. Convert seconds once with `Math.round(seconds * fps)` and compare frames; assign beats and events to sections by rounded frame, never by seconds.
- Keep it deterministic: derive everything from the frame. No `Date`, no `Math.random()`; use Remotion's `random(seed)`.
- Colors, fonts and sizes come from `src/theme.ts`.
- On screen: lyric text, exact product feature names, and the logo. No taglines, labels or debug text.

## Fixing timing by hand

Downbeats are estimated (4/4 assumed). A free-time intro or a half-time bridge can shift "the 1". Fix it in `src/data/timing-overrides.json`:

```json
{"firstBeat": 11.6, "lastBeat": 91.0, "downbeats": [11.6, 43.2, 58.9]}
```

`firstBeat` / `lastBeat` drop detected beats outside the range; each `downbeats` anchor snaps to the nearest detected beat (within half a beat) and bars count every 4 beats from the latest anchor. Mistakes stop the render with the field named. Overrides change the hooks, not `sections.json`: `pnpm align` snaps sections to the raw detected downbeats.

## Gotchas

- **Always render through `pnpm render`.** Remotion 4.0.527 encodes AAC with libfdk to raw ADTS and stream-copies it into the MP4, which loses the 2048-sample encoder priming: a plain `remotion render … .mp4` plays the audio ~42.7 ms late. The wrapper renders PCM-16 into an intermediate MKV, then ffmpeg's AAC writes the MP4 with an edit list, and `-video_track_timescale 30` makes the video exact CFR. `--codec`, `--audio-codec`, `--separate-audio-to`, `--sequence` and `--output` are refused.
- **Frames, not seconds.** `useSongFrame()` is `Internals.useTimelinePosition()`, correct at any `<Sequence>` depth. It's an internal API: Remotion is pinned exactly (4.0.527, with `@remotion/*` at the same version); re-run `pnpm test` on any upgrade.
- **Suno songs don't follow the plan.** They run longer and add instrumental stretches and repeats. Take section times from `pnpm align`, never from the lyric plan; check `creative/alignment/verification.json` → `possibleUnlistedLyrics` and `transcript.json`, and listen. Instrumentals get visuals, not invented text.
- **Headless Chrome can't launch inside the Claude Code Bash sandbox** (mach-port denial). `pnpm still`, `pnpm render` and anything else that opens Chrome need the sandbox off or an unsandboxed run.
- **pip in a sandbox or behind a TLS-intercepting proxy** may need `PIP_USE_DEPRECATED=legacy-certs pnpm setup:align` (or `setup:audio`).
- **Model hosts.** Hugging Face and PyTorch hosts may be blocked; the alignment uses only k2-fsa/sherpa-onnx models from GitHub releases. They land in `.cache/models` (~1.4 GB extracted). The setup deletes the archives after extraction; any `*.tar.bz2` or `dl/` left in `.cache/models` from older setups is deleted once all models are in place.
- **Chat uploads cap at 30 MB**: share `pnpm preview`'s file, not the full render.
- **Brand fonts may be commercial** (Proxima Nova, Gotham, ...). Check the licence; otherwise pick a similar Google family. Google families load through `@remotion/google-fonts`, pinned to the Remotion version; the family name must match Google Fonts exactly, and every weight must exist, or the render stops with the reason.
- **MP3 tracks** are fine timing-wise: the ~23 ms LAME delay is stripped on decode by the analysis, the alignment and the render.
- **A stale analysis** (track swapped, `pnpm analyze` not re-run) renders with the 60 s fallback grid and logs a warning. With a real analysis, a section that starts past the end of the track stops the render with its id.

## Layout

```
public/audio/            the song (track.wav or track.mp3)
public/brand/            logo files named in src/brand.json
creative/                lyrics (screen + sung), alignment diagnostics
scripts/                 analyze, align (+ lyric_sections.py), setup-align, render, still, preview, contact-sheet; lib/cli.mjs
src/brand.json           brand tokens (placeholder until replaced)
src/theme.ts             theme from brand.json; fonts loaded at render time
src/pipeline.json        composition id, output name, fps, size, fallback length, audio paths
src/data/                generated data, defaults, timing overrides
src/lib/                 schemas, timing math, hooks, brand parsing, font loading
src/components/          Logo, kinetic/ kit
src/scenes/              registry.ts, types.ts, Placeholder.tsx (replace it)
src/MusicVideo.tsx       the composition: audio, duration from the analysis, one Sequence per section
tests/                   node:test suites
out/                     renders, previews, stills (git-ignored)
```
