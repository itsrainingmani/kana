import { beforeEach, describe, expect, it } from 'vitest';
import { createProgressStore, createSessionStore } from '../src/storage.js';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides hiragana kana-to-sound defaults', () => {
    const store = createSessionStore();

    expect(store.getState()).toMatchObject({
      scriptMode: 'hiragana',
      mode: 'kana-to-sound'
    });
  });

  it('persists session updates locally', () => {
    const store = createSessionStore();

    store.setState({
      scriptMode: 'katakana',
      mode: 'sound-to-kana',
      enabledRows: ['k']
    });

    const restored = createSessionStore();
    expect(restored.getState()).toMatchObject({
      scriptMode: 'katakana',
      mode: 'sound-to-kana',
      enabledRows: ['k']
    });
  });

  it('returns defensive copies from session state', () => {
    const store = createSessionStore();

    const snapshot = store.getState();
    snapshot.scriptMode = 'katakana';
    snapshot.enabledRows.push('x');
    snapshot.enabledGroups.push('bonus');

    expect(store.getState()).toMatchObject({
      scriptMode: 'hiragana',
      enabledRows: ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'],
      enabledGroups: ['base']
    });
  });

  it('tracks per-kana progress counters', () => {
    const progress = createProgressStore();

    progress.record('h-a', 'kana-to-sound', 'correct');
    progress.record('h-a', 'drawing', 'order-failure');

    expect(progress.getKanaStats('h-a')).toMatchObject({
      attempts: 2,
      correct: 1,
      drawingOrderFailures: 1
    });
  });

  it('persists per-kana progress locally', () => {
    const progress = createProgressStore();

    progress.record('h-a', 'kana-to-sound', 'incorrect');

    const restored = createProgressStore();
    expect(restored.getKanaStats('h-a')).toMatchObject({
      attempts: 1,
      incorrect: 1
    });
  });

  it('falls back to defaults for malformed persisted session state', () => {
    localStorage.setItem(
      'kana-trainer-session',
      JSON.stringify({
        scriptMode: 'mixed',
        mode: 'mystery',
        enabledRows: 'oops',
        enabledGroups: null,
        fontDifficulty: ''
      })
    );

    const store = createSessionStore();

    expect(store.getState()).toMatchObject({
      scriptMode: 'hiragana',
      mode: 'kana-to-sound',
      enabledRows: ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'],
      enabledGroups: ['base'],
      fontDifficulty: 'standard'
    });
  });

  it('returns defensive copies from kana stats', () => {
    const progress = createProgressStore();

    progress.record('h-a', 'kana-to-sound', 'correct');

    const snapshot = progress.getKanaStats('h-a');
    snapshot.attempts = 99;
    snapshot.correct = 99;

    expect(progress.getKanaStats('h-a')).toMatchObject({
      attempts: 1,
      correct: 1
    });
  });

  it('rejects invalid record modes and outcomes', () => {
    const progress = createProgressStore();

    expect(() => progress.record('h-a', 'speaking', 'correct')).toThrow(
      /unsupported mode/i
    );
    expect(() => progress.record('h-a', 'kana-to-sound', 'mystery')).toThrow(
      /unsupported outcome/i
    );
  });

  it('normalizes malformed persisted progress entries before reading and writing', () => {
    localStorage.setItem(
      'kana-trainer-progress',
      JSON.stringify({
        'h-a': 'broken',
        'h-ka': {
          attempts: 'bad',
          correct: 2,
          incorrect: null,
          assisted: undefined,
          drawingOrderFailures: 'bad'
        }
      })
    );

    const progress = createProgressStore();

    expect(progress.getKanaStats('h-a')).toMatchObject({
      attempts: 0,
      correct: 0,
      incorrect: 0,
      assisted: 0,
      drawingOrderFailures: 0
    });

    progress.record('h-ka', 'kana-to-sound', 'correct');

    expect(progress.getKanaStats('h-ka')).toMatchObject({
      attempts: 1,
      correct: 3,
      incorrect: 0,
      assisted: 0,
      drawingOrderFailures: 0
    });
  });
});
