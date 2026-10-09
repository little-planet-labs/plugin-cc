---
name: suno-songwriting
description: How the music-video lyricist writes a company song for Suno. Covers what Suno actually takes (a lyrics box and a style description, nothing else confirmed), the topic menu that comes before any lyrics, bracketed section and delivery tags, a line-less intro and a sung ending so Suno doesn't speak fragments, the screen and sung lyric files with phonetic respelling of names and letter-spelled acronyms, the title as the hook, syllable budgeting per bar at a given BPM with rhymes on strong beats, lyric logic checks (no product in the "before", wordplay that works when sung, no spoken parts unless allowed), the avoid list, the style description, timing promises not to make, and the lyrics.md doc format. Use when writing topics.md, lyrics, or the Suno prompt for a music video.
user-invocable: false
---

# Suno songwriting

You write the song that the whole video hangs on. The user pastes your text into Suno, so every character you write either gets sung or steers how it's sung. `examples/kizen.md` (upbeat electro-pop) and `examples/github.md` (a satirical power ballad) are finished worked examples; read them for format, not for content.

## What Suno takes

**Confirmed by the user (2026-10-09):** Suno takes a **lyrics box of up to 5000 characters** and a **style description**. That is all you work with.

Everything else about Suno is **Inferring (unverified)**, and you say so wherever you rely on it: how it reads bracketed tags, whether `[End]` stops the song, how long the style description may be, how it pronounces anything. Don't invent other Suno features, settings, or limits, and don't tell the user to look for them.

Observed in one run (Kizen): Suno sang all 28 lines once, in order, with `[Section]` and delivery tags in brackets, and added instrumental stretches the lyrics didn't ask for.

Observed in another run: Suno **spoke** short, isolated lines in `[Intro]` and `[Outro]` (a counter line, "Days since <company> was down: zero", and a one-word "Resolved") instead of singing them. Full metered lines in an intro with a sung delivery cue were sung in the Kizen run. Why is **Inferring (unverified)**; short lines standing alone are the likely trigger.

## Order of work

1. **Topic menu first.** Write `creative/topics.md`: a numbered list of 12 to 18 candidate topics, one line each, each with its source in `research.md` (a feature with its exact UI name, a positioning claim, an industry served, a running joke). Mix earnest and funny. Stop there. **Write no lyrics until the user has approved topics** and the lead has recorded them in `brief.json` `approvedTopics`. Drafting lyrics early wastes a round when the user cuts half the topics.
2. **Lyrics**, from `approvedTopics` only.
3. **The Suno pack** and the checks below.

## Files you write

| File | What it is |
|---|---|
| `creative/topics.md` | The numbered topic menu with sources. |
| `creative/lyrics.md` | The human doc (format below). |
| `creative/lyrics.screen.txt` | Bracketed tags plus lines, with **screen spellings** ("Kizen"). `pnpm align` reads this file, and on-screen text comes from it. |
| `creative/lyrics.suno.txt` | **Identical** to the screen file except for phonetic respellings of names ("Ky-zen") and any letter-spelled acronyms ("S-S-H"). The user pastes this into Suno. |
| `creative/suno-prompt.md` | Title, the style description, pronunciation notes with fallbacks, export instructions. |

Both `.txt` files are plain text: tags on their own lines, one sung line per line, a blank line between sections. No markdown, no comments, no notes for the user.

### Tags

- One section tag per section: `[Intro]`, `[Verse 1]`, `[Pre-Chorus]`, `[Chorus]`, `[Verse 2]`, `[Bridge]`, `[Outro]`, `[End]`.
- **The intro has no lines by default.** Write `[Intro]` with a delivery cue and nothing else (`[Intro]` then `[Soft piano, no vocals]`). `pnpm align` turns a line-less tag before the first sung line into the instrumental lead-in section. Put intro lines in only when they're full, metered lines with a sung cue.
- **End on a sung, metered phrase**: a soft tag at the end of the final chorus (`[Soft, held to the end]` then the hook), not an `[Outro]` of fragments. Fold fragment jokes ("Resolved", a counter at zero) into metered lines in a verse or the tag.
- Delivery cues in their own brackets on the next line: `[Playful]`, `[Building, serious]`, `[Gang vocals]`, `[Half-time, dramatic, soaring]`, `[Playful, stop-time]`. A cue may also sit mid-section where the delivery changes.
- No `[Spoken]`, `[Spoken word]`, or `[Rap]` unless `brief.vocals` is `"spoken-ok"`.
- No `[Instrumental]`, `[Solo]`, `[Break]`, `[Drop]`, or `[Build]` sections. Suno adds instrumental stretches on its own, and the pipeline detects them.
- **The tags define the video's sections.** `pnpm align` turns each section tag into a section id (`[Verse 1]` → `verse-1`; an unnumbered kind that repeats → `chorus-1`, `chorus-2`) and each line into `<sectionId>-<n>`. So number your verses, and never start a delivery cue with a section kind (intro, verse, pre-chorus, chorus, post-chorus, hook, refrain, bridge, breakdown, outro, end, instrumental, interlude, break, solo, drop, build): `[Build, serious]` becomes a section, `[Building, serious]` stays a cue. `music-video:remotion-pipeline` has the full rule.

### Respelling names for the sung file

- Respell each name the way it should sound, using `brief.pronunciation.sung`: capitalised stressed syllable, hyphens between syllables ("Ky-zen").
- Initialisms that must be sung as letters get hyphens (`M-C-P`) in the Suno file. In the screen file, either keep the hyphens too (the scenes then show `MCP`), or write the real spelling (`SSH` on screen, `S-S-H` sung). Either way each is **one token in both files**, so the word counts match and the aligner maps the sung letters onto the screen word; add the pair to the diff's `sed`. Leave short ones Suno already sings as letters ("AI") alone; the fallback is "A.I." in the Suno file. **Inferring (unverified)** for both fallbacks.
- In `suno-prompt.md`, give one fallback respelling per name ("if it still sounds wrong, use Kai-zen and re-roll").
- A word that is *meant* to sound like the name (the Kaizen joke) is not respelled.

## Writing the lyrics

### Structure and length

- Build from `brief.targetSeconds` and the BPM you'll ask for in the style description. One 4/4 bar lasts `240 / BPM` seconds (1.94 s at 124 BPM). Bars needed = target seconds / bar seconds; pick a section plan that adds up.
- Typical shape: Intro (line-less; Suno picks its length), Verse 8, Pre-Chorus 4, Chorus 8, Verse 4 to 8, Chorus 8, Bridge 8, then a final chorus with a sung tag, or an Outro of 4 metered, sung bars.
- Most lines get 2 bars. Use 1-bar lines on purpose: stacked hits in a build, or a comic stop-time ending, inside a section with a sung delivery cue.
- The hook is short, sung, and repeated. The company name goes on the hook's first downbeat.
- **The title is the hook.** Title the song with the hook phrase, and open or end the chorus on it (or both), with a held repeat at the end, belted where the genre allows. When the user loves a phrase enough to retitle the song after it, they want it sung again and again; rewrite the chorus around it.

### Syllable budget

- Budget **2 to 3 sung syllables per second** for verses, **1.5 to 2** for the hook. At 124 BPM that's 4 to 6 per bar, so a 2-bar line holds 7 to 11. This is a craft heuristic from the Kizen run, where the busiest line was 11 syllables over 2 bars and still landed.
- Count syllables of every line and write them in the syllable map with the stresses in caps (`CUS-tom / OB-jects`).
- Put stressed syllables of names and feature names on strong beats (1 and 3). Put each **rhyme's stressed syllable on a strong beat**, usually the last strong beat of the line's second bar.
- Long product names eat the budget. "Agentic Workflows" is 5 syllables before the line has said anything.

### Rhyme and humour

- Rhyme line pairs; a chant hook can repeat instead of rhyme. A soaring bridge may skip rhyme on purpose; say so in the doc.
- Jokes land on the last word of a line, on a strong beat, so the video can hit them.
- Keep the tone split the brief asks for, and say in the section table which sections carry the jokes.

## Logic checks (run them before handing off)

1. **No product in the "before".** If the song has a before/after turn ("used to be spreadsheets"), nothing the company makes appears before the pivot. A Kizen feature (Custom Objects) can't be part of the life before Kizen. Mark the pivot line in the syllable map.
2. **Wordplay works sung, with the real pronunciation.** Read every pun and rhyme aloud using `pronunciation.sung`, not the spelling. "Kaizen? Drop the A! Sounds the same" only works because Kizen is said KY-zen; with any other pronunciation it's false the moment it's sung. If the pronunciation is unknown, the lead asks before you write wordplay on the name.
3. **Sung only** unless `brief.vocals` is `"spoken-ok"`. Users dislike spoken-word parts. Say "all vocals sung" and "no spoken intro or outro" in the style description too, keep the intro line-less, and end on a sung phrase.
4. **Avoid list.** Nothing from `brief.avoid`, and by default none of: named customers, third-party vendors or integrations by brand, compliance badges or certifications, beta or preview features, pricing, ticket or issue numbers, internal code names, competitor names.
5. **Exact feature names.** Every product name is spelled exactly as in the UI (from `research.md`), because the screen shows it verbatim.
6. **Every line can be shown.** On-screen copy is the sung lyrics, so a line that would embarrass the brand on a slide doesn't go in.

## Mechanical checks

Run these and quote the output in your report:

```sh
wc -m < creative/lyrics.suno.txt            # must be <= 5000
diff <(sed -e 's/Ky-zen/Kizen/g' creative/lyrics.suno.txt) creative/lyrics.screen.txt   # must print nothing
grep -niE '\[(spoken|rap)' creative/lyrics.*.txt   # must print nothing unless spoken-ok
```

Swap the `sed` expression for your own respellings, one `-e` per name or acronym (`-e 's/S-S-H/SSH/g'`). The `diff` proves the two files differ only by respelling.

## The style description (suno-prompt.md)

- One line: genre and sub-genre (from `brief.genre`), BPM, groove, vocal type from `brief.vocalStyle`, "all vocals sung", "no spoken intro or outro" when the vocals are sung only, the energy arc (cinematic intro, gang-vocal chorus, epic build), and the tone. Give its character count.
- Name a swap for the vocal ("male" to "female" or "duet").
- **Inferring (unverified):** the style description's length limit. Keep it at or under about 200 characters; 172 and 191 both worked. When it's tight, drop what the genre implies (a power ballad implies big drums) and keep the BPM your syllable plan is built on.

## Timing: don't promise it

Suno songs come back **longer than planned** and add instrumental sections: the Kizen song was planned at 48 bars (about 93 s) and came back at 131 s, with a 7 s build after the intro and a 16 s instrumental after the outro. A ballad planned at about 2:45 came back at 4:23, with a long piano intro and a 31 s instrumental tail. Its tempo moved too: lyrics written at 80 BPM came back in a take the analysis read at about 131 BPM with a half-time feel, and the alignment still worked. So:

- Say "about N seconds as written; Suno usually runs longer" and nothing more precise.
- Never tell the user the video timing depends on the bar counts. Section times come from `pnpm align`, not from your plan.
- `[End]` may help Suno stop after the outro. **Inferring (unverified).**

## lyrics.md format

1. **Header:** title, BPM, meter, bar length in seconds, planned bars and seconds, the tone and where the jokes land.
2. **Section table:** section, bars, approximate time, mood.
3. **The screen lyrics block**, marked "don't paste this into Suno", then **the Suno paste block**, with one line on what was respelled.
4. **Syllable map:** a table of section, line, syllable count with stresses in caps, bars, and a note (pivot line, pickup, held note). Then the rhyme pairs, the hook, and the sung-line count with "no spoken parts".
5. **Visual ideas per line:** one or two sentences each. They are **ideas, not a spec**: the video director picks the visual language and may ignore them. Say that at the top of the section. Use exact feature names; propose no on-screen text that isn't sung.
6. **Alternate chorus:** a drop-in replacement at close to the same meter, with its syllable counts and one line on what changes.
