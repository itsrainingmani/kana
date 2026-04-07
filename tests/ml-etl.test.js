import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '..');
const mlDir = resolve(repoRoot, 'ml');
const LONG_TIMEOUT = 20000;
const tempDirs = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

describe('ml ETL manifest generation', () => {
  it('writes complete manifest rows and assigns stable splits', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kana-ml-etl-'));
    tempDirs.push(tempDir);

    const result = spawnSync(
      'uv',
      [
        '--directory',
        mlDir,
        'run',
        'python',
        '-c',
        [
          'import json',
          'from pathlib import Path',
          'from prepare_etl import build_manifest, stable_split',
          'from dataset import load_manifest',
          `labels_path = Path(${JSON.stringify(join(tempDir, 'labels.txt'))})`,
          `manifest_path = Path(${JSON.stringify(join(tempDir, 'manifest.jsonl'))})`,
          'labels_path.write_text("a\\nka\\n", encoding="utf-8")',
          "samples = [Path('archive-a.zip_unpacked')]",
          'rows_path = build_manifest([], [{"id": "a", "glyph": "a"}, {"id": "ka", "glyph": "ka"}], manifest_path)[0]',
          'sample_rows = [{"glyph": "ka", "label_id": "ka", "label_index": 1, "image_path": "images/ka-001.png", "source_archive": "archive-a.zip", "split": stable_split("archive-a.zip:images/ka-001.png:ka")}]',
          'manifest_path.write_text("\\n".join(json.dumps(row) for row in sample_rows) + "\\n", encoding="utf-8")',
          'manifest_rows = load_manifest(manifest_path)',
          'sample_key = "archive-a.zip:images/ka-001.png:ka"',
          'payload = {',
          "  'manifest_rows': manifest_rows,",
          "  'split_once': stable_split(sample_key),",
          "  'split_twice': stable_split(sample_key),",
          '}',
          'print(json.dumps(payload, sort_keys=True))'
        ].join('\n')
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const payload = JSON.parse(result.stdout);
    const expectedRow = {
      glyph: 'ka',
      image_path: 'images/ka-001.png',
      label_id: 'ka',
      label_index: 1,
      source_archive: 'archive-a.zip',
      split: payload.split_once
    };

    expect(payload.manifest_rows).toEqual([expectedRow]);
    expect(payload.split_once).toBe(payload.split_twice);
    expect(['train', 'validation', 'test']).toContain(payload.split_once);
  }, LONG_TIMEOUT);
});
