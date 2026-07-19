import { describe, expect, it } from 'vitest';
import {
  FEATURE_CHANNELS,
  FEATURE_GRID,
  extractFeatures,
  normalizeStrokes,
  resampleStroke
} from '../src/write/recognizer-features.js';
import { glyphStrokes } from '../src/write/stroke-engine.js';

const SIZE = FEATURE_GRID * FEATURE_GRID;

function channelSum(tensor, channel) {
  let sum = 0;
  for (let index = 0; index < SIZE; index += 1) {
    sum += tensor[channel * SIZE + index];
  }
  return sum;
}

describe('normalizeStrokes', () => {
  it('centers and scales into the unit box preserving aspect', () => {
    const strokes = [
      [
        [100, 200],
        [300, 200]
      ]
    ];
    const [line] = normalizeStrokes(strokes);
    expect(line[0]).toEqual([0, 0.5]);
    expect(line[1]).toEqual([1, 0.5]);
  });

  it('keeps aspect for tall drawings', () => {
    const strokes = [
      [
        [10, 0],
        [10, 100],
        [30, 100]
      ]
    ];
    const [path] = normalizeStrokes(strokes);
    // height 100 dominates: width 20 maps to 0.2 around the center
    expect(path[0][0]).toBeCloseTo(0.4, 9);
    expect(path[2][0]).toBeCloseTo(0.6, 9);
    expect(path[0][1]).toBeCloseTo(0, 9);
    expect(path[1][1]).toBeCloseTo(1, 9);
  });
});

describe('resampleStroke', () => {
  it('emits equidistant points at the canonical step', () => {
    const points = resampleStroke(
      [
        [0, 0],
        [0.1, 0]
      ],
      0.02
    );
    expect(points.length).toBe(6);
    expect(points[1][0]).toBeCloseTo(0.02, 9);
    expect(points[5][0]).toBeCloseTo(0.1, 9);
  });
});

describe('extractFeatures', () => {
  it('returns a max-normalized tensor of the right shape', () => {
    const tensor = extractFeatures(glyphStrokes('あ'));
    expect(tensor.length).toBe(FEATURE_CHANNELS * SIZE);
    expect(Math.max(...tensor)).toBeCloseTo(1, 5);
  });

  it('is invariant to translation and uniform scale', () => {
    const strokes = glyphStrokes('木');
    const moved = strokes.map((stroke) =>
      stroke.map(([x, y]) => [x * 320 + 41, y * 320 + 97])
    );
    const a = extractFeatures(strokes);
    const b = extractFeatures(moved);
    for (let index = 0; index < a.length; index += 1) {
      expect(Math.abs(a[index] - b[index])).toBeLessThan(1e-4);
    }
  });

  it('activates the right direction channels', () => {
    // bin 0 = rightward, bin 2 = downward (y grows down), bin 4 = leftward
    const rightward = extractFeatures([
      [
        [0, 0.5],
        [1, 0.5]
      ]
    ]);
    expect(channelSum(rightward, 0)).toBeGreaterThan(0);
    expect(channelSum(rightward, 2)).toBe(0);
    expect(channelSum(rightward, 4)).toBe(0);

    const downward = extractFeatures([
      [
        [0.5, 0],
        [0.5, 1]
      ]
    ]);
    expect(channelSum(downward, 2)).toBeGreaterThan(0);
    expect(channelSum(downward, 0)).toBe(0);

    const leftward = extractFeatures([
      [
        [1, 0.5],
        [0, 0.5]
      ]
    ]);
    expect(channelSum(leftward, 4)).toBeGreaterThan(0);
    expect(channelSum(leftward, 0)).toBe(0);
  });

  it('distinguishes stroke direction (シ vs ツ energy layout differs)', () => {
    const shi = extractFeatures(glyphStrokes('シ'));
    const tsu = extractFeatures(glyphStrokes('ツ'));
    let difference = 0;
    for (let index = 0; index < shi.length; index += 1) {
      difference += Math.abs(shi[index] - tsu[index]);
    }
    expect(difference).toBeGreaterThan(5);
  });

  it('records stroke endpoints in the last channel', () => {
    const tensor = extractFeatures([
      [
        [0, 0],
        [1, 1]
      ]
    ]);
    expect(channelSum(tensor, 8)).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const tensor = extractFeatures([]);
    expect(tensor.every((value) => value === 0)).toBe(true);
  });
});
