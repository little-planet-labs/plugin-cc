# Worked example: stand-alone Shorts mini-songs (Jira)

Two stand-alone Shorts from the third music video, followed from the pitch menu (step S1) to the Suno take. Use it for the format of `creative/shorts-pitches.md` and for what a take does to a pitch. Don't reuse its jokes, hooks, or style line for another company.

## The parent and the menu

- **The parent:** "The Worst Tool (Except for All the Others)", a satire of Jira as a comic operetta patter song, 179.6 s, sung only, no logo. Its aligned take had verse lines of 2.9 to 3.4 s (about 3.2 s each), read at 144 BPM, and held full-company lines of 5 to 6.7 s.
- **The menu:** `creative/shorts-pitches.md` in the parent project, 8 pitches, best first, with one shared style line, the rules held for every pitch, a "Left off" idea, and a checks table. Every pitch opens on `[Verse 1]` and `[Quick patter, crisp diction]`, ends on `[Full company, broad]` before the punchline, then `[End]`.
- **The user took pitches 1 and 2 to Suno**, the top two. Each became its own Short project (`shorts/jira-five-or-eight`, `shorts/jira-highest`).
- **Only exact names on screen.** The parent brief's `docQuotes` allowed Jira's default status, priority and resolution names, spelled exactly. So the priority names in pitch 2 could be sung and shown, and pitch 1 has no product names at all.

## Style description (199 characters)

Adapted from the patter line in the parent's `suno-prompt.md`. Cut: "no spoken intro or outro", "full-company chorus", "grand finish". Added: the short-form asks.

```text
Comic operetta patter song, 150 BPM, brisk piano and pizzicato strings, fast crisp sung diction, all vocals sung, no rap, vocals from the first beat, no intro, 30 seconds, full-company button, satire
```

The parent's line names no voice, so the menu says what to swap if a take comes back in a different voice: "fast crisp sung diction" becomes "fast crisp male baritone" or "fast crisp female soprano" (**Inferring (unverified)** that it gets close to the parent's singer).

## Pitch 1: "Is it a five or an eight?"

As pitched:

- **The one joke:** the planning meeting argues longer over the number than the work would take, so the meeting costs more than the ticket. **Confirmed by** (second-hand: summaries of two joke pages) `research.md`, Community: "Arguments over five versus eight for a one-checkbox change" and "I picked 17." 17 is not Fibonacci. The pitch file cited these by line number, and the numbers went stale when research.md was edited, so cite the section and quote the bullet.
- **Hook line:** "Five or eight? It's just a checkbox, and we've argued half an hour". The premise is in the first two words.
- **About 26 s as written:** 7 patter lines at about 3.2 s, plus a full-company last line of about 4 s.
- **The loop:** it ends "...but the meeting was an eight!", and the loop answers with "Five or eight?", so the argument starts over.
- **Is it new?** A new joke, and a sequel to the parent's best-performing Short ("What is a story point, anyway?", cut from verse 4). That one used Atlassian's definition; this one uses the haggling.

Screen and Suno (identical; nothing is respelled), as pitched:

```
[Verse 1]
[Quick patter, crisp diction]
Five or eight? It's just a checkbox, and we've argued half an hour
And the architect says thirteen, with their arms crossed, looking sour
Then the manager says two, because it's due by Friday night
And the intern says a hundred, and the intern might be right!
So we vote, and we reveal, and someone's holding seventeen
Which is not on any scale that any of us has ever seen
So we settle on a five, an hour and a half too late
[Full company, broad]
And the ticket was a five, but the meeting was an eight!

[End]
```

## Pitch 2: "Why is every ticket Highest?"

As pitched:

- **The one joke:** everything gets filed as Highest, so the really urgent one is lost among the others, and the other four priorities turn into folklore. The priority names are **Confirmed by** `research.md`, Features, the "Priorities (defaults)" bullet (summarised fetch of https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/). "Everyone files Highest" is **Inferring (unverified)**: no source states the habit.
- **Hook line:** "Highest! It's the only one we pick, it's all we ever do".
- **About 26 s as written:** 7 lines at about 3.2 s, plus a full-company last line of about 4 s. Cutting lines 5 and 6 brings it to about 20 s.
- **The loop:** it ends "...and they're Highest, through and through!" and loops straight into "Highest!", like the chorus answering.
- **Is it new?** A riff. Its button keeps the user's favourite parent line ("And it's sitting with the others, and they're Highest, through and through", verse 1) word for word, and line 2 echoes verse 1 line 4. The new jokes are the Lowest as a legend, the Medium as a rumor sitting in between, and the urgent ticket lost among the Highests.

Screen and Suno (identical), as pitched:

```
[Verse 1]
[Quick patter, crisp diction]
Highest! It's the only one we pick, it's all we ever do
Though there's High, and there's a Medium, a Low, a Lowest too
Oh, the Lowest is a legend, and the Low is never seen
And the Medium's a rumor, sitting lonely in between
When the boss says, "Pick what matters!" we all promise that we will
Then we file the next one Highest, and the next one Highest still
And the one that's actually urgent is in there, out of view
[Full company, broad]
'Cause it's sitting with the others, and they're Highest, through and through!

[End]
```

## Checks (from the menu)

| Pitch | Suno characters | diff | `[Spoken]`/`[Rap]` | Sung words (Suno/screen) | Sung lines |
|---|---|---|---|---|---|
| 1. Five or eight | 552 | empty | none | 95/95 | 8 |
| 2. Highest | 568 | empty | none | 95/95 | 8 |

The avoid grep over all the menu's screen text (other vendors and Atlassian products, Rovo, and the excluded "Done", "Reopened", "Closed" and "Resolved") found nothing.

## What was sung

Three words came back different, each the first word of a line. The lead changed the Short's `lyrics.screen.txt` and `lyrics.suno.txt` to what was sung, re-aligned, and recorded each edit under "Lyric edits from the alignment" in `creative/direction-short.md`:

| Short | Line | Written (pitch) | Sung | Evidence |
|---|---|---|---|---|
| Five or eight | verse-1-2 | **And** the architect says thirteen | **Then** the architect says thirteen | The free transcript heard "Then"; the aligned word runs 4.675 to 4.845 s. |
| Highest | verse-1-2 | **Though** there's High | **But** there's High | The free transcript heard "But"; the CTC model preferred it by 14.8 log-points. |
| Highest | verse-1-3 | **Oh,** the Lowest is a legend | **For** the Lowest is a legend | The free transcript heard "For"; the stem shows an /f/ burst at 8.19 s. |

After the edits, the alignments matched 94 of 95 and 93 of 95 words against the free transcript. Line 2 of "Five or eight" now opens on "Then", like line 3. Nothing in the pitch was wrong; Suno just sang something else, which is why the screen lyrics are re-checked against every take.

## What Suno did with it

| Short | Suno's title | Take | First sung word | Sung span | Lines arrived every | After the last word |
|---|---|---|---|---|---|---|
| Five or eight | "The Ticket Was a Five" | 28.40 s | 1.235 s | 26.2 s | 3.19 to 3.44 s | 0.94 s of the button chord |
| Highest | "Highest Through and Through" | 31.64 s | 1.855 s | 28.0 s | 3.02 to 3.41 s | 1.83 s of the button and its decay |

- **The estimate was close.** "About 26 s as written" became a sung span of 26.2 s and 28.0 s. The takes ran 2.4 s and 5.6 s longer than the estimate, mostly the lead-in, the held last line (5.0 s in "Highest") and the final chord.
- **One bar of lead-in each**, despite "vocals from the first beat, no intro": 1.2 s of piano and pizzicato vamp, and 1.9 s of full accompaniment. The parent's take had opened on a 10.7 s instrumental. The director offered to start "Five or eight" on its first sung word (a 27.17 s cut); the user posted the full 28.4 s take, with a moving opening frame over the vamp.
- **Both ended on a decayed button chord**, so neither video needed an added tail, and the loop has no silent frames.
- **The analysis read the takes at 139 and 137 BPM**, with a jittery grid, against the 150 BPM in the style line. The lines still arrived every two bars at about 145 BPM, as in the parent.
