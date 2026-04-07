from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
UNPACK_DIR = ROOT / "data" / "tools" / "unpack_etlcdb"


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--downloads-dir",
        default=str(Path.home() / "Downloads" / "etl"),
        help="Directory containing manually downloaded ETL archives",
    )
    return parser.parse_args()


def ensure_dirs():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    UNPACK_DIR.parent.mkdir(parents=True, exist_ok=True)


def extract_unpack_utility(downloads_dir: Path) -> Path:
    archive = downloads_dir / "unpack_etlcdb.zip"
    if not archive.exists():
      raise FileNotFoundError(f"Missing unpack utility: {archive}")

    if not UNPACK_DIR.exists():
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(UNPACK_DIR.parent)

    return UNPACK_DIR / "unpack.py"


def unpack_archives(downloads_dir: Path, unpack_script: Path):
    archives = sorted(path for path in downloads_dir.glob("ETL*.zip") if path.is_file())
    unpacked_dirs = []

    for archive in archives:
        target_dir = RAW_DIR / archive.stem
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(target_dir)

        for candidate in sorted(target_dir.rglob("ETL*_*")):
            if candidate.is_file() and "_unpack" not in candidate.name:
                subprocess.run(["python", str(unpack_script), str(candidate)], check=True, cwd=UNPACK_DIR)
                unpacked = candidate.parent / f"{candidate.name}_unpack"
                if unpacked.exists():
                    unpacked_dirs.append(unpacked)

    return unpacked_dirs


def load_labels():
    return json.loads((ROOT / "labels.json").read_text(encoding="utf-8"))


def build_manifest(unpacked_dirs, labels):
    label_glyphs = {label["glyph"] for label in labels}
    manifest_path = PROCESSED_DIR / "manifest.jsonl"
    rows = []

    for unpacked_dir in unpacked_dirs:
        csv_files = list(unpacked_dir.glob("*.csv"))
        if not csv_files:
            continue

        csv_path = csv_files[0]
        with csv_path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for index, row in enumerate(reader):
                glyph = row.get("char") or row.get("jisx0208") or row.get("jisx0201") or row.get("char_u")
                if glyph not in label_glyphs:
                    continue

                image_path = unpacked_dir / f"{index:05d}.png"
                if not image_path.exists():
                    continue

                rows.append({
                    "glyph": glyph,
                    "image": str(image_path),
                    "source_csv": str(csv_path),
                })

    with manifest_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    return manifest_path, len(rows)


def main():
    args = parse_args()
    downloads_dir = Path(args.downloads_dir).expanduser().resolve()
    ensure_dirs()
    unpack_script = extract_unpack_utility(downloads_dir)
    unpacked_dirs = unpack_archives(downloads_dir, unpack_script)
    manifest_path, row_count = build_manifest(unpacked_dirs, load_labels())
    print(f"prepared etl manifest: {manifest_path} ({row_count} rows)")


if __name__ == "__main__":
    main()
