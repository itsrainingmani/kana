import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('interaction styles', () => {
  it('keeps disclosure headers from shrinking and exposing the panel background on press', () => {
    const css = readFileSync('styles.css', 'utf8');
    const activeTransformBlock = css.match(
      /\.audio-poster-button:active,[\s\S]*?\{[\s\S]*?transform:\s*scale\(0\.985\);[\s\S]*?\}/
    )?.[0];

    expect(activeTransformBlock).toBeTruthy();
    expect(activeTransformBlock).not.toContain('settings-summary:active');
    expect(css).toMatch(/\.settings-summary\s*\{[\s\S]*background:\s*var\(--paper\);/);
  });

  it('stacks each script sheet vertically so combinations sit below core kana on desktop', () => {
    const css = readFileSync('styles.css', 'utf8');
    const desktopReferenceBlock = css.match(
      /@media \(min-width: 780px\)\s*\{[\s\S]*?\.reference-sheet__tables\s*\{([\s\S]*?)\}[\s\S]*?\}/
    )?.[1];

    expect(desktopReferenceBlock).toBeTruthy();
    expect(desktopReferenceBlock).not.toContain('repeat(2, minmax(0, 1fr))');
  });

  it('lets the font control strip use the full width on desktop', () => {
    const css = readFileSync('styles.css', 'utf8');
    expect(css).not.toMatch(
      /@media \(min-width: 780px\)\s*\{[\s\S]*?\.control-strip\s*\{[\s\S]*?grid-template-columns:[\s\S]*?\}/
    );
  });

  it('renders the waveform without boxed button chrome', () => {
    const css = readFileSync('styles.css', 'utf8');
    const audioButtonBlock = css.match(/\.audio-poster-button\s*\{([\s\S]*?)\}/)?.[1];
    const waveformBlock = css.match(/\.audio-waveform\s*\{([\s\S]*?)\}/)?.[1];

    expect(audioButtonBlock).toBeTruthy();
    expect(audioButtonBlock).toContain('border: 0;');
    expect(audioButtonBlock).toContain('background: transparent;');
    expect(waveformBlock).toBeTruthy();
    expect(waveformBlock).toContain('height: 4rem;');
  });

  it('animates the waveform bars without drawing a separate cursor line', () => {
    const appSource = readFileSync('src/app.js', 'utf8');

    expect(appSource).not.toContain('const cursorX = Math.min(width, progress * width);');
    expect(appSource).not.toContain("ctx.moveTo(cursorX - dpr, height * 0.06);");
    expect(appSource).toContain('const played = (index + 1) / activeWaveformBars.length <= progress;');
  });
});
