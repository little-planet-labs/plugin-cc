---
name: music-video
description: The playbook for making a beat-synced kinetic-typography music video about any company, satire and parody included, with a song generated in Suno and a video rendered in Remotion. Runs eight phases with user checkpoints (brief interview, company research, topic menu, lyrics and Suno pack, the user's song, the audio pipeline, creative direction with a per-line beat map, and the scene build) plus an optional concept round, then a critique loop in which a separate read-only critic scores each half-res draft on a fixed rubric until every score reaches 8, before the master render. Names the agent and hand-off for each, and covers instantiating the project from the template, logo use, monetization and the user's hard rules, taking in the audio, feedback rounds, the quality level, the deliverables, and cleanup. Use when the user wants a music video, song, or lyric video about a company or product.
user-invocable: true
---

# Music video

You are the lead. Run the phases in order, stop at every ★ for the user, and dispatch the plugin's four agents for the phases they own: `music-video:company-researcher`, `music-video:lyricist`, `music-video:video-director`, and `music-video:video-critic`. Everything without an agent is yours. Don't skip ahead: no lyrics before the topics are approved, and no full build before the direction or a concept is approved.

## Ground rules

- **Questions go through `AskUserQuestion`**, never buried in prose. Load `little-planet-factory:asking-questions` if it's installed. Batch up to four related questions per call, recommended option first.
- **On-screen copy is lyrics, exact feature names, and the logo** (only as `brief.logoUse` allows). No invented taglines, labels, or captions that aren't sung.
- **The audio is read-only.** Nothing writes to `public/audio/track.*` after intake.
- **No git writes** unless the user asks. Follow `little-planet-factory:version-control` if it's installed; the default is to leave everything uncommitted.
- **Sandbox.** Headless Chrome can't launch inside the Claude Code Bash sandbox (mach-port denial), so `pnpm still`, `pnpm render`, and `pnpm draft` (including the composition's metadata step they run, and the text-only render) need an unsandboxed run: pass `dangerouslyDisableSandbox: true`, or ask the user to turn the sandbox off with `/sandbox`. `preview`, `contact-sheet`, `analyze`, `align`, `critique`, `pops`, `jitter`, and `beatmap` don't launch Chrome and run inside the sandbox. Inside the sandbox, `pip` needs `--use-deprecated=legacy-certs`.
- **Quality level.** Pipeline code gets an inspector: if anyone changes the deterministic pipeline (template `src/lib`, `scripts/`, render), that diff goes to an inspector (`little-planet-factory:quality-bar`, foundational tier). The video gets a judge: the builder can't review its own work, so every draft goes to `music-video:video-critic`, a separate read-only agent that scores it on a fixed rubric with a default stance of reject, and the build loops until it accepts (phase 8). In a howseen-ai/claude-motion-design run, the critic's first round caught text collisions, a dead 14 s intro and 30 s outro, lyrics cropped by the top edge, a strobe, and a hard-edged card, all missed by the builder's own still checks. Lyrics and direction are still the user's to approve at their checkpoints.
- **General rules and per-video style.** Two rules hold for every video: the concept round is offered (phase 7b), and there's no beat-locked rhythmic pulsing by default on a slow song without heavy beats unless the brief asks for it. So do the universal defect checks the critic runs (shimmering held text, clipped descenders, collisions and crops, hard-edged seams, pops and flashes, phone readability, lyric accuracy, sync) and the pacing rules (motion by 0.5 s, a visible change at least every 4 s). The structure is general too: the direction defines one unifying visual system (a world, a material, a type system, a palette logic, and a motion language) that holds the whole video together, and variety comes from staging and transformations inside it, never from a new unrelated world per line. Which system, and everything else about the look (palette, type, mascot treatment), is decided per video in the direction, from the brief and the user's words.

## Phases

| # | Phase | Who | Writes | Stop |
|---|---|---|---|---|
| 1 | Brief interview | you | `creative/brief.json` | ★ |
| 2 | Research | `music-video:company-researcher` | `creative/research.md`, `src/brand.json`, `public/brand/logo.svg`, `avoid` in brief.json | |
| 3 | Topic menu | `music-video:lyricist` | `creative/topics.md`; you record `approvedTopics` | ★ |
| 4 | Lyrics and Suno pack | `music-video:lyricist` | `creative/lyrics.md`, `lyrics.screen.txt`, `lyrics.suno.txt`, `suno-prompt.md` | ★ |
| 5 | Song and audio intake | the user, then you | `public/audio/track.wav` or `.mp3` | ★ |
| 6 | Pipeline | you | `src/data/audio-analysis.json`, `lyrics.json`, `sections.json` | |
| 7 | Creative direction | `music-video:video-director` | `creative/direction.md`, `creative/beatmap.md` | ★ |
| 7b | Concept round (optional) | `music-video:video-director` | `creative/concepts.md`, `src/concepts/<slug>/`, sheets and motion tests under `out/concepts/` | ★ |
| 8 | Scene build and draft rounds | `music-video:video-director` | `src/scenes/**` (or the chosen concept), `out/draft-r<n>.mp4`, `out/critique/r<n>/` | |
| 8 | Critique, each round | `music-video:video-critic` (read-only) | nothing; you save its report to `creative/critique/r<n>.md` and show the user the scores | |
| 8 | Master render, after ACCEPT | `music-video:video-director` | the MP4, preview, contact sheet | |

Every agent brief gives the absolute project path and the files the agent may write. Agents write only their own files.

## 1. ★ Brief interview

Settle what the request doesn't already say. Three `AskUserQuestion` rounds usually cover it:

- **Round 1:** sources (website only, website plus a local repo path, or the community sources the user names), audience, tone (funny, serious, a mix, or satire), **genre** (it shapes the meter, the hook, and the jokes, so ask before any lyrics), and target length (about 60 s, 90 s, or 2 min; say that Suno songs usually come back longer).
- **Round 2:** how the company name is **pronounced** (offer two or three phonetic spellings plus "as written"; this sets `pronunciation.sung`), vocals (sung only, recommended, or spoken parts allowed), vocal style (male, female, duet, no preference), and topics to keep out (multi-select: named customers, pricing, competitors, unreleased features; for a satire, offer named people and specific dated incidents instead of pricing and unreleased features).
- **Round 3:** whether the video will be **monetized**, and how the **logo** may be used (below).

**Satire and parody are fine.** Record the angle in `concept` and the sources the user named in `sources`. Research then targets community reaction (forums, posts, memes, the company's own status or error copy) alongside the brand, not the product pitch.

**Logo use.** Quote the company's brand rules in the question: most brand pages say whether the mark may be recoloured, distorted, or combined with other elements, and few mention parody. Look for a brand or press page yourself; if you can't find the rules, ask right after research, when the researcher's report quotes them. Options: untouched, altered as parody, or left out. Record the answer in `logoUse` (`"untouched"`, `"parody"`, or `"omitted"`); when it's `"omitted"`, nothing renders the logo or any company mark.

**Monetization.** If the video will earn money:

- Altering the logo raises takedown risk, so recommend untouched or left out.
- The song must be made on a paid Suno plan. Free-plan output is reportedly non-commercial; that comes from third-party summaries, not Suno's own terms, so tell the user to check Suno's current terms. **Inferring (unverified).**
- Tell the user to expect YouTube's disclosure for AI-generated content when they upload.

**Visual style.** If the user describes the look they want, copy their words verbatim into `visualStyle`. The director reads it as a requirement.

**Hard rules.** When the user states a rule for the video, at any point ("keep the lyrics still", "no pulsing", "never all caps"), add it verbatim to `hardRules`. The critic checks every entry one by one, along with the general rules and the universal defect checks.

Also settle the project folder; the default is `~/Developer/<company-slug>-music-video`. Then instantiate the project (next section) and write `creative/brief.json`:

```json
{
  "company": "Acme",
  "website": "https://acme.example",
  "repo": "/Users/me/Developer/acme-app",
  "concept": "",
  "sources": "website and repo",
  "pronunciation": {"screen": "Acme", "sung": "Ack-mee"},
  "audience": "operations leaders",
  "tone": "half funny, half serious",
  "genre": "upbeat electro-pop",
  "targetSeconds": 90,
  "vocals": "sung-only",
  "vocalStyle": "female",
  "visualStyle": "",
  "logoUse": "untouched",
  "monetized": false,
  "hardRules": [],
  "avoid": ["named customers", "pricing"],
  "approvedTopics": []
}
```

## Instantiate the project

Do it right after the interview, so research has somewhere to write. Follow `music-video:remotion-pipeline` for the exact steps; in short:

1. The template is `../remotion-pipeline/template/` relative to this skill's base directory. Copy it to the project folder. Stop if the folder exists and isn't empty.
2. `pnpm install` in the project.
3. Run `pnpm setup:audio` now (it creates `.venv/`). Leave `pnpm setup:align` for phase 6; it downloads about 1.4 GB.

## 2. Research: company-researcher

Dispatch `music-video:company-researcher`:

```
Project: <abs path>. Read creative/brief.json. Load music-video:brand-extraction.
Research <company> from <website> [and the repo at <path>] [and these sources: <the user's list>].
[Satire: research the community reaction to <concept> as well as the brand.]
Write: creative/research.md (positioning, product features with their exact UI names
from code when the repo is available, each finding labeled "Confirmed by <source>" or
"Inferring"), src/brand.json, public/brand/logo.svg (plus on-dark/on-light variants),
and add to brief.json's "avoid" list (named customers, third-party vendors, compliance
badges, beta or preview features, ticket numbers). Don't change the user's answers.
Report: font license verdict, logo source, the brand's logo usage rules quoted,
which sources you fetched and which were blocked, and anything you couldn't confirm.
```

Check its report against the files: `src/brand.json` parses, the logo has no unresolved `var(` or `currentColor`, every feature name carries a source, and every source the user named was either fetched or reported as blocked. **Send the researcher back** when a named source wasn't tried.

What reaches the web from an agent (one run, 2026-10):

- **Hacker News** works through the Algolia API (`hn.algolia.com/api/v1/search` and `/items/<id>`), and it was the best community source.
- **Reddit** returned a bot-check page (www and old), **Bluesky**'s public `searchPosts` returned 403, and **X** needs a login. Use meme aggregators, blog roundups, and web search instead, labelled second-hand.

If the logo question is still open, ask it now with the researcher's quote of the rules, and record `logoUse`.

## 3. ★ Topic menu: lyricist

```
Project: <abs path>. Load music-video:suno-songwriting. Read brief.json and research.md.
Write ONLY creative/topics.md: a numbered menu of 12 to 18 song topics, each one line
with its source from research.md. Respect brief.avoid. No lyrics.
```

Show the menu in your message, then ask one `AskUserQuestion`: approve all, approve with cuts or additions (they type the numbers and notes), or redo the menu. Record the result in `brief.json` `approvedTopics` as the topic text, not the numbers. Iterate until approved. No lyrics before this.

## 4. ★ Lyrics and Suno pack: lyricist

```
Project: <abs path>. Load music-video:suno-songwriting. Read brief.json (approvedTopics,
pronunciation, vocals, tone, genre, targetSeconds) and research.md.
Write creative/lyrics.md, lyrics.screen.txt, lyrics.suno.txt, suno-prompt.md.
Run the skill's checks (character count, screen/suno diff, logic checks) and quote the results.
```

Show the user the screen lyrics, the title, the style description, and the pronunciation notes. Ask: approve, revise (with notes), or swap in the alternate chorus. Revisions go back to the lyricist with the user's words quoted. If the user retitles the song, the new title becomes the hook: send it back so the chorus sings it.

## 5. ★ Song and audio intake

Tell the user exactly what to paste: the whole of `creative/lyrics.suno.txt` into Suno's lyrics box, and the style description from `creative/suno-prompt.md`. Ask them to export WAV if they can. If a take mispronounces the name, or speaks a line that should be sung, they re-roll with the fallback from `suno-prompt.md`. If `brief.monetized` is true, remind them the song needs a paid Suno plan.

**Length.** Suno runs long: a song planned at about 2:45 came back at 4:23, with a long piano intro and a 31 s instrumental tail. When a take is much longer than planned, tell the user its length and ask whether that's OK before anyone re-rolls. Long instrumentals become their own sections, and each one needs a real visual idea in the direction.

Take the audio in either form:

- **A local path:** copy it to `public/audio/track.wav` (or `track.mp3` for an MP3).
- **A Cadence file number:** call `get_file` with the number, then `curl -fsS -o public/audio/track.<ext> "<downloadUrl>"`. The URL works once and expires in 15 minutes.

Keep exactly one of `track.wav` and `track.mp3`. Confirm it with `ffprobe` (duration, sample rate) and tell the user the length.

## 6. Pipeline

```sh
pnpm analyze        # beats, downbeats, onsets, band energy
pnpm setup:align    # once; models land in .cache/models
pnpm align          # reads creative/lyrics.screen.txt, writes lyrics.json and sections.json
```

Review the output, not the code:

- Every lyric line was found, in order. If Suno skipped, repeated, or changed a line, edit `lyrics.screen.txt` to match what was sung and re-run `pnpm align`. Tell the user if the meaning changed.
- Sections tile the song, and instrumental stretches (Suno adds them) are their own sections.
- Downbeats sit on the sung stresses. If "the 1" slips, add anchors to `src/data/timing-overrides.json` and re-run.

`music-video:remotion-pipeline` has the details and failure modes, including blocked model hosts.

## 7. ★ Creative direction: video-director

```
Project: <abs path>. Load music-video:scene-authoring and music-video:remotion-pipeline.
Read brief.json, research.md, lyrics.md, src/brand.json, src/data/*.json.
The user's visual style, verbatim: "<brief.visualStyle>". Logo use: <brief.logoUse>.
Past directions to avoid repeating: <vault entries tagged music-video-direction, or the
user's answer>. Hard rules: <brief.hardRules>. Write ONLY creative/direction.md
(including its one unifying system and two contrasting alternates in one line each) and
creative/beatmap.md (start from pnpm beatmap). No scene code yet.
```

Before dispatching, look up past directions: with Cadence connected, `list_knowledge` with `tag: "music-video-direction"`; otherwise ask the user which past videos and looks to avoid. Show the user the direction's summary and ask: approve, pick an alternate, run a concept round, or redirect with notes.

## 7b. ★ Concept round: video-director

Stills and a written direction can't show motion, and a single look rejected after a full render costs hours. Offer a concept round between direction approval and the full build, or in place of the single direction when the user wants options.

```
Project: <abs path>. Concept round. Load music-video:scene-authoring and
music-video:remotion-pipeline. The user's words: "<verbatim>".
Pitch three really different unifying systems in creative/concepts.md, each varying
across the same moments while staying one piece, with a recommendation.
Build each as its own composition under src/concepts/<slug>/, registered in src/Root.tsx;
leave src/scenes/ and the main composition alone. For each concept render:
- a contact sheet of the SAME ~10 key lyric moments, at their real song frames
- a 10 to 14 s motion test of the pre-chorus into chorus 1:
  pnpm render --composition=<id> --frames=<a>-<b>
Working stills go under out/concepts/wip/. Report the sheet and clip paths.
```

Read each sheet so it shows inline, give the clip paths, and ask: pick one, combine (name what to take from each), or redirect. After the pick, the director extends the chosen concept to the whole song and renders it with `pnpm render --composition=<id>`; that composition is the build, and phase 8 runs on it.

When the user dislikes one element (a mascot, a graphic, a transition), don't re-render the video to try again. Have the director pitch 2 or 3 treatments of just that element as an in-context options sheet with short clips, and re-render once the user picks.

## 8. Build, critique loop, and render

Phase 8 is a loop: the director builds and drafts, a separate critic judges, the director fixes, and only an accepted draft becomes the master. There's no round cap. Each round costs about 3 to 4 minutes of judging, plus a half-res draft (a few minutes for a full song; measure it on the first round) and the director's fixes. The user can still call it at any round.

### Build and the first draft: video-director

```
Project: <abs path>. Direction approved: creative/direction.md and creative/beatmap.md
[or concept <id>] [plus the user's notes, verbatim]. Load music-video:scene-authoring and
music-video:remotion-pipeline. Build every scene in one pass: lyrics on LyricLayer, world
transitions through ShotTimeline only, a designed exit on every line, hard cuts only where
the beat map puts them. Then run draft round 1: pnpm draft --out out/draft-r1.mp4,
pnpm critique --in out/draft-r1.mp4 --tag r1 (extra strips under --tag r1-extra),
pnpm pops --in out/draft-r1.mp4 --cuts=<hard-cut frames> --fail (output to
out/critique/r1.pops.txt), then the full-scale text-only render
pnpm render --props='{"textOnly":true}' --out out/text-only.mp4 (always with --out, or it overwrites the
main video) and pnpm jitter --all-lines --in out/text-only.mp4 (output to
out/critique/r1.jitter.txt). pnpm draft, still and render launch Chrome and need
dangerouslyDisableSandbox: true. Stop and report the round; don't master-render.
```

### Each round

1. **The director reports round `n`:** the draft path, the critique sheet paths, the pops result, and the jitter result. Check the files exist and that pops and jitter passed; send it back if not.
2. **Spawn the critic** (`music-video:video-critic`):

   ```
   Project: <abs path>. Round <n>. Judge out/draft-r<n>.mp4 from its critique files:
   out/critique/r<n>/ (overview_*, phone_*, strip_*) [and out/critique/r<n>-extra/],
   out/critique/r<n>.pops.txt,
   out/critique/r<n>.jitter.txt. Previous round's sheets: out/critique/r<n-1>/ [none on
   round 1]. Also read creative/brief.json (hardRules, logoUse, genre, tone, visualStyle),
   src/data/lyrics.json, creative/beatmap.md, creative/direction.md, and the earlier
   reports creative/critique/r1.md to r<n-1>.md. The director says it changed (claims to
   check, not facts): <the director's change list>. Return your fixed report.
   ```

3. **Save the report** verbatim to `creative/critique/r<n>.md`, so the next round's critic can mark earlier items fixed or not.
4. **Give the user the scores** after every round: the nine scores in a table next to the previous round's, the three worst problems in a line each, and the verdict. Don't wait for an answer unless they want to weigh in; carry on.
5. **REJECT:** resume the director with the report verbatim. It snapshots what it will change, fixes the 3 worst problems plus every item scored 7 or lower, leaves sections scored 9 or higher alone (the regression guard), and runs round `n + 1`. If the critic judged this draft worse than the previous one side by side, the director first puts back the sections it named as regressed: a new draft replaces the previous one only when the critic judges it better.
6. **ACCEPT** (every score 8 or more and no hard-rule violation): go to the master render.

### Master render: video-director

```
Project: <abs path>. The critic accepted draft r<n>. Master-render it: pnpm render
[--composition=<id>] [--image-format=png], pnpm preview, pnpm contact-sheet [for a
concept, both with --in out/<id>.mp4 and their own --out]. Report the output paths.
```

For text-heavy masters, `pnpm render --image-format=png` avoids JPEG blocking around type; it's about 50% slower and much bigger (about 650 MB for a 4:23 master).

Read the contact sheet image yourself once: a blank, washed-out, or empty-captioned cell goes back to the director with its timestamp. Otherwise deliver.

## Feedback rounds

- **Relay the user's words verbatim** to the director, in quotes, alongside your summary. A paraphrase loses what they disliked.
- **Stop a rejected render.** When the user rejects something in a render that's still running, stop that render before it finishes; don't spend the time finishing a look that's already out.
- **Re-measure, don't eyeball.** Ask for numbers: `pnpm jitter` on the held lyrics the user flagged, A/V sync by cross-correlating the MP4's audio against `public/audio/track.*` (extract it with ffmpeg; the lag should be under one frame), and `pnpm pops` plus the critique strips for anything between shots. "It looks fine now" isn't a fix.
- **Feedback goes through a critique round.** The director's fix comes back as a new draft round, and the critic judges it as usual, with any new rule the user stated added to `hardRules` first. Master-render again only after an ACCEPT.

## Deliverables

Send the user:

- **The MP4**: its absolute path (from `pnpm render`'s output).
- **The preview**: 720p H.264 under 30 MB, sized for chat upload. Give its path.
- **The contact sheet**: Read the PNG so it shows inline, and give its path.

For a concept composition, `pnpm render --composition=<id>` writes `out/<id>.mp4`, so run the other two against it: `pnpm preview --in out/<id>.mp4 --out out/<id>-preview.mp4` and `pnpm contact-sheet --in out/<id>.mp4 --out out/<id>-contact-sheet.png`. Verify A/V sync (cross-correlation, as in feedback rounds) on any MP4 that `pnpm render` didn't make.

When Cadence is connected you can also store the contact sheet with `prepare_file_upload` and give its file number. That path caps files at 4 MB, so the preview usually doesn't fit; leave it as a path.

Then save the direction to the log: with Cadence connected, `create_knowledge` with tag `music-video-direction`, the company in the title, and the direction's summary (typography, motion, colour, texture, transitions). Search first and skip it if the entry exists.

## Cleanup

List these with their sizes (`du -sh`) and ask with a multi-select `AskUserQuestion` which to delete:

| Path | Size seen | Safe because |
|---|---|---|
| `.cache/models/dl` | 560 MB of download tarballs | the extracted models stay in `.cache/models` |
| `out/wip-*` | about 15 MB each | working stills and test renders only |
| `out/draft-r*.mp4`, `out/critique/`, `out/snapshots/` | not measured yet; check with `du -sh` | half-res drafts, critique sheets, and round snapshots; the critic reports stay in `creative/critique/` |
| `out/concepts/wip` | 2.4 GB after a concept round | working stills for the concept sheets |
| A cancelled concept's full renders | 2.3 GB each with PNG frames | the concept wasn't picked; its source stays in `src/concepts/` |
| `.venv-align` | about 500 MB (493 MB) | `pnpm setup:align` recreates it; delete once the lyrics are final |

Never delete `public/audio/`, `creative/`, `src/`, the final MP4, the preview, or the contact sheet. Keep the extracted models in `.cache/models` (about 830 MB; 822 MB in the second run) unless the user says alignment is done for good; re-aligning without them means downloading everything again. Delete only what the user ticked, and report what was deleted with its size.
