// Aural-mode waveform view: a dense hairline waveform on a dark player
// panel, after the sample-browser language of destruct.dev — thin mirrored
// bars where near-silence collapses to center dots, played bars flip to
// the accent, and a sharp playhead cursor drags a soft gradient wake.
//
// Motion principles (devouringdetails.com): the bars themselves are still —
// precision over bounce — so all playback motion lives in the sweep and
// cursor. A new syllable's silhouette prints in through per-bar
// critically-damped springs with a left→right stagger; interruptions
// (replay spam, prompt swaps, the lazy data chunk landing mid-clip)
// retarget mid-flight, and prefers-reduced-motion snaps every spring to
// its end state while keeping the informational sweep.

// The source buckets are 100 wide; every bucket gets its own hairline bar.
export const WAVEFORM_BAR_COUNT = 100;

// Source peaks sit on a noise floor of 12/100; remapping it to zero lets
// silent tails collapse into the dotted centerline instead of stub bars.
const SOURCE_FLOOR = 12;
const DOT_FLOOR = 0.045;

// Critically damped spring for the print-in — fast, no overshoot.
const STIFFNESS = 900;
const DAMPING = 60;
const MAX_FRAME_DT = 0.048;

// Print-in stagger: each bar picks up its target this many ms after its
// left neighbour (~300 ms across the stage, pacing the short clips).
const MORPH_STAGGER_MS = 3;

const SETTLE_EPSILON = 0.004;

// Trailing wake behind the cursor, as a fraction of the stage width.
const WAKE_WIDTH = 0.1;

// The panel mirrors the OS color scheme (the CSS swaps the panel ground
// via the same media query): muted ink hairlines with the metro blue on
// the light paper inset; warm off-white hairlines with a brightened blue
// on the near-black panel.
const PALETTES = {
  light: {
    idle: { r: 26, g: 24, b: 21, a: 0.3 },
    played: { r: 20, g: 102, b: 158, a: 1 },
    wakeAlpha: 0.12,
  },
  dark: {
    idle: { r: 250, g: 249, b: 246, a: 0.55 },
    played: { r: 92, g: 175, b: 232, a: 1 },
    wakeAlpha: 0.14,
  },
};

export function resampleWaveform(values, sampleCount = WAVEFORM_BAR_COUNT) {
  if (!Array.isArray(values) || values.length === 0) {
    return Array.from({ length: sampleCount }, () => DOT_FLOOR);
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index / Math.max(sampleCount - 1, 1)) * (values.length - 1),
    );
    const amplitude =
      ((values[sourceIndex] ?? SOURCE_FLOOR) - SOURCE_FLOOR) /
      (100 - SOURCE_FLOOR);
    return Math.max(DOT_FLOOR, Math.min(1, amplitude));
  });
}

function sweepColor(coverage, palette) {
  const { idle, played } = palette;
  const t = Math.min(1, Math.max(0, coverage));
  const r = Math.round(idle.r + (played.r - idle.r) * t);
  const g = Math.round(idle.g + (played.g - idle.g) * t);
  const b = Math.round(idle.b + (played.b - idle.b) * t);
  const a = Math.round((idle.a + (played.a - idle.a) * t) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function accentColor(palette, alpha = 1) {
  const { played } = palette;
  return `rgba(${played.r}, ${played.g}, ${played.b}, ${alpha})`;
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

  // The bar colors mirror the OS scheme alongside the CSS panel ground; a
  // scheme flip while the view sits idle repaints without any playback.
  let darkQuery = null;
  if (
    options.prefersDark === undefined &&
    typeof globalThis.matchMedia === "function"
  ) {
    darkQuery = globalThis.matchMedia("(prefers-color-scheme: dark)");
    darkQuery.addEventListener?.("change", () => draw());
  }
  const prefersDark =
    options.prefersDark ?? (() => Boolean(darkQuery?.matches));

  let rest = []; // settled bar amplitudes (0..1)
  let pendingRest = null; // staggered print-in targets not yet picked up
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

    // The playback clock stamps from frame timestamps only, so the sweep
    // and springs can never disagree about "now".
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

    let settled = pendingRest === null;

    for (let index = 0; index < rest.length; index += 1) {
      const target = rest[index];

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
    const cssHeight = canvas.clientHeight || canvas.offsetHeight || 44;
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

    const palette = prefersDark() ? PALETTES.dark : PALETTES.light;
    const halfHeight = height * 0.5;
    const xGap = width / barCount;
    // Hairline bars; round caps collapse silent buckets into center dots.
    ctx.lineWidth = Math.max(1, Math.min(2 * dpr, xGap * 0.45));
    ctx.lineCap = "round";

    for (let index = 0; index < barCount; index += 1) {
      const barX = (index + 0.5) * xGap;
      const amplitude = Math.min(1, Math.max(0, heights[index]));
      const barHeight = halfHeight * 0.92 * amplitude;
      const coverage = progress * barCount - index;
      ctx.strokeStyle = sweepColor(coverage, palette);
      ctx.beginPath();
      ctx.moveTo(barX, halfHeight - barHeight);
      ctx.lineTo(barX, halfHeight + barHeight);
      ctx.stroke();
    }

    // Playhead cursor with a trailing gradient wake, after destruct.dev's
    // sample rows. Only while the clip is actually sounding — the settled
    // all-accent state is the completion confirmation.
    if (playing && progress > 0) {
      const cursorX = progress * width;
      const wake = ctx.createLinearGradient(
        cursorX - WAKE_WIDTH * width,
        0,
        cursorX,
        0,
      );
      wake.addColorStop(0, accentColor(palette, 0));
      wake.addColorStop(1, accentColor(palette, palette.wakeAlpha));
      ctx.fillStyle = wake;
      ctx.fillRect(
        cursorX - WAKE_WIDTH * width,
        height * 0.025,
        WAKE_WIDTH * width,
        height * 0.95,
      );

      ctx.strokeStyle = accentColor(palette);
      ctx.lineWidth = Math.max(1, dpr);
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(cursorX, height * 0.025);
      ctx.lineTo(cursorX, height * 0.975);
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
    // (empty) view prints up from the dotted centerline.
    if (heights.length !== next.length) {
      heights = next.map((_, index) => heights[index] ?? DOT_FLOOR);
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
