"""Pre-generates feature datasets for training/validation/stress-eval.

Reads ml/data/strokes.json (KanjiVG polylines), synthesizes handwriting
samples per class, extracts feature tensors, and writes uint8-quantized
.npy arrays under ml/data/generated/. Every sample is reproducible from
(split, class, index) — no wall-clock or global randomness.

Usage: .venv/bin/python gen_dataset.py [--train 280] [--val 40] [--stress 24]
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
from pathlib import Path

import numpy as np

from features import CHANNELS, FEATURE_VERSION, GRID, extract_features
from synth import STRESS_CONFIG, TRAIN_CONFIG, synthesize

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUT = DATA / "generated"
BASE_SEED = 20260718

SPLITS = {"train": (0, TRAIN_CONFIG), "val": (1, TRAIN_CONFIG), "stress": (2, STRESS_CONFIG)}


def load_chars() -> tuple[list[str], dict[str, list[np.ndarray]]]:
    payload = json.loads((DATA / "strokes.json").read_text())
    chars = payload["chars"]
    labels = sorted(chars.keys(), key=lambda c: ord(c))
    strokes = {
        c: [np.asarray(s, dtype=np.float64) for s in chars[c]] for c in labels
    }
    return labels, strokes


def generate_class(args: tuple[int, str, list[np.ndarray], str, int]) -> np.ndarray:
    class_idx, _glyph, strokes, split, count = args
    split_id, config = SPLITS[split]
    out = np.empty((count, CHANNELS, GRID, GRID), dtype=np.uint8)

    for sample_idx in range(count):
        rng = np.random.default_rng([BASE_SEED, split_id, class_idx, sample_idx])
        sample = synthesize(strokes, rng, config)
        features = extract_features(sample)
        out[sample_idx] = np.round(features * 255.0).astype(np.uint8)

    return out


def build_split(
    split: str, count: int, labels: list[str], strokes: dict[str, list[np.ndarray]]
) -> None:
    jobs = [(i, glyph, strokes[glyph], split, count) for i, glyph in enumerate(labels)]
    x = np.empty((len(labels) * count, CHANNELS, GRID, GRID), dtype=np.uint8)
    y = np.empty(len(labels) * count, dtype=np.int16)

    with mp.Pool(min(4, mp.cpu_count())) as pool:
        for class_idx, block in enumerate(pool.imap(generate_class, jobs, chunksize=4)):
            lo = class_idx * count
            x[lo : lo + count] = block
            y[lo : lo + count] = class_idx
            if (class_idx + 1) % 50 == 0:
                print(f"  {split}: {class_idx + 1}/{len(labels)} classes", flush=True)

    np.save(OUT / f"x_{split}.npy", x)
    np.save(OUT / f"y_{split}.npy", y)
    print(f"{split}: {x.shape} written", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=int, default=280)
    parser.add_argument("--val", type=int, default=40)
    parser.add_argument("--stress", type=int, default=24)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    labels, strokes = load_chars()
    print(f"{len(labels)} classes", flush=True)

    (OUT / "labels.json").write_text(
        json.dumps({"feature_version": FEATURE_VERSION, "labels": labels}, ensure_ascii=False)
    )

    for split, count in (("train", args.train), ("val", args.val), ("stress", args.stress)):
        if count > 0:
            build_split(split, count, labels, strokes)


if __name__ == "__main__":
    main()
