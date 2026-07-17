import { describe, expect, it } from 'vitest';
import {
  createAudioClipMap,
  pickPlayableAudioSource,
  playKanaAudio,
  stopKanaAudio
} from '../src/audio.js';
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

  it('cancels the previous clip and resolves its promise when a new one starts', async () => {
    const clips = createAudioClipMap(KANA_DATA);
    const instances = [];

    class FakeAudio {
      constructor(src) {
        this.src = src;
        this.preload = 'none';
        this.onended = null;
        this.onerror = null;
        this._paused = false;
        instances.push(this);
      }

      play() {
        return Promise.resolve();
      }

      pause() {
        this._paused = true;
      }
    }

    const first = playKanaAudio('a', clips, FakeAudio, null);
    const second = playKanaAudio('ka', clips, FakeAudio, null);

    // First call must settle (not hang) when the second one starts — its
    // Audio element is paused and listeners are torn down by the time the
    // new clip begins, so the only path to resolution is the compensating
    // resolve(false) we wired into stopActiveAudio.
    await expect(first).resolves.toBe(false);

    // The first Audio instance should have been paused; the second still
    // owned by playKanaAudio and left playing until onended fires.
    expect(instances[0]._paused).toBe(true);
    expect(instances[1]._paused).toBe(false);

    // Finish the active clip so the second promise settles.
    instances[1].onended?.();
    await expect(second).resolves.toBe(true);

    stopKanaAudio();
  });
});
