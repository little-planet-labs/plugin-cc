---
name: scene-authoring
description: How the music-video director designs and builds a video's scenes so no two videos look alike. Covers creative/direction.md (one unifying visual system, varied inside it, never a new world per line) and the per-line beat map (creative/beatmap.md) before code, the optional concept round, the timing contract, text-led transitions (lyrics on their own layer with designed exits, world-only reveals underneath, hard cuts only on the biggest hits), the 0.5 s hook and 4 s change rules, motion, springs and easings, beat pulsing only where the genre fits or the brief asks, pixel-still held text, typography defects, phone legibility, safe areas, on-screen copy, determinism and React rules, the one-shot build, and the self-check on half-res drafts (critique sheets, pops, jitter) that feeds the critic loop, with known pitfalls. Use when writing direction.md, beatmap.md, concepts.md, or anything under src/scenes/ or src/concepts/.
user-invocable: false
---

# Scene authoring

The pipeline is shared; the look is not. Every video gets its own visual language, designed before any code and built in one pass. Load `music-video:remotion-pipeline` alongside this skill: it documents the full API (hooks, `resolveScene`/`SCENES`/`DEFAULT_SCENE`, the optional kinetic kit with `Backdrop` variants `black`, `deep`, `brand`, `neutral`, `light`, and `Logo`), the scripts, and the file layout. The optional motion kit in `src/components/motion/` is listed under "Motion" below. `examples/kizen.md` and `examples/github.md` are finished examples. **Don't copy their looks.**

## 1. Direction first: creative/direction.md

Write no scene code until the user has approved `direction.md`. Write the beat map (`creative/beatmap.md`, below) in the same pass, so the direction's ideas are pinned to frames before anything is built.

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

### One unifying system, varied inside it

This is a rule for every video. The direction defines **one unifying visual system**, a through-line that holds the whole video together:

- **a world** (where everything happens: a keynote stage, a paper desk, a terminal, a 3D city)
- **a material** (glass, paper, ink, chrome, flat colour)
- **a type system** (families, weights, case, how hits scale)
- **a palette logic** (which colour means what, and how it shifts as the song turns)
- **a motion language** (the 4 to 6 moves, and the transitions)

**Variety comes from transformations and staging inside that system:** new compositions, props, and camera moves, the system building and mutating as the song goes, a motif saved for the lyric that calls for it. How much it varies, and how often (per line or per section), is set by the direction. It never comes from swapping to an unrelated world. A video built as a new world per lyric line felt disconnected; a video that kept one visual system throughout and varied inside it felt connected (see `examples/github.md`).

Don't hold one static look for minutes, either: a single grid wall repainted for a whole song was rejected as dated and samey. Vary inside the system, as often as the direction sets, and the 4 s change rule (under "Pacing") holds whatever it sets.

This adopts the howseen-ai/claude-motion-design rule of one visual system from start to end, with transformations rather than cuts between unrelated looks. Its "one accent colour" part doesn't carry over: the palette is the brief's and the direction's call.

### What direction.md contains

1. **Summary**: three sentences a user can approve.
2. **Differs from**: the past directions and the dimensions this one changes.
3. **Visual language**: the unifying system (world, material, type system, palette logic, motion language) and how lines and sections vary inside it, the mascot or hero-graphic treatment when there is one, typography (families from brand.json, weights, case, tracking, how big hits get), motion vocabulary (the 4 to 6 moves this video uses, and the ones it never uses), colour treatment within the brand (which colour means what, how "before" and "after" differ if the song has a turn), camera feel, texture or medium, transitions between sections, and how humour lands visually (a sight gag on the punchline word, a stop-time freeze, a deadpan hold).
4. **Section plan**: one row per section in `src/data/sections.json` (instrumentals included), with its time range, energy, and concept: what's on screen, the hits it lands, and how it hands off to the next section.
5. **Alternates**: two contrasting directions in one line each, so the user can redirect without a new round.

The lead shows the user the summary and the alternates. ★ The user approves, redirects, or asks for a concept round. When the user redirects, revise `beatmap.md` with `direction.md`; after a concept pick, rewrite it for the chosen concept before extending it to the whole song.

### The beat map: creative/beatmap.md

The section plan says what each section is about. The beat map says what happens on every line, at which frame. Start it from the skeleton, then fill it in:

```sh
pnpm beatmap          # writes creative/beatmap.md; --force overwrites an existing one
```

The skeleton has the tempo and bars, candidate drops and accents from band-energy jumps, one row per lyric line with its frames and empty columns, and the layer list. Fill in:

- **Every line's row:** the world (what's on screen behind the text), the transition in, the text exit and its direction, and a one-off musical accent at a measured frame (a word, a drum fill, a stop-time hit). The exit direction matches the world transition that follows it (see "Text-led transitions").
- **The hard cuts**, each on a stop-time hit, a chorus downbeat, or the key change, with the frame.
- **The drops**, confirmed from the band-energy candidates, not guessed from the lyric tags, and **the key change**, which band energy can't show: mark it from the song itself and the lyric tags.
- **The layer list:** world → fx → lyric layer → overlays, and what lives in each.

The critic checks the build against this file, so keep it current when you change a line's treatment.

### Concept round (when the lead asks for one)

Users judge motion, not paragraphs. A concept round shows three looks moving before one gets built in full.

1. **Pitch three really different unifying systems** in `creative/concepts.md`: for each, a pitch, its world, material, typography, palette logic, motion, transitions, overlays, a line per section saying how the system varies there, and the cost and risk. End with a recommendation. Three variations of one system isn't a round, and neither is one concept that changes world every line.
2. **Pick the moments once.** List about 10 key lyric moments (the intro, the first line, the hook downbeat, a big joke, the bridge, the key change) with their absolute frames, in a table at the top of `concepts.md`. Every concept renders the **same** frames, so the sheets compare like for like, and each sheet shows its system varying across those moments while staying one piece.
3. **Build each concept as its own composition** under `src/concepts/<slug>/`, registered in `src/Root.tsx` with its own id. Shared concept code goes in `src/components/<kit-name>/`. Don't touch `src/scenes/` or the main composition, so an approved build stays intact.
4. **Render, per concept:**
   - a contact sheet of those moments (stills with `pnpm still --composition=<id> --frame=<n>`, tiled)
   - a 10 to 14 s motion test of the pre-chorus into chorus 1, with `pnpm render --composition=<id> --frames=<a>-<b>`. Stills can't show transitions or motion, and the pre-chorus into the hook has both.
5. **Self-check the sheets and the clips** before reporting: look at every sheet, and run `pnpm critique --in <clip> --tag <slug> --strips=<s,…>` and `pnpm pops --in <clip> --fail` on each motion test (section 5). A `--frames=<a>-<b>` clip starts at frame 0, but critique's default strips are song-time lyric and section starts, so pass `--strips` in clip-relative seconds: song seconds − `a`/fps. The same goes for `pops --cuts`: clip frames, song frame − `a`.

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

### Legibility at 1080p and on a phone

Most people watch on a phone, so design for a 360 px-wide frame and check it on the `phone_NN.png` critique tiles. The critic scores readability there.

- **Cap height at least 4.5% of the frame height**: about 49 px at 1080p. Body lyrics at least 72 px, normally 84 px, which clears it in most faces; check the cap height of a light or condensed face rather than trusting its font size. Hits 160 to 300 px. The preview is 720p, which shrinks everything by a third.
- **Contrast at least 4.5:1** between the glyphs and whatever is behind them within 12 to 20 px of their edges (a dilation of the glyphs), at that frame, not with the scene's base colour: check it over glows, particles, gradients, and flashes.
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
- **Lyrics inside camera, beat-punch, drift, or transition wrappers.** Anything that scales or moves the scene moves the text with it. In one build, whips blurred and slid the held lyric with the frame, zooms scaled and blurred it, and an iris covered it while it was still held.
- **Re-seeded grain drawn above the text.** Grain that changes every frame and sits over the type makes it crawl.

The layer order is: world, then fx, then the lyrics, then overlays. World and fx both go inside `WorldLayer`: the shots, the camera scale, `ShotTimeline`, `SubframeBlur`, `Shatter`, `CircleFlood`, and, as its top children, grain, vignette, and energy swells. The lyric (`MaskedWords`) goes in `LyricLayer`, rendered as a sibling after `WorldLayer`, never inside it, so nothing in the world reaches the text. Overlays (anything that must sit above the text) are rare: keep them static or one-off, never re-seeded grain, and return `null` from them when `useTextOnly()` is true. In the text-only render (`pnpm render --props='{"textOnly":true}' --out out/text-only.mp4`, input prop `textOnly: true`), `WorldLayer` draws opaque black instead of its children by itself and `LyricLayer` draws as usual, which is what `pnpm jitter --all-lines` measures. Text may still make deliberate moves: its entrance, a hit, its exit. Measure it with `pnpm jitter` (section 5). It passes when the mean shift is 0.01 px or less.

### Pacing: the hook and the 4 s rule

These are process rules for every video, whatever its look:

- **Hook by 0.5 s.** A subject and motion on screen by frame 15 (at 30 fps), even over a piano or ambient intro. Instrumentals still get no invented text; the hook is a picture that moves.
- **A visible change at least every 4 s**, carried by composition and musical events inside the unifying system: a new composition, a camera move, a world transition, a prop arriving, an accent on a real hit. Never by a rhythmic throb.
- **Nothing still for more than about 1 s**, except held lyric text, which must be pixel-still. Slow world drift, an incoming shot that's already moving (`useShotCamera`), or an energy swell keeps a shot alive without touching the text.
- **Dead stretches count.** In one run a critic flagged a 14 s intro and a 30 s outro with nothing happening. A long instrumental gets its own sequence of changes in the beat map.

### Text-led transitions

The lyric drives the cut, and the world follows it. This is what made the howseen-ai/claude-motion-design run's transitions read as designed: each line left with its own exit, on schedule, and then a world-only reveal ran underneath, often in the direction the words had left, with the next line riding above it.

- **Two layers.** Lyrics go on `LyricLayer`; the world goes on `WorldLayer`, and world transitions run only through `ShotTimeline`, a world-only transition player: each shot's `in` transition (`cut`, `wipe` with a blade edge, `diagonal`, staggered `bars`, `iris` with a colour ring, `zoom`, `whip`, `slices`, `split`, or `burn`) runs over the frames before that shot's `from` with both shots live. A world transition never touches the lyric layer.
- **Every line gets a designed exit.** `MaskedWords` takes an `exit`: `'fade'`, `'up'`, `'down'`, `'left'`, `'right'`, `'scatter'`, `'fall'`, `'blur'`, `'shrink'`, `'cut'`, or `{suckTo: [x, y]}` (a vortex into a point, in px within the line block's own box). The line is gone from E, the earliest of the next line's first word − 2 and `exitBy`; each word's exit (`exitFrames`, default 0.3 s, words `exitStagger` apart, default 0.035 s) ends by E. Set `exitBy` to the frame the world transition reaches the text, so the exit finishes before it. A short hold compresses the exit, and with no room at all it becomes a cut. If a scene changes these from their defaults, pass the matching `--exit-frames`, `--exit-stagger`, `--settle`, or `--stagger` to `pnpm jitter --all-lines`, which times each line's hold window from the defaults.
- **The exit's direction matches the world transition** that follows it. Starting points, not rules:

  | Text exit | World transition |
  |---|---|
  | `left` / `right` | a whip or a bladed wipe the same way |
  | `up` / `down` / `fall` | a wipe or staggered bars in that direction, or a diagonal |
  | `{suckTo: [x, y]}` | an iris opening from that point, or a `CircleFlood` with `contractTo` there |
  | `scatter` | a burn or a split |
  | `fade` / `blur` / `shrink` | a zoom-through or an iris |
  | `cut` | a hard cut |

- **Incoming text rides above the reveal.** The next line enters on the lyric layer while the world transition is still running beneath it, and is never clipped by the iris, wipe, or bars.
- **Never blur or scale held text inside a whip or zoom.** The world whips and zooms; the text has already left, or hasn't arrived. Text blurs only as its own exit (`'blur'`).
- **Animated transitions last 11 to 15 frames** (0.38 to 0.5 s at 30 fps) and carry the ordinary line changes.
- **Hard cuts are for the biggest hits:** stop-time hits, chorus downbeats, and the key change. Build into each with a push-in (the howseen run used 1.0 to 1.9) that peaks on the cut frame: cut at peak velocity, not at rest. The howseen run used 7 hard cuts in 262 s; the GitHub build used 1. List them in the beat map and pass their frames to `pnpm pops --cuts` so the scan doesn't flag them.

### Motion

Modern motion reads as designed, not as "things fading in". The template's optional motion kit (`src/components/motion/`) has the pieces: `springSettled`, `MaskedWords`, `Scrim`, `Grain`, `useEnergySwell`, `CircleFlood`, `logZoom`, `WorldLayer`, `LyricLayer`, `useTextOnly`, `ShotTimeline`, `useShotCamera`, `SubframeBlur`, and `Shatter`. Use what fits the direction.

- **Transitions with a source.** Zoom-throughs (the camera flies into an element and out into the next shot), circle floods from a source element, split panels, whip pans, masks, and shared-element handoffs, where a shape carries into the next shot. A word that carries over does it on the lyric layer.
- **Floods land on the hit.** On a stop-time hit, run a `CircleFlood` with `EASE_OUT` over about 0.3 s from 0.2 s before the hit, so it's mostly full on the hit, not a linear grow. `contractTo: {x, y, at, frames}` shrinks it to nothing at the next shot's hero element, so the eye lands where the next shot starts.
- **The incoming shot is already moving.** `useShotCamera(from, to, z0 = 1.08)` returns the world camera scale, settling in log space from `z0` at `from` (pass the shot's `start`) to exactly 1 at `to`. Scale a wrapper inside `WorldLayer` with it, never the lyric. Together with a `ShotTimeline` `in` transition, which renders the incoming shot live, the new shot arrives already moving. It's what makes a whip left end in a shot still travelling left.
- **Matched direction and speed across cuts.** A whip left ends in a shot already moving left at the same speed.
- **Motion blur on world transitions only.** `SubframeBlur` gives a 180° shutter to world moves; never on the lyric layer, and never across a hard cut. Seam blur on a full-frame world move is about 18 to 20 px.
- **Shatter, optionally, on a hit.** `Shatter` breaks world shapes and props apart on a real musical event, such as a hit effect behind the text. It's world-only: it lives in `WorldLayer`, which never holds the lyric and draws black in the text-only render. Lyric exits are only the `MaskedWords` exit kinds. Use it sparingly.
- **Camera zoom in log space** (`logZoom`): linear scale interpolation looks like it accelerates. Never zoom in and then straight back out.
- **Easings, never linear** for moves: `Easing.bezier(0.6, 0, 0.2, 1)` for moves between rests, `Easing.bezier(0.2, 0.8, 0.2, 1)` for entrances. Every easing returns exactly 0 and 1 at its ends.
- **Spring presets** (stiffness / damping, mass 1): snappy 320/30, default 170/26, heavy 120/24, and playful 180/12, which overshoots, so only on gag word entrances, never while text is held.

These motion and process ideas are adapted from howseen-ai/claude-motion-design (MIT). What we don't take from it:

- its one accent colour for the whole video (the palette is a per-video choice; its one-visual-system rule we do adopt, above)
- beat punches
- continuously moving gradients, or text that overshoots while held
- grain with an overlay blend
- all-caps faces that change the lyric's capitalisation
- its HTML and Playwright engine, chunked rendering, and loudness normalisation (Remotion and `pnpm render` stay)
- anything specific to its author

### Rhythm: pulse only when the track pounds

This is a rule for every video: **no beat-locked rhythmic pulsing by default on a slow song without heavy beats**, unless the brief asks for it. A per-beat or per-bar scale or brightness throb fought a slow ballad, and the user rejected it.

- **Sharp one-off moves on real musical events are fine** in any genre.
- **Repeating beat-locked pulsing** (the kinetic kit's `BeatPulse`, a scene-wide beat punch) only when the track has heavy, regular beats (dance, electro, rock with a four-on-the-floor kick) or the brief asks for it. Check the genre in `brief.json` and the low-band energy and onsets in `audio-analysis.json`.
- **For ballads and anything soft:** slow background movement on heavily smoothed energy (`useEnergySwell`), and single accents on real events: the hook downbeat, stop-time hits, the key change, an instrument's entrance.

### Mascots and graphics

The treatment of a mascot or hero graphic is a per-video choice: the direction names it (flat, illustrated, 3D, line art, glass, or something else that fits the look), and the critic checks the build against it. Whatever the treatment, keep it at one fidelity across every shot, and big enough to read at phone size. When the user dislikes an element after seeing it, pitch 2 or 3 treatments of just that element as an options sheet (see "Concept round"), rather than re-rendering the video to try again.

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

1. **Plan in direction.md and beatmap.md.** Every section's concept, every line's world, transition in, text exit, and accent, and every hard cut are written before code.
2. **Build this direction's primitives** in `src/components/<direction-name>/`: the 4 to 6 moves from the motion vocabulary, the text style, the backdrop. The template's `src/components/kinetic/*` and `src/components/motion/*` are optional; use a piece only when it fits the direction. The layer pair is not optional: lyrics on `LyricLayer`, the world on `WorldLayer`, world transitions through `ShotTimeline`.
3. **Build scenes section by section**, in song order, one folder per scene under `src/scenes/`, registered in `SCENES` in `src/scenes/registry.ts` under the scene keys `sections.json` uses. Then delete the placeholder and set `DEFAULT_SCENE` to `null`, so a missing key stops the render. Write a header comment per scene: its time range and, line by line, what happens. Run `pnpm typecheck` and `pnpm lint` after each scene.
4. **Draft rounds with the critic** (section 5): you render a half-res draft, run the checks, and report; the lead runs the `music-video:video-critic` agent on it; you fix its items. Repeat until it accepts. There's no round cap.
5. **Master render and hand off,** only after the critic's ACCEPT: `pnpm render`, `pnpm preview`, `pnpm contact-sheet`. Report the output paths. For a concept composition, `pnpm render --composition=<id>` writes `out/<id>.mp4`; pass that to `pnpm preview` and `pnpm contact-sheet` with `--in` and `--out`. For a text-heavy master, add `--image-format=png` to `pnpm render`: cleaner type, about 50% slower, and much bigger (about 650 MB for 4:23).

Scenes don't go to an inspector; they go to the critic. The builder can't judge its own work: in a howseen-ai/claude-motion-design run, the critic's first round caught text collisions during swaps, a dead 14 s intro, a dead 30 s outro, lyrics cropped by the top edge, a strobe, and a hard-edged card, all missed by the builder's still checks.

## 5. Self-check and the critique round

Judge rhythm, not sharpness: every round works from a half-res draft, and the full master comes last. `pnpm draft`, `pnpm still`, and `pnpm render` (the text-only render included) launch Chrome (including the composition's metadata step), so they need an unsandboxed run (`dangerouslyDisableSandbox: true`). `preview`, `contact-sheet`, `jitter`, `critique`, `pops`, and `beatmap` don't launch Chrome and run inside the sandbox.

Each round `n`:

1. **Render the draft:** `pnpm draft --out out/draft-r<n>.mp4`, a half-scale render through the audio-safe wrapper. Expect a few minutes for a full song; measure it on your first round. (The 3.5 minutes quoted for a 262 s draft came from the howseen engine, not from `pnpm draft`.)
2. **Render the critique sheets:** `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>`. It writes `out/critique/r<n>/`: `overview_NN.png` (a tile every 2 s, 270 px, 6×5 per sheet), `phone_NN.png` (a tile every 4 s, 360 px), and `strip_<seconds>.png` (12 frames from 0.1 s before each moment), all labelled with time and frame. Strips default to every lyric line start and section start. `--strips=<s,…>` (seconds) replaces the defaults, and a re-run of a tag removes that tag's older sheets, so put extra strips (the hard cuts, the biggest transitions) in a second tag: `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>-extra --strips=<s,…>`. These sheets replace most per-frame still sweeps.
3. **Look at every sheet** with the Read tool: the overviews for pacing and the 4 s rule, the phone tiles for readability, the strips for exits, transitions, collisions, and crops. Don't infer a frame from the code.
4. **Scan for pops:** `pnpm pops --in out/draft-r<n>.mp4 --cuts=<frame,…> --fail > out/critique/r<n>.pops.txt 2>&1`, and note the exit code. `--cuts` takes the beat map's hard cuts as song frames, each the first frame of the new shot. It finds pop spikes and one-frame flashes; a pop within ±1 frame of a listed cut is excused, a flash never is. In one run it caught three real bugs. It must pass before you report.
5. **Measure held text** at full scale (a half-scale draft can't show shimmer): `pnpm render --props='{"textOnly":true}' --out out/text-only.mp4` draws the lyric alone on black. Always pass `--out`: without it the render overwrites the main video. Then `pnpm jitter --all-lines --in out/text-only.mp4 > out/critique/r<n>.jitter.txt 2>&1`. It reports each line's mean and max shift over its hold window and `lines with motion during hold: N`. Every line passes at a mean shift of 0.01 px or less, and must before you report.
6. **Close-ups only where a sheet can't settle it:** a descender at a mask edge, the hit frame itself, a single transition frame. Use `pnpm still --frame=<n> --out=out/wip-r<n>/f-<n>.png` (`<n>` is the absolute frame; add `--composition=<id>` for a concept). `out/wip-*` is scratch the lead offers to delete at the end.
7. **Fix what the machine checks find** (a crash, a pop, a jitter failure) and re-draft until pops and jitter pass. Leave the judgement calls to the critic.
8. **Report the round** to the lead (the director agent's report lists what goes in it). The lead runs the critic.
9. **Fix the critic's items.** The 3 worst problems, plus every item in a category or section scored 7 or lower. **Regression guard:** don't touch a section the critic scored 9 or higher. Before fixing, copy the scene and component files you'll change to `out/snapshots/r<n>/`, so a regression can be put back. Then go to round `n + 1`.
10. **Version rule.** A new draft replaces the previous one only if the critic judges it better side by side. When it says the new draft is worse, put back the sections it names as regressed from the snapshot before fixing anything else.

The single-lyric jitter command is still there for a targeted check: `pnpm jitter --in <mp4> --from <frame> --frames <n> --crop x,y,w,h` over a held lyric. `--from` is a frame of the MP4 being measured (`--from=300`), or seconds into it with an `s` (`--from=10s`). On a full render that's the song frame. On a `--frames=<a>-<b>` render the file starts at 0, so subtract `<a>` (and `<a>`/fps from seconds): a lyric held from song frame 1350 in a `--frames=1200-1499` test is `--from=150`. Start `--from` after the line's last word has settled (that word's start frame plus the spring's settle frames; about 1 s later is safe), not at the line's start. It passes when the printed summary's mean shift is 0.01 px or less. `--max` gates the largest per-pair shift, so use it only as a loose guard (`--max=0.05`): a good render measured mean 0.008 / max 0.011 px with the earlier estimator, which read slightly high.

**Fix order,** within a round: a crash or a broken transition frame, a pop or flash, text you can't read (size, contrast, clipping, a crop at the frame edge, overlap with a prop or another line), a lyric that doesn't match the line sung at that frame, held text that moves, an empty or dead stretch, overlapping layers that weren't meant to overlap, then polish. Every lyric stays on screen at least 0.7 s, revealed at no more than about 17 characters per second.

## Known pitfalls

From the Kizen run:

- **A flash that washes out the frame.** A full-frame white flash at high opacity on a hit turns the hit frame, the one people screenshot, into a white sheet with the lyric unreadable. Keep flashes short and around 0.4 peak, or put the flash behind the text layer, and check the hit frame itself in the self-check.
- **Tiny props.** Small gag props read fine in the code and disappear at 1080p, and more so in the 720p preview. Make the joke the size of a word.
- **Empty caption panels at section starts.** A caption panel drawn from the section's first frame shows as an empty box until the first word stamps in. Bring the panel in with the first word, or don't use a panel.
- **Labels that aren't sung.** The lyric doc proposed a glowing core labelled "Knowledge bases" for "Teach it what you know"; the label wasn't sung, so the core shipped unlabelled. If it isn't sung, it isn't on screen.

From the GitHub run (`examples/github.md`):

- **One static look for the whole song.** A single grid wall held for 4.5 minutes was rejected after a full render as dated and samey. The fix that worked was one unifying system with variety inside it (see "One unifying system, varied inside it"), not a new world per line.
- **A new world per line.** A later build that swapped to an unrelated world for each lyric felt disconnected next to the version that kept one system throughout. Variety lives inside the system.
- **Pulsing on a ballad.** A per-beat scale throb was rejected as fighting the song. See "Rhythm" above.
- **Shimmering held lyrics.** Unsettled springs, lyrics inside the camera wrapper, and re-seeded grain over the text. See "Held text stays still" above.
- **A clock that goes negative.** A shot's local clock computed before its section starts went below zero and crashed the render mid-transition. Clamp local clocks at 0, and sweep transition frames.
- **A disliked element, re-rendered blind.** That user disliked the mascot's treatment; a three-way options sheet settled it without re-rendering the video. Which treatment they picked was their choice, not a default.

From the howseen comparison (`examples/github.md`):

- **Lyrics carried by world transitions.** Whips blurred and slid the held lyric, zooms scaled and blurred it, and an iris covered it while held. See "Text-led transitions".
- **Too few hard cuts.** One hard cut in a 4:23 song, against 7 in the howseen run, put on the stop-time hits and the key change with a push-in peaking into the cut.
- **Builder-only review.** Still checks by the builder missed collisions, crops, dead stretches, and a strobe that a separate critic caught in its first round. See section 5.
