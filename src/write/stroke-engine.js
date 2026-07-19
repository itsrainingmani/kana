// Stroke geometry + per-stroke grading for the write drill. Pure math, no
// DOM: everything operates in the unit square where the reference glyph's
// 109×109 KanjiVG viewBox maps to [0,1]² — the canvas renders guides, ghost
// glyphs, and ink through the same mapping, so user points arrive here as
// canvasPx / canvasSize.

import { STROKE_DATA, STROKE_GRID } from './stroke-data.js';

export const MATCH_POINTS = 24;

// Grading tolerances (unit-square distances). A stroke passes when its
// average path distance, endpoints, direction, and length are all within
// tolerance of the expected stroke; short strokes (dakuten ticks) get a
// slightly wider absolute floor because a few millimetres of finger noise
// is proportionally huge on them.
const TOLERANCE = {
  avgDist: 0.085,
  endpoint: 0.16,
  shortBoost: 0.035,
  shortLength: 0.14,
  dirCos: 0.35,
  lengthLo: 0.5,
  lengthHi: 1.9
};

export function glyphStrokes(glyph) {
  const packed = STROKE_DATA[glyph];

  if (!packed) {
    return null;
  }

  return packed.map((flat) => {
    const points = [];
    for (let index = 0; index < flat.length; index += 2) {
      points.push([flat[index] / STROKE_GRID, flat[index + 1] / STROKE_GRID]);
    }
    return points;
  });
}

export function hasGlyphStrokes(glyph) {
  return Boolean(STROKE_DATA[glyph]);
}

export function polylineLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.hypot(
      points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1]
    );
  }
  return total;
}

// Uniform arc-length resample to exactly `count` points (endpoints included).
export function resampleToCount(points, count = MATCH_POINTS) {
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return Array.from({ length: count }, () => [...points[0]]);
  }

  const segmentLengths = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = Math.hypot(
      points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1]
    );
    segmentLengths.push(length);
    total += length;
  }

  if (total < 1e-9) {
    return Array.from({ length: count }, () => [...points[0]]);
  }

  const out = [];
  let segmentIndex = 0;
  let cumulativeBefore = 0;

  for (let index = 0; index < count; index += 1) {
    const target = (index / (count - 1)) * total;
    while (
      segmentIndex < segmentLengths.length - 1 &&
      cumulativeBefore + segmentLengths[segmentIndex] < target
    ) {
      cumulativeBefore += segmentLengths[segmentIndex];
      segmentIndex += 1;
    }
    const segmentLength = segmentLengths[segmentIndex];
    const local = segmentLength < 1e-12 ? 0 : (target - cumulativeBefore) / segmentLength;
    out.push([
      points[segmentIndex][0] + (points[segmentIndex + 1][0] - points[segmentIndex][0]) * local,
      points[segmentIndex][1] + (points[segmentIndex + 1][1] - points[segmentIndex][1]) * local
    ]);
  }

  return out;
}

function overallDirection(points) {
  const dx = points[points.length - 1][0] - points[0][0];
  const dy = points[points.length - 1][1] - points[0][1];
  const length = Math.hypot(dx, dy);
  return length < 1e-9 ? null : [dx / length, dy / length];
}

// Distance metrics between a drawn stroke and a reference stroke, both
// resampled to MATCH_POINTS and index-aligned (direction-sensitive).
export function strokeMetrics(userPoints, referencePoints) {
  const user = resampleToCount(userPoints);
  const reference = resampleToCount(referencePoints);

  let sum = 0;
  for (let index = 0; index < MATCH_POINTS; index += 1) {
    sum += Math.hypot(
      user[index][0] - reference[index][0],
      user[index][1] - reference[index][1]
    );
  }

  const userDir = overallDirection(user);
  const refDir = overallDirection(reference);
  const dirCos =
    userDir && refDir ? userDir[0] * refDir[0] + userDir[1] * refDir[1] : 1;

  const userLength = polylineLength(user);
  const referenceLength = polylineLength(reference);

  return {
    avgDist: sum / MATCH_POINTS,
    start: Math.hypot(
      user[0][0] - reference[0][0],
      user[0][1] - reference[0][1]
    ),
    end: Math.hypot(
      user[MATCH_POINTS - 1][0] - reference[MATCH_POINTS - 1][0],
      user[MATCH_POINTS - 1][1] - reference[MATCH_POINTS - 1][1]
    ),
    dirCos,
    lengthRatio: referenceLength < 1e-9 ? 1 : userLength / referenceLength,
    referenceLength
  };
}

function toleranceFor(referenceLength) {
  // Short reference strokes get the widened absolute floor.
  const boost =
    referenceLength < TOLERANCE.shortLength
      ? TOLERANCE.shortBoost * (1 - referenceLength / TOLERANCE.shortLength)
      : 0;
  return {
    avgDist: TOLERANCE.avgDist + boost,
    endpoint: TOLERANCE.endpoint + boost
  };
}

export function strokePasses(metrics) {
  const tolerance = toleranceFor(metrics.referenceLength);
  return (
    metrics.avgDist <= tolerance.avgDist &&
    metrics.start <= tolerance.endpoint &&
    metrics.end <= tolerance.endpoint &&
    metrics.dirCos >= TOLERANCE.dirCos &&
    metrics.lengthRatio >= TOLERANCE.lengthLo &&
    metrics.lengthRatio <= TOLERANCE.lengthHi
  );
}

// Grade one drawn stroke against the expected next reference stroke.
// remaining = reference strokes not yet drawn, in order; index 0 is expected.
// Returns { verdict: 'match' | 'backwards' | 'out-of-order' | 'no-match',
//           matchedIndex (into remaining, for out-of-order) }.
export function gradeStrokeAttempt(userPoints, remaining) {
  if (userPoints.length < 2 || remaining.length === 0) {
    return { verdict: 'no-match', matchedIndex: -1 };
  }

  const expected = remaining[0];
  const forward = strokeMetrics(userPoints, expected);

  if (strokePasses(forward)) {
    return { verdict: 'match', matchedIndex: 0, metrics: forward };
  }

  const reversed = strokeMetrics([...userPoints].reverse(), expected);
  if (strokePasses(reversed) && forward.dirCos < 0) {
    return { verdict: 'backwards', matchedIndex: 0, metrics: reversed };
  }

  // Did they draw a *later* stroke correctly? (Classic order mistake.)
  for (let index = 1; index < remaining.length; index += 1) {
    const metrics = strokeMetrics(userPoints, remaining[index]);
    if (strokePasses(metrics)) {
      return { verdict: 'out-of-order', matchedIndex: index, metrics };
    }
  }

  return { verdict: 'no-match', matchedIndex: -1, metrics: forward };
}

// Free-recall order analysis: greedily assign each drawn stroke to its best
// remaining reference stroke, then report whether the assignment respects
// the canonical order. Used after the recognizer has confirmed the glyph.
export function analyzeStrokeOrder(userStrokes, referenceStrokes) {
  const remaining = referenceStrokes.map((stroke, index) => ({ stroke, index }));
  const assignment = [];

  for (const user of userStrokes) {
    if (user.length < 2 || remaining.length === 0) {
      assignment.push(-1);
      continue;
    }

    let best = -1;
    let bestScore = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const metrics = strokeMetrics(user, remaining[index].stroke);
      const reversedMetrics = strokeMetrics([...user].reverse(), remaining[index].stroke);
      const score = Math.min(
        metrics.avgDist,
        // A backwards-drawn stroke still occupies its slot for assignment,
        // with a penalty so a forward match at similar distance wins.
        reversedMetrics.avgDist + 0.02
      );
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }

    assignment.push(remaining[best].index);
    remaining.splice(best, 1);
  }

  let inOrder = true;
  for (let index = 1; index < assignment.length; index += 1) {
    if (assignment[index] >= 0 && assignment[index - 1] >= 0 && assignment[index] < assignment[index - 1]) {
      inOrder = false;
      break;
    }
  }

  return {
    assignment,
    inOrder,
    missing: referenceStrokes.length - userStrokes.length
  };
}
