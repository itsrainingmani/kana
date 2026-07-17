const AUDIO_SOURCES = [
  { dir: 'audio/opus', ext: 'ogg', type: 'audio/ogg; codecs=opus' },
  { dir: 'audio/mp3', ext: 'mp3', type: 'audio/mpeg' }
];

// Probe element is created once at module load and reused across every
// playKanaAudio call. canPlayType results are deterministic per environment.
const SHARED_AUDIO_PROBE = (() => {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return document.createElement('audio');
  }
  return null;
})();

// Only one kana clip should play at a time. Tapping "Hear" repeatedly or
// advancing mid-clip used to layer audio instances on top of each other.
let activeAudio = null;
let activeAudioResolve = null;

function stopActiveAudio() {
  if (!activeAudio) {
    return;
  }

  const previous = activeAudio;
  const previousResolve = activeAudioResolve;
  activeAudio = null;
  activeAudioResolve = null;

  try {
    previous.onended = null;
    previous.onerror = null;
    previous.pause();
    if (typeof previous.fastSeek === 'function') {
      try { previous.fastSeek(0); } catch { /* ignore */ }
    }
  } catch {
    // ignore — already torn down
  }

  // Make sure the previous playKanaAudio() caller resolves instead of
  // dangling: an Audio whose onended/onerror listeners were torn down
  // would never have fired otherwise.
  if (typeof previousResolve === 'function') {
    previousResolve(false);
  }
}

function createAudioProbe() {
  // Kept for backwards compat with existing tests that pass an explicit probe.
  return SHARED_AUDIO_PROBE;
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
  audioProbe = createAudioProbe(),
  { stopPrevious = true } = {}
) {
  const source = pickPlayableAudioSource(clipMap?.[audioId]?.sources, audioProbe);

  if (!audioId || !source?.src || typeof AudioCtor !== 'function') {
    return Promise.resolve(false);
  }

  if (stopPrevious) {
    stopActiveAudio();
  }

  return new Promise((resolve) => {
    const audio = new AudioCtor(source.src);
    audio.preload = 'auto';

    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (audio === activeAudio) {
        activeAudio = null;
        activeAudioResolve = null;
      }
      resolve(value);
    };

    audio.onended = () => settle(true);
    audio.onerror = () => settle(false);

    activeAudio = audio;
    activeAudioResolve = settle;

    const result = audio.play();

    if (result && typeof result.catch === 'function') {
      result.catch(() => settle(false));
    }
  });
}

export function stopKanaAudio() {
  stopActiveAudio();
}
