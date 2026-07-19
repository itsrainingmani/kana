// Aural-mode waveform view: chunky signage bars driven by per-bar springs.
//
// Redesign notes (interaction principles per devouringdetails.com):
// - Proportional response: playback paints a continuous sub-bar sweep and
//   bars physically lift as the playhead passes them — the sign responds to
//   sound moving through it, not just a stepped color fill.
// - Springs over durations: every bar height runs through its own damped
//   spring, so replay spam, prompt swaps, and late-arriving waveform data
//   all retarget mid-flight without a visible cut.
// - Choreography: a new syllable's silhouette arrives as a left-to-right
//   staggered morph — nothing moves in perfect concert.
// - Restraint: idle is static, the settled all-blue state is the only
//   completion confirmation, and prefers-reduced-motion snaps every spring
//   to its end state while keeping the informational progress sweep.

export const WAVEFORM_BAR_COUNT = 36;

const REST_FLOOR = 0.12;

// Spring tuned for the ~250–700 ms clips: stiff enough for the ripple to
// keep up with the playhead, damped low enough to leave a small wake.
const STIFFNESS = 380;
const DAMPING = 26;
const MAX_FRAME_DT = 0.048;

// How far neighbouring bars lift as the playhead passes (gaussian falloff
// measured in bar-index space).
const EXCITE_GAIN = 0.6;
const EXCITE_SIGMA = 1.5;

// New-syllable morph: each bar picks up its new target this many ms after
// its left neighbour.
const MORPH_STAGGER_MS = 9;

const SETTLE_EPSILON = 0.004;

// Idle bars are muted ink; played bars are the metro blue (#14669e). The
// boundary bar blends by sub-bar coverage so the sweep never steps.
const IDLE_COLOR = { r: 26, g: 24, b: 21, a: 0.28 };
const PLAYED_COLOR = { r: 20, g: 102, b: 158, a: 1 };

export function resampleWaveform(values, sampleCount = WAVEFORM_BAR_COUNT) {
  if (!Array.isArray(values) || values.length === 0) {
    return Array.from({ length: sampleCount }, () => REST_FLOOR);
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index / Math.max(sampleCount - 1, 1)) * (values.length - 1),
    );
    return Math.max(REST_FLOOR, (values[sourceIndex] ?? 12) / 100);
  });
}

function sweepColor(coverage) {
  const t = Math.min(1, Math.max(0, coverage));
  const r = Math.round(IDLE_COLOR.r + (PLAYED_COLOR.r - IDLE_COLOR.r) * t);
  const g = Math.round(IDLE_COLOR.g + (PLAYED_COLOR.g - IDLE_COLOR.g) * t);
  const b = Math.round(IDLE_COLOR.b + (PLAYED_COLOR.b - IDLE_COLOR.b) * t);
  const a =
    Math.round((IDLE_COLOR.a + (PLAYED_COLOR.a - IDLE_COLOR.a) * t) * 1000) /
    1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

let reducedMotionQuery = null;

function defaultPrefersReducedMotion() {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }

  reducedMotionQuery ??= globalThis.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  return Boolean(reducedMotionQuery.matches);
}

export function createWaveformView(canvas, options = {}) {
  if (!canvas) {
    return null;
  }

  const scheduleFrame =
    options.scheduleFrame ??
    (typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => setTimeout(() => callback(Date.now()), 16));
  const cancelFrame =
    options.cancelFrame ??
    (typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : clearTimeout);
  const prefersReducedMotion =
    options.prefersReducedMotion ?? defaultPrefersReducedMotion;

  let rest = []; // settled bar amplitudes (0..1)
  let pendingRest = null; // staggered morph targets not yet picked up
  let morphStartedAt = null; // null = stamps on the next frame
  let heights = [];
  let velocities = [];

  let playing = false;
  let progress = 0;
  let duration = 0;
  let startedAt = null; // null = stamps on the next frame after beginPlayback
  let frame = null;
  let lastTick = null;

  function ensureRunning() {
    if (frame === null) {
      lastTick = null;
      frame = scheduleFrame(step);
    }
  }

  function stopLoop() {
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    lastTick = null;
  }

  function step(timestamp) {
    frame = null;
    const dt =
      lastTick === null
        ? 0
        : Math.min(MAX_FRAME_DT, Math.max(0, (timestamp - lastTick) / 1000));
    lastTick = timestamp;

    // The playback clock stamps from frame timestamps only, so springs and
    // the sweep can never disagree about "now".
    if (playing && startedAt === null) {
      startedAt = timestamp;
    }
    if (playing && duration > 0 && startedAt !== null) {
      progress = Math.min(1, Math.max(0, (timestamp - startedAt) / duration));
    }

    const reduced = prefersReducedMotion();

    if (pendingRest) {
      if (morphStartedAt === null) {
        morphStartedAt = timestamp;
      }
      let allApplied = true;
      for (let index = 0; index < pendingRest.length; index += 1) {
        if (reduced || timestamp - morphStartedAt >= index * MORPH_STAGGER_MS) {
          rest[index] = pendingRest[index];
        } else {
          allApplied = false;
        }
      }
      if (allApplied) {
        pendingRest = null;
        morphStartedAt = null;
      }
    }

    const head = progress * rest.length - 0.5;
    let settled = pendingRest === null;

    for (let index = 0; index < rest.length; index += 1) {
      let target = rest[index];

      if (playing && duration > 0 && !reduced) {
        const distance = index - head;
        const lift = Math.exp(
          -(distance * distance) / (2 * EXCITE_SIGMA * EXCITE_SIGMA),
        );
        target = Math.min(
          1.2,
          rest[index] + lift * EXCITE_GAIN * (0.2 + rest[index] * 0.8),
        );
      }

      if (reduced) {
        heights[index] = target;
        velocities[index] = 0;
      } else if (dt > 0) {
        velocities[index] +=
          (STIFFNESS * (target - heights[index]) - DAMPING * velocities[index]) *
          dt;
        heights[index] += velocities[index] * dt;
      }

      if (
        Math.abs(target - heights[index]) > SETTLE_EPSILON ||
        Math.abs(velocities[index]) > SETTLE_EPSILON * 10
      ) {
        settled = false;
      }
    }

    draw();

    if (playing || !settled) {
      frame = scheduleFrame(step);
    } else {
      lastTick = null;
    }
  }

  function draw() {
    const ctx =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;

    if (!ctx) {
      return;
    }

    const dpr = globalThis.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.offsetWidth || 250;
    const cssHeight = canvas.clientHeight || canvas.offsetHeight || 64;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.clearRect(0, 0, width, height);

    const barCount = heights.length;

    if (barCount === 0) {
      return;
    }

    const halfHeight = height * 0.5;
    const xGap = width / barCount;
    // 5px-wide bars with a 2px gap at the design's 250px stage width.
    ctx.lineWidth = Math.max(1.5, xGap * 0.72);
    ctx.lineCap = "round";

    for (let index = 0; index < barCount; index += 1) {
      const barX = (index + 0.5) * xGap;
      // Compressed toward the top so the loudest bars keep headroom for the
      // playhead ripple instead of clipping flat.
      const amplitude = Math.max(0, heights[index]);
      const barHeight = Math.min(
        halfHeight - dpr,
        halfHeight * 0.86 * Math.pow(amplitude, 0.8),
      );
      const coverage = progress * barCount - index;
      ctx.strokeStyle = sweepColor(coverage);
      ctx.beginPath();
      ctx.moveTo(barX, halfHeight - barHeight);
      ctx.lineTo(barX, halfHeight + barHeight);
      ctx.stroke();
    }
  }

  function setBars(nextBars, { duration: nextDuration = 0, animate = true } = {}) {
    const next = Array.isArray(nextBars) ? nextBars.slice() : [];
    duration = nextDuration;

    if (next.length === 0) {
      clear();
      return;
    }

    if (!animate || prefersReducedMotion()) {
      rest = next.slice();
      heights = next.slice();
      velocities = next.map(() => 0);
      pendingRest = null;
      morphStartedAt = null;
      draw();
      if (playing) {
        ensureRunning();
      }
      return;
    }

    // Springs pick up from wherever the previous shape left them; a fresh
    // (empty) view rises from the quiet floor instead of popping in.
    if (heights.length !== next.length) {
      heights = next.map((_, index) => heights[index] ?? REST_FLOOR);
      velocities = next.map((_, index) => velocities[index] ?? 0);
      rest = next.map((_, index) => rest[index] ?? heights[index]);
    }

    pendingRest = next;
    morphStartedAt = null;
    ensureRunning();
  }

  function beginPlayback() {
    playing = true;
    progress = 0;
    startedAt = null;
    draw();
    ensureRunning();
  }

  function finishPlayback() {
    playing = false;
    startedAt = null;
    progress = rest.length > 0 ? 1 : 0;
    draw();
    ensureRunning();
  }

  function resetPlayback() {
    playing = false;
    startedAt = null;
    progress = 0;
    if (rest.length > 0) {
      draw();
      ensureRunning();
    }
  }

  function clear() {
    rest = [];
    pendingRest = null;
    morphStartedAt = null;
    heights = [];
    velocities = [];
    playing = false;
    progress = 0;
    duration = 0;
    startedAt = null;
    stopLoop();
    draw();
  }

  function inspect() {
    return {
      playing,
      progress,
      duration,
      rest: rest.slice(),
      heights: heights.slice(),
      animating: frame !== null,
    };
  }

  return {
    setBars,
    beginPlayback,
    finishPlayback,
    resetPlayback,
    clear,
    draw,
    inspect,
  };
}
