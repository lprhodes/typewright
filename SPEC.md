# Typewright — Architecture Specification

**Status:** Draft v1 (pre-implementation) · **Owner:** Luke Rhodes ([@lprhodes](https://github.com/lprhodes)) · **License:** MIT

A highly performant, from-scratch GitHub Flavored Markdown + MDX editor and streaming previewer for the web, shipped as a drop-in React component with a headless core. This document is the authoritative design; the code is built to it.

---

## 1. Goals & non-goals

### 1.1 Goals

1. **Fastest interactive editing loop of any web Markdown editor** — measured as keystroke-to-paint latency (INP) on realistic documents, not batch throughput.
2. **Full GitHub Flavored Markdown + full MDX v3** — tables, task lists, strikethrough, autolinks, footnotes; MDX JSX, ESM `import`/`export`, and `{expressions}`.
3. **Unified source-revealing edit mode** — formatting renders inline, raw syntax reveals around the caret (the Obsidian "Live Preview" idiom), plus fully-editable rich preview and read-only render modes.
4. **Rich editing UI** — in-place table editing, semantic heading folding with an H1–H6 menu, inline Mermaid, math, syntax-highlighted code, and standard text-editing keyboard shortcuts.
5. **Streaming preview with formatting anticipation** — ingest an AI/LLM token stream and render incrementally while predicting incomplete formatting (partial `*bo` → in-progress bold; open fence → code block; partial JSX → component skeleton).
6. **Drop-in and highly configurable** — one React component, a headless core, a streaming module; every behaviour toggleable.
7. **Zero third-party runtime dependencies** in the engine (one *conceded* boundary: the JSX/TS→JS transform for MDX execution — see §7).
8. **Web + Electron safe** — MDX/Mermaid execution cannot escalate to host access.
9. **Collaboration-ready** — the architecture must not foreclose real-time CRDT co-editing (not a v1 feature).

### 1.2 Non-goals (v1)

- Real-time collaborative co-editing (kept *possible*, not built — §14).
- A WYSIWYG model that abstracts the Markdown away (Typewright is always string-is-state).
- Beating batch Markdown-to-HTML converters on multi-MB throughput (the wrong metric — §10).
- Bundling a full JavaScript/TypeScript compiler (§7).

---

## 2. Design principles

1. **The string is the source of truth.** The document is a flat text string. Rich rendering is a *non-destructive overlay* of decorations, never a mutation of the model. This is the single decision that makes the unified source-revealing mode native instead of a fight (it is why CodeMirror-class editors can do it and ProseMirror/Lexical-class ones cannot).
2. **React out of the hot path.** The per-keystroke loop — parse, decorate, render viewport — is vanilla DOM against the model. React appears *only* to mount interactive widget islands (tables, Mermaid, MDX components) via a portal registry (§5.4). This removes the reconciliation cost generic React-markdown editors pay.
3. **Own the model, parser, and view; concede only input capture and JS execution to the platform.** Reimplementing IME/composition or a JS engine is a trap; everything else is ours (§4.4, §7).
4. **Incrementality follows Markdown's block structure.** An edit dirties one block; re-tokenize that block, reuse every other node. Block boundaries are a natural, cheap incrementality unit a generic parser doesn't exploit as cleanly (§4.2).
5. **Viewport-bounded work.** Parsing detail, decoration computation, and DOM materialization are bounded by what's visible, so latency is independent of document length.
6. **Configurable by composition.** Features are extensions over a small core; a consumer enables only what they need, and the core has no hard dependency on any of them.

---

## 3. System architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│ React binding  (typewright)          — thin wrapper, controlled/uncontrolled │
├───────────────────────────────────────────────────────────────────────┤
│ Headless engine  (typewright/core)                                      │
│                                                                         │
│   Document model ──► Incremental parser ──► Decoration builder ──► View  │
│   (piece table)      (block + inline,       (mark/replace/          (virtualized │
│         ▲             offset-exact)          widget/line)            DOM)  │
│         │                                        │                    │   │
│   Input substrate (hidden input sink: keys+IME)  │              Widget registry │
│         │                                        │                    │   │
│   Command / keymap ◄─────────────────────────────┘        React portals ┘   │
│                                                                         │
├───────────────────────────────────────────────────────────────────────┤
│ Async side-channels (Web Workers)                                       │
│   • MDX compile (markup parse = ours; JSX/TS transform = wasm) → iframe  │
│   • Mermaid render → iframe                                              │
│   • (optional) heavy syntax highlight for read/export views             │
├───────────────────────────────────────────────────────────────────────┤
│ Streaming layer  (typewright/streaming)  — anticipation renderer         │
└───────────────────────────────────────────────────────────────────────┘
```

### Layer summary

| Layer | Responsibility | Thread | Deps |
|---|---|---|---|
| Document model | Immutable text + edit transactions + position mapping | main | none |
| Incremental parser | GFM + MDX markup → offset-exact tree, dirty-block reparse | main | none |
| Decoration builder | Map tree nodes → mark/replace/widget/line decorations, viewport-scoped | main | none |
| View | Virtualized DOM materialization, selection/caret rendering | main | none |
| Input substrate | Capture keystrokes/IME/composition via a hidden sink | main | platform |
| Widget registry | Mount React islands into decoration holes via portals | main | react (peer) |
| MDX compile | Markup parse (ours) + JSX/TS transform (wasm) + evaluate | worker + iframe | wasm transform |
| Streaming | Accumulate tokens, anticipate formatting, drive the view | main | none |

---

## 4. The editing engine (from scratch)

### 4.1 Document model

- A **piece table** (or gap buffer) over the immutable original string plus appended edit buffers. Edits are `{from, to, insert}` transactions; the model never mutates in place, enabling cheap undo/redo and position mapping.
- **Position mapping**: every transaction produces a change description that maps prior offsets to new offsets, so decorations, selections, and fold ranges survive edits without a full recompute.
- **UTF-16 offsets** throughout (matching the DOM/`Selection` API); grapheme-cluster awareness is handled at the cursor-motion layer, not the model.

### 4.2 Incremental parser

The parser is hand-written, offset-exact, and specialized for GFM + MDX. It is a **two-phase block-then-inline** design:

1. **Block phase** — line-oriented scan that partitions the document into blocks (headings, paragraphs, fenced code, blockquotes, lists, tables, HTML/JSX blocks, MDX ESM lines, thematic breaks). Each block records `{from, to, type, meta}`.
2. **Inline phase** — within each block that permits inline content, a delimiter-stack scan resolves emphasis, code spans, links, images, autolinks, strikethrough, footnote refs, and MDX expression/JSX spans.

**Incrementality.** On an edit, only the block(s) overlapping the change region are re-scanned (plus a small look-around for constructs that can merge/split across block boundaries — e.g. a blank line splitting a paragraph, a ` ``` ` opening/closing a fence). Unchanged blocks keep their nodes and are re-offset via position mapping. This is `O(edited block)`, not `O(document)`.

**Offset exactness** is the contract everything downstream depends on: every node exposes precise `{from, to}` for its syntax markers *and* its content, which is what lets decorations hide/reveal delimiters and what defines foldable ranges and table cell boundaries.

**Error tolerance.** Incomplete/malformed input (mid-typing, mid-stream) never throws; it produces a best-effort tree with open nodes. This property is what the streaming anticipation engine (§8) builds on.

**GFM coverage.** Tables, task list items, strikethrough (`~~`), extended autolinks, and footnotes are first-class block/inline node types, gated by the `gfm` extension.

**MDX coverage (markup only).** The parser recognizes ESM `import`/`export` statement lines, JSX element boundaries (open/close/self-closing, nested), and `{expression}` spans — enough to highlight, fold, select, and delimit them. It does **not** evaluate JS; that is §7.

### 4.3 Decoration system

Four decoration kinds, applied over `{from, to}` ranges, recomputed only for the visible viewport on each transaction:

- **Mark** — inline styling of a range (emphasis, code, links).
- **Replace** — hide a range and optionally substitute a DOM node (collapsing `**` markers; rendering an image; replacing a table block with its grid widget).
- **Widget** — insert a DOM node at a point without altering text (fold placeholders, the heading fold affordance).
- **Line** — attributes on a whole line's element (active line, blockquote indent, heading level).

Decorations are held in a range set that is **mapped through** each transaction's changes (indices shift, no recompute) and only *rebuilt* for blocks that actually changed within the viewport. This is what prevents the flicker/GC/layout-thrash of naive rebuild-everything approaches.

### 4.4 Input substrate — the line we do not cross

Raw text input is the genuinely hard, platform-specific layer: IME/CJK composition, dead keys, Android soft keyboards, autocorrect, spellcheck, bidi, grapheme-cluster cursor motion, screen-reader semantics.

**Decision:** own the caret, selection rendering, model, and *everything visible*, but route **keystroke and composition capture through a single hidden/overlaid contentEditable-or-input sink** (the technique CodeMirror and Monaco use). We do **not** reimplement composition events. This one concession is the difference between a fast custom editor and a broken one.

### 4.5 View — virtualization

Only lines intersecting `[viewportTop − overscan, viewportBottom + overscan]` are materialized as DOM; off-screen lines are represented by height-reserving placeholders. Line heights are measured and cached; scroll anchoring keeps the caret stable across reflow. Memory and per-keystroke DOM work are bounded by viewport size, not document size.

---

## 5. Modes & rich editing

### 5.1 Modes

`edit` (raw + highlight) · `unified` (live preview, source revealed at caret — flagship) · `preview` (fully rendered, still editable) · `read` (rendered, non-editable). Modes are a decoration-policy switch over the same model, not different engines.

### 5.2 Unified source-revealing mode

The signature interaction. Algorithm, per transaction:

1. The parser yields the syntax nodes intersecting the viewport with exact marker offsets.
2. A state field computes the **active ranges**: nodes whose `{from, to}` (widened by one position on each side) contain any selection range.
3. For each formatting node:
   - **Caret outside** → `Replace` the syntax markers (hide `**`/`` ` ``/`#`), `Mark` or `Widget` the content as rendered.
   - **Caret inside/adjacent** → omit the replace decoration so the raw markers render back into the DOM, with a subtle monospace `Mark` signalling "you are editing raw syntax."
4. A short **click-settle debounce** (~30–50 ms) defers the render→raw transition on click so the DOM shift doesn't land mid-click and mis-place the caret / trigger stray selection (a documented failure of naive implementations).

### 5.3 Heading folding

Semantic, not indentation-based. A fold on an `H2` collapses everything until the next heading of equal-or-higher level. Implemented as a fold service walking the parse tree (never regex, which breaks on headings inside code blocks). The UI (per the reference screenshots): a per-heading affordance opening a menu with **Heading 1–6** level controls, **Toggle Folding**, **Fold All Headers**, **Unfold All Headers**, and **Copy Link to here**. Fold state is optionally persisted (`folding.persistKey`). Fold placeholders are `Widget` decorations that can summarize the collapsed section (child count / word count).

### 5.4 In-place tables & widget islands

GFM tables (and Mermaid/MDX components) render as **widget islands**:

1. The parser detects the block; a `Replace` decoration hides the raw source and mounts a widget in its place.
2. The widget's DOM hole is registered with a **central portal registry**; the top-level React tree `createPortal`s the interactive component (a grid editor, a Mermaid frame, an MDX component) into it. No isolated React roots.
3. **Bidirectional sync**: editing a cell dispatches a scoped `{from, to, insert}` transaction against exactly that cell's source range — the Markdown stays canonical.
4. **Atomic ranges + transaction filters**: the block's source range is registered atomic so the keyboard caret treats it as one indivisible unit; arrow-key motion into it hands focus to the widget, and motion past the last cell returns focus to the text. This prevents the caret getting "trapped" in hidden source.
5. Off-screen widgets are destroyed (`WidgetType.destroy()` → portal unmount), preserving the frame budget.

### 5.5 Syntax highlighting, Mermaid, math

- **Editing view** highlighting is native (the parser already tokenizes fenced code via nested sub-grammars) — no third-party highlighter on the hot path.
- **Read/export** views may use a heavier, more accurate highlighter, offloaded to a worker; optional.
- **Mermaid** renders in the isolated sandbox (§7), memoized by diagram source, re-rendered on edit debounce.
- **Math** via a pluggable engine (KaTeX-compatible interface); optional.

---

## 6. GFM & MDX support matrix

| Feature | Parse | Edit | Render | Notes |
|---|---|---|---|---|
| Headings, paragraphs, lists, blockquotes, thematic breaks | ✓ | ✓ | ✓ | CommonMark core |
| Emphasis / strong / inline code / links / images | ✓ | ✓ | ✓ | delimiter stack |
| Fenced & indented code | ✓ | ✓ | ✓ | nested highlight |
| GFM tables | ✓ | ✓ (grid) | ✓ | §5.4 |
| Task lists | ✓ | ✓ | ✓ | checkbox toggles source |
| Strikethrough | ✓ | ✓ | ✓ | `~~` |
| Autolinks (extended) | ✓ | ✓ | ✓ | |
| Footnotes | ✓ | ✓ | ✓ | |
| MDX ESM `import`/`export` | ✓ | ✓ | n/a | highlighted; feed the sandbox |
| MDX JSX elements | ✓ | ✓ | ✓ | render = §7 |
| MDX `{expressions}` | ✓ | ✓ | ✓ | render = §7 |
| Mermaid (```` ```mermaid ````) | ✓ | ✓ | ✓ | sandbox |
| Math (`$`/`$$`) | ✓ | ✓ | ✓ | optional |

---

## 7. MDX: the markup/execution split

MDX = Markdown + JSX + JS expressions. The two jobs are handled by different layers, and **neither the browser nor Electron parses JSX/TS for you** — the platform only *executes* plain JS.

1. **Markup parse (ours).** Typewright's parser finds where JSX elements/expressions begin and end — enough for highlighting, folding, selection, and delimiting. Zero dependency.
2. **Transform (the one conceded boundary).** Turning JSX/TS into runnable plain JS is delegated, because a correct JS+JSX parser/transformer is a multi-year project on its own. Options via `MdxOptions.transform`:
   - `wasm-esbuild` — `esbuild-wasm` in a worker (smallest, fastest transform-only).
   - `wasm-swc` — `@swc/wasm-web`.
   - `constrained` — a small built-in transform for a *restricted* MDX-JS subset (no dependency), for hosts that want true zero-dep and accept a limited surface.
   - a host-supplied `(code) => js` function.
3. **Execution (the platform).** The transformed plain JS runs inside an **`iframe srcdoc sandbox="allow-scripts"` with an opaque origin** (no `allow-same-origin`). It cannot reach the host DOM, storage, or session — the same V8 in a browser tab and an Electron renderer, so behaviour is identical; Electron's Node-bearing main process is never in the execution path. This closes the XSS→RCE escalation. Host/network access a component legitimately needs is brokered by `postMessage` to the host, which proxies it (`SandboxOptions.onHostMessage`).

Pipeline: `debounce → worker: (our markup parse → transform) → postMessage compiled module → iframe evaluate → render`. Only the transform+eval are off the main thread; the editor never blocks on MDX.

---

## 8. Streaming preview with formatting anticipation

The novel capability. A token stream (typically an LLM) is rendered incrementally, and **incomplete formatting is optimistically resolved** so the preview reads as finished prose while it's still arriving. Reference behaviour: [ai-sdk JSX preview](https://elements.ai-sdk.dev/components/jsx-preview).

### 8.1 Controller

`createStreamController(onUpdate, options)` (see `typewright/streaming`) accumulates chunks and exposes `push` / `replace` / `end` / `reset`. `pipeStream(source, controller)` drives it from an `AsyncIterable<string>` or `ReadableStream<string>` (e.g. `result.textStream` from the Vercel AI SDK). *(Accumulation + piping are implemented today; the anticipation renderer below is the pending work.)*

### 8.2 Anticipation algorithm

The engine relies on the error-tolerant incremental parser (§4.2), which already yields **open nodes** for unterminated constructs:

1. Parse the running buffer after each chunk (incremental — only the tail block is dirty).
2. For each **open node** at the buffer's end, apply an **anticipation policy** (`AnticipationOptions`) that renders it as if closed:
   - `*bo` / `**bo` → in-progress emphasis/strong (render bold, style the open marker as pending).
   - unterminated `` ` `` or ```` ``` ```` → open inline-code / code block.
   - `[text`(no `]`) / `[text](ur` → link forming.
   - `#`…(no newline) → heading forming.
   - a partially-typed table row → grid with a ghost row.
   - `<Comp pr` → JSX element forming → render `componentFallback` skeleton until the tag + required props resolve.
3. On the next chunk, the open node either **completes** (promote to a real node, drop the pending styling) or **extends** (keep anticipating). On `end()`, all still-open nodes resolve to their best-effort final form.
4. **Stability rule:** anticipation only ever *adds* rendering ahead of confirmation; it never reflows already-confirmed content, so text doesn't jump as it streams.
5. **Smoothing** (`smooth`) optionally reveals characters at a target rate rather than in raw chunk jumps, decoupling visual cadence from network cadence.

### 8.3 Partial JSX / components

When `anticipate.jsx` is on and the transform supports it, a syntactically-complete-enough JSX subtree is speculatively transformed and rendered in the sandbox; an incomplete one shows `componentFallback`. Failed speculative transforms are swallowed (the tolerant path), never surfaced as errors mid-stream.

---

## 9. Public API

The full, documented contract is [`src/types.ts`](./src/types.ts). Shape:

- **`<TypewrightEditor>`** (`typewright`) — `EditorConfig` + `EditorEvents` + controlled/uncontrolled `value`/`defaultValue` + `className`/`style`.
- **`EditorView`** (`typewright/core`) — headless mount: `new EditorView({ parent, ...config })`, `dispatch`, `setSelection`, `destroy`.
- **`createStreamController` / `pipeStream`** (`typewright/streaming`).

Key config surfaces: `mode`, `extensions` (`gfm`/`mdx`/`mermaid`/`math`/`syntaxHighlight`, each a boolean or an options object), `folding`, `keymap` (preset + binding overrides), `theme` (appearance + token overrides), `readOnly`, `overscan`. Every feature is independently toggleable; nothing is mandatory but the core editor.

**Headless render path** (`typewright/core`, no DOM — runs in Node/SSG):

- `parse(src, ParseOptions)` — `math` / `footnotes` / `defLists` / `frontmatter`, each defaulting to `false`. `frontmatter` locates a closed leading `---` block onto `doc.frontmatter` and **does not interpret it** (a YAML parser would be a runtime dependency, which §7's zero-dependency rule forbids outside the MDX transform boundary). Frontmatter is not a `Block` and never enters `children`.
- `renderToHtml(doc, RenderOptions)` — `highlight` / `math` hooks, plus `headingIds` (unique, URL-safe heading anchors) and `classMap` (additive class names on emitted elements, attribute-escaped). Both default off; omitting them yields byte-identical output to prior versions.
- `outline(doc)` / `slugify` / `createSlugger` — the table-of-contents input. `outline` and `renderToHtml` read ids from **one allocator keyed by node identity**, so a TOC's anchors provably match the rendered `id`s.

Rendered content ships no client JavaScript. `renderToHtml` still escapes raw HTML and MDX per §11 — server-rendering MDX *components* is out of scope for the sanitizing renderer.

**Stability policy:** the type surface is the contract and is versioned semver; internal engine modules are private and may change freely.

---

## 10. Performance targets & benchmarking

**Thesis:** the metric that matters is **keystroke-to-paint latency (INP)** on realistic documents (5–50 KB, some containing tables / a Mermaid block / MDX), *not* Markdown-to-HTML throughput on multi-MB files nobody edits. WebAssembly Markdown parsers win on the latter and lose on the former (JS↔WASM marshalling dominates below ~256 KB), so the engine is JS + incremental, not WASM, on the hot path. WASM is used only where it genuinely wins: the off-thread MDX transform (§7).

**Targets (to be validated, not asserted):**

| Metric | Target | Workload |
|---|---|---|
| Keystroke → paint (p95) | < 8 ms | 50 KB doc, mixed content, mid-document edit |
| Cold parse | < 16 ms | 50 KB doc |
| Large-doc typing (p95) | < 8 ms | 1 MB doc (viewport-bounded) |
| Memory | viewport-bounded | 1 MB doc vs 50 KB doc within a small constant factor |
| Bundle (core, gzip) | small, tracked in CI | headless core, no extensions |

**Method:** a reproducible harness (documents + edit scripts) comparing against named incumbents (CodeMirror-6-based editors, ProseMirror/TipTap, Lexical) on the *same* workloads. A speed claim without a named workload and a named competitor is not shippable. Be honest: incumbents built on CodeMirror share its engine, so the win is in the tailored parser, the React-free hot path, MDX, and streaming — not a magic constant on plain typing.

---

## 11. Security model

- **MDX/Mermaid isolation** — opaque-origin sandboxed iframe, `allow-scripts` only, no `allow-same-origin`; host access brokered via `postMessage`. Electron-safe (§7).
- **No `dangerouslySetInnerHTML`** of compiled output into the host tree.
- **URL discipline** — every rendered link/image `href`/`src` passes a scheme allowlist.
- **CSP** — the sandbox document carries a strict CSP; hosts may extend it (`SandboxOptions.csp`).
- **Resource bounds** — parse/render guards against pathological inputs (deeply nested structures, giant tables) to avoid main-thread stalls.

---

## 12. Configurability & theming

- **Extensions** are opt-in modules; the core ships nothing it doesn't need.
- **Theming** via CSS custom properties (`--tw-*`) with `light`/`dark`/`auto` and per-token overrides; no CSS-in-JS runtime.
- **Keymap** is data-driven (command ids), fully rebindable, with a `none` preset for hosts that supply their own.
- **Commands** are a public registry, so hosts can add toolbar actions/slash-commands against the same transaction API the built-ins use.

---

## 13. Build / no-build boundaries

| Concern | Decision |
|---|---|
| Document model, parser, decorations, view | **From scratch, zero deps.** The moat and the speed. |
| Text-input capture (keys/IME/composition) | **Platform** (hidden sink). Do not reimplement. |
| JSX/TS → JS transform (MDX) | **One conceded dependency** (`esbuild-wasm`/`swc-wasm`) or a constrained hand-roll. |
| JS execution | **Platform** (V8 in a sandboxed iframe). Never a dependency. |
| CRDT (future) | A *shape* kept viable, not built in v1 (§14). |

---

## 14. Collaboration-readiness (future)

Not a v1 feature, but the architecture must not foreclose it. Because every change is an immutable `{from, to, insert}` transaction, a CRDT text type (Yjs-`Y.Text`-shaped) can bind by translating local transactions to CRDT ops and applying remote ops as transactions that flow through the *same* parse → decorate → render pipeline. Remote cursors/selections render as ordinary widget/line decorations. The v1 requirement is only that transactions stay the sole mutation path and positions stay mappable — both already true.

---

## 15. Roadmap

- **Phase 0 — Foundation.** Document model (piece table + position mapping), input substrate (hidden sink, IME), virtualized view, selection/caret rendering. *De-risk first: prove IME + a11y + scrolling before anything else.*
- **Phase 1 — Parser.** Incremental block+inline GFM parser with exact offsets and dirty-block reparse. Benchmark keystroke latency vs a CodeMirror-6 baseline (validates the thesis).
- **Phase 2 — Rendering & unified mode.** Decoration system, active-line culling, standard keymap, semantic heading folding + fold menu.
- **Phase 3 — Rich editing.** In-place tables, native code highlighting, Mermaid, math.
- **Phase 4 — MDX.** Markup parser extension, wasm transform boundary, sandboxed execution, component map.
- **Phase 5 — Streaming.** Anticipation engine, partial JSX, smoothing.
- **Phase 6 — Hardening.** Accessibility, IME/bidi edge cases, benchmark suite + published numbers, collaboration-readiness proof.

Each phase ships behind the stable API in [`src/types.ts`](./src/types.ts); the `<textarea>` scaffold is replaced incrementally as phases land.

---

## 16. Open questions

- **Constrained transform surface** — exactly which MDX-JS subset the zero-dep `constrained` transform supports, and how it degrades to `wasm-*`.
- **Widget island cost at scale** — pooling/virtualization strategy when a document has many inline Mermaid/MDX islands (per-island iframe budget vs a shared sandbox).
- **Anticipation policy defaults** — which constructs anticipate by default vs opt-in, tuned against real LLM streams to avoid distracting flicker.
- **Read/export highlighter** — whether to ship a heavier accurate highlighter for read mode or keep everything on the native tokenizer.
- **Collaboration timing** — when (if) to promote CRDT from "kept possible" to a shipped feature.
