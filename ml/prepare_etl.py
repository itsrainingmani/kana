from __future__ import annotations

import argparse
import csv
import json
import subprocess
import zipfile
from hashlib import sha256
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / 'data' / 'raw'
PROCESSED_DIR = ROOT / 'data' / 'processed'
UNPACK_DIR = ROOT / 'data' / 'tools' / 'unpack_etlcdb'
DEFAULT_MANIFEST_PATH = PROCESSED_DIR / 'manifest.jsonl'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('--downloads-dir', default=str(Path.home() / 'Downloads' / 'etl'))
    parser.add_argument('--labels-path', default=str(ROOT / 'labels.json'))
    parser.add_argument('--manifest-path', default=str(DEFAULT_MANIFEST_PATH))
    return parser.parse_args()


def ensure_dirs() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    UNPACK_DIR.parent.mkdir(parents=True, exist_ok=True)


def extract_unpack_utility(downloads_dir: Path) -> Path:
    archive = downloads_dir / 'unpack_etlcdb.zip'
    if not archive.exists():
        raise FileNotFoundError(f'missing unpack utility: {archive}')

    if not UNPACK_DIR.exists():
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(UNPACK_DIR.parent)

    return UNPACK_DIR / 'unpack.py'


def unpack_archives(downloads_dir: Path, unpack_script: Path) -> list[Path]:
    archives = sorted(path for path in downloads_dir.glob('ETL*.zip') if path.is_file())
    unpacked_dirs = []

    for archive in archives:
        target_dir = RAW_DIR / archive.stem
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(target_dir)

        for candidate in sorted(target_dir.rglob('ETL*_*')):
            if candidate.is_file() and '_unpack' not in candidate.name:
                subprocess.run(['python', str(unpack_script), str(candidate)], check=True, cwd=UNPACK_DIR)
                unpacked = candidate.parent / f'{candidate.name}_unpack'
                if unpacked.exists():
                    unpacked_dirs.append(unpacked)

    return unpacked_dirs


def load_labels(labels_path: str | Path) -> list[dict[str, str]]:
    path = Path(labels_path)
    text = path.read_text(encoding='utf-8').strip()
    if not text:
        return []
    if path.suffix != '.json':
        return [{'id': line.strip(), 'glyph': line.strip()} for line in text.splitlines() if line.strip()]

    data = json.loads(text)
    if data and isinstance(data[0], dict):
        return [{'id': str(label['id']), 'glyph': str(label['glyph'])} for label in data]
    return [{'id': str(label), 'glyph': str(label)} for label in data]


def stable_split(sample_key: str) -> str:
    bucket = int(sha256(sample_key.encode('utf-8')).hexdigest()[:8], 16) % 100
    if bucket < 80:
        return 'train'
    if bucket < 90:
        return 'validation'
    return 'test'


def build_manifest(
    unpacked_dirs: list[Path],
    labels: list[dict[str, str]],
    manifest_path: str | Path | None = None,
) -> tuple[Path, int]:
    label_lookup = {
        label['glyph']: {'id': label['id'], 'label_index': index}
        for index, label in enumerate(labels)
    }
    output_path = Path(manifest_path) if manifest_path is not None else DEFAULT_MANIFEST_PATH
    rows = []

    for unpacked_dir in unpacked_dirs:
        csv_files = list(unpacked_dir.glob('*.csv'))
        if not csv_files:
            continue

        csv_path = csv_files[0]
        source_archive = unpacked_dir.parent.name
        with csv_path.open(encoding='utf-8', newline='') as handle:
            reader = csv.DictReader(handle)
            for index, row in enumerate(reader):
                glyph = row.get('char') or row.get('jisx0208') or row.get('jisx0201') or row.get('char_u')
                label = label_lookup.get(str(glyph))
                if not label:
                    continue

                image_path = unpacked_dir / f'{index:05d}.png'
                if not image_path.exists():
                    continue

                sample_key = f'{source_archive}:{csv_path.name}:{index}:{glyph}'
                rows.append(
                    {
                        'glyph': glyph,
                        'label_id': label['id'],
                        'label_index': label['label_index'],
                        'image_path': str(image_path),
                        'source_archive': source_archive,
                        'split': stable_split(sample_key),
                    }
                )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        '\n'.join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + ('\n' if rows else ''),
        encoding='utf-8',
    )
    return output_path, len(rows)


def main() -> int:
    args = parse_args()
    downloads_dir = Path(args.downloads_dir).expanduser().resolve()
    ensure_dirs()
    unpack_script = extract_unpack_utility(downloads_dir)
    unpacked_dirs = unpack_archives(downloads_dir, unpack_script)
    manifest_path, row_count = build_manifest(unpacked_dirs, load_labels(args.labels_path), args.manifest_path)
    print(f'prepared manifest: {manifest_path} ({row_count} rows)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
