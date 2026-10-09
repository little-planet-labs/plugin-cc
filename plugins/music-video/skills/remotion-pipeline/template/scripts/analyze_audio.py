"""Beat / onset / energy analysis for the music video.

Invoked by scripts/analyze.mjs (`pnpm analyze`), which decodes the track with
ffmpeg to a mono WAV first, so this script only ever reads plain PCM WAV.

Output schema (version 1) is mirrored by src/lib/analysis-schema.ts; keep the two
in sync.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

import librosa
import numpy as np

SAMPLE_RATE = 22050
ONSET_HOP = 512  # standard librosa hop for onset/beat tracking (~23ms)
BEATS_PER_BAR = 4  # assumption: 4/4, which nearly all pop / Suno output uses

# Frequency bands for the per-frame energy envelope, in Hz.
BANDS: dict[str, tuple[float, float]] = {
    "low": (20.0, 250.0),
    "mid": (250.0, 4000.0),
    "high": (4000.0, SAMPLE_RATE / 2),
}

# Dynamic range mapped onto 0..1 for each band, in dB below the band's 99th
# percentile. Quieter than that floor reads as 0.
ENERGY_RANGE_DB = 48.0

# Silence added at both ends before onset/beat tracking so a hit at t=0 still
# registers (spectral flux has nothing to diff against on the very first frame).
# Reported times are shifted back by this amount.
EDGE_PAD_SECONDS = 0.5

# Leading/trailing beats whose onset strength is below this fraction of the
# median beat's are dropped (beats extrapolated into a silent intro/outro).
EDGE_BEAT_MIN_STRENGTH = 0.1


def r3(values) -> list[float]:
    return [round(float(v), 3) for v in values]


def band_energy(y: np.ndarray, fps: int, n_frames: int) -> dict[str, list[float]]:
    """Per-video-frame normalized energy for each band (0..1)."""
    hop = SAMPLE_RATE / fps
    if hop != int(hop):
        raise SystemExit(f"fps {fps} must divide the {SAMPLE_RATE} Hz sample rate evenly")
    hop = int(hop)
    # center=True puts STFT column i at time i * hop / sr == video frame i.
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop, center=True)) ** 2
    freqs = librosa.fft_frequencies(sr=SAMPLE_RATE, n_fft=2048)

    out: dict[str, list[float]] = {}
    for name, (lo_hz, hi_hz) in BANDS.items():
        mask = (freqs >= lo_hz) & (freqs < hi_hz)
        power = spec[mask].sum(axis=0)
        db = 10.0 * np.log10(power + 1e-10)
        top = float(np.percentile(db, 99))
        floor = top - ENERGY_RANGE_DB
        if not math.isfinite(top) or top <= -95.0:  # effectively silent band
            norm = np.zeros_like(db)
        else:
            norm = np.clip((db - floor) / ENERGY_RANGE_DB, 0.0, 1.0)
        # Exactly one value per video frame: pad with 0 (silence) or trim.
        if norm.shape[0] < n_frames:
            norm = np.pad(norm, (0, n_frames - norm.shape[0]))
        out[name] = r3(norm[:n_frames])
    return out


def trim_weak_edge_beats(onset_env: np.ndarray, beat_frames: np.ndarray) -> np.ndarray:
    if len(beat_frames) == 0:
        return beat_frames
    strengths = onset_env[np.clip(beat_frames, 0, len(onset_env) - 1)]
    threshold = EDGE_BEAT_MIN_STRENGTH * float(np.median(strengths))
    strong = np.flatnonzero(strengths >= threshold)
    if len(strong) == 0:
        return beat_frames[:0]
    return beat_frames[strong[0] : strong[-1] + 1]


def estimate_downbeats(y: np.ndarray, beat_frames: np.ndarray) -> int:
    """Pick which of the first BEATS_PER_BAR beats is the bar's downbeat.

    librosa has no downbeat tracker. Heuristic: the downbeat phase is the one
    whose beats carry the most low-frequency onset strength (kick drums land on
    1 far more than on 2/3/4). Returns the index of the first downbeat in
    `beat_frames`.
    """
    if len(beat_frames) < BEATS_PER_BAR * 2:
        return 0
    low_onset = librosa.onset.onset_strength(
        y=y, sr=SAMPLE_RATE, hop_length=ONSET_HOP, fmax=250.0, n_mels=32
    )
    idx = np.clip(beat_frames, 0, len(low_onset) - 1)
    strengths = low_onset[idx]
    scores = [float(strengths[k::BEATS_PER_BAR].mean()) for k in range(BEATS_PER_BAR)]
    return int(np.argmax(scores))


def analyze(wav_path: str, source: str, fps: int) -> dict:
    y, _ = librosa.load(wav_path, sr=SAMPLE_RATE, mono=True)
    duration = float(len(y)) / SAMPLE_RATE
    if duration <= 0:
        raise SystemExit("decoded audio is empty")
    n_frames = int(math.ceil(duration * fps - 1e-9))

    # Pad both ends with silence so hits at the very start/end register, and
    # run the tracker untrimmed; weak edge beats are trimmed below instead.
    # (librosa's own trim=True dropped a real beat at t=0 on a click track.)
    pad = np.zeros(int(EDGE_PAD_SECONDS * SAMPLE_RATE), dtype=y.dtype)
    y_padded = np.concatenate([pad, y, pad])

    onset_env = librosa.onset.onset_strength(y=y_padded, sr=SAMPLE_RATE, hop_length=ONSET_HOP)
    global_tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=SAMPLE_RATE, hop_length=ONSET_HOP, trim=False, units="frames"
    )
    beat_frames = trim_weak_edge_beats(onset_env, beat_frames)
    beat_times = librosa.frames_to_time(beat_frames, sr=SAMPLE_RATE, hop_length=ONSET_HOP) - EDGE_PAD_SECONDS
    keep = (beat_times >= 0) & (beat_times < duration)
    beat_frames, beat_times = beat_frames[keep], beat_times[keep]

    # librosa's global tempo is quantized to its tempogram bins (~117.5 / 123 BPM
    # around 120 at this hop), and single intervals jitter by one hop (~23ms).
    # Average the intervals near the median one (skips dropped/doubled beats).
    tempo = float(np.atleast_1d(global_tempo)[0])
    if len(beat_times) >= 4:
        intervals = np.diff(beat_times)
        typical = float(np.median(intervals))
        steady = intervals[np.abs(intervals - typical) <= 0.25 * typical]
        tempo = 60.0 / float(steady.mean())

    first_down = estimate_downbeats(y_padded, beat_frames)
    downbeat_times = beat_times[first_down::BEATS_PER_BAR]

    onset_times = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=SAMPLE_RATE, hop_length=ONSET_HOP, units="time"
    ) - EDGE_PAD_SECONDS
    onset_times = onset_times[(onset_times >= 0) & (onset_times < duration)]

    return {
        "version": 1,
        "source": source,
        "generator": f"librosa {librosa.__version__}",
        "fps": fps,
        "durationSeconds": round(duration, 3),
        "durationInFrames": n_frames,
        "tempo": round(tempo, 2),
        "beatsPerBar": BEATS_PER_BAR,
        "beats": r3(beat_times),
        "downbeats": r3(downbeat_times),
        "onsets": r3(onset_times),
        "bands": {name: [lo, hi] for name, (lo, hi) in BANDS.items()},
        "energy": band_energy(y, fps, n_frames),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav")
    parser.add_argument("--source", required=True, help="path relative to public/, e.g. audio/track.wav")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    result = analyze(args.wav, args.source, args.fps)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"))
        f.write("\n")
    print(
        f"duration {result['durationSeconds']}s, {result['durationInFrames']} frames, "
        f"tempo {result['tempo']} BPM, {len(result['beats'])} beats, "
        f"{len(result['downbeats'])} downbeats, {len(result['onsets'])} onsets",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
