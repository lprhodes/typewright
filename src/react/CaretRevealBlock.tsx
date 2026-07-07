import * as React from 'react';
import { collectMarkers, hiddenMarkers, safeUrl, walk } from '../core';
import type { AstNode, Block, Document, Inline } from '../core';

/**
 * CaretRevealBlock — one top-level block rendered as a managed `contentEditable`
 * div that implements SPEC.md §5.2 **caret-level source reveal**: the formatting
 * renders inline (bold shows bold, a link shows as a link), but every raw syntax
 * marker (`**`, `` ` ``, `#`, `](url)`, a `>` quote prefix, …) is emitted as a
 * `.tw-syntax` span that COLLAPSES when the caret is away and REVEALS (monospace,
 * muted) when the caret sits on/adjacent to it — the reveal decision comes from
 * the already-tested {@link hiddenMarkers}.
 *
 * Correctness contract — every source character of the block appears EXACTLY once
 * in the DOM as a text-node character (inside either a marker span or a content
 * run), so DOM ⇄ source offset mapping is 1:1 and lossless. Content is emitted
 * from the raw SOURCE slice (never `node.value`), so escapes/entities map 1:1
 * (`&` is one source char and one DOM char — we never emit HTML entities).
 *
 * Editing strategy — the surface is UNCONTROLLED while focused/composing: React
 * never re-sets the DOM mid-edit (the div carries no React children; the DOM is
 * built imperatively), so the caret never jumps. On `input` the new plain text is
 * reconstructed from the DOM, diffed against the block's stored source to a scoped
 * `{from,to,insert}` splice, and reported via `onChange`. The marker spans are
 * only re-tokenised on a settle debounce / blur, and the reveal set is applied as
 * a caret-safe class toggle (no text-node mutation) on selection change.
 *
 * Security — this component NEVER uses `dangerouslySetInnerHTML`. The DOM is built
 * from the parsed inline node tree + {@link collectMarkers} ranges using text
 * nodes and element spans we create, mirroring what render.ts escapes. Link/image
 * URLs pass {@link safeUrl}; the only thing toggled is marker-span visibility.
 *
 * IME — composition is the platform's (SPEC §4.4): during composition model sync
 * and re-tokenisation are suppressed; on `compositionend` the composed text is
 * committed once and the block re-tokenises.
 */

/* ------------------------------------------------------------------ *
 * Pure model — segments, markers, offset mapping, splice
 * (no component state; exported so they are unit-testable in isolation)
 * ------------------------------------------------------------------ */

/** A formatting element that wraps a source range (`em`/`strong`/`a`/`code`/…). */
export interface FmtTag {
  /** The AST node — its identity groups adjacent segments into one element. */
  node: AstNode;
  tag: string;
  from: number;
  to: number;
  href?: string;
  className?: string;
}

/** A leaf of the flat block layout: a content run or a hideable marker. */
export interface Segment {
  from: number;
  to: number;
  /** The raw source slice (never a decoded value) — preserves 1:1 mapping. */
  text: string;
  kind: 'content' | 'marker';
  /** {@link import('../core').Marker.kind} for a marker segment. */
  markerKind?: string;
  /** Formatting elements wrapping this segment, outermost-first. */
  tags: FmtTag[];
}

/** Wrap a single block as a one-child document so the core walkers accept it. */
export function wrapBlock(block: Block): Document {
  return { type: 'document', from: block.from, to: block.to, children: [block] };
}

/** First / last descendant text node of a DOM node (or itself when it is text). */
function firstTextIn(node: Node): Text | null {
  if (node.nodeType === 3) return node as Text;
  const w = node.ownerDocument!.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  return (w.nextNode() as Text) ?? null;
}
function lastTextIn(node: Node): Text | null {
  if (node.nodeType === 3) return node as Text;
  const w = node.ownerDocument!.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let n = w.nextNode();
  while (n) {
    last = n as Text;
    n = w.nextNode();
  }
  return last;
}

/**
 * Every inline formatting node under `doc`, as a wrapping range + element. The
 * delimiter runs are NOT part of a node's inner range (they stay outside the
 * element, so `**` renders un-bolded), except links/autolinks/images/math/
 * footnote refs which wrap their whole span so the element (and its `href`)
 * still applies with the markers hidden.
 */
export function collectFmtTags(doc: Document): FmtTag[] {
  const out: FmtTag[] = [];
  walk(doc, (n) => {
    switch (n.type) {
      case 'emphasis':
      case 'strong':
      case 'strikethrough': {
        const kids = n.children;
        const first = kids[0];
        const last = kids[kids.length - 1];
        if (first && last) {
          const tag = n.type === 'emphasis' ? 'em' : n.type === 'strong' ? 'strong' : 'del';
          out.push({ node: n, tag, from: first.from, to: last.to });
        }
        break;
      }
      case 'inlineCode': {
        const ticks = Math.max(1, n.ticks);
        const from = Math.min(n.from + ticks, n.to);
        const to = Math.max(n.to - ticks, from);
        out.push({ node: n, tag: 'code', from, to });
        break;
      }
      case 'link':
      case 'autolink':
        out.push({ node: n, tag: 'a', from: n.from, to: n.to, href: safeUrl(n.url) });
        break;
      case 'image':
        out.push({ node: n, tag: 'span', className: 'tw-cr-img', from: n.from, to: n.to });
        break;
      case 'math':
        out.push({ node: n, tag: 'span', className: 'tw-math-src', from: n.from, to: n.to });
        break;
      case 'footnoteRef':
        out.push({ node: n, tag: 'sup', className: 'tw-fnref', from: n.from, to: n.to });
        break;
    }
    return true;
  });
  return out;
}

/** Formatting tags fully containing `[from,to)`, outermost-first. */
function tagsAt(fmts: FmtTag[], from: number, to: number): FmtTag[] {
  return fmts
    .filter((f) => f.from <= from && to <= f.to && f.to > f.from)
    .sort((a, b) => a.from - b.from || b.to - a.to);
}

/**
 * Partition the block's source range into an ordered list of content + marker
 * segments. Marker ranges come from {@link collectMarkers} (the single source of
 * truth, so the reveal decision always lines up); the gaps between them are
 * content. The concatenation of every segment's `text` equals the block source.
 */
export function buildSegments(block: Block, source: string): Segment[] {
  const doc = wrapBlock(block);
  const markers = collectMarkers(doc, source)
    .filter((m) => m.from >= block.from && m.to <= block.to && m.to > m.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const fmts = collectFmtTags(doc);

  const segs: Segment[] = [];
  let cur = block.from;
  const pushContent = (from: number, to: number): void => {
    if (to > from) segs.push({ from, to, text: source.slice(from, to), kind: 'content', tags: tagsAt(fmts, from, to) });
  };
  for (const m of markers) {
    if (m.to <= cur) continue; // wholly covered by a previous marker (defensive)
    const from = Math.max(m.from, cur);
    if (from > cur) pushContent(cur, from);
    segs.push({ from, to: m.to, text: source.slice(from, m.to), kind: 'marker', markerKind: m.kind, tags: tagsAt(fmts, from, m.to) });
    cur = m.to;
  }
  pushContent(cur, block.to);
  return segs;
}

/** A stable `data-from:data-to` key for a marker, in BLOCK-LOCAL offsets. */
function markerKeyLocal(from: number, to: number, blockFrom: number): string {
  return `${from - blockFrom}:${to - blockFrom}`;
}

/**
 * The block's HIDDEN marker keys (block-local) for a selection — the markers the
 * caret is NOT on. `sel` in document offsets, or `null`/`'all'` to hide every
 * marker (the resting, fully-rendered look when the block is unfocused).
 */
export function hiddenKeySet(block: Block, source: string, sel: { from: number; to: number } | null): Set<string> {
  const doc = wrapBlock(block);
  const set = new Set<string>();
  if (!sel) {
    for (const m of collectMarkers(doc, source)) {
      if (m.from >= block.from && m.to <= block.to && m.to > m.from) set.add(markerKeyLocal(m.from, m.to, block.from));
    }
    return set;
  }
  for (const m of hiddenMarkers(doc, sel, source)) {
    if (m.from >= block.from && m.to <= block.to && m.to > m.from) set.add(markerKeyLocal(m.from, m.to, block.from));
  }
  return set;
}

/** Every text node under `root`, in document order (INCLUDING hidden markers). */
function flattenText(root: Node): Text[] {
  const out: Text[] = [];
  const w = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = w.nextNode();
  while (n) {
    out.push(n as Text);
    n = w.nextNode();
  }
  return out;
}

/** Reconstruct the block source from `root`'s text nodes (the DOM is the truth). */
export function reconstructSource(root: Node): string {
  let s = '';
  for (const t of flattenText(root)) s += t.data;
  return s;
}

/**
 * Map a DOM point `(node, offset)` to a BLOCK-LOCAL source offset. Hidden marker
 * spans still contribute their source length (they are real text nodes), so a
 * caret at the start of visible `bold` correctly sits past the hidden `**`.
 */
export function offsetOfPoint(root: Node, node: Node, offset: number): number {
  const texts = flattenText(root);
  let target: Text | null = null;
  let local = 0;
  if (node.nodeType === 3) {
    target = node as Text;
    local = offset;
  } else {
    const child = node.childNodes[offset] ?? null;
    if (child) {
      target = firstTextIn(child);
      local = 0;
      if (!target) {
        const prev = node.childNodes[offset - 1];
        target = prev ? lastTextIn(prev) : null;
        local = target ? target.data.length : 0;
      }
    } else {
      const prev = node.childNodes[node.childNodes.length - 1];
      target = prev ? lastTextIn(prev) : null;
      local = target ? target.data.length : 0;
    }
  }
  if (!target) return 0;
  let acc = 0;
  for (const t of texts) {
    if (t === target) return acc + Math.min(local, t.data.length);
    acc += t.data.length;
  }
  return acc;
}

/** Map a BLOCK-LOCAL source offset to a DOM point `(node, offset)`. */
export function pointAtOffset(root: Node, offset: number): { node: Node; offset: number } {
  const texts = flattenText(root);
  let acc = 0;
  for (const t of texts) {
    const len = t.data.length;
    if (offset <= acc + len) return { node: t, offset: Math.max(0, offset - acc) };
    acc += len;
  }
  const last = texts[texts.length - 1];
  return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 };
}

/**
 * Minimal `{from,to,insert}` splice turning `oldStr` into `newStr` (trim the
 * shared prefix + suffix), in the string's own offsets. Mirrors the editor's
 * `minimizeChange` so a single keystroke yields a single-character splice.
 */
export function computeSplice(oldStr: string, newStr: string): { from: number; to: number; insert: string } {
  let p = 0;
  const maxP = Math.min(oldStr.length, newStr.length);
  while (p < maxP && oldStr.charCodeAt(p) === newStr.charCodeAt(p)) p++;
  let s = 0;
  const maxS = Math.min(oldStr.length - p, newStr.length - p);
  while (s < maxS && oldStr.charCodeAt(oldStr.length - 1 - s) === newStr.charCodeAt(newStr.length - 1 - s)) s++;
  return { from: p, to: oldStr.length - s, insert: newStr.slice(p, newStr.length - s) };
}

/* ------------------------------------------------------------------ *
 * DOM painting (imperative — the surface is uncontrolled while editing)
 * ------------------------------------------------------------------ */

/** Hidden-marker set, or `'all'` to hide every marker. */
type Hidden = Set<string> | 'all';

function isHidden(hidden: Hidden, key: string): boolean {
  return hidden === 'all' || hidden.has(key);
}

/**
 * (Re)build `root`'s children from `segs`. Adjacent segments sharing a formatting
 * node reuse one element (diffed by node identity), so nesting is exact. Only
 * text nodes + spans/elements we create are used — never innerHTML.
 */
export function paintSegments(root: HTMLElement, segs: Segment[], hidden: Hidden, blockFrom: number): void {
  const doc = root.ownerDocument!;
  while (root.firstChild) root.removeChild(root.firstChild);
  const stack: { node: AstNode; el: HTMLElement }[] = [];
  for (const seg of segs) {
    let common = 0;
    while (common < stack.length && common < seg.tags.length && stack[common]!.node === seg.tags[common]!.node) common++;
    stack.length = common;
    let parent: HTMLElement = common > 0 ? stack[common - 1]!.el : root;
    for (let k = common; k < seg.tags.length; k++) {
      const t = seg.tags[k]!;
      const el = doc.createElement(t.tag);
      if (t.href !== undefined) el.setAttribute('href', t.href);
      if (t.className) el.className = t.className;
      parent.appendChild(el);
      stack.push({ node: t.node, el });
      parent = el;
    }
    if (seg.kind === 'marker') {
      const span = doc.createElement('span');
      span.className = 'tw-syntax';
      span.setAttribute('data-mark', seg.markerKind ?? '');
      const key = markerKeyLocal(seg.from, seg.to, blockFrom);
      span.setAttribute('data-from', String(seg.from - blockFrom));
      span.setAttribute('data-to', String(seg.to - blockFrom));
      span.appendChild(doc.createTextNode(seg.text));
      if (isHidden(hidden, key)) span.classList.add('tw-syntax--hidden');
      parent.appendChild(span);
    } else {
      parent.appendChild(doc.createTextNode(seg.text));
    }
  }
}

/**
 * Toggle marker-span visibility for a new reveal set WITHOUT touching any text
 * node — so the caret is never disturbed (SPEC §5.2 keeps the caret stable while
 * markers reveal). Cheap: one class flip per marker span.
 */
export function applyReveal(root: HTMLElement, hidden: Hidden): void {
  const spans = root.querySelectorAll<HTMLElement>('span.tw-syntax[data-from]');
  spans.forEach((span) => {
    const key = `${span.getAttribute('data-from')}:${span.getAttribute('data-to')}`;
    span.classList.toggle('tw-syntax--hidden', isHidden(hidden, key));
  });
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface CaretRevealBlockProps {
  /** The parsed block whose offsets index into {@link source}. */
  block: Block;
  /** Full document source (the single source of truth). */
  source: string;
  /** Emit a scoped splice: `source[from..to]` becomes `insert`. */
  onChange: (change: { from: number; to: number; insert: string }) => void;
  readOnly?: boolean;
}

/** Milliseconds to defer the reveal update after a click so the caret settles. */
const CLICK_SETTLE_MS = 40;
/** A selection change within this window of a pointerdown is treated as a click. */
const CLICK_WINDOW_MS = 250;
/** Idle after typing before the block re-tokenises (applies new markers). */
const SETTLE_MS = 140;

/** Class + level suffix for the block's editable region. */
function blockClass(block: Block): string {
  let c = 'tw-caret-block';
  switch (block.type) {
    case 'heading':
      c += ` tw-cr-heading tw-cr-h${block.level}`;
      break;
    case 'blockquote':
      c += ' tw-cr-blockquote';
      break;
    case 'list':
      c += ' tw-cr-list';
      break;
    default:
      c += ' tw-cr-paragraph';
  }
  return c;
}

export function CaretRevealBlock(props: CaretRevealBlockProps): React.ReactElement {
  const { block, source, onChange, readOnly = false } = props;

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Latest props read by imperative handlers/timers (they outlive a render).
  const propsRef = React.useRef(props);
  propsRef.current = props;

  const editingRef = React.useRef(false);
  const composingRef = React.useRef(false);
  const blockSrcRef = React.useRef(source.slice(block.from, block.to));
  const blockFromRef = React.useRef(block.from);
  // Key of the currently-painted content, so a pure offset shift in another block
  // (same text) doesn't force a needless rebuild while this one is unfocused.
  const builtKeyRef = React.useRef<string | null>(null);
  const lastPointerRef = React.useRef(0);
  const settleTimer = React.useRef<number | null>(null);
  const revealTimer = React.useRef<number | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  /** Current in-block selection as document offsets, or null (caret elsewhere). */
  const readSelection = React.useCallback((): { from: number; to: number } | null => {
    const root = rootRef.current;
    if (!root) return null;
    const win = root.ownerDocument?.defaultView;
    const sel = win?.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
    const base = blockFromRef.current;
    const a = offsetOfPoint(root, sel.anchorNode, sel.anchorOffset) + base;
    const f = sel.focusNode && root.contains(sel.focusNode) ? offsetOfPoint(root, sel.focusNode, sel.focusOffset) + base : a;
    return { from: Math.min(a, f), to: Math.max(a, f) };
  }, []);

  /** Place the collapsed caret at a document offset, skipping hidden markers. */
  const restoreCaret = React.useCallback((docOffset: number): void => {
    const root = rootRef.current;
    if (!root) return;
    const win = root.ownerDocument?.defaultView;
    if (!win) return;
    let { node, offset } = pointAtOffset(root, docOffset - blockFromRef.current);
    // A caret cannot rest inside a display:none marker — nudge to the nearest
    // visible text node so the placement actually takes.
    const inHidden = (n: Node): boolean =>
      (n.nodeType === 3 ? (n as Text).parentElement : (n as Element))?.closest('.tw-syntax--hidden') != null;
    if (inHidden(node)) {
      const texts = flattenText(root);
      const idx = texts.indexOf(node as Text);
      let j = idx + 1;
      while (j < texts.length && inHidden(texts[j]!)) j++;
      if (j < texts.length) {
        node = texts[j]!;
        offset = 0;
      } else {
        let k = idx - 1;
        while (k >= 0 && inHidden(texts[k]!)) k--;
        if (k >= 0) {
          node = texts[k]!;
          offset = texts[k]!.data.length;
        }
      }
    }
    try {
      const range = root.ownerDocument!.createRange();
      range.setStart(node, Math.min(offset, node.nodeType === 3 ? (node as Text).data.length : node.childNodes.length));
      range.collapse(true);
      const sel = win.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* selection can throw across a re-render race — safe to ignore */
    }
  }, []);

  /** Full (re)paint from the given props + reveal selection. */
  const paint = React.useCallback((b: Block, src: string, sel: { from: number; to: number } | null): void => {
    const root = rootRef.current;
    if (!root) return;
    const segs = buildSegments(b, src);
    const hidden: Hidden = sel ? hiddenKeySet(b, src, sel) : 'all';
    paintSegments(root, segs, hidden, b.from);
    blockSrcRef.current = src.slice(b.from, b.to);
    blockFromRef.current = b.from;
    builtKeyRef.current = `${b.from}:${blockSrcRef.current}`;
  }, []);

  /** Reveal-only pass for the live selection (caret-safe class toggle). */
  const updateReveal = React.useCallback((): void => {
    const root = rootRef.current;
    if (!root) return;
    const { block: b, source: src } = propsRef.current;
    const sel = readSelection();
    applyReveal(root, sel ? hiddenKeySet(b, src, sel) : 'all');
  }, [readSelection]);

  /** Read the DOM, diff to a scoped splice, report it (skipped while composing). */
  const syncModel = React.useCallback((): void => {
    const root = rootRef.current;
    if (!root) return;
    const next = reconstructSource(root);
    const prev = blockSrcRef.current;
    if (next === prev) return;
    const sp = computeSplice(prev, next);
    blockSrcRef.current = next; // optimistic; the parent's re-parse confirms it
    const base = blockFromRef.current;
    onChangeRef.current({ from: base + sp.from, to: base + sp.to, insert: sp.insert });
  }, []);

  /** After typing settles, re-tokenise from the (now committed) props + restore caret. */
  const settleRetokenize = React.useCallback((): void => {
    const root = rootRef.current;
    if (!root || composingRef.current || !editingRef.current) return;
    const { block: b, source: src } = propsRef.current;
    // Only re-tokenise once the props reflect the DOM, so a not-yet-committed
    // keystroke is never clobbered by a stale re-paint.
    if (src.slice(b.from, b.to) !== reconstructSource(root)) return;
    const sel = readSelection();
    paint(b, src, sel);
    if (sel) restoreCaret(sel.to);
  }, [paint, readSelection, restoreCaret]);

  const scheduleSettle = React.useCallback((): void => {
    const win = rootRef.current?.ownerDocument?.defaultView;
    if (!win) return;
    if (settleTimer.current != null) win.clearTimeout(settleTimer.current);
    settleTimer.current = win.setTimeout(() => {
      settleTimer.current = null;
      settleRetokenize();
    }, SETTLE_MS);
  }, [settleRetokenize]);

  /* --- prop-driven build: runs when unfocused (never mid-edit) --- */
  React.useLayoutEffect(() => {
    if (editingRef.current) return; // uncontrolled while editing — never clobber
    const key = `${block.from}:${source.slice(block.from, block.to)}`;
    if (builtKeyRef.current === key) {
      // Same content + position already painted — nothing to do.
      blockSrcRef.current = source.slice(block.from, block.to);
      blockFromRef.current = block.from;
      return;
    }
    paint(block, source, null);
  }, [block, source, readOnly, paint]);

  /* --- selection change: caret-safe reveal (debounced after a click) --- */
  React.useEffect(() => {
    const root = rootRef.current;
    const doc = root?.ownerDocument;
    if (!doc) return undefined;
    const win = doc.defaultView;
    const onSelectionChange = (): void => {
      if (!editingRef.current || composingRef.current) return;
      const sel = win?.getSelection();
      if (!sel || !sel.anchorNode || !root!.contains(sel.anchorNode)) return;
      const clickInitiated = Date.now() - lastPointerRef.current < CLICK_WINDOW_MS;
      if (revealTimer.current != null) win?.clearTimeout(revealTimer.current);
      if (clickInitiated && win) {
        revealTimer.current = win.setTimeout(() => {
          revealTimer.current = null;
          updateReveal();
        }, CLICK_SETTLE_MS);
      } else {
        updateReveal();
      }
    };
    doc.addEventListener('selectionchange', onSelectionChange);
    return () => {
      doc.removeEventListener('selectionchange', onSelectionChange);
      if (win) {
        if (revealTimer.current != null) win.clearTimeout(revealTimer.current);
        if (settleTimer.current != null) win.clearTimeout(settleTimer.current);
      }
    };
  }, [updateReveal]);

  /* --- editable-surface event handlers --- */
  const onFocus = React.useCallback((): void => {
    editingRef.current = true;
    updateReveal();
  }, [updateReveal]);

  const onBlur = React.useCallback((): void => {
    editingRef.current = false;
    const win = rootRef.current?.ownerDocument?.defaultView;
    if (win) {
      if (settleTimer.current != null) win.clearTimeout(settleTimer.current);
      if (revealTimer.current != null) win.clearTimeout(revealTimer.current);
    }
    // Repaint the resting, fully-rendered look from the committed props.
    const { block: b, source: src } = propsRef.current;
    builtKeyRef.current = null;
    paint(b, src, null);
  }, [paint]);

  const onInput = React.useCallback((): void => {
    if (composingRef.current) return;
    syncModel();
    scheduleSettle();
  }, [syncModel, scheduleSettle]);

  const onCompositionStart = React.useCallback((): void => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = React.useCallback((): void => {
    composingRef.current = false;
    syncModel();
    scheduleSettle();
  }, [syncModel, scheduleSettle]);

  const onPointerDown = React.useCallback((): void => {
    lastPointerRef.current = Date.now();
  }, []);

  // Keep Enter/paste as plain text so the DOM stays a faithful mirror of source
  // (a contentEditable would otherwise inject <div>/<br>/rich HTML we can't map).
  const onKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (readOnly) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      insertPlainText(e.currentTarget, '\n');
    }
  }, [readOnly]);

  const onPaste = React.useCallback((e: React.ClipboardEvent<HTMLDivElement>): void => {
    if (readOnly) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) insertPlainText(e.currentTarget, text);
  }, [readOnly]);

  const label =
    block.type === 'heading' ? `Heading ${block.level}` : block.type === 'blockquote' ? 'Blockquote' : block.type === 'list' ? 'List' : 'Paragraph';

  return (
    <div
      ref={rootRef}
      className={blockClass(block)}
      data-typewright="caret-block"
      data-block-type={block.type}
      data-tw-from={block.from}
      data-tw-to={block.to}
      role="textbox"
      aria-multiline="true"
      aria-label={`${label} (Markdown, source reveals at the caret)`}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={readOnly ? undefined : 0}
      onFocus={readOnly ? undefined : onFocus}
      onBlur={readOnly ? undefined : onBlur}
      onInput={readOnly ? undefined : onInput}
      onCompositionStart={readOnly ? undefined : onCompositionStart}
      onCompositionEnd={readOnly ? undefined : onCompositionEnd}
      onPointerDown={readOnly ? undefined : onPointerDown}
      onKeyDown={readOnly ? undefined : onKeyDown}
      onPaste={readOnly ? undefined : onPaste}
    />
  );
}

/** Insert plain text at the caret, firing a normal `input` event for sync. */
function insertPlainText(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument;
  const win = doc?.defaultView;
  // `execCommand` keeps undo history + fires `input`; guard for environments
  // (jsdom) where it is absent — the caret-sync path still runs on `input`.
  const exec = (doc as unknown as { execCommand?: (c: string, s: boolean, v: string) => boolean } | undefined)?.execCommand;
  if (doc && typeof exec === 'function') {
    try {
      if (exec.call(doc, 'insertText', false, text)) return;
    } catch {
      /* fall through to manual insertion */
    }
  }
  const sel = win?.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = doc!.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  root.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ------------------------------------------------------------------ *
 * Styles (injected into the editor's single stylesheet)
 * ------------------------------------------------------------------ */

export const CARET_REVEAL_CSS = `
.tw-caret-block{white-space:pre-wrap;overflow-wrap:break-word;outline:none;cursor:text;border-radius:6px;padding:1px 4px;margin-left:-4px;transition:background .15s}
.tw-mode-unified .tw-caret-block:hover{background:var(--tw-accent-soft)}
.tw-caret-block:focus-visible{outline:2px solid var(--tw-accent);outline-offset:2px}
.tw-caret-block.tw-cr-heading{font-weight:680;letter-spacing:-.02em;line-height:1.25}
.tw-caret-block.tw-cr-h1{font-size:1.8em} .tw-caret-block.tw-cr-h2{font-size:1.45em} .tw-caret-block.tw-cr-h3{font-size:1.2em} .tw-caret-block.tw-cr-h4{font-size:1.05em} .tw-caret-block.tw-cr-h5{font-size:1em} .tw-caret-block.tw-cr-h6{font-size:.92em;color:var(--tw-muted)}
.tw-caret-block.tw-cr-blockquote{border-left:3px solid var(--tw-line);padding-left:14px;color:var(--tw-muted)}
.tw-caret-block.tw-cr-list{padding-left:6px}
.tw-caret-block a{color:var(--tw-accent);text-decoration:none;border-bottom:1px solid var(--tw-accent-soft)}
.tw-caret-block code{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:.88em;background:var(--tw-chip);border:1px solid var(--tw-line);border-radius:5px;padding:1px 5px}
.tw-caret-block .tw-cr-img{color:var(--tw-muted);font-style:italic}
.tw-caret-block .tw-fnref{font-size:.82em;color:var(--tw-accent)}
/* Revealed marker: subtle, monospace, "you are editing raw syntax". */
.tw-syntax{font-family:"SF Mono",ui-monospace,Menlo,monospace;color:var(--tw-faint);opacity:.85;font-weight:400;font-style:normal}
/* Hidden marker: collapsed out of layout, but its source chars stay in the DOM
   (and in this component's offset mapping) — never removed from the string. */
.tw-syntax--hidden{display:none}
@media (prefers-reduced-motion: reduce){ .tw-caret-block{transition:none} }
`;
