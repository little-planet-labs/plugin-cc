"""Render worker: one chunk of the video, frames [from, to), captured through
scripts/capture.py and piped as raw rgb24 to this worker's own ffmpeg (x264)
process. No frame touches the disk.

scripts/render.mjs starts one worker per pool slot as the leader of its own
process group, so stopping the worker stops its Chromium and its ffmpeg with
it. The worker owns exactly one Chromium (one Capture) and one encoder.

    python scripts/render_chunk.py --root DIR --from A --to B --frames-total N
        --scale S --format png|jpeg [--textonly] [--scenes MODULE] [--pipeline CONFIG] [--single]
        --encoder JSON [--sample-log FILE]

--encoder is a JSON array: the ffmpeg binary and its full argument list
(built by scripts/lib/encode.mjs chunkEncoderArgs, output path included).
--frames-total is the frame count render.mjs computed (scripts/lib/project.mjs);
the page must agree. Without --single, frame n is the exact average of the
captures at window.__mv.subframes(n) (motion blur inside the page's blur
windows only); the cut rule is checked again here before any capture. With
--single (the draft), frame n is one capture at n / fps. --sample-log writes
one JSON line per frame, {"n", "samples"}: the times actually captured.

Exit codes: 0 when ffmpeg finished the chunk, 1 on any failure (ffmpeg is
killed first, so a failed chunk is never finalised), 130 / 143 on SIGINT /
SIGTERM (scripts/capture.py run()). The worker also stops when its parent
(render.mjs) is gone, so a killed orchestrator can't leave it rendering.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

from capture import Capture, CaptureError, average, check_samples, run


async def render_chunk(a: argparse.Namespace) -> int:
    parent = os.getppid()
    encoder = json.loads(a.encoder)
    if not isinstance(encoder, list) or not encoder or not all(isinstance(x, str) for x in encoder):
        raise CaptureError("--encoder must be a JSON array of strings (ffmpeg and its arguments)")
    label = f"chunk [{a.start}, {a.end})"
    cap = Capture(a.root, scale=a.scale, textonly=a.textonly, scenes=a.scenes, fmt=a.format, pipeline=a.pipeline)
    proc = None
    log = open(a.sample_log, "w", encoding="utf-8") if a.sample_log else None
    try:
        info = await cap.open()
        if info["frames"] != a.frames_total:
            raise CaptureError(f"the page has {info['frames']} frames but the render expects {a.frames_total}")
        if not 0 <= a.start < a.end <= info["frames"]:
            raise CaptureError(f"{label} is outside the video (0..{info['frames']})")
        fps = info["fps"]
        cuts = info["cuts"]
        proc = await asyncio.create_subprocess_exec(*encoder, stdin=asyncio.subprocess.PIPE)
        total = a.end - a.start
        every = max(1, -(-total // 10))
        t0 = time.monotonic()
        for i, n in enumerate(range(a.start, a.end)):
            if os.getppid() != parent:
                raise CaptureError("the render that started this worker is gone")
            tc = n / fps
            if a.single:
                samples = [tc]
            else:
                samples = await cap.samples(n)
                check_samples(samples, tc, cuts)  # never across a hard cut, asserted again before capturing
            frame = average([await cap.capture_at(t) for t in samples])
            if log is not None:
                log.write(json.dumps({"n": n, "samples": samples}) + "\n")
            try:
                proc.stdin.write(frame.tobytes())
                await proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as err:
                raise CaptureError(f"ffmpeg stopped reading frames ({err})") from err
            done = i + 1
            if done % every == 0 or done == total:
                per = (time.monotonic() - t0) / done
                print(f"render: {label}: {done}/{total} frames ({per:.2f} s/frame)", file=sys.stderr, flush=True)
        proc.stdin.close()
        code = await proc.wait()
        if code != 0:
            raise CaptureError(f"ffmpeg exited with code {code}")
        proc = None
    finally:
        if proc is not None and proc.returncode is None:
            proc.kill()  # an unfinished chunk is never finalised
            await proc.wait()
        if log is not None:
            log.close()
        await cap.close()
    for c in cap.console:
        if not c.startswith("warning: music-video:"):
            print(f"render: {label}: console {c}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="render_chunk.py", description="Render one chunk of the music video.")
    p.add_argument("--root", required=True, help="project root")
    p.add_argument("--from", dest="start", type=int, required=True, help="first frame")
    p.add_argument("--to", dest="end", type=int, required=True, help="end frame (exclusive)")
    p.add_argument("--frames-total", type=int, required=True, help="the video's frame count (must match the page)")
    p.add_argument("--scale", type=float, default=1.0)
    p.add_argument("--format", choices=["png", "jpeg"], default="png")
    p.add_argument("--textonly", action="store_true")
    p.add_argument("--scenes")
    p.add_argument("--pipeline", help="alternate pipeline config under src/ (default src/pipeline.json)")
    p.add_argument("--single", action="store_true", help="one capture per frame (no subframes)")
    p.add_argument("--encoder", required=True, help="JSON array: ffmpeg and its arguments")
    p.add_argument("--sample-log", help="write the captured sample times, one JSON line per frame")
    a = p.parse_args(argv)
    return run(lambda: render_chunk(a))


if __name__ == "__main__":
    sys.exit(main())
