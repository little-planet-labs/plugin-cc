---
name: scene-authoring
description: How the music-video director designs and builds a video's scenes in one shot so no two videos look alike. Covers writing creative/direction.md first (a distinct visual language drawn from the brand, the song, and the company, checked against past directions and approved by the user), the timing contract (absolute song frames, beats assigned to sections by rounded frame, downbeat hits, anticipation, the active lyric always matching the sung line, instrumentals without invented text), legibility and safe areas, on-screen copy limits, determinism and React rules, the one-shot build order, and the stills-based self-check loop, with known pitfalls. Use when writing direction.md or anything under src/scenes/.
user-invocable: false
---

# Scene authoring

The pipeline is shared; the look is not. Every video gets its own visual language, designed before any code and built in one pass. Load `music-video:remotion-pipeline` alongside this skill: it documents the full API (hooks, `resolveScene`/`SCENES`/`DEFAULT_SCENE`, the optional kinetic kit with `Backdrop` variants `black`, `deep`, `brand`, `neutral`, `light`, and `Logo`), the scripts, and the file layout. `examples/kizen.md` is one finished example. **Don't copy its look.**

## 1. Direction first: creative/direction.md

Write no scene code until the user has approved `direction.md`.

### Check what's been done

The lead passes you past directions in the brief: vault entries tagged `music-video-direction` when Cadence is connected, otherwise what the user said. If the brief has none and you have Cadence, run `list_knowledge` with `tag: "music-video-direction"` yourself. The new direction must differ from each past one on at least three of: typography approach, motion vocabulary, texture or medium, camera feel, and transitions. Name them in the "Differs from" line. You don't write to the vault; the lead logs your direction after delivery.

### Derive it

Pull from three inputs and say in the doc how each one shaped the result:

- **The brand** (`src/brand.json`): which colours carry the video, and what the brand's own UI and site feel like (dense and technical, soft and friendly, editorial).
- **The song** (`lyrics.md`, `src/data/audio-analysis.json`): genre, BPM, the energy curve across sections, where the jokes land.
- **The company's personality** (`research.md`, `brief.tone`): who they sell to and how they talk.

### The menu (inspiration, not a list to pick from)

| Direction | Typography | Motion | Texture |
|---|---|---|---|
| Cinematic kinetic caps (Kizen) | Wide-tracked light caps, huge bold hits | Slam, push-in, camera shake | Clean gradients, glow |
| Paper collage | Cut-out letters, mixed fonts | Stop-motion at 12 fps steps, paper drops | Torn edges, grain, shadows |
| Brutalist type | One heavy grotesk, full-bleed, clipped | Hard cuts on every beat, no easing | Flat colour, raw grid |
| 3D or isometric | Extruded words on planes | Orbiting camera, blocks assembling | Soft lighting, long shadows |
| Hand-drawn | Marker lettering | Boiling lines, draw-on paths | Paper white, ink |
| Retro terminal | Monospace, scanlines | Typing, glitch, cursor blinks | CRT glow, phosphor colour from the brand |
| Editorial magazine | Serif display with sans captions | Slow pans, layout reflows | Photo-less spreads, rules, folios |
| Liquid gradients | Rounded sans, soft weights | Morphing blobs, elastic text | Mesh gradients from the brand palette |

Mix and invent. A direction is good when you can describe a still from it in one sentence and nobody would mistake it for the last video.

### What direction.md contains

1. **Summary**: three sentences a user can approve.
2. **Differs from**: the past directions and the dimensions this one changes.
3. **Visual language**: typography (families from brand.json, weights, case, tracking, how big hits get), motion vocabulary (the 4 to 6 moves this video uses, and the ones it never uses), colour treatment within the brand (which colour means what, how "before" and "after" differ if the song has a turn), camera feel, texture or medium, transitions between sections, and how humour lands visually (a sight gag on the punchline word, a stop-time freeze, a deadpan hold).
4. **Section plan**: one row per section in `src/data/sections.json` (instrumentals included), with its time range, energy, and concept: what's on screen, the hits it lands, and how it hands off to the next section.
5. **Alternates**: two contrasting directions in one line each, so the user can redirect without a new round.

The lead shows the user the summary and the alternates. ★ The user approves or redirects.

## 2. Timing contract

- **Absolute song frames, always.** Scenes run inside a `<Sequence>`, so `useCurrentFrame()` is section-relative. Sync everything with `useSongFrame()` and the line and beat helpers, which return absolute frames. Entrance components take `at` and `exitAt` in absolute frames.
- **Beats belong to sections by rounded frame**, never by comparing seconds. Use `useSectionBeats(section)`, which returns `{beats, downbeats}` in absolute frames; never filter `beats` by seconds yourself, or a beat on the boundary lands in both sections or neither.
- **Hit downbeats.** The big moves (a section's first hit, the name on the hook, a cut) land on downbeats from the analysis. Smaller accents use beats or word starts.
- **Anticipate the impact.** The impact frame is the beat or word frame; the wind-up (squash, pull-back, a dim) starts 3 to 6 frames before it. An entrance that starts on the beat reads late.
- **The active lyric line matches the sung line.** Lines come from `src/data/lyrics.json` by id (`useLine(id)`). A line may appear at most a few frames before its first word, exits before the next line's first word, and words stamp in on their own word frames. Never show a line before it's sung or after the next one starts, and never show a line that wasn't sung. Line ids are `<sectionId>-<n>` (`verse-1-3`), and a line repeated within its section gets `-r2`, `-r3` (`chorus-1-1-r2`). Use `useLineOrNull(id)` where a take may have dropped a line.
- **Sections come from the lyric tags.** A kind that repeats (two choruses) shares one scene key and gets `variant` `"1"`, `"2"`; make the later one a payoff rather than a copy. Instrumentals are `scene: "instrumental"` with `variant` `lead-in`, `break`, or `tail`.
- **Instrumentals get motion, not text.** Suno adds instrumental sections; give them visuals driven by `useEnergy` and the beats. No invented words. The logo is allowed.
- **Section times come from `sections.json`**, never from the lyric plan. Make every section stretch: derive positions from its frame range and beats, not from fixed frame numbers.

## 3. Craft

### Legibility at 1080p

- Body lyrics at least 72 px, normally 84 px. Hits 160 to 300 px. The preview is 720p, which shrinks everything by a third.
- Text contrast with whatever is behind it at that frame, not with the scene's base colour: check it over glows, particles, and flashes.
- A lyric word stays readable for at least 12 frames once it's in.
- Props that carry a joke are at least 200 px on their long side. A gag nobody can see is a missing gag.

### Safe areas

- Keep all text inside the action-safe area: 96 px from the left and right edges, 54 px from the top and bottom.
- Keep lyrics and the logo inside title-safe: 192 px and 108 px. Players draw controls over the bottom of the frame.

### On-screen copy

Only three kinds of text appear: **the sung lyrics**, **exact feature names** as spelled in `research.md` (when the lyric sings them), and **the logo**. No taglines, no labels on diagrams, no captions, no UI chrome with fake copy, no debug text. A label you want to add is a label that wasn't sung: drop it.

### Determinism

- Everything derives from the frame. No `Date`, no `Math.random()`, no `performance.now()`. Use Remotion's `random(seed)` with a stable string seed, and build seeded arrays once at module scope.
- No CSS `transition` or `@keyframes` animation, and no `setTimeout`. They don't follow the frame, so a render and a still disagree.
- No network fetches at render time. Assets come from `public/` through `staticFile`.

### React rules

- No `useState`, `useEffect`, or refs for animation state. A frame's output is a pure function of the frame and the data.
- Hooks are called unconditionally at the top of a component. A component that shows only during a range returns `null` outside it after its hooks run.
- Keys are stable ids, never array indexes on lists that change.
- Colours, fonts, and sizes come from `src/theme.ts` (which reads `brand.json`). Add direction-specific tokens to `theme.ts`; never hard-code a hex in a scene.

## 4. One-shot build

1. **Plan in direction.md.** Every section's concept, its hits by word or beat, and its handoff are written before code.
2. **Build this direction's primitives** in `src/components/<direction-name>/`: the 4 to 6 moves from the motion vocabulary, the text style, the backdrop. The template's `src/components/kinetic/*` is optional; use a piece only when it fits the direction.
3. **Build scenes section by section**, in song order, one folder per scene under `src/scenes/`, registered in `SCENES` in `src/scenes/registry.ts` under the scene keys `sections.json` uses. Then delete the placeholder and set `DEFAULT_SCENE` to `null`, so a missing key stops the render. Write a header comment per scene: its time range and, line by line, what happens. Run `pnpm typecheck` and `pnpm lint` after each scene.
4. **Self-check loop** (below), then fix.
5. **Render and hand off:** `pnpm render`, `pnpm preview`, `pnpm contact-sheet`. Report the output paths.

No inspector rounds on scenes. The self-check is the review.

## 5. Self-check loop

Commands that launch Chrome (`still`, `render`, `preview`, `contact-sheet`) need an unsandboxed run (`dangerouslyDisableSandbox: true`).

1. **List the check frames** from `src/data/sections.json` and `lyrics.json`: each section's first frame and first frame + 8, each big hit and hit + 2, the frame where each line's last word lands, and the last frame of the video.
2. **Render them** with `pnpm still --frame=<n> --out=out/wip-<pass>/f-<n>.png` (`<n>` is the absolute frame). `out/wip-*` is scratch the lead offers to delete at the end.
3. **Look at every one** with the Read tool. Don't infer a frame from the code.
4. **Fix, in this order:** text you can't read (size, contrast, overlap with a prop), a lyric that doesn't match the line sung at that frame, an empty or half-built frame, overlapping layers that weren't meant to overlap, then polish.
5. **Repeat** only on the frames you changed. Two passes is normal; stop when the frames are clean.

## Known pitfalls (from the Kizen run)

- **A flash that washes out the frame.** A full-frame white flash at high opacity on a hit turns the hit frame, the one people screenshot, into a white sheet with the lyric unreadable. Keep flashes short and around 0.4 peak, or put the flash behind the text layer, and check the hit frame itself in the self-check.
- **Tiny props.** Small gag props read fine in the code and disappear at 1080p, and more so in the 720p preview. Make the joke the size of a word.
- **Empty caption panels at section starts.** A caption panel drawn from the section's first frame shows as an empty box until the first word stamps in. Bring the panel in with the first word, or don't use a panel.
- **Labels that aren't sung.** The lyric doc proposed a glowing core labelled "Knowledge bases" for "Teach it what you know"; the label wasn't sung, so the core shipped unlabelled. If it isn't sung, it isn't on screen.
