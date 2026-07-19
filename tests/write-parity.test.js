import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFeatures } from '../src/write/recognizer-features.js';
import { createRecognizerFromBuffer } from '../src/write/recognizer.js';

// End-to-end parity against the Python reference (ml/export.py): synthetic
// handwriting samples → JS feature extraction → JS int8 forward pass must
// reproduce torch's features and logits. This is the contract that lets the
// model be trained in Python but shipped without an ML runtime.

const GOLDEN = JSON.parse(readFileSync('tests/fixtures/write/golden.json', 'utf8'));

function loadShippedModel() {
  const bytes = readFileSync('assets/models/kana-writer.bin');
  return createRecognizerFromBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

describe('python ↔ js parity', () => {
  it('reproduces feature tensors exactly (within float32 rounding)', () => {
    const withFeatures = GOLDEN.samples.filter((sample) => sample.features);
    expect(withFeatures.length).toBeGreaterThan(0);

    for (const sample of withFeatures) {
      const features = extractFeatures(sample.strokes);
      expect(features.length).toBe(sample.features.length);

      let worst = 0;
      for (let index = 0; index < features.length; index += 1) {
        worst = Math.max(worst, Math.abs(features[index] - sample.features[index]));
      }
      // Fixture values are rounded to 1e-6; anything beyond ~2e-6 is real drift.
      expect(worst, `feature drift for ${sample.char}`).toBeLessThan(2e-6);
    }
  });

  it('reproduces model logits on every golden sample', () => {
    const recognizer = loadShippedModel();

    for (const sample of GOLDEN.samples) {
      const logits = recognizer.infer(extractFeatures(sample.strokes));
      expect(logits.length).toBe(sample.logits.length);

      let worst = 0;
      for (let index = 0; index < logits.length; index += 1) {
        worst = Math.max(worst, Math.abs(logits[index] - sample.logits[index]));
      }
      expect(worst, `logit drift for ${sample.char}`).toBeLessThan(0.02);
    }
  });

  it('agrees with torch on the top-1 class for every golden sample', () => {
    const recognizer = loadShippedModel();

    for (const sample of GOLDEN.samples) {
      const { top } = recognizer.classify(extractFeatures(sample.strokes), 1);
      expect(top[0].label, `top-1 for ${sample.char}`).toBe(sample.top1);
    }
  });

  it('shipped model recognizes nearly all golden handwriting samples', () => {
    // Broken-export tripwire, not an accuracy benchmark (that's the val set
    // in ml/train.py): a mislabeled or corrupted model fails this hard,
    // while one genuinely hard sample out of ten must not.
    const recognizer = loadShippedModel();
    expect(recognizer.labels.length).toBeGreaterThan(300);

    const hits = GOLDEN.samples.filter((sample) => sample.top1 === sample.char);
    expect(hits.length).toBeGreaterThanOrEqual(GOLDEN.samples.length - 2);
  });
});
