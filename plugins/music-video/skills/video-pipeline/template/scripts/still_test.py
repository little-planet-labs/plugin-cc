"""Held-text pixel check on the engine (pnpm still-test), and the page's line
schedule for pnpm jitter --all-lines.

Invoked by scripts/still-test.mjs and scripts/jitter.mjs, which do the frame
arithmetic and the reporting; this script only drives the page through
scripts/capture.py's Capture (text-only mode: the world, fx and overlay layers
draw nothing on an opaque black stage, the lyric layer as usual).

    still_test.py lines --root DIR [--scenes MODULE] [--pipeline CONFIG]
        Print {"info": {...}, "lines": window.__mv.lines()} as one JSON line,
        each line with its words' schedules. Times that aren't finite come back as null.

    still_test.py check --root DIR --plan PLAN.json
        PLAN = {"scale": S, "scenes": MODULE | null, "pipeline": CONFIG | null (optional),
                "checks": [{"id": LINE, "word": K, "frames": [n, ...]}, ...]}.
        For each check: show only word K of line LINE (an injected !important
        visibility rule hides every other lyric line, #txt .ly whose data-line
        isn't LINE, and every other word of LINE, .wm whose data-word isn't K),
        capture each listed frame exactly as the render does (Capture.frame:
        the page's subframes for that frame), and compare every frame with the
        first one, pixel for pixel. Print {"info", "lines" (the schedule),
        "results": [{"id", "word", "frames", "maxDiff", "changed", "lit", "litFirst",
        "diffs": [{"frame", "maxDiff", "changed", "lit"}]}]} as one JSON line.
        maxDiff is the largest channel difference (0..255), changed the most
        pixels with any channel different, lit the most pixels that aren't
        black in any listed frame (litFirst: in the first one).

The method: render only the lyric layer, at device scale 2 so sub-pixel creep
shows, and diff frames across each held word's window with everything else
hidden; any nonzero difference is motion.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from capture import Capture, CaptureError, run  # noqa: E402

ISOLATE_ID = "mv-still-test-isolate"

# Show only word `k` of line `id`. Returns false when the page has no element for that word.
ISOLATE = (
    "([id, k]) => {"
    "  const line = [...document.querySelectorAll('#txt .ly')].find((e) => e.dataset.line === id);"
    "  if (!line || !line.querySelector(`.wm[data-word=\"${k}\"]`)) return false;"
    f"  let s = document.getElementById('{ISOLATE_ID}');"
    f"  if (!s) {{ s = document.createElement('style'); s.id = '{ISOLATE_ID}'; document.head.appendChild(s); }}"
    "  const sel = `[data-line=\"${CSS.escape(id)}\"]`;"
    "  s.textContent = `#txt .ly:not(${sel}){visibility:hidden!important}` +"
    "    `#txt .ly${sel} .wm:not([data-word=\"${k}\"]){visibility:hidden!important}`;"
    "  return true;"
    "}"
)
RELEASE = f"() => document.getElementById('{ISOLATE_ID}')?.remove()"

TIMES = ("first", "settled", "exitStart", "exitEnd", "next")
WORD_TIMES = ("reveal", "settled", "exitStart", "exitEnd")


def finite(v):
    return v if isinstance(v, (int, float)) and math.isfinite(v) else None


def clean_lines(lines: list[dict]) -> list[dict]:
    out = []
    for l in lines:
        words = [{"index": w["index"], "text": w["text"], **{k: finite(w.get(k)) for k in WORD_TIMES}} for w in l.get("words") or []]
        out.append({"id": l["id"], **{k: finite(l.get(k)) for k in TIMES}, "words": words})
    return out


def page_info(cap: Capture) -> dict:
    i = cap.info
    return {"fps": i["fps"], "frames": i["frames"], "width": i["width"], "height": i["height"], "duration": i["duration"]}


def report_console(cap: Capture) -> None:
    for c in cap.console:
        if not c.startswith("warning: music-video:"):
            print(f"still_test: console {c}", file=sys.stderr)


def lit_pixels(img: np.ndarray) -> int:
    return int((img.max(axis=2) > 0).sum())


async def cmd_lines(args) -> int:
    cap = Capture(args.root, scale=1.0, textonly=True, scenes=args.scenes, pipeline=args.pipeline)
    try:
        await cap.open()
        lines = clean_lines(await cap.page.evaluate("window.__mv.lines()"))
    finally:
        await cap.close()
    report_console(cap)
    print(json.dumps({"info": page_info(cap), "lines": lines}))
    return 0


async def cmd_check(args) -> int:
    plan = json.loads(Path(args.plan).read_text("utf-8"))
    cap = Capture(args.root, scale=float(plan["scale"]), textonly=True, scenes=plan.get("scenes"), pipeline=plan.get("pipeline"))
    results = []
    try:
        await cap.open()
        lines = clean_lines(await cap.page.evaluate("window.__mv.lines()"))
        todo = plan["checks"]
        for k, item in enumerate(todo):
            line_id, word, frames = item["id"], item["word"], item["frames"]
            if not await cap.page.evaluate(ISOLATE, [line_id, word]):
                raise CaptureError(f'the page has no element for word {word} of lyric line "{line_id}" (#txt .ly[data-line] .wm[data-word])')
            if k % 25 == 0:
                print(f"still_test: word windows {k + 1}-{min(k + 25, len(todo))} of {len(todo)}", file=sys.stderr)
            first = await cap.frame(frames[0])
            ref = first.astype(np.int16)
            lit_first = lit_pixels(first)
            diffs = []
            for n in frames[1:]:
                img = await cap.frame(n)
                d = np.abs(img.astype(np.int16) - ref)
                diffs.append({"frame": n, "maxDiff": int(d.max()), "changed": int((d.max(axis=2) > 0).sum()), "lit": lit_pixels(img)})
            results.append(
                {
                    "id": line_id,
                    "word": word,
                    "frames": frames,
                    "maxDiff": max((d["maxDiff"] for d in diffs), default=0),
                    "changed": max((d["changed"] for d in diffs), default=0),
                    "lit": max([lit_first, *(d["lit"] for d in diffs)]),
                    "litFirst": lit_first,
                    "diffs": diffs,
                }
            )
        await cap.page.evaluate(RELEASE)
    finally:
        await cap.close()
    report_console(cap)
    print(json.dumps({"info": page_info(cap), "lines": lines, "results": results}))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="still_test.py", description="Held-text pixel check and line schedule.")
    sub = p.add_subparsers(dest="command", required=True)
    lp = sub.add_parser("lines")
    lp.add_argument("--root", required=True)
    lp.add_argument("--scenes")
    lp.add_argument("--pipeline")
    cp = sub.add_parser("check")
    cp.add_argument("--root", required=True)
    cp.add_argument("--plan", required=True)
    args = p.parse_args(argv)
    return run(lambda: cmd_lines(args) if args.command == "lines" else cmd_check(args))


if __name__ == "__main__":
    sys.exit(main())
