from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader

try:
    from .dataset import build_datasets, load_labels
    from .model import build_model, get_model_input_shape
except ImportError:
    from dataset import build_datasets, load_labels
    from model import build_model, get_model_input_shape


ML_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    def positive_int(value: str, flag_name: str) -> int:
        parsed = int(value)
        if parsed <= 0:
            raise argparse.ArgumentTypeError(f'{flag_name} must be greater than 0')
        return parsed

    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-path', default=str(ML_DIR / 'data' / 'processed' / 'manifest.jsonl'))
    parser.add_argument('--labels-path', default=str(ML_DIR / 'labels.json'))
    parser.add_argument('--artifact-dir', default=str(ML_DIR / 'artifacts'))
    parser.add_argument('--epochs', type=lambda value: positive_int(value, 'epochs'), default=5)
    parser.add_argument('--batch-size', type=lambda value: positive_int(value, 'batch-size'), default=32)
    return parser.parse_args()


def save_checkpoint(
    checkpoint_path: Path,
    model: nn.Module,
    epoch: int,
    val_accuracy: float,
    labels: list[str],
    label_count: int,
    input_shape: tuple[int, int, int],
) -> None:
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            'model_state': model.state_dict(),
            'epoch': epoch,
            'val_accuracy': val_accuracy,
            'label_count': label_count,
            'labels': labels,
            'input_shape': input_shape,
        },
        checkpoint_path,
    )


def main() -> int:
    args = parse_args()

    datasets = build_datasets(args.manifest_path, args.labels_path)
    train_dataset = datasets['train']
    val_dataset = datasets['val']
    if len(train_dataset) == 0:
        raise ValueError('train split must not be empty')
    if len(val_dataset) == 0:
        raise ValueError('val split must not be empty')

    labels = load_labels(args.labels_path)
    label_count = len(labels)
    model = build_model(label_count)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size, shuffle=False)

    artifact_dir = Path(args.artifact_dir)
    checkpoints_dir = artifact_dir / 'checkpoints'
    metrics_dir = artifact_dir / 'metrics'
    input_shape = get_model_input_shape()
    history: list[dict[str, float | int]] = []
    best_val_accuracy = float('-inf')

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        total_examples = 0
        for inputs, targets in train_loader:
            optimizer.zero_grad()
            logits = model(inputs)
            loss = loss_fn(logits, targets)
            loss.backward()
            optimizer.step()

            batch_size = targets.size(0)
            total_loss += loss.item() * batch_size
            total_examples += batch_size

        model.eval()
        correct = 0
        val_examples = 0
        with torch.no_grad():
            for inputs, targets in val_loader:
                logits = model(inputs)
                predictions = logits.argmax(dim=1)
                correct += int((predictions == targets).sum().item())
                val_examples += targets.size(0)

        train_loss = total_loss / total_examples
        val_accuracy = correct / val_examples
        history.append({'epoch': epoch, 'train_loss': train_loss, 'val_accuracy': val_accuracy})

        last_checkpoint_path = checkpoints_dir / 'last.pt'
        save_checkpoint(last_checkpoint_path, model, epoch, val_accuracy, labels, label_count, input_shape)
        print(f'Saved last checkpoint: {last_checkpoint_path}')

        if val_accuracy >= best_val_accuracy:
            best_val_accuracy = val_accuracy
            best_checkpoint_path = checkpoints_dir / 'best.pt'
            save_checkpoint(best_checkpoint_path, model, epoch, val_accuracy, labels, label_count, input_shape)
            print(f'Saved best checkpoint: {best_checkpoint_path}')

    metrics_dir.mkdir(parents=True, exist_ok=True)
    history_path = metrics_dir / 'train-history.json'
    history_path.write_text(json.dumps({'epochs': history}, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote training history: {history_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
