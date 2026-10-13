---
name: music-video
description: The playbook for making a beat-synced kinetic-typography music video about any company, satire and parody included, with a song generated in Suno and a 4K video drawn as a time-seeked HTML page, captured with Playwright and encoded with ffmpeg. Runs eight phases with user checkpoints (brief interview, company research, topic menu, lyrics and Suno pack, the user's song, the audio pipeline, creative direction with a per-line beat map, and the scene build) plus an optional concept round, then a critique loop in which a separate read-only critic scores each half-res draft on a fixed rubric until every score reaches 8, before the master render. Names the agent and hand-off for each, and covers instantiating the project, logo use, monetization and hard rules, audio intake, feedback rounds, the quality level, render times and machine load, the deliverables, and cleanup. Use when the user wants a music video, song, or lyric video about a company or product.
user-invocable: true
---

# Music video

You are the lead. Run the phases in order, stop at every ★ for the user, and dispatch the plugin's four agents for the phases they own: `music-video:company-researcher`, `music-video:lyricist`, `music-video:video-director`, and `music-video:video-critic`. Everything without an agent is yours. Don't skip ahead: no lyrics before the topics are approved, and no full build before the direction or a concept is approved.

## Ground rules

- **Questions go through `AskUserQuestion`**, never buried in prose. Load `little-planet-factory:asking-questions` if it's installed. Batch up to four related questions per call, recommended option first.
- **On-screen copy is lyrics, exact feature names, and the logo** (only as `brief.logoUse` allows). No invented taglines, labels, or captions that aren't sung.
- **The audio is read-only.** Nothing writes to `public/audio/track.*` after intake, and every render muxes it untouched: no resampling, no loudness normalisation.
- **No git writes** unless the user asks. Follow `little-planet-factory:version-control` if it's installed; the default is to leave everything uncommitted.
- **Sandbox.** Headless Chromium can't launch inside the Claude Code Bash sandbox (mach-port denial), so `pnpm still`, `draft`, `render`, `still-test`, `jitter --all-lines` and `test:render` need the sandbox disabled for that command: pass `dangerouslyDisableSandbox: true`, or ask the user to turn the sandbox off with `/sandbox`. `analyze`, `align`, `beatmap`, `check`, `critique`, `pops`, single-window `jitter`, `preview`, `contact-sheet` and `pnpm test` run inside it. Inside the sandbox, or behind a TLS-intercepting proxy, the setup commands need `PIP_USE_DEPRECATED=legacy-certs` in front.
- **Machine load.** One heavy render on the machine at a time: a master, a draft, a text-only render, a concept clip, `still-test` or an alignment run, never two at once, across agents too. Never dispatch two directors that render at the same time. The render pool's cap is `render.pool` in `src/pipeline.json` (see "Renders and machine load").
- **Quality level.** Pipeline code gets an inspector: if anyone changes the template's engine or scripts (`index.html`, `src/engine/`, `src/lib/`, `scripts/`, `tests/`, `package.json`), that diff goes to an inspector (`little-planet-factory:quality-bar`, foundational tier), and `pnpm test` and `pnpm test:render` (unsandboxed) must pass in the project. The video gets a judge: the builder can't review its own work, so every draft goes to `music-video:video-critic`, a separate read-only agent that scores it on a fixed rubric with a default stance of reject, and the build loops until it accepts (phase 8). In a howseen-ai/claude-motion-design run, the critic's first round caught text collisions, a dead 14 s intro and 30 s outro, lyrics cropped by the top edge, a strobe, and a hard-edged card, all missed by the builder's own still checks. Lyrics and direction are still the user's to approve at their checkpoints.
- **General rules and per-video style.** These hold for every video:
  - **One unifying visual system**, varied inside it. The direction defines one world, material, type system, palette logic and motion language that hold the whole video together; variety comes from staging and transformations inside it, as much and as often (per line or per section) as the direction sets, never from a new unrelated world per line. No rule says each scene must look different from the others.
  - **The concept round** is offered (phase 7b).
  - **No beat-locked rhythmic pulsing** by default on a slow song without heavy beats, unless the brief asks for it.
  - **The universal defect checks** the critic runs: shimmering held text, clipped descenders, collisions and crops, hard-edged seams, pops and flashes, phone readability, lyric accuracy, and sync.
  - **The pacing rules:** motion by 0.5 s, and a visible change at least every 4 s.

  Which system, and everything else about the look (palette, type, mascot treatment), is decided per video in the direction, from the brief and the user's words.

## Phases

| # | Phase | Who | Writes | Stop |
|---|---|---|---|---|
| 1 | Brief interview | you | `creative/brief.json`, `creative/reference/` | ★ |
| 2 | Research | `music-video:company-researcher` | `creative/research.md`, `src/brand.json`, `public/brand/logo.svg`, `avoid` in brief.json; then you run `pnpm fonts` | |
| 3 | Topic menu | `music-video:lyricist` | `creative/topics.md`; you record `approvedTopics` | ★ |
| 4 | Lyrics and Suno pack | `music-video:lyricist` | `creative/lyrics.md`, `lyrics.screen.txt`, `lyrics.suno.txt`, `suno-prompt.md` | ★ |
| 5 | Song and audio intake | the user, then you | `public/audio/track.wav` or `.mp3` | ★ |
| 6 | Pipeline | you | `src/data/audio-analysis.json`, `lyrics.json`, `sections.json` | |
| 7 | Creative direction | `music-video:video-director` | `creative/direction.md`, `creative/beatmap.md`, `creative/style-guide.md` with a reference | ★ |
| 7b | Concept round (optional) | `music-video:video-director` | `creative/concepts.md`, `src/concepts/<slug>.js` and `src/concepts/<slug>/`, sheets and motion tests under `out/concepts/` | ★ |
| 8 | Scene build and draft rounds | `music-video:video-director` | `src/scenes/**`, `out/draft-r<n>.mp4`, `out/critique/r<n>/` | |
| 8 | Critique, each round | `music-video:video-critic` (read-only) | nothing; you save its report to `creative/critique/r<n>.md`, log the round, and show the user the scores | |
| 8 | Master render, after ACCEPT | `music-video:video-director` | the MP4, preview, contact sheet | |

Every agent brief gives the absolute project path and the files the agent may write. Agents write only their own files.

## 1. ★ Brief interview

Settle what the request doesn't already say. Three `AskUserQuestion` rounds usually cover it:

- **Round 1:** sources (website only, website plus a local repo path, or the community sources the user names), audience, tone (funny, serious, a mix, or satire), **genre** (it shapes the meter, the hook, and the jokes, so ask before any lyrics), and target length (about 60 s, 90 s, or 2 min; say that Suno songs usually come back longer).
- **Round 2:** how the company name is **pronounced** (offer two or three phonetic spellings plus "as written"; this sets `pronunciation.sung`), vocals (sung only, recommended, or spoken parts allowed), vocal style (male, female, duet, no preference), and topics to keep out (multi-select: named customers, pricing, competitors, unreleased features; for a satire, offer named people and specific dated incidents instead of pricing and unreleased features).
- **Round 3:** whether the video will be **monetized**, how the **logo** may be used (below), and whether they have a **reference** for the look: a video or frames they like, a named style, or none.

**Satire and parody are fine.** Record the angle in `concept` and the sources the user named in `sources`. Research then targets community reaction (forums, posts, memes, the company's own status or error copy) alongside the brand, not the product pitch.

**Logo use.** Quote the company's brand rules in the question: most brand pages say whether the mark may be recoloured, distorted, or combined with other elements, and few mention parody. Look for a brand or press page yourself; if you can't find the rules, ask right after research, when the researcher's report quotes them. Options: untouched, altered as parody, or left out. Record the answer in `logoUse` (`"untouched"`, `"parody"`, or `"omitted"`); when it's `"omitted"`, nothing renders the logo or any company mark.

**Monetization.** If the video will earn money:

- Altering the logo raises takedown risk, so recommend untouched or left out.
- The song must be made on a paid Suno plan. Free-plan output is reportedly non-commercial; that comes from third-party summaries, not Suno's own terms, so tell the user to check Suno's current terms. **Inferring (unverified).**
- Tell the user to expect YouTube's disclosure for AI-generated content when they upload.

**Visual style.** If the user describes the look they want, copy their words verbatim into `visualStyle`. The director reads it as a requirement.

**Reference.** A reference video or frames go under `creative/reference/` (copy a local path, or fetch a Cadence file as in phase 5), and `reference` names them, or holds the named style in the user's words ("like a Swiss transit poster"). The director studies a reference before writing the direction and takes its grammar, never its content or logos.

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
  "reference": "",
  "logoUse": "untouched",
  "monetized": false,
  "hardRules": [],
  "avoid": ["named customers", "pricing"],
  "approvedTopics": []
}
```

## Instantiate the project

Do it right after the interview, so research has somewhere to write. Follow `music-video:video-pipeline` for the exact steps; in short:

1. The template is `../video-pipeline/template/` relative to this skill's base directory. Copy it with `cp -R` (so `.gitignore` comes along) to the project folder. Stop if the folder exists and isn't empty. Never run anything inside the plugin's template.
2. There are no npm dependencies: don't run `pnpm install`.
3. Run `pnpm setup:env` now. It checks ffmpeg and ffprobe (libx264, aac), builds `.venv/` (librosa, numpy, pillow, playwright) and downloads headless Chromium into `.cache/ms-playwright` (about 195 MB). Leave `pnpm setup:align` for phase 6; it downloads about 650 MB of models that unpack to about 1.4 GB.

The machine needs Node 22.18 or newer, pnpm, Python 3.14, ffmpeg and ffprobe with libx264 and aac, and `curl` and `tar`. If `setup:env` reports one missing, tell the user what to install.

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

Check its report against the files: `src/brand.json` parses and `pnpm check` accepts it, the logo has no unresolved `var(` or `currentColor`, every feature name carries a source, and every source the user named was either fetched or reported as blocked. **Send the researcher back** when a named source wasn't tried.

Then run `pnpm fonts` (it needs network access). It downloads every `"source": "google"` family and weight in `brand.json` into `public/fonts/`. If it fails naming a family or weight, the researcher picked one Google Fonts doesn't serve under that name: send it back with the error. Run `pnpm fonts` again whenever `brand.json`'s fonts change; renders never touch the network.

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

**Length.** Suno runs long: a song planned at about 2:45 came back at 4:23, with a long piano intro and a 31 s instrumental tail. When a take is much longer than planned, tell the user its length and ask whether that's OK before anyone re-rolls. Long instrumentals become their own sections, and each one needs a real visual idea in the direction. Length also sets the render time (see "Renders and machine load").

Take the audio in either form:

- **A local path:** copy it to `public/audio/track.wav` (or `track.mp3` for an MP3).
- **A Cadence file number:** call `get_file` with the number, then `curl -fsS -o public/audio/track.<ext> "<downloadUrl>"`. The URL works once and expires in 15 minutes.

Keep exactly one of `track.wav` and `track.mp3`. Confirm it with `ffprobe` (duration, sample rate) and tell the user the length.

## 6. Pipeline

```sh
pnpm analyze        # beats, downbeats, onsets, band energy → src/data/audio-analysis.json
pnpm setup:align    # once; models land in .cache/models
pnpm align          # reads creative/lyrics.screen.txt (+ lyrics.suno.txt), writes lyrics.json and sections.json
pnpm check          # the data parses and the timing resolves
```

Review the output, not the code:

- Every lyric line was found, in order. If Suno skipped, repeated, or changed a line, edit `lyrics.screen.txt` to match what was sung and re-run `pnpm align`. Check `creative/alignment/verification.json` `possibleUnlistedLyrics` for sung lines that aren't in the text, and listen before trusting them. Tell the user if the meaning changed.
- Sections tile the song, and instrumental stretches (Suno adds them) are their own sections.
- Downbeats sit on the sung stresses. If "the 1" slips, add anchors to `src/data/timing-overrides.json` and re-run.

If the track ever changes, re-run `pnpm analyze` and then `pnpm align`: every render refuses stale timing. `music-video:video-pipeline` has the details and failure modes, including blocked model hosts.

## 7. ★ Creative direction: video-director

```
Project: <abs path>. Load music-video:scene-authoring and music-video:video-pipeline.
Read brief.json, research.md, lyrics.md, src/brand.json, src/data/*.json.
The user's visual style, verbatim: "<brief.visualStyle>". Reference: <brief.reference,
and the files under creative/reference/ if any>. Logo use: <brief.logoUse>.
Past directions to avoid repeating: <vault entries tagged music-video-direction, or the
user's answer>. Hard rules: <brief.hardRules>. Write ONLY creative/direction.md
(its named reference, its one unifying system, and two contrasting alternates in one
line each), creative/beatmap.md (start from pnpm beatmap), and creative/style-guide.md
if there is a reference video. No scene code yet.
```

Before dispatching, look up past directions: with Cadence connected, `list_knowledge` with `tag: "music-video-direction"`; otherwise ask the user which past videos and looks to avoid. Show the user the direction's summary and ask: approve, pick an alternate, run a concept round, or redirect with notes.

## 7b. ★ Concept round: video-director

Stills and a written direction can't show motion, and a single look rejected after a full render costs hours. Offer a concept round between direction approval and the full build, or in place of the single direction when the user wants options.

Each concept is an alternate scene registry the page loads instead of `src/scenes/index.js` (its `scenes=` query; `--scenes=<module>` on every capturing script), so the concepts never touch the main scenes.

```
Project: <abs path>. Concept round. Load music-video:scene-authoring and
music-video:video-pipeline. The user's words: "<verbatim>".
Pitch three really different unifying systems in creative/concepts.md, each varying
across the same moments while staying one piece, with a recommendation.
Build each as its own scene registry, src/concepts/<slug>.js, with its scene modules in
src/concepts/<slug>/; leave src/scenes/ alone. For each concept, one at a time:
- a sheet of the SAME ~10 key lyric moments, at their real song frames:
  pnpm still --scenes=src/concepts/<slug>.js --frame=<n>, tiled into out/concepts/<slug>-sheet.png
- a 10 to 14 s motion test of the pre-chorus into chorus 1, iterated with pnpm draft and
  delivered at 1080p: pnpm render --scenes=src/concepts/<slug>.js --frames=<a>-<b>
  --scale=1 --out out/concepts/<slug>-motion.mp4
Never run two renders at once. Report the sheet and clip paths.
```

Read each sheet so it shows inline, give the clip paths, and ask: pick one, combine (name what to take from each), or redirect. After the pick, the director promotes the chosen concept into `src/scenes/` and extends it to the whole song; phase 8 runs on it as the normal build.

When the user dislikes one element (a mascot, a graphic, a transition), don't re-render the video to try again. Have the director pitch 2 or 3 treatments of just that element as an in-context options sheet with short clips, and re-render once the user picks.

## 8. Build, critique loop, and render

Phase 8 is a loop: the director builds and drafts, a separate critic judges, the director fixes, and only an accepted draft becomes the master. There's no round cap. Each round costs about 3 to 4 minutes of judging, about 5 minutes of draft for a 4:23 song, the held-text checks, and the director's fixes. The user can still call it at any round.

### Build and the first draft: video-director

```
Project: <abs path>. Direction approved: creative/direction.md and creative/beatmap.md
[or concept <slug>, to promote into src/scenes/] [plus the user's notes, verbatim].
Load music-video:scene-authoring and music-video:video-pipeline. Build every scene in one
pass: lyrics only through ctx.lyric with a designed exit on every line, world transitions
only through ctx.transition, hard cuts only where the beat map puts them, motion blur
windows only on the slam moves. Register every key, delete placeholder.js, set
DEFAULT_SCENE to null, and pnpm check after each scene. Look at stills of the beat map's
moments before any video. Then run draft round 1, one render at a time:
pnpm draft --out out/draft-r1.mp4; pnpm critique --in out/draft-r1.mp4 --tag r1 (extra
strips under --tag r1-extra); pnpm pops --in out/draft-r1.mp4 --cuts=auto --fail
(output to out/critique/r1.pops.txt); pnpm still-test (output to
out/critique/r1.still-test.txt); pnpm render --textonly --scale=1, then
pnpm jitter --all-lines (output to out/critique/r1.jitter.txt). still, draft, render and
still-test launch Chromium and need dangerouslyDisableSandbox: true.
Stop and report the round; don't master-render.
```

### Each round

1. **The director reports round `n`:** the draft path, the critique sheet paths, and the pops, still-test and jitter results. Check the files exist and that all three passed; send it back if not.
2. **Spawn the critic** (`music-video:video-critic`):

   ```
   Project: <abs path>. Round <n>. Judge out/draft-r<n>.mp4 from its critique files:
   out/critique/r<n>/ (overview_*, phone_*, strip_*) [and out/critique/r<n>-extra/],
   out/critique/r<n>.pops.txt, out/critique/r<n>.still-test.txt,
   out/critique/r<n>.jitter.txt, and the draft's manifest out/draft-r<n>.manifest.json.
   Previous round's sheets: out/critique/r<n-1>/ [none on round 1]. Also read
   creative/brief.json (hardRules, logoUse, genre, tone, visualStyle),
   src/data/lyrics.json, creative/beatmap.md, creative/direction.md, and the earlier
   reports creative/critique/r1.md to r<n-1>.md. The director says it changed (claims to
   check, not facts): <the director's change list>. Return your fixed report.
   ```

3. **Save the report** verbatim to `creative/critique/r<n>.md`, so the next round's critic can mark earlier items fixed or not.
4. **Log the version.** Add a row to `creative/critique/versions.md`: round, draft path, the nine scores, the verdict, the side-by-side call against the previous round, and whether this draft replaced the previous one or its regressed sections were put back. A new draft replaces the previous one only when the critic judges it better.
5. **Give the user the scores** after every round: the nine scores in a table next to the previous round's, the three worst problems in a line each, and the verdict. Don't wait for an answer unless they want to weigh in; carry on.
6. **REJECT:** resume the director with the report verbatim. It snapshots `src/scenes/`, fixes the 3 worst problems plus every item scored 7 or lower, leaves sections scored 9 or higher alone (the regression guard), and runs round `n + 1`. If the critic judged this draft worse than the previous one side by side, the director first puts back the sections it named as regressed.
7. **ACCEPT** (every score 8 or more and no hard-rule violation): go to the master render.

### Master render: video-director

```
Project: <abs path>. The critic accepted draft r<n>. Master-render it: pnpm render in the
background (4K, about 1.13 s per frame at pool 2; nothing else heavy while it runs),
then pnpm preview and pnpm contact-sheet. Report the output paths.
```

Tell the user the expected time before it starts: about 2.5 hours for a 4:23 song at pool 2, more with heavy scenes or blur windows. Read the contact sheet image yourself once: a blank, washed-out, or empty-captioned cell goes back to the director with its timestamp. Otherwise deliver.

## Renders and machine load

`src/pipeline.json` holds the settings every render shares: `render` (scale 2, so a 3840x2160 master from the 1920x1080 page; CRF 17; PNG captures; `pool` 2; 20 s chunks) and `draft` (scale 0.5, 960x540, JPEG captures, CRF 23). Measured at pool 2 with the template's placeholder scene; real scenes are slower, and every frame inside a blur window costs one capture per sample:

| Render | Speed | A 4:23 song (7880 frames) |
|---|---|---|
| Draft (`pnpm draft`) | about 0.07 s per frame per worker | about 5 minutes (278 s measured) |
| 1080p (`pnpm render --scale=1`, the text-only QA render) | about 0.37 s per frame per worker | roughly half an hour or more |
| 4K master (`pnpm render`) | about 1.13 s per frame of wall time | about 2.5 hours, about 3 GB |

- **The pool cap.** A render runs at most `pool` chunk workers at once, each a headless Chromium plus an x264 encoder. The default is 2: a shell-job pool once launched 24 4K chunks at once and rebooted the machine. To change it for one run, pass `--pool=<n>` to `pnpm render` or `pnpm draft`; to change it for the project, set `render.pool` in `src/pipeline.json` (drafts use the same value). Above 2 prints a warning; raise it only when the user asks and knows the machine, and lower it to 1 when they need the machine to stay usable during a long render.
- **One heavy render at a time, machine-wide.** Don't overlap renders, drafts, `still-test`, alignment or other heavy ffmpeg work, across agents and projects too. Run anything longer than a few minutes in the background.
- **Disk.** While a render runs, its temp folder holds the chunks, the joined video and the muxed file at once: budget about three times the master's size on the `out/` drive, plus the old master if there is one.

## Feedback rounds

- **Relay the user's words verbatim** to the director, in quotes, alongside your summary. A paraphrase loses what they disliked.
- **Stop a rejected render.** When the user rejects something in a render that's still running, stop that render before it finishes (Ctrl-C or SIGTERM cleans up its temp folder and workers); don't spend hours finishing a look that's already out.
- **Re-measure, don't eyeball.** Ask for numbers: `pnpm still-test` and `pnpm jitter` on the held lyrics the user flagged, `pnpm pops` plus the critique strips for anything between shots, and A/V sync by cross-correlating the audio of any MP4 that `pnpm render` or `pnpm draft` didn't make against `public/audio/track.*` (the lag should be under one frame). "It looks fine now" isn't a fix.
- **Feedback goes through a critique round.** The director's fix comes back as a new draft round, and the critic judges it as usual, with any new rule the user stated added to `hardRules` first. Master-render again only after an ACCEPT.

## Deliverables

Send the user:

- **The MP4**: its absolute path, `out/<outputName>.mp4` (3840x2160, H.264, BT.709, AAC from the untouched track).
- **The preview**: `out/<outputName>-preview.mp4`, 720p and under 30 MB, sized for chat upload. Give its path.
- **The contact sheet**: `out/contact-sheet.png`. Read it so it shows inline, and give its path.

When Cadence is connected you can also store the contact sheet with `prepare_file_upload` and give its file number. That path caps files at 4 MB, so the preview usually doesn't fit; leave it as a path.

Then save the direction to the log: with Cadence connected, `create_knowledge` with tag `music-video-direction`, the company in the title, and the direction's summary (reference, typography, motion, colour, texture, transitions). Search first and skip it if the entry exists.

## Cleanup

List these with their sizes (`du -sh`) and ask with a multi-select `AskUserQuestion` which to delete. Never delete anything while a render is running.

| Path | Size seen | Safe because |
|---|---|---|
| `out/draft*.mp4` and their `.manifest.json` | not measured yet; check with `du -sh` | half-res drafts; the critic reports stay in `creative/critique/` |
| `out/critique/` | check with `du -sh` | QA sheets for each round |
| `out/<outputName>-textonly*.mp4` | check | the 1080p text-only QA renders |
| `out/*-frames-*.mp4` and their manifests | check | partial test renders |
| `out/wip-*`, `out/snapshots/`, `out/reference/` | check | working stills, round snapshots, reference sheets |
| `out/concepts/` and a cancelled concept's `out/<slug>.mp4` | check | concept stills, sheets and motion tests; the concepts' source stays in `src/concepts/` |
| `out/.render-*`, `out/.draft-*` | check | temp folders of a killed render; the next render sweeps them anyway |
| `.venv-align` | about 500 MB | `pnpm setup:align` recreates it; delete once the lyrics are final |
| `.cache/models` | about 1.4 GB | alignment models; re-aligning without them downloads about 650 MB again |
| `.cache/ms-playwright` | about 195 MB | headless Chromium; `pnpm setup:env` downloads it again |
| `.venv` | check | `pnpm setup:env` recreates it; every capture, critique and analysis needs it |

Never delete `public/audio/`, `public/brand/`, `public/fonts/`, `creative/`, `src/`, the master, the preview, or the contact sheet. Keep the alignment models unless the user says alignment is done for good, and keep `.venv` and `.cache/ms-playwright` while any render or fix is still likely. Delete only what the user ticked, and report what was deleted with its size.
