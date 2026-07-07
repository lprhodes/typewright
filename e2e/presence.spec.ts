import { test, expect } from '@playwright/test';

/**
 * Presence (spec §1 / plan Phase A; AC "Presence peers passed as props render
 * avatars and live remote cursors at the correct text positions").
 *
 * The demo passes `presence` with three peers; one (Priya N.) carries a live
 * cursor anchored at "Content under the second". We assert the avatar row and
 * the remote-cursor decoration render.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('presence avatars render for every peer', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const avatars = editor.locator('.tw-collab-bar .tw-presence-av');
  await expect(avatars).toHaveCount(3);
  // The presence row is labelled for assistive tech.
  await expect(editor.locator('.tw-presence[aria-label="Collaborators"]')).toBeVisible();
  // Each avatar shows the peer's initials.
  await expect(avatars.filter({ hasText: 'PN' })).toHaveCount(1); // Priya N.
});

test('a remote collaborator cursor renders in the document', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const cursor = editor.locator('.tw-remote-cursor');
  await expect(cursor.first()).toBeAttached();
  // The cursor is labelled with its peer and sits inside the anchored block.
  await expect(cursor.first()).toHaveAttribute('data-peer', 'Priya N.');
  await expect(
    editor.locator('.tw-block', { hasText: 'Content under the second' }).locator('.tw-remote-cursor'),
  ).toHaveCount(1);
});
