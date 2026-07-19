import { describe, expect, it } from "vitest";
import {
  WAVEFORM_BAR_COUNT,
  createWaveformView,
  resampleWaveform,
} from "../src/waveform-view.js";

// Dark-scheme palette (the harness below pins the scheme to dark).
const IDLE = "rgba(250, 249, 246, 0.55)";
const PLAYED = "rgba(92, 175, 232, 1)";
// Light-scheme palette: muted ink hairlines, metro blue accent.
const IDLE_LIGHT = "rgba(26, 24, 21, 0.3)";
const PLAYED_LIGHT = "rgba(20, 102, 158, 1)";

function createStubCanvas() {
  const strokes = [];
  const fills = [];
  const ctx = {
    lineWidth: 0,
    lineCap: "butt",
    strokeStyle: "",
    fillStyle: null,
    clears: 0,
    clearRect() {
      this.clears += 1;
      strokes.length = 0;
      fills.length = 0;
    },
    beginPath() {
      this.pathStart = null;
    },
    moveTo(x, y) {
      this.pathStart = { x, y };
    },
    lineTo(x, y) {
      this.pathEnd = { x, y };
    },
    stroke() {
      strokes.push({
        style: this.strokeStyle,
        cap: this.lineCap,
        from: { ...this.pathStart },
        to: { ...this.pathEnd },
      });
    },
    createLinearGradient() {
      return { addColorStop() {}, isGradient: true };
    },
    fillRect(x, y, w, h) {
      fills.push({ style: this.fillStyle, x, y, w, h });
    },
  };

  return {
    clientWidth: 316,
    clientHeight: 44,
    offsetWidth: 316,
    offsetHeight: 44,
    width: 0,
    height: 0,
    getContext: () => ctx,
    ctx,
    strokes,
    fills,
  };
}

// Deterministic frame harness: the view schedules at most one frame at a
// time; tick() fires it with an explicit timestamp.
function createFrameHarness() {
  let pending = null;
  return {
    scheduleFrame(callback) {
      pending = callback;
      return 1;
    },
    cancelFrame() {
      pending = null;
    },
    tick(timestamp) {
      const callback = pending;
      pending = null;
      callback?.(timestamp);
    },
    hasPending() {
      return pending !== null;
    },
  };
}

function createHarnessView(canvas, extraOptions = {}) {
  const frames = createFrameHarness();
  const view = createWaveformView(canvas, {
    scheduleFrame: frames.scheduleFrame,
    cancelFrame: frames.cancelFrame,
    prefersReducedMotion: () => false,
    prefersDark: () => true,
    ...extraOptions,
  });
  return { view, frames };
}

function runUntilSettled(frames, from = 0, step = 16, maxMs = 4000) {
  let t = from;
  while (frames.hasPending() && t - from < maxMs) {
    t += step;
    frames.tick(t);
  }
  return t;
}

describe("resampleWaveform", () => {
  it("maps every source bucket to a hairline bar above the dot floor", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i === 0 ? 100 : 12));
    const bars = resampleWaveform(values);
    expect(bars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(bars[0]).toBe(1);
    // The 12/100 source noise floor collapses to the dotted centerline.
    expect(bars[50]).toBeCloseTo(0.045, 5);
    expect(Math.min(...bars)).toBeGreaterThan(0);
  });

  it("returns the dotted floor for missing data", () => {
    const bars = resampleWaveform(null);
    expect(bars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(new Set(bars)).toEqual(new Set([0.045]));
  });
});

describe("createWaveformView", () => {
  it("returns null without a canvas", () => {
    expect(createWaveformView(null)).toBeNull();
  });

  it("snaps to the target shape when animate is off", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    const bars = Array.from({ length: 8 }, (_, i) => 0.2 + i * 0.1);
    view.setBars(bars, { animate: false });

    expect(view.inspect().heights).toEqual(bars);
    expect(frames.hasPending()).toBe(false);
    expect(canvas.strokes).toHaveLength(8);
  });

  it("prints in a new shape through springs with a left-to-right stagger", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    const from = Array.from({ length: 12 }, () => 0.2);
    const to = Array.from({ length: 12 }, () => 0.9);
    view.setBars(from, { animate: false });
    view.setBars(to, { animate: true });

    expect(frames.hasPending()).toBe(true);
    frames.tick(0); // stamps the morph start
    frames.tick(16);

    const mid = view.inspect();
    // Early bars have started rising toward the new target; the last bar's
    // target has not been applied yet (stagger), so it is still at rest.
    expect(mid.rest[0]).toBe(0.9);
    expect(mid.rest[11]).toBe(0.2);
    expect(mid.heights[0]).toBeGreaterThan(0.2);

    runUntilSettled(frames, 16);
    const done = view.inspect();
    expect(done.rest).toEqual(to);
    for (const height of done.heights) {
      expect(height).toBeCloseTo(0.9, 1);
    }
    expect(frames.hasPending()).toBe(false);
  });

  it("sweeps playback color continuously across the boundary bar", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    view.setBars(Array.from({ length: 4 }, () => 0.5), {
      animate: false,
      duration: 400,
    });
    view.beginPlayback();
    frames.tick(1000); // stamps the playback clock
    frames.tick(1200); // halfway through the 400ms clip

    expect(view.inspect().progress).toBeCloseTo(0.5, 2);
    // progress 0.5 over 4 bars → coverage 2, 1, 0, -1: two bars fully
    // played (accent), the third untouched.
    expect(canvas.strokes[0].style).toBe(PLAYED);
    expect(canvas.strokes[1].style).toBe(PLAYED);
    expect(canvas.strokes[2].style).toBe(IDLE);

    frames.tick(1250); // progress 0.625 → coverage on bar 2 is 0.5, a blend
    const blended = canvas.strokes[2].style;
    expect(blended).not.toBe(IDLE);
    expect(blended).not.toBe(PLAYED);
  });

  it("draws the playhead cursor and wake only while playing", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    const rest = Array.from({ length: 10 }, () => 0.4);
    view.setBars(rest, { animate: false, duration: 1000 });
    view.beginPlayback();
    frames.tick(0);
    frames.tick(500);

    // Mid-clip: bars stay still (no ripple — precision over bounce), and
    // the cursor hairline + gradient wake are drawn past the bars.
    expect(view.inspect().heights).toEqual(rest);
    expect(canvas.fills).toHaveLength(1);
    expect(canvas.fills[0].style?.isGradient).toBe(true);
    const cursor = canvas.strokes.at(-1);
    expect(cursor.cap).toBe("butt");
    expect(cursor.style).toBe(PLAYED);
    expect(cursor.from.x).toBeCloseTo(cursor.to.x, 5);

    view.finishPlayback();
    expect(view.inspect().progress).toBe(1);
    runUntilSettled(frames, 500);

    // Settled: every bar accent, no cursor, loop shut down.
    expect(canvas.fills).toHaveLength(0);
    expect(canvas.strokes).toHaveLength(10);
    for (const stroke of canvas.strokes) {
      expect(stroke.style).toBe(PLAYED);
    }
    expect(frames.hasPending()).toBe(false);
  });

  it("resets the sweep without disturbing settled bars", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    view.setBars([0.5, 0.5], { animate: false, duration: 100 });
    view.beginPlayback();
    frames.tick(0);
    frames.tick(200);
    view.finishPlayback();
    runUntilSettled(frames, 200);

    view.resetPlayback();
    runUntilSettled(frames, 5000);
    expect(view.inspect().progress).toBe(0);
    expect(canvas.strokes[0].style).toBe(IDLE);
  });

  it("snaps the print-in under reduced motion while keeping the sweep", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas, {
      prefersReducedMotion: () => true,
    });

    view.setBars([0.2, 0.2, 0.2], { animate: true, duration: 300 });
    frames.tick(0);
    expect(view.inspect().heights).toEqual([0.2, 0.2, 0.2]);

    view.beginPlayback();
    frames.tick(100);
    frames.tick(250);
    // The informational sweep still advances, but no bar moves.
    expect(view.inspect().progress).toBeGreaterThan(0);
    expect(view.inspect().heights).toEqual([0.2, 0.2, 0.2]);
  });

  it("mirrors the light scheme with ink hairlines and the metro blue", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas, {
      prefersDark: () => false,
    });

    view.setBars([0.5, 0.5], { animate: false, duration: 100 });
    view.beginPlayback();
    frames.tick(0);
    frames.tick(50); // progress 0.5: first bar played, second idle

    expect(canvas.strokes[0].style).toBe(PLAYED_LIGHT);
    expect(canvas.strokes[1].style).toBe(IDLE_LIGHT);
    expect(canvas.strokes.at(-1).style).toBe(PLAYED_LIGHT); // cursor
  });

  it("clears to an empty canvas and stops animating", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    view.setBars([0.4, 0.6], { animate: false });
    view.clear();

    expect(view.inspect().heights).toEqual([]);
    expect(canvas.strokes).toHaveLength(0);
    expect(frames.hasPending()).toBe(false);
  });
});
