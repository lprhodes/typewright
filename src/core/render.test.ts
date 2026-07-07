import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { renderToHtml, renderNode, renderInline, safeUrl } from './render';
import type { Block, Document, Inline, ListItem } from './ast';

/* ------------------------------------------------------------------ *
 * Direct-AST fixtures — exact output we fully control (no parser dep).
 * ------------------------------------------------------------------ */

const text = (value: string): Inline => ({ type: 'text', from: 0, to: 0, value });

describe('renderInline', () => {
  it('escapes text (& < > ")', () => {
    expect(renderInline([text('a & b < c > d "e"')])).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    );
  });

  it('renders strong / emphasis / strikethrough', () => {
    expect(renderInline([{ type: 'strong', marker: '**', from: 0, to: 0, children: [text('b')] }])).toBe(
      '<strong>b</strong>',
    );
    expect(renderInline([{ type: 'emphasis', marker: '*', from: 0, to: 0, children: [text('i')] }])).toBe(
      '<em>i</em>',
    );
    expect(renderInline([{ type: 'strikethrough', from: 0, to: 0, children: [text('s')] }])).toBe(
      '<del>s</del>',
    );
  });

  it('renders inline code, escaping its content', () => {
    expect(renderInline([{ type: 'inlineCode', from: 0, to: 0, ticks: 1, value: 'a < b' }])).toBe(
      '<code>a &lt; b</code>',
    );
  });

  it('renders a link with a safe href and a title', () => {
    expect(
      renderInline([
        { type: 'link', from: 0, to: 0, url: 'https://x.io/a?b=1&c=2', title: 'T"', children: [text('go')] },
      ]),
    ).toBe('<a href="https://x.io/a?b=1&amp;c=2" title="T&quot;">go</a>');
  });

  it('renders an image with safe src and escaped alt', () => {
    expect(
      renderInline([{ type: 'image', from: 0, to: 0, url: '/p.png', alt: 'a "b" <c>' }]),
    ).toBe('<img src="/p.png" alt="a &quot;b&quot; &lt;c&gt;">');
  });

  it('renders an autolink', () => {
    expect(renderInline([{ type: 'autolink', from: 0, to: 0, url: 'https://a.com' }])).toBe(
      '<a href="https://a.com">https://a.com</a>',
    );
  });

  it('renders hard vs soft breaks', () => {
    expect(renderInline([{ type: 'break', from: 0, to: 0, hard: true }])).toBe('<br>\n');
    expect(renderInline([{ type: 'break', from: 0, to: 0, hard: false }])).toBe('\n');
  });
});

describe('renderNode', () => {
  it('renders heading levels h1..h6', () => {
    for (let l = 1; l <= 6; l++) {
      const node: Block = {
        type: 'heading',
        level: l as 1 | 2 | 3 | 4 | 5 | 6,
        from: 0,
        to: 0,
        contentFrom: 0,
        children: [text('H')],
      };
      expect(renderNode(node)).toBe(`<h${l}>H</h${l}>`);
    }
  });

  it('renders a paragraph', () => {
    expect(renderNode({ type: 'paragraph', from: 0, to: 0, children: [text('hi')] })).toBe('<p>hi</p>');
  });

  it('renders a blockquote wrapping blocks', () => {
    expect(
      renderNode({
        type: 'blockquote',
        from: 0,
        to: 0,
        children: [{ type: 'paragraph', from: 0, to: 0, children: [text('q')] }],
      }),
    ).toBe('<blockquote><p>q</p></blockquote>');
  });

  it('renders an ordered list with a start attribute only when != 1', () => {
    const item = (n: string): ListItem => ({
      type: 'listItem',
      task: null,
      from: 0,
      to: 0,
      contentFrom: 0,
      children: [{ type: 'paragraph', from: 0, to: 0, children: [text(n)] }],
    });
    expect(
      renderNode({ type: 'list', from: 0, to: 0, ordered: true, start: 3, tight: true, items: [item('a')] }),
    ).toBe('<ol start="3"><li>a</li></ol>');
    expect(
      renderNode({ type: 'list', from: 0, to: 0, ordered: true, start: 1, tight: true, items: [item('a')] }),
    ).toBe('<ol><li>a</li></ol>');
    expect(
      renderNode({ type: 'list', from: 0, to: 0, ordered: false, start: 1, tight: true, items: [item('a')] }),
    ).toBe('<ul><li>a</li></ul>');
  });

  it('renders a task list item with a disabled checkbox', () => {
    const checkedItem = {
      type: 'listItem' as const,
      task: 'checked' as const,
      from: 0,
      to: 0,
      contentFrom: 0,
      children: [{ type: 'paragraph' as const, from: 0, to: 0, children: [text('done')] }],
    };
    const uncheckedItem = { ...checkedItem, task: 'unchecked' as const, children: [{ type: 'paragraph' as const, from: 0, to: 0, children: [text('todo')] }] };
    const html = renderNode({
      type: 'list',
      from: 0,
      to: 0,
      ordered: false,
      start: 1,
      tight: true,
      items: [checkedItem, uncheckedItem],
    });
    expect(html).toContain('<input type="checkbox" disabled checked> done');
    expect(html).toContain('<input type="checkbox" disabled> todo');
  });

  it('renders a fenced code block with a language class and escaped body', () => {
    expect(
      renderNode({ type: 'codeBlock', from: 0, to: 0, lang: 'ts', fenced: true, value: 'const a = 1 < 2;' }),
    ).toBe('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
  });

  it('renders a code block without a class when no language', () => {
    expect(
      renderNode({ type: 'codeBlock', from: 0, to: 0, lang: '', fenced: true, value: 'x' }),
    ).toBe('<pre><code>x</code></pre>');
  });

  it('renders a thematic break', () => {
    expect(renderNode({ type: 'thematicBreak', from: 0, to: 0 })).toBe('<hr>');
  });

  it('renders a table with per-column alignment', () => {
    const cell = (v: string) => ({ type: 'tableCell' as const, from: 0, to: 0, children: [text(v)] });
    const html = renderNode({
      type: 'table',
      from: 0,
      to: 0,
      align: ['left', 'center', 'right', null],
      header: [cell('A'), cell('B'), cell('C'), cell('D')],
      rows: [[cell('1'), cell('2'), cell('3'), cell('4')]],
    });
    expect(html).toContain('<thead><tr>');
    expect(html).toContain('<th style="text-align:left">A</th>');
    expect(html).toContain('<th style="text-align:center">B</th>');
    expect(html).toContain('<th style="text-align:right">C</th>');
    expect(html).toContain('<th>D</th>'); // null alignment → no style
    expect(html).toContain('<tbody><tr><td style="text-align:left">1</td>');
  });

  it('emits an HTML block ESCAPED inside <pre> (safety boundary)', () => {
    const html = renderNode({
      type: 'htmlBlock',
      from: 0,
      to: 0,
      variant: 'html',
      value: '<script>alert(1)</script>',
    });
    expect(html).toBe('<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>');
    expect(html).not.toContain('<script>');
  });

  it('emits an MDX flow block ESCAPED too (never raw JSX)', () => {
    const html = renderNode({
      type: 'htmlBlock',
      from: 0,
      to: 0,
      variant: 'mdxFlow',
      value: '<Chart onClick={()=>evil()} />',
    });
    expect(html).toContain('&lt;Chart');
    expect(html).not.toContain('<Chart');
  });
});

/* ------------------------------------------------------------------ *
 * safeUrl
 * ------------------------------------------------------------------ */

describe('safeUrl', () => {
  it('keeps http/https/mailto and relative/anchor URLs', () => {
    expect(safeUrl('https://a.com/x')).toBe('https://a.com/x');
    expect(safeUrl('http://a.com')).toBe('http://a.com');
    expect(safeUrl('HTTP://A.com')).toBe('HTTP://A.com');
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('/relative/path')).toBe('/relative/path');
    expect(safeUrl('./rel')).toBe('./rel');
    expect(safeUrl('#anchor')).toBe('#anchor');
    expect(safeUrl('page.html?q=1')).toBe('page.html?q=1');
    expect(safeUrl('//protocol-relative.com')).toBe('//protocol-relative.com');
  });

  it('rejects javascript / data / vbscript / file schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('JavaScript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('vbscript:msgbox')).toBe('#');
    expect(safeUrl('file:///etc/passwd')).toBe('#');
  });

  it('sees through whitespace / control-char obfuscation of a scheme', () => {
    expect(safeUrl('  javascript:alert(1)')).toBe('#');
    expect(safeUrl('java\tscript:alert(1)')).toBe('#');
    expect(safeUrl('java\nscript:alert(1)')).toBe('#');
    expect(safeUrl('\fjavascript:alert(1)')).toBe('#');
  });

  it('handles empty / non-string input defensively', () => {
    expect(safeUrl('')).toBe('#');
    expect(safeUrl('   ')).toBe('#');
    // @ts-expect-error runtime guard for non-string input
    expect(safeUrl(null)).toBe('#');
  });
});

/* ------------------------------------------------------------------ *
 * XSS — the guarantees that MUST hold end to end.
 * ------------------------------------------------------------------ */

describe('XSS sanitization', () => {
  it('neutralises a javascript: link (direct node)', () => {
    const html = renderInline([
      { type: 'link', from: 0, to: 0, url: 'javascript:alert(1)', children: [text('x')] },
    ]);
    expect(html).not.toContain('javascript:');
    expect(html).toBe('<a href="#">x</a>');
  });

  it('neutralises a javascript: image (direct node)', () => {
    const html = renderInline([{ type: 'image', from: 0, to: 0, url: 'javascript:alert(1)', alt: 'x' }]);
    expect(html).not.toContain('javascript:');
    expect(html).toBe('<img src="#" alt="x">');
  });

  it('escapes a raw <script> in text', () => {
    const html = renderInline([text('<script>alert(1)</script>')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/* ------------------------------------------------------------------ *
 * Parser-driven integration — the same guarantees through parse().
 * ------------------------------------------------------------------ */

describe('renderToHtml (via parse)', () => {
  it('renders a heading', () => {
    expect(renderToHtml(parse('# Hello'))).toContain('<h1>');
  });

  it('renders a task-list checkbox', () => {
    const html = renderToHtml(parse('- [x] done\n'));
    expect(html).toContain('<input type="checkbox" disabled');
    expect(html).toContain('checked');
  });

  it('renders a fenced code block with a language class', () => {
    const html = renderToHtml(parse('```js\nconst a = 1;\n```\n'));
    expect(html).toContain('<code class="language-js">');
  });

  it('renders a table with alignment styles', () => {
    const md = '| a | b |\n|:--|--:|\n| 1 | 2 |\n';
    const html = renderToHtml(parse(md));
    expect(html).toContain('<table>');
    expect(html).toContain('text-align:left');
    expect(html).toContain('text-align:right');
  });

  it('MUST NOT emit javascript: for [x](javascript:alert(1))', () => {
    const html = renderToHtml(parse('[x](javascript:alert(1))'));
    expect(html).not.toContain('javascript:');
  });

  it('MUST NOT emit javascript: for ![x](javascript:alert(1))', () => {
    const html = renderToHtml(parse('![x](javascript:alert(1))'));
    expect(html).not.toContain('javascript:');
  });

  it('MUST escape a raw <script> to &lt;script&gt;', () => {
    const html = renderToHtml(parse('<script>alert(1)</script>'));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never throws on malformed / partial input', () => {
    for (const bad of ['', '#', '[', '![', '```', '| a', '- [', '<div', '*unclosed', '> ']) {
      expect(() => renderToHtml(parse(bad))).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ *
 * RenderOptions.highlight — the syntax-colouring hook (Wave 2b).
 * ------------------------------------------------------------------ */

/** A realistic highlighter stub: escapes first, then wraps in a token span. */
const escapeLike = (code: string): string =>
  code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('RenderOptions.highlight', () => {
  it('invokes the hook and trusts its (already-escaped) output — no double-escape', () => {
    let called = false;
    const highlight = (lang: string, code: string): string => {
      called = true;
      expect(lang).toBe('ts');
      return `<span class="tw-tok-str">${escapeLike(code)}</span>`;
    };
    const node: Block = { type: 'codeBlock', from: 0, to: 0, lang: 'ts', fenced: true, value: 'x < y' };
    const html = renderNode(node, { highlight });
    expect(called).toBe(true);
    expect(html).toBe(
      '<pre><code class="language-ts"><span class="tw-tok-str">x &lt; y</span></code></pre>',
    );
    // the `<` inside the code is escaped, not double-escaped (&amp;lt;)
    expect(html).not.toContain('&amp;lt;');
  });

  it('keeps a <script> in code ESCAPED even with a span-returning highlight fn', () => {
    const highlight = (_lang: string, code: string): string =>
      `<span class="tw-tok">${escapeLike(code)}</span>`;
    const html = renderToHtml(parse('```js\n<script>alert(1)</script>\n```\n'), { highlight });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<span class="tw-tok">');
  });

  it('falls back to plain escaped code with no hook (unchanged default)', () => {
    const node: Block = { type: 'codeBlock', from: 0, to: 0, lang: 'ts', fenced: true, value: 'a < b' };
    expect(renderNode(node)).toBe('<pre><code class="language-ts">a &lt; b</code></pre>');
  });
});

/* ------------------------------------------------------------------ *
 * Math — engine hook + safe escaped-source fallback (Wave 2b).
 * ------------------------------------------------------------------ */

describe('RenderOptions.math + math-src fallback', () => {
  it('renders inline math through the host engine when supplied', () => {
    const math = (src: string, display: boolean): string =>
      `<span class="katex" data-display="${display}">${src}</span>`;
    const node: Inline = { type: 'math', from: 0, to: 0, value: 'e=mc^2', display: false };
    expect(renderInline([node], { math })).toBe(
      '<span class="katex" data-display="false">e=mc^2</span>',
    );
  });

  it('math-src fallback ESCAPES the source (e.g. "$<script>")', () => {
    const node: Inline = { type: 'math', from: 0, to: 0, value: '<script>', display: false };
    const html = renderInline([node]);
    expect(html).toBe('<span class="tw-math-src">&lt;script&gt;</span>');
    expect(html).not.toContain('<script>');
  });

  it('renders a math block as an escaped <div> source without an engine', () => {
    const node: Block = { type: 'mathBlock', from: 0, to: 0, value: 'a < b' };
    expect(renderNode(node)).toBe('<div class="tw-math-src">a &lt; b</div>');
  });

  it('passes display=true for a math block into the engine', () => {
    let seen: boolean | null = null;
    const math = (_src: string, display: boolean): string => {
      seen = display;
      return '<div></div>';
    };
    renderNode({ type: 'mathBlock', from: 0, to: 0, value: 'x' }, { math });
    expect(seen).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Footnotes — GitHub-style refs + collected trailing section (Wave 2b).
 * ------------------------------------------------------------------ */

const footDoc = (): Document => ({
  type: 'document',
  from: 0,
  to: 0,
  children: [
    {
      type: 'paragraph',
      from: 0,
      to: 0,
      children: [
        text('See '),
        { type: 'footnoteRef', from: 0, to: 0, id: '1' },
        text(' and '),
        { type: 'footnoteRef', from: 0, to: 0, id: 'note' },
      ],
    },
    {
      type: 'footnoteDef',
      from: 0,
      to: 0,
      id: '1',
      children: [{ type: 'paragraph', from: 0, to: 0, children: [text('first')] }],
    },
    {
      type: 'footnoteDef',
      from: 0,
      to: 0,
      id: 'note',
      children: [{ type: 'paragraph', from: 0, to: 0, children: [text('second')] }],
    },
  ],
});

describe('footnotes (GitHub-style)', () => {
  it('renders refs as superscripts with first-seen numbers + linking ids', () => {
    const html = renderToHtml(footDoc());
    expect(html).toContain('<sup class="tw-fnref" id="fnref-1"><a href="#fn-1">[1]</a></sup>');
    expect(html).toContain(
      '<sup class="tw-fnref" id="fnref-note"><a href="#fn-note">[2]</a></sup>',
    );
  });

  it('collects defs into ONE trailing <section>, never inline where authored', () => {
    const html = renderToHtml(footDoc());
    expect(html).not.toContain('tw-footnote-def'); // no inline def wrapper in flow
    expect(html).toContain('<section class="tw-footnotes"><ol>');
    expect(html).toContain(
      '<li id="fn-1"><p>first</p> <a href="#fnref-1" class="tw-fn-back">↩</a></li>',
    );
    expect(html).toContain(
      '<li id="fn-note"><p>second</p> <a href="#fnref-note" class="tw-fn-back">↩</a></li>',
    );
    // the section is appended after the body paragraph
    expect(html.indexOf('<section')).toBeGreaterThan(html.indexOf('<p>See'));
  });

  it('back-link ids round-trip: fnref-ID ↔ href="#fnref-ID", fn-ID ↔ href="#fn-ID"', () => {
    const html = renderToHtml(footDoc());
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('href="#fnref-1"');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('href="#fn-1"');
  });

  it('slugs + escapes a hostile footnote id so it cannot break out of the attribute', () => {
    const id = '"><script>x';
    const doc: Document = {
      type: 'document',
      from: 0,
      to: 0,
      children: [
        {
          type: 'paragraph',
          from: 0,
          to: 0,
          children: [{ type: 'footnoteRef', from: 0, to: 0, id }],
        },
        {
          type: 'footnoteDef',
          from: 0,
          to: 0,
          id,
          children: [{ type: 'paragraph', from: 0, to: 0, children: [text('body')] }],
        },
      ],
    };
    const html = renderToHtml(doc);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><script');
    // ref and def share the same slugged id, so the back-links still line up
    const slug = '-script-x';
    expect(html).toContain(`id="fnref-${slug}"`);
    expect(html).toContain(`id="fn-${slug}"`);
    expect(html).toContain(`href="#fn-${slug}"`);
    expect(html).toContain(`href="#fnref-${slug}"`);
  });

  it('a standalone renderNode(footnoteDef) still renders its body (completeness)', () => {
    const html = renderNode({
      type: 'footnoteDef',
      from: 0,
      to: 0,
      id: '1',
      children: [{ type: 'paragraph', from: 0, to: 0, children: [text('x')] }],
    });
    expect(html).toBe('<div class="tw-footnote-def"><p>x</p></div>');
  });
});

/* ------------------------------------------------------------------ *
 * Definition lists — <dl>/<dt>/<dd> (Wave 2b).
 * ------------------------------------------------------------------ */

describe('definition lists', () => {
  it('renders a <dl> with a <dt> term and one <dd> per definition', () => {
    const node: Block = {
      type: 'defList',
      from: 0,
      to: 0,
      items: [
        {
          type: 'defItem',
          from: 0,
          to: 0,
          term: [text('Term')],
          definitions: [
            [{ type: 'paragraph', from: 0, to: 0, children: [text('Def one')] }],
            [{ type: 'paragraph', from: 0, to: 0, children: [text('Def two')] }],
          ],
        },
      ],
    };
    expect(renderNode(node)).toBe(
      '<dl><dt>Term</dt><dd><p>Def one</p></dd><dd><p>Def two</p></dd></dl>',
    );
  });

  it('escapes term + definition content', () => {
    const node: Block = {
      type: 'defList',
      from: 0,
      to: 0,
      items: [
        {
          type: 'defItem',
          from: 0,
          to: 0,
          term: [text('<b>')],
          definitions: [[{ type: 'paragraph', from: 0, to: 0, children: [text('<i>')] }]],
        },
      ],
    };
    const html = renderNode(node);
    expect(html).toContain('<dt>&lt;b&gt;</dt>');
    expect(html).toContain('<dd><p>&lt;i&gt;</p></dd>');
    expect(html).not.toContain('<b>');
  });
});
