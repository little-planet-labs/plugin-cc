---
name: music-video
description: The playbook for making a beat-synced kinetic-typography music video about any company, satire and parody included, with a song generated in Suno and a 4K video drawn as a time-seeked HTML page, captured with Playwright and encoded with ffmpeg. Runs eight phases with user checkpoints (brief interview, company research, topic menu, lyrics and Suno pack, the user's song, the audio pipeline, creative direction with a per-line beat map, and the scene build) plus an optional concept round, then a critique loop in which a separate read-only critic scores each half-res draft on a fixed rubric until every score reaches 8, before the master render. Then, as the interview asked, a full-length vertical 9:16 version for Instagram Reels and TikTok (an approved adaptation addendum, its own scene registry, an early look, critic rounds and a 1080x1920 master), cut shorts (segments of the song cut frame-exactly from it, picked by the user, each clip's first and last frame checked), and cover posters. Also stand-alone Shorts, new 15 to 35 s mini-songs for the Shorts feed in the voice of a finished video, each with a pitch menu, its own project copied from the parent, a direction where frame 0 is the hook and the last frame loops into it, critic rounds, a 1080x1920 master, three vertical covers and post copy. Names the agent and hand-off for each, and covers instantiating the project, logo use, monetization and hard rules, audio intake, feedback rounds, the quality level, render times and machine load, the deliverables, captions for the shorts on request, and cleanup. Use when the user wants a music video, song, or lyric video about a company or product, or a Short or mini-song made from one of those videos ("make a Short from the Jira video").
user-invocable: true
---

# Music video

You are the lead. Run the phases in order (or, for a short from a finished video, start as "Starting from a finished video" says), stop at every ★ for the user, and dispatch the plugin's four agents for the phases they own: `music-video:company-researcher`, `music-video:lyricist`, `music-video:video-director`, and `music-video:video-critic`. Everything without an agent is yours. Don't skip ahead: no lyrics before the topics are approved, no full build before the direction or a concept is approved, no vertical scenes before `creative/direction-vertical.md` is approved, and no Short's scenes before its `creative/direction-short.md` is approved.

## Ground rules

- **Questions go through `AskUserQuestion`**, never buried in prose. Load `little-planet-factory:asking-questions` if it's installed. Batch up to four related questions per call, recommended option first.
- **On-screen copy is lyrics, exact feature names, and the logo** (only as `brief.logoUse` allows). No invented taglines, labels, or captions that aren't sung. On a stand-alone Short, `brief.docQuotes` says exactly which names may appear. Post captions are a different thing: copy the user asked for, written for the post and never put on screen (see "Captions for the shorts" and S6).
- **The audio is read-only.** Nothing writes to `public/audio/track.*` after intake, and every render muxes it untouched: no resampling, no loudness normalisation.
- **No git writes** unless the user asks. Follow `little-planet-factory:version-control` if it's installed; the default is to leave everything uncommitted.
- **Sandbox.** Headless Chromium can't launch inside the Claude Code Bash sandbox. Run `pnpm still`, `draft`, `render`, `still-test`, `jitter --all-lines`, `posters` and `test:render` normally. Only if the Bash sandbox is on and a command fails with a mach-port error, re-run that one command with `dangerouslyDisableSandbox: true` (or ask the user to turn the sandbox off with `/sandbox`). Never pass it pre-emptively. Inside the sandbox, or behind a TLS-intercepting proxy, the setup commands need `PIP_USE_DEPRECATED=legacy-certs` in front.
- **Machine load.** One heavy render on the machine at a time: a master (landscape or vertical), a draft, a text-only render, a concept clip, an early look, `still-test`, `pnpm clips`, `pnpm posters` or an alignment run, never two at once, across agents and across sibling Short projects too. Never dispatch two directors that render at the same time. On a stand-alone Short, the director always asks you for a go before a heavy command (S4). The render pool's cap is `render.pool` in `src/pipeline.json` (see "Renders and machine load").
- **Quality level.** Pipeline code gets an inspector: if anyone changes the template's engine or scripts (`index.html`, `src/engine/`, `src/lib/`, `scripts/`, `tests/`, `package.json`), that diff goes to an inspector (`little-planet-factory:quality-bar`, foundational tier), and `pnpm test` and `pnpm test:render` must pass in the project. The video gets a judge: the builder can't review its own work, so every draft goes to `music-video:video-critic`, a separate read-only agent that scores it on a fixed rubric with a default stance of reject, and the build loops until it accepts (phase 8, and phase 10 for the vertical). In a howseen-ai/claude-motion-design run, the critic's first round caught text collisions, a dead 14 s intro and 30 s outro, lyrics cropped by the top edge, a strobe, and a hard-edged card, all missed by the builder's own still checks. Lyrics and direction are still the user's to approve at their checkpoints.
- **General rules and per-video style.** These hold for every video:
  - **One unifying visual system**, varied inside it. The direction defines one world, material, type system, palette logic and motion language that hold the whole video together; variety comes from staging and transformations inside it, as much and as often (per line or per section) as the direction sets, never from a new unrelated world per line. No rule says each scene must look different from the others.
  - **The concept round** is offered (phase 7b).
  - **No beat-locked rhythmic pulsing** by default on a slow song without heavy beats, unless the brief asks for it.
  - **The universal defect checks** the critic runs: shimmering held text, clipped descenders, collisions and crops, hard-edged seams, pops and flashes, phone readability, lyric accuracy, and sync.
  - **The pacing rules:** motion by 0.5 s, and a visible change at least every 4 s.
  - **Shorts defaults.** On a stand-alone Short, frame 0 is the hook, the last frame loops into it, and film grain is 0 by default: grain turns to mush in Shorts compression, and it changes every frame, so the last frame can't match frame 0. Record it in the Short's `hardRules` as "No film grain on Shorts: grain 0 everywhere (Shorts default)". In the Jira run the user asked for it ("Yeah keep it off"); when the user states their own rule, record it verbatim as usual.

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
| 7c | Shorts proposal (when `social.shorts`) | you | `social.clips` in brief.json | ★ |
| 8 | Scene build and draft rounds | `music-video:video-director` | `src/scenes/**`, `out/draft-r<n>.mp4`, `out/critique/r<n>/` | |
| 8 | Critique, each round | `music-video:video-critic` (read-only) | nothing; you save its report to `creative/critique/r<n>.md`, log the round, and show the user the scores | |
| 8 | Master render, after ACCEPT | `music-video:video-director` | the MP4, preview, contact sheet | |
| 9 | Vertical direction (when `social.vertical` or `social.shorts`) | `music-video:video-director` | `creative/direction-vertical.md`, a first `src/clips.vertical.json`; you set `tailSeconds` in `src/pipeline.vertical.json` | ★ |
| 10 | Vertical build, early look and draft rounds | `music-video:video-director` | `src/scenes-vertical/**`, the early look `out/<vertical outputName>-frames-<a>-<b>.mp4` and its preview, `out/vertical-draft-v<n>.mp4`, `out/critique/v<n>/` | |
| 10 | Vertical critique, each round | `music-video:video-critic` (read-only) | nothing; you save `creative/critique/v<n>.md` and log the round | |
| 10 | Vertical master, after ACCEPT | `music-video:video-director` | `out/<vertical outputName>.mp4`, its preview and contact sheet | |
| 11 | Cut shorts: cut and check (when `social.shorts`) | `music-video:video-director`, then you | `out/clips/`; you check every clip's edges and lengths | |
| 12 | Cover posters (when `posters`) | `music-video:video-director` | `src/posters.js`, `src/posters/`, `posters/` | ★ |

Phases 7c and 9 to 12 run only for the versions the user asked for in the interview. Phase 12 doesn't depend on 7c or 9 to 11: run it at any point after the landscape master when no render is running.

Two kinds of short, named apart everywhere: **cut shorts** are segments of the song cut from the vertical master (phases 7c and 11), and **stand-alone Shorts** are new mini-songs, each with its own project, made after the video is finished (steps S1 to S7 in "Stand-alone Shorts", after phase 12).

**Starting from a finished video.** When the user asks for a Short or mini-song from a video that's already made ("make a Short from the Jira video"), don't restart at phase 1: the interview and the landscape build are done. Find the finished parent project; if its path isn't obvious, ask for it with `AskUserQuestion`. Check the prerequisites at the top of "Stand-alone Shorts". Then ask one `AskUserQuestion`: a **cut short** (a segment of the song itself: set `social.shorts` in the parent's brief and run 7c, so the picks go into `social.clips`. If the parent has no vertical master, run phases 9 and 10, where phase 9 writes the first `src/clips.vertical.json` from `social.clips`; if its vertical scenes exist, re-render the vertical master. Then phase 11) or a **stand-alone Short** (a new 15 to 35 s mini-song in the video's voice, with its own project, starting at S1).

Every agent brief gives the absolute project path and the files the agent may write. Agents write only their own files.

## 1. ★ Brief interview

Settle what the request doesn't already say. Four `AskUserQuestion` rounds usually cover it:

- **Round 1:** sources (website only, website plus a local repo path, or the community sources the user names), audience, tone (funny, serious, a mix, or satire), **genre** (it shapes the meter, the hook, and the jokes, so ask before any lyrics), and target length (about 60 s, 90 s, or 2 min; say that Suno songs usually come back longer).
- **Round 2:** how the company name is **pronounced** (offer two or three phonetic spellings plus "as written"; this sets `pronunciation.sung`), vocals (sung only, recommended, or spoken parts allowed), vocal style (male, female, duet, no preference), and topics to keep out (multi-select: named customers, pricing, competitors, unreleased features; for a satire, offer named people and specific dated incidents instead of pricing and unreleased features).
- **Round 3:** whether the video will be **monetized**, how the **logo** may be used (below), and whether they have a **reference** for the look: a video or frames they like, a named style, or none.
- **Round 4, the other versions.** The landscape 16:9 video is always made. Ask about the rest as separate questions, one decision each:
  - **Vertical:** do they want a **full-length vertical 9:16 version** for Instagram Reels and TikTok? Say it's a native re-layout for a phone held upright, not a crop, with its own approval step, and that a full-length Reel must stay under 3:00 (song plus tail; see phase 9).
  - **Shorts:** do they want **cut shorts**, clips of 15 to 60 s cut from the song for Reels and TikTok? Say they're cut from a vertical master, so asking for shorts means the vertical scenes get built and rendered even if they don't want the full-length vertical delivered, and that they'll pick the segments after the direction.
  - **Posters:** do they want **cover posters**: YouTube thumbnails as new compositions in the video's style, about six to choose from?

  Never fold the vertical and shorts questions into one ("vertical and shorts?"): a user can want either without the other.

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
  "approvedTopics": [],
  "social": {"vertical": false, "shorts": false, "clips": []},
  "posters": false
}
```

`social.vertical` and `social.shorts` are the two Round 4 answers, recorded separately. `social.clips` stays `[]` until the user picks segments in phase 7c. `posters` is the third Round 4 answer. If the user changes their mind later, update the field and run the phase.

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

**Length.** Suno runs long: a song planned at about 2:45 came back at 4:23, with a long piano intro and a 31 s instrumental tail. When a take is much longer than planned, tell the user its length and ask whether that's OK before anyone re-rolls. Long instrumentals become their own sections, and each one needs a real visual idea in the direction. Length also sets the render time (see "Renders and machine load"). When `social.vertical` is true, also say whether the take fits a full-length Reel: the song plus the vertical tail must stay under 180 s (phase 9). A take of 180 s or more can't be one Reel; ask whether to re-roll shorter, deliver the vertical anyway for platforms that take longer videos (tell them to check the platform's current limit), or rely on shorts.

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

**The tail.** When the direction's closing move needs to run past the song (a curtain that finishes closing, a last hold), the director asks for a `tailSeconds` (0 to 30). Set it in `src/pipeline.json` before the build; the video then runs that long over silence after the track. In the Jira run, the landscape cut took a 2 s tail for its closing curtain.

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

## 7c. ★ Shorts proposal

Only when `social.shorts` is true. Do it once the direction (or the concept pick) is approved, so the segments follow the sections the direction plans. It's your work, not a render, so it can run while the director builds phase 8.

Read `src/data/sections.json`, `src/data/lyrics.json` and the direction's section plan, and propose 3 to 5 segments that each stand alone. Each one:

- starts and ends on section boundaries: one section, or two that belong together, such as a verse and the chorus it leads into
- opens clean, so someone who scrolls onto it sees a deliberate first frame, not the end of the previous line
- lands on a strong last line: a punchline, the hook, or a line that resolves
- runs 15 to 60 s
- has a working title, the short's own name, which becomes its slug and later its caption title

Give each with its sections, its seconds and length, its first and last sung lines, and why it stands alone. Ask one multi-select `AskUserQuestion` for which to make, with your recommendations first. Record the picks in `social.clips` as `{"slug", "title", "sections", "start", "end"}`, using the section-boundary seconds; the director sets the exact edges in phase 9.

**Words on a boundary.** For each edge, check the last sung word's start and end and the next line's first word in `lyrics.json`. A word aligned a few frames before a section starts is sung in the earlier section, and a clip that starts on that boundary opens on it. In the Jira run, the last word of chorus 1 ("before!") was aligned 2 frames before verse 2 started, so clip 1's end and clip 2's start both moved to 50.6 s. Flag every such edge to the director.

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
pnpm jitter --all-lines (output to out/critique/r1.jitter.txt). Stop and report the round; don't master-render.
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

Tell the user the expected time before it starts: about 2.5 hours for a 4:23 song at pool 2, more with heavy scenes or blur windows. Read the contact sheet image yourself once: a blank, washed-out, or empty-captioned cell goes back to the director with its timestamp. Otherwise go on to the phases the brief asks for (9 to 12), or deliver.

## 9. ★ Vertical direction: video-director

Runs when `social.vertical` or `social.shorts` is true. Shorts are cut from the vertical master, so shorts alone still need phases 9 and 10. It comes after the landscape build, because the vertical registry may import the landscape's pure helpers. The director can write the addendum while the landscape master renders, since writing isn't a render; no vertical stills or renders until the master has finished.

The vertical is a native re-layout for a phone held upright, never a crop or a letterbox of the landscape video. It has its own pipeline config, `src/pipeline.vertical.json` (in the template: a 1080x1920 page at the main config's fps, render scale 1 so the master is 1080x1920, its own `outputName`, and `"scenes": "src/scenes-vertical/index.js"`), and its own scene registry. Every script takes `--pipeline=src/pipeline.vertical.json`. The landscape scenes in `src/scenes/**` are never edited for the vertical, so the landscape video stays byte-identical.

**Set the tail first.** `tailSeconds` in `src/pipeline.vertical.json` runs the video past the song so a closing move can finish. The template's 0.3 is only an example: set it for this song. When the user wants a full-length vertical, the song plus the tail must stay under 180 s, the Reels cap: at 30 fps, `ceil((song + tail) × 30)` under 5400 frames. A short tail is enough for a close that lands on the audio end and holds a few frames. In the Jira run, a 179.6 s song took a 0.3 s tail: 5397 frames, 179.9 s, against 181.6 s for the landscape cut with its 2 s tail. If the song alone is 179.7 s or more, set the tail to 0. For shorts alone the cap doesn't apply, but keep the tail short. Pipeline configs are yours to edit; the director asks you for a different tail.

```
Project: <abs path>. Vertical version. Load music-video:scene-authoring and
music-video:video-pipeline. Read creative/direction.md and creative/beatmap.md (approved,
still in force), creative/brief.json (hardRules, logoUse, social, and social.clips: the
shorts the user picked) [the edges I flagged: <list>], src/pipeline.vertical.json
(tailSeconds <n>), src/data/*.json, and the landscape scenes in src/scenes/ (read-only).
Write ONLY creative/direction-vertical.md, the adaptation addendum the scene-authoring
skill's section 6, "The vertical version", describes: the frame and its text box inside
theme.safe.title and theme.safe.social, the vertical grid and the camera per section,
restaged set pieces, explicit row breaks for every line measured with the brand font at
1080 wide, a deliberate opening at every clip edge [and the transitions that change for
it], the clip edges table, the outro inside the tail, the code plan, and the decisions
for the user. [Also write src/clips.vertical.json with a first edge per picked short.]
No scene code yet. Never edit src/scenes/**.
```

Show the user the addendum's summary, the restaged set pieces, the transitions it changes so the clips open and end cleanly, the clip edges with what each clip's first and last frame shows, and its decisions list. Ask: approve, or redirect with notes. The clip-friendly transitions and any restaging are the user's decisions: when the addendum offers options (act curtains or hard cuts at the clip edges, a set piece restaged one way or another), ask each as its own question. Relay the answers verbatim; the director revises and stops again.

## 10. Vertical build, early look, critique, and master: video-director

### Build and the early look

```
Project: <abs path>. Vertical direction approved: creative/direction-vertical.md [plus
the user's notes, verbatim]. Load music-video:scene-authoring and music-video:video-pipeline.
Build src/scenes-vertical/ as scene-authoring's "The parallel registry" describes: its own index, frame
(text box and the setup-time guard), type (row breaks per line), openers, ends and scene
modules. Never edit src/scenes/**. Every command takes --pipeline=src/pipeline.vertical.json.
Build the sections of <the first picked short, slug, start-end s | the first hook,
about 15 to 30 s> first, check stills at its edges, then render that range for an early
look: pnpm render --pipeline=src/pipeline.vertical.json --frames=<a>-<b>, then
pnpm preview --pipeline=src/pipeline.vertical.json --in <that file>. Until every vertical
scene exists, keep a plain stand-in DEFAULT_SCENE in src/scenes-vertical/index.js that
registers the lines of the sections not built yet, and set it back to null before the
full draft (or build the whole registry first). Stop and report it.
```

Give the user the early look's preview path (720x1280, under 30 MB) and say what it is: one segment, ahead of the rest. Carry on unless they have notes; relay any verbatim. Then resume the director:

```
Finish src/scenes-vertical/ for the whole song, pnpm check --pipeline=src/pipeline.vertical.json
after each scene, and plain pnpm check to confirm the landscape registry still loads. Stills
at every section start and start + 8, every clip edge frame (the first and last frame of
each clip, and the frames either side), and the big hits. Then run vertical draft round 1,
one render at a time, every command with --pipeline=src/pipeline.vertical.json:
pnpm draft --out out/vertical-draft-v1.mp4; pnpm critique --in out/vertical-draft-v1.mp4
--tag v1 (extra strips under --tag v1-extra, including every clip edge); pnpm pops --in
out/vertical-draft-v1.mp4 --cuts=auto --fail (to out/critique/v1.pops.txt); pnpm
still-test (to out/critique/v1.still-test.txt); pnpm render --textonly --scale=1, then
pnpm jitter --all-lines (to out/critique/v1.jitter.txt). Stop and report the round.
```

### Vertical rounds

The loop is phase 8's "Each round", with the vertical's names: round `v<n>`, draft `out/vertical-draft-v<n>.mp4`, sheets in `out/critique/v<n>/`, reports saved to `creative/critique/v<n>.md`, and a `v<n>` row in `creative/critique/versions.md`. The landscape rounds and reports stay as they are. The critic brief:

```
Project: <abs path>. Vertical round v<n> (1080x1920, for Reels and TikTok). Judge
out/vertical-draft-v<n>.mp4 from out/critique/v<n>/ [and out/critique/v<n>-extra/],
out/critique/v<n>.pops.txt, out/critique/v<n>.still-test.txt,
out/critique/v<n>.jitter.txt, and out/vertical-draft-v<n>.manifest.json. Previous
round's sheets: out/critique/v<n-1>/ [none on v1]. Also read creative/brief.json,
src/data/lyrics.json, creative/beatmap.md, creative/direction.md,
creative/direction-vertical.md, src/clips.vertical.json, and the earlier vertical reports
creative/critique/v1.md to v<n-1>.md. Judge it as a vertical round (your "Vertical
rounds" section). The director says it changed (claims to check, not facts): <list>.
```

### Vertical master

```
Project: <abs path>. The critic accepted vertical draft v<n>. Master-render it:
pnpm render --pipeline=src/pipeline.vertical.json in the background (1080x1920; nothing
else heavy while it runs), then pnpm preview --pipeline=src/pipeline.vertical.json and
pnpm contact-sheet --pipeline=src/pipeline.vertical.json. Report the output paths.
```

The vertical master is `out/<vertical outputName>.mp4` (`out/music-video-vertical.mp4` in the template's config); the two configs' masters can't overwrite each other. In the Jira run, a 3-minute vertical master at scale 1 took about 22 minutes at pool 2. Read its contact sheet as for the landscape master. When the user wanted shorts but not the full-length vertical, the master is still rendered, since the clips are cut from it, but it isn't a deliverable.

## 11. Cut shorts: cut and check

Only when `social.shorts` is true, after the vertical master. A cut short can also get vertical covers, the same way as a stand-alone Short (S5), with the `src/posters-shorts.js` registry in this project.

```
Project: <abs path>. Cut the shorts. [No clip list covers these picks yet (phase 9 didn't run
for them): first create or extend src/clips.vertical.json from brief.json's social.clips, with edges set by
phase 9's rules and the boundary words I flag from 7c.] Check src/clips.vertical.json's edges against
stills of the master's edge frames and tune them to your staging, then
pnpm clips --pipeline=src/pipeline.vertical.json, then for each clip
pnpm preview --pipeline=src/pipeline.vertical.json --in out/clips/<file>.mp4.
Report every clip's path, frame range, length, and the preview paths and sizes.
```

`pnpm clips` writes `out/clips/<vertical outputName>-<slug>.mp4` for each clip, frame-exact with short audio fades, plus `out/clips/<vertical outputName>-clips.manifest.json` with every clip's frame range and duration.

**Check every clip yourself** before it goes to the user. For each one, with `<frames>` from the manifest:

```sh
mkdir -p out/wip-clips
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames,r_frame_rate,width,height -of default=nw=1 out/clips/<file>.mp4
ffprobe -v error -show_entries stream=codec_type,duration -of default=nw=1 out/clips/<file>.mp4
ffmpeg -v error -y -i out/clips/<file>.mp4 -vf "select=eq(n\,0)" -frames:v 1 out/wip-clips/<slug>-first.png
ffmpeg -v error -y -i out/clips/<file>.mp4 -vf "select=eq(n\,<frames - 1>)" -frames:v 1 out/wip-clips/<slug>-last.png
```

- `nb_read_frames` equals the manifest's frame count, and the audio stream's duration equals the video's.
- Open both frames with the Read tool. The first frame is a deliberate opening: no transition in progress, no line or word left over from the previous section. The last frame holds the segment's last sung line whole, before the next section's incoming transition starts.

A clip that fails goes back to the director with the frame and what's wrong; it moves the edge in `src/clips.vertical.json` and cuts again.

## 12. ★ Cover posters: video-director

Only when `posters` is true. Any time after the landscape master, when no render is running.

```
Project: <abs path>. Cover posters. Load music-video:scene-authoring and
music-video:video-pipeline. Read creative/direction.md, brief.json (logoUse, hardRules)
and src/data/lyrics.json. Write src/posters.js, an alternate scene registry that exports
POSTERS = [{n, slug, frame}], SCENES = {} and your poster scene as DEFAULT_SCENE, with its
modules in src/posters/; replace the template's placeholder entry and scene:
about six new compositions in the video's style, made as thumbnails (not frames from the
video), poster k drawn at frame <fps × k>. On-screen text only the song title, sung
lyrics and exact feature names; the logo only as logoUse allows. Register every lyric
line invisibly. You may import src/scenes/ helpers read-only. Then pnpm posters.
Report the poster paths and both review sheets.
```

`pnpm posters` captures each poster at 1920x1080, downscales it to 1280x720 into `posters/`, and builds `posters/posters-sheet.png` (all of them) and `posters/posters-small.png` (each at 360 and 168 px, YouTube's phone and sidebar sizes). Read both sheets so they show inline, and ask: approve, revise (name the posters and what to change), or redo. At the small sizes the title must still read; send back any poster that doesn't.

## Stand-alone Shorts

A stand-alone Short is a new mini-song of 15 to 35 s, written for the Shorts feed in the voice of a finished music video, the parent. Each gets its own project, direction, build, critic rounds, master, vertical covers and post copy. The parent must be finished first (research.md, brief.json, approved lyrics, the produced take, the direction, ideally its vertical version); the user can ask any time after that, in a later session. In the Jira run, "Five or eight" (28.4 s) and "Highest, Through and Through" (31.64 s) were made.

| # | Step | Who | Writes | Stop |
|---|---|---|---|---|
| S1 | Pitch menu | `music-video:lyricist`, in the parent | `creative/shorts-pitches.md` | ★ |
| S2 | Intake, one project per Short | you | the project, `creative/brief.json`, the lyrics, `src/data/*.json` | |
| S3 | Direction | `music-video:video-director` | `creative/direction-short.md` (and optionally `creative/beatmap-<outputName>.md`); you edit `src/pipeline.vertical.json` | ★ |
| S4 | Build, critic rounds, master | `music-video:video-director`, `music-video:video-critic` | `src/scenes-vertical/**`, drafts, `out/<outputName>.mp4`; you save `creative/critique/v<n>.md` | |
| S5 | Covers | `music-video:video-director` | `src/posters-shorts.js`, `src/posters-shorts/`, `posters-shorts/` | ★ |
| S6 | Post copy and delivery | you | `creative/social-captions.md` | |
| S7 | Cleanup | you | nothing | |

### S1. ★ Pitch menu: lyricist

```
Project: <parent abs path>. Stand-alone Shorts pitch menu. Load music-video:suno-songwriting.
Read creative/brief.json, research.md, lyrics.screen.txt, suno-prompt.md and
src/data/lyrics.json (seconds per sung line). Write ONLY creative/shorts-pitches.md: six to
eight pitches, each with a title phrased as the question viewers argue about, one joke
from research.md (Confirmed by / Inferring), the hook line, "about N s as written" (15 to
30 s), the loop, screen and Suno text, "Is it new?" against the parent song, and the rules
held. One shared Suno style line adapted from the parent's. End with the checks table and
your top 2.
```

Check the checks table against the file: a row per pitch, no avoid hits, every estimate inside 15 to 30 s, and a style line under about 200 characters. Send back a pitch that repeats the parent's lines. Show the menu and ask one multi-select `AskUserQuestion`: which go to Suno, the top 2 first. Tell the user exactly what to paste for each: the pitch's text block whole, plus the style line. In the Jira run, 30 s asks came back at 28 to 32 s.

### S2. Intake: one project per Short

Each take gets its own project at `<parent project's parent dir>/shorts/<company-slug>-<short-slug>/` (ours: `shorts/jira-five-or-eight`, `shorts/jira-highest`). Stop if the folder exists and isn't empty. Copy the parent (brand, fonts, logo, research and scene helpers come along) without `out/`, `.venv`, `.venv-align` or `.cache`, since virtualenvs hold absolute paths; `music-video:video-pipeline` has the details:

```sh
mkdir -p <parent dir>/shorts
rsync -a --exclude=/out/ --exclude=/.venv/ --exclude=/.venv-align/ --exclude=/.cache/ <parent>/ <parent dir>/shorts/<company-slug>-<short-slug>/
pnpm setup:env && pnpm setup:align   # in the new project; about 2 GB
```

Copy the parent's `creative/brief.json`, `lyrics.screen.txt` and `lyrics.suno.txt` into `creative/reference/parent/`, and move its `creative/beatmap.md` and `src/clips.vertical.json` there (a Short has no clip list, and its beat map is `creative/beatmap-<outputName>.md`). Clear the copied `creative/critique/` (the parent keeps its reports). Put the take at `public/audio/track.wav` (read-only from then on, the only `track.*`), replace `creative/lyrics.screen.txt` and `lyrics.suno.txt` with the pitch text, and update `creative/brief.json`, keeping the parent's other fields:

```json
{
  "concept": "Stand-alone Short: pitch 2, 'Why is every ticket Highest?', in the voice of the parent '<title>'.",
  "targetSeconds": 30,
  "social": {"vertical": true, "shorts": false, "clips": []},
  "posters": false,
  "parent": "/abs/path/to/the/parent",
  "targetNote": "The take is 31.64 s. Vertical only; the landscape registry still holds the parent's scenes and is unused.",
  "docQuotes": "the sung lyrics and the exact priority names Highest, High, Medium, Low, Lowest; nothing else",
  "hardRules": ["<the parent's rules>", "No film grain on Shorts: grain 0 everywhere (Shorts default)", "<any rules the user states, verbatim>"]
}
```

`docQuotes` is "none: sung lyrics only" when no product name may appear. Then run `pnpm analyze`, `pnpm align` and `pnpm check` (a data-only check at this point; once S3 edits the vertical config, every command takes `--pipeline=src/pipeline.vertical.json`), and review as in phase 6. Edit the lyrics to what was actually sung and re-align: in "Five or eight", "And" was sung "Then the architect". Pass each edit to the director, who records it under "Lyric edits from the alignment" in `direction-short.md`, and tell the user when one changes the words on screen. Tell the user the take's length; a stand-alone Short should land around 20 to 35 s.

### S3. ★ Direction: video-director

First edit `src/pipeline.vertical.json`: `outputName` `<company-slug>-<short-slug>-vertical`, `scenes` `src/scenes-vertical/index.js`, and `tailSeconds` 0 when the take ends on its own final chord or decay rather than cut mid-note (listen to the last second), so the loop has no silent frames. Both Jira Shorts used 0. The landscape registry is unused.

```
Project: <abs path>. Stand-alone Short, vertical only (1080x1920), in the voice of the parent
at <parent abs path> (read-only). Load music-video:scene-authoring and music-video:video-pipeline.
Read creative/brief.json (concept, docQuotes, hardRules, logoUse, targetNote), the pitch in
the parent's creative/shorts-pitches.md, creative/reference/parent/, creative/direction.md
and direction-vertical.md (the parent's look), src/pipeline.vertical.json (tailSeconds <n>)
and src/data/*.json. Lyric edits from the alignment: <list, with the user's answers>.
Write ONLY creative/direction-short.md (a per-line beat map may go inside it, or start
creative/beatmap-<outputName>.md with pnpm beatmap --pipeline=src/pipeline.vertical.json):
frame 0 a finished, readable hook with motion from frame 1 and a first event by about
0.4 s, the last frame matching frame 0, words only from the lyrics and docQuotes, grain 0.
No scene code yet.
```

Show the user the summary, frame 0 and how the loop closes, and ask: approve, run a concept round (as in 7b, with `--pipeline=src/pipeline.vertical.json`), or redirect. For "Highest", the round had three concepts in four registries (The Full House was built with two endings, crash and sell-out), and the user picked The Full House with the floor-collapse ending.

### S4. Build, critic rounds, and master

The loop is phase 10's, judged against `direction-short.md`: `out/vertical-draft-v<n>.mp4`, `out/critique/v<n>/`, `creative/critique/v<n>.md`, a row in `creative/critique/versions.md`, snapshots in `out/snapshots/v<n>/`. Brief the build and the critic as in phase 10, with `direction-short.md` in place of the addendum and no clip edges; tell the critic "Stand-alone Short: judge frame 0 as the hook and the loop seam, last frame into frame 0. Locked sections: <list>."

- **Locked sections.** The critic locks sections that score 9 or more. A later round that touches one must bring strips for every frame of it: the "Highest" v4 was rejected because the camera path changed inside the locked reset and f917 to f938 had no strips. In v5, strips at 30.60 and 31.00 (f915 to f938) settled it.
- **Polish rounds** after ACCEPT are the user's choice. Ask; don't start one yourself.
- **The render slot.** On a stand-alone Short, the director always stops and asks you for a go before a heavy command, whether or not another Short is in flight. Give the slot to one at a time across all projects. Heavy: `draft`, any render (text-only, partial, a motion test or concept clip, the master), `still-test`, `jitter --all-lines`, and a batch of stills. No go needed: a single still or two, `check`, `beatmap`, `critique`, `pops`, `preview`, `contact-sheet`, and single-window `jitter`.

After the master (`out/<outputName>.mp4`, its preview and contact sheet), check it yourself:

```sh
mkdir -p out/wip-loop
ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,r_frame_rate,nb_read_frames -of default=nw=1 out/<outputName>.mp4
ffprobe -v error -show_entries stream=codec_type,duration -of default=nw=1 out/<outputName>.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1 public/audio/track.wav
ffmpeg -v error -y -i out/<outputName>.mp4 -vf "select=eq(n\,0)" -frames:v 1 out/wip-loop/f0.png
ffmpeg -v error -y -i out/<outputName>.mp4 -vf "select=eq(n\,<frames - 1>)" -frames:v 1 out/wip-loop/last.png
ffmpeg -hide_banner -i out/wip-loop/f0.png -i out/wip-loop/last.png -lavfi psnr -f null - 2>&1 | grep Parsed_psnr
```

Expect 1080x1920, `30/1`, `nb_read_frames` equal to ceil(duration × 30), and an audio duration equal to the take's. Read both frames with the Read tool: they should match. The "Highest" master (950 frames) measured 45.8 dB.

### S5. ★ Covers: video-director

```
Project: <abs path>. Three 1080x1920 covers for the Short. Load music-video:scene-authoring
and music-video:video-pipeline. Read creative/direction-short.md, brief.json (docQuotes,
logoUse, hardRules) and src/data/lyrics.json. Write src/posters-shorts.js (SCENES = {},
DEFAULT_SCENE, COVERS = [{n, slug, frame}]) and src/posters-shorts/covers.js; leave the
video's scenes untouched. Render cover k with pnpm still --pipeline=src/pipeline.vertical.json
--scenes=src/posters-shorts.js --frame=<30k> to posters-shorts/<short-slug>-<k>-<name>.png,
plus <short-slug>-sheet.png and <short-slug>-small.png (video-pipeline's covers recipe).
Three distinct ideas. Report each
cover's bounds measured from pixels.
```

Check the covers yourself before the user sees them:

- **Measure the bounds from pixels**, never from a code comment: every key shape and word inside x 108-920, y 220-1500, and the main read inside y 420-1500. Overlay both boxes, read the result, and measure any shape near an edge. At signoff, "Highest" shapes measured x 91 to 943 and ran below y 1500 while the comment said they were inside.

  ```sh
  mkdir -p out/wip-covers
  ffmpeg -v error -y -i posters-shorts/<file>.png -vf "drawbox=x=108:y=220:w=812:h=1280:color=red@0.9:t=4,drawbox=x=108:y=420:w=812:h=1080:color=yellow@0.9:t=4" out/wip-covers/<file>-safe.png
  ```

- **Read every cover at full size**, not only the sheet. A crack graphic split the "h" of "Highest" and left a white sliver that only showed at full size.
- Words at 4.5:1 contrast or better, and only sung lyrics, `docQuotes` names and sung numerals; no logo unless `logoUse` allows; grain 0. A cover that echoes one the user already posted is a backup only.

Read the two sheets inline, recommend one, and ask: approve, revise, or redo. A cut short's covers work the same way, with the registry in the parent project.

### S6. Post copy and delivery

On request, write titles and descriptions to `creative/social-captions.md` in the Short's project, and show them in your message. In the Jira run they went only into chat, and the user had to ask again. For each Short: three titles, the recommended first (usually the pitch's question); a description whose first line quotes a sung line exactly, then "A <N>-second <genre> song about <topic>, from the people who brought you "<parent title>". Full song: <link>", with N the take's length rounded to the nearest second (the Jira takes were 28.4 s and 31.6 s); hashtags ending with #shorts; and "Parody - not affiliated with <company>." for a parody. Tell the user to replace `<link>`, set the full video as the Related video, match the parent title as posted, and space out Shorts on one topic. Then deliver ("Deliverables").

### S7. Cleanup

Each Short project holds about 2 GB of environments plus its `out/`. Run "Cleanup" in each one; the user may keep the environments while more Shorts are likely.

## Renders and machine load

`src/pipeline.json` holds the settings every render shares: `render` (scale 2, so a 3840x2160 master from the 1920x1080 page; CRF 17; PNG captures; `pool` 2; 20 s chunks) and `draft` (scale 0.5, 960x540, JPEG captures, CRF 23). Measured at pool 2 with the template's placeholder scene; real scenes are slower, and every frame inside a blur window costs one capture per sample:

| Render | Speed | A 4:23 song (7880 frames) |
|---|---|---|
| Draft (`pnpm draft`) | about 0.07 s per frame per worker | about 5 minutes (278 s measured) |
| 1080p (`pnpm render --scale=1`, the text-only QA render) | about 0.37 s per frame per worker | roughly half an hour or more |
| 4K master (`pnpm render`) | about 1.13 s per frame of wall time | about 2.5 hours, about 3 GB |

`src/pipeline.vertical.json` renders at scale 1: a 1080x1920 master and 540x960 drafts. In the Jira run, with real scenes at pool 2, the 3-minute vertical master took about 22 minutes and came to about 600 MB, and each short cut from it was 55 to 110 MB.

- **The pool cap.** A render runs at most `pool` chunk workers at once, each a headless Chromium plus an x264 encoder. The default is 2: a shell-job pool once launched 24 4K chunks at once and rebooted the machine. To change it for one run, pass `--pool=<n>` to `pnpm render` or `pnpm draft`; to change it for the project, set `render.pool` in `src/pipeline.json` (drafts use the same value). Above 2 prints a warning; raise it only when the user asks and knows the machine, and lower it to 1 when they need the machine to stay usable during a long render.
- **One heavy render at a time, machine-wide.** Don't overlap renders, drafts, `still-test`, alignment or other heavy ffmpeg work, across agents and projects too. Run anything longer than a few minutes in the background.
- **Disk.** While a render runs, its temp folder holds the chunks, the joined video and the muxed file at once: budget about three times the master's size on the `out/` drive, plus the old master if there is one.

## Feedback rounds

- **Relay the user's words verbatim** to the director, in quotes, alongside your summary. A paraphrase loses what they disliked.
- **Stop a rejected render.** When the user rejects something in a render that's still running, stop that render before it finishes (Ctrl-C or SIGTERM cleans up its temp folder and workers); don't spend hours finishing a look that's already out.
- **Re-measure, don't eyeball.** Ask for numbers: `pnpm still-test` and `pnpm jitter` on the held lyrics the user flagged, `pnpm pops` plus the critique strips for anything between shots, and A/V sync by cross-correlating the audio of any MP4 that `pnpm render` or `pnpm draft` didn't make against `public/audio/track.*` (the lag should be under one frame). "It looks fine now" isn't a fix.
- **Feedback goes through a critique round.** The director's fix comes back as a new draft round, and the critic judges it as usual, with any new rule the user stated added to `hardRules` first. Master-render again only after an ACCEPT.
- **Landscape fixes after the vertical is built.** The vertical imports some landscape helpers. A landscape fix that touches one of them changes the vertical too, so have the director say which helpers it touched, and when the vertical uses them, run a vertical round, re-render the vertical master, and cut the clips again.

## Deliverables

Send the user:

- **The MP4**: its absolute path, `out/<outputName>.mp4` (3840x2160, H.264, BT.709, AAC from the untouched track).
- **The preview**: `out/<outputName>-preview.mp4`, 720p and under 30 MB, sized for chat upload. Give its path.
- **The contact sheet**: `out/contact-sheet.png`. Read it so it shows inline, and give its path.

Then the versions the brief asked for:

- **The vertical** (when `social.vertical`): `out/<vertical outputName>.mp4` (1080x1920), its preview `out/<vertical outputName>-preview.mp4` (720x1280, under 30 MB), and its contact sheet (`out/<vertical outputName>-contact-sheet.png`, read inline). When the user wanted shorts only, don't offer the vertical master as a deliverable; mention it exists in one line.
- **The shorts** (when `social.shorts`): each clip's full-quality path under `out/clips/`, with its title, length and first sung line. The full-quality clips are usually over the 30 MB chat upload cap, so send the preview copies (`out/clips/<file>-preview.mp4`, 720x1280) for chat and give the paths of the full-quality files for posting. Tell the user that `theme.safe.social` is an estimate of the Reels and TikTok overlays, and to check one real upload before posting the rest.
- **The posters** (when `posters`): the paths of the 1280x720 PNGs in `posters/`, with `posters/posters-sheet.png` read inline. A successful `pnpm posters` removes poster PNGs that are no longer in the list, so the `poster-*.png` files there are exactly the current set.

For a **stand-alone Short**, send from its own project:

- **Post-ready:** the master `out/<outputName>.mp4` (1080x1920), the recommended cover and the alternates in `posters-shorts/` (absolute paths, recommended first), and `creative/social-captions.md` when the user asked for post copy.
- **Previews, as a separate list:** `out/<outputName>-preview.mp4` and the contact sheet, read inline. Never mix previews into the post-ready list.

### Captions for the shorts

At delivery, ask whether the user wants titles and captions for the shorts. Write them only if they do, to `creative/social-captions.md`, and show them in your message. For each short:

- **A title.** Reels and TikTok have no title field, so it's the caption's first line, or the text for the cover.
- **A caption** of one or two sentences, drawn from the sung lines in that clip.
- **Hashtags**: a few that fit the company, the song's genre and the joke.
- **For a satire,** a suggested line such as "Parody - not affiliated with <company>".

The user asked for this copy, so the no-invented-copy rule for on-screen text doesn't apply to it. It still never goes on screen, and it keeps to `brief.avoid`. Post copy for a stand-alone Short (three titles, a description and hashtags) follows S6 and goes to the same file name in the Short's project.

When Cadence is connected you can also store the contact sheet with `prepare_file_upload` and give its file number. That path caps files at 4 MB, so the preview usually doesn't fit; leave it as a path.

Then save the direction to the log: with Cadence connected, `create_knowledge` with tag `music-video-direction`, the company in the title, and the direction's summary (reference, typography, motion, colour, texture, transitions). Search first and skip it if the entry exists.

## Cleanup

List these with their sizes (`du -sh`) and ask with a multi-select `AskUserQuestion` which to delete. Never delete anything while a render is running.

| Path | Size seen | Safe because |
|---|---|---|
| `out/draft*.mp4` and their `.manifest.json` | not measured yet; check with `du -sh` | half-res drafts; the critic reports stay in `creative/critique/` |
| `out/critique/` | check with `du -sh` | QA sheets for each round |
| `out/<outputName>-textonly*.mp4` | check | the text-only QA renders, for each config |
| `out/*-frames-*.mp4`, their manifests and their `-preview.mp4` copies | 140 MB plus a 25 MB preview for a 40 s vertical early look | partial test renders, the early look included; the finished master supersedes it |
| `out/vertical-draft*.mp4` and their `.manifest.json` | check | half-res vertical drafts; the reports stay in `creative/critique/` |
| `out/clips/*-preview.mp4` | about 25 MB each | chat copies of the shorts; `pnpm preview --in <clip>` makes them again |
| `out/wip-*`, `out/snapshots/`, `out/reference/` | 90 to 300 MB per folder in the Jira run | working stills (`out/wip-clips/` and the vertical's `out/wip-v*` included), round snapshots, reference sheets |
| `out/concepts/` and a cancelled concept's `out/<slug>.mp4` | check | concept stills, sheets and motion tests; the concepts' source stays in `src/concepts/` |
| `out/.render-*`, `out/.draft-*` | check | temp folders of a killed render; the next render sweeps them anyway |
| `.venv-align` | about 500 MB | `pnpm setup:align` recreates it; delete once the lyrics are final |
| `.cache/models` | about 1.4 GB | alignment models; re-aligning without them downloads about 650 MB again |
| `.cache/ms-playwright` | about 195 MB | headless Chromium; `pnpm setup:env` downloads it again |
| `.venv` | check | `pnpm setup:env` recreates it; every capture, critique and analysis needs it |
| A stand-alone Short's `.venv`, `.venv-align` and `.cache` | about 2 GB per Short project (525 MB, 493 MB and 1.0 GB for "Highest") | `pnpm setup:env` and `pnpm setup:align` recreate them; keep them while more Shorts or fixes are likely |

Run this in the parent and in each Short project under `shorts/`. Never delete `public/audio/`, `public/brand/`, `public/fonts/`, `creative/`, `src/`, `posters/`, `posters-shorts/`, the masters (landscape and vertical, including a vertical master rendered only for the shorts, since re-cutting a clip needs it), their previews and contact sheets, or the full-quality clips and their manifest in `out/clips/`. Keep the alignment models unless the user says alignment is done for good, and keep `.venv` and `.cache/ms-playwright` while any render or fix is still likely. Delete only what the user ticked, and report what was deleted with its size.
