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

// The write drill (stroke DB, canvas controller, recognizer runtime) lives
// in its own chunk — ~30 KB gz plus a ~120 KB int8 model fetched on demand.
// Nothing loads until the mode is first entered.
let writeModule = null;
let writeModulePromise = null;

function ensureWriteModuleLoaded() {
  if (writeModule || writeModulePromise) {
    return writeModulePromise ?? Promise.resolve(writeModule);
  }

  writeModulePromise = import("./write/write-drill.js")
    .then((module) => {
      writeModule = module;
      return writeModule;
    })
    .catch(() => {
      writeModulePromise = null;
      return null;
    });

  return writeModulePromise;
}

const MODE_LETTERS = {
  "kana-to-sound": "V",
  "sound-to-kana": "A",
  write: "W",
};

// Outcome word pairs for the status line. Vermillion is the positive mark
// here (marubatsu grading): correct = せいかい, revealed = amber こたえ,
// incorrect = ink ざんねん. The write drill adds partial: right character,
// wrong stroke order/count.
const STATUS_THEMES = {
  correct: { jp: "せいかい", en: "CORRECT" },
  assisted: { jp: "こたえ", en: "REVEALED" },
  incorrect: { jp: "ざんねん", en: "NOT QUITE" },
  partial: { jp: "おしい", en: "ALMOST" },
};

// Transient per-stroke feedback under the drawing canvas (kana-only copy —
// the font subsets carry no extra kanji).
const DRAW_NOTES = {
  backwards: { jp: "ぎゃく！", en: "BACKWARDS — START FROM THE OTHER END" },
  "out-of-order": { jp: "じゅんばん！", en: "WRONG ORDER" },
  "no-match": { jp: "ちがうかたち", en: "CHECK POSITION AND SHAPE" },
  grading: { jp: "よみとりちゅう", en: "READING YOUR WRITING…" },
  "stroke-order": { jp: "じゅんばんがちがう", en: "RIGHT SHAPE — WRONG STROKE ORDER" },
  "stroke-count": { jp: "かくすうがちがう", en: "STROKE COUNT IS OFF" },
};

// Tier chip labels (そらがき = writing from memory, "air writing").
const TIER_LABELS = {
  trace: { jp: "なぞる", en: "TRACE" },
  guided: { jp: "みちびき", en: "GUIDED" },
  recall: { jp: "そらがき", en: "RECALL" },
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
    writeCue: root.querySelector('[data-slot="write-cue"]'),
    writeCueMain: root.querySelector('[data-slot="write-cue-main"]'),
    writeCueSub: root.querySelector('[data-slot="write-cue-sub"]'),
    writeReveal: root.querySelector('[data-slot="write-reveal"]'),
    drawBlock: root.querySelector('[data-slot="draw-block"]'),
    drawFrame: root.querySelector('[data-slot="draw-frame"]'),
    drawCanvas: root.querySelector('[data-slot="draw-canvas"]'),
    drawNote: root.querySelector('[data-slot="draw-note"]'),
    strokeTicks: root.querySelector('[data-slot="stroke-ticks"]'),
    tierChip: root.querySelector('[data-action="cycle-tier"]'),
    tierJp: root.querySelector('[data-slot="tier-jp"]'),
    tierEn: root.querySelector('[data-slot="tier-en"]'),
    undoButton: root.querySelector('[data-action="draw-undo"]'),
    clearButton: root.querySelector('[data-action="draw-clear"]'),
    drawHintButton: root.querySelector('[data-action="draw-hint"]'),
    doneButton: root.querySelector('[data-action="draw-done"]'),
    kanjiContainer: root.querySelector("[data-kanji-container]"),
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
  let writeDrill = null;
  let writeRevealPlayer = null;
  let writeDemoShown = false;
  let writeResult = null;
  let writeNoteState = null;

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

  function getWritePool(session = sessionStore.getState()) {
    return writeModule ? writeModule.buildWritePool(KANA_DATA, session) : [];
  }

  // Assistance tier: explicit override, else driven by this character's
  // mastery — new chars get the traced ghost, strong ones write from memory.
  function writeTierFor(target, session = sessionStore.getState()) {
    if (session.writeAssist && session.writeAssist !== "auto") {
      return session.writeAssist;
    }
    return writeModule.tierForMastery(
      getMasteryLabel(progressStore.getKanaStats(target.id)),
    );
  }

  function createWritePromptNow() {
    if (!writeModule) {
      // First entry: the chunk is still downloading. The render shows the
      // loading state; once the module lands we pick a prompt and re-render.
      void ensureWriteModuleLoaded().then((module) => {
        if (module && sessionStore.getState().mode === "write") {
          ensureWriteWiring();
          if (!currentPrompt) {
            setPrompt();
            render();
            autoplayPromptAudio();
          } else {
            render();
          }
        }
      });
      return null;
    }
    return writeModule.createWritePrompt(getWritePool());
  }

  function promptForMode(mode) {
    if (mode === "write") {
      return createWritePromptNow();
    }
    return createPromptForMode(mode, getEnabledKana());
  }

  function promptStillValid(prompt, mode) {
    if (!prompt) {
      return false;
    }
    if (mode === "write") {
      return (
        prompt.kind === "write" &&
        getWritePool().some((record) => record.id === prompt.target.id)
      );
    }
    const expectedKind =
      mode === "sound-to-kana" ? "sound-to-kana" : "kana-to-sound";
    return (
      prompt.kind === expectedKind &&
      getEnabledKana().some((kana) => kana.id === prompt.target.id)
    );
  }

  function resetWritePromptState() {
    writeResult = null;
    writeNoteState = null;
    writeDemoShown = false;
    writeRevealPlayer?.stop();
  }

  function setPrompt() {
    clearAdvanceTimer();
    clearAudioState();
    resetWritePromptState();
    const session = sessionStore.getState();
    currentPrompt = promptForMode(session.mode);
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

    if (!promptStillValid(currentPrompt, session.mode)) {
      resetWritePromptState();
      currentPrompt = promptForMode(session.mode);
      promptIndex += 1;
    }

    feedback = null;
    typingStatus = null;
    usedHint = false;
    selectedChoiceId = null;
  }

  function ensurePrompt() {
    const enabledKana = getEnabledKana();

    if (!promptStillValid(currentPrompt, sessionStore.getState().mode)) {
      clearAudioState();
      resetWritePromptState();
      currentPrompt = promptForMode(sessionStore.getState().mode);
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

  function answerLabelFor(prompt) {
    if (prompt.kind === "write" && writeModule) {
      return writeModule.writeAnswerLabel(prompt.target);
    }
    return formatAnswerLabel(prompt);
  }

  function finishPrompt(outcome, { advanceDelay = advanceDelayMs } = {}) {
    recordOutcome(outcome);
    updateStreak(outcome);
    feedback = {
      outcome,
      answer: answerLabelFor(currentPrompt),
    };
    typingStatus = null;
    render();

    if (outcome === "correct" && autoAdvance) {
      scheduleAdvance(advanceDelay);
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
    const mode = sessionStore.getState().mode;

    if (!currentPrompt?.target.audioId || feedback) {
      return;
    }

    if (mode === "sound-to-kana") {
      void handleAudioPrompt(currentPrompt.target.audioId, {
        markHint: false,
        animatePrompt: true,
      });
      return;
    }

    // Write mode is dictation for kana targets: say the syllable once when
    // the prompt appears (no waveform poster in this mode).
    if (mode === "write") {
      void handleAudioPrompt(currentPrompt.target.audioId, {
        markHint: false,
        animatePrompt: false,
      });
    }
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

    if (sessionStore.getState().mode === "write") {
      revealWritePrompt();
      return;
    }

    usedHint = true;
    void handleAudioPrompt(currentPrompt.target.audioId, {
      markHint: false,
      animatePrompt: false,
    });
    finishPrompt("assisted");
  }

  // ------------------------------------------------------------------
  // Write drill plumbing

  function ensureWriteWiring() {
    if (!writeModule || writeDrill || !elements.drawCanvas) {
      return;
    }

    writeDrill = writeModule.createWriteDrill({
      canvas: elements.drawCanvas,
      onEvent: handleWriteDrillEvent,
    });
    if (elements.writeReveal) {
      writeRevealPlayer = writeModule.createStrokePlayer(elements.writeReveal);
    }
    renderKanjiSheets();
  }

  function setDrawNote(note, tone = "info") {
    writeNoteState = note ? { ...note, tone } : null;
    if (!elements.drawNote) {
      return;
    }
    if (!writeNoteState) {
      elements.drawNote.textContent = "";
      elements.drawNote.dataset.tone = "";
      return;
    }
    elements.drawNote.innerHTML = "";
    const jp = document.createElement("span");
    jp.lang = "ja";
    jp.textContent = writeNoteState.jp;
    const en = document.createElement("span");
    en.className = "draw-note__en";
    en.textContent = writeNoteState.en;
    elements.drawNote.append(jp, en);
    elements.drawNote.dataset.tone = tone;
  }

  function renderStrokeTicks() {
    const container = elements.strokeTicks;
    const session = writeDrill?.session;
    if (!container) {
      return;
    }
    if (!session) {
      container.innerHTML = "";
      return;
    }

    if (
      container.childElementCount !== session.total ||
      container.dataset.forGlyph !== session.glyph
    ) {
      container.innerHTML = Array.from(
        { length: session.total },
        () => '<span class="stroke-tick"></span>',
      ).join("");
      container.dataset.forGlyph = session.glyph;
    }

    const drawn = session.drawnCount();
    [...container.children].forEach((tick, index) => {
      tick.dataset.state =
        index < drawn ? "done" : index === drawn ? "next" : "todo";
    });
  }

  function updateDoneButton() {
    const session = writeDrill?.session;
    const show =
      Boolean(session) &&
      session.tier === "recall" &&
      !session.finished &&
      !feedback &&
      session.drawnCount() > 0 &&
      !session.isComplete();
    setHidden(elements.doneButton, !show);
  }

  function handleWriteDrillEvent(event) {
    if (event.type === "stroke" || event.type === "cleared") {
      if (writeNoteState?.tone === "miss") {
        setDrawNote(null);
      }
      renderStrokeTicks();
      updateDoneButton();
      return;
    }

    if (event.type === "ink-start") {
      return;
    }

    if (event.type === "miss") {
      const note = DRAW_NOTES[event.verdict] ?? DRAW_NOTES["no-match"];
      if (event.verdict === "out-of-order") {
        setDrawNote(
          {
            jp: note.jp,
            en: `THAT WAS STROKE ${event.matchedIndex + 1} — STROKE ${event.expectedIndex + 1} COMES FIRST`,
          },
          "miss",
        );
      } else {
        setDrawNote(note, "miss");
      }
      replayAttributeAnimation(elements.drawFrame, "deny");
      return;
    }

    if (event.type === "grading") {
      setDrawNote(DRAW_NOTES.grading, "info");
      return;
    }

    if (event.type === "complete") {
      handleWriteComplete(event.result);
    }
  }

  function handleWriteComplete(result) {
    // Recall grading is async — the user may have switched modes or
    // advanced while the recognizer ran. Only grade the prompt that is
    // still the live write prompt.
    if (
      !currentPrompt ||
      feedback ||
      currentPrompt.kind !== "write" ||
      sessionStore.getState().mode !== "write"
    ) {
      return;
    }

    writeResult = result;
    if (result.hintsUsed > 0) {
      usedHint = true;
    }

    if (result.reason === "recognized-other" && result.recognized && writeModule) {
      setDrawNote(writeModule.lookedLikeNote(result.recognized.label), "miss");
    } else if (result.reason === "stroke-order") {
      setDrawNote(DRAW_NOTES["stroke-order"], "almost");
    } else if (result.reason === "stroke-count") {
      const drawn = writeDrill?.session?.drawnCount() ?? 0;
      const total = writeDrill?.session?.total ?? 0;
      setDrawNote(
        {
          jp: DRAW_NOTES["stroke-count"].jp,
          en: `${drawn} OF ${total} STROKES`,
        },
        "almost",
      );
    } else {
      setDrawNote(null);
    }

    // Correct answers linger a beat longer than typed drills: the reveal
    // stamp + finished character are worth a glance before advancing.
    finishPrompt(result.outcome, { advanceDelay: 1600 });
  }

  // REVEAL in write mode teaches instead of skipping: ghost the character
  // on the canvas, play the stroke-order demo on the poster, and let the
  // learner finish tracing it (graded as assisted).
  function revealWritePrompt() {
    if (!writeDrill?.session || writeDrill.session.finished) {
      return;
    }
    usedHint = true;
    writeDrill.reveal();
    writeDemoShown = true;
    render();
    writeRevealPlayer?.play();
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
    const isWrite = mode === "write";
    const showGlyph = Boolean(prompt) && !isWrite && (!isAural || Boolean(feedback));
    const showWave = Boolean(prompt) && isAural && !feedback;
    // Write mode: the poster is the cue before the answer, and the animated
    // stroke-order reveal after (or during a reveal-assisted attempt).
    const showWriteReveal =
      Boolean(prompt) && isWrite && (Boolean(feedback) || writeDemoShown);
    const showWriteCue = Boolean(prompt) && isWrite && !showWriteReveal;

    setText(elements.scriptLabel, getActiveScriptLabel(session));
    setText(
      elements.stationCode,
      `STA. ${MODE_LETTERS[mode]}-${String(promptIndex).padStart(2, "0")}`,
    );

    elements.promptCard.dataset.outcome = feedback?.outcome ?? "";
    elements.promptCard.dataset.hasAudio = isAural ? "true" : "false";
    elements.promptCard.dataset.mode = mode;

    setHidden(elements.hintChip, !(prompt && usedHint && !feedback));
    setText(
      elements.fontLabel,
      !prompt
        ? ""
        : isWrite
          ? prompt.target.script === "kanji"
            ? `KANJI · GRADE ${prompt.target.grade}`
            : "DICTATION"
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
      // The sheets teach "tap any kana to hear it" — the drill glyph obeys
      // the same rule. Generic label only: the romaji would leak the answer.
      elements.promptGlyph.title = "きく · Hear it";
    } else {
      setText(elements.promptGlyph, "");
      delete elements.promptGlyph.dataset.kanaGroup;
      elements.promptGlyph.className = "poster-kana";
      elements.promptGlyph.removeAttribute("title");
    }

    // The aural answer reveal is a waveform → glyph crossfade between very
    // different shapes; a touch of blur + scale softens it. The attribute
    // only flips once per feedback, so re-renders don't re-trigger it.
    elements.promptGlyph.dataset.reveal =
      isAural && showGlyph ? "true" : "false";

    if (showWriteCue && writeModule) {
      const cue = writeModule.writeCueFor(prompt.target);
      setText(elements.writeCueMain, cue.main);
      setText(elements.writeCueSub, cue.sub);
      elements.writeCue.dataset.cueKind = cue.kind;
      // Kana cues are tap-to-hear, like every glyph elsewhere in the app.
      if (cue.kind === "kana") {
        elements.writeCue.title = "きく · Hear it";
      } else {
        elements.writeCue.removeAttribute("title");
      }
    } else if (elements.writeCue) {
      setText(elements.writeCueMain, "");
      setText(elements.writeCueSub, "");
    }

    if (elements.writeReveal) {
      const revealKey = showWriteReveal ? `${prompt.target.glyph}` : "";
      if (elements.writeReveal.dataset.revealFor !== revealKey) {
        elements.writeReveal.dataset.revealFor = revealKey;
        if (showWriteReveal && writeRevealPlayer) {
          writeRevealPlayer.setGlyph(prompt.target.glyph);
          writeRevealPlayer.play();
        } else {
          writeRevealPlayer?.stop();
        }
      }
    }

    setVisibleState(elements.promptGlyph, showGlyph);
    setVisibleState(elements.audioPosterButton, showWave);
    setVisibleState(elements.writeCue, showWriteCue);
    setVisibleState(elements.writeReveal, showWriteReveal);
    setHidden(elements.emptyState, Boolean(prompt));
    setHidden(
      elements.maruStamp,
      !(
        feedback?.outcome === "correct" &&
        (showGlyph || (isWrite && Boolean(feedback)))
      ),
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

    setHidden(
      elements.answerBlock,
      !prompt && !(session.mode === "write" && !writeModule),
    );

    if (session.mode === "write") {
      setVisibleState(elements.typedBlock, false);
      setVisibleState(elements.answerInput, false);
      setVisibleState(elements.choicesBlock, false);
      setVisibleState(elements.choiceGrid, false);
      setVisibleState(elements.drawBlock, true);
      elements.choiceGrid.innerHTML = "";
      delete elements.choiceGrid.dataset.promptKey;

      const loading = !writeModule;
      elements.drawBlock.dataset.loading = loading ? "true" : "false";

      if (loading || !prompt) {
        elements.strokeTicks.innerHTML = "";
        setHidden(elements.doneButton, true);
        if (loading) {
          setDrawNote(
            { jp: "じゅんびちゅう", en: "LOADING STROKE DATA…" },
            "info",
          );
        } else {
          setDrawNote(null);
        }
        activePromptKey = promptKey;
        return;
      }

      ensureWriteWiring();

      const tier = writeTierFor(prompt.target, session);
      const writeKey = `${promptKey}:${tier}`;

      if (writeDrill && elements.drawBlock.dataset.promptKey !== writeKey) {
        elements.drawBlock.dataset.promptKey = writeKey;
        writeDrill.setPrompt({ glyph: prompt.target.glyph, tier });
        setDrawNote(null);
      }

      const tierLabel = TIER_LABELS[tier];
      setText(elements.tierJp, tierLabel.jp);
      setText(elements.tierEn, session.writeAssist === "auto" ? `AUTO · ${tierLabel.en}` : tierLabel.en);
      elements.tierChip.dataset.tier = tier;

      const locked = Boolean(feedback);
      elements.drawBlock.dataset.finished = locked ? "true" : "false";
      elements.undoButton.disabled = locked;
      elements.clearButton.disabled = locked;
      elements.drawHintButton.disabled = locked || tier === "recall";
      setHidden(elements.drawHintButton, tier === "recall");

      renderStrokeTicks();
      updateDoneButton();
      activePromptKey = promptKey;
      return;
    }

    setVisibleState(elements.drawBlock, false);
    elements.drawBlock.dataset.loading = "false";

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
    // HEAR shows wherever the prompt has audio to give: visual mode always,
    // write mode only for kana targets (kanji prompts have no clips).
    setHidden(
      elements.hearButton,
      session.mode === "sound-to-kana" ||
        (session.mode === "write" && !prompt?.target.audioId),
    );
    if (elements.revealButton) {
      // In write mode REVEAL turns into the traced demo; once shown, the
      // button has done its job for this prompt.
      elements.revealButton.disabled =
        !prompt || Boolean(feedback) || (session.mode === "write" && writeDemoShown);
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

  const KANJI_GRADE_INFO = {
    1: { jp: "いちねんせい", en: "KYŌIKU GRADE 1", badge: "一" },
    2: { jp: "にねんせい", en: "KYŌIKU GRADE 2", badge: "二" },
  };

  function renderKanjiSheets() {
    const container = elements.kanjiContainer;

    if (!container || !writeModule) {
      return;
    }

    const selected = new Set(sessionStore.getState().selectedKanjiGroups);
    const groups = writeModule.kanjiGroups();

    // Same build-once + patch-in-place contract as the kana sheets: the
    // structure never rebuilds, so toggle transitions actually run.
    if (container.dataset.built !== "true") {
      const grades = [...new Set(groups.map((group) => group.grade))];
      container.innerHTML = grades
        .map((grade) => {
          const info = KANJI_GRADE_INFO[grade];
          const gradeGroups = groups.filter((group) => group.grade === grade);

          return `
            <section class="kana-sheet kanji-sheet" data-kanji-sheet="g${grade}">
              <div class="kana-sheet__head">
                <span class="kana-sheet__id">
                  <span class="kana-sheet__badge kanji-sheet__badge" lang="ja" aria-hidden="true">${info.badge}</span>
                  <span class="kana-sheet__names">
                    <span class="kana-sheet__jp" lang="ja">${info.jp}</span>
                    <span class="kana-sheet__en">${info.en}</span>
                  </span>
                </span>
                <span class="kana-sheet__count" data-kanji-sheet-count="g${grade}"></span>
              </div>
              <div class="kana-matrix__head">
                <p class="kana-matrix__label">
                  <span lang="ja">かきとり</span>
                  <span class="kana-matrix__label-en">GROUPS OF TEN</span>
                </p>
                <span class="kana-matrix__actions">
                  <button class="reference-link-action" data-kanji-toggle-all="g${grade}" aria-label="Select all of grade ${grade}" type="button"><span lang="ja">ぜんぶ</span> ALL</button>
                  <button class="reference-link-action reference-link-action--none" data-kanji-toggle-none="g${grade}" aria-label="Clear all of grade ${grade}" type="button"><span lang="ja">なし</span> NONE</button>
                </span>
              </div>
              <div class="kanji-group-grid">
                ${gradeGroups
                  .map(
                    (group) => `
                      <button
                        class="kanji-group"
                        data-kanji-group="${group.id}"
                        data-active="false"
                        aria-pressed="false"
                        type="button"
                      >
                        <span class="kanji-group__code">${group.rangeLabel}</span>
                        <span class="kanji-group__glyphs" lang="ja">${group.members
                          .map(
                            (kanji) =>
                              `<span class="kanji-group__glyph" title="${kanji.meaning}">${kanji.glyph}</span>`,
                          )
                          .join("")}</span>
                      </button>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `;
        })
        .join("");
      container.dataset.built = "true";
    }

    container.querySelectorAll("[data-kanji-group]").forEach((button) => {
      const active = selected.has(button.dataset.kanjiGroup);
      button.dataset.active = active ? "true" : "false";
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    for (const grade of [1, 2]) {
      const count = container.querySelector(
        `[data-kanji-sheet-count="g${grade}"]`,
      );
      if (count) {
        const gradeGroups = groups.filter((group) => group.grade === grade);
        const activeKanji = gradeGroups
          .filter((group) => selected.has(group.id))
          .reduce((sum, group) => sum + group.members.length, 0);
        const total = gradeGroups.reduce(
          (sum, group) => sum + group.members.length,
          0,
        );
        count.textContent = `${activeKanji}/${total} ON`;
      }
    }
  }

  function render() {
    const session = sessionStore.getState();
    const enabledKana = ensurePrompt();
    const referenceKana = getReferenceKana();
    // The record strip reflects what the active mode drills: kana for the
    // sound modes, kana + enabled kanji for the write drill.
    const statsPool =
      session.mode === "write" && writeModule
        ? getWritePool(session)
        : enabledKana;
    const summary = createSummary(statsPool, progressStore);
    const promptFont = getPromptFont(session);

    renderControls(session);
    renderPromptSection(session, currentPrompt, promptFont);
    renderInteraction(session, currentPrompt, promptFont);
    renderActions(session, currentPrompt);
    renderStats(summary, session);
    renderReference(referenceKana, enabledKana);
    renderKanjiSheets();

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

    if (button.dataset.action === "cycle-tier") {
      const order = ["auto", "trace", "guided", "recall"];
      const current = sessionStore.getState().writeAssist ?? "auto";
      const next = order[(order.indexOf(current) + 1) % order.length];
      sessionStore.setState({ writeAssist: next });
      // The tier is part of the drawing session: switching restarts the
      // current character with the new assistance level.
      render();
      return;
    }

    if (button.dataset.action === "draw-undo") {
      writeDrill?.undo();
      return;
    }

    if (button.dataset.action === "draw-clear") {
      writeDrill?.clear();
      return;
    }

    if (button.dataset.action === "draw-hint") {
      if (writeDrill?.hint()) {
        usedHint = true;
        render();
      }
      return;
    }

    if (button.dataset.action === "draw-done") {
      void writeDrill?.finish();
      return;
    }

    if (button.dataset.kanjiGroup) {
      const sessionState = sessionStore.getState();
      const groups = toggleSelection(
        sessionState.selectedKanjiGroups,
        button.dataset.kanjiGroup,
      );
      sessionStore.setState({ selectedKanjiGroups: groups });
      suppressInputFocus = true;
      refreshPromptAfterSelectionChange();
      render();
      return;
    }

    if (button.dataset.kanjiToggleAll || button.dataset.kanjiToggleNone) {
      const grade = button.dataset.kanjiToggleAll ?? button.dataset.kanjiToggleNone;
      const sessionState = sessionStore.getState();
      const kept = sessionState.selectedKanjiGroups.filter(
        (id) => !id.startsWith(`${grade}:`),
      );
      const groups = button.dataset.kanjiToggleAll
        ? [
            ...kept,
            ...(writeModule
              ? writeModule
                  .kanjiGroups()
                  .filter((group) => group.id.startsWith(`${grade}:`))
                  .map((group) => group.id)
              : []),
          ]
        : kept;
      sessionStore.setState({ selectedKanjiGroups: groups });
      suppressInputFocus = true;
      refreshPromptAfterSelectionChange();
      render();
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

  // Tap-to-hear on the drill glyph, mirroring the sheet kana. Pre-answer in
  // visual mode this routes through the same hint rules as HEAR (the chip
  // appears immediately); during feedback it's a free replay of the answer.
  elements.promptGlyph?.addEventListener("click", () => {
    if (!currentPrompt || elements.promptGlyph.dataset.visible !== "true") {
      return;
    }

    void handleAudioPrompt(currentPrompt.target.audioId, {
      animatePrompt: false,
    });
  });

  // The write cue behaves the same for kana targets (dictation replay);
  // kanji cues carry no audio.
  elements.writeCue?.addEventListener("click", () => {
    if (
      !currentPrompt?.target.audioId ||
      elements.writeCue.dataset.visible !== "true"
    ) {
      return;
    }

    void handleAudioPrompt(currentPrompt.target.audioId, {
      markHint: false,
      animatePrompt: false,
    });
  });

  // Tap the finished reveal to watch the stroke order again.
  elements.writeReveal?.addEventListener("click", () => {
    if (elements.writeReveal.dataset.visible === "true") {
      writeRevealPlayer?.play();
    }
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
      // The reveal moment is exactly when you want to re-listen — R
      // replays the answer in both modes (the input is disabled, so the
      // key is free).
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void handleAudioPrompt(currentPrompt?.target.audioId, {
          markHint: false,
          animatePrompt: false,
        });
        return;
      }

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
      sessionStore.getState().mode === "write" &&
      currentPrompt &&
      !(event.target instanceof HTMLInputElement)
    ) {
      // Mechanical keys for the drawing hand's idle side: H hint, U undo,
      // C clear, R replay the kana cue. No animations on these paths.
      const key = event.key.toLowerCase();
      if (key === "h" && !elements.drawHintButton?.hidden) {
        event.preventDefault();
        elements.drawHintButton?.click();
      } else if (key === "u") {
        event.preventDefault();
        writeDrill?.undo();
      } else if (key === "c") {
        event.preventDefault();
        writeDrill?.clear();
      } else if (key === "r" && currentPrompt.target.audioId) {
        event.preventDefault();
        void handleAudioPrompt(currentPrompt.target.audioId, {
          markHint: false,
          animatePrompt: false,
        });
      }
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
