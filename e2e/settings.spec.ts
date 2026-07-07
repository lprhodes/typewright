import { test, expect } from '@playwright/test';

/**
 * Settings surface + ⌘K command palette (spec §2 / plan Phase B; AC "The
 * settings panel switches mode/toolbar/folding/theme/extensions live" and "⌘K
 * opens a palette listing every command; running Bold from it toggles the live
 * selection; ⌘B pressed twice returns the original text").
 *
 * The demo passes `settings={{ enabled: true }}`, so the gear + palette are the
 * editor's own real surfaces. We assert the live EFFECT of each control (root
 * theme class, mode swap, syntax-highlight disappearing), not mere presence.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('the gear opens the settings panel; theme toggle restyles the editor live', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const root = editor.locator('.tw-editor');
  // Demo starts in dark.
  await expect(root).toHaveClass(/tw-theme-dark/);

  await editor.getByRole('button', { name: 'Show settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Editor settings' });
  await expect(panel).toBeVisible();

  // Theme → Light restyles the editor root immediately.
  await panel.getByRole('group', { name: 'Theme appearance' }).getByRole('button', { name: 'Light' }).click();
  await expect(root).toHaveClass(/tw-theme-light/);
  await expect(root).not.toHaveClass(/tw-theme-dark/);

  // …and back to Dark.
  await panel.getByRole('group', { name: 'Theme appearance' }).getByRole('button', { name: 'Dark' }).click();
  await expect(root).toHaveClass(/tw-theme-dark/);
});

test('switching mode from the panel changes the editor mode', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.getByRole('button', { name: 'Show settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Editor settings' });

  await panel.getByRole('group', { name: 'Editor mode' }).getByRole('button', { name: 'Edit' }).click();
  // Close the overlay to observe the editor beneath.
  await page.keyboard.press('Escape');

  await expect(editor.locator('textarea.tw-source-full')).toBeVisible();
  await expect(editor.locator('textarea.tw-source-full')).toHaveValue(/# Typewright/);
});

test('toggling the syntax-highlight extension off removes token spans live', async ({ page }) => {
  const editor = page.getByTestId('editor');
  // With highlighting on (default), the ```ts fence has token spans.
  await expect(editor.locator('pre code span[class*="tw-tok-"]').first()).toBeVisible();

  await editor.getByRole('button', { name: 'Show settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Editor settings' });
  await panel.getByRole('switch', { name: 'Syntax highlight' }).click();
  await page.keyboard.press('Escape');

  // The token spans are gone; the fence renders as plain escaped code.
  await expect(editor.locator('pre code span[class*="tw-tok-"]')).toHaveCount(0);
  await expect(editor.locator('pre code')).toContainText('const x');
});

test('⌘K opens the palette, and running "Bold" wraps the focused selection', async ({ page }) => {
  const editor = page.getByTestId('editor');
  // Work in edit mode so there is a focused source with a selection.
  await page.locator('button[data-mode="edit"]').click();
  const ta = editor.locator('textarea.tw-source-full');
  await ta.click();
  await ta.fill('word');
  await ta.selectText();

  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();

  const input = palette.getByRole('combobox');
  await input.fill('Bold');
  // The top-ranked option is the Bold command.
  await expect(palette.getByRole('option').first()).toContainText('Bold');
  await page.keyboard.press('Enter');

  await expect(palette).toHaveCount(0);
  await expect(ta).toHaveValue('**word**');
});

test('⌘B pressed twice returns the original (toggle-aware, via the keymap)', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await page.locator('button[data-mode="edit"]').click();
  const ta = editor.locator('textarea.tw-source-full');
  await ta.click();
  await ta.fill('word');
  await ta.selectText();

  await page.keyboard.press('ControlOrMeta+b');
  await expect(ta).toHaveValue('**word**');
  await ta.selectText();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(ta).toHaveValue('word');
});
