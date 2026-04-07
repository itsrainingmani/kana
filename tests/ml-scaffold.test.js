import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ml scaffold', () => {
  it('includes the uv-managed ml scaffold files', async () => {
    const files = await Promise.all([
      access('ml/pyproject.toml').then(() => true).catch(() => false),
      access('ml/train.py').then(() => true).catch(() => false),
      access('ml/eval.py').then(() => true).catch(() => false),
      access('ml/export_onnx.py').then(() => true).catch(() => false)
    ]);

    expect(files).toEqual([true, true, true, true]);
  });

  it('documents the expected exported ONNX and label artifact paths', async () => {
    const readme = await readFile('ml/README.md', 'utf8');

    expect(readme).toContain('public/models/kana-classifier.onnx');
    expect(readme).toContain('public/models/kana-labels.json');
  });

  it('includes baseline model and dataset modules', async () => {
    const files = await Promise.all([
      access('ml/model.py').then(() => true).catch(() => false),
      access('ml/dataset.py').then(() => true).catch(() => false),
      access('ml/artifacts/.gitkeep').then(() => true).catch(() => false)
    ]);

    expect(files).toEqual([true, true, true]);
  });
});
