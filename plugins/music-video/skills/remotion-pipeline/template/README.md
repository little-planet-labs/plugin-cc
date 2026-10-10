# Music video

A beat-synced kinetic-typography music video, as long as the track, at 1920x1080 and 30fps (`src/pipeline.json`), built with [Remotion](https://www.remotion.dev/) 4.

This project holds the deterministic pipeline: audio analysis, lyric alignment, typed beat/energy/lyric hooks, a brand theme read from `src/brand.json`, an optional kinetic-typography kit, an optional motion kit (`src/components/motion`), and the render, draft (half scale), preview, contact-sheet, critique (labelled QA sheets), pops (pop and flash scan), beatmap (beat-map skeleton) and jitter (held-text shimmer) scripts. The scenes are the video's own: `src/scenes/` starts with one neutral placeholder that plays every section.

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
6. `pnpm beatmap`: a `creative/beatmap.md` skeleton (tempo, energy jumps, sections, one row per line) to plan the scenes against.
7. Build the scenes in `src/scenes/` and register them in `src/scenes/registry.ts`.
8. Draft rounds. Each round runs `pnpm draft --out out/draft-r<n>.mp4` (half scale), `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>`, `pnpm pops --in out/draft-r<n>.mp4 --cuts=<hard-cut frames> --fail` (the video's intended hard cuts), and the text-only check: `pnpm render --props='{"textOnly":true}' --out out/text-only.mp4`, then `pnpm jitter --all-lines --in out/text-only.mp4`.
9. Last: the master `pnpm render`, then `pnpm preview` (a 720p copy under 30 MB) and `pnpm contact-sheet` (one PNG of stills).

Requirements: Node 22.18 or newer, pnpm, Python 3.12+ for `setup:audio`, Python 3.14 for `setup:align` (its pins are tested there), `curl`, `tar`, and `ffmpeg` + `ffprobe` with libx264 on `PATH`. On the first render, Remotion downloads Chrome Headless Shell (~190 MB) into `node_modules/.remotion/`.

## Scripts

| Script | Does |
|---|---|
| `pnpm setup:audio` | Creates `.venv/` and installs the analysis pins. |
| `pnpm setup:align` | Creates `.venv-align/` (removed again if the install fails), installs the alignment pins, downloads the models from the k2-fsa/sherpa-onnx GitHub releases into `.cache/models/`, and deletes the archives after extracting them. Re-run it to resume an interrupted download. |
| `pnpm analyze` | Decodes the track with ffmpeg and writes `src/data/audio-analysis.json`. Re-run whenever the track changes. |
| `pnpm analyze:reset` | Restores the no-track default analysis (60 s, 120 BPM grid). |
| `pnpm align` | Aligns `creative/lyrics.screen.txt` to the track; writes `src/data/lyrics.json` and `src/data/sections.json`, plus diagnostics in `creative/alignment/`. Needs `pnpm analyze` first. `pnpm align calibrate` re-measures the model timing bias (macOS `say`). |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Checks. The tests cover the timing math, schemas, hooks under nesting, the scripts' cleanup, and the lyric and section logic of `pnpm align`. They pass both on the template and on a finished video: the placeholder-scene tests skip, with the reason, once `Placeholder.tsx` is deleted and `DEFAULT_SCENE` is `null`, and every scene key in `sections.json` must resolve. |
| `pnpm still` | One frame as a PNG: `--frame=<n>` (absolute frame) and `--out <path>` (default `out/still.png`), e.g. `pnpm still --frame=1200 --out=out/wip-1/f-1200.png`. `--composition=<id>` takes the frame from another composition. Other Remotion flags pass through as `--flag=value`. |
| `pnpm render` | The full video into `out/music-video.mp4` (`--out <path>`, `--frames=0-299`, other Remotion flags as `--flag=value`). `--composition=<id>` (or `--composition <id>`) renders another composition registered in `src/Root.tsx`, such as a concept round or an alternate cut, through the same codec path, into `out/<id>.mp4` unless `--out` is given. Every render checks the frame rate: the remux writes the video at `src/pipeline.json`'s `fps`, so an intermediate at any other rate (a composition with its own fps, `Config.overrideFps` in `remotion.config.ts`) stops the render before anything is written, and `--fps` / `--every-nth-frame` are refused up front. `--image-format=png` captures frames as PNG (see Gotchas). Always render through this script; see Gotchas. |
| `pnpm draft` | A half-scale draft (960x540 from 1080p) into `out/draft.mp4`: `pnpm render` with `--scale=0.5` added, through the same argument checks, frame-rate probe and audio-safe remux. `--out <path>`, `--frames=a-b`, `--composition=<id>`, `--props=<json>` and other Remotion flags pass through as in `pnpm render`. A `--scale` of your own and an `--out` that is the main video (`out/music-video.mp4`, any letter case) are refused. Per critique round: `pnpm draft --out out/draft-r<n>.mp4`. |
| `pnpm preview` | A 720p H.264 copy of the render, `out/music-video-preview.mp4`, sized for ~26 MB and refused at 30 MB (`--in`, `--out`). |
| `pnpm contact-sheet` | Stills from the final MP4 at every section start (+0.5 s) and the middle of sections of 12 s or more, tiled 4 across into `out/contact-sheet.png`; prints which tile is which (`--in`, `--out`, `--columns=<n>`). |
| `pnpm jitter` | Measures frame-to-frame motion of held text in a render: `pnpm jitter --from <start> --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]`, where `<start>` is a frame (`1236`) or seconds with an `s` (`41.2s`) of the MP4 being measured: on a full render that is the song frame; on a `--frames=<a>-<b>` render, which starts at frame 0, subtract `<a>` (or `<a>`/fps for seconds), e.g. `pnpm jitter --from=42.4s --frames=45 --crop=360,420,1200,240 --max=0.05` for a line whose last word is sung at 41.4 s. For each pair of frames it prints the sub-pixel shift (phase correlation), the shift of the bright-pixel centroid, and the mean pixel difference, then a summary. Start after the line's last word has settled (its start frame plus the spring's settle frames; about 1 s is safe), not at the line start: the entrance isn't held text. Pass is a summary mean shift of 0.01 px or less. `--max` exits non-zero when any single pair's shift is larger, so use it only as a loose guard (`--max=0.05`): a good render measured mean 0.008 / max 0.011 px with the earlier estimator, which read slightly high, and `--max=0.01` would have failed it. `--in` defaults to `out/music-video.mp4`. Needs `.venv` from `pnpm setup:audio` (numpy). `pnpm jitter --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--settle <frames \| preset>] [--exit-frames <n>] [--exit-stagger <n>] [--stagger <n>]` measures every line of `src/data/lyrics.json` over its hold window instead (not with `--from`/`--frames`); run it on the full-length text-only render, `pnpm render --props='{"textOnly":true}' --out out/text-only.mp4` (holds are song frames, so not on a `--frames` render). A line's hold runs from its last word's settle frame (last reveal − 2 + the `snappy` spring's settle frames, 15 at 30 fps; reveals are the sung word starts, at least 2 frames apart) to its first word's earliest exit start ((next line's first word − 2) − 9 − (words − 1) × 1 at 30 fps, i.e. `MaskedWords`' default 0.3 s exits 0.035 s apart). The last line holds until 1 s after its sung end, or the end of the video. Override `--settle` (frames, or `snappy` / `default` / `heavy` / `playful`), `--exit-frames`, `--exit-stagger` and `--stagger` for scenes that pass other `MaskedWords` props. Lines with a hold under 2 frames are skipped and listed; a frame with no pixel above 48 (of 255) is blank, so a hold ends at its first blank frame and one that starts blank is skipped and listed. It prints each line's mean and max shift and `lines with motion during hold: N` (mean shift over 0.01 px); `--max <px>` exits non-zero when any line's largest single-pair shift is over it. |
| `pnpm critique` | QA contact sheets for a critique round into `out/critique/<tag>/`: `pnpm critique --tag <name> [--in <mp4>] [--strips=<s,…>] [--overview-every=2] [--phone-every=4]`. `overview_NN.png`: a frame every 2 s from frame 0, 270 px wide, 6×5 per sheet. `phone_NN.png`: a frame every 4 s, 360 px wide, 5×3 (legibility at phone size). `strip_SSSS.SS.png` (e.g. `strip_0012.40.png`): 12 consecutive frames from `round((t − 0.1) × fps)`, 320 px wide, 6×2, for every lyric line start and section start, or the seconds in `--strips`; a strip at t < 0.1 s starts at frame 0, one that runs past the end is cut short and one past the end is skipped, each with a message. Every tile is labelled with its time and frame (`0:12.40 f372`). Frames are picked by index in one decode per sheet kind, never by seeking. The tag is one path segment (letters, digits, `.`, `_`, `-`). A rerun of a tag replaces its sheets and removes ones it no longer makes; a failed run changes nothing. `--in` defaults to `out/music-video.mp4`. Needs `.venv`. |
| `pnpm pops` | Lists pop spikes and one-frame flashes, with frame and time: `pnpm pops [--in <mp4>] [--cuts=<frame,…>] [--ratio=3] [--fail]`. On 180×180 gray frames, with `d[i]` the mean absolute difference between frames `i` and `i+1`, a pop is `d[i]` over `ratio` × the larger of its neighbours (at least 0.3) and over 2, reported at frame `i+1`, the first frame of the new picture; a flash is a frame that differs from both neighbours (both differences over 2) while they look alike (their difference under 0.35 × the smaller). `--cuts` names intended hard cuts by their first frame; a pop within ±1 frame of one is listed as that cut instead of as a finding. Flashes are always findings. `--fail` exits 1 when anything other than a listed cut is found. `--in` defaults to `out/music-video.mp4`. Needs `.venv`. |
| `pnpm beatmap` | Writes `creative/beatmap.md`: tempo, beat and bar length; candidate drops (the three bands averaged, a rise of 6 dB or more between the second before and the second after a frame) and candidate accents (per band, 0.1 s windows, 12 dB or more, the 24 largest), with frames and seconds (energy 0..1 spans 48 dB per band); a note that key changes can't be detected from band energy; the sections with frames; one row per lyric line (id, frames, seconds, text, and empty world, transition in, text exit and one-off accent columns); and a WorldLayer / LyricLayer list to fill in. The same data always gives the same file. It won't replace an existing `creative/beatmap.md` without `--force`. |

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
| `creative/beatmap.md` | `pnpm beatmap`, then you | The beat-map skeleton: tempo, energy-jump candidates, sections and one row per lyric line with empty columns to fill in. `pnpm beatmap` won't replace it without `--force`. |
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

The optional kit in `src/components/kinetic`: `Backdrop` (`black`/`deep`/`brand`/`neutral`/`light`, with an energy-reactive glow), `KineticText`, `SlamIn`, `SnapIn`, `FadeUp`, `Typewriter`, `StampWords`, `Shake`, `BeatPulse`, `Flash`, `DrawPath`. Entrances take `at` / `exitAt` as ABSOLUTE song frames (e.g. `useLine('chorus-1-2').wordFrames[0].start`) and render nothing before `at`. `BeatPulse` is a rhythmic pulse on every beat; it is off by default on slow songs without heavy beats unless the brief asks for it, and `useEnergySwell` gives smoothed movement instead.

The optional motion kit in `src/components/motion` (ABSOLUTE song frames throughout; colours from the theme, sizes from the composition):

- **Two layers.** Put everything that isn't the lyric in `<WorldLayer>`: backdrops, shots, the camera scale from `useShotCamera`, `SubframeBlur`, `ShotTimeline`, `Shatter`, `CircleFlood`, grain. Put the lyric (`MaskedWords`) in `<LyricLayer>`, rendered as a sibling after `WorldLayer`, never inside it: it sits above the world and no camera, blur or transition reaches it. Neither layer takes a transform, filter, clip or opacity in `style`. With the input prop `textOnly` true (`useTextOnly()`, read through `getInputProps()`; `TextOnlyContext` overrides it in tests), `WorldLayer` draws plain black instead of its children and the lyric draws as usual.
- **`MaskedWords`** (`<MaskedWords id="verse-1-2" accent? range? stagger? preset? exit? exitFrames? exitStagger? exitBy? until? seed? />`): lyric words rising out of masks on their sung frames, with room for descenders, balanced wrapping, and no transform, filter or opacity once settled until the word's exit starts. `exit` is `'fade'` (default), `'up'`/`'down'` (inside the mask), `'left'`, `'right'`, `'scatter'`, `'fall'` (both seeded by `seed`, default the line id), `'blur'`, `'shrink'`, `'cut'` (the whole line at once) or `{suckTo: [x, y]}` (px in the line block's own box, `[0, 0]` its top-left). The line renders nothing from E = min(next line's first word − 2 frames, `exitBy`, `until`) (`until` is the older name for `exitBy`); each word's exit (`exitFrames`, default 0.3 s, `exitStagger` apart, default 0.035 s) finishes by E, starting as late as it can and never before the word is revealed. A short hold compresses the exit; with no room at all it becomes a cut at E. Pass `exitBy` to clear a line ahead of a wipe edge.
- **`ShotTimeline`** (`shots`, `end?`): world shots `{id, from, Component, in?}` on absolute frames, each whole from its `from` to the next shot's; an `in` transition (`cut`, `wipe` with `angle` and blade `edge`/`edgeWidth`, `diagonal`, `bars` with `count` 5–9 and `stagger` seconds, `iris` with a colour ring, `zoom`, `whip`, `slices`, `split`, `burn`) runs over the frames before its shot's `from` with both shots rendered live. Shots must be sorted (it throws naming the id); nothing renders before the first shot. Shot components get `{start, from, to}`. `shotWindows` and `shotAt` are the pure versions.
- **`useShotCamera(from, to, z0 = 1.08)`**: the world camera scale, settling in log space from `z0` at `from` (the shot's `start`) to exactly 1 at `to`. Scale a wrapper inside `WorldLayer` with it, never the lyric.
- **`SubframeBlur`** (`window={[from, to]}` half-open, `samples?` 3–6, default 4, `shutter?` 0.5): motion blur for world content around a transition, N samples centred on the frame and clamped into the window (pass the shot's or transition's range so no sample crosses a cut), averaged with plain opacity; one plain render outside the window, with the same element structure so nothing remounts at the edges. Each sample's visuals are the unblurred render at its fractional frame (`useCurrentFrame()` and nested Sequences included). Only visuals are sampled: sound inside it is muted in the window, so audio and video sound go outside it. `subframeSamples` gives the sample frames.
- **`Shatter`** (`at`, `x?`, `y?`, `seed?`, `flash?`, `flashPeak?`): breaks the world children into 64 seeded shards that cover the frame at impact and fly out under gravity, with a short flash. `buildShards` is the pure shard list.
- **`CircleFlood`** (`at`, `frames`, `x?`, `y?`, `color?`, `easing?`, `contractTo?`, `ring?`): a circle wipe that clears the farthest corner; `contractTo: {x, y, at, frames}` shrinks it back to radius 0 at a target point by `at + frames`, and `ring: {color, width}` leads the edge. A flood meant to be mostly full on a hit wants `EASE_OUT` over about 0.3 s, starting about 0.2 s before the hit.
- **Helpers.** `springSettled(frame, at, fps, preset?)` (0 before `at`, exactly 1 from `at + settleFrames(fps, preset)`; `SPRING_PRESETS` snappy 320/30, default 170/26, heavy 120/24, playful 180/12), `Scrim` (one feathered backing behind a text block), `Grain` (seeded per frame, no blend mode; in the world, below the text), `useEnergySwell(opts?)` (low/mid energy smoothed over two bars, no beat ripple), `logZoom(frame, from, to, z0, z1, easing?)`, `EASE_CAM` and `EASE_OUT`.

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

- **Always render through `pnpm render`.** Remotion 4.0.527 encodes AAC with libfdk to raw ADTS and stream-copies it into the MP4, which loses the 2048-sample encoder priming: a plain `remotion render … .mp4` plays the audio ~42.7 ms late. The wrapper renders PCM-16 into an intermediate MKV, then ffmpeg's AAC writes the MP4 with an edit list, and `-video_track_timescale 30` makes the video exact CFR. `--codec`, `--audio-codec`, `--separate-audio-to`, `--sequence` and `--output` are refused, and so are `--fps` and `--every-nth-frame` (they change the frame rate the remux relies on; `--width`, `--height`, `--scale` and `--duration` are fine). That holds for every composition: render extra ones (concept rounds, alternates) with `pnpm render --composition=<id>`, never with a side tool that copies these steps.
- **Text-heavy masters: `pnpm render --image-format=png`.** Frames are captured as JPEG by default (`remotion.config.ts`), which adds ringing around high-contrast type. The flag goes straight to Remotion and overrides the config; it works with the wrapper's h264 encode. In one 4:23 video it rendered about 50% slower and gave a ~650 MB master, so use it for the final render, not for test renders.
- **Held text that shimmers.** Springs that haven't settled, beat-punch scaling and grain over type make held lyrics wobble by fractions of a pixel, and viewers see it. Check a held line with `pnpm jitter` over a crop around the text, starting after its last word has settled (about 1 s after that word's start frame), not at the line start (`--from` is a time or frame of the MP4 being measured, so on a `--frames=<a>-<b>` render subtract `<a>`). Pass is a summary mean shift of 0.01 px or less, with a small, steady diff; keep `--max` loose (e.g. `0.05`), since it gates the largest single pair. A diff that pulses with no shift points at scaling or grain.
- **Text-only render: pass `--out`.** `pnpm render --props='{"textOnly":true}' --out out/text-only.mp4` draws the lyric alone on black; without `--out` it overwrites the main video, `out/music-video.mp4`. Use the `--props=<json>` form. `pnpm jitter --all-lines` needs this render: on the full render, world motion behind the text reads as the line moving.
- **Run `pnpm pops --in out/draft-r<n>.mp4 --cuts=<hard-cut frames> --fail` on every draft round** (and on the master if you like), with the video's intended hard cuts in `--cuts`. A layer that appears a frame early, a transition a frame off, or a stray frame of the wrong shot shows up as a pop or a flash.
- **Critique labels exist only on the QA sheets** that `pnpm critique` writes. Nothing in the video itself carries a label.
- **A draft is half scale.** Judge timing, motion and composition on `pnpm draft` output, not fine type or shimmer; check those at full scale.
- **The QA scripts load `src/lib` and `springs.ts` directly** (Node's built-in type stripping, Node 22.18+), so the data checks, word timing and spring settle frames match the composition's. Keep `src/lib/lyrics-schema.ts`, `sections.ts`, `analysis-schema.ts`, `lyric-timing.ts` and `src/components/motion/springs.ts` free of runtime imports other than `remotion` (use `import type`).
- **Keep the lyric out of camera, blur and transition wrappers.** A whip that slides the frame, a zoom that scales it and an iris that covers it must not take a held line with them: `MaskedWords` goes in `LyricLayer`, the camera, `SubframeBlur`, `ShotTimeline` and `Shatter` in `WorldLayer`.
- **`SubframeBlur` only on world content, inside a window that doesn't cross a cut.** Averaged copies of text smear. Wrap a full-frame shot. Sound inside it is muted for the whole window and drops out of the render's mix: put `<Audio>` / `<Html5Audio>`, and any video whose sound you need, outside `SubframeBlur` as siblings. Don't build a blur from Remotion's `<Freeze>`: it zeroes the Sequence offsets inside it, so relative frames and nested Sequences shift by the section's start; `SubframeBlur` changes only the timeline frame.
- **No blend modes.** No `mix-blend-mode` and no `plus-lighter`: blended layers over transformed or clipped layers composite as grey slabs in headless Chrome. The kit averages and glows with plain opacity.
- **Frames, not seconds.** `useSongFrame()` is `Internals.useTimelinePosition()`, correct at any `<Sequence>` depth. It's an internal API: Remotion is pinned exactly (4.0.527, with `@remotion/*` at the same version); re-run `pnpm test` on any upgrade.
- **Suno songs don't follow the plan.** They run longer and add instrumental stretches and repeats. Take section times from `pnpm align`, never from the lyric plan; check `creative/alignment/verification.json` → `possibleUnlistedLyrics` and `transcript.json`, and listen. Instrumentals get visuals, not invented text.
- **Headless Chrome can't launch inside the Claude Code Bash sandbox** (mach-port denial). `pnpm still`, `pnpm render`, `pnpm draft` and anything else that opens Chrome need the sandbox off or an unsandboxed run. `analyze`, `align`, `preview`, `contact-sheet`, `jitter`, `critique`, `pops` and `beatmap` don't open Chrome.
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
creative/                lyrics (screen + sung), alignment diagnostics, beatmap.md
scripts/                 analyze, align (+ lyric_sections.py), setup-align, render, draft, still, preview, contact-sheet, jitter (+ jitter.py), critique (+ critique.py), pops (+ pops.py), beatmap; lib/cli.mjs, lib/qa.mjs
src/brand.json           brand tokens (placeholder until replaced)
src/theme.ts             theme from brand.json; fonts loaded at render time
src/pipeline.json        composition id, output name, fps, size, fallback length, audio paths
src/data/                generated data, defaults, timing overrides
src/lib/                 schemas, timing math, hooks, brand parsing, font loading
src/components/          Logo, kinetic/ kit, motion/ kit
src/scenes/              registry.ts, types.ts, Placeholder.tsx (replace it)
src/MusicVideo.tsx       the composition: audio, duration from the analysis, one Sequence per section
tests/                   node:test suites
out/                     renders, previews, stills, draft*.mp4, text-only.mp4, critique/<tag>/ sheets (git-ignored)
```
