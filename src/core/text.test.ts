import { describe, it, expect } from 'vitest';
import { TextDoc } from './text';

describe('TextDoc', () => {
  it('reports length and lines', () => {
    const d = new TextDoc('a\nbb\nccc');
    expect(d.length).toBe(8);
    expect(d.lines).toBe(3);
  });

  it('applies a single change immutably', () => {
    const d = new TextDoc('hello world');
    const d2 = d.apply({ from: 6, to: 11, insert: 'there' });
    expect(d2.text).toBe('hello there');
    expect(d.text).toBe('hello world'); // original unchanged
  });

  it('applies multiple changes (order-independent input)', () => {
    const d = new TextDoc('0123456789');
    const d2 = d.applyAll([
      { from: 0, to: 1, insert: 'A' },
      { from: 5, to: 6, insert: 'FFF' },
    ]);
    expect(d2.text).toBe('A1234FFF6789');
  });

  it('lineAt returns the containing line', () => {
    const d = new TextDoc('one\ntwo\nthree');
    expect(d.lineAt(0).text).toBe('one');
    expect(d.lineAt(5).number).toBe(2);
    expect(d.lineAt(5).text).toBe('two');
    expect(d.lineAt(12).text).toBe('three');
  });

  it('round-trips position <-> offset', () => {
    const d = new TextDoc('ab\ncde\nf');
    const pos = d.positionAt(4); // 'd'
    expect(pos).toEqual({ line: 2, column: 2 });
    expect(d.offsetAt(2, 2)).toBe(4);
  });

  it('maps an offset after an earlier insertion', () => {
    const d = new TextDoc('hello world');
    // insert 3 chars at offset 0
    expect(d.mapOffset(6, { from: 0, to: 0, insert: 'xxx' })).toBe(9);
  });

  it('leaves an offset before the change untouched', () => {
    const d = new TextDoc('hello world');
    expect(d.mapOffset(2, { from: 6, to: 11, insert: 'there' })).toBe(2);
  });

  it('collapses an offset inside a replaced range to the edit boundary', () => {
    const d = new TextDoc('hello world');
    expect(d.mapOffset(8, { from: 6, to: 11, insert: 'x' }, -1)).toBe(6);
  });
});
