# Plan — TW-0001: Typewright editor v1

**Spec:** [spec-TW-0001.md](../specs/spec-TW-0001.md) · **Architecture:** [SPEC.md](../../SPEC.md)
**Size tier:** **Large** (greenfield from-scratch editing engine)
**Status:** Ready for Work

> The codebase is greenfield: a scaffold (`src/types.ts` API contract, three
> entry points, `<textarea>` stub) plus the authoritative [SPEC.md](../../SPEC.md).
> This plan sequences SPEC.md §15 into concrete, buildable phases with files and
> per-phase acceptance. Build order is **de-risk-first**: the substrate and the
> parser (the two make-or-break layers) come before features.

---

## 0. Ground rules (carried from SPEC.md)

- Zero runtime deps in the engine; React is a peer used only for widget islands; the one conceded dep is the MDX transform.
- The string is the only source of truth; every mutation is a `{from,to,insert}` transaction; positions are always mappable.
- React stays out of the per-keystroke path.
- Each phase ships behind the stable `src/types.ts` API; the `<textarea>` stub is swapped incrementally.
- Every phase lands with unit tests (Vitest) + a demo route exercising it.

## 1. Module map (target `src/` layout)

```
src/
  core/
    text/            piece-table document model + position mapping
    parser/          incremental block + inline parser (GFM + MDX markup)
    decoration/      decoration set + range mapping
    view/            virtualized DOM view, selection/caret, input sink
    commands/        keymap + command registry
    fold/            semantic heading fold service + fold state
    widgets/         widget registry + atomic ranges + portal bridge
    toolbar/         formatting toolbar (docked/floating) + command bindings
    comments/        selection popup, comment threads, anchors, presence
    index.ts         EditorView (public)
  react/             <TypewrightEditor>, hooks, portal host
  streaming/         controller (done) + anticipation renderer
  mdx/               markup extension, transform adapters, sandbox host
  extensions/        gfm, mermaid, math, syntaxHighlight (opt-in)
  types.ts           public contract (exists)
```

## 2. Phases

### Phase 0 — Foundation & substrate  ⟶ *de-risk first*
**Build:** piece-table model + position mapping (`core/text`); the input substrate — a hidden contentEditable/textarea sink capturing keys **and IME/composition** (`core/view/input`); virtualized DOM view with measured line heights + scroll anchoring (`core/view`); selection/caret rendering; a minimal `EditorView` that round-trips typing on a plain string.
**Acceptance:** type/select/undo/redo on a 1 MB plain-text doc with viewport-bounded latency; **IME/CJK composition, dead keys, and screen-reader focus verified** across Safari/Chrome/Firefox; caret stable across scroll.
**Gate:** this is the make-or-break layer — if IME/a11y/virtualization aren't right, stop and fix before Phase 1.

### Phase 1 — Incremental parser
**Build:** block-phase scanner (headings, paragraphs, fenced code, blockquotes, lists, tables, thematic breaks, HTML/JSX/ESM blocks) + inline-phase delimiter-stack resolver (emphasis, code, links, images, autolinks, strikethrough, footnote refs); exact `{from,to}` offsets on markers + content; **dirty-block reparse** driven by transactions with cross-boundary look-around; error-tolerant open nodes.
**Acceptance:** GFM conformance suite passes; incremental reparse touches only edited block(s) (assert via instrumentation); **keystroke-to-paint benchmarked vs a CodeMirror-6 baseline on the SPEC.md §10 docs** (validates the speed thesis before building on it).

### Phase 2 — Decorations, unified mode, keymap, folding, toolbar
**Build:** decoration set (mark/replace/widget/line) with range mapping (`core/decoration`); the mode policy (`edit`/`unified`/`preview`/`read`); **active-line syntax culling** with the click-settle debounce (`core/view` + a state field); standard keymap + command registry (`core/commands`); **semantic heading fold service** + fold state + the **fold menu UI** (Heading 1–6 / Toggle / Fold All / Unfold All / Copy Link) matching the reference screenshots (`core/fold`); the **formatting toolbar** (`core/toolbar`) — full inline/block/insert/MDX tool set bound to commands, contextual table tools, and the **docked/floating** display modes (floating = reveal on hover/focus, nudge content, hold while focused).
**Acceptance:** C1–C6, C17–C19 demonstrable; caret placement correct on click into rendered text; fold menu behaves per spec; every toolbar command maps to a real transaction; floating toolbar reveals/holds per the focus rule; fold survives edits (persist via `folding.persistKey`).

### Phase 3 — Rich editing (tables, code, mermaid, math)
**Build:** widget registry + `atomicRanges` + transaction filters + focus handoff (`core/widgets`); the React portal host (`react`); **in-place table grid** with bidirectional cell↔source sync; native fenced-code highlighting; **Mermaid** + **math** extensions rendering in the sandbox (`extensions/*`).
**Acceptance:** C7–C11; editing a cell writes exactly that cell's source range; table stays canonical Markdown; arrow-key motion into/out of a table hands focus correctly; off-screen widgets destroy.

### Phase 4 — MDX
**Build:** MDX markup parser extension (JSX/ESM/expression nodes) into Phase-1 parser; transform adapters (`mdx/transform`: `wasm-esbuild`, `wasm-swc`, `constrained`, fn); worker pipeline; **sandboxed iframe host** (opaque origin, `allow-scripts`, postMessage broker) (`mdx/sandbox`); component-map wiring.
**Acceptance:** C12; MDX components render from a host map; ESM/expressions work; **sandbox escape attempts fail** (cannot reach host DOM/storage); Electron-safe verified; editor never blocks on MDX (debounced/off-thread).

### Phase 4b — Collaboration & comments
**Build:** anchored **comment threads** (`core/comments`) — a selection raises a floating action popup; adding a comment anchors a highlight decoration to the range and creates a thread; a show/hide **Comments sidebar** renders threads with replies + emoji reactions and resolve/reopen; **presence** avatars (and live cursors/selections built on the §14 decoration-over-transaction path). Anchors ride the same position-mapping as decorations so they survive edits.
**Acceptance:** C20–C23 demonstrable; selecting text offers Comment; a comment highlights its range and appears in the sidebar; replies + reactions work; an anchor survives edits above it (position-mapped, not offset-frozen).

### Phase 5 — Streaming & anticipation
**Build:** the anticipation renderer over the tolerant parser (`streaming`): open-node → anticipation policy per `AnticipationOptions`; stability rule (never reflow confirmed content); smoothing; **partial JSX** speculative transform → skeleton/promote. Wire the controller (already built) to a live preview view.
**Acceptance:** C13–C16; `*bo` → in-progress bold that promotes cleanly; open fence → code block; forming component → skeleton → real; confirmed text never jitters; smoothing decouples from chunk cadence.

### Phase 6 — Hardening & polish
**Build:** accessibility pass (ARIA, screen-reader on virtualized doc), IME/bidi edge cases, the published **benchmark harness + numbers** (SPEC.md §10), bundle-size CI budget, collaboration-readiness proof (transaction↔CRDT binding sketch), theming tokens, docs.
**Acceptance:** benchmark numbers published vs named incumbents; a11y audit clean; bundle budget enforced in CI; SPEC.md §10 targets met or the gap is documented honestly.

## 3. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Input substrate (IME/a11y) underestimated | Phase 0 gate — prove it before anything else. |
| "Faster than any library" unprovable | Phase 1 benchmarks vs CM6 baseline early; if the win isn't there, re-scope the claim (SPEC.md §10 is honest about this). |
| MDX-in-editor parsing complexity | Mix a JS/JSX sub-parser into the block parser (parseMixed-style) rather than a full MDX grammar; markup-only in the editor, transform off-thread. |
| Many inline widget iframes = perf/layout cost | Pool + virtualize islands; only executable islands get iframes; static markup stays plain decorations (SPEC.md §16). |
| Anticipation flicker distracts | Stability rule (only add ahead of confirmation); tune default policy against real LLM streams. |
| Round-trip fidelity (table/widget edits corrupt source) | Scoped per-cell transactions; property tests round-tripping edits ↔ source. |

## 4. Testing strategy

- **Unit (Vitest):** model/position-mapping, parser conformance (GFM + MDX markup), incremental-reparse scope, decoration mapping, fold service, table source sync, anticipation policy, transform adapters.
- **Property tests:** edit→source round-trip fidelity; parse determinism.
- **Browser (Playwright):** IME/composition, unified-mode caret placement, fold menu, table navigation, streaming animation, sandbox isolation, a11y; run across Chromium/WebKit/Firefox.
- **Benchmarks:** keystroke-to-paint + cold parse vs incumbents on fixed docs; tracked over time.

## 5. Definition of done (v1)

C1–C20 demonstrable and tested; SPEC.md §10 targets met or gap documented; a11y + IME solid; MDX sandbox proven; benchmark numbers published; the `<textarea>` stub fully replaced; demo showcase covers every capability; API in `src/types.ts` stable and semver-tagged.
