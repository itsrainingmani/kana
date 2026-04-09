import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const viteConfigSource = readFileSync('vite.config.js', 'utf8');

describe('vite workflow', () => {
  it('uses vite for dev, build, and preview scripts', () => {
    expect(packageJson.scripts.dev).toBe('vite');
    expect(packageJson.scripts.build).toBe('vite build');
    expect(packageJson.scripts.preview).toBe('vite preview');
  });

  it('keeps dev and preview pinned to port 4173', () => {
    expect(viteConfigSource).toContain('server');
    expect(viteConfigSource).toContain('preview');
    expect(viteConfigSource).toContain('port: 4173');
    expect(viteConfigSource).toContain('strictPort: true');
  });

  it('allows the dev server to serve workspace-root dependencies for onnxruntime assets', () => {
    expect(viteConfigSource).toContain('searchForWorkspaceRoot(process.cwd())');
    expect(viteConfigSource).toContain('fs');
    expect(viteConfigSource).toContain('allow');
  });

  it('builds index.html and model assets into dist', () => {
    rmSync('dist', { recursive: true, force: true });

    expect(() => execFileSync('npm', ['run', 'build'], { stdio: 'pipe' })).not.toThrow();
    expect(existsSync('dist/index.html')).toBe(true);
    expect(existsSync('dist/models/kana-classifier.onnx')).toBe(true);
    expect(existsSync('dist/models/kana-classifier.onnx.data')).toBe(true);
    expect(existsSync('dist/models/kana-labels.json')).toBe(true);

    const workerBundlePath = execFileSync('node', ['-e', [
      "import { readdirSync } from 'node:fs'",
      "const match = readdirSync('dist/assets').find((name) => name.startsWith('recognition-worker-') && name.endsWith('.js'))",
      "if (!match) process.exit(1)",
      'process.stdout.write(`dist/assets/${match}`)'
    ].join('; ')], { encoding: 'utf8' }).trim();
    const workerBundle = readFileSync(workerBundlePath, 'utf8');

    expect(workerBundle).toContain('/models/kana-classifier.onnx');
    expect(workerBundle).toContain('/models/kana-labels.json');
    expect(workerBundle).not.toContain('/public/models/');
  });
});
