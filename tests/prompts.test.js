import { describe, expect, it } from 'vitest';
import { FONT_OPTIONS, KANA_DATA } from '../src/kana-data.js';
import {
  buildEnabledKanaSet,
  createKanaReferenceTables,
  createKanaSelectionMatrices,
  createKanaToSoundPrompt,
  createReferenceSections,
  createRotatingFontSequence,
  createSoundToKanaPrompt,
  gradeKanaToSoundAnswer,
  gradeSoundToKanaAnswer
} from '../src/prompts.js';

describe('prompts', () => {
  const enabledKana = buildEnabledKanaSet(KANA_DATA, {
    selectedRows: {
      'hiragana:core': ['vowels', 'k', 'g'],
      'hiragana:combination': ['k'],
      'katakana:core': [],
      'katakana:combination': []
    }
  });

  it('creates a kana-to-sound prompt', () => {
    const prompt = createKanaToSoundPrompt(enabledKana, () => 0);

    expect(prompt.kind).toBe('kana-to-sound');
    expect(prompt.target).toBeTruthy();
  });

  it('creates a sound-to-kana prompt with up to six options including the target', () => {
    const prompt = createSoundToKanaPrompt(enabledKana, () => 0);

    expect(prompt.kind).toBe('sound-to-kana');
    expect(prompt.options.length).toBe(6);
    expect(prompt.options.some((option) => option.id === prompt.target.id)).toBe(true);
  });

  it('creates grouped reference sections for the kana sheets', () => {
    const sections = createReferenceSections(enabledKana);

    expect(sections[0]).toMatchObject({
      script: 'hiragana',
      rows: expect.any(Array)
    });
    expect(sections[0].rows[0]).toMatchObject({
      rowId: expect.any(String),
      items: expect.any(Array)
    });
  });

  it('creates kana reference tables with vowel columns', () => {
    const tables = createKanaReferenceTables(enabledKana);
    const hiraganaBase = tables.find((table) => table.script === 'hiragana' && table.group === 'base');

    expect(hiraganaBase.columns).toEqual(['a', 'i', 'u', 'e', 'o']);
    expect(hiraganaBase.rows.find((row) => row.rowId === 'k')?.cells.map((cell) => cell?.romaji ?? null)).toEqual([
      'ka',
      'ki',
      'ku',
      'ke',
      'ko'
    ]);
  });

  it('creates fixed kana selection matrices with family columns', () => {
    const matrices = createKanaSelectionMatrices(KANA_DATA);
    const hiraganaCore = matrices.find((matrix) => matrix.script === 'hiragana' && matrix.id === 'core');

    expect(hiraganaCore.columns).toEqual([
      'vowels',
      'k',
      's',
      't',
      'n',
      'h',
      'm',
      'y',
      'r',
      'w',
      'nn',
      'g',
      'z',
      'd',
      'b',
      'p'
    ]);
    expect(hiraganaCore.rows.map((row) => row.id)).toEqual(['a', 'i', 'u', 'e', 'o']);
    expect(hiraganaCore.rows.find((row) => row.id === 'a')?.cells.find((cell) => cell.columnId === 'k')?.items[0].romaji).toBe('ka');
  });

  it('places final n in its own core column', () => {
    const matrices = createKanaSelectionMatrices(KANA_DATA);
    const hiraganaCore = matrices.find((matrix) => matrix.script === 'hiragana' && matrix.id === 'core');
    const oRow = hiraganaCore.rows.find((row) => row.id === 'o');
    const wCell = oRow.cells.find((cell) => cell.columnId === 'w');
    const nCell = oRow.cells.find((cell) => cell.columnId === 'nn');

    expect(wCell.items.map((item) => item.romaji)).toEqual(['wo']);
    expect(nCell.items.map((item) => item.romaji)).toEqual(['n']);
  });

  it('removes the empty d family from the combination matrix', () => {
    const matrices = createKanaSelectionMatrices(KANA_DATA);
    const hiraganaCombinations = matrices.find(
      (matrix) => matrix.script === 'hiragana' && matrix.id === 'combination'
    );

    expect(hiraganaCombinations.columns).not.toContain('d');
  });

  it('places s-row and t-row combinations into the ya-yu-yo grid', () => {
    const combinationKana = buildEnabledKanaSet(KANA_DATA, {
      selectedRows: {
        'hiragana:core': [],
        'hiragana:combination': ['s', 't'],
        'katakana:core': [],
        'katakana:combination': []
      }
    });

    const table = createKanaReferenceTables(combinationKana).find(
      (candidate) => candidate.script === 'hiragana' && candidate.group === 'combination'
    );

    expect(table.rows.find((row) => row.rowId === 's')?.cells.map((cell) => cell?.romaji ?? null)).toEqual([
      'sha',
      'shu',
      'sho'
    ]);
    expect(table.rows.find((row) => row.rowId === 't')?.cells.map((cell) => cell?.romaji ?? null)).toEqual([
      'cha',
      'chu',
      'cho'
    ]);
  });

  it('grades kana-to-sound answers with hint awareness', () => {
    expect(gradeKanaToSoundAnswer(' Ka ', 'ka')).toMatchObject({
      correct: true,
      outcome: 'correct'
    });
    expect(gradeKanaToSoundAnswer('ka', 'ka', { usedHint: true }).outcome).toBe('assisted');
  });

  it('grades sound-to-kana selections by id', () => {
    expect(gradeSoundToKanaAnswer('h-a', 'h-a').correct).toBe(true);
  });

  it('rotates only across the explicitly selected fonts', () => {
    const sequence = createRotatingFontSequence(
      FONT_OPTIONS,
      ['mincho', 'rounded'],
      5
    );

    expect(sequence.map((font) => font.id)).toEqual([
      'rounded',
      'mincho',
      'rounded',
      'mincho',
      'rounded'
    ]);
  });

  it('exposes only the stronger built-in drill fonts', () => {
    expect(FONT_OPTIONS.map((font) => font.id)).toEqual([
      'gothic',
      'mincho',
      'rounded',
      'magic',
      'dot'
    ]);
  });
});
