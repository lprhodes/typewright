import { describe, it, expect } from 'vitest';
import { highlightToHtml } from './highlight';

/** Assert an escaped token span with the given kind + content is present. */
function hasTok(html: string, kind: string, content: string): boolean {
  return html.includes(`<span class="tw-tok-${kind}">${content}</span>`);
}

describe('highlightToHtml — per-language tokens', () => {
  it('javascript: keyword / number / comment', () => {
    const html = highlightToHtml('js', 'const x = 1; // hi');
    expect(hasTok(html, 'keyword', 'const')).toBe(true);
    expect(hasTok(html, 'number', '1')).toBe(true);
    expect(hasTok(html, 'comment', '// hi')).toBe(true);
  });

  it('typescript: keyword / type', () => {
    const html = highlightToHtml('ts', 'let n: number = 1');
    expect(hasTok(html, 'keyword', 'let')).toBe(true);
    expect(hasTok(html, 'type', 'number')).toBe(true);
  });

  it('json: prop key / string value / number / keyword', () => {
    const html = highlightToHtml('json', '{ "id": 1, "name": "bob", "ok": true }');
    expect(hasTok(html, 'prop', '&quot;id&quot;')).toBe(true);
    expect(hasTok(html, 'string', '&quot;bob&quot;')).toBe(true);
    expect(hasTok(html, 'number', '1')).toBe(true);
    expect(hasTok(html, 'keyword', 'true')).toBe(true);
  });

  it('css: property name', () => {
    const html = highlightToHtml('css', '.a { color: red; }');
    expect(hasTok(html, 'prop', 'color')).toBe(true);
  });

  it('python: keyword / fn / comment', () => {
    const html = highlightToHtml('py', 'def greet(): # hi');
    expect(hasTok(html, 'keyword', 'def')).toBe(true);
    expect(hasTok(html, 'fn', 'greet')).toBe(true);
    expect(hasTok(html, 'comment', '# hi')).toBe(true);
  });

  it('bash: keyword / string / comment', () => {
    const html = highlightToHtml('sh', 'echo "hi" # comment');
    expect(hasTok(html, 'keyword', 'echo')).toBe(true);
    expect(hasTok(html, 'string', '&quot;hi&quot;')).toBe(true);
    expect(hasTok(html, 'comment', '# comment')).toBe(true);
  });

  it('sql: keyword (case-insensitive) / comment', () => {
    const html = highlightToHtml('sql', 'SELECT id FROM users -- c');
    expect(hasTok(html, 'keyword', 'SELECT')).toBe(true);
    expect(hasTok(html, 'keyword', 'FROM')).toBe(true);
    expect(hasTok(html, 'comment', '-- c')).toBe(true);
  });
});

describe('highlightToHtml — fallback + resolution', () => {
  it('unknown language returns escaped, unspanned source', () => {
    const html = highlightToHtml('rust', 'fn main() { let x = 1; }');
    expect(html).not.toContain('<span');
    expect(html).toBe('fn main() { let x = 1; }');
  });

  it('empty language returns escaped, unspanned source', () => {
    const html = highlightToHtml('', 'x < y & z');
    expect(html).not.toContain('<span');
    expect(html).toBe('x &lt; y &amp; z');
  });

  it('yaml is treated as plain (unsupported)', () => {
    const html = highlightToHtml('yaml', 'a: 1');
    expect(html).not.toContain('<span');
    expect(html).toBe('a: 1');
  });

  it('resolves language from the whole fence info string', () => {
    const html = highlightToHtml('js {1,3}', 'const x=1');
    expect(hasTok(html, 'keyword', 'const')).toBe(true);
  });
});

describe('highlightToHtml — security (escaping)', () => {
  it('escapes an embedded </script> and <img> payload inside a string', () => {
    const html = highlightToHtml(
      'js',
      '"</script><img src=x onerror=alert(1)>"',
    );
    // No raw markup may survive — every angle bracket must be escaped.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;/script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('escapes markup that appears in the gaps between tokens too', () => {
    const html = highlightToHtml('js', 'x = <img src=y onerror=z>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });
});
