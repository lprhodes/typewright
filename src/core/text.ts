/**
 * Document model — an immutable text container with transaction-based edits and
 * position mapping. The string is the source of truth (SPEC.md §4.1): every edit
 * is a `{from, to, insert}` change, applying one returns a NEW `TextDoc`, and
 * offsets can be mapped across a change so decorations / anchors survive edits.
 */

export interface Change {
  /** Inclusive start offset of the replaced range. */
  from: number;
  /** Exclusive end offset of the replaced range. */
  to: number;
  /** Text inserted in place of `[from, to)`. */
  insert: string;
}

export interface LineInfo {
  /** 1-based line number. */
  number: number;
  /** Offset of the first character of the line. */
  from: number;
  /** Offset just past the last character (before the newline). */
  to: number;
  /** The line's text (without the trailing newline). */
  text: string;
}

export interface Position {
  /** 1-based line. */
  line: number;
  /** 1-based column (UTF-16 units within the line). */
  column: number;
}

export class TextDoc {
  readonly text: string;
  private _lineStarts: number[] | null = null;

  constructor(text = '') {
    this.text = text;
  }

  get length(): number {
    return this.text.length;
  }

  /** Apply one change, returning a new document. */
  apply(change: Change): TextDoc {
    const { from, to, insert } = normalize(change, this.text.length);
    return new TextDoc(this.text.slice(0, from) + insert + this.text.slice(to));
  }

  /**
   * Apply several changes, returning a new document. Changes are given in
   * document coordinates of THIS doc; they are applied right-to-left so earlier
   * offsets stay valid.
   */
  applyAll(changes: Change[]): TextDoc {
    const sorted = [...changes].sort((a, b) => b.from - a.from);
    let text = this.text;
    for (const c of sorted) {
      const { from, to, insert } = normalize(c, text.length);
      text = text.slice(0, from) + insert + text.slice(to);
    }
    return new TextDoc(text);
  }

  private lineStarts(): number[] {
    if (this._lineStarts) return this._lineStarts;
    const starts = [0];
    for (let i = 0; i < this.text.length; i++) {
      if (this.text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
    }
    this._lineStarts = starts;
    return starts;
  }

  /** Total number of lines (a trailing newline yields an extra empty line). */
  get lines(): number {
    return this.lineStarts().length;
  }

  /** The line (1-based) containing `offset`. */
  lineAt(offset: number): LineInfo {
    const off = clamp(offset, 0, this.text.length);
    const starts = this.lineStarts();
    // binary search for the last start <= off
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    const from = starts[lo]!;
    const nextStart = starts[lo + 1];
    const to = nextStart === undefined ? this.text.length : nextStart - 1;
    return { number: lo + 1, from, to, text: this.text.slice(from, to) };
  }

  /** Line/column (both 1-based) for an offset. */
  positionAt(offset: number): Position {
    const line = this.lineAt(offset);
    return { line: line.number, column: clamp(offset, 0, this.text.length) - line.from + 1 };
  }

  /** Offset for a 1-based line/column. */
  offsetAt(line: number, column: number): number {
    const starts = this.lineStarts();
    const idx = clamp(line, 1, starts.length) - 1;
    const from = starts[idx]!;
    const nextStart = starts[idx + 1];
    const to = nextStart === undefined ? this.text.length : nextStart - 1;
    return clamp(from + (column - 1), from, to);
  }

  /**
   * Map an offset from this document's coordinates to the coordinates AFTER the
   * given change(s). `assoc` controls which side of an insertion at the offset
   * the mapped position sticks to: -1 = before (default), 1 = after.
   */
  mapOffset(offset: number, changes: Change | Change[], assoc: -1 | 1 = -1): number {
    const list = Array.isArray(changes) ? changes : [changes];
    // apply in document order; each change shifts offsets after it
    const ordered = [...list].sort((a, b) => a.from - b.from);
    let result = offset;
    for (const c of ordered) {
      const { from, to, insert } = normalize(c, Number.MAX_SAFE_INTEGER);
      const delta = insert.length - (to - from);
      if (result < from) continue;
      if (result > to) {
        result += delta;
      } else if (result === from && assoc < 0) {
        // stays at from
      } else if (result === to && assoc > 0) {
        result += delta;
      } else {
        // inside the replaced range: collapse toward the edit boundary
        result = assoc < 0 ? from : from + insert.length;
      }
    }
    return result;
  }

  toString(): string {
    return this.text;
  }
}

function normalize(change: Change, len: number): Change {
  let from = clamp(Math.min(change.from, change.to), 0, len);
  let to = clamp(Math.max(change.from, change.to), 0, len);
  return { from, to, insert: change.insert };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
