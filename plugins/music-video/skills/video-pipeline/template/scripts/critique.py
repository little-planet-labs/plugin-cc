"""Tile decoded frames into labelled QA contact sheets (pnpm critique).

Invoked by scripts/critique.mjs, which decodes the frames with ffmpeg into raw
rgb24 files first and writes a job file describing every sheet. This script
only reads those files: for each sheet it places the tiles left to right, top
to bottom, stamps each tile's label in its top-left corner with a built-in
5x7 bitmap font (ffmpeg builds often lack drawtext; a bitmap font needs no
system font and stamps the same pixels everywhere, so tests read the labels
back), and writes the sheet as an 8-bit RGB PNG. Needs numpy (the .venv from
`pnpm setup:env`).

Labels exist only on these QA sheets, never in the video.

    critique.py <job.json>   write the sheets the job lists
    critique.py --font       print the font and label geometry as JSON (tests decode labels with it)
"""

from __future__ import annotations

import json
import struct
import sys
import zlib

import numpy as np

# Space between tiles and around the sheet, in px, and its colour.
GAP = 4
GAP_RGB = (24, 24, 24)
# Each font pixel is LABEL_SCALE x LABEL_SCALE output pixels; the label box
# leaves LABEL_PAD px around the glyphs; glyphs advance GLYPH_ADVANCE font px.
LABEL_SCALE = 2
LABEL_PAD = 3
GLYPH_W, GLYPH_H, GLYPH_ADVANCE = 5, 7, 6
LABEL_BG = (0, 0, 0)
LABEL_FG = (255, 255, 255)

# 5x7 glyphs, one string per row, '#' = on. Only what labels use.
FONT: dict[str, list[str]] = {
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    ":": [".....", "..#..", "..#..", ".....", "..#..", "..#..", "....."],
    ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
    "f": ["..##.", ".#..#", ".#...", "###..", ".#...", ".#...", ".#..."],
    "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
    " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
}

GLYPHS = {ch: np.array([[c == "#" for c in row] for row in rows], dtype=bool) for ch, rows in FONT.items()}


def label_size(text: str) -> tuple[int, int]:
    """(width, height) of the label box for `text`, in px."""
    w = 2 * LABEL_PAD + (len(text) * GLYPH_ADVANCE - (GLYPH_ADVANCE - GLYPH_W)) * LABEL_SCALE
    return w, 2 * LABEL_PAD + GLYPH_H * LABEL_SCALE


def stamp(tile: np.ndarray, text: str) -> None:
    """Draw `text` in a box at the tile's top-left corner, in place, clipped to the tile."""
    th, tw, _ = tile.shape
    bw, bh = label_size(text)
    tile[: min(bh, th), : min(bw, tw)] = LABEL_BG
    for i, ch in enumerate(text):
        glyph = np.kron(GLYPHS[ch], np.ones((LABEL_SCALE, LABEL_SCALE), dtype=bool))
        x = LABEL_PAD + i * GLYPH_ADVANCE * LABEL_SCALE
        y = LABEL_PAD
        if x >= tw or y >= th:
            break
        g = glyph[: th - y, : tw - x]
        region = tile[y : y + g.shape[0], x : x + g.shape[1]]
        region[g] = LABEL_FG


def write_png(path: str, rgb: np.ndarray) -> None:
    """An 8-bit RGB PNG, with only the standard library."""
    h, w, _ = rgb.shape
    rows = np.zeros((h, w * 3 + 1), dtype=np.uint8)  # filter byte 0 (None) per row
    rows[:, 1:] = rgb.reshape(h, w * 3)

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows.tobytes(), 6)))
        f.write(chunk(b"IEND", b""))


def build_sheet(spec: dict, frames: np.ndarray) -> np.ndarray:
    cols, rows = spec["cols"], spec["rows"]
    tw, th = spec["tileWidth"], spec["tileHeight"]
    sheet = np.empty((GAP + rows * (th + GAP), GAP + cols * (tw + GAP), 3), dtype=np.uint8)
    sheet[:] = GAP_RGB
    for k, tile_spec in enumerate(spec["tiles"]):
        x = GAP + (k % cols) * (tw + GAP)
        y = GAP + (k // cols) * (th + GAP)
        tile = np.array(frames[tile_spec["index"]])
        stamp(tile, tile_spec["label"])
        sheet[y : y + th, x : x + tw] = tile
    return sheet


def main() -> int:
    if sys.argv[1:] == ["--font"]:
        json.dump(
            {
                "font": FONT,
                "gap": GAP,
                "scale": LABEL_SCALE,
                "pad": LABEL_PAD,
                "glyphWidth": GLYPH_W,
                "glyphHeight": GLYPH_H,
                "advance": GLYPH_ADVANCE,
            },
            sys.stdout,
        )
        return 0
    if len(sys.argv) != 2:
        print("usage: critique.py <job.json> | --font", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf8") as f:
        job = json.load(f)
    for spec in job["sheets"]:
        tw, th = spec["tileWidth"], spec["tileHeight"]
        data = np.memmap(spec["raw"], dtype=np.uint8, mode="r")
        size = tw * th * 3
        if len(data) % size != 0:
            print(f"critique.py: {spec['raw']} is not a whole number of {tw}x{th} rgb24 frames", file=sys.stderr)
            return 1
        frames = data.reshape(-1, th, tw, 3)
        for t in spec["tiles"]:
            if not 0 <= t["index"] < len(frames):
                print(f"critique.py: tile index {t['index']} is outside the {len(frames)} decoded frames", file=sys.stderr)
                return 1
            bad = set(t["label"]) - FONT.keys()
            if bad:
                print(f"critique.py: label {t['label']!r} has characters the font lacks: {sorted(bad)}", file=sys.stderr)
                return 1
        write_png(spec["out"], build_sheet(spec, frames))
    return 0


if __name__ == "__main__":
    sys.exit(main())
