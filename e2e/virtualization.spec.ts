import { test, expect } from '@playwright/test';

/**
 * Block-level viewport virtualization (spec C-12 / plan IJ3).
 *
 * Loads an 800-block document into the demo (headings + paragraphs) and proves
 * that the editor keeps a BOUNDED number of `.tw-block` DOM nodes while the
 * document value is large, and that scrolling mounts later blocks (and unmounts
 * earlier ones) — i.e. the DOM is a moving window, not the whole document.
 */

const MAX_RENDERED = 120; // generous cap; a 480px viewport windows far fewer

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('a large document keeps a bounded number of rendered blocks', async ({ page }) => {
  const editor = page.getByTestId('editor');

  await page.getByTestId('load-large').click();

  // The document value is large…
  await expect(page.getByTestId('value-len')).toContainText('len:');
  const lenText = (await page.getByTestId('value-len').textContent()) ?? '';
  const len = Number(/len:(\d+)/.exec(lenText)?.[1] ?? '0');
  expect(len).toBeGreaterThan(20_000);

  // …but only a windowed subset of blocks is in the DOM.
  const blocks = editor.locator('.tw-block');
  await expect(blocks.first()).toBeVisible();
  const initialCount = await blocks.count();
  expect(initialCount).toBeGreaterThan(0);
  expect(initialCount).toBeLessThan(MAX_RENDERED);

  // The first section is rendered at the top; a late paragraph is NOT yet mounted.
  await expect(editor.locator('.tw-block', { hasText: 'Section 0' }).first()).toBeVisible();
  await expect(editor.locator('.tw-block', { hasText: 'Paragraph 799' })).toHaveCount(0);

  // Scroll the (host-provided) scroll container to the bottom.
  await editor.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  // Scrolling reveals later blocks…
  await expect(editor.locator('.tw-block', { hasText: 'Paragraph 799' }).first()).toBeVisible({ timeout: 10_000 });
  // …and drops earlier ones (moving window, not accumulation).
  await expect(editor.locator('.tw-block', { hasText: 'Section 0' })).toHaveCount(0);

  // The DOM stays bounded after scrolling.
  const afterCount = await blocks.count();
  expect(afterCount).toBeGreaterThan(0);
  expect(afterCount).toBeLessThan(MAX_RENDERED);
});

test('a small document is not virtualized (renders all blocks)', async ({ page }) => {
  // The default SAMPLE doc is well under the threshold, so every block is
  // present and there is no virtualization scroll wrapper.
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-block', { hasText: 'Second section' })).toBeVisible();
  await expect(editor.locator('.tw-virt-spacer')).toHaveCount(0);
});
