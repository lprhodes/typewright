/**
 * Anticipatory streaming renderer (SPEC.md §8).
 *
 * Given a PARTIAL Markdown string (as it arrives token-by-token from an LLM),
 * render the confirmed prefix richly via the real parser/renderer, and
 * optimistically resolve the trailing incomplete construct — an unterminated
 * `**bo` renders as in-progress bold, an open ``` opens a code block, a forming
 * `<Comp` shows a component skeleton — so the preview reads as finished prose
 * while it is still streaming. Confirmed content is never reflowed.
 *
 * Open-delimiter detection is PARITY based (an odd number of a delimiter on the
 * active line means the last one is unclosed) so a completed span is never
 * mistaken for an open one.
 */

import { parse } from '../core/parser';
import { renderToHtml, renderInline } from '../core/render';
import type { AnticipationOptions } from '../types';

export interface AnticipateResult {
  /** Sanitized HTML for the current partial (safe to inject — render.ts escapes). */
  html: string;
  /** Which constructs are currently being anticipated (e.g. ['strong']). */
  pending: string[];
}

type Opt = Required<AnticipationOptions>;

function normalizeOpt(o: AnticipationOptions | boolean): Opt {
  const all = (v: boolean): Opt => ({
    emphasis: v, strong: v, code: v, strikethrough: v, links: v,
    headings: v, fences: v, listItems: v, tables: v, jsx: v,
  });
  if (o === true || o === undefined) return all(true);
  if (o === false) return all(false);
  return { ...all(true), ...o };
}

function esc(s: string): string {
  // escapes text AND attribute values (the fence language class, component name),
  // so `"`/`'` must be escaped too — this is a security boundary.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline HTML for a single line via the real renderer (no <p> wrapper). */
function inlineHtml(text: string): string {
  const doc = parse(text);
  const first = doc.children[0];
  if (first && (first.type === 'paragraph' || first.type === 'heading')) {
    return renderInline(first.children);
  }
  return esc(text);
}

const CARET = '<span class="tw-caret" aria-hidden="true"></span>';

interface OpenRun {
  kind: string;
  tag: string;
  cls: string;
  /** Offset of the opening delimiter within the line. */
  opener: number;
  /** Delimiter length. */
  dl: number;
}

function indexesOf(line: string, sub: string): number[] {
  const out: number[] = [];
  let i = line.indexOf(sub);
  while (i >= 0) {
    out.push(i);
    i = line.indexOf(sub, i + sub.length);
  }
  return out;
}

/**
 * Offset of the `[` opening a still-forming link on the line, or null.
 *
 * Forming = an unclosed `[text…` (no `]` yet) OR a `[text](url…` whose
 * destination is still open (no closing `)`). A completed `[text](url)` — or a
 * bare closed `[text]` not followed by `(` — is NOT forming, so a finished link
 * is never mistaken for an open one (the STABILITY RULE).
 */
function findOpenLink(line: string): number | null {
  const bi = line.lastIndexOf('[');
  if (bi < 0) return null;
  const rest = line.slice(bi);
  if (!rest.includes(']')) return bi; // "[text…"
  if (/^\[[^\]]*\]\([^)]*$/.test(rest)) return bi; // "[text](url…"
  return null;
}

/**
 * Push the trailing lone-`ch` emphasis run when its parity is odd. The doubled
 * `strong` form (`**`/`__`) is masked with an EQUAL-LENGTH sentinel first, so
 * strong pairs never count as emphasis while the surviving delimiter offsets
 * still line up with the original line (a plain strip would shift them).
 */
function pushEmphasis(line: string, ch: string, dbl: string, cands: OpenRun[]): void {
  const masked = line.split(dbl).join('');
  const idx: number[] = [];
  for (let i = 0; i < masked.length; i++) if (masked[i] === ch) idx.push(i);
  if (idx.length % 2 === 1) {
    cands.push({ kind: 'emphasis', tag: 'em', cls: 'tw-pending tw-pending-em', opener: idx[idx.length - 1]!, dl: 1 });
  }
}

/** Find the OUTERMOST unclosed inline delimiter on a line, or null. */
function findOpenRun(line: string, opt: Opt): OpenRun | null {
  const cands: OpenRun[] = [];

  if (opt.strong) {
    const x = indexesOf(line, '**');
    if (x.length % 2 === 1) cands.push({ kind: 'strong', tag: 'strong', cls: 'tw-pending tw-pending-strong', opener: x[x.length - 1]!, dl: 2 });
  }
  if (opt.strikethrough) {
    const x = indexesOf(line, '~~');
    if (x.length % 2 === 1) cands.push({ kind: 'strikethrough', tag: 'del', cls: 'tw-pending tw-pending-del', opener: x[x.length - 1]!, dl: 2 });
  }
  if (opt.code) {
    // ignore ``` fence runs — those are code-block markers, not inline code
    const ticks: number[] = [];
    for (const m of line.matchAll(/`+/g)) {
      if (m[0].length >= 3) continue;
      for (let k = 0; k < m[0].length; k++) ticks.push(m.index + k);
    }
    if (ticks.length % 2 === 1) cands.push({ kind: 'code', tag: 'code', cls: 'tw-pending tw-pending-code', opener: ticks[ticks.length - 1]!, dl: 1 });
  }
  if (opt.links) {
    const li = findOpenLink(line);
    if (li !== null) cands.push({ kind: 'link', tag: 'a', cls: 'tw-pending tw-pending-link', opener: li, dl: 1 });
  }
  if (opt.emphasis) {
    // `*` and `_` emphasis in parallel (mask their `**`/`__` strong forms first)
    pushEmphasis(line, '*', '**', cands);
    pushEmphasis(line, '_', '__', cands);
  }

  if (!cands.length) return null;
  cands.sort((a, b) => a.opener - b.opener); // outermost first
  return cands[0]!;
}

function isFormingJsx(line: string, opt: Opt): boolean {
  return opt.jsx && /<[A-Z][A-Za-z0-9]*\b[^>]*$/.test(line) && !/\/?>\s*$/.test(line);
}

/**
 * A line whose active tail is a forming list item — `- `, `* `, `+ ` or `1. `
 * followed by a space. The text may be empty while it is still being typed, so
 * only the marker+space is required. Rendered as an in-progress <li>.
 */
const LIST_ITEM_RE = /^( {0,3})([-+*]|\d{1,9}[.)])[ \t]+(.*)$/;
function isFormingListItem(line: string, opt: Opt): boolean {
  return opt.listItems && LIST_ITEM_RE.test(line);
}

/** A `| a | b` line — a table row (header, delimiter and data all start `|`). */
const TABLE_ROW_RE = /^ {0,3}\|/;
function splitTableCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function hasTrailing(line: string, opt: Opt): boolean {
  if (!line.trim()) return false;
  return (
    isFormingJsx(line, opt) ||
    isFormingListItem(line, opt) ||
    findOpenRun(line, opt) !== null
  );
}

/** Render a line whose trailing construct is being anticipated. */
function renderActiveLine(line: string, opt: Opt, pending: string[], fallback?: string): string {
  if (isFormingJsx(line, opt)) {
    const name = /<([A-Z][A-Za-z0-9]*)/.exec(line)?.[1] ?? 'Component';
    pending.push('jsx');
    const label = fallback ? esc(fallback) : `‹${esc(name)}› rendering…`;
    return `<div class="tw-skeleton" data-component="${esc(name)}"><span class="tw-skeleton-label">${label}</span><div class="tw-skeleton-bar"></div><div class="tw-skeleton-bar" style="width:70%"></div></div>`;
  }

  if (isFormingListItem(line, opt)) return renderActiveListItem(line, opt, pending);

  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  const body = heading ? (heading[2] ?? '') : line;
  const inner = renderInlineWithOpen(body, opt, pending);
  if (heading) return `<h${heading[1]!.length}>${inner}${CARET}</h${heading[1]!.length}>`;
  return `<p>${inner}${CARET}</p>`;
}

/**
 * An in-progress list item as its OWN single-item list. Committed items above
 * render through the real parser (their own <ul>/<ol>) and are never touched,
 * so anticipation only ADDS the forming item ahead of confirmation.
 */
function renderActiveListItem(line: string, opt: Opt, pending: string[]): string {
  const m = LIST_ITEM_RE.exec(line)!;
  const marker = m[2]!;
  const content = m[3] ?? '';
  pending.push('listItem');
  const inner = content ? renderInlineWithOpen(content, opt, pending) : '';
  const li = `<li class="tw-pending tw-pending-li">${inner}${CARET}</li>`;
  if (/\d/.test(marker)) {
    const n = parseInt(marker, 10);
    const startAttr = Number.isFinite(n) && n !== 1 ? ` start="${esc(String(n))}"` : '';
    return `<ol${startAttr} class="tw-pending tw-pending-list">${li}</ol>`;
  }
  return `<ul class="tw-pending tw-pending-list">${li}</ul>`;
}

function renderInlineWithOpen(text: string, opt: Opt, pending: string[]): string {
  const open = findOpenRun(text, opt);
  if (!open) return inlineHtml(text);
  const prefix = text.slice(0, open.opener);
  pending.push(open.kind);
  if (open.kind === 'link') {
    // Show the resolved link TEXT (up to `]`); the href is withheld until the
    // URL finishes, so a partial/unsafe destination is never emitted.
    const after = text.slice(open.opener + 1);
    const close = after.indexOf(']');
    const label = close >= 0 ? after.slice(0, close) : after;
    return `${inlineHtml(prefix)}<a class="${open.cls}">${inlineHtml(label)}</a>`;
  }
  const content = text.slice(open.opener + open.dl);
  const inner = open.kind === 'code' ? esc(content) : inlineHtml(content);
  return `${inlineHtml(prefix)}<${open.tag} class="${open.cls}">${inner}</${open.tag}>`;
}

function renderOpenFence(block: string, pending: string[]): string {
  const nl = block.indexOf('\n');
  const info = block.slice(3, nl < 0 ? block.length : nl).trim();
  const lang = info.split(/\s+/)[0] ?? '';
  const code = nl < 0 ? '' : block.slice(nl + 1);
  pending.push('code');
  const langAttr = lang ? ` class="language-${esc(lang)}"` : '';
  return `<pre class="tw-codeblock"><code${langAttr}>${esc(code)}${CARET}</code></pre>`;
}

/** An in-progress table row appended under a committed header+delimiter table. */
function renderActiveTableRow(row: string, pending: string[]): string {
  const cells = splitTableCells(row);
  pending.push('tableRow');
  let tds = '';
  for (let i = 0; i < cells.length; i++) {
    const caret = i === cells.length - 1 ? CARET : '';
    tds += `<td>${cells[i] ? inlineHtml(cells[i]!) : ''}${caret}</td>`;
  }
  return `<table class="tw-pending tw-pending-table"><tbody><tr>${tds}</tr></tbody></table>`;
}

export function anticipate(
  partial: string,
  options: AnticipationOptions | boolean = true,
  componentFallback?: string,
): AnticipateResult {
  const opt = normalizeOpt(options);
  const pending: string[] = [];
  if (!partial) return { html: '', pending };

  // 1) open fenced code block — an odd number of ``` fences means the last is open
  const fenceCount = (partial.match(/^```/gm) ?? []).length;
  if (opt.fences && fenceCount % 2 === 1) {
    const idx = partial.lastIndexOf('```');
    const committed = partial.slice(0, idx).replace(/\n+$/, '');
    const open = partial.slice(idx);
    const committedHtml = committed.trim() ? renderToHtml(parse(committed)) : '';
    return { html: committedHtml + renderOpenFence(open, pending), pending };
  }

  // 2) in-progress table row — a `| …` last line under a committed table
  //    (header+delimiter, or a fuller table above). Uses the multi-line
  //    committed/active split like the fence path, so the confirmed rows —
  //    which do not change until the active row commits — are never reflowed.
  if (opt.tables) {
    const nl = partial.lastIndexOf('\n');
    if (nl >= 0) {
      const row = partial.slice(nl + 1);
      if (TABLE_ROW_RE.test(row)) {
        const committed = partial.slice(0, nl);
        const doc = parse(committed);
        const last = doc.children[doc.children.length - 1];
        if (last && last.type === 'table') {
          return { html: renderToHtml(doc) + renderActiveTableRow(row, pending), pending };
        }
      }
    }
  }

  // 3) anticipate a trailing construct on the LAST line, if any
  const lastNl = partial.lastIndexOf('\n');
  const active = lastNl >= 0 ? partial.slice(lastNl + 1) : partial;
  if (!hasTrailing(active, opt)) {
    // nothing to anticipate — render the whole thing as-is
    return { html: renderToHtml(parse(partial)), pending };
  }
  const committed = lastNl >= 0 ? partial.slice(0, lastNl) : '';
  const committedHtml = committed.trim() ? renderToHtml(parse(committed)) : '';
  return { html: committedHtml + renderActiveLine(active, opt, pending, componentFallback), pending };
}
