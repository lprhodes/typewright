import * as React from 'react';
import { applyCommand, COMMANDS, highlightToHtml, parse, renderNode, renderToHtml } from '../core';
import type { Block, Command, ParseOptions, RenderOptions } from '../core';
import type { DocChange, EditorConfig, EditorEvents, EditorMode, FoldingOptions, KeymapOptions } from '../types';
import { FoldMenu, FOLDMENU_CSS } from './FoldMenu';
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
    // widget-island styles (table grid + fold menu), so consumers need no extra CSS.
    el.textContent = TYPEWRIGHT_CSS + TABLEGRID_CSS + FOLDMENU_CSS;
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

    // Parse: footnotes + conservative def-lists on by default; math only when the
    // extension is on (`$` is common in prose). Render: syntax highlighting when
    // enabled — math stays undefined so the escaped tw-math-src fallback holds.
    // Memoized on the resolved flags so the downstream parse memo stays stable.
    const mathOn = extEnabled(extensions?.math);
    const highlightOn = extEnabled(extensions?.syntaxHighlight);
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

    const commitValue = React.useCallback(
      (next: string, change: DocChange) => {
        if (!isControlled) setInternal(next);
        onChange?.(next, change);
      },
      [isControlled, onChange],
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
    const appearance = theme?.appearance ?? 'auto';
    const rootClass = ['tw-editor', `tw-mode-${mode}`, appearance !== 'auto' ? `tw-theme-${appearance}` : '', className]
      .filter(Boolean)
      .join(' ');

    const toolbarMode: 'docked' | 'floating' = toolbar === 'floating' ? 'floating' : 'docked';
    const showToolbar = !!toolbar && !readOnly && (mode === 'edit' || mode === 'unified');
    const toolbarEl = showToolbar ? <Toolbar mode={toolbarMode} onCommand={applyCmd} /> : null;

    if (mode === 'edit') {
      return (
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
            full
          />
        </div>
      );
    }

    if (mode === 'read') {
      const html = renderToHtml(parse(md, parseOpts), renderOpts);
      return (
        <div
          className={rootClass}
          style={style}
          data-typewright="read"
          // sanitized by render.ts
          dangerouslySetInnerHTML={{ __html: html || `<p class="tw-placeholder">${escapeText(placeholder)}</p>` }}
        />
      );
    }

    // unified + preview: editable block-level rich preview
    return (
      <UnifiedEditor
        md={md}
        mdRef={mdRef}
        rootClass={rootClass}
        style={style}
        readOnly={readOnly}
        placeholder={placeholder}
        foldingEnabled={foldingEnabled}
        showGutter={showGutter}
        persistKey={persistKey}
        commitValue={commitValue}
        register={register}
        toolbar={toolbarEl}
        parseOpts={parseOpts}
        renderOpts={renderOpts}
        bindings={keymapBindings}
      />
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
}

function UnifiedEditor(props: UnifiedProps): React.ReactElement {
  const { md, mdRef, rootClass, style, readOnly, placeholder, foldingEnabled, showGutter, persistKey, commitValue, register, toolbar, parseOpts, renderOpts, bindings } = props;
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
      <div className={rootClass} style={style} data-typewright="unified">
        <p className="tw-placeholder">{placeholder}</p>
      </div>
    );
  }
  // empty doc, or the user is typing into a fresh doc: edit the whole source
  // until they blur, then fall back to the block-rendered view.
  if (!md.trim() || typing) {
    return (
      <div className={rootClass} style={style} data-typewright="unified">
        {toolbar}
        <SourceArea
          value={md}
          full
          placeholder={placeholder}
          register={register}
          bindings={bindings}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onChange={(next, change) => commitValue(next, change)}
        />
      </div>
    );
  }

  return (
    <div className={rootClass} style={style} data-typewright="unified">
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
                onMouseDown={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
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
}

function SourceArea(props: SourceAreaProps): React.ReactElement {
  const { value, onChange, onBlur, onEscape, onFocus, onSelect, autoFocus, readOnly, placeholder, full, register, bindings } = props;
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
        onSelect?.({ main: { from: el.selectionStart, to: el.selectionEnd }, ranges: [{ from: el.selectionStart, to: el.selectionEnd }] });
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
`;
