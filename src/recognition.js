function distance([ax, ay], [bx, by]) {
  return Math.hypot(ax - bx, ay - by);
}

function scoreStroke(stroke, template) {
  if (!Array.isArray(stroke) || stroke.length === 0 || !template?.points?.length) {
    return Number.POSITIVE_INFINITY;
  }

  const start = distance(stroke[0], template.points[0]);
  const end = distance(stroke[stroke.length - 1], template.points[template.points.length - 1]);
  return start + end;
}

function compareStrokeOrder(strokes, templates) {
  if (!Array.isArray(templates) || templates.length === 0) {
    return { correct: false, message: 'No stroke template available.' };
  }

  if (strokes.length !== templates.length) {
    return {
      correct: false,
      message: `You drew ${strokes.length} strokes, expected ${templates.length}.`
    };
  }

  for (let index = 0; index < templates.length; index += 1) {
    if (scoreStroke(strokes[index], templates[index]) > 0.45) {
      return {
        correct: false,
        message: `Recognized the kana, but stroke ${index + 1} came in the wrong order.`
      };
    }
  }

  return { correct: true, message: 'Correct stroke order.' };
}

export function gradeSoundToDrawingAttempt({ recognition, expected, strokes }) {
  const bestMatch = recognition?.matches?.[0] ?? null;

  if (!bestMatch?.glyph) {
    return {
      correct: false,
      outcome: 'incorrect',
      message: 'Drawing too incomplete to grade.',
      answer: expected.romaji
    };
  }

  if (bestMatch.glyph !== expected.glyph) {
    return {
      correct: false,
      outcome: 'incorrect',
      message: `This looks closest to ${bestMatch.glyph}.`,
      answer: expected.romaji
    };
  }

  const strokeOrder = compareStrokeOrder(strokes, expected.strokes);

  if (!strokeOrder.correct) {
    return {
      correct: false,
      outcome: 'partial',
      message: strokeOrder.message,
      answer: expected.romaji
    };
  }

  return {
    correct: true,
    outcome: 'correct',
    message: 'Correct stroke order.',
    answer: `${expected.glyph} · ${expected.romaji}`
  };
}
