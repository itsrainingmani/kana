# ML Pipeline

Run these commands from the `ml/` directory.

They use the default pipeline paths under `ml/` and `public/models/`:

- `ml/data/processed/manifest.jsonl`
- `ml/labels.json`
- `ml/artifacts/`
- `public/models/kana-classifier.onnx`
- `public/models/kana-labels.json`

```bash
uv sync
uv run python prepare_etl.py --downloads-dir ~/Downloads/etl
uv run python train.py
uv run python eval.py
uv run python export_onnx.py
```

The ETL intake step expects archives in `~/Downloads/etl` and will unpack the official ETL files into `ml/data/raw/`, filter rows to the supported non-combination kana labels in `ml/labels.json`, and write a normalized manifest to `ml/data/processed/manifest.jsonl`.
