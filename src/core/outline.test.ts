import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { renderNode, renderToHtml } from './render';
import { slugify, createSlugger, outline, collectHeadings, buildHeadingIds } from './outline';

/** Every `id="…"` in render order. */
function renderedIds(html: string): string[] {
  return [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1]!);
}

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('The Basics')).toBe('the-basics');
  });

  it('drops punctuation and collapses whitespace runs', () => {
    expect(slugify('What are dividends, really?')).toBe('what-are-dividends-really');
    expect(slugify('a   b')).toBe('a-b');
  });

  it('trims leading/trailing hyphens and collapses runs', () => {
    expect(slugify('  -- hello -- world --  ')).toBe('hello-world');
  });

  it('keeps letters and digits of any script', () => {
    expect(slugify('Überschrift 2')).toBe('überschrift-2');
    expect(slugify('配当とは')).toBe('配当とは');
  });

  it('falls back to `section` when nothing survives', () => {
    expect(slugify('!!!')).toBe('section');
    expect(slugify('')).toBe('section');
  });
});

describe('createSlugger', () => {
  it('suffixes repeats', () => {
    const s = createSlugger();
    expect([s('Overview'), s('Overview'), s('Overview')]).toEqual([
      'overview',
      'overview-2',
      'overview-3',
    ]);
  });

  it('never collides an auto-suffix with a literal heading of the same slug', () => {
    const s = createSlugger();
    // `Overview 2` naturally slugs to `overview-2`, which the second `Overview`
    // would otherwise have claimed.
    expect([s('Overview'), s('Overview 2'), s('Overview')]).toEqual([
      'overview',
      'overview-2',
      'overview-3',
    ]);
  });

  it('scopes state per instance', () => {
    expect(createSlugger()('X')).toBe('x');
    expect(createSlugger()('X')).toBe('x');
  });
});

describe('outline', () => {
  it('reports level, text and offsets', () => {
    const src = '# One\n\n## Two\n\n### Three\n';
    const entries = outline(parse(src));
    expect(entries).toEqual([
      { level: 1, id: 'one', text: 'One', from: 0, to: 5 },
      { level: 2, id: 'two', text: 'Two', from: 7, to: 13 },
      { level: 3, id: 'three', text: 'Three', from: 15, to: 24 },
    ]);
    expect(src.slice(entries[1]!.from, entries[1]!.to)).toBe('## Two');
  });

  it('flattens inline markup out of the text and the slug', () => {
    const [entry] = outline(parse('## The **bold** and `code` bit\n'));
    expect(entry!.text).toBe('The bold and code bit');
    expect(entry!.id).toBe('the-bold-and-code-bit');
  });

  it('uses a link’s text, not its URL', () => {
    const [entry] = outline(parse('## See [the docs](https://example.com)\n'));
    expect(entry!.text).toBe('See the docs');
  });

  it('finds headings nested in blockquotes', () => {
    expect(outline(parse('> ## Quoted\n')).map((e) => e.id)).toEqual(['quoted']);
  });

  it('skips headings inside footnote definitions (hoisted out of flow)', () => {
    const doc = parse('# Real\n\n[^a]: ## Buried\n', { footnotes: true });
    expect(outline(doc).map((e) => e.text)).toEqual(['Real']);
  });

  it('is empty for a document with no headings', () => {
    expect(outline(parse('just a paragraph\n'))).toEqual([]);
  });
});

describe('heading ids ⇄ outline parity', () => {
  it('renderToHtml emits no id by default', () => {
    expect(renderToHtml(parse('## Two\n'))).toBe('<h2>Two</h2>');
  });

  it('renderToHtml emits the id outline() reports, for duplicates and unicode', () => {
    const src = [
      '# Overview',
      '## Overview',
      '## Overview 2',
      '## Overview',
      '## Überschrift!',
      '> ## Quoted',
    ].join('\n\n');
    const doc = parse(src);
    const html = renderToHtml(doc, { headingIds: true });
    const ids = outline(doc).map((e) => e.id);

    // The property that makes a TOC safe: every anchor the rail links exists.
    expect(renderedIds(html)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);

    // The 2nd `Overview` claims `overview-2` first, so the literal `Overview 2`
    // — which slugs to the same thing — must step aside. Ugly, but unique and
    // deterministic; uniqueness is the invariant, not prettiness.
    expect(ids).toEqual([
      'overview',
      'overview-2',
      'overview-2-2',
      'overview-3',
      'überschrift',
      'quoted',
    ]);
  });

  it('escapes the id attribute', () => {
    // `"` is stripped by slugify, but the escape must survive any future charset.
    const html = renderToHtml(parse('## a"b\n'), { headingIds: true });
    expect(html).toBe('<h2 id="ab">a&quot;b</h2>');
    expect(html).not.toContain('id="a"b"');
  });

  it('buildHeadingIds keys by node identity, so same-titled headings differ', () => {
    const doc = parse('## Same\n\n## Same\n');
    const headings = collectHeadings(doc);
    const ids = buildHeadingIds(doc);
    expect(ids.get(headings[0]!)).toBe('same');
    expect(ids.get(headings[1]!)).toBe('same-2');
  });

  it('renderNode cannot allocate a document id, so emits none', () => {
    // Guards the documented divergence rather than letting it rot silently.
    const heading = parse('## Two\n').children[0]!;
    expect(renderNode(heading, { headingIds: true })).toBe('<h2>Two</h2>');
  });
});
