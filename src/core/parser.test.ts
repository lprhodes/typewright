import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type {
  Autolink,
  Blockquote,
  CodeBlock,
  Emphasis,
  Heading,
  HtmlBlock,
  Image,
  InlineCode,
  LineBreak,
  Link,
  List,
  Paragraph,
  Strikethrough,
  Strong,
  Table,
} from './ast';

/** First block, asserted to be a paragraph, returning its inline children. */
function para(src: string): Paragraph['children'] {
  const b = parse(src).children[0]!;
  expect(b.type).toBe('paragraph');
  return (b as Paragraph).children;
}

describe('parser — headings', () => {
  it('parses an ATX heading with exact offsets (the locked contract)', () => {
    const doc = parse('# Hi');
    const h = doc.children[0]! as Heading;
    expect(h.type).toBe('heading');
    expect(h.level).toBe(1);
    expect(h.from).toBe(0);
    expect(h.to).toBe(4);
    expect(h.contentFrom).toBe(2);
    expect(h.children[0]).toMatchObject({ type: 'text', value: 'Hi', from: 2, to: 4 });
  });

  it('supports levels 1..6', () => {
    expect((parse('###### deep').children[0] as Heading).level).toBe(6);
    expect((parse('### mid').children[0] as Heading).level).toBe(3);
  });

  it('degrades a lone # to an empty heading, never throws', () => {
    const h = parse('#').children[0]! as Heading;
    expect(h.type).toBe('heading');
    expect(h.level).toBe(1);
    expect(h.contentFrom).toBe(1);
    expect(h.children).toEqual([]);
  });
});

describe('parser — inline emphasis', () => {
  it('parses strong with offsets covering **b** (the locked contract)', () => {
    const kids = para('a **b** c');
    const strong = kids[1]! as Strong;
    expect(strong.type).toBe('strong');
    expect(strong.marker).toBe('**');
    expect(strong.from).toBe(2);
    expect(strong.to).toBe(7);
    expect(strong.children[0]).toMatchObject({ type: 'text', value: 'b' });
  });

  it('parses single-* emphasis and exposes its marker', () => {
    const em = para('*em*')[0]! as Emphasis;
    expect(em.type).toBe('emphasis');
    expect(em.marker).toBe('*');
    expect(em.from).toBe(0);
    expect(em.to).toBe(4);
  });

  it('parses __strong__ with an underscore marker', () => {
    const s = para('__x__')[0]! as Strong;
    expect(s.type).toBe('strong');
    expect(s.marker).toBe('__');
  });

  it('parses ~~strikethrough~~', () => {
    const s = para('~~gone~~')[0]! as Strikethrough;
    expect(s.type).toBe('strikethrough');
    expect(s.from).toBe(0);
    expect(s.to).toBe(8);
  });

  it('does not treat intraword _ as emphasis', () => {
    const kids = para('a_b_c');
    expect(kids.every((k) => k.type === 'text')).toBe(true);
  });
});

describe('parser — inline code / links / images / autolinks', () => {
  it('parses an inline code span and records the tick count', () => {
    const c = para('`code`')[0]! as InlineCode;
    expect(c.type).toBe('inlineCode');
    expect(c.ticks).toBe(1);
    expect(c.value).toBe('code');
    expect(c.from).toBe(0);
    expect(c.to).toBe(6);
  });

  it('parses a multi-tick code span containing a backtick', () => {
    const c = para('``a`b``')[0]! as InlineCode;
    expect(c.ticks).toBe(2);
    expect(c.value).toBe('a`b');
  });

  it('parses a link with url + title + inline children', () => {
    const l = para('[t](http://x.com "hi")')[0]! as Link;
    expect(l.type).toBe('link');
    expect(l.url).toBe('http://x.com');
    expect(l.title).toBe('hi');
    expect(l.children[0]).toMatchObject({ type: 'text', value: 't' });
    expect(l.from).toBe(0);
  });

  it('parses an image with alt + url', () => {
    const img = para('![alt text](img.png)')[0]! as Image;
    expect(img.type).toBe('image');
    expect(img.alt).toBe('alt text');
    expect(img.url).toBe('img.png');
  });

  it('parses an autolink and not as an HTML block', () => {
    const a = para('see <https://ex.com> ok')[1]! as Autolink;
    expect(a.type).toBe('autolink');
    expect(a.url).toBe('https://ex.com');
  });
});

describe('parser — line breaks', () => {
  it('treats two trailing spaces before a newline as a hard break', () => {
    const kids = para('a  \nb');
    const br = kids.find((k) => k.type === 'break') as LineBreak | undefined;
    expect(br?.hard).toBe(true);
  });

  it('treats a backslash before a newline as a hard break', () => {
    const kids = para('a\\\nb');
    const br = kids.find((k) => k.type === 'break') as LineBreak | undefined;
    expect(br?.hard).toBe(true);
  });

  it('emits a soft break across a wrapped paragraph line', () => {
    const kids = para('one\ntwo');
    const br = kids.find((k) => k.type === 'break') as LineBreak | undefined;
    expect(br).toBeDefined();
    expect(br?.hard).toBe(false);
  });
});

describe('parser — blockquotes', () => {
  it('parses a blockquote containing a paragraph', () => {
    const q = parse('> hi').children[0]! as Blockquote;
    expect(q.type).toBe('blockquote');
    expect(q.children[0]!.type).toBe('paragraph');
  });

  it('parses a nested blockquote', () => {
    const q = parse('> > deep').children[0]! as Blockquote;
    const inner = q.children[0]! as Blockquote;
    expect(inner.type).toBe('blockquote');
  });

  it('parses a list nested inside a blockquote (blockquote > list)', () => {
    const q = parse('> - a\n> - b').children[0]! as Blockquote;
    const list = q.children[0]! as List;
    expect(list.type).toBe('list');
    expect(list.items).toHaveLength(2);
  });
});

describe('parser — lists', () => {
  it('parses a tight bullet list and sets contentFrom past the marker', () => {
    const list = parse('- a\n- b').children[0]! as List;
    expect(list.type).toBe('list');
    expect(list.ordered).toBe(false);
    expect(list.tight).toBe(true);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]!.contentFrom).toBe(2);
  });

  it('parses task-list items with checked/unchecked state', () => {
    const list = parse('- [ ] todo\n- [x] done').children[0]! as List;
    expect(list.items[0]!.task).toBe('unchecked');
    expect(list.items[1]!.task).toBe('checked');
    // contentFrom sits past `- [ ] `
    expect(list.items[0]!.contentFrom).toBe(6);
  });

  it('parses an ordered list and records its start number', () => {
    const list = parse('3. a\n4. b').children[0]! as List;
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
  });

  it('nests a sublist inside an item (list > para + list)', () => {
    const list = parse('- outer\n  - inner').children[0]! as List;
    const item = list.items[0]!;
    expect(item.children.some((c) => c.type === 'list')).toBe(true);
  });

  it('marks a list loose when a blank line separates items', () => {
    const list = parse('- a\n\n- b').children[0]! as List;
    expect(list.tight).toBe(false);
    expect(list.items).toHaveLength(2);
  });
});

describe('parser — code blocks', () => {
  it('parses a fenced code block with an info string', () => {
    const cb = parse('```js\nconst x = 1\n```').children[0]! as CodeBlock;
    expect(cb.type).toBe('codeBlock');
    expect(cb.fenced).toBe(true);
    expect(cb.lang).toBe('js');
    expect(cb.value).toBe('const x = 1');
  });

  it('parses an indented code block (fenced:false)', () => {
    const cb = parse('    indented').children[0]! as CodeBlock;
    expect(cb.type).toBe('codeBlock');
    expect(cb.fenced).toBe(false);
    expect(cb.value).toBe('indented');
  });

  it('does not throw on an unterminated fence (runs to end)', () => {
    const cb = parse('```\nnever closed').children[0]! as CodeBlock;
    expect(cb.type).toBe('codeBlock');
    expect(cb.value).toBe('never closed');
  });
});

describe('parser — thematic breaks', () => {
  it('parses --- and *** as thematic breaks', () => {
    expect(parse('---').children[0]!.type).toBe('thematicBreak');
    expect(parse('***').children[0]!.type).toBe('thematicBreak');
  });
});

describe('parser — tables', () => {
  it('parses a GFM table with alignment, header and body rows', () => {
    const t = parse('| a | b |\n| --- | :-: |\n| 1 | 2 |').children[0]! as Table;
    expect(t.type).toBe('table');
    expect(t.align).toEqual([null, 'center']);
    expect(t.header).toHaveLength(2);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toHaveLength(2);
    expect(t.header[0]!.children[0]).toMatchObject({ type: 'text', value: 'a' });
  });
});

describe('parser — html / mdx flow', () => {
  it('parses a raw HTML block (variant html)', () => {
    const h = parse('<div>\nhi\n</div>').children[0]! as HtmlBlock;
    expect(h.type).toBe('htmlBlock');
    expect(h.variant).toBe('html');
    expect(h.value).toContain('<div>');
  });

  it('parses a leading-<Tag as mdxFlow, verbatim (not evaluated)', () => {
    const h = parse('<Chart x={1} />').children[0]! as HtmlBlock;
    expect(h.type).toBe('htmlBlock');
    expect(h.variant).toBe('mdxFlow');
    expect(h.value).toBe('<Chart x={1} />');
  });

  it('parses an import/export line as mdxFlow', () => {
    const h = parse("import X from 'y'").children[0]! as HtmlBlock;
    expect(h.variant).toBe('mdxFlow');
  });
});

describe('parser — resilience & document shape', () => {
  it('degrades an unclosed ** to plain text', () => {
    const kids = para('a **b');
    expect(kids.every((k) => k.type === 'text')).toBe(true);
  });

  it('degrades an unterminated link to text', () => {
    const kids = para('[oops](');
    expect(kids.some((k) => k.type === 'link')).toBe(false);
  });

  it('handles the empty string', () => {
    const doc = parse('');
    expect(doc.type).toBe('document');
    expect(doc.children).toEqual([]);
    expect(doc.to).toBe(0);
  });

  it('sets the document range to the full source length', () => {
    const src = '# Title\n\nbody text\n';
    const doc = parse(src);
    expect(doc.from).toBe(0);
    expect(doc.to).toBe(src.length);
  });

  it('separates a heading and a following paragraph into two blocks', () => {
    const doc = parse('# Title\n\nbody');
    expect(doc.children).toHaveLength(2);
    expect(doc.children[0]!.type).toBe('heading');
    expect(doc.children[1]!.type).toBe('paragraph');
  });

  it('never throws on assorted malformed input', () => {
    for (const s of ['![](', '`unclosed', '> ', '- ', '~~', '<', '|a|', '\n\n\n', '\\']) {
      expect(() => parse(s)).not.toThrow();
    }
  });
});
