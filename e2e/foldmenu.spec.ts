import { test, expect } from '@playwright/test';

/**
 * Fold menu — the per-heading options popover (spec §7 / plan Phase G; AC "The
 * heading menu sets H1–H6 (rewriting the # run), toggles/folds/unfolds all, and
 * copies a #slug link").
 *
 * "Copy Link to here" writes to the clipboard, which is a secure-context API not
 * reliably readable over plain http in a headless run — so we assert the item is
 * present + clickable (it must not throw / must close the menu), not the
 * clipboard's contents.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('the ⋯ affordance opens the heading options menu with every item', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.locator('.tw-row', { hasText: 'Second section' }).locator('.tw-fold-more').click();

  const menu = page.getByRole('menu', { name: 'Heading options' });
  await expect(menu).toBeVisible();
  for (const n of [1, 2, 3, 4, 5, 6]) {
    await expect(menu.getByRole('menuitemradio', { name: `Heading ${n}`, exact: true })).toBeVisible();
  }
  // The current level (H2) is the checked radio.
  await expect(menu.getByRole('menuitemradio', { name: 'Heading 2', exact: true })).toHaveAttribute('aria-checked', 'true');
  for (const label of ['Toggle Folding', 'Fold All Headers', 'Unfold All Headers', 'Copy Link to here']) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  }
});

test('setting a different heading level rewrites the # run in the source', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.locator('.tw-row', { hasText: 'Second section' }).locator('.tw-fold-more').click();

  const menu = page.getByRole('menu', { name: 'Heading options' });
  await menu.getByRole('menuitemradio', { name: 'Heading 3', exact: true }).click();

  await page.locator('button[data-mode="edit"]').click();
  const value = await editor.locator('textarea.tw-source-full').inputValue();
  expect(value).toMatch(/^### Second section$/m); // ## → ###
  expect(value).not.toMatch(/^## Second section$/m);
});

test('"Copy Link to here" is available and dismisses the menu', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.locator('.tw-row', { hasText: 'Second section' }).locator('.tw-fold-more').click();
  const menu = page.getByRole('menu', { name: 'Heading options' });
  await menu.getByRole('menuitem', { name: 'Copy Link to here' }).click();
  await expect(menu).toHaveCount(0);
});

test('Fold All Headers collapses the sections', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-block', { hasText: 'Content under the second' })).toBeVisible();

  await editor.locator('.tw-fold-more').first().click();
  // The menu is position:fixed and can extend past the viewport bottom for a
  // high anchor, so dispatch the item's click directly (no scroll-into-view).
  await page.getByRole('menu', { name: 'Heading options' }).getByRole('menuitem', { name: 'Fold All Headers', exact: true }).dispatchEvent('click');

  // Sections collapsed: a fold summary chip is shown and the folded content is gone.
  await expect(editor.locator('.tw-foldchip').first()).toBeVisible();
  await expect(editor.locator('.tw-block', { hasText: 'Content under the second' })).toHaveCount(0);
  await expect(editor.locator('.tw-row', { hasText: 'Second section' })).toHaveCount(0);
});
