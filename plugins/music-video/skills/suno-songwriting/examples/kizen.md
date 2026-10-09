# Worked example: "Power What's Possible (Kizen)"

The finished song from the first music video (project: `~/Developer/kizen-music-video`, file `creative/lyrics.md`). Use it for format and craft. Don't reuse its structure, jokes, or hook for another company.

## The brief that shaped it

- Kizen, a CRM and AI platform; the song names insurance, financial services, and healthcare as its industries. Hook built on Kizen's own line "Power What's Possible".
- Tone: "kind of funny, kind of serious". About 90 s. All sung (the user dislikes spoken words).
- Pronunciation: **KY-zen, rhymes with "wise"**. The first Suno take said it wrong; respelling fixed it.
- Approved topics included the AI features (MCP knowledge bases, Kizen AI, Agentic Workflows), the platform features by their UI names, and the industries served. One topic was cut at the menu stage and a feature was left out at the user's request.

## Corrections the user made (apply them every time)

1. **Topics before lyrics.** Lyrics were drafted before the topics were agreed, and the user stopped it: "iterate on the topics before you keep wasting time writing lyrics."
2. **No product in the "before".** An early draft put Custom Objects in the "used to be" half. "Custom Objects are a Kizen thing, so they couldn't have been before." The pivot is now line 2 of Verse 1; every feature comes after it.
3. **No spoken words.** An early draft had a spoken part. Removed; the style description now says "all vocals sung".
4. **How Suno works.** An early Suno pack assumed more controls than Suno offers. The user: "I can give it 5000 characters for lyrics, and a style description." That's the whole interface.
5. **Pronunciation.** "Kizen" was mispronounced until the Suno file spelled it "Ky-zen".

## Screen lyrics (`lyrics.screen.txt`)

```
[Intro]
[Cinematic, slow, soaring vocal]
Agentic orchestration
That powers what's possible

[Verse 1]
[Playful]
Used to be spreadsheets and a prayer
Then came Kizen: Contacts everywhere
Custom Objects, Dashboards like a slot machine
Broadcasts, Forms, and Surveys, squeaky clean

[Pre-Chorus]
[Building, serious]
Teach it what you know
M-C-P, agents go
Kizen AI
Takes the wheel!

[Chorus]
[Gang vocals]
Kizen, power what's possible!
Agentic Workflows run the show
Kizen, power what's possible!
Supercharged people, front and center, go!

[Verse 2]
[Playful]
Missing something? SmartConnectors, snap!
App Marketplace. That's a wrap.

[Chorus]
[Gang vocals]
Kizen, power what's possible!
Agentic Workflows run the show
Kizen, power what's possible!
Supercharged people, front and center, go!

[Bridge]
[Half-time, dramatic, soaring]
Insurance. Financial services. Healthcare.
Mission-critical moments
AI kept within the guardrails
[Playful]
Safely. Now everybody dance!

[Outro]
[Playful, stop-time]
Kaizen? Drop the A!
Sounds the same, spelled our way
Systems that learn, every day
Kizen!

[End]
```

## Suno file (`lyrics.suno.txt`)

Identical, except every sung "Kizen" is "Ky-zen". "Kaizen" in the outro stays: it's meant to sound the same. The check:

```sh
diff <(sed -e 's/Ky-zen/Kizen/g' creative/lyrics.suno.txt) creative/lyrics.screen.txt   # prints nothing
```

Fallback in `suno-prompt.md`: if "Ky-zen" still comes out wrong, use "Kai-zen" and re-roll.

## Style description (172 characters)

```
Cinematic sung intro into upbeat electro-pop, 124 BPM, four-on-the-floor, playful confident male vocal, all vocals sung, gang-vocal chorus, epic build, tongue-in-cheek hype
```

## Syllable map (excerpt)

124 BPM, 4/4, one bar is about 1.94 s. Most lines are 2 bars; the pre-chorus and outro use 1-bar lines on purpose.

| Section | Line | Syllables | Bars | Note |
|---|---|---|---|---|
| Verse 1 | Used to be spreadsheets and a prayer | 8 (USED / to / be / SPREAD-sheets / and / a / PRAYER) | 2 | the "before": no Kizen features |
| Verse 1 | Then came Kizen: Contacts everywhere | 9 (THEN / came / KY-zen / CON-tacts / EV-ery-WHERE) | 2 | the pivot |
| Verse 1 | Custom Objects, Dashboards like a slot machine | 11 | 2 | the busiest line that still landed |
| Pre-Chorus | M-C-P, agents go | 6 (EM / SEE / PEE / A-gents / GO) | 1 | stacked build hits |
| Chorus | Kizen, power what's possible! | 8 (KY-zen / POW-er / what's / POS-si-ble) | 2 | the hook; "Kizen" on the downbeat |
| Bridge | Insurance. Financial services. Healthcare. | 11 | 2 | half-time, one word group per half bar |
| Outro | Kaizen? Drop the A! | 5 (KY-zen / DROP / the / A) | 1 | works only because Kizen is said KY-zen |

Rhymes: prayer / everywhere, machine / clean, know / go, show / go, snap / wrap, A / way / day. The hook repeats instead of rhyming (a gang chant). The bridge doesn't rhyme, on purpose.

## Alternate chorus (offered, not used)

```
[Chorus]
[Gang vocals]
Kizen, let the agents work!
Agentic Workflows, run it all
Kizen, let the agents work!
Supercharge the people, stand up tall
```

## What Suno did with it

- All 28 lines sung once, in order, with the sections where the tags put them.
- Planned 48 bars (about 93 s); the track came back at **131 s**. Suno added a 7 s instrumental build after the intro and a 16 s instrumental drop after the outro. The video gave both their own visuals with no text.
- Every chorus "Kizen" landed within 0.1 s of a detected downbeat, because the name sat on the hook's first strong beat.
- The speech-recognition transcript heard "Ky-zen" as "kais", "highs", "rise". That's the aligner's problem, not a lyric problem: the alignment maps the sung word back to the screen spelling.
