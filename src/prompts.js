import { ROW_OPTIONS } from './kana-data.js';

const GROUP_TABLE_CONFIG = [
  { id: 'base', columns: ['a', 'i', 'u', 'e', 'o'], label: 'Base' },
  { id: 'dakuten', columns: ['a', 'i', 'u', 'e', 'o'], label: 'Dakuten' },
  { id: 'handakuten', columns: ['a', 'i', 'u', 'e', 'o'], label: 'Handakuten' },
  { id: 'combination', columns: ['ya', 'yu', 'yo'], label: 'Combination' }
];

const MATRIX_CONFIG = [
  {
    id: 'core',
    label: 'Core Kana',
    columns: ['vowels', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'nn', 'g', 'z', 'd', 'b', 'p'],
    rows: ['a', 'i', 'u', 'e', 'o']
  },
  {
    id: 'combination',
    label: 'Combinations',
    columns: ['k', 's', 't', 'n', 'h', 'm', 'r', 'g', 'z', 'b', 'p'],
    rows: ['ya', 'yu', 'yo']
  }
];

function clampCount(items, count) {
  return items.slice(0, Math.min(items.length, count));
}

function shuffle(items, random = Math.random) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function pickOne(items, random = Math.random) {
  return items[Math.floor(random() * items.length)];
}

function normalizeRomaji(value) {
  return value.trim().toLowerCase();
}

function byRowOrder(left, right) {
  return ROW_OPTIONS.findIndex((row) => row.id === left.rowId) - ROW_OPTIONS.findIndex((row) => row.id === right.rowId);
}

function getColumnKey(kana) {
  if (kana.group === 'combination') {
    if (kana.romaji.endsWith('a')) {
      return 'ya';
    }

    if (kana.romaji.endsWith('u')) {
      return 'yu';
    }

    if (kana.romaji.endsWith('o')) {
      return 'yo';
    }

    return null;
  }

  const vowel = kana.romaji.at(-1);
  return ['a', 'i', 'u', 'e', 'o'].includes(vowel) ? vowel : null;
}

function getMatrixIdForKana(kana) {
  return kana.group === 'combination' ? 'combination' : 'core';
}

function getMatrixRowKey(kana, matrixId) {
  if (matrixId === 'combination') {
    return getColumnKey(kana);
  }

  if (kana.romaji === 'n') {
    return 'o';
  }

  if (kana.row === 'vowels') {
    return kana.romaji;
  }

  return kana.romaji.at(-1);
}

function getMatrixColumnKey(kana, matrixId) {
  if (matrixId === 'combination') {
    return kana.row;
  }

  if (kana.romaji === 'n') {
    return 'nn';
  }

  return kana.row;
}

export function buildEnabledKanaSet(kanaData, session = {}) {
  if (session.selectedRows && typeof session.selectedRows === 'object' && !Array.isArray(session.selectedRows)) {
    return kanaData.filter((kana) => {
      const matrixId = getMatrixIdForKana(kana);
      const key = `${kana.script}:${matrixId}`;
      const enabledFamilies = session.selectedRows[key] ?? [];
      return enabledFamilies.includes(getMatrixColumnKey(kana, matrixId));
    });
  }

  const scriptMode = session.scriptMode ?? 'hiragana';
  const enabledRows = session.enabledRows ?? [];
  const enabledGroups = session.enabledGroups ?? [];

  return kanaData.filter((kana) => {
    const scriptMatch = scriptMode === 'mixed' || kana.script === scriptMode;
    const rowMatch = enabledRows.length === 0 || enabledRows.includes(kana.row);
    const groupMatch = enabledGroups.length === 0 || enabledGroups.includes(kana.group);

    return scriptMatch && rowMatch && groupMatch;
  });
}

export function createKanaToSoundPrompt(kanaData, random = Math.random) {
  return {
    kind: 'kana-to-sound',
    target: pickOne(kanaData, random)
  };
}

export function createSoundToKanaPrompt(kanaData, random = Math.random) {
  const target = pickOne(kanaData, random);
  const sameRow = kanaData.filter((kana) => kana.id !== target.id && kana.row === target.row);
  const sameReadingFamily = kanaData.filter(
    (kana) =>
      kana.id !== target.id &&
      kana.romaji[0] === target.romaji[0] &&
      kana.row !== target.row
  );
  const fallback = kanaData.filter(
    (kana) =>
      kana.id !== target.id &&
      !sameRow.some((candidate) => candidate.id === kana.id) &&
      !sameReadingFamily.some((candidate) => candidate.id === kana.id)
  );

  const distractors = [
    ...clampCount(shuffle(sameRow, random), 2),
    ...clampCount(shuffle(sameReadingFamily, random), 2),
    ...clampCount(shuffle(fallback, random), 5)
  ]
    .filter(
      (kana, index, items) => items.findIndex((candidate) => candidate.id === kana.id) === index
    )
    .slice(0, Math.min(5, kanaData.length - 1));

  return {
    kind: 'sound-to-kana',
    target,
    options: shuffle([target, ...distractors], random)
  };
}

export function createSoundToDrawingPrompt(kanaData, random = Math.random) {
  const drawableHiragana = kanaData.filter(
    (kana) => kana.script === 'hiragana' && Array.isArray(kana.strokes)
  );

  if (drawableHiragana.length === 0) {
    return null;
  }

  return {
    kind: 'sound-to-drawing',
    target: pickOne(drawableHiragana, random),
    attemptCount: 0,
    revealedRomaji: false,
    promptId: `${Date.now()}-${Math.floor(random() * 1_000_000)}`
  };
}

export function createReferenceSections(kanaData) {
  return ['hiragana', 'katakana']
    .map((script) => {
      const rows = kanaData
        .filter((kana) => kana.script === script)
        .reduce((groups, kana) => {
          const row = ROW_OPTIONS.find((option) => option.id === kana.row);
          const existing = groups.find((group) => group.rowId === kana.row);

          if (existing) {
            existing.items.push(kana);
            return groups;
          }

          return [
            ...groups,
            {
              rowId: kana.row,
              label: row?.label ?? kana.row,
              items: [kana]
            }
          ];
        }, [])
        .sort(byRowOrder)
        .map((row) => ({
          ...row,
          items: row.items.sort((left, right) => left.romaji.localeCompare(right.romaji))
        }));

      return {
        script,
        rows
      };
    })
    .filter((section) => section.rows.length > 0);
}

export function createKanaReferenceTables(kanaData) {
  return ['hiragana', 'katakana'].flatMap((script) =>
    GROUP_TABLE_CONFIG.flatMap((config) => {
      const items = kanaData.filter((kana) => kana.script === script && kana.group === config.id);

      if (items.length === 0) {
        return [];
      }

      const rows = items
        .reduce((groups, kana) => {
          const row = ROW_OPTIONS.find((option) => option.id === kana.row);
          const existing = groups.find((group) => group.rowId === kana.row);

          if (existing) {
            existing.items.push(kana);
            return groups;
          }

          return [
            ...groups,
            {
              rowId: kana.row,
              label: row?.label ?? kana.row,
              items: [kana]
            }
          ];
        }, [])
        .sort(byRowOrder)
        .map((row) => {
          const cells = config.columns.map((column) =>
            row.items.find((kana) => getColumnKey(kana) === column) ?? null
          );
          const extras = row.items.filter((kana) => !config.columns.includes(getColumnKey(kana)));

          return {
            rowId: row.rowId,
            label: row.label,
            cells,
            extras
          };
        });

      return [
        {
          script,
          group: config.id,
          label: config.label,
          columns: config.columns,
          rows
        }
      ];
    })
  );
}

export function createKanaSelectionMatrices(kanaData) {
  return ['hiragana', 'katakana'].flatMap((script) =>
    MATRIX_CONFIG.map((config) => ({
      script,
      id: config.id,
      label: config.label,
      columns: config.columns,
      rows: config.rows.map((rowId) => ({
        id: rowId,
        label: rowId,
        cells: config.columns.map((columnId) => ({
          columnId,
          items: kanaData.filter(
            (kana) =>
              kana.script === script &&
              getMatrixIdForKana(kana) === config.id &&
              getMatrixRowKey(kana, config.id) === rowId &&
              getMatrixColumnKey(kana, config.id) === columnId
          )
        }))
      }))
    }))
  );
}

export function createRotatingFontSequence(fontOptions, enabledFontIds, count, offset = 0) {
  const enabledFonts = fontOptions.filter((font) => enabledFontIds.includes(font.id));
  const pool = enabledFonts.length > 0 ? enabledFonts : fontOptions;

  return Array.from({ length: count }, (_, index) => pool[(offset + index + 1) % pool.length]);
}

export function gradeKanaToSoundAnswer(input, expected, { usedHint = false } = {}) {
  const correct = normalizeRomaji(input) === normalizeRomaji(expected);

  return {
    correct,
    outcome: correct ? (usedHint ? 'assisted' : 'correct') : 'incorrect'
  };
}

export function gradeSoundToKanaAnswer(selectedId, expectedId, { usedHint = false } = {}) {
  const correct = selectedId === expectedId;

  return {
    correct,
    outcome: correct ? (usedHint ? 'assisted' : 'correct') : 'incorrect'
  };
}

export function getMasteryLabel(stats) {
  if (stats.attempts < 3) {
    return 'new';
  }

  const accuracy = (stats.correct + stats.assisted) / stats.attempts;
  return accuracy >= 0.85 ? 'strong' : 'shaky';
}
