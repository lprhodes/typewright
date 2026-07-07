/**
 * Pure table-editing helpers (Phase F1 of plan-TW-0002).
 *
 * These are the headless layer under the in-place table grid: no DOM, no React,
 * just string → string transforms over the offset-exact {@link Table} AST that
 * `./parser` produces. Every mutation keeps the Markdown *canonical* — a GFM
 * pipe table with a delimiter row — so `parse → mutate → parse` round-trips to
 * the same structure.
 *
 * Two edit shapes, matching the plan:
 *  - **Single-cell** edits are scoped: {@link cellSourceRange} hands back a
 *    cell's *exact* source range so the caller can splice only that slice.
 *  - **Structural** ops (add/remove row/column, set alignment) re-serialize the
 *    whole table block and return a full-block splice over `[table.from, table.to]`.
 *
 * Addressing convention (documented once, used everywhere):
 *  - Rows use a **grid index**: row `0` is the header, rows `1..N` are body rows
 *    (this mirrors the rendered grid, where the header is the top row).
 *  - Columns are 0-based.
 *
 * The AST contract these helpers lean on (see `src/core/ast.ts:144-156`):
 *   - `TableCell extends Pos` — every cell carries exact `{from,to}` UTF-16
 *     offsets of its *trimmed* content (`splitRow`, `parser.ts:447-459`).
 *   - `Table { from; to; align: CellAlign[]; header: TableCell[]; rows: TableCell[][] }`.
 *   The delimiter row has no node of its own, so alignment edits (like every
 *   structural op) re-serialize the block rather than splicing that row in place.
 */

import type { CellAlign, Pos, Table, TableCell } from './ast';

/** Result of a structural (whole-block) table edit. */
export interface TableEdit {
  /** The full new document text after the splice. */
  text: string;
  /** A sensible caret offset into {@link text} after the edit. */
  selection: number;
}

const clampInt = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

/** Canonical delimiter cell for an alignment (`---`, `:---`, `:---:`, `---:`). */
function delimCell(align: CellAlign): string {
  switch (align) {
    case 'left':
      return ':---';
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    default:
      return '---';
  }
}

/**
 * A normalized, string-only view of a table: header, per-column alignment, and
 * body rows, every row widened/truncated to the header's column count. Editing
 * happens on this, then it is serialized back to canonical GFM.
 */
interface Grid {
  header: string[];
  align: CellAlign[];
  rows: string[][];
}

const cellText = (text: string, cell: TableCell): string =>
  text.slice(cell.from, cell.to);

const emptyRow = (ncols: number): string[] =>
  Array.from({ length: ncols }, () => '');

/** Build a rectangular {@link Grid} from a parsed table, reading raw cell source. */
function tableToGrid(text: string, table: Table): Grid {
  const ncols = Math.max(1, table.header.length);
  const header = table.header.map((c) => cellText(text, c));
  while (header.length < ncols) header.push('');

  const align: CellAlign[] = [];
  for (let i = 0; i < ncols; i++) align.push(table.align[i] ?? null);

  const rows = table.rows.map((row) => {
    const cells = row.map((c) => cellText(text, c));
    while (cells.length < ncols) cells.push('');
    cells.length = ncols;
    return cells;
  });

  return { header, align, rows };
}

/** The cell strings that make up a given serialized line (0 header, 1 delim, ≥2 body). */
function cellsForLine(grid: Grid, lineIdx: number): string[] {
  const ncols = grid.header.length;
  if (lineIdx === 0) return grid.header;
  if (lineIdx === 1) {
    const a: string[] = [];
    for (let i = 0; i < ncols; i++) a.push(delimCell(grid.align[i] ?? null));
    return a;
  }
  return grid.rows[lineIdx - 2] ?? grid.header;
}

/** Serialize the grid to canonical GFM lines: header, delimiter, then body rows. */
function gridLines(grid: Grid): string[] {
  const ncols = grid.header.length;
  const rowLine = (cells: string[]): string => {
    const out = cells.slice(0, ncols);
    while (out.length < ncols) out.push('');
    return `| ${out.join(' | ')} |`;
  };
  const delim: string[] = [];
  for (let i = 0; i < ncols; i++) delim.push(delimCell(grid.align[i] ?? null));

  const lines = [rowLine(grid.header), `| ${delim.join(' | ')} |`];
  for (const r of grid.rows) lines.push(rowLine(r));
  return lines;
}

/** Offset of the first char of `lineIdx` within the joined serialization. */
function lineStart(lines: string[], lineIdx: number): number {
  let off = 0;
  for (const l of lines.slice(0, lineIdx)) off += l.length + 1; // +1 for '\n'
  return off;
}

/** Content-start offset of column `col` within a canonical `| c0 | c1 | … |` row. */
function colOffsetInLine(cells: string[], col: number): number {
  let off = 2; // leading "| "
  for (const c of cells.slice(0, col)) off += c.length + 3; // "cell" + " | "
  return off;
}

/**
 * Serialize `grid`, splice it over `[table.from, table.to]`, and place the caret
 * at the start of `(lineIdx, col)` in the new block.
 */
function commit(
  text: string,
  table: Table,
  grid: Grid,
  lineIdx: number,
  col: number,
): TableEdit {
  const lines = gridLines(grid);
  const block = lines.join('\n');
  const inBlock =
    lineStart(lines, lineIdx) + colOffsetInLine(cellsForLine(grid, lineIdx), col);
  const newText = text.slice(0, table.from) + block + text.slice(table.to);
  return { text: newText, selection: table.from + inBlock };
}

/* ------------------------------------------------------------------ *
 * Public helpers
 * ------------------------------------------------------------------ */

/**
 * Exact source range of a single cell's (trimmed) text, for scoped single-cell
 * splices. Row `0` is the header; rows `1..N` are body rows. Returns `null` when
 * the coordinate is out of bounds.
 */
export function cellSourceRange(
  table: Table,
  row: number,
  col: number,
): Pos | null {
  const cell: TableCell | undefined =
    row === 0 ? table.header[col] : table.rows[row - 1]?.[col];
  if (!cell) return null;
  return { from: cell.from, to: cell.to };
}

/**
 * Insert a new empty body row so it lands at grid position `atRow`
 * (clamped into the body range). Re-serializes the whole block.
 */
export function addRow(text: string, table: Table, atRow: number): TableEdit {
  const grid = tableToGrid(text, table);
  const bodyIdx = clampInt(atRow - 1, 0, grid.rows.length);
  grid.rows.splice(bodyIdx, 0, emptyRow(grid.header.length));
  return commit(text, table, grid, 2 + bodyIdx, 0);
}

/**
 * Insert a new empty column at index `atCol` (clamped), widening the header,
 * the alignment row, and every body row. Re-serializes the whole block.
 */
export function addColumn(text: string, table: Table, atCol: number): TableEdit {
  const grid = tableToGrid(text, table);
  const idx = clampInt(atCol, 0, grid.header.length);
  grid.header.splice(idx, 0, '');
  grid.align.splice(idx, 0, null);
  for (const r of grid.rows) r.splice(idx, 0, '');
  return commit(text, table, grid, 0, idx);
}

/**
 * Remove the body row at grid position `atRow` (row `0`, the header, and
 * out-of-range indices are no-ops). Re-serializes the whole block.
 */
export function removeRow(text: string, table: Table, atRow: number): TableEdit {
  const grid = tableToGrid(text, table);
  const bodyIdx = atRow - 1;
  if (bodyIdx >= 0 && bodyIdx < grid.rows.length) grid.rows.splice(bodyIdx, 1);

  const lineIdx =
    grid.rows.length === 0 ? 0 : 2 + clampInt(bodyIdx, 0, grid.rows.length - 1);
  return commit(text, table, grid, lineIdx, 0);
}

/**
 * Remove the column at index `atCol` from the header, alignment row, and every
 * body row. The last remaining column is never removed (a GFM table needs ≥1
 * column), and out-of-range indices are no-ops. Re-serializes the whole block.
 */
export function removeColumn(
  text: string,
  table: Table,
  atCol: number,
): TableEdit {
  const grid = tableToGrid(text, table);
  if (grid.header.length > 1 && atCol >= 0 && atCol < grid.header.length) {
    grid.header.splice(atCol, 1);
    grid.align.splice(atCol, 1);
    for (const r of grid.rows) r.splice(atCol, 1);
  }
  const caretCol = clampInt(atCol, 0, grid.header.length - 1);
  return commit(text, table, grid, 0, caretCol);
}

/**
 * Set column `col`'s alignment and rewrite the delimiter row (via a canonical
 * re-serialization of the whole block). Out-of-range `col` is a no-op.
 */
export function setAlignment(
  text: string,
  table: Table,
  col: number,
  align: CellAlign,
): TableEdit {
  const grid = tableToGrid(text, table);
  if (col >= 0 && col < grid.align.length) grid.align[col] = align;
  const caretCol = clampInt(col, 0, grid.align.length - 1);
  return commit(text, table, grid, 1, caretCol);
}
