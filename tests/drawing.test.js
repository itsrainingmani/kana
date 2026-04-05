import { describe, expect, it } from 'vitest';
import { gradeStrokeSet, normalizeStrokeSet, renderStrokeOrderSvg } from '../src/drawing.js';

describe('drawing helpers', () => {
  it('normalizes stroke coordinates into 0-1 space', () => {
    const result = normalizeStrokeSet(
      [[{ x: 10, y: 20 }, { x: 50, y: 80 }]],
      { width: 100, height: 100 }
    );

    expect(result[0][0]).toEqual([0.1, 0.2]);
    expect(result[0][1]).toEqual([0.5, 0.8]);
  });

  it('fails the right shape in the wrong order', () => {
    const result = gradeStrokeSet(
      [
        [[0.5, 0.1], [0.5, 0.9]],
        [[0.1, 0.1], [0.9, 0.1]]
      ],
      [
        { points: [[0.1, 0.1], [0.9, 0.1]] },
        { points: [[0.5, 0.1], [0.5, 0.9]] }
      ]
    );

    expect(result.outcome).toBe('order-failure');
  });

  it('renders stroke order SVG markup', () => {
    const svg = renderStrokeOrderSvg([{ points: [[0.1, 0.1], [0.9, 0.1]] }]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('path');
  });
});
