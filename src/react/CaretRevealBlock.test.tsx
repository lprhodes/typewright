// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse, collectMarkers, hiddenMarkers } from '../core';
import type { Block } from '../core';
import {
  buildSegments,
  paintSegments,
  applyReveal,
  hiddenKeySet,
  reconstructSource,
  offsetOfPoint,
  pointAtOffset,
  computeSplice,
  wrapBlock,
} from './CaretRevealBlock';

/**
 * Unit coverage for CaretRevealBlock's PURE model — the offset mapping, the
 * segment layout, the reveal decision, and the scoped-splice diff. These are the
 * load-bearing correctness pieces (they decide caret placement, which markers
 * reveal, and the edit target). The contentEditable behavioural loop (typing,
 * IME composition, click-settle) is exercised in Playwright e2e — jsdom has no
 * layout/execCommand/composition, so it can't drive the surface directly. What
 * IS asserted here in jsdom is the DOM the surface builds and the DOM⇄source
 * mapping over it, which is where a mapping bug would actually bite.
 */

/** First top-level block of `src` (with document-relative offsets). */
function firstBlock(src: string, opts?: Parameters<typeof parse>[1]): Block {
  const b = parse(src, opts).children[0];
  if (!b) throw new Error('no block parsed');
  return b;
}

/** Paint a block into a fresh detached div and return it. */
function paint(block: Block, source: string, sel: { from: number; to: number } | null): HTMLDivElement {
  const root = document.createElement('div');
  const hidden = sel ? hiddenKeySet(block, source, sel) : 'all';
  paintSegments(root, buildSegments(block, source), hidden, block.from);
  return root;
}

describe('buildSegments — flat content/marker layout', () => {
  it('partitions "**bold** and *em*" and every source char appears once', () => {
    const src = '**bold** and *em*';
    const block = firstBlock(src);
    const segs = buildSegments(block, src);

    // Marker segments carry the raw delimiters; content carries the raw slices.
    expect(
      segs.map((s) => ({ from: s.from, to: s.to, kind: s.kind, mark: s.markerKind, tags: s.tags.map((t) => t.tag) })),
    ).toEqual([
      { from: 0, to: 2, kind: 'marker', mark: 'strong', tags: [] },
      { from: 2, to: 6, kind: 'content', mark: undefined, tags: ['strong'] },
      { from: 6, to: 8, kind: 'marker', mark: 'strong', tags: [] },
      { from: 8, to: 13, kind: 'content', mark: undefined, tags: [] },
      { from: 13, to: 14, kind: 'marker', mark: 'emphasis', tags: [] },
      { from: 14, to: 16, kind: 'content', mark: undefined, tags: ['em'] },
      { from: 16, to: 17, kind: 'marker', mark: 'emphasis', tags: [] },
    ]);

    // The concatenation of every segment's raw text is the block source exactly.
    expect(segs.map((s) => s.text).join('')).toBe(src);
  });

  it('nests strong>em for "**_x_**" and wraps a link whole (so href survives hiding)', () => {
    const strongEm = firstBlock('**_x_**');
    const segs = buildSegments(strongEm, '**_x_**');
    // The "x" content sits inside BOTH strong and em (outermost first).
    const content = segs.find((s) => s.kind === 'content' && s.text === 'x');
    expect(content?.tags.map((t) => t.tag)).toEqual(['strong', 'em']);

    const linkSrc = '[hi](https://x.dev)';
    const link = firstBlock(linkSrc);
    const linkSegs = buildSegments(link, linkSrc);
    // Every piece of the link (brackets, text, url, paren) is wrapped in the <a>,
    // so with the markers hidden the "hi" text still renders as a link.
    expect(linkSegs.every((s) => s.tags.some((t) => t.tag === 'a'))).toBe(true);
    expect(linkSegs.map((s) => s.text).join('')).toBe(linkSrc);
  });

  it('emits a hidden heading `## ` marker and the heading content', () => {
    const src = '## Title';
    const block = firstBlock(src);
    const segs = buildSegments(block, src);
    expect(segs).toEqual([
      expect.objectContaining({ from: 0, to: 3, kind: 'marker', markerKind: 'heading', text: '## ' }),
      expect.objectContaining({ from: 3, to: 8, kind: 'content', text: 'Title' }),
    ]);
  });
});

describe('reveal decision — driven by core hiddenMarkers', () => {
  const src = '**bold** and *em*';
  const block = firstBlock(src);
  const key = (from: number, to: number) => `${from - block.from}:${to - block.from}`;

  it('reveals the `**` around a selection over "bold", hides the far `*`', () => {
    // Selecting the word puts both `**` adjacent to the widened selection.
    const hidden = hiddenKeySet(block, src, { from: 2, to: 6 });
    expect(hidden.has(key(0, 2))).toBe(false); // opening ** revealed
    expect(hidden.has(key(6, 8))).toBe(false); // closing ** revealed
    expect(hidden.has(key(13, 14))).toBe(true); // the * elsewhere stays hidden
    expect(hidden.has(key(16, 17))).toBe(true);
  });

  it('a caret adjacent to only the opening `**` reveals just that marker', () => {
    const hidden = hiddenKeySet(block, src, { from: 1, to: 1 });
    expect(hidden.has(key(0, 2))).toBe(false); // opening ** revealed
    expect(hidden.has(key(6, 8))).toBe(true); // closing ** stays hidden
  });

  it('a caret in another block (no in-block selection) hides every marker', () => {
    const hidden = hiddenKeySet(block, src, null);
    for (const m of collectMarkers(wrapBlock(block), src)) {
      expect(hidden.has(key(m.from, m.to))).toBe(true);
    }
  });

  it('hiddenKeySet mirrors hiddenMarkers exactly (block-local keys)', () => {
    const sel = { from: 1, to: 1 };
    const fromCore = new Set(hiddenMarkers(wrapBlock(block), sel, src).map((m) => key(m.from, m.to)));
    expect(hiddenKeySet(block, src, sel)).toEqual(fromCore);
  });
});

describe('DOM ⇄ source offset mapping', () => {
  it('round-trips an offset inside "bold" through the painted DOM', () => {
    const src = '**bold** and *em*';
    const block = firstBlock(src);
    const root = paint(block, src, { from: 2, to: 6 });

    // Reconstructing from the DOM (hidden markers included) returns the source.
    expect(reconstructSource(root)).toBe(src);

    // Offset 4 ("bo|ld") maps to a DOM point and back to 4.
    const point = pointAtOffset(root, 4);
    expect(point.node.nodeType).toBe(3);
    expect((point.node as Text).data).toBe('bold');
    expect(offsetOfPoint(root, point.node, point.offset)).toBe(4);
  });

  it('maps a point ON a marker (inside the `**`) back to its source offset', () => {
    const src = '**bold**';
    const block = firstBlock(src);
    const root = paint(block, src, { from: 1, to: 1 });
    // Offset 1 falls inside the opening `**` marker span.
    const point = pointAtOffset(root, 1);
    expect((point.node as Text).data).toBe('**');
    expect(offsetOfPoint(root, point.node, point.offset)).toBe(1);
  });

  it('maps rendered entities 1:1 — `&` is one source char and one DOM char', () => {
    const src = 'a & b';
    const block = firstBlock(src);
    const root = paint(block, src, null);
    // No HTML entity encoding: the text node holds a literal single `&`.
    expect(reconstructSource(root)).toBe('a & b');
    const amp = pointAtOffset(root, 2); // the `&`
    expect((amp.node as Text).data[amp.offset]).toBe('&');
    expect(offsetOfPoint(root, amp.node, amp.offset)).toBe(2);
  });

  it('round-trips every offset of a mixed block', () => {
    const src = '**bold** and *em*';
    const block = firstBlock(src);
    const root = paint(block, src, { from: 2, to: 6 });
    for (let off = 0; off <= src.length; off++) {
      const point = pointAtOffset(root, off);
      const back = offsetOfPoint(root, point.node, point.offset);
      // The reverse map lands on the same offset (a marker boundary can resolve
      // to either adjacent node, but the accumulated offset is stable).
      expect(back).toBe(off);
    }
  });
});

describe('painting — hidden by default, reveal is a caret-safe class toggle', () => {
  it('hides all markers when unfocused and reveals them without moving text', () => {
    const src = '**bold**';
    const block = firstBlock(src);
    const root = paint(block, src, null);

    const spans = () => Array.from(root.querySelectorAll('span.tw-syntax'));
    expect(spans()).toHaveLength(2);
    expect(spans().every((s) => s.classList.contains('tw-syntax--hidden'))).toBe(true);

    // The reveal pass only flips classes — the text nodes are untouched.
    const before = reconstructSource(root);
    applyReveal(root, hiddenKeySet(block, src, { from: 2, to: 6 }));
    expect(spans().some((s) => s.classList.contains('tw-syntax--hidden'))).toBe(false);
    expect(reconstructSource(root)).toBe(before);
  });

  it('never uses innerHTML — marker chars live in real text nodes', () => {
    const src = '`<script>`';
    const block = firstBlock(src);
    const root = paint(block, src, { from: 1, to: 1 });
    // The angle brackets are inert text, never parsed as an element.
    expect(root.querySelector('script')).toBeNull();
    expect(reconstructSource(root)).toBe(src);
    expect(root.querySelector('code')?.textContent).toBe('<script>');
  });
});

describe('computeSplice — scoped edit against the block source range', () => {
  it('a single inserted char yields a single-char splice', () => {
    expect(computeSplice('hello', 'hexllo')).toEqual({ from: 2, to: 2, insert: 'x' });
  });

  it('a deletion yields an empty-insert splice', () => {
    expect(computeSplice('hello', 'helo')).toEqual({ from: 3, to: 4, insert: '' });
  });

  it('converts a block-local splice to document offsets via block.from', () => {
    const src = 'intro\n\nhello world';
    const block = firstBlock(src.slice(0)) && parse(src).children[1]!; // "hello world" paragraph
    expect(block.type).toBe('paragraph');
    const oldBlockSrc = src.slice(block.from, block.to); // "hello world"
    const newBlockSrc = 'hexllo world';
    const sp = computeSplice(oldBlockSrc, newBlockSrc);
    const docChange = { from: block.from + sp.from, to: block.from + sp.to, insert: sp.insert };
    // Only the block's range is touched; applying it reproduces the edited doc.
    const applied = src.slice(0, docChange.from) + docChange.insert + src.slice(docChange.to);
    expect(applied).toBe('intro\n\nhexllo world');
    expect(docChange.to - docChange.from).toBe(0); // pure insertion
  });
});
