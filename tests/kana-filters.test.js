import { describe, expect, it } from 'vitest';
import { KANA_DATA } from '../src/kana/kana-data.js';
import { buildEnabledKanaSet } from '../src/logic/kana-filters.js';

describe('buildEnabledKanaSet', () => {
  it('returns only base hiragana kana for the default session', () => {
    const enabled = buildEnabledKanaSet({
      script: 'hiragana',
      base: true,
      dakuten: false,
      handakuten: false,
      combination: false,
    });

    expect([...enabled]).toEqual(
      KANA_DATA.filter((kana) => kana.script === 'hiragana' && kana.group === 'base').map((kana) => kana.id),
    );
  });

  it('includes dakuten and combination katakana when enabled', () => {
    const enabled = buildEnabledKanaSet({
      script: 'katakana',
      base: true,
      dakuten: true,
      handakuten: false,
      combination: true,
    });

    expect(enabled.has('ga-katakana')).toBe(true);
    expect(enabled.has('gi-katakana')).toBe(true);
    expect(enabled.has('gya-katakana')).toBe(true);
    expect(enabled.has('ka-katakana')).toBe(true);
    expect(enabled.has('ki-katakana')).toBe(true);
  });

  it('uses the canonical kana data as the source of truth', () => {
    const enabled = buildEnabledKanaSet({
      script: 'mixed',
      base: true,
      dakuten: true,
      handakuten: true,
      combination: true,
    });

    expect(enabled.has('a-hiragana')).toBe(true);
    expect(enabled.has('a-katakana')).toBe(true);
    expect(enabled.has('pa-hiragana')).toBe(true);
    expect(KANA_DATA.some((kana) => kana.id === 'a-hiragana')).toBe(true);
  });
});
