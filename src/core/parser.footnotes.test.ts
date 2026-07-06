import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type { Blockquote, FootnoteDef, FootnoteRef, Paragraph } from './ast';

const FN = { footnotes: true } as const;

describe('parser — footnote refs (gated by opts.footnotes)', () => {
  it('parses a [^id] ref inside a paragraph with exact offsets', () => {
    const p = parse('see[^1] here', FN).children[0]! as Paragraph;
    expect(p.type).toBe('paragraph');
    const ref = p.children.find((k) => k.type === 'footnoteRef') as FootnoteRef | undefined;
    expect(ref).toBeDefined();
    expect(ref!.id).toBe('1');
    expect(ref!.from).toBe(3);
    expect(ref!.to).toBe(7);
    // surrounding text is preserved on both sides
    expect(p.children[0]).toMatchObject({ type: 'text', value: 'see' });
    expect(p.children[p.children.length - 1]).toMatchObject({ type: 'text', value: ' here' });
  });

  it('parses a multi-character label', () => {
    const p = parse('x[^note-2]y', FN).children[0]! as Paragraph;
    const ref = p.children.find((k) => k.type === 'footnoteRef') as FootnoteRef | undefined;
    expect(ref!.id).toBe('note-2');
  });

  it('degrades an unterminated [^ to plain text (no ref, no crash)', () => {
    const p = parse('[^abc no close', FN).children[0]! as Paragraph;
    expect(p.type).toBe('paragraph');
    expect(p.children.some((k) => k.type === 'footnoteRef')).toBe(false);
    expect(p.children.every((k) => k.type === 'text')).toBe(true);
  });

  it('bounds the id scan: a [^ with a very long unterminated label degrades', () => {
    const p = parse('[^' + 'a'.repeat(400), FN).children[0]! as Paragraph;
    expect(p.children.some((k) => k.type === 'footnoteRef')).toBe(false);
  });

  it('is INERT when the flag is off: [^1] stays plain text', () => {
    const p = parse('see[^1] here').children[0]! as Paragraph;
    expect(p.type).toBe('paragraph');
    expect(p.children.every((k) => k.type === 'text')).toBe(true);
  });
});

describe('parser — footnote definitions (gated by opts.footnotes)', () => {
  it('parses a [^id]: def as a footnoteDef block with content children', () => {
    const d = parse('[^1]: A note', FN).children[0]! as FootnoteDef;
    expect(d.type).toBe('footnoteDef');
    expect(d.id).toBe('1');
    expect(d.from).toBe(0);
    expect(d.to).toBe('[^1]: A note'.length);
    expect(d.children[0]!.type).toBe('paragraph');
    expect((d.children[0] as Paragraph).children[0]).toMatchObject({ type: 'text', value: 'A note' });
  });

  it('absorbs lazily-continued following lines into the def body', () => {
    const d = parse('[^note]: first line\nand more text', FN).children[0]! as FootnoteDef;
    expect(d.type).toBe('footnoteDef');
    expect(d.id).toBe('note');
    expect(d.children).toHaveLength(1);
    const p = d.children[0] as Paragraph;
    expect(p.type).toBe('paragraph');
    // the wrapped line arrives via a soft break inside the same paragraph
    expect(p.children.some((k) => k.type === 'break')).toBe(true);
  });

  it('interrupts a preceding paragraph (registered in startsBlock)', () => {
    const doc = parse('some text\n[^1]: a def', FN);
    expect(doc.children).toHaveLength(2);
    expect(doc.children[0]!.type).toBe('paragraph');
    expect(doc.children[1]!.type).toBe('footnoteDef');
  });

  it('parses a def inside a blockquote (container recursion)', () => {
    const q = parse('> [^1]: note in quote', FN).children[0]! as Blockquote;
    expect(q.type).toBe('blockquote');
    const d = q.children[0]! as FootnoteDef;
    expect(d.type).toBe('footnoteDef');
    expect(d.id).toBe('1');
  });

  it('is INERT when the flag is off: [^1]: … is a plain paragraph', () => {
    const doc = parse('[^1]: A note');
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]!.type).toBe('paragraph');
  });
});
