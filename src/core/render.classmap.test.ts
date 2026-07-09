import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import { renderToHtml } from './render';

const render = (src: string, options?: Parameters<typeof renderToHtml>[1]): string =>
  renderToHtml(parse(src, { footnotes: true, math: true, defLists: true }), options);

describe('classMap — default output is unchanged', () => {
  const fixtures = [
    '# H\n',
    'a **b** *c* ~~d~~ `e`\n',
    '> quote\n',
    '- a\n- b\n',
    '1. a\n',
    '- [x] done\n',
    '```ts\nx\n```\n',
    '```\nx\n```\n',
    '---\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n',
    '[link](https://a.b)\n',
    '![alt](https://a.b/i.png)\n',
    'x[^a]\n\n[^a]: note\n',
    '$$ x $$\n',
    'term\n: def\n',
  ];

  it('emits byte-identical HTML with no options and with an empty classMap', () => {
    for (const src of fixtures) {
      const bare = render(src);
      expect(render(src, {})).toBe(bare);
      expect(render(src, { classMap: {} })).toBe(bare);
    }
  });

  it('an empty or whitespace-only class name emits no attribute', () => {
    expect(render('p\n', { classMap: { paragraph: '' } })).toBe('<p>p</p>');
    expect(render('p\n', { classMap: { paragraph: '   ' } })).toBe('<p>p</p>');
  });
});

describe('classMap — mapping', () => {
  it('classes block elements', () => {
    expect(render('p\n', { classMap: { paragraph: 'lead' } })).toBe('<p class="lead">p</p>');
    expect(render('> q\n', { classMap: { blockquote: 'callout' } })).toBe(
      '<blockquote class="callout"><p>q</p></blockquote>',
    );
    expect(render('---\n', { classMap: { thematicBreak: 'rule' } })).toBe('<hr class="rule">');
  });

  it('classes a table and its parts', () => {
    const html = render('| a |\n| - |\n| 1 |\n', {
      classMap: {
        table: 'spec-table',
        tableHead: 'th-head',
        tableBody: 'th-body',
        tableRow: 'tr',
        tableHeaderCell: 'hc',
        tableCell: 'c',
      },
    });
    expect(html).toBe(
      '<table class="spec-table">' +
        '<thead class="th-head"><tr class="tr"><th class="hc">a</th></tr></thead>' +
        '<tbody class="th-body"><tr class="tr"><td class="c">1</td></tr></tbody>' +
        '</table>',
    );
  });

  it('adds h-level classes to the shared heading class', () => {
    expect(render('## T\n', { classMap: { heading: 'hd', h2: 'hd--section' } })).toBe(
      '<h2 class="hd hd--section">T</h2>',
    );
    expect(render('# T\n', { classMap: { heading: 'hd' } })).toBe('<h1 class="hd">T</h1>');
    expect(render('### T\n', { classMap: { h2: 'only-h2' } })).toBe('<h3>T</h3>');
  });

  it('composes heading ids with heading classes', () => {
    expect(render('## T\n', { headingIds: true, classMap: { heading: 'hd' } })).toBe(
      '<h2 id="t" class="hd">T</h2>',
    );
  });

  it('adds ordered/unordered classes on top of the shared list class', () => {
    expect(render('- a\n', { classMap: { list: 'l', unorderedList: 'l--ul' } })).toBe(
      '<ul class="l l--ul"><li><p>a</p></li></ul>',
    );
    expect(render('1. a\n', { classMap: { list: 'l', orderedList: 'l--ol' } })).toBe(
      '<ol class="l l--ol"><li><p>a</p></li></ol>',
    );
  });

  it('adds a task class only to items that carry a checkbox', () => {
    const html = render('- [x] a\n- b\n', { classMap: { listItem: 'i', taskListItem: 'i--task' } });
    expect(html).toContain('<li class="i i--task"><input type="checkbox" disabled checked>');
    expect(html).toContain('<li class="i"><p>b</p></li>');
  });

  it('appends the code class AFTER the language class', () => {
    expect(render('```ts\nx\n```\n', { classMap: { codeBlock: 'pre', code: 'tok' } })).toBe(
      '<pre class="pre"><code class="language-ts tok">x</code></pre>',
    );
    // No language: the mapped class stands alone.
    expect(render('```\nx\n```\n', { classMap: { code: 'tok' } })).toBe(
      '<pre><code class="tok">x</code></pre>',
    );
  });

  it('appends to the renderer’s own tw-* classes rather than replacing them', () => {
    const fn = render('x[^a]\n\n[^a]: n\n', {
      classMap: { footnoteRef: 'ref', footnotes: 'notes', footnoteBackref: 'back' },
    });
    expect(fn).toContain('<sup class="tw-fnref ref"');
    expect(fn).toContain('<section class="tw-footnotes notes">');
    expect(fn).toContain('class="tw-fn-back back"');

    expect(render('$$\nx\n$$\n', { classMap: { mathBlock: 'mb' } })).toContain(
      '<div class="tw-math-src mb">',
    );
  });

  it('classes inline elements, including autolinks via `link`', () => {
    expect(render('**b**\n', { classMap: { strong: 's' } })).toBe('<p><strong class="s">b</strong></p>');
    expect(render('[a](https://x.y)\n', { classMap: { link: 'lk' } })).toBe(
      '<p><a href="https://x.y" class="lk">a</a></p>',
    );
    expect(render('<https://x.y>\n', { classMap: { link: 'lk' } })).toContain('class="lk"');
  });
});

describe('classMap — escaping', () => {
  it('escapes a class value, so a hostile map cannot break out of the attribute', () => {
    const html = render('p\n', { classMap: { paragraph: '"><script>alert(1)</script>' } });
    expect(html).not.toContain('<script>');
    expect(html).toBe('<p class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">p</p>');
  });

  it('escapes a language-derived code class', () => {
    expect(render('```a"b\nx\n```\n', {})).toContain('class="language-a&quot;b"');
  });
});
