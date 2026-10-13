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
```

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
- Colours, fonts, sizes and safe areas come from `ctx.theme`. Lyrics and the logo stay inside title-safe (`theme.safe.title`).
- Beats for this section are `ctx.beats` and `ctx.downbeats` (frame-aligned seconds, chosen by rounded frame).
- Make elements and canvases in `setup`. Don't transform `ctx.root`; the engine owns it.
- A section with no incoming transition starts with a hard cut. Motion blur is opt-in per window: `ctx.blur(a, b, samples)` or `blur: N` on a transition, never across a cut.
- `src/scenes/placeholder.js` is the full worked example; `src/engine/context.js` lists every `ctx` member.

## Where the data lives

| File | Written by |
|---|---|
| `src/pipeline.json` | you: output name, fps, page size, render and draft settings (pool 2, 4K master) |
| `src/brand.json`, `public/brand/` | brand research |
| `public/fonts/` | `pnpm fonts` |
| `creative/lyrics.screen.txt`, `creative/lyrics.suno.txt` | the lyricist |
| `public/audio/track.wav` | the song |
| `src/data/audio-analysis.json` | `pnpm analyze` (`pnpm analyze:reset` restores the no-track default) |
| `src/data/lyrics.json`, `src/data/sections.json`, `creative/alignment/` | `pnpm align` |
| `src/data/timing-overrides.json` | by hand: `firstBeat`, `lastBeat`, `downbeats` |
| `creative/beatmap.md` | `pnpm beatmap`, then the director |
| `out/` | renders, each with a `<video>.manifest.json`; `out/critique/<tag>/`; stills |

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
