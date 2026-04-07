const AUDIO_SOURCES = [
  { dir: 'audio/opus', ext: 'ogg', type: 'audio/ogg; codecs=opus' },
  { dir: 'audio/mp3', ext: 'mp3', type: 'audio/mpeg' }
];

function createAudioProbe() {
  if (typeof document !== 'undefined') {
    return document.createElement('audio');
  }

  return null;
}

export function createAudioClipMap(kanaData) {
  return Object.fromEntries(
    [...new Set(kanaData.map((kana) => kana.audioId))]
      .filter(Boolean)
      .map((audioId) => [
        audioId,
        {
          sources: AUDIO_SOURCES.map((source) => ({
            src: `${source.dir}/${audioId}.${source.ext}`,
            type: source.type
          }))
        }
      ])
  );
}

export function pickPlayableAudioSource(sources, audioProbe = createAudioProbe()) {
  if (!Array.isArray(sources) || sources.length === 0) {
    return null;
  }

  if (!audioProbe || typeof audioProbe.canPlayType !== 'function') {
    return sources.at(-1) ?? null;
  }

  return (
    sources.find((source) => {
      const support = audioProbe.canPlayType(source.type);
      return support === 'probably' || support === 'maybe';
    }) ??
    sources.at(-1) ??
    null
  );
}

export function playKanaAudio(
  audioId,
  clipMap,
  AudioCtor = globalThis.Audio,
  audioProbe = createAudioProbe()
) {
  const source = pickPlayableAudioSource(clipMap?.[audioId]?.sources, audioProbe);

  if (!audioId || !source?.src || typeof AudioCtor !== 'function') {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const audio = new AudioCtor(source.src);
    audio.preload = 'auto';
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
    const result = audio.play();

    if (result && typeof result.catch === 'function') {
      result.catch(() => resolve(false));
    }
  });
}
