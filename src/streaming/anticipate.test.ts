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
});
