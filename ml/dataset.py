from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_labels(path: Path | None = None):
    label_path = path or ROOT / "labels.json"
    return json.loads(label_path.read_text(encoding="utf-8"))


def label_count(path: Path | None = None) -> int:
    return len(load_labels(path))
