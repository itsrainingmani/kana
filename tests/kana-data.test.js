import { describe, expect, it } from 'vitest';
import { KANA_DATA } from '../src/kana-data.js';
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

  it('filters to hiragana base rows when enabled', () => {
    const result = buildEnabledKanaSet(KANA_DATA, {
      scriptMode: 'hiragana',
      enabledRows: ['vowels', 'k'],
      enabledGroups: ['base']
    });

    expect(result.every((kana) => kana.script === 'hiragana')).toBe(true);
    expect(result.some((kana) => kana.group === 'dakuten')).toBe(false);
  });

  it('includes combination kana when enabled', () => {
    const result = buildEnabledKanaSet(KANA_DATA, {
      scriptMode: 'hiragana',
      enabledRows: ['k'],
      enabledGroups: ['base', 'combination']
    });

    expect(result.some((kana) => kana.group === 'combination')).toBe(true);
  });

  it('does not treat mixed mode as a wildcard', () => {
    const result = buildEnabledKanaSet(KANA_DATA, {
      scriptMode: 'mixed',
      enabledRows: ['vowels', 'k'],
      enabledGroups: ['base', 'dakuten', 'combination']
    });

    expect(result).toEqual([]);
  });
});
