import { readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('audio assets', () => {
  it('keeps the deployable audio directory limited to shipped formats', () => {
    const names = readdirSync('audio', { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();

    expect(names).toEqual(['mp3', 'opus']);
  });

  it('ships compact local audio clips and waveform data for kana playback', () => {
    expect(statSync('audio/opus/a.ogg').size).toBeGreaterThan(500);
    expect(statSync('audio/opus/kya.ogg').size).toBeGreaterThan(500);
    expect(statSync('audio/opus/ji.ogg').size).toBeGreaterThan(500);
    expect(statSync('audio/mp3/a.mp3').size).toBeGreaterThan(1000);
    expect(statSync('audio/mp3/kya.mp3').size).toBeGreaterThan(1000);
    expect(statSync('audio/mp3/ji.mp3').size).toBeGreaterThan(1000);
    expect(statSync('src/waveforms.js').size).toBeGreaterThan(1000);
  });
});
