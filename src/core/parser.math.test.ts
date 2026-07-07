import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type { Math, MathBlock, Paragraph } from './ast';

/** First block as a paragraph, returning its inline children. */
function para(src: string): Paragraph['children'] {
  const b = parse(src, { math: true }).children[0]!;
  expect(b.type).toBe('paragraph');
  return (b as Paragraph).children;
}

describe('parser — math (gated by opts.math)', () => {
  it('parses inline $x$ with exact offsets', () => {
    const kids = para('$x$');
    expect(kids).toHaveLength(1);
    const m = kids[0]! as Math;
    expect(m.type).toBe('math');
    expect(m.display).toBe(false);
    expect(m.value).toBe('x');
    expect(m.from).toBe(0);
    expect(m.to).toBe(3);
  });

  it('parses an inline span inside surrounding text, offsets intact', () => {
    const kids = para('a $e=mc^2$ b');
    const m = kids.find((k) => k.type === 'math') as Math | undefined;
    expect(m).toBeDefined();
    expect(m!.value).toBe('e=mc^2');
    expect(m!.from).toBe(2);
    expect(m!.to).toBe(10);
    expect(m!.display).toBe(false);
  });

  it('parses inline-display $$x$$', () => {
    const kids = para('a $$x$$ b');
    const m = kids.find((k) => k.type === 'math') as Math | undefined;
    expect(m).toBeDefined();
    expect(m!.display).toBe(true);
    expect(m!.value).toBe('x');
    expect(m!.from).toBe(2);
    expect(m!.to).toBe(7);
  });

  it('parses a $$…$$ display-math block with exact offsets', () => {
    const b = parse('$$\nx^2\n$$', { math: true }).children[0]! as MathBlock;
    expect(b.type).toBe('mathBlock');
    expect(b.value).toBe('x^2');
    expect(b.from).toBe(0);
    expect(b.to).toBe(9);
  });

  it('runs an unterminated $$ block to end (never throws)', () => {
    const b = parse('$$\nnever closed', { math: true }).children[0]! as MathBlock;
    expect(b.type).toBe('mathBlock');
    expect(b.value).toBe('never closed');
  });

  it('degrades an unterminated inline $ to plain text', () => {
    const kids = para('$x with no close');
    expect(kids.every((k) => k.type === 'text')).toBe(true);
  });

  it('keeps bare $ signs in prose ($5 and $10) as text (flanking rule)', () => {
    const kids = para('$5 and $10');
    expect(kids.every((k) => k.type === 'text')).toBe(true);
  });

  it('treats \\$ as an escaped literal, not a delimiter', () => {
    const kids = para('\\$x\\$');
    expect(kids.every((k) => k.type === 'text')).toBe(true);
  });

  it('is INERT when the flag is off: $x$ is plain text', () => {
    const b = parse('$x$').children[0]! as Paragraph;
    expect(b.type).toBe('paragraph');
    expect(b.children.every((k) => k.type === 'text')).toBe(true);
  });

  it('is INERT when the flag is off: $$…$$ is a paragraph, not a math block', () => {
    const doc = parse('$$\nx^2\n$$');
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]!.type).toBe('paragraph');
  });
});
