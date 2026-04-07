from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import torch
from torch.utils.data import DataLoader

try:
    from .dataset import build_datasets, load_labels
    from .model import build_model
except ImportError:
    from dataset import build_datasets, load_labels
    from model import build_model


ML_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    def positive_int(value: str) -> int:
        parsed = int(value)
        if parsed <= 0:
            raise argparse.ArgumentTypeError('batch-size must be greater than 0')
        return parsed

    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-path', default=str(ML_DIR / 'data' / 'processed' / 'manifest.jsonl'))
    parser.add_argument('--labels-path', default=str(ML_DIR / 'labels.json'))
    parser.add_argument('--artifact-dir', default=str(ML_DIR / 'artifacts'))
    parser.add_argument('--checkpoint-path', default=str(ML_DIR / 'artifacts' / 'checkpoints' / 'best.pt'))
    parser.add_argument('--batch-size', type=positive_int, default=32)
    return parser.parse_args()


def write_confusion_matrix_csv(output_path: Path, labels: list[str], confusion_matrix: list[list[int]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['actual_label', *labels])
        for label, row in zip(labels, confusion_matrix, strict=True):
            writer.writerow([label, *row])


def main() -> int:
    args = parse_args()

    manifest_path = Path(args.manifest_path)
    checkpoint_path = Path(args.checkpoint_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f'manifest not found: {manifest_path}')
    if not checkpoint_path.exists():
        raise FileNotFoundError(f'checkpoint not found: {checkpoint_path}')

    checkpoint = torch.load(checkpoint_path, map_location='cpu')
    labels = list(checkpoint['labels'])
    current_labels = load_labels(args.labels_path)
    if current_labels != labels:
        raise ValueError('labels file must match checkpoint labels ordering')

    datasets = build_datasets(manifest_path, args.labels_path)
    test_dataset = datasets['test']
    if len(test_dataset) == 0:
        raise ValueError('test split must not be empty')

    model = build_model(len(labels))
    model.load_state_dict(checkpoint['model_state'])
    model.eval()

    test_loader = DataLoader(test_dataset, batch_size=args.batch_size, shuffle=False)
    confusion_matrix = [[0 for _ in labels] for _ in labels]
    per_class_total = [0 for _ in labels]
    per_class_correct = [0 for _ in labels]
    total_correct = 0
    total_examples = 0

    with torch.no_grad():
        for inputs, targets in test_loader:
            predictions = model(inputs).argmax(dim=1)
            for target, prediction in zip(targets.tolist(), predictions.tolist(), strict=True):
                confusion_matrix[target][prediction] += 1
                per_class_total[target] += 1
                if prediction == target:
                    total_correct += 1
                    per_class_correct[target] += 1
                total_examples += 1

    test_accuracy = total_correct / total_examples
    per_class_accuracy = {
        label: (per_class_correct[index] / per_class_total[index] if per_class_total[index] else 0.0)
        for index, label in enumerate(labels)
    }

    metrics_dir = Path(args.artifact_dir) / 'metrics'
    metrics_dir.mkdir(parents=True, exist_ok=True)
    eval_path = metrics_dir / 'eval.json'
    eval_path.write_text(
        json.dumps(
            {
                'test_accuracy': test_accuracy,
                'per_class_accuracy': per_class_accuracy,
                'total_examples': total_examples,
            },
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )
    write_confusion_matrix_csv(metrics_dir / 'confusion-matrix.csv', labels, confusion_matrix)

    print(f'test_accuracy={test_accuracy:.6f}')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
