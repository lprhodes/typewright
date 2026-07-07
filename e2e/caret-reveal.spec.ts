import { test, expect, type Page } from '@playwright/test';

/**
 * Caret-level per-marker reveal — the opt-in `unifiedReveal:'caret'` surface
 * (spec-TW-0003 §5.2 / plan steps 2,3,7). This drives the REAL managed
 * `contentEditable` block (`CaretRevealBlock`) in a browser — the behaviour that
 * its jsdom unit tests cannot exercise (live selection, caret placement, marker
 * reveal/hide on selectionchange, typing, IME composition).
 *
 * The demo exposes the mode via a `reveal-toggle` checkbox that flips the editor's
 * `unifiedReveal` prop between 'block' (default) and 'caret'.
 *
 * Reveal rule (from core `hiddenMarkers`): a marker `[from,to)` reveals when it
 * intersects the selection widened by 1 char each side. So SELECTING a word puts
 * both delimiters adjacent to the (widened) selection and reveals the pair; a
 * collapsed caret at a word EDGE reveals only the adjacent delimiter (per-marker).
 */

const editorSel = '[data-testid="editor"]';

/** Enable caret-reveal, load `md` via edit mode, then return to unified mode. */
async function loadCaretDoc(page: Page, md: string): Promise<void> {
  await page.getByTestId('reveal-toggle').check();
  await page.locator('button[data-mode="edit"]').click();
  await page.getByTestId('editor').locator('textarea.tw-source-full').fill(md);
  await page.locator('button[data-mode="unified"]').click();
}

/** The raw Markdown source, read back through edit mode's full-document textarea. */
async function readSource(page: Page): Promise<string> {
  await page.locator('button[data-mode="edit"]').click();
  return page.getByTestId('editor').locator('textarea.tw-source-full').inputValue();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('editor')).toBeVisible();
});

test('caret mode renders a contentEditable textbox with inline formatting + hidden markers', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await loadCaretDoc(page, 'A **bold** word here.\n\nSecond paragraph.');

  // The eligible block is now a managed contentEditable (role=textbox), NOT the
  // classic click-to-edit `.tw-block` div.
  const block = editor.locator('[data-typewright="caret-block"]').first();
  await expect(block).toBeVisible();
  await expect(block).toHaveAttribute('role', 'textbox');
  await expect(block).toHaveAttribute('contenteditable', 'true');
  await expect(block).toHaveAttribute('aria-multiline', 'true');

  // Formatting is RENDERED (a real <strong> for **bold**), not raw.
  await expect(block.locator('strong')).toHaveText('bold');

  // The raw `**` delimiters are present in the DOM but HIDDEN by default
  // (display:none via .tw-syntax--hidden) — the resting, fully-rendered look.
  const marks = block.locator('span.tw-syntax[data-mark="strong"]');
  await expect(marks).toHaveCount(2);
  await expect(marks.first()).toBeHidden();
  await expect(marks.nth(1)).toBeHidden();
  await expect(marks.first()).toHaveClass(/tw-syntax--hidden/);
});

test('CORE: caret reveals the ** markers around bold, and hides them when the caret leaves', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await loadCaretDoc(page, 'A **bold** word here.\n\nSecond paragraph.');

  const block = editor.locator('[data-typewright="caret-block"]').first();
  const marks = block.locator('span.tw-syntax[data-mark="strong"]');
  // Resting: both delimiters hidden.
  await expect(marks.first()).toBeHidden();
  await expect(marks.nth(1)).toBeHidden();

  // Put the selection on the word (double-click selects "bold") → the widened
  // selection touches BOTH `**` delimiters, so they reveal. THIS is the core AC.
  await block.locator('strong').dblclick();
  await expect(marks.first()).toBeVisible();
  await expect(marks.nth(1)).toBeVisible();
  // The revealed delimiter text is the literal `**`.
  await expect(marks.first()).toHaveText('**');

  // Move the caret to another block → the first block hides its markers again.
  await editor.locator('[data-typewright="caret-block"]').nth(1).click();
  await expect(marks.first()).toBeHidden();
  await expect(marks.nth(1)).toBeHidden();
});

test('per-marker: a caret at the word edge reveals ONLY the adjacent delimiter (not per-block)', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await loadCaretDoc(page, 'A **bold** word here.\n\nSecond paragraph.');

  const block = editor.locator('[data-typewright="caret-block"]').first();
  const open = block.locator('span.tw-syntax[data-from="2"]'); // opening ** [2,4)
  const close = block.locator('span.tw-syntax[data-from="8"]'); // closing ** [8,10)

  // Focus the block, then place a COLLAPSED caret at the very start of "bold"
  // (source offset 4) — adjacent to the opening `**` only.
  await block.click();
  await block.evaluate((el) => {
    const strong = el.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(strong.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // Only the opening delimiter reveals; the closing one stays hidden — proving
  // the reveal is PER MARKER, not the whole block flipping to raw.
  await expect(open).toBeVisible();
  await expect(close).toBeHidden();
});

test('typing round-trips to canonical Markdown (markers intact)', async ({ page }) => {
  const editor = page.getByTestId('editor');
  await loadCaretDoc(page, 'Say **hi** now');

  const block = editor.locator('[data-typewright="caret-block"]').first();
  await expect(block.locator('strong')).toHaveText('hi');

  // Focus + place a deterministic caret at the very end of the block content,
  // then type. (contentEditable End-key nav is unreliable under CDP, so the caret
  // is collapsed to end via a Range for a deterministic round-trip assertion.)
  await block.click();
  await block.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // to end
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.type('!');

  // The source round-trips: the char landed at the caret and the `**hi**`
  // delimiters are byte-intact (canonical Markdown — no marker loss/dup).
  const src = await readSource(page);
  expect(src).toBe('Say **hi** now!');
});

test('caret stability: clicking rendered text inserts at that spot, not block start/end', async ({ page }) => {
  const editor = page.getByTestId('editor');
  const doc = 'Alpha bravo charlie delta echo';
  await loadCaretDoc(page, doc);

  const block = editor.locator('[data-typewright="caret-block"]').first();
  // A plain click lands the caret where the pointer is (roughly block-centre),
  // NOT at the block start or end — this catches the offset-mapping / caret-jump
  // class of bug (where every click snaps to 0 or to the end).
  await block.click();
  await page.keyboard.type('Z');

  const src = await readSource(page);
  const idx = src.indexOf('Z');
  // Z landed somewhere in the interior, not pinned to the start or the end…
  expect(idx).toBeGreaterThan(3);
  expect(idx).toBeLessThan(doc.length - 3);
  // …and nothing else was corrupted: removing the typed Z restores the original.
  expect(src.slice(0, idx) + src.slice(idx + 1)).toBe(doc);
});

test('IME/composition commits the composed text to the source (CDP)', async ({ page }) => {
  // Coverage note (honest): this drives Chromium's real composition path via CDP
  // (Input.imeSetComposition → Input.insertText, the emoji/IME-keyboard commit).
  // It proves the compositionstart→compositionend → model-commit loop round-trips
  // multi-byte text into canonical source. The deep CJK candidate-window / dead-key
  // / soft-keyboard tail is NOT exhaustively driven here (documented as the
  // coverage boundary in spec-TW-0003); the plain insertText path below is the
  // most-reliable proxy and is also asserted.
  const editor = page.getByTestId('editor');
  // The block ends in visible text (" now") so the end-caret is deterministic —
  // a caret cannot rest inside a display:none marker, so a doc ending in a hidden
  // `**` would snap the programmatic end-caret before it (a harness artifact).
  await loadCaretDoc(page, 'Say **hi** now');

  const block = editor.locator('[data-typewright="caret-block"]').first();
  await block.click();
  await block.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // caret to end
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const client = await page.context().newCDPSession(page);
  // Simulate a composition: pre-edit string, then commit the final characters.
  await client.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await client.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
  await client.send('Input.insertText', { text: '日本' });

  const src = await readSource(page);
  // The composed text committed into the source at the caret, and the `**hi**`
  // markers survived the composition untouched (canonical Markdown preserved).
  expect(src).toBe('Say **hi** now日本');
  // The composed run is a single contiguous commit (no split / duplication).
  expect((src.match(/日本/g) ?? []).length).toBe(1);
});

test('IME proxy: a non-keypress text insertion (insertText) round-trips', async ({ page }) => {
  // The most-reliable composition-style path: Input.insertText delivers text the
  // way an emoji keyboard / autocomplete / IME commit does (a text `input` event,
  // no key event). This is the strongest reliably-drivable proxy for commit.
  const editor = page.getByTestId('editor');
  await loadCaretDoc(page, 'Plain text');

  const block = editor.locator('[data-typewright="caret-block"]').first();
  await block.click();
  await block.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const client = await page.context().newCDPSession(page);
  await client.send('Input.insertText', { text: '★ok' });

  const src = await readSource(page);
  expect(src).toBe('Plain text★ok');
});

test('default (block) mode is unaffected: toggling caret off restores click-to-edit textarea', async ({ page }) => {
  const editor = page.getByTestId('editor');

  // With caret reveal ON, an eligible block is a contentEditable — clicking it
  // does NOT open the classic source textarea.
  await loadCaretDoc(page, 'A **bold** paragraph.\n\nAnother one.');
  const caretBlock = editor.locator('[data-typewright="caret-block"]').first();
  await caretBlock.click();
  await expect(editor.locator('textarea.tw-source')).toHaveCount(0);

  // Toggle caret OFF (back to the default 'block' mode) — the classic
  // click-to-edit-block behaviour returns: clicking a block reveals a raw-source
  // textarea with the Markdown, exactly as the default path always did.
  await page.getByTestId('reveal-toggle').uncheck();
  await expect(editor.locator('[data-typewright="caret-block"]')).toHaveCount(0);
  await editor.locator('.tw-block', { hasText: 'bold' }).first().click();
  const ta = editor.locator('textarea.tw-source');
  await expect(ta).toBeVisible();
  await expect(ta).toHaveValue(/\*\*bold\*\*/);
});
