"""Forced alignment of the known lyrics to public/audio/track.(wav|mp3).

Reads creative/lyrics.screen.txt (Suno-style [Section] tags plus lines, in
SCREEN spellings) and, when present, creative/lyrics.suno.txt (the same lines
in SUNG spellings, used only for the acoustic model). Writes:
  src/data/lyrics.json     line + word timings, screen spellings, ids <section>-<n>
  src/data/sections.json   section boundaries (sung sections + instrumentals)
and diagnostics to creative/alignment/:
  transcript.json       free ASR transcript of the vocal stem (what was sung)
  verification.json     cross-checks (onsets, vocal energy, second model, mix vs
                        stem) and possible unlisted lyrics
  align-words.json      per sung word: CTC and TDT starts, which one was used

Pipeline (all models run locally through onnxruntime, downloaded once from the
k2-fsa/sherpa-onnx GitHub releases into .cache/models/ by `pnpm setup:align`):
  1. ffmpeg decodes the track (gapless: MP3 encoder delay removed, same as
     `pnpm analyze`), 44.1 kHz stereo.
  2. UVR-MDX-NET-Voc_FT (via sherpa-onnx) separates the vocal stem.
  3. NeMo parakeet-tdt-0.6b-v2 transcribes the stem in windows cut at the
     quietest vocal moments (record of what was sung, and an independent
     timing reference).
  4. The CTC head of NeMo parakeet-tdt_ctc-110m gives per-frame token
     log-probs (80 ms frames); a CTC Viterbi forced alignment places the
     KNOWN sung text. The encoder runs at four 20 ms sub-frame offsets and the
     four alignments are averaged, for ~20 ms effective resolution.
  5. Starts: CTC and TDT, each bias-corrected (see `calibrate`), averaged where
     they agree; CTC alone otherwise.
  6. Word ends: the next word's start inside a phrase; at a phrase end, the
     end of the sung note holding the last word (pYIN pitch continuity), capped.
  7. Sections: each tagged lyric section starts on the downbeat nearest its
     first word (or just before a pickup). A gap of INSTRUMENTAL_MIN_GAP
     seconds or more without vocals becomes an `instrumental` section.

Run through pnpm (`pnpm setup:align` once, then `pnpm align`), or directly:
  .venv-align/bin/python scripts/align_lyrics.py               align
  .venv-align/bin/python scripts/align_lyrics.py fetch-models  download models only
  .venv-align/bin/python scripts/align_lyrics.py calibrate     re-measure the timing bias (macOS `say`)
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache"
# Keep every library cache inside the project (nothing in ~/.cache).
for _var, _sub in (("HF_HOME", "hf"), ("TORCH_HOME", "torch"), ("XDG_CACHE_HOME", "xdg"), ("NUMBA_CACHE_DIR", "numba")):
    os.environ.setdefault(_var, str(CACHE / _sub))

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import sherpa_onnx  # noqa: E402
import soundfile as sf  # noqa: E402
from lyric_sections import (  # noqa: E402
    INSTRUMENTAL_MIN_GAP,
    acoustic_words,
    assign_ids,
    build_sections,
    log,
    lyric_lines,
    parse_lyrics,
    r3,
    unlisted_lyrics,
)

MODELS = CACHE / "models"
WORK = CACHE / "align"
DATA = ROOT / "src" / "data"
REPORT = ROOT / "creative" / "alignment"
SCREEN_LYRICS = ROOT / "creative" / "lyrics.screen.txt"
SUNG_LYRICS = ROOT / "creative" / "lyrics.suno.txt"
BRIEF = ROOT / "creative" / "brief.json"
RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
UVR_MODEL = MODELS / "UVR-MDX-NET-Voc_FT.onnx"
CTC_DIR = MODELS / "sherpa-onnx-nemo-parakeet_tdt_ctc_110m-en-36000-int8"
TDT_DIR = MODELS / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"

SR = 16000
CTC_FRAME = 0.08  # subsampling factor 8 x 10 ms hop
SHIFTS = (0.0, 0.02, 0.04, 0.06)
THREADS = 8
# Timing calibration, measured by `align_lyrics.py calibrate`: on synthetic
# speech with exactly known word onsets, CTC start minus truth had a median of
# +0.07 s and TDT start minus truth a median of -0.03 s (clean and with a
# backing track mixed in). Speech, not singing: the bias on sung vowels is
# inferred, not measured.
CTC_LAG = 0.07
TDT_LAG = -0.03
# Above this CTC/TDT disagreement the TDT match is treated as suspect and CTC
# (which is constrained to the known text) is used alone.
FUSE_MAX = 0.35

# A word ending a phrase may hold at most this long past its last CTC token.
MAX_HOLD = 2.5
# Inside a line, a silence at least this long splits phrases (the word before
# it gets a voicing-based end instead of running up to the next word).
PHRASE_GAP = 0.45
# Note-following thresholds for phrase ends (see Pitch.note_end).
NOTE_JUMP = 1.0
NOTE_DROP_DB = 10.0
# Shortest span given to a phrase-final word (still never past the next word).
MIN_FINAL_WORD = 0.25

# Free-transcript windows: about this long, cut at the quietest vocal moment
# within +-WINDOW_SEARCH seconds, overlapping by WINDOW_OVERLAP.
WINDOW_TARGET = 15.0
WINDOW_SEARCH = 4.0
WINDOW_OVERLAP = 1.0


# ---------------------------------------------------------------- lyrics text

def pronunciation_map() -> dict[str, str]:
    """brief.json pronunciation {screen, sung}, as a lowercase word map (used
    only when there's no lyrics.suno.txt)."""
    try:
        p = json.loads(BRIEF.read_text(encoding="utf8"))["pronunciation"]
        screen, sung = str(p["screen"]).strip(), str(p["sung"]).strip()
    except (OSError, KeyError, TypeError, ValueError):
        return {}
    return {screen.lower(): sung} if screen and sung and screen.lower() != sung.lower() else {}


def sung_tokens(screen_sections: list[dict]) -> list[list[list[str]]]:
    """Per section, per line: the SUNG token for each screen token.

    From creative/lyrics.suno.txt when it has the same sections and lines and
    the line has the same number of tokens; otherwise the screen token, with
    brief.json's pronunciation applied."""
    pron = pronunciation_map()

    def fallback(text: str) -> list[str]:
        out = []
        for tok in text.split(" "):
            core = re.sub(r"[^A-Za-z']", "", tok).lower()
            out.append(pron.get(core, tok))
        return out

    sung = parse_lyrics(SUNG_LYRICS.read_text(encoding="utf8")) if SUNG_LYRICS.exists() else None
    if sung is not None:
        shape = lambda secs: [len(s["lines"]) for s in secs]  # noqa: E731
        if shape(sung) != shape(screen_sections):
            log(f"{SUNG_LYRICS.relative_to(ROOT)} has different sections/lines than the screen lyrics; ignoring it")
            sung = None
    out = []
    for si, sec in enumerate(screen_sections):
        lines = []
        for li, text in enumerate(sec["lines"]):
            tokens = text.split(" ")
            if sung is not None:
                alt = sung[si]["lines"][li].split(" ")
                if len(alt) == len(tokens):
                    lines.append(alt)
                    continue
                log(f"sung line {sung[si]['lines'][li]!r} has a different word count than {text!r}; using the screen spelling")
            lines.append(fallback(text))
        out.append(lines)
    return out


# ---------------------------------------------------------------- setup steps


def models_ready() -> bool:
    return UVR_MODEL.exists() and all((d / "tokens.txt").exists() for d in (CTC_DIR, TDT_DIR))


def ensure_models() -> None:
    """Download the three models into .cache/models (once). Each archive is
    extracted into a temp dir next to its target and renamed into place, then
    deleted, so a failed or interrupted setup never leaves a half-extracted
    model; a partial download (.part) is kept and resumed next time."""
    MODELS.mkdir(parents=True, exist_ok=True)
    if not UVR_MODEL.exists():
        fetch(f"{RELEASES}/source-separation-models/{UVR_MODEL.name}", UVR_MODEL)
    for d in (CTC_DIR, TDT_DIR):
        if (d / "tokens.txt").exists():
            continue
        tarball = MODELS / f"{d.name}.tar.bz2"
        if not tarball.exists():
            fetch(f"{RELEASES}/asr-models/{tarball.name}", tarball)
        staging = Path(tempfile.mkdtemp(prefix=".extract-", dir=MODELS))
        try:
            log(f"extracting {tarball.name}")
            subprocess.run(["tar", "xjf", str(tarball), "-C", str(staging)], check=True)
            if d.exists():
                shutil.rmtree(d)
            (staging / d.name).rename(d)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        tarball.unlink()
    # Archives left by older setups (or a manual download) are redundant once extracted.
    if models_ready():
        for leftover in [MODELS / "dl", *MODELS.glob("*.tar.bz2")]:
            if leftover.is_dir():
                shutil.rmtree(leftover, ignore_errors=True)
            elif leftover.exists():
                leftover.unlink()


def fetch(url: str, dest: Path) -> None:
    log(f"downloading {url}")
    part = dest.with_name(dest.name + ".part")
    for _ in range(6):  # resume on stalls
        r = subprocess.run(["curl", "-fsSL", "--speed-limit", "20000", "--speed-time", "30", "-C", "-", "-o", str(part), url])
        if r.returncode == 0:
            part.rename(dest)
            return
    raise SystemExit(f"download failed: {url} (partial download kept at {part.relative_to(ROOT)}; re-run to resume)")


def find_track() -> Path:
    pipeline = json.loads((ROOT / "src" / "pipeline.json").read_text())
    found = [ROOT / "public" / p for p in pipeline["audioCandidates"] if (ROOT / "public" / p).exists()]
    if len(found) != 1:
        raise SystemExit(f"expected exactly one track, found {found}")
    return found[0]


def decode(track: Path) -> Path:
    wav = WORK / "track.wav"
    if not wav.exists() or wav.stat().st_mtime < track.stat().st_mtime:
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", str(track), "-ar", "44100", "-ac", "2", str(wav)], check=True)
    return wav


def separate(wav: Path) -> Path:
    vocals = WORK / "vocals.wav"
    if vocals.exists() and vocals.stat().st_mtime >= wav.stat().st_mtime:
        return vocals
    log("separating vocals (UVR-MDX-NET-Voc_FT), ~1 min")
    x, sr = sf.read(wav, dtype="float32", always_2d=True)
    cfg = sherpa_onnx.OfflineSourceSeparationConfig(
        model=sherpa_onnx.OfflineSourceSeparationModelConfig(
            uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(model=str(UVR_MODEL)), num_threads=THREADS
        )
    )
    out = sherpa_onnx.OfflineSourceSeparation(cfg).process(sr, np.ascontiguousarray(x.T))
    # stems[0] is the vocal stem for this model: it is the one that transcribes
    # to the lyrics (checked by transcript.json; stems[1] is the backing track).
    sf.write(vocals, np.asarray(out.stems[0].data).T, out.sample_rate)
    sf.write(WORK / "instrumental.wav", np.asarray(out.stems[1].data).T, out.sample_rate)
    return vocals


# ---------------------------------------------------------------- ASR transcript

def transcript_windows(y: np.ndarray) -> list[tuple[float, float]]:
    """Windows for the free transcript, ~WINDOW_TARGET s long, each cut at the
    quietest moment of the vocal stem within +-WINDOW_SEARCH s (so a sung
    phrase rarely straddles an edge), overlapping by WINDOW_OVERLAP s."""
    hop = 0.05
    dur = len(y) / SR
    rms = librosa.feature.rms(y=y, frame_length=int(0.2 * SR), hop_length=int(hop * SR))[0]
    level = np.convolve(rms, np.ones(5) / 5, mode="same")
    cuts = [0.0]
    while dur - cuts[-1] > WINDOW_TARGET + WINDOW_SEARCH:
        lo = int((cuts[-1] + WINDOW_TARGET - WINDOW_SEARCH) / hop)
        hi = int((cuts[-1] + WINDOW_TARGET + WINDOW_SEARCH) / hop)
        cuts.append(round((lo + int(np.argmin(level[lo:hi]))) * hop, 3))
    cuts.append(round(dur, 3))
    return [(max(0.0, a - (WINDOW_OVERLAP if k else 0.0)), b) for k, (a, b) in enumerate(zip(cuts, cuts[1:]))]


def transcribe(y: np.ndarray) -> list[dict]:
    d = TDT_DIR
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"), joiner=str(d / "joiner.int8.onnx"),
        tokens=str(d / "tokens.txt"), model_type="nemo_transducer", num_threads=THREADS,
    )
    out = []
    for a, b in transcript_windows(y):
        s = rec.create_stream()
        s.accept_waveform(SR, y[int(a * SR) : int(b * SR)])
        rec.decode_stream(s)
        r = s.result
        words: list[dict] = []
        for tok, t in zip(r.tokens, r.timestamps):
            if tok.startswith(" ") or not words:
                words.append({"text": tok.strip(), "start": round(a + t, 3)})
            else:
                words[-1]["text"] += tok
        out.append({"window": [round(a, 3), round(b, 3)], "text": r.text.strip(), "words": words})
    return out


def asr_word_list(transcript: list[dict]) -> list[tuple[str, float]]:
    """Flat (normalized word, start) list; where windows overlap, each window
    owns the words before the overlap's midpoint, so nothing is counted twice."""
    out = []
    for i, seg in enumerate(transcript):
        lo = -np.inf if i == 0 else (seg["window"][0] + transcript[i - 1]["window"][1]) / 2
        hi = np.inf if i + 1 == len(transcript) else (transcript[i + 1]["window"][0] + seg["window"][1]) / 2
        for w in seg["words"]:
            if lo <= w["start"] < hi:
                n = re.sub(r"[^a-z']", "", w["text"].lower())
                if n:
                    out.append((n, w["start"]))
    return out


def word_similarity(known: str, heard: str) -> float:
    return difflib.SequenceMatcher(a=known, b=heard).ratio()


def match_asr(words: list[str], asr: list[tuple[str, float]]) -> list[int | None]:
    """Needleman-Wunsch word alignment of the known words to the ASR words.
    Returns, per known word, the index of its ASR match (similarity >= 0.5) or None."""
    n, m = len(words), len(asr)
    GAP = -0.4
    score = np.zeros((n + 1, m + 1))
    score[:, 0] = GAP * np.arange(n + 1)
    score[0, :] = GAP * np.arange(m + 1)
    sim = np.array([[word_similarity(w, a) for a, _ in asr] for w in words])
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            score[i, j] = max(score[i - 1, j - 1] + sim[i - 1, j - 1] * 2 - 1, score[i - 1, j] + GAP, score[i, j - 1] + GAP)
    out: list[int | None] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        if np.isclose(score[i, j], score[i - 1, j - 1] + sim[i - 1, j - 1] * 2 - 1):
            if sim[i - 1, j - 1] >= 0.5:
                out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif np.isclose(score[i, j], score[i - 1, j] + GAP):
            i -= 1
        else:
            j -= 1
    return out


def fuse(
    words: list[str], times: np.ndarray, asr: list[tuple[str, float]]
) -> tuple[np.ndarray, list[dict], list[int | None]]:
    """Calibrated word starts: mean of the CTC and TDT estimates where the TDT
    transcript has the word (and they agree within FUSE_MAX), else CTC alone.
    Returns new (start, token_end) rows, a per-word record, and the TDT match
    of each known word (index into `asr`, or None)."""
    match = match_asr(words, asr)
    out = times.copy()
    out[:, 0] -= CTC_LAG
    out[:, 1] -= CTC_LAG
    rec = []
    for i, w in enumerate(words):
        ctc = out[i, 0]
        j = match[i]
        tdt = asr[j][1] - TDT_LAG if j is not None else None
        used = "ctc"
        if tdt is not None and abs(ctc - tdt) <= FUSE_MAX:
            out[i, 0] = (ctc + tdt) / 2
            used = "mean"
        rec.append({"word": w, "ctc": r3(ctc), "tdt": None if tdt is None else r3(tdt), "heard": None if j is None else asr[j][0],
                    "delta": None if tdt is None else r3(ctc - tdt), "used": used, "start": r3(out[i, 0])})
    # keep word starts strictly ascending (a fused start must not pass a neighbour)
    for i in range(1, len(out)):
        if out[i, 0] <= out[i - 1, 0] + 0.04:
            out[i, 0] = out[i - 1, 0] + 0.04
            rec[i]["start"] = r3(out[i, 0])
            rec[i]["used"] += "+order"
    out[:, 1] = np.maximum(out[:, 1], out[:, 0] + 0.04)
    return out, rec, match


# ---------------------------------------------------------------- CTC alignment

_MEL = librosa.filters.mel(sr=SR, n_fft=512, n_mels=80, fmin=0, fmax=SR / 2, norm="slaney", htk=False)


def nemo_features(y: np.ndarray) -> np.ndarray:
    """NeMo AudioToMelSpectrogramPreprocessor equivalent (per_feature norm).

    Checked against sherpa-onnx's own front end: greedy decoding of the model's
    test wavs is identical.
    """
    y = np.append(y[0], y[1:] - 0.97 * y[:-1]).astype(np.float32)
    s = np.abs(librosa.stft(y, n_fft=512, hop_length=160, win_length=400, window="hann", center=True, pad_mode="constant")) ** 2
    f = np.log(_MEL @ s + 2.0**-24)
    f = (f - f.mean(1, keepdims=True)) / (f.std(1, keepdims=True) + 1e-5)
    return f.astype(np.float32)


class Ctc:
    def __init__(self) -> None:
        self.sess = ort.InferenceSession(str(CTC_DIR / "model.int8.onnx"))
        self.vocab = [ln.rsplit(" ", 1)[0] for ln in (CTC_DIR / "tokens.txt").read_text(encoding="utf8").splitlines()]
        self.blank = len(self.vocab) - 1
        assert self.vocab[self.blank] == "<blk>"
        # Case-insensitive token classes: a target piece scores the log-sum of
        # every vocab entry with the same lowercase spelling (the model is
        # cased + punctuated; the sung text has no meaningful case).
        self.classes: dict[str, list[int]] = {}
        for i, t in enumerate(self.vocab[: self.blank]):
            if t == "<unk>":
                continue
            self.classes.setdefault(t.lower(), []).append(i)
        # Punctuation tokens can't appear in the target, so their mass joins blank.
        self.blankish = [self.blank] + [i for i, t in enumerate(self.vocab) if t.strip("▁") and not re.search(r"[A-Za-z0-9]", t) and t.strip("▁") != "'"]

    def tokenize(self, word: str) -> list[str]:
        """Greedy longest-match segmentation into vocab pieces. The first piece
        carries the word-start marker ▁; when no ▁-piece starts the word (e.g.
        "zen"), a bare ▁ is emitted and the word continues unmarked."""
        pieces: list[str] = []
        i, need_mark = 0, True
        while i < len(word):
            for k in range(len(word), i, -1):
                cand = ("▁" if need_mark else "") + word[i:k]
                if cand in self.classes:
                    pieces.append(cand)
                    i, need_mark = k, False
                    break
            else:
                if need_mark and "▁" in self.classes:  # bare word-boundary marker
                    pieces.append("▁")
                    need_mark = False
                    continue
                raise SystemExit(f"cannot tokenize {word!r}")
        return pieces

    def logprobs(self, y: np.ndarray, window: float = 24.0, hop: float = 16.0) -> np.ndarray:
        """(frames, vocab) log-probs over the whole signal, stitched from
        overlapping windows (each frame taken from the window it is most central in)."""
        n = int(np.ceil(len(y) / SR / CTC_FRAME))
        out = np.zeros((n, len(self.vocab)), dtype=np.float32)
        best = np.full(n, np.inf)
        start = 0.0
        dur = len(y) / SR
        while True:
            seg = y[int(start * SR) : int(min(start + window, dur) * SR)]
            f = nemo_features(seg)[None]
            lp = self.sess.run(None, {"audio_signal": f, "length": np.array([f.shape[2]], dtype=np.int64)})[0][0]
            f0 = int(round(start / CTC_FRAME))
            centre = (len(lp) - 1) / 2
            for j in range(len(lp)):
                g = f0 + j
                if g < n and abs(j - centre) < best[g]:
                    best[g] = abs(j - centre)
                    out[g] = lp[j]
            if start + window >= dur:
                break
            start += hop
        return out

    def align(self, lp: np.ndarray, pieces: list[str]) -> list[tuple[int, int]]:
        """CTC Viterbi forced alignment. Returns (first_frame, last_frame) per piece."""
        T = len(lp)
        em_blank = np.logaddexp.reduce(lp[:, self.blankish], axis=1)
        em_tok = np.stack([np.logaddexp.reduce(lp[:, self.classes[p.lower()]], axis=1) for p in pieces], axis=1)
        L = len(pieces)
        S = 2 * L + 1
        # emission matrix over extended states: even = blank, odd = piece
        em = np.empty((T, S), dtype=np.float64)
        em[:, 0::2] = em_blank[:, None]
        em[:, 1::2] = em_tok
        skip_ok = np.zeros(S, dtype=bool)
        for s in range(3, S, 2):
            skip_ok[s] = pieces[(s - 1) // 2].lower() != pieces[(s - 3) // 2].lower()
        NEG = -1e30
        dp = np.full(S, NEG)
        dp[0] = em[0, 0]
        dp[1] = em[0, 1]
        back = np.zeros((T, S), dtype=np.int8)
        for t in range(1, T):
            stay = dp
            step = np.concatenate(([NEG], dp[:-1]))
            skip = np.concatenate(([NEG, NEG], dp[:-2]))
            skip = np.where(skip_ok, skip, NEG)
            cand = np.stack([stay, step, skip])
            arg = cand.argmax(0)
            dp = cand[arg, np.arange(S)] + em[t]
            back[t] = arg
        s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
        path = np.empty(T, dtype=np.int64)
        for t in range(T - 1, -1, -1):
            path[t] = s
            s -= int(back[t, s])
        spans: list[list[int]] = [[-1, -1] for _ in range(L)]
        for t, s in enumerate(path):
            if s % 2 == 1:
                k = (s - 1) // 2
                if spans[k][0] < 0:
                    spans[k][0] = t
                spans[k][1] = t
        assert all(a >= 0 for a, _ in spans), "alignment dropped a token"
        return [(a, b) for a, b in spans]


def align_text(ctc: Ctc, y: np.ndarray, words: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """Per align-word (start, token_end) in seconds, averaged over sub-frame shifts."""
    pieces: list[str] = []
    owner: list[int] = []
    for wi, w in enumerate(words):
        for p in ctc.tokenize(w):
            pieces.append(p)
            owner.append(wi)
    runs = []
    for sh in SHIFTS:
        ys = np.concatenate([np.zeros(int(round(sh * SR)), dtype=np.float32), y])
        spans = ctc.align(ctc.logprobs(ys), pieces)
        res = np.zeros((len(words), 2))
        res[:, 0] = np.inf
        for (a, b), wi in zip(spans, owner):
            res[wi, 0] = min(res[wi, 0], a * CTC_FRAME - sh)
            res[wi, 1] = max(res[wi, 1], (b + 1) * CTC_FRAME - sh)
        runs.append(res)
    return np.mean(runs, axis=0), np.ptp(np.stack(runs), axis=0)


# ---------------------------------------------------------------- word ends


class Pitch:
    """pYIN f0 (semitones) and RMS level (dB) of the vocal stem, 16 ms hop."""

    HOP = 256

    def __init__(self, y: np.ndarray) -> None:
        cache = WORK / "pitch.npz"
        if cache.exists() and cache.stat().st_mtime >= (WORK / "vocals.wav").stat().st_mtime:
            z = np.load(cache)
            f0, db = z["f0"], z["db"]
        else:
            log("pYIN pitch tracking on the vocal stem, ~1 min")
            f0, _, _ = librosa.pyin(y, fmin=80, fmax=1000, sr=SR, frame_length=1024, hop_length=self.HOP)
            rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=self.HOP)[0]
            db = 20 * np.log10(rms + 1e-9)
            np.savez(cache, f0=f0, db=db)
        self.semi = 12 * np.log2(f0 / 110.0)  # NaN where unvoiced
        self.db = db
        self.hop = self.HOP / SR

    def note_end(self, start: float, tok_end: float, limit: float) -> float:
        """End of a phrase-final word: follow the sung note that starts at the
        word's last token until its pitch jumps (> NOTE_JUMP semitones between
        frames), voicing drops out for > 60 ms, or the level falls NOTE_DROP_DB
        under the note's onset level. Capped by MAX_HOLD and `limit`.

        Why pitch continuity rather than plain voicing: the vocal stem keeps a
        voiced synth pad/backing bed between phrases (constant pitch, level
        pumping on the beat), so "still voiced" runs on long after the singer stops.
        """
        cap = min(tok_end + MAX_HOLD, limit)
        n = len(self.semi)
        j = int((tok_end - CTC_FRAME) / self.hop)
        while j < n and j * self.hop < tok_end + 0.2 and np.isnan(self.semi[j]):
            j += 1
        if j >= n or np.isnan(self.semi[j]):
            return float(min(max(tok_end, start + 0.05), cap))
        ref = float(np.max(self.db[j : j + 6]))
        prev = self.semi[j]
        last = j
        k = j + 1
        while k < n and k * self.hop < cap:
            s = self.semi[k]
            if np.isnan(s):
                if (k - last) * self.hop > 0.06:
                    break
            elif abs(s - prev) > NOTE_JUMP or self.db[k] < ref - NOTE_DROP_DB:
                break
            else:
                prev, last = s, k
            k += 1
        end = (last + 1) * self.hop
        # staccato words still get a readable minimum span
        return float(min(max(end, tok_end, start + MIN_FINAL_WORD), cap))


# ---------------------------------------------------------------- main


def build_lines(lines: list[dict], times: np.ndarray, pitch: Pitch, duration: float) -> list[dict]:
    flat: list[tuple[int, int, float, float]] = []  # (line, display word, start, tok_end)
    k = 0
    for li, ln in enumerate(lines):
        for di, (_, ac) in enumerate(ln["units"]):
            seg = times[k : k + len(ac)]
            flat.append((li, di, float(seg[:, 0].min()), float(seg[:, 1].max())))
            k += len(ac)
    assert k == len(times)
    for idx, (li, di, st, te) in enumerate(flat):
        nxt = flat[idx + 1][2] if idx + 1 < len(flat) else duration
        if idx + 1 < len(flat) and flat[idx + 1][0] == li and nxt - te < PHRASE_GAP:
            end = nxt  # legato inside a phrase
        else:
            end = pitch.note_end(st, te, nxt - 0.02)
        flat[idx] = (li, di, st, end)
    out = []
    for li, ln in enumerate(lines):
        ws = [(di, st, en) for (l2, di, st, en) in flat if l2 == li]
        out.append(
            {
                "id": ln["id"],
                "text": ln["text"],
                "start": r3(ws[0][1]),
                "end": r3(ws[-1][2]),
                "words": [{"text": ln["units"][di][0], "start": r3(st), "end": r3(en)} for di, st, en in ws],
            }
        )
    return out


def verify(lines: list[dict], words: list[str], times: np.ndarray, spread: np.ndarray, times_mix: np.ndarray,
           fusion: list[dict], analysis: dict, vocals: np.ndarray, unlisted: list[dict]) -> dict:
    """Independent checks of the final timings (written to verification.json)."""
    deltas = np.array([f["delta"] for f in fusion if f["delta"] is not None])

    # vocal-stem onsets and energy rises
    hop = 160
    v_on = librosa.onset.onset_detect(y=vocals, sr=SR, hop_length=hop, units="time", backtrack=False)
    rms = librosa.feature.rms(y=vocals, frame_length=640, hop_length=hop)[0]
    db = 20 * np.log10(rms + 1e-9)
    rise = np.diff(np.convolve(db, np.ones(3) / 3, mode="same"), prepend=db[0])
    mix_on = np.asarray(analysis["onsets"])

    def nearest(arr: np.ndarray, t: float) -> float:
        return float(arr[np.argmin(np.abs(arr - t))] - t) if len(arr) else float("nan")

    def stat(fn, arr) -> float | None:
        return r3(fn(arr)) if len(arr) else None

    per_line = []
    for ln in lines:
        t = ln["start"]
        i0, i1 = max(0, int((t - 0.25) * SR / hop)), int((t + 0.25) * SR / hop)
        k = i0 + int(np.argmax(rise[i0:i1])) if i1 > i0 else i0
        per_line.append(
            {
                "id": ln["id"],
                "start": t,
                "mixOnsetDelta": r3(nearest(mix_on, t)),
                "vocalOnsetDelta": r3(nearest(v_on, t)),
                "vocalRiseDelta": r3(k * hop / SR - t),
            }
        )
    d_mix = times_mix[:, 0] - times[:, 0]
    summary = {
        "tdtMatchedWords": f"{len(deltas)}/{len(words)}",
        "fusedWords": sum(f["used"].startswith("mean") for f in fusion),
        "calibratedCtcMinusTdtMedian": stat(np.median, deltas),
        "calibratedCtcMinusTdtAbsMedian": stat(np.median, np.abs(deltas)),
        "calibratedCtcMinusTdtAbsP90": stat(lambda a: np.percentile(a, 90), np.abs(deltas)),
        "disagreeOver150ms": [f"{f['word']}@{f['start']}" for f in fusion if f["delta"] is not None and abs(f["delta"]) > 0.15],
        "mixMinusStemMedianAbs": r3(np.median(np.abs(d_mix))),
        "mixMinusStemAbsP90": r3(np.percentile(np.abs(d_mix), 90)),
        "shiftSpreadMedian": r3(np.median(spread[:, 0])),
        "lineStartVocalOnsetMedianAbs": r3(np.nanmedian([abs(p["vocalOnsetDelta"]) for p in per_line])),
        "lineStartMixOnsetMedianAbs": r3(np.nanmedian([abs(p["mixOnsetDelta"]) for p in per_line])),
        "lineStartVocalRiseMedianAbs": r3(np.median([abs(p["vocalRiseDelta"]) for p in per_line])),
        "possibleUnlistedLyrics": len(unlisted),
    }
    return {"summary": summary, "possibleUnlistedLyrics": unlisted, "lineStarts": per_line}


def clamp_to_sections(lines: list[dict], sections: list[dict]) -> None:
    """A held last note never runs past the start of the next section."""
    starts = [sec["start"] for sec in sections]
    for ln in lines:
        nxt = next((t for t in starts if t > ln["start"]), None)
        if nxt is not None and ln["end"] > nxt:
            w = ln["words"][-1]
            ln["end"] = w["end"] = r3(max(nxt, w["start"] + 0.04))


def validate(lines: list[dict], expected: list[dict], sections: list[dict], duration: float) -> None:
    """Contract checks for src/data/lyrics.json and sections.json (the same
    rules src/lib/lyrics-schema.ts and sections.ts enforce); any failure aborts
    before writing."""

    def need(ok: bool, msg: str) -> None:
        if not ok:
            raise SystemExit(f"validation failed: {msg}")

    need([ln["id"] for ln in lines] == [e["id"] for e in expected], "line ids differ from the lyrics")
    need(len({ln["id"] for ln in lines}) == len(lines), "unique line ids")
    prev_end = 0.0
    for ln, e in zip(lines, expected):
        need(set(ln) == {"id", "text", "start", "end", "words"}, f"{ln['id']}: keys")
        need(ln["text"] == e["text"], f"{ln['id']}: text is the screen text")
        need(ln["end"] > ln["start"] >= prev_end, f"{ln['id']}: sorted, non-overlapping, end > start")
        need(" ".join(w["text"] for w in ln["words"]) == ln["text"], f"{ln['id']}: words join to text")
        wprev = ln["start"]
        for w in ln["words"]:
            need(w["end"] > w["start"] >= wprev, f"{ln['id']}/{w['text']}: ascending, non-overlapping")
            need(ln["start"] <= w["start"] and w["end"] <= ln["end"], f"{ln['id']}/{w['text']}: inside line")
            wprev = w["end"]
        prev_end = ln["end"]
    need(prev_end <= duration, "last line ends after the audio")
    need(sections[0]["start"] == 0, "first section starts at 0")
    need(len({s["id"] for s in sections}) == len(sections), "unique section ids")
    for a, b in zip(sections, sections[1:]):
        need(b["start"] > a["start"], f"{b['id']}: sections sorted")
    for sec in sections:
        need(bool(sec["id"]) and bool(sec["scene"]), f"{sec}: id and scene")
        need(set(sec) <= {"id", "scene", "start", "variant"}, f"{sec['id']}: keys")
        need(sec["start"] < duration, f"{sec['id']}: starts before the end of the audio")
    starts = [sec["start"] for sec in sections]
    for ln in lines:  # no line's text is cut by a section boundary
        need(not any(ln["start"] < t < ln["words"][0]["start"] for t in starts), f"{ln['id']}: section boundary inside first word")


def calibrate() -> None:
    """Measure the CTC and TDT word-start bias on synthetic speech (macOS `say`)
    with exactly known onsets, clean and with the song's backing track mixed in
    (needs one `pnpm align` run first, for .cache/align/instrumental.wav)."""
    words = ("every morning the quick brown fox jumps over seven lazy dogs while bright yellow birds sing loud "
             "simple songs about rivers mountains cities people working together building better tools each day "
             "and night").split()
    cal = WORK / "calibration"
    cal.mkdir(parents=True, exist_ok=True)
    clips = []
    for i, w in enumerate(words):
        f = cal / f"w{i:02d}.aiff"
        if not f.exists():
            subprocess.run(["say", "-o", str(f), w], check=True)
        x, _ = librosa.load(f, sr=SR)
        x = x / np.abs(x).max() * 0.5
        nz = np.where(np.abs(x) > 0.02 * np.abs(x).max())[0]
        clips.append(x[nz[0] : nz[-1] + 1])
    d = TDT_DIR
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(d / "encoder.int8.onnx"), decoder=str(d / "decoder.int8.onnx"), joiner=str(d / "joiner.int8.onnx"),
        tokens=str(d / "tokens.txt"), model_type="nemo_transducer", num_threads=THREADS,
    )
    ctc = Ctc()
    inst_path = WORK / "instrumental.wav"
    if not inst_path.exists():
        raise SystemExit("calibrate needs .cache/align/instrumental.wav: run `pnpm align` once first")
    inst, _ = librosa.load(inst_path, sr=SR, offset=20)
    rng = np.random.default_rng(1)
    results = {}
    for bg in (0.0, 0.3):
        sig, truth, t = [np.zeros(SR // 2, np.float32)], [], 0.5
        for x in clips:
            truth.append(t)
            sig.append(x)
            t += len(x) / SR
            gap = int(rng.uniform(0.05, 0.5) * SR)
            sig.append(np.zeros(gap, np.float32))
            t += gap / SR
        y = np.concatenate(sig)
        if bg:
            y = y + bg * inst[: len(y)] / np.abs(inst).max() * 0.5
        y = y.astype(np.float32)
        times, _ = align_text(ctc, y, words)
        dc = times[:, 0] - np.array(truth)
        s = rec.create_stream()
        s.accept_waveform(SR, y)
        rec.decode_stream(s)
        st = [ts for tok, ts in zip(s.result.tokens, s.result.timestamps) if tok.startswith(" ")]
        res = {"ctcMedian": r3(np.median(dc)), "ctcP10": r3(np.percentile(dc, 10)), "ctcP90": r3(np.percentile(dc, 90))}
        if len(st) == len(words):
            dt = np.array(st) - np.array(truth)
            res.update({"tdtMedian": r3(np.median(dt)), "tdtP10": r3(np.percentile(dt, 10)), "tdtP90": r3(np.percentile(dt, 90))})
        results[f"background{bg}"] = res
    print(json.dumps(results, indent=1))


def write_json(path: Path, data: object, indent: int | None = 2) -> None:
    """Write via a temp file in the same directory and rename, so a reader
    never sees a half-written file and a failure leaves the old one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as f:
            f.write(json.dumps(data, indent=indent) + "\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> None:
    if not SCREEN_LYRICS.exists():
        raise SystemExit(f"{SCREEN_LYRICS.relative_to(ROOT)} is missing: write the on-screen lyrics there first")
    if not models_ready():
        raise SystemExit("alignment models missing: run `pnpm setup:align` first")
    analysis = json.loads((DATA / "audio-analysis.json").read_text())
    if analysis.get("source") is None:
        raise SystemExit("src/data/audio-analysis.json is the no-track default: run `pnpm analyze` first")

    lyric_sections = parse_lyrics(SCREEN_LYRICS.read_text(encoding="utf8"))
    assign_ids(lyric_sections)
    expected = lyric_lines(lyric_sections, sung_tokens(lyric_sections))
    if not expected:
        raise SystemExit(f"{SCREEN_LYRICS.relative_to(ROOT)} has no lyric lines")
    words = [w for ln in expected for _, ac in ln["units"] for w in ac]
    log(f"{len(expected)} lines, {len(words)} sung words in {len(lyric_sections)} tagged sections")

    WORK.mkdir(parents=True, exist_ok=True)
    track = find_track()
    wav = decode(track)
    vocals_path = separate(wav)
    vocals, _ = librosa.load(vocals_path, sr=SR)
    mix, _ = librosa.load(wav, sr=SR)
    duration = len(mix) / SR
    if abs(duration - analysis["durationSeconds"]) > 0.05:
        raise SystemExit(f"decoded {duration:.3f}s but audio-analysis.json says {analysis['durationSeconds']}s; re-run pnpm analyze")

    log("transcribing vocal stem (parakeet-tdt-0.6b-v2)")
    transcript = transcribe(vocals)

    ctc = Ctc()
    log("forced alignment on the vocal stem")
    times, spread = align_text(ctc, vocals, words)
    log("forced alignment on the full mix (cross-check)")
    times_mix, _ = align_text(ctc, mix, words)

    asr = asr_word_list(transcript)
    fused, fusion, match = fuse(words, times, asr)
    pitch = Pitch(vocals)
    lines = build_lines(expected, fused, pitch, duration)
    sections = build_sections(lyric_sections, lines, [ln["section"] for ln in expected], analysis, duration)
    clamp_to_sections(lines, sections)

    validate(lines, expected, sections, duration)
    unlisted = unlisted_lyrics(asr, match)
    report = verify(lines, words, times, spread, times_mix, fusion, analysis, vocals, unlisted)
    write_json(REPORT / "verification.json", report, indent=1)
    write_json(REPORT / "transcript.json", transcript)
    write_json(
        REPORT / "align-words.json",
        [
            {**f, "rawCtcStart": r3(t[0]), "rawCtcTokenEnd": r3(t[1]), "shiftSpread": r3(s[0]), "rawMixStart": r3(m[0])}
            for f, t, s, m in zip(fusion, times, spread, times_mix)
        ],
        indent=1,
    )
    write_json(DATA / "lyrics.json", lines)
    write_json(DATA / "sections.json", sections)
    log(f"verification: {json.dumps(report['summary'])}")
    for u in unlisted:
        log(f"possible lyrics not in lyrics.screen.txt at {u['start']}-{u['end']}s: heard {u['heard']!r} (check by ear)")
    log(f"wrote src/data/lyrics.json ({len(lines)} lines), src/data/sections.json ({len(sections)} sections), "
        f"diagnostics in {REPORT.relative_to(ROOT)}/")


def _exit_on_sigterm(signum: int, _frame: object) -> None:
    # SystemExit unwinds through `finally` blocks, so temp files get removed.
    raise SystemExit(128 + signum)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _exit_on_sigterm)
    if sys.argv[1:] == ["calibrate"]:
        ensure_models()
        calibrate()
    elif sys.argv[1:] == ["fetch-models"]:
        ensure_models()
        log(f"models ready in {MODELS.relative_to(ROOT)}")
    elif sys.argv[1:]:
        raise SystemExit("usage: align_lyrics.py [fetch-models | calibrate]")
    else:
        main()
