import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRecognizerFromBuffer, softmax } from '../src/write/recognizer.js';

function loadFixtureModel() {
  const bytes = readFileSync('tests/fixtures/write/tiny-model.bin');
  return createRecognizerFromBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

const CASES = JSON.parse(readFileSync('tests/fixtures/write/tiny-model-cases.json', 'utf8'));

describe('recognizer runtime', () => {
  it('parses the KWM1 container', () => {
    const recognizer = loadFixtureModel();
    expect(recognizer.arch).toBe('kwnet1');
    expect(recognizer.labels.length).toBeGreaterThan(0);
    expect(recognizer.indexOfLabel(recognizer.labels[3])).toBe(3);
    expect(recognizer.indexOfLabel('§missing')).toBe(-1);
  });

  it('rejects corrupted payloads', () => {
    const bytes = readFileSync('tests/fixtures/write/tiny-model.bin');
    const truncated = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - 8);
    expect(() => createRecognizerFromBuffer(truncated)).toThrow(/size mismatch/);

    const garbage = new Uint8Array(16).buffer;
    expect(() => createRecognizerFromBuffer(garbage)).toThrow(/magic/);
  });

  it('matches torch logits on the parity fixture', () => {
    const recognizer = loadFixtureModel();

    for (const [caseIndex, testCase] of CASES.cases.entries()) {
      const features = Float32Array.from(testCase.features);
      const logits = recognizer.infer(features);
      expect(logits.length).toBe(testCase.logits.length);

      for (let index = 0; index < logits.length; index += 1) {
        expect(
          Math.abs(logits[index] - testCase.logits[index]),
          `case ${caseIndex} logit ${index}`
        ).toBeLessThan(2e-3);
      }
    }
  });

  it('classify returns ranked labels with probabilities', () => {
    const recognizer = loadFixtureModel();
    const features = Float32Array.from(CASES.cases[0].features);
    const { top } = recognizer.classify(features, 3);

    expect(top).toHaveLength(3);
    expect(top[0].prob).toBeGreaterThanOrEqual(top[1].prob);
    expect(top[1].prob).toBeGreaterThanOrEqual(top[2].prob);
  });

  it('softmax sums to one', () => {
    const probs = softmax(Float32Array.from([1, 2, 3, 4]));
    const sum = probs.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});
