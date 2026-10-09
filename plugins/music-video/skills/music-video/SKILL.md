---
name: music-video
description: The playbook for making a beat-synced kinetic-typography music video about any company, with a song generated in Suno and a video rendered in Remotion. Runs eight phases with user checkpoints (brief interview, company research, topic menu, lyrics and Suno pack, the user's song, the audio pipeline, creative direction, one-shot scene build and render), names the agent and hand-off for each, and covers instantiating the project from the template, taking in the audio, the quality level, the deliverables, and cleanup. Use when the user wants a music video, song, or lyric video about a company or product.
user-invocable: true
---

# Music video

You are the lead. Run the phases in order, stop at every ★ for the user, and dispatch the plugin's three agents for the phases they own. Everything without an agent is yours. Don't skip ahead: no lyrics before the topics are approved, and no scenes before the direction is approved.

## Ground rules

- **Questions go through `AskUserQuestion`**, never buried in prose. Load `little-planet-factory:asking-questions` if it's installed. Batch up to four related questions per call, recommended option first.
- **On-screen copy is lyrics, exact feature names, and the logo.** No invented taglines, labels, or captions that aren't sung.
- **The audio is read-only.** Nothing writes to `public/audio/track.*` after intake.
- **No git writes** unless the user asks. Follow `little-planet-factory:version-control` if it's installed; the default is to leave everything uncommitted.
- **Sandbox.** Headless Chrome can't launch inside the Claude Code Bash sandbox (mach-port denial), so `pnpm still`, `render`, `preview`, and `contact-sheet` need an unsandboxed run: pass `dangerouslyDisableSandbox: true`, or ask the user to turn the sandbox off with `/sandbox`. Inside the sandbox, `pip` needs `--use-deprecated=legacy-certs`.
- **Quality level.** The deterministic pipeline (template `src/lib`, `scripts/`, render) gets reviewed; creative work doesn't. If anyone changes pipeline code, that diff goes to an inspector (`little-planet-factory:quality-bar`, foundational tier). Scenes, lyrics, and direction get no inspector rounds: the director self-checks with stills and the user is the reviewer. The user asked for less checking and a faster result.

## Phases

| # | Phase | Who | Writes | Stop |
|---|---|---|---|---|
| 1 | Brief interview | you | `creative/brief.json` | ★ |
| 2 | Research | `music-video:company-researcher` | `creative/research.md`, `src/brand.json`, `public/brand/logo.svg`, `avoid` in brief.json | |
| 3 | Topic menu | `music-video:lyricist` | `creative/topics.md`; you record `approvedTopics` | ★ |
| 4 | Lyrics and Suno pack | `music-video:lyricist` | `creative/lyrics.md`, `lyrics.screen.txt`, `lyrics.suno.txt`, `suno-prompt.md` | ★ |
| 5 | Song and audio intake | the user, then you | `public/audio/track.wav` or `.mp3` | ★ |
| 6 | Pipeline | you | `src/data/audio-analysis.json`, `lyrics.json`, `sections.json` | |
| 7 | Creative direction | `music-video:video-director` | `creative/direction.md` | ★ |
| 8 | Scene build, self-check, render | `music-video:video-director` | `src/scenes/**`, the MP4, preview, contact sheet | |

Every agent brief gives the absolute project path and the files the agent may write. Agents write only their own files.

## 1. ★ Brief interview

Settle what the request doesn't already say. Two `AskUserQuestion` rounds usually cover it:

- **Round 1:** sources (website only, or website plus a local repo path), audience, tone (funny, serious, or a mix), and target length (about 60 s, 90 s, or 2 min; say that Suno songs usually come back longer).
- **Round 2:** how the company name is **pronounced** (offer two or three phonetic spellings plus "as written"; this sets `pronunciation.sung`), vocals (sung only, recommended, or spoken parts allowed), vocal style (male, female, duet, no preference), and topics to keep out (multi-select: named customers, pricing, competitors, unreleased features).

Also settle the project folder; the default is `~/Developer/<company-slug>-music-video`. Then instantiate the project (next section) and write `creative/brief.json`:

```json
{
  "company": "Acme",
  "website": "https://acme.example",
  "repo": "/Users/me/Developer/acme-app",
  "pronunciation": {"screen": "Acme", "sung": "Ack-mee"},
  "audience": "operations leaders",
  "tone": "half funny, half serious",
  "targetSeconds": 90,
  "vocals": "sung-only",
  "vocalStyle": "female",
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
Research <company> from <website> [and the repo at <path>].
Write: creative/research.md (positioning, product features with their exact UI names
from code when the repo is available, each finding labeled "Confirmed by <source>" or
"Inferring"), src/brand.json, public/brand/logo.svg (plus on-dark/on-light variants),
and add to brief.json's "avoid" list (named customers, third-party vendors, compliance
badges, beta or preview features, ticket numbers). Don't change the user's answers.
Report: font license verdict, logo source, and anything you couldn't confirm.
```

Check its report against the files: `src/brand.json` parses, the logo has no unresolved `var(` or `currentColor`, and every feature name carries a source.

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
pronunciation, vocals, tone, targetSeconds) and research.md.
Write creative/lyrics.md, lyrics.screen.txt, lyrics.suno.txt, suno-prompt.md.
Run the skill's checks (character count, screen/suno diff, logic checks) and quote the results.
```

Show the user the screen lyrics, the style description, and the pronunciation notes. Ask: approve, revise (with notes), or swap in the alternate chorus. Revisions go back to the lyricist with the user's words quoted.

## 5. ★ Song and audio intake

Tell the user exactly what to paste: the whole of `creative/lyrics.suno.txt` into Suno's lyrics box, and the style description from `creative/suno-prompt.md`. Ask them to export WAV if they can. If a take mispronounces the name, they re-roll with the fallback spelling from `suno-prompt.md`.

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
Past directions to avoid repeating: <vault entries tagged music-video-direction, or the
user's answer>. Write ONLY creative/direction.md, including two contrasting alternates
in one line each. No scene code yet.
```

Before dispatching, look up past directions: with Cadence connected, `list_knowledge` with `tag: "music-video-direction"`; otherwise ask the user which past videos and looks to avoid. Show the user the direction's summary and ask: approve, pick an alternate, or redirect with notes.

## 8. Build and render: video-director

```
Project: <abs path>. Direction approved: creative/direction.md [plus the user's notes].
Load music-video:scene-authoring and music-video:remotion-pipeline. Build every scene in
one pass, run the self-check loop, then pnpm render, pnpm preview, pnpm contact-sheet.
Runs that launch Chrome need dangerouslyDisableSandbox: true.
Report the output paths, the stills you checked, and what you fixed.
```

No inspector round. Read the contact sheet image yourself once: a blank, washed-out, or empty-captioned cell goes back to the director with its timestamp. Otherwise deliver.

## Deliverables

Send the user:

- **The MP4**: its absolute path (from `pnpm render`'s output).
- **The preview**: 720p H.264 under 30 MB, sized for chat upload. Give its path.
- **The contact sheet**: Read the PNG so it shows inline, and give its path.

When Cadence is connected you can also store the contact sheet with `prepare_file_upload` and give its file number. That path caps files at 4 MB, so the preview usually doesn't fit; leave it as a path.

Then save the direction to the log: with Cadence connected, `create_knowledge` with tag `music-video-direction`, the company in the title, and the direction's summary (typography, motion, colour, texture, transitions). Search first and skip it if the entry exists.

## Cleanup

List these with their sizes (`du -sh`) and ask with a multi-select `AskUserQuestion` which to delete:

| Path | Size in the Kizen run | Safe because |
|---|---|---|
| `.cache/models/dl` | 560 MB of download tarballs | the extracted models stay in `.cache/models` |
| `out/wip-*` | about 15 MB each | working stills and test renders only |
| `.venv-align` | about 500 MB | `pnpm setup:align` recreates it; delete once the lyrics are final |

Never delete `public/audio/`, `creative/`, `src/`, the final MP4, the preview, or the contact sheet. Keep the extracted models in `.cache/models` (about 830 MB) unless the user says alignment is done for good; re-aligning without them means downloading everything again.
