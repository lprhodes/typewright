/**
 * Unified (Obsidian-style live-preview) source-revealing logic.
 *
 * In `unified` mode the formatting renders inline, but the raw syntax markers
 * (a heading's `### `, an emphasis `*`, a link's `](url)`, …) are hidden UNLESS
 * the caret/selection is on top of them — then they reveal so you can edit the
 * source. This module is pure and offset-exact: it maps the AST to the set of
 * hideable marker ranges (`collectMarkers`) and decides which stay hidden for a
 * given selection (`hiddenMarkers`). It never mutates the tree or the string.
 */

import { walk } from './ast';
import type { Document, Pos } from './ast';

/** A hideable syntax-marker range: `[from, to)` with a `kind` tag. */
export interface Marker extends Pos {
  kind: string;
}

/**
 * Every hideable syntax-marker range in the document, in document order.
 *
 * Covers: heading `#… ` prefixes, the two emphasis/strong/strike delimiter runs
 * on each side, inline-code backtick fences, link `[`/`](`/url/`)` pieces, the
 * image `!` (plus its bracket/paren pieces), and list-item markers.
 */
export function collectMarkers(doc: Document): Marker[] {
  const markers: Marker[] = [];
  const push = (from: number, to: number, kind: string): void => {
    if (to > from) markers.push({ from, to, kind });
  };

  walk(doc, (node) => {
    switch (node.type) {
      case 'heading': {
        // '#… ' prefix up to the start of content.
        push(node.from, node.contentFrom, 'heading');
        break;
      }
      case 'emphasis':
      case 'strong':
      case 'strikethrough': {
        const kind = node.type === 'strikethrough' ? 'strike' : node.type;
        const kids = node.children;
        const first = kids[0];
        const last = kids[kids.length - 1];
        const innerFrom = first ? first.from : node.to;
        const innerTo = last ? last.to : node.from;
        push(node.from, innerFrom, kind); // opening delimiter run
        push(innerTo, node.to, kind); // closing delimiter run
        break;
      }
      case 'inlineCode': {
        const ticks = Math.max(1, node.ticks);
        const openTo = Math.min(node.from + ticks, node.to);
        const closeFrom = Math.max(node.to - ticks, openTo);
        push(node.from, openTo, 'code'); // opening backtick fence
        push(closeFrom, node.to, 'code'); // closing backtick fence
        break;
      }
      case 'link': {
        const kids = node.children;
        const last = kids[kids.length - 1];
        const textEnd = last ? last.to : node.from + 1;
        const midTo = Math.min(textEnd + 2, node.to);
        push(node.from, Math.min(node.from + 1, node.to), 'link'); // '['
        push(textEnd, midTo, 'link'); // ']('
        push(midTo, node.to - 1, 'link'); // url (+ optional title)
        push(Math.max(node.to - 1, node.from), node.to, 'link'); // ')'
        break;
      }
      case 'image': {
        const bracketOpen = node.from + 1;
        const altStart = bracketOpen + 1;
        const altEnd = Math.min(altStart + node.alt.length, node.to);
        const midTo = Math.min(altEnd + 2, node.to);
        push(node.from, Math.min(node.from + 1, node.to), 'image'); // '!'
        push(bracketOpen, Math.min(bracketOpen + 1, node.to), 'image'); // '['
        push(altEnd, midTo, 'image'); // ']('
        push(midTo, node.to - 1, 'image'); // url (+ optional title)
        push(Math.max(node.to - 1, node.from), node.to, 'image'); // ')'
        break;
      }
      case 'listItem': {
        // The list marker up to the start of item content (`- `, `1. `, `- [x] `).
        push(node.from, node.contentFrom, 'listMarker');
        break;
      }
    }
    return true;
  });

  return markers;
}

/**
 * The markers that stay HIDDEN for a given selection: those whose `[from, to)`
 * does NOT intersect the selection widened by 1 on each side. Markers that DO
 * intersect are revealed (returned excluded), so the caret can edit the raw
 * syntax it sits on — the live-preview reveal rule.
 */
export function hiddenMarkers(doc: Document, sel: { from: number; to: number }): Marker[] {
  const lo = Math.min(sel.from, sel.to) - 1;
  const hi = Math.max(sel.from, sel.to) + 1;
  // Half-open overlap of marker [from,to) with widened selection [lo,hi).
  const intersects = (m: Marker): boolean => m.from < hi && lo < m.to;
  return collectMarkers(doc).filter((m) => !intersects(m));
}

/**
 * Index into `doc.children` of the top-level block whose inclusive `[from, to]`
 * range contains `offset`, or -1 when the offset falls in a gap between blocks.
 */
export function activeBlockIndex(doc: Document, offset: number): number {
  const blocks = doc.children;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && offset >= b.from && offset <= b.to) return i;
  }
  return -1;
}
