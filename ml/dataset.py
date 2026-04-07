from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms


ROOT = Path(__file__).resolve().parent
IMAGE_SIZE = 48


def load_label_records(labels_path: str | Path | None = None) -> list[dict[str, str]]:
    path = Path(labels_path) if labels_path is not None else ROOT / 'labels.json'
    text = path.read_text(encoding='utf-8').strip()
    if not text:
        return []

    if path.suffix != '.json':
        return [{'id': line.strip(), 'glyph': line.strip()} for line in text.splitlines() if line.strip()]

    data = json.loads(text)
    if data and isinstance(data[0], dict):
        return [
            {
                'id': str(label['id']),
                'glyph': str(label['glyph']),
                'romaji': str(label.get('romaji', '')),
                'script': str(label.get('script', '')),
                'group': str(label.get('group', '')),
            }
            for label in data
        ]
    return [{'id': str(label), 'glyph': str(label)} for label in data]


def load_labels(labels_path: str | Path | None = None) -> list[str]:
    return [label['id'] for label in load_label_records(labels_path)]


def build_label_index(labels: list[str]) -> dict[str, int]:
    return {label: index for index, label in enumerate(labels)}


def label_count(path: str | Path | None = None) -> int:
    return len(load_labels(path))


def get_input_shape() -> tuple[int, int, int]:
    return (1, IMAGE_SIZE, IMAGE_SIZE)


def build_base_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Grayscale(num_output_channels=1),
            transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
            transforms.ToTensor(),
        ]
    )


def build_train_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.RandomAffine(degrees=5, translate=(0.02, 0.02), scale=(0.98, 1.02), fill=255),
            *build_base_transform().transforms,
        ]
    )


def load_manifest(manifest_path: str | Path) -> list[dict[str, object]]:
    path = Path(manifest_path)
    if not path.exists():
        return []

    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


class KanaImageDataset(Dataset):
    def __init__(
        self,
        rows: list[dict[str, object]],
        transform: transforms.Compose | None = None,
        image_root: str | Path | None = None,
    ) -> None:
        self.rows = rows
        self.transform = transform or build_base_transform()
        self.image_root = Path(image_root) if image_root is not None else None

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        image_path = Path(str(row['image_path']))
        if not image_path.is_absolute() and self.image_root is not None:
            image_path = self.image_root / image_path

        with Image.open(image_path) as image:
            tensor = self.transform(image.convert('L'))
        return tensor, int(row['label_index'])


def build_datasets(
    manifest_path: str | Path,
    labels_path: str | Path | None = None,
) -> dict[str, KanaImageDataset]:
    manifest = Path(manifest_path)
    rows = load_manifest(manifest)

    if labels_path is not None:
        labels = load_labels(labels_path)
        label_index = build_label_index(labels)
        for row in rows:
            row['label_index'] = label_index[str(row['label_id'])]

    split_rows = {'train': [], 'val': [], 'test': []}
    for row in rows:
        split = row['split']
        if split == 'validation':
            split = 'val'
        if split not in split_rows:
            raise ValueError(f'unsupported split: {split}')
        split_rows[split].append(row)

    return {
        'train': KanaImageDataset(split_rows['train'], transform=build_train_transform(), image_root=manifest.parent),
        'val': KanaImageDataset(split_rows['val'], transform=build_base_transform(), image_root=manifest.parent),
        'test': KanaImageDataset(split_rows['test'], transform=build_base_transform(), image_root=manifest.parent),
    }
