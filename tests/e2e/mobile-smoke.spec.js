import { expect, test } from '@playwright/test';
import { KANA_DATA } from '../../src/kana-data.js';

const GLYPH_TO_ROMAJI = new Map(
  KANA_DATA.filter((kana) => kana.script === 'hiragana' && kana.group === 'base').map((kana) => [
    kana.glyph,
    kana.romaji
  ])
);

test('cycles through the main training modes on mobile', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-region="prompt"]')).toBeVisible();
  await expect(page.locator('[data-region="controls"]')).toBeVisible();
  await expect(page.locator('[data-region="mode-controls"]')).toBeVisible();
  await expect(page.locator('[data-answer-input]')).toBeVisible();
  await expect(page.locator('[data-region="kana-sheets"]')).toBeVisible();
  await expect(page.locator('[data-region="prompt"]')).toHaveAttribute('data-has-audio', 'false');
  await expect(page.locator('.audio-poster-button')).toHaveAttribute('data-visible', 'false');
  await expect(page.locator('[data-answer-input]')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-choice-grid]')).toHaveAttribute('data-visible', 'false');

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const readColumns = async (selector) =>
    page.locator(selector).evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);

  await expect(page.locator('[data-mode-group] > button')).toHaveCount(3);
  await expect(page.locator('[data-font-group] > button')).toHaveCount(5);
  expect(await readColumns('[data-mode-group]')).toBeGreaterThanOrEqual(2);
  expect(await readColumns('[data-font-group]')).toBe(5);
  await expect(page.locator('[data-font]').first()).toHaveText('あア');
  await page.locator('[data-mode="sound-to-kana"]').dispatchEvent('click');
  await expect(page.locator('.choice-card').first()).toBeVisible();
  await expect(page.locator('.choice-card')).toHaveCount(6);
  await expect(page.locator('.audio-poster-button')).toHaveAttribute('data-visible', 'true');
  expect(await readColumns('[data-choice-grid]')).toBe(viewportWidth < 780 ? 2 : 3);
  await expect(page.locator('[data-slot="waveform-canvas"]')).toBeVisible();

  await page.locator('.choice-card').first().click();
  await expect(page.locator('[data-region="prompt"]')).toContainText(/correct|answer|expected/i);

  await page.locator('[data-mode="sound-to-drawing"]').dispatchEvent('click');
  await expect(page.locator('[data-drawing-pad]')).toBeVisible();
  await expect(page.locator('[data-action="submit-drawing"]')).toBeVisible();
  await expect(page.locator('.audio-poster-button')).toHaveAttribute('data-visible', 'true');

  await expect(page.locator('[data-kana-sheet="hiragana"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet="katakana"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet-matrix="hiragana:core"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet-matrix="hiragana:combination"]')).toBeVisible();
  await expect(page.locator('[data-reference-column-toggle="hiragana:core:vowels"]')).toBeVisible();
  await expect(page.locator('[data-group-toggle-all="katakana:core"]')).toBeVisible();
});

test('uses an authored drill shell with explicit prompt and support regions', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.prompt-card__rail')).toHaveCount(1);
  await expect(page.locator('.prompt-card__stage')).toHaveCount(1);
  await expect(page.locator('.interaction-card__body')).toHaveCount(1);
  await expect(page.locator('.hints-card__actions')).toHaveCount(1);
});

test('keeps the kana position stable when status text appears', async ({ page }) => {
  await page.goto('/');

  const prompt = page.locator('.poster-kana');
  const glyph = (await prompt.textContent())?.trim() ?? '';
  const romaji = GLYPH_TO_ROMAJI.get(glyph);

  expect(romaji).toBeTruthy();

  const beforeBox = await prompt.boundingBox();
  await page.locator('[data-answer-input]').fill(romaji);
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute('data-visible', 'true');

  const afterBox = await prompt.boundingBox();

  expect(beforeBox?.x).toBe(afterBox?.x);
  expect(beforeBox?.y).toBe(afterBox?.y);
});

test('switches between drill modes without shifting the stacked layout', async ({ page }) => {
  await page.goto('/');
  const viewportWidth = page.viewportSize()?.width ?? 0;

  const promptCard = page.locator('[data-region="prompt"]');
  const interactionCard = page.locator('[data-region="interaction"]');
  const hintsCard = page.locator('[data-region="hints"]');
  const modeRack = page.locator('[data-region="mode-controls"]');
  const controlRack = page.locator('[data-region="controls"]');
  const sheets = page.locator('[data-region="kana-sheets"]');

  const before = {
    prompt: await promptCard.boundingBox(),
    interaction: await interactionCard.boundingBox(),
    hints: await hintsCard.boundingBox(),
    mode: await modeRack.boundingBox(),
    controls: await controlRack.boundingBox(),
    sheets: await sheets.boundingBox()
  };

  await page.locator('[data-mode="sound-to-kana"]').dispatchEvent('click');
  await expect(page.locator('.choice-card')).toHaveCount(6);

  const after = {
    prompt: await promptCard.boundingBox(),
    interaction: await interactionCard.boundingBox(),
    hints: await hintsCard.boundingBox(),
    mode: await modeRack.boundingBox(),
    controls: await controlRack.boundingBox(),
    sheets: await sheets.boundingBox()
  };

  expect(before.prompt?.height).toBe(after.prompt?.height);
  expect(before.interaction?.height).toBe(after.interaction?.height);
  expect(before.hints?.height).toBe(after.hints?.height);
  expect(Math.abs((before.mode?.y ?? 0) - (after.mode?.y ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((before.controls?.y ?? 0) - (after.controls?.y ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((before.sheets?.y ?? 0) - (after.sheets?.y ?? 0))).toBeLessThanOrEqual(2);

  if (viewportWidth < 780) {
    expect(before.prompt?.height ?? 0).toBeLessThanOrEqual(320);
    expect(before.interaction?.height ?? 0).toBeLessThanOrEqual(220);
  }
});

test('keeps the prompt centered and balances the desktop drill columns', async ({ page }) => {
  await page.goto('/');

  const viewportWidth = page.viewportSize()?.width ?? 0;

  if (viewportWidth < 780) {
    return;
  }

  const promptCard = page.locator('[data-region="prompt"]');
  const glyph = page.locator('.poster-kana');
  const interactionCard = page.locator('[data-region="interaction"]');
  const hintsCard = page.locator('[data-region="hints"]');

  const promptBox = await promptCard.boundingBox();
  const glyphBox = await glyph.boundingBox();
  const interactionBox = await interactionCard.boundingBox();
  const hintsBox = await hintsCard.boundingBox();

  expect(promptBox).toBeTruthy();
  expect(glyphBox).toBeTruthy();
  expect(interactionBox).toBeTruthy();
  expect(hintsBox).toBeTruthy();

  const promptCenterX = promptBox.x + promptBox.width / 2;
  const glyphCenterX = glyphBox.x + glyphBox.width / 2;
  const promptCenterY = promptBox.y + promptBox.height / 2;
  const glyphCenterY = glyphBox.y + glyphBox.height / 2;
  const promptHeight = promptBox.height;
  const rightColumnHeight = hintsBox.y + hintsBox.height - interactionBox.y;

  expect(Math.abs(promptCenterX - glyphCenterX)).toBeLessThanOrEqual(8);
  expect(Math.abs(promptCenterY - glyphCenterY)).toBeLessThanOrEqual(12);
  expect(Math.abs(promptHeight - rightColumnHeight)).toBeLessThanOrEqual(8);
});

test('centers the answer card and anchors hint actions on desktop', async ({ page }) => {
  await page.goto('/');

  const viewportWidth = page.viewportSize()?.width ?? 0;

  if (viewportWidth < 780) {
    return;
  }

  const interactionCard = page.locator('[data-region="interaction"]');
  const answerInput = page.locator('[data-answer-input]');
  const hintsCard = page.locator('[data-region="hints"]');
  const hintToolbar = page.locator('[data-region="hints"] .toolbar-row');

  const interactionBox = await interactionCard.boundingBox();
  const inputBox = await answerInput.boundingBox();
  const hintsBox = await hintsCard.boundingBox();
  const toolbarBox = await hintToolbar.boundingBox();

  expect(interactionBox).toBeTruthy();
  expect(inputBox).toBeTruthy();
  expect(hintsBox).toBeTruthy();
  expect(toolbarBox).toBeTruthy();

  const interactionCenterY = interactionBox.y + interactionBox.height / 2;
  const inputCenterY = inputBox.y + inputBox.height / 2;
  const hintBottomGap = hintsBox.y + hintsBox.height - (toolbarBox.y + toolbarBox.height);

  expect(Math.abs(interactionCenterY - inputCenterY)).toBeLessThanOrEqual(28);
  expect(hintBottomGap).toBeLessThanOrEqual(24);
});

test('keeps combination kana horizontal at mobile sizes across prompt, choices, and reference', async ({
  page
}) => {
  await page.setViewportSize({ width: 280, height: 900 });
  await page.goto('/');

  await page.locator('[data-group-toggle-all="hiragana:combination"]').dispatchEvent('click');
  await page.locator('[data-group-toggle-none="hiragana:core"]').dispatchEvent('click');

  const promptGlyph = page.locator('.poster-kana');
  const promptBox = await promptGlyph.boundingBox();

  expect(promptBox).toBeTruthy();
  expect(promptBox.width).toBeGreaterThan(promptBox.height);

  await page.locator('[data-mode="sound-to-kana"]').dispatchEvent('click');
  await expect(page.locator('.choice-card')).toHaveCount(6);

  const choiceMetrics = await page.locator('.choice-card span').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );

  choiceMetrics.forEach((metric) => {
    expect(metric.width).toBeGreaterThan(metric.height);
  });

  const combinationButtons = page.locator('[data-kana-sheet-matrix="hiragana:combination"] .reference-glyph');
  await expect(combinationButtons.first()).toBeVisible();

  const referenceMetrics = await combinationButtons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );

  referenceMetrics.forEach((metric) => {
    expect(metric.width).toBeGreaterThan(metric.height);
  });
});
