import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ml etl intake', () => {
  it('includes an ETL preparation entrypoint and data directories', async () => {
    const files = await Promise.all([
      access('ml/prepare_etl.py').then(() => true).catch(() => false),
      access('ml/data/.gitkeep').then(() => true).catch(() => false),
      access('ml/data/processed/.gitkeep').then(() => true).catch(() => false)
    ]);

    expect(files).toEqual([true, true, true]);
  });

  it('documents the local ETL download directory workflow', async () => {
    const readme = await readFile('ml/README.md', 'utf8');

    expect(readme).toContain('~/Downloads/etl');
    expect(readme).toContain('prepare_etl.py');
  });
});
