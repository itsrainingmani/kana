import { describe, expect, it } from "vitest";
import {
  WAVEFORM_BAR_COUNT,
  createWaveformView,
  resampleWaveform,
} from "../src/waveform-view.js";

function createStubCanvas() {
  const strokes = [];
  const ctx = {
    lineWidth: 0,
    lineCap: "butt",
    strokeStyle: "",
    clears: 0,
    clearRect() {
      this.clears += 1;
      strokes.length = 0;
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
        from: { ...this.pathStart },
        to: { ...this.pathEnd },
      });
    },
  };

  return {
    clientWidth: 250,
    clientHeight: 64,
    offsetWidth: 250,
    offsetHeight: 64,
    width: 0,
    height: 0,
    getContext: () => ctx,
    ctx,
    strokes,
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
  it("downsamples to the signage bar count with a quiet floor", () => {
    const bars = resampleWaveform([100, 50, 0, 12]);
    expect(bars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(bars[0]).toBe(1);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(0.12);
  });

  it("returns the flat floor for missing data", () => {
    const bars = resampleWaveform(null);
    expect(bars).toHaveLength(WAVEFORM_BAR_COUNT);
    expect(new Set(bars)).toEqual(new Set([0.12]));
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

  it("morphs to a new shape through springs with a left-to-right stagger", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    const from = Array.from({ length: 12 }, () => 0.2);
    const to = Array.from({ length: 12 }, () => 0.9);
    view.setBars(from, { animate: false });
    view.setBars(to, { animate: true });

    expect(frames.hasPending()).toBe(true);
    frames.tick(0); // stamps the morph start
    frames.tick(32);

    const mid = view.inspect();
    // Early bars have started rising toward the new target; the last bar's
    // target has not been applied yet (stagger), so it is still at rest.
    expect(mid.rest[0]).toBe(0.9);
    expect(mid.rest[11]).toBe(0.2);
    expect(mid.heights[0]).toBeGreaterThan(0.2);

    runUntilSettled(frames, 32);
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
    // played (metro blue), the third untouched.
    expect(canvas.strokes[0].style).toBe("rgba(20, 102, 158, 1)");
    expect(canvas.strokes[1].style).toBe("rgba(20, 102, 158, 1)");
    expect(canvas.strokes[2].style).toBe("rgba(26, 24, 21, 0.28)");

    frames.tick(1250); // progress 0.625 → coverage on bar 2 is 0.5, a blend
    const blended = canvas.strokes[2].style;
    expect(blended).not.toBe("rgba(26, 24, 21, 0.28)");
    expect(blended).not.toBe("rgba(20, 102, 158, 1)");
  });

  it("lifts bars near the playhead and settles after finishPlayback", () => {
    const canvas = createStubCanvas();
    const { view, frames } = createHarnessView(canvas);

    const rest = Array.from({ length: 10 }, () => 0.4);
    view.setBars(rest, { animate: false, duration: 1000 });
    view.beginPlayback();
    frames.tick(0);
    for (let t = 16; t <= 500; t += 16) {
      frames.tick(t);
    }

    // Mid-clip, the bar under the playhead has been excited above rest.
    const playingState = view.inspect();
    const head = Math.round(playingState.progress * 10 - 0.5);
    expect(playingState.heights[head]).toBeGreaterThan(0.45);

    view.finishPlayback();
    expect(view.inspect().progress).toBe(1);
    runUntilSettled(frames, 500);

    const settledState = view.inspect();
    expect(settledState.playing).toBe(false);
    for (const height of settledState.heights) {
      expect(height).toBeCloseTo(0.4, 1);
    }
    // The loop shuts itself down once the wake dies out.
    expect(frames.hasPending()).toBe(false);
    // Every bar is painted as played.
    for (const stroke of canvas.strokes) {
      expect(stroke.style).toBe("rgba(20, 102, 158, 1)");
    }
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
    expect(canvas.strokes[0].style).toBe("rgba(26, 24, 21, 0.28)");
  });

  it("snaps morphs and skips the ripple under reduced motion", () => {
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
    // The informational sweep still advances, but no bar leaves its rest
    // height.
    expect(view.inspect().progress).toBeGreaterThan(0);
    expect(view.inspect().heights).toEqual([0.2, 0.2, 0.2]);
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
