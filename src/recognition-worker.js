import { getModelInputShape, rasterizeNormalizedStrokes } from './model-preprocess.js';

const GRID_SIZE = 16;
const MODEL_PATH = '/models/kana-classifier.onnx';
const LABELS_PATH = '/models/kana-labels.json';
let ortModulePromise = null;
let sessionPromise = null;
let labelsPromise = null;

function clamp01(value) {
  return Math.max(0, Math.min(0.999, value));
}

function createEmptyGrid() {
  return new Array(GRID_SIZE * GRID_SIZE).fill(0);
}

function markPoint(grid, x, y) {
  const column = Math.floor(clamp01(x) * GRID_SIZE);
  const row = Math.floor(clamp01(y) * GRID_SIZE);
  grid[row * GRID_SIZE + column] = 1;
}

function rasterizePolyline(points, grid) {
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    markPoint(grid, x, y);

    if (index === 0) {
      continue;
    }

    const [fromX, fromY] = points[index - 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x - fromX), Math.abs(y - fromY)) * GRID_SIZE * 2));

    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      markPoint(grid, fromX + (x - fromX) * ratio, fromY + (y - fromY) * ratio);
    }
  }
}

function rasterizeStrokes(strokes) {
  const grid = createEmptyGrid();

  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0) {
      continue;
    }

    rasterizePolyline(stroke, grid);
  }

  return grid;
}

function templateToStrokePoints(templates) {
  return (templates ?? []).map((template) => template.points ?? []);
}

function toOrientationBucket(stroke) {
  if (!Array.isArray(stroke) || stroke.length < 2) {
    return 2;
  }

  const [startX, startY] = stroke[0];
  const [endX, endY] = stroke[stroke.length - 1];
  const deltaX = Math.abs(endX - startX);
  const deltaY = Math.abs(endY - startY);

  if (deltaX > deltaY * 1.5) {
    return 0;
  }

  if (deltaY > deltaX * 1.5) {
    return 1;
  }

  return 2;
}

function createOrientationVector(strokes) {
  const vector = [0, 0, 0];

  for (const stroke of strokes) {
    vector[toOrientationBucket(stroke)] += 1;
  }

  return vector;
}

function scoreRaster(actual, expected) {
  let score = 0;

  for (let index = 0; index < actual.length; index += 1) {
    score += Math.abs(actual[index] - expected[index]);
  }

  return score;
}

function scoreVector(actual, expected) {
  let score = 0;

  for (let index = 0; index < actual.length; index += 1) {
    score += Math.abs(actual[index] - expected[index]);
  }

  return score;
}

function toConfidence(bestScore, secondBestScore) {
  if (!Number.isFinite(bestScore)) {
    return 0;
  }

  if (!Number.isFinite(secondBestScore)) {
    return 1;
  }

  return Math.max(0, Math.min(1, secondBestScore === 0 ? 0 : 1 - bestScore / secondBestScore));
}

function classify(strokes, candidates) {
  const raster = rasterizeStrokes(strokes);
  const orientation = createOrientationVector(strokes);
  let bestMatch = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondBestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates ?? []) {
    if (!Array.isArray(candidate.strokes) || candidate.strokes.length === 0) {
      continue;
    }

    const expectedStrokes = templateToStrokePoints(candidate.strokes);
    const score =
      scoreRaster(raster, rasterizeStrokes(expectedStrokes)) +
      scoreVector(orientation, createOrientationVector(expectedStrokes)) * 8;

    if (score < bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestMatch = candidate;
      continue;
    }

    if (score < secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestMatch) {
    return [];
  }

  return [
    {
      glyph: bestMatch.glyph,
      id: bestMatch.id,
      confidence: toConfidence(bestScore, secondBestScore)
    }
  ];
}

function topK(scores, count = 3) {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((left, right) => right.score - left.score)
    .slice(0, count);
}

async function loadOrt() {
  if (!ortModulePromise) {
    ortModulePromise = import('onnxruntime-web/all');
  }

  return ortModulePromise;
}

async function loadLabels(fetchImpl = fetch) {
  if (!labelsPromise) {
    labelsPromise = fetchImpl(LABELS_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load labels: ${response.status}`);
        }

        return response.json();
      })
      .catch((error) => {
        labelsPromise = null;
        throw error;
      });
  }

  return labelsPromise;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = loadOrt()
      .then((ort) => ort.InferenceSession.create(MODEL_PATH))
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  }

  return sessionPromise;
}

async function classifyWithModel(strokes, candidates) {
  const [ort, session, labels] = await Promise.all([loadOrt(), getSession(), loadLabels()]);
  const input = rasterizeNormalizedStrokes(strokes);
  const tensor = new ort.Tensor('float32', input, getModelInputShape());
  const output = await session.run({ input: tensor });
  const logits = Object.values(output)[0]?.data;

  if (!logits) {
    return [];
  }

  const candidatesByGlyph = new Map((candidates ?? []).map((candidate) => [candidate.glyph, candidate]));

  return topK(Array.from(logits), 5)
    .map(({ index, score }) => {
      const label = labels[index];
      const glyph = label?.glyph ?? label;
      const candidate = candidatesByGlyph.get(glyph);

      if (!candidate) {
        return null;
      }

      return {
        glyph: candidate.glyph,
        id: candidate.id,
        confidence: Number(score)
      };
    })
    .filter(Boolean);
}

async function classifyRequest(strokes, candidates) {
  try {
    return await classifyWithModel(strokes, candidates);
  } catch {
    return classify(strokes, candidates);
  }
}

const workerScope = typeof self !== 'undefined' ? self : null;

workerScope?.addEventListener('message', async (event) => {
  const data = event.data ?? {};

  if (data.type === 'warmup') {
    try {
      await Promise.all([getSession(), loadLabels()]);
    } catch {
      // Keep worker usable while the model artifact is not present yet.
    }

    workerScope.postMessage({ type: 'ready' });
    return;
  }

  if (data.type !== 'classify') {
    workerScope.postMessage({
      type: 'error',
      requestId: data.requestId,
      promptId: data.promptId,
      message: 'Unsupported worker request'
    });
    return;
  }

  workerScope.postMessage({
    type: 'result',
    requestId: data.requestId,
    promptId: data.promptId,
    matches: await classifyRequest(data.strokes ?? [], data.candidates ?? [])
  });
});

export const __testables = {
  topK,
  classify,
  classifyWithModel,
  loadLabels,
  getSession,
};
