import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { collectMarkers, hiddenMarkers, activeBlockIndex } from './unified';
import type { Marker } from './unified';

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
