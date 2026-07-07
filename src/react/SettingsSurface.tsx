import * as React from 'react';
import type { EditorMode } from '../types';

/**
 * Settings surface — the live-toggle settings panel + a ⌘K command palette
 * (Phase B3, plan-TW-0002). Both are controlled, self-contained overlays: the
 * host owns visibility (`open`) and wires ⌘K; this module only renders. Styling
 * comes from {@link SETTINGS_CSS}, injected into the editor's single stylesheet,
 * using the shared `--tw-*` design tokens so light/dark + reduced-motion match
 * the rest of the editor.
 *
 * Nothing here mutates global state: `SettingsPanel` emits `onChange(patch)` and
 * the caller applies it (extensions are merged shallowly by the caller);
 * `CommandPalette` runs the selected command and closes.
 */

/* ------------------------------------------------------------------ *
 * Settings panel
 * ------------------------------------------------------------------ */

/** Live, session-only editor settings surfaced in {@link SettingsPanel}. */
export interface SettingsState {
  mode: EditorMode;
  toolbar: boolean | 'docked' | 'floating';
  folding: boolean;
  theme: 'light' | 'dark' | 'auto';
  extensions: { gfm?: boolean; mdx?: boolean; mermaid?: boolean; math?: boolean; syntaxHighlight?: boolean };
}

const MODE_OPTIONS: { value: EditorMode; label: string }[] = [
  { value: 'edit', label: 'Edit' },
  { value: 'unified', label: 'Unified' },
  { value: 'preview', label: 'Preview' },
  { value: 'read', label: 'Read' },
];

const TOOLBAR_OPTIONS: { value: 'off' | 'docked' | 'floating'; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'docked', label: 'Docked' },
  { value: 'floating', label: 'Floating' },
];

const THEME_OPTIONS: { value: 'light' | 'dark' | 'auto'; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

const EXTENSION_OPTIONS: { key: keyof SettingsState['extensions']; label: string; kbd: string }[] = [
  { key: 'gfm', label: 'GitHub Flavored MD', kbd: 'gfm' },
  { key: 'mdx', label: 'MDX v3', kbd: 'mdx' },
  { key: 'mermaid', label: 'Mermaid', kbd: 'mermaid' },
  { key: 'math', label: 'Math (KaTeX)', kbd: 'math' },
  { key: 'syntaxHighlight', label: 'Syntax highlight', kbd: 'syntaxHl' },
];

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
}): React.JSX.Element {
  const { label, value, options, onSelect } = props;
  return (
    <div className="tw-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="tw-seg-btn"
          aria-pressed={o.value === value}
          onClick={() => onSelect(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow(props: { label: string; kbd?: string; checked: boolean; onToggle: () => void }): React.JSX.Element {
  const { label, kbd, checked, onToggle } = props;
  const id = React.useId();
  return (
    <div className="tw-set-toggle">
      <span className="tw-set-toggle-label" id={id}>
        {label}
        {kbd ? <span className="tw-set-toggle-kbd">{kbd}</span> : null}
      </span>
      <button
        type="button"
        className="tw-sw"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={onToggle}
      />
    </div>
  );
}

/** Move focus back inside `container` when Tab would leave it. */
function trapTab(e: React.KeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== 'Tab' || !container) return;
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((n) => !(n as HTMLButtonElement).disabled && n.offsetParent !== null);
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

export function SettingsPanel(props: {
  open: boolean;
  onClose: () => void;
  state: SettingsState;
  /** extensions merged shallowly by caller */
  onChange: (patch: Partial<SettingsState>) => void;
}): React.JSX.Element | null {
  const { open, onClose, state, onChange } = props;
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Focus the first control when the panel opens.
  React.useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>('button, input, [tabindex]');
    const raf = requestAnimationFrame(() => (first ?? el).focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const toolbarValue: 'off' | 'docked' | 'floating' =
    state.toolbar === false ? 'off' : state.toolbar === 'floating' ? 'floating' : 'docked';

  // Preview the chosen theme live on the panel itself.
  const themeClass = state.theme === 'dark' ? 'tw-theme-dark' : state.theme === 'light' ? 'tw-theme-light' : '';

  return (
    <div
      className={`tw-settings-overlay${themeClass ? ' ' + themeClass : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tw-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Editor settings"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          trapTab(e, panelRef.current);
        }}
      >
        <div className="tw-settings-head">
          <span className="tw-settings-title">Settings</span>
          <button type="button" className="tw-settings-close" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tw-settings-body">
          <section className="tw-set-section">
            <h4 className="tw-set-h4">Mode</h4>
            <Segmented
              label="Editor mode"
              value={state.mode}
              options={MODE_OPTIONS}
              onSelect={(mode) => onChange({ mode })}
            />
          </section>

          <section className="tw-set-section">
            <h4 className="tw-set-h4">Toolbar</h4>
            <Segmented
              label="Toolbar mode"
              value={toolbarValue}
              options={TOOLBAR_OPTIONS}
              onSelect={(v) => onChange({ toolbar: v === 'off' ? false : v })}
            />
          </section>

          <section className="tw-set-section">
            <h4 className="tw-set-h4">Theme</h4>
            <Segmented
              label="Theme appearance"
              value={state.theme}
              options={THEME_OPTIONS}
              onSelect={(theme) => onChange({ theme })}
            />
          </section>

          <section className="tw-set-section">
            <h4 className="tw-set-h4">Section folding</h4>
            <div className="tw-toggle-list">
              <ToggleRow
                label="Fold headings"
                checked={state.folding}
                onToggle={() => onChange({ folding: !state.folding })}
              />
            </div>
          </section>

          <section className="tw-set-section">
            <h4 className="tw-set-h4">Extensions</h4>
            <div className="tw-toggle-list">
              {EXTENSION_OPTIONS.map((ext) => (
                <ToggleRow
                  key={ext.key}
                  label={ext.label}
                  kbd={ext.kbd}
                  checked={!!state.extensions[ext.key]}
                  onToggle={() =>
                    onChange({
                      extensions: { [ext.key]: !state.extensions[ext.key] } as SettingsState['extensions'],
                    })
                  }
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Command palette (⌘K)
 * ------------------------------------------------------------------ */

/** A single command surfaced in {@link CommandPalette}. */
export interface PaletteCommand {
  id: string;
  label: string;
  kbd?: string;
  group?: string;
  run: () => void;
}

/**
 * Subsequence fuzzy score: `null` when `query` is not a subsequence of `text`,
 * otherwise higher is a better match (rewards consecutive + word-boundary hits,
 * mildly penalizes longer targets). Both args are compared case-insensitively.
 */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let run = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      run++;
      score += run * 2;
      const prev = t[ti - 1];
      if (ti === 0 || prev === ' ' || prev === '-' || prev === '/') score += 6;
      qi++;
    } else {
      run = 0;
    }
  }
  if (qi < q.length) return null;
  return score - t.length * 0.1;
}

export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}): React.JSX.Element | null {
  const { open, onClose, commands } = props;
  const [query, setQuery] = React.useState('');
  const [highlight, setHighlight] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const activeItemRef = React.useRef<HTMLLIElement>(null);

  const { groups, flat } = React.useMemo(() => {
    const q = query.trim();
    const order: string[] = [];
    const byGroup = new Map<string, { cmd: PaletteCommand; score: number }[]>();
    for (const cmd of commands) {
      const score = q ? fuzzyScore(q, cmd.label) : 0;
      if (score === null) continue;
      const g = cmd.group ?? '';
      let bucket = byGroup.get(g);
      if (!bucket) {
        bucket = [];
        byGroup.set(g, bucket);
        order.push(g);
      }
      bucket.push({ cmd, score });
    }
    let idx = 0;
    const grouped = order.map((name) => {
      const bucket = byGroup.get(name)!;
      if (q) bucket.sort((a, b) => b.score - a.score);
      return { name, items: bucket.map(({ cmd }) => ({ cmd, flatIndex: idx++ })) };
    });
    const flatList: PaletteCommand[] = [];
    for (const gr of grouped) for (const it of gr.items) flatList.push(it.cmd);
    return { groups: grouped, flat: flatList };
  }, [commands, query]);

  // Reset + focus the input each time the palette opens.
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Keep the highlight in range as the filtered list changes.
  React.useEffect(() => {
    setHighlight((h) => (flat.length === 0 ? 0 : Math.min(h, flat.length - 1)));
  }, [flat.length]);

  // Scroll the highlighted option into view.
  React.useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!open) return null;

  const runAt = (i: number): void => {
    const cmd = flat[i];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlight((h) => (flat.length === 0 ? 0 : (h + 1) % flat.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlight((h) => (flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length));
        break;
      case 'Home':
        e.preventDefault();
        setHighlight(0);
        break;
      case 'End':
        e.preventDefault();
        setHighlight(flat.length === 0 ? 0 : flat.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        runAt(highlight);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        // Only the input is tabbable; keep focus trapped on it.
        trapTab(e, dialogRef.current);
        break;
      default:
        break;
    }
  };

  const activeId = flat[highlight] ? `tw-pcmd-${highlight}` : undefined;

  return (
    <div
      className="tw-palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tw-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="tw-palette-input-wrap">
          <svg
            className="tw-palette-search"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            className="tw-palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="tw-palette-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            placeholder="Type a command…"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="tw-palette-esc">esc</kbd>
        </div>
        <ul className="tw-palette-list" id="tw-palette-list" role="listbox" aria-label="Commands">
          {groups.map((group) => (
            <React.Fragment key={group.name || '_'}>
              {group.name ? (
                <li className="tw-palette-group" role="presentation">
                  {group.name}
                </li>
              ) : null}
              {group.items.map((it) => (
                <li
                  key={it.cmd.id}
                  id={`tw-pcmd-${it.flatIndex}`}
                  role="option"
                  aria-selected={it.flatIndex === highlight}
                  className={`tw-palette-item${it.flatIndex === highlight ? ' tw-active' : ''}`}
                  ref={it.flatIndex === highlight ? activeItemRef : undefined}
                  onMouseMove={() => setHighlight(it.flatIndex)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    runAt(it.flatIndex);
                  }}
                >
                  <span className="tw-palette-label">{it.cmd.label}</span>
                  {it.cmd.kbd ? <kbd className="tw-palette-kbd">{it.cmd.kbd}</kbd> : null}
                </li>
              ))}
            </React.Fragment>
          ))}
          {flat.length === 0 ? (
            <li className="tw-palette-empty" role="presentation">
              No matching commands
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Styles (injected into the editor's single stylesheet)
 * ------------------------------------------------------------------ */

const LIGHT_TOKENS =
  '--tw-fg:#1a1d20;--tw-muted:#5a6169;--tw-faint:#8b929a;--tw-bg:#ffffff;--tw-chip:#f0f1f3;--tw-line:rgba(18,22,27,.1);--tw-accent:#2f6fed;--tw-accent-soft:rgba(47,111,237,.1);--tw-code-bg:#f6f7f9;';
const DARK_TOKENS =
  '--tw-fg:#e8eaed;--tw-muted:#a3abb2;--tw-faint:#6a727a;--tw-bg:#0f1215;--tw-chip:#1e242b;--tw-line:rgba(255,255,255,.1);--tw-accent:#6ea3ff;--tw-accent-soft:rgba(110,163,255,.14);--tw-code-bg:#13171b;';

export const SETTINGS_CSS = `
.tw-settings-overlay,.tw-palette-overlay{${LIGHT_TOKENS}position:fixed;inset:0;z-index:1000;display:flex;font-family:-apple-system,"SF Pro Text",system-ui,sans-serif;color:var(--tw-fg);line-height:1.5;font-size:15px}
@media (prefers-color-scheme: dark){.tw-settings-overlay:not(.tw-theme-light),.tw-palette-overlay:not(.tw-theme-light){${DARK_TOKENS}}}
.tw-settings-overlay.tw-theme-dark,.tw-palette-overlay.tw-theme-dark{${DARK_TOKENS}}
:root[data-theme="dark"] .tw-settings-overlay:not(.tw-theme-light),:root[data-theme="dark"] .tw-palette-overlay:not(.tw-theme-light){${DARK_TOKENS}}
.tw-settings-overlay.tw-theme-light,.tw-palette-overlay.tw-theme-light,:root[data-theme="light"] .tw-settings-overlay,:root[data-theme="light"] .tw-palette-overlay{${LIGHT_TOKENS}}

.tw-settings-overlay{justify-content:flex-end;background:color-mix(in srgb,#0b0d0f 30%,transparent);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);animation:tw-set-fade .18s ease}
.tw-palette-overlay{align-items:flex-start;justify-content:center;padding:14vh 16px 16px;background:color-mix(in srgb,#0b0d0f 34%,transparent);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:tw-set-fade .16s ease}

.tw-settings-panel{width:340px;max-width:92vw;height:100%;box-sizing:border-box;background:var(--tw-bg);border-left:1px solid var(--tw-line);box-shadow:-18px 0 48px -20px rgba(0,0,0,.5);display:flex;flex-direction:column;outline:none;animation:tw-set-slide .26s cubic-bezier(.32,.72,0,1)}
.tw-settings-head{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--tw-line)}
.tw-settings-title{flex:1;font-size:15px;font-weight:640;letter-spacing:-.01em}
.tw-settings-close{width:28px;height:28px;flex:none;border:1px solid var(--tw-line);background:var(--tw-chip);border-radius:8px;color:var(--tw-muted);font-size:18px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:color .15s,border-color .15s}
.tw-settings-close:hover{color:var(--tw-fg);border-color:var(--tw-accent)}
.tw-settings-close:focus-visible{outline:2px solid var(--tw-accent);outline-offset:2px}
.tw-settings-body{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:18px}
.tw-set-section{display:flex;flex-direction:column;gap:8px}
.tw-set-h4{margin:0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--tw-faint);font-weight:600}
.tw-toggle-list{display:flex;flex-direction:column;gap:1px}

.tw-seg{display:flex;width:100%;background:color-mix(in srgb,var(--tw-chip) 60%,transparent);border:1px solid var(--tw-line);border-radius:10px;padding:3px;gap:2px}
.tw-seg-btn{flex:1;border:0;background:transparent;color:var(--tw-muted);font-size:12.5px;font-weight:540;padding:6px 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:color .18s,background .18s}
.tw-seg-btn[aria-pressed="true"]{color:var(--tw-fg);background:var(--tw-bg);box-shadow:0 1px 2px rgba(0,0,0,.18)}
.tw-seg-btn:hover:not([aria-pressed="true"]){color:var(--tw-fg)}
.tw-seg-btn:focus-visible{outline:2px solid var(--tw-accent);outline-offset:1px}

.tw-set-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 8px;border-radius:8px;transition:background .15s}
.tw-set-toggle:hover{background:var(--tw-chip)}
.tw-set-toggle-label{display:flex;align-items:center;gap:9px;font-size:13.5px}
.tw-set-toggle-kbd{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11px;color:var(--tw-faint)}
.tw-sw{width:38px;height:22px;flex:none;padding:0;border-radius:999px;background:var(--tw-chip);border:1px solid var(--tw-line);position:relative;cursor:pointer;transition:background .2s}
.tw-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s cubic-bezier(.32,.72,0,1)}
.tw-sw[aria-checked="true"]{background:var(--tw-accent)}
.tw-sw[aria-checked="true"]::after{transform:translateX(16px)}
.tw-sw:focus-visible{outline:2px solid var(--tw-accent);outline-offset:2px}

.tw-palette{width:560px;max-width:100%;max-height:60vh;box-sizing:border-box;background:var(--tw-bg);border:1px solid var(--tw-line);border-radius:14px;box-shadow:0 24px 64px -18px rgba(0,0,0,.55);display:flex;flex-direction:column;overflow:hidden;animation:tw-pal-in .2s cubic-bezier(.32,.72,0,1)}
.tw-palette-input-wrap{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid var(--tw-line)}
.tw-palette-search{width:17px;height:17px;flex:none;color:var(--tw-faint)}
.tw-palette-input{flex:1;min-width:0;border:0;background:transparent;outline:none;color:var(--tw-fg);font-size:15px;font-family:inherit}
.tw-palette-input::placeholder{color:var(--tw-faint)}
.tw-palette-esc{flex:none;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11px;color:var(--tw-faint);border:1px solid var(--tw-line);border-radius:5px;padding:2px 6px}
.tw-palette-list{list-style:none;margin:0;padding:6px;overflow:auto;flex:1}
.tw-palette-group{padding:8px 10px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--tw-faint);font-weight:600}
.tw-palette-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;color:var(--tw-fg)}
.tw-palette-item.tw-active{background:var(--tw-accent-soft)}
.tw-palette-label{flex:1;min-width:0;font-size:13.5px}
.tw-palette-kbd{flex:none;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11px;color:var(--tw-muted);background:var(--tw-chip);border:1px solid var(--tw-line);border-radius:5px;padding:2px 6px}
.tw-palette-item.tw-active .tw-palette-kbd{color:var(--tw-accent)}
.tw-palette-empty{padding:22px;text-align:center;color:var(--tw-faint);font-size:13px}

@keyframes tw-set-fade{from{opacity:0}to{opacity:1}}
@keyframes tw-set-slide{from{transform:translateX(18px);opacity:.4}to{transform:none;opacity:1}}
@keyframes tw-pal-in{from{transform:translateY(-8px) scale(.98);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion: reduce){.tw-settings-overlay,.tw-palette-overlay,.tw-settings-panel,.tw-palette,.tw-sw::after{animation:none !important;transition:none !important}}
@media (prefers-reduced-transparency: reduce){.tw-settings-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:color-mix(in srgb,#0b0d0f 60%,transparent)}.tw-palette-overlay{backdrop-filter:none;-webkit-backdrop-filter:none;background:color-mix(in srgb,#0b0d0f 64%,transparent)}}
`;
