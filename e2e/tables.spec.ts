import { test, expect } from '@playwright/test';

/**
 * In-place table WYSIWYG grid (spec §6 / plan Phase F; AC "Editing a table cell
 * writes only that cell's source range … Tab/arrows navigate cells; add/remove
 * row/column and alignment changes round-trip to canonical GFM").
 *
 * The Markdown source stays canonical: we drive the grid, then read the raw
 * source back in `edit` mode to prove the mutation round-tripped, and that ONLY
 * the intended cell/structure changed.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('the GFM table renders as an editable grid', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-table-grid .tw-tg-table')).toBeVisible();
  // Header (2) + two body rows (2×2) = 6 grid cells.
  await expect(editor.locator('.tw-tg-cell')).toHaveCount(6);
  await expect(editor.locator('.tw-tg-table thead th')).toHaveCount(2);
  await expect(editor.locator('.tw-tg-table tbody tr')).toHaveCount(2);
});

test('editing a cell writes only that cell back to the Markdown source', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const cell = editor.locator('.tw-tg-cell', { hasText: 'Shipped' });
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Done');
  await page.keyboard.press('Tab'); // commit via blur to the next cell

  // Round-trip: the raw source now carries the edit, canonical GFM, scoped to
  // exactly that one cell (every other cell is byte-for-byte intact).
  await page.locator('button[data-mode="edit"]').click();
  const source = editor.locator('textarea.tw-source-full');
  await expect(source).toHaveValue(/\| Parser \| Done \|/);
  const value = await source.inputValue();
  expect(value).not.toContain('Shipped');
  for (const kept of ['| Feature | Status |', '| Editor | Alpha |', '| :- | -: |']) {
    expect(value).toContain(kept);
  }
});

test('Tab navigates between cells', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const first = editor.locator('.tw-tg-cell', { hasText: 'Parser' });
  await first.scrollIntoViewIfNeeded();
  await first.click();
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  // Focus advanced to the next cell in the same row.
  await expect(editor.locator('.tw-tg-cell', { hasText: 'Shipped' })).toBeFocused();
});

test('adding a row updates the source to canonical GFM (alignment row preserved)', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-tg-table tbody tr')).toHaveCount(2);

  const cell = editor.locator('.tw-tg-cell', { hasText: 'Editor' });
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  // The grid toolbar floats above the table and can sit under the page's sticky
  // topbar, so dispatch the click directly to the button (bypasses hit-testing).
  await editor.getByRole('button', { name: 'Add row' }).dispatchEvent('click');

  // The grid gained a body row…
  await expect(editor.locator('.tw-tg-table tbody tr')).toHaveCount(3);

  // …and the source is still canonical GFM with the alignment row intact.
  await page.locator('button[data-mode="edit"]').click();
  const value = await editor.locator('textarea.tw-source-full').inputValue();
  const tableLines = value.split('\n').filter((l) => l.trim().startsWith('|'));
  expect(tableLines.length).toBe(5); // header + alignment + 3 body rows
  // The structural op re-serialized the whole table to CANONICAL GFM — the
  // alignment row's dashes are normalized (`:-`→`:---`, `-:`→`---:`).
  expect(value).toContain('| :--- | ---: |');
});

test('adding a column updates every row + the alignment row', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await expect(editor.locator('.tw-tg-table thead th')).toHaveCount(2);

  const cell = editor.locator('.tw-tg-cell', { hasText: 'Status' });
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  await editor.getByRole('button', { name: 'Add column' }).dispatchEvent('click');

  await expect(editor.locator('.tw-tg-table thead th')).toHaveCount(3);

  await page.locator('button[data-mode="edit"]').click();
  const value = await editor.locator('textarea.tw-source-full').inputValue();
  const tableLines = value.split('\n').filter((l) => l.trim().startsWith('|'));
  // Every table line now has three pipe-delimited columns (4 leading/trailing pipes).
  for (const line of tableLines) {
    expect((line.match(/\|/g) ?? []).length).toBe(4);
  }
});
