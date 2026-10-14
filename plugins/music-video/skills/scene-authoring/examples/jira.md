# Worked example: the Jira video

**Don't copy this look.** It's here for two things: a direction built from one unifying system that a satire could hang every joke on, and the first vertical adaptation, with its shorts. The board, the cards and the curtain were this video's choices, not defaults. What generalises is the structure: the vertical as an addendum to an approved direction, a parallel registry that never touches the landscape scenes, and clip edges designed into the staging.

Project: a satire of Jira from the point of view of the people who use it, "The Worst Tool (Except for All the Others)", a comic operetta patter song. Song: 179.6 s, about 144 BPM, 45 lines, 8 sections (an instrumental intro, four verses, three choruses). No logo anywhere (`logoUse: "omitted"`), and the video may be monetized. Atlassian's trademark page says its website "look" or "feel" shouldn't be reproduced, so nothing on screen is laid out like the product.

## Concept round

Three concepts at the same ten moments, each with a motion test:

| Concept | Pitch |
|---|---|
| **Blue Board** (picked) | One endless work board staged like Saul Bass title cards; the choruses turn it into an operetta stage |
| Watercolour Overture | One sheet of cold-press paper the music paints, with the lyrics painted in |
| Stationery | The lyrics written on ruled cream letter paper with moving rules, engraved florals and a programme-card chorus |

The second and third came from the user's own words in `brief.visualStyle`.

## Direction: Blue Board

- **Reference.** Saul Bass title sequences (flat cut shapes and hard-edged bars sliding on a grid over one flat colour field), applied to a kanban board. The choruses borrow a Gilbert and Sullivan chorus line.
- **Evoke, don't mimic.** Generic parts drawn to the video's own proportions: 300 px lanes, cards with a colour strip, two grey bars (never text) and a blank avatar dot, and status capsules in the research's vivid palette. One family, Inter.
- **Type.** Four compositions set per line by the beat map: a headline at the top of the field, a ticket (the line written on a hero card), a definition (a dictionary entry on a card, from the user's hard rule), and a centred stage line in the choruses. The exact Jira labels the lyrics sing (Highest, backlog, Won't do) are capsules inside the lyric itself, so the sung word is the label.
- **Palette logic.** A capsule's colour means its label everywhere; red is the running joke ("everything is Highest" floods the board red); saffron is the hook; the field colour names the verse.
- **Motion.** Six moves: camera travel one step per line in step with the lyric exit, card drag, capsule pop, card drop, a cascade sweeping lane by lane, and a kick used only in the choruses. No beat-locked throb in the verses.
- **Variety inside the system.** Each verse travels the board its own way: one lane left, down a shaft, diagonally through a workflow, close in over a planning table.
- **Transitions.** A push-in to a hard cut on each chorus downbeat, whips out of choruses 1 and 2, Bass bars into verse 4, a hard cut on "Surprise!". The video opens on a curtain parting and ends on it closing, in a 2 s tail after the audio.

## What worked

- **Labels as sung words.** Every capsule on screen is a word being sung, so the copy rule never fought the jokes.
- **A hard rule kept whole.** The user wanted the definition on screen at once, like a dictionary entry. The full entry shows from its first sung word as a grey proof, and each word inks on its sung frame.
- **The critic loop.** Six rounds to ACCEPT. Hard rules sat at 4 until round 4; the hook went from 4 to 8 by round 3.

## The vertical version

The user asked for shorts and a full-length vertical. The vertical was written as `creative/direction-vertical.md`, an addendum the user approved, and built as `src/scenes-vertical/` while `src/scenes/` stayed untouched.

- **The frame.** The text box is the intersection of title-safe and social-safe, x 108 to 920 and y 220 to 1500. Lyrics sit in a zone at the top (from y 236, up to four rows), the cards act in a band below (y 740 to 1500), and under the app's caption bar the board just continues. The stage axis is x 516, the text box's centre, 24 px left of the frame centre.
- **The board.** It keeps its world coordinates; a portrait camera at zoom 0.9 shows three tall lanes, built at least six cards deep so every lane reaches the frame bottom. Each verse keeps its landscape travel, re-tuned: the shaft descends three rows per line instead of two.
- **Type.** Headlines at 76 px (72 on three long lines), stage lines at 88, the tag at 104, the definition at 68. Every line has explicit row breaks, measured with Pillow on the project's Inter woff2 files against a 760 px limit in the 784 px column. A setup guard throws if any block leaves the text box.
- **Restaging.** The seven-card kick line became risers, three cards in front and four behind, with a back row bleeding off both edges in choruses 2 and 3. The priority ladder became a real ladder down one lane, the chart rose higher, and the eleven-step hopper snakes through a grid. The shiny card is kicked off downward so it never crosses the lyric zone.
- **Act curtains.** The whips and bars into verses 2, 3 and 4 straddled the clip starts. They became act curtains: choruses 1 and 2 close the curtain over their last line, which stays held, and verses 2, 3 and 4 open on it parting (verse 4 by a hard cut to the shut curtain). Both sides draw the curtain with the same call, so each seam frame is pixel-identical.
- **The close.** The landscape close ran 1.4 s past the audio. With a 0.3 s tail (179.9 s in all, under the 3:00 Reels cap), the vertical close starts on the last beat, shuts the curtain on the audio's last frame, and holds through 9 silent frames.

### The shorts

| Short | Seconds | First frame | Last frame |
|---|---|---|---|
| everything-is-highest | 10.553 to 50.6 | the settled verse-1 board, no text | the shut curtain with chorus 1's last line held |
| loading-loading-still | 50.6 to 97.1 | the shut curtain, starting to part | the shut curtain with chorus 2's last line held |
| built-from-spite | 97.433 to 125.06 | the shut curtain, a footlight warming it on the beat | verse 3's last line held, its shake just finished |
| story-points | 125.08 to 152.46 | the hard cut to the shut curtain, parting | the flooded wide board with "and another!" held |

Clip 1's end and clip 2's start moved from about 50.2 s to 50.6 s: "before!" was aligned 2 frames before verse 2 started, so the old edge would have opened clip 2 on it. The early look was clip 1's range rendered at 1080x1920 while the rest was built. The vertical master took about 22 minutes at pool 2.

## What the vertical taught

- **Design the clip edges into the staging.** Clip-friendly openings changed three transitions, and the user decided them at the direction stop, before any vertical code.
- **Measure row breaks before building.** The breaks table settled every line's layout up front, and the guard stops a later change from pushing a line under the app's UI.
- **Look at props in the tall frame.** The hopper card read as a speck at 143 px and was enlarged to about 198 px.
