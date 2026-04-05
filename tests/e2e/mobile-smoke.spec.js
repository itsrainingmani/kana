import { expect, test } from '@playwright/test';

test('cycles through the main training modes on mobile', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('[data-region="controls"]')).toBeVisible();
  await expect(page.locator('[data-region="prompt"]')).toBeVisible();
  await expect(page.locator('[data-answer-input]')).toBeVisible();

  await page.locator('[data-mode="sound-to-kana"]').click();
  await expect(page.locator('.choice-card').first()).toBeVisible();

  await page.locator('.choice-card').first().click();
  await expect(page.locator('[data-region="feedback"]')).toContainText(/correct|wrong|answer/i);

  await page.locator('[data-action="next"]').click();
  await page.locator('[data-mode="drawing"]').click();
  await expect(page.locator('[data-drawing-pad]')).toBeVisible();
  await expect(page.locator('[data-action="submit-drawing"]')).toBeVisible();
});
