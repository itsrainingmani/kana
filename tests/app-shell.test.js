import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('app shell', () => {
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
