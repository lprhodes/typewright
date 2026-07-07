import * as React from 'react';
import { renderInline } from '../core/render';
import {
  addColumn,
  addRow,
  cellSourceRange,
  removeColumn,
  removeRow,
  setAlignment,
} from '../core/table';
import type { TableEdit } from '../core/table';
import type { CellAlign, Table, TableCell } from '../core/ast';

/**
 * TableGrid — in-place editable grid for a single GFM table (Phase F2).
 *
 * The Markdown SOURCE stays canonical: this component never holds its own copy
 * of the table's text. Two edit shapes, mirroring `core/table.ts`:
 *
 *  - **Single-cell** edits are SCOPED. A cell is `contentEditable`; while idle it
 *    shows its rendered inline HTML (via {@link renderInline}), and on focus it
 *    swaps to the cell's *raw* Markdown source so an edit round-trips losslessly.
 *    Committing (blur / Enter / navigation) reads {@link cellSourceRange} and
 *    emits an `onChange` that replaces ONLY that cell's source slice — the C-8
 *    invariant: exactly one cell's source changes.
 *  - **Structural** ops (add/remove row/column, set alignment) run the matching
 *    `core/table.ts` helper, which returns the FULL new document text, and emit a
 *    single splice over `[table.from, table.to]` carrying just the re-serialized
 *    block (so the document outside the table is byte-for-byte untouched).
 *
 * Structural ops are DEFERRED one render: the toolbar button does not steal focus
 * with `preventDefault`, so clicking it first blurs+commits any in-flight cell
 * edit; the op then runs against the freshly-reparsed `table` prop. This keeps a
 * pending keystroke from being clobbered by a whole-block re-serialization.
 */
export interface TableGridProps {
  /** The parsed table whose offsets index into {@link source}. */
  table: Table;
  /** Full document source (the single source of truth). */
  source: string;
  /** Emit a scoped splice: `source[from..to]` becomes `insert`. */
  onChange: (change: { from: number; to: number; insert: string }) => void;
  /** The caret left the grid past an edge (Tab/arrow beyond the outermost cell). */
  onExit?: (dir?: 'up' | 'down') => void;
  readOnly?: boolean;
}

/** Grid coordinate: row `0` is the header, rows `1..N` are body rows; `col` is 0-based. */
interface Coord {
  row: number;
  col: number;
}

/** A structural edit queued for the next render (after any cell commit lands). */
type PendingOp =
  | { kind: 'add-row' | 'add-col' | 'del-row' | 'del-col'; row: number; col: number }
  | { kind: 'align'; row: number; col: number; align: CellAlign };

const cellKey = (row: number, col: number): string => `${row}:${col}`;

/* ------------------------------------------------------------------ *
 * Caret / selection helpers (raw DOM, client-only)
 * ------------------------------------------------------------------ */

/** Place the caret at the end of a `contentEditable` element's content. */
function caretToEnd(el: HTMLElement): void {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Whether the collapsed caret sits at the very start / very end of `el`'s text. */
function caretAtEdge(el: HTMLElement): { start: boolean; end: boolean } {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0) return { start: true, end: true };
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return { start: false, end: false };
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString().length;
  const total = el.textContent?.length ?? 0;
  return { start: range.collapsed && before === 0, end: range.collapsed && before === total };
}

/* ------------------------------------------------------------------ *
 * Icons (inherit currentColor, match the demo's stroke conventions)
 * ------------------------------------------------------------------ */

function Svg({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICON = {
  addRow: (
    <Svg>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <path d="M12 15v6M9 18h6" />
    </Svg>
  ),
  addCol: (
    <Svg>
      <rect x="4" y="3" width="7" height="18" rx="1.5" />
      <path d="M15 12h6M18 9v6" />
    </Svg>
  ),
  delRow: (
    <Svg>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <path d="M9 18h6" />
    </Svg>
  ),
  delCol: (
    <Svg>
      <rect x="4" y="3" width="7" height="18" rx="1.5" />
      <path d="M15 12h6" />
    </Svg>
  ),
  alignL: (
    <Svg>
      <path d="M4 6h16M4 12h10M4 18h13" />
    </Svg>
  ),
  alignC: (
    <Svg>
      <path d="M4 6h16M7 12h10M6 18h12" />
    </Svg>
  ),
  alignR: (
    <Svg>
      <path d="M4 6h16M10 12h10M7 18h13" />
    </Svg>
  ),
};

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function TableGrid(props: TableGridProps): React.ReactElement {
  const { table, source, onChange, onExit, readOnly = false } = props;

  const ncols = Math.max(1, table.header.length);
  const lastRow = table.rows.length; // grid index of the last body row (0 == header-only)

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const cellRefs = React.useRef<Map<string, HTMLTableCellElement>>(new Map());
  const [selected, setSelected] = React.useState<Coord | null>(null);
  const [pendingFocus, setPendingFocus] = React.useState<Coord | null>(null);
  const [pendingOp, setPendingOp] = React.useState<PendingOp | null>(null);

  const getCell = React.useCallback(
    (row: number, col: number): TableCell | undefined =>
      row === 0 ? table.header[col] : table.rows[row - 1]?.[col],
    [table],
  );

  /* --- keep every idle cell showing its rendered inline HTML --- */
  React.useLayoutEffect(() => {
    const paint = (row: number, col: number, cell: TableCell | undefined): void => {
      const el = cellRefs.current.get(cellKey(row, col));
      if (!el || el === document.activeElement) return; // never clobber the cell being edited
      el.innerHTML = cell ? renderInline(cell.children) : '';
    };
    for (let c = 0; c < ncols; c++) paint(0, c, table.header[c]);
    table.rows.forEach((row, ri) => {
      for (let c = 0; c < ncols; c++) paint(ri + 1, c, row[c]);
    });
  }, [table, source, ncols, readOnly]);

  /* --- deferred structural op: runs against the freshest table/source --- */
  React.useEffect(() => {
    if (!pendingOp || readOnly) {
      if (pendingOp) setPendingOp(null);
      return;
    }
    const op = pendingOp;
    setPendingOp(null);
    let result: TableEdit;
    switch (op.kind) {
      case 'add-row':
        result = addRow(source, table, op.row + 1);
        break;
      case 'add-col':
        result = addColumn(source, table, op.col + 1);
        break;
      case 'del-row':
        result = removeRow(source, table, op.row);
        break;
      case 'del-col':
        result = removeColumn(source, table, op.col);
        break;
      case 'align':
        result = setAlignment(source, table, op.col, op.align);
        break;
      default:
        return;
    }
    // The helper returns the FULL new document; the prefix before `table.from`
    // and the suffix after `table.to` are unchanged, so the new block is the
    // slice between them. Emit a splice scoped to the table block only.
    const insert = result.text.slice(table.from, result.text.length - source.length + table.to);
    const oldBlock = source.slice(table.from, table.to);
    if (insert !== oldBlock) {
      onChange({ from: table.from, to: table.to, insert });
    }
  }, [pendingOp, table, source, onChange, readOnly]);

  /* --- move focus to a cell by coordinate after a render (nav / structural) --- */
  React.useEffect(() => {
    if (!pendingFocus) return;
    const el = cellRefs.current.get(cellKey(pendingFocus.row, pendingFocus.col));
    setPendingFocus(null);
    if (el) el.focus();
  }, [pendingFocus, table]);

  /* --- single-cell commit (C-8: exactly one cell's source slice changes) --- */
  const commitCell = React.useCallback(
    (row: number, col: number): void => {
      const el = cellRefs.current.get(cellKey(row, col));
      const cell = getCell(row, col);
      const range = cellSourceRange(table, row, col);
      if (!el || !cell || !range) return;
      const oldText = source.slice(range.from, range.to);
      const next = (el.textContent ?? '').replace(/\r?\n/g, ' ');
      if (next !== oldText) {
        onChange({ from: range.from, to: range.to, insert: next });
      } else {
        // No source change ⇒ the layout effect won't repaint; revert this cell
        // from its raw-source editing view back to rendered inline HTML.
        el.innerHTML = renderInline(cell.children);
      }
    },
    [table, source, onChange, getCell],
  );

  const onCellFocus = React.useCallback(
    (row: number, col: number): void => {
      if (readOnly) return;
      const cell = getCell(row, col);
      const el = cellRefs.current.get(cellKey(row, col));
      setSelected({ row, col });
      if (el && cell) {
        const raw = source.slice(cell.from, cell.to);
        if (el.textContent !== raw) el.textContent = raw; // swap rendered → raw source
        caretToEnd(el);
      }
    },
    [readOnly, getCell, source],
  );

  /* --- navigation targets --- */
  const nextCell = React.useCallback(
    (row: number, col: number): Coord | null => {
      if (col < ncols - 1) return { row, col: col + 1 };
      if (row < lastRow) return { row: row + 1, col: 0 };
      return null;
    },
    [ncols, lastRow],
  );
  const prevCell = React.useCallback(
    (row: number, col: number): Coord | null => {
      if (col > 0) return { row, col: col - 1 };
      if (row > 0) return { row: row - 1, col: ncols - 1 };
      return null;
    },
    [ncols],
  );

  const exitPastEdge = React.useCallback(
    (row: number, col: number, dir: 'up' | 'down'): void => {
      cellRefs.current.get(cellKey(row, col))?.blur(); // blur commits the cell
      onExit?.(dir);
    },
    [onExit],
  );

  const onCellKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTableCellElement>, row: number, col: number): void => {
      if (readOnly) return;
      const el = e.currentTarget;
      switch (e.key) {
        case 'Enter': {
          if (e.shiftKey) return;
          e.preventDefault();
          if (row < lastRow) setPendingFocus({ row: row + 1, col });
          else exitPastEdge(row, col, 'down');
          return;
        }
        case 'Tab': {
          e.preventDefault();
          const target = e.shiftKey ? prevCell(row, col) : nextCell(row, col);
          if (target) setPendingFocus(target);
          else exitPastEdge(row, col, e.shiftKey ? 'up' : 'down');
          return;
        }
        case 'ArrowUp': {
          e.preventDefault();
          if (row > 0) setPendingFocus({ row: row - 1, col });
          else exitPastEdge(row, col, 'up');
          return;
        }
        case 'ArrowDown': {
          e.preventDefault();
          if (row < lastRow) setPendingFocus({ row: row + 1, col });
          else exitPastEdge(row, col, 'down');
          return;
        }
        case 'ArrowLeft': {
          if (!caretAtEdge(el).start) return; // let the caret move within the cell
          e.preventDefault();
          const target = prevCell(row, col);
          if (target) setPendingFocus(target);
          else exitPastEdge(row, col, 'up');
          return;
        }
        case 'ArrowRight': {
          if (!caretAtEdge(el).end) return;
          e.preventDefault();
          const target = nextCell(row, col);
          if (target) setPendingFocus(target);
          else exitPastEdge(row, col, 'down');
          return;
        }
        default:
          return;
      }
    },
    [readOnly, lastRow, nextCell, prevCell, exitPastEdge],
  );

  /* --- selection lifecycle --- */
  const onWrapBlur = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>): void => {
      const next = e.relatedTarget as Node | null;
      if (next && wrapRef.current?.contains(next)) return; // focus stayed inside the grid
      setSelected(null);
    },
    [],
  );

  // Clamp the selection to the live grid so a deleted row/column can't dangle.
  const sel: Coord | null = selected
    ? { row: Math.min(selected.row, lastRow), col: Math.min(selected.col, ncols - 1) }
    : null;

  const colAlign = (col: number): CellAlign => table.align[col] ?? null;

  // Shared attribute set for a header/body cell (a `<th>`/`<td>` share the same
  // props — only their element type differs).
  const cellProps = (
    row: number,
    col: number,
  ): React.HTMLAttributes<HTMLTableCellElement> & React.RefAttributes<HTMLTableCellElement> => {
    const align = colAlign(col);
    const isSel = sel !== null && sel.row === row && sel.col === col;
    const p: React.HTMLAttributes<HTMLTableCellElement> & React.RefAttributes<HTMLTableCellElement> = {
      ref: (el: HTMLTableCellElement | null) => {
        if (el) cellRefs.current.set(cellKey(row, col), el);
        else cellRefs.current.delete(cellKey(row, col));
      },
      className: `tw-tg-cell${isSel ? ' tw-tg-sel' : ''}`,
      role: readOnly ? undefined : 'gridcell',
      style: align ? { textAlign: align } : undefined,
      contentEditable: readOnly ? undefined : true,
      suppressContentEditableWarning: true,
      spellCheck: false,
    };
    if (!readOnly) {
      p.onFocus = () => onCellFocus(row, col);
      p.onBlur = () => commitCell(row, col);
      p.onKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => onCellKeyDown(e, row, col);
    }
    return p;
  };

  const runOp = (op: PendingOp): void => {
    if (readOnly) return;
    setPendingOp(op);
  };

  const showToolbar = !readOnly && sel !== null;
  const toolbar = showToolbar ? (
    <div className="tw-tg-toolbar" role="toolbar" aria-label="Table">
      <button
        type="button"
        className="tw-tg-btn"
        title="Add row"
        aria-label="Add row"
        onClick={() => runOp({ kind: 'add-row', row: sel.row, col: sel.col })}
      >
        {ICON.addRow}
      </button>
      <button
        type="button"
        className="tw-tg-btn"
        title="Add column"
        aria-label="Add column"
        onClick={() => runOp({ kind: 'add-col', row: sel.row, col: sel.col })}
      >
        {ICON.addCol}
      </button>
      <button
        type="button"
        className="tw-tg-btn"
        title="Delete row"
        aria-label="Delete row"
        disabled={sel.row === 0 || lastRow === 0}
        onClick={() => runOp({ kind: 'del-row', row: sel.row, col: sel.col })}
      >
        {ICON.delRow}
      </button>
      <button
        type="button"
        className="tw-tg-btn"
        title="Delete column"
        aria-label="Delete column"
        disabled={ncols <= 1}
        onClick={() => runOp({ kind: 'del-col', row: sel.row, col: sel.col })}
      >
        {ICON.delCol}
      </button>
      <span className="tw-tg-sep" aria-hidden="true" />
      <button
        type="button"
        className="tw-tg-btn"
        title="Align left"
        aria-label="Align left"
        aria-pressed={colAlign(sel.col) === 'left'}
        onClick={() => runOp({ kind: 'align', row: sel.row, col: sel.col, align: 'left' })}
      >
        {ICON.alignL}
      </button>
      <button
        type="button"
        className="tw-tg-btn"
        title="Align center"
        aria-label="Align center"
        aria-pressed={colAlign(sel.col) === 'center'}
        onClick={() => runOp({ kind: 'align', row: sel.row, col: sel.col, align: 'center' })}
      >
        {ICON.alignC}
      </button>
      <button
        type="button"
        className="tw-tg-btn"
        title="Align right"
        aria-label="Align right"
        aria-pressed={colAlign(sel.col) === 'right'}
        onClick={() => runOp({ kind: 'align', row: sel.row, col: sel.col, align: 'right' })}
      >
        {ICON.alignR}
      </button>
    </div>
  ) : null;

  const headerCols = Array.from({ length: ncols }, (_, c) => c);

  return (
    <div className="tw-table-grid" ref={wrapRef} onBlur={readOnly ? undefined : onWrapBlur}>
      {toolbar}
      <div className="tw-table-grid-scroll">
        <table className="tw-tg-table">
          <thead>
            <tr>
              {headerCols.map((c) => (
                <th key={c} {...cellProps(0, c)} />
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((_row, ri) => (
              <tr key={ri}>
                {headerCols.map((c) => (
                  <td key={c} {...cellProps(ri + 1, c)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Styles (injected into the editor's single stylesheet)
 * ------------------------------------------------------------------ */

export const TABLEGRID_CSS = `
.tw-table-grid{position:relative;margin:.6em 0;width:fit-content;max-width:100%}
.tw-table-grid-scroll{overflow-x:auto;border:1px solid var(--tw-line);border-radius:10px}
.tw-tg-table{border-collapse:collapse;font-size:14px}
.tw-tg-table th,.tw-tg-table td{border:1px solid var(--tw-line);padding:8px 13px;text-align:left;vertical-align:top;min-width:52px}
.tw-tg-table th{background:var(--tw-chip);font-weight:600;color:var(--tw-muted);font-size:12px;letter-spacing:.02em;text-transform:uppercase}
.tw-tg-table td{color:var(--tw-fg)}
.tw-tg-cell{outline:none}
.tw-tg-cell:empty::after{content:"";display:inline-block;min-height:1.15em}
.tw-tg-table th.tw-tg-sel,.tw-tg-table td.tw-tg-sel{box-shadow:inset 0 0 0 2px var(--tw-accent);background:var(--tw-accent-soft)}
.tw-tg-toolbar{position:absolute;top:0;right:0;z-index:6;transform:translateY(calc(-100% - 7px));display:flex;align-items:center;gap:3px;padding:4px 5px;border:1px solid var(--tw-line);border-radius:11px;background:color-mix(in srgb, var(--tw-bg) 82%, transparent);backdrop-filter:blur(18px) saturate(1.6);-webkit-backdrop-filter:blur(18px) saturate(1.6);box-shadow:0 6px 20px -10px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06);animation:tw-tg-pop .18s cubic-bezier(.32,.72,0,1)}
@keyframes tw-tg-pop{from{opacity:0;transform:translateY(calc(-100% + 2px))}to{opacity:1;transform:translateY(calc(-100% - 7px))}}
.tw-tg-sep{width:1px;height:18px;background:var(--tw-line);margin:0 3px}
.tw-tg-btn{min-width:28px;height:28px;padding:0 6px;border:1px solid transparent;background:transparent;border-radius:7px;color:var(--tw-muted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:color .15s,background .15s,border-color .15s}
.tw-tg-btn:hover{color:var(--tw-fg);background:var(--tw-accent-soft)}
.tw-tg-btn:disabled{opacity:.4;cursor:default}
.tw-tg-btn:disabled:hover{color:var(--tw-muted);background:transparent}
.tw-tg-btn[aria-pressed="true"]{color:var(--tw-accent);background:var(--tw-accent-soft);border-color:var(--tw-line)}
.tw-tg-btn svg{width:15px;height:15px}
@media (prefers-reduced-transparency: reduce){.tw-tg-toolbar{background:var(--tw-bg);backdrop-filter:none;-webkit-backdrop-filter:none}}
@media (prefers-reduced-motion: reduce){.tw-tg-toolbar{animation:none} .tw-tg-btn{transition:none}}
`;
