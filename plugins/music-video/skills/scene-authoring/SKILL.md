---
name: scene-authoring
description: How the music-video director designs and builds a video's scenes on the HTML page engine. Covers creative/direction.md (a named reference, one unifying visual system varied inside it) and the per-line beat map before any code, the concept round as alternate scene registries, the timing contract, the layer stack, lyrics through ctx.lyric with designed exits, text-led transitions, cut seams and subframe motion blur, motion and spring rules, pacing (the 0.5 s hook and the 4 s change rule), beat pulsing only where the track pounds or the brief asks, readability and caption rules, safe areas, on-screen copy, determinism and capture hygiene, the one-shot build, and the draft rounds (stills, critique sheets, pops, still-test, jitter) that feed the critic loop, with machine-load limits and known pitfalls. Use when writing direction.md, beatmap.md, concepts.md, or anything under src/scenes/ or src/concepts/.
user-invocable: false
---

# Scene authoring

The pipeline is shared; the look is not. Every video gets its own visual language, designed before any code and built in one pass. Load `music-video:video-pipeline` alongside this skill: it documents the page engine, the scene API (`ctx`), every script and flag, the data files, and the gotchas. This skill is how to use them well. `examples/kizen.md` and `examples/github.md` are finished examples. **Don't copy their looks.**

The engine and much of the method below are adapted from howseen-ai/claude-motion-design (MIT; see the template's `NOTICE.md`).

## 1. Direction first: creative/direction.md

Write no scene code until the user has approved `direction.md`. Write the beat map (`creative/beatmap.md`, below) in the same pass, so the direction's ideas are pinned to frames before anything is built.

### Check what's been done

The lead passes you past directions in the brief: vault entries tagged `music-video-direction` when Cadence is connected, otherwise what the user said. If the brief has none and you have Cadence, run `list_knowledge` with `tag: "music-video-direction"` yourself. The new direction must differ from each past one on at least three of: typography approach, motion vocabulary, texture or medium, camera feel, and transitions. Name them in the "Differs from" line. This is about videos, not scenes: inside one video, the scenes share one system (below). You don't write to the vault; the lead logs your direction after delivery.

### Reference first

A direction starts from a **named reference style**: something a person can picture ("a 1986 airbrushed album cover", "a Swiss transit poster", "a late-night terminal session"), never an adjective like "premium" or "modern".

When the user gives a reference video or frames (`brief.reference`, with the files under `creative/reference/`), study it before writing anything:

```sh
mkdir -p out/reference
ffmpeg -i creative/reference/<file> -vf "fps=2,scale=270:-1,tile=6x5" out/reference/sheet_%02d.png
```

That is a frame every 0.5 s. Read every sheet, then write `creative/style-guide.md`: palette (hex values), type (families, weights, case, sizes), shot lengths, transitions, camera, texture, and how text comes in and goes out. **Take the grammar, never the content or the logos.** The direction cites the style guide.

### Derive it

Pull from three inputs and say in the doc how each one shaped the result:

- **The brand** (`src/brand.json`, and the vivid palette in the Brand section of `research.md`): which colours carry the video, and what the brand's own UI and site feel like (dense and technical, soft and friendly, editorial).
- **The song** (`lyrics.md`, `src/data/audio-analysis.json`): genre, BPM, the energy curve across sections, where the jokes land.
- **The company's personality** (`research.md`, `brief.tone`): who they sell to and how they talk.

`brief.visualStyle`, when set, is the user's own words about the look. Treat it as a requirement and quote it in the summary. `brief.logoUse` decides whether the logo appears at all: when it's `"omitted"`, no `ctx.logo` and no company mark, redrawn or not. `brief.hardRules` are the user's rules, verbatim; the critic checks every one.

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
| Liquid gradients | Rounded sans, soft weights | Morphing blobs, soft springs | Mesh gradients from the brand palette |

Mix and invent. A direction is good when you can describe a still from it in one sentence and nobody would mistake it for the last video.

### One unifying system, varied inside it

This is a rule for every video. The direction defines **one unifying visual system**, a through-line that holds the whole video together:

- **a world** (where everything happens: a stage, a paper desk, a terminal, a 3D city)
- **a material** (glass, paper, ink, chrome, flat colour)
- **a type system** (families, weights, case, how hits scale)
- **a palette logic** (which colour means what, and how it shifts as the song turns)
- **a motion language** (the 4 to 6 moves, and the transitions)

**Variety comes from transformations and staging inside that system:** new compositions, props, and camera moves, the system building and mutating as the song goes, a motif saved for the lyric that calls for it. How much it varies, and how often (per line or per section), is set by the direction. It never comes from swapping to an unrelated world, and no rule says each scene must look different from the others. A video built as a new world per lyric line felt disconnected; a video that kept one visual system throughout and varied inside it felt connected (see `examples/github.md`).

Don't hold one static look for minutes, either: a single grid wall repainted for a whole song was rejected as dated and samey. Vary inside the system, as often as the direction sets, and the 4 s change rule (under "Pacing") holds whatever it sets.

The palette is the brief's and the direction's call: there's no one-accent-colour rule.

### What direction.md contains

1. **Summary**: three sentences a user can approve. It passes the **one-sentence test**: someone who saw the video muted could say what it's about in one sentence. The critic restates the message from the frames alone each round.
2. **Reference**: the named reference style, and `creative/style-guide.md` when there's a reference video.
3. **Differs from**: the past directions and the dimensions this one changes.
4. **Visual language**: the unifying system (world, material, type system, palette logic, motion language) and how lines and sections vary inside it; the mascot or hero-graphic treatment when there is one; typography (families from brand.json, weights, case, tracking, how big hits get); motion vocabulary (the 4 to 6 moves this video uses, and the ones it never uses); colour treatment within the brand (which colour means what, how "before" and "after" differ if the song has a turn); camera feel; texture or medium; transitions between sections; and how humour lands visually (a sight gag on the punchline word, a stop-time freeze, a deadpan hold).
5. **Section plan**: one row per section in `src/data/sections.json` (instrumentals included), with its time range, energy, and concept: what's on screen, the hits it lands, and how it hands off to the next section.
6. **Alternates**: two contrasting directions in one line each, so the user can redirect without a new round.

The lead shows the user the summary and the alternates. ★ The user approves, redirects, or asks for a concept round. When the user redirects, revise `beatmap.md` with `direction.md`; after a concept pick, rewrite it for the chosen concept before extending it to the whole song.

### The beat map: creative/beatmap.md

The section plan says what each section is about. The beat map says what happens on every line, at which frame. Start it from the skeleton, then fill it in:

```sh
pnpm beatmap          # writes creative/beatmap.md; --force replaces an existing one
```

The skeleton has the tempo, beat and bar length; candidate drops (the three bands averaged, a rise of 6 dB or more over 1 s windows) and candidate accents (per band, 12 dB or more over 0.1 s windows, the 24 largest); the sections with their frames; one row per lyric line with empty world, transition-in, text-exit and one-off-accent columns; and World layer and Lyric layer headings. Fill in:

- **Every line's row:** the world (what's on screen behind the text), the transition in, the text exit and its direction, and a one-off musical accent at a measured frame (a word, a drum fill, a stop-time hit). The exit direction matches the world transition that follows it (see "Text-led transitions").
- **The drop on the key visual moment.** Confirm the drops from the band-energy candidates, not from the lyric tags, and put the largest on the video's biggest visual idea (a flood, a reveal, the hook). Mark **the key change** from the song itself and the lyric tags: band energy can't show it.
- **The hard cuts**, each on a stop-time hit, a chorus downbeat, or the key change, with the frame.
- **The layers:** what lives in `#world` (scenes, camera, transitions, shatter), `#fx` (grain, vignette), `#txt` (the lyrics, nothing else) and `#over` (a flash over everything, rare).

The critic checks the build against this file, so keep it current when you change a line's treatment.

### Concept round (when the lead asks for one)

Users judge motion, not paragraphs. A concept round shows three looks moving before one gets built in full. Each concept is an **alternate scene registry**: the page loads it instead of `src/scenes/index.js` through its `scenes=` query, and every script that captures the page takes it as `--scenes=<module>`.

1. **Pitch three really different unifying systems** in `creative/concepts.md`: for each, a pitch and its named reference, its world, material, typography, palette logic, motion, transitions, a line per section saying how the system varies there, and the cost and risk. End with a recommendation. Three variations of one system isn't a round, and neither is one concept that changes world every line.
2. **Pick the moments once.** List about 10 key lyric moments (the intro, the first line, the hook downbeat, a big joke, the bridge, the key change) with their absolute frames and seconds, in a table at the top of `concepts.md`. Every concept renders the **same** frames, so the sheets compare like for like, and each sheet shows its system varying across those moments while staying one piece.
3. **Build each concept as its own registry.** `src/concepts/<slug>.js` exports `SCENES` and `DEFAULT_SCENE` exactly as `src/scenes/index.js` does; its scene modules live in `src/concepts/<slug>/`, and code the concepts share goes in `src/concepts/shared/`. Name the registry after the concept, never `index.js`: renders of an alternate registry are named after the module's basename (`out/<slug>.mp4`). Build the sections the moments and the motion test touch, and give the registry a plain `DEFAULT_SCENE` of its own for the rest that registers its section's lines (`for (const line of ctx.lines) ctx.lyric(line.id, {})`), because a render fails boot on any sung line no scene registered. Don't touch `src/scenes/`. Run `pnpm check --scenes=src/concepts/<slug>.js` after each change.
4. **Render, per concept, one concept at a time** (one heavy render on the machine at once):
   - **Stills of the moments**, one per frame, then tiled into one sheet:

     ```sh
     pnpm still --scenes=src/concepts/<slug>.js --frame=<n> --out=out/concepts/<slug>/f-<n as 6 digits>.png
     ffmpeg -y -pattern_type glob -i 'out/concepts/<slug>/f-*.png' -vf "scale=640:-1,tile=5x2" -frames:v 1 out/concepts/<slug>-sheet.png
     ```

   - **A 10 to 14 s motion test** of the pre-chorus into chorus 1. Stills can't show transitions or motion, and the pre-chorus into the hook has both. Iterate on it with `pnpm draft --scenes=src/concepts/<slug>.js --frames=<a>-<b> --out out/concepts/<slug>-draft.mp4` (960x540, seconds to render), then render the clip the user sees at 1080p with its motion blur: `pnpm render --scenes=src/concepts/<slug>.js --frames=<a>-<b> --scale=1 --out out/concepts/<slug>-motion.mp4` (about 0.37 s per frame per worker, a few minutes for 14 s at pool 2).
5. **Self-check the sheets and the clips** before reporting: look at every sheet, and run `pnpm critique --in out/concepts/<slug>-motion.mp4 --tag <slug>` and `pnpm pops --in out/concepts/<slug>-motion.mp4 --cuts=auto --fail` on each motion test (section 5). A partial render carries its `firstFrame` in its manifest, so critique labels and default strips are in song time and `--cuts=auto` reads the clip's own cuts; nothing needs converting.

After the user picks, rewrite `beatmap.md` for the chosen concept and **promote it**: move its modules into `src/scenes/` and its entries into `src/scenes/index.js`, then extend it to the whole song as the normal build (section 4). From there every default works: `pnpm render` writes the master, and the QA scripts find it. Leave the other concepts' files in `src/concepts/` for the lead's cleanup. When the user dislikes one element of the pick (a mascot, a graphic, a transition), pitch 2 or 3 treatments of just that element as an in-context options sheet with a short clip of each, and re-render the video only after they pick.

## 2. Timing contract

- **Song seconds, snapped to frames.** `draw(t, ctx)` gets absolute song seconds, and frame `n` is the page at exactly `n / fps`. Section times, beats, downbeats, word reveals, cuts and blur windows are all `k / fps` values. Use `ctx.frameTime(s)` for any time you compute, and `ctx.progress(t, t0, dur, ease)` for any move: it's exactly 0 before `t0` and exactly 1 from `t0 + dur`.
- **Draw from `t`, never from a counter or a previous draw.** Seeking backwards, skipping frames, or capturing frame 4000 first must give the same pixels. `ctx.state` is for what `setup` builds; `draw` reads it and never writes to it.
- **Beats belong to sections by rounded frame**, never by comparing seconds. `ctx.beats` and `ctx.downbeats` are this section's, already chosen that way; `ctx.song.beats` and `ctx.song.downbeats` are the whole song's. Never filter beats by seconds yourself, or a beat on a boundary lands in both sections or neither.
- **Hit downbeats.** The big moves (a section's first hit, the name on the hook, a cut) land on downbeats from the analysis. Smaller accents use beats, word starts, or the beat map's candidate accents.
- **Anticipate the impact.** The impact is on the beat or word frame; the wind-up (a squash, a pull-back, a dim) starts 3 to 6 frames before it (0.1 to 0.2 s at 30 fps). An entrance that starts on the beat reads late.
- **The active lyric matches the sung line.** The engine shows each word on its own sung frame and clears each line at least 2 frames before the next line's first word, so register every line and let the schedule run. Don't push words early with `lead` unless the beat map says why. Line ids are `<sectionId>-<n>` (`verse-1-3`), and a line repeated within its section gets `-r2`, `-r3` (`chorus-1-1-r2`). Never show a line that wasn't sung.
- **Sections come from the lyric tags.** A kind that repeats (two choruses) shares one scene key and gets `ctx.section.variant` `"1"`, `"2"`; make the later one a payoff rather than a copy. Instrumentals are scene `instrumental` with variant `lead-in`, `break`, or `tail`.
- **Instrumentals get motion, not text.** Give them visuals driven by `ctx.energy`, `ctx.swell`, and the beats. No invented words. The logo is allowed unless `brief.logoUse` is `"omitted"`. A long instrumental (a 30 s tail) needs its own visual idea in the plan, not a held frame.
- **Section times come from `sections.json`**, never from the lyric plan. Make every section stretch: derive positions from `ctx.section.start`, `ctx.section.end` and the beats, not from fixed numbers.
- **Draw before the start when you need to.** `pre` and `post` on the scene definition let `draw` run before the section starts and after it ends, and the engine already widens the span to cover the incoming transition and the next one. A local clock (`t - ctx.section.start`) goes negative in that span: clamp it, or use `ctx.progress`.

## 3. Craft

### The layers

| Layer | Holds | Rule |
|---|---|---|
| `#world` | Every section's root: backdrops, props, camera, transitions, shatter, shake | All scene drawing goes here, through `ctx.el` and `ctx.canvas`. |
| `#fx` | Grain and vignette, set per draw with `ctx.setFx` | Under the text, so grain never crawls over a held word. |
| `#txt` | The lyrics, drawn by the engine from `ctx.lyric` | Nothing else. Camera, shake, shatter and transitions throw if given a text element. |
| `#over` | `ctx.flash` over everything | Rare. Off in text-only renders. |

A sung word drawn with `ctx.el` or on a world canvas escapes the exit rule, the text-only render, `still-test` and `jitter --all-lines`, and moves with the camera. It's a defect even when it looks right.

The engine rewrites each section root's transform, clip, opacity and filter on every seek for transitions. Never transform `ctx.root`: put one full-page container inside it and move that (`ctx.applyCamera(container, k)`).

### Readability at 1080p and on a phone

Most people watch on a phone, so design for a 360 px-wide frame and check it on the `phone_NN.png` critique tiles. The critic scores readability there.

- **Cap height at least 4.5% of the frame height**: about 49 px at 1080p. The theme's lyric size is 84 px (`theme.sizes.lyric`) and the small size 72 px; check the cap height of a light or condensed face rather than trusting its font size. Hits run `theme.sizes.hit` to `hitMax` (200 to 300 px). The preview is 720p, which shrinks everything by a third.
- **Contrast at least 4.5:1** between the glyphs and whatever is behind them within 12 to 20 px of their edges (a dilation of the glyphs), at that frame, not against the scene's base colour: check it over glows, particles, gradients, and flashes. `src/lib/color.js` has `contrast(a, b)`.
- **Caption timing.** Each lyric stays on screen at least 0.7 s, and text reveals no faster than about 17 characters per second. A word lights on its sung frame, never before, and stays readable for at least 12 frames once it's in. The boot warns about a word that would be on screen for one frame at almost no opacity; treat that warning as a defect.
- **Capitalisation comes from the lyrics.** Leave `uppercase` off: the critic checks the screen text against `lyrics.json` character for character. When the direction wants caps, the lead has the lyricist write the screen lyrics that way.
- Props that carry a joke are at least 200 px on their long side. A gag nobody can see is a missing gag.

### Type that holds up

These defects shipped in earlier runs and were caught late:

- **Clipped descenders.** The engine's word masks leave 0.45em below the line for g, j, p, q and y. A mask or a `background-clip: text` gradient box of your own needs the same room, and must cover the full glyph extent.
- **Hard-edged bands behind wrapped lines.** A dark band per line shows as stacked slabs with hard edges. Put one soft, feathered scrim behind the whole block, drawn on a world canvas (a radial or blurred gradient), not a box per line.
- **Stranded single words.** A last row holding one word looks like a mistake. `balance` is on by default; use `breaks` (word indices that start a row) when it isn't enough.
- **Variable-font outlines.** A stroke on a variable font draws its internal contours (an H reads as "l-l"). Use a hard offset shadow (`css` or `wordCss`) instead.
- **Sharp text through a handoff.** Never scale a blurred copy of text; crossfade only its fill.

### Held text stays still

Once a word has landed, it doesn't move by a pixel until its exit starts. Sub-pixel shimmer on held type looks like a cheap encode, and viewers notice it on a ballad more than anywhere. The engine holds every word with no transform, opacity exactly 1 and no filter from its settle time to its exit, and its springs land on exactly 1, so the remaining causes are yours:

- a sung word drawn outside `ctx.lyric` (in the world, under the camera)
- `css` or `wordCss` that changes with time
- something in `#over` above the text that changes every frame

Text may still make deliberate moves: its entrance, a hit, its exit. `pnpm still-test` checks every word over its own hold window, and `pnpm jitter --all-lines` measures each line on a rendered video (section 5).

### Pacing: the hook and the 4 s rule

These are process rules for every video, whatever its look:

- **Hook by 0.5 s.** A subject and motion on screen by frame 15 (at 30 fps), even over a piano or ambient intro. Instrumentals still get no invented text; the hook is a picture that moves.
- **A visible change at least every 4 s**, carried by composition and musical events inside the unifying system: a new composition, a camera move, a world transition, a prop arriving, an accent on a real hit. Never by a rhythmic throb.
- **No frozen frames.** Nothing on screen is still for more than about 1 s, except held lyric text, which must be pixel-still. Keep a slow drift, a settle, or an energy swell alive in the world, on an end card too.
- **Dead stretches count.** In one run a critic flagged a 14 s intro and a 30 s outro with nothing happening. A long instrumental gets its own sequence of changes in the beat map.

### Text-led transitions

The lyric drives the change, and the world follows it: each line leaves with its own exit, on schedule, then a world-only reveal runs underneath, often in the direction the words left, with the next line riding above it.

- **Two layers.** Lyrics go through `ctx.lyric`; world transitions go through `ctx.transition` on the incoming section. A transition plays over the frames before its section starts (`at` defaults to the start minus `dur`), with both sections live, so the new section is whole on its first frame. It never touches `#txt`.
- **Every line gets a designed exit** (`exit`): `fade`, `up`, `down`, `left`, `right`, `fall`, `blur`, `scatter`, `shrink`, `cut`, `suck` (into `suckTo`), or `{suck: [x, y]}`. The engine keeps the requested exit when it fits, re-anchors or compresses it when it doesn't, and cuts it with no room left; a line is always gone 2 frames before the next line's first word. Set `exitBy` to the time the world transition reaches the text, so the words are gone before it. `pairWith` shows two lines together and clears them for the line after. `lines()` on `window.__mv` gives the schedule the engine settled on.
- **The exit's direction matches the world transition** that follows it. Starting points, not rules:

  | Text exit | World transition |
  |---|---|
  | `left` / `right` | `whip` the same way, or `wipe` with an `edge` blade |
  | `up` / `down` / `fall` | `wipe` from the matching side, `bars` (with `vertical`), or `diagonal` |
  | `suck` to a point | `circle` from that point, or a `circle` with `contractTo` there |
  | `scatter` | `bars`, or a world `ctx.shatter` on the hit |
  | `fade` / `blur` / `shrink` | `zoom` through a point, or `circle` |
  | `cut` | `cut` |

- **Incoming text rides above the reveal.** The next line enters on `#txt` while the world transition is still running beneath it, and nothing in the world can clip it.
- **Exits accelerate away, entrances decelerate in.** The lyric exits already ease in; do the same for world elements that leave, and bring arrivals in on `o5`, `enter` or a spring. Never key a move in visible steps.
- **Animated transitions last 11 to 15 frames** (0.38 to 0.5 s at 30 fps; the default is 0.4 s) and carry the ordinary line changes.
- **Hard cuts are for the biggest hits:** stop-time hits, chorus downbeats, and the key change. List them in the beat map, and make each one with a `cut` transition, `cut: true` on the scene, or `ctx.cut(t)` inside a section. A section with no incoming transition starts with a hard cut too, so give every other section a transition.

### Seams and cuts

- **Cut on movement, at peak velocity**, not at rest. Build into each hard cut with a push-in that peaks on the cut frame (the howseen-ai run used a camera zoom of 1.0 to 1.9).
- **Direction and speed match on both sides.** A whip left ends in a section already travelling left at the same speed; a zoom keeps the sign of its scale change across the cut.
- **The incoming section is already moving.** Start its camera keys before its start (`ctx.camera` holds before the first key and after the last) so its first frame is mid-move, settling after. It's what makes a whip land in a shot that's still travelling.
- **Shared elements carry the handoff.** A shape that leaves one section and becomes the next one's hero reads as designed: draw it in both sections over the transition's span (`post` on the outgoing scene keeps it alive).
- **Floods clear the frame.** A `circle` transition grows to the farthest corner × 1.05; give it about 0.3 to 0.35 s and land it mostly full on the hit, then `contractTo` the next section's hero element so the eye lands where the next shot starts.
- **Never zoom in and straight back out**, and zoom through `ctx.camera` keys, which interpolate zoom in log space (linear scale looks like it accelerates).
- **Every declared cut is excused by `pops --cuts=auto`**; any other pop is a seam bug. A pop next to a section start you didn't plan as a cut means that section has no transition.

### Subframe motion blur

The master renders motion blur only inside windows you declare: `ctx.blur(a, b, samples)`, or `blur: N` on a transition. Frame `n` inside a window is the exact average of N captures spread over half a frame (`render.shutter` 0.5, a 180° shutter); everywhere else a frame is one capture.

- **Blur only the one to three slam moves that need it.** Pick samples from the fastest element's speed: about 4 up to 20 px per frame, `ceil(px / 5)` above that, at most 16. A move slower than one element width per frame needs none.
- **Seam blur scales with size:** about 10 px for a moving word block's travel per frame, 18 to 20 px for a full-frame world move.
- **Never across a hard cut.** A cut strictly inside a window fails boot; end the window at the cut.
- **Never blur text meant to be read.** A window averages the whole page, `#txt` included: held words are identical in every sample and stay sharp, but a word entering or leaving inside the window smears. Put windows where no word is mid-entrance.
- **Drafts never blur**, and every sample is a full capture, so a window costs N times its frames in the master. Check blur on `pnpm still --frame=<n> --scale=2` (stills capture blur windows as the master does) or a short `pnpm render --frames=<a>-<b> --scale=1`.

### Motion

Modern motion reads as designed, not as "things fading in".

- **Easings, never linear** for moves. `src/lib/ease.js` `EASE`: `cam` (cubic-bezier .6, 0, .2, 1) for moves between rests, `enter` (.2, .8, .2, 1) for entrances, plus `io`, `out`, `in`, `o5`, `expo`, `sine`, `qio`. Every easing is exactly 0 and 1 at its ends.
- **Springs** from `src/lib/springs.js`: `spring(t, at, spec)` with the presets `snappy`, `default`, `heavy`, and `playful`, or `{freq, damping}`. Damping below 0.72 is refused unless you pass `{allowBounce: true}`: nothing in a lyric video bounces like a cartoon. `playful` only on gag-word entrances.
- **One primary move at a time** per shot, so the eye knows where to look; secondary motion (a drift, a swell) stays slow. The direction can break this on purpose for a payoff.
- **Camera:** `ctx.camera([[t, zoom, x, y], ...], ease)` returns a function of `t`; apply it with `ctx.applyCamera(container, k)` or `ctx.cameraOnCanvas(c2d, k)`. World only.
- **Shake and shatter on real hits.** `ctx.shake(el, t, {at, amp, dur, freq, rot, seed})` is exactly 0 outside its window. `ctx.shatter({at, x, y, seed, flash})` breaks a world source canvas (`ctx.canvas({offscreen: true})`) into 64 seeded shards. Use them sparingly, world only.
- **Flashes:** `ctx.flash(t, {at, peak, decay})` sits over everything, text included, so keep the peak around 0.4 and short. For a flash behind the text, draw it on a world canvas with `flashAmount` from `src/lib/pulse.js`.

### Rhythm: pulse only when the track pounds

This is a rule for every video: **no beat-locked rhythmic pulsing by default on a slow song without heavy beats**, unless the brief asks for it. A per-beat or per-bar scale or brightness throb fought a slow ballad, and the user rejected it.

- **Sharp one-off moves on real musical events are fine** in any genre.
- **Repeating beat-locked pulsing** (`pulse(ctx.sinceBeat(t))` or `pulse(ctx.sinceDownbeat(t))` driving scale or brightness on every beat, a scene-wide beat punch) only when the track has heavy, regular beats (dance, electro, rock with a four-on-the-floor kick) or the brief asks for it. Check the genre in `brief.json` and the low-band energy and onsets in `audio-analysis.json`. The template's placeholder scene kicks its glow on each downbeat; don't carry that into a slow song.
- **For ballads and anything soft:** slow background movement on `ctx.swell(t)` (a bar-long smoothed energy with no beat ripple), and single accents on real events: the hook downbeat, stop-time hits, the key change, an instrument's entrance.

### Mascots and graphics

The treatment of a mascot or hero graphic is a per-video choice: the direction names it (flat, illustrated, 3D, line art, glass, or something else that fits the look), and the critic checks the build against it. Whatever the treatment, keep it at one fidelity across every shot, and big enough to read at phone size. When the user dislikes an element after seeing it, pitch 2 or 3 treatments of just that element as an options sheet (see "Concept round"), rather than re-rendering the video to try again.

### Safe areas

From `ctx.theme.safe`, at 1080p:

- Keep all text inside action-safe: 96 px from the left and right edges, 54 px from the top and bottom (`safe.action`).
- Keep lyrics and the logo inside title-safe: 192 px and 108 px (`safe.title`). The lyric layout defaults to it. Players draw controls over the bottom of the frame.

### On-screen copy

Only three kinds of text appear: **the sung lyrics**, **exact feature names** as spelled in `research.md` (when the lyric sings them), and **the logo** (`ctx.logo`, as `brief.logoUse` allows). No taglines, no labels on diagrams, no captions, no UI chrome with fake copy, no debug text. A label you want to add is a label that wasn't sung: drop it.

### Colours, fonts, and tokens

- Colours, fonts, weights, sizes and safe areas come from `ctx.theme`, which the engine builds from `brand.json`. Never hard-code a hex in a scene.
- A vivid-palette colour from the Brand section of `research.md` that the direction uses goes in one tokens module in the scenes folder (`src/scenes/tokens.js`), each with its source in a comment, and scenes import it from there.
- Only `brand.json`'s font families load. A direction that needs another family asks the lead: it goes into `brand.json` and `pnpm fonts` downloads it.

### Determinism and capture hygiene

Every frame must be the same however often and in whatever order it is seeked. `pnpm check` scans `src/**` and `index.html` and prints `file:line` for each breach:

- Seeded randomness only: `ctx.rng(seed)` or `src/lib/rng.js` (`rng`, `hash`, `noise1`, `fbm`).
- No `Date`, `performance.now`, `Math.random`, `crypto` randomness, `setTimeout`, `setInterval`, `requestIdleCallback`, `element.animate()`, or `requestAnimationFrame`.
- No CSS `transition`, `animation` or `@keyframes`, and no blend modes (`mix-blend-mode`, `background-blend-mode`, `plus-lighter`, canvas composite ops beyond `source-over` and the alpha masks). Blended layers composite as grey slabs in headless Chromium.
- No libraries that animate in real time. An idea from one gets ported to a function of `t`.
- No network at render time. Images come from project files: load them in an `async setup` and `await img.decode()` before it returns.
- The canvas resets on every seek: `ctx.canvas().get()` hands back a cleared context with no state, so set everything you need in each draw.
- Scene modules don't touch the DOM at import time: `pnpm check` imports them in Node.
- Give every element a `z`; children of a hidden parent use `visibility: inherit`, not `visible`. Measure text with canvas `measureText`, not DOM rects, when a camera scale applies, and never put `will-change` on an element the camera scales.

The capture waits for `document.fonts.ready`, kills CSS transitions, pauses animations, and waits two `requestAnimationFrame`s after every seek. That's a safety net, not permission.

## 4. One-shot build

1. **Plan in direction.md and beatmap.md.** Every section's concept, every line's world, transition in, text exit, and accent, and every hard cut are written before code.
2. **Build this direction's primitives** as plain modules beside the scenes (`src/scenes/<direction-name>/`): the 4 to 6 moves from the motion vocabulary, the backdrop, any shared drawing. The engine already gives you the lyric entrances and exits, transitions, camera, shake, shatter and blur; build only what the direction adds.
3. **Build scenes section by section**, in song order, one module per scene key under `src/scenes/`, registered in `SCENES` in `src/scenes/index.js` under the keys `sections.json` uses. A scene module default-exports `{setup(ctx), draw(t, ctx)}`, plus optional `pre` and `post` (seconds `draw` runs before the start and after the end) and `cut: true` (every section of the scene starts on a hard cut); `setup` may be async. Repeats of a key differ through `ctx.section.variant`. Write a header comment per scene: its time range and, line by line, what happens. Run `pnpm check` after each scene.
4. **Every line registered once.** Each sung line is registered by exactly one scene (`ctx.lyric(line.id, style)`, usually over `ctx.lines`). A render fails boot naming any line no scene registered.
5. **Finish the registry.** Register every key, delete `src/scenes/placeholder.js`, and set `DEFAULT_SCENE = null`, so a missing key stops the boot.
6. **Stills before any video.** Capture the beat map's moments with `pnpm still --frame=<n> --out=out/wip-1/f-<n>.png`: each section start and start + 8 frames, each hit and hit + 2, each line's last word. Open every one with the Read tool and fix what's wrong. Don't infer a frame from the code.
7. **Draft rounds with the critic** (section 5): you render a half-res draft, run the checks, and report; the lead runs the `music-video:video-critic` agent on it; you fix its items. Repeat until it accepts. There's no round cap.
8. **Master render and hand off,** only after the critic's ACCEPT: `pnpm render` (in the background), then `pnpm preview` and `pnpm contact-sheet`. Report the output paths.

Scenes don't go to an inspector; they go to the critic. The builder can't judge its own work: in a howseen-ai/claude-motion-design run, the critic's first round caught text collisions during swaps, a dead 14 s intro, a dead 30 s outro, lyrics cropped by the top edge, a strobe, and a hard-edged card, all missed by the builder's still checks.

## 5. Self-check and the critique round

Judge rhythm, not sharpness: every round works from a half-res draft, and the full master comes last.

**Sandbox.** `still`, `draft`, `render`, `still-test`, `jitter --all-lines` and `test:render` launch headless Chromium, which can't start inside the Claude Code Bash sandbox: run each of those with the sandbox disabled for that command (`dangerouslyDisableSandbox: true`). `check`, `beatmap`, `critique`, `pops`, single-window `jitter`, `preview` and `contact-sheet` run inside it.

**Machine load.** One heavy render on the machine at a time: never a draft, a text-only render, a concept clip or the master alongside another render, `still-test`, or alignment. The render pool runs at most `render.pool` workers (2 by default, each a Chromium plus an x264 encoder); `--pool=<n>` changes it for one run, and above 2 prints a warning. Don't raise it unless the lead says so. Measured at pool 2:

| Render | Speed | A 4:23 song (7880 frames) |
|---|---|---|
| `pnpm draft` (960x540) | about 0.07 s per frame per worker | about 5 minutes (278 s measured) |
| `pnpm render --scale=1` (1080p) | about 0.37 s per frame per worker | roughly half an hour or more; measure it on round 1 |
| `pnpm render` (4K master) | about 1.13 s per frame of wall time | about 2.5 hours, and about 3 GB |

Real scenes are slower than the placeholder these were measured on, and every frame inside a blur window costs one capture per sample. Run anything longer than a few minutes in the background.

Each round `n`:

1. **Check the code:** `pnpm check`. It must print no findings.
2. **Render the draft:** `pnpm draft --out out/draft-r<n>.mp4`. While iterating on a fix, `pnpm draft --frames=<a>-<b> --out out/wip-r<n>/<a>-<b>.mp4` re-renders only the changed range; the draft you report is always the whole song.
3. **Render the critique sheets:** `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>`. It writes `out/critique/r<n>/`: `overview_NN.png` (a tile every 2 s, 270 px, 6×5 per sheet), `phone_NN.png` (a tile every 4 s, 360 px, 5×3), and `strip_<seconds>.png` (12 frames from 0.1 s before each moment), every tile labelled `m:ss.cc f<frame>`. Strips default to every lyric line start and section start. `--strips=<s,…>` replaces the defaults and a re-run of a tag replaces its sheets, so put extra strips (the hard cuts, the biggest transitions, the slam moves) in a second tag: `pnpm critique --in out/draft-r<n>.mp4 --tag r<n>-extra --strips=<s,…>`.
4. **Look at every sheet** with the Read tool: the overviews for pacing, dead stretches and the 4 s rule, the phone tiles for readability, the strips for exits, transitions, collisions, and crops. Score each section yourself as a harsh motion director, not a proud author; it tells you what to fix before the critic sees it.
5. **Scan for pops:** `pnpm pops --in out/draft-r<n>.mp4 --cuts=auto --fail > out/critique/r<n>.pops.txt 2>&1`, and note the exit code. `--cuts=auto` excuses the page's own hard cuts from the draft's manifest; every other pop, and every one-frame flash, is a finding. It must pass before you report.
6. **Check held text on the engine:** `pnpm still-test > out/critique/r<n>.still-test.txt 2>&1`. It checks every word of every line over its own hold window at 4K, pixel for pixel, with everything else hidden. Pass: `lines with motion during hold: 0` with at least one word checked. Words listed as never settling before their exit are a design note (slow the exit or shorten the entrance), not a failure.
7. **Measure held text on a render:** `pnpm render --textonly --scale=1` writes `out/<outputName>-textonly.mp4` (the lyrics alone on black, 1080p), then `pnpm jitter --all-lines > out/critique/r<n>.jitter.txt 2>&1`. Pass: every line's mean shift 0.01 px or less. Always pass `--scale=1`: plain `--textonly` is the whole song at 4K. After a fix to a few lines, `--frames=<a>-<b>` on the render and `--in` on `jitter` measure only that range.
8. **Close-ups only where a sheet can't settle it:** a descender at a mask edge, the hit frame itself, a blur window, a single transition frame. `pnpm still --frame=<n> --scale=2 --out=out/wip-r<n>/f-<n>.png` (`<n>` is the absolute frame). A draft is half scale: judge type and edges on a still, never on the draft.
9. **Fix what the machine checks find** (a crash, a boot warning, a pop or flash, held-text motion) and re-draft until they pass. Leave the judgement calls to the critic.
10. **Report the round** to the lead (the director agent's report lists what goes in it). The lead runs the critic.
11. **Fix the critic's items.** Snapshot first: `cp -R src/scenes out/snapshots/r<n>/`. Fix the 3 worst problems, plus every item in a category or section scored 7 or lower, each to the measurable fix the critic gave. **Regression guard:** don't touch a section the critic scored 9 or higher. Then go to round `n + 1`.
12. **Version rule.** A new draft replaces the previous one only if the critic judges it better side by side. When it says the new draft is worse, put back the sections it names as regressed from the snapshot before fixing anything else. The lead keeps the version log.

`pnpm jitter --from=<frame> --frames=45 --crop=x,y,w,h` measures one held window on any render, starting after the line's last word has settled. `--from` is a frame of the file measured (or seconds with an `s`); on a `--frames=<a>-<b>` render that's the song frame minus `a`. `--max` gates the largest single pair; keep it a loose guard such as `--max=0.05`.

**Fix order,** within a round: a crash or a broken transition frame, a pop or flash, text you can't read (size, contrast, clipping, a crop at the frame edge, overlap with a prop or another line), a lyric that doesn't match the line sung at that frame, held text that moves, an empty or dead stretch, overlapping layers that weren't meant to overlap, then polish.

When it looks wrong, the video-pipeline skill's symptom table names the usual cause: stutter (a clock or kept state), shimmer, cheap bounce, grey slabs, a quarter-size canvas, washed-out colour, late audio, a pop at a section start, lines overlapping in a swap.

## Known pitfalls

From the Kizen run:

- **A flash that washes out the frame.** A full-frame white flash at high opacity on a hit turns the hit frame, the one people screenshot, into a white sheet with the lyric unreadable. Keep flashes short and around 0.4 peak, or put the flash behind the text on a world canvas, and check the hit frame itself.
- **Tiny props.** Small gag props read fine in the code and disappear at 1080p, and more so in the 720p preview. Make the joke the size of a word.
- **Empty caption panels at section starts.** A panel drawn from the section's first frame shows as an empty box until the first word is sung. Bring the panel in with the first word, or don't use a panel.
- **Labels that aren't sung.** The lyric doc proposed a glowing core labelled "Knowledge bases" for "Teach it what you know"; the label wasn't sung, so the core shipped unlabelled. If it isn't sung, it isn't on screen.

From the GitHub run (`examples/github.md`):

- **One static look for the whole song.** A single grid wall held for 4.5 minutes was rejected after a full render as dated and samey. The fix that worked was one unifying system with variety inside it, not a new world per line.
- **A new world per line.** A build that swapped to an unrelated world for each lyric felt disconnected next to the version that kept one system throughout. Variety lives inside the system.
- **Pulsing on a ballad.** A per-beat scale throb was rejected as fighting the song. See "Rhythm".
- **Shimmering held lyrics.** Unsettled springs, lyrics inside the camera wrapper, and grain over the text. The engine's layers and springs now prevent all three; `still-test` and `jitter` prove it each round.
- **A clock that goes negative.** A local clock computed before its section started went below zero and crashed mid-transition. Clamp local clocks at 0, or use `ctx.progress`, and look at the transition frames.
- **A disliked element, re-rendered blind.** That user disliked the mascot's treatment; a three-way options sheet settled it without re-rendering the video. Which treatment they picked was their choice, not a default.

From the howseen comparison (`examples/github.md`):

- **Lyrics carried by world transitions.** Whips blurred and slid the held lyric, zooms scaled and blurred it, and an iris covered it while held. The layer stack now keeps them apart; see "Text-led transitions".
- **Too few hard cuts.** One hard cut in a 4:23 song, against 7 in the howseen run, put on the stop-time hits and the key change with a push-in peaking into the cut.
- **Builder-only review.** Still checks by the builder missed collisions, crops, dead stretches, and a strobe that a separate critic caught in its first round. See section 5.
