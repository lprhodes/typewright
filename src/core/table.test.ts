import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type { CellAlign, Table } from './ast';
import {
  addColumn,
  addRow,
  cellSourceRange,
  removeColumn,
  removeRow,
  setAlignment,
} from './table';

/** Base GFM table: mixed alignment (none / center / right), two body rows. */
const SRC = [
  '| Name | Age | City |',
  '| --- | :---: | ---: |',
  '| Alice | 30 | NYC |',
  '| Bob | 25 | LA |',
].join('\n');

/** Parse `src` and return its first table block (throws if there is none). */
function firstTable(src: string): Table {
  const doc = parse(src);
  const t = doc.children.find((b) => b.type === 'table');
  if (!t || t.type !== 'table') throw new Error('expected a table block');
  return t;
}

/** Assert a table is a well-formed, rectangular, canonical GFM grid. */
function assertWellFormed(table: Table): void {
  expect(table.type).toBe('table');
  expect(table.header.length).toBeGreaterThanOrEqual(1);
  // The delimiter row (align) has exactly one entry per header column…
  expect(table.align.length).toBe(table.header.length);
  // …and every body row is the same width as the header.
  for (const row of table.rows) expect(row.length).toBe(table.header.length);
}

describe('cellSourceRange', () => {
  it('returns the exact source slice of header + body cells', () => {
    const t = firstTable(SRC);
    const name = cellSourceRange(t, 0, 0)!;
    const age = cellSourceRange(t, 0, 1)!;
    const nyc = cellSourceRange(t, 1, 2)!;
    const la = cellSourceRange(t, 2, 0)!;
    expect(SRC.slice(name.from, name.to)).toBe('Name');
    expect(SRC.slice(age.from, age.to)).toBe('Age');
    expect(SRC.slice(nyc.from, nyc.to)).toBe('NYC');
    expect(SRC.slice(la.from, la.to)).toBe('Bob');
  });

  it('is null out of bounds', () => {
    const t = firstTable(SRC);
    expect(cellSourceRange(t, 99, 0)).toBeNull();
    expect(cellSourceRange(t, 0, 99)).toBeNull();
    expect(cellSourceRange(t, -1, 0)).toBeNull();
  });

  it('supports a scoped single-cell splice that reparses cleanly', () => {
    const t = firstTable(SRC);
    const r = cellSourceRange(t, 1, 0)!; // "Alice"
    const edited = SRC.slice(0, r.from) + 'Alicia' + SRC.slice(r.to);
    const t2 = firstTable(edited);
    assertWellFormed(t2);
    expect(edited).toContain('| Alicia | 30 | NYC |');
    // Only that cell changed — the rest of the grid is intact.
    expect(edited).toContain('| Bob | 25 | LA |');
  });
});

describe('addRow', () => {
  it('inserts an empty body row and preserves columns + alignment', () => {
    const t = firstTable(SRC);
    const { text, selection } = addRow(SRC, t, 1); // before the first body row
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.rows.length).toBe(3);
    expect(t2.header.length).toBe(3);
    expect(t2.align).toEqual([null, 'center', 'right']);
    // The new first body row is empty.
    expect(t2.rows[0]!.every((c) => c.from === c.to)).toBe(true);
    // Caret sits inside the table block.
    expect(selection).toBeGreaterThanOrEqual(t2.from);
    expect(selection).toBeLessThanOrEqual(text.length);
  });

  it('appends when atRow is past the end', () => {
    const t = firstTable(SRC);
    const { text } = addRow(SRC, t, 999);
    const t2 = firstTable(text);
    expect(t2.rows.length).toBe(3);
    // Existing rows keep their order; the new one is last (and empty).
    expect(t2.rows[t2.rows.length - 1]!.every((c) => c.from === c.to)).toBe(true);
    expect(text).toContain('| Alice | 30 | NYC |');
  });
});

describe('addColumn', () => {
  it('widens header, alignment, and every row', () => {
    const t = firstTable(SRC);
    const { text } = addColumn(SRC, t, 3); // append at the end
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.header.length).toBe(4);
    expect(t2.align.length).toBe(4);
    expect(t2.rows.every((r) => r.length === 4)).toBe(true);
    expect(t2.align).toEqual([null, 'center', 'right', null]);
  });

  it('prepends at index 0', () => {
    const t = firstTable(SRC);
    const { text } = addColumn(SRC, t, 0);
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.header.length).toBe(4);
    // Original first column shifts right.
    expect(text.slice(t2.header[1]!.from, t2.header[1]!.to)).toBe('Name');
  });
});

describe('removeRow', () => {
  it('drops the addressed body row', () => {
    const t = firstTable(SRC);
    const { text } = removeRow(SRC, t, 1); // remove "Alice" row
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.rows.length).toBe(1);
    expect(text).not.toContain('Alice');
    expect(text).toContain('Bob');
  });

  it('is a no-op on the header row (0)', () => {
    const t = firstTable(SRC);
    const { text } = removeRow(SRC, t, 0);
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.rows.length).toBe(2);
  });

  it('can empty out the body and stay a valid table', () => {
    let text = SRC;
    text = removeRow(text, firstTable(text), 1).text;
    text = removeRow(text, firstTable(text), 1).text;
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.rows.length).toBe(0);
    expect(t2.header.length).toBe(3);
  });
});

describe('removeColumn', () => {
  it('drops the addressed column from header, alignment, and rows', () => {
    const t = firstTable(SRC);
    const { text } = removeColumn(SRC, t, 1); // remove "Age" (center)
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.header.length).toBe(2);
    expect(t2.align).toEqual([null, 'right']);
    expect(text).not.toContain('Age');
    expect(text).not.toContain(':---:');
  });

  it('never removes the last remaining column', () => {
    let text = SRC;
    // Remove three times; two columns removable, the last must survive.
    text = removeColumn(text, firstTable(text), 0).text;
    text = removeColumn(text, firstTable(text), 0).text;
    text = removeColumn(text, firstTable(text), 0).text;
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.header.length).toBe(1);
  });
});

describe('setAlignment', () => {
  it('rewrites the delimiter row to canonical GFM', () => {
    const t = firstTable(SRC);
    const { text, selection } = setAlignment(SRC, t, 0, 'center');
    const t2 = firstTable(text);
    assertWellFormed(t2);
    expect(t2.align).toEqual(['center', 'center', 'right']);
    expect(text).toContain('| :---: | :---: | ---: |');
    // Caret lands on the delimiter row inside the block.
    expect(selection).toBeGreaterThanOrEqual(t2.from);
  });

  it('supports all four alignments and clearing back to none', () => {
    const aligns: CellAlign[] = ['left', 'right', 'center', null];
    for (const a of aligns) {
      const t = firstTable(SRC);
      const { text } = setAlignment(SRC, t, 2, a);
      const t2 = firstTable(text);
      assertWellFormed(t2);
      expect(t2.align[2]).toBe(a);
    }
  });
});

describe('property-style: parse → mutate → reparse stays a well-formed table', () => {
  type Op =
    | ['addRow', number]
    | ['addColumn', number]
    | ['removeRow', number]
    | ['removeColumn', number]
    | ['setAlign', number, CellAlign];

  // Deterministic (no Math.random) fixed sequences, including out-of-range and
  // shrink-to-limit cases that exercise the clamps/guards.
  const SEQUENCES: Op[][] = [
    [['addRow', 1], ['addColumn', 0], ['setAlign', 0, 'left'], ['removeRow', 2]],
    [['addColumn', 3], ['addColumn', 1], ['removeColumn', 0], ['setAlign', 1, 'center']],
    [['removeRow', 1], ['removeRow', 1], ['addRow', 1], ['setAlign', 2, 'right']],
    [['setAlign', 0, null], ['addRow', 99], ['removeColumn', 5], ['addColumn', 2]],
    [['removeColumn', 0], ['removeColumn', 0], ['removeColumn', 0], ['addColumn', 0], ['addRow', 0]],
    [['addRow', 2], ['addRow', 1], ['addColumn', 2], ['setAlign', 3, 'left'], ['removeRow', 3]],
  ];

  it('holds across every fixed edit sequence', () => {
    for (const seq of SEQUENCES) {
      let text = SRC;
      for (const op of seq) {
        const t = firstTable(text);
        let res;
        switch (op[0]) {
          case 'addRow':
            res = addRow(text, t, op[1]);
            break;
          case 'addColumn':
            res = addColumn(text, t, op[1]);
            break;
          case 'removeRow':
            res = removeRow(text, t, op[1]);
            break;
          case 'removeColumn':
            res = removeColumn(text, t, op[1]);
            break;
          case 'setAlign':
            res = setAlignment(text, t, op[1], op[2]);
            break;
        }
        text = res.text;
        // Selection is always a valid offset in the new text.
        expect(res.selection).toBeGreaterThanOrEqual(0);
        expect(res.selection).toBeLessThanOrEqual(text.length);
        // The result is still exactly one well-formed table.
        const doc = parse(text);
        const tables = doc.children.filter((b) => b.type === 'table');
        expect(tables.length).toBe(1);
        assertWellFormed(firstTable(text));
      }
    }
  });
});
