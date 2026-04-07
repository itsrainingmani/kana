# Kana ML

This directory contains the local training and export pipeline for the kana handwriting classifier.

## Tooling

Use `uv` for dependency management and execution.

## Commands

- `uv sync`
- `uv run python prepare_etl.py --downloads-dir ~/Downloads/etl`
- `uv run python train.py`
- `uv run python eval.py`
- `uv run python export_onnx.py`

## ETL Intake

Download the ETL archives into `~/Downloads/etl`, then run `prepare_etl.py` to:

- unpack the official ETL files with the provided `unpack_etlcdb.zip` utility
- collect metadata and images into `ml/data/raw/`
- filter rows to the non-combination kana labels in `ml/labels.json`
- write a normalized manifest into `ml/data/processed/`

## Artifacts

- checkpoints and metrics are written under `ml/artifacts/`
- exported browser assets land in `public/models/kana-classifier.onnx`
- exported labels land in `public/models/kana-labels.json`

## Runtime Artifacts

- `public/models/kana-classifier.onnx`
- `public/models/kana-labels.json`
