import { test, expect, type Page } from '@playwright/test';

/**
 * Comments & collaboration surfaces (spec §1 / plan Phase A; AC "Selecting text
 * offers Comment; a created thread highlights its exact range, appears in the
 * sidebar with working replies/reactions/resolve").
 *
 * The demo wires the REAL `comments` prop (controlled data-in/events-out); the
 * demo's React state IS the host transport, so every callback effect
 * (create/reply/react/resolve) round-trips back through `threads`. We assert the
 * observable outcome of each: a new thread + a new anchored <mark> highlight,
 * a rendered reply, a toggled reaction chip, and the resolved/reopened state.
 */

const editorSel = '[data-testid="editor"]';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

/** Select a word in a rendered block (double-click) → the 💬 popup appears. */
async function selectWordForComment(page: Page): Promise<void> {
  const block = page
    .locator(`${editorSel} .tw-block`, { hasText: 'Content under the second' })
    .first();
  await block.scrollIntoViewIfNeeded();
  await block.dblclick();
  await expect(page.locator('.tw-selpop-btn')).toBeVisible();
}

test('seeded threads render in the sidebar with their quotes', async ({ page }) => {
  const editor = page.getByTestId('editor');
  // Sidebar is hidden until the comments toggle is used.
  await expect(editor.locator('.tw-comments-sidebar')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Show comments' }).click();

  const sidebar = editor.getByRole('complementary', { name: 'Comments' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.tw-comment-thread')).toHaveCount(2);
  await expect(sidebar.locator('.tw-comment-quote').nth(0)).toContainText('from-scratch');
  await expect(sidebar.locator('.tw-comment-quote').nth(1)).toContainText('GFM parsing');
  // The count badge reflects the thread total.
  await expect(sidebar.locator('.tw-comments-count')).toHaveText('2');
});

test('select text → Comment → composer → submit creates a thread + anchored highlight', async ({ page }) => {
  const editor = page.getByTestId('editor');
  // Two seeded highlights exist to start with.
  await expect(editor.locator('mark.tw-comment')).toHaveCount(2);

  await selectWordForComment(page);

  // 💬 Comment → composer with the quoted selection.
  await page.locator('.tw-selpop-btn').click();
  const composer = page.locator('.tw-composer');
  await expect(composer).toBeVisible();
  await expect(composer.locator('.tw-composer-quote')).toBeVisible();

  const body = composer.getByRole('textbox', { name: 'Comment' });
  await body.fill('Please expand this section.');
  await composer.getByRole('button', { name: 'Comment' }).click();

  // The host callback (onCreate) round-tripped: a third thread now exists…
  const sidebar = editor.getByRole('complementary', { name: 'Comments' });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.tw-comment-thread')).toHaveCount(3);
  await expect(sidebar.locator('.tw-comment-text', { hasText: 'Please expand this section.' })).toBeVisible();

  // …and a third anchored highlight was drawn over the commented range.
  await expect(editor.locator('mark.tw-comment')).toHaveCount(3);
});

test('reply to a thread renders the reply', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.getByRole('button', { name: 'Show comments' }).click();

  const thread = editor.locator('.tw-comment-thread', { hasText: 'from-scratch' });
  // Seeded with exactly one reply.
  await expect(thread.locator('.tw-comment-replies .tw-comment-row')).toHaveCount(1);

  await thread.getByRole('textbox', { name: 'Reply to thread' }).fill('Agreed — shipping it.');
  await thread.getByRole('button', { name: 'Send reply' }).click();

  await expect(thread.locator('.tw-comment-replies .tw-comment-row')).toHaveCount(2);
  await expect(thread.locator('.tw-comment-text', { hasText: 'Agreed — shipping it.' })).toBeVisible();
});

test('toggling a reaction updates its pressed state and count', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.getByRole('button', { name: 'Show comments' }).click();

  const thread = editor.locator('.tw-comment-thread', { hasText: 'from-scratch' });
  const react = thread.getByRole('button', { name: /React 🎉/ });
  await expect(react).toHaveAttribute('aria-pressed', 'false');

  await react.click();
  await expect(react).toHaveAttribute('aria-pressed', 'true');
  await expect(react).toContainText('1');

  // Toggling off clears our reaction again (count removed).
  await react.click();
  await expect(react).toHaveAttribute('aria-pressed', 'false');
});

test('resolve then reopen a thread flips its state', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await editor.getByRole('button', { name: 'Show comments' }).click();

  const thread = editor.locator('.tw-comment-thread', { hasText: 'from-scratch' });
  await expect(thread).not.toHaveClass(/resolved/);
  // An unresolved thread has its anchored highlight in the document.
  await expect(editor.locator('mark.tw-comment[data-thread="t1"]')).toHaveCount(1);

  await thread.getByRole('button', { name: 'Resolve thread' }).click();
  await expect(thread).toHaveClass(/resolved/);
  // Resolving removes its highlight decoration.
  await expect(editor.locator('mark.tw-comment[data-thread="t1"]')).toHaveCount(0);

  await thread.getByRole('button', { name: 'Reopen thread' }).click();
  await expect(thread).not.toHaveClass(/resolved/);
  await expect(editor.locator('mark.tw-comment[data-thread="t1"]')).toHaveCount(1);
});
