import { test, expect } from '@playwright/test';

/**
 * Footnotes (spec §6 / plan Phase H; AC "[^1] + [^1]: note render GitHub-style
 * with working back-links").
 *
 * The collected GitHub-style footnotes section (with back-links) is emitted by
 * the string renderer path. In the demo that path is used by `read` mode when no
 * executable islands are present, so we turn MDX + Mermaid off first, then read.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('a [^1] reference links to a footnotes section with a working back-link', async ({ page }) => {
  const editor = page.getByTestId('editor');

  // Use the pure string-render path (read mode, islands off) so the collected
  // footnotes section is emitted.
  await page.getByRole('switch', { name: 'MDX (sandboxed)' }).click();
  await page.getByRole('switch', { name: 'Mermaid diagrams' }).click();
  await page.locator('button[data-mode="read"]').click();

  // The inline reference renders as a superscript link into the section.
  const ref = editor.locator('sup.tw-fnref a');
  await expect(ref).toBeVisible();
  await expect(ref).toHaveAttribute('href', '#fn-1');

  // The footnotes section carries the definition with a back-link to the ref.
  const section = editor.locator('section.tw-footnotes');
  await expect(section).toBeVisible();
  await expect(section.locator('li#fn-1')).toBeVisible();
  const back = section.locator('a.tw-fn-back');
  await expect(back).toHaveAttribute('href', '#fnref-1');
  // The ref's own id is the back-link target (round-trip).
  await expect(editor.locator('sup.tw-fnref#fnref-1')).toBeVisible();
});
