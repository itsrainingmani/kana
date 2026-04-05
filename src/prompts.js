export function buildEnabledKanaSet(kanaData, session = {}) {
  const scriptMode = session.scriptMode ?? 'hiragana';
  const enabledRows = session.enabledRows ?? [];
  const enabledGroups = session.enabledGroups ?? [];

  return kanaData.filter((kana) => {
    const scriptMatch = kana.script === scriptMode;
    const rowMatch = enabledRows.includes(kana.row);
    const groupMatch = enabledGroups.includes(kana.group);

    return scriptMatch && rowMatch && groupMatch;
  });
}
