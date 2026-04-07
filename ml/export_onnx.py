from __future__ import annotations

import argparse
import pickle
import shutil
import sys
from pathlib import Path

import torch

try:
    from .dataset import load_labels
    from .model import build_model, get_model_input_shape
except ImportError:
    from dataset import load_labels
    from model import build_model, get_model_input_shape


ML_DIR = Path(__file__).resolve().parent
ROOT_DIR = ML_DIR.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-dir', default=str(ML_DIR / 'artifacts'))
    parser.add_argument('--checkpoint-path')
    parser.add_argument('--labels-path', default=str(ML_DIR / 'labels.json'))
    parser.add_argument('--output-path')
    parser.add_argument('--runtime-labels-path')
    return parser.parse_args()


def load_export_checkpoint(checkpoint_path: Path) -> dict[str, object]:
    checkpoint = torch.load(checkpoint_path, map_location='cpu')
    if not isinstance(checkpoint, dict):
        raise ValueError('checkpoint must deserialize to a mapping')
    required_keys = {'labels', 'label_count', 'model_state'}
    missing_keys = required_keys - checkpoint.keys()
    if missing_keys:
        raise ValueError(f"checkpoint is missing required fields: {', '.join(sorted(missing_keys))}")
    return checkpoint


def main() -> int:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir)

    checkpoint_path = Path(args.checkpoint_path) if args.checkpoint_path else artifact_dir / 'checkpoints' / 'best.pt'
    labels_path = Path(args.labels_path)
    output_path = Path(args.output_path) if args.output_path else ROOT_DIR / 'public' / 'models' / 'kana-classifier.onnx'
    runtime_labels_path = (
        Path(args.runtime_labels_path) if args.runtime_labels_path else ROOT_DIR / 'public' / 'models' / 'kana-labels.json'
    )

    if not checkpoint_path.exists():
        raise FileNotFoundError(f'checkpoint not found: {checkpoint_path}')

    labels = load_labels(labels_path)
    checkpoint = load_export_checkpoint(checkpoint_path)
    checkpoint_labels = list(checkpoint['labels'])
    if labels != checkpoint_labels:
        raise ValueError('labels file must match checkpoint labels ordering')

    model = build_model(int(checkpoint['label_count']))
    model.load_state_dict(checkpoint['model_state'])
    model.eval()

    input_shape = tuple(checkpoint.get('input_shape', get_model_input_shape()))
    if input_shape != get_model_input_shape():
        raise ValueError('checkpoint input shape must match runtime input contract')

    output_path.parent.mkdir(parents=True, exist_ok=True)
    dummy_input = torch.zeros((1, *input_shape), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        input_names=['input'],
        output_names=['logits'],
        dynamo=True,
        opset_version=18,
    )

    runtime_labels_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(labels_path, runtime_labels_path)

    print(f'Wrote ONNX model: {output_path}')
    print(f'Copied runtime labels: {runtime_labels_path}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (EOFError, FileNotFoundError, pickle.UnpicklingError, RuntimeError, ValueError, TypeError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
