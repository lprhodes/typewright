import { test, expect } from '@playwright/test';

/**
 * Extensions: syntax colouring, sandboxed MDX, Mermaid, and math (spec §3–§5 /
 * plan Phases C–E; ACs "a ```ts fence renders coloured tokens", "<Callout>
 * renders live inside a sandboxed iframe … no transform → escaped source", "a
 * mermaid fence renders a diagram … plain fence with the extension off", "$…$
 * renders via a host engine").
 *
 * The island iframes are OPAQUE-ORIGIN (`sandbox="allow-scripts"`, never
 * `allow-same-origin`), so we assert the iframe mounts + no `.tw-island-error`
 * card — we never reach across the boundary into the frame's document.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('a ```ts fence renders native syntax-colour token spans', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const tokens = editor.locator('pre code span[class*="tw-tok-"]');
  await expect(tokens.first()).toBeVisible();
  // The tokenizer classifies `const` as a keyword (not just any span).
  await expect(editor.locator('pre code span.tw-tok-keyword').first()).toContainText('const');
  expect(await tokens.count()).toBeGreaterThan(1);
});

test('the MDX <Callout> mounts a sandboxed island; toggling MDX off falls back to escaped source', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const island = editor.locator('.tw-island-mdx[data-tw-island="mdx"]');
  await expect(island).toHaveCount(1);

  // Opaque-origin sandbox: allow-scripts, and crucially NOT allow-same-origin.
  const frame = island.locator('iframe');
  await expect(frame).toHaveCount(1);
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  // Compiled cleanly — no inline error card.
  await expect(editor.locator('.tw-island-error')).toHaveCount(0);

  // Turn MDX off → the block falls back to escaped source (no island).
  await page.getByRole('switch', { name: 'MDX (sandboxed)' }).click();
  await expect(editor.locator('.tw-island-mdx')).toHaveCount(0);
  await expect(editor.locator('pre', { hasText: '<Callout' }).first()).toBeVisible();

  // Turn it back on → the sandbox island remounts.
  await page.getByRole('switch', { name: 'MDX (sandboxed)' }).click();
  await expect(editor.locator('.tw-island-mdx iframe')).toHaveCount(1);
});

test('a mermaid fence renders a diagram island; toggling Mermaid off falls back to a fence', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const island = editor.locator('.tw-island-mermaid[data-tw-island="mermaid"]');
  await expect(island).toHaveCount(1);
  await expect(island.locator('iframe')).toHaveCount(1);
  await expect(island.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(editor.locator('.tw-island-error')).toHaveCount(0);

  // Turn Mermaid off → the fence renders as a plain <pre><code> block again.
  await page.getByRole('switch', { name: 'Mermaid diagrams' }).click();
  await expect(editor.locator('.tw-island-mermaid')).toHaveCount(0);
  await expect(editor.locator('pre code', { hasText: 'graph TD' })).toBeVisible();
});

test('inline math renders through the host engine (no raw $ markers)', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const mathBlock = editor.locator('.tw-block', { hasText: 'Inline math renders' });
  await expect(mathBlock).toBeVisible();
  // The engine replaced the $…$ source with rendered markup (superscripts).
  await expect(mathBlock.locator('sup').first()).toBeVisible();
  await expect(mathBlock).not.toContainText('$');
  // No un-rendered fallback source remains.
  await expect(editor.locator('.tw-math-src')).toHaveCount(0);
});
