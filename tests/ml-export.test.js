import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

describe('ml onnx export', () => {
  it('fails fast with a clear message when the checkpoint is missing', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-export-'));
    tempDirs.push(artifactDir);

    const missingCheckpointPath = resolve(artifactDir, 'checkpoints/missing.pt');
    const outputPath = resolve(artifactDir, 'runtime/model.onnx');
    const runtimeLabelsPath = resolve(artifactDir, 'runtime/labels.json');
    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        'export_onnx.py',
        '--artifact-dir',
        artifactDir,
        '--checkpoint-path',
        missingCheckpointPath,
        '--labels-path',
        labelsPath,
        '--output-path',
        outputPath,
        '--runtime-labels-path',
        runtimeLabelsPath
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/checkpoint not found/i);
    expect(result.stderr).not.toMatch(/traceback/i);
    expect(existsSync(outputPath)).toBe(false);
    expect(existsSync(runtimeLabelsPath)).toBe(false);
  }, LONG_TIMEOUT);

  it('fails fast with a clear message when the checkpoint is malformed', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-export-'));
    tempDirs.push(artifactDir);

    const checkpointPath = resolve(artifactDir, 'checkpoints/bad.pt');
    const outputPath = resolve(artifactDir, 'runtime/model.onnx');
    const runtimeLabelsPath = resolve(artifactDir, 'runtime/labels.json');
    const badCheckpointResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        [
          'from pathlib import Path',
          'import torch',
          `Path(${JSON.stringify(checkpointPath)}).parent.mkdir(parents=True, exist_ok=True)`,
          `torch.save({'label_count': 2, 'labels': ['a', 'ka']}, ${JSON.stringify(checkpointPath)})`
        ].join('\n')
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(badCheckpointResult.status, badCheckpointResult.stderr || badCheckpointResult.stdout).toBe(0);

    const result = spawnSync(
      'uv',
      [
        'run',
        'python',
        'export_onnx.py',
        '--artifact-dir',
        artifactDir,
        '--checkpoint-path',
        checkpointPath,
        '--labels-path',
        labelsPath,
        '--output-path',
        outputPath,
        '--runtime-labels-path',
        runtimeLabelsPath
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing required fields/i);
    expect(result.stderr).not.toMatch(/traceback/i);
    expect(existsSync(outputPath)).toBe(false);
  }, LONG_TIMEOUT);

  it('exports the best checkpoint to onnx and syncs runtime labels', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'kana-ml-export-'));
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
    const outputPath = resolve(artifactDir, 'runtime/model.onnx');
    const runtimeLabelsPath = resolve(artifactDir, 'runtime/labels.json');
    const exportResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        'export_onnx.py',
        '--artifact-dir',
        artifactDir,
        '--checkpoint-path',
        checkpointPath,
        '--labels-path',
        labelsPath,
        '--output-path',
        outputPath,
        '--runtime-labels-path',
        runtimeLabelsPath
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(exportResult.status, exportResult.stderr || exportResult.stdout).toBe(0);
    expect(`${exportResult.stdout}\n${exportResult.stderr}`).not.toMatch(/version conversion/i);
    expect(existsSync(outputPath)).toBe(true);

    const validateResult = spawnSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        [
          'import onnx',
          `model = onnx.load(${JSON.stringify(outputPath)})`,
          'onnx.checker.check_model(model)',
          'print(model.graph.name or "checked")'
        ].join('\n')
      ],
      { cwd: mlDir, encoding: 'utf8' }
    );

    expect(validateResult.status, validateResult.stderr || validateResult.stdout).toBe(0);
    expect(readFileSync(runtimeLabelsPath, 'utf8')).toEqual(readFileSync(labelsPath, 'utf8'));
  }, LONG_TIMEOUT);
});
