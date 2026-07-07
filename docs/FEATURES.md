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
| | Footnotes · definition lists | ✅ |
| **MDX** | Markup recognized (JSX / ESM / expressions) | ✅ |
| | Component **execution** (sandboxed iframe) | ✅ |
| **Live preview** | Unified block-level editing (click to reveal source) | ✅ |
| | Character-level inline marker reveal (Obsidian-exact, per-caret) | ✅ |
| **Toolbar** | Built-in formatting toolbar (docked / floating) + command engine | ✅ |
| **Keyboard** | Standard text-editing shortcuts + rebindable keymap + ⌘K palette | ✅ |
| | IME / composition (native `<textarea>` + contentEditable) | ✅ |
| **Folding** | Semantic heading section folding | ✅ |
| | Fold menu (set H1–H6, fold-all, copy-link) + `persistKey` | ✅ |
| **Tables** | GFM table parse + render + source edit | ✅ |
| | In-place WYSIWYG grid editing | ✅ |
| **Streaming** | LLM token-stream preview with formatting anticipation (links · lists · tables · smooth) | ✅ |
| **Diagrams / math** | Mermaid · KaTeX rendering (host-supplied engines, sandboxed) | ✅ |
| **Code** | Fenced code blocks | ✅ |
| | Syntax **colouring** of rendered code (native, zero-dep) | ✅ |
| **Collaboration** | Comments, presence, cursors | ✅ |
| **Settings** | Built-in settings / command-palette surface | ✅ |
| **Performance** | Incremental reparse · benchmark harness · gzip size budget | ✅ |
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

> ✅ **Marker reveal granularity — both modes shipped.** Unified mode's default is **block**-level reveal (click a block → its source appears in an inline editor). The Obsidian-exact **per-caret** reveal — only the markers immediately around the caret (`**`, `*`, `` ` ``, `#`, `[]()`, fences, blockquotes) surface while the rest of the line stays rendered — is now shipped as an **opt-in** mode: set `unifiedReveal: 'caret'`. It is a managed `contentEditable` surface driving the tested `hiddenMarkers` algorithm, with a click-settle debounce; the string stays canonical throughout. Block-level stays the default (and the fallback). Preview mode stays block-edit **by design**. *Coverage honesty:* the per-caret surface is exercised end-to-end in the e2e suite (reveal/hide, click caret placement, typing round-trip, block split/merge, IME commit); the deep CJK candidate-window / dead-key / soft-keyboard tail and Home/End line-nav in the caret surface are the documented coverage boundary, not exhaustively driven.

## 2. Markdown — CommonMark + GFM ✅

A hand-written, offset-exact parser (zero dependencies) covering:

**Blocks:** headings (ATX `#`–`######`), paragraphs, blockquotes (nestable), bullet & ordered lists (nestable, tight/loose), **task lists** (`- [ ]` / `- [x]`), fenced & indented code blocks, thematic breaks, and **GFM tables** (with per-column alignment).

**Inline:** `**strong**` / `*emphasis*` (and `_`), `~~strikethrough~~`, `` `inline code` ``, `[links](url "title")`, `![images](url)`, `<autolinks>`, and hard/soft line breaks.

The parser never throws on malformed or incomplete input (degrades gracefully) and is bounded against pathological input (e.g. runs of unmatched brackets stay O(n)). ✅ **Also shipped:** GFM **footnotes** (`[^id]` references + `[^id]:` definition blocks rendered as a GitHub-style ordered list with back-links) and **definition lists** (`term` / `: definition` → `<dl>/<dt>/<dd>`); both degrade to plain text when malformed.

## 3. MDX ✅

MDX **markup** is recognized by the parser — JSX elements, ESM `import`/`export` lines, and `{expressions}` are captured as offset-exact nodes (so they highlight, fold, and select correctly).

✅ **Component execution is shipped** via the `typewright/mdx` entry, opt-in behind `extensions.mdx` + a configured transform. The path is exactly the one designed in [SPEC.md §7](../SPEC.md#7-mdx-the-markupexecution-split): a transform adapter (`wasm-esbuild` / `wasm-swc` — host-installed optional peers — or the built-in zero-dep `constrained` subset, or a host function) runs **off-thread in a Blob worker**, and the result evaluates inside an **opaque-origin sandboxed `iframe`** (`allow-scripts`, never `allow-same-origin`; strict CSP). The compiled output stays *inside* the iframe (the iframe is the widget) — it is never `innerHTML`'d into the host tree, so the XSS→RCE path stays closed (Electron-safe). No transform configured → the block falls back to **escaped source** exactly as before; malformed JSX shows an inline error card and never blocks editing. Bundles nothing: esbuild-wasm / swc are host-supplied.

## 4. Formatting toolbar & command engine ✅

A **built-in toolbar** (`toolbar` prop) with a pure, tested command engine underneath:

- **Inline:** bold, italic, strikethrough, inline code, link.
- **Blocks:** heading levels, bullet / numbered / task lists, blockquote.
- **Insert:** divider (`---`), code block, table.

Each command (`core/commands.ts` → `applyCommand(text, selection, command)`) is a pure, toggle-aware transform over the text + selection, so it round-trips cleanly and restores the caret. The toolbar drives the **live selection** of the focused editing surface, and is also exposed imperatively (§ API — `applyCommand`).

**Display:** `toolbar="docked"` pins it; `toolbar="floating"` reveals it as an inset, rounded, shadowed pill that animates in on hover/focus.

## 5. Keyboard shortcuts ✅

Standard text-editing shortcuts in any editing surface: `⌘/Ctrl+B` bold, `⌘/Ctrl+I` italic, `⌘/Ctrl+K` link, `⌘/Ctrl+E` inline code — plus native selection, undo/redo, and caret motion. ✅ The **rebindable keymap** ([`KeymapOptions`](../src/types.ts)) is live — `keymap.preset` (incl. `'none'` to disable) + per-command `bindings` overrides — and every shortcut now routes through the same tested command engine as the toolbar (no more double-wrap on repeat). A **⌘K command palette** enumerates and runs every command (§ Settings). 

**IME / composition** is handled correctly through the **platform text-input layer**: block-level editing uses native `<textarea>` surfaces, and the opt-in per-caret reveal surface uses a managed `contentEditable` (composition is suppressed during `compositionstart`→`compositionend` and committed once on end — never reimplemented). Composition, dead keys and CJK input work in both. ✅ **Design note:** the SPEC §4.4 *hidden-sink* architecture (a single positioned hidden sink driving a fully custom caret) is **deliberately not** how this is built — `contentEditable` and native textareas route composition through the platform for free, which is the correct-for-IME choice; the user-facing goals (per-caret reveal + working IME) are delivered without the bespoke sink. This is a documented architectural divergence, not a gap.

## 6. Section folding ✅

**Semantic** heading folding: fold a heading and everything beneath it collapses to the next same-or-higher heading (never regex-based — it walks the parse tree). A per-heading chevron folds/unfolds; a folded section shows a summary chip (`N blocks · M subsections`). Fold ranges are also available headless (`headingFoldRanges`). ✅ **Shipped:** the fold **menu** — set Heading 1–6 (rewrites the `#` run), Toggle Folding, Fold-all / Unfold-all headers, and Copy Link (GitHub-style `#slug` to the clipboard), keyboard-accessible. `FoldingOptions` is honored: `persistKey` persists the folded set across reloads (re-anchored by heading text) and `showGutter:false` hides the chevrons.

## 7. Streaming preview + anticipation ✅

`<StreamingPreview>` renders an AI/LLM token stream incrementally and **optimistically resolves incomplete formatting** so the preview reads as finished prose while it's still arriving:

- `*bo` / `_bo` → in-progress **bold**/italic; `` `co `` → inline code; an open ```` ``` ```` → a live code block; a forming `<Component` → a shimmer skeleton.
- ✅ Now also anticipates **forming links** (`[text](…`), **list items**, and **table rows** (a partial `| a | b` renders an in-progress row), via the `AnticipationOptions.links` / `listItems` / `tables` flags.
- ✅ **Smooth reveal** (`StreamOptions.smooth` / `<StreamingPreview smooth>`): a reveal cursor advances at `charsPerSecond` and flushes on `end()`, so bursty token arrival reads as steady typing. `componentFallback` is surfaced as a prop.
- **Confirmed content never reflows** (parity-based open-delimiter detection).
- Rendered **block-by-block with entrance animations** (stable committed blocks — no full-innerHTML flicker) and a live caret.

Drive it with an updating `text` prop, or hand it a `stream` (async iterable or `ReadableStream`). Reference behaviour: [ai-sdk jsx-preview](https://elements.ai-sdk.dev/components/jsx-preview).

## 8. Theming ✅

`theme={{ appearance: 'light' | 'dark' | 'auto' }}` (auto follows `prefers-color-scheme`). All styling is CSS custom properties (`--tw-*`) — no CSS-in-JS runtime — so tokens can be overridden. Styles are self-injected once (drop-in; no external stylesheet import). Respects `prefers-reduced-motion` and `prefers-reduced-transparency`.

## 9. Security ✅

- **Sanitizing renderer** (`core/render.ts`) is the boundary: all text/attributes are escaped; every URL passes a scheme allowlist (`safeUrl` blocks `javascript:`, `data:text/html`, obfuscation, etc.); raw HTML / MDX is emitted **escaped**, never as live markup. Covered by unit + end-to-end XSS tests, and cleared by an independent adversarial review.
- **Electron-safe execution model** (for MDX, once shipped): compiled output runs in an opaque-origin sandboxed `iframe` (`allow-scripts`, no `allow-same-origin`), so an XSS payload can't escalate to host/Node access.

## 10. Performance ✅

- ✅ **Incremental, block-structured reparse** (`parseIncremental`): reuses the block prefix before the edit, bounds the reparse to the dirty block(s) with a proven safe boundary, re-offsets the unchanged suffix, and is proven deep-equal to a full parse by a one-way property test. Measured **~1.6× (mid-doc) to ~8.6× (append) faster** than a full reparse on a 50 KB doc (GC-free floor).
- No React on the per-keystroke path in the block model.
- ✅ **Threshold-gated virtualization** for very large documents (`overscan` honored) keeps the rendered DOM bounded so 1 MB docs stay editable.
- Target metric is **keystroke-to-paint latency (INP)** on realistic documents, not batch throughput ([SPEC.md §10](../SPEC.md#10-performance-targets--benchmarking)).
- ✅ **Reproducible benchmark harness + published numbers** (`pnpm bench`) and a **gzip size budget** with a hard CI gate on the headless core (`pnpm size`, core ≈ 13.2 KB gzip). See **[docs/BENCHMARKS.md](./BENCHMARKS.md)** — including the honestly-reported large-doc boundary: the reparse *span* is now bounded to the dirty block(s) (a 2-line reparse even mid-1 MB-doc), but a keystroke's total wall-clock still carries the O(tail) cost of re-offsetting the reused suffix — so a mid-document 1 MB keystroke is ~30 ms floor (down from ~34 ms) and a near-*top* edit does not yet beat a full parse (making the re-offset lazy is roadmap).

## 11. Collaboration & comments ✅

✅ **Shipped** (data-in / events-out — the library stores nothing; the host owns the transport, so CRDT/network stays possible per SPEC §14 without being imposed):

- **Anchored comment threads:** select text → floating Comment action → composer; the created thread highlights its exact range, and the **anchor survives edits** — insert a paragraph above it and the highlight stays on the same words (offsets ride the same `DocChange` position-mapping as everything else, via `mapAnchor`).
- **Sidebar** with per-thread quote, threaded **replies**, emoji **reactions** (fixed set), and **resolve / reopen**; click a thread to scroll to and flash its highlight. Wired through `CommentsOptions` (`threads` + `onCreate`/`onReply`/`onReact`/`onResolve`/`onDelete`).
- **Presence:** avatar row + live remote cursors/selections rendered as overlays at the correct text positions, from `presence` peers supplied as props.

## 12. Settings ✅

✅ **Shipped:** a built-in settings panel + **⌘K command palette**.

- **Settings panel:** live toggles for mode (fires `onModeChange`), toolbar (docked/floating), folding, theme appearance, and each extension — session-state, host-overridable.
- **Command palette (⌘K / Ctrl+K):** fuzzy-filter overlay listing every registered command (from the single-source `COMMANDS` registry) plus host-supplied entries; Enter runs it against the live selection through the same command engine as the toolbar and keymap.

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
| `unifiedReveal` | `'block' \| 'caret'` | Unified-mode reveal granularity. Default `'block'` (click a block to edit its source); `'caret'` = per-marker reveal around the caret (opt-in, contentEditable). |
| `toolbar` | `boolean \| 'docked' \| 'floating'` | Built-in formatting toolbar. |
| `folding` | `boolean \| FoldingOptions` | Heading folding (default on). |
| `theme` | `{ appearance?, tokens? }` | `'light' \| 'dark' \| 'auto'`. |
| `readOnly` | `boolean` | |
| `placeholder` | `string` | |
| `extensions` | `{ gfm, mdx, mermaid, math, syntaxHighlight }` | Feature flags — all functional in v0.2 (GFM always on; `mdx`/`mermaid`/`math` also need a host-supplied transform/engine to execute, else they render as escaped/plain source). |
| `keymap` | `KeymapOptions` | `preset` (incl. `'none'`) + per-command `bindings`. |
| `comments` | `boolean \| CommentsOptions` | Anchored comment threads (data-in / events-out). |
| `presence` | `PresencePeer[]` | Remote avatars + live cursors. |
| `settings` | `boolean \| SettingsOptions` | Settings panel + ⌘K palette (host-extensible entries). |
| `overscan` | `number` | Virtualization overscan (rows beyond the viewport). |
| `onModeChange` | `(mode) => void` | Fires when the settings panel switches mode. |
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
| `anticipate` | `boolean \| AnticipationOptions` (`links` · `listItems` · `tables` · `emphasis`) |
| `smooth` | `boolean \| { charsPerSecond }` (steady reveal) |
| `componentFallback` | render for a forming/unknown component |
| `className` / `style` | |

### Headless core — `typewright/core`

Framework-agnostic, zero-dependency:

- `parse(src): Document` — offset-exact GFM/MDX-markup AST.
- `parseIncremental(prev, prevSrc, change, nextSrc): Document` — reuse-the-prefix reparse, deep-equal to a full `parse` (property-tested).
- `renderToHtml(doc, opts?)` / `renderInline(nodes)` / `renderNode(node)` — sanitized HTML. `safeUrl(url)`. `RenderOptions.highlight` threads the tokenizer in.
- `highlightToHtml(lang, code)` — native, zero-dep syntax colouring (escaped `tw-tok-*` spans) for js/ts/jsx/tsx, json, css, html, md, python, bash, sql.
- `collectMarkers(doc)` / `hiddenMarkers(doc, sel)` / `activeBlockIndex(doc, offset)` — unified-mode logic.
- `headingFoldRanges(doc)` — fold ranges.
- `applyCommand(text, sel, command)` + `COMMANDS` — the command engine + its enumerable registry (labels/kbd/group).
- `mapAnchor(anchor, change)` — comment-anchor position mapping.
- `cellSourceRange` / `addRow` / `addColumn` / `removeRow` / `removeColumn` / `setAlignment` — pure GFM table-grid helpers.
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
| `typewright/core` | parser (+ incremental), renderer, highlight, unified/fold logic, commands, table + comment helpers, model, AST | no |
| `typewright/streaming` | stream controller + anticipation renderer | no |
| `typewright/mdx` | sandboxed MDX execution (transform adapters + opaque-origin iframe host) | no |

**Zero runtime dependencies.** `react` / `react-dom` (≥18) are optional peers (only for the React entry and MDX widget islands). The MDX transform (`esbuild-wasm` / `@swc/wasm-web`) and any Mermaid/KaTeX engine are **host-supplied optional peers — never bundled**. Ships ESM + CJS + `.d.ts`.

## Runtime support

Modern browsers and Electron (web + desktop). The headless core runs anywhere (incl. Node, for parse/render/serialization).

## Roadmap

v0.2 shipped the previously-deferred surfaces: comments & presence, settings + ⌘K palette, native syntax colouring, sandboxed MDX execution, Mermaid + math engine hooks, the in-place table grid, the fold menu, footnotes + definition lists, streaming link/list/table anticipation + smoothing, the incremental parser, and threshold-gated virtualization — plus the benchmark harness and gzip size budget.

**v0.2.1 (this release) closed the remaining items:**

1. **Character-level (per-caret) marker reveal — shipped, opt-in** (`unifiedReveal: 'caret'`). A managed `contentEditable` surface renders the tested `hiddenMarkers` algorithm live: only the markers around the caret surface; block-level stays the default. IME/composition works through the platform (`contentEditable`), so the SPEC §4.4 hidden-sink is a **documented architectural divergence**, not a gap — the user-facing goal is delivered.
2. **Reparse-span tightening — shipped.** The incremental reparse now bounds the reparsed *span* to the dirty block(s) + a safe look-around and re-offsets the reused suffix — a **2-line reparse** even for a mid-1 MB-doc keystroke, proven deep-equal to a full parse by the property oracle. The *span* is O(edited block); a keystroke's total wall-clock still carries the O(tail) cost of re-offsetting the reused suffix, so mid-doc edits win (~1.45× at 1 MB, ~1.6× at 50 KB) but a near-*top* edit does not yet beat a full parse — making the re-offset lazy is roadmap. See [BENCHMARKS.md](./BENCHMARKS.md).
3. **Published competitor baseline — shipped.** A real CodeMirror-6 / Lezer cold-parse baseline runs over the same fixtures; numbers are published in [BENCHMARKS.md](./BENCHMARKS.md) (Typewright is ~3–4× faster on cold parse at the GC-free floor; honestly caveated as batch parse, not the keystroke-to-paint headline metric).
4. **Accessibility sweep — shipped.** An automated `axe-core` pass runs over every surface (all editor modes incl. caret-reveal, toolbar, comments sidebar, settings panel, ⌘K palette, fold menu, table grid) in the e2e suite with zero serious/critical violations (colour-contrast is excluded as host-theme scope, documented in the suite); two real violations it surfaced (task-checkbox labels, a nested-interactive block role) were fixed.

**Documented coverage boundaries** (honest, not gaps that break anything): the per-caret surface's deep CJK candidate-window / dead-key / soft-keyboard tail and Home/End line-nav are exercised as far as headless e2e reaches, not exhaustively; comment highlights are not *drawn* inline inside a focused caret block (the thread still anchors correctly and shows in the sidebar); fenced-code-block markers are computed offset-exactly by the core `collectMarkers` (and unit-tested) but are not yet *revealed* in the caret surface, because code blocks are not caret-eligible.

The [design prototype](../demo/design-prototype.html) shows the full intended experience.

---

*Status reflects `main` as of the latest release. See the repo [README](../README.md) for install + demo.*
