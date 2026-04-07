from pathlib import Path

import torch

from dataset import label_count
from model import KanaClassifier


def main():
    artifact_dir = Path(__file__).resolve().parent / "artifacts"
    artifact_dir.mkdir(exist_ok=True)

    model = KanaClassifier(label_count())
    dummy = torch.zeros((1, 1, 48, 48), dtype=torch.float32)
    logits = model(dummy)
    print(f"training scaffold: {tuple(logits.shape)}")


if __name__ == "__main__":
    main()
