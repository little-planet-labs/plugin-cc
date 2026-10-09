"""Lyric text and section logic for scripts/align_lyrics.py, kept free of the
audio libraries so tests run it with any Python 3 (tests/align-text.test.ts).

Parses Suno-style lyrics ([Section] tags, delivery cues, lines), assigns
section and line ids, and turns aligned lines into sections.json entries."""

from __future__ import annotations

import re
import sys

# A stretch this long (seconds) without sung words becomes an instrumental section.
INSTRUMENTAL_MIN_GAP = 4.0
# This many transcribed words in a row with no match in the lyrics are
# reported as possible unlisted lyrics (Suno ad-libs, repeats, extra lines).
UNLISTED_MIN_WORDS = 4
SUNG_LYRICS_NAME = "creative/lyrics.suno.txt"


def log(msg: str) -> None:
    print(f"align: {msg}", file=sys.stderr, flush=True)


# Section tag words -> scene key. Tags whose words aren't here are delivery
# cues ([Playful], [Gang vocals], [Half-time, dramatic]) and are ignored.
SECTION_KINDS = {
    "intro": "intro",
    "verse": "verse",
    "pre-chorus": "preChorus",
    "prechorus": "preChorus",
    "chorus": "chorus",
    "post-chorus": "postChorus",
    "postchorus": "postChorus",
    "hook": "hook",
    "refrain": "refrain",
    "bridge": "bridge",
    "breakdown": "breakdown",
    "outro": "outro",
    "end": "end",
    "instrumental": "instrumental",
    "interlude": "instrumental",
    "break": "instrumental",
    "solo": "instrumental",
    "drop": "instrumental",
    "build": "instrumental",
    "build-up": "instrumental",
    "buildup": "instrumental",
}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def kebab(scene: str) -> str:
    return re.sub(r"(?<=[a-z])(?=[A-Z])", "-", scene).lower()


def parse_tag(inner: str) -> tuple[str, int | None] | None:
    """(scene key, number) for a section tag's inner text, or None for a delivery cue.

    Only the part before the first ',' / ':' / ' - ' / '(' counts, so
    "[Female vocal, build]" stays a cue. That part is a section when it is a
    known kind as a whole ("Pre-Chorus", "Verse 2") or its last word is one
    ("Final Chorus", "Instrumental Break")."""
    head = re.split(r",|:| - |\(", inner, maxsplit=1)[0].strip().lower()
    m = re.fullmatch(r"(.*?)\s*(\d+)?", head)
    base, num = (m.group(1), m.group(2)) if m else (head, None)
    base = re.sub(r"\s+", "-", base.strip())
    number = int(num) if num else None
    if base in SECTION_KINDS:
        return SECTION_KINDS[base], number
    words = [w for w in base.split("-") if w]
    for k in range(len(words) - 1, -1, -1):
        cand = "-".join(words[k:])
        if cand in SECTION_KINDS:
            return SECTION_KINDS[cand], number
    return None


def parse_lyrics(text: str) -> list[dict]:
    """Sections of Suno-style lyrics text, in order:
    [{"tag": str, "scene": str, "number": int | None, "lines": [str]}].

    Blank lines and delivery cues are skipped. Parenthesized text in a line is
    a backing-vocal ad-lib in Suno's convention: it's removed (not aligned, not
    shown). Lines before the first section tag form an "intro" section."""
    sections: list[dict] = []
    for raw in text.splitlines():
        ln = raw.strip()
        if not ln:
            continue
        tag = re.fullmatch(r"\[(.+)\]", ln)
        if tag:
            kind = parse_tag(tag.group(1))
            if kind is not None:
                sections.append({"tag": tag.group(1).strip(), "scene": kind[0], "number": kind[1], "lines": []})
            continue
        text = re.sub(r"\s+", " ", re.sub(r"\([^)]*\)", " ", ln)).strip()
        if not text:
            continue
        if not sections:
            sections.append({"tag": "Intro", "scene": "intro", "number": None, "lines": []})
        sections[-1]["lines"].append(text)
    return sections


def assign_ids(sections: list[dict]) -> None:
    """Give each section an id and, when its kind repeats, a variant.

    id: the kind in kebab case, plus the tag's number ("verse-2") or, for a
    kind that occurs more than once without numbers, its occurrence
    ("chorus-1", "chorus-2"). Line-less tags take part, so ids match the text.
    Collisions get a "-b", "-c", ... suffix."""
    counts: dict[str, int] = {}
    for sec in sections:
        counts[sec["scene"]] = counts.get(sec["scene"], 0) + 1
    seen: dict[str, int] = {}
    used: set[str] = set()
    for sec in sections:
        scene = sec["scene"]
        seen[scene] = seen.get(scene, 0) + 1
        n = sec["number"] if sec["number"] is not None else (seen[scene] if counts[scene] > 1 else None)
        base = kebab(scene) if n is None else f"{kebab(scene)}-{n}"
        sid, k = base, 1
        while sid in used:
            sid = f"{base}-{chr(ord('a') + k)}"
            k += 1
        used.add(sid)
        sec["id"] = sid
        sec["variant"] = str(seen[scene]) if counts[scene] > 1 else None


def acoustic_words(token: str) -> list[str]:
    """Acoustic spelling(s) for one sung token: hyphens and camelCase split
    ("M-C-P" -> m c p, "DataSync" -> data sync); punctuation
    other than apostrophes is dropped."""
    w = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", token)
    w = w.replace("-", " ")
    w = re.sub(r"[^A-Za-z' ]", "", w).lower()
    return [p for p in w.split() if p.strip("'")]


def r3(x: float) -> float:
    return round(float(x), 3)


def line_units(text: str, sung: list[str]) -> list[tuple[str, list[str]]]:
    """(screen token, acoustic words) per on-screen word of a line.

    A token with no letters or digits ("-", "&"-free punctuation) joins the
    previous token, so it's shown but never aligned. A token whose sung
    spelling has nothing to pronounce (digits like "24/7") stops the run:
    spell it out in creative/lyrics.suno.txt."""
    units: list[tuple[str, list[str]]] = []
    for screen_tok, sung_tok in zip(text.split(" "), sung):
        ac = acoustic_words(sung_tok) or acoustic_words(screen_tok)
        if not ac:
            if re.search(r"[A-Za-z0-9]", screen_tok) or not units:
                raise SystemExit(
                    f"can't pronounce {sung_tok!r} in {text!r}: spell it the way it's sung (letters only) "
                    f"in {SUNG_LYRICS_NAME}"
                )
            prev_text, prev_ac = units[-1]
            units[-1] = (f"{prev_text} {screen_tok}", prev_ac)
            continue
        units.append((screen_tok, ac))
    return units


def lyric_lines(sections: list[dict], sung: list[list[list[str]]]) -> list[dict]:
    """Every sung line, in order: {id, text, section, units}.

    Ids are `<section id>-<n>`, numbered from 1 within the section. A line whose
    text repeats an earlier line of the same section reuses that line's id with
    `-r2`, `-r3`, ... (so `n` counts distinct lines)."""
    out = []
    for si, sec in enumerate(sections):
        seen: dict[str, tuple[str, int]] = {}
        n = 0
        for li, text in enumerate(sec["lines"]):
            key = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
            if key in seen:
                base, count = seen[key]
                seen[key] = (base, count + 1)
                lid = f"{base}-r{count + 1}"
            else:
                n += 1
                lid = f"{sec['id']}-{n}"
                seen[key] = (lid, 1)
            out.append({"id": lid, "text": text, "section": si, "units": line_units(text, sung[si][li])})
    return out


def build_sections(lyric_sections: list[dict], lines: list[dict], line_section: list[int], analysis: dict,
                   duration: float) -> list[dict]:
    """Sung sections from the lyric tags, plus `instrumental` sections for every
    stretch of INSTRUMENTAL_MIN_GAP s or more without vocals: before the first
    line ("lead-in"), between sections ("break") and after the last ("tail").

    A sung section starts on the detected downbeat nearest its first word; if
    that downbeat comes after the word (a pickup), 0.05 s before the word
    instead, so the word is never cut. An instrumental starts on the first
    downbeat after the last sung word ends (or just after the word). A
    line-less tag in the lyrics ([Instrumental], [Break], [End]) names the
    instrumental at its position; without one it's "instrumental-<n>"."""
    downbeats = list(analysis.get("downbeats") or [])
    groups: list[tuple[dict, list[dict]]] = []
    pending: list[list[dict]] = [[]]  # line-less tags before each sung section, then after the last
    for si, sec in enumerate(lyric_sections):
        sec_lines = [ln for ln, s in zip(lines, line_section) if s == si]
        if sec_lines:
            groups.append((sec, sec_lines))
            pending.append([])
        else:
            pending[-1].append(sec)
    if not groups:
        raise SystemExit("no sung lines in the lyrics")

    used: set[str] = {sec["id"] for sec, _ in groups}
    counter = [0]

    def instrumental(start: float, variant: str, tags: list[dict]) -> dict:
        if tags:
            sid = tags[0]["id"]
            for t in tags[1:]:
                log(f"lyric tag [{t['tag']}] has no lines and shares a gap with [{tags[0]['tag']}]; dropped")
        else:
            counter[0] += 1
            sid = f"instrumental-{counter[0]}"
            while sid in used:
                counter[0] += 1
                sid = f"instrumental-{counter[0]}"
        used.add(sid)
        return {"id": sid, "scene": "instrumental", "start": r3(start), "variant": variant}

    def downbeat_after(t: float, before: float) -> float:
        db = next((d for d in downbeats if d >= t - 0.1), None)
        return db if db is not None and db < before - 1.0 and db > t - 0.1 else t + 0.05

    def drop_unused(tags: list[dict]) -> None:
        for t in tags:
            log(f"lyric tag [{t['tag']}] has no lines and no instrumental gap of {INSTRUMENTAL_MIN_GAP:g}s+ at its place; dropped")

    out: list[dict] = []
    prev_end = None
    prev_last_word = None
    for k, (sec, sec_lines) in enumerate(groups):
        word0 = sec_lines[0]["words"][0]["start"]
        if downbeats:
            db = min(downbeats, key=lambda d: abs(d - word0))
            start = db if db <= word0 else word0 - 0.05
        else:
            start = word0 - 0.05
        if prev_last_word is not None:
            start = min(max(start, prev_last_word + 0.05), word0)
        tags = pending[k]
        if k == 0:
            if word0 >= INSTRUMENTAL_MIN_GAP:
                out.append(instrumental(0.0, "lead-in", tags))
            else:
                drop_unused(tags)
                start = 0.0
        elif word0 - prev_end >= INSTRUMENTAL_MIN_GAP:
            gap_start = downbeat_after(prev_end, start)
            if gap_start < start - 0.5:
                out.append(instrumental(gap_start, "break", tags))
            else:
                drop_unused(tags)
        else:
            drop_unused(tags)
        entry = {"id": sec["id"], "scene": sec["scene"], "start": r3(max(start, 0.0))}
        if sec["variant"] is not None:
            entry["variant"] = sec["variant"]
        out.append(entry)
        prev_end = sec_lines[-1]["end"]
        prev_last_word = sec_lines[-1]["words"][-1]["start"]
    if duration - prev_end >= INSTRUMENTAL_MIN_GAP:
        out.append(instrumental(downbeat_after(prev_end, duration), "tail", pending[-1]))
    else:
        drop_unused(pending[-1])
    return out


def unlisted_lyrics(asr: list[tuple[str, float]], match: list[int | None]) -> list[dict]:
    """Runs of UNLISTED_MIN_WORDS+ transcribed words that match nothing in the
    lyrics: candidates for sung lines missing from lyrics.screen.txt (ad-libs,
    repeats Suno added). ASR also mishears, so check each by ear."""
    matched = {j for j in match if j is not None}
    runs, cur = [], []
    for j, (w, t) in enumerate(asr):
        if j in matched:
            if len(cur) >= UNLISTED_MIN_WORDS:
                runs.append(cur)
            cur = []
        else:
            cur.append((w, t))
    if len(cur) >= UNLISTED_MIN_WORDS:
        runs.append(cur)
    return [{"start": r3(run[0][1]), "end": r3(run[-1][1]), "heard": " ".join(w for w, _ in run)} for run in runs]
