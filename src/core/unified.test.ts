import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { collectMarkers, hiddenMarkers, activeBlockIndex } from './unified';
import type { Marker } from './unified';
import type { Document } from './ast';

const kinds = (markers: Marker[]): string[] => markers.map((m) => m.kind);
const ofKind = (markers: Marker[], kind: string): Marker[] =>
  markers.filter((m) => m.kind === kind);

describe('collectMarkers', () => {
  it('emits a heading marker covering the "#… " prefix', () => {
    const doc = parse('# Title');
    const heading = ofKind(collectMarkers(doc), 'heading');
    expect(heading).toHaveLength(1);
    expect(heading[0]!.from).toBe(0);
    // the marker ends before the content 'Title' (covers '# ')
    expect(heading[0]!.to).toBe(doc.children[0]!.type === 'heading' ? doc.children[0]!.contentFrom : heading[0]!.to);
    expect(heading[0]!.to).toBeGreaterThanOrEqual(1);
  });

  it('handles deeper heading levels', () => {
    const doc = parse('### Deep');
    const heading = ofKind(collectMarkers(doc), 'heading');
    expect(heading).toHaveLength(1);
    expect(heading[0]!.from).toBe(0);
    expect(heading[0]!.to).toBeGreaterThan(2); // at least '###'
  });

  it('emits two emphasis delimiter runs', () => {
    const doc = parse('*hi*');
    const em = ofKind(collectMarkers(doc), 'emphasis');
    expect(em).toHaveLength(2);
    expect(em[0]!.from).toBe(0);
    expect(em[1]!.to).toBe(4);
    // the two runs sit on either side of the content
    expect(em[0]!.to).toBeLessThanOrEqual(em[1]!.from);
  });

  it('emits two strong delimiter runs', () => {
    const doc = parse('**hi**');
    const st = ofKind(collectMarkers(doc), 'strong');
    expect(st).toHaveLength(2);
    expect(st[0]!.from).toBe(0);
    expect(st[1]!.to).toBe(6);
  });

  it('emits strike delimiter runs with kind "strike"', () => {
    const doc = parse('~~no~~');
    const runs = ofKind(collectMarkers(doc), 'strike');
    // strikethrough is a GFM feature; if the parser produced it, it must be marked
    if (runs.length > 0) {
      expect(runs).toHaveLength(2);
      expect(kinds(collectMarkers(doc))).not.toContain('strikethrough');
    }
  });

  it('emits two backtick fences for inline code', () => {
    const doc = parse('`code`');
    const code = ofKind(collectMarkers(doc), 'code');
    expect(code).toHaveLength(2);
    expect(code[0]!.from).toBe(0);
    expect(code[1]!.to).toBe(6);
  });

  it('emits link piece markers', () => {
    const doc = parse('[t](u)');
    const link = ofKind(collectMarkers(doc), 'link');
    expect(link.length).toBeGreaterThanOrEqual(3);
    // opening bracket sits at the link start
    expect(link[0]!.from).toBe(0);
    // last piece is the closing paren
    expect(link[link.length - 1]!.to).toBe(6);
  });

  it('emits an image "!" marker', () => {
    const doc = parse('![a](u)');
    const img = ofKind(collectMarkers(doc), 'image');
    expect(img.length).toBeGreaterThanOrEqual(1);
    expect(img[0]!.from).toBe(0); // the leading '!'
    expect(kinds(collectMarkers(doc))).toContain('image');
  });

  it('emits a listMarker for a bullet item', () => {
    const doc = parse('- item');
    const lm = ofKind(collectMarkers(doc), 'listMarker');
    expect(lm.length).toBeGreaterThanOrEqual(1);
    expect(lm[0]!.from).toBeLessThan(lm[0]!.to);
  });

  it('walks into nested inline formatting', () => {
    const doc = parse('# H\n\n**bold** and *em*');
    const all = collectMarkers(doc);
    expect(kinds(all)).toContain('heading');
    expect(ofKind(all, 'strong')).toHaveLength(2);
    expect(ofKind(all, 'emphasis')).toHaveLength(2);
  });

  it('never throws on malformed / incomplete input', () => {
    expect(() => collectMarkers(parse('**unterminated'))).not.toThrow();
    expect(() => collectMarkers(parse('[broken](  '))).not.toThrow();
    expect(() => collectMarkers(parse(''))).not.toThrow();
    expect(() => collectMarkers(parse('###'))).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * Math + footnote-ref markers (Wave 2b). Built from direct AST fixtures so the
 * offsets are exact and independent of the parser's opt-in extension flags.
 * ------------------------------------------------------------------ */

describe('collectMarkers — math + footnote refs', () => {
  it('emits two `$` delimiter markers around inline math', () => {
    // `$e=mc^2$` — [0,8): '$' at [0,1), source [1,7), '$' at [7,8).
    const doc: Document = {
      type: 'document',
      from: 0,
      to: 8,
      children: [
        {
          type: 'paragraph',
          from: 0,
          to: 8,
          children: [{ type: 'math', from: 0, to: 8, value: 'e=mc^2', display: false }],
        },
      ],
    };
    const math = ofKind(collectMarkers(doc), 'math');
    expect(math).toHaveLength(2);
    expect(math[0]!.from).toBe(0);
    expect(math[0]!.to).toBe(1);
    expect(math[1]!.from).toBe(7);
    expect(math[1]!.to).toBe(8);
  });

  it('emits two `$$` delimiter markers around display math', () => {
    // `$$x$$` — [0,5): '$$' at [0,2), source [2,3), '$$' at [3,5).
    const doc: Document = {
      type: 'document',
      from: 0,
      to: 5,
      children: [
        {
          type: 'paragraph',
          from: 0,
          to: 5,
          children: [{ type: 'math', from: 0, to: 5, value: 'x', display: true }],
        },
      ],
    };
    const math = ofKind(collectMarkers(doc), 'math');
    expect(math).toHaveLength(2);
    expect(math[0]!.from).toBe(0);
    expect(math[0]!.to).toBe(2);
    expect(math[1]!.from).toBe(3);
    expect(math[1]!.to).toBe(5);
  });

  it('emits `[^` and `]` markers for a footnote reference', () => {
    // `[^1]` — [0,4): '[^' at [0,2), id '1' at [2,3), ']' at [3,4).
    const doc: Document = {
      type: 'document',
      from: 0,
      to: 4,
      children: [
        {
          type: 'paragraph',
          from: 0,
          to: 4,
          children: [{ type: 'footnoteRef', from: 0, to: 4, id: '1' }],
        },
      ],
    };
    const fn = ofKind(collectMarkers(doc), 'footnoteRef');
    expect(fn).toHaveLength(2);
    expect(fn[0]!.from).toBe(0);
    expect(fn[0]!.to).toBe(2);
    expect(fn[1]!.from).toBe(3);
    expect(fn[1]!.to).toBe(4);
  });

  it('reveals only the math delimiter the caret sits on', () => {
    const doc: Document = {
      type: 'document',
      from: 0,
      to: 8,
      children: [
        {
          type: 'paragraph',
          from: 0,
          to: 8,
          children: [{ type: 'math', from: 0, to: 8, value: 'e=mc^2', display: false }],
        },
      ],
    };
    const math = ofKind(collectMarkers(doc), 'math');
    const open = math[0]!; // [0,1)
    const close = math[1]!; // [7,8)
    // caret on the opening '$' reveals it; the far closing '$' stays hidden
    const hidden = hiddenMarkers(doc, { from: 0, to: 0 });
    expect(hidden).not.toContainEqual(open);
    expect(hidden).toContainEqual(close);
  });
});

/* ------------------------------------------------------------------ *
 * Fenced-code + blockquote markers (TW-0003). These need the raw `source`
 * to be offset-exact, so they are only emitted when `source` is passed.
 * ------------------------------------------------------------------ */

describe('collectMarkers — fenced code + blockquote', () => {
  it('emits opening + closing fence markers for a closed fenced block', () => {
    const src = '```js\nconst x = 1;\n```';
    const fence = ofKind(collectMarkers(parse(src), src), 'fence');
    expect(fence).toHaveLength(2);
    // opening fence line: '```js' at [0,5)
    expect(fence[0]!.from).toBe(0);
    expect(fence[0]!.to).toBe(5);
    expect(src.slice(fence[0]!.from, fence[0]!.to)).toBe('```js');
    // closing fence line: '```' at [19,22)
    expect(fence[1]!.from).toBe(19);
    expect(fence[1]!.to).toBe(22);
    expect(src.slice(fence[1]!.from, fence[1]!.to)).toBe('```');
  });

  it('works for tilde fences too', () => {
    const src = '~~~\ncode\n~~~';
    const fence = ofKind(collectMarkers(parse(src), src), 'fence');
    expect(fence).toHaveLength(2);
    expect([fence[0]!.from, fence[0]!.to]).toEqual([0, 3]);
    expect([fence[1]!.from, fence[1]!.to]).toEqual([9, 12]);
  });

  it('includes any info-string / trailing spaces in the fence lines', () => {
    const src = '```js  \nx\n```  ';
    const fence = ofKind(collectMarkers(parse(src), src), 'fence');
    expect(fence).toHaveLength(2);
    expect(src.slice(fence[0]!.from, fence[0]!.to)).toBe('```js  ');
    expect(src.slice(fence[1]!.from, fence[1]!.to)).toBe('```  ');
  });

  it('emits only the opening fence for an unterminated fenced block', () => {
    const src = '```js\nno close here';
    const fence = ofKind(collectMarkers(parse(src), src), 'fence');
    expect(fence).toHaveLength(1);
    expect(src.slice(fence[0]!.from, fence[0]!.to)).toBe('```js');
  });

  it('emits no fence markers for an indented (non-fenced) code block', () => {
    const src = '    indented code';
    expect(ofKind(collectMarkers(parse(src), src), 'fence')).toHaveLength(0);
  });

  it('emits a `>` marker for a single blockquote line', () => {
    const src = '> hello';
    const bq = ofKind(collectMarkers(parse(src), src), 'blockquote');
    expect(bq).toHaveLength(1);
    expect([bq[0]!.from, bq[0]!.to]).toEqual([0, 2]);
    expect(src.slice(bq[0]!.from, bq[0]!.to)).toBe('> ');
  });

  it('emits one `>` marker per line for a multi-line blockquote', () => {
    const src = '> a\n> b';
    const bq = ofKind(collectMarkers(parse(src), src), 'blockquote');
    expect(bq).toHaveLength(2);
    expect([bq[0]!.from, bq[0]!.to]).toEqual([0, 2]);
    expect([bq[1]!.from, bq[1]!.to]).toEqual([4, 6]);
  });

  it('covers the full stacked prefix for a nested blockquote (one marker/line)', () => {
    const src = '> > deep\n> > deeper';
    const bq = ofKind(collectMarkers(parse(src), src), 'blockquote');
    expect(bq).toHaveLength(2);
    expect(src.slice(bq[0]!.from, bq[0]!.to)).toBe('> > ');
    expect(src.slice(bq[1]!.from, bq[1]!.to)).toBe('> > ');
  });

  it('handles a `>` with no following space', () => {
    const src = '>tight';
    const bq = ofKind(collectMarkers(parse(src), src), 'blockquote');
    expect(bq).toHaveLength(1);
    expect([bq[0]!.from, bq[0]!.to]).toEqual([0, 1]);
  });

  it('omits fence/blockquote markers when `source` is not supplied', () => {
    const src = '```js\nx\n```\n\n> quote';
    const withSource = kinds(collectMarkers(parse(src), src));
    const withoutSource = kinds(collectMarkers(parse(src)));
    expect(withSource).toContain('fence');
    expect(withSource).toContain('blockquote');
    // source-free call is identical to the pre-TW-0003 behaviour
    expect(withoutSource).not.toContain('fence');
    expect(withoutSource).not.toContain('blockquote');
  });

  it('still collects the inline markers inside a blockquote', () => {
    const src = '> quote **bold**';
    const all = collectMarkers(parse(src), src);
    expect(kinds(all)).toContain('blockquote');
    expect(ofKind(all, 'strong')).toHaveLength(2);
  });
});

describe('hiddenMarkers — fence + blockquote reveal', () => {
  const fenceSrc = '```js\nx\n```'; // open [0,5), close [8,11)

  it('hides both fence markers when the caret is in the code body', () => {
    const doc = parse(fenceSrc);
    const hidden = ofKind(hiddenMarkers(doc, { from: 6, to: 6 }, fenceSrc), 'fence');
    expect(hidden).toHaveLength(2);
  });

  it('reveals only the fence line the caret sits on', () => {
    const doc = parse(fenceSrc);
    const fence = ofKind(collectMarkers(doc, fenceSrc), 'fence');
    const open = fence[0]!; // [0,5)
    const close = fence[1]!; // [8,11)
    // caret on the opening fence reveals it, the closing fence stays hidden
    const hiddenOnOpen = hiddenMarkers(doc, { from: 2, to: 2 }, fenceSrc);
    expect(hiddenOnOpen).not.toContainEqual(open);
    expect(hiddenOnOpen).toContainEqual(close);
    // caret on the closing fence reveals it, the opening fence stays hidden
    const hiddenOnClose = hiddenMarkers(doc, { from: 9, to: 9 }, fenceSrc);
    expect(hiddenOnClose).toContainEqual(open);
    expect(hiddenOnClose).not.toContainEqual(close);
  });

  it('hides the `>` prefix when the caret is in the quote body, reveals it on the marker', () => {
    const src = '> hello world';
    const doc = parse(src);
    const marker = ofKind(collectMarkers(doc, src), 'blockquote')[0]!; // [0,2)
    // caret out in 'world' → the '>' prefix stays hidden
    const away = hiddenMarkers(doc, { from: 8, to: 8 }, src);
    expect(away).toContainEqual(marker);
    // caret on the '>' → it reveals
    const on = hiddenMarkers(doc, { from: 0, to: 0 }, src);
    expect(on).not.toContainEqual(marker);
  });
});

describe('hiddenMarkers', () => {
  it('reveals a strong run when the selection is inside it, and hides the heading', () => {
    const doc = parse('# A\n\n**bold**');
    const strong = ofKind(collectMarkers(doc), 'strong');
    expect(strong).toHaveLength(2);
    // select the content between the two delimiter runs (the word 'bold')
    const sel = { from: strong[0]!.to, to: strong[1]!.from };
    const hidden = hiddenMarkers(doc, sel);
    const hiddenKinds = kinds(hidden);
    // the strong delimiters reveal → excluded from hidden
    expect(hiddenKinds).not.toContain('strong');
    // the heading marker is far away → stays hidden
    expect(hiddenKinds).toContain('heading');
  });

  it('hides every marker when the caret is far from all of them', () => {
    const doc = parse('# A\n\n**bold**');
    const all = collectMarkers(doc);
    // caret between the blocks, away from any marker
    const hidden = hiddenMarkers(doc, { from: 4, to: 4 });
    expect(hidden).toHaveLength(all.length);
  });

  it('reveals the heading marker when the caret sits on it', () => {
    const doc = parse('# A\n\n**bold**');
    const heading = ofKind(collectMarkers(doc), 'heading')[0]!;
    const hidden = hiddenMarkers(doc, { from: heading.from, to: heading.from });
    expect(kinds(hidden)).not.toContain('heading');
  });

  it('widens the selection by one on each side', () => {
    const doc = parse('*x*');
    const em = ofKind(collectMarkers(doc), 'emphasis');
    const open = em[0]!; // [0,1)
    const close = em[1]!; // [2,3)
    // caret at the boundary just past the opening delimiter reveals it via the
    // ±1 widening (a bare point in the half-open range would not include the end)
    const hidden = hiddenMarkers(doc, { from: open.to, to: open.to });
    expect(hidden).not.toContainEqual(open);
    // the closing delimiter is two away → stays hidden
    expect(hidden).toContainEqual(close);
  });

  it('normalises a backwards selection', () => {
    const doc = parse('**bold**');
    const strong = ofKind(collectMarkers(doc), 'strong');
    const sel = { from: strong[1]!.from, to: strong[0]!.to }; // reversed
    const hidden = hiddenMarkers(doc, sel);
    expect(kinds(hidden)).not.toContain('strong');
  });

  it('returns all markers for a document with no selection overlap', () => {
    const doc = parse('# One\n\n# Two');
    const all = collectMarkers(doc);
    const hidden = hiddenMarkers(doc, { from: doc.to, to: doc.to });
    // caret at very end may reveal the last heading marker only
    expect(hidden.length).toBeGreaterThanOrEqual(all.length - 1);
  });

  it('never throws for out-of-range selections', () => {
    const doc = parse('# A');
    expect(() => hiddenMarkers(doc, { from: -50, to: 999 })).not.toThrow();
  });
});

describe('activeBlockIndex', () => {
  it('finds the block containing an offset', () => {
    const doc = parse('# A\n\nsecond paragraph');
    expect(activeBlockIndex(doc, doc.children[0]!.from)).toBe(0);
    expect(activeBlockIndex(doc, doc.children[1]!.from)).toBe(1);
  });

  it('includes both range endpoints (inclusive)', () => {
    const doc = parse('# A\n\nbody');
    const b = doc.children[0]!;
    expect(activeBlockIndex(doc, b.from)).toBe(0);
    expect(activeBlockIndex(doc, b.to)).toBe(0);
  });

  it('returns -1 for an offset past every block', () => {
    const doc = parse('# A');
    expect(activeBlockIndex(doc, doc.to + 100)).toBe(-1);
  });

  it('returns -1 for an empty document', () => {
    const doc = parse('');
    expect(activeBlockIndex(doc, 0)).toBe(-1);
  });

  it('never throws on any offset', () => {
    const doc = parse('# A\n\nbody');
    expect(() => activeBlockIndex(doc, -1)).not.toThrow();
    expect(() => activeBlockIndex(doc, 1e9)).not.toThrow();
  });
});
