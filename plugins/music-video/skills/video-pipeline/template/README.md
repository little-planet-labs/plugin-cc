# Music video project

This project draws a beat-synced music video as one HTML page (`index.html` + `src/`) whose every pixel is a function of the song time, captures it frame by frame in headless Chromium, and encodes it with ffmpeg. The full reference (every flag, the scene API, the render internals, the gotchas) is the `music-video:video-pipeline` skill's `SKILL.md`. This file is the short version.

The engine and the capture method are adapted from howseen-ai/claude-motion-design (MIT); see `NOTICE.md`, and keep it with the project.

## Setup

Needs Node 22.18+, pnpm, Python 3.14, `ffmpeg` and `ffprobe` with libx264 and aac, and `curl` and `tar` for the alignment models. There are no npm dependencies; `pnpm install` isn't needed.

```sh
pnpm setup:env      # .venv (librosa, numpy, pillow, playwright) + headless Chromium in .cache/ms-playwright
pnpm setup:align    # .venv-align + ~1.4 GB of alignment models in .cache/models
pnpm fonts          # downloads brand.json's Google fonts into public/fonts/ (run after brand.json is filled)
```

Behind a TLS-intercepting proxy or in a sandbox, prefix the setup commands with `PIP_USE_DEPRECATED=legacy-certs`.

## Commands, in working order

```sh
# 1-3: fill src/brand.json + public/brand/logo*.svg, write creative/lyrics.screen.txt and
#      creative/lyrics.suno.txt, put the song at public/audio/track.wav (or .mp3)
pnpm analyze                       # src/data/audio-analysis.json
pnpm align                         # src/data/lyrics.json, src/data/sections.json
pnpm beatmap                       # creative/beatmap.md: fill it in before writing scenes
# 7: write the scenes in src/scenes/, running `pnpm check` after each
pnpm still --frame=<n> --out=out/wip-1/f-<n>.png     # look at stills before any video
pnpm draft --out out/draft-r1.mp4                    # 960x540, per round r1, r2, ...
pnpm critique --in out/draft-r1.mp4 --tag r1
pnpm pops --in out/draft-r1.mp4 --cuts=auto --fail
pnpm still-test
pnpm render --textonly --scale=1 && pnpm jitter --all-lines   # 1080p text-only; plain --textonly is 4K PNG
pnpm render                        # the master: out/music-video.mp4, 3840x2160
pnpm preview                       # out/music-video-preview.mp4, under 30 MB
pnpm contact-sheet                 # out/contact-sheet.png
pnpm posters                       # posters/: the cover posters listed in src/posters.js
```

The vertical (9:16) cut and its social clips have their own commands: see "Vertical (social) version" below.

`pnpm serve` serves the interactive preview at http://127.0.0.1:8770/index.html: Space plays with the track, Left/Right step a frame (Shift: 0.5 s), R goes back to the start, the bar at the bottom scrubs, and `?t=<seconds>` opens at a time.

`still`, `draft`, `render`, `still-test`, `jitter --all-lines` and `pnpm test:render` launch Chromium; inside the Claude Code Bash sandbox they need the sandbox disabled for that command.

## Writing a scene

A scene is a module whose default export has `setup(ctx)` (once per section, before the first frame) and `draw(t, ctx)` (every frame; `t` is absolute song seconds). `draw` must be a pure function of `t`: no `Date`, `Math.random`, timers, `requestAnimationFrame`, CSS transitions or blend modes. `pnpm check` finds them.

```js
// src/scenes/verse.js
import {mix, rgba} from '../lib/color.js';
// For a beat-locked accent when a direction asks for one: import {pulse} from '../lib/pulse.js'
// and use pulse(ctx.sinceDownbeat(t)) (1 on each downbeat's frame, decaying to exactly 0).

export default {
  setup(ctx) {
    ctx.state.world = ctx.canvas();                                  // DPR-aware canvas in this section's root
    if (ctx.section.index > 0) ctx.transition({kind: 'fade', dur: 0.3}); // plays before the section starts
    for (const line of ctx.lines) ctx.lyric(line.id, {enter: 'rise', exit: 'fade'}); // every sung line, once
  },

  draw(t, ctx) {
    const {width: W, height: H, theme} = ctx;
    const c = ctx.state.world.get();                                 // a fully reset 2D context, every frame
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.colors.background);
    bg.addColorStop(1, mix(theme.colors.background, theme.colors.primaryDeep, 0.55));
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    const swell = ctx.swell(t, {bars: 2});                           // slow 0..1 energy, never on the beat
    const glow = c.createRadialGradient(W / 2, H * 0.62, 0, W / 2, H * 0.62, H * (0.5 + 0.15 * swell));
    glow.addColorStop(0, rgba(theme.colors.primary, 0.22 + 0.2 * swell));
    glow.addColorStop(1, rgba(theme.colors.primary, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    ctx.setFx({vignette: 0.35, grain: 0.035});                       // grain and vignette sit under the lyrics
  },
};
```

Register it in `src/scenes/index.js` under the scene key `sections.json` uses:

```js
import verse from './verse.js';
export const SCENES = {verse};
export const DEFAULT_SCENE = null; // once every key has a scene and placeholder.js is deleted
```

Rules that keep a scene correct:

- Lyrics go through `ctx.lyric(id, style)` only; never draw sung words in the world. Each line with words is registered by exactly one scene. Words appear on their sung frames and a line is gone 2 frames before the next line's first word.
- Colours, fonts, sizes and safe areas come from `ctx.theme`. Lyrics and the logo stay inside title-safe (`theme.safe.title`). Type sizes scale with the page's short side over 1080, so they are the same px on a 1920x1080 and a 1080x1920 page.
- Beats for this section are `ctx.beats` and `ctx.downbeats` (frame-aligned seconds, chosen by rounded frame).
- Make elements and canvases in `setup`. Don't transform `ctx.root`; the engine owns it.
- A section with no incoming transition starts with a hard cut. Motion blur is opt-in per window: `ctx.blur(a, b, samples)` or `blur: N` on a transition, never across a cut.
- `src/scenes/placeholder.js` is the full worked example; `src/engine/context.js` lists every `ctx` member.

### Running past the end of the audio

`tailSeconds` in `src/pipeline.json` (default 0, at most 30) runs the video that many seconds past the end of the song, over silence, so a closing move can finish. The video then has `ceil((song seconds + tailSeconds) × fps)` frames, and every script uses that count: the page, `still`, `draft`, `render`, the QA scripts, `preview`, `contact-sheet`, `check` and `beatmap` (which adds a `Tail:` line).

- `ctx.duration` and `ctx.frames` are the end of the video, tail included. `ctx.audioEnd` (frame-aligned seconds) and `ctx.audioFrames` are the end of the song; they equal `ctx.duration` and `ctx.frames` when there is no tail. `window.__mv` has the same four.
- The tail belongs to the last section: it runs to the end of the video, often the `instrumental` section `pnpm align` names with variant `"tail"`. No section may start in the tail (one that does is stale data). Draw the closing move in the last section's `draw` from `t >= ctx.audioEnd`, or earlier.
- Lyrics are bound to the song: a line is gone by `ctx.audioEnd`, and lyric timings don't change.
- There are no beats in the tail and `ctx.energy` is 0 there.
- The mux keeps the song exactly as it is (no resampling, no loudness change, the same AAC encode) and appends digital silence after it, so the audio stream is as long as the video. A `--frames` range that reaches into the tail gets the same silence. The `pnpm serve` preview keeps playing through the tail after the track stops.

## Vertical (social) version

`src/pipeline.vertical.json` is a second pipeline config for a 9:16 Instagram Reels / TikTok cut: a 1080x1920 page, the same fps as `src/pipeline.json`, an example 0.3 s tail, a 1080x1920 master (`render.scale` 1) and 540x960 drafts. Instagram Reels caps a video at 3:00, so set its `tailSeconds` per song to keep the song plus the tail under 180 s; 0 is fine when the vertical cut doesn't need the landscape tail. It draws with its own scene registry, `src/scenes-vertical/index.js` (its `scenes` key), and its master is `out/music-video-vertical.mp4`. The landscape config, `src/pipeline.json`, stays the default for every command, and neither config's output can land on the other's master.

The template ships the config but not the vertical scenes: write `src/scenes-vertical/index.js` (the same `SCENES` / `DEFAULT_SCENE` shape as `src/scenes/index.js`) before using it. Until it exists, `pnpm check --pipeline=src/pipeline.vertical.json` fails with `scenes: scene registry src/scenes-vertical/index.js (the scenes of src/pipeline.vertical.json) does not exist; write it, or pass --scenes=<module> to use another`, and `still`, `draft` and `render` with that config stop before opening a browser with `scene registry src/scenes-vertical/index.js (the scenes of src/pipeline.vertical.json) does not exist; pass --scenes=<module> to use another`. The landscape commands never need it.

```sh
pnpm check --pipeline=src/pipeline.vertical.json
pnpm still --pipeline=src/pipeline.vertical.json --frame=<n> --out=out/wip-v1/f-<n>.png
pnpm draft --pipeline=src/pipeline.vertical.json --out out/vertical-draft-v1.mp4   # 540x960
pnpm critique --pipeline=src/pipeline.vertical.json --in out/vertical-draft-v1.mp4 --tag v1
pnpm render --pipeline=src/pipeline.vertical.json      # out/music-video-vertical.mp4, 1080x1920
pnpm preview --pipeline=src/pipeline.vertical.json     # out/music-video-vertical-preview.mp4, 720x1280
pnpm contact-sheet --pipeline=src/pipeline.vertical.json   # out/music-video-vertical-contact-sheet.png
pnpm clips --pipeline=src/pipeline.vertical.json       # out/clips/music-video-vertical-<slug>.mp4 + music-video-vertical-clips.manifest.json
```

- `--pipeline=<config>` is accepted by `still`, `draft`, `render`, `preview`, `contact-sheet`, `critique`, `pops`, `still-test`, `jitter`, `check`, `beatmap` and `clips`; the page takes `?pipeline=<config>` (e.g. `http://127.0.0.1:8770/index.html?pipeline=src/pipeline.vertical.json`). A config is `src/pipeline.json` or `src/pipeline.<name>.json` (`<name>` in lowercase letters, digits and hyphens; nothing else is accepted), must use the fps of `src/pipeline.json` (the song's analysis and lyric timing are made at it) and its own `outputName`. `analyze`, `align` and `posters` always use `src/pipeline.json`.
- A config may name its scene registry in an optional `scenes` key (a project-relative module path). `--scenes=<module>` still works with `--pipeline`. Without it, or naming the config's own registry, it is the master render; any other registry is an alternate render (`out/music-video-vertical-<module>.mp4`), for example `--scenes=src/scenes/index.js` to see the landscape scenes on the vertical page.
- `pnpm draft:vertical`, `render:vertical`, `preview:vertical` and `clips:vertical` are the same commands with the flag filled in. A vertical `beatmap` writes `creative/beatmap-music-video-vertical.md`.
- Type sizes and lyric exit travel scale with the short side of the page, so on the 1080x1920 page `theme.sizes` are the 1920x1080 values (84 px lyrics) and a word falls or scatters the same distance as at 1920x1080. On any landscape page both are exactly what they were. `pnpm preview` makes "720p" the short side: a 9:16 master previews at 720x1280. `theme.safe.action` and `theme.safe.title` are 5% and 10% of each side (title is 108 px left and right, 192 px top and bottom).
- `theme.safe.social` is where Reels and TikTok draw their own UI over the video: at 1080x1920 `{top: 220, right: 160, bottom: 420, left: 64}` px (header row; like/comment/share column; caption, audio row and tab bar), scaled with the page. It is an approximation (rounded-up estimates of those overlays), not an official figure, and the apps change their overlays: keep lyrics, the logo and anything that must be read inside both `safe.title` and `safe.social`, and check a real post.

### Clips

A config's clip list is `src/clips.<name>.json` for `src/pipeline.<name>.json` (`src/clips.vertical.json` for the vertical config; `src/clips.json` for `src/pipeline.json`). The template ships none: write the list for your song. A config without one needs `--clips <json>`.

```json
{
  "fadeIn": 0.15,
  "fadeOut": 0.4,
  "clips": [
    {"slug": "verse-1-chorus", "start": 10.5, "end": 50.6, "fadeOut": 0.25, "note": "why these edges"}
  ]
}
```

Each clip has a `slug`, a `start` and an `end` in song seconds (snapped to whole frames; the clip is `[start, end)`), optional `fadeIn` / `fadeOut` in seconds (defaults 0.15 and 0.4, audio only; the picture cuts hard) and a `note`. `pnpm clips` cuts each one frame-exactly from the master (re-encoded: H.264 CRF 18, constant fps, AAC 256 kbit/s 48 kHz, `+faststart`), checks its frame count and audio length, and writes `out/clips/<outputName>-<slug>.mp4` plus `out/clips/<outputName>-clips.manifest.json` with every clip's frame range and duration (one manifest per config, so both can share `out/clips/`). `--clips <json>`, `--in <mp4>` and `--out-dir <dir>` override the defaults. It refuses a clip that runs past the master, a master at another fps, a partial render, a master without audio, and any output that is a master or the input.

## Cover posters

`src/posters.js` holds the cover posters (YouTube thumbnails): it exports `POSTERS`, the list, next to `SCENES` and `DEFAULT_SCENE`, the scenes that draw them. It is an alternate scene registry on the `src/pipeline.json` page; the video's own registry, `src/scenes/index.js`, is not involved. Each entry is `{n, slug, frame}`: the poster's number, a slug of lowercase letters and digits joined by hyphens, and the page frame that draws it. The poster scene picks what to draw from `t`, for example poster k at frame 30 k. The template ships one placeholder poster (`src/posters/placeholder.js`, no text); replace it with the project's poster scene and list one entry per poster.

```sh
pnpm posters
```

It checks the list first (an empty list, a repeated number, slug or frame, or a frame past the end of the video stops it, naming the problem), captures each poster at its frame at 1920x1080 through `scripts/capture.py` (the same capture path `pnpm still` uses) and lanczos-downscales it to 1280x720. Once every file is complete it replaces the set in `posters/`: any `poster-<n>-<slug>.png` the list no longer names (a poster removed or renamed since the last run) is deleted and reported, so `posters/` holds exactly the current list and these files:

- `poster-<n>-<slug>.png`, one per poster
- `posters-sheet.png`: every poster at 640 px, 2 across
- `posters-small.png`: each poster at 360 px and 168 px wide, YouTube's phone and sidebar sizes, for judging readability

Only `poster-<n>-<slug>.png` names are ever deleted; other files in `posters/` are left alone. Intermediates go to a temp folder under `out/`, which is removed when the script finishes or is interrupted.

## Where the data lives

| File | Written by |
|---|---|
| `src/pipeline.json` | you: output name, fps, page size, `tailSeconds` after the song, render and draft settings (pool 2, 4K master) |
| `src/pipeline.vertical.json`, `src/scenes-vertical/`, `src/clips.vertical.json` | you: the vertical (9:16) config, its scenes and its social clips |
| `src/posters.js`, `src/posters/` | you: the cover-poster list and scenes |
| `src/brand.json`, `public/brand/` | brand research |
| `public/fonts/` | `pnpm fonts` |
| `creative/lyrics.screen.txt`, `creative/lyrics.suno.txt` | the lyricist |
| `public/audio/track.wav` | the song |
| `src/data/audio-analysis.json` | `pnpm analyze` (`pnpm analyze:reset` restores the no-track default) |
| `src/data/lyrics.json`, `src/data/sections.json`, `creative/alignment/` | `pnpm align` |
| `src/data/timing-overrides.json` | by hand: `firstBeat`, `lastBeat`, `downbeats` |
| `creative/beatmap.md` | `pnpm beatmap`, then the director |
| `out/` | renders, each with a `<video>.manifest.json`; `out/critique/<tag>/`; `out/clips/`; stills |
| `posters/` | `pnpm posters` |

## QA pass marks

| Check | Pass |
|---|---|
| `pnpm critique --tag r<n>` | Every section scores 8 or more out of 10 on legibility at 360 px, sync, motion, composition, on-screen copy and seams. |
| `pnpm pops --cuts=auto --fail` | Exit 0: no unexcused pop, no flash. |
| `pnpm still-test` | `lines with motion during hold: 0`, at least one word checked. |
| `pnpm jitter --all-lines` (on `pnpm render --textonly --scale=1`) | Every line's mean shift 0.01 px or less, measured at 1080p. The 4K held-text check is `pnpm still-test` (scale 2). |

## Troubleshooting

- `Python venv missing` or `Playwright's Chromium is missing`: run `pnpm setup:env`.
- `alignment venv missing`: run `pnpm setup:align`.
- A boot error saying `run pnpm fonts`: the brand's Google fonts aren't downloaded, or brand.json fonts changed since.
- Chromium fails to launch with a mach-port error: you are in the sandbox; disable it for that command.
- A warning about fallback timing, `beatmap` refusing to run, or a render refused with "Run `pnpm analyze` before rendering": the track changed, was never analysed, or was analysed at another fps. Run `pnpm analyze`, then `pnpm align`. Only a project with no track renders, silent, on the fallback grid.
- `unknown scene key "<key>"`: add it to `SCENES`, or keep `DEFAULT_SCENE` set while you build.
- `lyric line ... not registered by any scene`: every sung line needs one `ctx.lyric(id)` in some scene's setup.
- A blur window "has a hard cut inside it": end the window at the cut, or give the section a transition.
- `pops` reports a pop at a section start: that boundary is a hard cut. Pass `--cuts=auto`, or add a transition.
- A render takes the machine down: keep `pool` at 2 in `src/pipeline.json`. Never run renders through a shell `&` loop.
- `pnpm preview` refuses a video as too long: over about 8 minutes, 26 MB leaves under 300 kbit/s of video. Render an excerpt (`pnpm render --frames=<a>-<b>`) and preview that with `--in`.
- Time and disk: a 4K master of a 4:23 song takes about 2.5 hours at pool 2 with the placeholder scene (real scenes are slower) and about 3 GB at CRF 17, and a render needs about three times that free on the `out/` drive while it runs.
