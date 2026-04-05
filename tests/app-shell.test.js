import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('app shell', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
  });

  it('renders the brutalist workspace with core regions', () => {
    createApp(document.querySelector('#app'));

    expect(document.querySelector('[data-region="controls"]')).toBeTruthy();
    expect(document.querySelector('[data-region="prompt"]')).toBeTruthy();
    expect(document.querySelector('[data-region="interaction"]')).toBeTruthy();
    expect(document.querySelector('[data-region="feedback"]')).toBeTruthy();
    expect(document.querySelector('[data-region="progress"]')).toBeTruthy();
  });

  it('shows a live kana prompt by default', () => {
    createApp(document.querySelector('#app'));

    expect(document.querySelector('.poster-kana')?.textContent?.trim()).not.toBe('');
    expect(document.querySelector('[data-answer-input]')).toBeTruthy();
  });
});
