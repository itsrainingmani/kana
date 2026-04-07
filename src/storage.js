const SESSION_KEY = 'kana-trainer-session';
const PROGRESS_KEY = 'kana-trainer-progress';
const ALLOWED_MODES = new Set(['kana-to-sound', 'sound-to-kana', 'sound-to-drawing']);
const ALLOWED_OUTCOMES = new Set(['correct', 'incorrect', 'assisted', 'partial']);
const DEFAULT_FONTS = ['gothic', 'mincho', 'rounded', 'magic', 'dot'];
const DEFAULT_BASE_ROWS = ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'nn'];
const SHEET_KEYS = [
  'hiragana:core',
  'hiragana:combination',
  'katakana:core',
  'katakana:combination'
];

const DEFAULT_SELECTED_ROWS = {
  'hiragana:core': [...DEFAULT_BASE_ROWS],
  'hiragana:combination': [],
  'katakana:core': [],
  'katakana:combination': []
};

const DEFAULT_SESSION = {
  mode: 'kana-to-sound',
  selectedRows: DEFAULT_SELECTED_ROWS,
  enabledFonts: [...DEFAULT_FONTS]
};

function createEmptyStats() {
  return {
    attempts: 0,
    correct: 0,
    incorrect: 0,
    assisted: 0,
    partial: 0
  };
}

function sanitizeStringArray(value, fallback, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const filtered = value.filter((item) => typeof item === 'string' && item.trim() !== '');
  return filtered.length > 0 || allowEmpty ? filtered : [...fallback];
}

function cloneSessionState(state) {
  return {
    ...state,
    selectedRows: Object.fromEntries(
      Object.entries(state.selectedRows).map(([key, rows]) => [key, [...rows]])
    ),
    enabledFonts: [...state.enabledFonts]
  };
}

function sanitizeSelectedRows(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return cloneSessionState(DEFAULT_SESSION).selectedRows;
  }

  return Object.fromEntries(
    SHEET_KEYS.map((key) => [
      key,
      sanitizeStringArray(value[key], DEFAULT_SELECTED_ROWS[key], { allowEmpty: true })
    ])
  );
}

function migrateLegacySelections(state = {}) {
  const next = sanitizeSelectedRows(state.selectedRows);

  if (state.selectedRows && typeof state.selectedRows === 'object' && !Array.isArray(state.selectedRows)) {
    const hasLegacyKeys = Object.keys(state.selectedRows).some((key) => key.includes(':base') || key.includes(':dakuten') || key.includes(':handakuten'));

    if (!hasLegacyKeys) {
      return next;
    }
  }

  const scriptMode =
    state.scriptMode === 'katakana' || state.scriptMode === 'mixed' ? state.scriptMode : 'hiragana';
  const enabledRows = sanitizeStringArray(state.enabledRows, DEFAULT_BASE_ROWS);
  const enabledGroups = sanitizeStringArray(state.enabledGroups, ['base']);
  const scripts = scriptMode === 'mixed' ? ['hiragana', 'katakana'] : [scriptMode];

  const selections = sanitizeSelectedRows(null);

  if (state.selectedRows && typeof state.selectedRows === 'object' && !Array.isArray(state.selectedRows)) {
    for (const script of ['hiragana', 'katakana']) {
      const core = new Set([
        ...(state.selectedRows[`${script}:base`] ?? []),
        ...(state.selectedRows[`${script}:dakuten`] ?? []),
        ...(state.selectedRows[`${script}:handakuten`] ?? [])
      ]);
      const combination = new Set(state.selectedRows[`${script}:combination`] ?? []);

      selections[`${script}:core`] = [...core];
      selections[`${script}:combination`] = [...combination];
    }

    return selections;
  }

  for (const script of scripts) {
    if (enabledGroups.some((group) => ['base', 'dakuten', 'handakuten'].includes(group))) {
      selections[`${script}:core`] = [...enabledRows];
    }

    if (enabledGroups.includes('combination')) {
      selections[`${script}:combination`] = [...enabledRows];
    }
  }

  return selections;
}

function normalizeSessionState(state = {}) {
  const mode = ALLOWED_MODES.has(state.mode) ? state.mode : DEFAULT_SESSION.mode;

  return {
    ...DEFAULT_SESSION,
    ...state,
    mode,
    selectedRows: migrateLegacySelections(state),
    enabledFonts: sanitizeStringArray(state.enabledFonts, DEFAULT_SESSION.enabledFonts)
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
    partial: Number.isFinite(source.partial) ? source.partial : fallback.partial
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

      state = cloneSessionState(
        normalizeSessionState({
          ...state,
          ...next,
          selectedRows: next.selectedRows
            ? {
                ...state.selectedRows,
                ...next.selectedRows
              }
            : state.selectedRows
        })
      );
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
      current[outcome] += 1;
      state[id] = current;
      persist();
    }
  };
}
