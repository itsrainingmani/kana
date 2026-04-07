from pathlib import Path

import torch

from dataset import label_count
from model import KanaClassifier


def main():
    root = Path(__file__).resolve().parent.parent
    output_path = root / "public" / "models" / "kana-classifier.onnx"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    model = KanaClassifier(label_count())
    model.eval()
    dummy = torch.zeros((1, 1, 48, 48), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        output_path,
        input_names=["input"],
        output_names=["logits"],
        opset_version=17,
    )
    print(f"export scaffold: {output_path}")


if __name__ == "__main__":
    main()
