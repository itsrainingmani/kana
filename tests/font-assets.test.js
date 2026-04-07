import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('font assets', () => {
  it('ships bundled kana drill fonts', () => {
    expect(statSync('assets/fonts/noto-sans-jp-kana.woff2').size).toBeGreaterThan(10000);
    expect(statSync('assets/fonts/noto-serif-jp-kana.woff2').size).toBeGreaterThan(10000);
    expect(statSync('assets/fonts/zen-maru-gothic-kana.woff2').size).toBeGreaterThan(10000);
    expect(statSync('assets/fonts/yusei-magic-kana.woff2').size).toBeGreaterThan(10000);
    expect(statSync('assets/fonts/dotgothic16-kana.woff2').size).toBeGreaterThan(10000);
  });
});
