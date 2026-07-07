import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type { Blockquote, DefList, Paragraph } from './ast';

const DL = { defLists: true } as const;

describe('parser — definition lists (gated by opts.defLists)', () => {
  it('parses a term + definition with exact offsets', () => {
    const dl = parse('Term\n: Definition', DL).children[0]! as DefList;
    expect(dl.type).toBe('defList');
    expect(dl.from).toBe(0);
    expect(dl.to).toBe('Term\n: Definition'.length);
    expect(dl.items).toHaveLength(1);
    const item = dl.items[0]!;
    expect(item.type).toBe('defItem');
    expect(item.term[0]).toMatchObject({ type: 'text', value: 'Term' });
    expect(item.definitions).toHaveLength(1);
    expect(item.definitions[0]![0]!.type).toBe('paragraph');
    expect((item.definitions[0]![0] as Paragraph).children[0]).toMatchObject({
      type: 'text',
      value: 'Definition',
    });
  });

  it('collects multiple definitions for one term', () => {
    const dl = parse('Term\n: Def one\n: Def two', DL).children[0]! as DefList;
    expect(dl.items).toHaveLength(1);
    expect(dl.items[0]!.definitions).toHaveLength(2);
  });

  it('collects multiple term/definition groups into one list', () => {
    const dl = parse('T1\n: D1\nT2\n: D2', DL).children[0]! as DefList;
    expect(dl.items).toHaveLength(2);
    expect(dl.items[0]!.term[0]).toMatchObject({ type: 'text', value: 'T1' });
    expect(dl.items[1]!.term[0]).toMatchObject({ type: 'text', value: 'T2' });
  });

  it('absorbs an indented continuation line into a definition', () => {
    const dl = parse('Term\n: Line one\n  Line two', DL).children[0]! as DefList;
    const def = dl.items[0]!.definitions[0]!;
    expect(def[0]!.type).toBe('paragraph');
    expect((def[0] as Paragraph).children.some((k) => k.type === 'break')).toBe(true);
  });

  it('parses a definition list inside a blockquote (container recursion)', () => {
    const q = parse('> Term\n> : Def', DL).children[0]! as Blockquote;
    expect(q.type).toBe('blockquote');
    expect(q.children[0]!.type).toBe('defList');
  });

  it('is CONSERVATIVE: ordinary two-line prose is not a def list', () => {
    const doc = parse('Hello world\nthis is a note', DL);
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]!.type).toBe('paragraph');
  });

  it('is CONSERVATIVE: a mid-line colon (time is 3:30) is not a definition', () => {
    const doc = parse('meeting\ntime is 3:30', DL);
    expect(doc.children[0]!.type).toBe('paragraph');
  });

  it('is INERT when the flag is off: term / : def is one plain paragraph', () => {
    const doc = parse('Term\n: Definition');
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]!.type).toBe('paragraph');
  });
});
