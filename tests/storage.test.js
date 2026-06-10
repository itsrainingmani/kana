import { beforeEach, describe, expect, it } from 'vitest';
import { createProgressStore, createSessionStore } from '../src/storage.js';

describe('storage', () => {
  const defaultSelections = {
    'hiragana:core': ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'nn'],
    'hiragana:combination': [],
    'katakana:core': [],
    'katakana:combination': []
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('provides hiragana-first kana sheet defaults', () => {
    const store = createSessionStore();

    expect(store.getState()).toMatchObject({
      mode: 'kana-to-sound',
      selectedRows: defaultSelections
    });
  });

  it('persists session updates locally', () => {
    const store = createSessionStore();

    store.setState({
      mode: 'sound-to-kana',
      selectedRows: {
        ...defaultSelections,
        'hiragana:core': ['vowels', 'k', 'g'],
        'katakana:core': ['vowels', 'k']
      },
      enabledFonts: ['mincho']
    });

    const restored = createSessionStore();
    expect(restored.getState()).toMatchObject({
      mode: 'sound-to-kana',
      selectedRows: {
        ...defaultSelections,
        'hiragana:core': ['vowels', 'k', 'g'],
        'katakana:core': ['vowels', 'k']
      },
      enabledFonts: ['mincho']
    });
  });

  it('returns defensive copies from session state', () => {
    const store = createSessionStore();

    const snapshot = store.getState();
    snapshot.selectedRows['hiragana:core'].push('x');
    snapshot.selectedRows['katakana:core'].push('vowels');
    snapshot.enabledFonts.push('custom');

    expect(store.getState()).toMatchObject({
      selectedRows: defaultSelections,
      enabledFonts: ['gothic', 'mincho', 'rounded', 'magic', 'dot']
    });
  });

  it('tracks per-kana progress counters', () => {
    const progress = createProgressStore();

    progress.record('h-a', 'kana-to-sound', 'correct');
    progress.record('h-a', 'sound-to-kana', 'assisted');

    expect(progress.getKanaStats('h-a')).toMatchObject({
      attempts: 2,
      correct: 1,
      assisted: 1
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
        mode: 'mystery',
        selectedRows: 'oops',
        enabledFonts: []
      })
    );

    const store = createSessionStore();

    expect(store.getState()).toMatchObject({
      mode: 'kana-to-sound',
      selectedRows: defaultSelections,
      enabledFonts: ['gothic', 'mincho', 'rounded', 'magic', 'dot']
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
          assisted: undefined
        }
      })
    );

    const progress = createProgressStore();

    expect(progress.getKanaStats('h-a')).toMatchObject({
      attempts: 0,
      correct: 0,
      incorrect: 0,
      assisted: 0
    });

    progress.record('h-ka', 'kana-to-sound', 'correct');

    expect(progress.getKanaStats('h-ka')).toMatchObject({
      attempts: 1,
      correct: 3,
      incorrect: 0,
      assisted: 0
    });
  });
});
