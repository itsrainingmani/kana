import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '..');
const mlDir = resolve(repoRoot, 'ml');
const fixturesDir = resolve(repoRoot, 'tests/fixtures/ml');
const manifestPath = resolve(fixturesDir, 'manifest.fixture.jsonl');
const labelsPath = resolve(fixturesDir, 'labels.fixture.json');
const LONG_TIMEOUT = 60000;

describe('ml dataset', () => {
  it('loads fixture images into 1x48x48 float32 tensors', () => {
    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        [
          'import json',
          'from pathlib import Path',
          'from dataset import build_datasets, get_input_shape',
          `manifest_path = Path(${JSON.stringify(manifestPath)})`,
          `labels_path = Path(${JSON.stringify(labelsPath)})`,
          'datasets = build_datasets(manifest_path, labels_path)',
          'payload = {',
          "  'input_shape': list(get_input_shape()),",
          "  'splits': {},",
          '}',
          "for split_name, dataset in datasets.items():",
          '  tensor, label_index = dataset[0]',
          "  payload['splits'][split_name] = {",
          "    'shape': list(tensor.shape),",
          "    'dtype': str(tensor.dtype),",
          "    'min': float(tensor.min().item()),",
          "    'max': float(tensor.max().item()),",
          "    'label_index': label_index,",
          '  }',
          'print(json.dumps(payload, sort_keys=True))'
        ].join('\n')
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const payload = JSON.parse(result.stdout);

    expect(payload.input_shape).toEqual([1, 48, 48]);
    expect(payload.splits).toEqual({
      test: {
        shape: [1, 48, 48],
        dtype: 'torch.float32',
        min: expect.any(Number),
        max: expect.any(Number),
        label_index: 0
      },
      train: {
        shape: [1, 48, 48],
        dtype: 'torch.float32',
        min: expect.any(Number),
        max: expect.any(Number),
        label_index: 0
      },
      val: {
        shape: [1, 48, 48],
        dtype: 'torch.float32',
        min: expect.any(Number),
        max: expect.any(Number),
        label_index: 1
      }
    });

    for (const split of Object.values(payload.splits)) {
      expect(split.min).toBeGreaterThanOrEqual(0);
      expect(split.max).toBeLessThanOrEqual(1);
    }
  }, LONG_TIMEOUT);

  it('fails fast for unsupported manifest splits', () => {
    const tempDir = mkdtempSync(`${tmpdir()}/kana-ml-dataset-`);

    try {
      const badManifestPath = resolve(tempDir, 'manifest.bad-split.fixture.jsonl');
      const result = spawnSync(
        'uv',
        [
          'run',
          'python',
          '-c',
          [
            'import json',
            'from pathlib import Path',
            'from dataset import build_datasets',
            `manifest_path = Path(${JSON.stringify(manifestPath)})`,
            `labels_path = Path(${JSON.stringify(labelsPath)})`,
            `bad_manifest_path = Path(${JSON.stringify(badManifestPath)})`,
            'rows = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]',
            'rows[0]["split"] = "mystery"',
            'bad_manifest_path.write_text("\\n".join(json.dumps(row) for row in rows) + "\\n", encoding="utf-8")',
            'build_datasets(bad_manifest_path, labels_path)'
          ].join('\n')
        ],
        { cwd: mlDir, encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unsupported split/i);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }, LONG_TIMEOUT);
});
