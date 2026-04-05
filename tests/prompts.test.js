import { describe, expect, it } from 'vitest';
import { KANA_DATA } from '../src/kana-data.js';
import {
  buildEnabledKanaSet,
  createDrawingPrompt,
  createKanaToSoundPrompt,
  createSoundToKanaPrompt,
  gradeKanaToSoundAnswer,
  gradeSoundToKanaAnswer
} from '../src/prompts.js';

describe('prompts', () => {
  const enabledKana = buildEnabledKanaSet(KANA_DATA, {
    scriptMode: 'hiragana',
    enabledRows: ['vowels', 'k'],
    enabledGroups: ['base', 'dakuten', 'combination']
  });

  it('creates a kana-to-sound prompt', () => {
    const prompt = createKanaToSoundPrompt(enabledKana, () => 0);

    expect(prompt.kind).toBe('kana-to-sound');
    expect(prompt.target).toBeTruthy();
  });

  it('creates a sound-to-kana prompt with up to five options including the target', () => {
    const prompt = createSoundToKanaPrompt(enabledKana, () => 0);

    expect(prompt.kind).toBe('sound-to-kana');
    expect(prompt.options.length).toBeLessThanOrEqual(5);
    expect(prompt.options.some((option) => option.id === prompt.target.id)).toBe(true);
  });

  it('creates a drawing prompt from kana with stroke templates', () => {
    const prompt = createDrawingPrompt(enabledKana, () => 0);

    expect(prompt).not.toBeNull();
    expect(Array.isArray(prompt.target.strokes)).toBe(true);
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
});
