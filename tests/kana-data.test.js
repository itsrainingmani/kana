import { describe, expect, it } from 'vitest';
import { GROUP_OPTIONS, KANA_DATA, ROW_OPTIONS } from '../src/kana-data.js';
import { buildEnabledKanaSet } from '../src/prompts.js';

describe('KANA_DATA', () => {
  it('contains both hiragana and katakana entries', () => {
    expect(KANA_DATA.some((kana) => kana.script === 'hiragana')).toBe(true);
    expect(KANA_DATA.some((kana) => kana.script === 'katakana')).toBe(true);
  });

  it('uses unambiguous kana ids', () => {
    const ids = KANA_DATA.map((kana) => kana.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exposes the row and group toggles used by the UI', () => {
    expect(ROW_OPTIONS.some((row) => row.id === 'vowels')).toBe(true);
    expect(GROUP_OPTIONS.some((group) => group.id === 'dakuten')).toBe(true);
    expect(GROUP_OPTIONS.some((group) => group.id === 'combination')).toBe(true);
  });

  it('supports mixed script filtering', () => {
    const result = buildEnabledKanaSet(KANA_DATA, {
      scriptMode: 'mixed',
      enabledRows: ['vowels'],
      enabledGroups: ['base']
    });

    expect(result.some((kana) => kana.script === 'hiragana')).toBe(true);
    expect(result.some((kana) => kana.script === 'katakana')).toBe(true);
  });
});
