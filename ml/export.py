"""Exports the trained recognizer to the app's binary model format and emits
golden parity vectors for the JS inference engine.

Binary layout of assets/models/kana-writer.bin (all little-endian):

    bytes 0..3    magic "KWM1"
    bytes 4..7    uint32 header JSON byte length H
    bytes 8..8+H  header JSON (utf-8)
    then, for each entry in header.layers with weights, in order:
        int8   weights   (shape as documented per layer type)
        f32    scales    (one per output channel)
        f32    bias      (one per output channel)

Weight shapes: conv k×k = [out, in, k, k] (row-major), linear = [out, in].
Weights are per-output-channel symmetric int8; the JS loader dequantizes to
float32 once at load time.

Usage: .venv/bin/python export.py [--arch kwnet1]
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import torch
from torch import nn

from features import CHANNELS, FEATURE_VERSION, GRID, STEP, extract_features
from synth import TRAIN_CONFIG, synthesize
from train import FeatureDataset, build_model, evaluate

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
GENERATED = ROOT / "data" / "generated"
ARTIFACTS = ROOT / "artifacts"
MODEL_OUT = REPO / "assets" / "models" / "kana-writer.bin"
GOLDEN_OUT = REPO / "tests" / "fixtures" / "write" / "golden.json"

GOLDEN_CHARS = ["あ", "き", "シ", "ツ", "ん", "一", "木", "本", "火", "語"]


def quantize_tensor(weight: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-output-channel symmetric int8 quantization."""
    flat = weight.reshape(weight.shape[0], -1)
    scales = np.abs(flat).max(axis=1) / 127.0
    scales = np.where(scales < 1e-12, 1.0, scales)
    quantized = np.clip(np.round(flat / scales[:, None]), -127, 127).astype(np.int8)
    return quantized.reshape(weight.shape), scales.astype(np.float32)


def dequantized_copy(model: nn.Module) -> nn.Module:
    """Replace weights with their int8-dequantized values (bias untouched)."""
    clone = build_model_from(model)
    clone.load_state_dict(model.state_dict())
    with torch.no_grad():
        for module in clone.modules():
            if isinstance(module, (nn.Conv2d, nn.Linear)):
                weight = module.weight.detach().numpy()
                quantized, scales = quantize_tensor(weight)
                restored = quantized.reshape(quantized.shape[0], -1).astype(np.float32)
                restored *= scales[:, None]
                module.weight.copy_(torch.from_numpy(restored.reshape(weight.shape)))
    return clone


_ARCH = {"value": None, "classes": None}


def build_model_from(model: nn.Module) -> nn.Module:
    return build_model(_ARCH["value"], _ARCH["classes"])


def layer_specs(model: nn.Module) -> list[dict]:
    """Walk the Sequential and emit the JS-facing layer plan."""
    specs = []
    modules = list(model)
    index = 0
    while index < len(modules):
        module = modules[index]
        if isinstance(module, nn.Conv2d):
            spec = {
                "type": "conv",
                "k": module.kernel_size[0],
                "in": module.in_channels,
                "out": module.out_channels,
                "pad": module.padding[0],
                "relu": index + 1 < len(modules) and isinstance(modules[index + 1], nn.ReLU),
            }
            offset = 2 if spec["relu"] else 1
            spec["pool"] = index + offset < len(modules) and isinstance(
                modules[index + offset], nn.MaxPool2d
            )
            specs.append(spec)
        elif isinstance(module, nn.AdaptiveAvgPool2d):
            specs.append({"type": "gap"})
        elif isinstance(module, nn.Linear):
            specs.append({"type": "linear", "in": module.in_features, "out": module.out_features})
        index += 1
    return specs


def export_binary(model: nn.Module, labels: list[str], arch: str, metrics: dict) -> None:
    specs = layer_specs(model)
    header = {
        "format": "KWM1",
        "arch": arch,
        "featureVersion": FEATURE_VERSION,
        "grid": GRID,
        "channels": CHANNELS,
        "step": STEP,
        "labels": labels,
        "layers": specs,
        "metrics": metrics,
    }
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    blobs = [b"KWM1", struct.pack("<I", len(header_bytes)), header_bytes]
    for module in model.modules():
        if isinstance(module, (nn.Conv2d, nn.Linear)):
            weight = module.weight.detach().numpy()
            quantized, scales = quantize_tensor(weight)
            bias = module.bias.detach().numpy().astype(np.float32)
            blobs.append(quantized.tobytes())
            blobs.append(scales.tobytes())
            blobs.append(bias.tobytes())

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = b"".join(blobs)
    MODEL_OUT.write_bytes(payload)
    print(f"{MODEL_OUT.relative_to(REPO)}: {len(payload) / 1024:.1f} KB")


def export_golden(model: nn.Module, labels: list[str], chars: dict) -> None:
    model.eval()
    label_index = {glyph: i for i, glyph in enumerate(labels)}
    samples = []

    for golden_index, glyph in enumerate(GOLDEN_CHARS):
        strokes = [np.asarray(s, dtype=np.float64) for s in chars[glyph]]
        rng = np.random.default_rng([424242, golden_index])
        sample = synthesize(strokes, rng, TRAIN_CONFIG)
        features = extract_features(sample)
        with torch.no_grad():
            logits = model(torch.from_numpy(features[None]))[0].numpy()

        entry = {
            "char": glyph,
            "classIndex": label_index[glyph],
            "strokes": [[[round(float(x), 3), round(float(y), 3)] for x, y in s] for s in sample],
            "logits": [round(float(v), 4) for v in logits],
            "top1": labels[int(np.argmax(logits))],
        }
        if golden_index < 2:
            entry["features"] = [round(float(v), 6) for v in features.flatten()]
        samples.append(entry)

    GOLDEN_OUT.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_OUT.write_text(json.dumps({"labels": labels, "samples": samples}))
    print(f"{GOLDEN_OUT.relative_to(REPO)}: {len(samples)} samples")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", default="kwnet1")
    args = parser.parse_args()

    checkpoint = torch.load(ARTIFACTS / f"{args.arch}.pt", weights_only=True)
    labels = checkpoint["labels"]
    _ARCH["value"] = args.arch
    _ARCH["classes"] = len(labels)

    model = build_model(args.arch, len(labels))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    x_val = np.load(GENERATED / "x_val.npy", mmap_mode="r")
    y_val = np.load(GENERATED / "y_val.npy")
    x_stress = np.load(GENERATED / "x_stress.npy", mmap_mode="r")
    y_stress = np.load(GENERATED / "y_stress.npy")
    val_loader = torch.utils.data.DataLoader(FeatureDataset(x_val, y_val), batch_size=512)
    stress_loader = torch.utils.data.DataLoader(FeatureDataset(x_stress, y_stress), batch_size=512)

    float_val = evaluate(model, val_loader)
    quantized = dequantized_copy(model)
    quant_val = evaluate(quantized, val_loader)
    quant_stress = evaluate(quantized, stress_loader)
    print(
        f"val float {float_val * 100:.2f}% | int8 {quant_val * 100:.2f}% "
        f"| stress int8 {quant_stress * 100:.2f}%"
    )
    if float_val - quant_val > 0.005:
        raise SystemExit("quantization cost more than 0.5% accuracy — refusing to export")

    metrics = {
        "valFloat": round(float_val, 4),
        "valInt8": round(quant_val, 4),
        "stressInt8": round(quant_stress, 4),
    }
    export_binary(model, labels, args.arch, metrics)

    chars = json.loads((ROOT / "data" / "strokes.json").read_text())["chars"]
    export_golden(quantized, labels, chars)


if __name__ == "__main__":
    main()
