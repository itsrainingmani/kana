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
} from "./prompts.js";
import { createProgressStore, createSessionStore } from "./storage.js";
import { WAVEFORM_DATA } from "./waveforms.js";

const MODE_LABELS = {
  "kana-to-sound": "Visual",
  "sound-to-kana": "Aural",
};

const MODE_ICONS = {
  "kana-to-sound": "keyboard",
  "sound-to-kana": "volume",
};

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"></path>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
  keyboard:
    '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="M6 8h.01"></path><path d="M10 8h.01"></path><path d="M14 8h.01"></path><path d="M18 8h.01"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M7 16h10"></path>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"></rect>',
  volume:
    '<path d="M11 5 6 9H2v6h4l5 4V5Z"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>',
};

const SCRIPT_LABELS = {
  hiragana: "Hiragana",
  katakana: "Katakana",
  mixed: "Mixed",
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

function getColumnLabel(column) {
  if (column === "vowels") {
    return "";
  }

  if (column === "nn") {
    return "ん";
  }

  return column;
}

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

  return "No Kana Active";
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

function normalizeRomaji(value) {
  return value.trim().toLowerCase();
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
  return `${prompt.target.glyph} · ${prompt.target.romaji}`;
}

function renderIcon(name) {
  return `
    <svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${ICONS[name] ?? ""}
    </svg>
  `;
}

function renderControlButtons(
  items,
  activeValues,
  datasetKey,
  className = "brutal-button brutal-button--compact",
) {
  return items
    .map(
      (item) => `
        <button
          class="${className}${item.className ? ` ${item.className}` : ""}"
          data-${datasetKey}="${item.id}"
          data-active="${activeValues.includes(item.id)}"
          type="button"
        >
          ${item.icon ? renderIcon(item.icon) : ""}
          ${item.previewOnly ? `<small>${item.preview}</small>` : `<span>${item.label}</span>`}
          ${item.preview && !item.previewOnly ? `<small>${item.preview}</small>` : ""}
        </button>
      `,
    )
    .join("");
}

function renderReferenceTables(tables, selectedRows) {
  const sheets = ["hiragana", "katakana"]
    .map((script) => {
      const scriptTables = tables.filter((table) => table.script === script);

      if (scriptTables.length === 0) {
        return "";
      }

      const scriptCount = scriptTables.reduce(
        (count, table) =>
          count +
          table.rows.reduce(
            (rowCount, row) =>
              rowCount +
              row.cells.reduce(
                (cellCount, cell) => cellCount + cell.items.length,
                0,
              ),
            0,
          ),
        0,
      );

      return `
        <section class="reference-sheet" data-kana-sheet="${script}">
          <div class="reference-sheet__header">
            <div class="section-heading">
              <p class="module-label">${script === "hiragana" ? "H" : "K"} / Study Sheet</p>
              <h3>${SCRIPT_LABELS[script]}</h3>
            </div>
            <div class="reference-sheet__meta">
              <p class="reference-sheet__count">${scriptCount} kana</p>
            </div>
          </div>
          <div class="reference-sheet__tables">
            ${scriptTables
              .map((table) => {
                const sheetKey = `${table.script}:${table.id}`;
                const activeColumns = selectedRows[sheetKey] ?? [];

                return `
                  <section class="reference-table" data-kana-sheet-matrix="${sheetKey}">
                    <div class="reference-table__topline">
                      <div class="section-heading reference-table__heading">
                        <p class="module-label">${table.label}</p>
                        <p class="reference-table__meta">${table.rows.map((row) => row.label).join(" / ")}</p>
                      </div>
                      <p class="reference-table__actions">
                        <button class="reference-link-action" data-group-toggle-all="${sheetKey}" aria-label="Select all ${table.label}" title="Select all" type="button">${renderIcon("check")}<span class="sr-only">Select all</span></button>
                        <span aria-hidden="true">|</span>
                        <button class="reference-link-action" data-group-toggle-none="${sheetKey}" aria-label="Clear all ${table.label}" title="Clear all" type="button">${renderIcon("square")}<span class="sr-only">Clear all</span></button>
                      </p>
                    </div>
                    <div
                      class="reference-chart"
                      data-reference-group="${table.id}"
                      style="--reference-columns: ${table.columns.length}"
                      role="table"
                      aria-label="${SCRIPT_LABELS[table.script]} ${table.label}"
                    >
                      <div class="reference-chart__header reference-chart__header--rowlabel"></div>
                      ${table.columns
                        .map(
                          (column) => `
                            <button
                              class="reference-chart__header reference-column-toggle"
                              data-reference-column-toggle="${sheetKey}:${column}"
                              data-column-active="${activeColumns.includes(column)}"
                              type="button"
                            >
                              ${getColumnLabel(column)}
                            </button>
                          `,
                        )
                        .join("")}
                      ${table.rows
                        .map(
                          (row) => `
                            <div class="reference-chart__rowlabel">${row.label}</div>
                            ${row.cells
                              .map(
                                (cell) => `
                                <div class="reference-chart__cell reference-chart__stack" data-column-active="${activeColumns.includes(cell.columnId)}">
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
                                          type="button"
                                        >
                                          ${kana.glyph}
                                        </button>
                                      `,
                                    )
                                    .join("")}
                                </div>
                              `,
                              )
                              .join("")}
                          `,
                        )
                        .join("")}
                    </div>
                  </section>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");

  return `
    ${sheets}
  `;
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }

  element.hidden = hidden;
}

function setVisibleState(element, visible) {
  if (!element) {
    return;
  }

  element.hidden = false;
  element.dataset.visible = visible ? "true" : "false";
  element.setAttribute("aria-hidden", visible ? "false" : "true");
}

function setText(element, value) {
  if (!element) {
    return;
  }

  element.textContent = value;
}

function resampleWaveform(values, sampleCount = 100) {
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

  document.title = "Kana Trainer";
  root.dataset.enhanced = "true";

  const sessionStore = createSessionStore();
  const progressStore = createProgressStore();
  const audioClips = createAudioClipMap(KANA_DATA);

  const elements = {
    modeLabel: root.querySelector('[data-slot="mode-label"]'),
    scriptLabel: root.querySelector('[data-slot="script-label"]'),
    promptCard: root.querySelector('[data-region="prompt"]'),
    promptStage: root.querySelector(".prompt-card__stage"),
    promptLabel:
      root.querySelector('[data-slot="prompt-label"]') ??
      root.querySelector(".prompt-card .module-label"),
    promptGlyph: root.querySelector('[data-slot="prompt-glyph"]'),
    promptMeta: root.querySelector('[data-slot="font-label"]'),
    promptStatus: root.querySelector('[data-slot="prompt-status"]'),
    promptStatusMessage: root.querySelector('[data-slot="status-message"]'),
    promptStatusAnswer: root.querySelector('[data-slot="status-answer"]'),
    audioPosterButton: root.querySelector(".prompt-card .audio-poster-button"),
    waveformCanvas: root.querySelector('[data-slot="waveform-canvas"]'),
    answerLabel:
      root.querySelector('[data-slot="answer-label"]') ??
      root.querySelector(".answer-label"),
    answerInput: root.querySelector("[data-answer-input]"),
    answerHelp: root.querySelector('[data-slot="answer-help"]'),
    choiceGrid: root.querySelector("[data-choice-grid]"),
    interactionBody: root.querySelector(".interaction-card__body"),
    hintsCard: root.querySelector('[data-region="hints"]'),
    playSoundButtons: () => root.querySelectorAll('[data-action="play-sound"]'),
    revealButton: root.querySelector('[data-action="reveal"]'),
    modeGroup: root.querySelector("[data-mode-group]"),
    fontGroup: root.querySelector("[data-font-group]"),
    statsAttempts: root.querySelector('[data-slot="stats-attempts"]'),
    statsCorrect: root.querySelector('[data-slot="stats-correct"]'),
    statsAssisted: root.querySelector('[data-slot="stats-assisted"]'),
    statsStrong: root.querySelector('[data-slot="stats-strong"]'),
    referenceContainer: root.querySelector("[data-reference-container]"),
  };

  let promptIndex = 0;
  let currentPrompt = null;
  let feedback = null;
  let typingStatus = null;
  let usedHint = false;
  let advanceTimer = null;
  let activePromptKey = null;
  let activePromptVisualKey = null;
  let selectedChoiceId = null;
  let promptMotionTimer = null;
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

  function clearPromptMotionTimer() {
    if (promptMotionTimer) {
      clearTimeout(promptMotionTimer);
      promptMotionTimer = null;
    }
  }

  function pulsePromptMotion() {
    if (!elements.promptCard) {
      return;
    }

    clearPromptMotionTimer();
    elements.promptCard.dataset.promptMotion = "incoming";
    promptMotionTimer = setTimeout(() => {
      elements.promptCard.dataset.promptMotion = "idle";
      promptMotionTimer = null;
    }, 220);
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

  function scheduleAdvance(delay = 850) {
    clearAdvanceTimer();
    advanceTimer = setTimeout(() => {
      setPrompt();
      render();
      autoplayPromptAudio();
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
    const cssWidth = canvas.clientWidth || canvas.offsetWidth || 320;
    const cssHeight = canvas.clientHeight || canvas.offsetHeight || 56;
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
    ctx.lineWidth = Math.max(1.5, dpr * 1.5);
    ctx.lineCap = "round";

    for (let index = 0; index < activeWaveformBars.length; index += 1) {
      const barX = (index + 0.5) * xGap;
      const barHeight = Math.min(
        halfHeight - dpr,
        halfHeight * activeWaveformBars[index] * 1.76,
      );
      const played = (index + 1) / activeWaveformBars.length <= progress;
      ctx.strokeStyle = played ? "#c82117" : "rgba(17, 17, 17, 0.34)";
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

    const waveform = WAVEFORM_DATA[prompt.target.audioId];

    if (!waveform) {
      activeWaveformBars = [];
      activeWaveformKey = null;
      drawWaveform(0);
      return;
    }

    if (activeWaveformKey !== prompt.target.audioId) {
      activeWaveformBars = resampleWaveform(waveform.v, 100);
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
      sessionStore.getState().mode === "kana-to-sound"
    ) {
      usedHint = true;
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
      typingStatus = {
        outcome: "incorrect",
        message: "Keep typing.",
        answer: "",
      };
      render();
      return;
    }

    typingStatus = null;
    const result = gradeKanaToSoundAnswer(answer, currentPrompt.target.romaji, {
      usedHint,
    });
    recordOutcome(result.outcome);
    feedback = {
      outcome: result.outcome,
      message: "Correct",
      answer: formatAnswerLabel(currentPrompt),
    };
    render();
    scheduleAdvance(700);
  }

  function revealPrompt() {
    if (!currentPrompt || feedback) {
      return;
    }

    typingStatus = null;
    usedHint = true;
    recordOutcome("assisted");
    feedback = {
      outcome: "assisted",
      message: "Answer revealed",
      answer: formatAnswerLabel(currentPrompt),
    };
    render();
    scheduleAdvance(1100);
  }

  function renderControls(session) {
    elements.modeGroup.innerHTML = renderControlButtons(
      [
        {
          id: "kana-to-sound",
          label: MODE_LABELS["kana-to-sound"],
          icon: MODE_ICONS["kana-to-sound"],
        },
        {
          id: "sound-to-kana",
          label: MODE_LABELS["sound-to-kana"],
          icon: MODE_ICONS["sound-to-kana"],
        },
      ],
      [session.mode],
      "mode",
    );

    elements.fontGroup.innerHTML = renderControlButtons(
      FONT_OPTIONS.map((font) => ({
        ...font,
        preview: "あア",
        previewOnly: true,
      })),
      session.enabledFonts,
      "font",
      "font-toggle",
    );
  }

  function renderPromptSection(session, prompt, promptFont) {
    const status = feedback ?? typingStatus;
    const promptVisualKey = prompt
      ? `${session.mode}:${prompt.target.id}:${promptFont.id}`
      : "empty";

    if (elements.promptStatus) {
      elements.promptStatus.hidden = false;
    }

    setText(elements.modeLabel, MODE_LABELS[session.mode]);
    setText(elements.scriptLabel, getActiveScriptLabel(session));

    if (!prompt) {
      elements.promptCard.dataset.outcome = "";
      elements.promptCard.dataset.hasAudio = "false";
      setText(elements.promptLabel, "No Kana Active");
      setText(elements.promptGlyph, "");
      setVisibleState(elements.promptGlyph, false);
      setVisibleState(elements.audioPosterButton, false);
      setText(elements.promptMeta, "");
      setText(elements.promptStatusMessage, "");
      setText(elements.promptStatusAnswer, "");
      elements.promptStatus.dataset.visible = "false";
      elements.promptStatus.setAttribute("aria-hidden", "true");
      elements.promptCard.dataset.promptMotion = "idle";
      activePromptVisualKey = promptVisualKey;
      return;
    }

    if (promptVisualKey !== activePromptVisualKey) {
      pulsePromptMotion();
      activePromptVisualKey = promptVisualKey;
    }

    elements.promptCard.dataset.outcome = status?.outcome ?? "";
    setText(elements.promptMeta, promptFont.label);
    renderAudioState();
    renderWaveform(prompt);

    if (session.mode === "sound-to-kana") {
      elements.promptCard.dataset.hasAudio = "true";
      setText(elements.promptLabel, "Listen, then choose");
      setText(elements.promptGlyph, "");
      delete elements.promptGlyph.dataset.kanaGroup;
      elements.promptGlyph.className = "poster-kana";
      setVisibleState(elements.promptGlyph, false);
      setVisibleState(elements.audioPosterButton, true);
      elements.audioPosterButton.setAttribute("aria-label", "Replay audio");
    } else {
      elements.promptCard.dataset.hasAudio = "false";
      setText(elements.promptLabel, "See, then type");
      setText(elements.promptGlyph, prompt.target.glyph);
      elements.promptGlyph.dataset.kanaGroup = prompt.target.group;
      elements.promptGlyph.className = `poster-kana ${promptFont.className}`;
      setVisibleState(elements.promptGlyph, true);
      setVisibleState(elements.audioPosterButton, false);
      elements.audioPosterButton.setAttribute("aria-label", "Play audio");
    }

    if (!status) {
      setText(elements.promptStatusMessage, "");
      setText(elements.promptStatusAnswer, "");
      elements.promptStatus.dataset.visible = "false";
      elements.promptStatus.setAttribute("aria-hidden", "true");
      return;
    }

    setText(elements.promptStatusMessage, status.message);
    setText(elements.promptStatusAnswer, status.answer ?? "");
    elements.promptStatus.dataset.visible = "true";
    elements.promptStatus.setAttribute("aria-hidden", "false");
  }

  function renderInteraction(session, prompt, promptFont) {
    const promptKey = prompt
      ? `${session.mode}:${prompt.target.id}:${promptFont.id}`
      : "empty";

    if (session.mode === "sound-to-kana" && prompt) {
      setText(elements.answerLabel, "Choose the kana");
      setVisibleState(elements.answerInput, false);
      setVisibleState(elements.answerHelp, false);
      setVisibleState(elements.choiceGrid, true);
      elements.choiceGrid.innerHTML = prompt.options
        .map((option) => {
          let choiceState = "idle";

          if (feedback) {
            if (option.id === prompt.target.id) {
              choiceState = "correct";
            } else if (option.id === selectedChoiceId) {
              choiceState = "incorrect";
            }
          }

          return `
            <button
              class="choice-card ${promptFont.className}"
              data-choice="${option.id}"
              data-kana-group="${option.group}"
              data-state="${choiceState}"
              data-romaji="${option.romaji}"
              type="button"
              ${feedback ? "disabled" : ""}
            >
              <span data-romaji="${option.romaji}">${option.glyph}</span>
            </button>
          `;
        })
        .join("");
    } else {
      const interactionRegion = root.querySelector(
        '[data-region="interaction"]',
      );
      if (interactionRegion) {
        interactionRegion.className = "interaction-card";
      }
      elements.interactionBody.innerHTML = `
        <label class="answer-label" for="kana-answer" data-slot="answer-label">Type the romaji sound</label>
        <input id="kana-answer" class="answer-input" data-answer-input type="text" autocomplete="off" autocapitalize="none" inputmode="latin" placeholder="ka / shi / tsu" spellcheck="false" />
        <p class="answer-help" data-slot="answer-help">Use romaji. Examples: shi, chi, tsu.</p>
        <div class="choice-grid" data-choice-grid hidden></div>
      `;
      elements.answerLabel = root.querySelector('[data-slot="answer-label"]');
      elements.answerInput = root.querySelector("[data-answer-input]");
      elements.answerHelp = root.querySelector('[data-slot="answer-help"]');
      elements.choiceGrid = root.querySelector("[data-choice-grid]");
      elements.answerInput.addEventListener("input", (event) => {
        resolveKanaTyping(event.currentTarget.value);
      });
      setText(elements.answerLabel, "Type the romaji sound");
      setVisibleState(elements.answerInput, true);
      setVisibleState(elements.answerHelp, true);
      setVisibleState(elements.choiceGrid, false);
      elements.choiceGrid.innerHTML = "";

      if (activePromptKey !== promptKey) {
        elements.answerInput.value = "";
      }
      elements.answerInput.disabled = Boolean(feedback || !prompt);
      elements.answerInput.dataset.state =
        feedback?.outcome ?? typingStatus?.outcome ?? "pending";
      elements.answerInput.setAttribute(
        "aria-invalid",
        typingStatus?.outcome === "incorrect" ? "true" : "false",
      );
    }

    activePromptKey = promptKey;
  }

  function renderHints(session, prompt) {
    const hidden = !prompt || Boolean(feedback);
    setHidden(elements.hintsCard, hidden);

    if (hidden) {
      return;
    }

    elements.playSoundButtons().forEach((button) => {
      if (button === elements.audioPosterButton) {
        return;
      }

      const label = session.mode === "sound-to-kana" ? "Replay" : "Hear";
      button.innerHTML = `${renderIcon("volume")}<span>${label}</span>`;
      button.setAttribute("aria-label", label);
      button.disabled = false;
      button.hidden = session.mode === "sound-to-kana";
    });
    elements.revealButton.innerHTML = `${renderIcon("eye")}<span>Reveal</span>`;
    elements.revealButton.setAttribute("aria-label", "Reveal answer");
    elements.revealButton.disabled = false;
  }

  function renderStats(summary) {
    elements.statsAttempts.textContent = String(summary.attempts);
    elements.statsCorrect.textContent = String(summary.correct);
    elements.statsAssisted.textContent = String(summary.assisted);
    elements.statsStrong.textContent = String(summary.strong);
  }

  function renderReference(referenceKana) {
    const tables = createKanaSelectionMatrices(referenceKana);
    elements.referenceContainer.innerHTML = renderReferenceTables(
      tables,
      sessionStore.getState().selectedRows,
    );
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
    renderHints(session, currentPrompt);
    renderStats(summary);
    renderReference(referenceKana);

    if (
      session.mode === "kana-to-sound" &&
      currentPrompt &&
      !feedback &&
      !suppressInputFocus
    ) {
      elements.answerInput.focus();
    }

    suppressInputFocus = false;
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");

    if (!button || !root.contains(button)) {
      return;
    }

    if (button.dataset.mode) {
      sessionStore.setState({ mode: button.dataset.mode });
      setPrompt();
      render();
      autoplayPromptAudio();
      return;
    }

    if (button.dataset.font) {
      const sessionState = sessionStore.getState();
      sessionStore.setState({
        enabledFonts: ensureAtLeastOne(
          sessionState.enabledFonts,
          button.dataset.font,
        ),
      });
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
      await handleAudioPrompt(button.dataset.referenceAudioId, {
        markHint: false,
        animatePrompt: false,
      });
      return;
    }

    if (button.dataset.choice && currentPrompt && !feedback) {
      typingStatus = null;
      selectedChoiceId = button.dataset.choice;
      const result = gradeSoundToKanaAnswer(
        button.dataset.choice,
        currentPrompt.target.id,
        {
          usedHint,
        },
      );
      recordOutcome(result.outcome);
      feedback = {
        outcome: result.outcome,
        message: result.correct ? "Correct" : "Expected",
        answer: formatAnswerLabel(currentPrompt),
      };
      render();
      scheduleAdvance(result.correct ? 700 : 950);
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
