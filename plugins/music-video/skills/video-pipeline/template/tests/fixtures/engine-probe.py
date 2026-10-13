"""Pixel probes for tests/render/engine-*.test.mjs: each command opens the page
through scripts/capture.py, measures one property and prints one JSON line.

    python tests/fixtures/engine-probe.py <command> --root DIR [--scenes MODULE] [--scale S] [...]

Commands:
  hash      sha256 of frame(n) for each --frames; --history repeats them after seeking far ahead
  timecode  decoded time code of frame(n) for each --frames
  textonly  per frame: pixels outside the lyric word boxes in a textonly capture, lit pixels inside, and the same
            region in a normal capture
  blur      per frame: whether frame(n) equals one plain capture and/or the average of its subframe captures
  crosscut  forces a sample list across a cut and reports whether frame(n) refuses it
  boot      tries to open the page; reports the error and the seconds it took
  hold      textonly frames across one line's hold window: how many differ from the first
  evalat    for each --times t: seek to t, wait two rAFs, and evaluate the --js expression
  lit       for each --frames n: how many pixels of frame(n) are not black
  asyncwith opens the page with `async with Capture(...)` (tagged with --marker); reports the error and the
            tagged Chromium processes still alive afterwards
  wordhold  for each word of --line: its schedule from lines() against what is drawn (visibility around reveal and
            exitEnd, held pose in its hold window), and whether its hold-window frames are pixel-identical with every
            other word hidden
  preview   opens --url (the interactive preview, no render=1), steps with the arrow keys, reads the HUD
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "scripts"))
sys.path.insert(0, str(HERE / "scenes"))

import numpy as np  # noqa: E402
from capture import Capture, CaptureError, CutCrossingError, average  # noqa: E402
from timecode_decode import decode  # noqa: E402

WORD_BOXES = """() => [...document.querySelectorAll('#txt .wm')].filter((m) => {
  const w = m.firstElementChild; const cs = getComputedStyle(w);
  return cs.visibility === 'visible' && Number(cs.opacity) > 0 && getComputedStyle(m.parentElement).visibility === 'visible';
}).map((m) => { const r = m.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })"""


def frames_arg(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part[1:]:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return out


def sha(a: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def box_mask(shape, boxes, scale: float) -> np.ndarray:
    mask = np.zeros(shape[:2], dtype=bool)
    for l, t, r, b in boxes:
        x0, y0 = max(0, int(np.floor(l * scale))), max(0, int(np.floor(t * scale)))
        x1, y1 = int(np.ceil(r * scale)), int(np.ceil(b * scale))
        mask[y0:y1, x0:x1] = True
    return mask


async def cmd_hash(a, cap: Capture):
    frames = frames_arg(a.frames)
    first = [sha(await cap.frame(n)) for n in frames]
    out = {"hashes": first}
    if a.history:
        far = cap.info["frames"] - 1
        second = []
        for n in frames:
            await cap.capture_at(far / cap.info["fps"])
            await cap.capture_at(0)
            await cap.capture_at(far / cap.info["fps"] / 2)
            second.append(sha(await cap.frame(n)))
        out["after_history"] = second
    return out


async def cmd_timecode(a, cap: Capture):
    return {"frames": frames_arg(a.frames), "codes": [decode(await cap.frame(n)) for n in frames_arg(a.frames)], "cuts": cap.info["cuts"]}


async def cmd_textonly(a, cap: Capture):
    frames = frames_arg(a.frames)
    results = []
    for n in frames:
        img = await cap.frame(n)
        boxes = await cap.page.evaluate(WORD_BOXES)
        mask = box_mask(img.shape, boxes, cap.scale)
        lit = img.max(axis=2) > 0
        results.append({"frame": n, "boxes": len(boxes), "outside_nonblack": int((lit & ~mask).sum()), "inside_lit": int((lit & mask).sum()),
                        "outside_pixels": int((~mask).sum()), "mask": mask})
    normal = Capture(a.root, scale=a.scale, textonly=False, scenes=a.scenes)
    try:
        await normal.open()
        for r in results:
            img = await normal.frame(r["frame"])
            r["normal_outside_nonblack"] = int(((img.max(axis=2) > 0) & ~r.pop("mask")).sum())
            r["normal_pixels"] = int(img.shape[0] * img.shape[1])
    finally:
        await normal.close()
    return {"results": results}


async def cmd_blur(a, cap: Capture):
    results = []
    for n in frames_arg(a.frames):
        samples = await cap.samples(n)
        framed = await cap.frame(n)
        plain = await cap.capture_at(n / cap.info["fps"])
        raws = [await cap.capture_at(t) for t in samples]
        results.append({"frame": n, "samples": samples, "equals_plain": bool(np.array_equal(framed, plain)),
                        "equals_average": bool(np.array_equal(framed, average(raws))),
                        "samples_differ": bool(len(raws) > 1 and not np.array_equal(raws[0], raws[-1]))})
    return {"results": results, "windows": cap.info["blurWindows"], "cuts": cap.info["cuts"]}


async def cmd_crosscut(a, cap: Capture):
    cuts = cap.info["cuts"]
    fps = cap.info["fps"]
    c = cuts[0]
    n = round(c * fps)
    await cap.page.evaluate(f"window.__mv.subframes = () => [{(n - 0.25) / fps}, {n / fps}]")
    try:
        await cap.frame(n)
        return {"refused": False, "cut": c}
    except CutCrossingError as err:
        return {"refused": True, "cut": c, "message": str(err)}


async def cmd_hold(a, cap: Capture):
    lines = await cap.page.evaluate("window.__mv.lines()")
    line = next(l for l in lines if l["id"] == a.line)
    fps = cap.info["fps"]
    frames = [n for n in range(cap.info["frames"]) if line["settled"] <= n / fps < line["exitStart"]]
    ref = await cap.frame(frames[0])
    differ = []
    for n in frames[1:]:
        img = await cap.frame(n)
        if not np.array_equal(img, ref):
            differ.append(n)
    return {"line": line, "frames": frames, "differ": differ, "lit": int((ref.max(axis=2) > 0).sum())}


async def preview(url: str):
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            page = await browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(url)
            await page.wait_for_function("() => window.__mv && (window.__mv.ready || window.__mv.error)", timeout=60000)
            state = await page.evaluate("() => ({ready: __mv.ready, error: __mv.error})")
            hud = [await page.inner_text("#hud")]
            await page.keyboard.press("ArrowRight")
            await page.wait_for_function("t => document.getElementById('hud').textContent !== t", arg=hud[0], timeout=5000)
            hud.append(await page.inner_text("#hud"))
            await page.keyboard.press("Shift+ArrowRight")
            await page.wait_for_function("t => document.getElementById('hud').textContent !== t", arg=hud[1], timeout=5000)
            hud.append(await page.inner_text("#hud"))
            scrub = await page.evaluate("getComputedStyle(document.getElementById('scrub')).display")
            return {"state": state, "hud": hud, "scrub": scrub, "errors": errors}
        finally:
            await browser.close()


async def cmd_evalat(a, cap: Capture):
    out = []
    for t in [float(x) for x in a.times.split(",")]:
        await cap.page.evaluate(
            "t => window.__mv.seek(t).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))", t
        )
        out.append(await cap.page.evaluate(a.js))
    return {"values": out, "audio": cap.info.get("audio"), "timing": cap.info.get("timing"), "lines": await cap.page.evaluate("window.__mv.lines()")}


async def cmd_lit(a, cap: Capture):
    """Lit pixels per frame; with --js (an expression giving [left, top, right, bottom] CSS px, or null) also inside that box."""
    lit, in_box = [], []
    for n in frames_arg(a.frames):
        img = await cap.frame(n)
        mask = img.max(axis=2) > 0
        lit.append(int(mask.sum()))
        if a.js != "null":
            box = await cap.page.evaluate(a.js)
            in_box.append(None if box is None else int(box_mask(img.shape, [box], cap.scale)[mask].sum()))
    return {"frames": frames_arg(a.frames), "lit": lit, "lit_in_box": in_box}


async def asyncwith(a):
    import subprocess

    def alive():
        r = subprocess.run(["pgrep", "-f", a.marker.lstrip("-")], capture_output=True, text=True)
        return [int(p) for p in r.stdout.split() if int(p) != __import__("os").getpid()]

    error = None
    try:
        async with Capture(a.root, scenes=a.scenes, launch_args=(a.marker,)) as cap:
            await cap.frame(0)
    except CaptureError as err:
        error = str(err)
    for _ in range(50):
        if not alive():
            break
        await asyncio.sleep(0.1)
    return {"error": error, "alive": alive()}


async def cmd_wordhold(a, cap: Capture):
    fps = cap.info["fps"]
    frames_total = cap.info["frames"]
    line = next(l for l in await cap.page.evaluate("window.__mv.lines()") if l["id"] == a.line)
    sel = f'[data-line="{a.line}"]'
    await cap.page.evaluate(
        "() => { const s = document.createElement('style'); s.id = 'mv-isolate'; document.head.appendChild(s); }"
    )

    async def isolate(k):
        css = "" if k is None else f'.ly:not({sel}) {{ visibility: hidden !important; }} {sel} .wm:not([data-word="{k}"]) {{ visibility: hidden !important; }}'
        await cap.page.evaluate("css => { document.getElementById('mv-isolate').textContent = css; }", css)

    async def word_state(n, k):
        await cap.page.evaluate(
            "t => window.__mv.seek(t).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))", n / fps
        )
        return await cap.page.evaluate(
            """([sel, k]) => { const w = document.querySelector(`${sel} .wm[data-word="${k}"] .wi`); const cs = getComputedStyle(w);
               return {visible: cs.visibility === 'visible', transform: cs.transform, opacity: cs.opacity, filter: cs.filter}; }""",
            [sel, k],
        )

    eps = 1e-7
    words = []
    for w in line["words"]:
        k = w["index"]
        reveal_f = round(w["reveal"] * fps)
        gone_f = next(n for n in range(frames_total + 1) if n == frames_total or n / fps >= w["exitEnd"] - eps)
        held = [n for n in range(frames_total) if w["settled"] - eps <= n / fps < w["exitStart"] - eps]
        before = await word_state(reveal_f - 1, k) if reveal_f > 0 else {"visible": False}
        at = await word_state(reveal_f, k)
        after = await word_state(gone_f, k) if gone_f < frames_total else {"visible": False}
        poses = [await word_state(n, k) for n in held]
        await isolate(k)
        imgs = [await cap.frame(n) for n in held]
        await isolate(None)
        differ = [held[i] for i in range(1, len(imgs)) if not np.array_equal(imgs[i], imgs[0])]
        words.append({
            "index": k, "text": w["text"], "held": held, "differ": differ,
            "lit": int((imgs[0].max(axis=2) > 0).sum()) if imgs else 0,
            "hidden_before_reveal": not before["visible"], "visible_on_reveal": at["visible"], "hidden_from_exit_end": not after["visible"],
            "held_pose_ok": all(p["visible"] and p["transform"] == "none" and p["opacity"] == "1" and p["filter"] == "none" for p in poses),
        })
    return {"line": line, "words": words}


COMMANDS = {"hash": cmd_hash, "timecode": cmd_timecode, "textonly": cmd_textonly, "blur": cmd_blur, "crosscut": cmd_crosscut, "hold": cmd_hold, "evalat": cmd_evalat, "lit": cmd_lit, "wordhold": cmd_wordhold}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=[*COMMANDS, "boot", "preview", "asyncwith"])
    p.add_argument("--root")
    p.add_argument("--url")
    p.add_argument("--scenes")
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--textonly", action="store_true")
    p.add_argument("--frames", default="0")
    p.add_argument("--history", action="store_true")
    p.add_argument("--line")
    p.add_argument("--times", default="0")
    p.add_argument("--js", default="null")
    p.add_argument("--marker", default="--mv-asyncwith")
    p.add_argument("--timeout", type=float, default=120.0)
    a = p.parse_args()

    async def go():
        if a.command == "preview":
            return await preview(a.url)
        if a.command == "asyncwith":
            return await asyncwith(a)
        cap = Capture(a.root, scale=a.scale, textonly=a.textonly, scenes=a.scenes, timeout=a.timeout)
        t0 = time.monotonic()
        try:
            if a.command == "boot":
                try:
                    await cap.open()
                    return {"ok": True, "seconds": time.monotonic() - t0}
                except CaptureError as err:
                    return {"ok": False, "error": str(err), "seconds": time.monotonic() - t0}
            await cap.open()
            out = await COMMANDS[a.command](a, cap)
            # Page errors and unexpected warnings; the engine's own boot warnings (music-video: ...) are reported apart.
            out["console"] = [c for c in cap.console if not c.startswith("warning: music-video:")]
            out["warnings"] = cap.info.get("warnings", [])
            out["info"] = {k: cap.info[k] for k in ("fps", "frames", "width", "height", "cuts", "blurWindows")}
            return out
        finally:
            await cap.close()

    print(json.dumps(asyncio.run(go())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
