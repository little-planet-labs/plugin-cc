---
name: scene-authoring
description: How the music-video director designs and builds a video's scenes so no two videos look alike. Covers creative/direction.md first (a visual language drawn from the brand, the song, and the company, checked against past directions and approved by the user), the optional concept round (three concepts as separate compositions, each with a contact sheet of the same key moments and a motion test), the timing contract (absolute song frames, beats by rounded frame, downbeat hits, the active lyric matching the sung line, instrumentals without text), variety across shots, motion, transitions, springs and easings, beat pulsing only where the genre fits, pixel-still held text, typography defects, legibility, safe areas, on-screen copy, determinism and React rules, the one-shot build, and the self-check loop (stills, a transition sweep, jitter), with known pitfalls. Use when writing direction.md, concepts.md, or anything under src/scenes/ or src/concepts/.
user-invocable: false
---

# Scene authoring

The pipeline is shared; the look is not. Every video gets its own visual language, designed before any code and built in one pass. Load `music-video:remotion-pipeline` alongside this skill: it documents the full API (hooks, `resolveScene`/`SCENES`/`DEFAULT_SCENE`, the optional kinetic kit with `Backdrop` variants `black`, `deep`, `brand`, `neutral`, `light`, and `Logo`), the scripts, and the file layout. The optional motion kit in `src/components/motion/` is listed under "Motion" below. `examples/kizen.md` and `examples/github.md` are finished examples. **Don't copy their looks.**

## 1. Direction first: creative/direction.md

Write no scene code until the user has approved `direction.md`.

### Check what's been done

The lead passes you past directions in the brief: vault entries tagged `music-video-direction` when Cadence is connected, otherwise what the user said. If the brief has none and you have Cadence, run `list_knowledge` with `tag: "music-video-direction"` yourself. The new direction must differ from each past one on at least three of: typography approach, motion vocabulary, texture or medium, camera feel, and transitions. Name them in the "Differs from" line. You don't write to the vault; the lead logs your direction after delivery.

### Derive it

Pull from three inputs and say in the doc how each one shaped the result:

- **The brand** (`src/brand.json`): which colours carry the video, and what the brand's own UI and site feel like (dense and technical, soft and friendly, editorial).
- **The song** (`lyrics.md`, `src/data/audio-analysis.json`): genre, BPM, the energy curve across sections, where the jokes land.
- **The company's personality** (`research.md`, `brief.tone`): who they sell to and how they talk.

`brief.visualStyle`, when set, is the user's own words about the look. Treat it as a requirement and quote it in the summary. `brief.logoUse` decides whether the logo appears at all: when it's `"omitted"`, no `Logo` and no company mark, redrawn or not.

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
| Product keynote (GitHub) | Heavy grotesk, sentence case, words rising through masks | Springs, zoom-throughs, circle floods, split panels | Glass cards over vivid mesh gradients |

Mix and invent. A direction is good when you can describe a still from it in one sentence and nobody would mistake it for the last video.

### Variety: one direction, many ideas

A direction is a language, not a single image. One visual system held for a whole song wears out: a full-bleed grid wall that carried every section of a 4.5-minute ballad was rejected as dated and repetitive.

- Give each section, and often each line, its own layout and visual idea inside the direction.
- Save a recurring motif for the lyric that calls for it. The grid that failed as a wall worked as one shot, on the line about the grid itself.
- Inside one shot: one accent colour, and one hero element moving at a time.
- Across shots: vary the system (type-only, prop, UI, illustration) and the palette.

### What direction.md contains

1. **Summary**: three sentences a user can approve.
2. **Differs from**: the past directions and the dimensions this one changes.
3. **Visual language**: typography (families from brand.json, weights, case, tracking, how big hits get), motion vocabulary (the 4 to 6 moves this video uses, and the ones it never uses), colour treatment within the brand (which colour means what, how "before" and "after" differ if the song has a turn), camera feel, texture or medium, transitions between sections, and how humour lands visually (a sight gag on the punchline word, a stop-time freeze, a deadpan hold).
4. **Section plan**: one row per section in `src/data/sections.json` (instrumentals included), with its time range, energy, and concept: what's on screen, the hits it lands, and how it hands off to the next section.
5. **Alternates**: two contrasting directions in one line each, so the user can redirect without a new round.

The lead shows the user the summary and the alternates. ★ The user approves, redirects, or asks for a concept round.

### Concept round (when the lead asks for one)

Users judge motion, not paragraphs. A concept round shows three looks moving before one gets built in full.

1. **Pitch three really different concepts** in `creative/concepts.md`: for each, a pitch, typography, colour, motion, transitions, overlays, a line per section, and the cost and risk. End with a recommendation. Three variations of one idea isn't a round.
2. **Pick the moments once.** List about 10 key lyric moments (the intro, the first line, the hook downbeat, a big joke, the bridge, the key change) with their absolute frames, in a table at the top of `concepts.md`. Every concept renders the **same** frames, so the sheets compare like for like.
3. **Build each concept as its own composition** under `src/concepts/<slug>/`, registered in `src/Root.tsx` with its own id. Shared concept code goes in `src/components/<kit-name>/`. Don't touch `src/scenes/` or the main composition, so an approved build stays intact.
4. **Render, per concept:**
   - a contact sheet of those moments (stills with `pnpm still --composition=<id> --frame=<n>`, tiled)
   - a 10 to 14 s motion test of the pre-chorus into chorus 1, with `pnpm render --composition=<id> --frames=<a>-<b>`. Stills can't show transitions or motion, and the pre-chorus into the hook has both.
5. **Self-check the sheets and the clips** as in section 5 before reporting.

After the user picks, extend the chosen concept to the whole song in its own composition and render it with `pnpm render --composition=<id>` (it writes `out/<id>.mp4`). When the user dislikes one element of it, pitch 2 or 3 treatments of just that element as an options sheet, in context, with a short clip of each, and re-render only after they pick.

## 2. Timing contract

- **Absolute song frames, always.** Scenes run inside a `<Sequence>`, so `useCurrentFrame()` is section-relative. Sync everything with `useSongFrame()` and the line and beat helpers, which return absolute frames. Entrance components take `at` and `exitAt` in absolute frames.
- **Beats belong to sections by rounded frame**, never by comparing seconds. Use `useSectionBeats(section)`, which returns `{beats, downbeats}` in absolute frames; never filter `beats` by seconds yourself, or a beat on the boundary lands in both sections or neither.
- **Hit downbeats.** The big moves (a section's first hit, the name on the hook, a cut) land on downbeats from the analysis. Smaller accents use beats or word starts.
- **Anticipate the impact.** The impact frame is the beat or word frame; the wind-up (squash, pull-back, a dim) starts 3 to 6 frames before it. An entrance that starts on the beat reads late.
- **The active lyric line matches the sung line.** Lines come from `src/data/lyrics.json` by id (`useLine(id)`). A line may appear at most a few frames before its first word, exits before the next line's first word, and words stamp in on their own word frames. Never show a line before it's sung or after the next one starts, and never show a line that wasn't sung. Line ids are `<sectionId>-<n>` (`verse-1-3`), and a line repeated within its section gets `-r2`, `-r3` (`chorus-1-1-r2`). Use `useLineOrNull(id)` where a take may have dropped a line.
- **Sections come from the lyric tags.** A kind that repeats (two choruses) shares one scene key and gets `variant` `"1"`, `"2"`; make the later one a payoff rather than a copy. Instrumentals are `scene: "instrumental"` with `variant` `lead-in`, `break`, or `tail`.
- **Instrumentals get motion, not text.** Suno adds instrumental sections; give them visuals driven by `useEnergy` and the beats. No invented words. The logo is allowed unless `brief.logoUse` is `"omitted"`. A long instrumental (a 30 s tail) needs its own visual idea in the plan, not a held frame.
- **Section times come from `sections.json`**, never from the lyric plan. Make every section stretch: derive positions from its frame range and beats, not from fixed frame numbers.

## 3. Craft

### Legibility at 1080p

- Body lyrics at least 72 px, normally 84 px. Hits 160 to 300 px. The preview is 720p, which shrinks everything by a third.
- Text contrast with whatever is behind it at that frame, not with the scene's base colour: check it over glows, particles, and flashes.
- A lyric word stays readable for at least 12 frames once it's in. Each lyric stays on screen at least 0.7 s, and text reveals no faster than about 17 characters per second.
- Props that carry a joke are at least 200 px on their long side. A gag nobody can see is a missing gag.

### Type that holds up

These defects all shipped in one run's renders and were caught late:

- **Clipped descenders.** An `overflow: hidden` mask, or a `background-clip: text` gradient box, that ends at the line box cuts off g, j, p, q, and y. Give masks room below the line (about 0.45em) and make gradient boxes cover the full glyph extent.
- **Hard-edged bands behind wrapped lines.** A dark background per line shows as stacked slabs with hard edges. Put one soft, feathered scrim behind the whole block (`Scrim` in the motion kit).
- **Stranded single words.** A last line holding one word looks like a mistake. Use `text-wrap: balance`, or break lines yourself.
- **Variable-font outlines.** A stroke on a variable font draws its internal contours (an H reads as "l-l"). Use a hard offset shadow instead of a stroke.
- **Grey slabs from blend modes.** Grain with a blend mode over 3D-transformed or clipped layers renders as grey rectangles in headless Chrome. No blend modes on grain.

### Held text stays still

Once a lyric has landed, it doesn't move by a pixel until it exits. Sub-pixel shimmer on held type looks like a cheap encode, and viewers notice it on a ballad more than anywhere. The causes found in one run:

- **Springs that never settle.** Remotion's `spring` approaches 1 and never reaches it, so the text keeps drifting by fractions of a pixel. Use `springSettled` from the motion kit, or clamp to exactly 1 once the motion is done.
- **Lyrics inside camera, beat-punch, or drift wrappers.** Anything that scales or moves the scene moves the text with it.
- **Re-seeded grain drawn above the text.** Grain that changes every frame and sits over the type makes it crawl.

The layer order is: background, then grain and vignette, then the lyric text in a layer with no punch, drift, or camera scale. Text may still make deliberate moves: its entrance, a hit, its exit. Measure it with `pnpm jitter` (section 5). It passes when the printed summary's mean shift is 0.01 px or less.

### Motion

Modern motion reads as designed, not as "things fading in". The template's optional motion kit (`src/components/motion/`) has the pieces: `springSettled`, `MaskedWords`, `Scrim`, `Grain`, `useEnergySwell`, `CircleFlood`, and `logZoom`. Use what fits the direction.

- **Transitions with a source.** Zoom-throughs (the camera flies into an element and out into the next shot), circle floods from a source element (`CircleFlood` clears the farthest corner), split panels, whip pans, masks, and shared-element handoffs, where a word or shape carries into the next shot.
- **Matched direction and speed across cuts.** A whip left ends in a shot already moving left at the same speed.
- **Cut at peak velocity**, not at rest. The cut hides inside the fastest frame.
- **Seam blur scales with size:** about 10 px for text, 18 to 20 px for a full-frame move.
- **Camera zoom in log space** (`logZoom`): linear scale interpolation looks like it accelerates. Never zoom in and then straight back out.
- **Easings, never linear** for moves: `Easing.bezier(0.6, 0, 0.2, 1)` for moves between rests, `Easing.bezier(0.2, 0.8, 0.2, 1)` for entrances. Every easing returns exactly 0 and 1 at its ends.
- **Spring presets** (stiffness / damping, mass 1): snappy 320/30, default 170/26, heavy 120/24, and playful 180/12, which overshoots, so only on gag words.

These motion ideas are adapted from howseen-ai/claude-motion-design (MIT).

### Rhythm: pulse only when the track pounds

Beat-locked pulsing is genre-dependent. A per-beat or per-bar scale or brightness throb fought a slow ballad without heavy beats, and the user rejected it.

- **Sharp one-off moves on real musical events are fine** in any genre.
- **Repeating beat-locked pulsing** (the kinetic kit's `BeatPulse`, a scene-wide beat punch) only when the track has heavy, regular beats: dance, electro, rock with a four-on-the-floor kick. Check the genre in `brief.json` and the low-band energy and onsets in `audio-analysis.json`.
- **For ballads and anything soft:** slow background movement on heavily smoothed energy (`useEnergySwell`), and single accents on real events: the hook downbeat, stop-time hits, the key change, an instrument's entrance.

### Mascots and graphics

App-icon framing (a squircle tile, a badge, a rounded-square icon) reads as low-fi at video size. Draw mascots and hero graphics freestanding, at a higher fidelity: a layered illustration, glass, or neon line art. When you aren't sure which treatment fits, pitch 2 or 3 as an options sheet before building one.

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
- Colours, fonts, and sizes come from `src/theme.ts` (which reads `brand.json`). Add direction-specific tokens to `theme.ts`, including any vivid-palette colours from the Brand section of `research.md`; never hard-code a hex in a scene.

## 4. One-shot build

1. **Plan in direction.md.** Every section's concept, its hits by word or beat, and its handoff are written before code.
2. **Build this direction's primitives** in `src/components/<direction-name>/`: the 4 to 6 moves from the motion vocabulary, the text style, the backdrop. The template's `src/components/kinetic/*` and `src/components/motion/*` are optional; use a piece only when it fits the direction.
3. **Build scenes section by section**, in song order, one folder per scene under `src/scenes/`, registered in `SCENES` in `src/scenes/registry.ts` under the scene keys `sections.json` uses. Then delete the placeholder and set `DEFAULT_SCENE` to `null`, so a missing key stops the render. Write a header comment per scene: its time range and, line by line, what happens. Run `pnpm typecheck` and `pnpm lint` after each scene.
4. **Self-check loop** (below), then fix.
5. **Render and hand off:** `pnpm render`, `pnpm preview`, `pnpm contact-sheet`. Report the output paths. For a concept composition, `pnpm render --composition=<id>` writes `out/<id>.mp4`; pass that to `pnpm preview` and `pnpm contact-sheet` with `--in` and `--out`. For a text-heavy master, add `--image-format=png` to `pnpm render`: cleaner type, about 50% slower, and much bigger (about 650 MB for 4:23).

No inspector rounds on scenes. The self-check is the review.

## 5. Self-check loop

`pnpm still` and `pnpm render` launch Chrome (including the composition's metadata step), so they need an unsandboxed run (`dangerouslyDisableSandbox: true`). `preview`, `contact-sheet`, and `jitter` don't launch Chrome (ffmpeg, plus numpy for `jitter`) and run inside the sandbox.

1. **List the check frames** from `src/data/sections.json` and `lyrics.json`:
   - each section's first frame and first frame + 8
   - each big hit and hit + 2
   - the frame where each line's last word lands, and the frame just after it for every line with g, j, p, q, or y, or punctuation at a mask edge
   - **the transition sweep:** the start, middle, and end of every transition, plus each shot's first two frames. Stills that all sit on settled shots miss what breaks between them: one run crashed on a clock that went negative before a section's start, and no settled still showed it.
   - the last frame of the video
2. **Render them** with `pnpm still --frame=<n> --out=out/wip-<pass>/f-<n>.png` (`<n>` is the absolute frame; add `--composition=<id>` for a concept). `out/wip-*` is scratch the lead offers to delete at the end.
3. **Look at every one** with the Read tool. Don't infer a frame from the code.
4. **Measure held text** on a render (a short `--frames` test is enough): `pnpm jitter --in <mp4> --from <frame> --frames <n> --crop x,y,w,h` over a held lyric. `--from` is a frame of the MP4 being measured (`--from=300`), or seconds into it with an `s` (`--from=10s`). On a full render that's the song frame. On a `--frames=<a>-<b>` render the file starts at 0, so subtract `<a>` (and `<a>`/fps from seconds): a lyric held from song frame 1350 in a `--frames=1200-1499` test is `--from=150`. Start `--from` after the line's last word has settled (that word's start frame plus the spring's settle frames; about 1 s later is safe), not at the line's start. It passes when the printed summary's mean shift is 0.01 px or less. `--max` gates the largest per-pair shift, so use it only as a loose guard (`--max=0.05`); a good render measured mean 0.008 px, max 0.011 px. Check every distinct text treatment, and quote the numbers in your report.
5. **Check readability:** every lyric on screen for at least 0.7 s, revealed at no more than about 17 characters per second.
6. **Fix, in this order:** a crash or a broken transition frame, text you can't read (size, contrast, clipping, overlap with a prop), a lyric that doesn't match the line sung at that frame, held text that moves, an empty or half-built frame, overlapping layers that weren't meant to overlap, then polish.
7. **Repeat** only on the frames you changed. Two passes is normal; stop when the frames and the numbers are clean.

## Known pitfalls

From the Kizen run:

- **A flash that washes out the frame.** A full-frame white flash at high opacity on a hit turns the hit frame, the one people screenshot, into a white sheet with the lyric unreadable. Keep flashes short and around 0.4 peak, or put the flash behind the text layer, and check the hit frame itself in the self-check.
- **Tiny props.** Small gag props read fine in the code and disappear at 1080p, and more so in the 720p preview. Make the joke the size of a word.
- **Empty caption panels at section starts.** A caption panel drawn from the section's first frame shows as an empty box until the first word stamps in. Bring the panel in with the first word, or don't use a panel.
- **Labels that aren't sung.** The lyric doc proposed a glowing core labelled "Knowledge bases" for "Teach it what you know"; the label wasn't sung, so the core shipped unlabelled. If it isn't sung, it isn't on screen.

From the GitHub run (`examples/github.md`):

- **One look for the whole song.** A single grid wall for 4.5 minutes was rejected after a full render. See "Variety" above, and offer a concept round when the song is long.
- **Pulsing on a ballad.** A per-beat scale throb was rejected as fighting the song. See "Rhythm" above.
- **Shimmering held lyrics.** Unsettled springs, lyrics inside the camera wrapper, and re-seeded grain over the text. See "Held text stays still" above.
- **A clock that goes negative.** A shot's local clock computed before its section starts went below zero and crashed the render mid-transition. Clamp local clocks at 0, and sweep transition frames.
- **An app-icon mascot.** A mascot in a squircle tile read as low-fi; the freestanding glass treatment from a three-way options sheet replaced it.
