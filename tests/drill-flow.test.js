import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { KANA_DATA } from "../src/kana-data.js";

class MockAudio {
  static instances = [];

  constructor(src) {
    this.src = src;
    this.preload = "none";
    MockAudio.instances.push(this);
  }

  play() {
    return Promise.resolve();
  }

  finish() {
    if (typeof this.onended === "function") {
      this.onended();
    }
  }
}

const APP_SCAFFOLD =
  readFileSync(join(process.cwd(), "index.html"), "utf8").match(
    /<main\b[\s\S]*?id="app"[\s\S]*<\/main>/,
  )?.[0] ?? "";

const FIRST_BASE_ROMAJI = KANA_DATA.find(
  (kana) => kana.script === "hiragana" && kana.group === "base",
)?.romaji;

function typeAnswer(value) {
  const input = document.querySelector("[data-answer-input]");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("drill flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = APP_SCAFFOLD;
    localStorage.clear();
    MockAudio.instances = [];
    globalThis.Audio = MockAudio;
    Element.prototype.scrollIntoView = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "round",
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-advances only after an unassisted correct answer", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("V-01");

    typeAnswer(FIRST_BASE_ROMAJI);

    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("correct");
    expect(
      document.querySelector('[data-slot="maru-stamp"]')?.hidden,
    ).toBe(false);

    vi.advanceTimersByTime(900);

    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("V-02");

    randomSpy.mockRestore();
  });

  it("waits for the user after a revealed answer and advances via NEXT", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-action="reveal"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("assisted");
    expect(document.querySelector('[data-slot="maru-stamp"]')?.hidden).toBe(
      true,
    );
    expect(document.querySelector('[data-action="next"]')?.hidden).toBe(false);

    vi.advanceTimersByTime(5000);

    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("V-01");

    document
      .querySelector('[data-action="next"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("V-02");

    randomSpy.mockRestore();
  });

  it("waits after a wrong aural pick and advances with Enter", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    const expectedGlyph = KANA_DATA.find(
      (kana) => kana.script === "hiragana" && kana.group === "base",
    )?.glyph;
    const wrongChoice = [...document.querySelectorAll(".choice-card")].find(
      (button) =>
        button.querySelector(".choice-card__glyph")?.textContent?.trim() !==
        expectedGlyph,
    );

    wrongChoice?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("incorrect");
    // The revealed target glyph replaces the waveform during feedback.
    expect(
      document.querySelector(".poster-kana")?.getAttribute("data-visible"),
    ).toBe("true");

    vi.advanceTimersByTime(5000);
    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("A-02");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(
      document.querySelector('[data-slot="station-code"]')?.textContent,
    ).toContain("A-03");

    randomSpy.mockRestore();
  });

  it("shows the HINT chip once Hear is used and grades the answer assisted", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    expect(document.querySelector('[data-slot="hint-chip"]')?.hidden).toBe(
      true,
    );

    document
      .querySelector('[data-region="hints"] [data-action="play-sound"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector('[data-slot="hint-chip"]')?.hidden).toBe(
      false,
    );

    typeAnswer(FIRST_BASE_ROMAJI);

    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("assisted");

    randomSpy.mockRestore();
  });

  it("selects the typed text and shakes on a wrong prefix instead of blocking", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    const input = document.querySelector("[data-answer-input]");
    const selectSpy = vi.spyOn(input, "select");

    typeAnswer("x");

    expect(selectSpy).toHaveBeenCalled();
    expect(input.getAttribute("data-shake")).toMatch(/^[ab]$/);
    expect(input.value).toBe("x");

    randomSpy.mockRestore();
  });

  it("counts a streak of unassisted correct answers and resets on a miss", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    typeAnswer(FIRST_BASE_ROMAJI);

    expect(
      document.querySelector('[data-slot="streak-count"]')?.textContent,
    ).toBe("1");
    expect(
      document.querySelector('[data-slot="streak"]')?.getAttribute(
        "data-active",
      ),
    ).toBe("true");

    vi.advanceTimersByTime(900);
    typeAnswer(FIRST_BASE_ROMAJI);

    expect(
      document.querySelector('[data-slot="streak-count"]')?.textContent,
    ).toBe("2");

    // A wrong aural pick resets the streak to zero.
    vi.advanceTimersByTime(900);
    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    const expectedGlyph = KANA_DATA.find(
      (kana) => kana.script === "hiragana" && kana.group === "base",
    )?.glyph;
    const wrongChoice = [...document.querySelectorAll(".choice-card")].find(
      (button) =>
        button.querySelector(".choice-card__glyph")?.textContent?.trim() !==
        expectedGlyph,
    );
    wrongChoice?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document.querySelector('[data-slot="streak-count"]')?.textContent,
    ).toBe("0");
    expect(
      document.querySelector('[data-slot="streak"]')?.getAttribute(
        "data-active",
      ),
    ).toBe("false");

    randomSpy.mockRestore();
  });

  it("answers aural prompts with the number keys and replays with R", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    const autoplayCount = MockAudio.instances.length;

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", bubbles: true }),
    );
    await Promise.resolve();

    expect(MockAudio.instances.length).toBe(autoplayCount + 1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", bubbles: true }),
    );

    expect(
      document
        .querySelector('[data-slot="prompt-status"]')
        ?.getAttribute("data-visible"),
    ).toBe("true");

    randomSpy.mockRestore();
  });

  it("plays the prompt audio when the glyph is tapped and marks the hint", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    expect(document.querySelector('[data-slot="hint-chip"]')?.hidden).toBe(
      true,
    );

    document
      .querySelector('[data-slot="prompt-glyph"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(MockAudio.instances).toHaveLength(1);
    expect(document.querySelector('[data-slot="hint-chip"]')?.hidden).toBe(
      false,
    );

    typeAnswer(FIRST_BASE_ROMAJI);

    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("assisted");

    randomSpy.mockRestore();
  });

  it("replays the answer audio with R or a glyph tap during feedback", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    typeAnswer(FIRST_BASE_ROMAJI);
    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("correct");
    expect(MockAudio.instances).toHaveLength(0);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", bubbles: true }),
    );
    expect(MockAudio.instances).toHaveLength(1);

    document
      .querySelector('[data-slot="prompt-glyph"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(MockAudio.instances).toHaveLength(2);

    // Replaying never counts as a hint after grading.
    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.getAttribute("data-tone"),
    ).toBe("correct");

    randomSpy.mockRestore();
  });

  it("patches the choice cards in place on feedback instead of rebuilding them", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    const firstCard = document.querySelector(".choice-card");
    const grid = document.querySelector("[data-choice-grid]");

    // Captions occupy their slot from the start; only their visibility flips.
    expect(firstCard?.querySelector("small")).toBeTruthy();
    expect(grid?.getAttribute("data-show-romaji")).toBe("false");

    firstCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Same node identity → the state color transition can actually run.
    expect(document.querySelector(".choice-card")).toBe(firstCard);
    expect(grid?.getAttribute("data-show-romaji")).toBe("true");
    expect(firstCard?.getAttribute("data-state")).not.toBe("idle");

    randomSpy.mockRestore();
  });

  it("patches the study sheets in place across renders", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    const toggle = document.querySelector(
      '[data-reference-column-toggle="hiragana:core:k"]',
    );
    expect(toggle?.getAttribute("data-column-active")).toBe("true");

    // A typing render must not rebuild the ~500 sheet buttons.
    typeAnswer("x");
    expect(
      document.querySelector('[data-reference-column-toggle="hiragana:core:k"]'),
    ).toBe(toggle);

    // Toggling still updates the patched attributes and counters.
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(toggle?.getAttribute("data-column-active")).toBe("false");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(
      document.querySelector('[data-kana-sheet-count="hiragana"]')?.textContent,
    ).toBe("41/104 ON");
    expect(
      document.querySelector(
        '[data-reference-column-toggle="hiragana:core:k"]',
      ),
    ).toBe(toggle);

    randomSpy.mockRestore();
  });

  it("offers a route out of the empty state", () => {
    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-group-toggle-none="hiragana:core"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector('[data-slot="empty-state"]')?.hidden).toBe(
      false,
    );
    expect(
      document.querySelector('[data-slot="script-label"]')?.textContent,
    ).toBe("NONE");

    document
      .querySelector('[data-action="goto-sheets"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
