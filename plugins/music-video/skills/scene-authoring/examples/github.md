# Worked example: the GitHub video

**Don't copy this look.** It's here for the concept round, the rejected first build, and the fixes that held up. The next video picks its own typography, motion, texture, and transitions (see "Check what's been done" in the skill).

Project: a satire about outages, "Unicorn Goodbye", an overwrought power ballad. Song: 4:23, written at 80 BPM and read by the analysis at about 131 BPM with a half-time feel, 11 sections including a 13.7 s piano lead-in, two instrumental breaks, and a 31 s instrumental tail. No logo anywhere: the user left the mark out because the video may be monetized. The brief's visual note, verbatim: "visually stimulating with lots of color and full-bleed scenes and designs".

## The first build, rejected

One system for the whole song: a full-bleed wall of rounded contribution-graph squares, repainted in cascades, with lyrics on dark bands cut into the wall and pixel props built from the same squares. It was planned in detail and rendered in full, and the user rejected it as dated and repetitive: every section was the same wall in a new colour. The grid was right for exactly one line ("My green squares bleeding red tonight") and wrong as the medium.

## The concept round

Three concepts, each its own composition under `src/concepts/<slug>/`, shared code in `src/components/concept-kit/`, `src/scenes/` untouched:

| Concept | Pitch |
|---|---|
| Chrome Heartache | A 1986 airbrushed album cover come to life: chrome type, outrun sunsets, star wipes |
| **Incident Keynote** (picked) | The outage presented like a flagship product launch: glass UI cards over vivid mesh gradients |
| Variable Heartbreak | Type is the image: a variable font stretched live across flat full-bleed colour fields |

Each got a contact sheet of the same 10 moments at their real frames (the intro, the first line, "All Systems Operational", "Major Outage", the hook downbeat, the error line, a verse-2 joke, the bridge takeover, the green squares line, the key change) and a 14 s motion test from the end of verse 1 into the chorus-1 hook.

## Direction: Incident Keynote

- **Typography.** Mona Sans at 800 to 900, tight tracking, sentence case. Words rise through masks; accent words carry a gradient fill.
- **Colour.** A different vivid mesh-gradient stage per shot, from the brand's marketing ramps (purple, blue, green, pink) and the status colours (yellow, orange, red).
- **Motion.** Springs from four presets, 3D card fly-ins, state morphs (a status pill grows and changes colour as the levels escalate), ring shockwaves on hits.
- **Transitions.** Zoom-throughs (into a notification's icon and out into the chorus), circle floods from the hero element, split panels, whips.
- **Rhythm.** The concepts shared a beat-locked scene punch; the user rejected it as fighting the ballad, so it was retired. Backgrounds now swell on energy averaged over a bar, with single accents on the hook downbeat, the stop-time hits, and the key change.
- **Humour.** Deadpan: keynote polish applied to heartbreak. Playful springs only on the gag words.

## Section concepts (excerpt)

| Section | Concept |
|---|---|
| Intro (0 to 13.7 s) | An aurora blooms on the piano; glass skeleton cards assemble in depth. No text |
| Verse 1 | A new UI composition per line: a glass terminal on "git push", a key card flipping on "SSH", every card's dot going dark on "Unplugged the router", a giant green status dot on "All Systems Operational" |
| Pre-chorus | Each status level slides in as a split panel and compresses the last to a sliver, so the escalation leaves a trail; "Major Outage" fires shockwaves |
| Chorus 1 | A notification drops in, the camera zooms through its icon into the hero layout; the error line is a modal over a blurred dashboard |
| Bridge | A wall of glass tiles flipping one by one on "The Unicorns have taken over"; an isometric contribution chart whose red spreads from the far corner on "green squares bleeding red" |
| Tail (31 s) | Its own movements on the downbeats and energy, not a held frame |

## What worked

- **A motion test before the full build.** The clips showed the transitions and the pacing, which no still can.
- **Options sheets for one element.** The user disliked the mascot in a rounded app-icon tile. Three freestanding treatments (layered illustration, glass, neon line art) went out as an in-context sheet with short clips, and glass won, without re-rendering the video to find out.
- **A text layer nothing touches.** Held lyrics shimmered until springs settled to exactly 1, the lyrics left the camera and punch wrappers, and the grain moved below the text: background, then grain and vignette, then lyrics.
- **The motif where it's sung.** The contribution grid appears once, on its own line, and lands harder for it.
- **A PNG-frame master** (`--image-format=png`) for text-heavy shots over gradients: about 650 MB and 50% slower, and clean type.
