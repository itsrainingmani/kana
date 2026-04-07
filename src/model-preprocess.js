const MODEL_SIZE = 48;

function clamp01(value) {
  return Math.max(0, Math.min(0.999, value));
}

function markPoint(grid, x, y, size) {
  const column = Math.floor(clamp01(x) * size);
  const row = Math.floor(clamp01(y) * size);
  grid[row * size + column] = 1;
}

function rasterizePolyline(points, grid, size) {
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    markPoint(grid, x, y, size);

    if (index === 0) {
      continue;
    }

    const [fromX, fromY] = points[index - 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x - fromX), Math.abs(y - fromY)) * size * 2));

    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      markPoint(grid, fromX + (x - fromX) * ratio, fromY + (y - fromY) * ratio, size);
    }
  }
}

export function rasterizeNormalizedStrokes(strokes, size = MODEL_SIZE) {
  const grid = new Array(size * size).fill(0);

  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length === 0) {
      continue;
    }

    rasterizePolyline(stroke, grid, size);
  }

  return Float32Array.from(grid);
}

export function getModelInputShape() {
  return [1, 1, MODEL_SIZE, MODEL_SIZE];
}
