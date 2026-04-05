import { KANA_DATA } from '../kana/kana-data.js';

function resolveGroupSelection(session = {}) {
  const source = session.groups ?? session;

  return {
    base: source.base ?? true,
    dakuten: source.dakuten ?? false,
    handakuten: source.handakuten ?? false,
    combination: source.combination ?? false,
  };
}

export function buildEnabledKanaSet(session = {}) {
  const script = session.script ?? 'hiragana';
  const groups = resolveGroupSelection(session);
  const enabled = new Set();

  for (const kana of KANA_DATA) {
    if (script !== 'mixed' && kana.script !== script) {
      continue;
    }

    if (!groups[kana.group]) {
      continue;
    }

    enabled.add(kana.id);
  }

  return enabled;
}
