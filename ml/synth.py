"""Synthetic handwriting generator.

Turns the clean KanjiVG centerline polylines into plausible learner
handwriting by composing geometric distortions: global rotation/shear/
anisotropic scale, per-stroke rigid jitter, smooth low-frequency wobble
along each stroke, end trimming/extension (tome/hane variation), and
occasional polyline simplification (finger-drawn strokes are straighter
than brush centerlines).

All randomness flows from an explicit numpy Generator so every sample is
reproducible from (split, class, index).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class AugmentConfig:
    rotate_std: float = 4.0        # degrees
    rotate_max: float = 9.0
    shear_std: float = 0.10
    shear_max: float = 0.24
    scale_lo: float = 0.85
    scale_hi: float = 1.15
    stroke_rotate_std: float = 3.0
    stroke_rotate_max: float = 7.0
    stroke_shift_std: float = 1.5  # KanjiVG units (109 grid)
    stroke_shift_max: float = 3.5
    stroke_scale_lo: float = 0.92
    stroke_scale_hi: float = 1.08
    wobble_lo: float = 0.4
    wobble_hi: float = 1.6
    end_trim_lo: float = -0.05     # fraction of arc length (negative = trim)
    end_trim_hi: float = 0.07
    simplify_prob: float = 0.3
    simplify_tol_lo: float = 0.5
    simplify_tol_hi: float = 2.0


TRAIN_CONFIG = AugmentConfig()

# Deliberately harsher than anything a motivated learner should produce;
# used as a robustness stress report, not for model selection.
STRESS_CONFIG = AugmentConfig(
    rotate_std=7.0,
    rotate_max=14.0,
    shear_std=0.16,
    shear_max=0.35,
    scale_lo=0.75,
    scale_hi=1.3,
    stroke_rotate_std=5.0,
    stroke_rotate_max=11.0,
    stroke_shift_std=2.6,
    stroke_shift_max=6.0,
    stroke_scale_lo=0.85,
    stroke_scale_hi=1.18,
    wobble_lo=0.8,
    wobble_hi=2.8,
    end_trim_lo=-0.12,
    end_trim_hi=0.12,
    simplify_prob=0.45,
    simplify_tol_lo=0.8,
    simplify_tol_hi=3.0,
)


def _clipped_normal(rng: np.random.Generator, std: float, max_abs: float) -> float:
    return float(np.clip(rng.normal(0.0, std), -max_abs, max_abs))


def _arc_lengths(stroke: np.ndarray) -> np.ndarray:
    deltas = np.diff(stroke, axis=0)
    return np.concatenate([[0.0], np.cumsum(np.hypot(deltas[:, 0], deltas[:, 1]))])


def _resample_count(stroke: np.ndarray, spacing: float = 1.6) -> np.ndarray:
    """Densify to roughly even spacing so wobble bends long segments too."""
    cumulative = _arc_lengths(stroke)
    total = cumulative[-1]
    if total < 1e-9 or len(stroke) < 2:
        return stroke.copy()
    count = max(int(total / spacing) + 1, 2)
    targets = np.linspace(0.0, total, count)
    xs = np.interp(targets, cumulative, stroke[:, 0])
    ys = np.interp(targets, cumulative, stroke[:, 1])
    return np.stack([xs, ys], axis=1)


def _simplify_rdp(stroke: np.ndarray, tolerance: float) -> np.ndarray:
    if len(stroke) <= 2:
        return stroke

    keep = np.zeros(len(stroke), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(stroke) - 1)]

    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        seg = stroke[hi] - stroke[lo]
        seg_len = np.hypot(*seg)
        pts = stroke[lo + 1 : hi]
        if seg_len < 1e-9:
            distances = np.hypot(*(pts - stroke[lo]).T)
        else:
            distances = np.abs(np.cross(seg, pts - stroke[lo])) / seg_len
        idx = int(np.argmax(distances))
        if distances[idx] > tolerance:
            keep[lo + 1 + idx] = True
            stack.append((lo, lo + 1 + idx))
            stack.append((lo + 1 + idx, hi))

    return stroke[keep]


def _wobble(stroke: np.ndarray, amplitude: float, rng: np.random.Generator) -> np.ndarray:
    if len(stroke) < 3:
        return stroke
    cumulative = _arc_lengths(stroke)
    total = cumulative[-1]
    if total < 1e-9:
        return stroke
    u = cumulative / total
    out = stroke.copy()
    for axis in range(2):
        # Two low-frequency sines with random phase ≈ smooth hand tremor.
        f1, f2 = rng.uniform(0.7, 1.6), rng.uniform(1.8, 3.2)
        p1, p2 = rng.uniform(0, 2 * np.pi, size=2)
        a1, a2 = amplitude * rng.uniform(0.5, 1.0), amplitude * rng.uniform(0.2, 0.6)
        out[:, axis] += a1 * np.sin(2 * np.pi * f1 * u + p1) + a2 * np.sin(
            2 * np.pi * f2 * u + p2
        )
    return out


def _trim_extend(stroke: np.ndarray, frac_start: float, frac_end: float) -> np.ndarray:
    cumulative = _arc_lengths(stroke)
    total = cumulative[-1]
    if total < 1e-9 or len(stroke) < 2:
        return stroke

    lo = max(0.0, -frac_start) * total
    hi = total - max(0.0, -frac_end) * total
    if hi - lo < total * 0.4:  # never trim a stroke below 40 % of its length
        lo, hi = 0.0, total

    targets = np.linspace(lo, hi, max(len(stroke), 2))
    xs = np.interp(targets, cumulative, stroke[:, 0])
    ys = np.interp(targets, cumulative, stroke[:, 1])
    out = np.stack([xs, ys], axis=1)

    # Positive fractions extend along the end tangents.
    if frac_start > 0:
        tangent = out[0] - out[1]
        norm = np.hypot(*tangent)
        if norm > 1e-9:
            out = np.concatenate([[out[0] + tangent / norm * frac_start * total], out])
    if frac_end > 0:
        tangent = out[-1] - out[-2]
        norm = np.hypot(*tangent)
        if norm > 1e-9:
            out = np.concatenate([out, [out[-1] + tangent / norm * frac_end * total]])
    return out


def synthesize(
    strokes: list[np.ndarray],
    rng: np.random.Generator,
    config: AugmentConfig = TRAIN_CONFIG,
) -> list[np.ndarray]:
    """Clean KanjiVG polylines (109-grid) -> one synthetic handwriting sample."""
    pts = np.concatenate(strokes, axis=0)
    center = (pts.min(axis=0) + pts.max(axis=0)) / 2.0

    theta = np.deg2rad(_clipped_normal(rng, config.rotate_std, config.rotate_max))
    shear = _clipped_normal(rng, config.shear_std, config.shear_max)
    sx = rng.uniform(config.scale_lo, config.scale_hi)
    sy = rng.uniform(config.scale_lo, config.scale_hi)
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    # rotate → shear-x → anisotropic scale
    matrix = np.array(
        [
            [sx * (cos_t + shear * sin_t), sx * (-sin_t + shear * cos_t)],
            [sy * sin_t, sy * cos_t],
        ]
    )

    out = []
    for stroke in strokes:
        s = _resample_count(np.asarray(stroke, dtype=np.float64))

        if rng.uniform() < config.simplify_prob:
            s = _simplify_rdp(s, rng.uniform(config.simplify_tol_lo, config.simplify_tol_hi))
            s = _resample_count(s)

        s = _wobble(s, rng.uniform(config.wobble_lo, config.wobble_hi), rng)
        s = _trim_extend(
            s,
            rng.uniform(config.end_trim_lo, config.end_trim_hi),
            rng.uniform(config.end_trim_lo, config.end_trim_hi),
        )

        # Per-stroke rigid jitter about the stroke centroid.
        centroid = s.mean(axis=0)
        phi = np.deg2rad(
            _clipped_normal(rng, config.stroke_rotate_std, config.stroke_rotate_max)
        )
        cos_p, sin_p = np.cos(phi), np.sin(phi)
        stroke_scale = rng.uniform(config.stroke_scale_lo, config.stroke_scale_hi)
        local = (s - centroid) @ np.array([[cos_p, -sin_p], [sin_p, cos_p]]).T * stroke_scale
        shift = np.array(
            [
                _clipped_normal(rng, config.stroke_shift_std, config.stroke_shift_max),
                _clipped_normal(rng, config.stroke_shift_std, config.stroke_shift_max),
            ]
        )
        s = local + centroid + shift

        # Global affine about the glyph center.
        s = (s - center) @ matrix.T + center
        out.append(s)

    return out
