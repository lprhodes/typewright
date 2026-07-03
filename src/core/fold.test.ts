import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { headingFoldRanges } from './fold';
import type { Document, Heading } from './ast';

const headings = (doc: Document): Heading[] =>
  doc.children.filter((b): b is Heading => b.type === 'heading');

describe('headingFoldRanges', () => {
  it('folds a heading down to the next same-level heading', () => {
    const doc = parse('# A\ntext\n# B');
    const hs = headings(doc);
    const ranges = headingFoldRanges(doc);
    const a = ranges.find((r) => r.headingFrom === hs[0]!.from)!;
    expect(a).toBeDefined();
    expect(a.from).toBe(hs[0]!.to);
    expect(a.to).toBe(hs[1]!.from);
  });

  it('a higher-level heading stops a lower-level section (the spec example)', () => {
    const doc = parse('# A\ntext\n## B\nmore\n# C');
    const hs = headings(doc);
    expect(hs).toHaveLength(3);
    const ranges = headingFoldRanges(doc);

    const a = ranges.find((r) => r.headingFrom === hs[0]!.from)!;
    const b = ranges.find((r) => r.headingFrom === hs[1]!.from)!;

    // '# A' folds to the next level<=1 heading, which is '# C'
    expect(a.level).toBe(1);
    expect(a.from).toBe(hs[0]!.to);
    expect(a.to).toBe(hs[2]!.from);

    // '## B' also folds only up to '# C' (level 1 <= 2 stops it)
    expect(b.level).toBe(2);
    expect(b.from).toBe(hs[1]!.to);
    expect(b.to).toBe(hs[2]!.from);
  });

  it('omits the trailing heading when it has no body', () => {
    const doc = parse('# A\ntext\n# C');
    const hs = headings(doc);
    const ranges = headingFoldRanges(doc);
    // '# C' is last with nothing after → to (doc.to) <= from (its own end) → omitted
    expect(ranges.some((r) => r.headingFrom === hs[hs.length - 1]!.from)).toBe(false);
  });

  it('the last heading folds to the document end when it has a body', () => {
    const doc = parse('# A\nbody text');
    const hs = headings(doc);
    const ranges = headingFoldRanges(doc);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(hs[0]!.to);
    expect(ranges[0]!.to).toBe(doc.to);
  });

  it('omits a heading with no body at all', () => {
    const doc = parse('# A');
    expect(headingFoldRanges(doc)).toHaveLength(0);
  });

  it('nests deeper headings without closing an ancestor early', () => {
    const doc = parse('# A\n### deep\n# B');
    const hs = headings(doc);
    const ranges = headingFoldRanges(doc);
    const a = ranges.find((r) => r.headingFrom === hs[0]!.from)!;
    const deep = ranges.find((r) => r.headingFrom === hs[1]!.from)!;
    // '# A' (level 1) stops at '# B' (level 1)
    expect(a.to).toBe(hs[2]!.from);
    // '### deep' (level 3) also stops at '# B' since 1 <= 3
    expect(deep.level).toBe(3);
    expect(deep.to).toBe(hs[2]!.from);
  });

  it('a same-or-higher level closes the range; lower does not', () => {
    const doc = parse('## A\n### small\n## big');
    const hs = headings(doc);
    const ranges = headingFoldRanges(doc);
    const a = ranges.find((r) => r.headingFrom === hs[0]!.from)!;
    // '## A' stops at '## big' (equal level), NOT at '### small'
    expect(a.to).toBe(hs[2]!.from);
  });

  it('returns an empty array when there are no headings', () => {
    const doc = parse('just a paragraph\n\nand another');
    expect(headingFoldRanges(doc)).toEqual([]);
  });

  it('reports headingFrom and level for every range', () => {
    const doc = parse('# A\nx\n## B\ny');
    const ranges = headingFoldRanges(doc);
    for (const r of ranges) {
      expect(typeof r.headingFrom).toBe('number');
      expect(r.level).toBeGreaterThanOrEqual(1);
      expect(r.level).toBeLessThanOrEqual(6);
      expect(r.to).toBeGreaterThan(r.from); // no empty bodies
    }
  });

  it('handles an empty document', () => {
    expect(() => headingFoldRanges(parse(''))).not.toThrow();
    expect(headingFoldRanges(parse(''))).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(() => headingFoldRanges(parse('###'))).not.toThrow();
    expect(() => headingFoldRanges(parse('# \n\n## \n\n'))).not.toThrow();
  });

  it('produces one range per heading that has a body', () => {
    const doc = parse('# A\nbody\n## B\nbody\n### C\nbody');
    const ranges = headingFoldRanges(doc);
    // every heading here has a following body, so all three fold
    expect(ranges).toHaveLength(3);
  });
});
