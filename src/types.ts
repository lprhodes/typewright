/**
 * Typewright — public type surface.
 *
 * These types ARE the API contract (spec-as-code). The from-scratch engine that
 * fulfils them — document model, incremental block parser, virtualized DOM view,
 * anticipatory streaming renderer — is described in SPEC.md and is in progress.
 *
 * The core types here intentionally carry NO React dependency, so the headless
 * engine (`typewright/core`) is usable without React. React-specific types live
 * in `src/react`.
 */

/* ------------------------------------------------------------------ *
 * Modes
 * ------------------------------------------------------------------ */

/**
 * How the document is presented and edited.
 *
 * - `edit`     Raw Markdown/MDX source with syntax highlighting.
 * - `unified`  Obsidian-style live preview: formatting renders inline, and the
 *              raw syntax is revealed only around the caret/selection. Flagship.
 * - `preview`  Fully-rendered rich preview that is still editable.
 * - `read`     Fully-rendered, non-editable output.
 */
export type EditorMode = 'edit' | 'unified' | 'preview' | 'read';

/* ------------------------------------------------------------------ *
 * Extensions
 * ------------------------------------------------------------------ */

export interface GfmFeatures {
  tables: boolean;
  taskLists: boolean;
  strikethrough: boolean;
  autolinks: boolean;
  footnotes: boolean;
}

export interface MermaidOptions {
  enabled: boolean;
  /** Mermaid theme name; diagrams render inside the isolated sandbox. */
  theme?: string;
}

export interface MathOptions {
  enabled: boolean;
  engine?: 'katex' | 'custom';
}

export interface SyntaxHighlightOptions {
  enabled: boolean;
  /** Highlight theme name. Editor highlighting is native; this is for previews. */
  theme?: string;
}

/**
 * How MDX's JSX/TS is transformed to runnable JavaScript before sandboxed
 * execution. This is the single conceded dependency boundary (see SPEC.md §7):
 * the Markdown/MDX *markup* is parsed by Typewright's own parser, but turning
 * JSX/TS into plain JS is delegated to a wasm transform or a host-supplied fn.
 */
export type MdxTransform =
  | 'wasm-esbuild'
  | 'wasm-swc'
  | 'constrained'
  | ((code: string, meta: { filename?: string }) => string | Promise<string>);

export interface SandboxOptions {
  /**
   * Must remain false. MDX executes in an `iframe srcdoc sandbox="allow-scripts"`
   * with an opaque origin (no `allow-same-origin`) so an XSS payload cannot reach
   * the host — Electron-safe (blocks the XSS→RCE path).
   */
  allowSameOrigin?: false;
  /** Extra Content-Security-Policy appended to the sandbox document. */
  csp?: string;
  /** Proxy for host/network access requested by an MDX component via postMessage. */
  onHostMessage?: (message: unknown) => void;
}

/** Component name → component. Loose in core to avoid a React type dependency. */
export type ComponentMap = Record<string, unknown>;

export interface MdxOptions {
  enabled: boolean;
  /** Components made available to MDX (`<Chart/>`, `<Callout/>`, …). */
  components?: ComponentMap;
  transform?: MdxTransform;
  sandbox?: SandboxOptions;
}

export interface FoldingOptions {
  enabled: boolean;
  /** Show the fold gutter + per-heading fold affordance. */
  showGutter?: boolean;
  /** localStorage key to persist fold state across reloads. */
  persistKey?: string;
}

export interface Extensions {
  /** GitHub Flavored Markdown. `true` enables the full set. */
  gfm?: boolean | Partial<GfmFeatures>;
  /** MDX v3 (JSX + ESM + expressions). */
  mdx?: boolean | MdxOptions;
  mermaid?: boolean | MermaidOptions;
  math?: boolean | MathOptions;
  syntaxHighlight?: boolean | SyntaxHighlightOptions;
}

/* ------------------------------------------------------------------ *
 * Keymap / theme
 * ------------------------------------------------------------------ */

export interface KeymapOptions {
  /** Base keymap preset. `default` gives standard text-editing shortcuts. */
  preset?: 'default' | 'none';
  /** Override or add bindings: `"Mod-b" -> "toggleStrong"`. */
  bindings?: Record<string, string>;
}

export interface ThemeOptions {
  appearance?: 'light' | 'dark' | 'auto';
  /** CSS custom-property overrides (`--tw-accent`, …). */
  tokens?: Record<string, string>;
}

/* ------------------------------------------------------------------ *
 * Document geometry
 * ------------------------------------------------------------------ */

export interface DocPosition {
  /** UTF-16 offset into the document string. */
  offset: number;
  line: number;
  column: number;
}

export interface DocRange {
  from: number;
  to: number;
}

export interface DocSelection {
  main: DocRange;
  ranges: DocRange[];
}

/** A single edit expressed as a range replacement (CodeMirror-style). */
export interface DocChange {
  from: number;
  to: number;
  insert: string;
}

/* ------------------------------------------------------------------ *
 * Editor configuration + events
 * ------------------------------------------------------------------ */

export interface EditorConfig {
  value?: string;
  mode?: EditorMode;
  extensions?: Extensions;
  folding?: boolean | FoldingOptions;
  readOnly?: boolean;
  placeholder?: string;
  keymap?: KeymapOptions;
  theme?: ThemeOptions;
  /** Lines rendered outside the viewport bounds (virtualization overscan). */
  overscan?: number;
}

export interface EditorEvents {
  onChange?: (value: string, change: DocChange) => void;
  onSelectionChange?: (selection: DocSelection) => void;
  onModeChange?: (mode: EditorMode) => void;
}

/* ------------------------------------------------------------------ *
 * Streaming preview
 * ------------------------------------------------------------------ */

/**
 * Which incomplete constructs are optimistically rendered mid-stream.
 * e.g. `emphasis` renders `*bo` as in-progress bold before the closing `*`.
 */
export interface AnticipationOptions {
  emphasis?: boolean;
  strong?: boolean;
  code?: boolean;
  strikethrough?: boolean;
  links?: boolean;
  headings?: boolean;
  /** An unterminated ```` ``` ```` opens an in-progress code block. */
  fences?: boolean;
  listItems?: boolean;
  tables?: boolean;
  /** Partial JSX elements render a skeleton until the tag/props complete. */
  jsx?: boolean;
}

export interface StreamOptions {
  /** Optimistically render incomplete formatting as tokens arrive. */
  anticipate?: boolean | AnticipationOptions;
  /** Skeleton rendered for a component whose props are still streaming. */
  componentFallback?: unknown;
  /** Reveal characters smoothly rather than in raw chunk jumps. */
  smooth?: boolean | { charsPerSecond: number };
}

/** Imperative handle for feeding a token stream into a preview. */
export interface StreamController {
  /** Append a chunk (token/word/sentence) to the stream. */
  push(chunk: string): void;
  /** Replace the whole buffer (e.g. a corrected re-generation). */
  replace(full: string): void;
  /** Mark the stream complete; resolves any anticipated formatting. */
  end(): void;
  /** Clear and start over. */
  reset(): void;
  readonly text: string;
  readonly complete: boolean;
}
