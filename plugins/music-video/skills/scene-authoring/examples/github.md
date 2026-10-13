# Worked example: the GitHub video

**Don't copy this look.** It's here for the concept round, the rejected first build, and the fixes that held up. The look, the glass cards, and the glass mascot were this user's choices for this video, not defaults. What does generalise is the structure: one unifying system (the same glass-card UI language, mesh gradients, and type throughout) with variety staged inside it; this user's video varied it on every line. The next video picks its own typography, motion, texture, and transitions (see "Check what's been done" in the skill).

Project: a satire about outages, "Unicorn Goodbye", an overwrought power ballad. Song: 4:23, written at 80 BPM and read by the analysis at about 131 BPM with a half-time feel, 11 sections including a 13.7 s piano lead-in, two instrumental breaks, and a 31 s instrumental tail. No logo anywhere: the user left the mark out because the video may be monetized. The brief's visual note, verbatim: "visually stimulating with lots of color and full-bleed scenes and designs".

## The first build, rejected

One static look for the whole song: a full-bleed wall of rounded contribution-graph squares, repainted in cascades, with lyrics on dark bands cut into the wall and pixel props built from the same squares. It was planned in detail and rendered in full, and the user rejected it as dated and repetitive: every section was the same wall in a new colour. The grid was right for exactly one line ("My green squares bleeding red tonight") and wrong as the medium.

## The concept round

Three concepts, each built apart from the main scenes, which stayed untouched:

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

## A new world per line, rejected

A later 4K rebuild was briefed that one visual system for a whole song is repetitive, an over-reading of the grid-wall rejection, and built a new world for each lyric. The user found it disconnected and preferred Incident Keynote, which varied every line inside one consistent world. The grid wall failed because it was static and dated, not because it was one system.

## What worked

- **A motion test before the full build.** The clips showed the transitions and the pacing, which no still can.
- **Options sheets for one element.** The user disliked the mascot in a rounded app-icon tile. Three freestanding treatments (layered illustration, glass, neon line art) went out as an in-context sheet with short clips, and glass won, without re-rendering the video to find out.
- **A text layer nothing touches.** Held lyrics shimmered until springs settled to exactly 1, the lyrics left the camera and punch wrappers, and the grain moved below the text: background, then grain and vignette, then lyrics.
- **The motif where it's sung.** The contribution grid appears once, on its own line, and lands harder for it.
- **PNG captures for the master.** JPEG captures rang around type over gradients; PNG frames gave clean type for about 50% more render time (about 650 MB for 4:23 then). Since 1.0.0, masters capture PNG by default.

## What the howseen comparison taught

The user then watched a run of howseen-ai/claude-motion-design (262 s, 39 scenes, 27 animated transitions) and preferred this video's style, but that run's process and transitions. Version 0.3.0 took these from it:

- **Text-led transitions.** Here, whips blurred and slid the held lyric with the frame, zooms scaled and blurred it, and the iris covered it while held. There, each line left with its own exit on schedule, a world-only reveal ran underneath in the direction the words left, and the next line rode above it.
- **Hard cuts on the biggest hits.** 7 there, each with a push-in peaking into the cut, against 1 here. Transitions ran 0.38 to 0.5 s.
- **A separate critic.** That run's critic scored its two drafts hook 2, readability 5, motion 4, variety 6, composition 6, accuracy 7, sync 8, then 3, 5, 6, 7, 5, 7, 8, and caught collisions, dead stretches, crops, and a strobe the builder had missed.

## 1.0.0: the engine change

The user later judged the video built the howseen way (a time-seeked HTML page captured frame by frame with Playwright and encoded with ffmpeg) better than the Remotion build. What held it back came from our side: a rule in our brief that each scene be distinct and not match the others, the "A new world per line" mistake above. So version 1.0.0:

- **Replaced Remotion** with a page engine adapted from howseen's and from our earlier adaptation of it (credited in the template's `NOTICE.md`): a layer stack that keeps the lyrics apart from the world, lyric entrances and exits with the exit rule built in, transitions, hard cuts and subframe motion-blur windows declared by the scenes, 4K masters with the render pool capped at 2, and QA on the page and the renders (stills before video, critique sheets, the pops and flash scan, the held-text still-test).
- **Brought over the rest of its method** into the scene-authoring skill: reference first, cut seams at peak velocity, the incoming shot already moving, blur only on slam moves and never on text being read, caption timing, and a version log next to the critic loop.
- **Kept our own parts:** the Suno song and its rules, the audio analysis and lyric alignment, the beat map, the concept round, the critic, and one unifying visual system per video, varied inside it.
