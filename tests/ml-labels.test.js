import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ml labels', () => {
  it('exports non-combination kana labels in app order', async () => {
    const labels = JSON.parse(await readFile('ml/labels.json', 'utf8'));

    expect(labels.some((label) => label.group === 'combination')).toBe(false);
    expect(labels[0]).toMatchObject({ glyph: 'あ', script: 'hiragana' });
  });

  it('ships the same labels to the browser runtime', async () => {
    const mlLabels = await readFile('ml/labels.json', 'utf8');
    const publicLabels = await readFile('public/models/kana-labels.json', 'utf8');

    expect(JSON.parse(publicLabels)).toEqual(JSON.parse(mlLabels));
  });
});
