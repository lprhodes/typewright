import { describe, it, expect } from 'vitest';
import { applyCommand } from './commands';
import type { Sel } from './commands';

const sel = (from: number, to: number): Sel => ({ from, to });

describe('applyCommand', () => {
  it('wraps a selection in bold', () => {
    const r = applyCommand('the word here', sel(4, 8), 'bold');
    expect(r.text).toBe('the **word** here');
    expect(r.text.slice(r.selection.from, r.selection.to)).toBe('word');
  });

  it('unwraps bold when the selection is already wrapped outside', () => {
    // selection covers "word" inside **word**
    const r = applyCommand('the **word** here', sel(6, 10), 'bold');
    expect(r.text).toBe('the word here');
    expect(r.text.slice(r.selection.from, r.selection.to)).toBe('word');
  });

  it('inserts empty bold markers with the caret between on a collapsed selection', () => {
    const r = applyCommand('ab', sel(1, 1), 'bold');
    expect(r.text).toBe('a****b');
    expect(r.selection).toEqual({ from: 3, to: 3 });
  });

  it('wraps italic and inline code', () => {
    expect(applyCommand('x', sel(0, 1), 'italic').text).toBe('*x*');
    expect(applyCommand('x', sel(0, 1), 'inlineCode').text).toBe('`x`');
    expect(applyCommand('x', sel(0, 1), 'strikethrough').text).toBe('~~x~~');
  });

  it('creates a link with the url selected', () => {
    const r = applyCommand('see docs', sel(4, 8), 'link');
    expect(r.text).toBe('see [docs](https://)');
    expect(r.text.slice(r.selection.from, r.selection.to)).toBe('https://');
  });

  it('sets a heading level on the line', () => {
    const r = applyCommand('Title', sel(0, 0), 'heading2');
    expect(r.text).toBe('## Title');
  });

  it('re-levels an existing heading', () => {
    const r = applyCommand('# Title', sel(3, 3), 'heading3');
    expect(r.text).toBe('### Title');
  });

  it('toggles a heading off when already at that level', () => {
    const r = applyCommand('## Title', sel(4, 4), 'heading2');
    expect(r.text).toBe('Title');
  });

  it('makes a bullet list across multiple selected lines', () => {
    const r = applyCommand('one\ntwo\nthree', sel(0, 13), 'bulletList');
    expect(r.text).toBe('- one\n- two\n- three');
  });

  it('numbers an ordered list', () => {
    const r = applyCommand('a\nb\nc', sel(0, 5), 'orderedList');
    expect(r.text).toBe('1. a\n2. b\n3. c');
  });

  it('makes a task list', () => {
    const r = applyCommand('todo', sel(0, 0), 'taskList');
    expect(r.text).toBe('- [ ] todo');
  });

  it('toggles a blockquote on and off', () => {
    const on = applyCommand('quote me', sel(0, 0), 'quote');
    expect(on.text).toBe('> quote me');
    const off = applyCommand('> quote me', sel(2, 2), 'quote');
    expect(off.text).toBe('quote me');
  });

  it('converts a bullet list back to plain lines', () => {
    const r = applyCommand('- one\n- two', sel(0, 11), 'bulletList');
    expect(r.text).toBe('one\ntwo');
  });

  it('inserts a horizontal rule with surrounding blank lines', () => {
    const r = applyCommand('above', sel(5, 5), 'horizontalRule');
    expect(r.text).toBe('above\n\n---');
  });

  it('wraps a selection in a code block', () => {
    const r = applyCommand('let x = 1', sel(0, 9), 'codeBlock');
    expect(r.text).toBe('```\nlet x = 1\n```');
  });

  it('inserts a GFM table template', () => {
    const r = applyCommand('', sel(0, 0), 'table');
    expect(r.text).toContain('| Column | Column |');
    expect(r.text).toContain('| --- | --- |');
  });

  it('never produces NaN offsets and keeps selection in bounds', () => {
    const cmds = ['bold', 'italic', 'link', 'heading1', 'bulletList', 'quote', 'table', 'codeBlock', 'horizontalRule'] as const;
    for (const c of cmds) {
      const r = applyCommand('sample text', sel(0, 6), c);
      expect(r.selection.from).toBeGreaterThanOrEqual(0);
      expect(r.selection.to).toBeLessThanOrEqual(r.text.length);
      expect(Number.isNaN(r.selection.from)).toBe(false);
    }
  });
});
