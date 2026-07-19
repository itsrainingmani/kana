// Canvas controller for the write drill: pointer-drawn ink, per-stroke
// feedback animations, hint pulses, and the stroke-order reveal player.
// Pure drawing/interaction — grading decisions come from write-session.js,
// prompt/outcome plumbing stays in app.js.
//
// Interaction notes (in the spirit of the rest of the app):
// - pointer events + setPointerCapture; touch-action is disabled in CSS so
//   the browser never fights the gesture; coalesced events keep fast ink
//   smooth on 120 Hz screens.
// - ink responds on every pointermove (draw-as-you-go, not on release);
//   a matched stroke "sets" into the canonical form with a short crossfade,
//   a miss bleeds vermillion and fades away.
// - all animations run through one rAF loop that only exists while
//   something moves; reduced-motion swaps every animation for its end state.

import { glyphStrokes } from './stroke-engine.js';
import { createWriteSession } from './write-session.js';
import { extractFeatures } from './recognizer-features.js';
import { loadRecognizer } from './recognizer.js';
import modelUrl from '../../assets/models/kana-writer.bin?url';

export { TIERS, tierForMastery } from './write-session.js';
export { glyphStrokes, hasGlyphStrokes } from './stroke-engine.js';
export {
  buildWritePool,
  createWritePrompt,
  kanjiGroups,
  lookedLikeNote,
  writeAnswerLabel,
  writeCueFor
} from './write-data.js';

// Canvas colors mirror the styles.css tokens (canvas can't read custom
// properties per-frame cheaply; update together if the palette shifts).
const COLOR = {
  ink: '#1a1815',
  ghost: 'rgba(26, 24, 21, 0.13)',
  guide: 'rgba(26, 24, 21, 0.1)',
  miss: '#c82117',
  hint: '#9b6a16',
  start: '#2e6e4e'
};

const SNAP_MS = 170;
const MISS_MS = 320;
const HINT_LOOP_MS = 1100;
const HINT_LOOPS = 2;
const MIN_POINT_DISTANCE = 1.4; // css px between recorded ink points

function prefersReducedMotion() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function cumulativeLengths(points) {
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(
      lengths[index - 1] +
        Math.hypot(
          points[index][0] - points[index - 1][0],
          points[index][1] - points[index - 1][1]
        )
    );
  }
  return lengths;
}

// First `t` (0..1 of arc length) of a polyline, for dash-draw animations.
function partialPolyline(points, t) {
  if (t >= 1 || points.length < 2) {
    return points;
  }
  const lengths = cumulativeLengths(points);
  const target = lengths[lengths.length - 1] * t;
  const out = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    if (lengths[index] <= target) {
      out.push(points[index]);
      continue;
    }
    const span = lengths[index] - lengths[index - 1];
    const local = span < 1e-9 ? 0 : (target - lengths[index - 1]) / span;
    out.push([
      points[index - 1][0] + (points[index][0] - points[index - 1][0]) * local,
      points[index - 1][1] + (points[index][1] - points[index - 1][1]) * local
    ]);
    break;
  }
  return out;
}

// Midpoint-quadratic smoothing turns the quantized polylines back into
// calm curves; round caps/joins give the ink its pen weight.
function tracePolyline(ctx, points, scale) {
  ctx.beginPath();
  ctx.moveTo(points[0][0] * scale, points[0][1] * scale);
  if (points.length === 2) {
    ctx.lineTo(points[1][0] * scale, points[1][1] * scale);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const midX = ((points[index][0] + points[index + 1][0]) / 2) * scale;
      const midY = ((points[index][1] + points[index + 1][1]) / 2) * scale;
      ctx.quadraticCurveTo(points[index][0] * scale, points[index][1] * scale, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0] * scale, last[1] * scale);
  }
  ctx.stroke();
}

function strokeStyle(ctx, { color, alpha, width }) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function setupCanvas(canvas) {
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!context) {
    return null; // jsdom / test environments: state machine still works
  }
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
  const side = canvas.clientWidth || canvas.offsetWidth || 300;
  const px = Math.max(1, Math.round(side * dpr));
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, side };
}

// ---------------------------------------------------------------------------
// Reveal player: animates the canonical stroke order on a stage canvas.

export function createStrokePlayer(canvas) {
  let strokes = null;
  let frame = null;
  let playToken = 0;

  function stop() {
    playToken += 1;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  function renderUpTo(strokeIndex, t) {
    const setup = setupCanvas(canvas);
    if (!setup || !strokes) {
      return;
    }
    const { context, side } = setup;
    context.clearRect(0, 0, side, side);
    const width = Math.max(4, side * 0.052);

    for (let index = 0; index < strokes.length; index += 1) {
      if (index > strokeIndex) {
        break;
      }
      const portion = index < strokeIndex ? strokes[index] : partialPolyline(strokes[index], t);
      if (portion.length >= 2) {
        strokeStyle(context, { color: COLOR.ink, alpha: 1, width });
        tracePolyline(context, portion, side);
      }
    }
    context.globalAlpha = 1;
  }

  function play() {
    stop();
    if (!strokes || strokes.length === 0) {
      return;
    }
    if (prefersReducedMotion()) {
      renderUpTo(strokes.length - 1, 1);
      return;
    }

    const token = playToken;
    const gap = 90;
    const plan = strokes.map((stroke) => {
      const lengths = cumulativeLengths(stroke);
      return 110 + lengths[lengths.length - 1] * 520;
    });

    let strokeIndex = 0;
    let strokeStart = null;

    function tick(now) {
      if (token !== playToken) {
        return;
      }
      if (strokeStart === null) {
        strokeStart = now;
      }
      const elapsed = now - strokeStart;
      const duration = plan[strokeIndex];

      if (elapsed >= duration + gap) {
        strokeIndex += 1;
        strokeStart = now;
        if (strokeIndex >= strokes.length) {
          renderUpTo(strokes.length - 1, 1);
          frame = null;
          return;
        }
      }
      renderUpTo(strokeIndex, Math.min(elapsed / duration, 1));
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
  }

  return {
    setGlyph(glyph) {
      stop();
      strokes = glyphStrokes(glyph);
      renderUpTo(-1, 0);
    },
    play,
    renderFinal() {
      stop();
      if (strokes) {
        renderUpTo(strokes.length - 1, 1);
      }
    },
    clear() {
      stop();
      strokes = null;
      const setup = setupCanvas(canvas);
      if (setup) {
        setup.context.clearRect(0, 0, setup.side, setup.side);
      }
    },
    stop
  };
}

// ---------------------------------------------------------------------------
// Recognizer plumbing

let recognizerStart = null;

export function warmRecognizer() {
  if (!recognizerStart) {
    recognizerStart = loadRecognizer(modelUrl).catch(() => null);
  }
  return recognizerStart;
}

// Classify with a deadline so a slow/failed model download never wedges the
// drill — grading falls back to geometric matching (write-session handles it).
async function classifyWithDeadline(strokes, deadlineMs = 1600) {
  const recognizer = await Promise.race([
    warmRecognizer(),
    new Promise((resolve) => setTimeout(() => resolve(null), deadlineMs))
  ]);
  if (!recognizer) {
    return null;
  }
  const { top } = recognizer.classify(extractFeatures(strokes), 5);
  return {
    top,
    equivalent: recognizer.equivalent,
    homoglyphTwins: recognizer.homoglyphTwins
  };
}

// ---------------------------------------------------------------------------
// The drill

export function createWriteDrill({ canvas, onEvent }) {
  let session = null;
  let inkPoints = null; // current in-progress stroke, unit coords
  let activePointer = null;
  let animations = []; // { kind, points, start, duration, loops? }
  let hintState = null; // { stroke, until } while pulsing
  let frame = null;
  let disposed = false;
  let completing = false;
  let showGhost = false;
  let side = 0; // last painted canvas size (css px)
  let gestureSide = 1; // canvas size captured at pointerdown, for ink filtering

  const reduceMotion = prefersReducedMotion();

  function emit(event) {
    if (onEvent) {
      onEvent(event);
    }
  }

  function unitFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(rect.width, 1);
    return [
      Math.min(Math.max((event.clientX - rect.left) / size, -0.2), 1.2),
      Math.min(Math.max((event.clientY - rect.top) / size, -0.2), 1.2)
    ];
  }

  function inkWidth() {
    return Math.max(4, side * 0.046);
  }

  function drawGuides(ctx) {
    ctx.save();
    ctx.strokeStyle = COLOR.guide;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(side / 2, 6);
    ctx.lineTo(side / 2, side - 6);
    ctx.moveTo(6, side / 2);
    ctx.lineTo(side - 6, side / 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawStartMarker(ctx) {
    if (!session || session.tier === 'recall' || session.isComplete() || session.finished) {
      return;
    }
    const next = session.remainingStrokes()[0];
    if (!next || next.length === 0) {
      return;
    }
    const [x, y] = next[0];
    const radius = Math.max(4.5, inkWidth() * 0.62);

    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = COLOR.start;
    ctx.beginPath();
    ctx.arc(x * side, y * side, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = COLOR.start;
    ctx.globalAlpha = 0.95;
    const label = String(session.drawnCount() + 1);
    const lx = x * side + radius + 4;
    const ly = y * side - radius - 2;
    ctx.fillText(label, Math.min(lx, side - 12), Math.max(ly, 10));
    ctx.restore();
  }

  function render(now = 0) {
    const setup = setupCanvas(canvas);
    if (!setup || !session) {
      return;
    }
    const { context } = setup;
    side = setup.side;
    context.clearRect(0, 0, side, side);

    drawGuides(context);

    const width = inkWidth();
    const referenceStrokes = session.strokes;

    if (showGhost || session.tier === 'trace') {
      for (const stroke of referenceStrokes) {
        strokeStyle(context, { color: COLOR.ink, alpha: 0.13, width });
        tracePolyline(context, stroke, side);
      }
    }

    // Settled strokes: canonical form for gated tiers, raw ink for recall.
    const settled =
      session.tier === 'recall'
        ? session.rawStrokes
        : referenceStrokes.slice(0, session.drawnCount());
    const snapping = animations.find((animation) => animation.kind === 'snap');

    settled.forEach((stroke, index) => {
      const isSnapping =
        snapping && session.tier !== 'recall' && index === session.drawnCount() - 1;
      if (isSnapping) {
        return; // drawn by the animation pass below
      }
      strokeStyle(context, { color: COLOR.ink, alpha: 1, width });
      tracePolyline(context, stroke, side);
    });

    // Animation passes.
    const stillRunning = [];
    for (const animation of animations) {
      const t = Math.min((now - animation.start) / animation.duration, 1);

      if (animation.kind === 'snap') {
        const reference = referenceStrokes[animation.index];
        // Raw ink dissolves while the canonical stroke sets in place.
        if (t < 1 && animation.points.length >= 2) {
          strokeStyle(context, { color: COLOR.ink, alpha: 0.55 * (1 - t), width });
          tracePolyline(context, animation.points, side);
        }
        if (reference) {
          strokeStyle(context, {
            color: COLOR.ink,
            alpha: 0.35 + 0.65 * t,
            width: width * (1.14 - 0.14 * t)
          });
          tracePolyline(context, partialPolyline(reference, 0.72 + 0.28 * t), side);
        }
      } else if (animation.kind === 'miss') {
        if (animation.points.length >= 2) {
          strokeStyle(context, {
            color: COLOR.miss,
            alpha: 0.5 * (1 - t),
            width: width * (1 - 0.25 * t)
          });
          tracePolyline(context, animation.points, side);
        }
      }

      if (t < 1) {
        stillRunning.push(animation);
      }
    }
    animations = stillRunning;

    // Hint pulse: the expected stroke draws itself in amber, twice.
    if (hintState) {
      const elapsed = now - hintState.start;
      if (elapsed > HINT_LOOP_MS * HINT_LOOPS && !reduceMotion) {
        hintState = null;
      } else {
        const t = reduceMotion
          ? 1
          : Math.min(((elapsed % HINT_LOOP_MS) / HINT_LOOP_MS) * 1.18, 1);
        strokeStyle(context, { color: COLOR.hint, alpha: 0.62, width });
        tracePolyline(context, partialPolyline(hintState.stroke, t), side);
        const [hx, hy] = hintState.stroke[0];
        context.beginPath();
        context.globalAlpha = 0.8;
        context.fillStyle = COLOR.hint;
        context.arc(hx * side, hy * side, Math.max(4, width * 0.55), 0, Math.PI * 2);
        context.fill();
        if (reduceMotion && elapsed > 1600) {
          hintState = null;
        }
      }
    }

    drawStartMarker(context);

    // Current live ink on top of everything.
    if (inkPoints && inkPoints.length >= 2) {
      strokeStyle(context, { color: COLOR.ink, alpha: 0.85, width });
      tracePolyline(context, inkPoints, side);
    }

    context.globalAlpha = 1;

    if (animations.length > 0 || hintState) {
      scheduleFrame();
    }
  }

  function scheduleFrame() {
    if (frame || disposed) {
      return;
    }
    frame = requestAnimationFrame((now) => {
      frame = null;
      render(now);
    });
  }

  function redraw() {
    scheduleFrame();
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function startHint({ countsAsHint }) {
    if (!session || session.tier === 'recall' || session.isComplete() || session.finished) {
      return false;
    }
    const stroke = session.remainingStrokes()[0];
    if (!stroke) {
      return false;
    }
    if (countsAsHint) {
      session.markHint();
    }
    hintState = { stroke, start: now() };
    redraw();
    return countsAsHint;
  }

  // Recall finishes are async (recognizer); gated finishes are immediate.
  async function finishNow() {
    if (!session || session.finished || completing) {
      return;
    }
    completing = true;
    emit({ type: 'grading' });

    let classifyResult = null;
    if (session.tier === 'recall') {
      const drawn = session.rawStrokes.map((stroke) => stroke.map((point) => [...point]));
      classifyResult = await classifyWithDeadline(drawn);
    }

    const result = session.finish({
      classify: classifyResult ? () => classifyResult : null
    });
    completing = false;
    emit({ type: 'complete', result });
  }

  function handleStrokeEnd() {
    if (!session || !inkPoints) {
      return;
    }
    const points = inkPoints;
    inkPoints = null;

    if (points.length < 2) {
      redraw();
      return;
    }

    const event = session.attemptStroke(points);

    if (event.type === 'accept') {
      hintState = null;
      if (reduceMotion) {
        animations = [];
      } else {
        animations.push({
          kind: 'snap',
          index: event.index,
          points,
          start: now(),
          duration: SNAP_MS
        });
      }
      emit({ type: 'stroke', index: event.index, total: session.total });
      redraw();
      if (event.complete) {
        void finishNow();
      }
      return;
    }

    if (event.type === 'reject') {
      if (!reduceMotion) {
        animations.push({ kind: 'miss', points, start: now(), duration: MISS_MS });
      }
      emit({
        type: 'miss',
        verdict: event.verdict,
        matchedIndex: event.matchedIndex,
        expectedIndex: session.drawnCount()
      });
      if (event.autoHint) {
        startHint({ countsAsHint: false });
      }
      redraw();
      return;
    }

    if (event.type === 'ink') {
      emit({ type: 'stroke', index: event.index, total: session.total });
      redraw();
      if (event.complete) {
        void finishNow();
      }
    }
  }

  function onPointerDown(event) {
    if (!session || session.finished || completing || session.isComplete()) {
      return;
    }
    if (activePointer !== null) {
      return; // one stroke at a time; a second touch is ignored
    }
    activePointer = event.pointerId;
    if (typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // capture is best-effort (may throw for departed touches)
      }
    }
    // The gesture's pixel scale comes from the live rect, not the last paint
    // — a stroke that starts before the first rAF still filters correctly.
    gestureSide = Math.max(canvas.getBoundingClientRect().width, 1);
    inkPoints = [unitFromEvent(event)];
    emit({ type: 'ink-start' });
    event.preventDefault();
  }

  function appendPoint(event) {
    const point = unitFromEvent(event);
    const last = inkPoints[inkPoints.length - 1];
    const minDistance = MIN_POINT_DISTANCE / gestureSide;
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < minDistance) {
      return false;
    }
    inkPoints.push(point);
    return true;
  }

  function onPointerMove(event) {
    if (activePointer !== event.pointerId || !inkPoints) {
      return;
    }
    const events =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    let changed = false;
    for (const sample of events) {
      changed = appendPoint(sample) || changed;
    }
    if (!changed) {
      return;
    }

    // Live ink: draw just the fresh tail segment — no full redraw per move.
    const setup = setupCanvas(canvas);
    if (setup && inkPoints.length >= 2) {
      const { context } = setup;
      strokeStyle(context, { color: COLOR.ink, alpha: 0.85, width: inkWidth() });
      const a = inkPoints[inkPoints.length - 2];
      const b = inkPoints[inkPoints.length - 1];
      context.beginPath();
      context.moveTo(a[0] * setup.side, a[1] * setup.side);
      context.lineTo(b[0] * setup.side, b[1] * setup.side);
      context.stroke();
      context.globalAlpha = 1;
    }
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (activePointer !== event.pointerId) {
      return;
    }
    activePointer = null;
    handleStrokeEnd();
  }

  function onPointerCancel(event) {
    if (activePointer !== event.pointerId) {
      return;
    }
    activePointer = null;
    inkPoints = null;
    redraw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => redraw())
      : null;
  resizeObserver?.observe(canvas);

  return {
    setPrompt({ glyph, tier }) {
      const strokes = glyphStrokes(glyph);
      session = strokes
        ? createWriteSession({ glyph, strokes, tier })
        : null;
      inkPoints = null;
      animations = [];
      hintState = null;
      completing = false;
      showGhost = false;
      activePointer = null;
      warmRecognizer();
      redraw();
      return session !== null;
    },
    get session() {
      return session;
    },
    undo() {
      if (session?.undo()) {
        hintState = null;
        redraw();
        emit({ type: 'stroke', index: session.drawnCount() - 1, total: session.total });
        return true;
      }
      return false;
    },
    clear() {
      if (!session || session.finished) {
        return;
      }
      session.clearDrawing();
      inkPoints = null;
      animations = [];
      hintState = null;
      redraw();
      emit({ type: 'cleared' });
    },
    hint() {
      return startHint({ countsAsHint: true });
    },
    // Reveal = give up: ghost + demo; grading is capped to assisted.
    reveal() {
      if (!session || session.finished) {
        return;
      }
      session.markRevealed();
      showGhost = true;
      redraw();
    },
    finish() {
      return finishNow();
    },
    renderNow() {
      render(now());
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      resizeObserver?.disconnect();
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }
  };
}
