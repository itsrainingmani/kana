import { describe, expect, it } from 'vitest';
import {
  analyzeStrokeOrder,
  glyphStrokes,
  gradeStrokeAttempt,
  hasGlyphStrokes,
  polylineLength,
  resampleToCount,
  strokeMetrics,
  strokePasses
} from '../src/write/stroke-engine.js';
import { STROKE_DATA } from '../src/write/stroke-data.js';
import { KANA_DATA } from '../src/kana-data.js';
import { KANJI_DATA } from '../src/write/kanji-data.js';

// Deterministic pseudo-random jitter for "plausible handwriting" fixtures.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function jitterStroke(points, amplitude, random) {
  const dx = (random() - 0.5) * amplitude * 2;
  const dy = (random() - 0.5) * amplitude * 2;
  return points.map(([x, y]) => [
    x + dx + (random() - 0.5) * amplitude,
    y + dy + (random() - 0.5) * amplitude
  ]);
}

describe('stroke database', () => {
  it('covers every single-glyph kana', () => {
    const singles = KANA_DATA.filter((kana) => [...kana.glyph].length === 1);
    for (const kana of singles) {
      expect(hasGlyphStrokes(kana.glyph), `missing ${kana.glyph}`).toBe(true);
    }
  });

  it('covers every kanji record with a matching stroke count', () => {
    for (const kanji of KANJI_DATA) {
      const strokes = glyphStrokes(kanji.glyph);
      expect(strokes, `missing ${kanji.glyph}`).not.toBeNull();
      expect(strokes.length, `count ${kanji.glyph}`).toBe(kanji.strokeCount);
    }
  });

  it('decodes strokes into unit-square points', () => {
    for (const glyph of ['あ', 'ア', '一', '語']) {
      for (const stroke of glyphStrokes(glyph)) {
        expect(stroke.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of stroke) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('stores multi-point dakuten marks for voiced kana', () => {
    const ka = glyphStrokes('か');
    const ga = glyphStrokes('が');
    expect(ga.length).toBe(ka.length + 2);
  });
});

describe('resampleToCount', () => {
  it('produces evenly spaced points with exact endpoints', () => {
    const line = [
      [0, 0],
      [1, 0]
    ];
    const resampled = resampleToCount(line, 5);
    expect(resampled).toHaveLength(5);
    expect(resampled[0]).toEqual([0, 0]);
    expect(resampled[4][0]).toBeCloseTo(1, 9);
    expect(resampled[2][0]).toBeCloseTo(0.5, 9);
  });

  it('handles degenerate single points', () => {
    expect(resampleToCount([[0.3, 0.4]], 3)).toEqual([
      [0.3, 0.4],
      [0.3, 0.4],
      [0.3, 0.4]
    ]);
  });
});

describe('gradeStrokeAttempt', () => {
  const strokes = glyphStrokes('こ'); // two horizontal strokes, top then bottom

  it('accepts a lightly jittered correct stroke', () => {
    const random = makeRandom(7);
    for (let trial = 0; trial < 20; trial += 1) {
      const drawn = jitterStroke(strokes[0], 0.03, random);
      const result = gradeStrokeAttempt(drawn, strokes);
      expect(result.verdict, `trial ${trial}`).toBe('match');
    }
  });

  it('flags a stroke drawn in reverse as backwards', () => {
    const reversed = [...strokes[0]].reverse();
    const result = gradeStrokeAttempt(reversed, strokes);
    expect(result.verdict).toBe('backwards');
  });

  it('flags drawing the second stroke first as out-of-order', () => {
    const result = gradeStrokeAttempt(strokes[1], strokes);
    expect(result.verdict).toBe('out-of-order');
    expect(result.matchedIndex).toBe(1);
  });

  it('rejects a stroke drawn far from the target', () => {
    const displaced = strokes[0].map(([x, y]) => [x, y + 0.5]);
    const result = gradeStrokeAttempt(displaced, strokes);
    expect(result.verdict).toBe('no-match');
  });

  it('rejects unrelated scribbles', () => {
    const scribble = [
      [0.1, 0.9],
      [0.15, 0.2],
      [0.9, 0.85]
    ];
    const result = gradeStrokeAttempt(scribble, glyphStrokes('一'));
    expect(result.verdict).toBe('no-match');
  });

  it('accepts jittered strokes across a spread of characters', () => {
    const random = makeRandom(11);
    for (const glyph of ['あ', 'き', 'ツ', '木', '火', '学']) {
      const reference = glyphStrokes(glyph);
      const remaining = [...reference];
      reference.forEach((stroke, index) => {
        const drawn = jitterStroke(stroke, 0.025, random);
        const result = gradeStrokeAttempt(drawn, remaining.slice(index));
        expect(result.verdict, `${glyph} stroke ${index}`).toBe('match');
      });
    }
  });

  it('accepts short dakuten ticks with proportionally more noise', () => {
    const ga = glyphStrokes('が');
    const tick = ga[ga.length - 1];
    const random = makeRandom(3);
    const drawn = jitterStroke(tick, 0.028, random);
    const result = gradeStrokeAttempt(drawn, [tick]);
    expect(result.verdict).toBe('match');
  });
});

describe('strokeMetrics + strokePasses', () => {
  it('reports direction cosine for opposing strokes', () => {
    const forward = [
      [0.2, 0.5],
      [0.8, 0.5]
    ];
    const backward = [
      [0.8, 0.5],
      [0.2, 0.5]
    ];
    const metrics = strokeMetrics(backward, forward);
    expect(metrics.dirCos).toBeLessThan(-0.99);
    expect(strokePasses(metrics)).toBe(false);
  });

  it('measures length ratio', () => {
    const reference = [
      [0.2, 0.5],
      [0.8, 0.5]
    ];
    const half = [
      [0.2, 0.5],
      [0.5, 0.5]
    ];
    expect(strokeMetrics(half, reference).lengthRatio).toBeCloseTo(0.5, 5);
    expect(polylineLength(reference)).toBeCloseTo(0.6, 9);
  });
});

describe('analyzeStrokeOrder', () => {
  const strokes = glyphStrokes('川'); // three vertical-ish strokes, left to right

  it('confirms canonical order', () => {
    const analysis = analyzeStrokeOrder(strokes, strokes);
    expect(analysis.assignment).toEqual([0, 1, 2]);
    expect(analysis.inOrder).toBe(true);
    expect(analysis.missing).toBe(0);
  });

  it('detects swapped strokes', () => {
    const swapped = [strokes[1], strokes[0], strokes[2]];
    const analysis = analyzeStrokeOrder(swapped, strokes);
    expect(analysis.inOrder).toBe(false);
  });

  it('counts missing strokes', () => {
    const analysis = analyzeStrokeOrder(strokes.slice(0, 2), strokes);
    expect(analysis.missing).toBe(1);
  });
});
