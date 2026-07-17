import { expect, test } from '@playwright/test';
import { KANA_DATA } from '../../src/kana-data.js';

const GLYPH_TO_ROMAJI = new Map(
  KANA_DATA.filter((kana) => kana.script === 'hiragana' && kana.group === 'base').map((kana) => [
    kana.glyph,
    kana.romaji
  ])
);

test('cycles through the main training modes', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.masthead__title')).toBeVisible();
  await expect(page.locator('[data-region="prompt"]')).toBeVisible();
  await expect(page.locator('[data-mode-group]')).toBeVisible();
  await expect(page.locator('[data-answer-input]')).toBeVisible();
  await expect(page.locator('[data-region="kana-sheets"]')).toBeVisible();
  await expect(page.locator('[data-region="prompt"]')).toHaveAttribute('data-has-audio', 'false');
  await expect(page.locator('.audio-poster-button')).toHaveAttribute('data-visible', 'false');
  await expect(page.locator('[data-answer-input]')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-choice-grid]')).toHaveAttribute('data-visible', 'false');
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. V-01');

  const readColumns = async (selector) =>
    page.locator(selector).evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);

  await expect(page.locator('[data-mode-group] > button')).toHaveCount(2);
  await expect(page.locator('[data-font-group] > button')).toHaveCount(5);
  expect(await readColumns('[data-mode-group]')).toBeGreaterThanOrEqual(2);
  expect(await readColumns('[data-font-group]')).toBe(5);
  await expect(page.locator('[data-font] .font-toggle__preview').first()).toHaveText('あア');

  await page.locator('[data-mode="sound-to-kana"]').dispatchEvent('click');
  await expect(page.locator('.choice-card').first()).toBeVisible();
  await expect(page.locator('.choice-card')).toHaveCount(6);
  await expect(page.locator('.audio-poster-button')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. A-02');
  expect(await readColumns('[data-choice-grid]')).toBe(3);
  await expect(page.locator('[data-slot="waveform-canvas"]')).toBeVisible();
  await expect(page.locator('.audio-replay-caption')).toContainText('REPLAY');

  await page.locator('.choice-card').first().click();
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-slot="status-message"]')).toContainText(/CORRECT|NOT QUITE/);

  await expect(page.locator('[data-kana-sheet="hiragana"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet="katakana"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet-matrix="hiragana:core"]')).toBeVisible();
  await expect(page.locator('[data-kana-sheet-matrix="hiragana:combination"]')).toBeVisible();
  await expect(page.locator('[data-reference-column-toggle="hiragana:core:vowels"]')).toBeVisible();
  await expect(page.locator('[data-group-toggle-all="katakana:core"]')).toBeVisible();
});

test('uses an authored drill shell with a single merged drill card', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.drill-card')).toHaveCount(1);
  await expect(page.locator('.drill-card__rail')).toHaveCount(1);
  await expect(page.locator('.drill-card__stage')).toHaveCount(1);
  await expect(page.locator('.interaction-card__body')).toHaveCount(1);
  await expect(page.locator('.drill-actions')).toHaveCount(1);
  await expect(page.locator('[data-action="next"]')).toHaveCount(1);

  // The glyph and the answer field live in the same card — never separated.
  const cardBox = await page.locator('.drill-card').boundingBox();
  const inputBox = await page.locator('[data-answer-input]').boundingBox();
  expect(inputBox.y).toBeGreaterThanOrEqual(cardBox.y);
  expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
});

test('keeps the kana position stable when typing feedback appears', async ({ page }) => {
  await page.goto('/');

  const prompt = page.locator('.poster-kana');
  const beforeBox = await prompt.boundingBox();

  // "x" is never a valid romaji prefix, so this always trips the retype state.
  await page.locator('[data-answer-input]').fill('x');
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-slot="status-message"]')).toContainText('RETYPE');

  const afterBox = await prompt.boundingBox();

  expect(beforeBox?.x).toBe(afterBox?.x);
  expect(beforeBox?.y).toBe(afterBox?.y);
});

test('waits for the user after a revealed answer and advances via NEXT', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="reveal"]').dispatchEvent('click');

  await expect(page.locator('[data-slot="status-message"]')).toContainText('REVEALED');
  await expect(page.locator('[data-action="next"]')).toBeVisible();

  // Revealed answers never auto-advance.
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. V-01');

  await page.locator('[data-action="next"]').click();
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. V-02');
});

test('answers a visual prompt correctly and shows the maru stamp', async ({ page }) => {
  await page.goto('/');

  const glyph = (await page.locator('.poster-kana').textContent())?.trim() ?? '';
  const romaji = GLYPH_TO_ROMAJI.get(glyph);

  expect(romaji).toBeTruthy();

  await page.locator('[data-answer-input]').fill(romaji);

  await expect(page.locator('[data-slot="status-message"]')).toContainText('CORRECT');
  await expect(page.locator('[data-slot="maru-stamp"]')).toBeVisible();
  await expect(page.locator('[data-slot="streak-count"]')).toHaveText('1');

  // Correct answers auto-advance after the delay.
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. V-02', {
    timeout: 3000
  });
});

test('places the study sheets in a right rail on desktop', async ({ page }) => {
  await page.goto('/');

  const viewportWidth = page.viewportSize()?.width ?? 0;

  if (viewportWidth < 780) {
    return;
  }

  const drillBox = await page.locator('.drill-card').boundingBox();
  const sheetsBox = await page.locator('[data-region="kana-sheets"]').boundingBox();
  const mastheadBox = await page.locator('.masthead').boundingBox();

  expect(drillBox).toBeTruthy();
  expect(sheetsBox).toBeTruthy();

  // Sheets sit beside the drill column, starting at the same band as the tabs.
  expect(sheetsBox.x).toBeGreaterThan(drillBox.x + drillBox.width);
  expect(mastheadBox.width).toBeGreaterThan(drillBox.width + sheetsBox.width);
});

test('shows an exit from the empty state', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-group-toggle-none="hiragana:core"]').dispatchEvent('click');

  await expect(page.locator('[data-slot="empty-state"]')).toBeVisible();
  await expect(page.locator('[data-slot="script-label"]')).toHaveText('NONE');
  await expect(page.locator('[data-action="goto-sheets"]')).toBeVisible();
  await expect(page.locator('[data-answer-input]')).toBeHidden();
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

  const choiceMetrics = await page.locator('.choice-card__glyph').evaluateAll((nodes) =>
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

  // Reference buttons pad vertically, so compare against a single text line:
  // a wrapped two-line glyph would roughly double the line-height metric.
  const referenceMetrics = await combinationButtons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      const styles = getComputedStyle(node);
      const fontSize = Number.parseFloat(styles.fontSize);
      const paddingY =
        Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      return { height: rect.height, singleLineMax: fontSize * 1.5 + paddingY };
    })
  );

  referenceMetrics.forEach((metric) => {
    expect(metric.height).toBeLessThanOrEqual(metric.singleLineMax);
  });
});
