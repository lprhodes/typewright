<div align="center">

# Typewright

**A blazing-fast, from-scratch GitHub Flavored Markdown + MDX editor and streaming previewer for the web.**

Zero-runtime-dependency engine · Obsidian-style unified live preview · semantic folding · in-place tables · and an LLM token-stream renderer that *anticipates formatting as it arrives*.

[![npm](https://img.shields.io/badge/npm-typewright-cb3837)](https://www.npmjs.com/package/typewright)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![status](https://img.shields.io/badge/status-pre--alpha-orange)](./SPEC.md)

</div>

> [!NOTE]
> **Alpha (v0.1.0).** The core engine is real and tested: a from-scratch,
> zero-runtime-dependency GFM parser → offset-exact AST → **sanitizing** HTML
> renderer, unified-mode + fold services, and a streaming **anticipation**
> renderer — all wired into working `<TypewrightEditor>` and `<StreamingPreview>`
> components (129 unit tests + 9 Playwright e2e; an independent adversarial
> security/correctness review passed after fixes). Still **deferred** (see
> [SPEC.md §15](./SPEC.md#15-roadmap)) and represented in the interactive
> [`demo/`](./demo/index.html): character-level inline marker reveal, custom
> virtualization + full IME, MDX JSX **sandbox execution**, Mermaid, the in-place
> table WYSIWYG grid, and comments/collaboration. The public API (`src/types.ts`)
> is stable and semver-versioned.

---

## Why Typewright

Most web Markdown editors sit on a generic editing framework (CodeMirror, ProseMirror, Lexical) and a generic parser (Lezer, `@mdx-js`). That is the right call for most teams — and the reason no one is meaningfully *faster* than anyone else: they share the same engines.

Typewright takes the other path. The **document model, the incremental parser, and the rendering layer are written from scratch with zero runtime dependencies**, tuned for one grammar (GFM + MDX) and one interaction model (unified live-preview editing). Markdown is block-structured, which makes incremental re-parsing genuinely cheap — an edit re-tokenizes *one block*, not the document — and keeping React out of the per-keystroke path removes the reconciliation tax that generic React-markdown editors pay.

The result is designed to win where it matters: **keystroke-to-paint latency on real documents**, not throughput on 20 MB files nobody edits. See [SPEC.md §10](./SPEC.md#10-performance-targets--benchmarking) for the honest performance thesis.

## Highlights

- ⚡ **From-scratch, zero-runtime-dependency engine.** String-is-state model, viewport-virtualized DOM rendering, hand-written incremental block parser with exact source offsets.
- 👁 **Unified source-revealing mode.** Formatting renders inline; the raw Markdown (`**`, `` ` ``, `#`) is revealed only around your caret — the Obsidian "Live Preview" idiom, native rather than bolted on.
- 🧩 **Full GFM + MDX v3.** Tables, task lists, strikethrough, autolinks, footnotes; MDX JSX, ESM `import`/`export`, and `{expressions}`.
- 🌊 **Streaming preview with formatting anticipation.** Feed it an LLM token stream and it renders word-by-word while *predicting* incomplete formatting — a partial `*bo` shows as in-progress bold, an unterminated fence opens a code block, partial JSX renders a component skeleton. ([demo pattern](https://elements.ai-sdk.dev/components/jsx-preview))
- 📁 **Semantic heading folding.** Fold a section and everything under it collapses to the next same-or-higher heading, with an H1–H6 fold menu and fold/unfold-all.
- ▦ **In-place table editing.** Edit GFM tables as a grid; the Markdown source stays the source of truth.
- 📊 **Mermaid & math.** Rendered inline, executed in an isolated sandbox.
- 🔒 **Electron-safe by design.** MDX/Mermaid execute in an opaque-origin sandboxed iframe — the XSS→RCE path is closed.
- 🎛 **Drop-in and highly configurable.** One React component, a headless core (`typewright/core`), and a streaming module (`typewright/streaming`).

## Demo

An interactive, self-contained prototype of the full featureset lives in [`demo/index.html`](./demo/index.html) — open it in a browser (no build). It represents the unified live-preview editing, the fold menu, in-place tables, the floating formatting toolbar, inline comments + presence, mode switching, theming, and the streaming-anticipation preview. The macOS-style app icon and its showcase are in [`assets/`](./assets/) ([`icon.svg`](./assets/icon.svg) · [`icon.html`](./assets/icon.html)).

> The prototype simulates the interactions to communicate design intent; the real engine (per [SPEC.md](./SPEC.md)) is being built underneath the same API.

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

```ts
import { EditorView } from 'typewright/core';

const view = new EditorView({ parent: el, value: '# Doc', mode: 'unified' });
```

## Configuration

`<TypewrightEditor>` accepts the full [`EditorConfig`](./src/types.ts) surface — `mode`, `extensions` (`gfm` / `mdx` / `mermaid` / `math` / `syntaxHighlight`), `folding`, `keymap`, `theme`, `readOnly`, `overscan`, and the `onChange` / `onSelectionChange` / `onModeChange` events. The complete, documented contract is `src/types.ts`; the behaviour behind each option is specified in [SPEC.md §9](./SPEC.md#9-public-api).

## Package layout

| Import | What |
|---|---|
| `typewright` | The drop-in React editor component. |
| `typewright/core` | The headless, framework-agnostic engine. |
| `typewright/streaming` | The LLM stream controller + anticipation options. |

## Status & roadmap

Typewright is being built spec-first. See **[SPEC.md](./SPEC.md)** for the architecture and **[SPEC.md §15](./SPEC.md#15-roadmap)** for the phased roadmap. Broadly:

1. **Foundation** — document model, incremental GFM block parser, virtualized view.
2. **Unified mode** — decoration culling, standard keybindings, folding.
3. **Rich editing** — tables, syntax highlighting, Mermaid, math.
4. **MDX** — markup parser, wasm transform boundary, sandboxed execution.
5. **Streaming** — the anticipation engine + partial JSX.
6. **Hardening** — a11y, IME, benchmarks, collaboration-readiness.

## Contributing

Early days — issues and design discussion welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Luke Rhodes
