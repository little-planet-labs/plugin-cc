# Worked example: the Jira video

**Don't copy this look.** It's here for three things: a direction built from one unifying system that a satire could hang every joke on, the first vertical adaptation, with its shorts, and the first two stand-alone Shorts. The board, the cards and the curtain were this video's choices, not defaults. What generalises is the structure: the vertical as an addendum to an approved direction, a parallel registry that never touches the landscape scenes, and clip edges designed into the staging.

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

## The stand-alone Shorts

After the video was finished, two pitches from the parent's `creative/shorts-pitches.md` became stand-alone Shorts. Each is a new Suno take with its own project under `shorts/`, its own `creative/direction-short.md`, critic rounds, master and three covers. Both keep the Blue Board system (the flat card, Inter, the capsule palette) and change the world or the angle. Both are vertical only, with `tailSeconds` 0, grain 0 (the Shorts default; the user confirmed it: "Yeah keep it off") and no logo.

| Short | Take | Concept | Rounds |
|---|---|---|---|
| "Is it a five or an eight?" | 28.4 s, 852 frames | The parent's planning table from above. Every sung number is a poker card slapped down on its word, a 17 fits nowhere in the fanned scale, and the meeting's 8 grows until it fills the table. | ACCEPT at v5; v6 polish |
| "Why is every ticket Highest?" | 31.64 s, 950 frames | The reverse angle of the parent's chorus stage: five tiers of seats, one per priority, with every ticket crammed into the red gallery over four empty tiers, until the gallery floor gives way. | ACCEPT at v3; v4 rejected; v5 accepted |

Highest had a concept round: three concepts (The Full House, The Map Room, The Lift) and four registries, since The Full House was built with two endings, a floor collapse and a sell-out. The user picked The Full House with the floor collapse.

### The hook and the loop

- **Five or eight.** The take has a 1.2 s vamp before "Five". The director offered a clip starting on "Five"; the user chose the full master, so frame 0 had to carry the hook: the 5 held high, face up and tilted, with the 8 face up on the table. The first frame already reads "5 or 8". Its round-1 hook scored 5 on a 1 to 2 px drift; by v3 the 5 rose about 120 px by f15 and each pizzicato onset lit a lane.
- **Five or eight's loop.** After the stab the company sinks out, the 8 shrinks home and the 5 rises into the frame-0 pose. One call, `dealPose(u)`, draws f0 and f851.
- **Highest's hook.** The gallery plate is lit red from f0, and the late ticket (about 174 px) is mid-flight. The gallery leans on the f5 hit, and the ticket slams into its seat on the f11 hit, the song's largest accent.
- **Highest's loop.** Line 8 fades on the stab, the crash rewinds as one move (f912 to f934), and the camera holds until the fade is at 0.26 or less, then eases back to frame 0's pose on a smoothstep (f908 to f936). The urgent ticket takes off over the last 22 frames on the same `flight(u)` as f0 to f11, so it reaches f0's point at f0's speed. The f0 and f949 stills matched in every pixel; the master measured 45.8 dB.

### What the critic caught

- **Line-8 clearance (Highest v3.1).** The last line sat about 25 px above the packed gallery for its 1.4 s hold. The hold was reframed lower (0.45 on y 888, pushing in to 0.5 on y 775), for 43 px or more on the stills.
- **The gallery push whip (Highest v3.2).** The push into line 7 put most of a 2.7× zoom into four frames on `cam`, 1.33 per frame at its peak. On a smoothstep it peaked at 1.143.
- **The loop-seam evidence rejection (Highest v4).** The lower line-8 framing left the camera about 170 px and 1.2× zoom from frame 0's pose at f905, so the move back now ran under the rewind, inside the locked reset. Its middle, f917 to f938, was on no strip, and the critic rejected the round with no visible defect. v5 held the camera to f908, moved it on a smoothstep (11.6 px and 1.0098 per frame at most, against 18.9 px and 1.0200), added strips 30.60 and 31.00, and was accepted.
- **Five or eight's round 1** also had numerals crossing y 1500 in the close-up and cards showing their faces 5 frames before their sung words.

### The covers

- **Five or eight:** "but the meeting / was an eight!", "Five or / eight?", and "with their arms crossed, / looking sour", with the sung numerals 5, 8 and 13 on cards.
- **Highest:** the full house under "Pick what matters!", the floor collapse with "Highest" on the cracked plate, and the urgent one in the follow spot under "actually urgent". They stay clear of the parent's covers for its Highest re-cut (a tower, a filed ticket, a priority ladder), which the user had already posted.
- **A crack through a letter.** The collapse cover's crack split the "h" of "Highest" and left a white sliver, seen only at full size. The word became "High" and "est" with a 44 px gap over the crack.
- **Shapes outside the safe box.** The code comment said every shape sat inside x 108 to 920 and y 220 to 1500. Signoff measured the pixels at x 91 to 943, with shapes below y 1500. After the fix the three covers measured x 110 to 916 and y 428 to 1496.
