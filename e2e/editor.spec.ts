import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('unified mode renders GFM richly', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('h1')).toContainText('Typewright');
  await expect(editor.locator('strong').first()).toContainText('from-scratch');
  await expect(editor.locator('em').first()).toContainText('live');
  await expect(editor.locator('a[href="https://example.com"]')).toBeVisible();
  await expect(editor.locator('table')).toBeVisible();
  await expect(editor.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(editor.locator('pre code')).toContainText('const x');
  await expect(editor.locator('blockquote')).toContainText('blockquote');
});

test('unified: click a block reveals its Markdown source and edits it', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.locator('.tw-block', { hasText: 'from-scratch' }).first().click();
  const ta = editor.locator('textarea.tw-source');
  await expect(ta).toBeVisible();
  await expect(ta).toHaveValue(/\*\*from-scratch\*\*/);
  await ta.fill('Edited **paragraph** here.');
  // click another block to blur+commit
  await editor.locator('h1').click();
  await expect(editor.locator('.tw-block', { hasText: 'Edited' })).toBeVisible();
  await expect(editor.locator('.tw-block', { hasText: 'Edited' }).locator('strong')).toContainText('paragraph');
});

test('unified: heading fold collapses the section', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-block', { hasText: 'Content under the second' })).toBeVisible();
  // fold the "Second section" heading (the fold button in its row)
  const row = editor.locator('.tw-row', { hasText: 'Second section' });
  await row.locator('button.tw-fold').click();
  await expect(editor.locator('.tw-foldchip')).toBeVisible();
  await expect(editor.locator('.tw-block', { hasText: 'Content under the second' })).toHaveCount(0);
});

test('edit mode shows raw source', async ({ page }) => {
  await page.locator('button[data-mode="edit"]').click();
  const ta = page.getByTestId('editor').locator('textarea.tw-source-full');
  await expect(ta).toBeVisible();
  await expect(ta).toHaveValue(/# Typewright/);
});

test('bold shortcut wraps the selection', async ({ page }) => {
  await page.locator('button[data-mode="edit"]').click();
  const ta = page.getByTestId('editor').locator('textarea');
  await ta.click();
  await ta.fill('word');
  await ta.selectText();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(ta).toHaveValue('**word**');
});

test('read mode renders and is not editable', async ({ page }) => {
  await page.locator('button[data-mode="read"]').click();
  const editor = page.getByTestId('editor');
  await expect(editor.locator('h1')).toBeVisible();
  await expect(editor.locator('textarea')).toHaveCount(0);
  await editor.locator('h1').click({ force: true });
  await expect(editor.locator('textarea')).toHaveCount(0);
});

test('XSS: a javascript: link is neutralized', async ({ page }) => {
  await page.locator('button[data-mode="edit"]').click();
  const ta = page.getByTestId('editor').locator('textarea');
  await ta.fill('[click](javascript:alert(1))');
  await page.locator('button[data-mode="preview"]').click();
  const link = page.getByTestId('editor').locator('a');
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).not.toContain('javascript:');
});

test('streaming anticipates then resolves', async ({ page }) => {
  await page.getByTestId('play-stream').click();
  const stream = page.getByTestId('stream');
  await expect(stream.locator('strong')).toContainText('bold', { timeout: 5000 });
  await expect(stream.locator('pre code')).toContainText('const p', { timeout: 5000 });
  await expect(stream.locator('h1')).toContainText('Q3', { timeout: 5000 });
});
