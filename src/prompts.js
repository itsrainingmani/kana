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

export function buildEnabledKanaSet(kanaData, session = {}) {
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
  const sameGroup = kanaData.filter(
    (kana) =>
      kana.id !== target.id &&
      kana.group === target.group &&
      kana.row !== target.row
  );
  const fallback = kanaData.filter(
    (kana) =>
      kana.id !== target.id &&
      !sameRow.some((candidate) => candidate.id === kana.id) &&
      !sameGroup.some((candidate) => candidate.id === kana.id)
  );

  const distractors = [
    ...clampCount(shuffle(sameRow, random), 2),
    ...clampCount(shuffle(sameGroup, random), 1),
    ...clampCount(shuffle(fallback, random), 4)
  ]
    .filter(
      (kana, index, items) => items.findIndex((candidate) => candidate.id === kana.id) === index
    )
    .slice(0, Math.min(4, kanaData.length - 1));

  return {
    kind: 'sound-to-kana',
    target,
    options: shuffle([target, ...distractors], random)
  };
}

export function createDrawingPrompt(kanaData, random = Math.random) {
  const drawableKana = kanaData.filter((kana) => Array.isArray(kana.strokes));

  if (drawableKana.length === 0) {
    return null;
  }

  return {
    kind: 'drawing',
    target: pickOne(drawableKana, random)
  };
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
  return accuracy >= 0.85 && stats.drawingOrderFailures === 0 ? 'strong' : 'shaky';
}
