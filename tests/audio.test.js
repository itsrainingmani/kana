import { describe, expect, it } from 'vitest';
import { createAudioClipMap, pickPlayableAudioSource } from '../src/audio.js';
import { KANA_DATA } from '../src/kana-data.js';

describe('audio clips', () => {
  it('maps kana readings to local opus and mp3 clip sources', () => {
    const clips = createAudioClipMap(KANA_DATA);

    expect(clips.a.sources).toEqual([
      { src: 'audio/opus/a.ogg', type: 'audio/ogg; codecs=opus' },
      { src: 'audio/mp3/a.mp3', type: 'audio/mpeg' }
    ]);
    expect(clips.kya.sources[0].src).toBe('audio/opus/kya.ogg');
    expect(clips.ji.sources[1].src).toBe('audio/mp3/ji.mp3');
  });

  it('prefers opus when the browser reports support and falls back to mp3 otherwise', () => {
    const preferred = pickPlayableAudioSource(
      [
        { src: 'audio/opus/a.ogg', type: 'audio/ogg; codecs=opus' },
        { src: 'audio/mp3/a.mp3', type: 'audio/mpeg' }
      ],
      {
        canPlayType(type) {
          return type.includes('opus') ? 'probably' : '';
        }
      }
    );

    const fallback = pickPlayableAudioSource(
      [
        { src: 'audio/opus/a.ogg', type: 'audio/ogg; codecs=opus' },
        { src: 'audio/mp3/a.mp3', type: 'audio/mpeg' }
      ],
      {
        canPlayType(type) {
          return type === 'audio/mpeg' ? 'maybe' : '';
        }
      }
    );

    expect(preferred?.src).toBe('audio/opus/a.ogg');
    expect(fallback?.src).toBe('audio/mp3/a.mp3');
  });
});
