import { describe, it, expect } from 'vitest';
import { parse } from '../core';
import { renderedCaretIndex, headingKeyMap } from './TypewrightEditor';

/**
 * Unit tests for the two source→rendered mapping computations behind the collab
 * decorations and folding. Both are pure string/offset logic (no DOM), so they
 * run in the default node environment.
 */

describe('renderedCaretIndex — presence remote caret mapping', () => {
  it('maps a source cursor inside "## Heading" to the right rendered char', () => {
    const source = '## Heading';
    const renderedLen = 'Heading'.length; // marker-stripped rendered text = 7 chars

    // Caret just after "## He" (raw source offset 5) → rendered index 2 ("He").
    expect(renderedCaretIndex(source, 0, 5, renderedLen)).toBe(2);
    // Caret at the first heading-text glyph (offset 3, after "## ") → index 0.
    expect(renderedCaretIndex(source, 0, 3, renderedLen)).toBe(0);
    // Caret at the source end clamps to the rendered length.
    expect(renderedCaretIndex(source, 0, source.length, renderedLen)).toBe(renderedLen);

    // The old buggy math (cur.from - scope.from) would have returned 5 here —
    // past the intended glyph — because it ignored the stripped "## " marker.
    expect(renderedCaretIndex(source, 0, 5, renderedLen)).not.toBe(5);
  });

  it('accounts for the block scope offset within a larger document', () => {
    const source = 'intro\n\n## Heading';
    const scopeFrom = source.indexOf('## Heading'); // 7
    const renderedLen = 'Heading'.length;

    // 5 source chars into the block ("## He") → rendered index 2.
    expect(renderedCaretIndex(source, scopeFrom, scopeFrom + 5, renderedLen)).toBe(2);
  });
});

describe('fold set survives edits — heading-key anchoring', () => {
  const invert = (blocks: ReturnType<typeof parse>['children'], src: string) => {
    const inv = new Map<string, number>();
    headingKeyMap(blocks, src).forEach((key, idx) => inv.set(key, idx));
    return inv;
  };

  it('keeps the SAME heading folded when a paragraph is inserted above it', () => {
    const src1 = '# Intro\n\nintro text\n\n## Details\n\ndetails body\n\n## Summary\n\nsummary body';
    const blocks1 = parse(src1).children;
    const inv1 = invert(blocks1, src1);

    // The user folds "## Details" — the editor stores its stable KEY, not index.
    expect(inv1.has('details')).toBe(true);
    const detailsIdx1 = inv1.get('details')!;
    const folded = new Set<string>(['details']);

    // Insert a brand-new paragraph block ABOVE "## Details" (shifts indices).
    const anchor = src1.indexOf('## Details');
    const src2 = src1.slice(0, anchor) + 'A brand new paragraph.\n\n' + src1.slice(anchor);
    const blocks2 = parse(src2).children;
    const map2 = headingKeyMap(blocks2, src2);
    const inv2 = invert(blocks2, src2);

    // The folded key still resolves — to the Details heading at its NEW index.
    expect(folded.has('details')).toBe(true);
    expect(inv2.has('details')).toBe(true);
    const detailsIdx2 = inv2.get('details')!;

    // The heading really moved (indices drifted), which is exactly why an
    // index-keyed fold set would have broken.
    expect(detailsIdx2).toBeGreaterThan(detailsIdx1);
    // And the resolved index genuinely IS the Details heading, not a sibling.
    expect(map2.get(detailsIdx2)).toBe('details');
    // The old index no longer points at Details — an index-based fold would have
    // folded the wrong section (or nothing).
    expect(map2.get(detailsIdx1)).not.toBe('details');
  });

  it('drops a folded heading that no longer exists (no stray fold)', () => {
    const src1 = '# Keep\n\nbody\n\n## Gone\n\nmore';
    const inv1 = invert(parse(src1).children, src1);
    expect(inv1.has('gone')).toBe(true);
    const folded = new Set<string>(['gone']);

    // Delete the "## Gone" heading line entirely.
    const src2 = '# Keep\n\nbody\n\nmore';
    const map2 = headingKeyMap(parse(src2).children, src2);

    // Its key resolves to nothing now → the fold silently drops, never folding
    // an unrelated block.
    const survives = [...map2.values()].includes('gone');
    expect(folded.has('gone')).toBe(true); // still in the stored set…
    expect(survives).toBe(false); // …but resolves to no current heading.
  });
});
