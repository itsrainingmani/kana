// Prompt pool + display formatting for the write drill. Lives in the lazy
// write chunk (KANJI_DATA and the stroke DB are only paid for once the mode
// is entered).

import { KANJI_DATA } from './kanji-data.js';
import { hasGlyphStrokes } from './stroke-engine.js';
import { buildEnabledKanaSet } from '../prompts.js';

const GROUP_SIZE = 10;

// Curriculum-ordered groups of ten per grade: "g1:0" = first ten grade-1
// kanji. KANJI_DATA is already sorted by grade, then newspaper frequency.
export function kanjiGroups() {
  const grades = new Map();

  for (const kanji of KANJI_DATA) {
    if (!grades.has(kanji.grade)) {
      grades.set(kanji.grade, []);
    }
    grades.get(kanji.grade).push(kanji);
  }

  const groups = [];
  for (const [grade, records] of grades) {
    for (let start = 0; start < records.length; start += GROUP_SIZE) {
      const members = records.slice(start, start + GROUP_SIZE);
      groups.push({
        id: `g${grade}:${start / GROUP_SIZE}`,
        grade,
        rangeLabel: `${String(start + 1).padStart(2, '0')}–${String(start + members.length).padStart(2, '0')}`,
        members
      });
    }
  }
  return groups;
}

export function kanjiForGroups(selectedGroupIds) {
  const wanted = new Set(selectedGroupIds);
  return kanjiGroups()
    .filter((group) => wanted.has(group.id))
    .flatMap((group) => group.members);
}

// The write pool: every enabled single-glyph kana (combination digraphs are
// two characters — not a writing target) plus the kanji in enabled groups.
export function buildWritePool(kanaData, session) {
  const kana = buildEnabledKanaSet(kanaData, session).filter(
    (record) => [...record.glyph].length === 1 && hasGlyphStrokes(record.glyph)
  );
  const kanji = kanjiForGroups(session.selectedKanjiGroups ?? []);
  return [...kana, ...kanji];
}

export function createWritePrompt(pool, random = Math.random) {
  if (!pool || pool.length === 0) {
    return null;
  }
  const target = pool[Math.floor(random() * pool.length)];
  return { kind: 'write', target };
}

const SCRIPT_SUBTITLES = {
  hiragana: 'ひらがな',
  katakana: 'カタカナ'
};

// What the prompt poster shows before the answer. Kana are cued by sound
// (romaji + audio — dictation); kanji by meaning + readings.
export function writeCueFor(target) {
  if (target.script === 'kanji') {
    const readings = [
      target.kun[0] ? `くん ${target.kun[0]}` : null,
      target.on[0] ? `おん ${target.on[0]}` : null
    ]
      .filter(Boolean)
      .join('　');
    return {
      kind: 'kanji',
      main: target.meaning.toUpperCase(),
      sub: readings
    };
  }

  return {
    kind: 'kana',
    main: target.romaji.toUpperCase(),
    sub: SCRIPT_SUBTITLES[target.script] ?? target.script
  };
}

export function writeAnswerLabel(target) {
  if (target.script === 'kanji') {
    return `${target.glyph} · ${target.meaning.toUpperCase()}${target.kun[0] ? ` · ${target.kun[0]}` : ''}`;
  }
  return `${target.glyph} · ${target.romaji.toUpperCase()}`;
}

const GLYPH_MEANINGS = (() => {
  const map = new Map();
  for (const kanji of KANJI_DATA) {
    map.set(kanji.glyph, kanji.meaning.toUpperCase());
  }
  return map;
})();

// Feedback copy for a recognized-but-wrong drawing: name what it looked
// like. UI phrasing stays kana-only (the font subsets carry no new kanji;
// the recognized glyph itself renders standalone via system JP fonts).
export function lookedLikeNote(recognizedLabel) {
  const meaning = GLYPH_MEANINGS.get(recognizedLabel);
  return {
    jp: `「${recognizedLabel}」にみえる`,
    en: meaning ? `LOOKS LIKE ${recognizedLabel} · ${meaning}` : `LOOKS LIKE ${recognizedLabel}`
  };
}
