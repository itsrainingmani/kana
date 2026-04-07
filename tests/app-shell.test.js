import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { KANA_DATA } from '../src/kana-data.js';

class MockAudio {
  static instances = [];

  constructor(src) {
    this.src = src;
    this.preload = 'none';
    MockAudio.instances.push(this);
  }

  play() {
    return Promise.resolve();
  }

  finish() {
    if (typeof this.onended === 'function') {
      this.onended();
    }
  }
}

const APP_SCAFFOLD = `
  <main id="app" class="app-shell" data-enhanced="false">
    <header class="poster-meta">
      <div>
        <p class="poster-kicker">Kana Trainer</p>
        <h1 class="poster-title">Focused Drill</h1>
      </div>
      <div class="poster-sidecar">
        <p class="poster-slug" data-slot="mode-label">Kana To Sound</p>
        <p class="poster-slug" data-slot="script-label">Hiragana</p>
      </div>
    </header>
    <section class="drill-stage">
        <section class="prompt-card" data-region="prompt">
          <div class="prompt-card__rail">
            <p class="module-label" data-slot="prompt-label">See / Type</p>
            <p class="prompt-meta" data-slot="font-label">Gothic</p>
          </div>
        <div class="prompt-card__stage">
          <div class="poster-kana font-gothic" data-slot="prompt-glyph">あ</div>
          <button class="audio-poster-button" data-action="play-sound" data-audio-state="idle" type="button" hidden>
            <span class="audio-waveform" data-slot="audio-waveform" aria-hidden="true">
              <canvas class="audio-waveform__canvas" data-slot="waveform-canvas"></canvas>
            </span>
            <span class="sr-only">Replay syllable</span>
          </button>
        </div>
        <div class="prompt-status" data-slot="prompt-status" data-visible="false" aria-hidden="true">
          <p class="prompt-status__message" data-slot="status-message"></p>
          <p class="prompt-status__answer" data-slot="status-answer"></p>
        </div>
      </section>
      <section class="interaction-card" data-region="interaction">
        <div class="interaction-card__body">
          <label class="answer-label" for="kana-answer" data-slot="answer-label">Type Romaji</label>
          <input id="kana-answer" class="answer-input" data-answer-input type="text" autocomplete="off" autocapitalize="none" inputmode="latin" placeholder="ka / shi / tsu" spellcheck="false" />
          <div class="choice-grid" data-choice-grid hidden></div>
        </div>
      </section>
      <section class="hints-card" data-region="hints">
        <p class="module-label">Hints</p>
        <div class="hints-card__body" aria-hidden="true"></div>
        <div class="toolbar-row hints-card__actions">
          <button class="brutal-button" data-action="play-sound" type="button">Hear</button>
          <button class="brutal-button" data-action="reveal" type="button">Reveal</button>
        </div>
      </section>
    </section>
    <section class="mode-rack" data-region="mode-controls">
      <section class="control-card control-card--mode">
        <p class="module-label">Mode</p>
        <div class="toolbar-row" data-mode-group></div>
      </section>
    </section>
    <section class="control-rack" data-region="controls">
      <div class="control-strip">
        <section class="control-card control-card--fonts">
          <p class="module-label">Fonts</p>
          <div class="font-grid" data-font-group></div>
        </section>
      </div>
      <div class="stats-strip">
        <div><p class="module-label">Attempts</p><p class="stats-value" data-slot="stats-attempts">0</p></div>
        <div><p class="module-label">Correct</p><p class="stats-value" data-slot="stats-correct">0</p></div>
        <div><p class="module-label">Assisted</p><p class="stats-value" data-slot="stats-assisted">0</p></div>
        <div><p class="module-label">Strong</p><p class="stats-value" data-slot="stats-strong">0</p></div>
      </div>
    </section>
    <section class="kana-sheets" data-region="kana-sheets">
      <div class="reference-panel__body" data-reference-container></div>
    </section>
  </main>
`;

describe('app shell', () => {
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
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      lineCap: 'round'
    }));
  });

  it('renders the drill-first workspace with central controls and kana sheets', () => {
    createApp(document.querySelector('#app'));

    expect(document.querySelector('[data-region="prompt"]')).toBeTruthy();
    expect(document.querySelector('[data-region="controls"]')).toBeTruthy();
    expect(document.querySelector('[data-region="mode-controls"]')).toBeTruthy();
    expect(document.querySelector('[data-region="interaction"]')).toBeTruthy();
    expect(document.querySelector('[data-region="kana-sheets"]')).toBeTruthy();
    expect(document.querySelector('[data-settings-panel]')).toBeNull();
    expect(document.querySelector('[data-reference-panel]')).toBeNull();
  });

  it('places mode controls below the drill and renders glyph-only font buttons', () => {
    createApp(document.querySelector('#app'));

    const drill = document.querySelector('.drill-stage');
    const modeControls = document.querySelector('[data-region="mode-controls"]');
    const firstFontButton = document.querySelector('[data-font]');

    expect(drill?.compareDocumentPosition(modeControls ?? document.body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstFontButton?.textContent?.trim()).toBe('あア');
    expect(firstFontButton?.querySelector('small')).toBeTruthy();
    expect(firstFontButton?.querySelector('span')).toBeNull();
  });

  it('enhances the authored HTML scaffold instead of replacing the app root', () => {
    const root = document.querySelector('#app');
    const promptRegion = document.querySelector('[data-region="prompt"]');

    createApp(root);

    expect(document.querySelector('#app')).toBe(root);
    expect(document.querySelector('[data-region="prompt"]')).toBe(promptRegion);
    expect(root?.getAttribute('data-enhanced')).toBe('true');
  });

  it('shows a live kana prompt by default', () => {
    createApp(document.querySelector('#app'));

    expect(document.querySelector('.poster-kana')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector('[data-answer-input]')).toBeTruthy();
    expect(document.querySelector('.audio-poster-button')?.getAttribute('data-visible')).toBe('false');
    expect(document.querySelector('[data-answer-input]')?.getAttribute('data-visible')).toBe('true');
    expect(document.querySelector('[data-choice-grid]')?.getAttribute('data-visible')).toBe('false');
    expect(document.querySelector('[data-region="prompt"]')?.getAttribute('data-has-audio')).toBe('false');
  });

  it('keeps drawing mode and the old setup section out of the v1 controls', () => {
    createApp(document.querySelector('#app'));

    const modeButtons = [...document.querySelectorAll('[data-mode]')].map((button) =>
      button.textContent?.trim().toLowerCase()
    );

    expect(modeButtons).toContain('kana to sound');
    expect(modeButtons).toContain('sound to kana');
    expect(modeButtons).toContain('sound to drawing');
    expect(document.querySelector('[data-script-group]')).toBeNull();
    expect(document.querySelector('[data-group-group]')).toBeNull();
  });

  it('renders sound-to-drawing with drawing controls and no visible clue initially', () => {
    createApp(document.querySelector('#app'), {
      classifierClient: {
        classify: () => Promise.resolve({ matches: [] }),
        warmup: () => {}
      }
    });

    document.querySelector('[data-mode="sound-to-drawing"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.querySelector('[data-drawing-pad]')).toBeTruthy();
    expect(document.querySelector('[data-action="submit-drawing"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="prompt-glyph"]')?.textContent?.trim()).toBe('');
  });

  it('reveals romaji after the first failed sound-to-drawing attempt', async () => {
    const app = createApp(document.querySelector('#app'), {
      classifierClient: {
        classify: () => Promise.resolve({ matches: [{ glyph: 'い', confidence: 0.8 }] }),
        warmup: () => {}
      }
    });

    document.querySelector('[data-mode="sound-to-drawing"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    app.setDrawingSubmissionForTest([[[0.1, 0.1], [0.9, 0.9]]]);

    document.querySelector('[data-action="submit-drawing"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[data-slot="status-answer"]')?.textContent?.toLowerCase()).not.toBe('');
  });

  it('keeps kana-to-sound on the same prompt until the exact answer is typed', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    createApp(document.querySelector('#app'));

    const initialPrompt = document.querySelector('.poster-kana')?.textContent;
    const input = document.querySelector('[data-answer-input]');

    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('.poster-kana')?.textContent).toBe(initialPrompt);

    input.value = 'a';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('.poster-kana')?.textContent).toBe(initialPrompt);
    expect(document.querySelector('.prompt-status')?.textContent?.toLowerCase()).toContain('correct');

    randomSpy.mockRestore();
  });

  it('shows an unresolved mismatch state without advancing or recording progress', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    createApp(document.querySelector('#app'));

    const initialPrompt = document.querySelector('.poster-kana')?.textContent;
    const input = document.querySelector('[data-answer-input]');

    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelector('.poster-kana')?.textContent).toBe(initialPrompt);
    expect(document.querySelector('.prompt-card')?.getAttribute('data-outcome')).toBe('incorrect');
    expect(document.querySelector('[data-slot="prompt-status"]')?.getAttribute('data-visible')).toBe(
      'true'
    );
    expect(document.querySelector('[data-slot="status-message"]')?.textContent?.toLowerCase()).toContain(
      'keep typing'
    );
    expect(document.querySelector('[data-slot="stats-attempts"]')?.textContent).toBe('0');
    expect(document.querySelector('[data-slot="stats-correct"]')?.textContent).toBe('0');

    randomSpy.mockRestore();
  });

  it('plays audio from the reference without toggling the family column', async () => {
    createApp(document.querySelector('#app'));
    const kana = document.querySelector(
      '[data-reference-audio-id][data-reference-column-toggle-target="hiragana:core:vowels"]'
    );

    expect(
      document.querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')?.getAttribute(
        'data-column-active'
      )
    ).toBe('true');

    kana?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].src).toMatch(/^audio\/mp3\/.+\.mp3$/);
    expect(
      document.querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')?.getAttribute(
        'data-column-active'
      )
    ).toBe('true');
  });

  it('does not move focus to the romaji input when a family column is toggled', () => {
    createApp(document.querySelector('#app'));

    const rowToggle = document.querySelector('[data-reference-column-toggle="hiragana:core:vowels"]');
    const input = document.querySelector('[data-answer-input]');

    rowToggle?.focus();
    rowToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(document.activeElement).not.toBe(input);
    expect(
      document
        .querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')
        ?.getAttribute('data-column-active')
    ).toBe('false');
  });

  it('does not animate the listen prompt waveform when reference audio is clicked', async () => {
    createApp(document.querySelector('#app'));

    document.querySelector('[data-mode="sound-to-kana"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await Promise.resolve();

    expect(document.querySelector('.audio-poster-button')?.getAttribute('data-audio-state')).toBe(
      'playing'
    );

    MockAudio.instances[0].finish();
    await Promise.resolve();

    expect(document.querySelector('.audio-poster-button')?.getAttribute('data-audio-state')).toBe(
      'idle'
    );

    document.querySelector('[data-reference-audio-id]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(2);
    expect(document.querySelector('.audio-poster-button')?.getAttribute('data-audio-state')).toBe(
      'idle'
    );
  });

  it('autoplays sound-to-kana prompts with six choices and waveform state', async () => {
    createApp(document.querySelector('#app'));

    document.querySelector('[data-mode="sound-to-kana"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await Promise.resolve();

    expect(MockAudio.instances).toHaveLength(1);
    expect(document.querySelectorAll('.choice-card')).toHaveLength(6);
    expect(document.querySelector('[data-action="play-sound"]')?.getAttribute('data-audio-state')).toBe(
      'playing'
    );
    expect(document.querySelector('[data-slot="waveform-canvas"]')).toBeTruthy();

    MockAudio.instances[0].finish();
    await Promise.resolve();

    expect(document.querySelector('[data-action="play-sound"]')?.getAttribute('data-audio-state')).toBe(
      'idle'
    );
  });

  it('marks selected and correct choices after a sound-to-kana answer', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    createApp(document.querySelector('#app'));

    document.querySelector('[data-mode="sound-to-kana"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await Promise.resolve();

    const expectedGlyph = KANA_DATA.find((kana) => kana.script === 'hiragana' && kana.group === 'base')
      ?.glyph;
    const wrongChoice = [...document.querySelectorAll('.choice-card')].find(
      (button) => button.textContent?.trim() !== expectedGlyph
    );

    wrongChoice?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(
      [...document.querySelectorAll('.choice-card')].find(
        (button) => button.textContent?.trim() === wrongChoice?.textContent?.trim()
      )?.getAttribute('data-state')
    ).toBe('incorrect');
    expect(
      [...document.querySelectorAll('.choice-card')].find(
        (button) => button.textContent?.trim() === expectedGlyph
      )?.getAttribute('data-state')
    ).toBe('correct');

    randomSpy.mockRestore();
  });

  it('clears the kana glyph from the prompt card in sound-to-kana mode', async () => {
    createApp(document.querySelector('#app'));

    document.querySelector('[data-mode="sound-to-kana"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );

    await Promise.resolve();

    const promptGlyph = document.querySelector('[data-slot="prompt-glyph"]');

    expect(promptGlyph?.getAttribute('data-visible')).toBe('false');
    expect(promptGlyph?.textContent).toBe('');
    expect(document.querySelector('[data-region="prompt"]')?.getAttribute('data-has-audio')).toBe(
      'true'
    );
  });

  it('sizes the combination matrix to the full family-column layout', () => {
    createApp(document.querySelector('#app'));

    const combinationTable = document.querySelector(
      '[data-kana-sheet-matrix="hiragana:combination"] .reference-chart'
    );
    expect(combinationTable?.getAttribute('style')).toContain('--reference-columns: 11');
  });

  it('uses persistent kana sheets with fixed core and combination matrices', () => {
    createApp(document.querySelector('#app'));

    expect(document.querySelector('[data-kana-sheet="hiragana"]')).toBeTruthy();
    expect(document.querySelector('[data-kana-sheet="katakana"]')).toBeTruthy();
    expect(document.querySelector('[data-kana-sheet-matrix="hiragana:core"]')).toBeTruthy();
    expect(document.querySelector('[data-kana-sheet-matrix="katakana:core"]')).toBeTruthy();
    expect(document.querySelector('[data-kana-sheet-matrix="hiragana:combination"]')).toBeTruthy();
    expect(document.querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')).toBeTruthy();
    expect(document.querySelector('[data-reference-column-toggle="hiragana:core:nn"]')).toBeTruthy();
    expect(document.querySelector('[data-group-toggle-all="hiragana:core"]')).toBeTruthy();
    expect(document.querySelector('[data-group-toggle-none="hiragana:core"]')).toBeTruthy();
    expect(document.querySelector('[data-reference-column-toggle="hiragana:combination:d"]')).toBeNull();
  });

  it('supports matrix-level check-all and uncheck-all actions inside the kana sheets', () => {
    createApp(document.querySelector('#app'));

    const katakanaBaseAll = document.querySelector('[data-group-toggle-all="katakana:core"]');

    katakanaBaseAll?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(
      document.querySelector('[data-reference-column-toggle="katakana:core:vowels"]')?.getAttribute(
        'data-column-active'
      )
    ).toBe('true');
    expect(
      document.querySelector('[data-reference-column-toggle="katakana:core:k"]')?.getAttribute(
        'data-column-active'
      )
    ).toBe('true');

    document
      .querySelector('[data-group-toggle-none="hiragana:core"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(
      document.querySelector('[data-reference-column-toggle="hiragana:core:vowels"]')?.getAttribute(
        'data-column-active'
      )
    ).toBe('false');
  });
});
