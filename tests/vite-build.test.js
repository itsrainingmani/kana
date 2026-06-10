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

  it('keeps dev and preview on the default app port without strict port pinning', () => {
    expect(viteConfigSource).toContain('server');
    expect(viteConfigSource).toContain('preview');
    expect(viteConfigSource).toContain('port: 4173');
    expect(viteConfigSource).not.toContain('strictPort');
  });

  it('builds index.html into dist', () => {
    rmSync('dist', { recursive: true, force: true });

    expect(() => execFileSync('npm', ['run', 'build'], { stdio: 'pipe' })).not.toThrow();
    expect(existsSync('dist/index.html')).toBe(true);
  });
});
