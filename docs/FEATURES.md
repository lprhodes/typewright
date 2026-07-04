# Typewright — Feature Reference

The complete capability catalogue for the `typewright` editor library, with honest
status on every feature and the full API. Pairs with [SPEC.md](../SPEC.md) (how it's
built) and [spec-TW-0001.md](./specs/spec-TW-0001.md) (the feature spec).

**Status legend:** ✅ Shipped (real + tested) · 🟡 Partial (works, with gaps) · 🔜 Planned (designed, not yet built — see the [design prototype](../demo/design-prototype.html))

---

## At a glance

| Area | Capability | Status |
|---|---|---|
| **Modes** | Edit · Unified · Preview (editable) · Read | ✅ |
| **Markdown** | Full CommonMark + GFM (tables, task lists, strikethrough, autolinks) | ✅ |
| | Footnotes · definition lists | 🔜 |
| **MDX** | Markup recognized (JSX / ESM / expressions) | 🟡 |
| | Component **execution** (sandboxed) | 🔜 |
| **Live preview** | Unified block-level editing (click to reveal source) | ✅ |
| | Character-level inline marker reveal (Obsidian-exact) | 🔜 |
| **Toolbar** | Built-in formatting toolbar (docked / floating) + command engine | ✅ |
| **Keyboard** | Standard text-editing shortcuts | ✅ |
| **Folding** | Semantic heading section folding | ✅ |
| | Fold menu (set H1–H6, fold-all) | 🔜 |
| **Tables** | GFM table parse + render + source edit | ✅ |
| | In-place WYSIWYG grid editing | 🔜 |
| **Streaming** | LLM token-stream preview with formatting anticipation | ✅ |
| **Diagrams / math** | Mermaid · KaTeX rendering | 🔜 |
| **Code** | Fenced code blocks | ✅ |
| | Syntax **colouring** of rendered code | 🔜 |
| **Collaboration** | Comments, presence, cursors | 🔜 |
| **Settings** | Built-in settings / command-palette surface | 🔜 |
| **Theming** | Light / dark / auto + CSS-variable tokens | ✅ |
| **Security** | Sanitizing renderer (XSS-safe), Electron-safe execution model | ✅ |
| **Packaging** | Drop-in React component · headless core · zero runtime deps | ✅ |

---

## 1. Editing modes ✅

One editor, four modes (the `mode` prop), all over the same Markdown string (the string is always the source of truth):

- **`edit`** — raw Markdown source in a text area, with syntax-aware editing and shortcuts.
- **`unified`** — live preview: the document renders richly; **click any block to reveal and edit its Markdown source** inline, then blur to re-render. Rows animate to their new positions on reveal/commit (no jump).
- **`preview`** — fully rendered **and editable** (click a block to edit its source). The "rich, editable preview."
- **`read`** — fully rendered, non-editable.

Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). Emits `onChange(value, change)` and `onSelectionChange(selection)`.

## 2. Markdown — CommonMark + GFM ✅

A hand-written, offset-exact parser (zero dependencies) covering:

**Blocks:** headings (ATX `#`–`######`), paragraphs, blockquotes (nestable), bullet & ordered lists (nestable, tight/loose), **task lists** (`- [ ]` / `- [x]`), fenced & indented code blocks, thematic breaks, and **GFM tables** (with per-column alignment).

**Inline:** `**strong**` / `*emphasis*` (and `_`), `~~strikethrough~~`, `` `inline code` ``, `[links](url "title")`, `![images](url)`, `<autolinks>`, and hard/soft line breaks.

The parser never throws on malformed or incomplete input (degrades gracefully) and is bounded against pathological input (e.g. runs of unmatched brackets stay O(n)). 🔜 **Not yet:** footnotes, definition lists.

## 3. MDX 🟡

MDX **markup** is recognized by the parser — JSX elements, ESM `import`/`export` lines, and `{expressions}` are captured as offset-exact nodes (so they highlight, fold, and select correctly). 🔜 **Component execution is deferred:** MDX/JSX currently renders as **escaped source** (the safety boundary), not as live React components. The execution path (compile via wasm transform → run in an opaque-origin sandboxed `iframe`, Electron-safe) is designed in [SPEC.md §7](../SPEC.md#7-mdx-the-markupexecution-split) and represented in the [design prototype](../demo/design-prototype.html).

## 4. Formatting toolbar & command engine ✅

A **built-in toolbar** (`toolbar` prop) with a pure, tested command engine underneath:

- **Inline:** bold, italic, strikethrough, inline code, link.
- **Blocks:** heading levels, bullet / numbered / task lists, blockquote.
- **Insert:** divider (`---`), code block, table.

Each command (`core/commands.ts` → `applyCommand(text, selection, command)`) is a pure, toggle-aware transform over the text + selection, so it round-trips cleanly and restores the caret. The toolbar drives the **live selection** of the focused editing surface, and is also exposed imperatively (§ API — `applyCommand`).

**Display:** `toolbar="docked"` pins it; `toolbar="floating"` reveals it as an inset, rounded, shadowed pill that animates in on hover/focus.

## 5. Keyboard shortcuts ✅

Standard text-editing shortcuts in any editing surface: `⌘/Ctrl+B` bold, `⌘/Ctrl+I` italic, `⌘/Ctrl+K` link, `⌘/Ctrl+E` inline code — plus native selection, undo/redo, and caret motion. Rebindable keymap is designed ([`KeymapOptions`](../src/types.ts)); the default preset ships. IME/composition is handled by the platform text-input layer (deep IME/bidi hardening is on the roadmap).

## 6. Section folding ✅

**Semantic** heading folding: fold a heading and everything beneath it collapses to the next same-or-higher heading (never regex-based — it walks the parse tree). A per-heading chevron folds/unfolds; a folded section shows a summary chip (`N blocks · M subsections`). Fold ranges are also available headless (`headingFoldRanges`). 🔜 **Not yet:** the fold **menu** (set Heading 1–6, Fold-all / Unfold-all, copy-link) shown in the design prototype.

## 7. Streaming preview + anticipation ✅

`<StreamingPreview>` renders an AI/LLM token stream incrementally and **optimistically resolves incomplete formatting** so the preview reads as finished prose while it's still arriving:

- `*bo` → in-progress **bold**; `` `co `` → inline code; an open ```` ``` ```` → a live code block; a forming `<Component` → a shimmer skeleton.
- **Confirmed content never reflows** (parity-based open-delimiter detection).
- Rendered **block-by-block with entrance animations** (stable committed blocks — no full-innerHTML flicker) and a live caret.

Drive it with an updating `text` prop, or hand it a `stream` (async iterable or `ReadableStream`). Reference behaviour: [ai-sdk jsx-preview](https://elements.ai-sdk.dev/components/jsx-preview).

## 8. Theming ✅

`theme={{ appearance: 'light' | 'dark' | 'auto' }}` (auto follows `prefers-color-scheme`). All styling is CSS custom properties (`--tw-*`) — no CSS-in-JS runtime — so tokens can be overridden. Styles are self-injected once (drop-in; no external stylesheet import). Respects `prefers-reduced-motion` and `prefers-reduced-transparency`.

## 9. Security ✅

- **Sanitizing renderer** (`core/render.ts`) is the boundary: all text/attributes are escaped; every URL passes a scheme allowlist (`safeUrl` blocks `javascript:`, `data:text/html`, obfuscation, etc.); raw HTML / MDX is emitted **escaped**, never as live markup. Covered by unit + end-to-end XSS tests, and cleared by an independent adversarial review.
- **Electron-safe execution model** (for MDX, once shipped): compiled output runs in an opaque-origin sandboxed `iframe` (`allow-scripts`, no `allow-same-origin`), so an XSS payload can't escalate to host/Node access.

## 10. Performance ✅

- Incremental, block-structured parsing; parse cost tracks the edit, not the document.
- No React on the per-keystroke path in the block model.
- Target metric is **keystroke-to-paint latency (INP)** on realistic documents, not batch throughput ([SPEC.md §10](../SPEC.md#10-performance-targets--benchmarking)).
- 🔜 Custom viewport **virtualization** for very large documents is on the roadmap.

## 11. Collaboration & comments 🔜

Anchored comment threads (offsets ride position-mapping), selection → comment, replies + reactions, resolve, plus presence avatars and live cursors. **Designed, not yet built** — fully represented in the [design prototype](../demo/design-prototype.html) and specified as C20–C23 / SPEC.md §14. Next roadmap feature.

## 12. Settings 🔜

A built-in settings / command surface (config + command palette) over the editor. Designed; not yet built. (Configuration is available today via component props.)

---

## API reference

### `<TypewrightEditor>` — the drop-in component

```tsx
import { TypewrightEditor } from 'typewright';
```

| Prop | Type | Notes |
|---|---|---|
| `value` | `string` | Controlled Markdown value. |
| `defaultValue` | `string` | Uncontrolled initial value. |
| `onChange` | `(value, change) => void` | Fires on every edit. |
| `onSelectionChange` | `(selection) => void` | |
| `mode` | `'edit' \| 'unified' \| 'preview' \| 'read'` | Default `'unified'`. |
| `toolbar` | `boolean \| 'docked' \| 'floating'` | Built-in formatting toolbar. |
| `folding` | `boolean \| FoldingOptions` | Heading folding (default on). |
| `theme` | `{ appearance?, tokens? }` | `'light' \| 'dark' \| 'auto'`. |
| `readOnly` | `boolean` | |
| `placeholder` | `string` | |
| `extensions` | `{ gfm, mdx, mermaid, math, syntaxHighlight }` | Feature flags (GFM always on in v0.1). |
| `keymap` | `KeymapOptions` | |
| `className` / `style` | | |

**Imperative handle** (via `ref`):

```tsx
import type { TypewrightEditorHandle } from 'typewright';
const ref = useRef<TypewrightEditorHandle>(null);
// ref.current.applyCommand('bold')   // acts on the live selection
```

### `<StreamingPreview>`

```tsx
import { StreamingPreview } from 'typewright';
<StreamingPreview text={accumulatedText} anticipate />
// or:  <StreamingPreview stream={result.textStream} anticipate />
```

| Prop | Type |
|---|---|
| `text` | `string` (controlled) |
| `stream` | `AsyncIterable<string> \| ReadableStream<string>` |
| `anticipate` | `boolean \| AnticipationOptions` |
| `className` / `style` | |

### Headless core — `typewright/core`

Framework-agnostic, zero-dependency:

- `parse(src): Document` — offset-exact GFM/MDX-markup AST.
- `renderToHtml(doc)` / `renderInline(nodes)` / `renderNode(node)` — sanitized HTML. `safeUrl(url)`.
- `collectMarkers(doc)` / `hiddenMarkers(doc, sel)` / `activeBlockIndex(doc, offset)` — unified-mode logic.
- `headingFoldRanges(doc)` — fold ranges.
- `applyCommand(text, sel, command)` — the command engine.
- `TextDoc` — immutable document model with transaction edits + position mapping.
- The AST node types (`Document`, `Block`, `Inline`, …).

### Streaming — `typewright/streaming`

- `createStreamController(onUpdate, options)` — accumulate a token stream.
- `pipeStream(source, controller)` — drive it from an async iterable / `ReadableStream`.
- `anticipate(partial, options): { html, pending }` — the anticipation renderer.

---

## Packages & exports

| Import | Contents | React? |
|---|---|---|
| `typewright` | `<TypewrightEditor>`, `<StreamingPreview>`, types | yes (peer) |
| `typewright/core` | parser, renderer, unified/fold logic, commands, model, AST | no |
| `typewright/streaming` | stream controller + anticipation renderer | no |

**Zero runtime dependencies.** `react` / `react-dom` (≥18) are optional peers (only for the React entry). Ships ESM + CJS + `.d.ts`.

## Runtime support

Modern browsers and Electron (web + desktop). The headless core runs anywhere (incl. Node, for parse/render/serialization).

## Roadmap

Next features, each shipped as its own pass (see [plan-TW-0001.md](./plans/plan-TW-0001.md) §15): **comments & collaboration** → **settings surface** → syntax **colouring** of code → **MDX execution** (sandboxed) → **Mermaid/math** → in-place **table grid** → character-level inline reveal → custom virtualization + deep IME. The [design prototype](../demo/design-prototype.html) shows the full intended experience.

---

*Status reflects `main` as of the latest release. See the repo [README](../README.md) for install + demo.*
