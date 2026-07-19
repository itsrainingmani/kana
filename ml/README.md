# Write-drill recognizer pipeline

Trains the on-device handwriting recognizer for the write drill: a
tiny conv net (~116K params) over stroke direction features, exported
as per-output-channel int8 weights in a single `KWM1` binary that the
app's hand-written JS forward pass consumes (`src/write/recognizer.js`).
No ML runtime ships to the browser.

## Layout

```
features.py        canonical feature spec (mirrored by
                   src/write/recognizer-features.js — golden-vector
                   parity tests enforce equivalence)
synth.py           synthetic handwriting generator (per-stroke jitter,
                   wobble, trim/extend, simplification, global affine)
homoglyphs.py      visually-identical character groups (へ/ヘ, カ/力 …)
gen_dataset.py     pre-generates train/val/stress uint8 feature pools
train.py           CNN training (torch CPU), homoglyph-aware metrics
export.py          int8 quantization + KWM1 export + golden vectors
make_test_fixture.py  random-weights fixture for JS conv parity tests
data/raw/          vendored KanjiVG SVGs + kanji metadata (committed)
data/strokes.json  flattened polylines (committed, canonical input)
data/generated/    feature pools (gitignored)
artifacts/         checkpoints + history (gitignored)
```

## Reproduce

```bash
python3 -m venv .venv
.venv/bin/pip install numpy torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install numpy

.venv/bin/python gen_dataset.py --train 560   # ~15 min on 4 cores
.venv/bin/python train.py --epochs 30         # ~1 h on 4 CPU cores
.venv/bin/python export.py                    # writes assets/models/kana-writer.bin
                                              # + tests/fixtures/write/golden.json
.venv/bin/python make_test_fixture.py         # only when the arch changes
```

Then `npm test` — the parity suite must pass before shipping a new
model. Any change to `features.py` is a breaking model-format change:
bump `FEATURE_VERSION`, mirror it in `recognizer-features.js`, retrain,
re-export.

## Design notes

- **Input**: strokes → unit box (aspect preserved) → equidistant resample
  → 24×24×9 tensor: 8 soft-binned direction channels + stroke-endpoint
  channel, max-normalized. Direction sensitivity is what separates
  シ/ツ and ソ/ン the same way human stroke order does.
- **Data**: no external handwriting corpus — training samples are
  synthesized from the KanjiVG centerlines with geometric augmentation.
  Deterministic seeds per (split, class, index); the val/stress splits
  use disjoint seed streams (stress is deliberately harsher than any
  earnest learner).
- **Homoglyphs**: some codepoint pairs are visually identical at
  handwriting fidelity; they are grouped (see `homoglyphs.py`), the
  groups ship in the model header, and both eval and app grading treat a
  within-group prediction as a hit.
- **Quantization**: per-output-channel symmetric int8 on weights only
  (float32 bias); the export refuses to ship if grouped val accuracy
  drops more than 0.5 % vs float.
