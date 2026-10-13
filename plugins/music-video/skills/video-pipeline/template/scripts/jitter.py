"""Frame-to-frame motion of a video crop, for spotting held text that shimmers.

Invoked by scripts/jitter.mjs (`pnpm jitter`), which decodes the frames with
ffmpeg into one raw 8-bit grayscale file first, so this script only reads that
file, one frame at a time (memory stays at one frame pair however long the
window). For each consecutive pair of frames it measures:

- shift: the sub-pixel translation by phase correlation (peak refined with
  the Dirichlet-kernel fit of Foroosh et al., see subpixel()), dx/dy and the
  distance;
- centroid shift: how far the centroid of the bright pixels (> threshold,
  i.e. light text on a dark ground) moved, or null when no pixel is that bright;
- diff: the mean absolute pixel difference (0..255), which also catches
  scaling, flicker and grain that don't translate.

It also reports each frame's brightest pixel (0..255), which `pnpm jitter
--all-lines` uses to tell a blank frame (the lyric has gone) from a held one.

Prints one JSON object to stdout: {"width", "height", "frames", "pairs": [...], "peaks": [...]}.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np


def subpixel(c: float, m: float, p: float) -> float:
    """Offset of the true peak from the integer peak `c`, given its neighbours `m`
    (before) and `p` (after). Phase correlation's peak is a Dirichlet kernel, not
    a parabola: the larger neighbour r1 puts the peak r1 / (r1 + c) of a pixel
    towards it (Foroosh, Zerubia & Berthod 2002). A parabolic fit reads a
    0.25 px shift as ~0.12 px.

    Equal neighbours mean no offset. Identical frames of a hard-edged shape
    give a peak with equal, nonzero neighbours (the shape's spectrum has exact
    zeros), which the formula alone would read as a shift of p / (p + c)."""
    if c <= 0:
        return 0.0
    if abs(p - m) <= 1e-9 * c:
        return 0.0
    if p >= m:
        return 0.0 if p <= 0 else p / (p + c)
    return 0.0 if m <= 0 else -m / (m + c)


def phase_shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """(dx, dy) that moves b onto a, in pixels."""
    h, w = a.shape
    fa = np.fft.fft2(a - a.mean())
    fb = np.fft.fft2(b - b.mean())
    cross = fa * np.conj(fb)
    cross /= np.abs(cross) + 1e-9
    r = np.fft.ifft2(cross).real
    py, px = np.unravel_index(np.argmax(r), r.shape)
    dy = py + subpixel(r[py, px], r[(py - 1) % h, px], r[(py + 1) % h, px])
    dx = px + subpixel(r[py, px], r[py, (px - 1) % w], r[py, (px + 1) % w])
    if dy > h / 2:
        dy -= h
    if dx > w / 2:
        dx -= w
    return float(dx), float(dy)


def centroid(a: np.ndarray, threshold: int) -> tuple[float, float] | None:
    ys, xs = np.nonzero(a > threshold)
    if len(xs) == 0:
        return None
    return float(xs.mean()), float(ys.mean())


def measure_pair(prev: np.ndarray, cur: np.ndarray, threshold: int) -> dict:
    """The pair's shift, centroid shift and mean difference (float64 frames)."""
    dx, dy = phase_shift(cur, prev)
    c0, c1 = centroid(prev, threshold), centroid(cur, threshold)
    return {
        "dx": dx,
        "dy": dy,
        "shift": math.hypot(dx, dy),
        "centroidShift": None if c0 is None or c1 is None else math.hypot(c1[0] - c0[0], c1[1] - c0[1]),
        "diff": float(np.abs(cur - prev).mean()),
    }


def measure_file(path: str, width: int, height: int, threshold: int) -> tuple[int, list[dict], list[int]]:
    """Read the raw frames one at a time (never the whole window: a 4K hold of a few seconds is gigabytes as
    float64), keeping only the previous frame: peak memory is one frame pair, whatever the window's length.
    Returns (frames, pairs, peaks); peaks are each frame's brightest pixel, read from its uint8 data."""
    size = width * height
    pairs: list[dict] = []
    peaks: list[int] = []
    prev = None
    with open(path, "rb") as fh:
        while True:
            raw = np.fromfile(fh, dtype=np.uint8, count=size)
            if raw.size == 0:
                break
            if raw.size != size:
                raise ValueError(f"the last frame has {raw.size} of {size} bytes")
            peaks.append(int(raw.max()))
            cur = raw.reshape(height, width).astype(np.float64)
            if prev is not None:
                pairs.append(measure_pair(prev, cur, threshold))
            prev = cur
    return len(peaks), pairs, peaks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw", help="raw gray8 frames, back to back")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--threshold", type=int, default=225)
    args = parser.parse_args()

    size = args.width * args.height
    total = os.path.getsize(args.raw)
    if size <= 0 or total % size != 0:
        print(f"jitter.py: {total} bytes is not a whole number of {args.width}x{args.height} frames", file=sys.stderr)
        return 1
    frames, pairs, peaks = measure_file(args.raw, args.width, args.height, args.threshold)
    json.dump({"width": args.width, "height": args.height, "frames": frames, "pairs": pairs, "peaks": peaks}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
