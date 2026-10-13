"""Frame probes on a finished video for tests/render/render-*.test.mjs: decodes
every frame with ffmpeg (rgb24; the decoder applies the stream's BT.709 TV-range
tags) and prints one JSON line.

    python tests/fixtures/render-probe.py timecodes FILE   # {"codes": [...]}: the time code of every frame
    python tests/fixtures/render-probe.py luma FILE        # {"luma": [...]}: the mean grey level of every frame
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "scenes"))

import numpy as np  # noqa: E402
from timecode_decode import decode  # noqa: E402


def frames(path: str):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    s = json.loads(probe.stdout)["streams"][0]
    w, h = s["width"], s["height"]
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        if proc.wait() != 0:
            raise SystemExit(f"ffmpeg could not decode {path}")


def main() -> int:
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "timecodes":
        print(json.dumps({"codes": [decode(f) for f in frames(path)]}))
    elif cmd == "luma":
        print(json.dumps({"luma": [float(f.mean()) for f in frames(path)]}))
    else:
        raise SystemExit(f"unknown command {cmd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
