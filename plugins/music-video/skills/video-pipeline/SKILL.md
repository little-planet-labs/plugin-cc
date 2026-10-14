---
name: video-pipeline
description: The deterministic kit behind every music video. A company-agnostic template that draws the video as a time-seeked HTML page, captures it frame by frame with Playwright's headless Chromium and encodes it with ffmpeg. Covers setup:env, fonts, audio analysis, lyric alignment, beatmap, the page engine and scene API (layers, lyric entrances and exits, transitions, hard cuts, blur windows, camera, shake, shatter), the brand theme, still, draft, the chunked render with its hard pool cap, and the QA scripts (critique, pops, still-test, jitter, preview, contact sheet). Covers pipeline.json and alternate pipeline configs (--pipeline, the scenes key, the vertical 9:16 config, master naming and protection), tailSeconds, the theme's short-side type scale and social safe area, pnpm clips and its clip list, pnpm posters, the data files, the timing contract and the gotchas (sandboxed Chromium, pip certificates, model hosts, AAC priming, the device-pixel-ratio trap, ffmpeg 8 colour tags, the 30 MB preview). Use when setting up a music-video project, running analysis, alignment, stills, drafts, renders or QA, or writing scene code against the page engine.
user-invocable: false
---

# Video pipeline

`template/` is a complete project that renders a beat-synced video for any song and any brand. The video is one HTML page (`index.html` plus `src/`) whose every pixel is a pure function of the song time `t`. `scripts/capture.py` opens it in headless Chromium, calls `window.__mv.seek(n / fps)` for frame `n`, screenshots it, and pipes the pixels to x264. The engine, the data, the render and the QA scripts are shared between videos. The scenes are not: each video gets its own, written by the director (see `music-video:scene-authoring`). The template ships one neutral placeholder scene so a fresh project renders end to end.

Paths below are relative to this skill's directory. `template/README.md` is the project's own short manual and goes with every copy.

The page engine and the capture method are adapted from howseen-ai/claude-motion-design (MIT License, Copyright (c) 2026 Howseen AI (Raphaël Aubry)). `template/NOTICE.md` lists the files with ported code, what each one took, and the full licence text. Keep it in every copy.

## Create a project

```sh
cp -R <this skill dir>/template <project dir>
cd <project dir>
pnpm setup:env      # checks ffmpeg/ffprobe (libx264, aac), .venv (librosa, numpy, pillow, playwright), headless Chromium
pnpm setup:align    # .venv-align/ (Python 3.14) + ~1.4 GB of alignment models in .cache/models
pnpm fonts          # after brand.json is filled: downloads its Google fonts into public/fonts/
```

- Copy with `cp -R` so the dotfiles (`.gitignore`) come along. Never run anything inside the plugin's `template/`; it must stay free of venvs, caches, `out/` and generated data.
- There are no npm dependencies and no lockfile. `pnpm install` isn't needed; pnpm only runs the scripts.
- `setup:env` checks that `ffmpeg` and `ffprobe` run and that ffmpeg has the `libx264` and `aac` encoders before it creates anything. It builds `.venv` from `python3.14` (falls back to `python3` with a warning), installs the pins in `scripts/requirements.txt` (librosa 1.0.0, numpy, pillow, playwright 1.63.0), then runs `playwright install --only-shell chromium` into the project's `.cache/ms-playwright` (about 195 MB, the headless shell only). A second run on a ready project downloads nothing. A venv it created is removed if the install then fails.
- `setup:align` downloads about 650 MB and runs for a few minutes the first time. It resumes an interrupted download and deletes the archives once extracted. It needs github.com; see Gotchas.
- `pnpm fonts` reads `src/brand.json` and needs network access. Renders never touch the network.
- Requirements on the machine: Node 22.18 or newer, pnpm, Python 3.14, `ffmpeg` and `ffprobe` with libx264 and aac (the colour tagging is written for ffmpeg 8), `curl` and `tar` for `setup:align`.

## The working order of a video

1. Brand. Fill `src/brand.json` and put the logo files under `public/brand/`, then `pnpm fonts`.
2. Lyrics. Write `creative/lyrics.screen.txt` (screen spellings) and `creative/lyrics.suno.txt` (sung spellings).
3. Track. Drop the song at `public/audio/track.wav` (or `track.mp3`; keep exactly one).
4. `pnpm analyze`: beats, downbeats, onsets and band energy into `src/data/audio-analysis.json`.
5. `pnpm align`: `src/data/lyrics.json` and `src/data/sections.json` from the lyrics and the track.
6. `pnpm beatmap`: writes `creative/beatmap.md`. Fill in its world, transition-in, text-exit and one-off accent columns before any scene code. Put the drop (the largest candidate drop) on the key visual moment, and land one-off moves on real musical events from the candidate lists.
7. Scenes. Build them in `src/scenes/` against the scene API below; `pnpm check` after each one.
8. Stills. `pnpm still --frame=<n> --out=out/wip-<pass>/f-<n>.png` at the beat map's moments (each section start and start + 8, each hit and hit + 2, each line's last word). Open every one with the Read tool and fix what's wrong before rendering any video.
9. Draft rounds, round `<n>` = 1, 2, ...:
   - `pnpm draft --out out/draft-r<n>.mp4`
   - `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>`, then score the sheets (QA below)
   - `pnpm pops --in out/draft-r<n>.mp4 --cuts=auto --fail`
   - `pnpm still-test` (the engine's held-text check; no render needed)
   - `pnpm render --textonly --scale=1` (1080p, `out/<outputName>-textonly.mp4`), then `pnpm jitter --all-lines`. Plain `--textonly` takes `render.scale` 2: the whole song at 4K in PNG, hours and gigabytes per round.
   - fix, and go again until the pass marks hold.
10. The master: `pnpm render` writes `out/<outputName>.mp4` (3840x2160).
11. `pnpm preview`: a 720p copy under 30 MB for chat.
12. `pnpm contact-sheet`: one PNG of stills from the master.
13. Optional versions: the vertical 9:16 cut (`--pipeline=src/pipeline.vertical.json` on the steps above, with its own registry), `pnpm clips` for the shorts, and `pnpm posters` for the cover posters. See Pipeline configs, Clips and Posters.

## Scripts

All are in `template/package.json`, implemented in `template/scripts/`. Every Node script runs through `scripts/lib/cli.mjs`: a bad argument prints `<script>: <message>` and exits 1; temp files are registered before they exist and removed on success, failure and Ctrl-C/SIGTERM (exit 130/143; children get the signal and 5 s before SIGKILL); outputs are written under a temp name and renamed into place only when complete. Render and draft flags take `--flag=value` or `--flag value`; a repeated or unknown flag is refused. The QA scripts take both forms too, and a value may not start with `-`. `still`, `draft`, `render`, `preview`, `contact-sheet`, `critique`, `pops`, `still-test`, `jitter`, `check`, `beatmap` and `clips` also take `--pipeline=<config>` (Pipeline configs); without it every script uses `src/pipeline.json`.

| Script | CLI | Does, defaults, outputs |
|---|---|---|
| `setup:env` | `pnpm setup:env` | See Create a project. Takes no arguments. |
| `setup:align` | `pnpm setup:align` | `.venv-align/` from `python3.14` (falls back to `python3` with a warning), `scripts/requirements-align.txt`, then `align_lyrics.py fetch-models` into `.cache/models`. Removes a venv it created if the install fails. |
| `fonts` | `pnpm fonts` | Every `source: "google"` family and weight in brand.json from the Google Fonts CSS2 API, every unicode-range subset, as `public/fonts/<family>-<subset>-<hash>.woff2`, plus the manifest `public/fonts/fonts.json`. All-or-nothing through a temp folder; files the new manifest no longer lists are removed. `MV_FONTS_BASE` overrides the API base. |
| `analyze` | `pnpm analyze` | Validates `src/pipeline.json`, then ffmpeg decode and librosa analysis of the one track in `audioCandidates` → `src/data/audio-analysis.json`. Fails when no track or more than one exists. |
| `analyze:reset` | `pnpm analyze:reset` | Restores `audio-analysis.default.json` (no track, 60 s, 120 BPM). |
| `align` | `pnpm align [calibrate]` | Forced alignment → `src/data/lyrics.json`, `src/data/sections.json`, diagnostics in `creative/alignment/`. `calibrate` re-measures the model bias. Needs `pnpm analyze` first. |
| `beatmap` | `pnpm beatmap [--force]` | Writes `creative/beatmap.md` from the timing in effect: tempo, beat and bar length; candidate drops (the three bands averaged, rise of 6 dB or more over 1 s windows); candidate accents (per band, 12 dB or more over 0.1 s windows, at most one per band per 0.5 s, the 24 largest); a note that key changes can't be read from band energy; the sections with frames; one row per lyric line with empty world / transition in / text exit / one-off accent columns; World layer and Lyric layer headings. Rise = change in mean energy × 48 dB. Byte-identical for the same data. Refuses to replace an existing file without `--force`; writes through a temp file. With no track and no analysis it writes the fallback grid with a warning; on fallback timing for any other reason it stops and names `pnpm analyze`. Prints the project warnings. |
| `check` | `pnpm check [--scenes=<module>]` | No browser. Every data file parses and the timing resolves (warnings printed); the scene registry loads in Node and every sections.json scene key resolves; the page source (`src/**`, `index.html`) is scanned for clocks and blending (see The page). Prints `file:line: what` per finding and exits 1 on any. |
| `serve` | `pnpm serve [--port <n>]` | Static server for the interactive preview at `http://127.0.0.1:8770/index.html` (default port 8770). Serves only project files under the containment rule (Data files), with Range support so the audio scrubs. Ctrl-C stops it. |
| `still` | `pnpm still [--frame=<n> \| --t=<seconds>] [--scale=<s>] [--textonly] [--scenes=<module>] [--out <png>]` | One frame as a PNG, captured exactly as the render captures it (blur windows included). Default frame 0, scale 1 (1920x1080), `out/still.png`; folders are created. `--frame` is the absolute frame; `--t` takes the nearest frame, `round(t × fps)`; not both. `--scale=2` gives the master's 3840x2160. |
| `draft` | `pnpm draft [--out <mp4>] [--pool=<n>] [--chunk-seconds=<s>] [--frames=<a>-<b>] [--scenes=<module>]` | `render`'s own pipeline with `pipeline.json` `draft` settings: 960x540 (scale 0.5), one capture per frame (no motion blur), JPEG captures, CRF 23, veryfast. Default `out/draft.mp4` (`out/draft-frames-<a>-<b>.mp4` with `--frames`). An `--out` that resolves to the master is refused. |
| `render` | `pnpm render [--out <mp4>] [--scale=<s>] [--crf=<n>] [--preset=<name>] [--pool=<n>] [--chunk-seconds=<s>] [--frames=<a>-<b>] [--textonly] [--scenes=<module>]` | The master. Defaults from `pipeline.json` `render`: scale 2 (3840x2160), CRF 17, preset medium, pool 2, 20 s chunks, PNG captures. Outputs: `out/<outputName>.mp4`; `--textonly` → `out/<outputName>-textonly.mp4`; `--scenes` → `out/<module basename>.mp4` (`out/<module basename>-textonly.mp4` with both); `--frames=a-b` (inclusive; one frame as `--frames=a`) adds `-frames-<a>-<b>` to whichever default applies. Text-only, alternate-scenes and partial (`--frames`) renders refuse an `--out` that resolves to the master; only a full plain render may write it. Every render writes `<video>.manifest.json` next to the video. `--pool` above 2 prints a warning; below 1 is refused. See The render. |
| `preview` | `pnpm preview [--in <mp4>] [--out <mp4>] [--pipeline=<config>]` | 720p H.264 High + AAC 128k, two-pass, video bitrate computed from the duration to land near 26 MB. "720p" is the short side: a 16:9 input previews at 1280x720, a 9:16 one at 720x1280. Default in = the config's master, out = `<in>-preview.mp4` (`out/<outputName>-preview.mp4`). Fails rather than write a file of 30 MB or more, and refuses a video too long for 300 kbit/s of video in that budget (about 8 minutes). Never overwrites the master. |
| `contact-sheet` | `pnpm contact-sheet [--in <mp4>] [--out <png>] [--columns=<n>] [--pipeline=<config>]` | Stills from the finished video at every section start + 0.5 s (or the section's middle if it is shorter) and at the middle of every section of 12 s or more, 480 px wide, 4 across → `out/contact-sheet.png`. Prints the legend (tile, time, section). On a partial render it follows the manifest's `firstFrame`. Default in = the master. |
| `critique` | `pnpm critique --tag <name> [--in <mp4>] [--strips=<s,...>] [--overview-every=2] [--phone-every=4]` | QA sheets in `out/critique/<tag>/`: `overview_NN.png` (a frame every 2 s, 270 px tiles, 6×5), `phone_NN.png` (every 4 s, 360 px, 5×3), `strip_SSSS.SS.png` (12 consecutive frames from `round((t − 0.1) × fps)`, 320 px, 6×2; clamped at 0, cut short at the end with a message, skipped past it). Strips default to every lyric line start and section start; `--strips` replaces them with seconds. Every tile is labelled `m:ss.cc f<frame>`. Frame-exact (decoded once per sheet kind, frames kept by index). `--tag` must match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. The tag directory is built aside and swapped in whole; a failed run leaves it as it was. Default in = the master. |
| `pops` | `pnpm pops [--in <mp4>] [--cuts=<frame,...>\|auto] [--ratio=3] [--fail]` | Pop spikes and one-frame flashes. Every frame decoded to 180×180 gray, `d[i]` = mean \|f[i+1] − f[i]\|. Pop at frame i+1 when `d[i] > ratio × max(d[i−1], d[i+1], 0.3)` and `d[i] > 2`. Flash at frame n when `min(d[n−1], d[n]) > 2` and mean \|f[n+1] − f[n−1]\| `< 0.35 × min(d[n−1], d[n])`. A listed cut excuses a pop within ±1 frame, never a flash. `--cuts=auto` reads the cuts from `<video>.manifest.json`; a missing sidecar is an error naming it, and one whose frame count or fps doesn't match the video is refused as stale. `--fail` exits 1 on any unexcused finding. Frames are the video's. Default in = the master. |
| `still-test` | `pnpm still-test [--scale=2] [--lines=<id,...>] [--samples=3] [--scenes=<module>]` | Held-text check on the page itself, no render: opens it text-only through `Capture` and, for every word of every line, captures `--samples` frames (at least 2) spread over the word's own hold window `ceil(settled × fps)` .. `ceil(exitStart × fps) − 1` (every frame of a shorter window), with every other line and word hidden, and compares them pixel for pixel. Any difference is motion. See QA for the output and pass mark. |
| `jitter` | `pnpm jitter --from <frame \| seconds>s --frames <n> [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>]` | Sub-pixel motion of one held picture in a rendered video: per consecutive pair, the phase-correlation shift, the bright-pixel centroid shift (pixels above `--threshold`, default 225) and the mean pixel difference. `--from` is a frame of the video, or seconds with an `s` suffix; `--frames` at least 2. `--max` exits 1 when any pair's shift is larger. Default in = the master. On a partial render, `--from` is a frame of that file (page frame − a). |
| `jitter --all-lines` | `pnpm jitter --all-lines [--in <mp4>] [--crop x,y,w,h] [--max <px>] [--threshold <0-255>] [--scenes=<module>]` | Every line over its line-level hold window from the page's own `lines()`, mapped through the manifest's `firstFrame` and clipped to the rendered range. Default in = `out/<outputName>-textonly.mp4`; warns when the input isn't text-only. A frame with no pixel above 48 is blank: a window ends at its first blank frame. Lines with a window under 2 frames, or with no line-wide hold ("words are held individually: use pnpm still-test"), are skipped and listed; lines outside a partial render are counted. Exits 1 when no line could be measured. Without a manifest, a video shorter than the page is refused. Can't be combined with `--from` or `--frames`. |
| `clips` | `pnpm clips [--pipeline=<config>] [--clips <json>] [--in <mp4>] [--out-dir <dir>]` | Frame-exact clips cut from a full master for social posts. See Clips. Default list = the config's own (`src/clips.<name>.json`), in = its master, out-dir = `out/clips/`. |
| `posters` | `pnpm posters` | The cover posters from the alternate registry `src/posters.js`, captured on the `src/pipeline.json` page at 1920x1080 and downscaled to 1280x720 into `posters/`, plus two review sheets. Takes no arguments. See Posters. |
| `draft:vertical`, `render:vertical`, `preview:vertical`, `clips:vertical` | `pnpm draft:vertical [flags]` and so on | `draft`, `render`, `preview` and `clips` with `--pipeline=src/pipeline.vertical.json` filled in. |
| `test` | `pnpm test` | The fast `node:test` suite (fakes, no Chromium; 589 tests). |
| `test:render` | `pnpm test:render` | Real Chromium and ffmpeg, serial (91 tests). Needs `pnpm setup:env` and an unsandboxed run. |

`scripts/capture.py` is the capture core under `still`, `render`, `still-test` and `jitter --all-lines`. It also runs on its own: `.venv/bin/python scripts/capture.py [--root DIR] [--scale S] [--textonly] [--scenes MODULE] [--pipeline CONFIG] [--format png|jpeg] (--frame N [--frame N ...] | --frames A,B,C | --frames A-B) [--out FILE | --out-dir DIR] [--info] [--json]`, and as an importable async `Capture(root, scale, textonly, scenes, fmt, pipeline)` (`pipeline` None means `src/pipeline.json`) with `open()`, `frame(n)` (a numpy uint8 RGB array) and `close()`. It serves the project to the page through Playwright request interception on a private origin (no server, no port); paths outside the project or through a dot-folder get 404, and every other origin is aborted.

## pipeline.json

`src/pipeline.json` holds what the page and the scripts share. `analyze` validates it before decoding; every script that reads it fails naming a bad field.

| Key | Template value | Rule |
|---|---|---|
| `outputName` | `"music-video"` | The master is `out/<outputName>.mp4`. |
| `fps` | `30` | An integer dividing 150 (1, 2, 3, 5, 6, 10, 15, 25, 30, 50, 75, 150), so a frame is a whole number of samples at 22050 Hz (analysis) and 48000 Hz. |
| `width`, `height` | `1920`, `1080` | Page size in CSS px; even. |
| `fallbackSeconds` | `60` | Length of the no-track timing. |
| `tailSeconds` | absent (0) | Optional, 0 to 30. Seconds the video runs past the end of the song, over silence, so a closing move can finish. See The tail. |
| `scenes` | absent | Optional. The config's own scene registry, project-relative (`src/pipeline.vertical.json` names `src/scenes-vertical/index.js`). Absent means `src/scenes/index.js`. |
| `audioCandidates` | `["audio/track.wav", "audio/track.mp3"]` | Track paths relative to `public/`, in preference order. |
| `render` | `{scale: 2, crf: 17, preset: "medium", pool: 2, chunkSeconds: 20, shutter: 0.5, format: "png", audioBitrate: "256k", retries: 2}` | Master settings. `width × scale` and `height × scale` must be even integers. `shutter` in (0, 1] spreads blur samples over that fraction of a frame. `retries` = extra attempts per failed chunk. `format` stays `png` for masters: JPEG captures ring around high-contrast type. |
| `draft` | `{scale: 0.5, crf: 23, preset: "veryfast", format: "jpeg"}` | Draft settings; same even-size rule. |

`render` and `draft` are optional key by key; a missing key takes the default above. There is no composition id.

## Pipeline configs and the vertical version

A project can hold more than one config: `src/pipeline.json` (the default for every command, and always the one `analyze`, `align` and `posters` use) and any number of `src/pipeline.<name>.json` (`<name>` in lowercase letters, digits and hyphens; no other path is accepted). An alternate config must use the fps of `src/pipeline.json`, because the analysis and the lyric timing are made at it, and must have its own `outputName`. Everything else is its own: page size, tail, scene registry, render and draft settings.

- **Selecting one.** Pass `--pipeline=<config>` to the scripts listed under Scripts. The page takes `?pipeline=<config>` (`http://127.0.0.1:8770/index.html?pipeline=src/pipeline.vertical.json`).
- **Scenes.** A config's `scenes` key names its registry. `--scenes=<module>` still works with `--pipeline`: naming the config's own registry, or leaving it out, is that config's master render; any other registry is an alternate render, named after both on an alternate config (`out/<outputName>-<module basename>.mp4`), for example `--scenes=src/scenes/index.js` to see the landscape scenes on the vertical page.
- **Masters.** Each config's master is `out/<outputName>.mp4`. Every refusal that protects the master (drafts, text-only, alternate-scenes and partial renders, the preview, the clips) protects every config's master, so neither config's output can land on the other's.
- **Per-config outputs.** The preview is `out/<outputName>-preview.mp4`, the contact sheet `out/<outputName>-contact-sheet.png` for an alternate config, the text-only render `out/<outputName>-textonly.mp4`, and `beatmap --pipeline=<config>` with an alternate config writes `creative/beatmap-<outputName>.md`, so it never replaces `creative/beatmap.md`.
- **Before the registry exists.** On a fresh project, the vertical `check` fails with "scene registry src/scenes-vertical/index.js (the scenes of src/pipeline.vertical.json) does not exist; write it, or pass --scenes=<module> to use another", and the vertical `still`, `draft` and `render` with "scene registry src/scenes-vertical/index.js (the scenes of src/pipeline.vertical.json) does not exist; pass --scenes=<module> to use another". That's expected until the director writes `src/scenes-vertical/`.

**The vertical config.** The template ships `src/pipeline.vertical.json` for a 9:16 Instagram Reels and TikTok cut: a 1080x1920 page, 30 fps, an example `tailSeconds` of 0.3 that the lead sets per song (the Reels cap below), `"scenes": "src/scenes-vertical/index.js"` (each project writes that registry; `music-video:scene-authoring` covers it), `render.scale` 1 so the master is 1080x1920, drafts at 540x960, and `outputName` `music-video-vertical`. Its master is `out/music-video-vertical.mp4` and its preview 720x1280.

- **The Reels cap.** Instagram Reels takes up to 3:00. Set `tailSeconds` so the song plus the tail stays under 180 s: at 30 fps, `ceil((song + tail) × 30)` under 5400 frames. A song of 180 s or more can't be one Reel.
- **Type on a portrait page.** `theme.sizes` scale with the page's short side over 1080, so on the 1080x1920 page they're the same px as at 1920x1080 (84 px lyrics), not 1.78 times them. Lyric exit travel (`fall`, `scatter`, `left`, and the rest) scales the same uniform way, so a word moves the same distance as at 1920x1080.
- **Safe areas.** `safe.action` and `safe.title` are 5% and 10% of each side, so at 1080x1920 title-safe is 108 px left and right and 192 px top and bottom. `safe.social` adds the Reels and TikTok overlay (Theme). Lyrics, the logo and anything that must be read sit inside both `safe.title` and `safe.social`.
- **Render time.** In the Jira run, a 3-minute vertical master at scale 1 with real scenes took about 22 minutes at pool 2 and came to about 600 MB.

## The tail

`tailSeconds` runs the video past the end of the song so a closing move can finish. The video has `ceil((song seconds + tailSeconds) × fps)` frames, and every script uses that count: the page, `still`, `draft`, `render`, the QA scripts, `preview`, `contact-sheet`, `check` and `beatmap` (which adds a `Tail:` line).

- `ctx.duration` and `ctx.frames` are the end of the video, tail included. `ctx.audioEnd` (frame-aligned seconds) and `ctx.audioFrames` are the end of the song; with no tail they equal `ctx.duration` and `ctx.frames`. `window.__mv` has the same four.
- The tail belongs to the last section, which runs to the end of the video. No section may start in the tail; one that does is stale data. Draw the closing move in the last section's `draw` from `ctx.audioEnd` (or earlier) on.
- Lyrics are bound to the song: every line is gone by `ctx.audioEnd`, and lyric timings don't change.
- There are no beats in the tail, and `ctx.energy` is 0 there.
- The mux keeps the song exactly as before and appends digital silence, so the audio stream is as long as the video. A `--frames` range that reaches into the tail gets the same silence. The `pnpm serve` preview keeps playing through the tail after the track stops.

## Data files

| File | Producer | Shape |
|---|---|---|
| `src/brand.json` | brand research | `name`; `colors`: `background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted` (hex) and `neutral` (at least 3 steps; keys are step numbers such as `"50"`, `"500"`, `"900"`); `fonts.display` / `fonts.body`: `family`, `source` (`"google"` or `"local"`), `weights` (100..900), local only `files` (weight → path under `public/`); `logo`: `path`, optional `onDark`, `onLight`, each a path under `public/`. `"$comment"` is allowed. The template's copy is a marked placeholder. Schema with field-naming errors: `template/src/lib/brand.js`. |
| `public/fonts/` | `pnpm fonts` | `fonts.json` and the woff2 files for the Google families. Local families load from brand.json `files`. |
| `creative/lyrics.screen.txt` | lyricist | Suno-style tags and lines, screen spellings. Read by `pnpm align`. |
| `creative/lyrics.suno.txt` | lyricist | Same sections, lines and word counts, sung spellings. Used for the acoustic model only. |
| `public/audio/track.wav` (or `.mp3`) | the user | The song. Muxed untouched (see The render). |
| `src/data/audio-analysis.json` | `pnpm analyze` | `version` 1, `source` (track path relative to `public/`, or null), `generator`, `fps`, `durationSeconds`, `durationInFrames` (`ceil(durationSeconds × fps)`), `tempo`, `beatsPerBar`, `beats`, `downbeats` (a subset of beats), `onsets` (seconds), `bands`, `energy.{low,mid,high}` (one 0..1 value per frame). Schema: `template/src/lib/analysis.js`. |
| `src/data/audio-analysis.default.json` | committed | The no-track default: 60 s, 120 BPM, silent. |
| `src/data/lyrics.json` | `pnpm align` | `[{id, text, start, end, words: [{text, start, end}]}]`, seconds, sorted, non-overlapping, words join to `text`. `[]` in the template. |
| `src/data/sections.json` | `pnpm align` | `[{id, scene, start, variant?}]`, first `start` 0, strictly ascending. `[]` in the template, which plays one whole-song section (id and scene key `song`). |
| `src/data/timing-overrides.json` | by hand | `{}` or `{firstBeat?, lastBeat?, downbeats?}` (seconds; `downbeats` are bar anchors). Applied to the analysis in effect; doesn't move `sections.json`. |
| `creative/alignment/` | `pnpm align` | `transcript.json` (free ASR of the vocal stem), `verification.json` (cross-checks and `possibleUnlistedLyrics`), `align-words.json`. |
| `creative/beatmap.md` | `pnpm beatmap`, then the director | The beat map. |
| `src/pipeline.<name>.json` | the lead | An alternate pipeline config (Pipeline configs). The template ships `src/pipeline.vertical.json`. |
| `src/clips.<name>.json` | the director | The clip list for `src/pipeline.<name>.json` (`src/clips.json` for `src/pipeline.json`). See Clips. |
| `out/clips/<outputName>-clips.manifest.json` | `pnpm clips` | Every clip of that config with its slug, frame range and duration. |
| `src/posters.js`, `src/posters/` | the director | The poster registry and its scene modules. See Posters. The template ships one placeholder entry and a text-free placeholder scene, which the director replaces. |
| `posters/` | `pnpm posters` | `poster-<n>-<slug>.png` (1280x720), `posters-sheet.png`, `posters-small.png`. |
| `out/<video>.manifest.json` | `pnpm render`, `pnpm draft` | `{fps, frames, width, height, scale, textonly, cuts: [video frame], blurWindows: [{from, to, samples}], source, firstFrame}`. `firstFrame` is the page frame shown at video frame 0 (0 unless `--frames`); cuts and blur windows are video frames inside the rendered range; a draft lists no blur windows. |

The timing in effect comes from one function, `resolveProject` in `src/lib/project.js`, used by the page and by `scripts/lib/project.mjs` `loadProject`, so the page and the scripts always agree on the frame count:

- Audio is the analysed file when it is present, else the first present candidate, else silence.
- The analysis drives the timing (with `timing-overrides.json` applied, and a steady beat grid when it found no beats) when its `source` is the chosen file and its `fps` matches pipeline.json. A section starting at or after the end is then an error naming it.
- The analysed file missing with nothing else present: analysed timing, silent, with a warning.
- No analysis, a present file that isn't the analysed one, or an analysis at another fps: the fallback timing (`fallbackSeconds × fps` frames, a 120 BPM grid) with a warning. Sections and lyric lines that start past its end are dropped so previews still render. Every render refuses it when a track is present (see The render); with no track at all a render is silent on the fallback grid.
- Every render has `analysis.durationInFrames` frames. Frame `n` is the page at `t = n / fps` exactly.
- A file counts as present only when its real path (symlinks resolved) is inside the real project root with no segment starting with `.`. The server, the capture and `loadProject` all apply this rule.

## What `pnpm align` does with the lyrics

Implemented in `template/scripts/lyric_sections.py` (no audio dependencies; tested by `tests/align-text.test.mjs`):

- Section tags. A bracketed tag is a section when its first part (before `,` `:` ` - ` `(`) is a section kind as a whole or by its last word: intro, verse, pre-chorus, chorus, post-chorus, hook, refrain, bridge, breakdown, outro, end, instrumental, interlude, break, solo, drop, build. Everything else is a delivery cue and is ignored: `[Playful]`, `[Gang vocals]`, `[Female vocal, build]`.
- Section ids and scene keys. id = the kind in kebab case plus the tag's number (`verse-2`), or the occurrence for a kind repeated without numbers (`chorus-1`, `chorus-2`). `scene` = the kind in camelCase (`verse`, `preChorus`, `chorus`, `postChorus`, `bridge`, `outro`, `instrumental`, ...). A repeated kind gets `variant` `"1"`, `"2"`, ...
- Line ids. `<section id>-<n>`, numbered within the section. A line repeating an earlier line of the same section gets that line's id plus `-r2`, `-r3` (chorus "A / B / A / C" → `chorus-1-1`, `chorus-1-2`, `chorus-1-1-r2`, `chorus-1-3`).
- Sung respellings map back to screen spellings. Word i of a screen line is aligned with word i of the matching `lyrics.suno.txt` line, and `lyrics.json` keeps the screen text. Without the suno file, `creative/brief.json` `pronunciation {screen, sung}` is applied. A line whose word counts differ falls back to the screen spelling, with a warning. Parenthesized ad-libs are dropped; numbers must be spelled out in the sung file.
- Section starts snap to the detected downbeat nearest the first word, or 0.05 s before the word when that downbeat is later (a pickup).
- Instrumentals. Every stretch of 4 s or more without sung words becomes `{scene: "instrumental", variant: "lead-in" | "break" | "tail"}`, starting on the first downbeat after the last word. A line-less tag at that position (`[Instrumental]`, `[End]`) names it; otherwise `instrumental-<n>`.

Method, unchanged from the reference video: ffmpeg gapless decode; UVR-MDX-NET-Voc_FT vocal stem; NeMo parakeet-tdt-0.6b-v2 free transcript in ~15 s windows cut at the quietest vocal moments; CTC forced alignment of the known text with parakeet-tdt_ctc-110m at four 20 ms sub-frame offsets, averaged; CTC (−0.07 s) and TDT (+0.03 s) bias calibration, averaged where they agree within 0.35 s; phrase-final word ends follow the sung note by pYIN pitch continuity. It refuses to write if the analysis is the no-track default or its duration doesn't match the decoded track (within 0.05 s), and validates the same contract `src/lib` enforces before writing.

## The page and engine

`index.html` at the project root loads `src/engine/main.js`. Open it through `pnpm serve` (ES modules don't load from `file://`).

Layer stack, all `position: absolute` in `#stage`:

| Layer | z | Holds |
|---|---|---|
| `#world` | 1 | Every section's root (scenes, backdrops, camera, transitions, shatter, shake). |
| `#fx` | 2 | Grain and vignette, under the text. |
| `#txt` | 3 | Lyrics only, drawn by the engine from `ctx.lyric` registrations. |
| `#over` | 4 | The flash over everything. Off in text-only mode. |

Query flags: `render=1` (capture mode: no HUD, no audio, no clock), `textonly=1` (`#world`, `#fx` and `#over` hidden, stage black, lyrics as usual), `scenes=<project-relative .js or .mjs module>` (an alternate scene registry; default the config's `scenes`, else `src/scenes/index.js`), `pipeline=<config>` (an alternate pipeline config such as `src/pipeline.vertical.json`; default `src/pipeline.json`), `t=<seconds>` (preview start).

Preview HUD (`src/engine/preview.js`, loaded only without `render=1`): Space play/pause (with the track), Left/Right one frame, Shift+Left/Right 0.5 s, R back to the start, click the scrubber to seek, `?t=` deep-links. The HUD shows time, frame, bar and section.

`window.__mv` exists from the first script on; capture code waits for `ready || error`:

| Member | Meaning |
|---|---|
| `ready`, `error` | Boot finished, or the plain reason it failed (boot errors name the file, scene, section, line or window). |
| `warnings` | Boot warnings (fallback timing, a line or word that can never be shown, a missing logo, a local font weight without a file). |
| `fps`, `width`, `height`, `duration`, `frames`, `audio`, `timing` | The project in effect. |
| `seek(t)` | Draws the whole page at `t` seconds; a pure function of `t`. `window.seek` is an alias. |
| `subframes(n)` | The sample times for frame `n`: `[n / fps]` outside blur windows. |
| `cuts()` | Hard-cut times (seconds), sorted. |
| `blurWindows()` | `[{a, b, samples}]`, seconds. |
| `lines()` | Every registered line's schedule: `{id, first, settled, exitStart, exitEnd, next, words: [{index, text, reveal, settled, exitStart, exitEnd}]}`, seconds. A word is held over its own `[settled, exitStart)`; the line's `settled` and `exitStart` are the latest settle and earliest exit start over its words. Each word's mask is `[data-line="<id>"] .wm[data-word="<k>"]`. |

Determinism. Every frame must be the same however often and in whatever order it is seeked:

- Seeded randomness only: `ctx.rng(seed)` or `src/lib/rng.js` (mulberry32, `hash`, `noise1`, `fbm`).
- No `Date`, `performance.now`, `Math.random`, `crypto.getRandomValues`/`randomUUID`, `setTimeout`/`setInterval`/`requestIdleCallback`, `element.animate()`, and no `requestAnimationFrame` outside `src/engine/preview.js`.
- No CSS `transition`, `animation` or `@keyframes`, in stylesheets or set from script.
- No blend modes: `mix-blend-mode`, `background-blend-mode`, `plus-lighter`, and no canvas `globalCompositeOperation` other than `source-over` and the alpha-masking ops (`destination-in`, `destination-out`, `source-in`, `source-atop`, `destination-atop`).
- `pnpm check` scans `src/**` and `index.html` for all of these and prints `file:line`. The capture also kills CSS transitions and pauses animations after load, waits for `document.fonts.ready`, and waits two `requestAnimationFrame`s after every seek; those are a safety net, not permission.
- No network at render time. Fonts, images and the logo come from project files.
- Chromium runs with `--deterministic-mode --run-all-compositor-stages-before-draw --disable-threaded-animation --disable-checker-imaging --font-render-hinting=none --force-color-profile=srgb`.

## The scene API

A scene module default-exports `{setup?(ctx), draw(t, ctx), pre?, post?, cut?}`:

- `setup(ctx)` runs once per section that uses the scene, before the first frame, and may be async. Make elements and canvases, register lyric lines, declare the transition, cuts and blur windows here.
- `draw(t, ctx)` runs on every seek while the section is on screen. `t` is absolute song seconds. It must be a pure function of `t`: no state carried from one draw to the next.
- `pre` / `post`: seconds before the section start / after its end that `draw` already / still runs (default 0). A section draws over `[start − pre, end + post)`, widened to cover its own incoming transition and the next section's transition (`contractTo` included). The last section draws to the end.
- `cut: true`: every section of this scene starts with a hard cut.

Register scenes in `src/scenes/index.js`: `export const SCENES = {<scene key>: scene, ...}` and `export const DEFAULT_SCENE = scene | null`. One definition per `sections.json` scene key, instantiated once per section that uses it; repeats differ through `ctx.section.variant`. With `DEFAULT_SCENE` null, an unknown key fails boot naming the key, the section and the known keys. Scene modules must not touch the DOM at import time (`pnpm check` imports them in Node). When the scenes are built: register every key, delete `placeholder.js`, set `DEFAULT_SCENE = null`. How much the sections look alike or differ is the director's decision; the pipeline has no rule about it.

`src/scenes/placeholder.js` is the worked example: one world canvas with a brand gradient and an energy glow, a fade transition into every section after the first, every line registered, grain and vignette.

### ctx

| Member | Meaning |
|---|---|
| `section` | `{id, scene, variant, index, start, end, from, to, durationInFrames, rawStart}`. `start`/`end` are frame-aligned seconds, `from`/`to` frames, `rawStart` the sections.json time. |
| `fps`, `width`, `height`, `duration`, `frames` | The video, tail included. |
| `audioEnd`, `audioFrames` | The end of the song, frame-aligned seconds and frames; equal to `duration` and `frames` with no tail. |
| `render`, `textonly` | Capture mode; text-only mode. |
| `theme`, `brand`, `analysis` | Theme (below), parsed brand.json, the analysis in effect. |
| `beats`, `downbeats` | This section's beats and downbeats, chosen by rounded frame, as frame-aligned seconds. |
| `song.beats`, `song.downbeats` | The whole song's, frame-aligned. |
| `lines` | Lyric lines whose first word is sung in this section. `allLines`: every line in effect. |
| `root` | The section's own element in `#world`. |
| `state` | Free storage: setup writes, draw reads. |
| `beatAt(t)` | `getBeatState` at the frame of `t`: `beatIndex`, `phase`, `isOnBeat`, `isOnDownbeat`, `beatInBar`, `barIndex`, `beatDuration`. |
| `sinceBeat(t)`, `sinceDownbeat(t)` | Seconds since the latest beat / downbeat at or before `t`'s frame; `Infinity` before the first. Feed to `pulse(since, decay = 6)` from `src/lib/pulse.js` (1 on the event, exactly 0 below 0.002). |
| `energy(t, band = 'low', smoothFrames = 1)` | Band energy 0..1 (`'low'`, `'mid'`, `'high'`), interpolated between frames; 0 when silent. |
| `swell(t, {bars = 1, weights = {low: 0.4, mid: 0.6}})` | Slow 0..1 energy (a bar-long triangle filter, no beat ripple). |
| `frameTime(s)` | Seconds snapped to the frame grid. |
| `progress(t, t0, dur, ease = 'io')` | Eased progress: exactly 0 up to `t0`, exactly 1 from `t0 + dur`. |
| `rng(seed)` | A seeded PRNG unique to this section and seed. |
| `el(tag \| html, {z, style, className, text})` | An element in the section root (a tag is absolutely positioned at 0, 0). Make them in setup. |
| `canvas({z, width, height, x, y, offscreen})` | A device-pixel-ratio-aware canvas in the root (`offscreen: true`: detached, a shatter source). `.get()` returns its 2D context fully reset (pixels and all state) with the DPR transform set, in CSS px, on every call. The backing store exists only while the section is on screen. |
| `style(el, prop, value)` | Cached style write (cheap when unchanged). |
| `logo({variant = 'default' \| 'onDark' \| 'onLight', height = 96, x, y, z})` | The brand logo as an `<img>` (setup only). A missing file is a warning and the logo is hidden. |
| `lyric(id, style)` | Register a line (setup only). Below. |
| `transition(spec)` | This section's incoming transition (setup only, once). Below. |
| `cut(t = section start)` | A hard cut at `t`, frame-snapped (setup only). |
| `blur(a, b, samples = 4)` | A motion-blur window `[a, b)`, frame-snapped, 2..16 samples (setup only). |
| `camera(keys, ease)` | Keys `[[t, zoom, x, y], ...]` (times ascending, zoom > 0) → `t => {zoom, x, y}`; eased segments (default `'io'`), zoom in log space, held before the first and after the last key. |
| `applyCamera(el, k)`, `cameraOnCanvas(c2d, k)` | Apply a camera state to a full-page world element (pivot pinned to its top-left) or to a 2D context before drawing. |
| `shakeOffset(t, {at, amp = 14, dur = 0.45, freq = 16, rot = 0, seed})`, `shake(el, t, opts)` | Seeded shake, exactly 0 outside `[at, at + dur)`. |
| `shatter({at, x, y, seed, flash, flashPeak = 0.6})` | `{draw(c2d, sourceCanvas, t)}`: the source whole before `at`, then 64 seeded shards covering the frame at impact, flying out under gravity, with an optional flash. |
| `setFx({grain, vignette})` | Grain and vignette levels for this seek (0..1, plain opacity); reset before every seek. The grain pattern moves every frame. |
| `flash(t, {at, peak = 0.4, decay = 8, color})` | A flash on `#over`, over the text (off in text-only). For a flash under the text, draw it on a world canvas with `flashAmount` from `src/lib/pulse.js`. |

Camera, shake, shatter and transitions work on world content only; given an element inside `#txt` they throw.

Helpers to import directly: `src/lib/ease.js` (`EASE`: `linear`, `io`, `out`, `in`, `o5`, `i2`, `expo`, `sine`, `qio`, `cam` = cubic-bezier(.6, 0, .2, 1), `enter` = cubic-bezier(.2, .8, .2, 1); `ease`, `progress`, `clamp`, `lerp`, `inv`, `cubicBezier`; every easing is exactly 0 and 1 at its ends), `src/lib/springs.js` (`spring(t, at, spec)`, `springSettle`, presets `snappy`, `default`, `heavy`, `playful`, or `{freq, damping}`; damping below 0.72 is refused unless `{allowBounce: true}` is passed, and every spring lands on exactly 1 at its settle time), `src/lib/rng.js`, `src/lib/color.js` (`rgba`, `mix`, `hexToRgba`, `luminance`, `contrast`), `src/lib/pulse.js` (`pulse`, `flashAmount`).

### Lyrics: `ctx.lyric(id, style)`

Every sung line with words must be registered by exactly one scene; in render mode an unregistered line fails boot naming it (the preview only warns). Unknown style options, an unknown entrance or exit, a duplicate id, or an id not in `lyrics.json` fail boot naming the line. A registered line draws from its own schedule whichever section is on screen, so it may cross a section boundary.

Style options, all optional:

- Layout: `x`, `w` (default the title-safe inset and the width between the insets; on a portrait page, set them inside `safe.social` too), `y` (default page centre), `anchor` (`'center'`, `'top'`, `'bottom'`), `align` (default `'center'`), `breaks` (word indices that start a new row), `z`.
- Type: `font` (`'display'` default, `'body'`, or a CSS family), `size` (default `theme.sizes.lyric`, 84 px at 1080p), `weight` (default the theme's bold), `color` (default `theme.colors.text`), `lineHeight` 1.12, `letterSpacing` `'-0.01em'`, `balance` (default true), `italic`, `uppercase`, `css`, `wordCss(k, word)`, `accent` (word indices) with `accentColor` (default the theme accent).
- Entrance: `enter` = `rise` (default), `drop`, `slam`, `blur`, `fade`, `side`, `zoom`, `flip`, `type`, `none`; `enterDur` 0.42 s; `enterEase` `'o5'`; or `spring` (a preset or `{freq, damping}`) instead of the easing.
- Exit: `exit` = `fade` (default), `fall`, `up`, `down`, `blur`, `scatter`, `shrink`, `left`, `right`, `cut`, `suck` (into `suckTo`, default the block centre), or `{suck: [x, y]}`; `exitDur` 0.35 s; `stagger` 0.035 s between words.
- Timing: `exitAt` (seconds, or `'hold'`: as late as allowed; default the last sung word's end + `linger`), `linger` 1.0 s, `exitBy` (absolute seconds the line must be gone by), `pairWith` (the next line's id: both show together and clear for the line after), `lead` (reveal words this many seconds early, default 0).

Words appear on their own sung start, frame-snapped; the entrance clock starts one frame early so the reveal frame already shows the word. Each word sits in a mask with 0.4em of room above and at the sides and 0.45em below for descenders. From a word's settle time until its exit starts it is held: transform none, opacity exactly 1, no filter. The boot warns about a line or word that can never be shown and a word that would be on screen for one frame at almost zero opacity.

The exit rule: a line is gone at least 2 frames before the next line's first word (the line after its pair, with `pairWith`), by `exitBy`, and by the end of the video. The requested exit is kept when it fits (moved later if needed so every word gets its reveal frame); otherwise it is re-anchored to end on that bound after every word has settled; then exit length and stagger shrink together; with no room left the line cuts on the bound. No word's exit starts before its reveal.

### Transitions: `ctx.transition(spec)`

The incoming transition of this section, on its root. `at` defaults to the section start − `dur`, so the transition plays over the frames before the section starts and the section is whole on its first frame; `dur` defaults to 0.4 s, `ease` to `'cam'`. A transition that starts before the previous section starts fails boot. `blur: N` (2..16) adds a motion-blur window over its span.

| `kind` | Options |
|---|---|
| `cut` | A hard cut at `at` (dur 0). |
| `fade` | Opacity. |
| `circle` (alias `iris`) | `x`, `y` (default centre); grows to the farthest corner × 1.05. `ring: {color, width}` leads the edge; `contractTo: {x, y, at, dur, ease}` then shrinks it to radius exactly 0 at the target. |
| `wipe` | `from` = `left` (default), `right`, `top`, `bottom`; `edge: {color, width}` draws a blade on the edge. |
| `diagonal` | `slope` 0.35 (fraction of the width), `dir` = `right` (default) or `left`. |
| `bars` | `count` 5..9 (default 7), `stagger` 0.035 s (compressed so all finish at the end), `vertical`. |
| `whip` | `toward` = `left` (default), `right`, `up`, `down`; `blurPx` 20. Moves both sections. |
| `zoom` | `x`, `y`: the outgoing section zooms through that point while the incoming one settles in. |

### Hard cuts and blur windows

A hard cut is a section with `cut: true`, a `cut` transition, a `ctx.cut(t)`, and every section start with no incoming transition. `pops --cuts=auto` excuses exactly these.

`ctx.blur(a, b, samples)` declares where the master renders motion blur. Inside a window, frame `n`'s samples sit at `n/fps + (j − (N−1)/2) × shutter / (fps × N)`, `j = 0..N−1`, clamped into `[a, b − 1/fps]` and never across a cut; the captures are averaged exactly. Outside every window a frame is one capture. A hard cut strictly inside a window fails boot naming the window and the cut's source. Drafts never blur.

### Theme

`ctx.theme` (`src/engine/theme.js`, from brand.json, scaled to the page):

- `colors`: `background`, `surface`, `primary`, `primaryDeep`, `accent`, `accentAlt`, `text`, `textMuted`, `textOnLight`, `light`, `lightRaised`, `neutralDark`, `neutralDarkRaised`, `neutral`, `neutralScale`, `flash`, `black`.
- `fonts.display`, `fonts.body`: CSS stacks.
- `weights`: `light`, `regular`, `semibold`, `bold`, `extraBold`, snapped to the nearest loaded weight.
- `sizes` at 1080p: `lyric` 84, `lyricSmall` 72, `cinematic` 96, `hit` 200, `hitMax` 300. They scale with the page's short side over 1080, so a 1080x1920 page gets the same px as 1920x1080.
- `safe`: `title` {x: 192, y: 108}, `action` {x: 96, y: 54} at 1920x1080 (insets in px; 10% and 5% of each side on any page shape, so title is {x: 108, y: 192} at 1080x1920).
- `safe.social`: where Instagram Reels and TikTok draw their own UI over the video, `{top: 220, right: 160, bottom: 420, left: 64}` at 1080x1920 (the header row; the like, comment and share column; the caption, audio row and tab bar), scaled with the page on each axis. It's an estimate of those overlays, not an official figure, and the apps change them: check one real upload. On a portrait page, lyrics and the logo sit inside both `safe.title` and `safe.social`.

Scenes take colours and fonts only from the theme. Fonts load explicitly through `FontFace` before the page is ready: Google families from `public/fonts/fonts.json`, local ones from brand.json `files`. A missing face fails boot with "run pnpm fonts".

## Timing contract

- Times are absolute song seconds, snapped to the frame grid. `ctx.section.start`, beats, downbeats, word reveals, cuts and blur windows are all `k / fps` values. Frame `n` shows `seek(n / fps)`.
- Beats and downbeats belong to a section by rounded frame, never by comparing seconds: a beat at 12.016 s belongs to the section whose frame range holds frame 360. `ctx.beats` and `ctx.downbeats` already do this.
- Sections tile `[0, frames)` exactly: each runs from its rounded start to the next one's. Section times come from `sections.json`, never from the lyric plan.
- A transition plays before its section's start, over the end of the previous section. A section with no incoming transition starts with a hard cut.
- A lyric word appears on its sung frame. A line is gone 2 frames before the next line's first word.
- Draw from the frame-aligned times, never from a counter. Seeking backwards, skipping frames, or capturing frame 4000 first must give the same pixels.

## The render

`pnpm render` and `pnpm draft` share one pipeline (`scripts/render.mjs`):

1. Validate the flags and `pipeline.json`. Any render (full, draft, text-only, `--scenes`, `--frames`) is refused when a track is present but the timing in effect is the fallback (no analysis, an analysis of another file, or one at another fps); the error names the warnings and says to run `pnpm analyze`. A project with no track renders silent on the fallback grid. Then read the page's own frames, cuts and blur windows (`capture.py --info`). The page's frame count must equal the project's.
2. Split the frame range into chunks of about `chunkSeconds` that tile it exactly.
3. Run them through the pool: at most `pool` workers alive at once (default 2), starts staggered 1.5 s. Each worker (`scripts/render_chunk.py`) owns one headless Chromium and one ffmpeg and pipes rgb24 frames to x264; no frame touches the disk. A slot is held until the worker's whole process family is gone (process group, parent links, and an inherited `MV_PROCESS_FAMILY` token found with `ps -E`, so a re-parented Chromium is still counted) and its chunk is verified. A worker stops by itself if the orchestrator dies.
4. Verify each chunk by its decoded frame count. A failed or short chunk is deleted and retried alone, up to `retries` more times; then the render fails.
5. Concatenate the verified chunks (stream copy), count the frames again, mux the audio, and check frame count, size, `r_frame_rate = avg_frame_rate = fps/1` and the audio stream once more. Only then the video and its manifest are renamed into place.
6. The temp folder `out/.render-<pid>-*` (`out/.draft-<pid>-*`) is removed on success, failure and SIGINT/SIGTERM (exit 130/143). Temp folders of dead renders are swept at the next start.

Encode: H.264 High, yuv420p, `scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709` plus the `-color_*` tags, GOP 2 × fps, CRF and preset from pipeline.json or the flags. Level: a master takes the lowest level that fits its frame size and macroblock rate and allows at least 50 Mbit/s on High (1080p30 → 4.1, 2160p30 → 5.1); drafts and previews take the lowest fit (960x540 and 720p → 3.1). The VBV is capped at the level's limits.

Audio: ffmpeg's native AAC encoder (`render.audioBitrate`, 256k) encodes it in the final mux straight from the source file, with an edit list for the 1024-sample encoder priming. It is never stream-copied from an intermediate, never resampled, never loudness-normalised; the Suno audio goes out as it came. The source is always cut to the video's length, frames / fps (`-t`), starting at the range's first frame for a partial render (`-ss`); with a tail, digital silence follows the song so the audio stream is as long as the video. No `-shortest`. Measured lag against the WAV: 0.000 ms on a master, a partial range, a draft and a preview.

Outputs never collide: a draft, text-only, alternate-scenes or partial (`--frames`) render refuses an `--out` that resolves to the master (compared through symlinks and real paths, case-insensitively, and by device and inode), and a partial render's default name carries `-frames-<a>-<b>`, so it never replaces a full render of its kind. The preview refuses to overwrite the master too.

Measured timings (pool 2):

- Draft: 0.07 s per frame per worker. The full 4:23 reference song took 278 s.
- 1080p (`--scale=1`), placeholder scene on the reference song: 0.37 s per frame per worker, 0.44 s per frame overall on a 150-frame range. About 50 Mbit/s at CRF 17.
- 4K master, the same scene: 1.77 to 1.81 s per frame per worker, 1.13 s per frame of wall time (60 frames, 4 chunks). A full 4:23 song (7880 frames) is about 2.5 hours. About 90 Mbit/s at CRF 17 with the placeholder's grain, so about 3 GB for the song.
- Real scenes are slower than the placeholder, and every frame inside a blur window costs one capture per sample. Run master renders in the background.

Chromium also runs outside the pool: `still`, `still-test`, `jitter --all-lines` and the render's one page-info page (step 1) each open one Chromium at a time, never alongside the pool's workers.

## Clips

`pnpm clips` cuts short stand-alone clips from a finished full master, for social posts. A config's clip list is `src/clips.<name>.json` for `src/pipeline.<name>.json` (`src/clips.vertical.json` for the vertical config). `src/pipeline.json` has no list by default, so a landscape `pnpm clips` needs `--clips <json>`. A vertical `pnpm clips` before the director writes the list fails with "src/pipeline.vertical.json has no clip list: src/clips.vertical.json doesn't exist (write it, or pass --clips <json>)". Clips are cut from the full master: a partial render (its manifest's `firstFrame` isn't 0, such as the early look) is refused.

```json
{
  "fadeIn": 0.15,
  "fadeOut": 0.4,
  "clips": [
    {"slug": "first-chorus", "start": 10.553, "end": 50.6, "fadeOut": 0.25, "note": "verse-1 + chorus-1; why the edges sit where they do"}
  ]
}
```

- `slug` names the file: `out/clips/<outputName>-<slug>.mp4`.
- `start` and `end` are song seconds, each snapped to the nearest frame (`round(seconds × fps)`, the rounding the sections use, so a clip that starts on a section's start time starts on its first frame). The clip is frames `[start, end)`: `end` is the first frame not in it.
- `fadeIn` and `fadeOut` are audio fades in seconds (defaults 0.15 and 0.4). The file's top-level values replace the defaults, and a clip's own replace those. The picture cuts hard at both ends.
- `note` and `$comment` are free text: say what the first and last frame show.

Each clip is re-encoded frame-exactly from the master: H.264 High CRF 18 at a constant fps, the master's size, AAC 256 kbit/s 48 kHz, `+faststart`. Each is checked before anything is published: exactly `end − start` frames, `r_frame_rate` and `avg_frame_rate` equal to fps/1, and an audio stream as long as the video. `out/clips/<outputName>-clips.manifest.json` lists every clip with its frame range and duration. Everything is written in a temp folder inside the output folder and renamed into place only when every clip has passed.

Refused: a start not before its end after snapping, an end past the master's last frame, a master at another fps than the config, a partial render (its manifest's `firstFrame` isn't 0), a master without audio, and any output that is a master or the input. `--clips`, `--in` and `--out-dir` override the defaults.

Full-quality clips usually run over the 30 MB chat cap (55 to 110 MB for 25 to 47 s at 1080x1920 in the Jira run). `pnpm preview --pipeline=<config> --in out/clips/<file>.mp4` makes a 720x1280 copy for chat.

## Posters

`src/posters.js` is an alternate scene registry with the usual `SCENES` and `DEFAULT_SCENE`, plus `POSTERS`, the poster list: `[{n, slug, frame}, ...]`, each poster's number, slug (lowercase letters and digits joined by single hyphens) and the page frame that draws it. The poster scene picks what to draw from `t`: with poster k at frame 30 k on a 30 fps page, poster k is `t` in `[k, k + 1)`. `SCENES` is `{}`, so every section plays `DEFAULT_SCENE` and any frame can hold a poster. Its scene modules go in `src/posters/`. The template ships one entry, `{n: 1, slug: 'placeholder', frame: 30}`, with `DEFAULT_SCENE` set to `src/posters/placeholder.js`, a text-free scene that proves the capture works. Replace both: one `POSTERS` entry per poster, and your own poster scene as `DEFAULT_SCENE` (delete the placeholder).

`pnpm posters` captures each poster at its frame on the `src/pipeline.json` page (1920x1080, through `scripts/capture.py`, the capture path `pnpm still` uses), lanczos-downscales it to 1280x720 into `posters/poster-<n>-<slug>.png`, and builds two review sheets: `posters/posters-sheet.png` (every poster at 640 px, 2 across, or 1 across for a single poster, with as many rows as the count needs) and `posters/posters-small.png` (each at 360 px and 168 px wide, YouTube's phone and sidebar sizes). It takes no flags and always uses the `src/pipeline.json` page, which must be 16:9. The list is checked before Chromium launches: a missing `src/posters.js`, an empty list, a repeated `n`, slug or frame, a frame at or past the end of the video, or a slug that isn't lowercase letters and digits joined by single hyphens is refused, naming the problem. Like every capture, it needs `pnpm fonts` run first. Intermediates live in a temp folder under `out/`, removed on success, failure and Ctrl-C; the outputs are renamed into `posters/` only when all of them are complete. A successful run also removes each `posters/poster-<n>-<slug>.png` the new list no longer names, printing `posters: removed <path> (not in POSTERS)`, so the poster PNGs in `posters/` are exactly the current list. A failed run deletes nothing, and other files in `posters/` are left alone. It launches Chromium, so it needs the sandbox disabled.

A poster is a scene like any other: every sung line must be registered, so register them hidden (`ctx.lyric(line.id, {css: 'opacity:0'})`) and draw the poster's own words in the world. Those words follow the on-screen copy rules: the song title, sung lyrics, exact feature names, and the logo only as `brief.logoUse` allows.

## QA

Every QA script prints `<script>: <message>` and exits 1 on bad arguments or failure. Labels exist only on the QA sheets, never in the video.

Stills before video. Before the first draft, capture the beat map's moments with `pnpm still` and open each with the Read tool. Don't infer a frame from the code. A draft is 960x540: judge timing, motion and composition there, and check type, edges and thin lines on `pnpm still --frame=<n> --scale=2`.

Critique loop, once per draft round (and on the master if you like):

1. `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>`, then open every sheet: overview for rhythm and dead stretches, phone (360 px tiles) for legibility at phone size, strips for each line start and section start.
2. Score each section 1 to 10, as a harsh motion director and not as the author, on: legibility at 360 px; sync (hits on downbeats, words on their sung frames, the drop on the key visual moment); motion quality (eased or sprung moves, no linear drift, no dead frames where nothing but a held lyric moves for over a second); composition and safe areas; on-screen copy (only sung lyrics, exact feature names when sung, the logo); seams (cuts and transitions land clean).
3. Write the three worst problems with their timestamps and frames from the tile labels. Hunt for text overlapping during a swap, anything moving linearly, blurred or scaled text, a lyric on screen before it's sung or after the next line starts, a dead beat, an empty frame at a section start.
4. Fix only what scored 7 or less; leave sections at 9 or more alone. Re-render only the changed range when you can (`pnpm draft --frames=<a>-<b>`).
5. Repeat until every score is 8 or more. Expect two to four rounds.

Pops and flashes: `pnpm pops --in <video> --cuts=auto --fail`. Pass: exit 0, no unexcused pop and no flash. A pop next to an unlisted section start means the boundary is a plain hard cut you didn't intend; add a transition or accept it as a cut. A flash is always a stray frame.

Held text, on the engine: `pnpm still-test`. It prints, per line, `<line>  <checked>/<total>  max diff  changed px` and `MOTION: word K "<text>" (frames a-b: frame x differs from y)` for each moving word; the skipped words with their reason (a window under 2 frames, or nothing lit in any sampled frame); the words that never settle before their exit (the exit starts at or before the word settles: never still by design; slow the exit or shorten the entrance); then `lines with motion during hold: N (W word(s) checked in L line(s); S skipped; V never settle before their exit)`. Pass: N = 0 with at least one word checked. It exits 1 when no word was checked, so an instrumental-only video fails it. On the reference song at scale 2: 222 words checked, 0 motion, 6 never settle, about 156 s.

Held text, on a render: `pnpm render --textonly --scale=1`, then `pnpm jitter --all-lines`. It prints each line's mean and max pair shift and `lines with motion during hold: N`. Pass: every line's mean shift 0.01 px or less (N = 0), measured at 1080p as in 0.3.0. The 4K held-text check is the per-word `pnpm still-test` at scale 2. `--max` gates the largest single pair; keep it a loose guard such as `--max=0.05`. A diff that rises and falls with no shift points at scaling, a fade or grain. For one window, `pnpm jitter --from=<frame> --frames=45 --crop=x,y,w,h` on any render, starting after the line's last word has settled.

Cut seams and blur, from the reference method:

- Cut on movement, at peak velocity. Direction and speed match on both sides; a zoom keeps the sign of its scale change across the cut.
- Blur only the one to three slam moves that need it: a `ctx.blur` window over the move, or `blur: N` on a transition. Pick samples from the fastest element's speed: about 4 up to 20 px per frame, `ceil(px / 5)` above that, at most 16. A move slower than one element width per frame needs no blur.
- Never blur text meant to be read. A blur window averages the whole page, lyric layer included: held words are identical in every sample and stay sharp, but a word entering or leaving inside the window smears.

When it looks wrong:

| Symptom | Cause and fix |
|---|---|
| Stutter, or a still differs from the render | A clock, a CSS transition or state kept between draws. Run `pnpm check`; draw from `t` only. |
| Held lyric shimmers | A spring or easing still moving, scaling on the beat, or grain over the type. `pnpm still-test` names the word. |
| Cheap, bouncy motion | Bounce easing or a spring under damping 0.72. Use the presets. |
| Grey slab over part of the frame | A blend mode. `pnpm check`. |
| Canvas drawn into a quarter of a 4K frame | The devicePixelRatio trap (Gotchas). Use `ctx.canvas()`. |
| Washed-out or shifted colours | Full-range or untagged output. The encode filter and `setparams` handle it; don't add your own encode step. |
| Audio late or early | A stream copy of an intermediate's AAC. Render only through `pnpm render`/`pnpm draft`. |
| Pop at a section start | A plain boundary is a hard cut. Add a transition or keep it as a cut. |
| Lines overlap during a swap | An exit asked to run past the next line. The exit rule trims it; check `exitBy`, `pairWith` and `lines()`. |
| Machine slows to a crawl during a render | Too many workers. Keep `pool` at 2. |
| The video looks like the last one | No named reference and no beat map. Write the beat map and the direction first. |

## Gotchas

- Headless Chromium can't launch inside the Claude Code Bash sandbox (mach-port denial). `pnpm still`, `draft`, `render`, `still-test`, `jitter --all-lines`, `posters`, `test:render` and `capture.py` need the sandbox disabled for that command, or a run outside it. `analyze`, `align`, `beatmap`, `check`, `preview`, `contact-sheet`, `critique`, `pops`, single-window `jitter`, `clips` and `pnpm test` don't use Chromium.
- pip certificates. In the sandbox, or behind a TLS-intercepting proxy, pip fails certificate checks; run `PIP_USE_DEPRECATED=legacy-certs pnpm setup:env` (and the same for `setup:align`).
- Model hosts. huggingface.co, download.pytorch.org and similar hosts may be blocked, so the alignment uses only k2-fsa/sherpa-onnx models from GitHub releases (Python 3.14 wheels; UVR vocal stem + parakeet TDT/CTC). They land in the project's `.cache/models` (~1.4 GB). Archives are deleted after extraction, and any leftover `*.tar.bz2` or `.cache/models/dl/` is deleted once every model is in place. To save the download for a second project, copy (don't symlink, if setup might run) another project's `.cache/models`.
- Suno songs run long. A song planned at 93 s came back at 131 s with extra instrumental sections. Section times come from `pnpm align`, never from the lyric plan. Check `creative/alignment/verification.json` `possibleUnlistedLyrics` and `transcript.json` for sung lines that aren't in the text, and listen before trusting them. Instrumental sections get visuals, not invented text.
- The preview is for chat. Chat uploads cap at 30 MB; send `pnpm preview`'s file, never the master, and the same for clips (`pnpm preview --in <clip>`). A Cadence file-store upload caps at 4 MB, which fits the contact sheet but not the preview.
- Fonts and licences. Brand fonts are often commercial (Proxima Nova): check the licence, or use a structurally similar Google family. A Google family must exist under that exact name in the Google Fonts CSS2 API with the listed weights, or `pnpm fonts` fails naming it. Re-run `pnpm fonts` after any change to brand.json fonts.
- On-screen copy is the sung lyrics, exact product feature names when they are sung, and the logo. The pipeline never generates text; scenes must not invent taglines, labels or captions.
- Stale analysis. If the track changes and `pnpm analyze` isn't re-run, the timing falls back to the 60 s grid with a warning: `beatmap` stops, and every render (full, draft, text-only, `--scenes`, `--frames`) is refused with "Run `pnpm analyze` before rendering." The same holds for a missing analysis or one made at another fps. Only a project with no track renders on the fallback grid, silent. Re-run `analyze`, then `align`, whenever the track changes.
- AAC priming. Every AAC encoder adds about 1024 samples of priming; MP4 hides it with an edit list, but a stream copy through an intermediate container (raw ADTS in the old Remotion template) lost it and played the audio 42.7 ms late. That is why the final mux encodes AAC from the source WAV itself, once, and why no script stream-copies audio. Don't add a side encode step.
- Never use a shell job-control pool for renders. A zsh `jobs -r` count once read zero inside a subshell, launched 24 4K chunks at once and rebooted the machine. The pool in `scripts/lib/pool.mjs` counts the processes it started itself. Keep `pool` at 2 unless you know the machine; each worker is a Chromium plus an x264 encoder.
- The devicePixelRatio trap. A CDP screenshot with `clip.scale = <scale>` from a session without the device-metrics override returns the right size but resets the page's `devicePixelRatio` to 1 after the first shot, so DPR-aware canvases then draw into a quarter of a 4K frame. `capture.py` sets `deviceScaleFactor` on the screenshot session itself, captures at `clip.scale` 1, and checks `devicePixelRatio` after every seek. Keep that if you touch the capture.
- ffmpeg 8 takes the colour description from the frames, not from the `-color_*` output options. Without `setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709` in the filter, rawvideo input comes out tagged primaries and transfer "unknown". `scripts/lib/encode.mjs` adds it to every encode.
- No blend modes. Blended layers composite as grey slabs in headless Chrome. Grain is plain light and dark speckles at an opacity; `pnpm check` refuses the rest.
- The canvas resets on every seek. `ctx.canvas().get()` clears the pixels and every piece of state (transform, clip, path, save stack, styles, font, dash). Set everything you need in each draw; nothing carries over from the previous frame.
- Section roots and camera targets use `transform-origin: 0 0`. The engine rewrites each section root's transform, clip, opacity and filter on every seek for transitions, so a scene never transforms `ctx.root`; put a full-page container inside it and move that. A shake with `rot` pivots at that element's top-left.
- A plain section boundary is a hard cut. A section with no incoming transition starts with a cut, which `pops` reports unless listed (`--cuts=auto` lists it). A blur window across it fails boot.
- A lyric never goes in the world layer. Sung text belongs to `ctx.lyric`, which keeps it off the camera, out of transitions, inside the exit rule, and visible to `textonly`, `still-test` and `jitter --all-lines`. A word drawn with `ctx.el` or on a world canvas escapes all of that. Camera, shake and shatter throw if given a `#txt` element.
- A draft is half scale (960x540, no motion blur, JPEG captures). Check type on a full-scale still (`--scale=2`), not on the draft.
- Disk use of 4K masters. The 4K master runs about 90 Mbit/s at CRF 17 with the placeholder's grain, about 3 GB for a 4:23 song; heavier texture costs more (the earlier adaptation of this method, CRF 16 with heavy grain, wrote 8.2 GB). While a render runs, its temp folder holds the chunks, the joined video and the muxed file at once, so budget about three times the master's size on the `out/` drive, plus the old master if one exists. Delete stale `out/` renders before a master.
- Scene modules are imported by `pnpm check` in Node: no DOM at module top level, and `src/lib` stays free of `node:` imports and DOM globals so the page and the scripts share it.

## Left out on purpose

From the howseen method: Howseen branding, look and work folders; its API keys and services (Cartesia voice, 21st.dev, Firecrawl); Mixkit music and SFX, synthesized SFX and voiceover (the Suno track is the only audio); stock media and svgl logo fetchers; LinkedIn and X formats (the configs here are 16:9 and the 9:16 Reels and TikTok cut); remake mode and loop seam checks; loudness normalisation (the Suno audio is muxed untouched); its poster-frame rules (posters here are their own compositions; see Posters); "Example data" labels (no data appears on screen); WebGL capture flags; seeking third-party animation libraries. Its taste rules (one accent colour, one visual system, one thing moving at a time) aren't pipeline rules; the direction decides them.

From the old Remotion template: Remotion and React, the composition and `compositionId`, the hooks (`useSongFrame`, `useLine`, `useSectionBeats`, ...), the kinetic kit (`Backdrop`, `SlamIn`, `StampWords`, ...) and the motion components (`MaskedWords`, `ShotTimeline`, `SubframeBlur`, `CircleFlood`, `Scrim`), `--props` and `--composition`. Their jobs moved into the engine and the scene API above.
