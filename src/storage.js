const SESSION_KEY = 'kana-trainer-session';
const PROGRESS_KEY = 'kana-trainer-progress';
const ALLOWED_MODES = new Set(['kana-to-sound', 'sound-to-kana', 'drawing']);
const ALLOWED_OUTCOMES = new Set(['correct', 'incorrect', 'assisted', 'order-failure']);
const ALLOWED_SCRIPTS = new Set(['hiragana', 'katakana', 'mixed']);

const DEFAULT_SESSION = {
  scriptMode: 'hiragana',
  mode: 'kana-to-sound',
  enabledRows: ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w'],
  enabledGroups: ['base'],
  fontDifficulty: 'standard'
};

function createEmptyStats() {
  return {
    attempts: 0,
    correct: 0,
    incorrect: 0,
    assisted: 0,
    drawingOrderFailures: 0
  };
}

function sanitizeStringArray(value, fallback) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim() !== '')
    : [...fallback];
}

function cloneSessionState(state) {
  return {
    ...state,
    enabledRows: Array.isArray(state.enabledRows) ? [...state.enabledRows] : state.enabledRows,
    enabledGroups: Array.isArray(state.enabledGroups) ? [...state.enabledGroups] : state.enabledGroups
  };
}

function normalizeSessionState(state = {}) {
  const mode = ALLOWED_MODES.has(state.mode) ? state.mode : DEFAULT_SESSION.mode;
  const scriptMode = ALLOWED_SCRIPTS.has(state.scriptMode)
    ? state.scriptMode
    : DEFAULT_SESSION.scriptMode;

  return {
    ...DEFAULT_SESSION,
    ...state,
    mode,
    scriptMode,
    enabledRows: sanitizeStringArray(state.enabledRows, DEFAULT_SESSION.enabledRows),
    enabledGroups: sanitizeStringArray(state.enabledGroups, DEFAULT_SESSION.enabledGroups),
    fontDifficulty:
      typeof state.fontDifficulty === 'string' && state.fontDifficulty.trim() !== ''
        ? state.fontDifficulty
        : DEFAULT_SESSION.fontDifficulty
  };
}

function normalizeStats(stats) {
  const source = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
  const fallback = createEmptyStats();

  return {
    attempts: Number.isFinite(source.attempts) ? source.attempts : fallback.attempts,
    correct: Number.isFinite(source.correct) ? source.correct : fallback.correct,
    incorrect: Number.isFinite(source.incorrect) ? source.incorrect : fallback.incorrect,
    assisted: Number.isFinite(source.assisted) ? source.assisted : fallback.assisted,
    drawingOrderFailures: Number.isFinite(source.drawingOrderFailures)
      ? source.drawingOrderFailures
      : fallback.drawingOrderFailures
  };
}

function validateMode(mode) {
  if (!ALLOWED_MODES.has(mode)) {
    throw new RangeError(`Unsupported mode: ${mode}`);
  }
}

function validateRecordInput(id, mode, outcome) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('record id must be a non-empty string');
  }

  validateMode(mode);

  if (!ALLOWED_OUTCOMES.has(outcome)) {
    throw new RangeError(`Unsupported outcome: ${outcome}`);
  }
}

function readJson(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

function createMemoryStorage() {
  const data = new Map();

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    }
  };
}

function resolveStorage(storage) {
  if (storage) {
    return storage;
  }

  return typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage();
}

export function createSessionStore(storage) {
  const resolvedStorage = resolveStorage(storage);
  let state = cloneSessionState(normalizeSessionState(readJson(resolvedStorage, SESSION_KEY, {})));

  return {
    getState() {
      return cloneSessionState(state);
    },
    setState(next) {
      if (Object.prototype.hasOwnProperty.call(next, 'mode')) {
        validateMode(next.mode);
      }

      state = cloneSessionState(normalizeSessionState({ ...state, ...next }));
      writeJson(resolvedStorage, SESSION_KEY, state);
    }
  };
}

export function createProgressStore(storage) {
  const resolvedStorage = resolveStorage(storage);
  const persistedState = readJson(resolvedStorage, PROGRESS_KEY, {});
  const state = Object.fromEntries(
    Object.entries(persistedState).map(([id, stats]) => [id, normalizeStats(stats)])
  );

  function persist() {
    writeJson(resolvedStorage, PROGRESS_KEY, state);
  }

  return {
    getKanaStats(id) {
      return normalizeStats(state[id]);
    },
    record(id, mode, outcome) {
      validateRecordInput(id, mode, outcome);

      const current = normalizeStats(state[id]);
      current.attempts += 1;

      switch (outcome) {
        case 'correct':
          current.correct += 1;
          break;
        case 'incorrect':
          current.incorrect += 1;
          break;
        case 'assisted':
          current.assisted += 1;
          break;
        case 'order-failure':
          current.drawingOrderFailures += 1;
          break;
      }

      state[id] = current;
      persist();
    }
  };
}
