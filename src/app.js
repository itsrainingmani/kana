import { createAudioClipMap, playKanaAudio } from "./audio.js";
import { FONT_OPTIONS, KANA_DATA } from "./kana-data.js";
import {
  buildEnabledKanaSet,
  createKanaSelectionMatrices,
  createKanaToSoundPrompt,
  createRotatingFontSequence,
  createSoundToKanaPrompt,
  getMasteryLabel,
  gradeKanaToSoundAnswer,
  gradeSoundToKanaAnswer,
  normalizeRomaji,
} from "./prompts.js";
import { createProgressStore, createSessionStore } from "./storage.js";

// WAVEFORM_DATA is ~22 KB and is only used by the sound-to-kana waveform
// render. Defer the import until that mode is first engaged so the initial
// load for visual drills doesn't pay the cost.
let waveformData = null;
let waveformPromise = null;

function ensureWaveformsLoaded() {
  if (waveformData || waveformPromise) {
    return waveformPromise ?? Promise.resolve(waveformData);
  }

  waveformPromise = import("./waveforms.js")
    .then((module) => {
      waveformData = module.WAVEFORM_DATA;
      return waveformData;
    })
    .catch(() => {
      waveformPromise = null;
      return null;
    });

  return waveformPromise;
}

const MODE_LETTERS = {
  "kana-to-sound": "V",
  "sound-to-kana": "A",
};

// Outcome word pairs for the status line. Vermillion is the positive mark
// here (marubatsu grading): correct = せいかい, revealed = amber こたえ,
// incorrect = ink ざんねん.
const STATUS_THEMES = {
  correct: { jp: "せいかい", en: "CORRECT" },
  assisted: { jp: "こたえ", en: "REVEALED" },
  incorrect: { jp: "ざんねん", en: "NOT QUITE" },
};

const TYPING_THEME = { jp: "ちがう", en: "NOT THAT SOUND — RETYPE" };

const SCRIPT_LABELS = {
  hiragana: "HIRAGANA",
  katakana: "KATAKANA",
  mixed: "MIXED",
  none: "NONE",
};

const SHEET_INFO = {
  hiragana: { jp: "ひらがな", en: "HIRAGANA", badge: "ひ" },
  katakana: { jp: "カタカナ", en: "KATAKANA", badge: "カ" },
};

const MATRIX_LABELS = {
  core: { jp: "五十音・濁音", en: "CORE KANA" },
  combination: { jp: "拗音", en: "COMBINATIONS" },
};

// Column headers are the 行 kana themselves ([hiragana, katakana, romaji]),
// script-matched per sheet.
const COLUMN_HEADS = {
  core: {
    vowels: ["あ", "ア", "a"],
    k: ["か", "カ", "k"],
    s: ["さ", "サ", "s"],
    t: ["た", "タ", "t"],
    n: ["な", "ナ", "n"],
    h: ["は", "ハ", "h"],
    m: ["ま", "マ", "m"],
    y: ["や", "ヤ", "y"],
    r: ["ら", "ラ", "r"],
    w: ["わ", "ワ", "w"],
    nn: ["ん", "ン", "n"],
    g: ["が", "ガ", "g"],
    z: ["ざ", "ザ", "z"],
    d: ["だ", "ダ", "d"],
    b: ["ば", "バ", "b"],
    p: ["ぱ", "パ", "p"],
  },
  combination: {
    k: ["き", "キ", "k"],
    s: ["し", "シ", "s"],
    t: ["ち", "チ", "t"],
    n: ["に", "ニ", "n"],
    h: ["ひ", "ヒ", "h"],
    m: ["み", "ミ", "m"],
    r: ["り", "リ", "r"],
    g: ["ぎ", "ギ", "g"],
    z: ["じ", "ジ", "z"],
    b: ["び", "ビ", "b"],
    p: ["ぴ", "ピ", "p"],
  },
};

const SHEET_GROUP_ROWS = {
  "hiragana:core": [
    "vowels",
    "k",
    "s",
    "t",
    "n",
    "h",
    "m",
    "y",
    "r",
    "w",
    "nn",
    "g",
    "z",
    "d",
    "b",
    "p",
  ],
  "hiragana:combination": [
    "k",
    "s",
    "t",
    "n",
    "h",
    "m",
    "r",
    "g",
    "z",
    "b",
    "p",
  ],
  "katakana:core": [
    "vowels",
    "k",
    "s",
    "t",
    "n",
    "h",
    "m",
    "y",
    "r",
    "w",
    "nn",
    "g",
    "z",
    "d",
    "b",
    "p",
  ],
  "katakana:combination": [
    "k",
    "s",
    "t",
    "n",
    "h",
    "m",
    "r",
    "g",
    "z",
    "b",
    "p",
  ],
};

function toggleSelection(items, value) {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}

function ensureAtLeastOne(items, value) {
  if (items.includes(value) && items.length === 1) {
    return items;
  }

  const next = toggleSelection(items, value);
  return next.length > 0 ? next : items;
}

function getActiveScriptLabel(session) {
  const hiraganaActive = Object.entries(session.selectedRows).some(
    ([key, rows]) => key.startsWith("hiragana:") && rows.length > 0,
  );
  const katakanaActive = Object.entries(session.selectedRows).some(
    ([key, rows]) => key.startsWith("katakana:") && rows.length > 0,
  );

  if (hiraganaActive && katakanaActive) {
    return SCRIPT_LABELS.mixed;
  }

  if (hiraganaActive) {
    return SCRIPT_LABELS.hiragana;
  }

  if (katakanaActive) {
    return SCRIPT_LABELS.katakana;
  }

  return SCRIPT_LABELS.none;
}

function toggleRowSelectionForSheet(selectedRows, sheetKey, rowId) {
  const rows = selectedRows[sheetKey] ?? [];

  return {
    ...selectedRows,
    [sheetKey]: rows.includes(rowId)
      ? rows.filter((row) => row !== rowId)
      : [...rows, rowId],
  };
}

function setSheetRows(selectedRows, sheetKey, rowIds) {
  return {
    ...selectedRows,
    [sheetKey]: [...rowIds],
  };
}

function classifyTypedAnswer(value, expected) {
  const normalizedValue = normalizeRomaji(value);
  const normalizedExpected = normalizeRomaji(expected);

  if (normalizedValue === "") {
    return "pending";
  }

  if (normalizedValue === normalizedExpected) {
    return "correct";
  }

  return normalizedExpected.startsWith(normalizedValue)
    ? "pending"
    : "incorrect";
}

function createSummary(enabledKana, progressStore) {
  return enabledKana.reduce(
    (summary, kana) => {
      const stats = progressStore.getKanaStats(kana.id);
      const mastery = getMasteryLabel(stats);
      summary.attempts += stats.attempts;
      summary.correct += stats.correct;
      summary.assisted += stats.assisted;
      summary[mastery] += 1;
      return summary;
    },
    { attempts: 0, correct: 0, assisted: 0, new: 0, shaky: 0, strong: 0 },
  );
}

function createPromptForMode(mode, enabledKana) {
  if (enabledKana.length === 0) {
    return null;
  }

  if (mode === "sound-to-kana") {
    return createSoundToKanaPrompt(enabledKana);
  }

  return createKanaToSoundPrompt(enabledKana);
}

function formatAnswerLabel(prompt) {
  return `${prompt.target.glyph} · ${prompt.target.romaji.toUpperCase()}`;
}

function renderFontButtons(fontOptions, activeIds) {
  return fontOptions
    .map(
      (font) => `
        <button
          class="font-toggle"
          data-font="${font.id}"
          data-active="${activeIds.includes(font.id)}"
          aria-pressed="${activeIds.includes(font.id)}"
          type="button"
        >
          <span class="font-toggle__preview ${font.className}" lang="ja">あア</span>
          <small>${font.label}</small>
        </button>
      `,
    )
    .join("");
}

// Re-trigger a one-shot CSS animation bound to `[data-<name>]` on an
// element that may still carry the attribute from a previous run.
function replayAttributeAnimation(element, name) {
  if (!element) {
    return;
  }

  element.removeAttribute(`data-${name}`);
  // Force a style flush so re-adding the attribute restarts the animation.
  void element.offsetWidth;
  element.setAttribute(`data-${name}`, "");
  element.addEventListener(
    "animationend",
    () => element.removeAttribute(`data-${name}`),
    { once: true },
  );
}

function renderReferenceTables(tables, selectedRows, enabledKana) {
  return ["hiragana", "katakana"]
    .map((script) => {
      const scriptTables = tables.filter((table) => table.script === script);

      if (scriptTables.length === 0) {
        return "";
      }

      const info = SHEET_INFO[script];
      const scriptCount = KANA_DATA.filter(
        (kana) => kana.script === script,
      ).length;
      const activeCount = enabledKana.filter(
        (kana) => kana.script === script,
      ).length;

      return `
        <section class="kana-sheet" data-kana-sheet="${script}">
          <div class="kana-sheet__head">
            <span class="kana-sheet__id">
              <span class="kana-sheet__badge" lang="ja" aria-hidden="true">${info.badge}</span>
              <span class="kana-sheet__names">
                <span class="kana-sheet__jp" lang="ja">${info.jp}</span>
                <span class="kana-sheet__en">${info.en}</span>
              </span>
            </span>
            <span class="kana-sheet__count" data-kana-sheet-count="${script}">${activeCount}/${scriptCount} ON</span>
          </div>
          ${scriptTables
            .map((table) => {
              const sheetKey = `${table.script}:${table.id}`;
              const activeColumns = selectedRows[sheetKey] ?? [];
              const labels = MATRIX_LABELS[table.id];
              const heads = COLUMN_HEADS[table.id];

              return `
                <section class="kana-matrix" data-kana-sheet-matrix="${sheetKey}">
                  <div class="kana-matrix__head">
                    <p class="kana-matrix__label">
                      <span lang="ja">${labels.jp}</span>
                      <span class="kana-matrix__label-en">${labels.en}</span>
                    </p>
                    <span class="kana-matrix__actions">
                      <button class="reference-link-action" data-group-toggle-all="${sheetKey}" aria-label="Select all ${labels.en}" type="button"><span lang="ja">ぜんぶ</span> ALL</button>
                      <button class="reference-link-action reference-link-action--none" data-group-toggle-none="${sheetKey}" aria-label="Clear all ${labels.en}" type="button"><span lang="ja">なし</span> NONE</button>
                    </span>
                  </div>
                  <div class="kana-matrix__row kana-matrix__row--header">
                    <span class="kana-matrix__rowlabel" aria-hidden="true"></span>
                    ${table.columns
                      .map((column) => {
                        const head = heads[column];
                        const active = activeColumns.includes(column);
                        const kana =
                          table.script === "hiragana" ? head[0] : head[1];

                        return `
                          <button
                            class="reference-column-toggle"
                            data-reference-column-toggle="${sheetKey}:${column}"
                            data-column-active="${active}"
                            data-latin="${head[2]}"
                            aria-pressed="${active}"
                            title="${active ? "Remove" : "Add"} ${head[2]} column"
                            type="button"
                          >
                            <span class="reference-column-toggle__kana" lang="ja">${kana}</span>
                            <span class="reference-column-toggle__latin">${head[2]}</span>
                          </button>
                        `;
                      })
                      .join("")}
                  </div>
                  ${table.rows
                    .map(
                      (row) => `
                        <div class="kana-matrix__row">
                          <span class="kana-matrix__rowlabel">${row.label}</span>
                          ${row.cells
                            .map(
                              (cell) => `
                                <span class="kana-matrix__cell" data-cell-column="${sheetKey}:${cell.columnId}" data-column-active="${activeColumns.includes(cell.columnId)}">
                                  ${cell.items
                                    .map(
                                      (kana) => `
                                        <button
                                          class="reference-glyph"
                                          data-kana-group="${kana.group}"
                                          data-reference-column-toggle-target="${sheetKey}:${cell.columnId}"
                                          data-column-active="${activeColumns.includes(cell.columnId)}"
                                          data-reference-audio-id="${kana.audioId}"
                                          title="${kana.romaji}"
                                          aria-label="Play ${kana.romaji}"
                                          lang="ja"
                                          type="button"
                                        >${kana.glyph}</button>
                                      `,
                                    )
                                    .join("")}
                                </span>
                              `,
                            )
                            .join("")}
                        </div>
                      `,
                    )
                    .join("")}
                </section>
              `;
            })
            .join("")}
        </section>
      `;
    })
    .join("");
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }

  element.hidden = hidden;

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement
  ) {
    element.disabled = hidden;
  }
}

function setVisibleState(element, visible) {
  if (!element) {
    return;
  }

  element.hidden = false;
  element.dataset.visible = visible ? "true" : "false";
  element.setAttribute("aria-hidden", visible ? "false" : "true");

  // CSS hides non-applicable inputs/buttons via `display:none`, but
  // tab focus still reaches them unless we mark them `disabled`.
  if (element instanceof HTMLInputElement || element instanceof HTMLButtonElement) {
    element.disabled = !visible;
  }
}

function setText(element, value) {
  if (!element) {
    return;
  }

  element.textContent = value;
}

// The waveform renders as 36 chunky signage bars (the design's 250×64px
// stage); the 100-bucket peak data is downsampled to that count.
const WAVEFORM_BAR_COUNT = 36;

function resampleWaveform(values, sampleCount = WAVEFORM_BAR_COUNT) {
  if (!Array.isArray(values) || values.length === 0) {
    return Array.from({ length: sampleCount }, () => 0.12);
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index / Math.max(sampleCount - 1, 1)) * (values.length - 1),
    );
    return Math.max(0.12, (values[sourceIndex] ?? 12) / 100);
  });
}

export function createApp(root = document.querySelector("#app"), options = {}) {
  if (!root) {
    return null;
  }

  const autoAdvance = options.autoAdvance ?? true;
  const advanceDelayMs = Number(options.advanceDelayMs ?? 800);
  const romajiCaptions = options.romajiCaptions ?? false;

  document.title = "Kana Trainer";
  root.dataset.enhanced = "true";

  const sessionStore = createSessionStore();
  const progressStore = createProgressStore();
  const audioClips = createAudioClipMap(KANA_DATA);

  const elements = {
    scriptLabel: root.querySelector('[data-slot="script-label"]'),
    promptCard: root.querySelector('[data-region="prompt"]'),
    promptStage: root.querySelector(".drill-card__stage"),
    stationCode: root.querySelector('[data-slot="station-code"]'),
    hintChip: root.querySelector('[data-slot="hint-chip"]'),
    promptGlyph: root.querySelector('[data-slot="prompt-glyph"]'),
    fontLabel: root.querySelector('[data-slot="font-label"]'),
    promptStatus: root.querySelector('[data-slot="prompt-status"]'),
    promptStatusMessage: root.querySelector('[data-slot="status-message"]'),
    promptStatusJp: root.querySelector('[data-slot="status-jp"]'),
    promptStatusEn: root.querySelector('[data-slot="status-en"]'),
    promptStatusAnswer: root.querySelector('[data-slot="status-answer"]'),
    audioPosterButton: root.querySelector(".audio-poster-button"),
    waveformCanvas: root.querySelector('[data-slot="waveform-canvas"]'),
    emptyState: root.querySelector('[data-slot="empty-state"]'),
    maruStamp: root.querySelector('[data-slot="maru-stamp"]'),
    answerBlock: root.querySelector(".answer-block"),
    typedBlock: root.querySelector('[data-slot="typed-block"]'),
    choicesBlock: root.querySelector('[data-slot="choices-block"]'),
    answerInput: root.querySelector("[data-answer-input]"),
    choiceGrid: root.querySelector("[data-choice-grid]"),
    interactionBody: root.querySelector(".interaction-card__body"),
    drillActions: root.querySelector('[data-region="hints"]'),
    hearButton: root.querySelector(
      '[data-region="hints"] [data-action="play-sound"]',
    ),
    revealButton: root.querySelector('[data-action="reveal"]'),
    nextButton: root.querySelector('[data-action="next"]'),
    modeGroup: root.querySelector("[data-mode-group]"),
    fontGroup: root.querySelector("[data-font-group]"),
    streakChip: root.querySelector('[data-slot="streak"]'),
    streakCount: root.querySelector('[data-slot="streak-count"]'),
    statsAttempts: root.querySelector('[data-slot="stats-attempts"]'),
    statsCorrect: root.querySelector('[data-slot="stats-correct"]'),
    statsAssisted: root.querySelector('[data-slot="stats-assisted"]'),
    statsStrong: root.querySelector('[data-slot="stats-strong"]'),
    sheetsSection: root.querySelector('[data-region="kana-sheets"]'),
    referenceContainer: root.querySelector("[data-reference-container]"),
  };

  let promptIndex = 0;
  let hasRendered = false;
  let lastStreak = null;
  let currentPrompt = null;
  let feedback = null;
  let typingStatus = null;
  let usedHint = false;
  let advanceTimer = null;
  let activePromptKey = null;
  let selectedChoiceId = null;
  let suppressInputFocus = false;
  let audioState = "idle";
  let audioPlaybackToken = 0;
  let activeWaveformKey = null;
  let activeWaveformBars = [];
  let waveformDuration = 0;
  let waveformProgress = 0;
  let waveformStartedAt = 0;
  let waveformFrame = null;

  const scheduleFrame =
    typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback) => setTimeout(() => callback(Date.now()), 16);
  const cancelFrame =
    typeof globalThis.cancelAnimationFrame === "function"
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : clearTimeout;

  function clearAdvanceTimer() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
  }

  function clearAudioState() {
    audioPlaybackToken += 1;
    audioState = "idle";
    waveformProgress = 0;
    waveformStartedAt = 0;
    waveformDuration = 0;

    if (waveformFrame) {
      cancelFrame(waveformFrame);
      waveformFrame = null;
    }
  }

  function advancePrompt() {
    setPrompt();
    render();
    autoplayPromptAudio();
  }

  // Auto-advance applies to unassisted correct answers only; revealed and
  // incorrect outcomes wait for NEXT / Enter / Space so the correction can
  // actually be studied.
  function scheduleAdvance(delay = advanceDelayMs) {
    clearAdvanceTimer();
    advanceTimer = setTimeout(() => {
      advancePrompt();
    }, delay);
  }

  function getPromptFont(session) {
    return createRotatingFontSequence(
      FONT_OPTIONS,
      session.enabledFonts,
      1,
      promptIndex,
    )[0];
  }

  function getEnabledKana() {
    return buildEnabledKanaSet(KANA_DATA, sessionStore.getState());
  }

  function getReferenceKana() {
    return KANA_DATA;
  }

  function setPrompt() {
    clearAdvanceTimer();
    clearAudioState();
    const session = sessionStore.getState();
    currentPrompt = createPromptForMode(session.mode, getEnabledKana());
    feedback = null;
    typingStatus = null;
    usedHint = false;
    selectedChoiceId = null;
    promptIndex += 1;
  }

  function refreshPromptAfterSelectionChange() {
    clearAdvanceTimer();
    clearAudioState();

    const session = sessionStore.getState();
    const enabledKana = getEnabledKana();
    const expectedKind =
      session.mode === "sound-to-kana" ? "sound-to-kana" : "kana-to-sound";
    const currentStillValid =
      currentPrompt &&
      currentPrompt.kind === expectedKind &&
      enabledKana.some((kana) => kana.id === currentPrompt.target.id);

    if (!currentStillValid) {
      currentPrompt = createPromptForMode(session.mode, enabledKana);
      promptIndex += 1;
    }

    feedback = null;
    typingStatus = null;
    usedHint = false;
    selectedChoiceId = null;
  }

  function ensurePrompt() {
    const enabledKana = getEnabledKana();

    if (
      !currentPrompt ||
      !enabledKana.some((kana) => kana.id === currentPrompt.target.id)
    ) {
      clearAudioState();
      currentPrompt = createPromptForMode(
        sessionStore.getState().mode,
        enabledKana,
      );
      feedback = null;
      typingStatus = null;
      usedHint = false;
      selectedChoiceId = null;
    }

    return enabledKana;
  }

  function recordOutcome(outcome) {
    if (!currentPrompt) {
      return;
    }

    progressStore.record(
      currentPrompt.target.id,
      sessionStore.getState().mode,
      outcome,
    );
  }

  // Streak counts unassisted correct answers; a miss or an assist resets it.
  function updateStreak(outcome) {
    const session = sessionStore.getState();
    const streak = outcome === "correct" ? session.streak + 1 : 0;
    sessionStore.setState({ streak });
  }

  function finishPrompt(outcome) {
    recordOutcome(outcome);
    updateStreak(outcome);
    feedback = {
      outcome,
      answer: formatAnswerLabel(currentPrompt),
    };
    typingStatus = null;
    render();

    if (outcome === "correct" && autoAdvance) {
      scheduleAdvance(advanceDelayMs);
    }
  }

  function renderAudioState() {
    if (!elements.audioPosterButton) {
      return;
    }

    elements.audioPosterButton.dataset.audioState = audioState;
  }

  function getWaveformContext() {
    const canvas = elements.waveformCanvas;

    if (!canvas) {
      return null;
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

    const ctx =
      typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;

    if (!ctx) {
      return null;
    }

    return { canvas, ctx, width, height, dpr };
  }

  function drawWaveform(progress = waveformProgress) {
    const setup = getWaveformContext();

    if (!setup) {
      return;
    }

    const { ctx, width, height, dpr } = setup;
    ctx.clearRect(0, 0, width, height);

    if (activeWaveformBars.length === 0) {
      return;
    }

    const halfHeight = height * 0.5;
    const xGap = width / activeWaveformBars.length;
    // 5px-wide bars with a 2px gap at the design's 250px stage width.
    ctx.lineWidth = Math.max(1.5, xGap * 0.72);
    ctx.lineCap = "round";

    for (let index = 0; index < activeWaveformBars.length; index += 1) {
      const barX = (index + 0.5) * xGap;
      const barHeight = Math.min(
        halfHeight - dpr,
        halfHeight * activeWaveformBars[index] * 1.76,
      );
      const played = (index + 1) / activeWaveformBars.length <= progress;
      ctx.strokeStyle = played ? "#14669e" : "rgba(26, 24, 21, 0.28)";
      ctx.beginPath();
      ctx.moveTo(barX, halfHeight - barHeight);
      ctx.lineTo(barX, halfHeight + barHeight);
      ctx.stroke();
    }
  }

  function animateWaveformFrame(timestamp) {
    if (audioState !== "playing" || waveformDuration <= 0) {
      waveformFrame = null;
      return;
    }

    waveformProgress = Math.min(
      (timestamp - waveformStartedAt) / waveformDuration,
      1,
    );
    drawWaveform(waveformProgress);

    if (waveformProgress < 1) {
      waveformFrame = scheduleFrame(animateWaveformFrame);
      return;
    }

    waveformFrame = null;
  }

  function renderWaveform(prompt) {
    if (!elements.waveformCanvas || !elements.audioPosterButton) {
      return;
    }

    if (!prompt || sessionStore.getState().mode !== "sound-to-kana") {
      activeWaveformBars = [];
      activeWaveformKey = null;
      drawWaveform(0);
      return;
    }

    // WAVEFORM_DATA is loaded on demand. The first time we hit the aural
    // path, we kick off the dynamic import; once it resolves we re-render
    // so the bars appear without any further user action.
    if (!waveformData) {
      ensureWaveformsLoaded().then((data) => {
        if (data && currentPrompt) {
          renderWaveform(currentPrompt);
        }
      });
      activeWaveformBars = [];
      activeWaveformKey = null;
      drawWaveform(0);
      return;
    }

    const waveform = waveformData[prompt.target.audioId];

    if (!waveform) {
      activeWaveformBars = [];
      activeWaveformKey = null;
      drawWaveform(0);
      return;
    }

    if (activeWaveformKey !== prompt.target.audioId) {
      activeWaveformBars = resampleWaveform(waveform.v, WAVEFORM_BAR_COUNT);
      activeWaveformKey = prompt.target.audioId;
    }

    waveformDuration = waveform.d ?? 400;
    drawWaveform(audioState === "playing" ? waveformProgress : 0);
  }

  async function handleAudioPrompt(
    audioId = currentPrompt?.target.audioId,
    { markHint = true, animatePrompt = false } = {},
  ) {
    if (!audioId) {
      return;
    }

    if (
      markHint &&
      audioId === currentPrompt?.target.audioId &&
      sessionStore.getState().mode === "kana-to-sound" &&
      !feedback &&
      !usedHint
    ) {
      usedHint = true;
      // The HINT chip appears immediately, so an assisted outcome is
      // never a surprise.
      render();
    }

    let token = audioPlaybackToken;

    if (animatePrompt) {
      token = audioPlaybackToken + 1;
      audioPlaybackToken = token;
      audioState = "playing";
      waveformProgress = 0;
      waveformStartedAt =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      renderAudioState();
      drawWaveform(0);

      if (waveformFrame) {
        cancelFrame(waveformFrame);
      }
      waveformFrame = scheduleFrame(animateWaveformFrame);
    }

    await playKanaAudio(audioId, audioClips);

    if (animatePrompt && audioPlaybackToken === token) {
      audioState = "idle";
      waveformProgress = 1;
      if (waveformFrame) {
        cancelFrame(waveformFrame);
        waveformFrame = null;
      }
      drawWaveform(1);
      renderAudioState();
    }
  }

  function autoplayPromptAudio() {
    if (
      sessionStore.getState().mode !== "sound-to-kana" ||
      !currentPrompt?.target.audioId ||
      feedback
    ) {
      return;
    }

    void handleAudioPrompt(currentPrompt.target.audioId, {
      markHint: false,
      animatePrompt: true,
    });
  }

  function resolveKanaTyping(answer) {
    if (!currentPrompt || feedback) {
      return;
    }

    const state = classifyTypedAnswer(answer, currentPrompt.target.romaji);

    if (state === "pending") {
      if (typingStatus) {
        typingStatus = null;
        render();
      }
      return;
    }

    if (state === "incorrect") {
      // A wrong prefix never blocks: shake the field and select the text
      // so the next keystroke replaces it.
      typingStatus = {
        outcome: "incorrect",
        count: (typingStatus?.count ?? 0) + 1,
      };
      render();
      elements.answerInput?.select();
      return;
    }

    typingStatus = null;
    const result = gradeKanaToSoundAnswer(answer, currentPrompt.target.romaji, {
      usedHint,
    });
    finishPrompt(result.outcome);
  }

  function revealPrompt() {
    if (!currentPrompt || feedback) {
      return;
    }

    usedHint = true;
    void handleAudioPrompt(currentPrompt.target.audioId, {
      markHint: false,
      animatePrompt: false,
    });
    finishPrompt("assisted");
  }

  function renderControls(session) {
    elements.modeGroup
      ?.querySelectorAll("[data-mode]")
      .forEach((button) => {
        const active = button.dataset.mode === session.mode;
        button.dataset.active = active ? "true" : "false";
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });

    // Build the font toggles once, then patch active states in place so
    // the color transitions run and one-shot animations aren't wiped.
    if (elements.fontGroup.dataset.built !== "true") {
      elements.fontGroup.innerHTML = renderFontButtons(
        FONT_OPTIONS,
        session.enabledFonts,
      );
      elements.fontGroup.dataset.built = "true";
      return;
    }

    elements.fontGroup.querySelectorAll("[data-font]").forEach((button) => {
      const active = session.enabledFonts.includes(button.dataset.font);
      button.dataset.active = active ? "true" : "false";
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function renderPromptSection(session, prompt, promptFont) {
    const mode = session.mode;
    const isAural = mode === "sound-to-kana";
    const showGlyph = Boolean(prompt) && (!isAural || Boolean(feedback));
    const showWave = Boolean(prompt) && isAural && !feedback;

    setText(elements.scriptLabel, getActiveScriptLabel(session));
    setText(
      elements.stationCode,
      `STA. ${MODE_LETTERS[mode]}-${String(promptIndex).padStart(2, "0")}`,
    );

    elements.promptCard.dataset.outcome = feedback?.outcome ?? "";
    elements.promptCard.dataset.hasAudio = isAural ? "true" : "false";

    setHidden(elements.hintChip, !(prompt && usedHint && !feedback));
    setText(
      elements.fontLabel,
      !prompt
        ? ""
        : showGlyph
          ? `FONT · ${promptFont.label}`
          : "AUDIO PROMPT",
    );

    if (elements.promptStage) {
      // The alternating keyframe name re-triggers the entrance exactly once
      // per prompt; renders within the same prompt leave it untouched. The
      // very first paint is suppressed with an inline override — entrances
      // respond to input, not mounting.
      const motion = promptIndex % 2 ? "a" : "b";
      if (elements.promptStage.dataset.promptMotion !== motion) {
        elements.promptStage.style.animation = hasRendered ? "" : "none";
        elements.promptStage.dataset.promptMotion = motion;
      }
    }

    if (showGlyph) {
      setText(elements.promptGlyph, prompt.target.glyph);
      elements.promptGlyph.dataset.kanaGroup = prompt.target.group;
      elements.promptGlyph.className = `poster-kana ${promptFont.className}`;
    } else {
      setText(elements.promptGlyph, "");
      delete elements.promptGlyph.dataset.kanaGroup;
      elements.promptGlyph.className = "poster-kana";
    }

    // The aural answer reveal is a waveform → glyph crossfade between very
    // different shapes; a touch of blur + scale softens it. The attribute
    // only flips once per feedback, so re-renders don't re-trigger it.
    elements.promptGlyph.dataset.reveal =
      isAural && showGlyph ? "true" : "false";

    setVisibleState(elements.promptGlyph, showGlyph);
    setVisibleState(elements.audioPosterButton, showWave);
    setHidden(elements.emptyState, Boolean(prompt));
    setHidden(
      elements.maruStamp,
      !(feedback?.outcome === "correct" && showGlyph),
    );

    renderAudioState();
    renderWaveform(showWave ? prompt : null);

    const statusTheme = feedback
      ? { tone: feedback.outcome, ...STATUS_THEMES[feedback.outcome] }
      : typingStatus
        ? { tone: "typing", ...TYPING_THEME }
        : null;

    if (!statusTheme) {
      setText(elements.promptStatusJp, "");
      setText(elements.promptStatusEn, "");
      setText(elements.promptStatusAnswer, "");
      delete elements.promptStatusMessage?.dataset.tone;
      elements.promptStatus.dataset.visible = "false";
      elements.promptStatus.setAttribute("aria-hidden", "true");
      return;
    }

    setText(elements.promptStatusJp, statusTheme.jp);
    setText(elements.promptStatusEn, statusTheme.en);
    setText(elements.promptStatusAnswer, feedback?.answer ?? "");
    if (elements.promptStatusMessage) {
      elements.promptStatusMessage.dataset.tone = statusTheme.tone;
    }
    elements.promptStatus.dataset.visible = "true";
    elements.promptStatus.setAttribute("aria-hidden", "false");
  }

  function renderInteraction(session, prompt, promptFont) {
    const promptKey = prompt
      ? `${session.mode}:${prompt.target.id}:${promptFont.id}`
      : "empty";

    setHidden(elements.answerBlock, !prompt);

    if (session.mode === "sound-to-kana" && prompt) {
      setVisibleState(elements.typedBlock, false);
      setVisibleState(elements.answerInput, false);
      setVisibleState(elements.choicesBlock, true);
      setVisibleState(elements.choiceGrid, true);

      const grid = elements.choiceGrid;

      const choiceStateFor = (option) => {
        if (!feedback) {
          return "idle";
        }

        const isTargetChoice = option.id === prompt.target.id;
        const isSelectedChoice = option.id === selectedChoiceId;
        // Allow homophone partners (じ/ぢ, ず/づ) to also read "correct"
        // when the user picked the alternative glyph that shares the
        // same recording. The grader already accepts these as correct.
        const isHomophoneChoice =
          isSelectedChoice &&
          !isTargetChoice &&
          Boolean(prompt.target.audioId) &&
          option.audioId === prompt.target.audioId;

        if (isTargetChoice || isHomophoneChoice) {
          return "correct";
        }

        return isSelectedChoice ? "incorrect" : "idle";
      };

      // Captions live in the DOM from the start (reserving their space so
      // nothing shifts on answer) and fade in via the grid attribute.
      grid.dataset.showRomaji =
        feedback || romajiCaptions ? "true" : "false";

      if (grid.dataset.promptKey !== promptKey) {
        // Fresh prompt: rebuild with a staggered entrance. Skipped on the
        // very first paint — entrances respond to input, not mounting.
        grid.dataset.motion = hasRendered ? "in" : "static";
        grid.dataset.promptKey = promptKey;
        grid.innerHTML = prompt.options
          .map(
            (option, index) => `
              <button
                class="choice-card"
                data-choice="${option.id}"
                data-kana-group="${option.group}"
                data-state="idle"
                data-romaji="${option.romaji}"
                type="button"
                style="--stagger-index: ${index}"
              >
                <span class="choice-card__key" aria-hidden="true">${index + 1}</span>
                <span class="choice-card__glyph ${promptFont.className}" lang="ja" data-romaji="${option.romaji}">${option.glyph}</span>
                <small aria-hidden="true">${option.romaji}</small>
              </button>
            `,
          )
          .join("");
      } else {
        // Same prompt (answer/feedback render): patch the existing buttons
        // in place so the state color transitions actually run and no
        // entrance animation re-triggers.
        grid.querySelectorAll("[data-choice]").forEach((button) => {
          const option = prompt.options.find(
            (candidate) => candidate.id === button.dataset.choice,
          );
          button.dataset.state = option ? choiceStateFor(option) : "idle";
          button.disabled = Boolean(feedback);
        });
      }

      activePromptKey = promptKey;
      return;
    }

    // kana-to-sound path: keep the authored DOM stable (no per-render
    // innerHTML rewrite) so the user's typed text, caret, and IME
    // composition survive every render.
    elements.choiceGrid.innerHTML = "";
    delete elements.choiceGrid.dataset.promptKey;
    setVisibleState(elements.typedBlock, true);
    setVisibleState(elements.answerInput, true);
    setVisibleState(elements.choicesBlock, false);
    setVisibleState(elements.choiceGrid, false);

    if (activePromptKey !== promptKey && elements.answerInput) {
      elements.answerInput.value = "";
    }
    if (elements.answerInput) {
      // feedback / no-prompt disables the input; setVisibleState above
      // enabled it, so this is the authoritative disabled-state for the
      // kana-to-sound interaction.
      elements.answerInput.disabled = Boolean(feedback || !prompt);
      elements.answerInput.dataset.state =
        feedback?.outcome ?? typingStatus?.outcome ?? "pending";
      // Alternate the shake keyframe name so repeated wrong prefixes
      // re-trigger the animation.
      elements.answerInput.dataset.shake = typingStatus
        ? typingStatus.count % 2
          ? "a"
          : "b"
        : "";
      elements.answerInput.setAttribute(
        "aria-invalid",
        typingStatus?.outcome === "incorrect" ? "true" : "false",
      );
    }

    activePromptKey = promptKey;
  }

  function renderActions(session, prompt) {
    setHidden(elements.drillActions, !prompt || Boolean(feedback));
    setHidden(elements.hearButton, session.mode === "sound-to-kana");
    if (elements.revealButton) {
      elements.revealButton.disabled = !prompt || Boolean(feedback);
    }
    setHidden(elements.nextButton, !feedback);
  }

  function renderStats(summary, session) {
    elements.statsAttempts.textContent = String(summary.attempts);
    elements.statsCorrect.textContent = String(summary.correct);
    elements.statsAssisted.textContent = String(summary.assisted);
    elements.statsStrong.textContent = String(summary.strong);

    if (elements.streakCount) {
      elements.streakCount.textContent = String(session.streak);
    }
    if (elements.streakChip) {
      elements.streakChip.dataset.active =
        session.streak > 0 ? "true" : "false";
      // A small pop marks the increment in peripheral vision — reserved
      // for gains only, never for the reset.
      if (lastStreak !== null && session.streak > lastStreak) {
        replayAttributeAnimation(elements.streakChip, "pop");
      }
    }
    lastStreak = session.streak;
  }

  function renderReference(referenceKana, enabledKana) {
    const selectedRows = sessionStore.getState().selectedRows;
    const container = elements.referenceContainer;

    // The sheet structure is static — build it once, then patch active
    // states and counters in place. This keeps per-keystroke renders cheap
    // (~500 buttons untouched) and lets the wash/opacity transitions on
    // column toggles actually run.
    if (container.dataset.built !== "true") {
      const tables = createKanaSelectionMatrices(referenceKana);
      container.innerHTML = renderReferenceTables(
        tables,
        selectedRows,
        enabledKana,
      );
      container.dataset.built = "true";
      return;
    }

    const isColumnActive = (key) => {
      const [script, group, column] = key.split(":");
      return (selectedRows[`${script}:${group}`] ?? []).includes(column);
    };

    container
      .querySelectorAll("[data-reference-column-toggle]")
      .forEach((button) => {
        const active = isColumnActive(button.dataset.referenceColumnToggle);
        button.dataset.columnActive = active ? "true" : "false";
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.title = `${active ? "Remove" : "Add"} ${button.dataset.latin} column`;
      });

    container.querySelectorAll("[data-cell-column]").forEach((cell) => {
      cell.dataset.columnActive = isColumnActive(cell.dataset.cellColumn)
        ? "true"
        : "false";
    });

    container
      .querySelectorAll("[data-reference-column-toggle-target]")
      .forEach((button) => {
        button.dataset.columnActive = isColumnActive(
          button.dataset.referenceColumnToggleTarget,
        )
          ? "true"
          : "false";
      });

    for (const script of ["hiragana", "katakana"]) {
      const count = container.querySelector(
        `[data-kana-sheet-count="${script}"]`,
      );
      if (count) {
        const total = KANA_DATA.filter(
          (kana) => kana.script === script,
        ).length;
        const active = enabledKana.filter(
          (kana) => kana.script === script,
        ).length;
        count.textContent = `${active}/${total} ON`;
      }
    }
  }

  function render() {
    const session = sessionStore.getState();
    const enabledKana = ensurePrompt();
    const referenceKana = getReferenceKana();
    const summary = createSummary(enabledKana, progressStore);
    const promptFont = getPromptFont(session);

    renderControls(session);
    renderPromptSection(session, currentPrompt, promptFont);
    renderInteraction(session, currentPrompt, promptFont);
    renderActions(session, currentPrompt);
    renderStats(summary, session);
    renderReference(referenceKana, enabledKana);

    if (
      session.mode === "kana-to-sound" &&
      currentPrompt &&
      !feedback &&
      !suppressInputFocus
    ) {
      elements.answerInput.focus();
    }

    suppressInputFocus = false;
    hasRendered = true;
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");

    if (!button || !root.contains(button)) {
      return;
    }

    if (button.dataset.mode) {
      if (button.dataset.mode === sessionStore.getState().mode) {
        return;
      }

      sessionStore.setState({ mode: button.dataset.mode });
      setPrompt();
      render();
      autoplayPromptAudio();
      return;
    }

    if (button.dataset.font) {
      const sessionState = sessionStore.getState();
      const nextFonts = ensureAtLeastOne(
        sessionState.enabledFonts,
        button.dataset.font,
      );

      // At least one face must stay enabled. A silent no-op would leave
      // the tap unanswered — nudge the toggle instead.
      if (nextFonts === sessionState.enabledFonts) {
        replayAttributeAnimation(button, "deny");
        return;
      }

      sessionStore.setState({ enabledFonts: nextFonts });
      render();
      return;
    }

    if (button.dataset.referenceColumnToggle) {
      const sessionState = sessionStore.getState();
      const [script, group, rowId] =
        button.dataset.referenceColumnToggle.split(":");
      const sheetKey = `${script}:${group}`;
      elements.answerInput?.blur();
      sessionStore.setState({
        selectedRows: toggleRowSelectionForSheet(
          sessionState.selectedRows,
          sheetKey,
          rowId,
        ),
      });
      suppressInputFocus = true;
      refreshPromptAfterSelectionChange();
      render();
      return;
    }

    if (button.dataset.groupToggleAll) {
      const sessionState = sessionStore.getState();
      const rowIds = SHEET_GROUP_ROWS[button.dataset.groupToggleAll] ?? [];
      elements.answerInput?.blur();
      sessionStore.setState({
        selectedRows: setSheetRows(
          sessionState.selectedRows,
          button.dataset.groupToggleAll,
          rowIds,
        ),
      });
      suppressInputFocus = true;
      refreshPromptAfterSelectionChange();
      render();
      return;
    }

    if (button.dataset.groupToggleNone) {
      const sessionState = sessionStore.getState();
      elements.answerInput?.blur();
      sessionStore.setState({
        selectedRows: setSheetRows(
          sessionState.selectedRows,
          button.dataset.groupToggleNone,
          [],
        ),
      });
      suppressInputFocus = true;
      refreshPromptAfterSelectionChange();
      render();
      return;
    }

    if (button.dataset.referenceAudioId) {
      // Color the tapped kana in the sheet's line color while its clip
      // plays — audio alone leaves the tap without a visible response.
      button.dataset.playing = "true";
      try {
        await handleAudioPrompt(button.dataset.referenceAudioId, {
          markHint: false,
          animatePrompt: false,
        });
      } finally {
        delete button.dataset.playing;
      }
      return;
    }

    if (button.dataset.choice && currentPrompt && !feedback) {
      typingStatus = null;
      selectedChoiceId = button.dataset.choice;
      const selectedOption = currentPrompt.options.find(
        (option) => option.id === button.dataset.choice,
      );
      const result = gradeSoundToKanaAnswer(
        button.dataset.choice,
        currentPrompt.target.id,
        {
          usedHint,
          selectedAudioId: selectedOption?.audioId,
          expectedAudioId: currentPrompt.target.audioId,
        },
      );
      finishPrompt(result.outcome);
      return;
    }

    if (button.dataset.action === "next") {
      if (feedback) {
        advancePrompt();
      }
      return;
    }

    if (button.dataset.action === "goto-sheets") {
      elements.sheetsSection?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    if (button.dataset.action === "play-sound") {
      await handleAudioPrompt(currentPrompt?.target.audioId, {
        animatePrompt: sessionStore.getState().mode === "sound-to-kana",
      });
      return;
    }

    if (button.dataset.action === "reveal") {
      revealPrompt();
    }
  });

  elements.answerInput.addEventListener("input", (event) => {
    resolveKanaTyping(event.currentTarget.value);
  });

  // Manual advance is always available during feedback: NEXT, Enter, or
  // Space. The document-level listener works even when nothing inside the
  // card has focus (the disabled input drops focus after answering).
  // In aural mode, 1–6 pick a choice and R replays the clip — keyboard
  // input is mechanical, so these paths skip straight to the action.
  document.addEventListener("keydown", (event) => {
    if (!root.isConnected || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (feedback) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      // Let a focused NEXT button handle its own click instead of firing a
      // duplicate advance from the key event.
      if (event.target === elements.nextButton) {
        return;
      }

      event.preventDefault();
      advancePrompt();
      return;
    }

    if (
      sessionStore.getState().mode !== "sound-to-kana" ||
      !currentPrompt ||
      event.target instanceof HTMLInputElement
    ) {
      return;
    }

    if (event.key >= "1" && event.key <= "6") {
      const choice = elements.choiceGrid.querySelectorAll("[data-choice]")[
        Number(event.key) - 1
      ];
      if (choice) {
        event.preventDefault();
        choice.click();
      }
      return;
    }

    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      void handleAudioPrompt(currentPrompt.target.audioId, {
        markHint: false,
        animatePrompt: true,
      });
    }
  });

  setPrompt();
  render();
  autoplayPromptAudio();

  return {
    sessionStore,
    progressStore,
    render,
    nextPrompt: setPrompt,
  };
}
