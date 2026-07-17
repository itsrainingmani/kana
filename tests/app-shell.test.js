import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("app shell", () => {
  beforeEach(() => {
    document.body.innerHTML = APP_SCAFFOLD;
    localStorage.clear();
    MockAudio.instances = [];
    globalThis.Audio = MockAudio;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      setTransform: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineCap: "round",
    }));
  });

  it("renders the drill-first workspace with central controls and kana sheets", () => {
    createApp(document.querySelector("#app"));

    expect(document.querySelector('[data-region="prompt"]')).toBeTruthy();
    expect(document.querySelector('[data-region="controls"]')).toBeTruthy();
    expect(document.querySelector("[data-mode-group]")).toBeTruthy();
    expect(document.querySelector('[data-region="interaction"]')).toBeTruthy();
    expect(document.querySelector('[data-region="kana-sheets"]')).toBeTruthy();
    expect(document.querySelector("[data-settings-panel]")).toBeNull();
    expect(document.querySelector("[data-reference-panel]")).toBeNull();
  });

  it("places mode tabs above the drill and renders preview + name font toggles", () => {
    createApp(document.querySelector("#app"));

    const drill = document.querySelector(".drill-stage");
    const modePicker = document.querySelector("[data-mode-group]");
    const firstFontButton = document.querySelector("[data-font]");

    expect(
      drill?.compareDocumentPosition(modePicker ?? document.body) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      firstFontButton
        ?.querySelector(".font-toggle__preview")
        ?.textContent?.trim(),
    ).toBe("あア");
    expect(firstFontButton?.querySelector("small")?.textContent?.trim()).toBe(
      "Gothic",
    );
  });

  it("enhances the authored HTML scaffold instead of replacing the app root", () => {
    const root = document.querySelector("#app");
    const promptRegion = document.querySelector('[data-region="prompt"]');

    createApp(root);

    expect(document.querySelector("#app")).toBe(root);
    expect(document.querySelector('[data-region="prompt"]')).toBe(promptRegion);
    expect(root?.getAttribute("data-enhanced")).toBe("true");
  });

  it("shows a live kana prompt by default", () => {
    createApp(document.querySelector("#app"));

    expect(
      document.querySelector(".poster-kana")?.textContent?.trim(),
    ).not.toBe("");
    expect(document.querySelector("[data-answer-input]")).toBeTruthy();
    expect(
      document
        .querySelector(".audio-poster-button")
        ?.getAttribute("data-visible"),
    ).toBe("false");
    expect(
      document
        .querySelector("[data-answer-input]")
        ?.getAttribute("data-visible"),
    ).toBe("true");
    expect(
      document
        .querySelector("[data-choice-grid]")
        ?.getAttribute("data-visible"),
    ).toBe("false");
    expect(
      document
        .querySelector('[data-region="prompt"]')
        ?.getAttribute("data-has-audio"),
    ).toBe("false");
  });

  it("keeps removed drawing mode and the old setup section out of the v1 controls", () => {
    createApp(document.querySelector("#app"));

    const modeButtons = [...document.querySelectorAll("[data-mode]")].map(
      (button) => button.textContent?.toLowerCase() ?? "",
    );

    expect(modeButtons.some((text) => text.includes("visual"))).toBe(true);
    expect(modeButtons.some((text) => text.includes("aural"))).toBe(true);
    expect(modeButtons.some((text) => text.includes("sound to drawing"))).toBe(
      false,
    );
    expect(document.querySelector("[data-script-group]")).toBeNull();
    expect(document.querySelector("[data-group-group]")).toBeNull();
  });

  it("keeps kana-to-sound on the same prompt until the exact answer is typed", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    const initialPrompt = document.querySelector(".poster-kana")?.textContent;
    const input = document.querySelector("[data-answer-input]");

    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector(".poster-kana")?.textContent).toBe(
      initialPrompt,
    );

    input.value = "a";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector(".poster-kana")?.textContent).toBe(
      initialPrompt,
    );
    expect(
      document.querySelector(".prompt-status")?.textContent?.toLowerCase(),
    ).toContain("correct");

    randomSpy.mockRestore();
  });

  it("keeps the same answer-input element identity across renders in kana-to-sound mode", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    const input = document.querySelector("[data-answer-input]");
    expect(input).toBeTruthy();

    // Trigger an incorrect evaluation, which forces a re-render. The DOM
    // node identity must be preserved so the user's caret / IME composition
    // and active focus survive.
    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector("[data-answer-input]")).toBe(input);
    expect(document.querySelector("[data-answer-input]")?.value).toBe("x");

    // Switching to aural and back must also restore the same node, since
    // render() runs on every mode toggle.
    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector('[data-mode="kana-to-sound"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector("[data-answer-input]")).toBe(input);

    randomSpy.mockRestore();
  });

  it("shows an unresolved mismatch state without advancing or recording progress", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    createApp(document.querySelector("#app"));

    const initialPrompt = document.querySelector(".poster-kana")?.textContent;
    const input = document.querySelector("[data-answer-input]");

    input.value = "x";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector(".poster-kana")?.textContent).toBe(
      initialPrompt,
    );
    // Typing feedback shakes the field and marks the input — it never
    // paints the card-level outcome.
    expect(
      document
        .querySelector('[data-region="prompt"]')
        ?.getAttribute("data-outcome"),
    ).toBe("");
    expect(
      document.querySelector("[data-answer-input]")?.getAttribute("data-state"),
    ).toBe("incorrect");
    expect(
      document
        .querySelector("[data-answer-input]")
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      document
        .querySelector('[data-slot="prompt-status"]')
        ?.getAttribute("data-visible"),
    ).toBe("true");
    expect(
      document
        .querySelector('[data-slot="status-message"]')
        ?.textContent?.toLowerCase(),
    ).toContain("retype");
    expect(
      document.querySelector('[data-slot="stats-attempts"]')?.textContent,
    ).toBe("0");
    expect(
      document.querySelector('[data-slot="stats-correct"]')?.textContent,
    ).toBe("0");

    randomSpy.mockRestore();
  });

  it("plays audio from the reference without toggling the family column", async () => {
    createApp(document.querySelector("#app"));
    const kana = document.querySelector(
      '[data-reference-audio-id][data-reference-column-toggle-target="hiragana:core:vowels"]',
    );

    expect(
      document
        .querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')
        ?.getAttribute("data-column-active"),
    ).toBe("true");

    kana?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].src).toMatch(/^audio\/mp3\/.+\.mp3$/);
    expect(
      document
        .querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')
        ?.getAttribute("data-column-active"),
    ).toBe("true");
  });

  it("does not move focus to the romaji input when a family column is toggled", () => {
    createApp(document.querySelector("#app"));

    const rowToggle = document.querySelector(
      '[data-reference-column-toggle="hiragana:core:vowels"]',
    );
    const input = document.querySelector("[data-answer-input]");

    rowToggle?.focus();
    rowToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.activeElement).not.toBe(input);
    expect(
      document
        .querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')
        ?.getAttribute("data-column-active"),
    ).toBe("false");
  });

  it("does not animate the listen prompt waveform when reference audio is clicked", async () => {
    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(
      document
        .querySelector(".audio-poster-button")
        ?.getAttribute("data-audio-state"),
    ).toBe("playing");

    MockAudio.instances[0].finish();
    await Promise.resolve();

    expect(
      document
        .querySelector(".audio-poster-button")
        ?.getAttribute("data-audio-state"),
    ).toBe("idle");

    document
      .querySelector("[data-reference-audio-id]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(2);
    expect(
      document
        .querySelector(".audio-poster-button")
        ?.getAttribute("data-audio-state"),
    ).toBe("idle");
  });

  it("autoplays sound-to-kana prompts with six choices and waveform state", async () => {
    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(1);
    expect(document.querySelectorAll(".choice-card")).toHaveLength(6);
    expect(
      document
        .querySelector('[data-action="play-sound"]')
        ?.getAttribute("data-audio-state"),
    ).toBe("playing");
    expect(
      document.querySelector('[data-slot="waveform-canvas"]'),
    ).toBeTruthy();

    MockAudio.instances[0].finish();
    await Promise.resolve();

    expect(
      document
        .querySelector('[data-action="play-sound"]')
        ?.getAttribute("data-audio-state"),
    ).toBe("idle");
  });

  it("marks selected and correct choices after a sound-to-kana answer", async () => {
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
    const wrongChoiceId = wrongChoice?.getAttribute("data-choice");

    wrongChoice?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document
        .querySelector(`[data-choice="${wrongChoiceId}"]`)
        ?.getAttribute("data-state"),
    ).toBe("incorrect");
    expect(
      [...document.querySelectorAll(".choice-card")]
        .find(
          (button) =>
            button
              .querySelector(".choice-card__glyph")
              ?.textContent?.trim() === expectedGlyph,
        )
        ?.getAttribute("data-state"),
    ).toBe("correct");
    // Every choice captions its romaji after the answer (learning moment).
    expect(
      [...document.querySelectorAll(".choice-card")].every((button) =>
        Boolean(button.querySelector("small")),
      ),
    ).toBe(true);

    randomSpy.mockRestore();
  });

  it("clears the kana glyph from the prompt card in sound-to-kana mode", async () => {
    createApp(document.querySelector("#app"));

    document
      .querySelector('[data-mode="sound-to-kana"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await Promise.resolve();

    const promptGlyph = document.querySelector('[data-slot="prompt-glyph"]');

    expect(promptGlyph?.getAttribute("data-visible")).toBe("false");
    expect(promptGlyph?.textContent).toBe("");
    expect(
      document
        .querySelector('[data-region="prompt"]')
        ?.getAttribute("data-has-audio"),
    ).toBe("true");
  });

  it("sizes the combination matrix to the full family-column layout", () => {
    createApp(document.querySelector("#app"));

    const combinationHeaders = document.querySelectorAll(
      '[data-kana-sheet-matrix="hiragana:combination"] .kana-matrix__row--header .reference-column-toggle',
    );
    expect(combinationHeaders).toHaveLength(11);
    // Column headers are the 行 kana themselves with romaji beneath.
    expect(
      combinationHeaders[0]
        ?.querySelector(".reference-column-toggle__kana")
        ?.textContent?.trim(),
    ).toBe("き");
    expect(
      combinationHeaders[0]
        ?.querySelector(".reference-column-toggle__latin")
        ?.textContent?.trim(),
    ).toBe("k");
  });

  it("uses persistent kana sheets with fixed core and combination matrices", () => {
    createApp(document.querySelector("#app"));

    expect(document.querySelector('[data-kana-sheet="hiragana"]')).toBeTruthy();
    expect(document.querySelector('[data-kana-sheet="katakana"]')).toBeTruthy();
    expect(
      document.querySelector('[data-kana-sheet-matrix="hiragana:core"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-kana-sheet-matrix="katakana:core"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-kana-sheet-matrix="hiragana:combination"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-reference-column-toggle="hiragana:core:vowels"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-reference-column-toggle="hiragana:core:nn"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-group-toggle-all="hiragana:core"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-group-toggle-none="hiragana:core"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(
        '[data-reference-column-toggle="hiragana:combination:d"]',
      ),
    ).toBeNull();
  });

  it("supports matrix-level check-all and uncheck-all actions inside the kana sheets", () => {
    createApp(document.querySelector("#app"));

    const katakanaBaseAll = document.querySelector(
      '[data-group-toggle-all="katakana:core"]',
    );

    katakanaBaseAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document
        .querySelector('[data-reference-column-toggle="katakana:core:vowels"]')
        ?.getAttribute("data-column-active"),
    ).toBe("true");
    expect(
      document
        .querySelector('[data-reference-column-toggle="katakana:core:k"]')
        ?.getAttribute("data-column-active"),
    ).toBe("true");

    document
      .querySelector('[data-group-toggle-none="hiragana:core"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      document
        .querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')
        ?.getAttribute("data-column-active"),
    ).toBe("false");
  });
});
