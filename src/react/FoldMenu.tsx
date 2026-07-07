import * as React from 'react';

/**
 * FoldMenu — per-heading options popover (Phase G2).
 *
 * A glass popover anchored to a heading's fold affordance. Mirrors the design
 * prototype's `openFoldMenu` (demo/design-prototype.html ~775): a stack of
 * Heading 1–6 radio items (the current level checked, with ⌘1–⌘6 hints), then
 * Toggle Folding, Fold All / Unfold All Headers, and Copy Link to here.
 *
 * The string is never mutated here — every item just fires its callback and
 * closes. Positioning is derived from `anchorRect` (fixed, viewport-clamped);
 * closes on Escape and outside-click; fully keyboard-navigable (arrow keys /
 * Home / End) with menu/menuitem(radio) roles.
 *
 * Styles live in {@link FOLDMENU_CSS} as `.tw-fold-menu*` classes over the
 * editor's `--tw-*` tokens, so the editor can inject them into its single
 * stylesheet; the menu inherits theme tokens from its `.tw-editor` ancestor.
 */
export interface FoldMenuProps {
  /** Whether the menu is shown. Returns `null` when false. */
  open: boolean;
  /** Current heading level, 1–6. */
  level: number;
  /** Whether this heading's section is currently folded. */
  folded: boolean;
  /** Rect of the affordance the menu anchors to; a sensible default is used when absent. */
  anchorRect?: DOMRect | null;
  /** Set this heading to level 1–6. */
  onSetLevel: (level: number) => void;
  /** Fold/unfold this heading's section. */
  onToggleFold: () => void;
  /** Fold every heading in the document. */
  onFoldAll: () => void;
  /** Unfold every heading in the document. */
  onUnfoldAll: () => void;
  /** Copy a link (heading slug) to this heading. */
  onCopyLink: () => void;
  /** Dismiss the menu. */
  onClose: () => void;
}

const LEVELS = [1, 2, 3, 4, 5, 6] as const;
const ITEM_COUNT = LEVELS.length + 4; // 6 heading levels + toggle + foldAll + unfoldAll + copy
const MENU_WIDTH = 250;

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function FoldMenu(props: FoldMenuProps): React.JSX.Element | null {
  const {
    open,
    level,
    folded,
    anchorRect,
    onSetLevel,
    onToggleFold,
    onFoldAll,
    onUnfoldAll,
    onCopyLink,
    onClose,
  } = props;

  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = React.useCallback((index: number) => {
    const i = ((index % ITEM_COUNT) + ITEM_COUNT) % ITEM_COUNT;
    itemRefs.current[i]?.focus();
  }, []);

  // Escape + outside-click dismissal (document listeners, cleaned up).
  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const node = menuRef.current;
      if (node && e.target instanceof Node && !node.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onClose]);

  // Move focus onto the current-level item when the menu opens.
  React.useEffect(() => {
    if (!open) return;
    const start = level >= 1 && level <= LEVELS.length ? level - 1 : 0;
    itemRefs.current[start]?.focus();
  }, [open, level]);

  if (!open) return null;

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement | null);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(current < 0 ? 0 : current + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(current < 0 ? ITEM_COUNT - 1 : current - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(ITEM_COUNT - 1);
        break;
      case 'Tab':
        // Menus don't tab between items — dismiss so focus returns to the page.
        e.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const viewportW = typeof window === 'undefined' ? MENU_WIDTH * 4 : window.innerWidth;
  const left = anchorRect ? Math.max(8, Math.min(anchorRect.left, viewportW - MENU_WIDTH)) : 16;
  const top = anchorRect ? anchorRect.bottom + 6 : 16;

  const setRef = (index: number) => (el: HTMLButtonElement | null) => {
    itemRefs.current[index] = el;
  };

  return (
    <div
      ref={menuRef}
      className="tw-fold-menu"
      role="menu"
      aria-label="Heading options"
      aria-orientation="vertical"
      style={{ left, top }}
      onKeyDown={onMenuKeyDown}
    >
      {LEVELS.map((l, i) => {
        const on = level === l;
        return (
          <button
            key={l}
            ref={setRef(i)}
            type="button"
            className={`tw-fold-menu-item${on ? ' tw-on' : ''}`}
            role="menuitemradio"
            aria-checked={on}
            tabIndex={-1}
            onClick={run(() => onSetLevel(l))}
          >
            <span className="tw-fm-chk" aria-hidden="true">{CheckIcon}</span>
            <span className="tw-fm-num" aria-hidden="true">{l}</span>
            <span className="tw-fm-lab">Heading {l}</span>
            <span className="tw-fm-kbd" aria-hidden="true">⌘{l}</span>
          </button>
        );
      })}

      <div className="tw-fold-menu-sep" role="separator" />

      <button
        ref={setRef(LEVELS.length)}
        type="button"
        className="tw-fold-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={run(onToggleFold)}
      >
        <span className="tw-fm-chk" aria-hidden="true" />
        <span className="tw-fm-lab">{folded ? 'Unfold Section' : 'Fold Section'}</span>
      </button>
      <button
        ref={setRef(LEVELS.length + 1)}
        type="button"
        className="tw-fold-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={run(onFoldAll)}
      >
        <span className="tw-fm-chk" aria-hidden="true" />
        <span className="tw-fm-lab">Fold All Headers</span>
      </button>
      <button
        ref={setRef(LEVELS.length + 2)}
        type="button"
        className="tw-fold-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={run(onUnfoldAll)}
      >
        <span className="tw-fm-chk" aria-hidden="true" />
        <span className="tw-fm-lab">Unfold All Headers</span>
      </button>

      <div className="tw-fold-menu-sep" role="separator" />

      <button
        ref={setRef(LEVELS.length + 3)}
        type="button"
        className="tw-fold-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={run(onCopyLink)}
      >
        <span className="tw-fm-chk" aria-hidden="true" />
        <span className="tw-fm-lab">Copy Link to here</span>
      </button>
    </div>
  );
}

/**
 * Styles for {@link FoldMenu}. Uses the editor's `--tw-*` tokens (inherited from
 * the nearest `.tw-editor` ancestor), respects `prefers-reduced-motion` and
 * `prefers-reduced-transparency`, and themes light/dark via those tokens.
 */
export const FOLDMENU_CSS = `
.tw-fold-menu{position:fixed; z-index:100; min-width:234px; padding:6px; background:color-mix(in srgb, var(--tw-bg) 90%, transparent); backdrop-filter:blur(24px) saturate(1.7); -webkit-backdrop-filter:blur(24px) saturate(1.7); border:1px solid var(--tw-line); border-radius:14px; box-shadow:0 24px 60px -12px rgba(0,0,0,.5), 0 8px 24px -8px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06); color:var(--tw-fg); font-family:-apple-system,"SF Pro Text",system-ui,sans-serif; animation:tw-fold-menu-in .16s cubic-bezier(.32,.72,0,1) both}
@keyframes tw-fold-menu-in{from{opacity:0; transform:translateY(-6px) scale(.98)}to{opacity:1; transform:none}}
.tw-fold-menu-item{display:flex; align-items:center; gap:10px; width:100%; padding:7px 9px; border:0; border-radius:9px; background:transparent; color:var(--tw-fg); font:inherit; font-size:13.5px; line-height:1.2; text-align:left; cursor:pointer; transition:background .13s}
.tw-fold-menu-item:hover{background:var(--tw-accent-soft)}
.tw-fold-menu-item:focus{outline:none; background:var(--tw-accent-soft)}
.tw-fold-menu-item:focus-visible{outline:2px solid var(--tw-accent); outline-offset:-2px}
.tw-fold-menu-item .tw-fm-chk{width:14px; height:14px; flex:none; opacity:0; color:var(--tw-accent)}
.tw-fold-menu-item .tw-fm-chk svg{width:14px; height:14px; display:block}
.tw-fold-menu-item.tw-on .tw-fm-chk{opacity:1}
.tw-fold-menu-item .tw-fm-num{width:18px; height:18px; flex:none; border:1px solid var(--tw-line); border-radius:5px; display:grid; place-items:center; font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:10.5px; color:var(--tw-muted)}
.tw-fold-menu-item .tw-fm-lab{flex:1; min-width:0}
.tw-fold-menu-item .tw-fm-kbd{flex:none; font-family:"SF Mono",ui-monospace,Menlo,monospace; font-size:11px; color:var(--tw-faint)}
.tw-fold-menu-sep{height:1px; margin:5px 4px; background:var(--tw-line)}
@media (prefers-reduced-transparency: reduce){ .tw-fold-menu{background:var(--tw-bg); backdrop-filter:none; -webkit-backdrop-filter:none} }
@media (prefers-reduced-motion: reduce){ .tw-fold-menu{animation:none !important} .tw-fold-menu-item{transition:none !important} }
`;
