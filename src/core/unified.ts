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

/**
 * A hideable syntax-marker range: `[from, to)` with a `kind` tag.
 *
 * `kind` is an open string (not a closed union) so new marker families can be
 * added without a breaking type change. The kinds currently emitted are
 * `heading`, `emphasis`, `strong`, `strike`, `code`, `link`, `image`,
 * `listMarker`, `math`, `footnoteRef`, `fence` and `blockquote`.
 */
export interface Marker extends Pos {
  kind: string;
}

/**
 * Every hideable syntax-marker range in the document, in document order.
 *
 * Covers: heading `#… ` prefixes, the two emphasis/strong/strike delimiter runs
 * on each side, inline-code backtick fences, link `[`/`](`/url/`)` pieces, the
 * image `!` (plus its bracket/paren pieces), list-item markers, inline-math `$`
 * (or `$$`) delimiters, and footnote-reference `[^`/`]` brackets.
 *
 * When the original `source` string is supplied it additionally emits the
 * `fence` (opening + closing fenced-code lines) and `blockquote` (the leading
 * `>` run on each quoted line) markers — these need the raw text to be
 * offset-exact, so they are omitted when `source` is not passed (keeping the
 * source-free call identical to before). Always pure; never mutates.
 */
export function collectMarkers(doc: Document, source?: string): Marker[] {
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
      case 'math': {
        // The `$` (inline) / `$$` (display) fences on each side of the source.
        const delim = node.display ? 2 : 1;
        const openTo = Math.min(node.from + delim, node.to);
        const closeFrom = Math.max(node.to - delim, openTo);
        push(node.from, openTo, 'math'); // opening `$`/`$$`
        push(closeFrom, node.to, 'math'); // closing `$`/`$$`
        break;
      }
      case 'footnoteRef': {
        // `[^` opener and `]` closer; the id between them stays as content.
        const openTo = Math.min(node.from + 2, node.to);
        const closeFrom = Math.max(node.to - 1, openTo);
        push(node.from, openTo, 'footnoteRef'); // `[^`
        push(closeFrom, node.to, 'footnoteRef'); // `]`
        break;
      }
      case 'codeBlock': {
        // Only *fenced* blocks have marker lines (indented code has none), and
        // we need the raw text to locate the fence lines offset-exactly.
        if (!source || !node.fenced) break;
        // Opening fence line: the ``` `` ``/`~~~` run + info string, up to the
        // end of that first source line (the trailing newline is excluded).
        let openTo = source.indexOf('\n', node.from);
        if (openTo === -1 || openTo > node.to) openTo = node.to;
        if (openTo > node.from && source[openTo - 1] === '\r') openTo--;
        push(node.from, openTo, 'fence'); // opening fence line
        // Closing fence line: the block's last source line, emitted only when it
        // is a real closing fence. An unterminated fence's last line is content
        // (the parser would have closed on a genuine fence line), so the regex
        // check never false-fires; a container-nested close that does not sit at
        // the physical line start simply isn't emitted (never a wrong offset).
        const closeStart = source.lastIndexOf('\n', node.to - 1) + 1;
        if (closeStart > node.from) {
          const closeText = source.slice(closeStart, node.to);
          const cm = /^( {0,3})(`{3,}|~{3,}) *$/.exec(closeText);
          const om = /^ {0,3}([`~])/.exec(source.slice(node.from, openTo));
          if (cm && om && cm[2]![0] === om[1]) push(closeStart, node.to, 'fence'); // closing fence line
        }
        break;
      }
      case 'blockquote': {
        if (!source) break;
        // Emit the leading `>` run per line only for a *root* blockquote whose
        // first line starts at a physical line boundary. For such a blockquote
        // every line in [from,to) begins with its quote run, which we can read
        // directly and offset-exactly. A blockquote nested inside another (its
        // `from` sits after an outer `>` prefix) is skipped — its prefixes are
        // already covered by the outer root's full per-line run.
        const lineStart = source.lastIndexOf('\n', node.from - 1) + 1;
        if (lineStart !== node.from) break;
        let p = node.from;
        while (p < node.to) {
          let end = source.indexOf('\n', p);
          if (end === -1 || end > node.to) end = node.to;
          // The stacked quote prefix on this line: `( {0,3}> ?)+`.
          const qm = /^(?: {0,3}> ?)+/.exec(source.slice(p, end));
          if (qm) push(p, p + qm[0].length, 'blockquote');
          p = end + 1; // step over the newline; exits when end === node.to
        }
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
 *
 * `source` is forwarded to {@link collectMarkers} so the fence/blockquote
 * markers participate in the reveal too; omit it to keep the source-free set.
 * The selection filter itself is unchanged.
 */
export function hiddenMarkers(
  doc: Document,
  sel: { from: number; to: number },
  source?: string,
): Marker[] {
  const lo = Math.min(sel.from, sel.to) - 1;
  const hi = Math.max(sel.from, sel.to) + 1;
  // Half-open overlap of marker [from,to) with widened selection [lo,hi).
  const intersects = (m: Marker): boolean => m.from < hi && lo < m.to;
  return collectMarkers(doc, source).filter((m) => !intersects(m));
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
