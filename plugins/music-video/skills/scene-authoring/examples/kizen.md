# Worked example: the Kizen video

**Don't copy this look.** It's here to show the level of planning a direction needs and the craft moves that held up. The next video picks a different typography approach, motion vocabulary, texture, and transitions (see "Check what's been done" in the skill).

Project: `~/Developer/kizen-music-video` (scenes in `src/scenes/`, one header comment per scene). Song: 131 s, about 124 BPM, 10 sections including two instrumentals Suno added.

## Direction: cinematic kinetic caps

- **Summary.** Deep-teal cinematic kinetic typography: wide-tracked light caps for the serious moments, huge bold words slamming in on the hits, and a gray spreadsheet "before" world that the brand teal floods on the name. Camera push-ins and shakes give it weight; the jokes land as sight gags on the punchline word.
- **Typography.** One family (Open Sans, the Google fallback for Proxima Nova). Light 300 at 0.32 em tracking in caps for intro and bridge; ExtraBold 800 at tight tracking for hits; lyrics 72 to 84 px, hits 200 to 300 px.
- **Motion vocabulary.** Slam with overshoot (the default hit), 3-frame snap, slow fade-up with un-blur, word-by-word stamps, camera shake on impacts, SVG paths drawing on.
- **Colour.** Deep teal background, white type, and one accent (KDS blue-600) for hits, because teal-300 sat too close to the backgrounds to read as a hit. Gray neutrals only for the "before".
- **Camera.** Slow push-in across each section; shake on the biggest hits.
- **Texture.** Clean: radial glows that swell with low-band energy, vignettes, particles in the payoff.
- **Transitions.** Hard cuts on line starts; the two big turns are a teal flood (a circle bursting from the impact point) and a cut to black for the half-time bridge.
- **Humour.** Literal sight gags timed to the punchline word: a slot machine hitting the jackpot on "machine", a ribbon tying the app grid on "wrap", the A falling out of KAIZEN on "Drop the A!".

## Section concepts

| Section | Concept | Hits |
|---|---|---|
| Intro (0 to 10 s) | Black, slow push-in; AGENTIC / ORCHESTRATION fade up in cinematic caps with a low boom each; POSSIBLE scales past the camera | last syllable of "possible", cut to teal |
| Build, instrumental (10 to 17 s) | Abstract teal beat rings and orbiting nodes over a receding floor grid, denser each bar; the last bar desaturates and the floor stiffens into a flat spreadsheet grid | every beat; no text |
| Verse 1 (17 to 32 s) | Gray jittering spreadsheet and sticky notes; teal floods on "Kizen"; contact cards tile the frame; Custom Objects snap in; dashboard slot reels; envelopes for Broadcasts, Forms, Surveys | "Kizen" (flood and shake), "everywhere", "machine" (jackpot), "clean" (sparkle) |
| Pre-Chorus (32 to 48 s) | Icons stream into an unlabelled glowing core; M, C, P stamp in and lines draw out to agent dots; everything clears and "Kizen AI" types in; a steering wheel spins up behind it | each letter of M-C-P, "go", "wheel" into the hard cut |
| Chorus 1 (48 to 62 s) | Four shots cut on each line's first word: KIZEN from center on the downbeat with words stamping in; a workflow drawing per beat; the hook again inverted to light and mirrored; a row of people charging up | the downbeat "Kizen", "POS", "show", "go" |
| Verse 2 (62 to 70 s) | A puzzle gap; the SmartConnectors piece hovers legibly while sung, then slams in on "snap"; app tiles scroll and a ribbon ties them like a present | "snap", "wrap" |
| Chorus 2 (70 to 84 s) | The chorus again as a payoff: confetti bursts, per-bar framing cuts, an electric-blue tint, quick 0.4 flashes on line cuts | same hits, bigger |
| Bridge (84 to 106 s) | Half-time on black: each industry fades up alone; an ECG line draws to MISSION-CRITICAL; AI rides a road between rails; "Safely." holds small, then the rest bounces in as the beat returns | the ECG peak, "dance" |
| Outro (106 to 115 s) | KAIZEN? slams in, the A pops and bounces off the frame bottom and the word snaps shut to KIZEN; twin words over identical sound waves; a staircase chart, one step per beat; the logo lockup | "A!", "our way", each step, "Kizen!" |
| Drop, instrumental (115 to 131 s) | The outro's lockup holds center (an invisible cut) while light rays, a shockwave per beat, and orbiting nodes build around it; the last 1.2 s slows and dims | every beat and downbeat; logo only |

## What worked

- **Cutting chorus shots on each line's first sung word.** The edit follows the song without any hand-placed frame numbers.
- **A repeat that changes.** The second hook line in each chorus is the same move inverted and mirrored, and the second chorus gets a payoff variant, so the repeats feel earned.
- **Instrumentals that bridge.** The build ends by turning into the next section's spreadsheet grid, and the drop keeps the outro's lockup on screen, so both cuts read as intentional.
- **Fixed letter slots for the letter gag.** KAIZEN's letters sit in fixed slots, so the A's start position is known exactly and it falls in its own layer.
- **Seeded streams that start early.** The pre-chorus icon stream spawns from a few frames before the section, so it's already in flight on the section's first frame instead of starting empty.
- **One accent with a reason.** The hit colour was picked for contrast against every background, not for being on brand.
