"""Frame-to-frame differences of a whole video, for finding pops and flashes.

Invoked by scripts/pops.mjs (`pnpm pops`), which decodes every frame with
ffmpeg into one raw 8-bit grayscale file of small frames first, so this
script only reads that file (memory-mapped: one frame pair at a time).

Prints one JSON object to stdout: {"frames": N, "d": [...], "skip": [...]}:
- d[i] = mean |f[i+1] - f[i]| (0..255), for i in 0..N-2;
- skip[n] = mean |f[n+1] - f[n-1]|, for n in 1..N-2 (skip[0] and skip[N-1] are null).
pops.mjs decides what counts as a pop or a flash.
"""

from __future__ import annotations

import argparse
import json
import sys

import numpy as np


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("raw", help="raw gray8 frames, back to back")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    args = parser.parse_args()

    size = args.width * args.height
    data = np.memmap(args.raw, dtype=np.uint8, mode="r")
    if size <= 0 or len(data) % size != 0:
        print(f"pops.py: {len(data)} bytes is not a whole number of {args.width}x{args.height} frames", file=sys.stderr)
        return 1
    frames = data.reshape(-1, args.height, args.width)
    n = len(frames)

    def mad(a: int, b: int) -> float:
        return float(np.abs(frames[a].astype(np.int16) - frames[b].astype(np.int16)).mean())

    d = [mad(i + 1, i) for i in range(n - 1)]
    skip: list[float | None] = [None] * n
    for k in range(1, n - 1):
        skip[k] = mad(k + 1, k - 1)
    json.dump({"frames": n, "d": d, "skip": skip}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
