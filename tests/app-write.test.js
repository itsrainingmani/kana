import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { glyphStrokes } from "../src/write/stroke-engine.js";

class MockAudio {
  constructor(src) {
    this.src = src;
  }

  play() {
    return Promise.resolve();
  }
}

const APP_SCAFFOLD =
  readFileSync(join(process.cwd(), "index.html"), "utf8").match(
    /<main\b[\s\S]*?id="app"[\s\S]*<\/main>/,
  )?.[0] ?? "";

const CANVAS_SIDE = 300;

function mockCanvasContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    strokeStyle: "",
    fillStyle: "",
    globalAlpha: 1,
    lineWidth: 0,
    lineCap: "round",
    lineJoin: "round",
    font: "",
  };
}

async function waitFor(predicate, timeout = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function pointerEvent(type, x, y) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  return event;
}

// Draws a glyph's reference strokes onto the canvas as synthetic pointer
// input (unit coords × canvas size), stroke by stroke.
function drawGlyph(canvas, glyph) {
  for (const stroke of glyphStrokes(glyph)) {
    const [sx, sy] = stroke[0];
    canvas.dispatchEvent(pointerEvent("pointerdown", sx * CANVAS_SIDE, sy * CANVAS_SIDE));
    for (const [x, y] of stroke.slice(1)) {
      canvas.dispatchEvent(pointerEvent("pointermove", x * CANVAS_SIDE, y * CANVAS_SIDE));
    }
    const [ex, ey] = stroke[stroke.length - 1];
    canvas.dispatchEvent(pointerEvent("pointerup", ex * CANVAS_SIDE, ey * CANVAS_SIDE));
  }
}

describe("write mode", () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = APP_SCAFFOLD;
    localStorage.clear();
    globalThis.Audio = MockAudio;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCanvasContext());
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: CANVAS_SIDE,
      height: CANVAS_SIDE,
      top: 0,
      left: 0,
      right: CANVAS_SIDE,
      bottom: CANVAS_SIDE,
      x: 0,
      y: 0,
    }));
    // Deterministic prompts: always the first pool entry.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function enterWriteMode() {
    createApp(document.querySelector("#app"));
    document.querySelector('[data-mode="write"]').click();
    await waitFor(
      () =>
        document.querySelector('[data-slot="draw-block"]').dataset.loading ===
        "false",
    );
  }

  it("enters write mode: draw sheet, cue poster, station W, kanji sheets", async () => {
    await enterWriteMode();

    const drawBlock = document.querySelector('[data-slot="draw-block"]');
    expect(drawBlock.dataset.visible).toBe("true");
    expect(
      document.querySelector('[data-slot="typed-block"]').dataset.visible,
    ).toBe("false");

    // Default pool starts with hiragana あ (vowel column on by default).
    expect(
      document.querySelector('[data-slot="write-cue-main"]').textContent,
    ).toBe("A");
    expect(
      document.querySelector('[data-slot="write-cue-sub"]').textContent,
    ).toBe("ひらがな");
    expect(
      document.querySelector('[data-slot="station-code"]').textContent,
    ).toContain("STA. W-");

    // Kanji sheets built with the default first group active.
    const activeGroups = document.querySelectorAll(
      '[data-kanji-group][data-active="true"]',
    );
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0].dataset.kanjiGroup).toBe("g1:0");
    expect(
      document.querySelector('[data-kanji-sheet-count="g1"]').textContent,
    ).toBe("10/80 ON");

    // New character → trace tier with the ghost, ticks for each stroke.
    expect(document.querySelector('[data-slot="tier-en"]').textContent).toBe(
      "AUTO · TRACE",
    );
    expect(document.querySelectorAll(".stroke-tick")).toHaveLength(
      glyphStrokes("あ").length,
    );
  });

  it("completes a traced drawing and grades it as assisted", async () => {
    await enterWriteMode();
    const canvas = document.querySelector('[data-slot="draw-canvas"]');

    drawGlyph(canvas, "あ");

    await waitFor(
      () =>
        document.querySelector('[data-region="prompt"]').dataset.outcome !==
        "",
    );

    expect(
      document.querySelector('[data-region="prompt"]').dataset.outcome,
    ).toBe("assisted");
    expect(
      document.querySelector('[data-slot="status-answer"]').textContent,
    ).toBe("あ · A");
    // The reveal player takes the stage.
    expect(
      document.querySelector('[data-slot="write-reveal"]').dataset.visible,
    ).toBe("true");
    expect(
      document.querySelector('[data-slot="write-cue"]').dataset.visible,
    ).toBe("false");
  });

  it("keeps NEXT manual for assisted outcomes and advances on click", async () => {
    await enterWriteMode();
    const canvas = document.querySelector('[data-slot="draw-canvas"]');
    drawGlyph(canvas, "あ");
    await waitFor(
      () =>
        document.querySelector('[data-region="prompt"]').dataset.outcome ===
        "assisted",
    );

    const next = document.querySelector('[data-action="next"]');
    expect(next.hidden).toBe(false);
    next.click();

    expect(
      document.querySelector('[data-region="prompt"]').dataset.outcome,
    ).toBe("");
    expect(
      document.querySelector('[data-slot="write-cue"]').dataset.visible,
    ).toBe("true");
  });

  it("cycles assistance tiers and grades a guided run as correct", async () => {
    await enterWriteMode();

    const tierChip = document.querySelector('[data-action="cycle-tier"]');
    tierChip.click(); // auto → trace
    expect(document.querySelector('[data-slot="tier-en"]').textContent).toBe(
      "TRACE",
    );
    tierChip.click(); // trace → guided
    expect(document.querySelector('[data-slot="tier-en"]').textContent).toBe(
      "GUIDED",
    );

    drawGlyph(document.querySelector('[data-slot="draw-canvas"]'), "あ");
    await waitFor(
      () =>
        document.querySelector('[data-region="prompt"]').dataset.outcome !==
        "",
    );
    expect(
      document.querySelector('[data-region="prompt"]').dataset.outcome,
    ).toBe("correct");
  });

  it("shows stroke feedback for a wrong stroke and clears it on success", async () => {
    await enterWriteMode();
    const tierChip = document.querySelector('[data-action="cycle-tier"]');
    tierChip.click();
    tierChip.click(); // guided: no ghost, misses surface

    const canvas = document.querySelector('[data-slot="draw-canvas"]');
    // First stroke of あ drawn far away → reject note.
    canvas.dispatchEvent(pointerEvent("pointerdown", 10, 280));
    canvas.dispatchEvent(pointerEvent("pointermove", 80, 285));
    canvas.dispatchEvent(pointerEvent("pointerup", 80, 285));

    const note = document.querySelector('[data-slot="draw-note"]');
    expect(note.dataset.tone).toBe("miss");
    expect(note.textContent).toContain("ちがうかたち");

    drawGlyph(canvas, "あ");
    await waitFor(
      () =>
        document.querySelector('[data-region="prompt"]').dataset.outcome !==
        "",
    );
    // One miss is within the guided allowance.
    expect(
      document.querySelector('[data-region="prompt"]').dataset.outcome,
    ).toBe("correct");
  });

  it("toggles kanji groups into the pool and persists the selection", async () => {
    await enterWriteMode();

    const second = document.querySelector('[data-kanji-group="g1:1"]');
    second.click();
    expect(second.dataset.active).toBe("true");
    expect(
      document.querySelector('[data-kanji-sheet-count="g1"]').textContent,
    ).toBe("20/80 ON");
    expect(
      JSON.parse(localStorage.getItem("kana-trainer-session"))
        .selectedKanjiGroups,
    ).toEqual(["g1:0", "g1:1"]);

    document.querySelector('[data-kanji-toggle-none="g1"]').click();
    expect(
      document.querySelector('[data-kanji-sheet-count="g1"]').textContent,
    ).toBe("0/80 ON");
  });

  it("prompts kanji with meaning + readings when only kanji are enabled", async () => {
    localStorage.setItem(
      "kana-trainer-session",
      JSON.stringify({
        mode: "write",
        selectedRows: {
          "hiragana:core": [],
          "hiragana:combination": [],
          "katakana:core": [],
          "katakana:combination": [],
        },
        selectedKanjiGroups: ["g1:0"],
      }),
    );

    createApp(document.querySelector("#app"));
    await waitFor(
      () =>
        document.querySelector('[data-slot="draw-block"]').dataset.loading ===
        "false",
    );

    const main = document.querySelector('[data-slot="write-cue-main"]');
    expect(main.textContent.length).toBeGreaterThan(0);
    expect(main.textContent).toBe(main.textContent.toUpperCase());
    expect(
      document.querySelector('[data-slot="font-label"]').textContent,
    ).toContain("KANJI · GRADE 1");
  });

  it("REVEAL ghosts the character, plays the demo, and grades assisted", async () => {
    await enterWriteMode();

    document.querySelector('[data-action="reveal"]').click();
    expect(
      document.querySelector('[data-slot="write-reveal"]').dataset.visible,
    ).toBe("true");
    expect(document.querySelector('[data-slot="hint-chip"]').hidden).toBe(
      false,
    );

    drawGlyph(document.querySelector('[data-slot="draw-canvas"]'), "あ");
    await waitFor(
      () =>
        document.querySelector('[data-region="prompt"]').dataset.outcome !==
        "",
    );
    expect(
      document.querySelector('[data-region="prompt"]').dataset.outcome,
    ).toBe("assisted");
  });

  it("shows the empty state when nothing is selected for writing", async () => {
    localStorage.setItem(
      "kana-trainer-session",
      JSON.stringify({
        mode: "write",
        selectedRows: {
          "hiragana:core": [],
          "hiragana:combination": [],
          "katakana:core": [],
          "katakana:combination": [],
        },
        selectedKanjiGroups: [],
      }),
    );

    createApp(document.querySelector("#app"));
    await waitFor(
      () =>
        document.querySelector('[data-slot="draw-block"]').dataset.loading ===
        "false",
    );

    expect(document.querySelector('[data-slot="empty-state"]').hidden).toBe(
      false,
    );
  });
});
