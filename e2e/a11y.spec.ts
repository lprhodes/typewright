import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * Accessibility sweep (spec-TW-0003 C-15 / plan step 7). Runs axe-core across
 * every editor surface driven in the demo and fails on serious/critical
 * violations in OUR markup. Each scan is SCOPED to the component under test
 * (`[data-testid="editor"]` or the specific overlay) so demo-page chrome we don't
 * own can't add noise.
 *
 * Scope boundary (spec-TW-0003 assumption): host-page contrast/theme choices are
 * the host's responsibility, so `color-contrast` is disabled — the palette is
 * driven by CSS variables a host overrides, and the demo's own chrome (not the
 * library) sets the page background. Everything else (roles, names, ARIA, focus
 * order, region/landmark structure) IS in the library's control and is asserted.
 */

/** axe rules that depend on host-set colours/theme — documented as host-scope. */
const HOST_SCOPE_RULES = ['color-contrast'];

/** Serious/critical violations for `include`, with color-contrast excluded. */
async function seriousViolations(page: Page, include: string): Promise<{ id: string; impact?: string; help: string; targets: unknown[] }[]> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .disableRules(HOST_SCOPE_RULES)
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.flatMap((n) => n.target) }));
}

/** Assert the scoped surface has zero serious/critical violations (else print them). */
async function expectClean(page: Page, include: string): Promise<void> {
  const v = await seriousViolations(page, include);
  expect(v, `serious/critical a11y violations in ${include}:\n${JSON.stringify(v, null, 2)}`).toEqual([]);
}

const EDITOR = '[data-testid="editor"]';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('editor — unified mode (default) is clean, incl. table grid + toolbar', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-toolbar')).toBeVisible();
  await expect(editor.locator('.tw-table-grid .tw-tg-table')).toBeVisible();
  await expectClean(page, EDITOR);
});

test('editor — edit mode is clean', async ({ page }) => {
  await page.locator('button[data-mode="edit"]').click();
  await expect(page.getByTestId('editor').locator('textarea.tw-source-full')).toBeVisible();
  await expectClean(page, EDITOR);
});

test('editor — preview mode is clean', async ({ page }) => {
  await page.locator('button[data-mode="preview"]').click();
  await expect(page.getByTestId('editor').locator('h1')).toBeVisible();
  await expectClean(page, EDITOR);
});

test('editor — read mode is clean', async ({ page }) => {
  await page.locator('button[data-mode="read"]').click();
  await expect(page.getByTestId('editor').locator('h1')).toBeVisible();
  await expectClean(page, EDITOR);
});

test('editor — caret-reveal mode exposes its content to assistive tech and is clean', async ({ page }) => {
  await page.getByTestId('reveal-toggle').check();
  const block = page.getByTestId('editor').locator('[data-typewright="caret-block"]').first();
  await expect(block).toBeVisible();
  // The reveal surface must be a labelled textbox in the a11y tree.
  await expect(block).toHaveAttribute('role', 'textbox');
  await expect(block).toHaveAttribute('aria-label', /Markdown/);
  await expectClean(page, EDITOR);
});

test('comments sidebar is clean', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.getByRole('button', { name: 'Show comments' }).click();
  await expect(editor.getByRole('complementary', { name: 'Comments' })).toBeVisible();
  await expectClean(page, EDITOR);
});

test('settings panel is clean', async ({ page }) => {
  await page.getByTestId('editor').getByRole('button', { name: 'Show settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Editor settings' })).toBeVisible();
  await expectClean(page, '[role="dialog"][aria-label="Editor settings"]');
});

test('⌘K command palette is clean', async ({ page }) => {
  await page.locator('button[data-mode="edit"]').click();
  await page.getByTestId('editor').locator('textarea.tw-source-full').click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expectClean(page, '[role="dialog"][aria-label="Command palette"]');
});

test('fold menu is clean', async ({ page }) => {
  await page.getByTestId('editor').locator('.tw-row', { hasText: 'Second section' }).locator('.tw-fold-more').click();
  await expect(page.getByRole('menu', { name: 'Heading options' })).toBeVisible();
  await expectClean(page, '[role="menu"][aria-label="Heading options"]');
});
