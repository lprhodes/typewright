import { describe, it, expect } from 'vitest';
import { anticipate } from './anticipate';

describe('anticipate', () => {
  it('returns empty for empty input', () => {
    expect(anticipate('')).toEqual({ html: '', pending: [] });
  });

  it('renders a completed line with no pending', () => {
    const r = anticipate('The rollout is **bold** and done.');
    expect(r.html).toContain('<strong>bold</strong>');
    expect(r.pending).toEqual([]);
  });

  it('anticipates an unterminated bold', () => {
    const r = anticipate('The rollout is **bo');
    expect(r.pending).toContain('strong');
    expect(r.html).toContain('tw-pending-strong');
    expect(r.html).toContain('bo');
    expect(r.html).not.toContain('**'); // markers not shown literally
  });

  it('anticipates an unterminated emphasis', () => {
    const r = anticipate('this is *emph');
    expect(r.pending).toContain('emphasis');
    expect(r.html).toContain('tw-pending-em');
  });

  it('anticipates an unterminated inline code', () => {
    const r = anticipate('call `runGa');
    expect(r.pending).toContain('code');
    expect(r.html).toContain('tw-pending-code');
    expect(r.html).toContain('runGa');
  });

  it('opens a code block on an unterminated fence', () => {
    const r = anticipate('intro\n\n```ts\nconst x = 1;');
    expect(r.pending).toContain('code');
    expect(r.html).toContain('<pre class="tw-codeblock">');
    expect(r.html).toContain('language-ts');
    expect(r.html).toContain('const x = 1;');
  });

  it('closes the code block when the fence completes', () => {
    const r = anticipate('```ts\nconst x = 1;\n```');
    expect(r.pending).not.toContain('code');
    expect(r.html).toContain('<pre'); // rendered as a real code block
  });

  it('shows a component skeleton for a forming JSX element', () => {
    const r = anticipate('<Chart kind="area"');
    expect(r.pending).toContain('jsx');
    expect(r.html).toContain('tw-skeleton');
    expect(r.html).toContain('Chart');
  });

  it('anticipates a forming heading', () => {
    const r = anticipate('# Launch pl');
    expect(r.html).toContain('<h1>');
    expect(r.html).toContain('Launch pl');
  });

  it('keeps confirmed content stable across growth', () => {
    const a = anticipate('Done sentence one.\n\nSecond **bo');
    expect(a.html).toContain('Done sentence one.');
    expect(a.html).toContain('tw-pending-strong');
  });

  it('respects a disabled anticipation option', () => {
    const r = anticipate('the **bo', { strong: false });
    expect(r.pending).not.toContain('strong');
  });

  it('never throws on odd input', () => {
    for (const s of ['*', '**', '`', '<C', '#', '~~x', '](', '\n\n\n', '```']) {
      expect(() => anticipate(s)).not.toThrow();
    }
  });

  it('escapes quotes in the fence language attribute (no attribute breakout)', () => {
    const r = anticipate('```a"onmouseover=alert(1) x\ncode');
    expect(r.html).not.toContain('"onmouseover='); // raw breakout blocked
    expect(r.html).toContain('&quot;'); // the quote is escaped
  });

  it('anticipates a forming link as an open anchor, then promotes it when closed', () => {
    const open = anticipate('See [the do');
    expect(open.pending).toContain('link');
    expect(open.html).toContain('tw-pending-link');
    expect(open.html).toContain('the do');
    expect(open.html).not.toContain('[the'); // the `[` marker is not shown literally
    expect(open.html).not.toContain('href='); // no href until the URL finishes

    // …with the destination still streaming, the resolved text shows, url hidden
    const url = anticipate('See [the docs](https://exa');
    expect(url.pending).toContain('link');
    expect(url.html).toContain('the docs');
    expect(url.html).not.toContain('https://exa'); // partial URL withheld

    // once closed it promotes to a real, safe <a href>
    const closed = anticipate('See [the docs](https://example.com)');
    expect(closed.pending).not.toContain('link');
    expect(closed.html).toContain('<a href="https://example.com"');
    expect(closed.html).not.toContain('tw-pending-link');
  });

  it('anticipates a forming list item as an in-progress <li>', () => {
    const r = anticipate('Shopping:\n\n- milk\n- egg');
    expect(r.pending).toContain('listItem');
    expect(r.html).toContain('tw-pending-li');
    expect(r.html).toContain('egg'); // the forming item
    expect(r.html).toContain('milk'); // the committed item stays rendered
    expect(r.html).not.toContain('- egg'); // the marker is not shown literally
  });

  it('anticipates an ordered list item, preserving its start number', () => {
    const r = anticipate('3. thi');
    expect(r.pending).toContain('listItem');
    expect(r.html).toContain('<ol start="3"');
    expect(r.html).toContain('thi');
  });

  it('anticipates a partial table row under a committed header + delimiter', () => {
    const r = anticipate('| Name | Age |\n| --- | --- |\n| Alic');
    expect(r.pending).toContain('tableRow');
    expect(r.html).toContain('tw-pending-table');
    expect(r.html).toContain('Alic'); // the forming row cell
    expect(r.html).toContain('<th'); // committed header rendered as a real table
  });

  it('promotes a table row into the committed table once it is on its own line', () => {
    const r = anticipate('| Name | Age |\n| --- | --- |\n| Alice | 30 |\n');
    // the last line is now empty (row committed) — no in-progress row anticipated
    expect(r.pending).not.toContain('tableRow');
    expect(r.html).toContain('<td>Alice</td>');
    expect(r.html).not.toContain('tw-pending-table');
  });

  it('anticipates an unterminated _emphasis_ (underscore parity, like *)', () => {
    const r = anticipate('this is _emph');
    expect(r.pending).toContain('emphasis');
    expect(r.html).toContain('tw-pending-em');
    expect(r.html).toContain('emph');
    expect(r.html).not.toContain('_emph'); // marker not shown literally
  });

  it('keeps a lone `*` emphasis offset correct after a completed **strong** run', () => {
    // regression guard for the mask: the `*` opener must index the ORIGINAL line
    const r = anticipate('**done** and *emp');
    expect(r.html).toContain('<strong>done</strong>');
    expect(r.html).toContain('tw-pending-em');
    expect(r.html).toContain('emp');
  });

  it('never reflows confirmed content before the active tail across a push', () => {
    const a = anticipate('Done sentence one.\n\nSecond **bo');
    const b = anticipate('Done sentence one.\n\nSecond **bold te');
    const committedA = a.html.slice(0, a.html.indexOf('Second'));
    const committedB = b.html.slice(0, b.html.indexOf('Second'));
    expect(committedA).toBe(committedB); // byte-identical confirmed prefix
    expect(committedA).toContain('<p>Done sentence one.</p>');
  });

  it('never throws on odd link / list / table input', () => {
    for (const s of ['[', '[x', '[x]', '[x](', '](', '- ', '* ', '1. ', '|', '| a', '| a |\n| -']) {
      expect(() => anticipate(s)).not.toThrow();
    }
  });
});
