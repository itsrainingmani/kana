// JS mirror of ml/features.py (FEATURE_VERSION 1) — the canonical stroke
// feature extraction for the write-mode recognizer. The two implementations
// must stay bit-for-bit equivalent in structure (same op order, same
// clamping); tests/write-parity.test.js checks them against golden vectors
// exported from the Python side. Any change requires a version bump + retrain.

export const FEATURE_VERSION = 2;
export const FEATURE_GRID = 24;
export const FEATURE_CHANNELS = 9;
export const FEATURE_STEP = 0.02;

// strokes: array of arrays of [x, y] points (y down), any coordinate space.
export function normalizeStrokes(strokes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  let span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 0)) {
    span = 1;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return strokes.map((stroke) =>
    stroke.map(([x, y]) => [(x - centerX) / span + 0.5, (y - centerY) / span + 0.5])
  );
}

export function resampleStroke(stroke, step = FEATURE_STEP) {
  if (stroke.length <= 1) {
    return stroke.map((point) => [...point]);
  }

  const segmentLengths = [];
  let total = 0;
  for (let index = 0; index < stroke.length - 1; index += 1) {
    const length = Math.hypot(
      stroke[index + 1][0] - stroke[index][0],
      stroke[index + 1][1] - stroke[index][1]
    );
    segmentLengths.push(length);
    total += length;
  }

  if (total < 1e-9) {
    return [[...stroke[0]]];
  }

  const count = Math.max(Math.floor(total / step), 1);
  const out = [];
  let segmentIndex = 0;
  let cumulativeBefore = 0;

  for (let index = 0; index <= count; index += 1) {
    let target = index * step;
    if (index === count) {
      target = Math.min(target, total);
    }
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
      stroke[segmentIndex][0] + (stroke[segmentIndex + 1][0] - stroke[segmentIndex][0]) * local,
      stroke[segmentIndex][1] + (stroke[segmentIndex + 1][1] - stroke[segmentIndex][1]) * local
    ]);
  }

  const last = out[out.length - 1];
  const finalPoint = stroke[stroke.length - 1];
  if (Math.hypot(last[0] - finalPoint[0], last[1] - finalPoint[1]) > 1e-9) {
    out.push([...finalPoint]);
  }
  return out;
}

function splat(tensor, channel, x, y, weight) {
  const grid = FEATURE_GRID;
  const gx = Math.min(Math.max(x, 0), 1) * (grid - 1);
  const gy = Math.min(Math.max(y, 0), 1) * (grid - 1);
  const ix = Math.min(Math.floor(gx), grid - 2);
  const iy = Math.min(Math.floor(gy), grid - 2);
  const fx = gx - ix;
  const fy = gy - iy;
  const base = channel * grid * grid;

  tensor[base + iy * grid + ix] += weight * (1 - fx) * (1 - fy);
  tensor[base + iy * grid + ix + 1] += weight * fx * (1 - fy);
  tensor[base + (iy + 1) * grid + ix] += weight * (1 - fx) * fy;
  tensor[base + (iy + 1) * grid + ix + 1] += weight * fx * fy;
}

// strokes -> Float32Array of length CHANNELS * GRID * GRID (channel-major).
export function extractFeatures(strokes) {
  const tensor = new Float32Array(FEATURE_CHANNELS * FEATURE_GRID * FEATURE_GRID);
  const cleaned = strokes.filter((stroke) => stroke.length > 0);

  if (cleaned.length === 0) {
    return tensor;
  }

  // Accumulate in float64 (plain JS numbers) like numpy, quantize to f32 once.
  const accumulator = new Float64Array(tensor.length);
  const splatInto = (channel, x, y, weight) => splat(accumulator, channel, x, y, weight);
  const normalized = normalizeStrokes(cleaned);

  for (const stroke of normalized) {
    const points = resampleStroke(stroke);

    for (let index = 0; index < points.length - 1; index += 1) {
      const dx = points[index + 1][0] - points[index][0];
      const dy = points[index + 1][1] - points[index][1];
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) {
        continue;
      }
      let theta = Math.atan2(dy, dx) % (2 * Math.PI);
      if (theta < 0) {
        theta += 2 * Math.PI;
      }
      const t = theta / (Math.PI / 4);
      const b0 = Math.floor(t) % 8;
      const b1 = (b0 + 1) % 8;
      const frac = t - Math.floor(t);
      const mx = (points[index][0] + points[index + 1][0]) / 2;
      const my = (points[index][1] + points[index + 1][1]) / 2;
      splatInto(b0, mx, my, (1 - frac) * length);
      splatInto(b1, mx, my, frac * length);
    }

    splatInto(8, points[0][0], points[0][1], 1);
    const last = points[points.length - 1];
    splatInto(8, last[0], last[1], 1);
  }

  // v2 normalization: direction channels share one max, the endpoint
  // channel has its own — endpoint splats are far heavier per cell and a
  // joint max would crush the direction features (see ml/features.py).
  const endpointBase = 8 * FEATURE_GRID * FEATURE_GRID;
  let directionPeak = 0;
  for (let index = 0; index < endpointBase; index += 1) {
    if (accumulator[index] > directionPeak) {
      directionPeak = accumulator[index];
    }
  }
  if (directionPeak > 1e-6) {
    for (let index = 0; index < endpointBase; index += 1) {
      tensor[index] = accumulator[index] / directionPeak;
    }
  }
  let endpointPeak = 0;
  for (let index = endpointBase; index < accumulator.length; index += 1) {
    if (accumulator[index] > endpointPeak) {
      endpointPeak = accumulator[index];
    }
  }
  if (endpointPeak > 1e-6) {
    for (let index = endpointBase; index < accumulator.length; index += 1) {
      tensor[index] = accumulator[index] / endpointPeak;
    }
  }
  return tensor;
}
