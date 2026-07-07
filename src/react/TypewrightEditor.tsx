import * as React from 'react';
import { applyCommand, COMMANDS, highlightToHtml, mapAnchor, parse, renderNode, renderToHtml } from '../core';
import type { Block, Command, ParseOptions, RenderOptions } from '../core';
import type {
  CommentsOptions,
  CommentThread,
  DocChange,
  EditorConfig,
  EditorEvents,
  EditorMode,
  Extensions,
  FoldingOptions,
  KeymapOptions,
  PresencePeer,
  SettingsOptions,
} from '../types';
import { CommentsSidebar, COMMENTS_CSS } from './CommentsSidebar';
import { FoldMenu, FOLDMENU_CSS } from './FoldMenu';
import { CommandPalette, SettingsPanel, SETTINGS_CSS } from './SettingsSurface';
import type { PaletteCommand, SettingsState } from './SettingsSurface';
import { TableGrid, TABLEGRID_CSS } from './TableGrid';

/** Imperative handle exposed via a ref on `<TypewrightEditor>`. */
export interface TypewrightEditorHandle {
  /** Apply a formatting command to the currently-focused editing surface. */
  applyCommand: (command: Command) => void;
  /** Switch the editor mode; also fires `onModeChange`. */
  setMode: (mode: EditorMode) => void;
}

/** Registration of the currently-focused source textarea (for toolbar commands). */
interface ActiveSource {
  apply: (command: Command) => void;
}

/**
 * Typewright — drop-in Markdown + MDX editor React component.
 *
 * v1 engine (real, tested): the string is the source of truth; rendering goes
 * through the sanitizing renderer (render.ts escapes text, guards URLs, and
 * never emits raw HTML/MDX), so the `dangerouslySetInnerHTML` below is safe.
 *
 * Modes:
 *  - `edit`     raw Markdown source (textarea) with standard shortcuts
 *  - `unified`  live preview; click a block to reveal + edit its Markdown source
 *  - `preview`  fully rendered
 *  - `read`     fully rendered, no editing affordances
 *
 * Deferred to later phases (SPEC.md): character-level inline marker reveal,
 * custom virtualization/IME, MDX JSX sandbox execution, Mermaid, in-place table
 * grid, comments/collaboration. These are represented in the design demo.
 */
export interface TypewrightEditorProps extends EditorConfig, EditorEvents {
  /** Controlled Markdown value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  className?: string;
  style?: React.CSSProperties;
}

const STYLE_ID = 'typewright-styles';

export function useInjectStyles(): void {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    // One injected sheet keyed by STYLE_ID carries the editor chrome plus the
    // widget-island styles (table grid + fold menu + comments sidebar +
    // settings panel / command palette), so consumers need no extra CSS.
    el.textContent = TYPEWRIGHT_CSS + TABLEGRID_CSS + FOLDMENU_CSS + COMMENTS_CSS + SETTINGS_CSS;
    document.head.appendChild(el);
  }, []);
}

/** Whether an extension flag is on: `true`, or an options object not explicitly disabled. */
function extEnabled(x: boolean | { enabled?: boolean } | undefined, dflt = false): boolean {
  if (x === undefined) return dflt;
  if (typeof x === 'boolean') return x;
  return x.enabled !== false;
}

/* ------------------------------------------------------------------ *
 * Keymap — shortcuts dispatch real COMMANDS through `applyCommand`
 * (toggle-aware, so ⌘B twice returns the original text), never the
 * insert-only wrap that would double-wrap.
 * ------------------------------------------------------------------ */

/** Command ids that exist, for validating host-supplied bindings. */
const COMMAND_IDS = new Set<string>(COMMANDS.map((c) => c.id));

/** Canonical binding string: modifiers (mod, alt, shift) then key, e.g. `mod+b`. */
function canonKey(raw: string): string {
  const toks = raw
    .toLowerCase()
    .replace(/-/g, '+')
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean);
  let mod = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const t of toks) {
    if (t === 'mod' || t === 'cmd' || t === 'meta' || t === 'ctrl' || t === 'control') mod = true;
    else if (t === 'alt' || t === 'option' || t === 'opt') alt = true;
    else if (t === 'shift') shift = true;
    else key = t;
  }
  const parts: string[] = [];
  if (mod) parts.push('mod');
  if (alt) parts.push('alt');
  if (shift) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/** A displayed shortcut (`⌘B`, `⇧⌥K`) → a canonical binding string. */
function kbdToBinding(kbd: string): string | null {
  let key = '';
  const mods: string[] = [];
  for (const ch of kbd) {
    if (ch === '⌘' || ch === '⌃') mods.push('mod');
    else if (ch === '⇧') mods.push('shift');
    else if (ch === '⌥') mods.push('alt');
    else if (ch.trim()) key += ch;
  }
  key = key.toLowerCase();
  if (!key) return null;
  return canonKey([...mods, key].join('+'));
}

/** The canonical binding string for a live keyboard event. */
function eventCanon(e: React.KeyboardEvent<HTMLTextAreaElement>): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

/**
 * Build the active binding map from {@link KeymapOptions}. The `default` preset
 * seeds bindings from every command's displayed `kbd`; `none` starts empty.
 * `keymap.bindings` (keys like `"Mod-b"`) then override, keeping only valid ids.
 */
function buildKeymap(keymap?: KeymapOptions): Map<string, Command> {
  const map = new Map<string, Command>();
  if ((keymap?.preset ?? 'default') !== 'none') {
    for (const c of COMMANDS) {
      if (!c.kbd) continue;
      const b = kbdToBinding(c.kbd);
      if (b) map.set(b, c.id);
    }
  }
  if (keymap?.bindings) {
    for (const [raw, cmd] of Object.entries(keymap.bindings)) {
      if (COMMAND_IDS.has(cmd)) map.set(canonKey(raw), cmd as Command);
    }
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Collaboration — anchored comments + live presence (plan A3/A4)
 * ------------------------------------------------------------------ *
 * A controlled, data-in/events-out surface. The host owns the threads; the
 * editor keeps a LOCAL map of live anchor positions that survive edits (via
 * `mapAnchor` on every commit) and draws highlights + remote cursors over the
 * rendered content by wrapping existing text nodes — never by string-injecting
 * HTML, so the render.ts sanitizer boundary is untouched.
 */

/** Normalize `comments` (`boolean | CommentsOptions`) to options-or-null. */
function normalizeComments(comments: boolean | CommentsOptions | undefined): CommentsOptions | null {
  if (!comments) return null;
  if (comments === true) return { enabled: true, threads: [] };
  return comments;
}

/** Normalize `settings` (`boolean | SettingsOptions`) to options-or-null. */
function normalizeSettings(settings: boolean | SettingsOptions | undefined): SettingsOptions | null {
  if (!settings) return null;
  if (settings === true) return { enabled: true };
  return settings;
}

/** A single live decoration: where a thread's highlight is drawn *now*. */
interface LiveDecoration {
  id: string;
  from: number;
  to: number;
  quote: string;
}

/** A pending selection the "💬 Comment" popup is offered for. */
interface PendingSelection {
  anchor: { from: number; to: number };
  quote: string;
  /** Viewport coordinates the popup/composer anchor to (position: fixed). */
  x: number;
  y: number;
}

/**
 * Reduce a Markdown source slice to its approximate rendered text so a comment
 * highlight can be located by string match against the rendered DOM (where the
 * markers have been stripped). Conservative: strips the common block + inline
 * markers and collapses whitespace; anything it misses just means the match
 * falls back to a coarser range, never a wrong or unsafe one.
 */
function plainify(src: string): string {
  let s = src;
  // Leading block markers (heading / blockquote / list / task).
  s = s.replace(/^\s*#{1,6}\s+/, '');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '');
  // Inline links / images → their visible text.
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Inline emphasis / code / strike markers.
  s = s.replace(/(\*\*|__|~~|\*|_|`)/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** Initials for a presence chip (up to two letters). */
function peerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Merge host threads with locally-created (optimistic) ones, dropping any local
 * thread the host has since echoed back (matched by quote + body) so a created
 * comment shows instantly and de-duplicates once the host re-supplies `threads`.
 */
function mergeThreads(host: CommentThread[], local: CommentThread[]): CommentThread[] {
  if (local.length === 0) return host;
  const echoed = (l: CommentThread): boolean =>
    host.some((h) => h.quote === l.quote && h.body === l.body);
  return [...host, ...local.filter((l) => !echoed(l))];
}

/**
 * Tighten a change to its minimal edit by trimming the common prefix/suffix of
 * the replaced text and the inserted text. Whole-region replaces — the block
 * commit `{from,to,insert:draft}` and command applies `{from:0,to:len,insert}` —
 * would otherwise span text that did not actually change, so `mapAnchor` would
 * collapse any anchor inside that span. Minimizing first keeps anchors alive
 * across in-block edits and command applies (SPEC edge case).
 */
function minimizeChange(change: DocChange, prevDoc: string): DocChange {
  const { from, to } = change;
  const removed = prevDoc.slice(from, to);
  const inserted = change.insert;
  let p = 0;
  const maxP = Math.min(removed.length, inserted.length);
  while (p < maxP && removed.charCodeAt(p) === inserted.charCodeAt(p)) p++;
  let s = 0;
  const maxS = Math.min(removed.length - p, inserted.length - p);
  while (s < maxS && removed.charCodeAt(removed.length - 1 - s) === inserted.charCodeAt(inserted.length - 1 - s)) s++;
  return { from: from + p, to: to - s, insert: inserted.slice(p, inserted.length - s) };
}

/* ---- DOM text-node decoration (sanitizer-safe: wraps existing nodes) ---- */

/** Remove every collab decoration this module previously inserted into `scope`. */
function clearDecorations(scope: HTMLElement): void {
  scope.querySelectorAll('mark.tw-comment').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
  scope.querySelectorAll('.tw-remote-cursor').forEach((c) => c.remove());
  scope.normalize();
}

/** The concatenated text-node content of `scope`, plus a locator by char index. */
function textNodesOf(scope: HTMLElement): { nodes: Text[]; text: string } {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = '';
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    nodes.push(t);
    text += t.nodeValue ?? '';
    n = walker.nextNode();
  }
  return { nodes, text };
}

/** Resolve a char index within `scope`'s text to a `{node, offset}` position. */
function locateCharIndex(nodes: Text[], index: number): { node: Text; offset: number } | null {
  let pos = 0;
  for (const node of nodes) {
    const len = node.nodeValue?.length ?? 0;
    if (index <= pos + len) return { node, offset: Math.max(0, index - pos) };
    pos += len;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

/**
 * Wrap the `[start, end)` character span of `scope`'s concatenated text in a
 * `<mark class="tw-comment" data-thread=id>`. Splits at text-node boundaries so
 * each wrapped fragment stays inside one text node (safe for `surroundContents`).
 */
function wrapCharRange(scope: HTMLElement, start: number, end: number, id: string, flash: boolean): HTMLElement | null {
  if (end <= start) return null;
  const { nodes } = textNodesOf(scope);
  const segments: { node: Text; s: number; e: number }[] = [];
  let pos = 0;
  for (const node of nodes) {
    const len = node.nodeValue?.length ?? 0;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    const s = Math.max(start, nodeStart);
    const e = Math.min(end, nodeEnd);
    if (s < e) segments.push({ node, s: s - nodeStart, e: e - nodeStart });
    pos = nodeEnd;
    if (pos >= end) break;
  }
  let first: HTMLElement | null = null;
  for (const seg of segments) {
    const range = document.createRange();
    range.setStart(seg.node, seg.s);
    range.setEnd(seg.node, seg.e);
    const mark = document.createElement('mark');
    mark.className = flash ? 'tw-comment tw-comment-flash' : 'tw-comment';
    mark.setAttribute('data-thread', id);
    try {
      range.surroundContents(mark);
    } catch {
      continue; // a boundary we can't cleanly wrap — skip this fragment
    }
    if (!first) first = mark;
  }
  return first;
}

/** Insert a thin remote-cursor caret at a char index within `scope`. */
function insertRemoteCursor(scope: HTMLElement, index: number, peer: PresencePeer): void {
  const { nodes } = textNodesOf(scope);
  const loc = locateCharIndex(nodes, index);
  if (!loc) return;
  const range = document.createRange();
  range.setStart(loc.node, loc.offset);
  range.collapse(true);
  const caret = document.createElement('span');
  caret.className = 'tw-remote-cursor';
  caret.setAttribute('data-peer', peer.name);
  if (peer.color) caret.style.setProperty('--tw-remote', peer.color);
  const label = document.createElement('span');
  label.className = 'tw-remote-flag';
  label.textContent = peer.name;
  caret.appendChild(label);
  range.insertNode(caret);
}

/**
 * Apply comment highlights + presence carets to the rendered content in
 * `container`. Scoped per rendered block (`.tw-block[data-tw-from]`) when those
 * exist (unified/preview), else treated as one whole-document scope (read mode).
 */
function applyDecorations(
  container: HTMLElement,
  source: string,
  decorations: LiveDecoration[],
  peers: PresencePeer[],
  activeThreadId: string | undefined,
): void {
  clearDecorations(container);

  const blockEls = Array.from(container.querySelectorAll<HTMLElement>('.tw-block[data-tw-from]'));
  const scopes: { el: HTMLElement; from: number; to: number }[] =
    blockEls.length > 0
      ? blockEls.map((el) => ({
          el,
          from: Number(el.getAttribute('data-tw-from')) || 0,
          to: Number(el.getAttribute('data-tw-to')) || 0,
        }))
      : [{ el: container, from: 0, to: source.length }];

  let flashTarget: HTMLElement | null = null;

  for (const scope of scopes) {
    const scopeText = scope.el.textContent ?? '';
    for (const dec of decorations) {
      // Only decorate blocks the anchor overlaps.
      if (dec.to <= scope.from || dec.from >= scope.to) continue;
      const rawFrom = Math.max(dec.from, scope.from) - scope.from;
      const rawTo = Math.min(dec.to, scope.to) - scope.from;
      const rawSlice = source.slice(scope.from + rawFrom, scope.from + rawTo);
      const target = plainify(rawSlice) || plainify(dec.quote);
      if (!target) continue;
      let at = scopeText.indexOf(target);
      if (at < 0) at = scopeText.indexOf(dec.quote.trim());
      if (at < 0) continue;
      const mark = wrapCharRange(scope.el, at, at + target.length, dec.id, dec.id === activeThreadId);
      if (mark && dec.id === activeThreadId) flashTarget = mark;
    }
    for (const peer of peers) {
      const cur = peer.cursor;
      if (!cur) continue;
      if (cur.from < scope.from || cur.from > scope.to) continue;
      const rendered = scope.el.textContent?.length ?? 0;
      const idx = Math.min(Math.max(0, cur.from - scope.from), rendered);
      insertRemoteCursor(scope.el, idx, peer);
    }
  }

  if (flashTarget) flashTarget.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * The collaboration controller. Owns live anchors, optimistic threads, the
 * selection popup/composer, and the sidebar/presence state; returns the pieces
 * the editor stitches into each mode. Inert (all state idle) when neither
 * comments nor presence is configured.
 */
interface CollabController {
  commentsActive: boolean;
  active: boolean;
  /** Whether the editor shell + top-right strip render (comments/presence OR settings). */
  shellActive: boolean;
  /** Whether the comments sidebar is open (content is offset to make room). */
  sidebarOpen: boolean;
  peers: PresencePeer[];
  threads: CommentThread[];
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Wrap a commit so anchors re-map through its change; call from commitValue. */
  onCommit: (change: DocChange) => void;
  /** Report a raw-source (textarea) selection for the Comment popup. */
  onSourceSelect: (docFrom: number, docTo: number, quote: string) => void;
  /** Track the pointer so the popup can anchor near a textarea selection. */
  onPointer: (x: number, y: number) => void;
  /** Chrome rendered inside the editor shell (popup, composer, bar, sidebar). */
  overlay: React.ReactNode;
}

function useCollab(
  comments: boolean | CommentsOptions | undefined,
  presence: PresencePeer[] | undefined,
  md: string,
  mode: EditorMode,
  settingsControl?: React.ReactNode,
): CollabController {
  const opts = normalizeComments(comments);
  const commentsActive = !!opts && opts.enabled !== false;
  const peers = React.useMemo(() => presence ?? [], [presence]);
  const active = commentsActive || peers.length > 0;
  // The settings gear shares the top-right control strip, so the shell + strip
  // also render when only settings is active (with no comments/presence).
  const settingsPresent = !!settingsControl;
  const shellActive = active || settingsPresent;

  const hostThreads = opts?.threads ?? EMPTY_THREADS;
  const me = opts?.me;

  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const pointerRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const srcRef = React.useRef(md);
  srcRef.current = md;

  const [localThreads, setLocalThreads] = React.useState<CommentThread[]>([]);
  const [liveAnchors, setLiveAnchors] = React.useState<Map<string, { from: number; to: number }>>(
    () => new Map(),
  );
  const [open, setOpen] = React.useState(false);
  const [activeThreadId, setActiveThreadId] = React.useState<string | undefined>(undefined);
  const [pending, setPending] = React.useState<PendingSelection | null>(null);
  const [composing, setComposing] = React.useState<PendingSelection | null>(null);

  const threads = React.useMemo(() => mergeThreads(hostThreads, localThreads), [hostThreads, localThreads]);

  // Seed / reconcile live anchors when the visible thread set changes: add new
  // threads' anchors, drop removed ones, keep existing live positions.
  React.useEffect(() => {
    if (!commentsActive) return;
    setLiveAnchors((prev) => {
      const next = new Map(prev);
      const valid = new Set(threads.map((t) => t.id));
      for (const t of threads) if (!next.has(t.id)) next.set(t.id, t.anchor);
      for (const id of [...next.keys()]) if (!valid.has(id)) next.delete(id);
      return next;
    });
  }, [threads, commentsActive]);

  // Every commit re-maps every live anchor through the change; fully-deleted
  // anchors (mapAnchor → null) are dropped.
  const commentsActiveRef = React.useRef(commentsActive);
  commentsActiveRef.current = commentsActive;
  const onCommit = React.useCallback((change: DocChange) => {
    if (!commentsActiveRef.current) return;
    // Minimize against the pre-commit document so anchors inside an untouched
    // part of a whole-region replace (block commit / command apply) survive.
    const minimal = minimizeChange(change, srcRef.current);
    setLiveAnchors((prev) => {
      const next = new Map<string, { from: number; to: number }>();
      prev.forEach((a, id) => {
        const mapped = mapAnchor(a, minimal);
        if (mapped) next.set(id, mapped);
      });
      return next;
    });
  }, []);

  const onPointer = React.useCallback((x: number, y: number) => {
    pointerRef.current = { x, y };
  }, []);

  const onSourceSelect = React.useCallback(
    (docFrom: number, docTo: number, quote: string) => {
      if (!commentsActive || docFrom >= docTo || !quote.trim()) {
        setPending(null);
        return;
      }
      const { x, y } = pointerRef.current;
      setPending({ anchor: { from: docFrom, to: docTo }, quote, x, y });
    },
    [commentsActive],
  );

  // Rendered-content selection (preview/read + unified rendered blocks): derive
  // a document anchor from the nearest block's source range and the quote.
  React.useEffect(() => {
    if (!commentsActive) return undefined;
    const onMouseUp = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const container = contentRef.current;
      if (!container) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const quote = sel.toString();
      if (!quote.trim()) return;
      const range = sel.getRangeAt(0);
      const anchorNode = range.commonAncestorContainer;
      if (!(anchorNode instanceof Node) || !container.contains(anchorNode)) return;
      // Ignore selections inside our own chrome (composer/sidebar/popup).
      const host = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      if (host?.closest('.tw-selpop, .tw-composer, .tw-comments-sidebar')) return;

      const blockEl = host?.closest<HTMLElement>('.tw-block[data-tw-from]');
      const from = blockEl ? Number(blockEl.getAttribute('data-tw-from')) || 0 : 0;
      const to = blockEl ? Number(blockEl.getAttribute('data-tw-to')) || 0 : srcRef.current.length;
      const blockSrc = srcRef.current.slice(from, to);
      const idx = blockSrc.indexOf(quote.trim());
      const anchor =
        idx >= 0
          ? { from: from + idx, to: from + idx + quote.trim().length }
          : { from, to };
      const rect = range.getBoundingClientRect();
      setPending({
        anchor,
        quote: quote.trim(),
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [commentsActive]);

  // Draw highlights + presence carets after every relevant change.
  const decorations = React.useMemo<LiveDecoration[]>(() => {
    if (!commentsActive) return [];
    const out: LiveDecoration[] = [];
    for (const t of threads) {
      if (t.resolved) continue;
      const pos = liveAnchors.get(t.id) ?? t.anchor;
      out.push({ id: t.id, from: pos.from, to: pos.to, quote: t.quote ?? '' });
    }
    return out;
  }, [threads, liveAnchors, commentsActive]);

  React.useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container || !active) return;
    applyDecorations(container, md, decorations, peers, activeThreadId);
  }, [md, decorations, peers, activeThreadId, active, mode]);

  // Clicking a highlight opens its thread in the sidebar.
  React.useEffect(() => {
    const container = contentRef.current;
    if (!container || !commentsActive) return undefined;
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement | null)?.closest?.('mark.tw-comment');
      const id = mark?.getAttribute('data-thread');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      setActiveThreadId(id);
      setOpen(true);
    };
    container.addEventListener('click', onClick, true);
    return () => container.removeEventListener('click', onClick, true);
  }, [commentsActive]);

  const createThread = React.useCallback(
    (sel: PendingSelection, body: string) => {
      const id = `tw-comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      opts?.onCreate?.({ anchor: sel.anchor, quote: sel.quote, body });
      const thread: CommentThread = {
        id,
        anchor: sel.anchor,
        quote: sel.quote,
        author: me?.name ?? 'You',
        body,
        createdAt: new Date().toISOString(),
        replies: [],
      };
      setLocalThreads((prev) => [...prev, thread]);
      setLiveAnchors((prev) => new Map(prev).set(id, sel.anchor));
      setActiveThreadId(id);
      setOpen(true);
      setComposing(null);
      setPending(null);
      window.getSelection()?.removeAllRanges();
    },
    [opts, me],
  );

  const overlay = shellActive ? (
    <>
      {(peers.length > 0 || commentsActive || settingsPresent) && (
        <div className="tw-collab-bar">
          {peers.length > 0 && (
            <div className="tw-presence" aria-label="Collaborators">
              {peers.map((p) => (
                <span
                  key={p.id}
                  className="tw-presence-av"
                  style={{ background: p.color ?? '#888' }}
                  title={p.name}
                  aria-label={p.name}
                >
                  {peerInitials(p.name)}
                </span>
              ))}
            </div>
          )}
          {commentsActive && (
            <button
              type="button"
              className={`tw-comments-toggle${open ? ' tw-on' : ''}`}
              aria-label={open ? 'Hide comments' : 'Show comments'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span className="tw-comments-toggle-n">{threads.length}</span>
            </button>
          )}
          {settingsControl}
        </div>
      )}

      {commentsActive && pending && !composing && (
        <div className="tw-selpop show" style={{ left: clampX(pending.x), top: Math.max(8, pending.y - 44) }} role="menu">
          <button
            type="button"
            className="tw-selpop-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setComposing(pending);
              setPending(null);
            }}
          >
            💬 Comment
          </button>
        </div>
      )}

      {commentsActive && composing && (
        <Composer
          selection={composing}
          onSubmit={(body) => createThread(composing, body)}
          onCancel={() => {
            setComposing(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      )}

      {commentsActive && (
        <CommentsSidebar
          threads={threads}
          me={me}
          open={open}
          onClose={() => setOpen(false)}
          onReply={(threadId, body) => opts?.onReply?.(threadId, body)}
          onReact={(threadId, emoji) => opts?.onReact?.(threadId, emoji)}
          onResolve={(threadId, resolved) => opts?.onResolve?.(threadId, resolved)}
          onDelete={opts?.onDelete ? (threadId) => opts?.onDelete?.(threadId) : undefined}
          activeThreadId={activeThreadId}
          onSelectThread={(threadId) => setActiveThreadId(threadId)}
        />
      )}
    </>
  ) : null;

  return {
    commentsActive,
    active,
    shellActive,
    sidebarOpen: open && commentsActive,
    peers,
    threads,
    contentRef,
    onCommit,
    onSourceSelect,
    onPointer,
    overlay,
  };
}

const EMPTY_THREADS: CommentThread[] = [];

/** Clamp a fixed-position x so a popup/composer stays on screen. */
function clampX(x: number): number {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  return Math.max(8, Math.min(x, w - 288));
}

/** The comment composer: quoted selection + a body textarea + submit/cancel. */
function Composer(props: {
  selection: PendingSelection;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const { selection, onSubmit, onCancel } = props;
  const [body, setBody] = React.useState('');
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    taRef.current?.focus();
  }, []);
  const submit = () => {
    const v = body.trim();
    if (v) onSubmit(v);
  };
  return (
    <div
      className="tw-composer show"
      style={{ left: clampX(selection.x), top: Math.max(8, selection.y - 8) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tw-composer-quote">“{selection.quote}”</div>
      <textarea
        ref={taRef}
        value={body}
        placeholder="Add a comment…"
        aria-label="Comment"
        onChange={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="tw-composer-row">
        <button type="button" className="tw-composer-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="tw-composer-btn tw-composer-primary" disabled={!body.trim()} onClick={submit}>
          Comment
        </button>
      </div>
    </div>
  );
}

export const TypewrightEditor = React.forwardRef<TypewrightEditorHandle, TypewrightEditorProps>(
  function TypewrightEditor(props, forwardedRef): React.ReactElement {
    useInjectStyles();
    const {
      value,
      defaultValue,
      onChange,
      onSelectionChange,
      onModeChange,
      mode: modeProp = 'unified',
      extensions,
      folding,
      keymap,
      comments,
      presence,
      settings,
      readOnly = false,
      placeholder = 'Write Markdown…',
      theme,
      toolbar,
      className,
      style,
    } = props;

    // Mode is controlled-or-internal (like value/defaultValue): the internal
    // state is seeded from the prop, a changed prop from the parent wins, and
    // `setMode` drives it from inside (settings panel / imperative handle).
    const [modeState, setModeState] = React.useState<EditorMode>(modeProp);
    const lastModeProp = React.useRef(modeProp);
    if (modeProp !== lastModeProp.current) {
      lastModeProp.current = modeProp;
      setModeState(modeProp);
    }
    const mode = modeState;
    const setMode = React.useCallback(
      (m: EditorMode) => {
        setModeState(m);
        onModeChange?.(m);
      },
      [onModeChange],
    );

    // Settings surface (Phase B3): live, session-only OVERRIDES of the config
    // props. Each is seeded `undefined`/`{}` so — with no panel interaction — the
    // effective value below is exactly the prop and existing behaviour is
    // identical. `mode` already has its own internal state (setMode) above.
    const settingsOpts = React.useMemo<SettingsOptions | null>(() => normalizeSettings(settings), [settings]);
    const settingsActive = !!settingsOpts && settingsOpts.enabled !== false;
    const [toolbarOverride, setToolbarOverride] = React.useState<TypewrightEditorProps['toolbar'] | undefined>(undefined);
    const [themeOverride, setThemeOverride] = React.useState<'light' | 'dark' | 'auto' | undefined>(undefined);
    const [foldingOverride, setFoldingOverride] = React.useState<boolean | undefined>(undefined);
    const [extensionsOverride, setExtensionsOverride] = React.useState<Partial<Extensions>>({});
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [paletteOpen, setPaletteOpen] = React.useState(false);

    // The gear lives in the shared top-right control strip (alongside the
    // presence/comments chrome). Built here so it can be threaded into the collab
    // bar; the panel + palette overlays render at the editor level (below).
    const settingsControl = settingsActive ? (
      <button
        type="button"
        className={`tw-settings-gear${settingsOpen ? ' tw-on' : ''}`}
        aria-label={settingsOpen ? 'Hide settings' : 'Show settings'}
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((o) => !o)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    ) : null;

    // ⌘K / Ctrl+K opens the palette. Capture-phase + only when settings is active,
    // so it beats the ⌘K→link keymap binding and never hijacks otherwise.
    React.useEffect(() => {
      if (!settingsActive) return undefined;
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          e.stopPropagation();
          setPaletteOpen(true);
        }
      };
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
    }, [settingsActive]);

    // Parse: footnotes + conservative def-lists on by default; math only when the
    // extension is on (`$` is common in prose). Render: syntax highlighting when
    // enabled — math stays undefined so the escaped tw-math-src fallback holds.
    // Memoized on the resolved flags so the downstream parse memo stays stable.
    // Effective extensions: prop values overlaid with the live settings-panel
    // overrides (empty by default ⇒ identical to `extensions`).
    const effExtensions = React.useMemo<Extensions>(
      () => ({ ...extensions, ...extensionsOverride }),
      [extensions, extensionsOverride],
    );
    const mathOn = extEnabled(effExtensions.math);
    const highlightOn = extEnabled(effExtensions.syntaxHighlight);
    const parseOpts = React.useMemo<ParseOptions>(
      () => ({ footnotes: true, defLists: true, math: mathOn }),
      [mathOn],
    );
    const renderOpts = React.useMemo<RenderOptions>(
      () => ({ highlight: highlightOn ? highlightToHtml : undefined }),
      [highlightOn],
    );
    const keymapBindings = React.useMemo(() => buildKeymap(keymap), [keymap]);

    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState<string>(defaultValue ?? '');
    const md = isControlled ? value ?? '' : internal;

    const mdRef = React.useRef(md);
    mdRef.current = md;

    // Collaboration controller (comments + presence). Inert unless the host
    // passes `comments`/`presence`, so default rendering is unchanged.
    const collab = useCollab(comments, presence, md, mode, settingsControl);
    const { onCommit } = collab;

    const commitValue = React.useCallback(
      (next: string, change: DocChange) => {
        if (!isControlled) setInternal(next);
        onChange?.(next, change);
        onCommit(change); // re-map comment anchors through this edit
      },
      [isControlled, onChange, onCommit],
    );

    // The focused source textarea registers itself so toolbar commands + the
    // imperative handle can act on the live selection.
    const activeSource = React.useRef<ActiveSource | null>(null);
    const register = React.useCallback((api: ActiveSource | null) => {
      if (api || activeSource.current) activeSource.current = api;
    }, []);
    const applyCmd = React.useCallback((cmd: Command) => {
      activeSource.current?.apply(cmd);
    }, []);
    React.useImperativeHandle(forwardedRef, () => ({ applyCommand: applyCmd, setMode }), [applyCmd, setMode]);

    // `folding` is `boolean | FoldingOptions`: a bare boolean toggles the whole
    // feature; the options object splits enabled / gutter visibility / persistence.
    const foldOpts: FoldingOptions | null = folding && typeof folding === 'object' ? folding : null;
    const foldingEnabled = folding === undefined ? true : foldOpts ? foldOpts.enabled !== false : folding !== false;
    const showGutter = foldOpts ? foldOpts.showGutter !== false : true;
    const persistKey = foldOpts ? foldOpts.persistKey : undefined;

    // Effective config: prop value unless the settings panel has overridden it, so
    // a panel toggle re-renders the editor live (override undefined ⇒ prop value).
    const effFolding = foldingOverride ?? foldingEnabled;
    const effAppearance = themeOverride ?? (theme?.appearance ?? 'auto');
    const effToolbar = toolbarOverride ?? toolbar;

    const rootClass = ['tw-editor', `tw-mode-${mode}`, effAppearance !== 'auto' ? `tw-theme-${effAppearance}` : '', className]
      .filter(Boolean)
      .join(' ');

    const toolbarMode: 'docked' | 'floating' = effToolbar === 'floating' ? 'floating' : 'docked';
    const showToolbar = !!effToolbar && !readOnly && (mode === 'edit' || mode === 'unified');
    const toolbarEl = showToolbar ? <Toolbar mode={toolbarMode} onCommand={applyCmd} /> : null;

    // When comments/presence are active, the editor content is wrapped in a
    // positioned shell that also hosts the selection popup, composer, presence
    // bar, and comments sidebar. Inactive → the content renders exactly as before.
    const shellClass = [
      'tw-editor-shell',
      effAppearance !== 'auto' ? `tw-theme-${effAppearance}` : '',
      collab.sidebarOpen ? 'tw-comments-open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const shell = (content: React.ReactElement): React.ReactElement =>
      collab.shellActive ? (
        <div className={shellClass} onMouseUp={(e) => collab.onPointer(e.clientX, e.clientY)}>
          {content}
          {collab.overlay}
        </div>
      ) : content;

    // Live settings state fed to the panel, and the patch handler that routes each
    // key to its override setter (extensions merge shallowly). The panel + palette
    // are fixed-position overlays rendered alongside every mode's content.
    const settingsState: SettingsState = {
      mode,
      toolbar: effToolbar ?? false,
      folding: effFolding,
      theme: effAppearance,
      extensions: {
        // gfm is `boolean | Partial<GfmFeatures>` (no `enabled` field): any object
        // presence counts as on. The rest carry an `enabled` flag → extEnabled.
        gfm: effExtensions.gfm !== undefined && effExtensions.gfm !== false,
        mdx: extEnabled(effExtensions.mdx),
        mermaid: extEnabled(effExtensions.mermaid),
        math: extEnabled(effExtensions.math),
        syntaxHighlight: extEnabled(effExtensions.syntaxHighlight),
      },
    };
    const applySettingsPatch = React.useCallback(
      (patch: Partial<SettingsState>) => {
        if (patch.mode !== undefined) setMode(patch.mode);
        if (patch.toolbar !== undefined) setToolbarOverride(patch.toolbar);
        if (patch.folding !== undefined) setFoldingOverride(patch.folding);
        if (patch.theme !== undefined) setThemeOverride(patch.theme);
        if (patch.extensions !== undefined) {
          setExtensionsOverride((prev) => ({ ...prev, ...patch.extensions }));
        }
      },
      [setMode],
    );
    const paletteCommands = React.useMemo<PaletteCommand[]>(() => {
      const built = COMMANDS.map((c) => ({ id: c.id, label: c.label, kbd: c.kbd, group: c.group, run: () => applyCmd(c.id) }));
      const host = (settingsOpts?.commands ?? []).map((c) => ({ id: c.id, label: c.label, run: c.run }));
      return [...built, ...host];
    }, [applyCmd, settingsOpts]);
    const settingsSurfaces = settingsActive ? (
      <>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} state={settingsState} onChange={applySettingsPatch} />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
      </>
    ) : null;
    // Wrap a mode's content in the shell, then append the settings overlays.
    const finish = (content: React.ReactElement): React.ReactElement =>
      settingsActive ? (
        <>
          {shell(content)}
          {settingsSurfaces}
        </>
      ) : (
        shell(content)
      );

    if (mode === 'edit') {
      return finish(
        <div className={rootClass} style={style} data-typewright="edit">
          {toolbarEl}
          <SourceArea
            value={md}
            readOnly={readOnly}
            placeholder={placeholder}
            onChange={(next, change) => commitValue(next, change)}
            onSelect={onSelectionChange}
            register={register}
            bindings={keymapBindings}
            commentBase={collab.commentsActive ? 0 : undefined}
            onCommentSelect={collab.commentsActive ? collab.onSourceSelect : undefined}
            full
          />
        </div>,
      );
    }

    if (mode === 'read') {
      const html = renderToHtml(parse(md, parseOpts), renderOpts);
      return finish(
        <div
          className={rootClass}
          style={style}
          data-typewright="read"
          ref={collab.active ? collab.contentRef : undefined}
          // sanitized by render.ts
          dangerouslySetInnerHTML={{ __html: html || `<p class="tw-placeholder">${escapeText(placeholder)}</p>` }}
        />,
      );
    }

    // unified + preview: editable block-level rich preview
    return finish(
      <UnifiedEditor
        md={md}
        mdRef={mdRef}
        rootClass={rootClass}
        style={style}
        readOnly={readOnly}
        placeholder={placeholder}
        foldingEnabled={effFolding}
        showGutter={showGutter}
        persistKey={persistKey}
        commitValue={commitValue}
        register={register}
        toolbar={toolbarEl}
        parseOpts={parseOpts}
        renderOpts={renderOpts}
        bindings={keymapBindings}
        contentRef={collab.active ? collab.contentRef : undefined}
        commentsActive={collab.commentsActive}
        onCommentSelect={collab.commentsActive ? collab.onSourceSelect : undefined}
      />,
    );
  },
);

/* ------------------------------------------------------------------ *
 * Formatting toolbar
 * ------------------------------------------------------------------ */

const TB_GROUPS: { cmd: Command; label: string; text: string; cls?: string }[][] = [
  [
    { cmd: 'bold', label: 'Bold  ⌘B', text: 'B', cls: 'b' },
    { cmd: 'italic', label: 'Italic  ⌘I', text: 'I', cls: 'i' },
    { cmd: 'strikethrough', label: 'Strikethrough', text: 'S', cls: 's' },
    { cmd: 'inlineCode', label: 'Inline code  ⌘E', text: '‹›' },
    { cmd: 'link', label: 'Link  ⌘K', text: '↗' },
  ],
  [
    { cmd: 'heading1', label: 'Heading 1', text: 'H1' },
    { cmd: 'heading2', label: 'Heading 2', text: 'H2' },
    { cmd: 'bulletList', label: 'Bullet list', text: '•' },
    { cmd: 'orderedList', label: 'Numbered list', text: '1.' },
    { cmd: 'taskList', label: 'Task list', text: '☑' },
    { cmd: 'quote', label: 'Blockquote', text: '❝' },
  ],
  [
    { cmd: 'horizontalRule', label: 'Divider', text: '―' },
    { cmd: 'codeBlock', label: 'Code block', text: '{ }' },
    { cmd: 'table', label: 'Table', text: '▦' },
  ],
];

function Toolbar({ mode, onCommand }: { mode: 'docked' | 'floating'; onCommand: (cmd: Command) => void }): React.ReactElement {
  return (
    <div className={`tw-toolbar tw-toolbar-${mode}`} role="toolbar" aria-label="Formatting">
      {TB_GROUPS.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <span className="tw-tb-sep" aria-hidden="true" />}
          {group.map((it) => (
            <button
              key={it.cmd}
              type="button"
              className={`tw-tb-btn${it.cls ? ' tw-tb-' + it.cls : ''}`}
              title={it.label}
              aria-label={it.label}
              data-cmd={it.cmd}
              // keep the editor's selection: don't let the button steal focus
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCommand(it.cmd)}
            >
              {it.text}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Unified (block-level) editor
 * ------------------------------------------------------------------ */

interface UnifiedProps {
  md: string;
  mdRef: React.MutableRefObject<string>;
  rootClass: string;
  style?: React.CSSProperties;
  readOnly: boolean;
  placeholder: string;
  /** Whether headings fold their sections at all. */
  foldingEnabled: boolean;
  /** Whether the per-heading fold gutter (chevron + options affordance) renders. */
  showGutter: boolean;
  /** localStorage namespace for persisting the folded set across reloads. */
  persistKey?: string;
  commitValue: (next: string, change: DocChange) => void;
  register?: (api: ActiveSource | null) => void;
  toolbar?: React.ReactNode;
  parseOpts: ParseOptions;
  renderOpts: RenderOptions;
  bindings: Map<string, Command>;
  /** Ref the collab layer walks for comment highlights + presence carets. */
  contentRef?: React.RefObject<HTMLDivElement | null>;
  /** Whether comments are active (enables selection-to-comment on blocks). */
  commentsActive?: boolean;
  /** Report a raw-source selection (document offsets) for the Comment popup. */
  onCommentSelect?: (docFrom: number, docTo: number, quote: string) => void;
}

function UnifiedEditor(props: UnifiedProps): React.ReactElement {
  const { md, mdRef, rootClass, style, readOnly, placeholder, foldingEnabled, showGutter, persistKey, commitValue, register, toolbar, parseOpts, renderOpts, bindings, contentRef, commentsActive, onCommentSelect } = props;
  const [active, setActive] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState('');
  // Seed the folded set from persisted heading keys (re-anchored to the current
  // blocks) when a persistKey is configured; otherwise start empty.
  const [folds, setFolds] = React.useState<Set<number>>(() =>
    persistKey ? loadFoldSet(persistKey, parse(mdRef.current, parseOpts).children, mdRef.current) : new Set(),
  );
  const [typing, setTyping] = React.useState(false);
  // Which heading index (if any) has its FoldMenu open, and the affordance rect
  // the fixed-position menu anchors to.
  const [foldMenuFor, setFoldMenuFor] = React.useState<number | null>(null);
  const [foldMenuRect, setFoldMenuRect] = React.useState<DOMRect | null>(null);

  const activeRef = React.useRef<number | null>(null);
  const draftRef = React.useRef('');
  activeRef.current = active;
  draftRef.current = draft;

  // FLIP: rows slide to their new position when a line's height changes on
  // reveal/commit, instead of jumping.
  const rowEls = React.useRef<Map<number, HTMLElement>>(new Map());
  const flipFrom = React.useRef<Map<number, number> | null>(null);
  const captureFlip = React.useCallback(() => {
    const m = new Map<number, number>();
    rowEls.current.forEach((el, k) => m.set(k, el.getBoundingClientRect().top));
    flipFrom.current = m;
  }, []);
  React.useLayoutEffect(() => {
    const from = flipFrom.current;
    if (!from) return;
    flipFrom.current = null;
    rowEls.current.forEach((el, k) => {
      const prev = from.get(k);
      if (prev == null) return;
      const dy = prev - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) {
        el.style.transition = 'none';
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform .3s cubic-bezier(.32,.72,0,1)';
          el.style.transform = '';
        });
      }
    });
  });

  const doc = React.useMemo(() => parse(md, parseOpts), [md, parseOpts]);
  const blocks = doc.children;

  // Refs let the fold/menu callbacks read the freshest blocks/source without
  // being torn down and rebuilt on every parse.
  const blocksRef = React.useRef(blocks);
  blocksRef.current = blocks;
  const foldsRef = React.useRef(folds);
  foldsRef.current = folds;

  // Single fold-set writer: updates state and (when configured) persists the
  // folded headings by their stable key so the collapse survives a reload.
  const commitFolds = React.useCallback(
    (next: Set<number>) => {
      setFolds(next);
      if (persistKey) saveFoldSet(persistKey, next, blocksRef.current, mdRef.current);
    },
    [persistKey, mdRef],
  );

  const toggleFold = React.useCallback(
    (i: number) => {
      const next = new Set(foldsRef.current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      commitFolds(next);
    },
    [commitFolds],
  );

  const foldAll = React.useCallback(() => {
    const next = new Set<number>();
    blocksRef.current.forEach((b, i) => {
      if (b.type === 'heading') next.add(i);
    });
    commitFolds(next);
  }, [commitFolds]);

  const unfoldAll = React.useCallback(() => commitFolds(new Set()), [commitFolds]);

  // Rewrite a heading's `#`-run to `level` hashes via a splice over its marker
  // range `[from, contentFrom)` (contentFrom is exposed on the heading node).
  const setHeadingLevel = React.useCallback(
    (i: number, level: number) => {
      const b = blocksRef.current[i];
      if (!b || b.type !== 'heading') return;
      const src = mdRef.current;
      const marker = '#'.repeat(level) + ' ';
      const change: DocChange = { from: b.from, to: b.contentFrom, insert: marker };
      const next = src.slice(0, change.from) + marker + src.slice(change.to);
      if (next !== src) {
        commitValue(next, change);
        mdRef.current = next;
      }
    },
    [mdRef, commitValue],
  );

  const copyHeadingLink = React.useCallback(
    (i: number) => {
      const b = blocksRef.current[i];
      if (!b || b.type !== 'heading') return;
      const slug = slugify(mdRef.current.slice(b.contentFrom, b.to));
      try {
        void navigator.clipboard?.writeText('#' + slug);
      } catch {
        /* clipboard unavailable (permissions / insecure context) */
      }
    },
    [mdRef],
  );

  // A table cell / structural edit arrives as an already-scoped splice; apply it
  // to the current source and commit verbatim (TableGrid owns the range math).
  const handleTableChange = React.useCallback(
    (change: DocChange) => {
      const src = mdRef.current;
      const next = src.slice(0, change.from) + change.insert + src.slice(change.to);
      if (next !== src) {
        commitValue(next, { from: change.from, to: change.to, insert: change.insert });
        mdRef.current = next;
      }
    },
    [mdRef, commitValue],
  );

  const commit = React.useCallback((): { next: string; change: DocChange | null } => {
    const a = activeRef.current;
    const src = mdRef.current;
    activeRef.current = null;
    setActive(null);
    if (a === null) return { next: src, change: null };
    const b = parse(src, parseOpts).children[a];
    if (!b) return { next: src, change: null };
    const next = src.slice(0, b.from) + draftRef.current + src.slice(b.to);
    const change: DocChange = { from: b.from, to: b.to, insert: draftRef.current };
    if (next !== src) commitValue(next, change);
    mdRef.current = next; // keep the ref consistent for an immediate re-activation
    return { next, change };
  }, [mdRef, commitValue, parseOpts]);

  // Activate the block the user clicked (identified by its source OFFSET) after
  // committing any in-progress edit — the offset is mapped through that commit so
  // a block-count-changing edit can never target the wrong block (data-loss bug).
  const activate = React.useCallback(
    (clickedFrom: number) => {
      if (readOnly) return;
      captureFlip();
      const { next, change } = commit();
      let mapped = clickedFrom;
      if (change && clickedFrom >= change.to) {
        mapped = clickedFrom + (change.insert.length - (change.to - change.from));
      }
      const nextBlocks = parse(next, parseOpts).children;
      let idx = nextBlocks.findIndex((bl) => mapped >= bl.from && mapped < bl.to);
      if (idx < 0) idx = nextBlocks.findIndex((bl) => bl.from === mapped);
      const b = nextBlocks[idx];
      if (b) {
        const d = next.slice(b.from, b.to);
        draftRef.current = d;
        setDraft(d);
        activeRef.current = idx;
        setActive(idx);
      }
    },
    [commit, readOnly, captureFlip, parseOpts],
  );

  // which block indices are hidden by a folded ancestor heading
  const hidden = React.useMemo(() => {
    const set = new Set<number>();
    if (!foldingEnabled) return set;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (b.type === 'heading' && folds.has(i)) {
        for (let j = i + 1; j < blocks.length; j++) {
          const n = blocks[j]!;
          if (n.type === 'heading' && n.level <= b.level) break;
          set.add(j);
        }
      }
    }
    return set;
  }, [blocks, folds, foldingEnabled]);

  if (readOnly && !md.trim()) {
    return (
      <div className={rootClass} style={style} data-typewright="unified" ref={contentRef}>
        <p className="tw-placeholder">{placeholder}</p>
      </div>
    );
  }
  // empty doc, or the user is typing into a fresh doc: edit the whole source
  // until they blur, then fall back to the block-rendered view.
  if (!md.trim() || typing) {
    return (
      <div className={rootClass} style={style} data-typewright="unified" ref={contentRef}>
        {toolbar}
        <SourceArea
          value={md}
          full
          placeholder={placeholder}
          register={register}
          bindings={bindings}
          commentBase={commentsActive ? 0 : undefined}
          onCommentSelect={commentsActive ? onCommentSelect : undefined}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(next, change) => commitValue(next, change)}
        />
      </div>
    );
  }

  return (
    <div className={rootClass} style={style} data-typewright="unified" ref={contentRef}>
      {toolbar}
      {blocks.map((b, i) => {
        if (hidden.has(i)) return null;
        const isHeading = b.type === 'heading';
        const folded = isHeading && folds.has(i);
        return (
          <div
            className="tw-row"
            key={`${i}-${b.from}`}
            data-block-type={b.type}
            ref={(el) => {
              if (el) rowEls.current.set(i, el);
              else rowEls.current.delete(i);
            }}
          >
            {foldingEnabled && b.type === 'heading' && !readOnly && showGutter && (
              <>
                {/* Chevron: the fast path — a plain click toggles this section's fold. */}
                <button
                  type="button"
                  className={`tw-fold${folded ? ' tw-folded' : ''}`}
                  aria-label={folded ? 'Unfold section' : 'Fold section'}
                  aria-expanded={!folded}
                  onClick={() => toggleFold(i)}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {/* Options affordance: opens the heading FoldMenu (level, fold-all, copy link). */}
                <button
                  type="button"
                  className="tw-fold-more"
                  aria-label="Heading options"
                  aria-haspopup="menu"
                  aria-expanded={foldMenuFor === i}
                  onClick={(e) => {
                    setFoldMenuRect(e.currentTarget.getBoundingClientRect());
                    setFoldMenuFor(i);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.7" />
                    <circle cx="12" cy="12" r="1.7" />
                    <circle cx="19" cy="12" r="1.7" />
                  </svg>
                </button>
                {foldMenuFor === i && (
                  <FoldMenu
                    open
                    level={b.level}
                    folded={folded}
                    anchorRect={foldMenuRect}
                    onSetLevel={(n) => setHeadingLevel(i, n)}
                    onToggleFold={() => toggleFold(i)}
                    onFoldAll={foldAll}
                    onUnfoldAll={unfoldAll}
                    onCopyLink={() => copyHeadingLink(i)}
                    onClose={() => setFoldMenuFor(null)}
                  />
                )}
              </>
            )}
            {active === i && !readOnly ? (
              <SourceArea
                value={draft}
                autoFocus
                register={register}
                bindings={bindings}
                commentBase={commentsActive ? b.from : undefined}
                onCommentSelect={commentsActive ? onCommentSelect : undefined}
                onChange={(next) => setDraft(next)}
                onBlur={() => { captureFlip(); commit(); }}
                onEscape={() => { captureFlip(); commit(); }}
              />
            ) : b.type === 'table' && !readOnly ? (
              // A table is edited in its grid, not via a click-to-reveal source
              // textarea; the grid emits already-scoped splices we apply verbatim.
              <TableGrid table={b} source={mdRef.current} onChange={handleTableChange} readOnly={readOnly} />
            ) : (
              <div
                className="tw-block"
                role={readOnly ? undefined : 'button'}
                tabIndex={readOnly ? undefined : 0}
                data-tw-from={b.from}
                data-tw-to={b.to}
                onMouseDown={(e) => {
                  if (readOnly) return;
                  // When comments are active, let the browser start a native
                  // selection (drag → Comment popup); a plain click still
                  // reveals the source (handled in onClick below).
                  if (commentsActive) return;
                  e.preventDefault();
                  activate(b.from);
                }}
                onClick={() => {
                  if (readOnly || !commentsActive) return;
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed && sel.toString().trim()) return; // drag-select → comment
                  activate(b.from);
                }}
                onKeyDown={(e) => {
                  if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    activate(b.from);
                  }
                }}
                // sanitized by render.ts
                dangerouslySetInnerHTML={{ __html: renderNode(b, renderOpts) }}
              />
            )}
            {folded && (
              <button type="button" className="tw-foldchip" onClick={() => toggleFold(i)}>
                … {foldedSummary(blocks, i)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Fold persistence — keyed by heading (stable across edits), not index
 * ------------------------------------------------------------------ */

const FOLD_STORE_PREFIX = 'typewright-folds:';

/** GitHub-style heading slug: lowercase, spaces→`-`, drop non-alphanumeric-except-hyphen. */
function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/**
 * Block index → a stable persistence key for every heading. The key is the
 * heading's slug, disambiguated GitHub-style (`slug`, `slug-1`, …) when two
 * headings share a slug, so a folded set re-anchors to the right rows on reload
 * even though raw offsets/indices drift across edits.
 */
function headingKeyMap(blocks: readonly Block[], src: string): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  blocks.forEach((b, i) => {
    if (b.type !== 'heading') return;
    const base = slugify(src.slice(b.contentFrom, b.to)) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(i, n === 0 ? base : `${base}-${n}`);
  });
  return out;
}

/** Resolve the persisted heading keys for `persistKey` to current block indices. */
function loadFoldSet(persistKey: string, blocks: readonly Block[], src: string): Set<number> {
  const set = new Set<number>();
  if (typeof window === 'undefined') return set;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FOLD_STORE_PREFIX + persistKey);
  } catch {
    return set;
  }
  if (!raw) return set;
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    return set;
  }
  if (!Array.isArray(keys)) return set;
  const wanted = new Set(keys as string[]);
  headingKeyMap(blocks, src).forEach((key, idx) => {
    if (wanted.has(key)) set.add(idx);
  });
  return set;
}

/** Persist the folded set as heading keys under `persistKey`. */
function saveFoldSet(persistKey: string, folds: Set<number>, blocks: readonly Block[], src: string): void {
  if (typeof window === 'undefined') return;
  const keyMap = headingKeyMap(blocks, src);
  const keys: string[] = [];
  folds.forEach((idx) => {
    const key = keyMap.get(idx);
    if (key) keys.push(key);
  });
  try {
    window.localStorage.setItem(FOLD_STORE_PREFIX + persistKey, JSON.stringify(keys));
  } catch {
    /* storage unavailable (private mode / quota) — folding still works in-session */
  }
}

function foldedSummary(blocks: readonly { type: string; level?: number }[], idx: number): string {
  const b = blocks[idx] as { level: number };
  let lines = 0;
  let subs = 0;
  for (let j = idx + 1; j < blocks.length; j++) {
    const n = blocks[j]!;
    if (n.type === 'heading' && (n as { level: number }).level <= b.level) break;
    if (n.type === 'heading') subs++;
    lines++;
  }
  return `${lines} block${lines === 1 ? '' : 's'}${subs ? ` · ${subs} subsection${subs === 1 ? '' : 's'}` : ''}`;
}

/* ------------------------------------------------------------------ *
 * Source textarea (edit mode + unified active block)
 * ------------------------------------------------------------------ */

interface SourceAreaProps {
  value: string;
  onChange: (value: string, change: DocChange) => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onFocus?: () => void;
  onSelect?: (sel: import('../types').DocSelection) => void;
  autoFocus?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  full?: boolean;
  register?: (api: ActiveSource | null) => void;
  /** Active keyboard shortcuts (canonical binding → command). */
  bindings?: Map<string, Command>;
  /** Document offset this textarea's local offset 0 maps to (for comment anchors). */
  commentBase?: number;
  /** Report a non-empty selection (document offsets) for the Comment popup. */
  onCommentSelect?: (docFrom: number, docTo: number, quote: string) => void;
}

function SourceArea(props: SourceAreaProps): React.ReactElement {
  const { value, onChange, onBlur, onEscape, onFocus, onSelect, autoFocus, readOnly, placeholder, full, register, bindings, commentBase, onCommentSelect } = props;
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const pendingSel = React.useRef<[number, number] | null>(null);

  const apply = React.useCallback(
    (cmd: Command) => {
      const el = ref.current;
      if (!el) return;
      const val = el.value;
      const r = applyCommand(val, { from: el.selectionStart, to: el.selectionEnd }, cmd);
      pendingSel.current = [r.selection.from, r.selection.to];
      onChange(r.text, { from: 0, to: val.length, insert: r.text });
    },
    [onChange],
  );

  React.useEffect(() => {
    if (pendingSel.current && ref.current) {
      ref.current.selectionStart = pendingSel.current[0];
      ref.current.selectionEnd = pendingSel.current[1];
      pendingSel.current = null;
    }
  });

  const autoGrow = (el: HTMLTextAreaElement): void => {
    if (full) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <textarea
      ref={ref}
      className={`tw-source${full ? ' tw-source-full' : ''}`}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      autoFocus={autoFocus}
      spellCheck={false}
      rows={full ? undefined : 1}
      onChange={(e) => {
        onChange(e.target.value, { from: 0, to: value.length, insert: e.target.value });
        autoGrow(e.currentTarget);
      }}
      onFocus={(e) => {
        autoGrow(e.currentTarget);
        onFocus?.();
        register?.({ apply });
      }}
      onBlur={() => {
        register?.(null);
        onBlur?.();
      }}
      onSelect={(e) => {
        const el = e.currentTarget;
        const from = el.selectionStart;
        const to = el.selectionEnd;
        onSelect?.({ main: { from, to }, ranges: [{ from, to }] });
        if (onCommentSelect && commentBase !== undefined && from !== to) {
          onCommentSelect(commentBase + from, commentBase + to, el.value.slice(from, to));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onEscape) {
          e.preventDefault();
          onEscape();
          return;
        }
        // Route shortcuts through the SAME toggle-aware applyCommand path the
        // toolbar uses, so ⌘B toggles (and un-toggles) instead of double-wrapping.
        const cmd = bindings?.get(eventCanon(e));
        if (cmd) {
          e.preventDefault();
          apply(cmd);
        }
      }}
    />
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ------------------------------------------------------------------ *
 * Default styles (injected once; drop-in with no external CSS)
 * ------------------------------------------------------------------ */

const TYPEWRIGHT_CSS = `
.tw-editor { --tw-fg:#1a1d20; --tw-muted:#5a6169; --tw-faint:#8b929a; --tw-bg:#ffffff; --tw-chip:#f0f1f3; --tw-line:rgba(18,22,27,.1); --tw-accent:#2f6fed; --tw-accent-soft:rgba(47,111,237,.1); --tw-code-bg:#f6f7f9; font-family:-apple-system,"SF Pro Text",system-ui,sans-serif; color:var(--tw-fg); line-height:1.6; font-size:15px; }
@media (prefers-color-scheme: dark) { .tw-editor:not(.tw-theme-light) { --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); --tw-code-bg:#13171b; } }
.tw-editor.tw-theme-dark { --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); --tw-code-bg:#13171b; }
.tw-editor { background:var(--tw-bg); border-radius:10px; }
.tw-editor h1,.tw-editor h2,.tw-editor h3,.tw-editor h4,.tw-editor h5,.tw-editor h6 { font-weight:680; letter-spacing:-.02em; margin:.7em 0 .3em; line-height:1.25; }
.tw-editor h1{font-size:1.8em} .tw-editor h2{font-size:1.45em} .tw-editor h3{font-size:1.2em} .tw-editor h4{font-size:1.05em}
.tw-editor p{margin:.5em 0} .tw-editor ul,.tw-editor ol{margin:.4em 0; padding-left:1.5em} .tw-editor li{margin:.15em 0}
.tw-editor a{color:var(--tw-accent); text-decoration:none; border-bottom:1px solid var(--tw-accent-soft)}
.tw-editor code{font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:.88em; background:var(--tw-chip); border:1px solid var(--tw-line); border-radius:5px; padding:1px 5px}
.tw-editor pre{background:var(--tw-code-bg); border:1px solid var(--tw-line); border-radius:9px; padding:12px 14px; overflow-x:auto; margin:.6em 0}
.tw-editor pre code{background:none; border:0; padding:0; font-size:13px; line-height:1.55}
.tw-editor blockquote{border-left:3px solid var(--tw-line); margin:.6em 0; padding:.1em 0 .1em 14px; color:var(--tw-muted)}
.tw-editor table{border-collapse:collapse; margin:.6em 0; font-size:.95em} .tw-editor th,.tw-editor td{border:1px solid var(--tw-line); padding:6px 12px} .tw-editor th{background:var(--tw-chip)}
.tw-editor hr{border:0; border-top:1px solid var(--tw-line); margin:1em 0}
.tw-editor img{max-width:100%}
.tw-editor input[type=checkbox]{margin-right:6px; vertical-align:middle}
.tw-placeholder{color:var(--tw-faint)}
.tw-mode-preview,.tw-mode-read,.tw-mode-unified{padding:14px 18px}
.tw-mode-edit{padding:0}
.tw-toolbar{display:flex; align-items:center; justify-content:center; gap:3px; flex-wrap:wrap; padding:5px 7px; margin-bottom:9px; border:1px solid var(--tw-line); border-radius:12px; background:color-mix(in srgb, var(--tw-bg) 80%, transparent); backdrop-filter:blur(18px) saturate(1.6); -webkit-backdrop-filter:blur(18px) saturate(1.6); position:sticky; top:0; z-index:5; box-shadow:0 4px 14px -8px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06)}
.tw-toolbar-floating{max-height:0; padding-top:0; padding-bottom:0; margin-bottom:0; opacity:0; overflow:hidden; border-color:transparent; box-shadow:none; transform:translateY(-7px); transition:max-height .28s cubic-bezier(.32,.72,0,1), opacity .2s, margin .28s cubic-bezier(.32,.72,0,1), padding .28s, transform .24s cubic-bezier(.32,.72,0,1)}
.tw-editor:hover .tw-toolbar-floating,.tw-editor:focus-within .tw-toolbar-floating{max-height:84px; padding-top:5px; padding-bottom:5px; margin-bottom:9px; opacity:1; border-color:var(--tw-line); box-shadow:0 4px 14px -8px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06); transform:none}
.tw-tb-sep{width:1px; height:18px; background:var(--tw-line); margin:0 3px}
.tw-tb-btn{min-width:28px; height:28px; padding:0 7px; border:1px solid transparent; background:transparent; border-radius:7px; color:var(--tw-muted); font-size:13px; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:color .15s,background .15s}
.tw-tb-btn:hover{color:var(--tw-fg); background:var(--tw-accent-soft)}
.tw-tb-b{font-weight:800} .tw-tb-i{font-style:italic; font-family:Georgia,serif} .tw-tb-s{text-decoration:line-through}
.tw-row{transition:transform .3s cubic-bezier(.32,.72,0,1)}
@keyframes tw-stream-in{from{opacity:0; transform:translateY(7px)}to{opacity:1; transform:none}}
.tw-streamblk.tw-stream-in{animation:tw-stream-in .3s cubic-bezier(.32,.72,0,1) both}
.tw-row{position:relative; display:flex; align-items:flex-start; gap:2px}
.tw-block{flex:1; min-width:0; border-radius:6px; cursor:text; padding:1px 4px; margin-left:-4px; transition:background .15s}
.tw-mode-unified .tw-block:hover,.tw-mode-preview .tw-block:hover{background:var(--tw-accent-soft)}
.tw-block:focus-visible{outline:2px solid var(--tw-accent); outline-offset:2px}
.tw-block>:first-child{margin-top:.15em} .tw-block>:last-child{margin-bottom:.15em}
.tw-fold{flex:none; width:20px; height:24px; margin-top:.35em; border:0; background:none; color:var(--tw-faint); border-radius:5px; display:grid; place-items:center; cursor:pointer; opacity:.55; transition:opacity .15s,color .15s,transform .15s}
.tw-fold:hover{opacity:1; color:var(--tw-accent)} .tw-fold.tw-folded svg{transform:rotate(-90deg)}
.tw-fold-more{flex:none; width:18px; height:24px; margin-top:.35em; border:0; background:none; color:var(--tw-faint); border-radius:5px; display:grid; place-items:center; cursor:pointer; opacity:0; transition:opacity .15s,color .15s}
.tw-row:hover .tw-fold-more,.tw-fold-more:focus-visible,.tw-fold-more[aria-expanded="true"]{opacity:.6}
.tw-fold-more:hover,.tw-fold-more[aria-expanded="true"]{opacity:1; color:var(--tw-accent)}
.tw-foldchip{margin-left:6px; font-size:12.5px; color:var(--tw-faint); background:none; border:1px dashed var(--tw-line); border-radius:7px; padding:2px 9px; cursor:pointer}
.tw-foldchip:hover{color:var(--tw-muted); border-color:var(--tw-accent)}
.tw-source{width:100%; box-sizing:border-box; font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:13.5px; line-height:1.6; color:var(--tw-fg); background:var(--tw-accent-soft); border:1px solid var(--tw-accent); border-radius:7px; padding:6px 9px; resize:none; outline:none}
.tw-source-full{min-height:280px; height:100%; background:var(--tw-bg); border:0; border-radius:0; padding:16px 18px; font-size:14px}
.tw-caret{display:inline-block; width:2px; height:1.05em; background:var(--tw-accent); vertical-align:text-bottom; margin-left:1px; border-radius:1px; animation:tw-blink 1.06s steps(1) infinite}
@keyframes tw-blink{50%{opacity:0}}
.tw-pending{opacity:.62; border-bottom:1.5px dashed var(--tw-accent); border-radius:1px}
.tw-pending-strong{font-weight:680} .tw-pending-em{font-style:italic} .tw-pending-code{font-family:"SF Mono",ui-monospace,monospace}
.tw-skeleton{border:1px solid var(--tw-line); border-radius:10px; padding:12px; margin:.6em 0; background:linear-gradient(100deg, var(--tw-chip) 30%, var(--tw-code-bg) 50%, var(--tw-chip) 70%); background-size:200% 100%; animation:tw-shimmer 1.3s infinite}
.tw-skeleton-label{font-family:"SF Mono",ui-monospace,monospace; font-size:11px; color:var(--tw-accent)}
.tw-skeleton-bar{height:8px; border-radius:4px; background:var(--tw-line); margin-top:9px} .tw-skeleton-bar.two{width:70%} .tw-skeleton-bar.three{width:45%}
@keyframes tw-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion: reduce){ .tw-caret,.tw-skeleton,.tw-streamblk.tw-stream-in,.tw-row{animation:none !important; transition:none !important} }
.tw-editor .tw-tok-keyword{color:#cf222e} .tw-editor .tw-tok-string{color:#0a3069} .tw-editor .tw-tok-comment{color:#6e7781; font-style:italic} .tw-editor .tw-tok-number{color:#0550ae} .tw-editor .tw-tok-punct{color:var(--tw-muted)} .tw-editor .tw-tok-fn{color:#8250df} .tw-editor .tw-tok-type{color:#953800} .tw-editor .tw-tok-prop{color:#116329}
@media (prefers-color-scheme: dark){ .tw-editor:not(.tw-theme-light) .tw-tok-keyword{color:#ff7b72} .tw-editor:not(.tw-theme-light) .tw-tok-string{color:#a5d6ff} .tw-editor:not(.tw-theme-light) .tw-tok-comment{color:#8b949e} .tw-editor:not(.tw-theme-light) .tw-tok-number{color:#79c0ff} .tw-editor:not(.tw-theme-light) .tw-tok-fn{color:#d2a8ff} .tw-editor:not(.tw-theme-light) .tw-tok-type{color:#ffa657} .tw-editor:not(.tw-theme-light) .tw-tok-prop{color:#7ee787} }
.tw-editor.tw-theme-dark .tw-tok-keyword{color:#ff7b72} .tw-editor.tw-theme-dark .tw-tok-string{color:#a5d6ff} .tw-editor.tw-theme-dark .tw-tok-comment{color:#8b949e} .tw-editor.tw-theme-dark .tw-tok-number{color:#79c0ff} .tw-editor.tw-theme-dark .tw-tok-fn{color:#d2a8ff} .tw-editor.tw-theme-dark .tw-tok-type{color:#ffa657} .tw-editor.tw-theme-dark .tw-tok-prop{color:#7ee787}
.tw-editor .tw-math-src{font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:.9em; background:var(--tw-code-bg); border:1px solid var(--tw-line); border-radius:5px; padding:1px 5px}
.tw-editor div.tw-math-src{display:block; padding:8px 12px; margin:.6em 0; text-align:center; overflow-x:auto}
.tw-editor .tw-footnotes{border-top:1px solid var(--tw-line); margin-top:1.4em; padding-top:.6em; font-size:.9em; color:var(--tw-muted)}
.tw-editor .tw-fnref{font-size:.82em} .tw-editor .tw-fnref a{color:var(--tw-accent); border-bottom:0} .tw-editor .tw-fn-back{color:var(--tw-accent); border-bottom:0; margin-left:4px; text-decoration:none}
.tw-editor dl{margin:.5em 0} .tw-editor dt{font-weight:680; margin-top:.4em} .tw-editor dd{margin:.15em 0 .35em 1.4em; color:var(--tw-muted)}
/* ---- Collaboration: shell, comment highlights, presence, popup, composer ---- */
.tw-editor-shell{ --tw-fg:#1a1d20; --tw-muted:#5a6169; --tw-faint:#8b929a; --tw-bg:#ffffff; --tw-chip:#f0f1f3; --tw-line:rgba(18,22,27,.1); --tw-accent:#2f6fed; --tw-accent-soft:rgba(47,111,237,.1); --tw-code-bg:#f6f7f9; position:relative; font-family:-apple-system,"SF Pro Text",system-ui,sans-serif }
@media (prefers-color-scheme: dark){ .tw-editor-shell:not(.tw-theme-light){ --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); --tw-code-bg:#13171b } }
.tw-editor-shell.tw-theme-dark{ --tw-fg:#e8eaed; --tw-muted:#a3abb2; --tw-faint:#6a727a; --tw-bg:#0f1215; --tw-chip:#1e242b; --tw-line:rgba(255,255,255,.1); --tw-accent:#6ea3ff; --tw-accent-soft:rgba(110,163,255,.14); --tw-code-bg:#13171b }
.tw-editor-shell.tw-comments-open>.tw-editor{margin-right:min(340px,82vw); transition:margin .26s cubic-bezier(.32,.72,0,1)}
.tw-collab-bar{position:absolute; top:8px; right:10px; z-index:22; display:flex; align-items:center; gap:8px; pointer-events:none}
.tw-collab-bar>*{pointer-events:auto}
.tw-presence{display:flex; align-items:center}
.tw-presence-av{width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-size:11px; font-weight:640; color:#0b0d0f; border:2px solid var(--tw-bg); margin-left:-7px; box-shadow:0 1px 3px rgba(0,0,0,.3)}
.tw-presence-av:first-child{margin-left:0}
.tw-comments-toggle{display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 9px; border:1px solid var(--tw-line); border-radius:9px; background:color-mix(in srgb, var(--tw-bg) 82%, transparent); backdrop-filter:blur(16px) saturate(1.5); -webkit-backdrop-filter:blur(16px) saturate(1.5); color:var(--tw-muted); font:inherit; font-size:12.5px; cursor:pointer; transition:color .15s, border-color .15s, background .15s}
.tw-comments-toggle:hover{color:var(--tw-fg); border-color:var(--tw-accent)}
.tw-comments-toggle.tw-on{color:var(--tw-accent); border-color:var(--tw-accent); background:var(--tw-accent-soft)}
.tw-comments-toggle:focus-visible{outline:2px solid var(--tw-accent); outline-offset:2px}
.tw-comments-toggle svg{width:15px; height:15px; flex:none}
.tw-comments-toggle-n{font-variant-numeric:tabular-nums; font-size:11px; font-weight:640; background:var(--tw-chip); border-radius:999px; padding:0 6px; line-height:1.6}
.tw-settings-gear{display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; flex:none; border:1px solid var(--tw-line); border-radius:9px; background:color-mix(in srgb, var(--tw-bg) 82%, transparent); backdrop-filter:blur(16px) saturate(1.5); -webkit-backdrop-filter:blur(16px) saturate(1.5); color:var(--tw-muted); cursor:pointer; transition:color .15s, border-color .15s, background .15s}
.tw-settings-gear:hover{color:var(--tw-fg); border-color:var(--tw-accent)}
.tw-settings-gear.tw-on{color:var(--tw-accent); border-color:var(--tw-accent); background:var(--tw-accent-soft)}
.tw-settings-gear:focus-visible{outline:2px solid var(--tw-accent); outline-offset:2px}
.tw-settings-gear svg{width:15px; height:15px; flex:none}
.tw-comment{background:var(--tw-accent-soft); border-bottom:2px solid var(--tw-accent); border-radius:3px; padding:0 1px; cursor:pointer}
.tw-comment:hover{background:color-mix(in srgb, var(--tw-accent) 24%, transparent)}
@keyframes tw-comment-hl-flash{0%,100%{background:var(--tw-accent-soft)} 25%,70%{background:color-mix(in srgb, var(--tw-accent) 38%, transparent)}}
.tw-comment-flash{animation:tw-comment-hl-flash 1.4s ease}
.tw-remote-cursor{position:relative; display:inline-block; width:0; border-left:2px solid var(--tw-remote, var(--tw-accent)); margin:0 -1px; vertical-align:text-bottom; height:1.05em}
.tw-remote-flag{position:absolute; top:-1.15em; left:-1px; white-space:nowrap; font-size:9.5px; line-height:1.3; font-weight:640; color:#0b0d0f; background:var(--tw-remote, var(--tw-accent)); border-radius:4px 4px 4px 0; padding:0 4px; opacity:0; transform:translateY(2px); transition:opacity .15s, transform .15s; pointer-events:none}
.tw-remote-cursor:hover .tw-remote-flag{opacity:1; transform:none}
.tw-selpop{position:fixed; z-index:120; display:flex; align-items:center; gap:3px; padding:4px; background:color-mix(in srgb, var(--tw-bg) 86%, transparent); backdrop-filter:blur(22px) saturate(1.7); -webkit-backdrop-filter:blur(22px) saturate(1.7); border:1px solid var(--tw-line); border-radius:11px; box-shadow:0 12px 34px -10px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06); opacity:0; transform:translateY(4px); transition:opacity .14s, transform .14s cubic-bezier(.32,.72,0,1)}
.tw-selpop.show{opacity:1; transform:none}
.tw-selpop-btn{height:27px; padding:0 10px; border:0; border-radius:8px; background:transparent; color:var(--tw-accent); font:inherit; font-size:12.5px; font-weight:560; cursor:pointer; white-space:nowrap}
.tw-selpop-btn:hover{background:var(--tw-accent-soft)}
.tw-composer{position:fixed; z-index:121; width:268px; padding:10px; background:color-mix(in srgb, var(--tw-bg) 90%, transparent); backdrop-filter:blur(22px) saturate(1.7); -webkit-backdrop-filter:blur(22px) saturate(1.7); border:1px solid var(--tw-line); border-radius:13px; box-shadow:0 20px 48px -12px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06); color:var(--tw-fg); opacity:0; transform:translateY(6px) scale(.98); transition:opacity .16s, transform .16s cubic-bezier(.32,.72,0,1)}
.tw-composer.show{opacity:1; transform:none}
.tw-composer-quote{font-size:11.5px; color:var(--tw-muted); font-style:italic; border-left:2px solid var(--tw-accent-soft); padding-left:7px; margin-bottom:8px; overflow-wrap:anywhere}
.tw-composer textarea{width:100%; box-sizing:border-box; height:62px; resize:none; background:var(--tw-bg); border:1px solid var(--tw-line); border-radius:9px; padding:8px 9px; font:inherit; font-size:13px; color:var(--tw-fg); outline:none; transition:border-color .15s}
.tw-composer textarea:focus{border-color:var(--tw-accent)}
.tw-composer textarea::placeholder{color:var(--tw-faint)}
.tw-composer-row{display:flex; justify-content:flex-end; gap:6px; margin-top:8px}
.tw-composer-btn{border:1px solid var(--tw-line); background:var(--tw-chip); color:var(--tw-muted); border-radius:8px; padding:5px 11px; font:inherit; font-size:12px; cursor:pointer; transition:color .15s, border-color .15s, background .15s}
.tw-composer-btn:hover{color:var(--tw-fg); border-color:var(--tw-accent)}
.tw-composer-btn:focus-visible{outline:2px solid var(--tw-accent); outline-offset:2px}
.tw-composer-primary{background:var(--tw-accent); border-color:var(--tw-accent); color:#fff}
.tw-composer-primary:hover{color:#fff; filter:brightness(1.06)}
.tw-composer-btn:disabled{opacity:.5; cursor:default}
@media (prefers-reduced-transparency: reduce){ .tw-selpop,.tw-composer,.tw-comments-toggle,.tw-settings-gear{backdrop-filter:none; -webkit-backdrop-filter:none; background:var(--tw-bg)} }
@media (prefers-reduced-motion: reduce){ .tw-selpop,.tw-composer,.tw-comment-flash,.tw-editor-shell.tw-comments-open>.tw-editor{animation:none !important; transition:none !important} }
`;
