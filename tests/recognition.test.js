import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeSoundToDrawingAttempt } from '../src/recognition.js';
import { __testables } from '../src/recognition-worker.js';

const workerSource = readFileSync(join(process.cwd(), 'src/recognition-worker.js'), 'utf8');

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

  it('loads onnxruntime-web from a browser-resolvable path', () => {
    expect(workerSource).toContain("import('/node_modules/onnxruntime-web/dist/ort.all.min.mjs')");
    expect(workerSource).not.toContain("import('onnxruntime-web')");
  });
});
