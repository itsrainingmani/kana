import { expect, test } from '@playwright/test';
import { KANA_DATA } from '../../src/kana-data.js';
import { KANJI_DATA } from '../../src/write/kanji-data.js';
import { STROKE_DATA, STROKE_GRID } from '../../src/write/stroke-data.js';

const ROMAJI_TO_HIRAGANA = new Map(
  KANA_DATA.filter((kana) => kana.script === 'hiragana').map((kana) => [
    kana.romaji,
    kana.glyph
  ])
);

const MEANING_TO_KANJI = new Map(
  KANJI_DATA.map((kanji) => [kanji.meaning.toUpperCase(), kanji.glyph])
);

function strokesFor(glyph) {
  return STROKE_DATA[glyph].map((flat) => {
    const points = [];
    for (let index = 0; index < flat.length; index += 2) {
      points.push([flat[index] / STROKE_GRID, flat[index + 1] / STROKE_GRID]);
    }
    return points;
  });
}

// page.mouse works in viewport coordinates — the sheet must actually be on
// screen before stroking it, exactly like a human.
async function drawCanvasBox(page) {
  const canvas = page.locator('[data-slot="draw-canvas"]');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  return box;
}

// Draws the glyph's reference strokes on the canvas with the real mouse
// pipeline — this exercises pointer capture, coalescing, per-stroke grading
// and (in recall) the in-browser model inference.
async function drawGlyph(page, glyph) {
  const box = await drawCanvasBox(page);

  for (const stroke of strokesFor(glyph)) {
    const [sx, sy] = stroke[0];
    await page.mouse.move(box.x + sx * box.width, box.y + sy * box.height);
    await page.mouse.down();
    for (const [x, y] of stroke.slice(1)) {
      await page.mouse.move(box.x + x * box.width, box.y + y * box.height, {
        steps: 3
      });
    }
    await page.mouse.up();
    // Give the per-stroke grading + snap a beat before the next stroke.
    await page.waitForTimeout(60);
  }
}

async function enterWriteMode(page) {
  await page.goto('/');
  await page.locator('[data-mode="write"]').dispatchEvent('click');
  await expect(page.locator('[data-slot="draw-block"]')).toHaveAttribute(
    'data-loading',
    'false',
    { timeout: 10_000 }
  );
}

async function cueGlyph(page) {
  const main = (
    await page.locator('[data-slot="write-cue-main"]').textContent()
  )?.trim();
  const sub = (
    await page.locator('[data-slot="write-cue-sub"]').textContent()
  )?.trim();

  if (sub === 'ひらがな' || sub === 'カタカナ') {
    const glyph = ROMAJI_TO_HIRAGANA.get(main?.toLowerCase() ?? '');
    expect(glyph, `kana for cue ${main}`).toBeTruthy();
    return sub === 'ひらがな'
      ? glyph
      : KANA_DATA.find(
          (kana) => kana.script === 'katakana' && kana.romaji === main?.toLowerCase()
        )?.glyph;
  }

  const glyph = MEANING_TO_KANJI.get(main ?? '');
  expect(glyph, `kanji for cue ${main}`).toBeTruthy();
  return glyph;
}

test('write mode teaches a traced character end to end', async ({ page }) => {
  await enterWriteMode(page);

  await expect(page.locator('[data-mode-group] > button')).toHaveCount(3);
  await expect(page.locator('[data-slot="station-code"]')).toContainText('STA. W-');
  await expect(page.locator('[data-slot="draw-block"]')).toHaveAttribute(
    'data-visible',
    'true'
  );
  await expect(page.locator('[data-answer-input]')).toBeHidden();
  await expect(page.locator('[data-slot="write-cue"]')).toHaveAttribute(
    'data-visible',
    'true'
  );
  // Fresh characters open in the traced tier.
  await expect(page.locator('[data-slot="tier-en"]')).toHaveText('AUTO · TRACE');

  const glyph = await cueGlyph(page);
  await drawGlyph(page, glyph);

  // Traced completions grade as assisted (こたえ), never correct.
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute(
    'data-visible',
    'true',
    { timeout: 5000 }
  );
  await expect(page.locator('[data-slot="status-message"]')).toContainText('REVEALED');
  await expect(page.locator('[data-slot="status-answer"]')).toContainText(glyph);

  // The stroke-order reveal takes the stage; NEXT waits for the user.
  await expect(page.locator('[data-slot="write-reveal"]')).toHaveAttribute(
    'data-visible',
    'true'
  );
  await expect(page.locator('[data-action="next"]')).toBeVisible();
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('[data-slot="write-cue"]')).toHaveAttribute(
    'data-visible',
    'true'
  );
});

test('recall tier grades through the in-browser recognizer', async ({ page }) => {
  await enterWriteMode(page);

  // Cycle the assistance chip to そらがき (recall): free drawing, ML grading.
  const chip = page.locator('[data-action="cycle-tier"]');
  await chip.dispatchEvent('click'); // trace
  await chip.dispatchEvent('click'); // guided
  await chip.dispatchEvent('click'); // recall
  await expect(page.locator('[data-slot="tier-en"]')).toHaveText('RECALL');
  await expect(page.locator('[data-action="draw-hint"]')).toBeHidden();

  const glyph = await cueGlyph(page);
  await drawGlyph(page, glyph);

  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute(
    'data-visible',
    'true',
    { timeout: 8000 }
  );
  // Clean reference strokes must be recognized as the target: せいかい.
  await expect(page.locator('[data-slot="status-message"]')).toContainText('CORRECT');
  await expect(page.locator('[data-slot="maru-stamp"]')).toBeVisible();
});

test('wrong strokes get pedagogical feedback in guided tier', async ({ page }) => {
  await enterWriteMode(page);

  const chip = page.locator('[data-action="cycle-tier"]');
  await chip.dispatchEvent('click'); // trace
  await chip.dispatchEvent('click'); // guided
  await expect(page.locator('[data-slot="tier-en"]')).toHaveText('GUIDED');

  const box = await drawCanvasBox(page);

  // A stroke across the bottom edge matches nothing's first stroke.
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.95);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.97, {
    steps: 4
  });
  await page.mouse.up();

  await expect(page.locator('[data-slot="draw-note"]')).toHaveAttribute(
    'data-tone',
    'miss'
  );

  // Drawing the real character still completes the prompt (one miss is
  // within the guided allowance → correct).
  const glyph = await cueGlyph(page);
  await drawGlyph(page, glyph);
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute(
    'data-visible',
    'true',
    { timeout: 5000 }
  );
  await expect(page.locator('[data-slot="status-message"]')).toContainText('CORRECT');
});

test('kanji sheets extend the drill and prompt by meaning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'kana-trainer-session',
      JSON.stringify({
        mode: 'write',
        selectedRows: {
          'hiragana:core': [],
          'hiragana:combination': [],
          'katakana:core': [],
          'katakana:combination': []
        },
        selectedKanjiGroups: ['g1:0']
      })
    );
  });
  await page.goto('/');

  await expect(page.locator('[data-slot="draw-block"]')).toHaveAttribute(
    'data-loading',
    'false',
    { timeout: 10_000 }
  );
  await expect(page.locator('[data-kanji-sheet="g1"]')).toBeVisible();
  await expect(page.locator('[data-kanji-sheet-count="g1"]')).toHaveText('10/80 ON');
  await expect(page.locator('[data-slot="font-label"]')).toContainText(
    'KANJI · GRADE 1'
  );

  const glyph = await cueGlyph(page);
  await drawGlyph(page, glyph);
  await expect(page.locator('[data-slot="prompt-status"]')).toHaveAttribute(
    'data-visible',
    'true',
    { timeout: 5000 }
  );
  await expect(page.locator('[data-slot="status-answer"]')).toContainText(glyph);
});
