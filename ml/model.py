from __future__ import annotations

from torch import nn


def get_model_input_shape() -> tuple[int, int, int]:
    return (1, 48, 48)


class KanaClassifier(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 16, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 16, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.classifier = nn.Linear(64, num_classes)

    def forward(self, inputs):
        return self.classifier(self.features(inputs).flatten(1))


def build_model(label_count: int) -> KanaClassifier:
    if label_count <= 0:
        raise ValueError('label_count must be positive')
    return KanaClassifier(label_count)
