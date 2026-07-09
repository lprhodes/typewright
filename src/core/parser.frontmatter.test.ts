import { describe, it, expect } from 'vitest';
import { parse, parseIncremental, parseIncrementalWithStats } from './parser';

const FM = { frontmatter: true } as const;

describe('frontmatter — opt-in', () => {
  it('is off by default: a leading --- block parses exactly as before', () => {
    const src = '---\ntitle: x\n---\n\n# H\n';
    const doc = parse(src);
    expect(doc.frontmatter).toBeUndefined();
    // Two thematic breaks fencing a plain paragraph — the pre-existing behaviour
    // this flag exists to opt out of.
    expect(doc.children.map((b) => b.type)).toEqual([
      'thematicBreak',
      'paragraph',
      'thematicBreak',
      'heading',
    ]);
  });

  it('extracts the block and keeps it out of children', () => {
    const doc = parse('---\ntitle: x\n---\n\n# H\n', FM);
    expect(doc.frontmatter).toEqual({
      type: 'frontmatter',
      from: 0,
      to: 16,
      value: 'title: x',
    });
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]!.type).toBe('heading');
  });

  it('leaves following blocks offset-exact against the ORIGINAL source', () => {
    const src = '---\ntitle: x\n---\n\n# Hello\n';
    const doc = parse(src, FM);
    const h = doc.children[0]!;
    expect(src.slice(h.from, h.to)).toBe('# Hello');
    expect(doc.from).toBe(0);
    expect(doc.to).toBe(src.length);
  });

  it('handles a multi-line block, preserving inner newlines but not delimiters', () => {
    const doc = parse('---\na: 1\nb:\n  - 2\n---\nbody\n', FM);
    expect(doc.frontmatter?.value).toBe('a: 1\nb:\n  - 2');
  });

  it('handles an empty block', () => {
    const doc = parse('---\n---\nbody\n', FM);
    expect(doc.frontmatter?.value).toBe('');
    expect(doc.children).toHaveLength(1);
  });

  it('normalises CRLF to LF in the extracted value', () => {
    const doc = parse('---\r\ntitle: x\r\n---\r\nbody\r\n', FM);
    expect(doc.frontmatter?.value).toBe('title: x');
    expect(doc.frontmatter?.to).toBe(18);
  });

  it('tolerates trailing spaces on the delimiter lines', () => {
    expect(parse('--- \na: 1\n---  \n', FM).frontmatter?.value).toBe('a: 1');
  });

  it('ignores an UNCLOSED block — `---` still parses as it always did', () => {
    const doc = parse('---\ntitle: x\n', FM);
    expect(doc.frontmatter).toBeUndefined();
    expect(doc.children.length).toBeGreaterThan(0);
  });

  it('ignores a block that does not start at offset 0', () => {
    const doc = parse('# H\n\n---\na: 1\n---\n', FM);
    expect(doc.frontmatter).toBeUndefined();
  });

  it('ignores a fence that is not exactly three hyphens', () => {
    expect(parse('----\na: 1\n----\n', FM).frontmatter).toBeUndefined();
    expect(parse('--\na: 1\n--\n', FM).frontmatter).toBeUndefined();
  });

  it('does not interpret the value — `: ` is not parsed, just returned', () => {
    const doc = parse('---\nweird: [}{"\n---\nx\n', FM);
    expect(doc.frontmatter?.value).toBe('weird: [}{"');
  });
});

describe('frontmatter — incremental reparse', () => {
  const withFm = '---\ntitle: x\n---\n\n# H\n\nbody text\n';

  it('carries frontmatter through a fast-path body edit', () => {
    const next = withFm.replace('body text', 'body text!');
    const change = { from: withFm.indexOf('body text') + 9, to: withFm.indexOf('body text') + 9, insert: '!' };
    const doc = parseIncremental(parse(withFm, FM), withFm, change, next, FM);
    expect(doc.frontmatter).toEqual(parse(next, FM).frontmatter);
    expect(doc).toEqual(parse(next, FM));
  });

  it('falls back to a full parse when the edit lands inside the frontmatter', () => {
    const next = withFm.replace('title: x', 'title: y');
    const change = { from: 11, to: 12, insert: 'y' };
    const { doc, stats } = parseIncrementalWithStats(parse(withFm, FM), withFm, change, next, FM);
    expect(stats.fellBack).toBe(true);
    expect(doc.frontmatter?.value).toBe('title: y');
    expect(doc).toEqual(parse(next, FM));
  });

  it('falls back when the edit destroys the closing delimiter', () => {
    // Insert at exactly `frontmatter.to` — the last char of the closing `---`.
    const prev = parse(withFm, FM);
    const at = prev.frontmatter!.to;
    const next = withFm.slice(0, at) + 'x' + withFm.slice(at);
    const { doc, stats } = parseIncrementalWithStats(prev, withFm, { from: at, to: at, insert: 'x' }, next, FM);
    expect(stats.fellBack).toBe(true);
    expect(doc.frontmatter).toBeUndefined(); // `---x` is no longer a fence
    expect(doc).toEqual(parse(next, FM));
  });

  it('falls back when an edit at offset 0 could OPEN a block', () => {
    const src = '# H\n\nbody\n';
    const next = '---\na: 1\n---\n' + src;
    const { doc, stats } = parseIncrementalWithStats(
      parse(src, FM),
      src,
      { from: 0, to: 0, insert: '---\na: 1\n---\n' },
      next,
      FM,
    );
    expect(stats.fellBack).toBe(true);
    expect(doc.frontmatter?.value).toBe('a: 1');
    expect(doc).toEqual(parse(next, FM));
  });

  it('stays deep-equal to a full parse across a sweep of body edits', () => {
    for (let i = withFm.indexOf('# H'); i < withFm.length; i++) {
      const next = withFm.slice(0, i) + 'z' + withFm.slice(i);
      const doc = parseIncremental(parse(withFm, FM), withFm, { from: i, to: i, insert: 'z' }, next, FM);
      expect(doc).toEqual(parse(next, FM));
    }
  });
});
