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
 *    never re-emits untrusted markup, so it can be used on model output;
 *  - footnote / definition ids are slugged to a URL-safe charset *and* escaped
 *    before they reach an `id`/`href` attribute.
 *
 * The renderer never throws: malformed / partial nodes degrade to escaped text.
 *
 * {@link RenderOptions} lets a host plug in escaped-HTML producers for the two
 * constructs the core cannot render on its own — syntax highlighting and a math
 * engine. Both are trusted to return already-escaped HTML; without them the
 * renderer falls back to the safe escaped-source form. Passing no options
 * reproduces the exact default behaviour.
 */

import { walk } from './ast';
import type {
  Block,
  Document,
  FootnoteDef,
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
 * Host-supplied render hooks
 * ------------------------------------------------------------------ */

/**
 * Optional, host-supplied output producers for constructs the core cannot
 * render itself. Both hooks MUST return already-escaped, safe HTML — the
 * renderer trusts their output and does not re-escape it. Omitting a hook (or
 * the whole object) falls back to the safe escaped-source form.
 */
export interface RenderOptions {
  /**
   * Syntax highlighter for fenced code. Receives the fence info string and the
   * raw code; returns escaped HTML (e.g. `<span class="tw-tok-…">` runs). The
   * host is responsible for escaping — see {@link highlightToHtml}.
   */
  highlight?: (lang: string, code: string) => string;
  /**
   * Math engine. Receives the TeX source and whether it is display math;
   * returns escaped/safe HTML. Without it, math renders as escaped source.
   */
  math?: (src: string, display: boolean) => string;
}

/**
 * Per-render footnote numbering context. Footnote references are numbered in
 * first-seen order across a single render pass (keyed by the slugged id, so
 * repeated references to the same note share a number). Held in a small object
 * threaded through the walk rather than in module state, so rendering stays
 * re-entrant.
 */
interface FnCtx {
  /** Slugged footnote id → its 1-based display number, in first-seen order. */
  nums: Map<string, number>;
}

function newFnCtx(): FnCtx {
  return { nums: new Map() };
}

/** The display number for a footnote id, allocating one on first sight. */
function fnNumber(ctx: FnCtx, slug: string): number {
  const existing = ctx.nums.get(slug);
  if (existing !== undefined) return existing;
  const n = ctx.nums.size + 1;
  ctx.nums.set(slug, n);
  return n;
}

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
 * Reduce a footnote label to a slug that is safe both as an `id` attribute and
 * as a `#fragment` in an `href`: keep ASCII letters/digits/`_`/`-`, collapse any
 * other run to a single `-`. An empty result falls back to `_` so the id is
 * never blank. The same slug is applied to refs and defs, so their ids match.
 */
function slugFootnoteId(id: string): string {
  const slug = id.replace(/[^A-Za-z0-9_-]+/g, '-');
  return slug === '' ? '_' : slug;
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
export function renderInline(nodes: Inline[], options?: RenderOptions): string {
  return inlineRun(nodes, options, newFnCtx());
}

function inlineRun(
  nodes: Inline[],
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  let out = '';
  for (const node of nodes) out += renderInlineNode(node, options, ctx);
  return out;
}

function renderInlineNode(
  node: Inline,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'strong':
      return `<strong>${inlineRun(node.children, options, ctx)}</strong>`;
    case 'emphasis':
      return `<em>${inlineRun(node.children, options, ctx)}</em>`;
    case 'strikethrough':
      return `<del>${inlineRun(node.children, options, ctx)}</del>`;
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'link': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<a href="${attrUrl(node.url)}"${title}>${inlineRun(node.children, options, ctx)}</a>`;
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
      // Host math engine (trusted, returns escaped HTML) or safe escaped source.
      return options?.math
        ? options.math(node.value, node.display)
        : `<span class="tw-math-src">${escapeHtml(node.value)}</span>`;
    case 'footnoteRef': {
      // GitHub-style superscript back-reference. The def with the matching id
      // is collected + rendered once at the end of the document (see
      // renderToHtml). Number is first-seen order; id links the two ends.
      const slug = slugFootnoteId(node.id);
      const n = fnNumber(ctx, slug);
      const safe = escapeHtml(slug);
      return `<sup class="tw-fnref" id="fnref-${safe}"><a href="#fn-${safe}">[${n}]</a></sup>`;
    }
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
export function renderNode(node: Block, options?: RenderOptions): string {
  return renderBlockNode(node, options, newFnCtx());
}

function renderBlockNode(
  node: Block,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  switch (node.type) {
    case 'heading': {
      const l = node.level;
      return `<h${l}>${inlineRun(node.children, options, ctx)}</h${l}>`;
    }
    case 'paragraph':
      return `<p>${inlineRun(node.children, options, ctx)}</p>`;
    case 'blockquote':
      return `<blockquote>${renderBlocks(node.children, options, ctx)}</blockquote>`;
    case 'list':
      return renderList(node.ordered, node.start, node.tight, node.items, options, ctx);
    case 'codeBlock': {
      const cls = node.lang
        ? ` class="language-${escapeHtml(node.lang)}"`
        : '';
      // The highlighter is trusted to return escaped HTML; the default path
      // escapes here so raw code is never emitted live either way.
      const body = options?.highlight
        ? options.highlight(node.lang, node.value)
        : escapeHtml(node.value);
      return `<pre><code${cls}>${body}</code></pre>`;
    }
    case 'thematicBreak':
      return '<hr>';
    case 'table':
      return renderTable(node, options, ctx);
    case 'htmlBlock':
      // The safety boundary: raw HTML / MDX is emitted ESCAPED, never live.
      return `<pre>${escapeHtml(node.value)}</pre>`;
    case 'mathBlock':
      // A math block is always display math; host engine or escaped source.
      return options?.math
        ? options.math(node.value, true)
        : `<div class="tw-math-src">${escapeHtml(node.value)}</div>`;
    case 'footnoteDef':
      // Canonical placement is the collected <section> that renderToHtml
      // appends. A standalone renderNode(footnoteDef) still renders its body
      // for completeness (renderBlocks skips defs only in document flow).
      return `<div class="tw-footnote-def">${renderBlocks(node.children, options, ctx)}</div>`;
    case 'defList': {
      let out = '';
      for (const item of node.items) {
        out += `<dt>${inlineRun(item.term, options, ctx)}</dt>`;
        for (const def of item.definitions) {
          out += `<dd>${renderBlocks(def, options, ctx)}</dd>`;
        }
      }
      return `<dl>${out}</dl>`;
    }
    default: {
      const _never: never = node;
      return _never as never;
    }
  }
}

/**
 * Render a sequence of blocks in document flow. Footnote definitions are
 * skipped here: they are collected by {@link renderToHtml} and emitted once as
 * a trailing `<section>`, never inline where they were authored.
 */
function renderBlocks(
  blocks: Block[],
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  let out = '';
  for (const b of blocks) {
    if (b.type === 'footnoteDef') continue;
    out += renderBlockNode(b, options, ctx);
  }
  return out;
}

function renderList(
  ordered: boolean,
  start: number,
  tight: boolean,
  items: ListItem[],
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  const tag = ordered ? 'ol' : 'ul';
  const startAttr =
    ordered && Number.isFinite(start) && start !== 1
      ? ` start="${escapeHtml(String(Math.trunc(start)))}"`
      : '';
  let body = '';
  for (const item of items) body += renderListItem(item, tight, options, ctx);
  return `<${tag}${startAttr}>${body}</${tag}>`;
}

function renderListItem(
  item: ListItem,
  tight: boolean,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  let checkbox = '';
  if (item.task !== null) {
    const checked = item.task === 'checked' ? ' checked' : '';
    checkbox = `<input type="checkbox" disabled${checked}> `;
  }
  return `<li>${checkbox}${renderItemChildren(item.children, tight, options, ctx)}</li>`;
}

/**
 * In a tight list a lone paragraph child renders WITHOUT its `<p>` wrapper
 * (GFM tight-list behaviour), so a task item reads `<li><input…> text</li>`.
 * Loose lists keep full block structure.
 */
function renderItemChildren(
  children: Block[],
  tight: boolean,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  if (tight) {
    let out = '';
    for (const child of children) {
      out +=
        child.type === 'paragraph'
          ? inlineRun(child.children, options, ctx)
          : renderBlockNode(child, options, ctx);
    }
    return out;
  }
  return renderBlocks(children, options, ctx);
}

function renderTable(
  node: Table,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  const align = node.align;
  const cellStyle = (col: number): string => {
    const a = align[col];
    return a ? ` style="text-align:${a}"` : '';
  };

  const headCells = renderRow(node.header, 'th', cellStyle, options, ctx);
  const head = `<thead><tr>${headCells}</tr></thead>`;

  let bodyRows = '';
  for (const row of node.rows) {
    bodyRows += `<tr>${renderRow(row, 'td', cellStyle, options, ctx)}</tr>`;
  }
  const body = `<tbody>${bodyRows}</tbody>`;

  return `<table>${head}${body}</table>`;
}

function renderRow(
  cells: TableCell[],
  tag: 'th' | 'td',
  cellStyle: (col: number) => string,
  options: RenderOptions | undefined,
  ctx: FnCtx,
): string {
  let out = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    out += `<${tag}${cellStyle(i)}>${inlineRun(cell.children, options, ctx)}</${tag}>`;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

/** Every footnote definition in the document, in document order. */
function collectFootnoteDefs(doc: Document): FootnoteDef[] {
  const defs: FootnoteDef[] = [];
  walk(doc, (n) => {
    if (n.type === 'footnoteDef') {
      defs.push(n);
      return false; // don't descend into a def's body while collecting
    }
    return true;
  });
  return defs;
}

/** Render a whole document to sanitized HTML. */
export function renderToHtml(doc: Document, options?: RenderOptions): string {
  const ctx = newFnCtx();
  let out = renderBlocks(doc.children, options, ctx);

  // Collect every footnote definition (from anywhere in the tree) and emit it
  // once, GitHub-style, as a trailing ordered list with a back-link per note.
  const defs = collectFootnoteDefs(doc);
  if (defs.length > 0) {
    let items = '';
    for (const def of defs) {
      const safe = escapeHtml(slugFootnoteId(def.id));
      items +=
        `<li id="fn-${safe}">` +
        renderBlocks(def.children, options, ctx) +
        ` <a href="#fnref-${safe}" class="tw-fn-back">↩</a>` +
        `</li>`;
    }
    out += `<section class="tw-footnotes"><ol>${items}</ol></section>`;
  }

  return out;
}
