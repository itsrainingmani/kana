import { playKanaAudio } from './audio.js';
import { FONT_OPTIONS, GROUP_OPTIONS, KANA_DATA, ROW_OPTIONS } from './kana-data.js';
import { createDrawingPad, gradeStrokeSet, renderStrokeOrderSvg } from './drawing.js';
import {
  buildEnabledKanaSet,
  createDrawingPrompt,
  createKanaToSoundPrompt,
  createSoundToKanaPrompt,
  getMasteryLabel,
  gradeKanaToSoundAnswer,
  gradeSoundToKanaAnswer
} from './prompts.js';
import { createProgressStore, createSessionStore } from './storage.js';

function toggleItem(items, value) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function getPromptFont(promptIndex, fontDifficulty) {
  if (fontDifficulty === 'calm') {
    return FONT_OPTIONS[0];
  }

  return FONT_OPTIONS[promptIndex % FONT_OPTIONS.length];
}

function createSummary(enabledKana, progressStore) {
  return enabledKana.reduce(
    (summary, kana) => {
      const stats = progressStore.getKanaStats(kana.id);
      summary.attempts += stats.attempts;
      summary.correct += stats.correct;
      summary.shaky += getMasteryLabel(stats) === 'shaky' ? 1 : 0;
      return summary;
    },
    { attempts: 0, correct: 0, shaky: 0 }
  );
}

function createPromptForMode(mode, enabledKana) {
  if (enabledKana.length === 0) {
    return null;
  }

  if (mode === 'sound-to-kana') {
    return createSoundToKanaPrompt(enabledKana);
  }

  if (mode === 'drawing') {
    return createDrawingPrompt(enabledKana);
  }

  return createKanaToSoundPrompt(enabledKana);
}

function describePrompt(prompt, mode, fontClass) {
  if (!prompt) {
    return `
      <section class="prompt-card" data-region="prompt">
        <p class="module-label">No Kana Enabled</p>
        <p class="empty-copy">Turn on at least one row and group to begin drilling.</p>
      </section>
    `;
  }

  if (mode === 'sound-to-kana') {
    return `
      <section class="prompt-card prompt-card--listening" data-region="prompt">
        <p class="module-label">Listen / Select</p>
        <p class="poster-copy">Play the syllable and choose the matching kana.</p>
      </section>
    `;
  }

  if (mode === 'drawing') {
    return `
      <section class="prompt-card prompt-card--drawing" data-region="prompt">
        <p class="module-label">Draw This Sound</p>
        <p class="poster-roman">${prompt.target.romaji}</p>
      </section>
    `;
  }

  return `
    <section class="prompt-card" data-region="prompt">
      <p class="module-label">Kana / Sound</p>
      <div class="poster-kana ${fontClass}">${prompt.target.glyph}</div>
      <p class="poster-copy">Type the romaji reading.</p>
    </section>
  `;
}

function describeInteraction(prompt, mode, feedback) {
  if (!prompt) {
    return `
      <section class="interaction-card" data-region="interaction">
        <p class="module-label">Ready</p>
      </section>
    `;
  }

  if (feedback) {
    return `
      <section class="interaction-card" data-region="interaction">
        <button class="brutal-button brutal-button--accent" data-action="next">Next Prompt</button>
      </section>
    `;
  }

  if (mode === 'sound-to-kana') {
    return `
      <section class="interaction-card" data-region="interaction">
        <div class="choice-grid">
          ${prompt.options
            .map(
              (option) => `
                <button class="choice-card" data-choice="${option.id}">
                  ${option.glyph}
                </button>
              `
            )
            .join('')}
        </div>
      </section>
    `;
  }

  if (mode === 'drawing') {
    return `
      <section class="interaction-card" data-region="interaction">
        <canvas class="drawing-pad" data-drawing-pad width="320" height="320"></canvas>
        <div class="drawing-actions">
          <button class="brutal-button" data-action="clear-drawing">Clear</button>
          <button class="brutal-button brutal-button--accent" data-action="submit-drawing">Check</button>
        </div>
        <div class="stroke-guide" data-stroke-guide></div>
      </section>
    `;
  }

  return `
    <section class="interaction-card" data-region="interaction">
      <form class="answer-form" data-answer-form>
        <label class="answer-label" for="kana-answer">Romaji</label>
        <input id="kana-answer" class="answer-input" data-answer-input type="text" autocomplete="off" />
        <button class="brutal-button brutal-button--accent" type="submit">Check</button>
      </form>
    </section>
  `;
}

function describeFeedback(prompt, mode, feedback, showStrokeGuide) {
  if (!prompt) {
    return `
      <section class="feedback-card" data-region="feedback">
        <p class="module-label">Feedback</p>
        <p class="feedback-copy">No active prompt.</p>
      </section>
    `;
  }

  if (!feedback) {
    return `
      <section class="feedback-card" data-region="feedback">
        <p class="module-label">Feedback</p>
        <p class="feedback-copy">Awaiting answer.</p>
        ${showStrokeGuide && prompt.target.strokes ? renderStrokeOrderSvg(prompt.target.strokes) : ''}
      </section>
    `;
  }

  const answerLabel =
    mode === 'drawing'
      ? `${prompt.target.romaji} · ${prompt.target.glyph}`
      : `${prompt.target.glyph} · ${prompt.target.romaji}`;

  return `
    <section class="feedback-card" data-region="feedback" data-outcome="${feedback.outcome}">
      <p class="module-label">Feedback</p>
      <p class="feedback-copy">${feedback.message}</p>
      <p class="feedback-answer">${answerLabel}</p>
      ${showStrokeGuide && prompt.target.strokes ? renderStrokeOrderSvg(prompt.target.strokes) : ''}
    </section>
  `;
}

function describeHints(prompt, mode, showStrokeGuide) {
  if (!prompt) {
    return `
      <section class="hints-card" data-region="hints"></section>
    `;
  }

  return `
    <section class="hints-card" data-region="hints">
      <p class="module-label">Hints</p>
      <div class="toolbar-row">
        <button class="brutal-button" data-action="play-sound">${mode === 'sound-to-kana' ? 'Play Sound' : 'Hear Answer'}</button>
        <button class="brutal-button" data-action="toggle-strokes">${showStrokeGuide ? 'Hide Stroke Order' : 'Show Stroke Order'}</button>
        <button class="brutal-button" data-action="reveal">Reveal</button>
      </div>
    </section>
  `;
}

function describeProgress(enabledKana, progressStore) {
  const summary = createSummary(enabledKana, progressStore);

  return `
    <section class="progress-card" data-region="progress">
      <div class="stats-strip">
        <div>
          <p class="module-label">Attempts</p>
          <p class="stats-value">${summary.attempts}</p>
        </div>
        <div>
          <p class="module-label">Correct</p>
          <p class="stats-value">${summary.correct}</p>
        </div>
        <div>
          <p class="module-label">Shaky</p>
          <p class="stats-value">${summary.shaky}</p>
        </div>
      </div>
      <div class="progress-grid">
        ${enabledKana
          .map((kana) => {
            const mastery = getMasteryLabel(progressStore.getKanaStats(kana.id));
            return `
              <div class="progress-chip" data-mastery="${mastery}">
                <span>${kana.glyph}</span>
                <small>${kana.romaji}</small>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function describeControls(session) {
  return `
    <header class="toolbar" data-region="controls">
      <section class="toolbar-panel">
        <p class="module-label">Mode</p>
        <div class="toolbar-row">
          ${['kana-to-sound', 'sound-to-kana', 'drawing']
            .map(
              (mode) => `
                <button
                  class="brutal-button"
                  data-mode="${mode}"
                  data-active="${session.mode === mode}"
                >
                  ${mode.replaceAll('-', ' ')}
                </button>
              `
            )
            .join('')}
        </div>
      </section>
      <section class="toolbar-panel">
        <p class="module-label">Script</p>
        <div class="toolbar-row">
          ${['hiragana', 'katakana', 'mixed']
            .map(
              (script) => `
                <button
                  class="brutal-button"
                  data-script="${script}"
                  data-active="${session.scriptMode === script}"
                >
                  ${script}
                </button>
              `
            )
            .join('')}
        </div>
      </section>
      <section class="toolbar-panel">
        <p class="module-label">Rows</p>
        <div class="toolbar-row toolbar-row--compact">
          ${ROW_OPTIONS.map(
            (row) => `
              <button
                class="brutal-button brutal-button--compact"
                data-row="${row.id}"
                data-active="${session.enabledRows.includes(row.id)}"
              >
                ${row.label}
              </button>
            `
          ).join('')}
        </div>
      </section>
      <section class="toolbar-panel">
        <p class="module-label">Groups</p>
        <div class="toolbar-row">
          ${GROUP_OPTIONS.map(
            (group) => `
              <button
                class="brutal-button brutal-button--compact"
                data-group="${group.id}"
                data-active="${session.enabledGroups.includes(group.id)}"
              >
                ${group.label}
              </button>
            `
          ).join('')}
        </div>
      </section>
      <section class="toolbar-panel">
        <p class="module-label">Fonts</p>
        <div class="toolbar-row">
          <button
            class="brutal-button brutal-button--compact"
            data-font-difficulty="standard"
            data-active="${session.fontDifficulty === 'standard'}"
          >
            Rotate
          </button>
          <button
            class="brutal-button brutal-button--compact"
            data-font-difficulty="calm"
            data-active="${session.fontDifficulty === 'calm'}"
          >
            Calm
          </button>
        </div>
      </section>
    </header>
  `;
}

export function createApp(root = document.querySelector('#app')) {
  document.title = 'Kana Trainer';

  const sessionStore = createSessionStore();
  const progressStore = createProgressStore();
  let promptIndex = 0;
  let currentPrompt = null;
  let feedback = null;
  let usedHint = false;
  let showStrokeGuide = false;
  let drawingPad = null;

  function nextPrompt() {
    const session = sessionStore.getState();
    const enabledKana = buildEnabledKanaSet(KANA_DATA, session);
    currentPrompt = createPromptForMode(session.mode, enabledKana);
    promptIndex += 1;
    feedback = null;
    usedHint = false;
    showStrokeGuide = false;
  }

  function ensurePrompt() {
    const session = sessionStore.getState();
    const enabledKana = buildEnabledKanaSet(KANA_DATA, session);

    if (!currentPrompt || !enabledKana.some((kana) => kana.id === currentPrompt.target.id)) {
      currentPrompt = createPromptForMode(session.mode, enabledKana);
      feedback = null;
      usedHint = false;
      showStrokeGuide = false;
    }

    return enabledKana;
  }

  function render() {
    if (!root) {
      return;
    }

    if (drawingPad) {
      drawingPad.destroy();
      drawingPad = null;
    }

    const session = sessionStore.getState();
    const enabledKana = ensurePrompt();
    const font = getPromptFont(promptIndex, session.fontDifficulty);

    root.innerHTML = `
      <main class="app-shell">
        <section class="poster-meta">
          <p class="poster-kicker">Kana Trainer</p>
          <p class="poster-slug">Focused drill / editorial brutalism / mobile first</p>
        </section>
        ${describeControls(session)}
        ${describePrompt(currentPrompt, session.mode, font.className)}
        ${describeInteraction(currentPrompt, session.mode, feedback)}
        ${describeHints(currentPrompt, session.mode, showStrokeGuide)}
        ${describeFeedback(currentPrompt, session.mode, feedback, showStrokeGuide)}
        ${describeProgress(enabledKana, progressStore)}
      </main>
    `;

    root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        sessionStore.setState({ mode: button.dataset.mode });
        nextPrompt();
        render();
      });
    });

    root.querySelectorAll('[data-script]').forEach((button) => {
      button.addEventListener('click', () => {
        sessionStore.setState({ scriptMode: button.dataset.script });
        nextPrompt();
        render();
      });
    });

    root.querySelectorAll('[data-row]').forEach((button) => {
      button.addEventListener('click', () => {
        const sessionState = sessionStore.getState();
        sessionStore.setState({
          enabledRows: toggleItem(sessionState.enabledRows, button.dataset.row)
        });
        nextPrompt();
        render();
      });
    });

    root.querySelectorAll('[data-group]').forEach((button) => {
      button.addEventListener('click', () => {
        const sessionState = sessionStore.getState();
        sessionStore.setState({
          enabledGroups: toggleItem(sessionState.enabledGroups, button.dataset.group)
        });
        nextPrompt();
        render();
      });
    });

    root.querySelectorAll('[data-font-difficulty]').forEach((button) => {
      button.addEventListener('click', () => {
        sessionStore.setState({ fontDifficulty: button.dataset.fontDifficulty });
        render();
      });
    });

    root.querySelector('[data-action="play-sound"]')?.addEventListener('click', async () => {
      if (!currentPrompt) {
        return;
      }

      if (session.mode !== 'sound-to-kana') {
        usedHint = true;
      }

      await playKanaAudio(currentPrompt.target.glyph);
    });

    root.querySelector('[data-action="toggle-strokes"]')?.addEventListener('click', () => {
      if (!currentPrompt?.target.strokes) {
        return;
      }

      showStrokeGuide = !showStrokeGuide;
      if (showStrokeGuide) {
        usedHint = true;
      }
      render();
    });

    root.querySelector('[data-action="reveal"]')?.addEventListener('click', () => {
      if (!currentPrompt) {
        return;
      }

      usedHint = true;
      showStrokeGuide = Boolean(currentPrompt.target.strokes);
      feedback = {
        outcome: 'assisted',
        message: 'Answer revealed.'
      };
      render();
    });

    root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      nextPrompt();
      render();
    });

    if (session.mode === 'kana-to-sound' && currentPrompt && !feedback) {
      root.querySelector('[data-answer-form]')?.addEventListener('submit', (event) => {
        event.preventDefault();

        const value = root.querySelector('[data-answer-input]')?.value ?? '';
        const result = gradeKanaToSoundAnswer(value, currentPrompt.target.romaji, { usedHint });
        progressStore.record(currentPrompt.target.id, 'kana-to-sound', result.outcome);
        feedback = {
          outcome: result.outcome,
          message: result.correct
            ? `Correct: ${currentPrompt.target.romaji}`
            : `Not quite. Expected ${currentPrompt.target.romaji}.`
        };
        render();
      });
    }

    if (session.mode === 'sound-to-kana' && currentPrompt && !feedback) {
      root.querySelectorAll('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          const result = gradeSoundToKanaAnswer(button.dataset.choice, currentPrompt.target.id, {
            usedHint
          });
          progressStore.record(currentPrompt.target.id, 'sound-to-kana', result.outcome);
          feedback = {
            outcome: result.outcome,
            message: result.correct ? 'Correct selection.' : 'Wrong kana selected.'
          };
          render();
        });
      });
    }

    if (session.mode === 'drawing' && currentPrompt) {
      const canvas = root.querySelector('[data-drawing-pad]');
      if (canvas) {
        drawingPad = createDrawingPad(canvas);
      }

      root.querySelector('[data-action="clear-drawing"]')?.addEventListener('click', () => {
        drawingPad?.clear();
      });

      root.querySelector('[data-action="submit-drawing"]')?.addEventListener('click', () => {
        if (!drawingPad) {
          return;
        }

        const result = gradeStrokeSet(drawingPad.getNormalizedStrokes(), currentPrompt.target.strokes);
        progressStore.record(currentPrompt.target.id, 'drawing', result.outcome);
        feedback = {
          outcome: result.outcome,
          message: result.correct ? 'Stroke order looks right.' : result.message
        };
        render();
      });

      const guide = root.querySelector('[data-stroke-guide]');
      if (guide && showStrokeGuide && currentPrompt.target.strokes) {
        guide.innerHTML = renderStrokeOrderSvg(currentPrompt.target.strokes);
      }
    }
  }

  nextPrompt();
  render();

  return {
    sessionStore,
    progressStore,
    nextPrompt,
    render
  };
}
