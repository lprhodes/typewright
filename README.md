<div align="center">

# Typewright

**A blazing-fast, from-scratch GitHub Flavored Markdown + MDX editor and streaming previewer for the web.**

Zero-runtime-dependency engine · Obsidian-style unified live preview · semantic folding · in-place tables · and an LLM token-stream renderer that *anticipates formatting as it arrives*.

[![npm](https://img.shields.io/badge/npm-typewright-cb3837)](https://www.npmjs.com/package/typewright)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![status](https://img.shields.io/badge/status-alpha-orange)](./SPEC.md)

</div>

> [!NOTE]
> **Alpha (v0.2.0).** The engine is real and tested: a from-scratch,
> zero-runtime-dependency GFM+MDX parser → offset-exact AST → **sanitizing** HTML
> renderer, an **incremental reparse**, unified-mode + fold services, and a
> streaming **anticipation** renderer — all wired into working
> `<TypewrightEditor>` and `<StreamingPreview>` components (extensive unit +
> Playwright e2e coverage; an independent adversarial security/correctness review
> passed after fixes). **v0.2 lights up the surfaces v0.1 deferred:** comments &
> presence, a settings panel + **⌘K command palette**, native **syntax
> colouring**, **sandboxed MDX execution** (opaque-origin iframe), **Mermaid +
> math** engine hooks, the **in-place table grid**, the **fold menu**, **footnotes
> + definition lists**, streaming link/list/table **anticipation + smoothing**,
> and **threshold-gated virtualization** — with a reproducible **benchmark
> harness** ([docs/BENCHMARKS.md](./docs/BENCHMARKS.md)) and a gzip **size budget**.
>
> **v0.2.1 closes the remaining items:** the Obsidian-exact **per-caret marker
> reveal** now ships as an opt-in mode (`unifiedReveal: 'caret'`) — a managed
> `contentEditable` surface that reveals only the markers around the caret;
> block-level stays the default. IME/composition works through the platform
> (`contentEditable`/native textareas), so the SPEC §4.4 hidden-sink is a
> **documented architectural divergence**, not a gap. Also shipped: the published
> **CodeMirror-6 baseline**, an **axe-core a11y sweep**, and **reparse-span
> tightening** (mid-doc large-file keystrokes). Documented coverage boundaries: the
> deep CJK/dead-key/soft-keyboard IME tail and Home/End line-nav in the caret
> surface are exercised as far as headless e2e reaches, not exhaustively. The
> public API (`src/types.ts`) is stable and semver-versioned.

---

## Why Typewright

Most web Markdown editors sit on a generic editing framework (CodeMirror, ProseMirror, Lexical) and a generic parser (Lezer, `@mdx-js`). That is the right call for most teams — and the reason no one is meaningfully *faster* than anyone else: they share the same engines.

Typewright takes the other path. The **document model, the incremental parser, and the rendering layer are written from scratch with zero runtime dependencies**, tuned for one grammar (GFM + MDX) and one interaction model (unified live-preview editing). Markdown is block-structured, which makes incremental re-parsing genuinely cheap — an edit re-tokenizes *one block*, not the document — and keeping React out of the per-keystroke path removes the reconciliation tax that generic React-markdown editors pay.

The result is designed to win where it matters: **keystroke-to-paint latency on real documents**, not throughput on 20 MB files nobody edits. See [SPEC.md §10](./SPEC.md#10-performance-targets--benchmarking) for the honest performance thesis.

## Highlights

- ⚡ **From-scratch, zero-runtime-dependency engine.** String-is-state model, viewport-virtualized DOM rendering, hand-written incremental block parser with exact source offsets.
- 👁 **Unified source-revealing mode.** Formatting renders inline; click any block to reveal and edit its raw Markdown (`**`, `` ` ``, `#`) in place, then blur to re-render — the Obsidian "Live Preview" idiom, native rather than bolted on. (Per-**caret** reveal ships opt-in via `unifiedReveal:'caret'` — see [FEATURES.md](./docs/FEATURES.md).)
- 🧩 **Full GFM + MDX v3.** Tables, task lists, strikethrough, autolinks, footnotes; MDX JSX, ESM `import`/`export`, and `{expressions}`.
- 🌊 **Streaming preview with formatting anticipation.** Feed it an LLM token stream and it renders word-by-word while *predicting* incomplete formatting — a partial `*bo` shows as in-progress bold, an unterminated fence opens a code block, partial JSX renders a component skeleton. ([demo pattern](https://elements.ai-sdk.dev/components/jsx-preview))
- 📁 **Semantic heading folding.** Fold a section and everything under it collapses to the next same-or-higher heading, with an H1–H6 fold menu and fold/unfold-all.
- ▦ **In-place table editing.** Edit GFM tables as a grid; the Markdown source stays the source of truth.
- 📊 **Mermaid & math.** Rendered inline, executed in an isolated sandbox.
- 🔒 **Electron-safe by design.** MDX/Mermaid execute in an opaque-origin sandboxed iframe — the XSS→RCE path is closed.
- 🎛 **Drop-in and highly configurable.** One React component, a headless core (`typewright/core`), and a streaming module (`typewright/streaming`).

## Demo

A live demo that **runs the real library** lives in [`demo/`](./demo/): `pnpm demo` (Vite) serves it at http://localhost:5178. It mounts the actual `<TypewrightEditor>` and `<StreamingPreview>` — the four modes, unified block-level editing, GFM rendering, folding, and streaming anticipation — and is the target of the Playwright e2e suite (`pnpm e2e`).

To open the real demo **without a server**, run `pnpm demo:build` and open the self-contained, single-file [`demo/standalone.html`](./demo/standalone.html) directly (`file://`) — everything (React included) is inlined. (`demo/index.html` is the Vite source entry and needs the dev server; opening it raw shows instructions.)

The full **design vision**, including designed-but-deferred surfaces (inline comments + presence, the floating formatting toolbar, in-place tables, Mermaid), is preserved as the self-contained [`demo/design-prototype.html`](./demo/design-prototype.html) — open it directly in a browser. The macOS-style app icon + showcase are in [`assets/`](./assets/) ([`icon.svg`](./assets/icon.svg) · [`icon.html`](./assets/icon.html)).

## Install

```sh
npm install typewright
# or
pnpm add typewright
```

`react` and `react-dom` (≥18) are optional peers — only needed for the React component and MDX widget islands. The headless core has none.

## Quick start

### Drop-in editor

```tsx
import { TypewrightEditor } from 'typewright';

export function Doc() {
  const [md, setMd] = React.useState('# Hello\n\nType **markdown** here.');
  return (
    <TypewrightEditor
      value={md}
      onChange={setMd}
      mode="unified"                 // live preview with source revealed at the caret
      extensions={{ gfm: true, mdx: true, mermaid: true }}
      folding
    />
  );
}
```

### Streaming from an LLM

```tsx
import { TypewrightEditor } from 'typewright';
import { createStreamController, pipeStream } from 'typewright/streaming';

const [text, setText] = React.useState('');
const controller = React.useMemo(
  () => createStreamController(setText, { anticipate: true, smooth: true }),
  [],
);

// e.g. Vercel AI SDK: await pipeStream(result.textStream, controller)
await pipeStream(llmTextStream, controller);

<TypewrightEditor value={text} mode="preview" readOnly />;
```

### Headless (no React)

The zero-dependency core parses, renders (sanitized), and reparses incrementally — no DOM required, so it runs in Node too:

```ts
import { parse, renderToHtml, parseIncremental } from 'typewright/core';

const src = '# Doc\n\nType **markdown** here.';
const doc = parse(src);
const html = renderToHtml(doc);            // sanitized HTML string

// a single-keystroke edit reparses by reusing the block prefix:
const next = src + '!';
const doc2 = parseIncremental(doc, src, { from: src.length, to: src.length, insert: '!' }, next);
```

## Configuration

`<TypewrightEditor>` accepts the full [`EditorConfig`](./src/types.ts) surface — `mode`, `toolbar`, `extensions` (`gfm` / `mdx` / `mermaid` / `math` / `syntaxHighlight`), `folding`, `keymap`, `theme`, `readOnly`, `overscan`, and the `onChange` / `onSelectionChange` / `onModeChange` events. The complete, documented contract is `src/types.ts`; the behaviour behind each option is specified in [SPEC.md §9](./SPEC.md#9-public-api).

> 📚 **The complete feature catalogue + API reference — every capability with honest shipped/planned status — is [`docs/FEATURES.md`](./docs/FEATURES.md).**

## Package layout

| Import | What |
|---|---|
| `typewright` | The drop-in React editor component. |
| `typewright/core` | The headless, framework-agnostic engine. |
| `typewright/streaming` | The LLM stream controller + anticipation options. |

## Status & roadmap

Typewright is being built spec-first. See **[SPEC.md](./SPEC.md)** for the architecture, **[docs/FEATURES.md](./docs/FEATURES.md)** for the honest per-feature status, and **[docs/BENCHMARKS.md](./docs/BENCHMARKS.md)** for measured performance. Broadly, as of **v0.2**:

1. ✅ **Foundation** — document model, incremental GFM block parser, threshold-gated virtualized view.
2. ✅ **Unified mode** — decoration culling, rebindable keybindings + ⌘K palette, folding + fold menu.
3. ✅ **Rich editing** — in-place tables, native syntax highlighting, Mermaid, math (engines host-supplied).
4. ✅ **MDX** — markup parser, wasm transform boundary, sandboxed execution.
5. ✅ **Streaming** — the anticipation engine (links/lists/tables/smoothing) + partial JSX.
6. ✅ **Hardening** — comments/presence, benchmarks + gzip size budget, opt-in per-caret marker reveal (contentEditable; IME via the platform), reparse-span tightening for mid-doc large-file edits, the published CodeMirror-6 baseline, and an axe-core a11y sweep are all shipped. The SPEC §4.4 custom hidden-sink is a documented architectural divergence (the per-caret + IME goals are met via contentEditable), not a remaining gap.

## Contributing

Early days — issues and design discussion welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Luke Rhodes
