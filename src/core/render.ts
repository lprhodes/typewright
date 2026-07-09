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
  Heading,
  Inline,
  ListItem,
  Table,
  TableCell,
} from './ast';
import { buildHeadingIds } from './outline';

/** Hard cap on a URL length we are willing to place in an attribute. */
const MAX_URL = 8192;
/** Schemes we consider inert enough to keep. */
const SAFE_SCHEMES = /^(https?:|mailto:)/;

/* ------------------------------------------------------------------ *
 * Host-supplied render hooks
 * ------------------------------------------------------------------ */

/**
 * Class names to attach to the elements the renderer emits, so rendered content
 * adopts a host's design system without brittle descendant-selector CSS or a
 * post-render DOM walk.
 *
 * Every entry is ADDITIVE and optional. Where the renderer already emits a class
 * of its own (`tw-footnotes`, `language-ts`, …) the mapped name is appended to
 * it, never replaced — so existing stylesheets keep working. Omitting `classMap`
 * entirely reproduces byte-identical output.
 *
 * `heading` applies to every heading level; `h1`…`h6` add to it rather than
 * replace it, so `{ heading: 'hd', h2: 'hd--section' }` yields
 * `class="hd hd--section"`. The same additive rule holds for `list` +
 * `orderedList` / `unorderedList`, and `listItem` + `taskListItem`.
 *
 * ```ts
 * renderToHtml(doc, {
 *   headingIds: true,
 *   classMap: { blockquote: 'callout', table: 'spec-table' },
 * });
 * ```
 */
export interface ClassMap {
  heading?: string;
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  h5?: string;
  h6?: string;
  paragraph?: string;
  blockquote?: string;
  /** Both `<ul>` and `<ol>`. */
  list?: string;
  orderedList?: string;
  unorderedList?: string;
  listItem?: string;
  /** A `<li>` carrying a task checkbox. */
  taskListItem?: string;
  /** The `<pre>` of a fenced/indented code block. */
  codeBlock?: string;
  /** The `<code>` inside a code block; appended after `language-*`. */
  code?: string;
  inlineCode?: string;
  thematicBreak?: string;
  table?: string;
  tableHead?: string;
  tableBody?: string;
  tableRow?: string;
  tableHeaderCell?: string;
  tableCell?: string;
  /** The `<pre>` wrapping escaped raw HTML / MDX. */
  htmlBlock?: string;
  link?: string;
  image?: string;
  strong?: string;
  emphasis?: string;
  strikethrough?: string;
  mathInline?: string;
  mathBlock?: string;
  footnoteRef?: string;
  footnoteDef?: string;
  footnotes?: string;
  footnoteBackref?: string;
  definitionList?: string;
  definitionTerm?: string;
  definitionDescription?: string;
}

/**
 * Optional, host-supplied output producers for constructs the core cannot
 * render itself, plus the presentation hooks a content site needs.
 *
 * The `highlight` / `math` hooks MUST return already-escaped, safe HTML — the
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
  /**
   * Emit a unique, URL-safe `id` on every heading so `#anchor` links resolve.
   *
   * Ids come from the same allocator `outline()` uses, so the two agree exactly
   * — a TOC built from `outline(doc)` always links live anchors. Only meaningful
   * for {@link renderToHtml}, which has the whole document: {@link renderNode}
   * renders a lone block and cannot allocate a document-unique id, so it emits
   * none. Headings inside footnote definitions are likewise unidentified, since
   * the renderer hoists those out of document flow.
   */
  headingIds?: boolean;
  /** Class names to attach to emitted elements. See {@link ClassMap}. */
  classMap?: ClassMap;
}

/**
 * Per-render state, threaded through the walk rather than held in module state,
 * so rendering stays re-entrant.
 *
 * Footnote references are numbered in first-seen order across a single render
 * pass (keyed by the slugged id, so repeated references to the same note share a
 * number). Heading ids are pre-allocated per document by {@link buildHeadingIds}
 * and looked up by node identity — the renderer never slugs on its own, which is
 * what makes its ids identical to `outline()`'s.
 */
interface RenderCtx {
  /** Slugged footnote id → its 1-based display number, in first-seen order. */
  nums: Map<string, number>;
  /** Heading node → its document-unique id. Absent when `headingIds` is off. */
  ids?: Map<Heading, string>;
}

function newCtx(ids?: Map<Heading, string>): RenderCtx {
  return ids ? { nums: new Map(), ids } : { nums: new Map() };
}

/** The display number for a footnote id, allocating one on first sight. */
function fnNumber(ctx: RenderCtx, slug: string): number {
  const existing = ctx.nums.get(slug);
  if (existing !== undefined) return existing;
  const n = ctx.nums.size + 1;
  ctx.nums.set(slug, n);
  return n;
}

/* ------------------------------------------------------------------ *
 * Attributes
 * ------------------------------------------------------------------ */

/**
 * Build a ` class="…"` attribute from the non-empty names given, in order.
 * Returns `''` when nothing survives, so an element with no classes emits no
 * attribute at all — this is what keeps default output byte-identical.
 */
function classAttr(...names: (string | undefined)[]): string {
  let merged = '';
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const trimmed = name.trim();
    if (trimmed === '') continue;
    merged += merged === '' ? trimmed : ` ${trimmed}`;
  }
  return merged === '' ? '' : ` class="${escapeHtml(merged)}"`;
}

/** The per-level class for a heading, if the host mapped one. */
function headingLevelClass(map: ClassMap | undefined, level: number): string | undefined {
  if (!map) return undefined;
  switch (level) {
    case 1:
      return map.h1;
    case 2:
      return map.h2;
    case 3:
      return map.h3;
    case 4:
      return map.h4;
    case 5:
      return map.h5;
    default:
      return map.h6;
  }
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
  return inlineRun(nodes, options, newCtx());
}

function inlineRun(
  nodes: Inline[],
  options: RenderOptions | undefined,
  ctx: RenderCtx,
): string {
  let out = '';
  for (const node of nodes) out += renderInlineNode(node, options, ctx);
  return out;
}

function renderInlineNode(
  node: Inline,
  options: RenderOptions | undefined,
  ctx: RenderCtx,
): string {
  const map = options?.classMap;
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'strong':
      return `<strong${classAttr(map?.strong)}>${inlineRun(node.children, options, ctx)}</strong>`;
    case 'emphasis':
      return `<em${classAttr(map?.emphasis)}>${inlineRun(node.children, options, ctx)}</em>`;
    case 'strikethrough':
      return `<del${classAttr(map?.strikethrough)}>${inlineRun(node.children, options, ctx)}</del>`;
    case 'inlineCode':
      return `<code${classAttr(map?.inlineCode)}>${escapeHtml(node.value)}</code>`;
    case 'link': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<a href="${attrUrl(node.url)}"${title}${classAttr(map?.link)}>${inlineRun(node.children, options, ctx)}</a>`;
    }
    case 'image': {
      const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
      return `<img src="${attrUrl(node.url)}" alt="${escapeHtml(node.alt)}"${title}${classAttr(map?.image)}>`;
    }
    case 'autolink':
      return `<a href="${attrUrl(node.url)}"${classAttr(map?.link)}>${escapeHtml(node.url)}</a>`;
    case 'break':
      return node.hard ? '<br>\n' : '\n';
    case 'math':
      // Host math engine (trusted, returns escaped HTML) or safe escaped source.
      return options?.math
        ? options.math(node.value, node.display)
        : `<span${classAttr('tw-math-src', map?.mathInline)}>${escapeHtml(node.value)}</span>`;
    case 'footnoteRef': {
      // GitHub-style superscript back-reference. The def with the matching id
      // is collected + rendered once at the end of the document (see
      // renderToHtml). Number is first-seen order; id links the two ends.
      const slug = slugFootnoteId(node.id);
      const n = fnNumber(ctx, slug);
      const safe = escapeHtml(slug);
      return `<sup${classAttr('tw-fnref', map?.footnoteRef)} id="fnref-${safe}"><a href="#fn-${safe}">[${n}]</a></sup>`;
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

/**
 * Render a single block node to sanitized HTML.
 *
 * A lone block has no document context, so `headingIds` cannot allocate a
 * document-unique id here and no `id` is emitted. Use {@link renderToHtml} when
 * anchors are needed.
 */
export function renderNode(node: Block, options?: RenderOptions): string {
  return renderBlockNode(node, options, newCtx());
}

function renderBlockNode(
  node: Block,
  options: RenderOptions | undefined,
  ctx: RenderCtx,
): string {
  const map = options?.classMap;
  switch (node.type) {
    case 'heading': {
      const l = node.level;
      // Identity lookup, never a re-slug: this is what guarantees the emitted id
      // matches the one `outline()` reports for the same node.
      const id = ctx.ids?.get(node);
      const idAttr = id === undefined ? '' : ` id="${escapeHtml(id)}"`;
      const cls = classAttr(map?.heading, headingLevelClass(map, l));
      return `<h${l}${idAttr}${cls}>${inlineRun(node.children, options, ctx)}</h${l}>`;
    }
    case 'paragraph':
      return `<p${classAttr(map?.paragraph)}>${inlineRun(node.children, options, ctx)}</p>`;
    case 'blockquote':
      return `<blockquote${classAttr(map?.blockquote)}>${renderBlocks(node.children, options, ctx)}</blockquote>`;
    case 'list':
      return renderList(node.ordered, node.start, node.tight, node.items, options, ctx);
    case 'codeBlock': {
      const codeCls = classAttr(
        node.lang ? `language-${node.lang}` : undefined,
        map?.code,
      );
      // The highlighter is trusted to return escaped HTML; the default path
      // escapes here so raw code is never emitted live either way.
      const body = options?.highlight
        ? options.highlight(node.lang, node.value)
        : escapeHtml(node.value);
      return `<pre${classAttr(map?.codeBlock)}><code${codeCls}>${body}</code></pre>`;
    }
    case 'thematicBreak':
      return `<hr${classAttr(map?.thematicBreak)}>`;
    case 'table':
      return renderTable(node, options, ctx);
    case 'htmlBlock':
      // The safety boundary: raw HTML / MDX is emitted ESCAPED, never live.
      return `<pre${classAttr(map?.htmlBlock)}>${escapeHtml(node.value)}</pre>`;
    case 'mathBlock':
      // A math block is always display math; host engine or escaped source.
      return options?.math
        ? options.math(node.value, true)
        : `<div${classAttr('tw-math-src', map?.mathBlock)}>${escapeHtml(node.value)}</div>`;
    case 'footnoteDef':
      // Canonical placement is the collected <section> that renderToHtml
      // appends. A standalone renderNode(footnoteDef) still renders its body
      // for completeness (renderBlocks skips defs only in document flow).
      return `<div${classAttr('tw-footnote-def', map?.footnoteDef)}>${renderBlocks(node.children, options, ctx)}</div>`;
    case 'defList': {
      let out = '';
      for (const item of node.items) {
        out += `<dt${classAttr(map?.definitionTerm)}>${inlineRun(item.term, options, ctx)}</dt>`;
        for (const def of item.definitions) {
          out += `<dd${classAttr(map?.definitionDescription)}>${renderBlocks(def, options, ctx)}</dd>`;
        }
      }
      return `<dl${classAttr(map?.definitionList)}>${out}</dl>`;
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
  ctx: RenderCtx,
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
  ctx: RenderCtx,
): string {
  const tag = ordered ? 'ol' : 'ul';
  const startAttr =
    ordered && Number.isFinite(start) && start !== 1
      ? ` start="${escapeHtml(String(Math.trunc(start)))}"`
      : '';
  const map = options?.classMap;
  const cls = classAttr(map?.list, ordered ? map?.orderedList : map?.unorderedList);
  let body = '';
  for (const item of items) body += renderListItem(item, tight, options, ctx);
  return `<${tag}${startAttr}${cls}>${body}</${tag}>`;
}

function renderListItem(
  item: ListItem,
  tight: boolean,
  options: RenderOptions | undefined,
  ctx: RenderCtx,
): string {
  const map = options?.classMap;
  let checkbox = '';
  if (item.task !== null) {
    const checked = item.task === 'checked' ? ' checked' : '';
    checkbox = `<input type="checkbox" disabled${checked}> `;
  }
  const cls = classAttr(map?.listItem, item.task !== null ? map?.taskListItem : undefined);
  return `<li${cls}>${checkbox}${renderItemChildren(item.children, tight, options, ctx)}</li>`;
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
  ctx: RenderCtx,
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
  ctx: RenderCtx,
): string {
  const align = node.align;
  const map = options?.classMap;
  const cellStyle = (col: number): string => {
    const a = align[col];
    return a ? ` style="text-align:${a}"` : '';
  };
  const rowAttr = classAttr(map?.tableRow);

  const headCells = renderRow(node.header, 'th', cellStyle, options, ctx);
  const head = `<thead${classAttr(map?.tableHead)}><tr${rowAttr}>${headCells}</tr></thead>`;

  let bodyRows = '';
  for (const row of node.rows) {
    bodyRows += `<tr${rowAttr}>${renderRow(row, 'td', cellStyle, options, ctx)}</tr>`;
  }
  const body = `<tbody${classAttr(map?.tableBody)}>${bodyRows}</tbody>`;

  return `<table${classAttr(map?.table)}>${head}${body}</table>`;
}

function renderRow(
  cells: TableCell[],
  tag: 'th' | 'td',
  cellStyle: (col: number) => string,
  options: RenderOptions | undefined,
  ctx: RenderCtx,
): string {
  const map = options?.classMap;
  const cellCls = classAttr(tag === 'th' ? map?.tableHeaderCell : map?.tableCell);
  let out = '';
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    out += `<${tag}${cellStyle(i)}${cellCls}>${inlineRun(cell.children, options, ctx)}</${tag}>`;
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

/**
 * Render a whole document to sanitized HTML.
 *
 * Frontmatter, when present on the document, is metadata and is never rendered.
 */
export function renderToHtml(doc: Document, options?: RenderOptions): string {
  // One allocation pass per document, before any emission — so every heading's
  // id is known (and unique) by the time its tag is written.
  const ctx = newCtx(options?.headingIds === true ? buildHeadingIds(doc) : undefined);
  let out = renderBlocks(doc.children, options, ctx);

  // Collect every footnote definition (from anywhere in the tree) and emit it
  // once, GitHub-style, as a trailing ordered list with a back-link per note.
  const defs = collectFootnoteDefs(doc);
  if (defs.length > 0) {
    const map = options?.classMap;
    let items = '';
    for (const def of defs) {
      const safe = escapeHtml(slugFootnoteId(def.id));
      items +=
        `<li id="fn-${safe}">` +
        renderBlocks(def.children, options, ctx) +
        ` <a href="#fnref-${safe}"${classAttr('tw-fn-back', map?.footnoteBackref)}>↩</a>` +
        `</li>`;
    }
    out += `<section${classAttr('tw-footnotes', map?.footnotes)}><ol>${items}</ol></section>`;
  }

  return out;
}
