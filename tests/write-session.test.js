import { describe, expect, it } from 'vitest';
import { glyphStrokes } from '../src/write/stroke-engine.js';
import { createWriteSession, tierForMastery } from '../src/write/write-session.js';

function sessionFor(glyph, tier) {
  return createWriteSession({ glyph, strokes: glyphStrokes(glyph), tier });
}

describe('tierForMastery', () => {
  it('maps mastery to assistance tiers', () => {
    expect(tierForMastery('new')).toBe('trace');
    expect(tierForMastery('shaky')).toBe('guided');
    expect(tierForMastery('strong')).toBe('recall');
  });
});

describe('gated tiers (trace/guided)', () => {
  it('accepts correct strokes in order and completes', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'guided');

    const first = session.attemptStroke(strokes[0]);
    expect(first).toMatchObject({ type: 'accept', index: 0, complete: false });

    const second = session.attemptStroke(strokes[1]);
    expect(second).toMatchObject({ type: 'accept', index: 1, complete: true });

    const result = session.finish();
    expect(result.outcome).toBe('correct');
    expect(result.complete).toBe(true);
  });

  it('grades a clean traced run as assisted', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'trace');
    strokes.forEach((stroke) => session.attemptStroke(stroke));
    expect(session.finish().outcome).toBe('assisted');
  });

  it('rejects wrong strokes, auto-hints after three misses, allows one miss', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'guided');
    const wrong = strokes[0].map(([x, y]) => [x, y + 0.5]);

    expect(session.attemptStroke(wrong).autoHint).toBe(false);
    expect(session.attemptStroke(wrong).autoHint).toBe(false);
    expect(session.attemptStroke(wrong).autoHint).toBe(true);

    strokes.forEach((stroke) => session.attemptStroke(stroke));
    // three misses > allowance of one → assisted
    expect(session.finish().outcome).toBe('assisted');
  });

  it('stays correct with a single miss and no hints', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'guided');
    session.attemptStroke(strokes[0].map(([x, y]) => [x, y + 0.5]));
    strokes.forEach((stroke) => session.attemptStroke(stroke));
    expect(session.finish().outcome).toBe('correct');
  });

  it('marks hint usage as assisted', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'guided');
    session.markHint();
    strokes.forEach((stroke) => session.attemptStroke(stroke));
    expect(session.finish().outcome).toBe('assisted');
  });

  it('supports undo of an accepted stroke', () => {
    const strokes = glyphStrokes('こ');
    const session = sessionFor('こ', 'guided');
    session.attemptStroke(strokes[0]);
    expect(session.drawnCount()).toBe(1);
    expect(session.undo()).toBe(true);
    expect(session.drawnCount()).toBe(0);
    expect(session.undo()).toBe(false);
  });

  it('reports out-of-order attempts with the absolute stroke index', () => {
    const strokes = glyphStrokes('川');
    const session = sessionFor('川', 'guided');
    session.attemptStroke(strokes[0]);
    const event = session.attemptStroke(strokes[2]);
    expect(event.type).toBe('reject');
    expect(event.verdict).toBe('out-of-order');
    expect(event.matchedIndex).toBe(2);
  });
});

describe('recall tier', () => {
  const strokes = glyphStrokes('川');

  function drawAll(session, order = [0, 1, 2]) {
    order.forEach((index) => session.attemptStroke(strokes[index]));
  }

  it('accepts any ink without gating and completes at stroke count', () => {
    const session = sessionFor('川', 'recall');
    expect(session.attemptStroke(strokes[1]).type).toBe('ink');
    drawAll(session, [0, 2]);
    expect(session.isComplete()).toBe(true);
  });

  it('grades correct via the recognizer', () => {
    const session = sessionFor('川', 'recall');
    drawAll(session);
    const result = session.finish({
      classify: () => ({ top: [{ label: '川', prob: 0.98 }] })
    });
    expect(result.outcome).toBe('correct');
    expect(result.recognized.label).toBe('川');
  });

  it('accepts a homoglyph twin as the target', () => {
    const niStrokes = glyphStrokes('ニ');
    const session = createWriteSession({ glyph: 'ニ', strokes: niStrokes, tier: 'recall' });
    niStrokes.forEach((stroke) => session.attemptStroke(stroke));
    const result = session.finish({
      classify: () => ({
        top: [{ label: '二', prob: 0.9 }],
        equivalent: (a, b) => (a === '二' && b === 'ニ') || (a === 'ニ' && b === '二')
      })
    });
    expect(result.outcome).toBe('correct');
  });

  it('downgrades wrong stroke order to partial', () => {
    const session = sessionFor('川', 'recall');
    drawAll(session, [2, 1, 0]);
    const result = session.finish({
      classify: () => ({ top: [{ label: '川', prob: 0.95 }] })
    });
    expect(result.outcome).toBe('partial');
    expect(result.reason).toBe('stroke-order');
  });

  it('flags recognized-other as incorrect', () => {
    const session = sessionFor('川', 'recall');
    drawAll(session);
    const result = session.finish({
      classify: () => ({ top: [{ label: '州', prob: 0.8 }] })
    });
    expect(result.outcome).toBe('incorrect');
    expect(result.reason).toBe('recognized-other');
    expect(result.recognized.label).toBe('州');
  });

  it('caps hint-assisted recall at assisted', () => {
    const session = sessionFor('川', 'recall');
    session.markRevealed();
    drawAll(session);
    const result = session.finish({
      classify: () => ({ top: [{ label: '川', prob: 0.98 }] })
    });
    expect(result.outcome).toBe('assisted');
  });

  it('reports stroke-count mismatch as partial', () => {
    const session = sessionFor('川', 'recall');
    drawAll(session, [0, 1]);
    const result = session.finish({
      classify: () => ({ top: [{ label: '川', prob: 0.9 }] })
    });
    expect(result.outcome).toBe('partial');
    expect(result.reason).toBe('stroke-count');
  });

  it('falls back to geometric grading without a recognizer', () => {
    const correct = sessionFor('川', 'recall');
    drawAll(correct);
    expect(correct.finish().outcome).toBe('correct');

    const swapped = sessionFor('川', 'recall');
    drawAll(swapped, [1, 0, 2]);
    const result = swapped.finish();
    expect(result.outcome).toBe('partial');
    expect(result.reason).toBe('stroke-order');
  });
});
