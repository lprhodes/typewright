/**
 * Heading-based folding.
 *
 * A heading folds away everything from the end of its line down to (but not
 * including) the next heading of the same or higher level — the standard
 * "collapse a section" affordance. Pure and offset-exact.
 */

import type { Document } from './ast';

/** A foldable region owned by a heading. `[from, to)` is the collapsible body. */
export interface FoldRange {
  /** Offset where the owning heading starts (its `#`). */
  headingFrom: number;
  /** The heading's level (1–6). */
  level: number;
  /** Start of the collapsible body — the end of the heading line. */
  from: number;
  /** End of the collapsible body — the next same-or-higher heading, or doc end. */
  to: number;
}

/**
 * One `FoldRange` per top-level heading: `from` is the heading node's `to` (end
 * of the heading line), `to` is the `from` of the next heading whose level is
 * `<=` this heading's level (or the document's `to` if there is none). Ranges
 * with an empty body (`to <= from`) are omitted.
 */
export function headingFoldRanges(doc: Document): FoldRange[] {
  const blocks = doc.children;
  const ranges: FoldRange[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const h = blocks[i];
    if (!h || h.type !== 'heading') continue;

    let to = doc.to;
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j];
      if (n && n.type === 'heading' && n.level <= h.level) {
        to = n.from;
        break;
      }
    }

    const from = h.to;
    if (to > from) {
      ranges.push({ headingFrom: h.from, level: h.level, from, to });
    }
  }

  return ranges;
}
