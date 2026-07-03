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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  if (opt.emphasis) {
    // mask `**` pairs so only lone `*` (emphasis) delimiters remain
    const masked = line.replace(/\*\*/g, '');
    const stars: number[] = [];
    for (let i = 0; i < masked.length; i++) if (masked[i] === '*') stars.push(i);
    if (stars.length % 2 === 1) cands.push({ kind: 'emphasis', tag: 'em', cls: 'tw-pending tw-pending-em', opener: stars[stars.length - 1]!, dl: 1 });
  }

  if (!cands.length) return null;
  cands.sort((a, b) => a.opener - b.opener); // outermost first
  return cands[0]!;
}

function isFormingJsx(line: string, opt: Opt): boolean {
  return opt.jsx && /<[A-Z][A-Za-z0-9]*\b[^>]*$/.test(line) && !/\/?>\s*$/.test(line);
}

function hasTrailing(line: string, opt: Opt): boolean {
  if (!line.trim()) return false;
  return isFormingJsx(line, opt) || findOpenRun(line, opt) !== null;
}

/** Render a line whose trailing construct is being anticipated. */
function renderActiveLine(line: string, opt: Opt, pending: string[]): string {
  if (isFormingJsx(line, opt)) {
    const name = /<([A-Z][A-Za-z0-9]*)/.exec(line)?.[1] ?? 'Component';
    pending.push('jsx');
    return `<div class="tw-skeleton" data-component="${esc(name)}"><span class="tw-skeleton-label">‹${esc(name)}› rendering…</span><div class="tw-skeleton-bar"></div><div class="tw-skeleton-bar" style="width:70%"></div></div>`;
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  const body = heading ? (heading[2] ?? '') : line;
  const inner = renderInlineWithOpen(body, opt, pending);
  if (heading) return `<h${heading[1]!.length}>${inner}${CARET}</h${heading[1]!.length}>`;
  return `<p>${inner}${CARET}</p>`;
}

function renderInlineWithOpen(text: string, opt: Opt, pending: string[]): string {
  const open = findOpenRun(text, opt);
  if (!open) return inlineHtml(text);
  const prefix = text.slice(0, open.opener);
  const content = text.slice(open.opener + open.dl);
  pending.push(open.kind);
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

export function anticipate(partial: string, options: AnticipationOptions | boolean = true): AnticipateResult {
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

  // 2) anticipate a trailing construct on the LAST line, if any
  const lastNl = partial.lastIndexOf('\n');
  const active = lastNl >= 0 ? partial.slice(lastNl + 1) : partial;
  if (!hasTrailing(active, opt)) {
    // nothing to anticipate — render the whole thing as-is
    return { html: renderToHtml(parse(partial)), pending };
  }
  const committed = lastNl >= 0 ? partial.slice(0, lastNl) : '';
  const committedHtml = committed.trim() ? renderToHtml(parse(committed)) : '';
  return { html: committedHtml + renderActiveLine(active, opt, pending), pending };
}
