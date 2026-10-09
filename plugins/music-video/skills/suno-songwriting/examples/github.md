# Worked example: "Unicorn Goodbye (GitHub)"

The finished song from the second music video, a satire. Use it for format and craft, especially the intro, the ending, and the hook. Don't reuse its structure, jokes, or hook for another company.

## The brief that shaped it

- Satire: a GitHub outage played as heartbreak, in an **overwrought power ballad**, dead serious. The genre set the meter (one line per 3 s bar at 80 BPM), the belted hook, and the key change.
- Research was community reaction (Hacker News threads, meme roundups) plus GitHub's own status-page and error-page wording, not the product pitch.
- Tone: funny. About 150 s targeted. All sung. No logo, and the video may be monetized, so the song was made on a paid Suno plan.

## Corrections the user made (apply them every time)

1. **No spoken intro or outro.** Earlier takes **spoke** the short intro line ("Days since GitHub was down: zero") and the one-word outro ("Resolved"). The intro became line-less with a piano cue; the counter line moved into verse 2's meter; "Resolved" moved inside a full sung line in the final tag. The style description gained "no spoken intro or outro".
2. **The title is the hook.** The user loved "unicorn goodbye", retitled the song to it, and wanted it sung again and again. Each chorus now opens on it and ends on it alone, as a belted held note, and the song ends on a soft, held repeat.

## Screen lyrics (`lyrics.screen.txt`, excerpt)

```
[Intro]
[Soft piano, no vocals]

[Verse 1]
[Tender, piano ballad]
I typed git push and held my breath
The terminal hung, as cold as death
I blamed my SSH agent first
Unplugged the router, feared the worst
...

[Pre-Chorus]
[Building, stop-time hits]
Degraded Performance
Partial Outage
Major Outage
Then you sent the unicorn

[Chorus]
[Soaring, full band, big drums]
GitHub, it's a unicorn goodbye
No server is currently available
to service your request
You're down and so am I
[Belted, long held note]
Unicorn goodbye

...

[Chorus]
[Key change, soaring, choir, everything at once]
(the five chorus lines)
[Softer, piano, tender]
It all says Resolved, we're back on track
But Copilot still won't text me back
[Soft, held to the end]
Unicorn goodbye

[End]
```

The line-less `[Intro]` became the instrumental lead-in section in `pnpm align`. There's no `[Outro]`: the song ends inside the final chorus on a sung phrase.

## Suno file (`lyrics.suno.txt`)

Identical, except "SSH" is "S-S-H", so it's sung as three letters while the screen shows SSH. One token in each file, so the word counts match. "GitHub" is sung as written. The check:

```sh
diff <(sed -e 's/S-S-H/SSH/g' creative/lyrics.suno.txt) creative/lyrics.screen.txt   # prints nothing
```

## Style description (191 characters)

```
Overwrought 80s power ballad, 80 BPM, piano intro, wailing electric guitar, powerful female belt vocal, all vocals sung, no spoken intro or outro, choir, final chorus key change, dead serious
```

"Huge drums" was dropped to fit, since the genre implies them and the chorus cue still asks for them. "80 BPM" stayed because the syllable plan is built on it.

## Syllable map (excerpt)

80 BPM, 4/4, one bar is 3.0 s. Verse lines get 1 bar each; most chorus lines get 2.

| Section | Line | Syllables | Bars | Note |
|---|---|---|---|---|
| Verse 1 | I blamed my SSH agent first | 9 (i BLAMED my ES-ES-AITCH A-gent FIRST) | 1 | acronym sung as letters |
| Verse 1 | So calm, so green, so rational | 7 (so CALM, so GREEN, so RA-tion-al) | 1 | joke lands on "rational" |
| Pre-Chorus | Major Outage | 4 (MA-jor OUT-age) | 1 | the company's own wording, stacked hit, held |
| Chorus | GitHub, it's a unicorn goodbye | 9 (GIT-hub, it's a U-ni-corn good-BYE) | 2 | opens on the hook; the name on the downbeat |
| Chorus | Unicorn goodbye | 5 (U-ni-corn good-BYE) | 2 | the hook alone, belted and held |
| Verse 2 | Days since GitHub was down: zero | 8 (DAYS since GIT-hub was DOWN: ZE-ro) | 1 | moved from the intro into the verse meter |
| Chorus 3 tag | It all says Resolved, we're back on track | 9 (it ALL says re-SOLVED, we're BACK on TRACK) | 1 | the one-word outro, folded into a full line |

## What Suno did with it

- Planned at about 2:45 to 2:55; the take came back at **4:23**, with a 13.7 s piano lead-in, two instrumental breaks, and a **31 s instrumental tail**. The length was kept, and each instrumental got its own visual idea. Ask the user before re-rolling for length.
- Written at 80 BPM; the analysis read the take at about **131 BPM with a half-time feel**. The alignment still worked.
