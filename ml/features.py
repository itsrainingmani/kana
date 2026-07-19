"""Canonical stroke feature extraction.

This file is the *reference implementation* of the feature spec shared with
the JS inference engine (src/write/recognizer-features.js). Any change here
is a breaking model-format change: bump FEATURE_VERSION, retrain, and mirror
the change in JS (the golden-vector parity test in tests/ enforces this).

Spec (FEATURE_VERSION 2):
  input: strokes = [[(x, y), ...], ...] in any coordinate space, y down.
  1. Normalize: bounding box of all points; scale by the larger side so the
     drawing fits a unit box centered at (0.5, 0.5), aspect preserved.
  2. Resample each stroke to equidistant points, step 0.02 arc length.
  3. Rasterize onto a 24x24 grid, 9 channels:
       ch 0..7  direction of each resampled segment, soft-binned over the
                two nearest of 8 angle bins (bin k centered at k*pi/4,
                y-down screen angles), weighted by segment length,
                bilinearly splatted at the segment midpoint;
       ch 8     stroke endpoints (first + last point of every stroke),
                weight 1.0, bilinearly splatted.
  4. Normalize the direction channels (0..7) by their joint max and the
     endpoint channel by its own max. (v1 divided everything by the global
     max; endpoint splats are ~20x heavier than direction cells, which
     crushed the direction features into a sliver of the dynamic range.)
"""

from __future__ import annotations

import numpy as np

FEATURE_VERSION = 2
GRID = 24
CHANNELS = 9
STEP = 0.02


def normalize_strokes(strokes: list[np.ndarray]) -> list[np.ndarray]:
    pts = np.concatenate([s for s in strokes if len(s) > 0], axis=0)
    lo = pts.min(axis=0)
    hi = pts.max(axis=0)
    span = float(max(hi[0] - lo[0], hi[1] - lo[1]))
    if span <= 0:
        span = 1.0
    center = (lo + hi) / 2.0
    return [(s - center) / span + 0.5 for s in strokes]


def resample_stroke(stroke: np.ndarray, step: float = STEP) -> np.ndarray:
    if len(stroke) <= 1:
        return stroke.copy()

    deltas = np.diff(stroke, axis=0)
    seg_lens = np.hypot(deltas[:, 0], deltas[:, 1])
    total = float(seg_lens.sum())
    if total < 1e-9:
        return stroke[:1].copy()

    n_out = max(int(np.floor(total / step)), 1)
    targets = np.arange(n_out + 1, dtype=np.float64) * step
    targets[-1] = min(targets[-1], total)

    cumulative = np.concatenate([[0.0], np.cumsum(seg_lens)])
    out = np.empty((len(targets), 2), dtype=np.float64)
    seg_index = 0
    for i, t in enumerate(targets):
        while seg_index < len(seg_lens) - 1 and cumulative[seg_index + 1] < t:
            seg_index += 1
        seg_len = seg_lens[seg_index]
        local = 0.0 if seg_len < 1e-12 else (t - cumulative[seg_index]) / seg_len
        out[i] = stroke[seg_index] + deltas[seg_index] * local

    # Always terminate exactly on the final input point.
    if np.hypot(*(out[-1] - stroke[-1])) > 1e-9:
        out = np.concatenate([out, stroke[-1:][:]], axis=0)
    return out


def _splat(grid: np.ndarray, channel: int, x: float, y: float, weight: float) -> None:
    gx = min(max(x, 0.0), 1.0) * (GRID - 1)
    gy = min(max(y, 0.0), 1.0) * (GRID - 1)
    ix = min(int(np.floor(gx)), GRID - 2)
    iy = min(int(np.floor(gy)), GRID - 2)
    fx = gx - ix
    fy = gy - iy
    grid[channel, iy, ix] += weight * (1 - fx) * (1 - fy)
    grid[channel, iy, ix + 1] += weight * fx * (1 - fy)
    grid[channel, iy + 1, ix] += weight * (1 - fx) * fy
    grid[channel, iy + 1, ix + 1] += weight * fx * fy


def extract_features(strokes: list[np.ndarray]) -> np.ndarray:
    """strokes -> float32 tensor of shape (CHANNELS, GRID, GRID)."""
    strokes = [np.asarray(s, dtype=np.float64) for s in strokes if len(s) > 0]
    if not strokes:
        return np.zeros((CHANNELS, GRID, GRID), dtype=np.float32)

    tensor = np.zeros((CHANNELS, GRID, GRID), dtype=np.float64)
    normalized = normalize_strokes(strokes)

    for stroke in normalized:
        pts = resample_stroke(stroke)

        for i in range(len(pts) - 1):
            dx = pts[i + 1, 0] - pts[i, 0]
            dy = pts[i + 1, 1] - pts[i, 1]
            length = float(np.hypot(dx, dy))
            if length < 1e-9:
                continue
            theta = float(np.arctan2(dy, dx)) % (2 * np.pi)
            t = theta / (np.pi / 4)
            b0 = int(np.floor(t)) % 8
            b1 = (b0 + 1) % 8
            frac = t - np.floor(t)
            mx = (pts[i, 0] + pts[i + 1, 0]) / 2
            my = (pts[i, 1] + pts[i + 1, 1]) / 2
            _splat(tensor, b0, mx, my, (1 - frac) * length)
            _splat(tensor, b1, mx, my, frac * length)

        _splat(tensor, 8, float(pts[0, 0]), float(pts[0, 1]), 1.0)
        _splat(tensor, 8, float(pts[-1, 0]), float(pts[-1, 1]), 1.0)

    direction_peak = tensor[:8].max()
    if direction_peak > 1e-6:
        tensor[:8] /= direction_peak
    endpoint_peak = tensor[8].max()
    if endpoint_peak > 1e-6:
        tensor[8] /= endpoint_peak
    return tensor.astype(np.float32)
