# Notices

The time-seeked page engine and the frame-capture method in this template
are adapted from **howseen-ai/claude-motion-design** (the motion-design
skill's engine, render template and examples), used under the MIT License
below.

## Files with code ported or adapted from howseen-ai/claude-motion-design

| File | What comes from it |
|---|---|
| `src/lib/ease.js` | The io, out, in and o5 easings and the exact-0/exact-1 ends rule |
| `src/lib/springs.js` | The closed-form spring step response and the stiffness/damping presets |
| `src/lib/rng.js` | mulberry32 |
| `src/lib/camera.js` | Camera keys `[t, zoom, x, y]` with eased segments and zoom interpolated in log space |
| `src/lib/text-motion.js` | The masked word rise |
| `src/lib/subframes.js` | Adaptive subframe blur and the never-across-a-hard-cut rule |
| `src/lib/transitions.js` | A circle flood that clears the farthest corner (x1.05) |
| `src/engine/engine.js` | The `seek(t)` method: the whole page drawn as a pure function of t |
| `src/engine/text.js` | Masked word-by-word reveals |
| `src/engine/preview.js` | The preview controls (Space, arrows, Shift+arrows, R, scrubber, `?t=` deep link) |
| `scripts/capture.py` | The deterministic Chromium flags, the two-requestAnimationFrame wait after each seek, waiting for `document.fonts.ready`, killing CSS transitions and pausing animations after load, and blending several subframe captures into one frame |
| `scripts/render_chunk.py`, `scripts/render.mjs`, `scripts/lib/encode.mjs` | The TV-range BT.709 conversion filter, and rendering a long video in parallel chunks that are concatenated |
| `scripts/pops.mjs`, `scripts/pops.py` | The pop-spike and one-frame-flash detection rules |
| `scripts/critique.mjs`, `scripts/critique.py` | The critique sheet layouts: 270 px overview tiles 6x5, 360 px phone tiles 5x3, and 12-frame strips of 320 px from 0.1 s before a moment |

Other parts come from this plugin's own earlier work: the
shatter tiling, shot transitions' blade, ring and bar timing, the energy
swell, the theme and the timing contracts from its earlier Remotion template;
and the rest of the entrance/exit vocabulary, exit compression, the layer
stack, lazy device-pixel-ratio canvases, the remaining transitions, the
held-text still-test and piping captures straight to x264 from an earlier
adaptation of the howseen engine.

## MIT License

MIT License

Copyright (c) 2026 Howseen AI (Raphaël Aubry)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
