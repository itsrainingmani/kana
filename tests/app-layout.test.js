import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const appShell = readFileSync(join(process.cwd(), 'index.html'), 'utf8').match(/<main id="app"[\s\S]*<\/main>/)?.[0] ?? '';
const styles = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');

describe('app layout', () => {
  beforeEach(() => {
    document.body.innerHTML = appShell;
    localStorage.clear();

    globalThis.Audio = class {
      constructor() {
        this.onended = null;
        this.onerror = null;
      }

      play() {
        queueMicrotask(() => this.onended?.());
        return Promise.resolve();
      }
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      clearRect: vi.fn()
    }));

    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: 320,
      height: 320,
      top: 0,
      left: 0,
      right: 320,
      bottom: 320
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the drawing canvas in the prompt region only', () => {
    localStorage.setItem(
      'kana-trainer-session',
      JSON.stringify({ mode: 'sound-to-drawing' })
    );

    createApp(document.querySelector('#app'), {
      classifierClient: { warmup: vi.fn(), classify: vi.fn(async () => ({ ignored: true })) }
    });

    const promptRegion = document.querySelector('[data-region="prompt"]');
    const interactionRegion = document.querySelector('[data-region="interaction"]');

    expect(promptRegion?.querySelector('[data-drawing-pad]')).toBeTruthy();
    expect(interactionRegion?.querySelector('[data-drawing-pad]')).toBeNull();
    expect(interactionRegion?.querySelector('[data-action="clear-drawing"]')).toBeTruthy();
    expect(interactionRegion?.querySelector('[data-action="submit-drawing"]')).toBeTruthy();
    expect(interactionRegion?.querySelector('[data-stroke-guide]')).toBeTruthy();
  });

  it('keeps drawing actions in the interaction region after the canvas moves', () => {
    localStorage.setItem(
      'kana-trainer-session',
      JSON.stringify({ mode: 'sound-to-drawing' })
    );

    createApp(document.querySelector('#app'), {
      classifierClient: { warmup: vi.fn(), classify: vi.fn(async () => ({ ignored: true })) }
    });

    const interactionRegion = document.querySelector('[data-region="interaction"]');

    expect(interactionRegion?.classList.contains('interaction-card--drawing')).toBe(true);
    expect(interactionRegion?.querySelector('[data-action="clear-drawing"]')).toBeTruthy();
    expect(interactionRegion?.querySelector('[data-action="submit-drawing"]')).toBeTruthy();
    expect(interactionRegion?.querySelector('[data-stroke-guide]')).toBeTruthy();
  });

  it('uses prompt-card as the shared drawing stage', () => {
    expect(styles).toMatch(/\.prompt-card\s*\{[\s\S]*min-height:\s*calc\(var\(--prompt-stage-height\) \+ \(2 \* var\(--space-4\)\)\);/s);
    expect(styles).not.toMatch(/\.prompt-card--drawing\s*\{[^}]*min-height:/s);
    expect(styles).not.toMatch(/\.drawing-pad\s*\{[^}]*min-height:/s);
  });
});
