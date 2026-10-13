"""Frame capture core: opens index.html?render=1 in headless Chromium and turns
frame n into pixels. Used by `pnpm still` and by the render workers.

Importable (async API):

    cap = Capture(root, scale=2.0, textonly=False, scenes=None, fmt="png")
    info = await cap.open()          # {fps, width, height, frames, duration, cuts, blurWindows, warnings, audio, timing, scale}
    rgb = await cap.frame(n)         # numpy uint8 (round(height*scale), round(width*scale), 3)
    await cap.close()

`async with Capture(...) as cap:` opens and closes. `run(main)` runs a
coroutine function with SIGINT/SIGTERM cancelling it, so `finally` / `async
with` blocks close Chromium (no orphaned browser).

How a frame is made: ask the page for window.__mv.subframes(n) (one time
outside blur windows), refuse a sample list that crosses a hard cut, and for
each sample seek, wait two requestAnimationFrames, and take a CDP
Page.captureScreenshot of the page rect. Several samples are averaged exactly
in integers with round-half-up (the same as float32 sum / N + 0.5, floored).

Device scale: the CDP session the screenshots go through carries the same
Emulation.setDeviceMetricsOverride (deviceScaleFactor = scale) as the page,
and captures with clip.scale 1, so the image is width*scale x height*scale
device pixels. (A clip.scale = scale capture from a session without that
override returns the right size but resets the page's devicePixelRatio to 1
after the first screenshot, so DPR-aware canvases then draw into a quarter of
the frame: measured, see tests/render/engine-determinism.test.mjs.) Every
seek also checks that devicePixelRatio still equals the scale.

Transport: Playwright request interception serves project files on a private
origin (no server, no port, no extra process); paths outside the project or
through a dot-folder get 404, and any other origin is aborted, so nothing
reaches the network at render time.

The Chromium flags and the two-rAF wait are ported from the
howseen-ai/claude-motion-design render template (MIT, see NOTICE.md); its
clip.scale screenshot is replaced by the session override described above.

CLI:
    python scripts/capture.py [--root DIR] [--scale S] [--textonly] [--scenes MODULE]
        [--format png|jpeg] (--frame N [--frame N ...] | --frames A,B,C | --frames A-B)
        [--out FILE | --out-dir DIR] [--info] [--json]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import signal
import sys
from pathlib import Path
from urllib.parse import unquote, urlencode, urlsplit

import numpy as np
from PIL import Image

ORIGIN = "http://music-video.localhost"

CHROMIUM_FLAGS = [
    "--deterministic-mode",
    "--run-all-compositor-stages-before-draw",
    "--disable-threaded-animation",
    "--disable-checker-imaging",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    "--mute-audio",
]

NO_MOTION_CSS = "*{transition:none!important;animation:none!important;caret-color:transparent!important}"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
}

DEFAULT_ROOT = Path(__file__).resolve().parent.parent


class CaptureError(Exception):
    """A capture failure with a message meant for the user."""


class CutCrossingError(CaptureError):
    """A subframe sample list crosses a hard cut."""


def project_file(root: Path, url: str) -> Path | None:
    """The real project file a page URL maps to, or None (other origin, missing, not a file, or refused).

    The containment rule matches scripts/lib/files.mjs: the REAL target (symlinks resolved) must be inside
    the REAL project root, with no segment starting with "." in its real relative path."""
    if not url.startswith(ORIGIN + "/"):
        return None
    path = unquote(urlsplit(url).path)
    parts = [p for p in path.split("/") if p]
    if not parts or any(p.startswith(".") or "\0" in p for p in parts):
        return None
    try:
        base = root.resolve(strict=True)
        target = base.joinpath(*parts).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    try:
        rel = target.relative_to(base)
    except ValueError:
        return None
    if not rel.parts or any(p.startswith(".") for p in rel.parts) or not target.is_file():
        return None
    return target


def crossed_cut(samples: list[float], tc: float, cuts: list[float]) -> float | None:
    """The first cut some sample lies on the other side of (relative to tc), or None."""
    for c in cuts:
        for t in samples:
            if (t < c) != (tc < c):
                return c
    return None


def check_samples(samples: list[float], tc: float, cuts: list[float]) -> None:
    """Raise CutCrossingError when a sample crosses a cut."""
    if not samples:
        raise CaptureError(f"the page returned no sample times for t={tc}")
    c = crossed_cut(samples, tc, cuts)
    if c is not None:
        raise CutCrossingError(f"subframe samples {samples} for t={tc} cross the hard cut at {c}s")


def average(frames: list[np.ndarray]) -> np.ndarray:
    """Exact mean of uint8 frames, rounded half up, as uint8."""
    if len(frames) == 1:
        return frames[0]
    n = len(frames)
    acc = np.zeros(frames[0].shape, dtype=np.int32)
    for f in frames:
        acc += f
    return ((2 * acc + n) // (2 * n)).astype(np.uint8)


def save_image(arr: np.ndarray, path: str | os.PathLike, fmt: str | None = None, quality: int = 95) -> Path:
    """Write an RGB array to `path` atomically (temp file in the same folder, then rename)."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    kind = (fmt or out.suffix.lstrip(".")).lower()
    kind = {"jpg": "jpeg"}.get(kind, kind)
    tmp = out.with_name(f".{out.name}.tmp-{os.getpid()}")
    try:
        img = Image.fromarray(arr, "RGB")
        if kind == "jpeg":
            img.save(tmp, format="JPEG", quality=quality)
        else:
            img.save(tmp, format="PNG")
        os.replace(tmp, out)
    finally:
        if tmp.exists():
            tmp.unlink()
    return out


class Capture:
    """One headless Chromium page on the project's index.html?render=1."""

    def __init__(
        self,
        root: str | os.PathLike = DEFAULT_ROOT,
        *,
        scale: float = 1.0,
        textonly: bool = False,
        scenes: str | None = None,
        fmt: str = "png",
        jpeg_quality: int = 95,
        timeout: float = 120.0,
        launch_args: tuple[str, ...] = (),
    ) -> None:
        self.root = Path(root).resolve()
        self.scale = float(scale)
        self.textonly = textonly
        self.scenes = scenes
        self.fmt = "jpeg" if fmt in ("jpeg", "jpg") else "png"
        self.jpeg_quality = jpeg_quality
        self.timeout = timeout
        self.launch_args = tuple(launch_args)
        self.console: list[str] = []
        self.blocked: list[str] = []
        self._probes_404: set[str] = set()
        self.info: dict = {}
        self._pw = None
        self._browser = None
        self._page = None
        self._cdp = None

    async def __aenter__(self) -> "Capture":
        await self.open()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    def _page_size(self) -> tuple[int, int]:
        try:
            pipeline = json.loads((self.root / "src/pipeline.json").read_text("utf-8"))
            return int(pipeline["width"]), int(pipeline["height"])
        except (OSError, ValueError, KeyError, TypeError) as err:
            raise CaptureError(f"src/pipeline.json could not be read for the page size ({err})") from err

    async def _serve(self, route) -> None:
        request = route.request
        url = request.url
        if not url.startswith(ORIGIN + "/"):
            self.blocked.append(url)
            await route.abort()
            return
        path = project_file(self.root, url)
        if path is None:
            if request.method == "HEAD":
                self._probes_404.add(url)  # the page probing for an optional file (the audio candidates)
            await route.fulfill(status=404, content_type="text/plain", body="not found")
            return
        # The type follows the requested name (containment was checked on the real target).
        ctype = CONTENT_TYPES.get(Path(unquote(urlsplit(url).path)).suffix.lower(), "application/octet-stream")
        if request.method == "HEAD":
            await route.fulfill(status=200, headers={"content-type": ctype}, body=b"")
        else:
            await route.fulfill(status=200, content_type=ctype, body=path.read_bytes())

    async def open(self) -> dict:
        """Launch Chromium, load the page, wait for ready (or fail with the page's error).

        On any failure (including cancellation) it closes what it started before re-raising, so neither
        `async with` (whose __aexit__ never runs when __aenter__ raises) nor a manual open() leaks Chromium."""
        try:
            return await self._open()
        except BaseException:
            await asyncio.shield(self._close_quietly())
            raise

    async def _close_quietly(self) -> None:
        try:
            await self.close()
        except Exception:  # the original failure is the one worth reporting
            pass

    async def _open(self) -> dict:
        from playwright.async_api import Error as PlaywrightError
        from playwright.async_api import async_playwright

        width, height = self._page_size()
        query = {"render": "1"}
        if self.textonly:
            query["textonly"] = "1"
        if self.scenes:
            query["scenes"] = self.scenes
        url = f"{ORIGIN}/index.html?{urlencode(query)}"
        self._pw = await async_playwright().start()
        try:
            self._browser = await self._pw.chromium.launch(headless=True, args=[*CHROMIUM_FLAGS, *self.launch_args])
        except PlaywrightError as err:
            raise CaptureError(f"Chromium did not start ({str(err).splitlines()[0]}); run pnpm setup:env") from err
        context = await self._browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=self.scale)
        await context.route("**/*", self._serve)
        page = await context.new_page()
        page.on("console", self._on_console)
        page.on("pageerror", lambda e: self.console.append(f"pageerror: {e}"))
        self._page = page
        await page.goto(url, wait_until="load")
        try:
            await page.wait_for_function(
                "() => window.__mv && (window.__mv.ready === true || !!window.__mv.error)", timeout=self.timeout * 1000
            )
        except PlaywrightError as err:
            raise CaptureError(
                f"the page did not become ready within {self.timeout:.0f}s; console: {self.console[-5:] or 'nothing'}"
            ) from err
        state = await page.evaluate(
            """() => ({ready: window.__mv.ready, error: window.__mv.error, fps: window.__mv.fps,
                width: window.__mv.width, height: window.__mv.height, frames: window.__mv.frames,
                duration: window.__mv.duration, warnings: window.__mv.warnings || [],
                audio: window.__mv.audio ?? null, timing: window.__mv.timing ?? null,
                cuts: window.__mv.ready ? window.__mv.cuts() : [],
                blurWindows: window.__mv.ready ? window.__mv.blurWindows() : []})"""
        )
        if state["error"]:
            raise CaptureError(f"page error: {state['error']}")
        if state["width"] != width or state["height"] != height:
            raise CaptureError(f"the page is {state['width']}x{state['height']} but src/pipeline.json says {width}x{height}")
        await page.evaluate("document.fonts.ready")
        await page.add_style_tag(content=NO_MOTION_CSS)
        await page.evaluate("document.getAnimations().forEach(a => a.pause())")
        self._cdp = await context.new_cdp_session(page)
        await self._cdp.send(
            "Emulation.setDeviceMetricsOverride",
            {"width": width, "height": height, "deviceScaleFactor": self.scale, "mobile": False},
        )
        dpr = await page.evaluate("devicePixelRatio")
        if abs(dpr - self.scale) > 1e-9:
            raise CaptureError(f"the page's devicePixelRatio is {dpr}, expected {self.scale}")
        state["scale"] = self.scale
        self.info = state
        return state

    def _on_console(self, m) -> None:
        if m.type not in ("error", "warning"):
            return
        if m.text.startswith("Failed to load resource") and (m.location or {}).get("url") in self._probes_404:
            return  # an absent optional file answered its HEAD probe with 404: expected
        self.console.append(f"{m.type}: {m.text}")

    @property
    def page(self):
        return self._page

    async def samples(self, n: int) -> list[float]:
        """The page's subframe times for frame n, checked against the cuts."""
        if not 0 <= n < self.info["frames"]:
            raise CaptureError(f"frame {n} is outside the video (0..{self.info['frames'] - 1})")
        samples = await self._page.evaluate("n => window.__mv.subframes(n)", n)
        check_samples(samples, n / self.info["fps"], self.info["cuts"])
        return samples

    async def capture_at(self, t: float) -> np.ndarray:
        """Seek to t, wait two rAFs, screenshot: one RGB array."""
        dpr = await self._page.evaluate(
            "t => window.__mv.seek(t).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(devicePixelRatio)))))", t
        )
        if abs(dpr - self.scale) > 1e-9:
            raise CaptureError(f"the page's devicePixelRatio changed to {dpr} (expected {self.scale})")
        params = {
            "format": self.fmt,
            "clip": {"x": 0, "y": 0, "width": self.info["width"], "height": self.info["height"], "scale": 1},
            "captureBeyondViewport": False,
            "fromSurface": True,
        }
        if self.fmt == "jpeg":
            params["quality"] = self.jpeg_quality
        shot = await self._cdp.send("Page.captureScreenshot", params)
        img = Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGB")
        arr = np.asarray(img)
        want = (round(self.info["height"] * self.scale), round(self.info["width"] * self.scale), 3)
        if arr.shape != want:
            raise CaptureError(f"screenshot is {arr.shape[1]}x{arr.shape[0]}, expected {want[1]}x{want[0]}")
        return arr

    async def frame(self, n: int) -> np.ndarray:
        """Frame n: the average of the captures at subframes(n)."""
        samples = await self.samples(n)
        return average([await self.capture_at(t) for t in samples])

    async def close(self) -> None:
        """Close Chromium and Playwright (safe to call twice)."""
        browser, pw = self._browser, self._pw
        self._browser = self._pw = self._page = self._cdp = None
        try:
            if browser is not None:
                await browser.close()
        finally:
            if pw is not None:
                await pw.stop()


def run(main) -> int:
    """Run `main()` (a coroutine function) so SIGINT/SIGTERM cancel it and its
    cleanup still runs. Returns the exit code: main's int (default 0), 130 / 143
    after a signal, 1 after a CaptureError (printed)."""
    got: list[int] = []

    async def runner():
        loop = asyncio.get_running_loop()
        task = asyncio.current_task()

        def on_signal(sig):
            got.append(sig)
            task.cancel()

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, on_signal, sig)
        return await main()

    try:
        result = asyncio.run(runner())
    except asyncio.CancelledError:
        print(f"capture: interrupted ({signal.Signals(got[0]).name if got else 'cancelled'})", file=sys.stderr)
        return 130 if got and got[0] == signal.SIGINT else 143
    except CaptureError as err:
        print(f"capture: {err}", file=sys.stderr)
        return 1
    except Exception as err:  # a page-side failure (e.g. a scene's draw threw) arrives as a Playwright Error
        from playwright.async_api import Error as PlaywrightError

        if not isinstance(err, PlaywrightError):
            raise
        print(f"capture: {str(err).splitlines()[0]}", file=sys.stderr)
        return 1
    return int(result or 0)


def _parse_frames(args) -> list[int]:
    frames = list(args.frame or [])
    if args.frames:
        for part in args.frames.split(","):
            part = part.strip()
            if "-" in part[1:]:
                a, b = part.split("-", 1)
                frames.extend(range(int(a), int(b) + 1))
            elif part:
                frames.append(int(part))
    return frames


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="capture.py", description="Capture frames of the music-video page.")
    p.add_argument("--root", default=str(DEFAULT_ROOT), help="project root (default: this project)")
    p.add_argument("--scale", type=float, default=1.0, help="device scale factor (default 1)")
    p.add_argument("--textonly", action="store_true", help="lyric layer only, on black")
    p.add_argument("--scenes", help="alternate scene registry module (project-relative path)")
    p.add_argument("--format", choices=["png", "jpeg"], default="png")
    p.add_argument("--frame", type=int, action="append", help="absolute frame (repeatable)")
    p.add_argument("--frames", help="frames as A,B,C or A-B")
    p.add_argument("--out", help="output image for a single frame")
    p.add_argument("--out-dir", help="output folder: frame-<n>.<ext> per frame")
    p.add_argument("--info", action="store_true", help="print the page info as JSON and capture nothing")
    p.add_argument("--json", action="store_true", help="print a JSON summary on stdout")
    p.add_argument("--chromium-arg", action="append", default=[], help=argparse.SUPPRESS)
    args = p.parse_args(argv)
    frames = _parse_frames(args)
    if not args.info:
        if not frames:
            p.error("give --frame N or --frames A,B / A-B")
        if args.out and len(frames) != 1:
            p.error("--out takes exactly one frame; use --out-dir for several")
        if not args.out and not args.out_dir:
            p.error("give --out FILE or --out-dir DIR")
    ext = "jpg" if args.format == "jpeg" else "png"

    async def go() -> int:
        cap = Capture(args.root, scale=args.scale, textonly=args.textonly, scenes=args.scenes, fmt=args.format,
                      launch_args=tuple(args.chromium_arg))
        written: list[str] = []
        try:
            info = await cap.open()
            for w in info.get("warnings", []):
                print(f"capture: warning: {w}", file=sys.stderr)
            if not args.info:
                for n in frames:
                    arr = await cap.frame(n)
                    out = Path(args.out) if args.out else Path(args.out_dir) / f"frame-{n:06d}.{ext}"
                    save_image(arr, out, args.format)
                    written.append(str(out))
        finally:
            await cap.close()
        errors = [c for c in cap.console if not c.startswith("warning: music-video:")]
        for c in errors:
            print(f"capture: console {c}", file=sys.stderr)
        if args.json or args.info:
            print(json.dumps({"info": cap.info, "written": written, "console": cap.console, "blocked": cap.blocked}))
        return 0

    return run(go)


if __name__ == "__main__":
    sys.exit(main())
