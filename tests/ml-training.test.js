import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '..');
const mlDir = resolve(repoRoot, 'ml');
const fixturesDir = resolve(repoRoot, 'tests/fixtures/ml');
const manifestPath = resolve(fixturesDir, 'manifest.fixture.jsonl');
const labelsPath = resolve(fixturesDir, 'labels.fixture.json');
const LONG_TIMEOUT = 60000;
const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

describe('ml training', () => {
  it('trains for one epoch and saves best and last checkpoints', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-training-'));
    tempDirs.push(artifactDir);

    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        'train.py',
        '--manifest-path',
        manifestPath,
        '--labels-path',
        labelsPath,
        '--artifact-dir',
        artifactDir,
        '--epochs',
        '1',
        '--batch-size',
        '2'
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const checkpointsDir = resolve(artifactDir, 'checkpoints');
    const bestCheckpointPath = resolve(checkpointsDir, 'best.pt');
    const lastCheckpointPath = resolve(checkpointsDir, 'last.pt');
    const historyPath = resolve(artifactDir, 'metrics/train-history.json');
    const output = `${result.stdout}\n${result.stderr}`;

    expect(output).toMatch(/saved best checkpoint/i);
    expect(output).toMatch(/saved last checkpoint/i);
    expect(existsSync(bestCheckpointPath)).toBe(true);
    expect(existsSync(lastCheckpointPath)).toBe(true);
    expect(existsSync(historyPath)).toBe(true);

    const checkpointResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        [
          'import json',
          'import torch',
          `checkpoint = torch.load(${JSON.stringify(bestCheckpointPath)}, map_location="cpu")`,
          'print(json.dumps({',
          '  "epoch": checkpoint["epoch"],',
          '  "val_accuracy": checkpoint["val_accuracy"],',
          '  "label_count": checkpoint["label_count"],',
          '  "labels": checkpoint["labels"],',
          '  "input_shape": list(checkpoint["input_shape"]),',
          '}, sort_keys=True))'
        ].join('\n')
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(checkpointResult.status, checkpointResult.stderr || checkpointResult.stdout).toBe(0);

    const history = JSON.parse(readFileSync(historyPath, 'utf8'));
    const checkpoint = JSON.parse(checkpointResult.stdout);

    expect(history).toEqual({
      epochs: [
        expect.objectContaining({
          epoch: 1,
          train_loss: expect.any(Number),
          val_accuracy: expect.any(Number)
        })
      ]
    });
    expect(checkpoint).toEqual({
      epoch: 1,
      val_accuracy: expect.any(Number),
      label_count: 2,
      labels: ['a', 'ka'],
      input_shape: [1, 48, 48]
    });
  }, LONG_TIMEOUT);

  it('evaluates a trained checkpoint and writes confusion reporting artifacts', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-eval-'));
    tempDirs.push(artifactDir);

    const trainResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        'train.py',
        '--manifest-path',
        manifestPath,
        '--labels-path',
        labelsPath,
        '--artifact-dir',
        artifactDir,
        '--epochs',
        '1',
        '--batch-size',
        '2'
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(trainResult.status, trainResult.stderr || trainResult.stdout).toBe(0);

    const checkpointPath = resolve(artifactDir, 'checkpoints/best.pt');
    const evalResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        'eval.py',
        '--manifest-path',
        manifestPath,
        '--labels-path',
        labelsPath,
        '--artifact-dir',
        artifactDir,
        '--checkpoint-path',
        checkpointPath,
        '--batch-size',
        '2'
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(evalResult.status, evalResult.stderr || evalResult.stdout).toBe(0);

    const metricsDir = resolve(artifactDir, 'metrics');
    const evalPath = resolve(metricsDir, 'eval.json');
    const confusionMatrixPath = resolve(metricsDir, 'confusion-matrix.csv');
    const output = `${evalResult.stdout}\n${evalResult.stderr}`;
    const evalMetrics = JSON.parse(readFileSync(evalPath, 'utf8'));
    const confusionMatrix = readFileSync(confusionMatrixPath, 'utf8').trim().split(/\r?\n/);

    expect(output).toContain('test_accuracy=');
    expect(existsSync(evalPath)).toBe(true);
    expect(existsSync(confusionMatrixPath)).toBe(true);
    expect(evalMetrics).toEqual({
      test_accuracy: expect.any(Number),
      per_class_accuracy: {
        a: expect.any(Number),
        ka: expect.any(Number)
      },
      total_examples: 1
    });
    expect(confusionMatrix).toEqual([
      'actual_label,a,ka',
      expect.stringMatching(/^a,\d+,\d+$/),
      expect.stringMatching(/^ka,\d+,\d+$/)
    ]);

    const mismatchedLabelsPath = resolve(artifactDir, 'reordered-labels.json');
    writeFileSync(mismatchedLabelsPath, JSON.stringify(['ka', 'a']) + '\n', 'utf8');

    const mismatchedEvalResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        'eval.py',
        '--manifest-path',
        manifestPath,
        '--labels-path',
        mismatchedLabelsPath,
        '--artifact-dir',
        artifactDir,
        '--checkpoint-path',
        checkpointPath,
        '--batch-size',
        '2'
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(mismatchedEvalResult.status).not.toBe(0);
    expect(`${mismatchedEvalResult.stdout}\n${mismatchedEvalResult.stderr}`).toMatch(/labels.*checkpoint/i);
  }, LONG_TIMEOUT);

  it.each([
    ['--epochs', '0', /epochs must be greater than 0/i],
    ['--batch-size', '0', /batch-size must be greater than 0/i]
  ])('fails fast for invalid %s values', (flag, value, errorPattern) => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-training-'));
    tempDirs.push(artifactDir);

    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        'train.py',
        '--manifest-path',
        manifestPath,
        '--labels-path',
        labelsPath,
        '--artifact-dir',
        artifactDir,
        '--epochs',
        '1',
        '--batch-size',
        '2',
        flag,
        value
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(errorPattern);
  });
});
