import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const appShell = readFileSync(join(process.cwd(), 'index.html'), 'utf8').match(/<main\b[\s\S]*?id="app"[\s\S]*<\/main>/)?.[0] ?? '';
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

  it('falls back from removed drawing sessions to the regular kana prompt', () => {
    localStorage.setItem(
      'kana-trainer-session',
      JSON.stringify({ mode: 'sound-to-drawing' })
    );

    createApp(document.querySelector('#app'));

    expect(document.querySelector('[data-region="prompt"]')?.getAttribute('data-has-audio')).toBe('false');
    expect(document.querySelector('[data-drawing-pad]')).toBeNull();
    expect(document.querySelector('[data-action="submit-drawing"]')).toBeNull();
  });

  it('keeps drawing-specific layout classes out of the app shell', () => {
    expect(styles).toMatch(/\.prompt-card\s*\{[\s\S]*min-height:\s*calc\(var\(--prompt-stage-height\) \+ \(2 \* var\(--space-4\)\)\);/s);
    expect(styles).not.toContain('.prompt-card--drawing');
    expect(styles).not.toContain('.drawing-pad');
  });
});
