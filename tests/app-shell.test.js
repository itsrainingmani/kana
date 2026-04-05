import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('app shell', () => {
  it('loads the flat top-level stylesheet entrypoint', () => {
    const htmlPath = resolve(process.cwd(), 'index.html');
    const html = readFileSync(htmlPath, 'utf8');

    expect(html).toContain('<link rel="stylesheet" href="/styles.css" />');
    expect(html).not.toContain('/styles/tokens.css');
    expect(html).not.toContain('/styles/layout.css');
    expect(html).not.toContain('/styles/components.css');
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('renders the static kana trainer shell', () => {
    document.querySelector('#app').replaceChildren(createApp());

    expect(document.title).toBe('Kana Trainer');
    expect(document.querySelector('main.app-shell')).toBeTruthy();
    expect(document.querySelector('[data-mode="kana-to-sound"]')).toBeTruthy();
    expect(document.querySelector('[data-script="hiragana"]')).toBeTruthy();
    expect(document.querySelector('[data-region="prompt"]')).toBeTruthy();
    expect(document.querySelector('[data-region="progress"]')).toBeTruthy();
  });
});
