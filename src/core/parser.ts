/**
 * Typewright block + inline parser — a hand-written, zero-dependency GitHub
 * Flavored Markdown (+ light MDX-flow) parser that produces the offset-exact
 * AST in `./ast`. Every node carries `from`/`to` UTF-16 source offsets; markers
 * (heading `### `, list bullets, emphasis delimiters) are exposed so a consumer
 * can hide/reveal the raw syntax.
 *
 * Design notes:
 *  - Block parsing works line-by-line. Container blocks (blockquote, list) build
 *    a fresh line list whose `from` is advanced past the stripped prefix; because
 *    only `from` moves, `src.slice(from, to)` still equals the line's content, so
 *    offsets stay exact through arbitrary nesting.
 *  - Inline parsing stitches a block's content lines into one buffer with a
 *    per-character source-offset map, so emphasis/code spanning a soft line break
 *    still reports correct absolute offsets.
 *  - The parser never throws: unterminated emphasis / code / links / fences all
 *    degrade to text (or run to end-of-input) rather than failing.
 */

import type {
  Autolink,
  Block,
  Blockquote,
  CellAlign,
  CodeBlock,
  DefItem,
  DefList,
  Document,
  Emphasis,
  FootnoteDef,
  FootnoteRef,
  Heading,
  HtmlBlock,
  Image,
  Inline,
  InlineCode,
  LineBreak,
  Link,
  List,
  ListItem,
  Math,
  MathBlock,
  Paragraph,
  ParseOptions,
  Strikethrough,
  Strong,
  Table,
  TableCell,
  TaskState,
  TextNode,
  ThematicBreak,
} from './ast';

/* ------------------------------------------------------------------ *
 * Bounds — keep user/model-controlled strings sensibly capped.
 * ------------------------------------------------------------------ */

const MAX_URL = 4096;
const MAX_TITLE = 1024;
const MAX_ALT = 4096;
const MAX_LANG = 256;
const MAX_VALUE = 1_000_000;
/** Footnote labels are short tokens; this caps the `[^…]` lookahead to O(1). */
const MAX_FOOTNOTE_ID = 256;

const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/* ------------------------------------------------------------------ *
 * Opt-in extensions (math / footnotes / definition lists)
 *
 * All three default to `false`, so `parse(src)` is byte-for-byte what it always
 * was. The resolved flags live in module scope and are set once per `parse()`
 * call; parsing is synchronous and non-reentrant across calls, and every nested
 * `parseBlocks` within a single call shares the same flags — so this reads like
 * a closure variable without threading an argument through every builder.
 * ------------------------------------------------------------------ */

interface ResolvedOptions {
  math: boolean;
  footnotes: boolean;
  defLists: boolean;
}

let opts: ResolvedOptions = { math: false, footnotes: false, defLists: false };

/* ------------------------------------------------------------------ *
 * Line model
 * ------------------------------------------------------------------ */

interface Line {
  /** Offset of the first character of (stripped) content. */
  from: number;
  /** Offset just past the last content character (before the newline). */
  to: number;
  /** `src.slice(from, to)` — the line's content, minus any container prefix. */
  text: string;
}

/** Split source into content lines (newline + trailing `\r` excluded). */
function splitLines(src: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (let i = 0; i <= src.length; i++) {
    if (i === src.length || src[i] === '\n') {
      let end = i;
      if (end > from && src[end - 1] === '\r') end--;
      lines.push({ from, to: end, text: src.slice(from, end) });
      from = i + 1;
    }
  }
  return lines;
}

const leadingSpaces = (t: string): number => {
  let n = 0;
  while (n < t.length && t[n] === ' ') n++;
  return n;
};

const isBlank = (line: Line): boolean => line.text.trim() === '';

/* ------------------------------------------------------------------ *
 * Block detectors
 * ------------------------------------------------------------------ */

const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX_RE = /^( {0,3})(#{1,6})(?=\s|$)/;
const ITEM_RE = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)/;
const HTML_TAG_RE = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[\s/>]|$)/;
const ESM_RE = /^(?:import|export)\b/;

const isFence = (t: string): boolean => {
  const m = FENCE_RE.exec(t);
  if (!m) return false;
  // A backtick info string may not itself contain a backtick.
  return m[2]![0] !== '`' || !m[3]!.includes('`');
};

const isAtx = (t: string): boolean => ATX_RE.test(t);

const isThematic = (t: string): boolean => {
  const trimmed = t.trim();
  if (trimmed.length < 3) return false;
  const compact = trimmed.replace(/ /g, '');
  return /^(?:-{3,}|_{3,}|\*{3,})$/.test(compact);
};

const isQuote = (t: string): boolean => /^ {0,3}>/.test(t);

interface ItemInfo {
  indent: number;
  marker: string;
  markerLen: number;
  spacesAfter: number;
  ordered: boolean;
}

function detectItem(line: Line): ItemInfo | null {
  const m = ITEM_RE.exec(line.text);
  if (!m) return null;
  const marker = m[2]!;
  return {
    indent: m[1]!.length,
    marker,
    markerLen: marker.length,
    spacesAfter: m[3] === '' ? 0 : m[3]!.length,
    ordered: /\d/.test(marker[0]!),
  };
}

function htmlVariant(t: string): 'html' | 'mdxFlow' | null {
  const s = t.replace(/^ {0,3}/, '');
  if (ESM_RE.test(s)) return 'mdxFlow';
  const m = HTML_TAG_RE.exec(s);
  if (!m) return null;
  return /[A-Z]/.test(m[1]![0]!) ? 'mdxFlow' : 'html';
}

function isDelimRow(t: string): boolean {
  let s = t.trim();
  if (!s.includes('-')) return false;
  s = s.replace(/^\|/, '').replace(/\|$/, '');
  const cells = s.split('|');
  return cells.length >= 1 && cells.every((c) => /^ *:?-+:? *$/.test(c));
}

function isTableStartAt(lines: Line[], j: number): boolean {
  const line = lines[j];
  const next = lines[j + 1];
  if (!line || !next) return false;
  if (isBlank(line)) return false;
  return line.text.includes('|') && isDelimRow(next.text);
}

/* --- opt-in detectors (inert unless the matching flag is on) --- */

/** A `$$` display-math fence on its own line (opener or closer). */
const MATH_FENCE_RE = /^ {0,3}\$\$[ \t]*$/;
const isMathOpen = (t: string): boolean => opts.math && MATH_FENCE_RE.test(t);

/** A `[^id]:` footnote definition line. Never collides with `ITEM_RE`. */
const FOOTNOTE_DEF_RE = /^( {0,3})\[\^([^\]\s]+)\]:/;
const isFootnoteDef = (line: Line): boolean => opts.footnotes && FOOTNOTE_DEF_RE.test(line.text);

/** A `: …` definition-list definition line (up to 3 leading spaces). */
const DEF_RE = /^( {0,3}):[ \t]+/;

/**
 * Does line `j` open a definition list? Conservative: line `j` must be a plain
 * term (a line that would otherwise be a paragraph — not another block) and the
 * *immediately* following line must be a `: …` definition. The term guard reuses
 * `startsBlock` (which never recurses into this check), so a heading/quote/table
 * term is rejected.
 */
function isDefListStartAt(lines: Line[], j: number): boolean {
  if (!opts.defLists) return false;
  const line = lines[j];
  const next = lines[j + 1];
  if (!line || !next) return false;
  if (isBlank(line)) return false;
  if (startsBlock(lines, j)) return false; // term must not be another block
  return DEF_RE.test(next.text);
}

/** Does line `j` begin a non-paragraph block (so a paragraph must stop)? */
function startsBlock(lines: Line[], j: number): boolean {
  const line = lines[j]!;
  const t = line.text;
  return (
    isFence(t) ||
    isAtx(t) ||
    isThematic(t) ||
    isQuote(t) ||
    detectItem(line) !== null ||
    htmlVariant(t) !== null ||
    isTableStartAt(lines, j) ||
    isMathOpen(t) ||
    isFootnoteDef(line)
  );
}

/** Like `startsBlock` but excludes tables (used while consuming table rows). */
function startsOtherBlock(line: Line): boolean {
  const t = line.text;
  return (
    isFence(t) ||
    isAtx(t) ||
    isThematic(t) ||
    isQuote(t) ||
    detectItem(line) !== null ||
    htmlVariant(t) !== null ||
    isMathOpen(t) ||
    isFootnoteDef(line)
  );
}

/* ------------------------------------------------------------------ *
 * Block builders
 * ------------------------------------------------------------------ */

interface Built {
  node: Block;
  next: number;
}

function buildHeading(line: Line): Heading {
  const t = line.text;
  const m = ATX_RE.exec(t)!;
  const indent = m[1]!.length;
  const hashes = m[2]!;
  const level = hashes.length as 1 | 2 | 3 | 4 | 5 | 6;
  let ce = indent + hashes.length;
  if (t[ce] === ' ') ce++;
  const contentFrom = line.from + ce;

  // Trim trailing whitespace + an optional closing `###` sequence for children.
  let end = t.length;
  while (end > ce && (t[end - 1] === ' ' || t[end - 1] === '\t')) end--;
  let e2 = end;
  while (e2 > ce && t[e2 - 1] === '#') e2--;
  if (e2 < end && (e2 === ce || t[e2 - 1] === ' ' || t[e2 - 1] === '\t')) {
    end = e2;
    while (end > ce && (t[end - 1] === ' ' || t[end - 1] === '\t')) end--;
  }

  const children = parseInlineSegs([
    { from: contentFrom, to: line.from + end, text: t.slice(ce, end) },
  ]);
  return { type: 'heading', from: line.from, to: line.to, level, contentFrom, children };
}

function buildFence(lines: Line[], i: number): Built {
  const open = lines[i]!;
  const m = FENCE_RE.exec(open.text)!;
  const indent = m[1]!.length;
  const fenceChar = m[2]![0]!;
  const fenceLen = m[2]!.length;
  const lang = cap(m[3]!.trim(), MAX_LANG);

  const inner: Line[] = [];
  let j = i + 1;
  let closeTo: number | null = null;
  while (j < lines.length) {
    const cm = /^( {0,3})(`{3,}|~{3,}) *$/.exec(lines[j]!.text);
    if (cm && cm[2]![0] === fenceChar && cm[2]!.length >= fenceLen) {
      closeTo = lines[j]!.to;
      j++;
      break;
    }
    inner.push(lines[j]!);
    j++;
  }

  const value = cap(
    inner.map((l) => (leadingSpaces(l.text) >= indent ? l.text.slice(indent) : l.text.trimStart())).join('\n'),
    MAX_VALUE,
  );
  const to = closeTo ?? (inner.length ? inner[inner.length - 1]!.to : open.to);
  return { node: { type: 'codeBlock', from: open.from, to, lang, value, fenced: true }, next: j };
}

/** A `$$` … `$$` display-math block. Unterminated → runs to end (like a fence). */
function buildMathBlock(lines: Line[], i: number): Built {
  const open = lines[i]!;
  const inner: Line[] = [];
  let j = i + 1;
  let closeTo: number | null = null;
  while (j < lines.length) {
    if (MATH_FENCE_RE.test(lines[j]!.text)) {
      closeTo = lines[j]!.to;
      j++;
      break;
    }
    inner.push(lines[j]!);
    j++;
  }
  const value = cap(inner.map((l) => l.text).join('\n'), MAX_VALUE);
  const to = closeTo ?? (inner.length ? inner[inner.length - 1]!.to : open.to);
  const node: MathBlock = { type: 'mathBlock', from: open.from, to, value };
  return { node, next: j };
}

function buildIndentedCode(lines: Line[], i: number): Built {
  const from = lines[i]!.from;
  const inner: Line[] = [lines[i]!];
  let j = i + 1;
  let pending: Line[] = [];
  while (j < lines.length) {
    const line = lines[j]!;
    if (isBlank(line)) {
      pending.push(line);
      j++;
      continue;
    }
    if (leadingSpaces(line.text) >= 4) {
      inner.push(...pending, line);
      pending = [];
      j++;
      continue;
    }
    break;
  }
  const last = inner[inner.length - 1]!;
  const value = cap(inner.map((l) => l.text.slice(4)).join('\n'), MAX_VALUE);
  return {
    node: { type: 'codeBlock', from, to: last.to, lang: '', value, fenced: false },
    next: j,
  };
}

function buildThematic(line: Line): ThematicBreak {
  return { type: 'thematicBreak', from: line.from, to: line.to };
}

function stripQuote(line: Line): Line {
  const m = /^( {0,3})>( ?)/.exec(line.text)!;
  const cut = m[0].length;
  return { from: line.from + cut, to: line.to, text: line.text.slice(cut) };
}

function buildBlockquote(lines: Line[], i: number): Built {
  const from = lines[i]!.from;
  const inner: Line[] = [];
  let j = i;
  while (j < lines.length && isQuote(lines[j]!.text)) {
    inner.push(stripQuote(lines[j]!));
    j++;
  }
  const to = lines[j - 1]!.to;
  const children = parseBlocks(inner);
  return { node: { type: 'blockquote', from, to, children }, next: j };
}

const TASK_RE = /^\[([ xX])\](\s|$)/;

interface CollectedItem {
  item: ListItem;
  next: number;
  blankBefore: boolean;
  loose: boolean;
}

function collectItem(lines: Line[], idx: number): CollectedItem {
  const line0 = lines[idx]!;
  const det = detectItem(line0)!;
  const contentCol = det.indent + det.markerLen + 1;
  const localStart = det.indent + det.markerLen + (det.spacesAfter > 0 ? 1 : 0);

  let task: TaskState = null;
  let bodyStart = localStart;
  const afterMarker = line0.text.slice(localStart);
  const tm = TASK_RE.exec(afterMarker);
  if (tm) {
    task = tm[1] === ' ' ? 'unchecked' : 'checked';
    bodyStart = localStart + tm[0].length;
  }
  const contentFrom = line0.from + bodyStart;

  const body: Line[] = [
    { from: contentFrom, to: line0.to, text: line0.text.slice(bodyStart) },
  ];
  let lastTo = line0.to;
  let loose = false;
  let pendingBlank = false;
  let j = idx + 1;

  while (j < lines.length) {
    const lj = lines[j]!;
    if (isBlank(lj)) {
      pendingBlank = true;
      j++;
      continue;
    }
    const ind = leadingSpaces(lj.text);
    if (ind >= contentCol) {
      if (pendingBlank) {
        loose = true;
        body.push({ from: lj.from, to: lj.from, text: '' });
      }
      body.push({
        from: lj.from + contentCol,
        to: lj.to,
        text: lj.text.slice(contentCol),
      });
      lastTo = lj.to;
      pendingBlank = false;
      j++;
      continue;
    }
    if (detectItem(lj)) break; // sibling / new item
    if (pendingBlank) break; // blank then unindented, non-item → item ends
    if (startsOtherBlock(lj)) break; // a new block interrupts
    // lazy paragraph continuation
    body.push({ from: lj.from, to: lj.to, text: lj.text });
    lastTo = lj.to;
    j++;
  }

  const children = parseBlocks(body);
  const item: ListItem = {
    type: 'listItem',
    from: line0.from,
    to: lastTo,
    task,
    contentFrom,
    children,
  };
  return { item, next: j, blankBefore: pendingBlank, loose };
}

function buildList(lines: Line[], start: number): Built {
  const first = detectItem(lines[start]!)!;
  const ordered = first.ordered;
  const startNum = ordered ? parseInt(first.marker, 10) || 0 : 1;

  const items: ListItem[] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const det = detectItem(lines[i]!);
    if (!det || det.ordered !== ordered) break;
    const r = collectItem(lines, i);
    if (r.blankBefore) loose = true;
    if (r.loose) loose = true;
    items.push(r.item);
    i = r.next;
  }

  const node: List = {
    type: 'list',
    from: items[0]!.from,
    to: items[items.length - 1]!.to,
    ordered,
    start: startNum,
    tight: !loose,
    items,
  };
  return { node, next: i };
}

function parseAligns(delim: string): CellAlign[] {
  return splitCellRanges(delim).map(([a, b]) => {
    const cell = delim.slice(a, b).trim();
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (left) return 'left';
    if (right) return 'right';
    return null;
  });
}

/** Local [start,end) ranges for each pipe-delimited cell, outer pipes dropped. */
function splitCellRanges(t: string): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  let s = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k] === '|' && t[k - 1] !== '\\') {
      cells.push([s, k]);
      s = k + 1;
    }
  }
  cells.push([s, t.length]);
  if (cells.length > 1 && t.slice(cells[0]![0], cells[0]![1]).trim() === '') cells.shift();
  if (cells.length > 1 && t.slice(cells[cells.length - 1]![0], cells[cells.length - 1]![1]).trim() === '')
    cells.pop();
  return cells;
}

function splitRow(line: Line): TableCell[] {
  const t = line.text;
  return splitCellRanges(t).map(([a, b]) => {
    let ca = a;
    while (ca < b && t[ca] === ' ') ca++;
    let cb = b;
    while (cb > ca && t[cb - 1] === ' ') cb--;
    const from = line.from + ca;
    const to = line.from + cb;
    const children = parseInlineSegs([{ from, to, text: t.slice(ca, cb) }]);
    return { type: 'tableCell', from, to, children };
  });
}

function buildTable(lines: Line[], i: number): Built {
  const header = splitRow(lines[i]!);
  const align = parseAligns(lines[i + 1]!.text);
  const rows: TableCell[][] = [];
  let j = i + 2;
  let lastTo = lines[i + 1]!.to;
  while (j < lines.length) {
    const line = lines[j]!;
    if (isBlank(line) || startsOtherBlock(line)) break;
    rows.push(splitRow(line));
    lastTo = line.to;
    j++;
  }
  return {
    node: { type: 'table', from: lines[i]!.from, to: lastTo, align, header, rows },
    next: j,
  };
}

function buildHtml(lines: Line[], i: number): Built {
  const variant = htmlVariant(lines[i]!.text)!;
  const from = lines[i]!.from;
  const block: Line[] = [];
  let j = i;
  while (j < lines.length && !isBlank(lines[j]!)) {
    block.push(lines[j]!);
    j++;
  }
  const to = block[block.length - 1]!.to;
  const value = cap(block.map((l) => l.text).join('\n'), MAX_VALUE);
  return { node: { type: 'htmlBlock', from, to, value, variant }, next: j };
}

/**
 * A `[^id]: …` footnote definition. Its body — the text after `]: ` plus any
 * indented / lazily-continued following lines — is parsed as nested blocks
 * (mirroring `collectItem`'s continuation model), so a def can hold paragraphs,
 * lists, code, etc.
 */
function buildFootnoteDef(lines: Line[], i: number): Built {
  const line0 = lines[i]!;
  const m = FOOTNOTE_DEF_RE.exec(line0.text)!;
  const indent = m[1]!.length;
  const id = m[2]!;
  const markerLen = m[0].length - indent; // length of `[^id]:`
  const contentCol = indent + markerLen + 1; // continuation aligns past `[^id]: `
  let bodyStart = indent + markerLen;
  if (line0.text[bodyStart] === ' ') bodyStart++;
  const contentFrom = line0.from + bodyStart;

  const body: Line[] = [
    { from: contentFrom, to: line0.to, text: line0.text.slice(bodyStart) },
  ];
  let lastTo = line0.to;
  let pendingBlank = false;
  let j = i + 1;
  while (j < lines.length) {
    const lj = lines[j]!;
    if (isBlank(lj)) {
      pendingBlank = true;
      j++;
      continue;
    }
    const ind = leadingSpaces(lj.text);
    if (ind >= contentCol) {
      if (pendingBlank) body.push({ from: lj.from, to: lj.from, text: '' });
      body.push({ from: lj.from + contentCol, to: lj.to, text: lj.text.slice(contentCol) });
      lastTo = lj.to;
      pendingBlank = false;
      j++;
      continue;
    }
    if (pendingBlank) break; // blank then unindented → def ends
    if (isFootnoteDef(lj)) break; // sibling definition
    if (startsOtherBlock(lj)) break; // a new block interrupts
    if (isDefListStartAt(lines, j)) break;
    // lazy paragraph continuation
    body.push({ from: lj.from, to: lj.to, text: lj.text });
    lastTo = lj.to;
    j++;
  }

  const children = parseBlocks(body);
  const node: FootnoteDef = { type: 'footnoteDef', from: line0.from, to: lastTo, id, children };
  return { node, next: j };
}

/** One `: …` definition (+ its indented/lazy continuation) as a block sequence. */
function collectDefinition(lines: Line[], idx: number): { blocks: Block[]; to: number; next: number } {
  const line0 = lines[idx]!;
  const m = DEF_RE.exec(line0.text)!;
  const contentCol = m[0].length; // content begins just past `: `
  const body: Line[] = [
    { from: line0.from + contentCol, to: line0.to, text: line0.text.slice(contentCol) },
  ];
  let lastTo = line0.to;
  let pendingBlank = false;
  let j = idx + 1;
  while (j < lines.length) {
    const lj = lines[j]!;
    if (isBlank(lj)) {
      pendingBlank = true;
      j++;
      continue;
    }
    if (DEF_RE.test(lj.text)) break; // next definition of the same term
    const ind = leadingSpaces(lj.text);
    if (ind >= contentCol) {
      if (pendingBlank) body.push({ from: lj.from, to: lj.from, text: '' });
      body.push({ from: lj.from + contentCol, to: lj.to, text: lj.text.slice(contentCol) });
      lastTo = lj.to;
      pendingBlank = false;
      j++;
      continue;
    }
    if (pendingBlank) break;
    if (startsOtherBlock(lj)) break;
    if (isFootnoteDef(lj)) break;
    if (isDefListStartAt(lines, j)) break; // next term/definition group
    // lazy paragraph continuation
    body.push({ from: lj.from, to: lj.to, text: lj.text });
    lastTo = lj.to;
    j++;
  }
  return { blocks: parseBlocks(body), to: lastTo, next: j };
}

/** A term line plus its one-or-more `: …` definitions. */
function collectDefItem(lines: Line[], idx: number): { item: DefItem; next: number } {
  const termLine = lines[idx]!;
  const term = parseInlineSegs([
    { from: termLine.from, to: termLine.to, text: termLine.text },
  ]);
  const definitions: Block[][] = [];
  let lastTo = termLine.to;
  let j = idx + 1;
  while (j < lines.length && DEF_RE.test(lines[j]!.text)) {
    const d = collectDefinition(lines, j);
    definitions.push(d.blocks);
    lastTo = d.to;
    j = d.next;
  }
  const item: DefItem = { type: 'defItem', from: termLine.from, to: lastTo, term, definitions };
  return { item, next: j };
}

/** A definition list: consecutive `term` / `: definition` groups. */
function buildDefList(lines: Line[], start: number): Built {
  const items: DefItem[] = [];
  let i = start;
  while (i < lines.length && isDefListStartAt(lines, i)) {
    const r = collectDefItem(lines, i);
    items.push(r.item);
    i = r.next;
  }
  const node: DefList = {
    type: 'defList',
    from: items[0]!.from,
    to: items[items.length - 1]!.to,
    items,
  };
  return { node, next: i };
}

function buildParagraph(lines: Line[], i: number): Built {
  const para: Line[] = [lines[i]!];
  let j = i + 1;
  while (j < lines.length) {
    if (isBlank(lines[j]!)) break;
    if (startsBlock(lines, j)) break;
    para.push(lines[j]!);
    j++;
  }
  const from = para[0]!.from;
  const to = para[para.length - 1]!.to;
  const children = parseInlineSegs(para.map((l) => ({ from: l.from, to: l.to, text: l.text })));
  return { node: { type: 'paragraph', from, to, children }, next: j };
}

/* ------------------------------------------------------------------ *
 * Block dispatch
 * ------------------------------------------------------------------ */

function parseBlocks(lines: Line[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const t = line.text;

    if (isFence(t)) {
      const b = buildFence(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (isMathOpen(t)) {
      const b = buildMathBlock(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (leadingSpaces(t) >= 4) {
      const b = buildIndentedCode(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (isAtx(t)) {
      out.push(buildHeading(line));
      i++;
    } else if (isThematic(t)) {
      out.push(buildThematic(line));
      i++;
    } else if (isQuote(t)) {
      const b = buildBlockquote(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (detectItem(line)) {
      const b = buildList(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (isDefListStartAt(lines, i)) {
      const b = buildDefList(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (isTableStartAt(lines, i)) {
      const b = buildTable(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (htmlVariant(t)) {
      const b = buildHtml(lines, i);
      out.push(b.node);
      i = b.next;
    } else if (isFootnoteDef(line)) {
      const b = buildFootnoteDef(lines, i);
      out.push(b.node);
      i = b.next;
    } else {
      const b = buildParagraph(lines, i);
      out.push(b.node);
      i = b.next;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Inline parsing
 * ------------------------------------------------------------------ */

interface Seg {
  from: number;
  to: number;
  text: string;
}

const isWs = (ch: string | undefined): boolean =>
  ch === undefined || ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';

const isAlnum = (ch: string | undefined): boolean =>
  ch !== undefined && /[0-9A-Za-z]/.test(ch);

/**
 * Parse the inline content of a block, given its content lines. The lines are
 * stitched into one buffer separated by soft breaks; a per-character map lets
 * every produced node report exact absolute source offsets.
 */
function parseInlineSegs(segs: Seg[]): Inline[] {
  if (segs.length === 0) return [];
  let buf = '';
  const map: number[] = [];
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s]!;
    if (s > 0) {
      map.push(segs[s - 1]!.to);
      buf += '\n';
    }
    for (let k = 0; k < seg.text.length; k++) {
      map.push(seg.from + k);
      buf += seg.text[k];
    }
  }
  map.push(segs[segs.length - 1]!.to);

  const abs = (k: number): number => (k < map.length ? map[k]! : segs[segs.length - 1]!.to);

  /* --- inline node builders --- */
  const text = (from: number, to: number, value: string): TextNode => ({
    type: 'text',
    from,
    to,
    value: cap(value, MAX_VALUE),
  });

  /* --- construct scanners (buffer-index based) --- */

  interface Hit {
    node: Inline;
    endIdx: number;
  }

  function tryCode(i: number, end: number): Hit | null {
    let n = 1;
    while (i + n < end && buf[i + n] === '`') n++;
    let k = i + n;
    while (k < end) {
      if (buf[k] === '`') {
        let m = 1;
        while (k + m < end && buf[k + m] === '`') m++;
        if (m === n) {
          let val = buf.slice(i + n, k);
          if (val.length > 2 && val[0] === ' ' && val[val.length - 1] === ' ' && val.trim() !== '')
            val = val.slice(1, -1);
          const node: InlineCode = {
            type: 'inlineCode',
            from: abs(i),
            to: abs(k + n),
            value: cap(val, MAX_VALUE),
            ticks: n,
          };
          return { node, endIdx: k + n };
        }
        k += m;
        continue;
      }
      k++;
    }
    return null;
  }

  /**
   * Inline math `$…$` (or inline-display `$$…$$`). Modeled on `tryCode`: an
   * unterminated run returns null and degrades to literal text. Flanking rules
   * (opener not followed by space, closer not preceded by space) keep bare `$`
   * signs in prose — `$5 and $10` — from being read as math. `\$` is escaped.
   */
  function tryMath(i: number, end: number): Hit | null {
    let n = 1;
    while (i + n < end && buf[i + n] === '$' && n < 2) n++;
    const after = buf[i + n];
    if (after === undefined || after === ' ' || after === '\t' || after === '\n') return null;
    let k = i + n;
    while (k < end) {
      const ch = buf[k];
      if (ch === '\\') {
        k += 2; // escaped char (e.g. `\$`) can't close the span
        continue;
      }
      if (ch === '\n') return null; // inline math stays on one line
      if (ch === '$') {
        let m = 1;
        while (k + m < end && buf[k + m] === '$' && m < 2) m++;
        if (m === n && k > i + n) {
          const prev = buf[k - 1];
          if (prev !== ' ' && prev !== '\t' && prev !== '\n') {
            const node: Math = {
              type: 'math',
              from: abs(i),
              to: abs(k + n),
              value: cap(buf.slice(i + n, k), MAX_VALUE),
              display: n === 2,
            };
            return { node, endIdx: k + n };
          }
        }
        k += m;
        continue;
      }
      k++;
    }
    return null;
  }

  /**
   * A footnote reference `[^id]`. The id scan is BOUNDED (`MAX_FOOTNOTE_ID`) and
   * stops at the first `]`, whitespace, or nested bracket — so it is O(1) per
   * `[` and never reintroduces the quadratic blow-up a scan-to-end would. A miss
   * returns null and the caller falls through to `tryLink`.
   */
  function tryFootnoteRef(i: number, end: number): Hit | null {
    const idStart = i + 2; // past `[^`
    const stop = Math.min(end, idStart + MAX_FOOTNOTE_ID);
    let k = idStart;
    while (k < stop) {
      const ch = buf[k];
      if (ch === ']') break;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '[' || ch === '^') return null;
      k++;
    }
    if (k >= stop || buf[k] !== ']' || k === idStart) return null;
    const node: FootnoteRef = {
      type: 'footnoteRef',
      from: abs(i),
      to: abs(k + 1),
      id: buf.slice(idStart, k),
    };
    return { node, endIdx: k + 1 };
  }

  function tryAutolink(i: number, end: number): Hit | null {
    let k = i + 1;
    while (k < end && buf[k] !== '>' && buf[k] !== '<' && buf[k] !== ' ' && buf[k] !== '\n') k++;
    if (k >= end || buf[k] !== '>') return null;
    const content = buf.slice(i + 1, k);
    const isUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(content);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content);
    if (!isUri && !isEmail) return null;
    const node: Autolink = {
      type: 'autolink',
      from: abs(i),
      to: abs(k + 1),
      url: cap(content, MAX_URL),
    };
    return { node, endIdx: k + 1 };
  }

  /** Index of the `]` matching the `[` at `open`, or -1. */
  function matchLabel(open: number, end: number): number {
    // Bound the forward scan: link labels/text are short in practice, and an
    // unbounded scan from every `[` makes a run of unmatched brackets O(n^2)
    // (parse runs on every keystroke / streamed token).
    const stop = Math.min(end, open + 4096);
    let depth = 0;
    for (let k = open; k < stop; k++) {
      const ch = buf[k];
      if (ch === '\\') {
        k++;
        continue;
      }
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  function tryLink(i: number, end: number, isImage: boolean): Hit | null {
    const br = i + (isImage ? 1 : 0);
    if (buf[br] !== '[') return null;
    const close = matchLabel(br, end);
    if (close < 0) return null;
    let k = close + 1;
    if (buf[k] !== '(') return null;
    k++;
    while (k < end && (buf[k] === ' ' || buf[k] === '\n')) k++;

    let url = '';
    if (buf[k] === '<') {
      k++;
      const s = k;
      while (k < end && buf[k] !== '>' && buf[k] !== '\n') k++;
      if (buf[k] !== '>') return null;
      url = buf.slice(s, k);
      k++;
    } else {
      const s = k;
      let depth = 0;
      while (k < end) {
        const ch = buf[k];
        if (ch === ' ' || ch === '\n') break;
        if (ch === '(') depth++;
        else if (ch === ')') {
          if (depth === 0) break;
          depth--;
        }
        k++;
      }
      url = buf.slice(s, k);
    }

    let title: string | undefined;
    while (k < end && (buf[k] === ' ' || buf[k] === '\n')) k++;
    const q = buf[k];
    if (q === '"' || q === "'" || q === '(') {
      const closeCh = q === '(' ? ')' : q;
      k++;
      const s = k;
      while (k < end && buf[k] !== closeCh) k++;
      if (buf[k] !== closeCh) return null;
      title = buf.slice(s, k);
      k++;
      while (k < end && (buf[k] === ' ' || buf[k] === '\n')) k++;
    }
    if (buf[k] !== ')') return null;
    const endIdx = k + 1;
    const from = abs(i);
    const to = abs(endIdx);

    if (isImage) {
      const node: Image = {
        type: 'image',
        from,
        to,
        url: cap(url, MAX_URL),
        alt: cap(buf.slice(br + 1, close), MAX_ALT),
      };
      if (title !== undefined) node.title = cap(title, MAX_TITLE);
      return { node, endIdx };
    }
    const node: Link = {
      type: 'link',
      from,
      to,
      url: cap(url, MAX_URL),
      children: parseInlineRange(br + 1, close),
    };
    if (title !== undefined) node.title = cap(title, MAX_TITLE);
    return { node, endIdx };
  }

  function tryEmph(i: number, end: number): Hit | null {
    const c = buf[i]!;
    let n = 1;
    while (i + n < end && buf[i + n] === c) n++;
    const isStrike = c === '~';
    if (isStrike && n < 2) return null;
    const strength = isStrike ? 2 : n >= 2 ? 2 : 1;
    if (i + strength > end) return null;

    const after = buf[i + strength];
    const before = buf[i - 1];
    if (isWs(after)) return null; // opener must be left-flanking
    if (c === '_' && isAlnum(before)) return null; // no intraword `_`

    let k = i + strength;
    while (k < end) {
      if (buf[k] === c) {
        let m = 1;
        while (k + m < end && buf[k + m] === c) m++;
        if (m >= strength) {
          const prev = buf[k - 1];
          const aft = buf[k + strength];
          if (!isWs(prev) && (c !== '_' || !isAlnum(aft))) {
            const children = parseInlineRange(i + strength, k);
            const from = abs(i);
            const to = abs(k + strength);
            let node: Inline;
            if (isStrike) {
              node = { type: 'strikethrough', from, to, children } satisfies Strikethrough;
            } else if (strength === 2) {
              node = { type: 'strong', from, to, marker: c.repeat(2), children } satisfies Strong;
            } else {
              node = { type: 'emphasis', from, to, marker: c, children } satisfies Emphasis;
            }
            return { node, endIdx: k + strength };
          }
        }
        k += m;
        continue;
      }
      k++;
    }
    return null;
  }

  function parseInlineRange(start: number, end: number): Inline[] {
    const out: Inline[] = [];
    let i = start;
    let textStart = start;
    const flush = (upto: number): void => {
      if (upto > textStart) out.push(text(abs(textStart), abs(upto), buf.slice(textStart, upto)));
    };
    const commit = (hit: Hit): void => {
      flush(i);
      out.push(hit.node);
      i = hit.endIdx;
      textStart = i;
    };

    while (i < end) {
      const c = buf[i];
      if (c === '\\') {
        if (buf[i + 1] === '\n') {
          flush(i);
          out.push({ type: 'break', from: abs(i), to: abs(i + 2), hard: true } satisfies LineBreak);
          i += 2;
          textStart = i;
          continue;
        }
        i += 2; // escaped char stays part of the text run
        continue;
      }
      if (c === '\n') {
        let sp = 0;
        let p = i - 1;
        while (p >= textStart && buf[p] === ' ') {
          sp++;
          p--;
        }
        const hard = sp >= 2;
        flush(hard ? i - sp : i);
        out.push({
          type: 'break',
          from: abs(hard ? i - sp : i),
          to: abs(i + 1),
          hard,
        } satisfies LineBreak);
        i++;
        textStart = i;
        continue;
      }
      if (c === '`') {
        const r = tryCode(i, end);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      if (c === '$' && opts.math) {
        const r = tryMath(i, end);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      if (c === '<') {
        const r = tryAutolink(i, end);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      if (c === '!' && buf[i + 1] === '[') {
        const r = tryLink(i, end, true);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      if (c === '[') {
        if (opts.footnotes && buf[i + 1] === '^') {
          const rf = tryFootnoteRef(i, end);
          if (rf) {
            commit(rf);
            continue;
          }
        }
        const r = tryLink(i, end, false);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      if (c === '*' || c === '_' || c === '~') {
        const r = tryEmph(i, end);
        if (r) {
          commit(r);
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
    flush(end);
    return out;
  }

  return parseInlineRange(0, buf.length);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Parse Markdown/MDX source into an offset-exact {@link Document}.
 *
 * `options` gates the opt-in extensions (math, footnotes, definition lists);
 * every flag defaults to `false`, so `parse(src)` is unchanged from before.
 */
export function parse(src: string, options?: ParseOptions): Document {
  opts = {
    math: options?.math === true,
    footnotes: options?.footnotes === true,
    defLists: options?.defLists === true,
  };
  const lines = splitLines(src);
  const children = parseBlocks(lines);
  return { type: 'document', from: 0, to: src.length, children };
}
