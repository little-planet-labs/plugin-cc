---
name: remotion-pipeline
description: The deterministic kit behind every music video — a company-agnostic Remotion 4 template (template/) with audio analysis, lyric forced alignment, beat/energy/lyric hooks, a brand theme read from src/brand.json, an optional kinetic-typography kit, and the render, preview and contact-sheet scripts. Covers creating a project from the template, every pnpm script, the src API and timing contract, the data files, and the pipeline gotchas (render wrapper, frames not seconds, sandboxed Chrome, pip certificates, model hosts, the 30 MB preview). Use when setting up a music-video project, running analysis, alignment or renders, or writing code against its src/lib API.
user-invocable: false
---

# Remotion pipeline

`template/` is a complete Remotion project that renders a beat-synced video for any song and any brand. Everything in it is deterministic and shared between videos. The scenes are not: each video gets its own, written by the director (see `music-video:scene-authoring`). The template ships one neutral placeholder scene so a fresh project renders end to end.

Reference files below are relative to this skill's directory. `template/README.md` is the project's own manual and goes with every copy.

## Create a project

```sh
cp -R <this skill dir>/template <project dir>
cd <project dir>
pnpm install
pnpm setup:audio     # .venv/ with librosa, for pnpm analyze
pnpm setup:align     # .venv-align/ (Python 3.14) + ~1.4 GB of models in .cache/models
```

- Copy with `cp -R` so the dotfiles (`.gitignore`) come along. Never run the pipeline inside the plugin's `template/`; it must stay free of `node_modules`, venvs and generated data.
- `pnpm install` uses the committed `pnpm-lock.yaml`. Remotion and every `@remotion/*` package are pinned to exactly `4.0.527`; keep them in lockstep.
- `setup:align` downloads about 650 MB and runs for a few minutes the first time. It resumes an interrupted download and deletes the archives once extracted. It needs network access to github.com; see Gotchas.
- Requirements on the machine: Node 22.18+, pnpm, Python 3.14 (3.12+ is enough for `setup:audio`), `curl`, `tar`, `ffmpeg` and `ffprobe` with libx264.

Then, in order: fill `src/brand.json` and the logo files, write `creative/lyrics.screen.txt` and `creative/lyrics.suno.txt`, drop the song at `public/audio/track.wav` (or `.mp3`), `pnpm analyze`, `pnpm align`, build the scenes, `pnpm render`, `pnpm preview`, `pnpm contact-sheet`.

## Scripts

All are in `template/package.json`, implemented in `template/scripts/`. Every Node script runs on `template/scripts/lib/cli.mjs`: temp files are registered before they exist and removed on success, failure, and Ctrl-C/SIGTERM (forwarded to children, which get 5 s before SIGKILL); outputs are written under a temporary name and renamed into place only when complete. Never call `process.exit()` in a script body; throw a `CliError`.

| Script | File | Does |
|---|---|---|
| `setup:audio` | inline | `.venv/` + `scripts/requirements.txt` (librosa). |
| `setup:align` | `scripts/setup-align.mjs` | `.venv-align/` from `python3.14` (falls back to `python3` with a warning), `scripts/requirements-align.txt`, then `align_lyrics.py fetch-models`. Removes a venv it created if the install fails. |
| `analyze` | `scripts/analyze.mjs` + `analyze_audio.py` | ffmpeg decode, librosa beats/downbeats/onsets/band energy → `src/data/audio-analysis.json`. |
| `analyze:reset` | same | Restores `audio-analysis.default.json` (60 s, 120 BPM grid, silent). |
| `align` | `scripts/align.mjs` + `align_lyrics.py` + `lyric_sections.py` | Forced alignment → `src/data/lyrics.json`, `src/data/sections.json`, diagnostics in `creative/alignment/`. `pnpm align calibrate` re-measures the model bias. |
| `typecheck`, `lint`, `test` | | `tsc --noEmit`, ESLint (Remotion config), `node --test` via tsx. |
| `still` | `scripts/still.mjs` | One frame as an image. `--frame=<n>` is the ABSOLUTE frame; `--out <path>` or `--out=<path>` sets the file (default `out/still.png`, directories are created). Keep working stills under `out/wip-<pass>/`, e.g. `pnpm still --frame=1200 --out=out/wip-2/f-1200.png`. Other Remotion flags pass through as `--flag=value`. |
| `render` | `scripts/render.mjs` | The video → `out/<outputName>.mp4` (`out/music-video.mp4`). `--out <path>`, `--frames=0-299` for a 10 s test, other Remotion flags as `--flag=value`. |
| `preview` | `scripts/preview.mjs` | 720p H.264/AAC copy, two-pass, video bitrate computed from the duration to land near 26 MB; fails rather than write a file of 30 MB or more → `out/music-video-preview.mp4` (`--in`, `--out`). Refuses videos too long for a legible bitrate at that size (over about 8 minutes). |
| `contact-sheet` | `scripts/contact-sheet.mjs` | Stills from the FINAL MP4 at every `sections.json` start (+0.5 s, or the section's midpoint if shorter) and at the midpoint of every section of 12 s or more, 480 px wide, tiled 4 across → `out/contact-sheet.png`. Prints the legend (tile number, time, section id). `--in`, `--out`, `--columns=<n>`. |

`src/pipeline.json` holds what the scripts and the composition share: `compositionId` (`MusicVideo`), `outputName`, `fps` (30, integer, required for exact CFR), `width`, `height`, `fallbackSeconds`, `audioCandidates`.

## Data files

| File | Producer | Shape |
|---|---|---|
| `src/brand.json` | brand research | `name`; `colors`: `background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted` (hex) and `neutral` (at least 3 steps, keys are step-number strings such as `"50"`, `"500"`, `"900"`); `fonts.display` / `fonts.body`: `family`, `source` (`"google"` or `"local"`), `weights` (100..900), local only: `files` (weight → path under `public/`, every weight also in `weights`); `logo`: `path`, optional `onDark`, `onLight`, each a path under `public/` (e.g. `public/brand/logo-on-dark.svg`). `"$comment"` is allowed anywhere. The template's copy is a marked placeholder. Schema with field-naming errors: `template/src/lib/brand.ts`. |
| `creative/lyrics.screen.txt` | lyricist | Suno-style tags and lines, screen spellings. Read by `pnpm align`. |
| `creative/lyrics.suno.txt` | lyricist | Same sections, lines and word counts, sung spellings. Used for the acoustic model only. |
| `src/data/audio-analysis.json` | `pnpm analyze` | `durationSeconds`, `durationInFrames`, `tempo`, `beats`, `downbeats`, `onsets` (seconds), `energy.{low,mid,high}` (per frame, 0..1). Schema: `template/src/lib/analysis-schema.ts`. |
| `src/data/lyrics.json` | `pnpm align` | `[{id, text, start, end, words: [{text, start, end}]}]`, seconds, sorted, non-overlapping, words join to `text`. `[]` in the template. |
| `src/data/sections.json` | `pnpm align` | `[{id, scene, start, variant?}]`, first `start` 0, ascending. `[]` in the template, which plays one whole-song section. |
| `src/data/timing-overrides.json` | by hand | `{}` or `{firstBeat?, lastBeat?, downbeats?}` (seconds). Affects the hooks, not `sections.json`. |
| `creative/alignment/` | `pnpm align` | `transcript.json` (free ASR of the vocal stem), `verification.json` (cross-checks and `possibleUnlistedLyrics`), `align-words.json`. |

### What `pnpm align` does with the lyrics

Implemented in `template/scripts/lyric_sections.py` (no audio dependencies; tested by `tests/align-text.test.ts`):

- **Section tags.** A bracketed tag is a section when its first part (before `,` `:` ` - ` `(`) is a section kind as a whole or by its last word: intro, verse, pre-chorus, chorus, post-chorus, hook, refrain, bridge, breakdown, outro, end, instrumental, interlude, break, solo, drop, build. Everything else is a delivery cue and is ignored: `[Playful]`, `[Gang vocals]`, `[Female vocal, build]`.
- **Section ids and scene keys.** id = the kind in kebab case plus the tag's number (`verse-2`), or the occurrence for a kind repeated without numbers (`chorus-1`, `chorus-2`). `scene` = the kind in camelCase (`verse`, `preChorus`, `chorus`, `postChorus`, `bridge`, `outro`, `instrumental`, ...). A repeated kind gets `variant` `"1"`, `"2"`, ...
- **Line ids.** `<section id>-<n>`, numbered within the section. A line repeating an earlier line of the same section gets that line's id plus `-r2`, `-r3` (chorus "A / B / A / C" → `chorus-1-1`, `chorus-1-2`, `chorus-1-1-r2`, `chorus-1-3`).
- **Sung respellings map back to screen spellings.** Word i of a screen line is aligned with word i of the matching `lyrics.suno.txt` line, and `lyrics.json` keeps the screen text. Without the suno file, `creative/brief.json` `pronunciation {screen, sung}` is applied. A line whose word counts differ falls back to the screen spelling, with a warning. Parenthesized ad-libs are dropped; numbers must be spelled out in the sung file.
- **Section starts** snap to the detected downbeat nearest the first word, or 0.05 s before the word when that downbeat is later (a pickup).
- **Instrumentals.** Every stretch of 4 s or more without sung words becomes `{scene: "instrumental", variant: "lead-in" | "break" | "tail"}`, starting on the first downbeat after the last word. A line-less tag at that position (`[Instrumental]`, `[End]`) names it; otherwise `instrumental-<n>`.

Method, unchanged from the reference video: ffmpeg gapless decode; UVR-MDX-NET-Voc_FT vocal stem; NeMo parakeet-tdt-0.6b-v2 free transcript in ~15 s windows cut at the quietest vocal moments; CTC forced alignment of the known text with parakeet-tdt_ctc-110m at four 20 ms sub-frame offsets, averaged; CTC (−0.07 s) and TDT (+0.03 s) bias calibration, averaged where they agree within 0.35 s; phrase-final word ends follow the sung note by pYIN pitch continuity. It refuses to write if the analysis is the no-track default or its duration doesn't match the decoded track, and validates the same contract `src/lib` enforces before writing.

## src API

The names below are what scenes and the other skills depend on. Keep them.

**Hooks and helpers** (`template/src/lib/`, re-exported from `src/lib/index.ts`):

| Name | Returns |
|---|---|
| `useSongFrame()` | Absolute song frame, at any `<Sequence>`/`<Series>`/`<Loop>` depth (frozen frame inside `<Freeze>`). |
| `useSongTime()` | Absolute song time in seconds. |
| `useBeat()` | `beatIndex`, `phase`, `isOnBeat`, `isOnDownbeat`, `beatInBar`, `barIndex`, `beatDuration`. |
| `useEnergy(band, {smoothFrames})` | 0..1 energy of `'low'` / `'mid'` / `'high'` this frame. |
| `useFramesSinceOnset()` | Frames since the last onset (Infinity before the first). |
| `useLyric()` | `{line, index, wordIndex}` of the line being sung, or null; `wordIndex` is the word containing now, -1 in gaps. |
| `useLine(id)` / `useLineOrNull(id)` | `{line, words, startFrame, endFrame, wordFrames, activeWordIndex, progress, isActive}` in absolute frames; `activeWordIndex` is the last word started. `useLine` throws naming a missing id. |
| `useSectionBeats(section)` | `{beats, downbeats}` as absolute frames inside the section. |
| `useAudioAnalysis()`, `AudioAnalysisContext`, `useLyrics()`, `LyricsContext` | The data in effect; the contexts let tests and previews substitute it. |
| sections helpers (`sections.ts`) | `parseSections`, `placeSections`, `sectionsWithinDuration`, `withWholeSongSection`, types `SectionSpec`, `PlacedSection`, `SceneKey` (a string). |
| timing (`timing.ts`) | `secondsToFrame`, `frameToSeconds`, `getBeatState`, `getEnergyAt`, `framesSinceEvent`, `beatFramesBetween`, `downbeatFramesBetween` (half-open frame range, filtered on the rounded frame). |
| lyric timing (`lyric-timing.ts`) | `getLineById`, `getLineState`, `lineWords` (estimates word timing from character counts when a line has none). |
| motion (`motion.ts`) | `clamp01`, `progressBetween`, `springAt`, `decay`, `beatKick`, `shakeOffset`. |
| brand (`brand.ts`, `fonts.ts`) | `parseBrand`, `neutralScale`, `toStaticPath`, `loadBrandFont`, `fontStack`. |

**Theme** (`template/src/theme.ts`): `brand` (parsed brand.json) and `theme` with `colors` (`background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted`, `textOnLight`, `light`, `lightRaised`, `neutralDark`, `neutralDarkRaised`, `neutral`, `neutralScale`, `flash`, `black`), `fonts.display` / `fonts.body` (CSS stacks), `weights` (`light`..`extraBold`, snapped to loaded weights), `sizes` (`lyric` 84, `lyricSmall` 72, `cinematic` 96, `hit` 200, `hitMax` 300 px at 1080p). Google fonts load through `getAvailableFonts()` of `@remotion/google-fonts` by exact family name, so any family works without code changes; local fonts through `FontFace` from `files`, or an installed family. Each load holds a `delayRender`; a bad family or weight cancels the render with the reason. The director may tune the theme; scenes read colors and fonts only from it.

**Components**: `Logo` (`template/src/components/Logo.tsx`): `<Logo variant?="default" | "onDark" | "onLight" height? style? />`, falls back to `logo.path`, renders nothing when the file is missing (the composition's `calculateMetadata` probes the files). The optional kinetic kit in `template/src/components/kinetic/`: `Backdrop` (`black` / `deep` / `brand` / `neutral` / `light`), `KineticText`, `SlamIn`, `SnapIn`, `FadeUp`, `Typewriter`, `StampWords`, `Shake`, `BeatPulse`, `Flash`, `DrawPath`. Entrances take `at` / `exitAt` in absolute song frames and render nothing before `at`.

**Scenes** (`template/src/scenes/`): `types.ts` defines `SceneComponent = (props: {section: PlacedSection}) => ReactNode`. `registry.ts` exports `SCENES` (scene key → component), `DEFAULT_SCENE` (plays any key missing from `SCENES`; the template sets it to `Placeholder`), and `resolveScene(key)` (throws naming the key and the known keys when there's no component and no default). The composition (`template/src/MusicVideo.tsx`, id `MusicVideo`) renders each section in `<Sequence from={section.from} durationInFrames={section.durationInFrames}>`, so `useCurrentFrame()` inside a scene is section-relative; sync to the song with the hooks above. When the scenes are built: register every key `sections.json` uses, delete `Placeholder.tsx`, set `DEFAULT_SCENE = null`.

### Timing contract

- **Frames, not seconds.** Convert once with `Math.round(seconds * fps)` and compare integers. Assign beats, downbeats and events to sections by rounded frame (`beatFramesBetween` does), never by comparing seconds: a beat at 12.016 s belongs to the section whose frame range holds frame 360.
- Sections tile `[0, durationInFrames)` exactly: each runs from its rounded start to the next one's. With an analyzed track, a section starting at or after the end stops the render with its id (sections.json is stale); on the 60 s fallback timing such sections are dropped.
- Lyric and section times in the JSON are seconds from the start of the track; hooks expose them as absolute frames.
- Deterministic only: everything derives from the frame. No `Date`, no `Math.random()` (use Remotion's `random(seed)`), no network at render time beyond the font load.

## Gotchas

- **Render only via `pnpm render`.** Remotion 4.0.527 encodes AAC with libfdk to raw ADTS and stream-copies it into the MP4; ADTS can't carry the 2048-sample encoder priming, so a plain `remotion render` MP4 plays the audio 42.7 ms late. The wrapper renders PCM-16 into an intermediate MKV, then ffmpeg's native AAC writes the MP4 (with an edit list) and `-video_track_timescale 30` restores exact CFR from the MKV's millisecond timestamps. It refuses `--codec`, `--audio-codec`, `--separate-audio-to`, `--sequence` and `--output`.
- **`useSongFrame` is `Internals.useTimelinePosition()`**, a Remotion internal, which is why it's correct under any nesting. Remotion is pinned exactly; after any upgrade, run `pnpm test` (`tests/hooks.test.tsx` pins this behavior).
- **Frame, not seconds** when putting beats and events into sections (above).
- **Headless Chrome can't launch inside the Claude Code Bash sandbox** (mach-port denial). `pnpm still`, `pnpm render` and the composition's metadata step need the sandbox disabled for that command, or a run outside it. `analyze`, `align`, `preview` and `contact-sheet` don't use Chrome.
- **pip certificates.** In the sandbox, or behind a TLS-intercepting proxy, pip fails certificate checks; run `PIP_USE_DEPRECATED=legacy-certs pnpm setup:align` (and the same for `setup:audio`).
- **Model hosts.** huggingface.co, download.pytorch.org and similar hosts may be blocked, so the alignment uses only k2-fsa/sherpa-onnx models from GitHub releases (Python 3.14 wheels; UVR vocal stem + parakeet TDT/CTC). They land in the project's `.cache/models` (~1.4 GB). Archives are deleted after extraction, and any leftover `*.tar.bz2` or `.cache/models/dl/` is deleted once every model is in place. To save the download for a second project, copy (don't symlink, if setup might run) another project's `.cache/models`.
- **Suno songs run long.** A song planned at 93 s came back at 131 s with extra instrumental sections. Section times come from `pnpm align`, never from the lyric plan. Check `creative/alignment/verification.json` `possibleUnlistedLyrics` and `transcript.json` for sung lines that aren't in the text, and listen before trusting them. Instrumental sections get visuals, not invented text.
- **Preview for chat.** Chat uploads cap at 30 MB; send `pnpm preview`'s file, never the full render. A Cadence file-store upload caps at 4 MB, which fits the contact sheet but not the preview.
- **Fonts.** Brand fonts are often commercial (Proxima Nova): check the licence or use a structurally similar Google family. Google families must exist in `@remotion/google-fonts` at the pinned version, with the listed weights.
- **On-screen copy** is lyrics, exact product feature names, and the logo. The pipeline never generates text; scenes must not invent taglines.
- **Stale analysis.** If the track changes and `pnpm analyze` isn't re-run, the render falls back to the 60 s grid and warns. Re-run `analyze`, then `align`, whenever the track changes.
