import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('interaction styles', () => {
  it('paints the drill card top rule in the active mode color', () => {
    const css = readFileSync('styles.css', 'utf8');
    const drillCardBlock = css.match(
      /\.drill-card\s*\{([^}]*--mode-color[^}]*)\}/
    )?.[1];

    expect(drillCardBlock).toBeTruthy();
    expect(drillCardBlock).toContain('--mode-color: var(--vermillion);');
    expect(drillCardBlock).toContain('border-top: 5px solid var(--mode-color);');
    expect(css).toMatch(
      /\.drill-card\[data-has-audio='true'\]\s*\{[\s\S]*?--mode-color: var\(--blue\);/
    );
  });

  it('moves the study sheets into a persistent right rail on desktop', () => {
    const css = readFileSync('styles.css', 'utf8');
    const desktopBlock = css.match(
      /@media \(min-width: 780px\)\s*\{[\s\S]*?\.app-shell\s*\{([\s\S]*?)\}/
    )?.[1];

    expect(desktopBlock).toBeTruthy();
    expect(desktopBlock).toContain('max-width: 1100px;');
    expect(desktopBlock).toContain("'mast mast'");
    expect(desktopBlock).toContain("'nav sheets'");
    expect(desktopBlock).toContain("'drill sheets'");
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

  it('disables all animation under prefers-reduced-motion', () => {
    const css = readFileSync('styles.css', 'utf8');
    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\}\s*$/
    )?.[1];

    expect(reducedMotionBlock).toBeTruthy();
    expect(reducedMotionBlock).toContain('animation: none !important;');
    expect(reducedMotionBlock).toContain('transition: none !important;');
  });

  it('keeps the sheet matrices on flex rows so header and body columns align', () => {
    const css = readFileSync('styles.css', 'utf8');
    const rowBlock = css.match(/\.kana-matrix__row\s*\{([\s\S]*?)\}/)?.[1];
    const cellBlock = css.match(/\.kana-matrix__cell\s*\{([\s\S]*?)\}/)?.[1];

    expect(rowBlock).toContain('display: flex;');
    expect(cellBlock).toContain('flex: 1 1 0;');
    expect(cellBlock).toContain('min-width: 0;');
  });
});
