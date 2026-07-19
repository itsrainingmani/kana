"""Builds a tiny parity fixture for the JS inference engine: a randomly
initialized (untrained) kwnet1 exported through the real serialization path,
plus reference logits computed by torch on two deterministic inputs. Lets the
JS conv/pool/linear code be verified independently of training.

Usage: .venv/bin/python make_test_fixture.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import torch

import export as export_mod
from features import CHANNELS, FEATURE_VERSION, GRID, STEP
from train import build_model

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
FIXTURE_DIR = REPO / "tests" / "fixtures" / "write"

LABEL_COUNT = 17  # arbitrary small label space for the fixture


def main() -> None:
    torch.manual_seed(1234)
    labels = [chr(ord("a") + i) for i in range(LABEL_COUNT)]
    model = build_model("kwnet1", LABEL_COUNT)
    model.eval()

    export_mod._ARCH["value"] = "kwnet1"
    export_mod._ARCH["classes"] = LABEL_COUNT
    quantized = export_mod.dequantized_copy(model)
    quantized.eval()

    specs = export_mod.layer_specs(quantized)
    header = {
        "format": "KWM1",
        "arch": "kwnet1",
        "featureVersion": FEATURE_VERSION,
        "grid": GRID,
        "channels": CHANNELS,
        "step": STEP,
        "labels": labels,
        "layers": specs,
        "metrics": None,
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    blobs = [b"KWM1", struct.pack("<I", len(header_bytes)), header_bytes]
    for module in quantized.modules():
        if isinstance(module, (torch.nn.Conv2d, torch.nn.Linear)):
            weight = module.weight.detach().numpy()
            q, scales = export_mod.quantize_tensor(weight)
            blobs.append(q.tobytes())
            blobs.append(scales.tobytes())
            blobs.append(module.bias.detach().numpy().astype(np.float32).tobytes())

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    (FIXTURE_DIR / "tiny-model.bin").write_bytes(b"".join(blobs))

    rng = np.random.default_rng(99)
    cases = []
    for _ in range(2):
        features = rng.uniform(0, 1, size=(CHANNELS, GRID, GRID)).astype(np.float32)
        with torch.no_grad():
            logits = quantized(torch.from_numpy(features[None]))[0].numpy()
        cases.append(
            {
                "features": [round(float(v), 6) for v in features.flatten()],
                "logits": [round(float(v), 5) for v in logits],
            }
        )

    (FIXTURE_DIR / "tiny-model-cases.json").write_text(json.dumps({"cases": cases}))
    print("fixture written")


if __name__ == "__main__":
    main()
