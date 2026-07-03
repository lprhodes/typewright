# TW-0001 — Typewright editor: v1 featureset

**Status:** Ready for Work
**Type:** Library (drop-in React component + headless core)
**Architecture:** [SPEC.md](../../SPEC.md) (authoritative technical design)
**Plan:** [plan-TW-0001.md](../plans/plan-TW-0001.md)

> Ship-feature adaptation: this repo has no upstream "feature file" or HTML mock.
> The architecture [SPEC.md](../../SPEC.md) is the north star; this spec captures
> the same intent as **user-facing featureset + readiness** (what `/triage`
> produces), and drives the design-craft UI representation and the build plan.

---

## 1. Feature description (north star)

Typewright is a **highly performant, drop-in, highly-configurable Markdown + MDX
editor and previewer** delivered as a React component (`typewright`) over a
headless engine (`typewright/core`), with a streaming module
(`typewright/streaming`). It supports the **full GitHub Flavored Markdown and
MDX v3** specifications, edits through a **unified source-revealing live-preview**
surface (formatting renders inline; raw syntax reveals around the caret), and can
render an **AI/LLM token stream word-by-word while anticipating incomplete
formatting**. It is engineered to have the **fastest interactive editing loop of
any web Markdown editor**, is safe to run inside Electron, and does not foreclose
future real-time collaboration.

The user experiences one cohesive editor — not a split source/preview pane — that
feels like a modern word processor while the underlying document stays portable
Markdown at all times.

## 2. User-facing capabilities (each a verifiable behaviour)

**Editing & modes**
- C1. Type Markdown and see it render **inline** as you type (unified mode); the raw markers (`**`, `` ` ``, `#`, `[]()`) appear only on the line/selection you are editing and hide elsewhere.
- C2. Switch between **Edit** (raw + highlight), **Unified** (live preview), **Preview** (rendered + editable), and **Read** (rendered, non-editable) modes.
- C3. All **standard text-editing keyboard shortcuts** work (bold/italic/link, undo/redo, select/word/line motion, copy/paste), plus a rebindable keymap.
- C4. The rich preview is **fully editable** — clicking rendered text places the caret in the right place in the source with no jump/mis-selection.

**Structure**
- C5. **Semantic heading folding**: fold a heading and everything beneath it (down to the next same-or-higher heading) collapses. A per-heading menu offers **Heading 1–6** level set, **Toggle Folding**, **Fold All Headers**, **Unfold All Headers**, and **Copy Link to here** (matches the reference screenshots).
- C6. A collapsed section shows a summary placeholder (child/word count).

**GFM richness**
- C7. **In-place table editing** — GFM tables render as an editable grid (cell edit, tab/arrow navigation, add/remove row/column, alignment); the Markdown source stays canonical.
- C8. **Task lists** with clickable checkboxes that toggle the source.
- C9. Strikethrough, extended autolinks, footnotes.
- C10. **Mermaid diagrams** render inline (```` ```mermaid ````); **math** renders inline (`$`/`$$`).
- C11. **Syntax-highlighted** fenced code.

**MDX**
- C12. **MDX v3**: JSX components render inline (from a host-supplied component map), ESM `import`/`export` and `{expressions}` are supported; MDX executes in an isolated sandbox (Electron-safe).

**Streaming (novel)**
- C13. **Streaming preview**: feed an LLM token stream and the preview renders incrementally.
- C14. **Formatting anticipation**: an incomplete `*bo` optimistically renders as in-progress bold; an unterminated fence opens a code block; a forming link/heading/table row renders ahead of completion — and never reflows already-confirmed content (no jitter).
- C15. **Partial JSX/components**: a forming `<Component …>` renders a skeleton until its tag/props resolve, then promotes to the real component.
- C16. Optional **smooth reveal** (characters at a target rate) decoupled from network chunk cadence.

**Authoring toolbar**
- C17. A comprehensive **formatting toolbar**: inline (bold, italic, strikethrough, inline code, link, highlight), block (heading level, bullet / numbered / task lists, blockquote, horizontal rule), insert (table, code block, Mermaid, math, image, footnote), and MDX (insert component, insert expression).
- C18. **Contextual table tools** appear when a table/cell is active: add / delete row & column, column alignment, header toggle.
- C19. The toolbar is configurable: **docked** (always visible) or **floating** — it appears when the text area is hovered or focused, nudges the content down slightly, and stays while the editor is focused.

**Collaboration & comments**
- C20. **Presence** — collaborator avatars on the editor; live cursors/selections are architecture-ready (SPEC.md §14).
- C21. Selecting text raises a **floating action popup** (Comment + quick-format).
- C22. Adding a comment on a selection **highlights** the text and creates a **thread**.
- C23. A **show/hide Comments sidebar** lists threads (quoted text, author, body) with **replies** and **emoji reactions**, and resolve/reopen.

**Integration**
- C24. **Drop-in**: `<TypewrightEditor value onChange … />` works controlled or uncontrolled with sensible defaults.
- C25. **Highly configurable**: every feature (`gfm`/`mdx`/`mermaid`/`math`/`folding`/`syntaxHighlight`), the toolbar mode, comments, the keymap, and the theme (light/dark/auto + token overrides) are independently toggleable; nothing but the core editor is mandatory.
- C26. **Headless option**: `typewright/core` mounts without React.
- C27. **Themeable** via CSS custom properties; no CSS-in-JS runtime.

## 3. UI & logic preview (what design-craft represents)

A single interactive editor surface plus the affordances around it. Surfaces &
states the UI representation must show:

- **The editor canvas** in **Unified** mode: a realistic document (headings, prose, a list, a table, a fenced code block, a callout/MDX component, a Mermaid diagram) rendered inline, with one line in "caret-here" state showing revealed raw syntax (e.g. `**Navigation/flow**` with markers visible — reference screenshot #1).
- **The heading fold menu** popover: Heading 1–6 with the active level checked + ⌘1–⌘6, and Toggle Folding / Fold All Headers / Unfold All Headers / Copy Link to here (reference screenshot #2).
- **A folded section** state (collapsed heading with summary placeholder).
- **In-place table editing**: a selected cell, row/column add affordances.
- **Mode switcher**: Edit · Unified · Preview · Read.
- **The formatting toolbar**: full tool set (inline / block / insert / MDX) with contextual table tools; shown docked and in floating-on-hover/focus mode.
- **Comments**: the selection action popup, the inline comment composer, and the Comments sidebar with a seeded thread (quote + author + replies + reactions) and presence avatars.
- **Streaming state**: a preview mid-stream with an in-progress bold and a forming component skeleton, plus a "streaming" indicator; and the same content resolved after `end()`.
- **Light and dark themes.**
- **Empty state** (placeholder), **read-only state**.
- A configuration/props panel illustrating drop-in usage and toggles (including toolbar mode + comments).

Interaction depth (not a static wireframe): clicking a heading opens the fold
menu; toggling fold collapses/expands; switching modes re-renders; a "play
stream" control animates the anticipation behaviour; toggles flip features live.

## 4. Success criteria (acceptance oracle)

- Every capability C1–C20 is demonstrable.
- Unified mode reveals/hides syntax on the active line without caret mis-placement (C1, C4).
- The fold menu matches the reference screenshots and folds semantically (C5).
- Streaming anticipates incomplete formatting and never reflows confirmed text (C14).
- The component is drop-in (C17) and every feature toggles independently (C18).
- MDX/Mermaid cannot reach the host (sandbox) — verifiable (C12).
- Keystroke-to-paint stays within the SPEC.md §10 budget on the benchmark docs.

## 5. Assumptions (triage defaults; override to change the build)

- **A1.** Target runtime = **web + Electron**; the sandbox model is Electron-safe by default.
- **A2.** MDX JSX/TS→JS transform ships defaulting to a wasm transform (esbuild-wasm), with a `constrained` zero-dep fallback and a host-supplied-fn escape hatch (SPEC.md §7).
- **A3.** Real-time collaboration is **not** v1 — architecture keeps it viable only (SPEC.md §14).
- **A4.** The design-craft representation is an **interactive demo/showcase** (self-contained, in this repo), not composed into any external design system.
- **A5.** Visual identity: a modern, elegant developer-tool aesthetic, dark + light, consistent with the reference screenshots (SF-style type, calm surfaces, subtle glass on popovers). design-craft owns the craft.
- **A6.** Performance is defined as keystroke-to-paint INP on realistic docs (SPEC.md §10), not batch throughput.

## 6. Out of scope (v1)

- Real-time CRDT co-editing (kept possible, not built).
- A WYSIWYG model that discards Markdown.
- Bundling a full JS/TS compiler (only the transform boundary is conceded).
- Server-side rendering pipeline beyond the read/export view.

---

## Progress

**v0.1.0 — shipped to `main` (2026-07-04).** Ran the ship-feature pipeline
(adapted for this standalone repo): design representation → spec → plan → work →
gap-fix → e2e → merge.

**Shipped (real, tested):**
- `typewright/core` — `TextDoc` model (transactions + position mapping), a
  hand-written **GFM parser** producing an offset-exact AST, a **sanitizing**
  HTML renderer (the XSS boundary — escaping + `safeUrl` scheme allowlist; raw
  HTML/MDX escaped, never emitted), unified-mode marker logic, and heading fold
  ranges.
- `typewright/streaming` — the **anticipation** renderer (parity-based
  open-delimiter detection: partial `**bo` → pending bold, open ``` → code
  block, forming `<Comp` → skeleton; confirmed content never reflows).
- `typewright` — a functional `<TypewrightEditor>` (edit / **unified**
  block-level click-to-edit-source live preview / preview / read, folding,
  standard shortcuts, drop-in with injected styles) and `<StreamingPreview>`.
- **Gates:** 129 unit tests, 9 Playwright e2e (green twice), typecheck + tsup
  build (ESM+CJS+dts) all green.
- **Security/correctness:** an independent adversarial review found 3 defects
  (XSS in the stream escaper, unified-edit data-loss on block-count-changing
  edits, parser O(n²) on unmatched brackets) — all **fixed with regression
  coverage**; `render.ts`/`safeUrl` probed clean.

**Deferred (represented in `demo/`, not yet built — SPEC.md §15 later phases):**
character-level inline marker reveal (C1 at char granularity), custom
virtualization + full IME/bidi hardening, MDX JSX **sandbox execution** (C12
renders MDX as escaped source for now — the safety boundary), Mermaid + math
rendering, the in-place table WYSIWYG grid (C7 renders tables read-only), and
the comments/collaboration + presence backend (C20–C23). These are the honest
next phases; the API surface already reserves their options.

**Status:** Done (v0.1.0 core slice). Follow-on phases tracked in
[plan-TW-0001.md](../plans/plan-TW-0001.md) §15.
