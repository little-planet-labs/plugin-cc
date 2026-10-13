"""Decode the time code drawn by tests/fixtures/scenes/timecode.js (keep the
layout constants in sync with TIMECODE there). Works on an RGB uint8 array of
any size: the layout is in fractions of the frame, so a scaled or x264-encoded
frame decodes as long as the blocks stay readable.

    from timecode_decode import decode
    value = decode(rgb)   # Math.round(t * fps * 4) the page drew
"""

from __future__ import annotations

import numpy as np

BITS = 20
COLS = 10
STRIDE_OF_WIDTH = 1 / 16
X0_STRIDES = 3
Y0_OF_HEIGHT = 0.15
SAMPLE_OF_STRIDE = 0.3


def decode(rgb: np.ndarray) -> int:
    """The time-code value in an RGB frame."""
    h, w = rgb.shape[:2]
    gray = rgb[..., :3].astype(np.float32).mean(axis=2)
    s = w * STRIDE_OF_WIDTH
    x0 = X0_STRIDES * s
    y0 = Y0_OF_HEIGHT * h
    half = max(1, int(s * SAMPLE_OF_STRIDE / 2))
    value = 0
    for k in range(BITS):
        col, row = k % COLS, k // COLS
        cx = int(round(x0 + (col + 0.5) * s))
        cy = int(round(y0 + (row + 0.5) * s))
        if gray[cy - half : cy + half, cx - half : cx + half].mean() > 127:
            value |= 1 << k
    return value
