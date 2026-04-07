import { describe, expect, it } from 'vitest';
import { rasterizeNormalizedStrokes } from '../src/model-preprocess.js';

describe('model preprocess', () => {
  it('creates a 48x48 raster tensor from normalized strokes', () => {
    const raster = rasterizeNormalizedStrokes([
      [
        [0.1, 0.1],
        [0.9, 0.9]
      ]
    ]);

    expect(raster).toHaveLength(48 * 48);
    expect(raster.some((value) => value > 0)).toBe(true);
  });
});
