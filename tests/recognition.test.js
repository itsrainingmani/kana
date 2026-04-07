import { describe, expect, it } from 'vitest';
import { gradeSoundToDrawingAttempt } from '../src/recognition.js';
import { __testables } from '../src/recognition-worker.js';

describe('recognition', () => {
  it('exposes worker test helpers for model loading and scoring', () => {
    expect(__testables).toMatchObject({
      topK: expect.any(Function)
    });
  });

  it('marks a recognizable wrong-order drawing as partial', () => {
    const result = gradeSoundToDrawingAttempt({
      recognition: { matches: [{ glyph: 'あ', confidence: 0.9 }] },
      expected: {
        glyph: 'あ',
        romaji: 'a',
        strokes: [
          { points: [[0, 0], [1, 0]] },
          { points: [[0, 0], [0, 1]] }
        ]
      },
      strokes: [
        [[0, 0], [0, 1]],
        [[0, 0], [1, 0]]
      ]
    });

    expect(result.outcome).toBe('partial');
  });
});
