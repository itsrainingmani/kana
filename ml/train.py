"""Trains the write-mode character recognizer.

A deliberately small CNN over 9x24x24 direction-feature tensors (see
features.py). The exported int8 model must stay lightweight (~100 KB), so
capacity comes from the feature engineering, not the network.

Usage: .venv/bin/python train.py [--epochs 34] [--batch 256] [--arch kwnet1]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent
GENERATED = ROOT / "data" / "generated"
ARTIFACTS = ROOT / "artifacts"


def build_model(arch: str, classes: int) -> nn.Module:
    if arch == "kwnet1":
        return nn.Sequential(
            nn.Conv2d(9, 24, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(24, 48, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(48, 96, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(96, 128, 1), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1), nn.Flatten(),
            nn.Linear(128, classes),
        )
    if arch == "kwnet2":
        return nn.Sequential(
            nn.Conv2d(9, 24, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(24, 48, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(48, 96, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(96, 64, 1), nn.ReLU(),
            nn.Flatten(),
            nn.Linear(64 * 3 * 3, classes),
        )
    raise ValueError(f"unknown arch {arch}")


class FeatureDataset(torch.utils.data.Dataset):
    def __init__(self, x: np.ndarray, y: np.ndarray, noise: float = 0.0):
        self.x = x
        self.y = y
        self.noise = noise

    def __len__(self) -> int:
        return len(self.y)

    def __getitem__(self, index: int):
        features = torch.from_numpy(self.x[index].astype(np.float32)) / 255.0
        if self.noise > 0:
            features = (features + torch.randn_like(features) * self.noise).clamp_(0, 1.5)
        return features, int(self.y[index])


@torch.no_grad()
def evaluate(model: nn.Module, loader) -> float:
    model.eval()
    correct = 0
    total = 0
    for features, targets in loader:
        predictions = model(features).argmax(dim=1)
        correct += int((predictions == targets).sum())
        total += len(targets)
    return correct / max(total, 1)


@torch.no_grad()
def top_confusions(model: nn.Module, loader, labels: list[str], k: int = 12):
    model.eval()
    pairs: dict[tuple[int, int], int] = {}
    for features, targets in loader:
        predictions = model(features).argmax(dim=1)
        for t, p in zip(targets.tolist(), predictions.tolist()):
            if t != p:
                pairs[(t, p)] = pairs.get((t, p), 0) + 1
    ranked = sorted(pairs.items(), key=lambda item: -item[1])[:k]
    return [(labels[t], labels[p], n) for (t, p), n in ranked]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=34)
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--arch", default="kwnet1")
    parser.add_argument("--patience", type=int, default=6)
    args = parser.parse_args()

    torch.manual_seed(7)
    torch.set_num_threads(4)

    meta = json.loads((GENERATED / "labels.json").read_text())
    labels = meta["labels"]

    x_train = np.load(GENERATED / "x_train.npy", mmap_mode="r")
    y_train = np.load(GENERATED / "y_train.npy")
    x_val = np.load(GENERATED / "x_val.npy", mmap_mode="r")
    y_val = np.load(GENERATED / "y_val.npy")
    x_stress = np.load(GENERATED / "x_stress.npy", mmap_mode="r")
    y_stress = np.load(GENERATED / "y_stress.npy")

    train_loader = torch.utils.data.DataLoader(
        FeatureDataset(x_train, y_train, noise=0.01),
        batch_size=args.batch,
        shuffle=True,
        num_workers=2,
        persistent_workers=True,
    )
    val_loader = torch.utils.data.DataLoader(
        FeatureDataset(x_val, y_val), batch_size=512, num_workers=0
    )
    stress_loader = torch.utils.data.DataLoader(
        FeatureDataset(x_stress, y_stress), batch_size=512, num_workers=0
    )

    model = build_model(args.arch, len(labels))
    params = sum(p.numel() for p in model.parameters())
    print(f"arch={args.arch} params={params} classes={len(labels)}", flush=True)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    ARTIFACTS.mkdir(exist_ok=True)
    best_acc = 0.0
    stale = 0
    history = []

    for epoch in range(args.epochs):
        model.train()
        running_loss = 0.0
        batches = 0
        for features, targets in train_loader:
            optimizer.zero_grad()
            loss = criterion(model(features), targets)
            loss.backward()
            optimizer.step()
            running_loss += float(loss)
            batches += 1
        scheduler.step()

        val_acc = evaluate(model, val_loader)
        history.append({"epoch": epoch, "loss": running_loss / batches, "val_acc": val_acc})
        marker = ""
        if val_acc > best_acc:
            best_acc = val_acc
            stale = 0
            torch.save(
                {"arch": args.arch, "labels": labels, "state_dict": model.state_dict()},
                ARTIFACTS / f"{args.arch}.pt",
            )
            marker = " *"
        else:
            stale += 1
        print(
            f"epoch {epoch:02d} loss {running_loss / batches:.4f} val {val_acc * 100:.2f}%{marker}",
            flush=True,
        )
        if stale >= args.patience:
            print("early stop", flush=True)
            break

    checkpoint = torch.load(ARTIFACTS / f"{args.arch}.pt", weights_only=True)
    model.load_state_dict(checkpoint["state_dict"])
    stress_acc = evaluate(model, stress_loader)
    print(f"best val {best_acc * 100:.2f}% | stress {stress_acc * 100:.2f}%", flush=True)
    print("top confusions (val):", flush=True)
    for expected, predicted, count in top_confusions(model, val_loader, labels):
        print(f"  {expected} -> {predicted}: {count}", flush=True)

    (ARTIFACTS / f"{args.arch}-history.json").write_text(
        json.dumps({"best_val": best_acc, "stress": stress_acc, "history": history})
    )


if __name__ == "__main__":
    main()
