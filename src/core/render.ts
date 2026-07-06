/**
 * AST → sanitized HTML renderer.
 *
 * This is the `read`/`preview` output path (SPEC.md §4): it walks the offset-exact
 * AST produced by the parser and emits HTML that is safe to inject into a host
 * page. Safety is structural, not incidental:
 *
 *  - every text / attribute value is HTML-escaped (`&`, `<`, `>`, `"`);
 *  - every URL passes {@link safeUrl}, so `javascript:` / `data:` / other active
 *    schemes collapse to `#`;
 *  - raw HTML / MDX blocks are emitted ESCAPED inside `<pre>` — this renderer
 *    never re-emits untrusted markup, so it can be used on model output.
 *
 * The renderer never throws: malformed / partial nodes degrade to escaped text.
 */

import type {
  Block,
  Document,
  Inline,
  ListItem,
  Table,
  TableCell,
} from './ast';

/** Hard cap on a URL length we are willing to place in an attribute. */
const MAX_URL = 8192;
/** Schemes we consider inert enough to keep. */
const SAFE_SCHEMES = /^(https?:|mailto:)/;

/* ------------------------------------------------------------------ *
 * Escaping + URL safety
 * ------------------------------------------------------------------ */

/** Escape the five characters that matter in HTML text / double-quoted attrs. */
function escapeHtml(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    switch (ch) {
      case 38 /* & */:
        out += '&amp;';
        break;
      case 60 /* < */:
        out += '&lt;';
        break;
      case 62 /* > */:
        out += '&gt;';
        break;
      case 34 /* " */:
        out += '&quot;';
        break;
      default:
        out += value[i];
    }
  }
  return out;
}

/**
 * Return `url` when it is safe to place in an `href`/`src`, otherwise `'#'`.
 *
 * Safe = an http/https/mailto absolute URL, OR anything without an explicit
 * scheme (relative paths, `?query`, `#anchor`, protocol-relative `//host`).
 * Any other scheme (`javascript:`, `data:`, `vbscript:`, `file:`, …) is denied.
 *
 * Scheme detection is done against a copy with whitespace + control characters
 * stripped, so obfuscations like `java\tscript:` or a leading newline can't
 * smuggle an active scheme past the check.
 */
export function safeUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) return '#';
  const trimmed = url.trim().slice(0, MAX_URL);
  if (trimmed === '') return '#';

  // Fold away whitespace + C0/DEL controls for the scheme test ONLY.
  const probe = trimmed.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
  if (probe === '') return '#';

  // An allowed absolute scheme is fine.
  if (SAFE_SCHEMES.test(probe)) return trimmed;

  // Any OTHER explicit scheme (letter run followed by a colon) is denied.
  // Relative / anchor / protocol-relative URLs never match (they start with
  // `#`, `/`, `.`, `?`, or a bare path segment with no leading scheme colon).
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return '#';

  return trimmed;
}

/** Convenience: an escaped, safety-checked URL ready for an attribute. */
function attrUrl(url: string): string {
  return escapeHtml(safeUrl(url));
}

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

/** Render a run of inline nodes to sanitized HTML. */
export function renderInline(nodes: Inline[]): string {
  let out = '';
  for (const node of nodes) out += renderInlineNode(node);
  return out;
}

function renderInlineNode(node: Inline): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'strong':
      return `<strong>${renderInline(node.children)}</strong>`;
    case 'emphasis':
      return `<em>${renderInline(node.children)}</em>`;
    case 'strikethrough':
      return `<del>${renderInline(node.children)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'link': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<a href="${attrUrl(node.url)}"${title}>${renderInline(node.children)}</a>`;
    }
    case 'image': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<img src="${attrUrl(node.url)}" alt="${escapeHtml(node.alt)}"${title}>`;
    }
    case 'autolink':
      return `<a href="${attrUrl(node.url)}">${escapeHtml(node.url)}</a>`;
    case 'break':
      return node.hard ? '<br>\n' : '\n';
    case 'math':
      // Safe default: escaped source. A math engine replaces this in a later pass.
      return `<code class="tw-math-src">${escapeHtml(node.value)}</code>`;
    case 'footnoteRef':
      return `<sup class="tw-footnote-ref">${escapeHtml(node.id)}</sup>`;
    default: {
      // Exhaustiveness guard — a new inline type must be handled above.
      const _never: never = node;
      return _never as never;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

/** Render a single block node to sanitized HTML. */
export function renderNode(node: Block): string {
  switch (node.type) {
    case 'heading': {
      const l = node.level;
      return `<h${l}>${renderInline(node.children)}</h${l}>`;
    }
    case 'paragraph':
      return `<p>${renderInline(node.children)}</p>`;
    case 'blockquote':
      return `<blockquote>${renderBlocks(node.children)}</blockquote>`;
    case 'list':
      return renderList(node.ordered, node.start, node.tight, node.items);
    case 'codeBlock': {
      const cls = node.lang
        ? ` class="language-${escapeHtml(node.lang)}"`
        : '';
      return `<pre><code${cls}>${escapeHtml(node.value)}</code></pre>`;
    }
    case 'thematicBreak':
      return '<hr>';
    case 'table':
      return renderTable(node);
    case 'htmlBlock':
      // The safety boundary: raw HTML / MDX is emitted ESCAPED, never live.
      return `<pre>${escapeHtml(node.value)}</pre>`;
    case 'mathBlock':
      // Safe default: escaped source. A math engine replaces this in a later pass.
      return `<pre class="tw-math-src">${escapeHtml(node.value)}</pre>`;
    case 'footnoteDef':
      return `<div class="tw-footnote-def">${renderBlocks(node.children)}</div>`;
    case 'defList': {
      let out = '';
      for (const item of node.items) {
        out += `<dt>${renderInline(item.term)}</dt>`;
        for (const def of item.definitions) out += `<dd>${renderBlocks(def)}</dd>`;
      }
      return `<dl>${out}</dl>`;
    }
    default: {
      const _never: never = node;
      return _never as never;
    }
  }
}

function renderBlocks(blocks: Block[]): string {
  let out = '';
  for (const b of blocks) out += renderNode(b);
  return out;
}

function renderList(
  ordered: boolean,
  start: number,
  tight: boolean,
  items: ListItem[],
): string {
  const tag = ordered ? 'ol' : 'ul';
  const startAttr =
    ordered && Number.isFinite(start) && start !== 1
      ? ` start="${escapeHtml(String(Math.trunc(start)))}"`
      : '';
  let body = '';
  for (const item of items) body += renderListItem(item, tight);
  return `<${tag}${startAttr}>${body}</${tag}>`;
}

function renderListItem(item: ListItem, tight: boolean): string {
  let checkbox = '';
  if (item.task !== null) {
    const checked = item.task === 'checked' ? ' checked' : '';
    checkbox = `<input type="checkbox" disabled${checked}> `;
  }
  return `<li>${checkbox}${renderItemChildren(item.children, tight)}</li>`;
}

/**
 * In a tight list a lone paragraph child renders WITHOUT its `<p>` wrapper
 * (GFM tight-list behaviour), so a task item reads `<li><input…> text</li>`.
 * Loose lists keep full block structure.
 */
function renderItemChildren(children: Block[], tight: boolean): string {
  if (tight) {
    let out = '';
    for (const child of children) {
      out +=
        child.type === 'paragraph'
          ? renderInline(child.children)
          : renderNode(child);
    }
    return out;
  }
  return renderBlocks(children);
}

function renderTable(node: Table): string {
  const align = node.align;
  const cellStyle = (col: number): string => {
    const a = align[col];
    return a ? ` style="text-align:${a}"` : '';
  };

  const headCells = renderRow(node.header, 'th', cellStyle);
  const head = `<thead><tr>${headCells}</tr></thead>`;

  let bodyRows = '';
  for (const row of node.rows) {
    bodyRows += `<tr>${renderRow(row, 'td', cellStyle)}</tr>`;
  }
  const body = `<tbody>${bodyRows}</tbody>`;

  return `<table>${head}${body}</table>`;
}

function renderRow(
  cells: TableCell[],
  tag: 'th' | 'td',
  cellStyle: (col: number) => string,
): string {
  let out = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    out += `<${tag}${cellStyle(i)}>${renderInline(cell.children)}</${tag}>`;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

/** Render a whole document to sanitized HTML. */
export function renderToHtml(doc: Document): string {
  return renderBlocks(doc.children);
}
