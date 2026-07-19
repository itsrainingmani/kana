// Pure state machine for one write-drill prompt: which strokes have been
// accepted, miss/hint bookkeeping, and the final outcome. No DOM, no canvas —
// write-drill.js renders what this decides, tests exercise it directly.
//
// Tiers:
//   trace   ghost glyph always visible, strokes gated → completing = assisted
//   guided  gated per-stroke feedback; clean run (no hints, ≤1 miss) = correct
//   recall  free drawing, graded at the end by the recognizer + order analysis
//
// Verdicts are pedagogical: 'backwards' and 'out-of-order' carry the exact
// mistake so the UI can say what was wrong, not just that something was.

import { analyzeStrokeOrder, gradeStrokeAttempt, strokeMetrics, strokePasses } from './stroke-engine.js';

export const TIERS = ['trace', 'guided', 'recall'];

export const AUTO_HINT_MISSES = 3;
const GUIDED_MISS_ALLOWANCE = 1;

export function tierForMastery(mastery) {
  if (mastery === 'strong') {
    return 'recall';
  }
  return mastery === 'shaky' ? 'guided' : 'trace';
}

export function createWriteSession({ glyph, strokes, tier = 'trace' }) {
  const total = strokes.length;
  const state = {
    glyph,
    tier,
    accepted: [],       // for gated tiers: user ink per accepted reference stroke
    raw: [],            // for recall: every stroke as drawn
    missesOnCurrent: 0,
    totalMisses: 0,
    hintsUsed: 0,
    revealed: false,
    finished: false
  };

  function drawnCount() {
    return state.tier === 'recall' ? state.raw.length : state.accepted.length;
  }

  function isComplete() {
    return drawnCount() >= total;
  }

  function remainingStrokes() {
    return strokes.slice(state.accepted.length);
  }

  function markHint() {
    state.hintsUsed += 1;
  }

  function markRevealed() {
    state.revealed = true;
  }

  // Returns an event object describing what the drawn stroke did.
  function attemptStroke(points) {
    if (state.finished || isComplete()) {
      return { type: 'ignored' };
    }

    if (state.tier === 'recall') {
      state.raw.push(points);
      return {
        type: 'ink',
        index: state.raw.length - 1,
        complete: isComplete()
      };
    }

    const result = gradeStrokeAttempt(points, remainingStrokes());

    if (result.verdict === 'match') {
      state.accepted.push(points);
      state.missesOnCurrent = 0;
      return {
        type: 'accept',
        index: state.accepted.length - 1,
        complete: isComplete()
      };
    }

    state.missesOnCurrent += 1;
    state.totalMisses += 1;
    return {
      type: 'reject',
      verdict: result.verdict,
      matchedIndex:
        result.verdict === 'out-of-order'
          ? state.accepted.length + result.matchedIndex
          : state.accepted.length,
      autoHint: state.missesOnCurrent >= AUTO_HINT_MISSES
    };
  }

  function undo() {
    if (state.finished) {
      return false;
    }
    if (state.tier === 'recall') {
      return state.raw.pop() !== undefined;
    }
    if (state.accepted.length === 0) {
      return false;
    }
    state.accepted.pop();
    state.missesOnCurrent = 0;
    return true;
  }

  function clearDrawing() {
    if (state.finished) {
      return;
    }
    state.accepted = [];
    state.raw = [];
    state.missesOnCurrent = 0;
    // Misses/hints stay: clearing is a fresh sheet, not a fresh grade.
  }

  function gatedOutcome() {
    if (state.revealed || state.tier === 'trace') {
      return 'assisted';
    }
    return state.hintsUsed === 0 && state.totalMisses <= GUIDED_MISS_ALLOWANCE
      ? 'correct'
      : 'assisted';
  }

  // Recall-tier fallback when the recognizer is unavailable: strict greedy
  // stroke matching against the target only.
  function fallbackRecallGrade() {
    if (state.raw.length !== total) {
      return { outcome: 'partial', reason: 'stroke-count' };
    }
    const analysis = analyzeStrokeOrder(state.raw, strokes);
    const allClose = state.raw.every((points, index) => {
      const reference = strokes[analysis.assignment[index]] ?? strokes[index];
      return strokePasses(strokeMetrics(points, reference));
    });
    if (!allClose) {
      return { outcome: 'incorrect', reason: 'shape' };
    }
    return analysis.inOrder
      ? { outcome: 'correct', reason: null }
      : { outcome: 'partial', reason: 'stroke-order' };
  }

  // classify: (strokes) -> { top: [{label, prob}, ...] } | null
  function finish({ classify = null } = {}) {
    state.finished = true;

    if (state.tier !== 'recall') {
      return {
        outcome: gatedOutcome(),
        complete: isComplete(),
        recognized: null,
        reason: null,
        hintsUsed: state.hintsUsed,
        totalMisses: state.totalMisses
      };
    }

    const base = {
      complete: state.raw.length >= total,
      hintsUsed: state.hintsUsed,
      totalMisses: state.totalMisses
    };
    const capForAssists = (outcome) =>
      outcome === 'correct' && (state.hintsUsed > 0 || state.revealed)
        ? 'assisted'
        : outcome;

    const recognition = classify ? classify(state.raw) : null;

    if (!recognition || !recognition.top || recognition.top.length === 0) {
      const fallback = fallbackRecallGrade();
      return {
        ...base,
        outcome: capForAssists(fallback.outcome),
        reason: fallback.reason,
        recognized: null
      };
    }

    const top = recognition.top[0];
    const matchesTarget =
      top.label === glyph ||
      (typeof recognition.equivalent === 'function' &&
        recognition.equivalent(top.label, glyph));

    if (!matchesTarget) {
      return {
        ...base,
        outcome: 'incorrect',
        reason: 'recognized-other',
        recognized: top
      };
    }

    const analysis = analyzeStrokeOrder(state.raw, strokes);

    if (state.raw.length !== total) {
      return {
        ...base,
        outcome: 'partial',
        reason: 'stroke-count',
        recognized: top,
        strokeDelta: state.raw.length - total
      };
    }

    if (!analysis.inOrder) {
      return {
        ...base,
        outcome: 'partial',
        reason: 'stroke-order',
        recognized: top
      };
    }

    return {
      ...base,
      outcome: capForAssists('correct'),
      reason: null,
      recognized: top
    };
  }

  return {
    get tier() {
      return state.tier;
    },
    get glyph() {
      return state.glyph;
    },
    total,
    strokes,
    drawnCount,
    isComplete,
    remainingStrokes,
    attemptStroke,
    undo,
    clearDrawing,
    markHint,
    markRevealed,
    finish,
    get finished() {
      return state.finished;
    },
    get hintsUsed() {
      return state.hintsUsed;
    },
    get totalMisses() {
      return state.totalMisses;
    },
    get rawStrokes() {
      return state.raw;
    },
    get acceptedStrokes() {
      return state.accepted;
    }
  };
}
